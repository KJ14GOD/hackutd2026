// `npx tsx services/context/src/cli.ts [--programs A,B]`: gathers Jira, Notion and Slack live, resolves every
// Part 2 question, and writes out/context/resolutions.json. LLM_PROVIDER=nvidia calls Nemotron (cached);
// LLM_PROVIDER=replay and REST_MODE=replay rerun everything offline.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProvider } from '../../../packages/llm/src/index';
import { loadConfig } from '../../../packages/shared/src/config';
import { createHttp } from '../../people/src/http';
import { scopeIndex } from '../../people/src/scopes';
import type { Org } from '../../people/src/types';
import type { Part2 } from '../../reader/src/contract';
import { stableJson } from '../../segmenter/src/pass1';
import type { Pass1 } from '../../segmenter/src/types';
import { jiraDocs, notionDocs, slackDocs } from './corpus';
import { runContext } from './index';
import type { Doc } from './types';

const ROOT = resolve(import.meta.dirname, '../../..');
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* environment only */ }
const env = process.env;
const args = process.argv.slice(2);
const programs = args[args.indexOf('--programs') + 1] && args.includes('--programs') ? args[args.indexOf('--programs') + 1].split(',') : undefined;

const config = loadConfig();
const read = <T>(f: string) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')) as T;
const pass1 = read<Pass1>('out/pass1.json');
const part2 = read<Part2>('out/part2.json');
const org = read<Org>('out/people/org.json');
const http = createHttp({ cacheDir: resolve(ROOT, '.cache/rest'), mode: env.REST_MODE === 'replay' ? 'replay' : 'live' });
const index = scopeIndex(pass1);

const docs: Doc[] = [];
const gather = async (name: string, ready: boolean, get: () => Promise<Doc[]>) => {
  if (!ready) { console.log(`  ${name}: SKIPPED, no key in .env`); return; }
  try { const d = await get(); docs.push(...d); console.log(`  ${name}: ${d.length} documents (live)`); } catch (err) {
    console.log(`  ${name}: SKIPPED, ${err instanceof Error ? err.message.slice(0, 120) : err}`);
  }
};
await gather('jira', !!(env.JIRA_SITE && env.JIRA_EMAIL && env.JIRA_API_TOKEN), () => jiraDocs(http, index, { site: env.JIRA_SITE!, email: env.JIRA_EMAIL!, token: env.JIRA_API_TOKEN!, project: env.JIRA_PROJECT ?? 'CARD' }));
await gather('notion', !!env.NOTION_TOKEN, () => notionDocs(http, index, env.NOTION_TOKEN!));
await gather('slack', !!env.SLACK_BOT_TOKEN, () => slackDocs(http, index, env.SLACK_BOT_TOKEN!));

const provider = createProvider({ cacheDir: resolve(ROOT, config.llm.cacheDir), requestsPerMinute: config.llm.requestsPerMinute });
const run = await runContext({ part2, org, docs, provider, root: resolve(ROOT, 'legacy/carddemo'), programs, concurrency: config.requirements.context.concurrency, maxDocs: config.requirements.context.maxDocsPerQuestion });
mkdirSync(resolve(ROOT, 'out/context'), { recursive: true });
writeFileSync(resolve(ROOT, 'out/context/resolutions.json'), stableJson(run));

const count = (v: string) => run.resolutions.filter((r) => r.verdict === v).length;
console.log(`${run.resolutions.length} questions: ${count('answered')} answered, ${count('conflict')} conflict, ${count('known-issue')} known issue, ${count('not-found')} not found; ${run.resolutions.filter((r) => r.route).length} routed to a person; Nemotron calls ${provider.networkCalls}`);
for (const r of run.resolutions) console.log(`${r.questionId.padEnd(12)} ${r.verdict.padEnd(11)} ${r.route ? `-> ${r.route.name}` : ''}${r.quotes[0] ? `  [${r.quotes[0].title.slice(0, 50)}]` : ''}`);
console.log('wrote out/context/resolutions.json');
