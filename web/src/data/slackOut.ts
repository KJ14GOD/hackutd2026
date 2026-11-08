import type { SlackCard } from './slackCard'

/* ------------------------------------------------------------------ *
 * The browser half of the Slack bridge (the dev server half is
 * web/server/slack.ts). Only in `npm run dev`: a static build has no
 * endpoint, and the demo must never wait on or fail because of Slack,
 * so errors are logged and dropped.
 * ------------------------------------------------------------------ */

/** Fire-and-forget post of a question card to the demo Slack user. */
export function postToSlack(card: SlackCard): void {
  if (!import.meta.env.DEV) return
  fetch('/api/slack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card) })
    .then((r) => {
      if (r.status >= 400) console.warn('[slack] post failed', r.status)
    })
    .catch((e: unknown) => console.warn('[slack] unreachable', e))
}

export interface SlackAnswer {
  q: string // question id
  o: string // the option clicked
  p: string // person id the card was for
}

/** Calls `handle` for every button click on a card this app sent. Returns a stop function. */
export function onSlackAnswer(handle: (a: SlackAnswer) => void): () => void {
  if (!import.meta.env.DEV || typeof EventSource === 'undefined') return () => {}
  const es = new EventSource('/api/slack/events')
  es.onmessage = (e: MessageEvent<string>) => handle(JSON.parse(e.data) as SlackAnswer)
  return () => es.close()
}
