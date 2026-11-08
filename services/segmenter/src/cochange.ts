// Co-change: programs edited in the same commit are probably related. Weak signal, so it gets
// a small weight. Big commits (reformatting, bulk renames) are skipped.
import { execFileSync } from 'node:child_process';
import type { GraphEdge } from './segmentTypes';

/** Pure: commits (each a list of paths) -> cochange edges between known nodes. */
export function cochangeEdges(
  commits: string[][],
  nodeForPath: (path: string) => string | undefined,
  opt: { maxFilesPerCommit: number; minCount: number },
): GraphEdge[] {
  const counts = new Map<string, number>();
  for (const files of commits) {
    if (files.length > opt.maxFilesPerCommit) continue;
    const ids = [...new Set(files.map(nodeForPath).filter((x): x is string => !!x))].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .filter(([, n]) => n >= opt.minCount)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => {
      const [src, dst] = key.split('|');
      return { src, dst, kind: 'cochange', count, confidence: 'extracted' as const, detail: `${count} commits`, evidence: 'git log' };
    });
}

/** Reads `git log --name-only` for a checkout. Returns [] when there is no usable history. */
export function readCommits(repoDir: string): string[][] {
  let out: string;
  try {
    out = execFileSync('git', ['-C', repoDir, 'log', '--no-merges', '--name-only', '--format=%x00'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  return out
    .split('\0')
    .map((block) => block.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((files) => files.length > 0);
}
