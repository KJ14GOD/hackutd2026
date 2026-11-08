import { motion } from 'motion/react'
import type { Mismatch } from '@/types'
import { selectMismatches, useStore } from '@/store/useStore'
import { cn } from '@/lib/cn'
import { CATEGORY_COLOR, CLASSIFICATION_META, CLASSIFICATION_ORDER, LOW_CONFIDENCE } from './meta'

export function MismatchList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (m: Mismatch) => void
}) {
  const mismatches = useStore(selectMismatches)

  return (
    <div className="space-y-4 overflow-auto pr-1">
      {CLASSIFICATION_ORDER.map((cls) => {
        const items = mismatches.filter((m) => m.classification === cls)
        if (items.length === 0) return null
        const meta = CLASSIFICATION_META[cls]
        return (
          <div key={cls}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[12px] font-semibold text-[var(--color-fg)]">{meta.title}</span>
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide"
                style={{ background: `${meta.color}22`, color: meta.color }}
              >
                {meta.badge}
              </span>
              <span className="font-mono text-[11px] text-[var(--color-fg-dim)]">{items.length}</span>
            </div>
            <div className="space-y-1">
              {items.map((m) => (
                <Row
                  key={m.id}
                  m={m}
                  active={m.id === selectedId}
                  onClick={() => onSelect(m)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Row({ m, active, onClick }: { m: Mismatch; active: boolean; onClick: () => void }) {
  const resolved = m.status === 'test_generated'
  const lowConf = m.categoryConfidence != null && m.categoryConfidence < LOW_CONFIDENCE
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition',
        active
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
          : 'border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-strong)]',
      )}
    >
      <span className="size-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[m.category] }} />
      <span
        className={cn(
          'flex-1 truncate text-[12px]',
          resolved ? 'text-[var(--color-fg-dim)] line-through' : 'text-[var(--color-fg)]',
        )}
      >
        {m.title}
      </span>
      {lowConf && (
        <span
          title="Jev is unsure of this category"
          className="grid size-4 place-items-center rounded-full bg-[var(--color-warn)]/20 text-[10px] font-bold text-[var(--color-warn)]"
        >
          ?
        </span>
      )}
      <span className="shrink-0 font-mono text-[9px] uppercase text-[var(--color-fg-dim)]">
        {resolved ? 'test ✓' : m.category}
      </span>
    </motion.button>
  )
}
