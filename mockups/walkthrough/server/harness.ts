// Live harness feed for the browser, bridged from SpacetimeDB (Phase 5).
//   GET  /api/harness/stream   SSE: a snapshot of jobs, recent events and questions, then every change as it happens
//   POST /api/harness/answer   {questionId, answer, answeredBy}: answer from the UI instead of Slack
// The worker (services/harness/src/worker.ts) writes jobs and events; this only relays them, so any number of
// pages can watch "reading -> looking-up -> asking -> waiting on Maria -> Maria answered -> resuming -> done".
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connectStdb } from '../../../packages/shared/src/stdb';
import type { DbConnection } from '../../../packages/shared/src/module_bindings';
import type { HarnessFrame } from './harnessTypes';

let connecting: Promise<DbConnection> | null = null;
const answerListeners: ((q: { id: string; program: string; answerText: string; answeredBy: string }) => void)[] = [];

/** Called whenever a question becomes answered (Slack button or the UI). */
export const onQuestionAnswered = (cb: (typeof answerListeners)[number]) => { answerListeners.push(cb); };

/** The shared SpacetimeDB connection, for other server code that writes rows. */
export const harnessConnection = () => connection();
const clients = new Set<ServerResponse>();

/** BigInt (u64 columns) isn't JSON; times become plain numbers. */
const plain = <T extends object>(row: T) => JSON.parse(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));

function send(to: ServerResponse, frame: HarnessFrame) { to.write(`data: ${JSON.stringify(frame)}\n\n`); }
const broadcast = (frame: HarnessFrame) => { for (const c of clients) send(c, frame); };

/** One shared SpacetimeDB connection and subscription for every watching page. */
function connection(): Promise<DbConnection> {
  connecting ??= (async () => {
    const conn = await connectStdb();
    await new Promise<void>((ok, fail) => {
      conn.subscriptionBuilder().onApplied(() => ok()).onError((ctx) => fail(ctx.event ?? new Error('subscription failed')))
        .subscribe(['SELECT * FROM harness_job', 'SELECT * FROM harness_event', 'SELECT * FROM question', 'SELECT * FROM person']);
    });
    conn.db.harnessEvent.onInsert((_c, row) => broadcast({ type: 'event', event: plain(row) }));
    conn.db.harnessJob.onInsert((_c, row) => broadcast({ type: 'job', job: plain(row) }));
    conn.db.harnessJob.onUpdate((_c, _old, row) => broadcast({ type: 'job', job: plain(row) }));
    conn.db.question.onUpdate((_c, old, row) => {
      broadcast({ type: 'question', question: plain(row) });
      if (old.status !== 'answered' && row.status === 'answered') for (const cb of answerListeners) cb(row);
    });
    return conn;
  })().catch((err) => { connecting = null; throw err; });
  return connecting;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10_000) req.destroy(); });
    req.on('end', () => ok(data));
    req.on('error', fail);
  });
}

/** Returns true when it handled the request. */
export function harnessRoutes(url: URL, req: IncomingMessage, res: ServerResponse): boolean {
  if (url.pathname === '/api/harness/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    connection().then((conn) => {
      const events = [...conn.db.harnessEvent.iter()].sort((a, b) => Number(a.id - b.id)).slice(-300);
      send(res, {
        type: 'snapshot',
        jobs: [...conn.db.harnessJob.iter()].map(plain),
        events: events.map(plain),
        questions: [...conn.db.question.iter()].filter((q) => q.status === 'asking' || q.status === 'answered').map(plain),
        people: [...conn.db.person.iter()].map((p) => ({ id: p.id, name: p.name, title: p.title })),
      });
      clients.add(res);
      res.on('close', () => clients.delete(res));
    }).catch((err) => { send(res, { type: 'error', message: `SpacetimeDB isn't reachable (${String(err).slice(0, 120)}). Start it with node scripts/stdb.mjs start.` }); res.end(); });
    return true;
  }
  if (url.pathname === '/api/harness/answer' && req.method === 'POST') {
    void (async () => {
      try {
        const { questionId, answer, answeredBy } = JSON.parse(await readBody(req)) as { questionId?: string; answer?: string; answeredBy?: string };
        if (!questionId || !answer || !answeredBy) throw new Error('questionId, answer and answeredBy are required');
        const conn = await connection();
        await conn.reducers.answerQuestion({ questionId, answer, answeredBy });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(err).slice(0, 200) }));
      }
    })();
    return true;
  }
  return false;
}
