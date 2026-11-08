import { useEffect, useState } from 'react'
import { ChevronRight, PanelLeftClose } from 'lucide-react'
import {
  BUS_ORDER,
  DOMAINS,
  POCKET,
  PROGRAM,
  STORE,
  TEAMS,
  migrationProgress,
  pocketsUsingStore,
  type MigrationMap,
  type Ref,
} from '@/data/carddemo'
import { C, MIG_COLOR, TEAM_COLOR, isoColor } from '@/components/map/theme'
import type { Highlight } from '@/components/map/highlight'
import type { Lens } from '@/components/map/MapCanvas'
import { cn } from '@/lib/cn'
import { IconBtn } from './kit'

/* Left panel: the architecture as a tree. Domain → pocket → program, then the
 * shared bus. Rows mirror the map: hover lights it up, click flies there. */

export function Hierarchy({
  lens,
  focus,
  selection,
  hl,
  mig,
  onPick,
  onHover,
  onCollapse,
}: {
  lens: Lens
  focus: string | null
  selection: Ref | null
  hl: Highlight | null
  mig: MigrationMap
  onPick: (r: Ref) => void
  onHover: (r: Ref | null) => void
  onCollapse: () => void
}) {
  const [openSet, setOpen] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (focus) setOpen((s) => new Set(s).add(focus))
  }, [focus])
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const pocketPip = (id: string) => {
    const p = POCKET[id]
    if (lens === 'coupling') return isoColor(p.isolation)
    if (lens === 'owners') return TEAM_COLOR[p.team]
    if (lens === 'blast' && hl) {
      if (p.programs.some((x) => hl.programs.get(x) === 'source')) return C.accent
      if (p.programs.some((x) => hl.programs.get(x) === 'hit')) return C.warn
      return C.block
    }
    const prog = migrationProgress(mig, p.programs)
    return prog >= 0.95 ? MIG_COLOR.done : prog >= 0.5 ? MIG_COLOR.cutover : prog > 0 ? '#5B7A70' : MIG_COLOR.legacy
  }
  const pocketMeta = (id: string) => {
    const p = POCKET[id]
    if (lens === 'coupling') return p.isolation.toFixed(2)
    if (lens === 'owners') return TEAMS[p.team].owner
    if (lens === 'blast' && hl) {
      const n = p.programs.filter((x) => hl.programs.get(x) === 'hit').length
      return n ? `${n}` : ''
    }
    return `${Math.round(migrationProgress(mig, p.programs) * 100)}%`
  }
  const progPip = (id: string) => {
    if (lens === 'migration') return MIG_COLOR[mig[id] ?? 'legacy']
    if (lens === 'blast' && hl) {
      const r = hl.programs.get(id)
      return r === 'source' ? C.accent : r === 'hit' ? C.warn : C.block
    }
    return pocketPip(PROGRAM[id].pocket)
  }

  const isSel = (k: Ref['kind'], id: string) => selection?.kind === k && selection.id === id

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg-2)]">
      <div className="flex h-11 items-center justify-between border-b border-[var(--color-line)] pl-4 pr-1.5">
        <span className="eyebrow">Hierarchy</span>
        <IconBtn label="Collapse hierarchy" onClick={onCollapse}>
          <PanelLeftClose className="size-4" />
        </IconBtn>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <div className="px-4 pb-1.5 pt-3.5 text-[11px] text-[var(--color-faint)]">Pockets by domain</div>
        {DOMAINS.filter((d) => d.pockets.length).map((d) => (
          <div key={d.id} className="mb-1">
            <div className="flex items-center gap-2 px-4 py-1.5">
              <span className="size-1.5 rounded-full" style={{ background: TEAM_COLOR[d.team] }} />
              <span className="truncate text-[12px] font-medium text-[var(--color-muted)]">{d.title}</span>
              <span className="ml-auto font-mono text-[10.5px] text-[var(--color-faint)]">{TEAMS[d.team].owner}</span>
            </div>
            {d.pockets.map((pid) => {
              const p = POCKET[pid]
              const expanded = openSet.has(pid)
              const focused = focus === pid
              return (
                <div key={pid}>
                  <div
                    className={cn(
                      'group mx-2 flex h-7 items-center gap-1.5 rounded-[6px] pl-1 pr-2 transition-colors',
                      focused ? 'bg-[var(--color-panel-2)]' : 'hover:bg-[var(--color-panel)]',
                      isSel('pocket', pid) && 'shadow-[inset_0_0_0_1px_var(--color-accent)]',
                    )}
                    onMouseEnter={() => onHover({ kind: 'pocket', id: pid })}
                    onMouseLeave={() => onHover(null)}
                  >
                    <button type="button" aria-label={expanded ? `Collapse ${p.title}` : `Expand ${p.title}`} onClick={() => toggle(pid)} className="grid size-5 place-items-center text-[var(--color-faint)] hover:text-[var(--color-ink)]">
                      <ChevronRight className={cn('size-3.5 transition-transform duration-200', expanded && 'rotate-90')} />
                    </button>
                    <button type="button" onClick={() => onPick({ kind: 'pocket', id: pid })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: pocketPip(pid) }} />
                      <span className={cn('truncate text-[12.5px]', focused ? 'text-[var(--color-ink)]' : 'text-[var(--color-muted)] group-hover:text-[var(--color-ink)]')}>{p.title}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10.5px] text-[var(--color-faint)]">{pocketMeta(pid)}</span>
                    </button>
                  </div>
                  {expanded &&
                    p.programs.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onPick({ kind: 'program', id })}
                        onMouseEnter={() => onHover({ kind: 'program', id })}
                        onMouseLeave={() => onHover(null)}
                        className={cn(
                          'mx-2 flex h-6 w-[calc(100%-16px)] items-center gap-2 rounded-[6px] pl-9 pr-2 text-left transition-colors hover:bg-[var(--color-panel)]',
                          isSel('program', id) && 'bg-[var(--color-panel-2)] shadow-[inset_0_0_0_1px_var(--color-accent)]',
                        )}
                      >
                        <span className="size-1.5 shrink-0 rounded-[2px]" style={{ background: progPip(id) }} />
                        <span className="font-mono text-[11.5px] text-[var(--color-ink)]">{id}</span>
                        <span className="truncate text-[11px] text-[var(--color-faint)]">{PROGRAM[id].title}</span>
                      </button>
                    ))}
                </div>
              )
            })}
          </div>
        ))}

        <div className="mt-2 border-t border-[var(--color-line)] px-4 pb-1.5 pt-3.5 text-[11px] text-[var(--color-faint)]">Shared data bus</div>
        {BUS_ORDER.map((s) => {
          const lit = hl?.stores.has(s)
          return (
            <button
              key={s}
              type="button"
              onClick={() => onPick({ kind: 'store', id: s })}
              onMouseEnter={() => onHover({ kind: 'store', id: s })}
              onMouseLeave={() => onHover(null)}
              className={cn(
                'mx-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-[6px] px-2 text-left transition-colors hover:bg-[var(--color-panel)]',
                isSel('store', s) && 'bg-[var(--color-panel-2)] shadow-[inset_0_0_0_1px_var(--color-accent)]',
              )}
            >
              <span className="h-[2px] w-3 shrink-0 rounded" style={{ background: lit ? (hl?.tone === 'warn' ? C.warn : C.accent) : C.copper }} />
              <span className="font-mono text-[11.5px] text-[var(--color-ink)]">{s}</span>
              <span className="truncate text-[11px] text-[var(--color-faint)]">{STORE[s].title}</span>
              <span className="ml-auto shrink-0 font-mono text-[10.5px] text-[var(--color-faint)]">×{pocketsUsingStore(s).length}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
