import { AnimatePresence, motion } from 'motion/react'
import { selectAgentLog, selectDecisions, useStore } from '@/store/useStore'
import { StepHeader, Card, Rise } from '../chrome'

export default function Step5LockIn() {
  const decisions = useStore(selectDecisions)
  const log = useStore(selectAgentLog)

  return (
    <div className="grid h-full grid-cols-1 content-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="flex h-full flex-col justify-center">
        <StepHeader n="05" eyebrow="Make the knowledge permanent" title={<>Every answer<br />becomes a test.</>} />
        <Rise delay={0.1}>
          <p className="mb-5 max-w-[48ch] text-[15px] leading-relaxed text-[var(--color-muted)]">
            The reply is frozen into a test and a decision record — the business-rules documentation this
            system never had. Ask once; it's true forever.
          </p>
        </Rise>
        <Rise delay={0.15}>
          <Card className="overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-[var(--color-line)] px-4 py-2 text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
              <span>Question</span><span>Who</span><span>Test</span><span>Settles</span>
            </div>
            <div className="max-h-[42vh] overflow-auto">
              <AnimatePresence initial={false}>
                {decisions.map((d) => (
                  <motion.div
                    key={d.id}
                    initial={{ opacity: 0, backgroundColor: 'rgba(118,185,0,0.12)' }}
                    animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }}
                    transition={{ duration: 1 }}
                    className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-b border-[var(--color-line)] px-4 py-3 text-[12px]"
                  >
                    <span className="truncate text-[var(--color-ink)]">{d.question}</span>
                    <span className="font-mono text-[var(--color-accent-bright)]">{d.answeredBy}</span>
                    <span className="font-mono text-[var(--color-muted)]">{d.testId}</span>
                    <span className="font-mono text-[var(--color-good)]">{d.resolvedCount}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
              {decisions.length === 0 && (
                <div className="px-4 py-6 text-center text-[13px] text-[var(--color-faint)]">
                  No decisions yet — answer a question on the previous step.
                </div>
              )}
            </div>
          </Card>
        </Rise>
      </div>

      <Rise delay={0.2} className="self-center">
        <Card className="flex h-[min(58vh,560px)] flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-2.5">
            <span className="size-1.5 rounded-full bg-[var(--color-good)] pulse-soft" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-faint)]">Nemotron · reasoning</span>
          </div>
          <div className="flex-1 space-y-2 overflow-auto p-4">
            <AnimatePresence initial={false}>
              {log.map((tht) => (
                <motion.div
                  key={tht.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] p-2.5"
                >
                  <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--color-accent)]">{tht.phase}</span>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">{tht.text}</p>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </Card>
      </Rise>
    </div>
  )
}
