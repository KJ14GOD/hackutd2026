import type { OutreachStep, Question, ReqWorld } from '@/types'
import { STEP_LABEL, lint, personName } from './requirements'

/* ------------------------------------------------------------------ *
 * The Slack card for a question (docs/HUMAN_LOOP.md, "Wording"): one
 * Block Kit message asking for a decision, with the evidence (cited
 * COBOL, the flagged statement, the conflict or the shadow mismatch)
 * and one button per answer. Pure: the dev server posts it, and a click
 * comes back as {q, o, p} through /api/slack/events.
 * ------------------------------------------------------------------ */

/** People who get the business wording of a question; everyone else gets the engineer one. */
export const BUSINESS = ['p-maria', 'p-marcus', 'p-riley', 'p-elena', 'p-tom']

/** Buttons for a shadow mismatch when the question lists no options of its own. */
export const SHADOW_OPTIONS = ['Old is right', 'New is right', 'Neither', "Doesn't matter"]
/** Button action ids start with this; the dev server routes them back to the open app. */
export const UI_ACTION = 'ui_answer'

export interface SlackCard {
  text: string
  blocks: object[]
}

/** Vague or ambiguous words in the question text, checked before it goes out. */
export function wordingProblems(text: string): string[] {
  return lint({ statement: text, actor: 'x', measure: '1' }, 'functional').map((p) => p.word)
}

/** Slack header blocks take at most 150 characters of plain text. */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function questionCard(w: ReqWorld, q: Question, step: OutreachStep, recipient: string): SlackCard {
  const business = BUSINESS.includes(recipient)
  const text = business ? q.text.business : q.text.engineer
  const who = personName(w, recipient)
  const blocks: object[] = [
    { type: 'header', text: { type: 'plain_text', text: clip(text, 150) } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `*${STEP_LABEL[step]}* for *${who}* · ${q.scope} · ${q.urgency} urgency · ${q.id}` }],
    },
  ]
  if (text.length > 150) blocks.push({ type: 'section', text: { type: 'mrkdwn', text } })

  const ev = q.evidence
  if (ev.kind === 'flag') {
    const marked = ev.word ? ev.statement.replace(new RegExp(`\\b(${ev.word})\\b`, 'i'), '*$1*') : ev.statement
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `>${marked}` } })
  } else if (ev.kind === 'conflict') {
    const c = w.conflicts[ev.conflictId]
    if (c) {
      const side = (id: string, label: string) => `*${label}:* ${w.versions[id]?.statement ?? id}`
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${side(c.aVersionId, 'A')}\n${side(c.bVersionId, 'B')}` } })
    }
  } else if (ev.kind === 'shadow') {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ev.detail } })
  }

  const code = (q.cites ?? []).filter((c) => c.code.trim()).slice(0, 5)
  if (code.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `\`${code[0].ref}\`\n\`\`\`${code.map((c) => c.code).join('\n')}\`\`\`` } })
  }
  if (q.routedWhy) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Asked because: ${q.routedWhy}` }] })

  const options = q.options.length ? q.options : ev.kind === 'shadow' ? SHADOW_OPTIONS : []
  if (options.length) {
    blocks.push({
      type: 'actions',
      block_id: `q:${q.id}`,
      elements: options.slice(0, 5).map((o, i) => ({
        type: 'button',
        action_id: `${UI_ACTION}_${i}`,
        text: { type: 'plain_text', text: clip(o, 75) },
        value: JSON.stringify({ q: q.id, o, p: recipient }),
        ...(i === 0 ? { style: 'primary' } : {}),
      })),
    })
  } else {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Needs a written answer: reply in Shadow Diff → Questions.' }] })
  }

  return { text: `${STEP_LABEL[step]} for ${who}: ${text}`, blocks }
}
