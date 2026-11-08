// pnpm segment (src/segmentCli.ts) [--deps out/deps.json] [--legacy legacy/carddemo] [--out out/segmentation.json]
//              [--no-cochange] [--publish]
// Reads the dependency graph (docs/GRAPH_SCHEMA.md), writes the segmentation JSON, and with
// --publish loads it into SpacetimeDB. --legacy is the legacy git checkout the graph was
// extracted from: used for the commit id and for co-change history.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { findRepoRoot, loadConfig } from '@theseus/shared';
import { cochangeEdges, readCommits } from './cochange';
import { fromDeps, parseDeps } from './deps';
import { isCodeNode } from './project';
import { publishSegmentation } from './publish';
import { segment } from './segment';

const { values: args } = parseArgs({
  options: {
    deps: { type: 'string', default: 'out/deps.json' },
    legacy: { type: 'string', default: 'legacy/carddemo' },
    out: { type: 'string', default: 'out/segmentation.json' },
    'no-cochange': { type: 'boolean', default: false },
    publish: { type: 'boolean', default: false },
  },
});

const root = findRepoRoot();
const cfg = loadConfig().segmentation;
const depsPath = resolve(root, args.deps!);
if (!existsSync(depsPath)) {
  console.error(`No dependency graph at ${args.deps}. Produce one with: pnpm deps:extract (or the team extractor).`);
  process.exit(1);
}
const raw = readFileSync(depsPath, 'utf8');
let graph;
try {
  graph = fromDeps(parseDeps(JSON.parse(raw)));
} catch (e) {
  console.error(`${args.deps} does not match docs/GRAPH_SCHEMA.md:\n${(e as Error).message}`);
  process.exit(1);
}

const legacyDir = resolve(root, args.legacy!);
const git = (...a: string[]) => execFileSync('git', ['-C', legacyDir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
let ref = 'unknown';
try {
  ref = git('rev-parse', 'HEAD');
} catch {
  graph.warnings.push(`${args.legacy} is not a git checkout: no commit id, no co-change`);
}

if (!args['no-cochange'] && ref !== 'unknown') {
  // deps.json paths are relative to the legacy repo root, like git's.
  const byPath = new Map(graph.nodes.filter((n) => isCodeNode(n)).map((n) => [n.path, n.id]));
  const commits = readCommits(legacyDir);
  if (commits.length < 2) graph.warnings.push('no git history for co-change (run pnpm legacy:fetch --force)');
  graph.edges.push(...cochangeEdges(commits, (p) => byPath.get(p), cfg.cochange));
  graph.edges.sort((a, b) => `${a.src}|${a.dst}|${a.kind}`.localeCompare(`${b.src}|${b.dst}|${b.kind}`));
}

const result = segment(graph, cfg, {
  root: relative(root, legacyDir).replace(/\\/g, '/'),
  ref,
  deps: relative(root, depsPath).replace(/\\/g, '/'),
  depsHash: createHash('sha256').update(raw).digest('hex').slice(0, 16),
});
const outPath = resolve(root, args.out!);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');

const m = result.metrics;
console.log(`segmented ${result.source.deps} (${result.source.root} @ ${ref.slice(0, 12)}) -> ${relative(root, outPath)}`);
console.log(
  `  ${m.nodes} nodes, ${m.edges} edges, ${m.programs} programs -> ${m.pockets} pockets in ${m.domains} domains` +
    ` | modularity ${m.modularity} | cross-pocket weight ${(m.crossPocketWeightShare * 100).toFixed(1)}%` +
    ` | unresolved refs ${m.unresolved} | unused edges ${m.ignoredEdges}`,
);
console.table(
  result.pockets
    .filter((p) => p.level === 'pocket')
    .map((p) => ({
      pocket: p.id,
      domain: p.parentId,
      name: p.name.slice(0, 32),
      programs: p.programs,
      loc: p.loc,
      isolation: p.isolation,
      flags: [p.oversized ? 'oversized' : '', p.kind === 'shared' ? 'shared' : ''].filter(Boolean).join(' '),
    })),
);
if (result.warnings.length) {
  console.log(`${result.warnings.length} warnings (full list in the JSON):`);
  for (const w of result.warnings.slice(0, 8)) console.log(`  - ${w}`);
}

if (args.publish) {
  await publishSegmentation(result);
  console.log(`loaded into SpacetimeDB database "${process.env.STDB_DB ?? 'theseus'}"`);
}
process.exit(0);
