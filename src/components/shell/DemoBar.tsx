import { useState } from 'react'
import { MessageSquare, Play, Pause, RotateCcw, Radio } from 'lucide-react'
import { selectControls, useStore } from '@/store/useStore'
import { cn } from '@/lib/cn'

/* Compact demo controls for the main header. Owns the hero moment:
 * "Simulate Slack answer". Fully offline. */

export function DemoBar() {
  const controls = useStore(selectControls)
  const scenarioId = useStore((s) => s.scenarioId)
  const [playing, setPlaying] = useState(false)
  const [auto, setAuto] = useState(false)
  const scenarios = controls.scenarios()

  const togglePlay = () => {
    if (playing) controls.pause()
    else controls.play()
    setPlaying(!playing)
  }

  const toggleAuto = () => {
    const next = !auto
    controls.setAutoReplay(next)
    setAuto(next)
    setPlaying(controls.isPlaying())
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={scenarioId}
        onChange={(e) => {
          controls.loadScenario(e.target.value)
          setAuto(false)
          setPlaying(controls.isPlaying())
        }}
        className="rounded-full bg-[rgb(0_0_0/0.05)] px-3 py-1.5 text-[13px] text-[var(--color-ink)] outline-none"
      >
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <button
        onClick={() => controls.simulateSlackAnswer('old')}
        className="inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:brightness-105 active:translate-y-px"
      >
        <MessageSquare className="size-4" />
        Simulate Slack answer
      </button>

      <SecondaryBtn onClick={togglePlay}>
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        {playing ? 'Pause' : 'Live'}
      </SecondaryBtn>

      <button
        onClick={toggleAuto}
        aria-pressed={auto}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition',
          auto
            ? 'bg-[rgb(0_113_227/0.12)] text-[var(--color-accent)]'
            : 'bg-[rgb(0_0_0/0.05)] text-[var(--color-sub)] hover:text-[var(--color-ink)]',
        )}
        title="Hands-free recorded replay — demo safety net"
      >
        <Radio className={cn('size-3.5', auto && 'live-dot')} />
        Replay
      </button>

      <SecondaryBtn
        onClick={() => {
          controls.reset()
          setAuto(false)
          setPlaying(controls.isPlaying())
        }}
      >
        <RotateCcw className="size-3.5" />
        Reset
      </SecondaryBtn>
    </div>
  )
}

function SecondaryBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(0_0_0/0.05)] px-3 py-1.5 text-[13px] text-[var(--color-sub)] transition hover:text-[var(--color-ink)]"
    >
      {children}
    </button>
  )
}
