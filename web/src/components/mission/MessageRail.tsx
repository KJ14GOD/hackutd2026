import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { selectControls, selectDecisions, useStore } from '@/store/useStore'
import { RailHead, Expanded, Empty } from './AgentRail'

/* Right HUD rail — latest messages sent to people (the Slack questions).
 * Click to expand the full outbound thread. */

export function MessageRail() {
  const controls = useStore(selectControls)
  const decisions = useStore(selectDecisions)
  const pending = controls.pendingQuestions()
  const [open, setOpen] = useState(false)

  const waiting = pending.map((q) => ({ key: q.groupId, to: `${q.owner} · ${q.team}`, text: q.question, status: 'waiting' as const, q }))
  const answered = decisions.map((d) => ({ key: d.id, to: d.answeredBy, text: d.question, status: 'answered' as const, testId: d.testId, cases: d.resolvedCount }))
  const total = waiting.length + answered.length

  return (
    <>
      <aside className="flex h-full w-[260px] shrink-0 flex-col">
        <RailHead title="Messages" sub="to people" count={total} onExpand={() => setOpen(true)} live={waiting.length > 0} />
        <div className="min-h-0 flex-1 space-y-1.5 overflow-auto pr-1">
          <AnimatePresence initial={false}>
            {[...waiting, ...answered].slice(0, 8).map((m) => (
              <motion.button
                key={m.key}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => setOpen(true)}
                className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)]/60 p-2.5 text-left transition hover:border-[var(--color-line-2)]"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-[var(--color-agent)]">{m.to.split(' · ')[0]}</span>
                  <StatusDot waiting={m.status === 'waiting'} />
                </div>
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--color-muted)]">{m.text}</p>
              </motion.button>
            ))}
          </AnimatePresence>
          {total === 0 && <Empty text="No messages sent yet." />}
        </div>
      </aside>

      <Expanded open={open} onClose={() => setOpen(false)} title="Messages to people">
        {waiting.map((m) => (
          <div key={m.key} className="rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-bg-2)] p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-[var(--color-agent)]">{m.to}</span>
              <span className="rounded bg-[var(--color-warn)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-warn)]">waiting</span>
              <span className="ml-auto font-mono text-[10px] text-[var(--color-faint)]">Jev · {m.q.confidence.toFixed(2)}</span>
            </div>
            <p className="mt-1 text-[13px] text-[var(--color-ink)]">{m.text}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
              <span className="rounded border border-[var(--color-line)] px-2 py-1 text-[var(--color-muted)]">old: {m.q.old}</span>
              <span className="rounded border border-[var(--color-line)] px-2 py-1 text-[var(--color-muted)]">new: {m.q.new}</span>
            </div>
            <div className="mt-2 text-[11px] text-[var(--color-faint)]">settles {m.q.cases} cases · via {m.q.routedBy}</div>
          </div>
        ))}
        {answered.map((m) => (
          <div key={m.key} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] text-[var(--color-agent)]">{m.to}</span>
              <span className="rounded bg-[var(--color-good)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-good)]">answered</span>
            </div>
            <p className="mt-1 text-[13px] text-[var(--color-ink)]">{m.text}</p>
            <div className="mt-1.5 text-[11px] text-[var(--color-faint)]">became test {m.testId} · settled {m.cases} cases</div>
          </div>
        ))}
        {total === 0 && <Empty text="No messages sent yet." />}
      </Expanded>
    </>
  )
}

function StatusDot({ waiting }: { waiting: boolean }) {
  return <span className="size-1.5 rounded-full" style={{ background: waiting ? 'var(--color-warn)' : 'var(--color-good)' }} />
}
