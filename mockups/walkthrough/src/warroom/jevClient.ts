// The real Jev call, through the dev server's proxy (POST /api/jev → OpenRouter /api/alpha/decisions),
// so the key never reaches the browser. Answers are cached here by request hash as well, so a replay
// of the same state asks nothing twice. Any failure resolves to null and the caller uses the stand-in.

export const JEV_MODEL = 'typesafe/jev-1.13';

export type JevQuestion =
  | { type: 'noul'; question: string; instructions: string }
  | { type: 'choice'; question: string; criteria: Record<string, string> }
  | { type: 'score'; question: string; criteria: string[] };

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number; legend?: Record<string, string> };

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  /** Wall time of the call as seen from the browser, or the upstream time when the proxy reports it. */
  latencyMs: number;
  cached: boolean;
}

const memory = new Map<string, JevResponse>();
const inflight = new Map<string, Promise<JevResponse | null>>();
const STORAGE_PREFIX = 'theseus-jev:';
const TIMEOUT_MS = 6000;

async function hashOf(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromStorage(key: string): JevResponse | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? ({ ...(JSON.parse(raw) as JevResponse), cached: true }) : undefined;
  } catch { return undefined; }
}

function toStorage(key: string, r: JevResponse) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ model: r.model, answers: r.answers, latencyMs: r.latencyMs })); } catch { /* storage may be blocked; the memory cache still works */ }
}

/** One Jev request. Resolves null when the proxy is missing, the call fails, or it times out. */
export async function askJev(state: Record<string, unknown>, questions: Record<string, JevQuestion>): Promise<JevResponse | null> {
  const body = JSON.stringify({ model: JEV_MODEL, state, questions });
  const key = await hashOf(body);
  const hit = memory.get(key) ?? fromStorage(key);
  if (hit) { memory.set(key, hit); return { ...hit, cached: true }; }
  const going = inflight.get(key);
  if (going) return going;
  const p = (async () => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const started = performance.now();
    try {
      const r = await fetch('/api/jev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal });
      if (!r.ok) return null;
      const data = (await r.json()) as { model?: string; answers?: Record<string, JevAnswer> };
      if (!data.answers) return null;
      const upstream = Number(r.headers.get('X-Jev-Latency-Ms'));
      const res: JevResponse = {
        model: data.model ?? JEV_MODEL,
        answers: data.answers,
        latencyMs: Math.round(upstream > 0 ? upstream : performance.now() - started),
        cached: r.headers.get('X-Jev-Cache') === 'hit',
      };
      memory.set(key, res);
      toStorage(key, res);
      return res;
    } catch {
      return null;
    } finally {
      window.clearTimeout(t);
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** A small queue so a burst of findings does not open dozens of upstream calls at once. */
export function makeQueue(concurrency: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const next = () => { active--; waiting.shift()?.(); };
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const go = () => { active++; task().then(resolve, reject).finally(next); };
      if (active < concurrency) go(); else waiting.push(go);
    });
  };
}
