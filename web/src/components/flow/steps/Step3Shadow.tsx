import { selectHistory, selectMatchRate, selectMismatches, selectThreshold, useStore } from '@/store/useStore'
import { AnimatedNumber } from '@/components/dashboard/AnimatedNumber'
import { StepHeader, Card, Rise } from '../chrome'

export default function Step3Shadow() {
  const rate = useStore(selectMatchRate)
  const threshold = useStore(selectThreshold)
  const history = useStore(selectHistory)
  const mismatches = useStore(selectMismatches)
  const noise = useStore((s) => s.noiseBaseline)

  const asked = mismatches.filter((m) => m.classification === 'unmade-decision' && m.status !== 'test_generated').length
  const fixed = mismatches.filter((m) => m.classification === 'defect').length
  const filtered = mismatches.filter((m) => m.classification === 'noise').length

  return (
    <div className="grid h-full grid-cols-1 content-center gap-10 lg:grid-cols-[0.95fr_1.05fr]">
      <div>
        <StepHeader n="03" eyebrow="Find what nobody else could" title={<>Run both.<br />Watch them disagree.</>} />
        <Rise delay={0.1}>
          <p className="max-w-[44ch] text-[15px] leading-relaxed text-[var(--color-muted)]">
            We replay thousands of real inputs through the old COBOL and the new Java at the same time,
            and diff the outputs. Every disagreement is a behavior nobody remembered — surfaced, not guessed.
          </p>
        </Rise>
        <Rise delay={0.2}>
          <div className="mt-8 grid grid-cols-3 gap-3">
            <Tri label="Asked" sub="unmade decision" v={asked} color="var(--color-warn)" />
            <Tri label="Auto-fixed" sub="defect" v={fixed} color="var(--color-good)" />
            <Tri label="Filtered" sub="noise" v={filtered} color="var(--color-faint)" />
          </div>
        </Rise>
      </div>

      <Rise delay={0.15} className="self-center">
        <Card className="p-8">
          <div className="eyebrow mb-2">Behavioral match with the original</div>
          <div className="flex items-baseline gap-1">
            <AnimatedNumber
              value={rate * 100}
              className="glow font-display text-[88px] font-semibold leading-none tnum text-[var(--color-accent-bright)]"
            />
            <span className="font-display text-[40px] font-semibold text-[var(--color-faint)]">%</span>
          </div>
          <Spark history={history.map((h) => h.rate)} threshold={threshold} />
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[var(--color-faint)]">
            <span>threshold {(threshold * 100).toFixed(0)}%</span>
            <span>noise floor {((1 - noise) * 100).toFixed(1)}% · old vs old</span>
          </div>
        </Card>
      </Rise>
    </div>
  )
}

function Tri({ label, sub, v, color }: { label: string; sub: string; v: number; color: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-2)] p-3">
      <div className="font-display text-[26px] font-semibold tnum" style={{ color }}>
        {v}
      </div>
      <div className="text-[12px] text-[var(--color-ink)]">{label}</div>
      <div className="font-mono text-[10px] text-[var(--color-faint)]">{sub}</div>
    </div>
  )
}

function Spark({ history, threshold }: { history: number[]; threshold: number }) {
  if (history.length < 2) return <div className="mt-4 h-16" />
  const w = 360, h = 64
  const min = Math.min(...history, threshold) - 0.02
  const max = 1
  const pts = history.map((r, i) => {
    const x = (i / (history.length - 1)) * w
    const y = h - ((r - min) / (max - min)) * h
    return `${x},${y}`
  })
  const ty = h - ((threshold - min) / (max - min)) * h
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="mt-4 h-16 w-full">
      <line x1="0" y1={ty} x2={w} y2={ty} stroke="var(--color-line-2)" strokeDasharray="4 4" />
      <polyline points={pts.join(' ')} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
      <circle cx={w} cy={pts.length ? pts[pts.length - 1].split(',')[1] : 0} r={3.5} fill="var(--color-accent-bright)" />
    </svg>
  )
}
