// Turns raw COBOL text into clean logical lines: sequence areas and comments removed,
// continuation lines joined. Handles fixed format (cols 1-6 sequence, 7 indicator,
// 8-72 code, 73+ ignored) and free format (`*>` comments). Pure.

export interface CleanLine {
  no: number; // 1-based line number in the original file
  text: string; // code only, uppercased, trailing spaces trimmed
}

const FREE_FORMAT = />>\s*SOURCE\s+(FORMAT\s+)?(IS\s+)?FREE/i;

export function isFreeFormat(src: string): boolean {
  return FREE_FORMAT.test(src.slice(0, 2000));
}

export function cleanSource(src: string): CleanLine[] {
  const raw = src.replace(/\r\n?/g, '\n').split('\n');
  const free = isFreeFormat(src);
  const out: CleanLine[] = [];
  raw.forEach((line, i) => {
    const no = i + 1;
    if (free) {
      const code = line.replace(/\*>.*$/, '').trimEnd();
      if (code.trim() && !/^\s*>>/.test(code)) out.push({ no, text: code.toUpperCase() });
      return;
    }
    if (line.length < 7) return;
    const indicator = line[6];
    if (indicator === '*' || indicator === '/' || indicator === 'D' || indicator === 'd') return;
    const code = line.slice(7, 72).replace(/\*>.*$/, '').trimEnd();
    if (!code.trim()) return;
    if (indicator === '-' && out.length > 0) {
      // Continuation: a literal continues after the first quote on this line.
      const prev = out[out.length - 1];
      const cont = code.trimStart();
      const joined = /^['"]/.test(cont) ? prev.text.replace(/\s+$/, '') + cont.slice(1) : prev.text + ' ' + cont;
      prev.text = joined.toUpperCase();
      return;
    }
    out.push({ no, text: code.toUpperCase() });
  });
  return out;
}

/** Lines that count as code (for LOC). */
export function countLoc(src: string): number {
  return cleanSource(src).length;
}

/**
 * Joins clean lines into one string with single spaces, keeping a map back to line numbers
 * is unnecessary for our facts, so this is all the extractor needs for multi-line statements.
 */
export function joinedText(lines: CleanLine[]): string {
  return lines.map((l) => l.text.trim()).join(' ');
}

/** Every `EXEC <kind> ... END-EXEC` block, whitespace-collapsed. */
export function execBlocks(text: string, kind: 'CICS' | 'SQL' | 'DLI'): string[] {
  const re = new RegExp(`EXEC\\s+${kind}\\b([\\s\\S]*?)END-EXEC`, 'g');
  const out: string[] = [];
  for (const m of text.matchAll(re)) out.push(m[1].replace(/\s+/g, ' ').trim());
  return out;
}
