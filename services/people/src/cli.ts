// `npx tsx services/people/src/cli.ts`: builds the org from every source and writes out/people/org.json.
// REST_MODE=replay rebuilds it from cached API responses with no network.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../../../packages/shared/src/config';
import { runPass1, stableJson } from '../../segmenter/src/pass1';
import type { Pass1 } from '../../segmenter/src/types';
import { createHttp } from './http';
import { buildOrg } from './index';

const ROOT = resolve(import.meta.dirname, '../../..');
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* environment only */ }
const config = loadConfig();
const pass1File = resolve(ROOT, 'out/pass1.json');
const pass1: Pass1 = existsSync(pass1File) ? JSON.parse(readFileSync(pass1File, 'utf8')) : runPass1(resolve(ROOT, 'legacy/carddemo'));
const http = createHttp({ cacheDir: resolve(ROOT, '.cache/rest'), mode: process.env.REST_MODE === 'replay' ? 'replay' : 'live' });

const org = await buildOrg({ pass1, orgDir: resolve(ROOT, 'fixtures/org'), http, env: process.env, authority: config.requirements.authority, log: (l) => console.log(`  ${l}`) });
mkdirSync(resolve(ROOT, 'out/people'), { recursive: true });
writeFileSync(resolve(ROOT, 'out/people/org.json'), stableJson(org));

const name = (id: string) => org.people.find((p) => p.id === id)?.name ?? id;
console.log(`people ${org.people.length}, ownership links ${org.owns.length}, approvers ${org.approvers.length}, REST calls ${http.calls}`);
for (const prog of ['CBACT04C', 'CBTRN02C', 'COTRN02C', 'COBTUPDT']) {
  const list = org.approvers.filter((a) => a.target === `prog:${prog}`);
  const by = (c: string) => list.filter((a) => a.category === c).map((a) => `${a.name} ${a.score}`).join(', ') || 'none';
  console.log(`${prog.padEnd(9)} rules: ${by('business-rule')} | behavior: ${by('behavior')}`);
}
for (const s of org.successors.filter((x, i, a) => a.findIndex((y) => y.from === x.from && y.to === x.to) === i)) console.log(`successor: ${name(s.from)} -> ${name(s.to)} (${s.reason})`);
for (const m of org.identityMatches) console.log(`merge review: ${m.reason}`);
console.log('wrote out/people/org.json');
