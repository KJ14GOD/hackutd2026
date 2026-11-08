// `npx tsx services/rewrite/src/cli.ts CBACT04C [...]`: rewrites and shadows programs against the Runtime run in
// .sandbox (from `npx tsx services/runtime/src/cli.ts`), writing out/rewrite/<program>.json.
// LLM_PROVIDER=nvidia calls Nemotron (cached); LLM_PROVIDER=replay reruns from the cache.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProvider } from '../../../packages/llm/src/index';
import { loadConfig } from '../../../packages/shared/src/config';
import type { Part2 } from '../../reader/src/contract';
import { stableJson } from '../../segmenter/src/pass1';
import type { Pass1 } from '../../segmenter/src/types';
import { rewrite } from './rewrite';

const ROOT = resolve(import.meta.dirname, '../../..');
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* environment only */ }
const config = loadConfig();
const programs = process.argv.slice(2).map((p) => p.toUpperCase());
const read = <T>(f: string) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')) as T;
const provider = createProvider({ cacheDir: resolve(ROOT, config.llm.cacheDir), requestsPerMinute: config.llm.requestsPerMinute });
mkdirSync(resolve(ROOT, 'out/rewrite'), { recursive: true });
for (const program of programs) {
  const r = await rewrite({
    program, root: resolve(ROOT, 'legacy/carddemo'), pass1: read<Pass1>('out/pass1.json'), part2: read<Part2>('out/part2.json'),
    runtimeDir: resolve(ROOT, '.sandbox'), workDir: resolve(ROOT, '.sandbox/rewrite', program), provider, maxCompileFixes: config.rewrite.maxCompileFixes, maxDiffFixes: config.rewrite.maxDiffFixes, maxOutputTokens: config.rewrite.maxOutputTokens,
    emit: (e) => {
      if (e.type === 'stage') console.log(`  [${e.stage}] ${e.message}`);
      if (e.type === 'compile_error') console.log(`  javac: ${e.text.split('\n').slice(0, 3).join(' | ')}`);
      if (e.type === 'diff') console.log(`  ${e.scenario.padEnd(18)} ${Math.round(e.matchRate * 100)}% (${e.matched}/${e.total})`);
    },
  });
  writeFileSync(resolve(ROOT, `out/rewrite/${program}.json`), stableJson(r));
  console.log(`${program}: ${r.status}${r.reason ? ` (${r.reason})` : ''}, match ${Math.round(r.matchRate * 100)}%, ${r.passes.length} passes, ${Math.round(r.ms / 1000)} s; mismatches ${JSON.stringify(r.byCategory)}`);
}
