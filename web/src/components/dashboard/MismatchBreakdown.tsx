import type { MismatchCategory } from '@/types'
import { selectMismatches, useStore } from '@/store/useStore'

const CATEGORY_COLOR: Record<MismatchCategory, string> = {
  formatting: 'var(--color-cat-formatting)',
  rounding: 'var(--color-cat-rounding)',
  logic: 'var(--color-cat-logic)',
  noise: 'var(--color-cat-noise)',
}

const CATEGORIES: MismatchCategory[] = ['rounding', 'formatting', 'logic', 'noise']

/** Mismatches grouped by category and by triage classification. */
export function MismatchBreakdown() {
  const mismatches = useStore(selectMismatches)
  const open = mismatches.filter((m) => m.status !== 'test_generated')

  const byCat = CATEGORIES.map((c) => ({
    cat: c,
    count: open.filter((m) => m.category === c).length,
  }))
  const max = Math.max(1, ...byCat.map((b) => b.count))

  const asked = open.filter((m) => m.classification === 'unmade-decision').length
  const autoFixed = mismatches.filter((m) => m.classification === 'defect').length
  const filtered = open.filter((m) => m.classification === 'noise').length

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <div className="mb-2 text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">
          Open mismatches by category
        </div>
        <div className="space-y-1.5">
          {byCat.map((b) => (
            <div key={b.cat} className="flex items-center gap-2">
              <span className="w-20 text-[12px] capitalize text-[var(--color-fg-muted)]">{b.cat}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(b.count / max) * 100}%`, background: CATEGORY_COLOR[b.cat] }}
                />
              </div>
              <span className="w-6 text-right font-mono text-[12px] text-[var(--color-fg)]">
                {b.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">
          Triage — only "unmade decisions" ask a human
        </div>
        <div className="grid grid-cols-3 gap-2">
          <TriageStat label="Asked" sub="unmade-decision" value={asked} color="var(--color-warn)" />
          <TriageStat label="Auto-fixed" sub="defect" value={autoFixed} color="var(--color-good)" />
          <TriageStat label="Filtered" sub="noise" value={filtered} color="var(--color-noise)" />
        </div>
      </div>
    </div>
  )
}

function TriageStat({
  label,
  sub,
  value,
  color,
}: {
  label: string
  sub: string
  value: number
  color: string
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-[var(--color-fg)]">{label}</span>
        <span className="font-mono text-lg font-bold" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="font-mono text-[10px] text-[var(--color-fg-dim)]">{sub}</div>
    </div>
  )
}
