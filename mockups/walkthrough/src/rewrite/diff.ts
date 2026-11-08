// Line diff for the fix pass: which lines javac's complaint removed and which the model added.
// Plain LCS over lines; files here are a few hundred lines, so O(n·m) is fine.

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string; no?: number };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length, m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0, no = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i], no: no++ }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: 'del', text: a[i] }); i++; }
    else { out.push({ kind: 'add', text: b[j], no: no++ }); j++; }
  }
  while (i < n) { out.push({ kind: 'del', text: a[i++] }); }
  while (j < m) { out.push({ kind: 'add', text: b[j++], no: no++ }); }
  return out;
}

/** The diff trimmed to changed hunks with a little context, so a one-line fix is one small block. */
export function hunks(lines: DiffLine[], context = 3): DiffLine[][] {
  const changed = lines.map((l) => l.kind !== 'same');
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) if (changed[i]) for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  const out: DiffLine[][] = [];
  let cur: DiffLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) cur.push(lines[i]);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}
