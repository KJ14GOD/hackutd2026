import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Box, ChevronRight, Expand, Layers, PanelLeftOpen, PanelRightOpen, Radio, RotateCcw, Shrink, X } from 'lucide-react'
import {
  selectAgentLog,
  selectComponent,
  selectControls,
  selectCutover,
  selectDecisions,
  selectThreshold,
  useStore,
} from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { canSeeScope, gate as gateOf, gateState, isRestrictedScope } from '@/data/requirements'
import {
  BUS_ORDER,
  DOMAIN,
  ENTRIES,
  FLOWS,
  MIGRATION_META,
  MIGRATION_ORDER,
  POCKET,
  PROGRAM,
  PROGRAMS,
  STORE,
  TEAMS,
  migrationProgress,
  pocketsUsingStore,
  type Migration,
  type MigrationMap,
  type Ref,
} from '@/data/carddemo'
import { MapCanvas, type Lens, type MapHandle, type PocketGate, type View } from '@/components/map/MapCanvas'
import { blastHighlight, flowHighlight, impactHighlight, selectionHighlight, type Highlight } from '@/components/map/highlight'
import { C, GATE_COLOR, ISO_LEVELS, MIG_COLOR, TEAM_COLOR, isoWord } from '@/components/map/theme'
import { Hierarchy } from '@/components/shell/Hierarchy'
import { INSPECTOR_W, Inspector, type InspectorTab, type LiveInfo } from '@/components/shell/Inspector'
import { Search, type SearchHandle } from '@/components/shell/Search'
import { Btn, IconBtn, Segmented } from '@/components/shell/kit'
import { Rail, ViewingAs } from '@/components/shell/Rail'
import { RequirementsScreen } from '@/components/requirements/RequirementsScreen'
import { QuestionsScreen } from '@/components/questions/QuestionsScreen'
import { InboxScreen } from '@/components/approvals/InboxScreen'
import { PeopleScreen } from '@/components/people/PeopleScreen'
import { cn } from '@/lib/cn'

const LENSES: { id: Lens; label: string; hint: string }[] = [
  { id: 'migration', label: 'Migration', hint: 'What is on Java, what is being shadowed (1)' },
  { id: 'coupling', label: 'Coupling', hint: 'Where the code is tangled through shared data (2)' },
  { id: 'blast', label: 'Blast radius', hint: 'What to retest if a program changes (3)' },
  { id: 'owners', label: 'Owners', hint: 'Who owns what, who to ask (4)' },
  { id: 'gate', label: 'Requirements', hint: 'Which pockets may be rewritten or cut over, and what blocks the rest (5)' },
]

/** Below this width both panels stop docking: the sidebar collapses and the
 *  Inspector slides over the map instead (projectors, small laptops). */
const NARROW = 1440

function useNarrow() {
  const get = () => typeof window !== 'undefined' && window.innerWidth < NARROW
  const [narrow, setNarrow] = useState(get)
  useEffect(() => {
    const on = () => setNarrow(get())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return narrow
}

export default function MissionControl() {
  const [lens, setLens] = useState<Lens>('migration')
  const [view, setView] = useState<View>('iso')
  const [focus, setFocus] = useState<string | null>(null)
  const [selection, setSelection] = useState<Ref | null>(null)
  const [hover, setHover] = useState<Ref | null>(null)
  // the camera flies after a pick or Esc while the pointer stays still, so no
  // leave event fires: drop the hover then, the next pointer move restores it
  const [seen, setSeen] = useState({ focus, selection })
  if (seen.focus !== focus || seen.selection !== selection) {
    setSeen({ focus, selection })
    setHover(null)
  }
  const [flowState, setFlowState] = useState<{ id: string; step: number } | null>(null)
  const [tab, setTab] = useState<InspectorTab>('inspect')
  const [auto, setAuto] = useState(false)
  const mapRef = useRef<MapHandle>(null)
  const searchRef = useRef<SearchHandle>(null)

  /* panels: docked when wide; when narrow the sidebar starts hidden and the
   * Inspector overlays the map. "Map only" hides both without forgetting them. */
  const narrow = useNarrow()
  const [treeOpen, setTreeOpen] = useState(!narrow)
  const [inspOpen, setInspOpen] = useState(!narrow)
  const [mapOnly, setMapOnly] = useState(false)
  const [wasNarrow, setWasNarrow] = useState(narrow)
  if (narrow !== wasNarrow) {
    setWasNarrow(narrow)
    setTreeOpen(!narrow)
    setInspOpen(!narrow)
  }
  const showTree = treeOpen && !mapOnly
  const showInsp = inspOpen && !mapOnly

  const workspace = useUi((s) => s.workspace)
  const go = useUi((s) => s.go)
  const me = useUi((s) => s.viewerId)
  const impact = useUi((s) => s.impact)
  const showImpact = useUi((s) => s.showImpact)
  const onMap = workspace === 'map'
  // "Show on map": an impact spans pockets, so step back to the whole system
  const [seenImpact, setSeenImpact] = useState(impact)
  if (impact !== seenImpact) {
    setSeenImpact(impact)
    if (impact) {
      setFocus(null)
      setSelection(null)
      setFlowState(null)
    }
  }
  // the requirements gate per pocket, as strings so a clock tick doesn't re-render the map
  const gateRows = useStore(
    useShallow((s) =>
      Object.fromEntries(
        Object.keys(POCKET).map((id) => {
          const locked = isRestrictedScope(s.reqs, id) && !canSeeScope(s.reqs, me, id)
          return [id, locked ? 'locked:0' : `${gateState(s.reqs, id)}:${gateOf(s.reqs, id).blockers.length}`]
        }),
      ),
    ),
  )
  const gateMap = useMemo(
    () => Object.fromEntries(Object.entries(gateRows).map(([id, v]) => [id, { state: v.split(':')[0] as PocketGate['state'], blockers: Number(v.split(':')[1]) }])),
    [gateRows],
  )

  const controls = useStore(selectControls)
  const component = useStore(selectComponent)
  const threshold = useStore(selectThreshold)
  const cutover = useStore(selectCutover)
  const decisions = useStore(selectDecisions)
  const agentLog = useStore(selectAgentLog)
  const scenarioId = useStore((s) => s.scenarioId)
  // pendingQuestions() reads the store; decisions and scenarioId are what move it
  // oxlint-disable-next-line react-hooks/exhaustive-deps
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

  const flowDef = flowState ? FLOWS.find((f) => f.id === flowState.id) : undefined
  const flow = flowDef && flowState ? { flow: flowDef, step: flowState.step } : null
  const flowStep = flow ? flow.flow.steps[flow.step] : null

  const blastSource =
    selection?.kind === 'program'
      ? selection.id
      : selection?.kind === 'entry'
        ? (ENTRIES.find((e) => e.id === selection.id)?.program ?? null)
        : PROGRAM[component.id]
          ? component.id
          : null

  const highlight: Highlight | null = useMemo(() => {
    if (flowStep) return flowHighlight(flowStep)
    if (impact && !selection) return impactHighlight(impact.programs, impact.downstream)
    if (lens === 'blast' && selection?.kind !== 'store' && selection?.kind !== 'pocket' && blastSource) return blastHighlight(blastSource)
    if (selection && selection.kind !== 'pocket') return selectionHighlight(selection)
    if (hover && hover.kind !== 'pocket') return selectionHighlight(hover, 'soft')
    return null
  }, [flowStep, impact, lens, selection, hover, blastSource])

  // keep the step's shared store lane in shot while the camera follows the flow
  const flowFrame = useMemo(
    () => (flowStep ? [flowStep.from, flowStep.to].filter((r) => r.kind === 'store' && BUS_ORDER.includes(r.id)).map((r) => r.id) : undefined),
    [flowStep],
  )

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
      go('map')
      if (r.kind === 'pocket') setFocus(r.id)
      else if (r.kind === 'program') setFocus(PROGRAM[r.id].pocket)
      else if (r.kind === 'entry') {
        const e = ENTRIES.find((x) => x.id === r.id)
        if (e) setFocus(PROGRAM[e.program].pocket)
      }
      setSelection(r)
      if (narrow && !mapOnly) setInspOpen(true)
    },
    [flowState, selection, focus, narrow, mapOnly, go],
  )

  const goFlow = useCallback(
    (id: string | null, step = 0) => {
      if (!id) return setFlowState(null)
      const f = FLOWS.find((x) => x.id === id)
      if (!f) return
      const s = Math.max(0, Math.min(f.steps.length - 1, step))
      const st = f.steps[s]
      const prog = [st.from, st.to].find((r) => r.kind === 'program')?.id ?? ENTRIES.find((e) => e.id === st.from.id)?.program
      if (prog) setFocus(PROGRAM[prog].pocket)
      setSelection(null)
      setTab('inspect')
      setFlowState({ id, step: s })
      if (narrow && !mapOnly) setInspOpen(true)
    },
    [narrow, mapOnly],
  )

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
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return
      // the rest are map keys
      if (!onMap) return
      if (e.key === 'Escape') {
        if (impact && !selection && !flowState) showImpact(null)
        else pick(null)
      } else if (e.key >= '1' && e.key <= '5') setLens(LENSES[Number(e.key) - 1].id)
      else if (e.key.toLowerCase() === 'l') setView((v) => (v === 'iso' ? 'layers' : 'iso'))
      else if (e.key.toLowerCase() === 'f') mapRef.current?.fit()
      else if (e.key.toLowerCase() === 'm') setMapOnly((v) => !v)
      else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (flowState && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) goFlow(flowState.id, flowState.step + (e.key === 'ArrowRight' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pick, flowState, goFlow, onMap, impact, selection, showImpact])

  const progress = migrationProgress(mig)
  const overlayInsp = narrow && showInsp

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-ink)]">
      {/* ---------------- top bar ---------------- */}
      <header className="z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-bg-2)] px-4">
        <button type="button" onClick={goHome} className="flex shrink-0 items-center gap-2.5" aria-label="Back to the whole system">
          <Logo />
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Shadow Diff</span>
        </button>
        <div className="h-5 w-px shrink-0 bg-[var(--color-line-2)]" />
        <span className="shrink-0 font-mono text-[12px] font-semibold text-[var(--color-ink)]" title="AWS CardDemo, scanned by the segmenter">
          CARDDEMO
        </span>

        <div className="hidden w-[160px] shrink-0 2xl:block" title={`${Math.round(progress * 100)}% of the codebase is on Java`}>
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
          className="hidden shrink-0 items-center gap-2 rounded-[8px] border border-[rgba(69,199,245,.3)] px-2.5 py-1 transition-colors hover:border-[var(--color-accent)] md:flex"
          title="Fly to the component being shadowed"
        >
          <span className="size-1.5 rounded-full bg-[var(--color-accent)] pulse-soft" />
          <span className="text-[11.5px] text-[var(--color-muted)]">Shadowing</span>
          <span className="font-mono text-[12px] text-[var(--color-ink)]">{component.id}</span>
          <span className="tnum font-mono text-[12px]" style={{ color: component.matchRate >= threshold ? C.good : C.accent }} aria-live="polite">
            {(component.matchRate * 100).toFixed(1)}%
          </span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ViewingAs />
          <Search ref={searchRef} onPick={pick} compact={narrow} />
          <select
            value={scenarioId}
            onChange={(e) => {
              controls.loadScenario(e.target.value)
              setAuto(false)
              goHome()
            }}
            aria-label="Demo scenario"
            title="Demo scenario: which component the agent is shadowing"
            className="hidden h-8 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-2 text-[12px] text-[var(--color-muted)] outline-none hover:border-[var(--color-line-2)] lg:block"
          >
            {controls.scenarios().map((s) => (
              <option key={s.id} value={s.id}>
                {/* the chip beside it already names the program */}
                {s.name.split(' · ')[0]}
              </option>
            ))}
          </select>
          <div className="mx-0.5 h-5 w-px bg-[var(--color-line-2)]" />
          <Btn
            variant="outline"
            aria-pressed={auto}
            title="Answer every question automatically, hands-free"
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
            label="Reset the demo"
            onClick={() => {
              controls.reset()
              setAuto(false)
              goHome()
            }}
          >
            <RotateCcw className="size-4" />
          </IconBtn>
          <Btn
            variant="primary"
            disabled={!pending.length}
            onClick={() => controls.simulateSlackAnswer('old')}
            title={pending.length ? 'Answer the open Slack question as its owner' : 'No question is waiting on a person'}
          >
            Simulate answer
          </Btn>
        </div>
      </header>

      {/* ---------------- body ---------------- */}
      <div className="relative flex min-h-0 flex-1">
        <Rail />
        {!onMap && (
          <main className="flex min-w-0 flex-1 flex-col bg-[var(--color-bg)]">
            {workspace === 'requirements' && <RequirementsScreen />}
            {workspace === 'questions' && <QuestionsScreen />}
            {workspace === 'inbox' && <InboxScreen />}
            {workspace === 'people' && <PeopleScreen />}
          </main>
        )}
        {onMap && showTree && <Hierarchy focus={focus} selection={selection} mig={mig} onPick={pick} onHover={setHover} onCollapse={() => setTreeOpen(false)} />}

        {onMap && (
        <main className="flex min-w-0 flex-1 flex-col bg-[var(--color-bg)]">
          {/* canvas toolbar: where you are, how you look at it */}
          <div className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-bg-2)] px-2.5">
            {!showTree && !mapOnly && (
              <IconBtn label="Show systems panel" onClick={() => setTreeOpen(true)}>
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
              <div className="mx-0.5 h-5 w-px bg-[var(--color-line-2)]" />
              <IconBtn label={mapOnly ? 'Show panels (M)' : 'Map only (M)'} aria-pressed={mapOnly} onClick={() => setMapOnly((v) => !v)}>
                {mapOnly ? <Shrink className="size-4" /> : <Expand className="size-4" />}
              </IconBtn>
              {!showInsp && !mapOnly && (
                <IconBtn label="Show inspector" onClick={() => setInspOpen(true)}>
                  <PanelRightOpen className="size-4" />
                </IconBtn>
              )}
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
              gate={gateMap}
              live={PROGRAM[component.id] ? { id: component.id, pending: pending.length } : null}
              frame={flowFrame}
              insetRight={overlayInsp ? INSPECTOR_W : 0}
              onPick={pick}
              onHover={setHover}
              onOpenMessages={() => {
                if (PROGRAM[component.id]) pick({ kind: 'program', id: component.id })
                setTab('people')
                setInspOpen(true)
                setMapOnly(false)
              }}
            />

            {/* top-left: what the pointer is on (or the selection) */}
            <div className="pointer-events-none absolute left-3 top-3" style={{ right: 12 + (overlayInsp ? INSPECTOR_W : 0) }}>
              <Readout r={hover ?? selection} mig={mig} />
            </div>

            {impact && (
              <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-[10px] border border-[rgba(239,178,74,.4)] bg-[var(--color-panel)] py-1 pl-3 pr-1 text-[12px] shadow-[0_8px_24px_rgba(0,0,0,.5)]">
                <span className="text-[var(--color-warn)]">Showing impact</span>
                <span className="max-w-[420px] truncate text-[var(--color-muted)]">{impact.label}</span>
                <span className="shrink-0 text-[var(--color-faint)]">
                  {impact.programs.length} changing · {impact.downstream.length} to retest
                </span>
                <IconBtn label="Clear the impact" onClick={() => showImpact(null)}>
                  <X className="size-3.5" />
                </IconBtn>
              </div>
            )}

            {/* bottom-left: legend */}
            <div className="pointer-events-none absolute bottom-3 left-3">
              <Legend lens={lens} blastSource={blastSource} hasHighlight={!!highlight} />
            </div>
          </div>
        </main>
        )}

        {onMap && showInsp && (
          <div className={cn(overlayInsp && 'absolute bottom-0 right-0 top-11 z-20 shadow-[-24px_0_48px_-24px_rgba(0,0,0,.8)]')}>
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
              onHide={() => setInspOpen(false)}
            />
          </div>
        )}
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
    <button type="button" onClick={onClick} className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[12px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]">
      {children}
    </button>
  ) : (
    <span className={cn('shrink-0 px-1.5 text-[12px]', current ? 'font-medium text-[var(--color-ink)]' : 'text-[var(--color-faint)]')}>{children}</span>
  )
}

/* Where you are. When space runs out the domain step goes first, then the
 * pocket collapses to its short name; the current item is always whole. */
function Breadcrumb({ focus, selection, onHome, onPocket }: { focus: string | null; selection: Ref | null; onHome: () => void; onPocket: (id: string) => void }) {
  const pocket = focus ? POCKET[focus] : null
  const leaf = selection && selection.kind !== 'pocket' ? selection : null
  const sep = <ChevronRight className="size-3 shrink-0 text-[var(--color-faint)]" />
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center overflow-hidden whitespace-nowrap">
      <Crumb onClick={pocket || leaf ? onHome : undefined} current={!pocket && !leaf}>
        CardDemo
      </Crumb>
      {pocket && (
        <>
          <span className="hidden items-center 2xl:flex">
            {sep}
            <Crumb>{DOMAIN[pocket.domain].title}</Crumb>
          </span>
          {sep}
          <Crumb onClick={leaf ? () => onPocket(pocket.id) : undefined} current={!leaf}>
            <span className="hidden xl:inline">{pocket.title}</span>
            <span className="xl:hidden">{pocket.short}</span>
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
  if (!r) return null
  let parts: string[] = []
  if (r.kind === 'program') {
    const p = PROGRAM[r.id]
    parts = [r.id, p.title, `${p.mode} ${p.lang}`, `${p.loc.toLocaleString()} lines`, MIGRATION_META[mig[r.id] ?? 'legacy'].label]
  } else if (r.kind === 'store') {
    const s = STORE[r.id]
    parts = [r.id, s.title, s.kind.toUpperCase(), s.shared ? `shared by ${pocketsUsingStore(r.id).length} pockets` : 'used by one pocket']
  } else if (r.kind === 'pocket') {
    const p = POCKET[r.id]
    parts = [p.title, `${p.programs.length} programs`, isoWord(p.isolation), TEAMS[p.team].owner]
  } else {
    const e = ENTRIES.find((x) => x.id === r.id)
    parts = [r.id, e?.kind === 'job' ? 'JCL job' : 'CICS transaction', `starts ${e?.program}`]
  }
  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 py-1.5 font-mono text-[11.5px]">
      {parts.map((t, i) => (
        <span key={i} className={i === 0 ? 'text-[var(--color-ink)]' : 'text-[var(--color-faint)]'}>
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
    <div className="pointer-events-auto flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-1.5">
      {lens === 'migration' && MIGRATION_ORDER.map((m: Migration) => <Swatch key={m} color={MIG_COLOR[m]} label={MIGRATION_META[m].label} pulse={m === 'shadowing'} />)}
      {lens === 'coupling' && (
        <>
          {ISO_LEVELS.map((l) => (
            <Swatch key={l.word} color={l.color} label={l.word} />
          ))}
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
      {lens === 'gate' && (
        <>
          <Swatch color={GATE_COLOR.open} label="gate open" />
          <Swatch color={GATE_COLOR.blocked} label="blocked" />
          <Swatch color={GATE_COLOR.none} label="no requirements yet" />
          <Swatch color={GATE_COLOR.locked} label="restricted" />
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
