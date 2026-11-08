// Step 4 API: Part 2, Nemotron reading each program.
//   GET /api/read?source=...                     -> the latest saved read, or 404
//   GET /api/read/runs?source=...                -> every saved read: when, how, how long, totals
//   GET /api/read/stream?source=...&mode=live|replay[&tokens=1] -> reads now, streaming progress as SSE; tokens=1 adds
//        Nemotron's text as it's written ({type:'token'}), played back at reading speed for cached answers;
//        &pace=<ms per chunk> sets that speed (default 12, 0-200). The demo programs are read first.
//   GET /api/code?source=...&ref=path:12[-15]    -> those COBOL lines plus a little context, for citations
// Each read is saved as its own file under .cache/read/<source>/, so runs keep a history. The raw
// Nemotron calls stay in the repo's .cache/llm (keyed by prompt hash), which is what replay reads.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { relative, resolve } from 'node:path';
import { createProvider } from '../../../packages/llm/src/index';
import { loadConfig } from '../../../packages/shared/src/config';
import type { Pass1 } from '../../../services/segmenter/src/types';
import type { Runtime } from '../../../services/runtime/src/types';
import type { ReadEvent, ReadRun } from './readTypes';
import { runPart2 } from '../../../services/reader/src/part2';

const REPO_ROOT = resolve(__dirname, '../../..');
const READS = resolve(__dirname, '../.cache/read');
// The NVIDIA key lives in the repo's root .env; this server's own .env holds only GitHub settings.
try { process.loadEnvFile(resolve(REPO_ROOT, '.env')); } catch { /* environment only */ }

export interface ReadDeps {
  sourceDir: (source: string) => string | undefined;
  pass1For: (source: string, dir: string) => Pass1;
  runtimeFor: (source: string) => Runtime | undefined;
}

const safe = (source: string) => source.replace(/[^A-Za-z0-9_.-]/g, '_');
const runsDir = (source: string) => resolve(READS, safe(source));

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function savedRuns(source: string): string[] {
  const dir = runsDir(source);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
}

/** A read in progress: events so far and who is listening, so a page opened mid-read catches up. */
interface LiveRead { events: ReadEvent[]; clients: Set<ServerResponse> }
const live = new Map<string, LiveRead>();

function stream(res: ServerResponse, source: string, dir: string, mode: 'live' | 'replay', deps: ReadDeps, tokens: boolean, pace: number) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const write = (to: ServerResponse, e: ReadEvent) => to.write(`data: ${JSON.stringify(e)}\n\n`);
  const going = live.get(source);
  if (going) {
    for (const e of going.events) write(res, e);
    going.clients.add(res);
    res.on('close', () => going.clients.delete(res));
    return;
  }
  const run: LiveRead = { events: [], clients: new Set([res]) };
  live.set(source, run);
  res.on('close', () => run.clients.delete(res));
  const send = (e: ReadEvent) => { run.events.push(e); for (const c of run.clients) write(c, e); };

  void (async () => {
    const started = Date.now();
    try {
      const config = loadConfig();
      const provider = createProvider({ cacheDir: resolve(REPO_ROOT, config.llm.cacheDir), requestsPerMinute: config.llm.requestsPerMinute, replayChunkDelayMs: pace, env: { ...process.env, LLM_PROVIDER: mode === 'live' ? 'nvidia' : 'replay' } });
      if (mode === 'live' && !process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set in the repo’s .env');
      const pass1 = deps.pass1For(source, dir);
      const runtime = deps.runtimeFor(source);
      send({ type: 'stage', message: `Reading ${pass1.inventory.programs.length} programs with ${process.env.LLM_MODEL_STRONG ?? 'Nemotron'}, ${config.part2.concurrency} at a time` });
      if (!runtime) send({ type: 'log', line: 'Step 3 has not run for this codebase, so packs have no ran/never-ran marks' });
      let done = 0;
      const part2 = await runPart2({
        // The demo programs go in the first batch, so the best findings show up first.
        programs: [...config.requirements.harness.demoPrograms.filter((p) => pass1.inventory.programs.includes(p)), ...pass1.inventory.programs.filter((p) => !config.requirements.harness.demoPrograms.includes(p))],
        pass1, runtime, root: dir, provider,
        maxPackTokens: config.part2.maxPackTokens, maxOutputTokens: config.part2.maxOutputTokens,
        maxNeedMoreRounds: config.part2.maxNeedMoreRounds, concurrency: config.part2.concurrency, maxExtraTokens: config.part2.maxExtraTokens,
        onResult: (result) => send({ type: 'result', result, done: ++done, total: pass1.inventory.programs.length }),
        onLog: (line) => send({ type: 'log', line }),
        ...(tokens ? { onToken: (program: string, text: string) => send({ type: 'token', program, text }) } : {}),
      });
      const startedAt = new Date(started).toISOString();
      const saved: ReadRun = { id: startedAt.replace(/[:.]/g, '-'), mode, startedAt, ms: Date.now() - started, networkCalls: provider.networkCalls, part2 };
      mkdirSync(runsDir(source), { recursive: true });
      writeFileSync(resolve(runsDir(source), `${saved.id}.json`), JSON.stringify(saved));
      send({ type: 'done', run: saved });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: 'error', message: /replay/i.test(err?.constructor?.name ?? '') || /ReplayMiss/.test(message)
        ? 'Some programs have no saved Nemotron answer yet. Use “Read with Nemotron” to call it live.' : message });
    } finally {
      live.delete(source);
      for (const c of run.clients) c.end();
    }
  })();
}

/** Returns true when it handled the request. */
export function readRoutes(url: URL, res: ServerResponse, deps: ReadDeps): boolean {
  if (!['/api/read', '/api/read/runs', '/api/read/stream', '/api/code'].includes(url.pathname)) return false;
  const source = url.searchParams.get('source') || 'carddemo';
  const dir = deps.sourceDir(source);
  if (!dir) { json(res, 404, { error: 'unknown_source' }); return true; }

  if (url.pathname === '/api/read') {
    const runs = savedRuns(source);
    if (!runs.length) json(res, 404, { error: 'not_read' });
    else json(res, 200, JSON.parse(readFileSync(resolve(runsDir(source), runs[runs.length - 1]), 'utf8')));
    return true;
  }
  if (url.pathname === '/api/read/runs') {
    json(res, 200, savedRuns(source).map((f) => {
      const r = JSON.parse(readFileSync(resolve(runsDir(source), f), 'utf8')) as ReadRun;
      return { id: r.id, mode: r.mode, startedAt: r.startedAt, ms: r.ms, networkCalls: r.networkCalls, findings: r.part2.results.reduce((n, x) => n + x.findings.length, 0) };
    }));
    return true;
  }
  if (url.pathname === '/api/read/stream') {
    const pace = Math.min(200, Math.max(0, Number(url.searchParams.get('pace') ?? 12) || 0));
    stream(res, source, dir, url.searchParams.get('mode') === 'live' ? 'live' : 'replay', deps, url.searchParams.get('tokens') === '1', pace);
    return true;
  }
  // /api/code: only files inside this codebase, a small window of lines.
  const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(url.searchParams.get('ref') ?? '');
  const file = m && resolve(dir, m[1]);
  if (!m || !file || relative(dir, file).startsWith('..') || !existsSync(file)) { json(res, 404, { error: 'no_such_line' }); return true; }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const from = Number(m[2]), to = Math.min(Number(m[3] ?? m[2]), from + 40);
  const start = Math.max(1, from - 3), end = Math.min(lines.length, to + 3);
  json(res, 200, { path: m[1], from, to, lines: lines.slice(start - 1, end).map((text, i) => ({ no: start + i, text: text.slice(0, 80).trimEnd() })) });
  return true;
}
