import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Layers, Box, Maximize2, Minus, PanelLeftOpen, Plus, Radio, RotateCcw } from 'lucide-react'
import {
  selectAgentLog,
  selectComponent,
  selectControls,
  selectCutover,
  selectDecisions,
  selectThreshold,
  useStore,
} from '@/store/useStore'
import {
  BUS_ORDER,
  DOMAIN,
  ENTRIES,
  FLOWS,
  MIGRATION_META,
  MIGRATION_ORDER,
  POCKET,
  POCKETS,
  PROGRAM,
  PROGRAMS,
  STORE,
  STORES,
  TEAMS,
  migrationProgress,
  pocketsUsingStore,
  type Migration,
  type MigrationMap,
  type Ref,
} from '@/data/carddemo'
import { MapCanvas, type Lens, type MapHandle, type View } from '@/components/map/MapCanvas'
import { blastHighlight, flowHighlight, selectionHighlight, type Highlight } from '@/components/map/highlight'
import { C, MIG_COLOR, TEAM_COLOR, isoWord } from '@/components/map/theme'
import { Hierarchy } from '@/components/shell/Hierarchy'
import { Inspector, type InspectorTab, type LiveInfo } from '@/components/shell/Inspector'
import { Search, type SearchHandle } from '@/components/shell/Search'
import { Btn, IconBtn, Segmented } from '@/components/shell/kit'
import { cn } from '@/lib/cn'

const LENSES: { id: Lens; label: string; hint: string }[] = [
  { id: 'migration', label: 'Migration', hint: 'What is on Java, what is being shadowed (1)' },
  { id: 'coupling', label: 'Coupling', hint: 'Where the code is tangled through shared data (2)' },
  { id: 'blast', label: 'Blast radius', hint: 'What to retest if a program changes (3)' },
  { id: 'owners', label: 'Owners', hint: 'Who owns what, who to ask (4)' },
]

export default function MissionControl() {
  const [lens, setLens] = useState<Lens>('migration')
  const [view, setView] = useState<View>('iso')
  const [focus, setFocus] = useState<string | null>(null)
  const [selection, setSelection] = useState<Ref | null>(null)
  const [hover, setHover] = useState<Ref | null>(null)
  const [flowState, setFlowState] = useState<{ id: string; step: number } | null>(null)
  const [tab, setTab] = useState<InspectorTab>('inspect')
  const [zoom, setZoom] = useState(1)
  const [treeOpen, setTreeOpen] = useState(true)
  const [auto, setAuto] = useState(false)
  const mapRef = useRef<MapHandle>(null)
  const searchRef = useRef<SearchHandle>(null)

  const controls = useStore(selectControls)
  const component = useStore(selectComponent)
  const threshold = useStore(selectThreshold)
  const cutover = useStore(selectCutover)
  const decisions = useStore(selectDecisions)
  const agentLog = useStore(selectAgentLog)
  const scenarioId = useStore((s) => s.scenarioId)
  // pending questions move with every decision; recompute when the store moves
  const pending = useMemo(() => controls.pendingQuestions(), [controls, decisions, scenarioId])

  /* migration state: seeded, with the live component overridden by the shadow run */
  const mig: MigrationMap = useMemo(() => {
    const m: MigrationMap = Object.fromEntries(PROGRAMS.map((p) => [p.id, p.seed]))
    if (PROGRAM[component.id]) {
      m[component.id] = cutover === 100 ? 'done' : component.matchRate >= threshold ? 'cutover' : 'shadowing'
    }
    return m
  }, [component.id, component.matchRate, threshold, cutover])

  const live: LiveInfo = {
    id: component.id,
    name: component.name,
    matchRate: component.matchRate,
    threshold,
    status: component.status,
    pending: pending.length,
  }

  const flow = flowState ? { flow: FLOWS.find((f) => f.id === flowState.id)!, step: flowState.step } : null

  const blastSource =
    selection?.kind === 'program'
      ? selection.id
      : selection?.kind === 'entry'
        ? (ENTRIES.find((e) => e.id === selection.id)?.program ?? null)
        : PROGRAM[component.id]
          ? component.id
          : null

  const highlight: Highlight | null = useMemo(() => {
    if (flow) return flowHighlight(flow.flow.steps[flow.step])
    if (lens === 'blast' && selection?.kind !== 'store' && selection?.kind !== 'pocket' && blastSource) return blastHighlight(blastSource)
    if (selection && selection.kind !== 'pocket') return selectionHighlight(selection)
    if (hover && hover.kind !== 'pocket') return selectionHighlight(hover, 'soft')
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowState, lens, selection, hover, blastSource])

  /* ---------------- navigation ---------------- */
  const pick = useCallback(
    (r: Ref | null) => {
      if (!r) {
        if (flowState) return setFlowState(null)
        if (selection && !(selection.kind === 'pocket' && focus === selection.id)) return setSelection(null)
        setSelection(null)
        setFocus(null)
        return
      }
      setFlowState(null)
      setTab('inspect')
      if (r.kind === 'pocket') setFocus(r.id)
      else if (r.kind === 'program') setFocus(PROGRAM[r.id].pocket)
      else if (r.kind === 'entry') {
        const e = ENTRIES.find((x) => x.id === r.id)
        if (e) setFocus(PROGRAM[e.program].pocket)
      }
      setSelection(r)
    },
    [flowState, selection, focus],
  )

  const goFlow = useCallback((id: string | null, step = 0) => {
    if (!id) return setFlowState(null)
    const f = FLOWS.find((x) => x.id === id)!
    const s = Math.max(0, Math.min(f.steps.length - 1, step))
    const st = f.steps[s]
    const prog = [st.from, st.to].find((r) => r.kind === 'program')?.id ?? ENTRIES.find((e) => e.id === st.from.id)?.program
    if (prog) setFocus(PROGRAM[prog].pocket)
    setSelection(null)
    setTab('inspect')
    setFlowState({ id, step: s })
  }, [])

  // keep the step's shared store lane in shot while the camera follows the flow
  const flowFrame = useMemo(() => {
    if (!flow) return undefined
    const st = flow.flow.steps[flow.step]
    return [st.from, st.to].filter((r) => r.kind === 'store' && BUS_ORDER.includes(r.id)).map((r) => r.id)
  }, [flow?.flow.id, flow?.step]) // eslint-disable-line react-hooks/exhaustive-deps

  const goHome = () => {
    setFlowState(null)
    setSelection(null)
    setFocus(null)
  }

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return
      if (e.key === 'Escape') pick(null)
      else if (e.key >= '1' && e.key <= '4') setLens(LENSES[Number(e.key) - 1].id)
      else if (e.key.toLowerCase() === 'l') setView((v) => (v === 'iso' ? 'layers' : 'iso'))
      else if (e.key.toLowerCase() === 'f') mapRef.current?.fit()
      else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (flowState && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) goFlow(flowState.id, flowState.step + (e.key === 'ArrowRight' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pick, flowState, goFlow])

  const progress = migrationProgress(mig)
  const onZoom = useCallback((k: number) => setZoom(k), [])

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-ink)]">
      {/* ---------------- top bar ---------------- */}
      <header className="z-30 flex h-[52px] shrink-0 items-center gap-4 border-b border-[var(--color-line)] bg-[var(--color-bg-2)] px-4">
        <button type="button" onClick={goHome} className="flex items-center gap-2.5" aria-label="Back to the whole system">
          <Logo />
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Shadow Diff</span>
        </button>
        <div className="h-5 w-px bg-[var(--color-line-2)]" />
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[12px] font-semibold text-[var(--color-ink)]">CARDDEMO</span>
          <span className="hidden font-mono text-[11px] text-[var(--color-faint)] xl:inline">
            {PROGRAMS.length} programs · {POCKETS.length} pockets · {STORES.length} data stores
          </span>
        </div>

        <div className="hidden w-[180px] lg:block">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-[var(--color-faint)]">On Java</span>
            <span className="tnum font-mono text-[var(--color-good)]">{Math.round(progress * 100)}%</span>
          </div>
          <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
            <div className="h-full rounded-full bg-[var(--color-good)] transition-[width] duration-700" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => PROGRAM[component.id] && pick({ kind: 'program', id: component.id })}
          className="hidden items-center gap-2 rounded-[8px] border border-[rgba(76,201,240,.3)] px-2.5 py-1 transition-colors hover:border-[var(--color-accent)] md:flex"
          title="Fly to the component being shadowed"
        >
          <span className="size-1.5 rounded-full bg-[var(--color-accent)] pulse-soft" />
          <span className="text-[11.5px] text-[var(--color-muted)]">Shadowing</span>
          <span className="font-mono text-[12px] text-[var(--color-ink)]">{component.id}</span>
          <span className="tnum font-mono text-[12px]" style={{ color: component.matchRate >= threshold ? C.good : C.accent }}>
            {(component.matchRate * 100).toFixed(1)}%
          </span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <Search ref={searchRef} onPick={pick} />
          <select
            value={scenarioId}
            onChange={(e) => {
              controls.loadScenario(e.target.value)
              setAuto(false)
              goHome()
            }}
            aria-label="Scenario"
            className="h-8 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-2 font-mono text-[11.5px] text-[var(--color-muted)] outline-none hover:border-[var(--color-line-2)]"
          >
            {controls.scenarios().map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Btn
            variant="outline"
            aria-pressed={auto}
            onClick={() => {
              const n = !auto
              controls.setAutoReplay(n)
              setAuto(n)
            }}
            className={cn(auto && 'border-[var(--color-accent)] text-[var(--color-accent)]')}
          >
            <Radio className={cn('size-3.5', auto && 'pulse-soft')} /> Replay
          </Btn>
          <IconBtn
            label="Reset scenario"
            onClick={() => {
              controls.reset()
              setAuto(false)
              goHome()
            }}
          >
            <RotateCcw className="size-4" />
          </IconBtn>
          <Btn variant="primary" disabled={!pending.length} onClick={() => controls.simulateSlackAnswer('old')} title="Answer the open Slack question as the owner">
            Simulate answer
          </Btn>
        </div>
      </header>

      {/* ---------------- body ---------------- */}
      <div className="flex min-h-0 flex-1">
        {treeOpen && <Hierarchy lens={lens} focus={focus} selection={selection} hl={highlight} mig={mig} onPick={pick} onHover={setHover} onCollapse={() => setTreeOpen(false)} />}

        <main className="flex min-w-0 flex-1 flex-col bg-[var(--color-bg)]">
          {/* canvas toolbar: where you are, how you look at it */}
          <div className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-bg-2)] px-2.5">
            {!treeOpen && (
              <IconBtn label="Show hierarchy" onClick={() => setTreeOpen(true)}>
                <PanelLeftOpen className="size-4" />
              </IconBtn>
            )}
            <Breadcrumb focus={focus} selection={selection} onHome={goHome} onPocket={(id) => pick({ kind: 'pocket', id })} />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Segmented
                label="View"
                value={view}
                onChange={setView}
                items={[
                  { id: 'iso', label: <><Box className="size-3.5" /> Iso</>, hint: 'One floor, everything in place (L)' },
                  { id: 'layers', label: <><Layers className="size-3.5" /> Layers</>, hint: 'Pull apart: entry points, programs, data (L)' },
                ]}
              />
              <Segmented label="Lens" value={lens} onChange={setLens} items={LENSES} />
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
          <MapCanvas
            ref={mapRef}
            lens={lens}
            view={view}
            focus={focus}
            selection={selection}
            hover={hover}
            highlight={highlight}
            mig={mig}
            live={PROGRAM[component.id] ? { id: component.id, pending: pending.length } : null}
            frame={flowFrame}
            onPick={pick}
            onHover={setHover}
            onZoom={onZoom}
          />

          {/* bottom-left: hover readout */}
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[46%]">
            <Readout r={hover ?? selection} mig={mig} />
          </div>

          {/* bottom-center: legend */}
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Legend lens={lens} blastSource={blastSource} hasHighlight={!!highlight} />
          </div>

          {/* bottom-right: zoom */}
          <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-panel)] p-[3px]">
            <IconBtn label="Zoom out" onClick={() => mapRef.current?.zoomBy(1 / 1.35)} className="size-7">
              <Minus className="size-3.5" />
            </IconBtn>
            <span className="tnum w-11 text-center font-mono text-[11px] text-[var(--color-muted)]">{Math.round(zoom * 100)}%</span>
            <IconBtn label="Zoom in" onClick={() => mapRef.current?.zoomBy(1.35)} className="size-7">
              <Plus className="size-3.5" />
            </IconBtn>
            <div className="mx-0.5 h-4 w-px bg-[var(--color-line-2)]" />
            <Btn onClick={() => mapRef.current?.fit()} className="h-7 px-2 text-[11.5px]" title="Fit to view (F)">
              <Maximize2 className="size-3.5" /> Fit
            </Btn>
          </div>
          </div>
        </main>

        <Inspector
          tab={tab}
          setTab={setTab}
          selection={selection}
          lens={lens}
          mig={mig}
          live={live}
          blastSource={blastSource}
          agentLog={agentLog}
          decisions={decisions}
          pending={pending}
          onAnswer={(a) => controls.simulateSlackAnswer(a)}
          flow={flow}
          onFlow={goFlow}
          onPick={pick}
          onHover={setHover}
          onClose={() => setSelection(null)}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <rect x="4" y="4" width="14" height="14" rx="2.5" fill="none" stroke={C.accent} strokeWidth="1.5" />
      <rect x="8" y="8" width="6" height="6" rx="1" fill={C.accent} />
      {[7, 11, 15].map((v) => (
        <g key={v} stroke={C.copper} strokeWidth="1.2">
          <line x1={v} y1="1" x2={v} y2="4" />
          <line x1={v} y1="18" x2={v} y2="21" />
          <line x1="1" y1={v} x2="4" y2={v} />
          <line x1="18" y1={v} x2="21" y2={v} />
        </g>
      ))}
    </svg>
  )
}

function Crumb({ children, onClick, current }: { children: React.ReactNode; onClick?: () => void; current?: boolean }) {
  return onClick ? (
    <button type="button" onClick={onClick} className="pointer-events-auto rounded-[6px] px-1.5 py-0.5 text-[12px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]">
      {children}
    </button>
  ) : (
    <span className={cn('truncate px-1.5 text-[12px]', current ? 'font-medium text-[var(--color-ink)]' : 'text-[var(--color-faint)]')}>{children}</span>
  )
}

function Breadcrumb({ focus, selection, onHome, onPocket }: { focus: string | null; selection: Ref | null; onHome: () => void; onPocket: (id: string) => void }) {
  const pocket = focus ? POCKET[focus] : null
  const leaf = selection && selection.kind !== 'pocket' ? selection : null
  const sep = <ChevronRight className="size-3 text-[var(--color-faint)]" />
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center overflow-hidden whitespace-nowrap">
      <Crumb onClick={pocket || leaf ? onHome : undefined} current={!pocket && !leaf}>
        CardDemo
      </Crumb>
      {pocket && (
        <>
          {sep}
          <Crumb>{DOMAIN[pocket.domain].title}</Crumb>
          {sep}
          <Crumb onClick={leaf ? () => onPocket(pocket.id) : undefined} current={!leaf}>
            {pocket.title}
          </Crumb>
        </>
      )}
      {leaf && (
        <>
          {sep}
          <Crumb current>
            <span className="font-mono">{leaf.id}</span>
          </Crumb>
        </>
      )}
    </nav>
  )
}

function Readout({ r, mig }: { r: Ref | null; mig: MigrationMap }) {
  if (!r) {
    return <div className="font-mono text-[11px] text-[var(--color-faint)]">click a pocket to open it · drag to pan · scroll to zoom · Esc to go back</div>
  }
  let parts: string[] = []
  if (r.kind === 'program') {
    const p = PROGRAM[r.id]
    parts = [r.id, p.title, `${p.mode} ${p.lang}`, `${p.loc.toLocaleString()} lines`, MIGRATION_META[mig[r.id] ?? 'legacy'].label]
  } else if (r.kind === 'store') {
    const s = STORE[r.id]
    parts = [r.id, s.title, s.kind.toUpperCase(), s.shared ? `shared by ${pocketsUsingStore(r.id).length} pockets` : 'local']
  } else if (r.kind === 'pocket') {
    const p = POCKET[r.id]
    parts = [p.title, `${p.programs.length} programs`, `iso ${p.isolation.toFixed(2)} ${isoWord(p.isolation)}`, TEAMS[p.team].owner]
  } else {
    const e = ENTRIES.find((x) => x.id === r.id)
    parts = [r.id, e?.kind === 'job' ? 'JCL job' : 'CICS transaction', `→ ${e?.program}`]
  }
  return (
    <div className="flex items-center gap-2 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 py-1.5 font-mono text-[11.5px]">
      {parts.map((t, i) => (
        <span key={i} className={cn('truncate', i === 0 ? 'text-[var(--color-ink)]' : 'text-[var(--color-faint)]')}>
          {i > 0 && <span className="mr-2 text-[var(--color-line-2)]">·</span>}
          {t}
        </span>
      ))}
    </div>
  )
}

function Swatch({ color, label, pulse, line, dashed }: { color: string; label: string; pulse?: boolean; line?: boolean; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[var(--color-muted)]">
      {line ? (
        <svg width="16" height="6" aria-hidden>
          <line x1="0" y1="3" x2="16" y2="3" stroke={color} strokeWidth="1.6" strokeDasharray={dashed ? '3 3' : undefined} />
        </svg>
      ) : (
        <span className={cn('size-2 rounded-[2px]', pulse && 'pulse-soft')} style={{ background: color }} />
      )}
      {label}
    </span>
  )
}

function Legend({ lens, blastSource, hasHighlight }: { lens: Lens; blastSource: string | null; hasHighlight: boolean }) {
  return (
    <div className="pointer-events-auto flex items-center gap-3.5 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-1.5">
      {lens === 'migration' && MIGRATION_ORDER.map((m: Migration) => <Swatch key={m} color={MIG_COLOR[m]} label={MIGRATION_META[m].label} pulse={m === 'shadowing'} />)}
      {lens === 'coupling' && (
        <>
          <Swatch color={C.good} label="isolated ≥ .6" />
          <Swatch color={C.warn} label="coupled" />
          <Swatch color={C.bad} label="tangled < .3" />
          <span className="text-[11px] text-[var(--color-faint)]">thicker = more pockets share it</span>
        </>
      )}
      {lens === 'blast' && (
        <>
          <Swatch color={C.accent} label={blastSource ? `changing ${blastSource}` : 'pick a program'} />
          <Swatch color={C.warn} label="retest" />
          {!hasHighlight && <span className="text-[11px] text-[var(--color-faint)]">click any program</span>}
        </>
      )}
      {lens === 'owners' && (
        <>
          {Object.values(TEAMS).map((t) => (
            <Swatch key={t.id} color={TEAM_COLOR[t.id]} label={`${t.name} ${t.owner}`} />
          ))}
          <Swatch color={C.warn} label="open question" />
        </>
      )}
      <span className="h-3.5 w-px bg-[var(--color-line-2)]" />
      <Swatch color={C.copper} label="writes" line />
      <Swatch color={C.copper} label="reads" line dashed />
    </div>
  )
}
