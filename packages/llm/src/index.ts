// Every LLM call in Theseus goes through here (CLAUDE.md, D-008).
//
//   LLM_PROVIDER=nvidia  calls the NVIDIA API and records every answer in the cache
//   LLM_PROVIDER=replay  answers only from the cache; a miss is an error, never a network call
//   LLM_PROVIDER=mock    answers from a function you pass in (tests)
//
// The cache key is a hash of the model and the messages, so the same prompt always gets the same answer.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Role = 'fast' | 'strong';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteRequest {
  role: Role;
  messages: ChatMessage[];
  maxTokens?: number;
  /**
   * Receives the answer as it's written: live calls stream from NVIDIA; cached and replayed answers are
   * played back in ~20-character chunks, so a replay looks like a live run. Not part of the cache key.
   */
  onChunk?: (text: string) => void;
}

export interface CompleteResult {
  text: string;
  model: string;
  cached: boolean;
}

export interface LlmProvider {
  readonly mode: 'nvidia' | 'replay' | 'mock';
  complete(req: CompleteRequest): Promise<CompleteResult>;
  /** Network calls made so far. Replay must keep this at 0. */
  readonly networkCalls: number;
}

export interface LlmEnv {
  LLM_PROVIDER?: string;
  NVIDIA_BASE_URL?: string;
  NVIDIA_API_KEY?: string;
  LLM_MODEL_FAST?: string;
  LLM_MODEL_STRONG?: string;
  LLM_FAST_BASE_URL?: string;
  LLM_FAST_API_KEY?: string;
}

export class ReplayMiss extends Error {
  constructor(public readonly key: string) {
    super(`replay cache has no answer for ${key}; run once with LLM_PROVIDER=nvidia to record it`);
  }
}

const DEFAULT_MODELS: Record<Role, string> = { fast: 'nvidia/nemotron-3.5-bolt-e4b', strong: 'nvidia/nemotron-3-ultra-550b-a55b' };

export function cacheKey(model: string, messages: ChatMessage[]): string {
  return createHash('sha256').update(JSON.stringify({ model, messages })).digest('hex').slice(0, 32);
}

function modelFor(role: Role, env: LlmEnv): string {
  return (role === 'fast' ? env.LLM_MODEL_FAST : env.LLM_MODEL_STRONG) || DEFAULT_MODELS[role];
}

function readCache(dir: string, key: string): CompleteResult | undefined {
  const file = join(dir, `${key}.json`);
  if (!existsSync(file)) return undefined;
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { text: string; model: string };
  return { text: saved.text, model: saved.model, cached: true };
}

function writeCache(dir: string, key: string, model: string, messages: ChatMessage[], text: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.json`), JSON.stringify({ model, messages, text }, null, 2));
}

export interface ProviderOptions {
  cacheDir: string;
  env?: LlmEnv;
  /** For LLM_PROVIDER=mock: produces the answer for a request. */
  mock?: (req: CompleteRequest) => string;
  /** Overridable for tests. */
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  /** Per-call limit; a call that takes longer is abandoned and retried. */
  timeoutMs?: number;
  /** Spaces network calls so a run stays under the account's per-minute limit. Cached answers aren't counted. */
  requestsPerMinute?: number;
  /** Pause between chunks when playing back a cached answer to onChunk (default 12 ms). */
  replayChunkDelayMs?: number;
}

/** Plays a finished answer back in small chunks, the size a live stream arrives in. */
async function playBack(text: string, onChunk: (t: string) => void, delayMs: number) {
  for (let i = 0; i < text.length; i += 20) {
    onChunk(text.slice(i, i + 20));
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
}

/** Reads an OpenAI-style server-sent stream, passing each content delta on and returning the whole text. */
async function readStream(res: Response, onChunk: (t: string) => void): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '', buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.replace(/^data:\s*/, '').trim();
      if (!line.startsWith('data:') || !data || data === '[DONE]') continue;
      try {
        const piece = (JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] }).choices?.[0]?.delta?.content;
        if (piece) { text += piece; onChunk(piece); }
      } catch { /* a keep-alive or partial line */ }
    }
  }
  return text;
}

export function createProvider(opts: ProviderOptions): LlmProvider {
  const env = opts.env ?? (process.env as LlmEnv);
  const mode = (env.LLM_PROVIDER ?? 'mock') as LlmProvider['mode'];
  const doFetch = opts.fetchImpl ?? fetch;
  let networkCalls = 0;
  // Each network call waits for its turn: one start every 60s / requestsPerMinute, shared by all callers.
  let nextSlot = 0;
  const pace = async () => {
    if (!opts.requestsPerMinute) return;
    const gap = 60_000 / opts.requestsPerMinute;
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + gap;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };

  async function callNvidia(role: Role, model: string, messages: ChatMessage[], maxTokens: number, onChunk?: (t: string) => void): Promise<string> {
    const self = role === 'fast' && env.LLM_FAST_BASE_URL;
    const base = (self ? env.LLM_FAST_BASE_URL : env.NVIDIA_BASE_URL) || 'https://integrate.api.nvidia.com/v1';
    const key = self ? env.LLM_FAST_API_KEY : env.NVIDIA_API_KEY;
    if (!key && !self) throw new Error('NVIDIA_API_KEY is not set (build.nvidia.com -> API Keys)');
    let lastError: unknown;
    for (let attempt = 0; attempt <= (opts.maxRetries ?? 5); attempt++) {
      await pace();
      networkCalls++;
      // For streaming: abort only after 90 s without a chunk.
      const idle = new AbortController();
      let quiet: ReturnType<typeof setTimeout> = setTimeout(() => idle.abort(new Error('stream went quiet for 90 s')), 90_000);
      const alive = onChunk ? (t: string) => { clearTimeout(quiet); quiet = setTimeout(() => idle.abort(new Error('stream went quiet for 90 s')), 90_000); onChunk(t); } : undefined;
      let res: Response;
      try {
        res = await doFetch(`${base.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          // One hung call must not stall a whole run; a timeout counts as a failed attempt and is retried. A streamed
          // answer can legitimately take longer than that, so streaming calls are cut only when they go quiet (below).
          signal: onChunk ? idle.signal : AbortSignal.timeout(opts.timeoutMs ?? 240_000),
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({
            model, messages, temperature: 0, top_p: 1, max_tokens: maxTokens, stream: !!onChunk,
            // Nemotron 3: answer directly instead of spending the budget on visible reasoning.
            chat_template_kwargs: { enable_thinking: false },
          }),
        });
      } catch (err) {
        lastError = err;
        continue;
      }
      if (res.ok) {
        if (alive) { try { return await readStream(res, alive); } catch (err) { lastError = err; continue; } finally { clearTimeout(quiet); } }
        clearTimeout(quiet);
        const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
        return body.choices?.[0]?.message?.content ?? '';
      }
      lastError = new Error(`NVIDIA API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (res.status < 500 && res.status !== 429) break;
      // Rate limits: honor Retry-After, else back off 2s, 4s, 8s... so a burst slows down instead of failing.
      const after = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, (after > 0 ? after * 1000 : 2000 * 2 ** attempt) + Math.random() * 1500));
    }
    throw lastError;
  }

  return {
    mode,
    get networkCalls() { return networkCalls; },
    async complete(req) {
      const model = modelFor(req.role, env);
      const key = cacheKey(model, req.messages);
      if (mode === 'mock') {
        if (!opts.mock) throw new Error('mock provider needs a mock function');
        const text = opts.mock(req);
        if (req.onChunk) await playBack(text, req.onChunk, 0);
        return { text, model: 'mock', cached: false };
      }
      const hit = readCache(opts.cacheDir, key);
      if (hit) {
        if (req.onChunk) await playBack(hit.text, req.onChunk, opts.replayChunkDelayMs ?? 12);
        return hit;
      }
      if (mode === 'replay') throw new ReplayMiss(key);
      const text = await callNvidia(req.role, model, req.messages, req.maxTokens ?? 4096, req.onChunk);
      writeCache(opts.cacheDir, key, model, req.messages, text);
      return { text, model, cached: false };
    },
  };
}
