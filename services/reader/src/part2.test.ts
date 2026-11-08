// Acceptance for Part 2 (docs/SPEC_DEPENDENCY_PASSES.md §3.9), with a scripted model.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProvider, type CompleteRequest } from '../../../packages/llm/src/index';
import { runPass1, stableJson } from '../../segmenter/src/pass1';
import { buildPacks } from './pack';
import { runPart2 } from './part2';

const FIXTURE = join(__dirname, '..', '..', 'segmenter', 'fixtures', 'planted');
const pass1 = runPass1(FIXTURE);

/**
 * A scripted model: explains every connection it is shown, finds one real rule, and also tries
 * three things the reader must reject: a citation outside the pack, no citation, and a malformed finding.
 */
function scripted(req: CompleteRequest): string {
  const pack = req.messages[1].content;
  const ids = [...pack.matchAll(/^(C\d+) /gm)].map((m) => m[1]);
  const firstLine = /^(\S+:\d+)\| /m.exec(pack)![1];
  return '```json\n' + JSON.stringify({
    findings: [
      ...ids.map((id) => ({ kind: 'connection', ref: id, summary: `explains ${id}`, evidence: [firstLine], confidence: 'high' })),
      { kind: 'rule', summary: 'a real rule cited inside the pack', evidence: [firstLine], confidence: 'medium' },
      { kind: 'defect', summary: 'cites a line that is not in the pack', evidence: ['cbl/NOWHERE.cbl:99999'], confidence: 'low' },
      { kind: 'defect', summary: 'cites nothing at all', evidence: [], confidence: 'low' },
      { kind: 'vibes', summary: 'not a finding kind', evidence: [firstLine], confidence: 'high' },
    ],
    questions: [{ text: 'Is this behavior intended?', evidence: [firstLine], options: ['Keep old behavior', 'Fix it'], blocks: 'rewrite' }],
  }) + '\n```';
}

describe('Part 2 reader', () => {
  it('builds packs whose citable lines include the program and its copybooks', () => {
    const [pack] = buildPacks(pass1, FIXTURE, 'PLBATCH1', 24000);
    expect(pack.connections.length).toBeGreaterThan(10);
    expect([...pack.citable].some((c) => c.startsWith('cbl/PLBATCH1.cbl:'))).toBe(true);
    expect([...pack.citable].some((c) => c.startsWith('cpy/PLREC1.cpy:'))).toBe(true);
    expect(pack.text).toContain('C1 ');
  });

  it('splits an oversized program into packs that repeat the connections', () => {
    const packs = buildPacks(pass1, FIXTURE, 'PLBATCH1', 1);
    expect(packs.length).toBeGreaterThan(1);
    for (const p of packs) expect(p.text).toContain('CONNECTIONS');
  });

  it('explains every connection, keeps cited findings, and drops every uncited one', async () => {
    const provider = createProvider({ cacheDir: mkdtempSync(join(tmpdir(), 'p2-')), env: { LLM_PROVIDER: 'mock' }, mock: scripted });
    const out = await runPart2({ pass1, root: FIXTURE, provider, maxPackTokens: 24000, maxOutputTokens: 4096, maxNeedMoreRounds: 1, concurrency: 2, maxExtraTokens: 6000 });
    for (const r of out.results) expect(r.coverage).toMatchObject({ explained: r.coverage.connections, missing: [] });
    const all = out.results.flatMap((r) => r.findings);
    expect(all.every((f) => f.evidence.length > 0)).toBe(true);
    expect(all.filter((f) => f.kind === 'rule')).toHaveLength(out.results.length);
    const reasons = out.dropped.map((d) => d.reason);
    expect(reasons.filter((r) => r === 'bad-citation')).toHaveLength(out.results.length);
    expect(reasons.filter((r) => r === 'no-citation')).toHaveLength(out.results.length);
    expect(reasons.filter((r) => r === 'schema')).toHaveLength(out.results.length);
    expect(out.results.find((r) => r.program === 'PLONLN1')?.questions[0].id).toBe('PLONLN1-Q1');
    expect(out.notVerified.some((n) => n.kind === 'never-ran')).toBe(true);
  });

  it('flags data that is read but never written as a question about outside parties', async () => {
    const provider = createProvider({ cacheDir: mkdtempSync(join(tmpdir(), 'p2-')), env: { LLM_PROVIDER: 'mock' }, mock: scripted });
    const out = await runPart2({ pass1, root: FIXTURE, provider, programs: ['PLONLN1'], maxPackTokens: 24000, maxOutputTokens: 4096, maxNeedMoreRounds: 1, concurrency: 2, maxExtraTokens: 6000 });
    expect(out.crossProgram.some((f) => f.summary.startsWith('PL.INPUT is read'))).toBe(true);
  });

  it('replays from the cache with zero network calls and identical output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2-'));
    const fakeNvidia = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: CompleteRequest['messages'] };
      return new Response(JSON.stringify({ choices: [{ message: { content: scripted({ role: 'strong', messages: body.messages }) } }] }));
    }) as unknown as typeof fetch;
    const live = createProvider({ cacheDir: dir, env: { LLM_PROVIDER: 'nvidia', NVIDIA_API_KEY: 'test' }, fetchImpl: fakeNvidia });
    const first = await runPart2({ pass1, root: FIXTURE, provider: live, maxPackTokens: 24000, maxOutputTokens: 4096, maxNeedMoreRounds: 1, concurrency: 2, maxExtraTokens: 6000 });
    expect(live.networkCalls).toBeGreaterThan(0);

    const replay = createProvider({ cacheDir: dir, env: { LLM_PROVIDER: 'replay' } });
    const second = await runPart2({ pass1, root: FIXTURE, provider: replay, maxPackTokens: 24000, maxOutputTokens: 4096, maxNeedMoreRounds: 1, concurrency: 2, maxExtraTokens: 6000 });
    expect(replay.networkCalls).toBe(0);
    expect(stableJson({ ...second, model: '' })).toBe(stableJson({ ...first, model: '' }));
  });
});
