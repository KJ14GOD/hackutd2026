// Fixes for source that GnuCOBOL rejects, applied to the sandbox's copy only (legacy/ is never edited).
// Every fix keeps the line count, so statement traces still point at the original lines, and each
// returns a note so the run says what was changed instead of hiding it.
import { fileDefs } from './cobolFiles';
import { expandCopies, layoutOf } from './layout';

export interface Patched {
  text: string;
  notes: string[];
}

const recordKey = (select: string) => /\bRECORD\s+KEY\s+(?:IS\s+)?([A-Z0-9-]+)/i.exec(select)?.[1]?.toUpperCase();
const defines = (lines: string[], name: string) => lines.some((l) => new RegExp(`^\\s*\\d{1,2}\\s+${name}\\b`).test(l));

/**
 * A RECORD KEY has to be a field of the file's own record. CBEXPORT and CBIMPORT name a
 * working-storage field instead (EXPORT-SEQUENCE-NUM from CVEXPORT), which no compiler accepts.
 * When the FD record is one plain `01 X PIC X(n).` line followed by a blank line, the record gets
 * a key field at the same offset as the field the code meant, and the SELECT points at it.
 */
function keyOutsideRecord(lines: string[], text: string, copybooks: Map<string, string>): string[] {
  const notes: string[] = [];
  const expanded = expandCopies(text, copybooks);
  for (const def of fileDefs(text).filter((d) => d.organization === 'indexed')) {
    const key = recordKey(def.select);
    if (!key || defines(expandCopies(def.fd, copybooks), key)) continue;

    // The record the code took the key from, and where the key sits inside it.
    const at = expanded.findIndex((l) => new RegExp(`^\\s*\\d{1,2}\\s+${key}\\b`).test(l));
    const owner = expanded.slice(0, at + 1).reverse().map((l) => /^\s*01\s+([A-Z0-9-]+)/.exec(l)?.[1]).find(Boolean);
    const field = owner && layoutOf(expanded, owner).find((f) => f.name === key);
    if (!field) continue;

    const recLine = lines.findIndex((l) => new RegExp(`^.{7}\\s*01\\s+${def.record}\\s+PIC(?:TURE)?\\s+X\\((\\d+)\\)\\.\\s*$`).test(l));
    const size = Number(/X\((\d+)\)/.exec(lines[recLine] ?? '')?.[1] ?? 0);
    const selLine = lines.findIndex((l) => new RegExp(`\\bRECORD\\s+KEY\\s+(?:IS\\s+)?${key}\\b`).test(l));
    if (recLine < 0 || selLine < 0 || lines[recLine + 1]?.trim() !== '' || field.offset + field.length > size) continue;

    const name = `THESEUS-${def.dd}-KEY`;
    const before = field.offset ? ` 05 FILLER PIC X(${field.offset}).` : '';
    const after = size - field.offset - field.length;
    const patched = [
      `       01  ${def.record}.${before}`,
      `           05 ${name} PIC X(${field.length}).${after ? ` 05 FILLER PIC X(${after}).` : ''}`,
      lines[selLine].replace(new RegExp(`(RECORD\\s+KEY\\s+(?:IS\\s+)?)${key}\\b`), `$1${name}`),
    ];
    if (patched.some((l) => l.length > 72)) continue;
    [lines[recLine], lines[recLine + 1], lines[selLine]] = patched;
    notes.push(`${def.file}: RECORD KEY ${key} is in ${owner}, not the file's record; sandbox gave the record a key at the same offset (bytes ${field.offset + 1}-${field.offset + field.length})`);
  }
  return notes;
}

/** The program as the sandbox compiles it, or null when it needs no change. */
export function patchForGnuCobol(text: string, copybooks: Map<string, string>): Patched | null {
  const lines = text.split(/\r?\n/);
  const notes = keyOutsideRecord(lines, text, copybooks);
  return notes.length ? { text: lines.join('\n'), notes } : null;
}
