// Finds legacy source files under a root and classifies them by extension.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

export interface SourceFile {
  path: string; // repo-relative, forward slashes
  name: string; // basename without extension, uppercased
  text: string;
}

export interface Sources {
  programs: SourceFile[];
  copybooks: SourceFile[];
  maps: SourceFile[];
  jcl: SourceFile[];
  procs: SourceFile[];
  csd: SourceFile[];
  asm: SourceFile[];
  psbs: SourceFile[];
}

const KIND_BY_EXT: Record<string, keyof Sources> = {
  '.cbl': 'programs',
  '.cob': 'programs',
  '.cpy': 'copybooks',
  '.dcl': 'copybooks',
  '.bms': 'maps',
  '.jcl': 'jcl',
  '.prc': 'procs',
  '.proc': 'procs',
  '.csd': 'csd',
  '.asm': 'asm',
  '.psb': 'psbs',
};

/** Directories that hold data or docs, never source. */
const SKIP_DIRS = new Set(['data', 'diagrams', 'samples', '.git', 'node_modules']);

export function scanSources(root: string, repoRoot: string): Sources {
  const out: Sources = { programs: [], copybooks: [], maps: [], jcl: [], procs: [], csd: [], asm: [], psbs: [] };
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRS.has(entry.toLowerCase())) walk(full);
        continue;
      }
      const kind = KIND_BY_EXT[extname(entry).toLowerCase()];
      if (!kind) continue;
      out[kind].push({
        path: relative(repoRoot, full).replace(/\\/g, '/'),
        name: basename(entry, extname(entry)).toUpperCase(),
        text: readFileSync(full, 'latin1'),
      });
    }
  };
  walk(root);
  return out;
}
