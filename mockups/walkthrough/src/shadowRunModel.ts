// Pure model for the Shadow run chapter: no React, no I/O. Everything here is real data from the dev
// server (the map, sandbox runs, Part 2 reads, harness questions, and the rewrite's shadow diff).
// There is no simulation: a program without a rewrite result simply has none yet.
import type { HarnessQuestion } from '../server/harnessTypes';

export type CutoverStage = 0 | 1 | 10 | 100;
export const CUTOVER_STAGES: CutoverStage[] = [1, 10, 100];
/** Used only until a result carries the value from theseus.config.json. */
export const DEFAULT_THRESHOLD = 0.99;

export const CUTOVER_NOTE: Record<CutoverStage, string> = {
  0: 'Locked. The rewrite only shadows; the old path answers every request.',
  1: 'Canary. One request in a hundred is answered by Java; the old path still commits as fallback.',
  10: 'Scaling up. One in ten on Java, error rate held at baseline.',
  100: 'All traffic on Java. Kill switch armed, rollback tested.',
};

/* ----------------------------- shadow result ----------------------------- */

/** 'baseline' means the legacy run is the one that is off, proven by code (sign decoding on ASCII vs z/OS). */
export type MismatchCategory = 'rounding' | 'formatting' | 'logic' | 'noise' | 'baseline';
export type MismatchClass = 'defect' | 'noise' | 'baseline' | 'unmade-decision';

export interface Mismatch {
  id: string;
  scenario: string;
  line: string;
  old: string;
  new: string;
  category: MismatchCategory;
  classification: MismatchClass;
  questionId?: string;
}

export interface ScenarioMatch {
  name: string;
  label: string;
  outcome: 'match' | 'mismatch' | 'error';
  linesCompared: number;
  linesMatched: number;
}

/** One reason the outputs differ, as the server grouped the lines. Settled once a person decides or it is accepted. */
export interface RootCause {
  id: string;
  cause: string;
  category: MismatchCategory;
  lines: number;
  scenarios: string[];
  sample?: { scenario: string; line: string; old: string; new: string };
  decision?: string;
  accepted: boolean;
}

export interface ShadowResult {
  program: string;
  status: 'done' | 'failed';
  reason?: string;
  model?: string;
  /** share of output lines that must agree before traffic may move (theseus.config.json) */
  threshold: number;
  /** raw: every differing line counts against the rewrite */
  matchRate: number;
  /** lines where the old run is proven off count as matching; this is what gates the cutover */
  effectiveMatchRate: number;
  scenarios: ScenarioMatch[];
  mismatches: Mismatch[];
  causes: RootCause[];
  decisions: string[];
  /** one entry per run of this program, oldest first */
  history: { rate: number; label: string }[];
  compilePasses?: number;
  javaLines?: number;
}

/** Root causes sorted by what still needs doing. */
export function causeTriage(causes: RootCause[]) {
  const settled = causes.filter((c) => c.accepted || !!c.decision);
  const open = causes.filter((c) => !c.accepted && !c.decision);
  return {
    waiting: open.filter((c) => c.category !== 'noise' && c.category !== 'baseline'),
    noise: open.filter((c) => c.category === 'noise'),
    /** the old run is the one that is off; waved off, proven by code */
    baseline: open.filter((c) => c.category === 'baseline'),
    settled,
    lines: causes.reduce((n, c) => n + c.lines, 0),
  };
}

export const CATEGORIES: MismatchCategory[] = ['rounding', 'formatting', 'logic', 'noise', 'baseline'];

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

/** Reads a /api/rewrite result (services/rewrite), so a field moving on the server is a one-line fix here.
 * Shape: { program, status: 'shadowed'|'failed'|'not-runnable', reason?, model, java: string, passes[],
 * scenarios: [{ name, expectedRc, actualRc, matched, total, matchRate, mismatches: [{ scenario, line, old, new, category }] }],
 * matchRate, threshold, history: [{ at, matchRate, status }] oldest first }. */
export function normalizeShadow(raw: unknown, fallbackThreshold = DEFAULT_THRESHOLD): ShadowResult | null {
  const r = obj(raw);
  if (typeof r.program !== 'string') return null;

  const scenarios: ScenarioMatch[] = [];
  const mismatches: Mismatch[] = [];
  arr(r.scenarios).forEach((s, i) => {
    const o = obj(s);
    const name = str(o.name, `scenario ${i + 1}`);
    const total = num(o.total);
    const matched = num(o.matched);
    const rate = typeof o.matchRate === 'number' ? o.matchRate : total > 0 ? matched / total : 0;
    const expectedRc = num(o.expectedRc);
    const actualRc = num(o.actualRc);
    const outcome: ScenarioMatch['outcome'] = actualRc < 0 ? 'error' : rate === 1 && actualRc === expectedRc ? 'match' : 'mismatch';
    scenarios.push({ name, label: name, outcome, linesCompared: total, linesMatched: matched });
    arr(o.mismatches).forEach((m, j) => {
      const d = obj(m);
      const category = (CATEGORIES as string[]).includes(str(d.category)) ? (str(d.category) as MismatchCategory) : 'logic';
      mismatches.push({
        id: `${name}:${j}`,
        scenario: str(d.scenario, name),
        line: str(d.line),
        old: str(d.old),
        new: str(d.new),
        category,
        // the server classifies the kind of difference; what to do about it is this chapter's reading:
        // noise and a proven-off old run are waved off, and nothing is fixed without an agreed invariant,
        // so the rest needs a person
        classification: category === 'noise' ? 'noise' : category === 'baseline' ? 'baseline' : 'unmade-decision',
      });
    });
  });

  const compared = scenarios.reduce((n, s) => n + s.linesCompared, 0);
  const matched = scenarios.reduce((n, s) => n + s.linesMatched, 0);
  const matchRate = typeof r.matchRate === 'number' ? clamp(r.matchRate) : compared > 0 ? matched / compared : 0;
  const effectiveMatchRate = typeof r.effectiveMatchRate === 'number' ? clamp(r.effectiveMatchRate) : matchRate;
  const history = arr(r.history).map((h, i) => {
    const o = obj(h);
    const at = hhmm(str(o.at));
    return { rate: clamp(num(o.matchRate)), label: `${i === 0 ? 'first run' : `run ${i + 1}`}${at ? ` · ${at}` : ''}` };
  });
  const status = str(r.status);
  const java = typeof r.java === 'string' ? r.java : '';
  const passes = arr(r.passes).length;
  const causes: RootCause[] = arr(r.groups).map((g, i) => {
    const o = obj(g);
    const sample = obj(o.sample);
    return {
      id: str(o.id, `M${i + 1}`),
      cause: str(o.cause),
      category: (CATEGORIES as string[]).includes(str(o.category)) ? (str(o.category) as MismatchCategory) : 'logic',
      lines: num(o.lines),
      scenarios: arr(o.scenarios).map(String),
      sample: Object.keys(sample).length ? { scenario: str(sample.scenario), line: str(sample.line), old: str(sample.old), new: str(sample.new) } : undefined,
      decision: typeof o.decision === 'string' && o.decision ? o.decision : undefined,
      accepted: o.accepted === true,
    };
  });

  return {
    program: r.program,
    status: status === 'shadowed' ? 'done' : 'failed',
    reason: typeof r.reason === 'string' ? r.reason : status === 'not-runnable' ? 'the program could not be run in the sandbox' : undefined,
    model: typeof r.model === 'string' ? r.model : undefined,
    threshold: typeof r.threshold === 'number' ? r.threshold : fallbackThreshold,
    matchRate,
    effectiveMatchRate,
    scenarios,
    mismatches,
    causes,
    decisions: arr(r.decisions).map(String),
    history: history.length ? history : [{ rate: matchRate, label: 'first run' }],
    compilePasses: passes || undefined,
    javaLines: java ? java.split('\n').length : undefined,
  };
}

export interface RewriteListEntry { program: string; status: string; matchRate: number; at: string; running: boolean }

/** GET /api/rewrite/list: which programs have a rewrite, which are rerunning right now, and the gate threshold. */
export function normalizeList(raw: unknown): { threshold: number | null; programs: RewriteListEntry[] } {
  const r = obj(raw);
  return {
    threshold: typeof r.threshold === 'number' ? r.threshold : null,
    programs: arr(r.programs)
      .map((p) => { const o = obj(p); return { program: str(o.program), status: str(o.status), matchRate: num(o.matchRate), at: str(o.at), running: o.running === true }; })
      .filter((p) => p.program),
  };
}

/* --------------------------------- triage -------------------------------- */

export const CLASS_LABEL: Record<MismatchClass, string> = {
  defect: 'Defect, fixed',
  noise: 'Noise, ignored',
  baseline: 'Old run is off here',
  'unmade-decision': 'Needs a person',
};

export interface Triage {
  /** differences nobody can decide from the code or the documents */
  asked: number;
  /** defects against an agreed invariant, fixed without asking */
  autoFixed: number;
  /** nondeterminism excluded from the diff */
  filtered: number;
  total: number;
  byCategory: { category: MismatchCategory; count: number }[];
}

export function triage(ms: Mismatch[]): Triage {
  const t: Triage = { asked: 0, autoFixed: 0, filtered: 0, total: ms.length, byCategory: CATEGORIES.map((category) => ({ category, count: 0 })) };
  for (const m of ms) {
    if (m.classification === 'defect') t.autoFixed++;
    else if (m.classification === 'noise' || m.classification === 'baseline') t.filtered++;
    else t.asked++;
    t.byCategory[CATEGORIES.indexOf(m.category)].count++;
  }
  return t;
}

/* ------------------------------- questions ------------------------------- */

export interface Question {
  id: string;
  text: string;
  options: string[];
  routeName: string;
  routeTitle?: string;
  routeWhy: string;
  status: 'open' | 'answered';
  statusLabel: string;
  answerText: string;
  answeredBy: string;
  answeredAtMs: number;
  raw: HarnessQuestion;
}

const STATUS_LABEL: Record<string, string> = {
  asking: 'asked on Slack',
  'needs-person': 'needs a person',
  conflict: 'sources disagree',
  answered: 'answered',
  'answered-by-docs': 'answered by the documents',
  'known-issue': 'known issue',
};

export function optionsOf(q: HarnessQuestion): string[] {
  try {
    const v: unknown = JSON.parse(q.optionsJson || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
/** Still needs a person: routed, asked on Slack, or two sources disagree. */
export const isOpen = (q: HarnessQuestion) => q.status === 'asking' || q.status === 'needs-person' || q.status === 'conflict';
/** Settled, by a person or by the documents. */
export const isAnswered = (q: HarnessQuestion) => q.status === 'answered' || q.status === 'answered-by-docs' || q.status === 'known-issue';

/** The harness questions for one program, as the chapter shows them. */
export function questionsFor(program: string, rows: HarnessQuestion[], people: Map<string, { name: string; title: string }>) {
  const all = rows
    .filter((q) => q.program === program && (isOpen(q) || isAnswered(q)))
    .map((q): Question => ({
      id: q.id,
      text: q.text,
      options: optionsOf(q),
      routeName: people.get(q.routeTo)?.name ?? q.routeName ?? q.routeTo,
      routeTitle: people.get(q.routeTo)?.title,
      routeWhy: q.routeWhy,
      status: isAnswered(q) ? 'answered' : 'open',
      statusLabel: STATUS_LABEL[q.status] ?? q.status,
      answerText: q.answerText,
      // the harness keys answers by person id (an email); show the person
      answeredBy: people.get(q.answeredBy)?.name ?? q.answeredBy,
      answeredAtMs: q.answeredAtMs || 0,
      raw: q,
    }));
  return {
    open: all.filter((q) => q.status === 'open'),
    answered: all.filter((q) => q.status === 'answered').sort((a, b) => b.answeredAtMs - a.answeredAtMs),
  };
}

/* -------------------------------- pipeline ------------------------------- */

export type StageState = 'done' | 'active' | 'todo';
export interface StageRow { id: string; label: string; state: StageState; detail: string }

export interface PipelineFacts {
  mapped: boolean; links: number;
  ran: 'ran' | 'skipped' | 'failed' | 'none'; scenarios: number; runReason?: string;
  read: boolean; findings: number; questionsFound: number;
  rewrite: 'none' | 'done' | 'failed'; rewriteReason?: string; compilePasses?: number;
  /** raw and effective match; effective gates the cutover */
  matchRate: number | null; effectiveRate: number | null; threshold: number;
  waiting: number; answered: number;
  cutover: CutoverStage;
}

const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w.endsWith('s') ? `${w}es` : `${w}s`}`;
const pctOf = (r: number) => `${(r * 100).toFixed(1)}%`;

/** One row per stage for one program; every detail is something that actually happened. */
export function pipeline(f: PipelineFacts): StageRow[] {
  const unlocked = f.effectiveRate !== null && f.effectiveRate >= f.threshold;
  const pct = Math.round(f.threshold * 100);
  const shadowDetail = f.matchRate === null || f.effectiveRate === null
    ? 'not run yet'
    : f.effectiveRate !== f.matchRate
      ? `${pctOf(f.matchRate)} raw · ${pctOf(f.effectiveRate)} with the old run’s errors set aside`
      : `${pctOf(f.matchRate)} of output lines match`;
  return [
    { id: 'map', label: 'Map', state: f.mapped ? 'done' : 'todo', detail: f.mapped ? `${plural(f.links, 'link')} in the map` : 'not in the map' },
    { id: 'run', label: 'Run', state: f.ran === 'ran' ? 'done' : 'todo', detail: f.ran === 'ran' ? `${plural(f.scenarios, 'scenario')} in the sandbox` : f.ran === 'none' ? 'not run yet' : `couldn’t run: ${f.runReason ?? f.ran}` },
    { id: 'read', label: 'Read', state: f.read ? 'done' : 'todo', detail: f.read ? `${plural(f.findings, 'finding')} · ${plural(f.questionsFound, 'question')}` : 'not read yet' },
    { id: 'rewrite', label: 'Rewrite', state: f.rewrite === 'done' ? 'done' : 'todo', detail: f.rewrite === 'done' ? (f.compilePasses ? `Java, compiled in ${plural(f.compilePasses, 'pass')}` : 'Java compiled') : f.rewrite === 'failed' ? `didn’t compile: ${f.rewriteReason ?? 'see step 6'}` : 'not rewritten yet' },
    { id: 'shadow', label: 'Shadow', state: f.matchRate === null ? 'todo' : unlocked ? 'done' : 'active', detail: shadowDetail },
    { id: 'ask', label: 'Ask', state: f.waiting > 0 ? 'active' : 'done', detail: f.waiting > 0 ? `${f.waiting} waiting on a person` : `${f.answered} answered` },
    { id: 'lock', label: 'Lock in', state: f.answered > 0 ? (f.waiting > 0 ? 'active' : 'done') : 'todo', detail: `${plural(f.answered, 'answer')} → tests` },
    { id: 'cutover', label: 'Cut over', state: f.cutover === 100 ? 'done' : unlocked ? 'active' : 'todo', detail: f.cutover === 100 ? 'all traffic on Java' : unlocked ? `${f.cutover}% of traffic on Java` : `opens at ${pct}% match` },
  ];
}

/** Share of live traffic answered by each side. */
export function trafficSplit(stage: CutoverStage) {
  const java = stage / 100;
  return { java, legacy: 1 - java };
}

/* --------------------------------- chart --------------------------------- */

export interface ChartPoint { x: number; y: number; rate: number; label: string }
export interface ChartGeometry {
  points: ChartPoint[];
  /** SVG paths in a 0..100 × 0..100 box */
  line: string;
  area: string;
  thresholdY: number;
  ticks: { value: number; y: number }[];
}

/** Lays the match history out in a 0..100 box. Steps, not slopes: the rate only moves when a run lands. */
export function chartGeometry(history: { rate: number; label: string }[], threshold: number): ChartGeometry {
  const rates = history.map((p) => p.rate);
  const lo = Math.max(0, Math.min(...rates, threshold) - 0.04);
  const hi = 1;
  const y = (r: number) => 100 - ((r - lo) / (hi - lo)) * 100;
  const n = history.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * 100);
  const points = history.map((p, i) => ({ x: x(i), y: y(p.rate), rate: p.rate, label: p.label }));
  if (n === 0) return { points, line: '', area: '', thresholdY: y(threshold), ticks: [] };

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < n; i++) d += ` L ${points[i].x} ${points[i - 1].y} L ${points[i].x} ${points[i].y}`;
  const line = `${d} L 100 ${points[n - 1].y}`;
  const area = `${line} L 100 100 L ${points[0].x} 100 Z`;

  // gridlines below the threshold only; the threshold line labels itself. Coarser steps for wide ranges,
  // so a history that starts near zero doesn't stack ten labels on the right edge.
  const step = hi - lo > 0.5 ? 0.25 : hi - lo > 0.15 ? 0.1 : 0.05;
  const ticks: { value: number; y: number }[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= threshold - 0.03; v += step) ticks.push({ value: +v.toFixed(2), y: y(v) });
  return { points, line, area, thresholdY: y(threshold), ticks };
}

/** "after Grace Kim answered" → "after Grace Kim"; long notes are cut at four words. */
export function caption(label: string) {
  const words = label.split(/\s+/).filter(Boolean);
  return words.length > 4 ? `${words.slice(0, 4).join(' ')}…` : label;
}
