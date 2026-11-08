// Data API for the UI, as dev-server middleware.
//   GET  /api/graph?source=carddemo|gh:owner/name -> Part 1 static map (pass1.json) of a codebase
//   GET  /api/repos                               -> the signed-in user's GitHub repositories
//   POST /api/repos/connect {repo: "owner/name"}  -> shallow-clones the repo so /api/graph can read it
//   GET  /api/runtime?source=...                  -> the last Runtime witness result, or 404
//   GET  /api/runtime/stream?source=...           -> runs the witness (or joins the run in progress), streaming progress as SSE
// Results are cached per source; a repo is re-read only when its commit changes.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { sessionFor } from './githubAuth';
import { runPass1 } from '../../../services/segmenter/src/pass1';
import type { Pass1 } from '../../../services/segmenter/src/types';
import { runWitness } from '../../../services/runtime/src/witness';
import type { Runtime, RuntimeEvent } from '../../../services/runtime/src/types';

const REPO_ROOT = resolve(__dirname, '../../..');
const SOURCES: Record<string, string> = { carddemo: resolve(REPO_ROOT, 'legacy/carddemo') };
const CLONES = resolve(__dirname, '../.cache/repos');
const RUNTIME = resolve(__dirname, '../.cache/runtime');

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10_000) req.destroy(); });
    req.on('end', () => ok(data));
    req.on('error', fail);
  });
}

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const cache = new Map<string, Pass1>();

export function dataApi(): Plugin {
  return {
    name: 'theseus-data-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/api/repos' || url.pathname === '/api/repos/connect') {
          void repos(req, res, url.pathname);
          return;
        }
        if (url.pathname === '/api/runtime' || url.pathname === '/api/runtime/stream') {
          const source = url.searchParams.get('source') || 'carddemo';
          const dir = sourceDir(source);
          if (!dir) return json(res, 404, { error: 'unknown_source' });
          if (url.pathname === '/api/runtime') {
            const saved = resultFile(source);
            return existsSync(saved) ? json(res, 200, JSON.parse(readFileSync(saved, 'utf8'))) : json(res, 404, { error: 'not_run' });
          }
          streamRuntime(res, source, dir);
          return;
        }
        if (url.pathname !== '/api/graph') return next();
        const source = url.searchParams.get('source') || 'carddemo';
        const dir = sourceDir(source);
        res.setHeader('Content-Type', 'application/json');
        if (!dir) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'unknown_source' }));
        }
        try {
          res.end(JSON.stringify(pass1For(source, dir)));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'pass1_failed', detail: String(err) }));
        }
      });
    },
  };
}

/** Cloned repos are registered lazily, so a dev-server restart still finds them on disk. */
function sourceDir(source: string): string | undefined {
  if (source.startsWith('gh:') && !SOURCES[source] && REPO_NAME.test(source.slice(3))) {
    const dir = resolve(CLONES, source.slice(3).replace('/', '__'));
    if (existsSync(dir)) SOURCES[source] = dir;
  }
  return SOURCES[source];
}

function pass1For(source: string, dir: string): Pass1 {
  let pass1 = cache.get(source);
  if (!pass1) {
    pass1 = runPass1(dir);
    cache.set(source, pass1);
  }
  return pass1;
}

const resultFile = (source: string) => resolve(RUNTIME, `${source.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
/** A run in progress: every event so far, and the browsers listening. A page that opens mid-run catches up. */
interface LiveRun { events: RuntimeEvent[]; clients: Set<ServerResponse> }
const running = new Map<string, LiveRun>();

/** Streams the witness to the browser as SSE. Joins the run already going for this codebase, if any. */
function streamRuntime(res: ServerResponse, source: string, dir: string) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const write = (to: ServerResponse, e: RuntimeEvent) => to.write(`data: ${JSON.stringify(e)}\n\n`);
  const live = running.get(source);
  if (live) {
    for (const e of live.events) write(res, e);
    live.clients.add(res);
    res.on('close', () => live.clients.delete(res));
    return;
  }
  const run: LiveRun = { events: [], clients: new Set([res]) };
  running.set(source, run);
  res.on('close', () => run.clients.delete(res));
  const send = (e: RuntimeEvent) => { run.events.push(e); for (const c of run.clients) write(c, e); };
  void (async () => {
    try {
      const runtime: Runtime = await runWitness(dir, pass1For(source, dir), { workDir: resolve(RUNTIME, 'work', source.replace(/[^A-Za-z0-9_.-]/g, '_')), emit: send });
      mkdirSync(RUNTIME, { recursive: true });
      writeFileSync(resultFile(source), JSON.stringify(runtime));
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      running.delete(source);
      for (const c of run.clients) c.end();
    }
  })();
}

/** Lets other server routes add a source (a cloned repo) under a name. */
export function registerSource(name: string, dir: string) {
  SOURCES[name] = dir;
}

async function repos(req: IncomingMessage, res: ServerResponse, path: string) {
  const session = sessionFor(req);
  if (!session) return json(res, 401, { error: 'signed_out' });
  const gh = (p: string) => fetch(`https://api.github.com${p}`, {
    headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'theseus' },
  });
  try {
    if (path === '/api/repos') {
      const r = await gh('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
      if (!r.ok) return json(res, r.status, { error: 'github_error' });
      const list = (await r.json()) as { full_name: string; private: boolean; description: string | null; language: string | null; updated_at: string; default_branch: string }[];
      return json(res, 200, list.map((x) => ({ name: x.full_name, private: x.private, description: x.description, language: x.language, updatedAt: x.updated_at })));
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    const { repo } = JSON.parse(await readBody(req)) as { repo?: string };
    if (!repo || !REPO_NAME.test(repo)) return json(res, 400, { error: 'bad_repo' });
    const meta = await gh(`/repos/${repo}`);
    if (!meta.ok) return json(res, meta.status === 404 ? 404 : 502, { error: meta.status === 404 ? 'not_found_or_no_access' : 'github_error' });
    const dir = resolve(CLONES, repo.replace('/', '__'));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(CLONES, { recursive: true });
    // The token rides in a header for this one command only, so it never lands in .git/config or a log.
    const basic = Buffer.from(`x-access-token:${session.token}`).toString('base64');
    const clone = spawnSync('git', ['-c', `http.extraHeader=Authorization: Basic ${basic}`, 'clone', '--depth', '1', '--quiet', `https://github.com/${repo}.git`, dir],
      { encoding: 'utf8', timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (clone.status !== 0) return json(res, 502, { error: 'clone_failed' });
    const source = `gh:${repo}`;
    SOURCES[source] = dir;
    cache.delete(source);
    rmSync(resultFile(source), { force: true });
    return json(res, 200, { source });
  } catch {
    return json(res, 500, { error: 'server_error' });
  }
}
