import type { CutoverStage } from '@/types'
import { selectControls, selectCutover, selectMatchRate, selectThreshold, selectUIDecisions, useStore } from '@/store/useStore'
import { AnimatedNumber } from '@/components/dashboard/AnimatedNumber'
import { StepHeader, Card, Rise } from '../chrome'
import { cn } from '@/lib/cn'

const STAGES: CutoverStage[] = [1, 10, 100]
const STATUS: Record<number, string> = {
  0: 'Locked until the match passes 99%.',
  1: 'Canary live. The old path still commits as fallback.',
  10: 'Scaling up. Error rate holding at baseline.',
  100: 'All traffic on Java. Kill switch armed, rollback tested.',
}

export default function Step6Cutover() {
  const controls = useStore(selectControls)
  const stage = useStore(selectCutover)
  const rate = useStore(selectMatchRate)
  const threshold = useStore(selectThreshold)
  const jev = useStore(selectUIDecisions).find((d) => d.drives.includes('cutover'))
  const unlocked = rate >= threshold

  return (
    <div className="flex h-full flex-col justify-center">
      <div className="mx-auto max-w-[760px] text-center">
        <StepHeader n="06" eyebrow="Cut over without the fear" title={unlocked ? 'Ship it.' : 'Almost there.'} />

        <Rise delay={0.1}>
          <div className="mb-8 flex items-baseline justify-center gap-1">
            <AnimatedNumber value={rate * 100} className="glow font-display text-[72px] font-semibold leading-none tnum text-[var(--color-accent-bright)]" />
            <span className="font-display text-[34px] font-semibold text-[var(--color-faint)]">%</span>
            <span className="ml-3 self-center text-[13px] text-[var(--color-muted)]">behavioral match</span>
          </div>
        </Rise>

        <Rise delay={0.18}>
          <Card className="p-6">
            <div className="mb-3 flex items-center justify-between">
              <span className="eyebrow">Traffic cutover</span>
              {jev && (
                <span className="font-mono text-[11px] text-[var(--color-agent)]">
                  Jev · {unlocked ? 'safe to advance' : 'hold'} · {jev.confidence?.toFixed(2) ?? '—'}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {STAGES.map((s) => {
                const active = stage >= s
                return (
                  <button
                    key={s}
                    disabled={!unlocked}
                    onClick={() => controls.setCutover(s)}
                    className={cn(
                      'flex-1 rounded-xl border py-4 font-display text-[22px] font-semibold transition',
                      active
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent-bright)]'
                        : 'border-[var(--color-line-2)] text-[var(--color-muted)]',
                      unlocked ? 'cursor-pointer hover:border-[var(--color-accent)]' : 'cursor-not-allowed opacity-50',
                    )}
                  >
                    {s}%
                  </button>
                )
              })}
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 text-[13px]">
              <span className={cn('size-1.5 rounded-full', unlocked ? 'bg-[var(--color-good)] pulse-soft' : 'bg-[var(--color-faint)]')} />
              <span style={{ color: unlocked ? 'var(--color-ink)' : 'var(--color-faint)' }}>{STATUS[stage]}</span>
            </div>
          </Card>
        </Rise>

        {stage === 100 && (
          <Rise delay={0.05}>
            <p className="mt-6 font-display text-[18px] text-[var(--color-accent-bright)]">
              CBTRN02C is live on Java. The knowledge is in the code now.
            </p>
          </Rise>
        )}
      </div>
    </div>
  )
}
