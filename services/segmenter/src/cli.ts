// `pnpm part1 [repo] [out]`: runs Part 1 on a codebase and writes pass1.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runPass1, stableJson } from './pass1';
import { SYSTEMS } from './types';

const repo = resolve(process.argv[2] ?? 'legacy/carddemo');
const out = resolve(process.argv[3] ?? 'out/pass1.json');
const started = Date.now();
const result = runPass1(repo);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, stableJson(result));

const bySystem = SYSTEMS.map((s) => [s, result.edges.filter((e) => e.system === s).length, result.touches.filter((t) => t.system === s).length] as const);
console.log(`pass1: ${result.inventory.programs.length} programs, ${result.inventory.copybooks.length} copybooks, ${result.inventory.jobs.length} jobs, ${result.nodes.length} nodes, ${result.edges.length} edges, ${result.unresolved.length} unresolved (${Date.now() - started} ms)`);
console.log('system        edges  programs');
for (const [s, e, t] of bySystem) console.log(`${s.padEnd(13)} ${String(e).padStart(5)}  ${String(t).padStart(8)}`);
if (result.missingInputs.length) console.log(`missing inputs: ${result.missingInputs.join(', ')}`);
if (result.inventory.unknown.length) console.log(`unclassified files: ${result.inventory.unknown.length}`);
console.log(`wrote ${out}`);
