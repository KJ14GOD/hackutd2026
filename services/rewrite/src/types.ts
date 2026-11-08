// Shapes for the rewrite and shadow run. One RewriteResult per program, saved to disk so a replay is offline.

/** baseline: the legacy run is the one that's off (GnuCOBOL decoding mainframe data differently from z/OS), proven by code. */
export type MismatchCategory = 'formatting' | 'rounding' | 'noise' | 'logic' | 'baseline';

export interface Mismatch {
  scenario: string;
  /** 1-based line in the COBOL output (0 for the return code). */
  line: number;
  /** What COBOL printed ('' when Java printed an extra line). */
  old: string;
  /** What Java printed ('' when Java missed a line). */
  new: string;
  category: MismatchCategory;
}

/** Mismatches with one root cause: blocks of differing lines that start the same way, across scenarios. */
export interface MismatchGroup {
  /** "M1", "M2"... in order of size. */
  id: string;
  /** One line: what COBOL printed vs what the Java printed where the difference starts. */
  cause: string;
  category: MismatchCategory;
  /** Differing lines this cause accounts for. */
  lines: number;
  scenarios: string[];
  sample: { scenario: string; line: number; old: string; new: string };
  /** The Slack/UI question asking which behavior to keep (logic causes only). */
  questionId?: string;
  /** What the owner decided, once answered. */
  decision?: string;
  /** The owner accepted the difference ("keep the new behavior" or "doesn't matter"): its lines count as settled. */
  accepted?: boolean;
}

export interface ScenarioResult {
  name: string;
  expectedRc: number;
  actualRc: number;
  matched: number;
  /** Lines compared: the longer of the two outputs. */
  total: number;
  matchRate: number;
  mismatches: Mismatch[];
  ms: number;
  /** The Java's stderr when it crashed or printed errors (first lines). */
  stderr?: string;
}

export interface Pass {
  kind: 'write' | 'compile-fix' | 'diff-fix';
  compileOk: boolean;
  /** javac's output when it failed. */
  compileLog: string;
  /** Overall match rate after this pass ran, when it compiled. */
  matchRate?: number;
}

export interface RewriteResult {
  version: 1;
  program: string;
  /** shadowed: compiled and ran on every scenario; failed: never compiled; not-runnable: no COBOL run to compare with. */
  status: 'shadowed' | 'failed' | 'not-runnable';
  reason?: string;
  model: string;
  /** The final Main.java. */
  java: string;
  passes: Pass[];
  scenarios: ScenarioResult[];
  /** Matched lines over compared lines, across every scenario (return codes count as one line each); lines of accepted groups count as matched. */
  matchRate: number;
  /** Root causes per category (a cause is counted once however many lines it touches). */
  byCategory: Record<MismatchCategory, number>;
  /** Differing lines per category. */
  byCategoryLines: Record<MismatchCategory, number>;
  /** matchRate with baseline lines counted as matching too (the raw matchRate never includes them). */
  effectiveMatchRate: number;
  groups: MismatchGroup[];
  /** Owner decisions this run was written with (from answered mismatch questions). */
  decisions: string[];
  startedAt: string;
  ms: number;
}

export type RewriteEvent =
  | { type: 'stage'; stage: 'writing' | 'compiling' | 'fixing' | 'running' | 'diffing' | 'done'; message: string; pass?: number }
  /** The Java file being written; pass 0 is the first draft, later passes rewrite the whole file after a reset. */
  | { type: 'token'; text: string; pass: number }
  | { type: 'compile_error'; text: string; pass: number }
  /** A fix starts: the file is rewritten from scratch by the tokens that follow (reset: clear the editor). */
  | { type: 'fix_pass'; pass: number; reason: 'compile' | 'diff'; reset: true }
  | { type: 'compiled'; pass: number }
  /** The Java being written just named a COBOL paragraph: the lines it's translating now. */
  | { type: 'focus'; ref: string; label: string; pass: number }
  | { type: 'run'; scenario: string; rc: number; expectedRc: number; ms: number; lines: string[] }
  | { type: 'diff'; scenario: string; matchRate: number; matched: number; total: number; mismatches: Mismatch[] }
  | { type: 'done'; result: RewriteResult }
  | { type: 'error'; message: string };
