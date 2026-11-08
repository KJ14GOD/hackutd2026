// COBOL fact extractor: everything one program references. Pure (text in, facts out).
// Works on the program text with its copybooks already expanded (see expand.ts), because
// CardDemo keeps both literals and some procedure code in copybooks.
import { cleanSource, execBlocks, joinedText } from './source';

/** A reference that is either a literal name or a variable we must resolve. */
export type Ref = { literal: string } | { variable: string };
export type Mode = 'read' | 'write';

export interface ProgramFacts {
  programId: string;
  cics: boolean; // has EXEC CICS (an online program)
  copybooks: Map<string, number>; // COPY X and EXEC SQL INCLUDE X
  invocations: { kind: 'call' | 'link' | 'xctl'; ref: Ref }[];
  cicsFiles: { ref: Ref; mode: Mode }[];
  ddFiles: { fd: string; ddName: string; mode: Mode }[];
  sql: { table: string; mode: Mode }[];
  maps: Ref[];
  segments: { name: string; mode: Mode }[];
  queues: { ref: Ref; mode: Mode }[];
  /** var -> what is assigned to it: `L:<literal>` or `V:<other var>` (VALUE clauses and MOVEs). */
  assignments: Map<string, Set<string>>;
  /** every string literal, trimmed (fallback for unresolvable dynamic targets) */
  literals: Set<string>;
}

const FIGURATIVE = new Set([
  'SPACE', 'SPACES', 'ZERO', 'ZEROS', 'ZEROES', 'LOW-VALUE', 'LOW-VALUES', 'HIGH-VALUE', 'HIGH-VALUES',
  'QUOTE', 'QUOTES', 'FUNCTION', 'ALL', 'LENGTH', 'ADDRESS', 'CORRESPONDING', 'CORR',
]);
const SQL_SKIP = new Set(['SQLCA', 'SQLDA']);
const NAME = '[A-Z0-9][A-Z0-9-]*';

/** Splits on sentence-ending periods that are outside quotes. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === '.' && (i + 1 === text.length || text[i + 1] === ' ')) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function refFrom(raw: string): Ref {
  const q = raw.match(/^(['"])(.*)\1$/);
  if (q) return { literal: q[2].trim() };
  return { variable: raw.replace(/\(.*$/, '').trim() };
}

function addAssign(map: Map<string, Set<string>>, target: string, source: string) {
  if (!map.has(target)) map.set(target, new Set());
  map.get(target)!.add(source);
}

/** Argument of `KEYWORD(arg)` inside an EXEC block; keeps quotes so refFrom can tell literals. */
function arg(block: string, keyword: string): string | undefined {
  const m = block.match(new RegExp(`\\b${keyword}\\s*\\(\\s*((['"]).*?\\2|${NAME}(?:\\s*\\([^)]*\\))?)\\s*\\)`));
  return m?.[1];
}

export function extractCobol(expandedSource: string): ProgramFacts {
  const text = joinedText(cleanSource(expandedSource));
  const facts: ProgramFacts = {
    programId: text.match(new RegExp(`PROGRAM-ID\\.?\\s+['"]?(${NAME})`))?.[1] ?? '',
    cics: false,
    copybooks: new Map(),
    invocations: [],
    cicsFiles: [],
    ddFiles: [],
    sql: [],
    maps: [],
    segments: [],
    queues: [],
    assignments: new Map(),
    literals: new Set(),
  };

  for (const m of text.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    const lit = (m[1] ?? m[2]).trim();
    if (lit) facts.literals.add(lit);
  }
  for (const m of text.matchAll(new RegExp(`\\bCOPY\\s+['"]?(${NAME})`, 'g'))) {
    facts.copybooks.set(m[1], (facts.copybooks.get(m[1]) ?? 0) + 1);
  }

  // Data flow facts: VALUE clauses and MOVEs, sentence by sentence.
  const fdNames = new Map<string, string>(); // fd -> dd name
  for (const s of sentences(text)) {
    const value = s.match(new RegExp(`^(\\d{1,2})\\s+(${NAME})\\b.*?\\bVALUES?\\s+(?:IS\\s+|ARE\\s+)?(['"])(.*?)\\3`));
    if (value && value[1] !== '88' && value[2] !== 'FILLER') addAssign(facts.assignments, value[2], `L:${value[4].trim()}`);

    const select = s.match(new RegExp(`\\bSELECT\\s+(?:OPTIONAL\\s+)?(${NAME})\\s+ASSIGN\\s+(?:TO\\s+)?(['"]?)(${NAME})\\2`));
    if (select) fdNames.set(select[1], select[3].replace(/^(UT-)?S-|^AS-/, ''));

    for (const m of s.matchAll(/\bMOVE\s+(['"])(.*?)\1\s+TO\s+([A-Z0-9][A-Z0-9-]*)/g)) {
      addAssign(facts.assignments, m[3], `L:${m[2].trim()}`);
    }
    for (const m of s.matchAll(new RegExp(`\\bMOVE\\s+(${NAME})(?:\\s*\\([^)]*\\))?(?:\\s+(?:OF|IN)\\s+${NAME})*\\s+TO\\s+(${NAME})`, 'g'))) {
      if (!FIGURATIVE.has(m[1]) && !/^\d/.test(m[1])) addAssign(facts.assignments, m[2], `V:${m[1]}`);
    }
  }

  // Batch file opens: OPEN INPUT a b OUTPUT c ...
  const openModes = new Map<string, Mode>();
  for (const m of text.matchAll(/\bOPEN\s+((?:(?:INPUT|OUTPUT|I-O|EXTEND)\s+(?:[A-Z0-9][A-Z0-9-]*\s*)+)+)/g)) {
    let mode: Mode = 'read';
    for (const tok of m[1].split(/\s+/)) {
      if (tok === 'INPUT') mode = 'read';
      else if (tok === 'OUTPUT' || tok === 'I-O' || tok === 'EXTEND') mode = 'write';
      else if (fdNames.has(tok) && openModes.get(tok) !== 'write') openModes.set(tok, mode);
    }
  }
  for (const [fd, ddName] of fdNames) facts.ddFiles.push({ fd, ddName, mode: openModes.get(fd) ?? 'read' });

  // CALL statements outside EXEC blocks and outside string literals ('DLI CALL FAILED').
  const plain = text
    .replace(/EXEC\s+(CICS|SQL|DLI)\b[\s\S]*?END-EXEC/g, ' ')
    .replace(/(\bCALL\s+)?('[^']*'|"[^"]*")/g, (m, call: string | undefined) => (call ? m : ' '));
  for (const m of plain.matchAll(new RegExp(`(?<![A-Z0-9-])CALL\\s+((['"])${NAME}\\2|${NAME})`, 'g'))) {
    facts.invocations.push({ kind: 'call', ref: refFrom(m[1]) });
  }

  facts.cics = execBlocks(text, 'CICS').length > 0;
  for (const b of execBlocks(text, 'CICS')) {
    const verb = b.split(' ')[0];
    if (verb === 'XCTL' || verb === 'LINK') {
      const p = arg(b, 'PROGRAM');
      if (p) facts.invocations.push({ kind: verb === 'XCTL' ? 'xctl' : 'link', ref: refFrom(p) });
    } else if (/^(READ|READNEXT|READPREV|STARTBR)$/.test(verb) || /^(WRITE|REWRITE|DELETE)$/.test(verb)) {
      const f = arg(b, 'FILE') ?? arg(b, 'DATASET');
      if (f) facts.cicsFiles.push({ ref: refFrom(f), mode: /^(WRITE|REWRITE|DELETE)$/.test(verb) ? 'write' : 'read' });
    } else if ((verb === 'SEND' || verb === 'RECEIVE') && /^\w+ MAP\b/.test(b)) {
      const ms = arg(b, 'MAPSET') ?? arg(b, 'MAP');
      if (ms) facts.maps.push(refFrom(ms));
    }
  }

  for (const b of execBlocks(text, 'SQL')) {
    const inc = b.match(new RegExp(`^INCLUDE\\s+(${NAME})`));
    if (inc) {
      if (!SQL_SKIP.has(inc[1])) facts.copybooks.set(inc[1], (facts.copybooks.get(inc[1]) ?? 0) + 1);
      continue;
    }
    const write = /^(INSERT|UPDATE|DELETE)\b/.test(b);
    const tableRe = /\b(FROM|JOIN|INTO|UPDATE)\s+([A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)?)/g;
    for (const m of b.matchAll(tableRe)) {
      if (m[1] === 'INTO' && !/^INSERT\b/.test(b)) continue; // SELECT ... INTO :host
      facts.sql.push({ table: m[2], mode: write ? 'write' : 'read' });
    }
  }

  for (const b of execBlocks(text, 'DLI')) {
    const verb = b.split(' ')[0];
    const write = /^(ISRT|REPL|DLET)$/.test(verb);
    for (const m of b.matchAll(new RegExp(`\\bSEGMENT\\s*\\(\\s*['"]?(${NAME})['"]?\\s*\\)`, 'g'))) {
      facts.segments.push({ name: m[1], mode: write ? 'write' : 'read' });
    }
  }

  // MQ: queue names flow into a *OBJECTNAME field; puts mean the program writes.
  const callsMq = facts.invocations.some((i) => 'literal' in i.ref && /^MQ(OPEN|PUT1?|GET)$/.test(i.ref.literal));
  if (callsMq) {
    const puts = facts.invocations.some((i) => 'literal' in i.ref && /^MQPUT1?$/.test(i.ref.literal));
    for (const [target, sources] of facts.assignments) {
      if (!/OBJECTNAME$/.test(target)) continue;
      for (const s of sources) {
        facts.queues.push({ ref: s.startsWith('L:') ? { literal: s.slice(2) } : { variable: s.slice(2) }, mode: puts ? 'write' : 'read' });
      }
    }
  }
  return facts;
}

export interface Resolution {
  values: string[];
  confidence: 'literal' | 'resolved' | 'heuristic' | 'unresolved';
}

/**
 * Resolves a reference to literal names. Variables follow VALUE/MOVE chains. If a variable
 * has no literal source at all, fall back to every literal in the program that `accept`s
 * (e.g. is a known program name): low confidence, but catches table-driven menus.
 */
export function resolveRef(
  ref: Ref,
  facts: ProgramFacts,
  accept: (name: string) => boolean,
  guess = true,
): Resolution {
  if ('literal' in ref) return { values: [ref.literal], confidence: 'literal' };
  const found = new Set<string>();
  const seen = new Set<string>();
  const stack = [ref.variable];
  while (stack.length) {
    const v = stack.pop()!;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const s of facts.assignments.get(v) ?? []) {
      if (s.startsWith('L:')) found.add(s.slice(2));
      else stack.push(s.slice(2));
    }
  }
  const values = [...found].filter(accept).sort();
  if (values.length) return { values, confidence: 'resolved' };
  const guesses = guess ? [...facts.literals].filter(accept).sort() : [];
  return guesses.length ? { values: guesses, confidence: 'heuristic' } : { values: [], confidence: 'unresolved' };
}
