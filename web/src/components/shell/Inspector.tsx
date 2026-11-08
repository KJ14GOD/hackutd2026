import type { ReactNode } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Code2, Play, X } from 'lucide-react'
import type { AgentThought, Decision } from '@/types'
import type { PendingQuestion } from '@/data/source'
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
  POCKETS,
  SOURCE,
  STORE,
  TEAMS,
  blastRadius,
  callsFrom,
  callsTo,
  cutCost,
  entriesOf,
  ioOf,
  localStoresOfPocket,
  migrationCounts,
  migrationProgress,
  sharedStoresOfPocket,
  sourceUrl,
  storeBlast,
  type Flow,
  type MigrationMap,
  type Ref,
} from '@/data/carddemo'
import { C, MIG_COLOR, TEAM_COLOR, isoColor, isoWord } from '@/components/map/theme'
import type { Lens } from '@/components/map/MapCanvas'
import { cn } from '@/lib/cn'
import { Btn, Chip, Dot, IconBtn, SectionHead, Segmented, Stat } from './kit'

export type InspectorTab = 'inspect' | 'agent' | 'people'

export interface LiveInfo {
  id: string
  name: string
  matchRate: number
  threshold: number
  status: string
  pending: number
}

interface Props {
  tab: InspectorTab
  setTab: (t: InspectorTab) => void
  selection: Ref | null
  lens: Lens
  mig: MigrationMap
  live: LiveInfo
  blastSource: string | null
  agentLog: AgentThought[]
  decisions: Decision[]
  pending: PendingQuestion[]
  onAnswer: (a: 'old' | 'new') => void
  flow: { flow: Flow; step: number } | null
  onFlow: (id: string | null, step?: number) => void
  onPick: (r: Ref) => void
  onHover: (r: Ref | null) => void
  onClose: () => void
}

export function Inspector(p: Props) {
  return (
    <aside className="flex h-full w-[368px] shrink-0 flex-col border-l border-[var(--color-line)] bg-[var(--color-bg-2)]">
      <div className="flex h-11 items-center justify-between border-b border-[var(--color-line)] pl-3 pr-1.5">
        <Segmented
          size="sm"
          label="Inspector tab"
          value={p.tab}
          onChange={p.setTab}
          items={[
            { id: 'inspect', label: 'Inspect' },
            { id: 'agent', label: <>Agent <Count n={p.agentLog.length} /></> },
            { id: 'people', label: <>People <Count n={p.pending.length} warn /></> },
          ]}
        />
        {p.selection && p.tab === 'inspect' && (
          <IconBtn label="Clear selection" onClick={p.onClose}>
            <X className="size-4" />
          </IconBtn>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {p.tab === 'inspect' && (p.flow ? <FlowPanel {...p} flow={p.flow} /> : <InspectBody {...p} />)}
        {p.tab === 'agent' && <AgentPanel log={p.agentLog} live={p.live} />}
        {p.tab === 'people' && <PeoplePanel pending={p.pending} decisions={p.decisions} onAnswer={p.onAnswer} />}
      </div>
    </aside>
  )
}

function Count({ n, warn }: { n: number; warn?: boolean }) {
  if (!n) return null
  return (
    <span className="tnum rounded-[4px] px-1 font-mono text-[10px]" style={{ background: warn ? 'rgba(217,164,65,.16)' : 'var(--color-panel-2)', color: warn ? C.warn : 'var(--color-faint)' }}>
      {n}
    </span>
  )
}

/* ----------------------------- inspect ----------------------------- */

function Header({ kind, title, mono, sub }: { kind: ReactNode; title: string; mono?: boolean; sub?: ReactNode }) {
  return (
    <div className="px-4 pb-3 pt-4">
      <div className="eyebrow">{kind}</div>
      <h2 className={cn('mt-1.5 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[var(--color-ink)]', mono && 'font-mono text-[19px]')}>{title}</h2>
      {sub && <div className="mt-1 text-[12.5px] leading-snug text-[var(--color-muted)]">{sub}</div>}
    </div>
  )
}

function Hr() {
  return <div className="mx-4 my-1 h-px bg-[var(--color-line)]" />
}

function RefLink({ r, onPick, onHover, children }: { r: Ref; onPick: (r: Ref) => void; onHover: (r: Ref | null) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onPick(r)}
      onMouseEnter={() => onHover(r)}
      onMouseLeave={() => onHover(null)}
      className="min-w-0 truncate text-left font-mono text-[12px] text-[var(--color-ink)] underline decoration-[var(--color-line-2)] underline-offset-[3px] transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
    >
      {children}
    </button>
  )
}

/** groma-style relationship row: source → verb → destination */
function RelRow({ from, verb, to, tone }: { from: ReactNode; verb: string; to: ReactNode; tone?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-[var(--color-line)] px-4 py-2 last:border-b-0">
      <div className="min-w-0 truncate">{from}</div>
      <div className="flex flex-col items-center px-1">
        <span className="text-[10.5px] leading-none" style={{ color: tone ?? 'var(--color-faint)' }}>{verb}</span>
        <ArrowRight className="mt-0.5 size-3" style={{ color: tone ?? 'var(--color-faint)' }} />
      </div>
      <div className="min-w-0 truncate text-right">{to}</div>
    </div>
  )
}

function InspectBody(p: Props) {
  const s = p.selection
  if (!s) return <SystemView {...p} />
  if (s.kind === 'pocket') return <PocketDetail id={s.id} {...p} />
  if (s.kind === 'program') return <ProgramDetail id={s.id} {...p} />
  if (s.kind === 'store') return <StoreDetail id={s.id} {...p} />
  const e = ENTRIES.find((x) => x.id === s.id)
  if (!e) return null
  return (
    <div>
      <Header kind={e.kind === 'job' ? 'Entry point · JCL job' : 'Entry point · CICS transaction'} title={e.id} mono sub={e.desc || (e.kind === 'job' ? 'Batch job submitted by the scheduler.' : 'Started from a 3270 terminal.')} />
      <Hr />
      <RelRow from={<span className="font-mono text-[12px]">{e.id}</span>} verb={e.kind === 'job' ? 'runs' : 'starts'} to={<RefLink r={{ kind: 'program', id: e.program }} onPick={p.onPick} onHover={p.onHover}>{e.program}</RefLink>} />
    </div>
  )
}

const LENS_HELP: Record<Lens, string> = {
  migration: 'Blocks fill green as their programs move to Java. Cyan pulses are being shadowed right now.',
  coupling: 'Shared data is the coupling. Thicker taps and lanes mean more programs depend on that store. Tangled pockets are risky to cut first.',
  blast: 'Pick a program. Everything that reads what it writes, or calls it, lights up amber: that is what you retest.',
  owners: 'Each pocket is tinted by the team that owns it. Pins mark open questions waiting on a person.',
}

function SystemView(p: Props) {
  const counts = migrationCounts(p.mig)
  const prog = migrationProgress(p.mig)
  const tangled = [...POCKETS].sort((a, b) => a.isolation - b.isolation).slice(0, 4)
  return (
    <div>
      <Header kind="System · observed" title="AWS CardDemo" sub={`${PROGRAMS.length} programs in ${POCKETS.length} pockets, ${BUS_ORDER.length} shared data stores. Scanned at ${SOURCE.ref?.slice(0, 7)}.`} />
      <div className="px-4 pb-4 text-[12.5px] leading-relaxed text-[var(--color-muted)]">{LENS_HELP[p.lens]}</div>
      <Hr />
      {p.lens === 'migration' && (
        <div className="px-4 py-3">
          <Stat label="Codebase on Java" value={`${Math.round(prog * 100)}%`} color={C.good} sub="weighted by state; shadowing counts a third" />
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
            {MIGRATION_ORDER.slice()
              .reverse()
              .map((m) => (
                <div key={m} style={{ width: `${(counts[m] / PROGRAMS.length) * 100}%`, background: MIG_COLOR[m] }} />
              ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-y-1.5">
            {MIGRATION_ORDER.map((m) => (
              <div key={m} className="flex items-center gap-2 text-[12px] text-[var(--color-muted)]">
                <Dot color={MIG_COLOR[m]} pulse={m === 'shadowing'} /> {MIGRATION_META[m].label}
                <span className="tnum ml-auto mr-4 font-mono text-[11.5px] text-[var(--color-faint)]">{counts[m]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {p.lens === 'coupling' && (
        <div>
          <SectionHead>Most tangled pockets</SectionHead>
          {tangled.map((t) => (
            <PocketRow key={t.id} id={t.id} {...p} right={<span className="font-mono text-[11.5px]" style={{ color: isoColor(t.isolation) }}>{t.isolation.toFixed(2)} {isoWord(t.isolation)}</span>} />
          ))}
          <SectionHead>Busiest shared stores</SectionHead>
          {[...BUS_ORDER]
            .sort((a, b) => storeBlast(b).pockets.length - storeBlast(a).pockets.length)
            .map((s) => (
              <button key={s} type="button" onClick={() => p.onPick({ kind: 'store', id: s })} onMouseEnter={() => p.onHover({ kind: 'store', id: s })} onMouseLeave={() => p.onHover(null)} className="flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-[var(--color-panel)]">
                <span className="font-mono text-[12px] text-[var(--color-ink)]">{s}</span>
                <span className="truncate text-[11.5px] text-[var(--color-faint)]">{STORE[s].title}</span>
                <span className="ml-auto font-mono text-[11.5px] text-[var(--color-copper)]">{storeBlast(s).pockets.length} pockets</span>
              </button>
            ))}
        </div>
      )}
      {p.lens === 'blast' && p.blastSource && <BlastSummary id={p.blastSource} {...p} />}
      {p.lens === 'owners' && (
        <div>
          <SectionHead>Teams</SectionHead>
          {Object.values(TEAMS).map((t) => {
            const pockets = POCKETS.filter((x) => x.team === t.id)
            return (
              <div key={t.id} className="flex items-center gap-2.5 px-4 py-2">
                <Dot color={TEAM_COLOR[t.id]} />
                <span className="text-[12.5px] text-[var(--color-ink)]">{t.name}</span>
                <span className="font-mono text-[11.5px] text-[var(--color-muted)]">{t.owner}</span>
                <span className="ml-auto font-mono text-[11.5px] text-[var(--color-faint)]">{pockets.length} pockets</span>
              </div>
            )
          })}
          {p.live.pending > 0 && (
            <div className="mx-4 mt-2 rounded-[8px] border border-[rgba(217,164,65,.3)] px-3 py-2.5 text-[12px] text-[var(--color-muted)]">
              <span className="font-mono text-[var(--color-warn)]">{p.live.pending} open</span> question{p.live.pending > 1 ? 's' : ''} on <span className="font-mono text-[var(--color-ink)]">{p.live.id}</span>.{' '}
              <button type="button" className="text-[var(--color-accent)] hover:underline" onClick={() => p.setTab('people')}>
                Open People
              </button>
            </div>
          )}
        </div>
      )}
      <Hr />
      <SectionHead>Flows</SectionHead>
      {FLOWS.map((f) => (
        <button key={f.id} type="button" onClick={() => p.onFlow(f.id, 0)} className="group flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-[var(--color-panel)]">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[6px] border border-[var(--color-line-2)] text-[var(--color-muted)] group-hover:border-[var(--color-accent)] group-hover:text-[var(--color-accent)]">
            <Play className="size-3" />
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium text-[var(--color-ink)]">{f.title}</span>
            <span className="block text-[11.5px] text-[var(--color-faint)]">{f.summary} · {f.steps.length} steps</span>
          </span>
        </button>
      ))}
      <div className="h-4" />
    </div>
  )
}

function PocketRow({ id, right, onPick, onHover }: { id: string; right?: ReactNode } & Pick<Props, 'onPick' | 'onHover'>) {
  return (
    <button type="button" onClick={() => onPick({ kind: 'pocket', id })} onMouseEnter={() => onHover({ kind: 'pocket', id })} onMouseLeave={() => onHover(null)} className="flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-[var(--color-panel)]">
      <span className="truncate text-[12.5px] text-[var(--color-ink)]">{POCKET[id].title}</span>
      <span className="ml-auto shrink-0">{right}</span>
    </button>
  )
}

function BlastSummary({ id, onPick, onHover }: { id: string } & Pick<Props, 'onPick' | 'onHover'>) {
  const b = blastRadius(id)
  const byStore = new Map<string, string[]>()
  const callers: string[] = []
  for (const h of b.hits)
    for (const v of h.via) {
      if (v.store) byStore.set(v.store, [...(byStore.get(v.store) ?? []), h.program])
      if (v.caller) callers.push(h.program)
    }
  return (
    <div>
      <div className="px-4 py-3">
        <div className="text-[11.5px] text-[var(--color-faint)]">
          Changing <span className="font-mono text-[var(--color-accent)]">{id}</span> means retesting
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="tnum text-[30px] font-semibold tracking-[-0.03em] text-[var(--color-warn)]">{b.hits.length}</span>
          <span className="text-[13px] text-[var(--color-muted)]">programs in {b.pockets.length} pockets</span>
        </div>
        {b.hits.length === 0 && <div className="mt-1 text-[12px] text-[var(--color-faint)]">It writes nothing shared and nobody calls it. Safe to cut first.</div>}
      </div>
      {[...byStore.entries()].map(([s, progs]) => (
        <div key={s}>
          <SectionHead right={<span className="font-mono text-[10.5px] text-[var(--color-faint)]">{progs.length}</span>}>
            via {s} {STORE[s].shared ? '' : '(local)'}
          </SectionHead>
          <div className="flex flex-wrap gap-1.5 px-4">
            {progs.map((x) => (
              <RefLink key={x} r={{ kind: 'program', id: x }} onPick={onPick} onHover={onHover}>
                {x}
              </RefLink>
            ))}
          </div>
        </div>
      ))}
      {callers.length > 0 && (
        <div>
          <SectionHead>callers</SectionHead>
          <div className="flex flex-wrap gap-1.5 px-4">
            {callers.map((x) => (
              <RefLink key={x} r={{ kind: 'program', id: x }} onPick={onPick} onHover={onHover}>
                {x}
              </RefLink>
            ))}
          </div>
        </div>
      )}
      <div className="h-3" />
    </div>
  )
}

function PocketDetail({ id, ...p }: { id: string } & Props) {
  const pk = POCKET[id]
  const shared = sharedStoresOfPocket(id)
  const locals = localStoresOfPocket(id)
  const prog = migrationProgress(p.mig, pk.programs)
  return (
    <div>
      <Header kind={<>Pocket · {DOMAIN[pk.domain].title}</>} title={pk.title} sub={`${pk.programs.length} programs · ${pk.loc.toLocaleString()} lines · owned by ${TEAMS[pk.team].owner} (${TEAMS[pk.team].name})`} />
      <div className="grid grid-cols-3 gap-3 px-4 pb-4">
        <Stat label="On Java" value={`${Math.round(prog * 100)}%`} color={p.lens === 'migration' ? C.good : undefined} />
        <Stat label="Isolation" value={pk.isolation.toFixed(2)} color={p.lens === 'coupling' ? isoColor(pk.isolation) : undefined} sub={isoWord(pk.isolation)} />
        <Stat label="Bus taps" value={cutCost(id)} sub="cut cost" />
      </div>
      <Hr />
      <SectionHead>Programs</SectionHead>
      {pk.programs.map((x) => {
        const m = p.mig[x] ?? 'legacy'
        return (
          <button key={x} type="button" onClick={() => p.onPick({ kind: 'program', id: x })} onMouseEnter={() => p.onHover({ kind: 'program', id: x })} onMouseLeave={() => p.onHover(null)} className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left hover:bg-[var(--color-panel)]">
            <span className="font-mono text-[12px] text-[var(--color-ink)]">{x}</span>
            <span className="truncate text-[11.5px] text-[var(--color-faint)]">{PROGRAM[x].title}</span>
            <span className="ml-auto shrink-0">
              <Chip color={MIG_COLOR[m] === MIG_COLOR.legacy ? undefined : MIG_COLOR[m]}>{MIGRATION_META[m].label}</Chip>
            </span>
          </button>
        )
      })}
      <SectionHead>Data</SectionHead>
      <div className="flex flex-wrap gap-1.5 px-4">
        {shared.map((s) => (
          <button key={s} type="button" onClick={() => p.onPick({ kind: 'store', id: s })} onMouseEnter={() => p.onHover({ kind: 'store', id: s })} onMouseLeave={() => p.onHover(null)} className="rounded-[6px] border border-[rgba(176,141,87,.45)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-copper)] hover:border-[var(--color-copper)]">
            {s}
          </button>
        ))}
        {locals.map((s) => (
          <button key={s} type="button" onClick={() => p.onPick({ kind: 'store', id: s })} onMouseEnter={() => p.onHover({ kind: 'store', id: s })} onMouseLeave={() => p.onHover(null)} className="rounded-[6px] border border-[var(--color-line-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-muted)] hover:border-[var(--color-faint)]">
            {s}
          </button>
        ))}
      </div>
      <div className="px-4 pt-2 text-[11px] text-[var(--color-faint)]">Copper = on the shared bus. Grey = only this pocket uses it.</div>
      <div className="h-4" />
    </div>
  )
}

function ProgramDetail({ id, ...p }: { id: string } & Props) {
  const pr = PROGRAM[id]
  const pk = POCKET[pr.pocket]
  const m = p.mig[id] ?? 'legacy'
  const isLive = p.live.id === id
  const io = ioOf(id)
  const b = blastRadius(id)
  const L = (r: Ref, label: string) => (
    <RefLink r={r} onPick={p.onPick} onHover={p.onHover}>
      {label}
    </RefLink>
  )
  const self = <span className="font-mono text-[12px] text-[var(--color-ink)]">{id}</span>
  return (
    <div>
      <Header
        kind={<>Program · {pr.mode} · {pr.lang} · {pr.loc.toLocaleString()} lines</>}
        title={id}
        mono
        sub={
          <>
            {pr.title}. In{' '}
            <button type="button" className="text-[var(--color-ink)] underline decoration-[var(--color-line-2)] underline-offset-[3px] hover:text-[var(--color-accent)]" onClick={() => p.onPick({ kind: 'pocket', id: pk.id })}>
              {pk.title}
            </button>
            , owned by {TEAMS[pk.team].owner}.
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
        <Chip color={m === 'legacy' ? undefined : MIG_COLOR[m]}>{MIGRATION_META[m].label}</Chip>
        <Chip color={isoColor(pk.isolation)}>pocket {pk.isolation.toFixed(2)} {isoWord(pk.isolation)}</Chip>
        {entriesOf(id).map((e) => (
          <Chip key={e.id} mono>
            {e.kind === 'job' ? 'job' : 'cics'} {e.id}
          </Chip>
        ))}
        <a
          href={sourceUrl(id)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 rounded-[6px] border border-[var(--color-line-2)] px-2 py-[2px] text-[11px] font-medium text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          title={`Open ${id} source on GitHub (AWS CardDemo)`}
        >
          <Code2 className="size-3" /> View source
        </a>
      </div>

      {isLive && (
        <div className="mx-4 mb-3 rounded-[10px] border border-[rgba(76,201,240,.28)] bg-[rgba(76,201,240,.05)] px-3.5 py-3">
          <div className="flex items-center gap-2 text-[11.5px] text-[var(--color-accent)]">
            <Dot color={C.accent} pulse /> Shadowing now · {p.live.status}
          </div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span className="tnum text-[30px] font-semibold tracking-[-0.03em]" style={{ color: p.live.matchRate >= p.live.threshold ? C.good : C.ink }}>
              {(p.live.matchRate * 100).toFixed(1)}%
            </span>
            <span className="text-[12px] text-[var(--color-muted)]">old vs new agree · cutover at {(p.live.threshold * 100).toFixed(0)}%</span>
          </div>
          <div className="relative mt-2 h-1 rounded-full bg-[var(--color-panel-2)]">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${p.live.matchRate * 100}%`, background: p.live.matchRate >= p.live.threshold ? C.good : C.accent }} />
            <div className="absolute -top-1 h-3 w-px bg-[var(--color-ink)]" style={{ left: `${p.live.threshold * 100}%` }} />
          </div>
          {p.live.pending > 0 && (
            <button type="button" onClick={() => p.setTab('people')} className="mt-2.5 text-[12px] text-[var(--color-warn)] hover:underline">
              {p.live.pending} question{p.live.pending > 1 ? 's' : ''} waiting on a person →
            </button>
          )}
        </div>
      )}

      {p.lens === 'blast' ? (
        <>
          <Hr />
          <BlastSummary id={id} onPick={p.onPick} onHover={p.onHover} />
        </>
      ) : (
        <div className="grid grid-cols-3 gap-3 px-4 pb-3">
          <Stat label="Reads" value={io.filter((r) => r.mode !== 'write').length} />
          <Stat label="Writes" value={io.filter((r) => r.mode !== 'read').length} />
          <Stat label="Retest if changed" value={b.hits.length} color={b.hits.length > 8 ? C.warn : undefined} />
        </div>
      )}

      <Hr />
      <SectionHead>Relationships</SectionHead>
      {entriesOf(id).map((e) => (
        <RelRow key={e.id} from={L({ kind: 'entry', id: e.id }, e.id)} verb={e.kind === 'job' ? 'runs' : 'starts'} to={self} />
      ))}
      {io.map((r) => (
        <RelRow
          key={r.store}
          from={self}
          verb={r.mode === 'readwrite' ? 'reads + writes' : r.mode === 'write' ? 'writes' : 'reads'}
          to={L({ kind: 'store', id: r.store }, r.store)}
          tone={STORE[r.store].shared ? C.copper : undefined}
        />
      ))}
      {callsFrom(id).map((c) => (
        <RelRow key={`f-${c.to}`} from={self} verb={c.kind === 'transfers' ? 'XCTL to' : c.kind} to={L({ kind: 'program', id: c.to }, c.to)} />
      ))}
      {callsTo(id).map((c) => (
        <RelRow key={`t-${c.from}`} from={L({ kind: 'program', id: c.from }, c.from)} verb={c.kind === 'transfers' ? 'XCTL to' : c.kind} to={self} />
      ))}
      <div className="h-4" />
    </div>
  )
}

function StoreDetail({ id, ...p }: { id: string } & Props) {
  const st = STORE[id]
  const sb = storeBlast(id)
  const kind = { vsam: 'VSAM file', sequential: 'Sequential file', db2: 'DB2 table', ims: 'IMS database', mq: 'MQ queue' }[st.kind]
  return (
    <div>
      <Header kind={<>Data store · {kind} · {st.shared ? 'shared bus' : 'local'}</>} title={id} mono sub={st.title} />
      <div className="grid grid-cols-3 gap-3 px-4 pb-3">
        <Stat label="Writers" value={sb.writers.length} />
        <Stat label="Readers" value={sb.readers.length} />
        <Stat label="Pockets" value={sb.pockets.length} color={sb.pockets.length > 4 ? C.warn : undefined} />
      </div>
      {st.shared && sb.pockets.length > 1 && (
        <div className="px-4 pb-3 text-[12px] leading-relaxed text-[var(--color-muted)]">
          Changing this record layout touches {sb.pockets.length} pockets. This is where the codebase is coupled.
        </div>
      )}
      <Hr />
      <SectionHead>Who touches it</SectionHead>
      {[...new Set([...sb.writers, ...sb.readers])].map((x) => {
        const w = sb.writers.includes(x)
        const r = sb.readers.includes(x)
        return (
          <RelRow
            key={x}
            from={
              <RefLink r={{ kind: 'program', id: x }} onPick={p.onPick} onHover={p.onHover}>
                {x}
              </RefLink>
            }
            verb={w && r ? 'reads + writes' : w ? 'writes' : 'reads'}
            to={<span className="font-mono text-[12px] text-[var(--color-ink)]">{id}</span>}
            tone={w ? C.copper : undefined}
          />
        )
      })}
      <SectionHead>Physical datasets</SectionHead>
      <div className="space-y-0.5 px-4 pb-4">
        {st.datasets.map((d) => (
          <div key={d} className="truncate font-mono text-[11px] text-[var(--color-faint)]">
            {d}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------ flows ------------------------------ */

function FlowPanel({ flow, onFlow, onPick, onHover }: Props & { flow: { flow: Flow; step: number } }) {
  const { flow: f, step } = flow
  const name = (r: { kind: string; id: string }) => r.id
  return (
    <div>
      <div className="flex items-center gap-2 px-4 pt-3">
        <button type="button" onClick={() => onFlow(null)} className="inline-flex items-center gap-1 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-ink)]">
          <ChevronLeft className="size-3.5" /> Back to overview
        </button>
      </div>
      <Header kind="Flow" title={f.title} sub={f.summary} />
      <div className="flex items-center gap-2 px-4 pb-3">
        <Btn variant="outline" disabled={step <= 0} onClick={() => onFlow(f.id, step - 1)}>
          <ChevronLeft className="size-3.5" /> Previous
        </Btn>
        <Btn variant="primary" disabled={step >= f.steps.length - 1} onClick={() => onFlow(f.id, step + 1)}>
          Next <ChevronRight className="size-3.5" />
        </Btn>
        <span className="tnum ml-auto font-mono text-[11.5px] text-[var(--color-faint)]">
          {step + 1} / {f.steps.length}
        </span>
      </div>
      <Hr />
      <ol className="py-1">
        {f.steps.map((s, i) => {
          const on = i === step
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onFlow(f.id, i)}
                className={cn('flex w-full gap-3 px-4 py-2 text-left transition-colors', on ? 'bg-[rgba(76,201,240,.07)]' : 'hover:bg-[var(--color-panel)]')}
              >
                <span className={cn('tnum mt-[1px] w-4 shrink-0 font-mono text-[11.5px]', on ? 'text-[var(--color-accent)]' : 'text-[var(--color-faint)]')}>{i + 1}</span>
                <span className="min-w-0">
                  <span className={cn('block font-mono text-[12px]', on ? 'text-[var(--color-ink)]' : 'text-[var(--color-muted)]')}>
                    {name(s.from)} <span className="text-[var(--color-faint)]">{s.verb}</span> {name(s.to)}
                  </span>
                  {on && <span className="mt-0.5 block text-[12px] leading-snug text-[var(--color-muted)]">{s.note}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="px-4 pb-4 pt-1 text-[11px] text-[var(--color-faint)]">
        Tip: <span className="font-mono">←</span> <span className="font-mono">→</span> step through.{' '}
        <button type="button" className="underline" onClick={() => onPick({ kind: 'program', id: f.steps[step].from.kind === 'program' ? f.steps[step].from.id : (f.steps[step].to.id) })} onMouseEnter={() => onHover(null)}>
          Inspect this step
        </button>
      </div>
    </div>
  )
}

/* --------------------------- agent / people ------------------------ */

function AgentPanel({ log, live }: { log: AgentThought[]; live: LiveInfo }) {
  return (
    <div>
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <Dot color={C.accent} pulse />
        <span className="text-[12.5px] text-[var(--color-ink)]">Nemotron</span>
        <span className="text-[12px] text-[var(--color-faint)]">working on</span>
        <span className="font-mono text-[12px] text-[var(--color-accent)]">{live.id}</span>
      </div>
      {log.length === 0 && <div className="px-4 py-8 text-center text-[12px] text-[var(--color-faint)]">No agent activity yet. Press Replay.</div>}
      <ol>
        {log.map((t) => (
          <li key={t.id} className="grid grid-cols-[52px_1fr] gap-x-3 border-b border-[var(--color-line)] px-4 py-2.5">
            <span className="pt-[1px] font-mono text-[10.5px] text-[var(--color-faint)]">{t.at.slice(11, 19) || t.at}</span>
            <div className="min-w-0">
              <span className="font-mono text-[10.5px] text-[var(--color-accent)]">{t.phase}</span>
              <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--color-muted)]">{t.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function PeoplePanel({ pending, decisions, onAnswer }: { pending: PendingQuestion[]; decisions: Decision[]; onAnswer: (a: 'old' | 'new') => void }) {
  return (
    <div>
      <SectionHead>Waiting on a person</SectionHead>
      {pending.length === 0 && <div className="px-4 pb-3 text-[12px] text-[var(--color-faint)]">Nothing waiting. Every open mismatch has an answer.</div>}
      {pending.map((q) => (
        <div key={q.groupId} className="border-b border-[var(--color-line)] px-4 pb-3.5 pt-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-[var(--color-agent)]">{q.owner}</span>
            <span className="text-[11.5px] text-[var(--color-faint)]">
              {q.team} · via {q.routedBy}
            </span>
            <span className="ml-auto">
              <Chip color={C.warn}>{q.active ? 'asked on Slack' : 'queued'}</Chip>
            </span>
          </div>
          <p className="mt-1.5 text-[13px] leading-snug text-[var(--color-ink)]">{q.question}</p>
          <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-[var(--color-line)] bg-[var(--color-line)] font-mono text-[11.5px]">
            <div className="bg-[var(--color-panel)] px-2.5 py-1.5">
              <div className="text-[10px] text-[var(--color-faint)]">COBOL today</div>
              <div className="truncate text-[var(--color-ink)]">{q.old}</div>
            </div>
            <div className="bg-[var(--color-panel)] px-2.5 py-1.5">
              <div className="text-[10px] text-[var(--color-faint)]">Java rewrite</div>
              <div className="truncate text-[var(--color-ink)]">{q.new}</div>
            </div>
          </div>
          <div className="mt-1.5 text-[11px] text-[var(--color-faint)]">
            settles {q.cases} cases · Jev confidence {q.confidence.toFixed(2)} · becomes test <span className="font-mono">{q.testId}</span>
          </div>
          {q.active && (
            <div className="mt-2.5 flex gap-2">
              <Btn variant="primary" onClick={() => onAnswer('old')}>
                Keep COBOL behavior
              </Btn>
              <Btn variant="outline" onClick={() => onAnswer('new')}>
                Use the rewrite
              </Btn>
            </div>
          )}
        </div>
      ))}
      <SectionHead>Answered</SectionHead>
      {decisions.length === 0 && <div className="px-4 pb-4 text-[12px] text-[var(--color-faint)]">No answers yet.</div>}
      {decisions.map((d) => (
        <div key={d.id} className="border-b border-[var(--color-line)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-[var(--color-agent)]">{d.answeredBy}</span>
            <Chip color={C.good}>answered</Chip>
            <span className="ml-auto font-mono text-[11px] text-[var(--color-faint)]">{d.testId}</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-muted)]">{d.question}</p>
          <div className="mt-1 text-[11px] text-[var(--color-faint)]">became a test · settled {d.resolvedCount} cases</div>
        </div>
      ))}
      <div className="h-4" />
    </div>
  )
}

