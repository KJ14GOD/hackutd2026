import { Lock } from 'lucide-react'
import type { CutoverStage } from '@/types'
import {
  selectControls,
  selectCutover,
  selectMatchRate,
  selectThreshold,
  selectUIDecisions,
  useStore,
} from '@/store/useStore'
import { JevChip } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'

const STAGES: CutoverStage[] = [1, 10, 100]

/** Gradual cutover 1% → 10% → 100%, locked until the match rate clears threshold. */
export function CutoverControl() {
  const controls = useStore(selectControls)
  const stage = useStore(selectCutover)
  const rate = useStore(selectMatchRate)
  const threshold = useStore(selectThreshold)
  const decisions = useStore(selectUIDecisions)

  const unlocked = rate >= threshold
  const jev = decisions.find((d) => d.drives.includes('cutover'))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">
          Traffic cutover
        </span>
        {jev && <JevChip confidence={jev.confidence} latencyMs={jev.latencyMs} />}
      </div>

      <div className="relative flex gap-1.5">
        {STAGES.map((s) => {
          const active = stage >= s
          return (
            <button
              key={s}
              disabled={!unlocked}
              onClick={() => controls.setCutover(s)}
              className={cn(
                'flex-1 rounded-lg border py-2.5 text-center text-[13px] font-semibold transition',
                active
                  ? 'border-[var(--color-good)] bg-[var(--color-good)]/15 text-[var(--color-good)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]',
                unlocked ? 'cursor-pointer hover:border-[var(--color-good)]' : 'cursor-not-allowed opacity-60',
              )}
            >
              {s}%
            </button>
          )
        })}
      </div>

      {unlocked ? (
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-good)]">
          <span className="live-dot size-1.5 rounded-full bg-[var(--color-good)]" />
          Threshold met — routing {stage}% to the rewrite
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-fg-dim)]">
          <Lock className="size-3" />
          Locked — unlocks at {(threshold * 100).toFixed(0)}% match (now {(rate * 100).toFixed(1)}%)
        </div>
      )}
    </div>
  )
}
