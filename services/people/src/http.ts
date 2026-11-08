// Every REST call goes through here and its response is saved by request hash, so a demo can replay the
// whole org with no network. REST_MODE=replay reads only the cache; live always calls (sources change)
// and refreshes the cache.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class RestReplayMiss extends Error {
  constructor(url: string) { super(`no cached response for ${url} (run once with REST_MODE=live)`); }
}

export interface HttpOptions { cacheDir: string; mode?: 'live' | 'replay' }

export function createHttp(opts: HttpOptions) {
  let calls = 0;
  return {
    get calls() { return calls; },
    /** GET or POST returning JSON. Auth headers are not part of the cache key, so secrets never land on disk. */
    async json<T>(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<T> {
      const method = init.method ?? 'GET';
      const body = init.body === undefined ? undefined : JSON.stringify(init.body);
      const key = createHash('sha256').update(`${method} ${url} ${body ?? ''}`).digest('hex').slice(0, 32);
      const file = join(opts.cacheDir, `${key}.json`);
      if (opts.mode === 'replay') {
        if (existsSync(file)) return (JSON.parse(readFileSync(file, 'utf8')) as { response: T }).response;
        throw new RestReplayMiss(url);
      }
      calls++;
      const res = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }, body, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`${method} ${url.replace(/\?.*/, '')}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const response = (await res.json()) as T;
      mkdirSync(opts.cacheDir, { recursive: true });
      writeFileSync(file, JSON.stringify({ method, url, response }, null, 2));
      return response;
    },
  };
}

export type Http = ReturnType<typeof createHttp>;
