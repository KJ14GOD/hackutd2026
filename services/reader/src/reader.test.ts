// The pieces added to make real Nemotron output usable: replies cut off at the token limit, record
// sizes computed by code instead of by the model, and the extra-context round trip.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createProvider, type CompleteRequest } from '../../../packages/llm/src/index';
import { runPass1 } from '../../segmenter/src/pass1';
import { recordSizes, withExtras, buildPacks } from './pack';
import { extractJson } from './read';
import { fetchExtras, runPart2 } from './part2';

const CARDDEMO = 'legacy/carddemo';
const app = `${CARDDEMO}/app`;

it('keeps the complete items of a reply cut off mid-object', () => {
  const cut = '{"findings":[{"kind":"rule","summary":"a","evidence":["x:1"]},{"kind":"defect","summ';
  const { value, truncated } = extractJson(cut) as { value: { findings: unknown[] }; truncated: boolean };
  expect(truncated).toBe(true);
  expect(value.findings).toHaveLength(1);
  expect(extractJson('```json\n{"findings":[]}\n```').truncated).toBe(false);
});

it('computes record sizes from PICTURE clauses, key fields included', () => {
  const books = new Map(['CVACT01Y', 'CVACT03Y', 'CVTRA01Y', 'CVTRA05Y', 'CVTRA06Y'].map((b) => [b, readFileSync(`${app}/cpy/${b}.cpy`, 'utf8')]));
  const sizes = recordSizes(readFileSync(`${app}/cbl/CBTRN02C.cbl`, 'utf8'), books);
  expect(sizes.find((s) => s.startsWith('ACCOUNT-FILE'))).toMatch(/= 300 bytes; read into ACCOUNT-RECORD = 300 bytes \(same size\)/);
  expect(sizes.find((s) => s.startsWith('TCATBAL-FILE'))).toMatch(/= 50 bytes; read into TRAN-CAT-BAL-RECORD = 50 bytes/);
});

it('fetches what the model asks for and makes those lines citable', () => {
  const pass1 = runPass1(CARDDEMO);
  const [pack] = buildPacks(pass1, CARDDEMO, 'CBACT04C', 24000);
  const extras = fetchExtras(pass1, CARDDEMO, [{ kind: 'program', id: 'CBTRN02C' }, { kind: 'file', id: '../../etc/passwd' }]);
  expect(extras[0].refs.some((r) => r.startsWith('app/cbl/CBTRN02C.cbl:'))).toBe(true);
  expect(extras[1].lines).toEqual(['not found in this codebase']);
  const bigger = withExtras(pack, extras);
  expect(bigger.text.indexOf('EXTRA program app/cbl/CBTRN02C.cbl')).toBeLessThan(bigger.text.indexOf('\nTASK\n'));
  expect(bigger.citable.has(extras[0].refs[0])).toBe(true);
});

it('asks once more with the requested context, then stops', async () => {
  const pass1 = runPass1(CARDDEMO);
  const seen: string[] = [];
  const provider = createProvider({
    cacheDir: '/nonexistent', env: { LLM_PROVIDER: 'mock' },
    mock: (req: CompleteRequest) => {
      const text = req.messages[1].content;
      seen.push(text.includes('EXTRA program') ? 'with-extra' : 'plain');
      return JSON.stringify({ findings: [], questions: [], needMore: [{ kind: 'program', id: 'CBTRN02C' }] });
    },
  });
  await runPart2({ pass1, root: CARDDEMO, provider, programs: ['CBACT04C'], maxPackTokens: 24000, maxOutputTokens: 1000, maxNeedMoreRounds: 1, concurrency: 1, maxExtraTokens: 6000 });
  expect(seen).toEqual(['plain', 'with-extra']);
});

it('caps extra context at the configured size', () => {
  const pass1 = runPass1(CARDDEMO);
  const [big] = fetchExtras(pass1, CARDDEMO, [{ kind: 'program', id: 'COACTUPC' }], 2000);
  expect(big.title).toMatch(/first \d+ of \d+ lines/);
  expect(big.lines.join('\n').length / 4).toBeLessThanOrEqual(2000);
});

it('keeps the findings when the request for more context is malformed', async () => {
  const { ModelOutputSchema } = await import('./contract');
  const out = ModelOutputSchema.parse({ findings: [{}], needMore: [{ kind: 'copybook', id: 'CVACT01Y' }, { kind: 'weird', id: 'x' }] });
  expect(out.findings).toHaveLength(1);
  expect(out.needMore).toEqual([{ kind: 'file', id: 'CVACT01Y' }]);
});
