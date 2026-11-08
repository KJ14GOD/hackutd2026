import type { ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

/* ------------------------------------------------------------------ *
 * Dev-server Slack bridge, so the token never reaches the browser.
 *
 *   POST /api/slack          {text, blocks}  -> chat.postMessage to SLACK_DEMO_USER
 *   GET  /api/slack/events   SSE: one {q, o, p} per button click on our cards
 *
 * Button clicks arrive over Socket Mode (SLACK_APP_TOKEN, no public URL).
 * The harness worker (services/harness) holds a Socket Mode connection
 * for the same app, and Slack hands each click to one connection at
 * random, so this listener also handles the harness's `answer_N` clicks:
 * it calls the same answerQuestion reducer over SpacetimeDB's HTTP API.
 * The Harbor Card people aren't real Slack users, so every card goes to
 * the demo user, labeled with who it is for. With no token it answers
 * 204 and the UI carries on offline.
 * ------------------------------------------------------------------ */

interface Action {
  action_id: string
  value?: string
}
interface BlockActions {
  type: string
  user?: { id: string; name?: string }
  channel?: { id: string }
  message?: { ts: string; blocks: { type: string; block_id?: string }[] }
  actions?: Action[]
}

export function slackApi(env: Record<string, string>): Plugin {
  const token = env.SLACK_BOT_TOKEN
  const appToken = env.SLACK_APP_TOKEN
  const channel = env.SLACK_DEMO_USER || env.SLACK_QUESTIONS_CHANNEL
  const stdb = `${(env.STDB_SERVER || 'http://localhost:3000').replace(/\/$/, '')}/v1/database/${env.STDB_DB || 'theseus'}`
  const clients = new Set<ServerResponse>()

  const slack = async (method: string, body: object) => {
    const r = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    })
    return (await r.json()) as { ok: boolean; error?: string; channel?: string; ts?: string }
  }

  /** Swap the clicked card's buttons for a line saying what happened. */
  const settle = (p: BlockActions, questionId: string, line: string) =>
    p.channel && p.message
      ? slack('chat.update', {
          channel: p.channel.id,
          ts: p.message.ts,
          text: line,
          blocks: p.message.blocks.map((b) => (b.type === 'actions' && b.block_id === `q:${questionId}` ? { type: 'context', elements: [{ type: 'mrkdwn', text: line }] } : b)),
        })
      : undefined

  async function onClick(p: BlockActions, log: (m: string) => void) {
    for (const a of p.actions ?? []) {
      if (!a.value) continue
      const { q, o, p: person } = JSON.parse(a.value) as { q: string; o: string; p: string }
      if (a.action_id.startsWith('ui_answer')) {
        // our card: hand the answer to every open Shadow Diff tab
        for (const c of clients) c.write(`data: ${JSON.stringify({ q, o, p: person })}\n\n`)
        await settle(p, q, clients.size ? `Answered *${o}*. Saved in Shadow Diff; it becomes a test.` : `Shadow Diff isn't open, so *${o}* wasn't saved. Open it and click again.`)
        log(`answer ${q}: ${o} -> ${clients.size} tab(s)`)
      } else if (/^answer_\d+$/.test(a.action_id)) {
        // a harness digest: same reducer call the harness worker makes
        const r = await fetch(`${stdb}/call/answer_question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: q, answer: o, answeredBy: person }),
        })
        await settle(p, q, r.ok ? `Answered *${o}*. Saved; the rewrite of this program continues.` : `Couldn't save *${o}*: ${await r.text()}`)
        log(`harness answer ${q}: ${o} (${r.status})`)
      }
    }
  }

  /** Socket Mode by hand (Node's WebSocket): open, ack every envelope, reconnect when Slack asks. */
  function listen(log: (m: string) => void, warn: (m: string) => void) {
    let ws: WebSocket | undefined
    let stopped = false
    const connect = async () => {
      if (stopped) return
      const r = await fetch('https://slack.com/api/apps.connections.open', { method: 'POST', headers: { Authorization: `Bearer ${appToken}` } })
      const out = (await r.json()) as { ok: boolean; url?: string; error?: string }
      if (!out.ok || !out.url) {
        warn(`[slack] socket mode: ${out.error ?? 'no url'}`)
        return
      }
      ws = new WebSocket(out.url)
      ws.onmessage = (e: MessageEvent) => {
        const env = JSON.parse(String(e.data)) as { type: string; envelope_id?: string; payload?: BlockActions }
        if (env.envelope_id) ws?.send(JSON.stringify({ envelope_id: env.envelope_id }))
        if (env.type === 'interactive' && env.payload?.type === 'block_actions') onClick(env.payload, log).catch((err: unknown) => warn(`[slack] ${String(err)}`))
        if (env.type === 'disconnect') ws?.close()
      }
      ws.onclose = () => {
        if (!stopped) setTimeout(() => void connect(), 1000)
      }
    }
    void connect().catch((err: unknown) => warn(`[slack] socket mode: ${String(err)}`))
    return () => {
      stopped = true
      ws?.close()
    }
  }

  return {
    name: 'slack-api',
    configureServer(server) {
      const log = (m: string) => server.config.logger.info(`[slack] ${m}`, { timestamp: true })
      const warn = (m: string) => server.config.logger.warn(m, { timestamp: true })
      if (token && appToken) {
        const stop = listen(log, warn)
        server.httpServer?.once('close', stop)
      }

      server.middlewares.use('/api/slack/events', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write(': connected\n\n')
        clients.add(res)
        req.on('close', () => clients.delete(res))
      })

      server.middlewares.use('/api/slack', (req, res, next) => {
        if (req.url !== '/' && req.url !== '') return next()
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (c: Buffer) => (body += c.toString()))
        req.on('end', async () => {
          if (!token || !channel) {
            res.statusCode = 204
            res.end()
            return
          }
          try {
            const { text, blocks } = JSON.parse(body) as { text?: string; blocks?: object[] }
            if (!text) throw new Error('text is required')
            const out = await slack('chat.postMessage', { channel, text, blocks })
            if (!out.ok) warn(`[slack] post: ${out.error ?? 'failed'}`)
            res.statusCode = out.ok ? 200 : 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(out))
          } catch (e) {
            res.statusCode = 400
            res.end(String(e))
          }
        })
      })
    },
  }
}
