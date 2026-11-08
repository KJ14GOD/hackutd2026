// SpacetimeDB module: the shared state the pipeline writes and the UI subscribes to.
// Tables follow docs/REQUIREMENTS_IMPLEMENTATION.md §3.2-3.3 (people, ownership, approvers, outreach), plus
// questions with their Phase 4 resolution and the harness job and event feed that make "waiting on Maria ->
// Maria answered" live. Services only call reducers; the rules for who moves a job forward live here.
//
// Reducer names come from the export names. SpacetimeDB converts them to snake_case
// for the CLI and SQL (setConfig becomes set_config).
import { schema, table, t, SenderError } from 'spacetimedb/server';

const spacetimedb = schema({
  /** theseus.config.json as last pushed with `pnpm config:push`. Single row, id 0. */
  config: table(
    { public: true },
    {
      id: t.u32().primaryKey(),
      json: t.string(),
      version: t.u32(),
    },
  ),

  // People and ownership (Phase 3, services/people). Rebuilt as a whole by loadOrg.
  person: table({ public: true }, {
    id: t.string().primaryKey(),
    name: t.string(),
    title: t.string(),
    team: t.string().index('btree'),
    active: t.bool(),
    emailsJson: t.string(),
    source: t.string(),
  }),
  team: table({ public: true }, { id: t.string().primaryKey(), name: t.string(), parentTeamId: t.string() }),
  reportsTo: table({ public: true }, {
    id: t.u64().primaryKey().autoInc(),
    personId: t.string().index('btree'),
    managerId: t.string().index('btree'),
    source: t.string(),
  }),
  ownership: table({ public: true }, {
    id: t.u64().primaryKey().autoInc(),
    personId: t.string().index('btree'),
    target: t.string().index('btree'),
    kind: t.string(),
    signal: t.string(),
    weight: t.f64(),
    source: t.string(),
    evidence: t.string(),
    observedAt: t.string(),
  }),
  /** A possible same-person pair sharing no email: pending until someone merges or rejects it. */
  identityMatch: table({ public: true }, { id: t.string().primaryKey(), aRef: t.string(), bRef: t.string(), evidence: t.string(), status: t.string() }),
  approver: table({ public: true }, {
    id: t.string().primaryKey(),
    personId: t.string().index('btree'),
    scope: t.string().index('btree'),
    category: t.string(),
    score: t.f64(),
    evidenceJson: t.string(),
    signedOffBy: t.string(),
  }),

  /**
   * A question from Part 2 (Nemotron's read) with what Phase 4 found. status: answered-by-docs | known-issue |
   * conflict | needs-person | asking | answered.
   */
  question: table({ public: true }, {
    id: t.string().primaryKey(),
    program: t.string().index('btree'),
    text: t.string(),
    evidenceJson: t.string(),
    optionsJson: t.string(),
    blocks: t.string(),
    status: t.string().index('btree'),
    verdict: t.string(),
    answer: t.string(),
    quotesJson: t.string(),
    confidence: t.string(),
    routeTo: t.string().index('btree'),
    routeName: t.string(),
    routeWhy: t.string(),
    answeredBy: t.string(),
    answerText: t.string(),
    answeredAtMs: t.u64(),
  }),

  /** One question sent to one person; questions to the same person and program share a digestKey (one message). */
  outreach: table({ public: true }, {
    id: t.u64().primaryKey().autoInc(),
    questionId: t.string().index('btree'),
    digestKey: t.string().index('btree'),
    recipientPersonId: t.string().index('btree'),
    channel: t.string(),
    rendering: t.string(),
    urgency: t.string(),
    step: t.string(),
    status: t.string().index('btree'),
    slackTs: t.string(),
    slackChannel: t.string(),
    nextActionAtMs: t.u64(),
    sentAtMs: t.u64(),
  }),

  /** One harness run over a program. status: reading | looking-up | asking | waiting | resuming | done | failed. */
  harnessJob: table({ public: true }, {
    id: t.string().primaryKey(),
    program: t.string().index('btree'),
    status: t.string().index('btree'),
    /** Question ids the job is paused on. */
    waitingOnJson: t.string(),
    /** Whatever the worker needs to pick up where it stopped. */
    stateJson: t.string(),
    startedAtMs: t.u64(),
    updatedAtMs: t.u64(),
  }),
  /** The live step feed: what the harness did, who it's waiting on, and who answered. */
  harnessEvent: table({ public: true }, {
    id: t.u64().primaryKey().autoInc(),
    jobId: t.string().index('btree'),
    atMs: t.u64(),
    kind: t.string(),
    message: t.string(),
    dataJson: t.string(),
  }),
});

export default spacetimedb;

const now = (ctx: { timestamp: { toMillis(): bigint } }) => ctx.timestamp.toMillis();

function parse<T>(json: string, what: string): T {
  try { return JSON.parse(json) as T; } catch { throw new SenderError(`${what}: invalid JSON`); }
}

export const init = spacetimedb.init((ctx) => {
  ctx.db.config.insert({ id: 0, json: '', version: 0 });
});

/** Stores the config file contents. Validation happens client-side (packages/shared). */
export const setConfig = spacetimedb.reducer({ json: t.string() }, (ctx, { json }) => {
  parse(json, 'setConfig');
  const row = ctx.db.config.id.find(0);
  const version = (row?.version ?? 0) + 1;
  if (row) ctx.db.config.id.update({ id: 0, json, version });
  else ctx.db.config.insert({ id: 0, json, version });
});

interface OrgJson {
  people: { id: string; name: string; title?: string; team?: string; active: boolean; emails: string[]; source: string }[];
  teams: { id: string; name: string; parentTeamId?: string }[];
  reportsTo: { personId: string; managerId: string; source: string }[];
  owns: { personId: string; target: string; kind: string; signal: string; weight: number; source: string; evidence: string; observedAt: string }[];
  identityMatches: { a: string; b: string; reason: string }[];
  approvers: { personId: string; target: string; category: string; score: number; evidence: string[] }[];
}

/** Replaces the people, ownership and approver tables with a fresh Phase 3 build (out/people/org.json). */
export const loadOrg = spacetimedb.reducer({ json: t.string() }, (ctx, { json }) => {
  const org = parse<OrgJson>(json, 'loadOrg');
  for (const tbl of [ctx.db.person, ctx.db.team, ctx.db.reportsTo, ctx.db.ownership, ctx.db.identityMatch, ctx.db.approver]) tbl.clear();
  for (const p of org.people) ctx.db.person.insert({ id: p.id, name: p.name, title: p.title ?? '', team: p.team ?? '', active: p.active, emailsJson: JSON.stringify(p.emails), source: p.source });
  for (const x of org.teams) ctx.db.team.insert({ id: x.id, name: x.name, parentTeamId: x.parentTeamId ?? '' });
  for (const r of org.reportsTo) ctx.db.reportsTo.insert({ id: 0n, personId: r.personId, managerId: r.managerId, source: r.source });
  for (const o of org.owns) ctx.db.ownership.insert({ id: 0n, personId: o.personId, target: o.target, kind: o.kind, signal: o.signal, weight: o.weight, source: o.source, evidence: o.evidence, observedAt: o.observedAt });
  for (const m of org.identityMatches) ctx.db.identityMatch.insert({ id: `${m.a}|${m.b}`, aRef: m.a, bRef: m.b, evidence: m.reason, status: 'pending' });
  for (const a of org.approvers) ctx.db.approver.insert({ id: `${a.personId}|${a.target}|${a.category}`, personId: a.personId, scope: a.target, category: a.category, score: a.score, evidenceJson: JSON.stringify(a.evidence), signedOffBy: '' });
});

interface QuestionJson {
  id: string; program: string; text: string; evidence: string[]; options: string[]; blocks: string;
  verdict: string; answer: string; quotes: unknown[]; confidence: string;
  route?: { to: string; name: string; why: string };
}

const statusFor = (q: QuestionJson) =>
  q.verdict === 'answered' && !q.route ? 'answered-by-docs' : q.verdict === 'known-issue' ? 'known-issue' : q.verdict === 'conflict' ? 'conflict' : 'needs-person';

/**
 * Adds or refreshes questions with their Phase 4 resolution. Questions a person already answered, or that are
 * out being asked, keep that state: a rerun of the pipeline never erases a human answer.
 */
export const loadQuestions = spacetimedb.reducer({ json: t.string() }, (ctx, { json }) => {
  for (const q of parse<QuestionJson[]>(json, 'loadQuestions')) {
    const old = ctx.db.question.id.find(q.id);
    const row = {
      id: q.id, program: q.program, text: q.text, evidenceJson: JSON.stringify(q.evidence), optionsJson: JSON.stringify(q.options), blocks: q.blocks,
      status: old && (old.status === 'answered' || old.status === 'asking') ? old.status : statusFor(q),
      verdict: q.verdict, answer: q.answer, quotesJson: JSON.stringify(q.quotes), confidence: q.confidence,
      routeTo: q.route?.to ?? '', routeName: q.route?.name ?? '', routeWhy: q.route?.why ?? '',
      answeredBy: old?.answeredBy ?? '', answerText: old?.answerText ?? '', answeredAtMs: old?.answeredAtMs ?? 0n,
    };
    if (old) ctx.db.question.id.update(row);
    else ctx.db.question.insert(row);
  }
});

/** Queues questions for one person as one digest; the outreach worker sends it and calls markOutreachSent. */
export const queueOutreach = spacetimedb.reducer(
  { questionIdsJson: t.string(), recipientPersonId: t.string(), digestKey: t.string(), rendering: t.string(), urgency: t.string() },
  (ctx, { questionIdsJson, recipientPersonId, digestKey, rendering, urgency }) => {
    for (const id of parse<string[]>(questionIdsJson, 'queueOutreach')) {
      const q = ctx.db.question.id.find(id);
      if (!q) throw new SenderError(`queueOutreach: no question ${id}`);
      if (q.status === 'answered') continue;
      if ([...ctx.db.outreach.questionId.filter(id)].some((o) => o.status === 'queued' || o.status === 'sent')) continue;
      ctx.db.outreach.insert({ id: 0n, questionId: id, digestKey, recipientPersonId, channel: 'slack-dm', rendering, urgency, step: 'ask', status: 'queued', slackTs: '', slackChannel: '', nextActionAtMs: 0n, sentAtMs: 0n });
      ctx.db.question.id.update({ ...q, status: 'asking' });
    }
  },
);

/** Records that a digest went out, so buttons can update the same Slack message later. */
export const markOutreachSent = spacetimedb.reducer({ digestKey: t.string(), slackChannel: t.string(), slackTs: t.string() }, (ctx, { digestKey, slackChannel, slackTs }) => {
  for (const o of [...ctx.db.outreach.digestKey.filter(digestKey)]) {
    if (o.status === 'queued') ctx.db.outreach.id.update({ ...o, status: 'sent', slackChannel, slackTs, sentAtMs: now(ctx) });
  }
});

function event(ctx: Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0], jobId: string, kind: string, message: string, data: unknown = {}) {
  ctx.db.harnessEvent.insert({ id: 0n, jobId, atMs: now(ctx), kind, message, dataJson: JSON.stringify(data) });
}

/**
 * A person answered (Slack button or the UI). Marks the question and its outreach answered, logs it on every job
 * waiting for it, and resumes a job once nothing it waits on is still open.
 */
export const answerQuestion = spacetimedb.reducer({ questionId: t.string(), answer: t.string(), answeredBy: t.string() }, (ctx, { questionId, answer, answeredBy }) => {
  const q = ctx.db.question.id.find(questionId);
  if (!q) throw new SenderError(`answerQuestion: no question ${questionId}`);
  if (!answer.trim()) throw new SenderError('answerQuestion: empty answer');
  ctx.db.question.id.update({ ...q, status: 'answered', answerText: answer, answeredBy, answeredAtMs: now(ctx) });
  for (const o of [...ctx.db.outreach.questionId.filter(questionId)]) if (o.status !== 'answered') ctx.db.outreach.id.update({ ...o, status: 'answered' });
  const who = ctx.db.person.id.find(answeredBy)?.name ?? answeredBy;
  for (const job of [...ctx.db.harnessJob.iter()]) {
    const waiting = parse<string[]>(job.waitingOnJson || '[]', 'harnessJob.waitingOn');
    if (!waiting.includes(questionId)) continue;
    const left = waiting.filter((id) => id !== questionId && ctx.db.question.id.find(id)?.status !== 'answered');
    event(ctx, job.id, 'answered', `${who} answered ${questionId}: ${answer}`, { questionId, answer, answeredBy });
    const status = left.length ? job.status : 'resuming';
    ctx.db.harnessJob.id.update({ ...job, waitingOnJson: JSON.stringify(left), status, updatedAtMs: now(ctx) });
    if (!left.length) event(ctx, job.id, 'resumed', `All answers in for ${job.program}; resuming`, {});
  }
});

/** Creates or moves a harness job. Workers own the step logic; this keeps the record and the live feed. */
export const upsertJob = spacetimedb.reducer(
  { id: t.string(), program: t.string(), status: t.string(), waitingOnJson: t.string(), stateJson: t.string(), message: t.string() },
  (ctx, { id, program, status, waitingOnJson, stateJson, message }) => {
    parse(waitingOnJson || '[]', 'upsertJob.waitingOn');
    const old = ctx.db.harnessJob.id.find(id);
    const row = { id, program, status, waitingOnJson: waitingOnJson || '[]', stateJson, startedAtMs: old?.startedAtMs ?? now(ctx), updatedAtMs: now(ctx) };
    if (old) ctx.db.harnessJob.id.update(row);
    else ctx.db.harnessJob.insert(row);
    if (message) event(ctx, id, status, message, {});
  },
);

/** Appends one step to a job's live feed (a lookup hit, a token of reasoning, a sent question). */
export const recordEvent = spacetimedb.reducer({ jobId: t.string(), kind: t.string(), message: t.string(), dataJson: t.string() }, (ctx, { jobId, kind, message, dataJson }) => {
  parse(dataJson || '{}', 'recordEvent.data');
  event(ctx, jobId, kind, message, JSON.parse(dataJson || '{}'));
});

/** Clears jobs, events and outreach so a demo can start over; questions and people stay. */
export const resetRuns = spacetimedb.reducer({}, (ctx) => {
  ctx.db.harnessEvent.clear();
  ctx.db.harnessJob.clear();
  ctx.db.outreach.clear();
  for (const q of [...ctx.db.question.iter()]) if (q.status === 'asking' || q.status === 'answered') ctx.db.question.id.update({ ...q, status: 'needs-person', answeredBy: '', answerText: '', answeredAtMs: 0n });
});
