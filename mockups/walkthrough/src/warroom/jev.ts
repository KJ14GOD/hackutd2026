// Jev decides, Nemotron writes. Jev gets labels, never numbers (see CLAUDE.md, Jev reference), and
// returns a typed choice with a distribution. The live call goes through jevClient (dev-server proxy to
// OpenRouter `typesafe/jev-1.13`); a deterministic stand-in with the same shape answers instantly, and
// stays the answer when the call fails, is offline, or comes back with a flat distribution.
import type { Item, Job } from './engine';
import { askJev, type JevQuestion } from './jevClient';

export interface JevDecision {
  id: string;
  at: number;
  question: string;
  type: 'choice' | 'noul';
  choice: string;
  probabilities: Record<string, number>;
  /** How concentrated the distribution is. Not the chance of being right. */
  confidence: number;
  latencyMs: number;
  /** The labels Jev was shown, for the Decisions drawer. */
  state: Record<string, Record<string, string>>;
  drives: string;
  model: 'Jev';
  /** Real answer, or the deterministic stand-in. */
  source: 'jev' | 'stand-in';
  /** The model id the API reported, e.g. typesafe/jev-1.13-20260917. */
  modelId?: string;
  /** Why the stand-in answered instead of the model. */
  fallback?: 'offline' | 'low-confidence' | 'pending';
  cached?: boolean;
}

/** Below this the choice distribution is too flat to act on; the stand-in's ordering is kept. */
const MIN_CHOICE_CONFIDENCE = 0.3;
/** With many options the API's confidence runs low even when one option clearly leads; a lead this wide still counts. */
const CLEAR_LEAD = 1.5;
const MIN_TOP_PROBABILITY = 0.18;
const ABOVE_EVEN = 1.6;
/** Candidates shown to Jev at once: the stand-in's top picks, so the question stays small. */
const MAX_CANDIDATES = 8;

const MONEY = /\b(interest|balance|amount|fee|fees|payment|credit|debit|refund|rate|overdraft|limit)\b/i;

/** The labels for one candidate program. This is the whole of what Jev sees about it. */
export function summarizeJob(job: Job, heroNow: string | null, harness = 'not in the harness'): Record<string, string> {
  const recent = job.items.slice(-6);
  const newest = job.items[job.items.length - 1];
  const kind = !newest ? 'nothing yet'
    : newest.kind === 'question' ? (newest.question.blocks === 'none' ? 'question' : `question that blocks ${newest.question.blocks}`)
    : newest.finding.kind === 'defect' ? `suspected bug, ${newest.finding.confidence} confidence`
    : newest.finding.kind === 'rule' ? 'business rule'
    : newest.finding.kind === 'connection' ? 'link explained'
    : newest.finding.kind;
  const money = recent.some((it) => MONEY.test(it.kind === 'finding' ? it.finding.summary : it.question.text));
  const bugs = job.items.filter((it) => it.kind === 'finding' && it.finding.kind === 'defect' && it.finding.confidence === 'high').length;
  const blocking = job.items.filter((it) => it.kind === 'question' && it.question.blocks !== 'none').length;
  return {
    activity: job.status === 'reading' ? 'writing now' : job.status === 'done' ? 'finished' : 'waiting',
    newest: kind,
    moneyPath: money ? 'touches money' : 'no money fields seen',
    highConfidenceBugs: bugs === 0 ? 'none' : bugs === 1 ? 'one' : 'several',
    blockingQuestions: blocking === 0 ? 'none' : blocking === 1 ? 'one' : 'several',
    onStage: job.program === heroNow ? 'already on stage' : 'off stage',
    harness,
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function score(l: Record<string, string>): number {
  let s = 0.6;
  if (l.newest.startsWith('question that blocks')) s += 3;
  else if (l.newest === 'question') s += 1.2;
  else if (l.newest.startsWith('suspected bug, high')) s += 2.6;
  else if (l.newest.startsWith('suspected bug')) s += 1.4;
  else if (l.newest === 'business rule') s += 0.7;
  if (l.moneyPath === 'touches money') s += 1.3;
  if (l.highConfidenceBugs === 'several') s += 0.8;
  if (l.blockingQuestions !== 'none') s += 0.6;
  if (l.activity === 'writing now') s += 0.4;
  if (l.onStage === 'already on stage') s += 0.9;
  if (l.harness === 'answer just landed') s += 3.2;
  else if (l.harness === 'just paused for a person') s += 2.4;
  else if (l.harness === 'waiting on a person') s += 0.5;
  return s;
}

function softmax(scores: Record<string, number>): Record<string, number> {
  const max = Math.max(...Object.values(scores));
  const exp = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.exp(v - max)]));
  const sum = Object.values(exp).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(exp).map(([k, v]) => [k, Math.round((v / sum) * 1000) / 1000]));
}

let seq = 0;
const nextId = () => `jev-${++seq}`;

export type HarnessLabel = (program: string) => string;

/** "Which program takes the stage?" Choice over the programs being read right now. Instant stand-in. */
export function decideHero(candidates: Job[], heroNow: string | null, now: number, harness: HarnessLabel = () => 'not in the harness'): JevDecision | null {
  if (candidates.length === 0) return null;
  const state: Record<string, Record<string, string>> = {};
  const scores: Record<string, number> = {};
  for (const job of candidates) {
    const labels = summarizeJob(job, heroNow, harness(job.program));
    state[job.program] = labels;
    scores[job.program] = score(labels);
  }
  const probabilities = softmax(scores);
  const [choice, p] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  const h = hash(JSON.stringify(state) + seq);
  return {
    id: nextId(),
    at: now,
    question: 'Which program takes the stage?',
    type: 'choice',
    choice,
    probabilities,
    confidence: p,
    latencyMs: 90 + (h % 150),
    state,
    drives: 'hero pane',
    model: 'Jev',
    source: 'stand-in',
    fallback: 'pending',
  };
}

/** One line per candidate, so Jev reads a situation, not a table. */
function describe(l: Record<string, string>): string {
  return `${l.activity}; newest: ${l.newest}; ${l.moneyPath}; high-confidence bugs: ${l.highConfidenceBugs}; blocking questions: ${l.blockingQuestions}; harness: ${l.harness}; ${l.onStage}`;
}

/** The same question, asked of the real model. Resolves to the stand-in (marked) when it cannot answer. */
export async function decideHeroLive(standIn: JevDecision): Promise<JevDecision> {
  const programs = Object.entries(standIn.probabilities).sort((a, b) => b[1] - a[1]).slice(0, MAX_CANDIDATES).map(([p]) => p);
  if (programs.length < 2) return { ...standIn, fallback: undefined, source: 'stand-in' };
  const criteria = Object.fromEntries(programs.map((p) => [p, describe(standIn.state[p])]));
  const questions: Record<string, JevQuestion> = {
    stage: {
      type: 'choice',
      question: 'Which program should be on the big screen right now for the people watching this migration? Prefer the one where a person must decide something, where money is involved, or where a suspected bug just surfaced; avoid switching away from the program already on stage without a reason.',
      criteria,
    },
  };
  const shown = Object.fromEntries(programs.map((p) => [p, standIn.state[p]]));
  const r = await askJev({ programs: shown }, questions);
  const a = r?.answers.stage;
  if (!r || !a || a.type !== 'choice') return { ...standIn, source: 'stand-in', fallback: 'offline' };
  const ranked = Object.values(a.probabilities).sort((x, y) => y - x);
  // A lead counts when the top option is well above an even split, or clearly ahead of the runner-up.
  const aboveEven = ranked[0] >= Math.max(MIN_TOP_PROBABILITY, ABOVE_EVEN / Math.max(1, ranked.length));
  const clearLead = aboveEven || ranked[0] >= (ranked[1] ?? 0) * CLEAR_LEAD;
  if (!(a.choice in standIn.state) || (a.confidence < MIN_CHOICE_CONFIDENCE && !clearLead)) {
    // Keep the stand-in's pick but record what the model actually returned.
    return { ...standIn, source: 'stand-in', fallback: 'low-confidence', probabilities: a.probabilities, modelId: r.model, latencyMs: r.latencyMs, cached: r.cached };
  }
  return {
    ...standIn,
    choice: a.choice,
    probabilities: a.probabilities,
    confidence: a.confidence,
    latencyMs: r.latencyMs,
    modelId: r.model,
    source: 'jev',
    fallback: undefined,
    cached: r.cached,
  };
}

function humanLabels(item: Item): Record<string, string> {
  const text = item.kind === 'finding' ? item.finding.summary : item.question.text;
  return item.kind === 'question'
    ? { kind: 'open question from the reader', blocks: item.question.blocks === 'none' ? 'nothing' : `the ${item.question.blocks}`, moneyPath: MONEY.test(text) ? 'touches money' : 'no money fields', answerInCode: 'the code does not settle it', question: text }
    : { kind: `suspected ${item.finding.kind}`, confidence: item.finding.confidence, moneyPath: MONEY.test(text) ? 'touches money' : 'no money fields', answerInCode: item.finding.kind === 'defect' ? 'contradicts an invariant the code states' : 'yes', finding: text };
}

/** "Does this need a human?" Noul on one closed item. Instant stand-in. */
export function decideNeedsHuman(item: Item, now: number): JevDecision {
  const labels = humanLabels(item);
  const text = labels.question ?? labels.finding;
  // Most of what the reader asks can be settled by the knowledge base, the docs or the code; only a
  // blocking question about money, or one that blocks cutover, is likely to need a person.
  let yes = 0.06;
  if (item.kind === 'question') {
    yes = item.question.blocks === 'none' ? 0.22 : item.question.blocks === 'cutover' ? 0.62 : 0.38;
    if (labels.moneyPath === 'touches money') yes += item.question.blocks === 'none' ? 0.12 : 0.3;
  } else if (item.finding.kind === 'defect') {
    yes = item.finding.confidence === 'high' ? 0.14 : 0.26;
    if (labels.moneyPath === 'touches money') yes += 0.1;
  }
  yes = Math.min(0.97, yes);
  const h = hash(text);
  yes = Math.round((yes + ((h % 7) - 3) / 100) * 100) / 100;
  return {
    id: nextId(),
    at: now,
    question: 'Does this need a human?',
    type: 'noul',
    choice: yes >= 0.5 ? 'yes' : 'no',
    probabilities: { yes, no: Math.round((1 - yes) * 100) / 100 },
    confidence: Math.abs(yes - 0.5) * 2,
    latencyMs: 70 + (h % 120),
    state: { item: labels },
    drives: yes >= 0.5 ? 'Slack question' : 'auto-resolve',
    model: 'Jev',
    source: 'stand-in',
    fallback: 'pending',
  };
}

export async function decideNeedsHumanLive(standIn: JevDecision): Promise<JevDecision> {
  const questions: Record<string, JevQuestion> = {
    needsHuman: {
      type: 'noul',
      question: 'Does this need a human decision before the rewrite proceeds?',
      instructions: 'Yes means a person who owns this behavior must answer before the rewrite can safely continue: nothing in the code, docs or knowledge base settles it, and getting it wrong would change money, records or what a customer sees. No means the agent can settle it alone: it is a defect against a stated invariant, a style or logging question, or the answer is already in the code.',
    },
  };
  const r = await askJev(standIn.state.item, questions);
  const a = r?.answers.needsHuman;
  if (!r || !a || a.type !== 'noul') return { ...standIn, source: 'stand-in', fallback: 'offline' };
  const yes = Math.round(a.noul * 100) / 100;
  return {
    ...standIn,
    choice: yes >= 0.5 ? 'yes' : 'no',
    probabilities: { yes, no: Math.round((1 - yes) * 100) / 100 },
    confidence: Math.abs(yes - 0.5) * 2,
    latencyMs: r.latencyMs,
    drives: yes >= 0.5 ? 'Slack question' : 'auto-resolve',
    modelId: r.model,
    source: 'jev',
    fallback: undefined,
    cached: r.cached,
  };
}
