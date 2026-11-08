// Shared helpers for scanners: matching over normalized source, evidence, and resolving
// names that a program keeps in variables (spec §1.2 step 5).
import type { Confidence, Edge, Lookups, NormalizedProgram, System, Touch, Unresolved } from '../types';

export interface ScanResult {
  edges: Edge[];
  unresolved: Unresolved[];
  touches: Touch[];
}

export type Scanner = (prog: NormalizedProgram, lookups: Lookups) => ScanResult;

export const empty = (): ScanResult => ({ edges: [], unresolved: [], touches: [] });

export function at(prog: NormalizedProgram, offset: number): string {
  return `${prog.path}:${prog.lineAt(offset)}`;
}

export function* matches(re: RegExp, text: string): Generator<RegExpExecArray> {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    yield m;
    if (m[0].length === 0) g.lastIndex++;
  }
}

const literalRanges = new WeakMap<NormalizedProgram, [number, number][]>();

/** Start/end offsets of every quoted literal, so keywords inside DISPLAY strings don't count. */
function literalSpans(prog: NormalizedProgram): [number, number][] {
  const cached = literalRanges.get(prog);
  if (cached) return cached;
  const spans: [number, number][] = [];
  let open: { q: string; at: number } | undefined;
  for (let i = 0; i < prog.joined.length; i++) {
    const ch = prog.joined[i];
    if (ch !== "'" && ch !== '"') continue;
    if (!open) open = { q: ch, at: i };
    else if (open.q === ch) { spans.push([open.at, i]); open = undefined; }
  }
  literalRanges.set(prog, spans);
  return spans;
}

export function inLiteral(prog: NormalizedProgram, offset: number): boolean {
  const spans = literalSpans(prog);
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = spans[mid];
    if (offset < s) hi = mid - 1;
    else if (offset > e) lo = mid + 1;
    else return offset > s;
  }
  return false;
}

/** Like `matches` over the program's code, skipping hits that start inside a quoted literal. */
export function* codeMatches(prog: NormalizedProgram, re: RegExp): Generator<RegExpExecArray> {
  for (const m of matches(re, prog.joined)) if (!inLiteral(prog, m.index)) yield m;
}

/** Every `EXEC <kind> ... END-EXEC` block, with the offset where it starts. */
export function* execBlocks(prog: NormalizedProgram, kind: 'CICS' | 'SQL' | 'DLI'): Generator<{ body: string; offset: number }> {
  for (const m of codeMatches(prog, new RegExp(`\\bEXEC\\s+${kind}\\b([\\s\\S]*?)END-EXEC`))) {
    yield { body: m[1], offset: m.index };
  }
}

/** Reads `KEY(value)` out of an EXEC CICS block. */
export function option(body: string, key: string): string | undefined {
  const m = new RegExp(`\\b${key}\\s*\\(\\s*([^)]*?)\\s*\\)`).exec(body);
  return m?.[1];
}

export function literal(token: string): string | undefined {
  const m = /^(['"])(.*)\1$/.exec(token.trim());
  return m ? m[2].trim() : undefined;
}

export function stripSubscript(name: string): string {
  return name.replace(/\(.*$/, '').trim();
}

export class Collector {
  readonly result: ScanResult = empty();
  private touched = false;
  constructor(private prog: NormalizedProgram, private system: System) {}

  edge(to: string, rel: string, offset: number, confidence: Confidence = 'extracted', via?: string, from?: string) {
    this.result.edges.push({ from: from ?? `prog:${this.prog.name}`, to, rel, evidence: at(this.prog, offset), confidence, system: this.system, ...(via ? { via } : {}) });
    this.touch(offset);
  }

  unresolved(what: string, token: string, offset: number, candidates?: string[]) {
    this.result.unresolved.push({ program: this.prog.name, system: this.system, what, token, at: at(this.prog, offset), ...(candidates && candidates.length ? { candidates: [...new Set(candidates)].sort() } : {}) });
    this.touch(offset);
  }

  touch(offset: number) {
    if (this.touched) return;
    this.touched = true;
    this.result.touches.push({ program: this.prog.name, system: this.system, evidence: at(this.prog, offset) });
  }
}

const valueCache = new WeakMap<NormalizedProgram, Map<string, Set<string>>>();
const literalCache = new WeakMap<NormalizedProgram, Set<string>>();

/** Text of the program plus every copybook it includes, so VALUE clauses in copybooks count. */
function withCopybooks(prog: NormalizedProgram, lookups: Lookups): string {
  let text = prog.joined;
  for (const m of matches(/\bCOPY\s+['"]?([A-Z0-9#@$-]+)['"]?/, prog.joined)) {
    const cpy = lookups.copybooks.get(m[1]);
    if (cpy) text += ' ' + cpy;
  }
  return text;
}

const STOP = /^(MOVE|IF|ELSE|END-IF|PERFORM|EXEC|GO|DISPLAY|CALL|SET|COMPUTE|ADD|EVALUATE|WHEN|END-EVALUATE|INITIALIZE|STRING|READ|WRITE|OPEN|CLOSE|CONTINUE|NEXT|EXIT|GOBACK|STOP|ACCEPT|INSPECT|UNSTRING|SEARCH|RETURN|NOT|AND|OR|OF|IN)$/;

/** Variable name -> literal values the program (or its copybooks) assigns it. */
export function literalValues(prog: NormalizedProgram, lookups: Lookups): Map<string, Set<string>> {
  const cached = valueCache.get(prog);
  if (cached) return cached;
  const text = withCopybooks(prog, lookups);
  const values = new Map<string, Set<string>>();
  const add = (name: string, value: string) => {
    const key = stripSubscript(name);
    if (!values.has(key)) values.set(key, new Set());
    values.get(key)!.add(value.trim());
  };
  for (const m of matches(/\b\d{2}\s+([A-Z0-9-]+)\s+(?:PIC(?:TURE)?\s+(?:IS\s+)?\S+\s+)?(?:USAGE\s+(?:IS\s+)?\S+\s+)?VALUE\s+(?:IS\s+)?(['"])(.*?)\2/, text)) {
    add(m[1], m[3]);
  }
  for (const m of matches(/\bMOVE\s+(['"])(.*?)\1\s+TO\s+((?:[A-Z0-9-]+(?:\([^)]*\))?\s*)+)/, text)) {
    for (const target of m[3].trim().split(/\s+/)) {
      if (STOP.test(target)) break;
      add(target, m[2]);
    }
  }
  // MOVE A TO B copies whatever literals A can hold into B. A few rounds reach chains like LIT -> WS -> CDEMO.
  const copies: [string, string][] = [];
  for (const m of matches(/\bMOVE\s+([A-Z][A-Z0-9-]*)(?:\([^)]*\))?\s+TO\s+([A-Z][A-Z0-9-]*)/, text)) {
    if (!STOP.test(m[1]) && !/^(SPACES?|ZEROS?|ZEROES|LOW-VALUES?|HIGH-VALUES?|FUNCTION)$/.test(m[1])) copies.push([m[1], m[2]]);
  }
  for (let round = 0; round < 3; round++) {
    for (const [from, to] of copies) for (const v of values.get(from) ?? []) add(to, v);
  }
  valueCache.set(prog, values);
  return values;
}

/** Every quoted literal in the program and its copybooks. */
export function allLiterals(prog: NormalizedProgram, lookups: Lookups): Set<string> {
  const cached = literalCache.get(prog);
  if (cached) return cached;
  const out = new Set<string>();
  for (const m of matches(/(['"])([A-Z0-9#@$-]{1,30})\s*\1/, withCopybooks(prog, lookups))) out.add(m[2]);
  literalCache.set(prog, out);
  return out;
}

/**
 * Resolves an operand that is either a literal or a variable.
 * `exact` holds the name when there is exactly one; `values` holds whatever was found.
 */
export function resolveOperand(prog: NormalizedProgram, lookups: Lookups, operand: string): { exact?: string; isLiteral: boolean; values: string[] } {
  const lit = literal(operand);
  if (lit !== undefined) return { exact: lit, isLiteral: true, values: [lit] };
  const vals = [...(literalValues(prog, lookups).get(stripSubscript(operand)) ?? [])].filter((v) => v !== '').sort();
  return { exact: vals.length === 1 ? vals[0] : undefined, isLiteral: false, values: vals };
}

/** Call targets that are runtime or middleware APIs, not programs or vendor code. */
export const MQ_API = /^MQ(OPEN|PUT1?|GET|CONNX?|DISC|CLOSE|INQ|SET|BEGIN|CMIT|BACK)$/;
export const IMS_API = /^(CBLTDLI|AIBTDLI|CEETDLI)$/;
export const DATE_API = /^CEE(DAYS|DATE|LOCT|GMT|GMTO|DATM|SECS|ISEC|SECI|UTC|QCEN|SCEN|DYWK|CBLDY)$/;
export const SYSTEM_API = /^(CEE[A-Z0-9]+|DSNTIAR|DSNHLI|DSNALI|ILBO[A-Z0-9]+|IGZ[A-Z0-9]+|CSQ[A-Z0-9]+)$/;
export const SOCKET_API = /^(EZASOKET|EZACICAL|EZACIC[0-9A-Z]+|EZASMI)$/;

export interface CallSite {
  target?: string;
  operand: string;
  offset: number;
  dynamic: boolean;
  values: string[];
}

/** Every CALL statement, static or dynamic, with dynamic targets resolved when the program assigns exactly one. */
export function callSites(prog: NormalizedProgram, lookups: Lookups): CallSite[] {
  const out: CallSite[] = [];
  // EXEC SQL CALL is a stored procedure, which the db scanner owns.
  const sql = [...execBlocks(prog, 'SQL')].map((b) => [b.offset, b.offset + b.body.length + 20] as const);
  for (const m of codeMatches(prog, /(?<![A-Z0-9-])CALL\s+((['"])[A-Z0-9#@$-]+\2|[A-Z][A-Z0-9-]*)/)) {
    if (sql.some(([s, e]) => m.index >= s && m.index <= e)) continue;
    const operand = m[1];
    const r = resolveOperand(prog, lookups, operand);
    out.push({ target: r.exact, operand, offset: m.index, dynamic: !r.isLiteral, values: r.values });
  }
  return out;
}
