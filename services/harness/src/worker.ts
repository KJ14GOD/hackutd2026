// Phase 5 worker: `npx tsx services/harness/src/worker.ts [--programs A,B] [--fresh]`
//
// For each program it runs a harness job and writes every step to SpacetimeDB (harnessJob + harnessEvent),
// which the UI subscribes to live:
//   reading     what Nemotron found in the program (Part 2, cached)
//   looking-up  what the company's documents already answer (Phase 4)
//   asking      questions nobody wrote down, queued as one Slack digest per person (outreach rows)
//   waiting     paused until every one of those questions is answered
//   resuming    answerQuestion (a Slack button) cleared the last open question; the job picks up here
//   done
// Slack: Socket Mode, so no public URL. The synthetic Harbor Card people aren't real Slack users, so every
// digest goes to SLACK_DEMO_USER, labeled with who it is for. --fresh clears old jobs, events and outreach.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { App, LogLevel } from '@slack/bolt';
import { loadConfig } from '../../../packages/shared/src/config';
import { connectStdb } from '../../../packages/shared/src/stdb';
import type { DbConnection } from '../../../packages/shared/src/module_bindings';
import type { Part2 } from '../../reader/src/contract';
import { digestBlocks, markAnswered, type DigestQuestion } from './digest';

const ROOT = resolve(import.meta.dirname, '../../..');
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* environment only */ }
const config = loadConfig();
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const programs = (flag('--programs') ?? config.requirements.harness.demoPrograms.join(',')).split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
const STEP_MS = config.requirements.harness.stepDelayMs;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const part2 = JSON.parse(readFileSync(resolve(ROOT, 'out/part2.json'), 'utf8')) as Part2;

const conn: DbConnection = await connectStdb();
await new Promise<void>((ok, fail) => {
  conn.subscriptionBuilder().onApplied(() => ok()).onError((ctx) => fail(ctx.event ?? new Error('subscription failed')))
    .subscribe(['SELECT * FROM question', 'SELECT * FROM person', 'SELECT * FROM outreach', 'SELECT * FROM harness_job']);
});
const db = conn.db;
const personName = (id: string) => db.person.id.find(id)?.name ?? id;

const slack = new App({ token: process.env.SLACK_BOT_TOKEN, appToken: process.env.SLACK_APP_TOKEN, socketMode: true, logLevel: LogLevel.WARN });
const demoUser = process.env.SLACK_DEMO_USER;
if (!demoUser) throw new Error('SLACK_DEMO_USER is not set (your Slack member id, U...)');

/** Sends every queued digest: one Slack message per (person, program), then marks it sent. */
const sending = new Set<string>();
async function sendQueued() {
  const queued = [...db.outreach.iter()].filter((o) => o.status === 'queued' && !sending.has(o.digestKey));
  for (const digestKey of new Set(queued.map((o) => o.digestKey))) {
    sending.add(digestKey);
    const rows = queued.filter((o) => o.digestKey === digestKey);
    const personId = rows[0].recipientPersonId;
    const qs = rows.map((o) => db.question.id.find(o.questionId)).filter((q): q is NonNullable<typeof q> => !!q);
    const program = qs[0]?.program ?? '';
    const person = db.person.id.find(personId);
    const items: DigestQuestion[] = qs.map((q) => ({
      id: q.id, program: q.program, text: q.text, options: JSON.parse(q.optionsJson) as string[], evidence: JSON.parse(q.evidenceJson) as string[],
      why: q.routeWhy, quotes: (JSON.parse(q.quotesJson) as { title: string; url: string }[]),
    }));
    const blocks = digestBlocks({ name: person?.name ?? personId, title: person?.title ?? '' }, program, items, personId);
    const posted = await slack.client.chat.postMessage({ channel: demoUser!, text: `${items.length} question(s) about ${program} for ${person?.name ?? personId}`, blocks: blocks as never });
    await conn.reducers.markOutreachSent({ digestKey, slackChannel: posted.channel ?? '', slackTs: posted.ts ?? '' });
    console.log(`sent digest ${digestKey}: ${items.map((i) => i.id).join(', ')}`);
  }
}

// A button click answers one question; SpacetimeDB resumes any job that was waiting only on it.
slack.action(/^answer_\d+$/, async ({ ack, body, action, client }) => {
  await ack();
  const { q, o, p } = JSON.parse((action as { value: string }).value) as { q: string; o: string; p: string };
  await conn.reducers.answerQuestion({ questionId: q, answer: o, answeredBy: p });
  const message = (body as { message?: { ts: string; blocks: { type: string; block_id?: string }[] }; channel?: { id: string } });
  if (message.message && message.channel) {
    await client.chat.update({ channel: message.channel.id, ts: message.message.ts, text: `Answered ${q}`, blocks: markAnswered(message.message.blocks, q, o, personName(p)) as never });
  }
  console.log(`answer ${q}: ${o} (as ${personName(p)})`);
});

/** Runs one program up to the point it has to wait on people. */
async function runJob(program: string) {
  const jobId = `job:${program}`;
  const result = part2.results.find((r) => r.program === program);
  const upsert = (status: string, message: string, waitingOn: string[] = [], state: object = {}) =>
    conn.reducers.upsertJob({ id: jobId, program, status, waitingOnJson: JSON.stringify(waitingOn), stateJson: JSON.stringify(state), message });
  const note = (kind: string, message: string, data: object = {}) => conn.reducers.recordEvent({ jobId, kind, message, dataJson: JSON.stringify(data) });

  await upsert('reading', `Nemotron reads ${program}`);
  if (result) {
    await sleep(STEP_MS);
    await note('read', `${result.coverage.explained}/${result.coverage.connections} links explained, ${result.findings.filter((f) => f.kind === 'rule').length} rules, ${result.findings.filter((f) => f.kind === 'defect').length} suspected bugs, ${result.questions.length} questions`);
    for (const f of result.findings.filter((x) => x.kind === 'rule' || (x.kind === 'defect' && x.confidence === 'high')).slice(0, 4)) {
      await sleep(STEP_MS);
      await note(f.kind === 'rule' ? 'rule' : 'bug', f.summary, { evidence: f.evidence });
    }
  }

  await upsert('looking-up', `Checking Jira, Notion and Slack before asking anyone`);
  const questions = [...db.question.program.filter(program)].sort((a, b) => a.id.localeCompare(b.id));
  for (const q of questions) {
    await sleep(STEP_MS);
    const quotes = JSON.parse(q.quotesJson) as { title: string; url: string; text: string }[];
    const what = q.status === 'answered-by-docs' ? `answered by ${quotes[0]?.title ?? 'the docs'}`
      : q.status === 'known-issue' ? `known issue: ${quotes[0]?.title ?? 'open ticket'}`
      : q.status === 'answered' ? `already answered by ${personName(q.answeredBy)}`
      : q.routeTo ? `nobody wrote it down; ${personName(q.routeTo)} decides` : 'nobody wrote it down';
    await note('lookup', `${q.id}: ${what}`, { questionId: q.id, verdict: q.verdict, quotes });
  }

  const open = questions.filter((q) => (q.status === 'needs-person' || q.status === 'conflict' || q.status === 'asking') && q.routeTo);
  if (!open.length) { await upsert('done', `${program}: everything was settled by the documents`); return; }
  const byPerson = new Map<string, string[]>();
  for (const q of open) byPerson.set(q.routeTo, [...(byPerson.get(q.routeTo) ?? []), q.id]);
  await upsert('asking', `Asking ${[...byPerson].map(([p, ids]) => `${personName(p)} (${ids.length})`).join(', ')} on Slack`);
  for (const [personId, ids] of byPerson) {
    await conn.reducers.queueOutreach({ questionIdsJson: JSON.stringify(ids), recipientPersonId: personId, digestKey: `${personId}|${program}`, rendering: 'engineer', urgency: 'normal' });
  }
  await sleep(STEP_MS);
  await upsert('waiting', `Paused: waiting on ${[...byPerson.keys()].map(personName).join(', ')}`, open.map((q) => q.id));
}

/** A job SpacetimeDB marked resuming: finish it with the answers people gave. */
const finishing = new Set<string>();
async function finish(jobId: string, program: string) {
  if (finishing.has(jobId)) return;
  finishing.add(jobId);
  const note = (kind: string, message: string) => conn.reducers.recordEvent({ jobId, kind, message, dataJson: '{}' });
  const answered = [...db.question.program.filter(program)].filter((q) => q.status === 'answered');
  await note('resume', `Picking up ${program} with ${answered.length} answer(s)`);
  for (const q of answered) { await sleep(STEP_MS); await note('decision', `${q.id}: "${q.answerText}" (${personName(q.answeredBy)}) becomes a requirement and a test`); }
  await sleep(STEP_MS);
  await conn.reducers.upsertJob({ id: jobId, program, status: 'done', waitingOnJson: '[]', stateJson: '{}', message: `${program} is ready for the rewrite: every question is settled` });
  finishing.delete(jobId);
}

// Sends run one after another: two inserts arriving together must not post the same digest twice.
let sendChain = Promise.resolve();
const sendSoon = () => { sendChain = sendChain.then(() => sleep(300)).then(sendQueued).catch((e) => console.error('send failed:', e)); };
db.outreach.onInsert(() => sendSoon());
db.harnessJob.onUpdate((_ctx, _old, row) => { if (row.status === 'resuming') void finish(row.id, row.program).catch((e) => console.error('finish failed:', e)); });

await slack.start();
console.log(`slack connected; jobs for ${programs.join(', ')}`);
if (args.includes('--fresh')) await conn.reducers.resetRuns({});
for (const job of [...db.harnessJob.iter()].filter((j) => j.status === 'resuming')) void finish(job.id, job.program);
for (const p of programs) {
  const job = db.harnessJob.id.find(`job:${p}`);
  if (job && job.status !== 'done' && !args.includes('--fresh')) { console.log(`${p}: job already ${job.status}, not restarting`); continue; }
  await runJob(p);
}
sendSoon();
await sendChain;
console.log('waiting for answers (Ctrl+C to stop; jobs keep their state in SpacetimeDB)');
