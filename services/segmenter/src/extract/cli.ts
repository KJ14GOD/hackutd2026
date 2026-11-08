// pnpm deps:extract [--src legacy/carddemo/app] [--out out/deps.json]
// Writes the dependency graph in the team format (docs/GRAPH_SCHEMA.md). File paths in it are
// relative to the legacy repo root (app/cbl/X.cbl), like the Python prototype's.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { findRepoRoot } from '@theseus/shared';
import { extractDeps } from './graph';
import { scanSources } from './scan';

const { values: args } = parseArgs({
  options: {
    src: { type: 'string', default: 'legacy/carddemo/app' },
    out: { type: 'string', default: 'out/deps.json' },
  },
});

const root = findRepoRoot();
const srcDir = resolve(root, args.src!);
if (!existsSync(srcDir)) {
  console.error(`No source at ${args.src}. For CardDemo run: pnpm legacy:fetch`);
  process.exit(1);
}
let legacyRoot = srcDir;
try {
  legacyRoot = execFileSync('git', ['-C', srcDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
} catch {
  // not a git checkout: paths are relative to --src
}

const deps = extractDeps(scanSources(srcDir, legacyRoot));
const outPath = resolve(root, args.out!);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(deps, null, 2) + '\n');
console.log(`extracted ${relative(root, srcDir)} -> ${relative(root, outPath)}`);
console.log(`  nodes ${JSON.stringify(deps.counts)}`);
console.log(`  edges ${JSON.stringify(deps.edge_counts)}`);
console.log(`  unresolved ${deps.unresolved.length}`);
