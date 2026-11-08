import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, PanelLeftClose, Search } from 'lucide-react'
import {
  BUS_ORDER,
  DOMAINS,
  POCKET,
  STORE,
  TEAMS,
  migrationProgress,
  pocketsUsingStore,
  type MigrationMap,
  type Ref,
} from '@/data/carddemo'
import { C, TEAM_COLOR } from '@/components/map/theme'
import type { Highlight } from '@/components/map/highlight'
import type { Lens } from '@/components/map/MapCanvas'
import { cn } from '@/lib/cn'
import { IconBtn } from './kit'

/* Left panel: the system as a short list of business domains. Collapsed by
 * default; open one at a time. Isolation shown in plain words, not decimals;
 * domain color is the only grouping color. */

function isoWords(iso: number) {
  return iso >= 0.6 ? 'Easy to move' : iso >= 0.3 ? 'Some ties' : 'Tangled'
}

interface Props {
  lens: Lens
  focus: string | null
  selection: Ref | null
  hl: Highlight | null
  mig: MigrationMap
  onPick: (r: Ref) => void
  onHover: (r: Ref | null) => void
  onCollapse: () => void
}

export function Hierarchy(props: Props) {
  const { focus, selection, mig, onPick, onHover, onCollapse } = props
  const [open, setOpen] = useState<string | null>(DOMAINS[0]?.id ?? null)
  const [q, setQ] = useState('')

  // opening a domain from the map keeps the tree in sync
  useEffect(() => {
    if (focus) {
      const d = POCKET[focus]?.domain
      if (d) setOpen(d)
    }
  }, [focus])

  const domains = useMemo(() => DOMAINS.filter((d) => d.pockets.length), [])
  const search = q.trim().toLowerCase()
  const match = (pid: string) =>
    !search || POCKET[pid].short.toLowerCase().includes(search) || POCKET[pid].title.toLowerCase().includes(search)

  const isSel = (pid: string) => selection?.kind === 'pocket' && selection.id === pid

  return (
    <aside className="flex h-full w-[268px] shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg-2)]">
      <div className="flex h-11 items-center justify-between border-b border-[var(--color-line)] pl-4 pr-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-ink)]">Systems</span>
        <IconBtn label="Collapse panel" onClick={onCollapse}>
          <PanelLeftClose className="size-4" />
        </IconBtn>
      </div>

      {/* search */}
      <div className="px-3 pb-1 pt-3">
        <div className="flex h-8 items-center gap-2 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 focus-within:border-[var(--color-line-2)]">
          <Search className="size-3.5 text-[var(--color-faint)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter areas"
            className="h-full w-full bg-transparent text-[12.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-1">
        {domains.map((d) => {
          const areas = d.pockets.filter(match)
          if (search && !areas.length) return null
          const expanded = search ? true : open === d.id
          const prog = Math.round(migrationProgress(mig, d.pockets.flatMap((pid) => POCKET[pid].programs)) * 100)
          const sorted = [...areas].sort((a, b) => POCKET[b].isolation - POCKET[a].isolation)
          return (
            <div key={d.id} className="mb-0.5">
              <button
                type="button"
                onClick={() => !search && setOpen((o) => (o === d.id ? null : d.id))}
                onMouseEnter={() => onHover(null)}
                className="group w-full rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-panel)]"
              >
                <div className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: TEAM_COLOR[d.team] }} />
                  <span className="truncate text-[13px] font-medium text-[var(--color-ink)]">{d.title}</span>
                  <span className="tnum ml-auto shrink-0 text-[11px] text-[var(--color-good)]">{prog}% on Java</span>
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 text-[var(--color-faint)] transition-all duration-200',
                      expanded ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                  />
                </div>
                <div className="mt-1 flex items-center gap-2.5 pl-4">
                  <span className="shrink-0 text-[11px] text-[var(--color-faint)]">
                    {d.pockets.length} areas · {TEAMS[d.team].owner}
                  </span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
                    <div className="h-full rounded-full bg-[var(--color-good)]" style={{ width: `${prog}%` }} />
                  </div>
                </div>
              </button>

              {expanded && (
                <div className="mb-1 mt-0.5">
                  {d.desc && (
                    <p className="line-clamp-1 px-2 pb-1 pl-4 text-[11px] leading-snug text-[var(--color-faint)]" title={d.desc}>
                      {d.desc}
                    </p>
                  )}
                  {sorted.map((pid) => (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => onPick({ kind: 'pocket', id: pid })}
                      onMouseEnter={() => onHover({ kind: 'pocket', id: pid })}
                      onMouseLeave={() => onHover(null)}
                      title={POCKET[pid].title}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-[6px] py-[5px] pl-6 pr-2 text-left transition-colors hover:bg-[var(--color-panel)]',
                        isSel(pid) && 'bg-[var(--color-panel-2)] shadow-[inset_0_0_0_1px_var(--color-accent)]',
                      )}
                    >
                      <span className={cn('truncate text-[12.5px]', isSel(pid) ? 'text-[var(--color-ink)]' : 'text-[var(--color-muted)]')}>
                        {POCKET[pid].short}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-[var(--color-faint)]">{isoWords(POCKET[pid].isolation)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* shared data */}
        <div className="mt-3 border-t border-[var(--color-line)] px-2 pb-1 pt-3 text-[11px] text-[var(--color-faint)]">Shared data</div>
        {BUS_ORDER.filter((s) => !search || s.toLowerCase().includes(search) || STORE[s].title.toLowerCase().includes(search)).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick({ kind: 'store', id: s })}
            onMouseEnter={() => onHover({ kind: 'store', id: s })}
            onMouseLeave={() => onHover(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left transition-colors hover:bg-[var(--color-panel)]',
              selection?.kind === 'store' && selection.id === s && 'bg-[var(--color-panel-2)] shadow-[inset_0_0_0_1px_var(--color-accent)]',
            )}
          >
            <span className="h-[2px] w-3 shrink-0 rounded" style={{ background: C.copper }} />
            <span className="truncate text-[12.5px] text-[var(--color-muted)]" title={STORE[s].title}>{STORE[s].title}</span>
            <span className="ml-auto shrink-0 text-[11px] text-[var(--color-faint)]">{pocketsUsingStore(s).length} areas</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
