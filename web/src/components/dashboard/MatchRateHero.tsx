import { useEffect, useRef, useState } from 'react'
import {
  selectComponent,
  selectMatchRate,
  selectMismatches,
  selectThreshold,
  useStore,
} from '@/store/useStore'
import { AnimatedNumber } from './AnimatedNumber'

/** The hero: one big match number that counts up when an answer lands. */
export function MatchRateHero() {
  const rate = useStore(selectMatchRate)
  const threshold = useStore(selectThreshold)
  const component = useStore(selectComponent)
  const mismatches = useStore(selectMismatches)
  const noiseBaseline = useStore((s) => s.noiseBaseline)

  const prev = useRef(rate)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (rate > prev.current + 0.0001) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 1000)
      prev.current = rate
      return () => clearTimeout(t)
    }
    prev.current = rate
  }, [rate])

  const atThreshold = rate >= threshold
  const pointsLeft = Math.max(0, (threshold - rate) * 100)
  const openAsk = mismatches.filter(
    (m) => m.classification === 'unmade-decision' && m.status !== 'test_generated',
  ).length

  return (
    <div
      className={`flex h-full flex-col justify-center rounded-[22px] bg-[var(--color-card)] p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_6px_20px_-12px_rgb(0_0_0/0.08)] ${flash ? 'flash-good' : ''}`}
    >
      <div className="text-[13px] text-[var(--color-sub)]">Behavioral match with the COBOL original</div>

      <div className="mt-1 flex items-baseline gap-1">
        <AnimatedNumber
          value={rate * 100}
          className="tnum text-[76px] font-semibold leading-none tracking-[-0.045em] text-[var(--color-ink)]"
        />
        <span className="text-[34px] font-semibold text-[var(--color-faint)]">%</span>
      </div>

      <div className="mt-2 text-[13px] text-[var(--color-sub)]">
        {atThreshold ? (
          <span className="text-[var(--color-good)]">
            Above the threshold. Every remaining difference is explained.
          </span>
        ) : (
          <>
            {pointsLeft.toFixed(1)} points from the cutover line. {openAsk} question
            {openAsk === 1 ? '' : 's'} left.
          </>
        )}
      </div>

      <div className="mt-3 text-[12px] text-[var(--color-faint)]">
        Threshold {(threshold * 100).toFixed(0)}% · Noise floor {((1 - noiseBaseline) * 100).toFixed(1)}% (old
        vs old) · {component.language} → Java
      </div>
    </div>
  )
}
