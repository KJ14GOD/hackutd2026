// The war room's pacing engine. The reader's SSE delivers a whole PackResult per program (replay
// finishes in under a second), so this turns each result back into the text Nemotron wrote and
// "types" it out lane by lane, emitting an event as each finding or question closes. When the
// server starts sending real {type:'token'} chunks, feedToken() takes over for that program and
// the synthesized text is never used.
import type { Finding, PackResult, Question } from '../../../../services/reader/src/contract';

export type JobStatus = 'queued' | 'reading' | 'done';

export interface Citation { path: string; from: number; to: number }

/** One thing the model closed while writing: a finding or a question, with where it points. */
export type Item =
  | { kind: 'finding'; program: string; finding: Finding; cites: Citation[]; at: number }
  | { kind: 'question'; program: string; question: Question; cites: Citation[]; at: number };

export interface Job {
  program: string;
  status: JobStatus;
  /** Everything typed so far. */
  text: string;
  /** Items emitted so far, newest last. */
  items: Item[];
  /** Lines of the program's own file the model has cited so far. */
  citedLines: Set<number>;
  result?: PackResult;
  startedAt?: number;
  finishedAt?: number;
}

export type EngineEvent =
  | { type: 'job'; job: Job }
  | { type: 'item'; item: Item; job: Job }
  | { type: 'idle' };

type Pending = Item extends infer T ? T extends Item ? Omit<T, 'at'> : never : never;
interface Segment { end: number; item: Pending }

/** Brace-depth scanner over a streamed JSON reply. Depth 2 is "inside findings[] or questions[]". */
interface Scan { depth: number; inString: boolean; escape: boolean; objStart: number; consumed: number; section: 'findings' | 'questions' | null }

interface Lane {
  job: Job;
  full: string;
  pos: number;
  segments: Segment[];
  next: number;
}

export const EVIDENCE = /([\w./-]+\.(?:cbl|CBL|cpy|CPY|jcl|JCL|bms|BMS|dcl|DCL|sql|SQL|cob|COB)):(\d+)(?:-(\d+))?/g;

export function parseCitations(refs: string[]): Citation[] {
  const out: Citation[] = [];
  for (const ref of refs) {
    const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(ref.trim());
    if (!m) continue;
    const from = Number(m[2]);
    out.push({ path: m[1], from, to: Number(m[3] ?? m[2]) || from });
  }
  return out;
}

/** The program's own source file, judged from what it cites most. */
export function ownFile(job: Job): string | undefined {
  const counts = new Map<string, number>();
  for (const it of job.items) for (const c of it.cites) {
    const base = c.path.split('/').pop()?.replace(/\.[^.]+$/, '').toUpperCase();
    if (base === job.program.toUpperCase()) return c.path;
    counts.set(c.path, (counts.get(c.path) ?? 0) + 1);
  }
  let best: string | undefined;
  let n = 0;
  for (const [p, c] of counts) if (c > n) { best = p; n = c; }
  return best;
}

const q = (s: string) => JSON.stringify(s);

/** One streamed object → a finding or question item, or nothing if it is neither. */
function toItem(program: string, raw: unknown): Pending | null {
  const r = raw as { section: 'findings' | 'questions' | null; value: Record<string, unknown> };
  const v = r.value;
  if (!v || typeof v !== 'object') return null;
  const evidence = Array.isArray(v.evidence) ? (v.evidence as unknown[]).filter((e): e is string => typeof e === 'string') : [];
  if (r.section === 'questions' || (typeof v.text === 'string' && Array.isArray(v.options))) {
    if (typeof v.text !== 'string') return null;
    const question: Question = {
      id: typeof v.id === 'string' ? v.id : `${program}-q${evidence[0] ?? ''}`,
      program,
      text: v.text,
      evidence,
      options: Array.isArray(v.options) ? (v.options as unknown[]).filter((o): o is string => typeof o === 'string') : [],
      blocks: v.blocks === 'rewrite' || v.blocks === 'cutover' ? v.blocks : 'none',
    };
    return { kind: 'question', program, question, cites: parseCitations(evidence) };
  }
  if (typeof v.kind !== 'string' || typeof v.summary !== 'string') return null;
  const finding: Finding = {
    kind: v.kind as Finding['kind'],
    ref: typeof v.ref === 'string' ? v.ref : undefined,
    summary: v.summary,
    evidence,
    confidence: v.confidence === 'high' || v.confidence === 'low' ? v.confidence : 'medium',
  };
  return { kind: 'finding', program, finding, cites: parseCitations(evidence) };
}

/** Rebuilds the JSON Nemotron returns for one pack, remembering where every item closes. */
function synthesize(r: PackResult): { full: string; segments: Segment[] } {
  const segments: Segment[] = [];
  let s = '{\n  "findings": [\n';
  // Links first, as the model writes them, then the judgments; questions at the end.
  const ordered = [...r.findings].sort((a, b) => Number(b.kind === 'connection') - Number(a.kind === 'connection'));
  ordered.forEach((f, i) => {
    s += '    {\n';
    s += `      "kind": ${q(f.kind)},\n`;
    if (f.ref) s += `      "ref": ${q(f.ref)},\n`;
    s += `      "summary": ${q(f.summary)},\n`;
    s += `      "evidence": [${f.evidence.map(q).join(', ')}],\n`;
    s += `      "confidence": ${q(f.confidence)}\n`;
    s += i < ordered.length - 1 ? '    },\n' : '    }\n';
    segments.push({ end: s.length, item: { kind: 'finding', program: r.program, finding: f, cites: parseCitations(f.evidence) } });
  });
  s += '  ],\n  "questions": [\n';
  r.questions.forEach((qu, i) => {
    s += '    {\n';
    s += `      "text": ${q(qu.text)},\n`;
    s += `      "options": [${qu.options.map(q).join(', ')}],\n`;
    s += `      "evidence": [${qu.evidence.map(q).join(', ')}],\n`;
    s += `      "blocks": ${q(qu.blocks)}\n`;
    s += i < r.questions.length - 1 ? '    },\n' : '    }\n';
    segments.push({ end: s.length, item: { kind: 'question', program: r.program, question: qu, cites: parseCitations(qu.evidence) } });
  });
  s += '  ]\n}\n';
  return { full: s, segments };
}

export interface EngineOptions {
  /** Programs typed at once. */
  lanes: number;
  /** Characters per second at speed 1. */
  charsPerSecond: number;
}

export class Engine {
  private jobs = new Map<string, Job>();
  private order: string[] = [];
  private queue: PackResult[] = [];
  private lanes: Lane[] = [];
  private listeners = new Set<(e: EngineEvent) => void>();
  private timer: number | undefined;
  private last = 0;
  speed = 1;
  paused = false;
  private carry = 0;
  /** Programs the server streams tokens for; the engine does not synthesize those. */
  private live = new Set<string>();
  /** Incremental scan state for programs streamed by the server: where the top-level array items close. */
  private scan = new Map<string, Scan>();
  /** Server chunks not yet shown, per program. Drained at `paceMs` per chunk so a backlog burst still reads as typing. */
  private pending = new Map<string, string[]>();
  private pendingResult = new Map<string, PackResult>();
  /** Milliseconds per server chunk at speed 1; the speed buttons divide it. */
  paceMs = 40;

  constructor(private opts: EngineOptions) {}

  subscribe(fn: (e: EngineEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(e: EngineEvent) { for (const fn of this.listeners) fn(e); }

  all(): Job[] { return this.order.map((p) => this.jobs.get(p)!); }
  get(program: string) { return this.jobs.get(program); }
  get busy() { return this.lanes.length > 0 || this.queue.length > 0 || [...this.pending.values()].some((q) => q.length > 0); }

  /** Programs we know exist, before any result lands; they show as queued. */
  expect(programs: string[]) {
    for (const p of programs) this.ensure(p);
  }

  private ensure(program: string): Job {
    let job = this.jobs.get(program);
    if (!job) {
      job = { program, status: 'queued', text: '', items: [], citedLines: new Set() };
      this.jobs.set(program, job);
      this.order.push(program);
      this.emit({ type: 'job', job });
    }
    return job;
  }

  /** A finished pack from the server. Typed out when a lane frees up. */
  feedResult(r: PackResult) {
    const job = this.ensure(r.program);
    job.result = r;
    if (this.live.has(r.program)) {
      // Chunks still queued for display: finish once they have all been shown.
      if (this.pending.get(r.program)?.length) { this.pendingResult.set(r.program, r); return; }
      // The stream already produced the items; if it produced none (a non-JSON reply), take the parsed result.
      if (job.items.length === 0) {
        for (const f of r.findings) job.items.push({ kind: 'finding', program: r.program, finding: f, cites: parseCitations(f.evidence), at: performance.now() });
        for (const qu of r.questions) job.items.push({ kind: 'question', program: r.program, question: qu, cites: parseCitations(qu.evidence), at: performance.now() });
      }
      this.finish(job);
      return;
    }
    this.queue.push(r);
    this.fill();
    this.run();
  }

  /** A real token from the server. Replaces synthesis for that program; shown at the engine's pace. */
  feedToken(program: string, text: string) {
    const job = this.ensure(program);
    if (!this.live.has(program)) {
      this.live.add(program);
      this.lanes = this.lanes.filter((l) => l.job.program !== program);
      this.queue = this.queue.filter((r) => r.program !== program);
      job.text = '';
      job.status = 'reading';
      job.startedAt = performance.now();
      this.emit({ type: 'job', job });
    }
    const q = this.pending.get(program) ?? [];
    q.push(text);
    this.pending.set(program, q);
    this.run();
  }

  /** Applies one server chunk to its job: text, citations, closed items. */
  private applyToken(job: Job, text: string) {
    job.text += text;
    this.scanCitations(job, text);
    for (const raw of this.closedObjects(job)) {
      const item = toItem(job.program, raw);
      if (!item) continue;
      const full = { ...item, at: performance.now() } as Item;
      job.items.push(full);
      this.emit({ type: 'item', item: full, job });
    }
    this.emit({ type: 'job', job });
  }

  /** Objects that closed at depth 2 since the last call, as parsed JSON. */
  private closedObjects(job: Job): unknown[] {
    const st = this.scan.get(job.program) ?? { depth: 0, inString: false, escape: false, objStart: -1, consumed: 0, section: null };
    this.scan.set(job.program, st);
    const out: unknown[] = [];
    const t = job.text;
    for (let i = st.consumed; i < t.length; i++) {
      const c = t[i];
      if (st.inString) {
        if (st.escape) st.escape = false;
        else if (c === '\\') st.escape = true;
        else if (c === '"') st.inString = false;
        continue;
      }
      if (c === '"') { st.inString = true; continue; }
      if (c === '{' || c === '[') {
        st.depth++;
        if (c === '{' && st.depth === 3) st.objStart = i;
        if (c === '[' && st.depth === 2) {
          const head = t.slice(Math.max(0, i - 24), i);
          st.section = /"questions"\s*:\s*$/.test(head) ? 'questions' : /"findings"\s*:\s*$/.test(head) ? 'findings' : st.section;
        }
      } else if (c === '}' || c === ']') {
        if (c === '}' && st.depth === 3 && st.objStart >= 0) {
          try { out.push({ section: st.section, value: JSON.parse(t.slice(st.objStart, i + 1)) }); } catch { /* malformed item, skip it */ }
          st.objStart = -1;
        }
        st.depth = Math.max(0, st.depth - 1);
      }
    }
    st.consumed = t.length;
    return out;
  }

  private scanCitations(job: Job, chunk: string) {
    // Look back a little so a citation split across chunks is still caught.
    const window = job.text.slice(Math.max(0, job.text.length - chunk.length - 48));
    const own = job.program.toUpperCase();
    for (const m of window.matchAll(EVIDENCE)) {
      const base = m[1].split('/').pop()?.replace(/\.[^.]+$/, '').toUpperCase();
      if (base !== own) continue;
      const from = Number(m[2]);
      const to = Number(m[3] ?? m[2]) || from;
      for (let n = from; n <= Math.min(to, from + 40); n++) job.citedLines.add(n);
    }
  }

  private fill() {
    while (this.lanes.length < this.opts.lanes && this.queue.length) {
      const r = this.queue.shift()!;
      const job = this.jobs.get(r.program)!;
      const { full, segments } = synthesize(r);
      job.status = 'reading';
      job.startedAt = performance.now();
      this.lanes.push({ job, full, pos: 0, segments, next: 0 });
      this.emit({ type: 'job', job });
    }
  }

  private finish(job: Job) {
    job.status = 'done';
    job.finishedAt = performance.now();
    this.emit({ type: 'job', job });
  }

  private run() {
    if (this.timer !== undefined) return;
    this.last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = this.paused ? 0 : (now - this.last) / 1000;
      this.last = now;
      // Server chunks: at most one per paceMs/speed per program, carried as a fractional allowance.
      if (!this.paused) {
        const allow = (dt * 1000) / Math.max(1, this.paceMs / this.speed);
        this.carry = Math.min(this.carry + allow, 64);
        const n = Math.floor(this.carry);
        if (n > 0) {
          this.carry -= n;
          for (const [program, q] of this.pending) {
            if (!q.length) continue;
            const job = this.jobs.get(program)!;
            for (let i = 0; i < n && q.length; i++) this.applyToken(job, q.shift()!);
            this.emit({ type: 'job', job });
            const r = this.pendingResult.get(program);
            if (!q.length && r) { this.pendingResult.delete(program); this.pending.delete(program); this.feedResult(r); }
          }
        }
      }
      const budget = dt * this.opts.charsPerSecond * this.speed;
      for (const lane of [...this.lanes]) {
        const target = Math.min(lane.full.length, lane.pos + budget);
        if (target > lane.pos) {
          const chunk = lane.full.slice(lane.pos, target);
          lane.pos = target;
          lane.job.text = lane.full.slice(0, lane.pos);
          this.scanCitations(lane.job, chunk);
          while (lane.next < lane.segments.length && lane.segments[lane.next].end <= lane.pos) {
            const item = { ...lane.segments[lane.next].item, at: now } as Item;
            lane.job.items.push(item);
            lane.next++;
            this.emit({ type: 'item', item, job: lane.job });
          }
          this.emit({ type: 'job', job: lane.job });
        }
        if (lane.pos >= lane.full.length) {
          this.lanes = this.lanes.filter((l) => l !== lane);
          this.finish(lane.job);
        }
      }
      this.fill();
      if (this.lanes.length === 0 && this.queue.length === 0 && ![...this.pending.values()].some((q) => q.length > 0)) {
        window.clearInterval(this.timer);
        this.timer = undefined;
        this.emit({ type: 'idle' });
      }
    };
    this.timer = window.setInterval(tick, 40);
  }

  reset() {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.jobs.clear();
    this.order = [];
    this.queue = [];
    this.lanes = [];
    this.live.clear();
    this.scan.clear();
    this.pending.clear();
    this.pendingResult.clear();
    this.carry = 0;
    this.emit({ type: 'idle' });
  }

  destroy() {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }
}
