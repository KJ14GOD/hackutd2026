// POST /api/jev[?replay=1]: forwards a Jev decision request to OpenRouter and returns its answer, so the
// browser never sees the key. The body passes through unchanged (contract: typesafe/jev-1.13 on
// /api/alpha/decisions; Jev is not served on chat/completions).
// Successful answers are cached by the body's sha256 in .cache/jev, so a rehearsed demo runs offline; a cache
// hit never calls out. Headers: X-Jev-Cache hit|miss, X-Jev-Latency-Ms (the upstream time, also on hits).
// A missing key, an upstream error or a 5 s timeout returns 502 {error:'jev_unavailable'} fast, so the UI
// falls back to its stand-in. ?replay=1 serves only from the cache (404 on a miss).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

const UPSTREAM = 'https://openrouter.ai/api/alpha/decisions';
const CACHE = resolve(__dirname, '../.cache/jev');
const TIMEOUT_MS = 5_000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 200_000) req.destroy(); });
    req.on('end', () => ok(data));
    req.on('error', fail);
  });
}

function reply(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(body);
}

/** Returns true when it handled the request. */
export function jevRoutes(url: URL, req: IncomingMessage, res: ServerResponse): boolean {
  if (url.pathname !== '/api/jev') return false;
  if (req.method !== 'POST') { reply(res, 405, JSON.stringify({ error: 'POST only' })); return true; }
  void (async () => {
    const body = await readBody(req).catch(() => '');
    try { JSON.parse(body); } catch { reply(res, 400, JSON.stringify({ error: 'body must be JSON' })); return; }
    const file = resolve(CACHE, `${createHash('sha256').update(body).digest('hex')}.json`);
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { response: string; latencyMs: number };
      reply(res, 200, saved.response, { 'X-Jev-Cache': 'hit', 'X-Jev-Latency-Ms': String(saved.latencyMs) });
      return;
    }
    if (url.searchParams.get('replay') === '1') { reply(res, 404, JSON.stringify({ error: 'not_cached' }), { 'X-Jev-Cache': 'miss' }); return; }
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) { reply(res, 502, JSON.stringify({ error: 'jev_unavailable', reason: 'no OPENROUTER_API_KEY' }), { 'X-Jev-Cache': 'miss' }); return; }
    const started = Date.now();
    try {
      const upstream = await fetch(UPSTREAM, {
        method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      });
      const text = await upstream.text();
      const latencyMs = Date.now() - started;
      if (!upstream.ok) {
        reply(res, 502, JSON.stringify({ error: 'jev_unavailable', status: upstream.status, detail: text.slice(0, 500) }), { 'X-Jev-Cache': 'miss', 'X-Jev-Latency-Ms': String(latencyMs) });
        return;
      }
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(file, JSON.stringify({ response: text, latencyMs }));
      reply(res, 200, text, { 'X-Jev-Cache': 'miss', 'X-Jev-Latency-Ms': String(latencyMs) });
    } catch (err) {
      reply(res, 502, JSON.stringify({ error: 'jev_unavailable', reason: String(err).slice(0, 120) }), { 'X-Jev-Cache': 'miss', 'X-Jev-Latency-Ms': String(Date.now() - started) });
    }
  })();
  return true;
}
