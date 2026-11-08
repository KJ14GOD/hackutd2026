// Record layouts and the values the code tests for, read from a program and its copybooks.
// Scenarios use them to build records that push the program down its other branches.
import { normalizeLines } from '../../segmenter/src/inventory';

export interface Field {
  name: string;
  offset: number;
  length: number;
  /** 'x' text, 'num' zoned digits as text, 'packed'/'binary' (not editable in a text file). */
  kind: 'x' | 'num' | 'packed' | 'binary';
  digits: number;
  scale: number;
  signed: boolean;
}

interface Item { level: number; name: string; pic?: string; usage: string; occurs: number; redefines?: string; children: Item[] }

/** Program text with every COPY replaced by the copybook, as code-area lines. */
export function expandCopies(text: string, copybooks: Map<string, string>, depth = 0): string[] {
  const out: string[] = [];
  for (const l of normalizeLines(text)) {
    const m = /^\s*COPY\s+['"]?([A-Z0-9#@$-]+)['"]?/.exec(l.text);
    const book = m && copybooks.get(m[1]);
    if (book && depth < 5) out.push(...expandCopies(book, copybooks, depth + 1));
    else out.push(l.text);
  }
  return out;
}

/** Display length and digit count of a PICTURE string like S9(9)V99 or X(50). */
function picSize(pic: string) {
  let len = 0, digits = 0, scale = 0, afterV = false;
  for (const m of pic.matchAll(/([A-Z9*+\-,./$])(?:\((\d+)\))?/g)) {
    const [, ch, n] = m;
    const count = n ? Number(n) : 1;
    if (ch === 'S') continue;
    if (ch === 'V') { afterV = true; continue; }
    len += count;
    if (ch === '9') { digits += count; if (afterV) scale += count; }
  }
  return { len, digits, scale, signed: pic.startsWith('S') };
}

function parseItems(lines: string[]): Item[] {
  const statements = lines.join(' ').split(/\.(?=\s|$)/).map((s) => s.trim()).filter(Boolean);
  const roots: Item[] = [];
  const stack: Item[] = [];
  for (const s of statements) {
    const m = /^(\d{1,2})\s+([A-Z0-9-]+)?(.*)$/.exec(s);
    if (!m) continue;
    const level = Number(m[1]);
    if (level === 88 || level === 66) continue;
    const rest = m[3] ?? '';
    const name = m[2] && !/^(PIC|PICTURE|VALUE|REDEFINES|OCCURS|COMP)/.test(m[2]) ? m[2] : 'FILLER';
    const item: Item = {
      level, name, children: [],
      pic: /\bPIC(?:TURE)?\s+(?:IS\s+)?(\S+)/.exec(rest)?.[1],
      usage: /\b(COMP-3|COMPUTATIONAL-3|PACKED-DECIMAL)\b/.test(rest) ? 'packed' : /\b(COMP|COMP-4|COMP-5|BINARY|COMPUTATIONAL)\b/.test(rest) ? 'binary' : 'display',
      occurs: Number(/\bOCCURS\s+(\d+)/.exec(rest)?.[1] ?? 1),
      redefines: /\bREDEFINES\s+([A-Z0-9-]+)/.exec(rest)?.[1],
    };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length && level !== 1 && level !== 77) stack[stack.length - 1].children.push(item);
    else roots.push(item);
    stack.push(item);
  }
  return roots;
}

function size(item: Item): number {
  if (item.children.length) {
    let total = 0;
    for (const c of item.children) if (!c.redefines) total += size(c);
    return total * item.occurs;
  }
  if (!item.pic) return 0;
  const p = picSize(item.pic);
  const one = item.usage === 'packed' ? Math.floor(p.digits / 2) + 1 : item.usage === 'binary' ? (p.digits <= 4 ? 2 : p.digits <= 9 ? 4 : 8) : p.len;
  return one * item.occurs;
}

/** Total bytes of a record (group sizes, OCCURS and REDEFINES included), or 0 when it isn't defined. */
export function recordLength(lines: string[], record: string): number {
  const find = (items: Item[]): Item | undefined => {
    for (const i of items) { if (i.name === record) return i; const f = find(i.children); if (f) return f; }
  };
  const root = find(parseItems(lines));
  return root ? size(root) : 0;
}

/** Elementary fields of a record, with their offsets. Repeated fields list their first copy only. */
export function layoutOf(lines: string[], record: string): Field[] {
  const find = (items: Item[]): Item | undefined => {
    for (const i of items) { if (i.name === record) return i; const f = find(i.children); if (f) return f; }
  };
  const root = find(parseItems(lines));
  if (!root) return [];
  const fields: Field[] = [];
  const starts = new Map<string, number>();
  const walk = (item: Item, offset: number) => {
    starts.set(item.name, offset);
    if (!item.children.length) {
      if (!item.pic || item.name === 'FILLER') return;
      const p = picSize(item.pic);
      const kind = item.usage === 'packed' ? 'packed' : item.usage === 'binary' ? 'binary' : /9/.test(item.pic) && !/X|A/.test(item.pic) ? 'num' : 'x';
      fields.push({ name: item.name, offset, length: size({ ...item, occurs: 1 }), kind, digits: p.digits, scale: p.scale, signed: p.signed });
      return;
    }
    let at = offset;
    for (const c of item.children) {
      const start = c.redefines ? starts.get(c.redefines) ?? at : at;
      walk(c, start);
      if (!c.redefines) at += size(c);
    }
  };
  walk(root, 0);
  return fields;
}

/** The working-storage record a file is read INTO, or the file's own record. */
export function recordReadFrom(lines: string[], file: string, fdRecord: string): string {
  const joined = lines.join(' ');
  return new RegExp(`\\bREAD\\s+${file}\\b[^.]*?\\bINTO\\s+([A-Z0-9-]+)`).exec(joined)?.[1] ?? fdRecord;
}

/** Literal values the procedure division compares a field (or its 88-level names' parent) with. */
export function testedValues(lines: string[], fields: Field[]): Map<string, string[]> {
  const proc = lines.join('\n').split(/\bPROCEDURE\s+DIVISION\b/)[1] ?? '';
  const names = new Set(fields.map((f) => f.name));
  const out = new Map<string, Set<string>>();
  const add = (name: string, v: string) => { if (!out.has(name)) out.set(name, new Set()); out.get(name)!.add(v); };
  for (const m of proc.matchAll(/\bIF\s+([A-Z0-9-]+)\s+(?:NOT\s+)?(?:=|EQUAL(?:\s+TO)?)\s+'([^']*)'/g)) if (names.has(m[1])) add(m[1], m[2]);
  for (const m of proc.matchAll(/\bEVALUATE\s+([A-Z0-9-]+)([\s\S]*?)\bEND-EVALUATE\b/g)) {
    if (!names.has(m[1])) continue;
    for (const w of m[2].matchAll(/\bWHEN\s+'([^']*)'/g)) add(m[1], w[1]);
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

const POS = '{ABCDEFGHI', NEG = '}JKLMNOPQR';

/** Writes a number into a zoned field the way mainframe text files store it (sign in the last digit). */
export function zoned(field: Field, value: number): string {
  const n = Math.round(Math.abs(value) * 10 ** field.scale);
  const digits = String(n).padStart(field.digits, '0').slice(-field.digits);
  if (!field.signed) return digits;
  const last = Number(digits[digits.length - 1]);
  return digits.slice(0, -1) + (value < 0 ? NEG : POS)[last];
}

export function setField(record: string, f: Field, value: string): string {
  const padded = record.padEnd(f.offset + f.length, ' ');
  return padded.slice(0, f.offset) + value.padEnd(f.length, ' ').slice(0, f.length) + padded.slice(f.offset + f.length);
}

/** A record with every field filled: text gets X's, numbers get zero. */
export function blankRecord(fields: Field[]): string {
  let r = '';
  for (const f of fields) r = setField(r, f, f.kind === 'num' ? zoned(f, 0) : f.kind === 'x' ? 'X'.repeat(f.length) : '\0'.repeat(f.length));
  return r;
}
