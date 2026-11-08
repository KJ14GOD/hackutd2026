import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Radio, RotateCcw, ChevronLeft } from 'lucide-react'
import {
  selectComponent,
  selectControls,
  selectCutover,
  selectMismatches,
  selectThreshold,
  useStore,
} from '@/store/useStore'
import {
  FILES,
  INTRA_EDGES,
  MIGRATION_META,
  SEG_BY_ID,
  overallProgress,
  statusCounts,
  type FileNode,
  type Migration,
} from '@/data/system'
import { cn } from '@/lib/cn'
import { WireField } from '@/components/flow/WireField'
import { SceneMap, type Lens } from './SceneMap'
import { AgentRail } from './AgentRail'
import { MessageRail } from './MessageRail'

const LENSES: { id: Lens; label: string }[] = [
  { id: 'nodes', label: 'Status' },
  { id: 'segments', label: 'Segments' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'metrics', label: 'Metrics' },
]

export default function MissionControl() {
  const [lens, setLens] = useState<Lens>('nodes')
  const [focus, setFocus] = useState<string | null>(null)
  const [selArr, setSelArr] = useState<string[]>([])
  const [auto, setAuto] = useState(false)
  const selected = useMemo(() => new Set(selArr), [selArr])
  const toggleSelect = (id: string) => setSelArr((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  const controls = useStore(selectControls)
  const live = useStore(selectComponent)
  const mismatches = useStore(selectMismatches)
  const cutover = useStore(selectCutover)
  const threshold = useStore(selectThreshold)
  const scenarioId = useStore((s) => s.scenarioId)

  const files = useMemo<FileNode[]>(() => {
    const openQ = mismatches.filter((m) => m.classification === 'unmade-decision' && m.status !== 'test_generated').length
    const mig: Migration = cutover === 100 ? 'done' : live.matchRate >= threshold ? 'cutover' : 'shadowing'
    return FILES.map((f) => (f.id === live.id ? { ...f, matchRate: live.matchRate, openQuestions: openQ, migration: mig } : f))
  }, [live, mismatches, cutover, threshold])

  const progress = overallProgress(files)
  const counts = statusCounts(files)
  const fileById = useMemo(() => Object.fromEntries(files.map((f) => [f.id, f])), [files])
  const selFiles = selArr.map((id) => fileById[id]).filter(Boolean) as FileNode[]

  const enterFocus = (seg: string | null) => { setFocus(seg); setSelArr([]) }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <WireField />

      {/* top bar */}
      <header className="relative z-30 flex items-center gap-5 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="grid size-6 place-items-center rounded-[6px] bg-[var(--color-accent)] text-[#0a1400]"><span className="text-[13px] font-bold">◇</span></div>
          <span className="font-display text-[15px] font-semibold tracking-tight">Shadow Diff</span>
          <span className="ml-1 font-mono text-[11px] uppercase tracking-wider text-[var(--color-faint)]">CardDemo · migration</span>
        </div>

        <div className="hidden min-w-[220px] max-w-[300px] flex-1 md:block">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="font-mono uppercase tracking-wider text-[var(--color-faint)]">Codebase migrated</span>
            <span className="font-display font-semibold text-[var(--color-accent-bright)]">{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
            <motion.div className="h-full rounded-full bg-[var(--color-accent)]" animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.6 }} />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select value={scenarioId} onChange={(e) => { controls.loadScenario(e.target.value); setAuto(false); enterFocus(null) }}
            className="rounded-full border border-[var(--color-line-2)] bg-[var(--color-bg-2)] px-3 py-1.5 font-mono text-[12px] text-[var(--color-muted)] outline-none">
            {controls.scenarios().map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <button onClick={() => controls.simulateSlackAnswer('old')} className="rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-[12px] font-semibold text-[#0a1400] transition hover:bg-[var(--color-accent-bright)]">Simulate answer</button>
          <button onClick={() => { const n = !auto; controls.setAutoReplay(n); setAuto(n) }} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition', auto ? 'border-[var(--color-accent)] text-[var(--color-accent-bright)]' : 'border-[var(--color-line-2)] text-[var(--color-muted)] hover:text-[var(--color-ink)]')}><Radio className={cn('size-3.5', auto && 'pulse-soft')} /> Replay</button>
          <button onClick={() => { controls.reset(); setAuto(false); enterFocus(null) }} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-2)] px-3 py-1.5 text-[12px] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"><RotateCcw className="size-3.5" /></button>
        </div>
      </header>

      {/* full-bleed map with HUD overlays */}
      <div className="relative z-10 min-h-0 flex-1">
        <div className="absolute inset-0">
          <SceneMap files={files} lens={lens} focus={focus} setFocus={enterFocus} selected={selected} toggleSelect={toggleSelect} clearSelect={() => setSelArr([])} />
        </div>

        {/* rails fade into the center */}
        <FadeRail side="left"><AgentRail /></FadeRail>
        <FadeRail side="right"><MessageRail /></FadeRail>

        {/* breadcrumb / back */}
        <div className="pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2">
          {focus && (
            <button onClick={() => enterFocus(null)} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line-2)] bg-[var(--color-bg)]/80 px-2.5 py-1.5 text-[12px] text-[var(--color-muted)] backdrop-blur transition hover:text-[var(--color-ink)]">
              <ChevronLeft className="size-3.5" /> All segments
            </button>
          )}
          <div className="flex gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-bg)]/80 p-1 backdrop-blur">
            {LENSES.map((l) => (
              <button key={l.id} onClick={() => setLens(l.id)} aria-pressed={lens === l.id}
                className={cn('rounded-full px-3 py-1.5 text-[12px] font-medium transition', lens === l.id ? 'bg-[var(--color-accent)] text-[#0a1400]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]')}>
                {l.label}
              </button>
            ))}
          </div>
          {focus && <span className="font-mono text-[12px] text-[var(--color-ink)]">{SEG_BY_ID[focus].title}</span>}
        </div>

        {/* bottom-center: legend OR selection detail */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <AnimatePresence mode="wait">
            {selFiles.length > 0 ? (
              <motion.div key="detail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.2 }}>
                {selFiles.length === 1 ? <FileDetail file={selFiles[0]} /> : <MultiDetail files={selFiles} />}
              </motion.div>
            ) : (
              <motion.div key="legend" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-4 rounded-full border border-[var(--color-line)] bg-[var(--color-bg)]/70 px-4 py-2 backdrop-blur">
                {lens === 'metrics' ? (
                  <span className="font-mono text-[10px] text-[var(--color-faint)]">brighter = higher behavioral match</span>
                ) : (
                  (Object.keys(MIGRATION_META) as Migration[]).map((m) => (
                    <span key={m} className="flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
                      <span className="size-2 rounded-[2px]" style={{ background: MIGRATION_META[m].color }} />
                      {MIGRATION_META[m].label} · {counts[m]}
                    </span>
                  ))
                )}
                <span className="font-mono text-[10px] text-[var(--color-faint)]">
                  {focus ? 'click a file · drag/scroll to move · click empty to zoom out' : 'click a segment to zoom in'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function FadeRail({ side, children }: { side: 'left' | 'right'; children: React.ReactNode }) {
  const grad = side === 'left' ? 'to right' : 'to left'
  return (
    <div
      className={cn('pointer-events-auto absolute inset-y-0 z-20 w-[290px] px-5 py-4', side === 'left' ? 'left-0' : 'right-0')}
      style={{
        background: `linear-gradient(${grad}, var(--color-bg) 10%, transparent)`,
        maskImage: `linear-gradient(${grad}, black 62%, transparent)`,
        WebkitMaskImage: `linear-gradient(${grad}, black 62%, transparent)`,
      }}
    >
      {children}
    </div>
  )
}

function FileDetail({ file }: { file: FileNode }) {
  const seg = SEG_BY_ID[file.segment]
  const meta = MIGRATION_META[file.migration]
  const deps = INTRA_EDGES.filter((e) => e.to === file.id).length
  return (
    <div className="pointer-events-auto flex items-center gap-5 rounded-xl border border-[var(--color-line-2)] bg-[var(--color-panel)]/90 px-5 py-3 backdrop-blur">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[14px] font-semibold text-[var(--color-ink)]">{file.id}</span>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `${meta.color}22`, color: meta.color }}>{meta.label}</span>
        </div>
        <div className="text-[11px] text-[var(--color-muted)]">{file.name} · {seg.title}</div>
      </div>
      <Stat k="Match" v={file.matchRate > 0 ? `${(file.matchRate * 100).toFixed(1)}%` : '—'} accent={file.matchRate >= 0.99} />
      <Stat k="Open Q" v={String(file.openQuestions)} />
      <Stat k="Isolation" v={file.isolation.toFixed(2)} />
      <Stat k="Owner" v={seg.owner} />
      <Stat k="In-deps" v={String(deps)} />
    </div>
  )
}

function MultiDetail({ files }: { files: FileNode[] }) {
  const ids = new Set(files.map((f) => f.id))
  const conns = INTRA_EDGES.filter((e) => ids.has(e.from) || ids.has(e.to)).length
  return (
    <div className="pointer-events-auto flex items-center gap-5 rounded-xl border border-[var(--color-line-2)] bg-[var(--color-panel)]/90 px-5 py-3 backdrop-blur">
      <span className="font-mono text-[13px] text-[var(--color-ink)]">{files.length} files selected</span>
      <Stat k="Connections" v={String(conns)} accent />
      <span className="font-mono text-[11px] text-[var(--color-faint)]">{files.map((f) => f.id).join('  ')}</span>
    </div>
  )
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[13px]" style={{ color: accent ? 'var(--color-accent-bright)' : 'var(--color-ink)' }}>{v}</div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--color-faint)]">{k}</div>
    </div>
  )
}
