import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { selectAgentLog, useStore } from '@/store/useStore'

/* Left HUD rail — latest agent (Nemotron) migration updates.
 * Click an update to expand the full stream. */

export function AgentRail() {
  const log = useStore(selectAgentLog)
  const [open, setOpen] = useState(false)

  return (
    <>
      <aside className="flex h-full w-[260px] shrink-0 flex-col">
        <RailHead title="Agent updates" sub="Nemotron" count={log.length} onExpand={() => setOpen(true)} live />
        <div className="min-h-0 flex-1 space-y-1.5 overflow-auto pr-1">
          <AnimatePresence initial={false}>
            {log.slice(0, 8).map((t) => (
              <motion.button
                key={t.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => setOpen(true)}
                className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)]/60 p-2.5 text-left transition hover:border-[var(--color-line-2)]"
              >
                <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--color-accent)]">{t.phase}</span>
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--color-muted)]">{t.text}</p>
              </motion.button>
            ))}
          </AnimatePresence>
          {log.length === 0 && <Empty text="No agent activity yet." />}
        </div>
      </aside>

      <Expanded open={open} onClose={() => setOpen(false)} title="Agent updates · Nemotron">
        {log.map((t) => (
          <div key={t.id} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg-2)] p-3">
            <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--color-accent)]">{t.phase}</span>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink)]">{t.text}</p>
          </div>
        ))}
        {log.length === 0 && <Empty text="No agent activity yet." />}
      </Expanded>
    </>
  )
}

export function RailHead({ title, sub, count, onExpand, live }: { title: string; sub: string; count: number; onExpand: () => void; live?: boolean }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {live && <span className="size-1.5 rounded-full bg-[var(--color-good)] pulse-soft" />}
      <div>
        <div className="text-[13px] font-medium text-[var(--color-ink)]">{title}</div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-faint)]">{sub} · {count}</div>
      </div>
      <button onClick={onExpand} className="ml-auto font-mono text-[10px] uppercase tracking-wider text-[var(--color-faint)] transition hover:text-[var(--color-ink)]">
        all →
      </button>
    </div>
  )
}

export function Expanded({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-8 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-[min(560px,92vw)] flex-col rounded-2xl border border-[var(--color-line-2)] bg-[var(--color-panel)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-5 py-3.5">
              <span className="font-display text-[16px] font-semibold text-[var(--color-ink)]">{title}</span>
              <button onClick={onClose} className="text-[var(--color-faint)] transition hover:text-[var(--color-ink)]"><X className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-auto p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Empty({ text }: { text: string }) {
  return <div className="px-2 py-6 text-center text-[12px] text-[var(--color-faint)]">{text}</div>
}
