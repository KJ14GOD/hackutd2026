// `npx tsx services/reader/src/cli.ts [repo] [--programs A,B] [--pack-only]`: reads programs with Nemotron
// and writes out/part2.json. --pack-only prints what Nemotron would be given, with no LLM call.
// LLM_PROVIDER=nvidia records every answer; LLM_PROVIDER=replay reruns from the cache with no network.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createProvider } from '../../../packages/llm/src/index';
import { loadConfig } from '../../../packages/shared/src/config';
import { runPass1, stableJson } from '../../segmenter/src/pass1';
import type { Pass1 } from '../../segmenter/src/types';
import type { Runtime } from '../../runtime/src/types';
import { buildPacks } from './pack';
import { runPart2 } from './part2';

const ROOT = resolve(import.meta.dirname, '../../..');
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* no .env: environment only */ }

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const repo = resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? resolve(ROOT, 'legacy/carddemo'));
const programs = flag('--programs')?.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
const out = resolve(ROOT, flag('--out') ?? 'out/part2.json');

const config = loadConfig();
const pass1File = resolve(ROOT, 'out/pass1.json');
let pass1: Pass1 = existsSync(pass1File) ? (JSON.parse(readFileSync(pass1File, 'utf8')) as Pass1) : runPass1(repo);
if (!pass1.nodes.some((n) => n.file && existsSync(resolve(repo, n.file)))) pass1 = runPass1(repo);

const runtimeFile = resolve(ROOT, 'out/runtime.json');
const runtime = existsSync(runtimeFile) ? (JSON.parse(readFileSync(runtimeFile, 'utf8')) as Runtime) : undefined;

if (args.includes('--pack-only')) {
  for (const p of programs ?? []) for (const pack of buildPacks(pass1, repo, p, config.part2.maxPackTokens, runtime)) {
    console.log(`===== pack ${p} part ${pack.part}/${pack.parts}: ~${pack.tokens} tokens, ${pack.connections.length} connections, ${pack.citable.size} citable lines =====`);
    console.log(pack.text);
  }
  process.exit(0);
}

const provider = createProvider({ cacheDir: resolve(ROOT, config.llm.cacheDir), requestsPerMinute: config.llm.requestsPerMinute });
console.log(`part2: ${programs?.join(', ') ?? `all ${pass1.inventory.programs.length} programs`} with provider ${provider.mode}`);
const result = await runPart2({
  pass1, runtime, root: repo, provider, programs, maxPackTokens: config.part2.maxPackTokens, maxOutputTokens: config.part2.maxOutputTokens,
  maxNeedMoreRounds: config.part2.maxNeedMoreRounds, concurrency: config.part2.concurrency, maxExtraTokens: config.part2.maxExtraTokens,
  onProgress: (p, done, total) => console.log(`  ${done}/${total} ${p}`),
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, stableJson(result));

const findings = result.results.flatMap((r) => r.findings);
const byKind = Object.entries(findings.reduce<Record<string, number>>((m, f) => ({ ...m, [f.kind]: (m[f.kind] ?? 0) + 1 }), {}));
const conns = result.results.reduce((s, r) => s + r.coverage.connections, 0);
const explained = result.results.reduce((s, r) => s + r.coverage.explained, 0);
console.log(`findings: ${findings.length} (${byKind.map(([k, n]) => `${k} ${n}`).join(', ')})`);
console.log(`questions: ${result.results.reduce((s, r) => s + r.questions.length, 0)}, cross-program: ${result.crossProgram.length}`);
console.log(`connections explained: ${explained}/${conns}, dropped: ${result.dropped.length}, network calls: ${provider.networkCalls}`);
console.log(`wrote ${out}`);
