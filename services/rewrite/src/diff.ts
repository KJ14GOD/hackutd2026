// Compares what COBOL printed with what the Java printed, line by line. Lines are aligned with a longest-common-
// subsequence, so one missing line doesn't make every later line a mismatch. Each unmatched pair is classified by
// code, never by a model: formatting (same after spacing and zero padding), rounding (same numbers within a cent),
// noise (only timestamps or generated ids differ), else logic.
import type { Mismatch, MismatchCategory, MismatchGroup } from './types';

/** Runtime lines that aren't the program's own output (our stubs, GnuCOBOL warnings). */
export function cleanCobolOutput(text: string): string[] {
  return text.split('\n').map((l) => l.replace(/\r$/, '').trimEnd())
    .filter((l, i, all) => !(l === '' && i === all.length - 1))
    .filter((l) => !l.startsWith('THESEUS-') && !l.startsWith('libcob:'));
}

export const cleanJavaOutput = (text: string) => text.split('\n').map((l) => l.replace(/\r$/, '').trimEnd()).filter((l, i, all) => !(l === '' && i === all.length - 1));

const TIMESTAMP = /\d{4}-\d{2}-\d{2}[-. T]\d{2}[.:]\d{2}[.:]\d{2}(?:\.\d{1,6})?/g;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const numbers = (s: string) => (s.match(/[-+]?\d+(?:\.\d+)?/g) ?? []).map(Number);

export function classify(old: string, now: string): MismatchCategory {
  if (!old || !now) return 'logic';
  if (squash(old) === squash(now) || squash(old).replace(/\b0+(\d)/g, '$1') === squash(now).replace(/\b0+(\d)/g, '$1')) return 'formatting';
  if (old.replace(TIMESTAMP, '<ts>') === now.replace(TIMESTAMP, '<ts>') && TIMESTAMP.test(old)) return 'noise';
  const [a, b] = [numbers(old), numbers(now)];
  const letters = (s: string) => s.replace(/[-+]?\d+(?:\.\d+)?/g, '#');
  if (a.length && a.length === b.length && letters(squash(old)) === letters(squash(now)) && a.every((x, i) => Math.abs(x - b[i]) <= 1 && x !== b[i] ? true : x === b[i])) return 'rounding';
  return 'logic';
}

/** Aligns two outputs and returns the matched count plus every mismatch. */
export function diffLines(scenario: string, expected: string[], actual: string[]): { matched: number; total: number; mismatches: Mismatch[] } {
  const n = expected.length, m = actual.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = expected[i] === actual[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const mismatches: Mismatch[] = [];
  let i = 0, j = 0, matched = 0;
  const gapOld: number[] = [], gapNew: number[] = [];
  const flush = () => {
    // Pair the lines in a gap position by position; leftovers are missing or extra lines.
    for (let k = 0; k < Math.max(gapOld.length, gapNew.length); k++) {
      const o = gapOld[k], w = gapNew[k];
      mismatches.push({ scenario, line: o !== undefined ? o + 1 : (gapOld[gapOld.length - 1] ?? i - 1) + 2, old: o !== undefined ? expected[o] : '', new: w !== undefined ? actual[w] : '', category: classify(o !== undefined ? expected[o] : '', w !== undefined ? actual[w] : '') });
    }
    gapOld.length = 0; gapNew.length = 0;
  };
  while (i < n || j < m) {
    if (i < n && j < m && expected[i] === actual[j]) { flush(); matched++; i++; j++; }
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) gapNew.push(j++);
    else gapOld.push(i++);
  }
  flush();
  return { matched, total: Math.max(n, m), mismatches };
}

const RANK: Record<MismatchCategory, number> = { logic: 4, rounding: 3, formatting: 2, noise: 1, baseline: 0 };
const shape = (s: string) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

/**
 * Groups mismatches by root cause: consecutive differing lines in a scenario form one block, and blocks whose
 * first differing line looks the same (digits ignored) are one cause, wherever they occur.
 */
export function groupMismatches(mismatches: Mismatch[]): MismatchGroup[] {
  const blocks: Mismatch[][] = [];
  for (const m of mismatches) {
    const last = blocks[blocks.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.scenario === m.scenario && m.line > 0 && prev.line > 0 && m.line - prev.line <= 1) last.push(m);
    else blocks.push([m]);
  }
  // A wrong exit code is the same cause as the first differing block in that scenario.
  for (const rc of blocks.filter((b) => b[0].line === 0)) {
    if (!rc.length) continue;
    const host = blocks.find((b) => b !== rc && b.length > 0 && b[0].line > 0 && b[0].scenario === rc[0].scenario);
    if (host) { host.push(...rc); rc.length = 0; }
  }
  const byKey = new Map<string, Mismatch[][]>();
  for (const b of blocks.filter((x) => x.length)) {
    const key = `${shape(b[0].old)}|${shape(b[0].new)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), b]);
  }
  return [...byKey.values()]
    .map((bs) => {
      const all = bs.flat();
      const first = bs[0][0];
      const category = all.reduce<MismatchCategory>((c, m) => (RANK[m.category] > RANK[c] ? m.category : c), 'baseline');
      return {
        id: '', category, lines: all.length, scenarios: [...new Set(all.map((m) => m.scenario))],
        cause: first.line === 0 ? `exit code: COBOL ${first.old}, Java ${first.new}` : `COBOL printed ${JSON.stringify(first.old || '(nothing)')} where the Java printed ${JSON.stringify(first.new || '(nothing)')}`,
        sample: { scenario: first.scenario, line: first.line, old: first.old, new: first.new },
      };
    })
    .sort((a, b) => b.lines - a.lines)
    .map((g, i) => ({ ...g, id: `M${i + 1}` }));
}

/** Mainframe sign overpunch after a digit: } and J-R mark negatives, A-I positives (z/OS reads them; GnuCOBOL on ASCII doesn't). */
export const overpunchCount = (text: string) => (text.match(/\d[}A-R]/g) ?? []).length;

/**
 * True when two printed lines differ only in a number's last digit or trailing sign: exactly what decoding an
 * overpunched sign differently produces. Same length, every differing position a digit or sign.
 */
export function onlySignOrLastDigit(old: string, now: string): boolean {
  if (!old || old.length !== now.length || old === now) return false;
  for (let k = 0; k < old.length; k++) {
    if (old[k] === now[k]) continue;
    const signPos = (old[k] === '+' || old[k] === '-') && (now[k] === '+' || now[k] === '-');
    const lastDigit = /\d/.test(old[k]) && /\d/.test(now[k]) && /[+-]/.test(old[k + 1] ?? '');
    if (!signPos && !lastDigit) return false;
  }
  return true;
}
