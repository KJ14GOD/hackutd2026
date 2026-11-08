// `pnpm runtime [program...]`: runs the batch programs in the GnuCOBOL sandbox and writes
// out/runtime.json. The UI runs the same thing from its Run button; this is for tests and CI.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runPass1, stableJson } from '../../segmenter/src/pass1';
import { runWitness } from './witness';

const root = resolve('legacy/carddemo');
const pass1 = runPass1(root);
const only = process.argv.slice(2);
const runtime = await runWitness(root, pass1, {
  workDir: resolve('.sandbox'),
  only: only.length ? only : undefined,
  emit: (e) => {
    if (e.type === 'stage') console.log(e.message);
    if (e.type === 'program' && e.status !== 'running') console.log(`${e.program.padEnd(9)} ${e.status}${e.reason ? `: ${e.reason}` : ''}`);
    if (e.type === 'scenario') console.log(`  ${e.scenario.label.padEnd(12)} ${e.scenario.outcome.padEnd(7)} rc=${e.scenario.returnCode} ${e.scenario.statementsRun} statements ${e.scenario.ms} ms`);
  },
});
mkdirSync('out', { recursive: true });
writeFileSync('out/runtime.json', stableJson(runtime));
console.log(JSON.stringify(runtime.summary));
