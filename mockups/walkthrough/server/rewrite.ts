// Rewrite + shadow for the browser (services/rewrite).
//   GET /api/rewrite?source=&program=        -> latest result, the run history and the gate threshold; 404 {error:'not_rewritten'}
//   GET /api/rewrite/list?source=            -> every program's latest status and match rate (for overview screens)
//   GET /api/rewrite/stream?source=&program=&mode=live|watch|replay[&pace=ms]   (watch joins a run in progress and never starts one)
//        live: Nemotron writes the Java (cached answers replay at reading speed), javac and the scenarios run for real in
//        Docker, and every event is recorded with the result. replay: plays the last recorded run's events back, paced.
// Events (SSE data JSON): RewriteEvent from services/rewrite/src/types.ts.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { createProvider } from '../../../packages/llm/src/index';
import { loadConfig } from '../../../packages/shared/src/config';
import type { Part2 } from '../../../services/reader/src/contract';
import { rewrite } from '../../../services/rewrite/src/rewrite';
import type { RewriteEvent, RewriteResult } from '../../../services/rewrite/src/types';
import type { Pass1 } from '../../../services/segmenter/src/types';
import type { RewriteRecord } from './rewriteTypes';
import { baselineScenarios, finalize } from '../../../services/rewrite/src/rewrite';
import { route } from '../../../services/context/src/route';
import type { Org } from '../../../services/people/src/types';
import { createHash } from 'node:crypto';
import { harnessConnection, onQuestionAnswered } from './harness';

const REPO_ROOT = resolve(__dirname, '../../..');
const STORE = resolve(__dirname, '../.cache/rewrite');
const RUNTIME = resolve(__dirname, '../.cache/runtime/work');
const READS = resolve(__dirname, '../.cache/read');
const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');

export interface RewriteDeps { sourceDir: (source: string) => string | undefined; pass1For: (source: string, dir: string) => Pass1 }

const dirFor = (source: string, program: string) => resolve(STORE, safe(source), program);
function records(source: string, program: string): string[] {
  const d = dirFor(source, program);
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).sort() : [];
}
const load = (source: string, program: string, file: string) => JSON.parse(readFileSync(resolve(dirFor(source, program), file), 'utf8')) as RewriteRecord;

function latestPart2(source: string): Part2 | undefined {
  const d = resolve(READS, safe(source));
  const runs = existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).sort() : [];
  return runs.length ? (JSON.parse(readFileSync(resolve(d, runs[runs.length - 1]), 'utf8')) as { part2: Part2 }).part2 : undefined;
}

const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };

interface Live { events: RewriteEvent[]; clients: Set<ServerResponse> }
const live = new Map<string, Live>();

function sse(res: ServerResponse) { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); }
const write = (to: ServerResponse, e: RewriteEvent) => to.write(`data: ${JSON.stringify(e)}\n\n`);

/** Runs (or joins) a live rewrite. `res` is null when an answer triggers a rerun with nobody watching yet. */
function runLive(res: ServerResponse | null, source: string, dir: string, program: string, deps: RewriteDeps, decisions: Decision[] = decisionsFor(source, program)) {
  const key = `${source}|${program}`;
  const going = live.get(key);
  if (going) { if (res) { for (const e of going.events) write(res, e); going.clients.add(res); res.on('close', () => going.clients.delete(res)); } return; }
  const run: Live = { events: [], clients: new Set(res ? [res] : []) };
  live.set(key, run);
  res?.on('close', () => run.clients.delete(res));
  const timeline: { atMs: number; event: RewriteEvent }[] = [];
  const started = Date.now();
  const send = (e: RewriteEvent) => { run.events.push(e); timeline.push({ atMs: Date.now() - started, event: e }); for (const c of run.clients) write(c, e); };
  void (async () => {
    try {
      const config = loadConfig();
      const part2 = latestPart2(source);
      if (!part2) throw new Error('Step 4 has not read this codebase yet, so there are no rules or questions to rewrite against');
      const runtimeDir = resolve(RUNTIME, safe(source));
      if (!existsSync(resolve(runtimeDir, 'out', program))) throw new Error(`Step 3 has not run ${program} in the sandbox, so there is nothing to shadow against`);
      const provider = createProvider({ cacheDir: resolve(REPO_ROOT, config.llm.cacheDir), requestsPerMinute: config.llm.requestsPerMinute, replayChunkDelayMs: 8, env: { ...process.env, LLM_PROVIDER: 'nvidia' } });
      const result: RewriteResult = await rewrite({
        program, root: dir, pass1: deps.pass1For(source, dir), part2, runtimeDir, workDir: resolve(STORE, 'work', safe(source), program), provider,
        maxCompileFixes: config.rewrite.maxCompileFixes, maxDiffFixes: config.rewrite.maxDiffFixes, maxOutputTokens: config.rewrite.maxOutputTokens, emit: send, decisions,
      });
      mkdirSync(dirFor(source, program), { recursive: true });
      const record: RewriteRecord = { result, timeline };
      writeFileSync(resolve(dirFor(source, program), `${result.startedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(record));
      await raiseQuestions(source, result).catch((err) => console.error('rewrite: could not raise questions:', err));
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      live.delete(key);
      for (const c of run.clients) c.end();
    }
  })();
}

/** Plays a recorded run back: tokens at `pace` ms each, other events a beat apart (capped so long runs stay watchable). */
function replay(res: ServerResponse, source: string, program: string, pace: number) {
  const files = records(source, program);
  if (!files.length) { write(res, { type: 'error', message: `${program} has not been rewritten yet; use mode=live` }); res.end(); return; }
  const { timeline } = load(source, program, files[files.length - 1]);
  let closed = false;
  res.on('close', () => { closed = true; });
  void (async () => {
    for (const { event } of timeline) {
      if (closed) return;
      write(res, event);
      await new Promise((r) => setTimeout(r, event.type === 'token' ? pace : event.type === 'diff' || event.type === 'run' ? 150 : 400));
    }
    res.end();
  })();
}

/** Returns true when it handled the request. */
export function rewriteRoutes(url: URL, res: ServerResponse, deps: RewriteDeps): boolean {
  rerunDeps ??= { deps };
  // The answer listener needs the SpacetimeDB connection open even before anyone watches the harness feed.
  void harnessConnection().catch(() => {});
  if (!url.pathname.startsWith('/api/rewrite')) return false;
  const source = url.searchParams.get('source') || 'carddemo';
  const dir = deps.sourceDir(source);
  if (!dir) { json(res, 404, { error: 'unknown_source' }); return true; }
  const threshold = loadConfig().rewrite.gateThreshold;
  if (url.pathname === '/api/rewrite/list') {
    const root = resolve(STORE, safe(source));
    const programs = existsSync(root) ? readdirSync(root).filter((p) => p !== 'work' && p !== 'questions.json') : [];
    const runningOnly = [...live.keys()].filter((k) => k.startsWith(`${source}|`)).map((k) => k.split('|')[1]).filter((p) => !records(source, p).length);
    json(res, 200, { threshold, programs: [...runningOnly.map((p) => ({ program: p, status: 'running', matchRate: 0, at: new Date().toISOString(), running: true })), ...programs.flatMap((p) => {
      const f = records(source, p);
      if (!f.length) return [];
      const r = load(source, p, f[f.length - 1]).result;
      return [{ program: p, status: r.status, matchRate: r.matchRate, at: r.startedAt, running: live.has(`${source}|${p}`) }];
    })] });
    return true;
  }
  const program = (url.searchParams.get('program') ?? '').toUpperCase();
  if (!/^[A-Z0-9#@$-]{1,8}$/.test(program)) { json(res, 400, { error: 'program is required' }); return true; }
  if (url.pathname === '/api/rewrite') {
    const files = records(source, program);
    if (!files.length) { json(res, 404, { error: 'not_rewritten' }); return true; }
    const history = files.map((f) => { const r = load(source, program, f).result; return { at: r.startedAt, matchRate: r.matchRate, status: r.status, passes: r.passes.length }; });
    // Results saved before root-cause grouping existed get grouped on the way out.
    // Stored results are regrouped and reclassified on the way out (no rerun): root causes, owner decisions, and
    // mismatches the legacy run itself causes ('baseline').
    const latest = load(source, program, files[files.length - 1]).result;
    json(res, 200, { ...finalize({ ...latest, decisions: latest.decisions ?? [] }, decisionsFor(source, program), baselineScenarios(resolve(RUNTIME, safe(source)), program)), threshold, history });
    return true;
  }
  if (url.pathname === '/api/rewrite/stream') {
    sse(res);
    const mode = url.searchParams.get('mode');
    if (mode === 'live') runLive(res, source, dir, program, deps);
    else if (mode === 'watch') {
      const going = live.get(`${source}|${program}`);
      if (!going) { write(res, { type: 'error', message: `no rewrite of ${program} is running` }); res.end(); }
      else { for (const e of going.events) write(res, e); going.clients.add(res); res.on('close', () => going.clients.delete(res)); }
    }
    else replay(res, source, program, Math.min(200, Math.max(0, Number(url.searchParams.get('pace') ?? 8) || 0)));
    return true;
  }
  json(res, 404, { error: 'unknown route' });
  return true;
}

// ---- The decision loop: a root cause nobody can settle by code becomes a question; its answer changes the result. ----

type Decision = { cause: string; decision: string; accept: boolean };
interface Asked { questionId: string; source: string; program: string; cause: string; answer?: string; accept?: boolean }
const ASKED = resolve(STORE, 'questions.json');
const asked = (): Asked[] => (existsSync(ASKED) ? JSON.parse(readFileSync(ASKED, 'utf8')) as Asked[] : []);
const saveAsked = (list: Asked[]) => { mkdirSync(STORE, { recursive: true }); writeFileSync(ASKED, JSON.stringify(list, null, 2)); };
const decisionsFor = (source: string, program: string): Decision[] =>
  asked().filter((a) => a.source === source && a.program === program && a.answer).map((a) => ({ cause: a.cause, decision: a.answer!, accept: !!a.accept }));

export const MISMATCH_OPTIONS = ['Keep the COBOL behavior', 'Keep the new behavior', 'Neither: it needs a different fix', "Doesn't matter"];
let rerunDeps: { deps: RewriteDeps } | null = null;

/** One question per unsettled logic cause, routed like Phase 4 questions, sent as a Slack digest by the worker. */
async function raiseQuestions(source: string, result: RewriteResult) {
  const open = result.groups.filter((g) => g.category === 'logic' && !g.decision);
  if (!open.length) return;
  const orgFile = resolve(REPO_ROOT, 'out/people/org.json');
  if (!existsSync(orgFile)) return;
  const org = JSON.parse(readFileSync(orgFile, 'utf8')) as Org;
  const conn = await harnessConnection();
  const list = asked();
  const rows = [];
  for (const g of open) {
    const questionId = `${result.program}-S${createHash('sha256').update(g.cause).digest('hex').slice(0, 4).toUpperCase()}`;
    if (list.some((a) => a.questionId === questionId)) continue;
    const text = `Shadow run: in ${g.scenarios.join(', ')}, ${g.cause}. ${g.lines} line(s) differ from there. Which behavior should the rewrite keep?`;
    const to = route(org, result.program, text, { verdict: 'not-found', answer: '', quotes: [], confidence: 'high', model: 'code' });
    if (!to) continue;
    rows.push({ id: questionId, program: result.program, text, evidence: [], options: MISMATCH_OPTIONS, blocks: 'cutover', verdict: 'mismatch', answer: '', quotes: [], confidence: 'high', route: { to: to.to, name: to.name, why: `owns ${result.program}; the old and new code disagree here` } });
    list.push({ questionId, source, program: result.program, cause: g.cause });
  }
  if (!rows.length) return;
  saveAsked(list);
  await conn.reducers.loadQuestions({ json: JSON.stringify(rows) });
  for (const r of rows) await conn.reducers.queueOutreach({ questionIdsJson: JSON.stringify([r.id]), recipientPersonId: r.route.to, digestKey: `${r.route.to}|${result.program}|shadow`, rendering: 'engineer', urgency: 'high' });
  const people = [...new Set(rows.map((r) => r.route.name))].join(', ');
  await conn.reducers.upsertJob({ id: `job:${result.program}`, program: result.program, status: 'waiting', waitingOnJson: JSON.stringify(rows.map((r) => r.id)), stateJson: '{}',
    message: `Shadow run: ${rows.length} root cause(s), ${open.reduce((n, g) => n + g.lines, 0)} lines, need a decision; asking ${people}` });
}

/** An answer to a shadow question: rerun with the decision, or accept the difference and recount. */
function answered(q: { id: string; program: string; answerText: string }) {
  const list = asked();
  const a = list.find((x) => x.questionId === q.id);
  if (!a || !rerunDeps) return;
  a.answer = q.answerText;
  a.accept = /^Keep the new|^Doesn't matter/i.test(q.answerText);
  saveAsked(list);
  const files = records(a.source, a.program);
  if (!files.length) return;
  if (/^Keep the COBOL/i.test(q.answerText)) {
    // The rewrite has to change: run it again with the decision in Nemotron's prompt.
    const dir = rerunDeps.deps.sourceDir(a.source);
    if (dir) runLive(null, a.source, dir, a.program, rerunDeps.deps);
    return;
  }
  // Accepted (or "neither", which records the decision only): no new Java, the same run recounted with the answer.
  const prev = load(a.source, a.program, files[files.length - 1]);
  const result = finalize({ ...prev.result, startedAt: new Date().toISOString(), ms: 0, decisions: decisionsFor(a.source, a.program).map((d) => `${d.cause}: ${d.decision}`) }, decisionsFor(a.source, a.program));
  const event: RewriteEvent = { type: 'stage', stage: 'done', message: `${a.program}: decision recorded (${q.answerText}); ${Math.round(result.matchRate * 100)}% of lines now settled` };
  writeFileSync(resolve(dirFor(a.source, a.program), `${result.startedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify({ result, timeline: [{ atMs: 0, event }, { atMs: 1, event: { type: 'done', result } }] } satisfies RewriteRecord));
}
onQuestionAnswered(answered);
