import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { selectAgentLog, selectUIDecisions, useStore } from '@/store/useStore'
import { JevChip, ModelBadge } from '@/components/ui/primitives'

type Tab = 'nemotron' | 'jev'

/** Two agents side by side: Nemotron thinks (reasoning), Jev decides (typed). */
export function AgentPanels() {
  const [tab, setTab] = useState<Tab>('nemotron')
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-[var(--color-border)] px-2 pt-1">
        <TabBtn active={tab === 'nemotron'} onClick={() => setTab('nemotron')}>
          <ModelBadge model="Nemotron" /> reasoning
        </TabBtn>
        <TabBtn active={tab === 'jev'} onClick={() => setTab('jev')}>
          <ModelBadge model="Jev" /> decisions
        </TabBtn>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {tab === 'nemotron' ? <NemotronLog /> : <JevDecisions />}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-[12px] transition"
      style={{
        borderColor: active ? 'var(--color-fg)' : 'transparent',
        color: active ? 'var(--color-fg)' : 'var(--color-fg-dim)',
      }}
    >
      {children}
    </button>
  )
}

function NemotronLog() {
  const log = useStore(selectAgentLog)
  return (
    <div className="space-y-2">
      <AnimatePresence initial={false}>
        {log.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2"
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span className="rounded bg-[var(--color-nvidia)]/15 px-1 py-0.5 font-mono text-[9px] uppercase text-[var(--color-nvidia)]">
                {t.phase}
              </span>
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">{t.text}</p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function JevDecisions() {
  const decisions = useStore(selectUIDecisions)
  return (
    <div className="space-y-2">
      {decisions.map((d) => (
        <div key={d.id} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12px] text-[var(--color-fg)]">{d.question}</p>
            <JevChip confidence={d.confidence} latencyMs={d.latencyMs} />
          </div>
          <div className="mt-2 space-y-1">
            {Object.entries(d.probabilities).map(([opt, p]) => (
              <div key={opt} className="flex items-center gap-2">
                <span
                  className="w-16 text-[10px]"
                  style={{ color: opt === d.choice ? 'var(--color-agent)' : 'var(--color-fg-dim)' }}
                >
                  {opt}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${p * 100}%`,
                      background: opt === d.choice ? 'var(--color-agent)' : 'var(--color-fg-dim)',
                    }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-[10px] text-[var(--color-fg-dim)]">
                  {Math.round(p * 100)}%
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 text-[10px] text-[var(--color-fg-dim)]">drives: {d.drives}</div>
        </div>
      ))}
    </div>
  )
}
