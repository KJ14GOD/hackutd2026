import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReplayMiss, createProvider } from './index';

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('llm provider', () => {
  it('records with nvidia, then replays the same answer with zero network calls', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-'));
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), { status: 200 });
    }) as typeof fetch;
    const live = createProvider({ cacheDir: dir, env: { LLM_PROVIDER: 'nvidia', NVIDIA_API_KEY: 'test' }, fetchImpl: fakeFetch });
    expect((await live.complete({ role: 'strong', messages })).text).toBe('hello');
    expect(calls).toBe(1);

    const replay = createProvider({ cacheDir: dir, env: { LLM_PROVIDER: 'replay' } });
    const again = await replay.complete({ role: 'strong', messages });
    expect(again).toMatchObject({ text: 'hello', cached: true });
    expect(replay.networkCalls).toBe(0);
  });

  it('fails loudly on a replay miss instead of calling the network', async () => {
    const replay = createProvider({ cacheDir: mkdtempSync(join(tmpdir(), 'llm-')), env: { LLM_PROVIDER: 'replay' } });
    await expect(replay.complete({ role: 'fast', messages })).rejects.toBeInstanceOf(ReplayMiss);
    expect(replay.networkCalls).toBe(0);
  });

  it('retries server errors, not client errors', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      return calls < 2 ? new Response('busy', { status: 503 }) : new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    }) as typeof fetch;
    const p = createProvider({ cacheDir: mkdtempSync(join(tmpdir(), 'llm-')), env: { LLM_PROVIDER: 'nvidia', NVIDIA_API_KEY: 't' }, fetchImpl: flaky });
    expect((await p.complete({ role: 'fast', messages })).text).toBe('ok');
    expect(calls).toBe(2);
  });
});

it('plays a cached answer back in chunks to onChunk, and the chunks add up to the answer', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'llm-'));
  const mock = createProvider({ cacheDir: dir, env: { LLM_PROVIDER: 'mock' }, mock: () => 'x'.repeat(45) });
  const chunks: string[] = [];
  const r = await mock.complete({ role: 'strong', messages: [{ role: 'user', content: 'hi' }], onChunk: (t) => chunks.push(t) });
  expect(chunks.map((c) => c.length)).toEqual([20, 20, 5]);
  expect(chunks.join('')).toBe(r.text);
});
