import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Radio, RotateCcw } from 'lucide-react'
import { selectControls, useStore } from '@/store/useStore'
import { cn } from '@/lib/cn'
import { WireField } from './WireField'
import Step1Monolith from './steps/Step1Monolith'
import Step2Graph from './steps/Step2Graph'
import Step3Shadow from './steps/Step3Shadow'
import Step4Ask from './steps/Step4Ask'
import Step5LockIn from './steps/Step5LockIn'
import Step6Cutover from './steps/Step6Cutover'

const STEPS = [
  { n: '01', label: 'Meet the monolith', Component: Step1Monolith },
  { n: '02', label: 'Find where to cut', Component: Step2Graph },
  { n: '03', label: 'Find what nobody could', Component: Step3Shadow },
  { n: '04', label: 'Ask the right people', Component: Step4Ask },
  { n: '05', label: 'Make it permanent', Component: Step5LockIn },
  { n: '06', label: 'Cut over', Component: Step6Cutover },
]

export function StepShell() {
  const [i, setI] = useState(0)
  const [dir, setDir] = useState(1)
  const controls = useStore(selectControls)
  const scenarioId = useStore((s) => s.scenarioId)
  const [auto, setAuto] = useState(false)

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, next))
    setDir(clamped >= i ? 1 : -1)
    setI(clamped)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(i + 1)
      if (e.key === 'ArrowLeft') go(i - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const Step = STEPS[i].Component

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <WireField />

      {/* top bar */}
      <header className="relative z-20 flex items-center gap-3 px-8 py-5">
        <div className="flex items-center gap-2.5">
          <div className="grid size-6 place-items-center rounded-[6px] bg-[var(--color-accent)] text-[#0a1400]">
            <span className="text-[13px] font-bold">◇</span>
          </div>
          <span className="font-display text-[15px] font-semibold tracking-tight">Shadow Diff</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={scenarioId}
            onChange={(e) => { controls.loadScenario(e.target.value); setAuto(false) }}
            className="rounded-full border border-[var(--color-line-2)] bg-[var(--color-bg-2)] px-3 py-1.5 font-mono text-[12px] text-[var(--color-muted)] outline-none"
          >
            {controls.scenarios().map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={() => { const n = !auto; controls.setAutoReplay(n); setAuto(n) }}
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition',
              auto ? 'border-[var(--color-accent)] text-[var(--color-accent-bright)]' : 'border-[var(--color-line-2)] text-[var(--color-muted)] hover:text-[var(--color-ink)]')}
          >
            <Radio className={cn('size-3.5', auto && 'pulse-soft')} /> Replay
          </button>
          <button
            onClick={() => { controls.reset(); setAuto(false) }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-2)] px-3 py-1.5 text-[12px] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
          >
            <RotateCcw className="size-3.5" /> Reset
          </button>
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1">
        {/* step rail */}
        <nav className="hidden w-[232px] shrink-0 flex-col justify-center gap-1 px-6 lg:flex">
          {STEPS.map((s, idx) => {
            const active = idx === i
            const done = idx < i
            return (
              <button
                key={s.n}
                onClick={() => go(idx)}
                className="group flex items-center gap-3 rounded-lg px-3 py-2 text-left transition"
              >
                <span
                  className="font-mono text-[12px] tnum transition"
                  style={{ color: active ? 'var(--color-accent-bright)' : done ? 'var(--color-muted)' : 'var(--color-faint)' }}
                >
                  {s.n}
                </span>
                <span
                  className="text-[13px] transition"
                  style={{ color: active ? 'var(--color-ink)' : 'var(--color-faint)' }}
                >
                  {s.label}
                </span>
                {active && <span className="ml-auto h-4 w-0.5 rounded-full bg-[var(--color-accent)]" />}
              </button>
            )
          })}
        </nav>

        {/* content */}
        <main className="relative min-w-0 flex-1 px-8 lg:px-12">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={i}
              custom={dir}
              initial={{ opacity: 0, y: dir * 24, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: dir * -24, filter: 'blur(6px)' }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
            >
              <Step />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* bottom nav */}
      <footer className="relative z-20 flex items-center gap-4 px-8 py-5">
        <button
          onClick={() => go(i - 1)}
          disabled={i === 0}
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted)] transition hover:text-[var(--color-ink)] disabled:opacity-30"
        >
          <ArrowLeft className="size-4" /> Back
        </button>

        <div className="mx-auto flex items-center gap-1.5">
          {STEPS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => go(idx)}
              aria-label={`Step ${idx + 1}`}
              className="h-1.5 rounded-full transition-all"
              style={{ width: idx === i ? 26 : 6, background: idx === i ? 'var(--color-accent)' : 'var(--color-line-2)' }}
            />
          ))}
        </div>

        {i < STEPS.length - 1 ? (
          <button
            onClick={() => go(i + 1)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-4 py-2 text-[13px] font-semibold text-[#0a1400] transition hover:bg-[var(--color-accent-bright)]"
          >
            Next <ArrowRight className="size-4" />
          </button>
        ) : (
          <button
            onClick={() => go(0)}
            className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
          >
            <RotateCcw className="size-4" /> Start over
          </button>
        )}
      </footer>
    </div>
  )
}
