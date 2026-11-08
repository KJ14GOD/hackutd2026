import { useMemo, useState } from 'react'
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
import { C, TEAM_COLOR, isoColor, isoWord } from '@/components/map/theme'
import { cn } from '@/lib/cn'
import { IconBtn } from './kit'

/* Left panel: the system as a short list of business domains. One open at a
 * time. Pockets show isolation in words; data stores show id and name together
 * so they match the labels on the map. Nothing truncates: long text wraps. */

interface Props {
  focus: string | null
  selection: Ref | null
  mig: MigrationMap
  onPick: (r: Ref) => void
  onHover: (r: Ref | null) => void
  onCollapse: () => void
}

export function Hierarchy({ focus, selection, mig, onPick, onHover, onCollapse }: Props) {
  const [open, setOpen] = useState<string | null>(DOMAINS[0]?.id ?? null)
  const [q, setQ] = useState('')

  // flying into a pocket on the map opens its domain here (adjusted during
  // render, React's pattern for state that follows a prop)
  const [seenFocus, setSeenFocus] = useState(focus)
  if (focus !== seenFocus) {
    setSeenFocus(focus)
    const d = focus ? POCKET[focus]?.domain : null
    if (d) setOpen(d)
  }

  const domains = useMemo(() => DOMAINS.filter((d) => d.pockets.length), [])
  const search = q.trim().toLowerCase()
  const match = (pid: string) => !search || POCKET[pid].short.toLowerCase().includes(search) || POCKET[pid].title.toLowerCase().includes(search)
  const isSel = (k: Ref['kind'], id: string) => selection?.kind === k && selection.id === id
  const stores = BUS_ORDER.filter((s) => !search || s.toLowerCase().includes(search) || STORE[s].title.toLowerCase().includes(search))

  return (
    <aside className="flex h-full w-[268px] shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg-2)]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-line)] pl-4 pr-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-ink)]">Systems</span>
        <IconBtn label="Hide systems panel" onClick={onCollapse}>
          <PanelLeftClose className="size-4" />
        </IconBtn>
      </div>

      <div className="px-3 pb-1 pt-3">
        <label className="flex h-8 items-center gap-2 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 focus-within:border-[var(--color-line-2)]">
          <Search className="size-3.5 shrink-0 text-[var(--color-faint)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter pockets and data"
            aria-label="Filter pockets and data stores"
            className="h-full w-full bg-transparent text-[12.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 pt-1">
        {domains.map((d) => {
          const pockets = d.pockets.filter(match)
          if (search && !pockets.length) return null
          const expanded = search ? true : open === d.id
          const prog = Math.round(migrationProgress(mig, d.pockets.flatMap((pid) => POCKET[pid].programs)) * 100)
          const sorted = [...pockets].sort((a, b) => POCKET[b].isolation - POCKET[a].isolation)
          return (
            <div key={d.id} className="mb-0.5">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => !search && setOpen((o) => (o === d.id ? null : d.id))}
                onMouseEnter={() => onHover(null)}
                className="group w-full rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-panel)]"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-[5px] size-2 shrink-0 rounded-full" style={{ background: TEAM_COLOR[d.team] }} />
                  <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-[var(--color-ink)]">{d.title}</span>
                  <ChevronRight
                    className={cn(
                      'mt-[2px] size-3.5 shrink-0 text-[var(--color-faint)] transition-all duration-200',
                      expanded ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                  />
                </div>
                <div className="mt-1 flex items-center gap-2 pl-4">
                  <span className="shrink-0 text-[11px] text-[var(--color-faint)]">
                    {d.pockets.length} pocket{d.pockets.length > 1 ? 's' : ''} · {TEAMS[d.team].owner}
                  </span>
                  <div className="h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
                    <div className="h-full rounded-full bg-[var(--color-good)]" style={{ width: `${prog}%` }} />
                  </div>
                  <span className="tnum shrink-0 text-[11px] text-[var(--color-good)]">{prog}% on Java</span>
                </div>
              </button>

              {expanded && (
                <div className="mb-1 mt-0.5">
                  {d.desc && <p className="px-2 pb-1.5 pl-6 text-[11.5px] leading-snug text-[var(--color-faint)]">{d.desc}</p>}
                  {sorted.map((pid) => (
                    <button
                      key={pid}
                      type="button"
                      onClick={() => onPick({ kind: 'pocket', id: pid })}
                      onMouseEnter={() => onHover({ kind: 'pocket', id: pid })}
                      onMouseLeave={() => onHover(null)}
                      title={POCKET[pid].title}
                      className={cn(
                        'flex w-full items-baseline gap-2 rounded-[6px] py-[5px] pl-6 pr-2 text-left transition-colors hover:bg-[var(--color-panel)]',
                        (isSel('pocket', pid) || focus === pid) && 'bg-[var(--color-panel-2)]',
                        isSel('pocket', pid) && 'shadow-[inset_0_0_0_1px_var(--color-accent)]',
                      )}
                    >
                      <span className={cn('min-w-0 flex-1 text-[12.5px] leading-snug', isSel('pocket', pid) || focus === pid ? 'text-[var(--color-ink)]' : 'text-[var(--color-muted)]')}>
                        {POCKET[pid].short}
                      </span>
                      <span className="shrink-0 text-[11px]" style={{ color: isoColor(POCKET[pid].isolation) }}>
                        {isoWord(POCKET[pid].isolation)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {stores.length > 0 && <div className="mt-3 border-t border-[var(--color-line)] px-2 pb-1 pt-3 text-[11px] text-[var(--color-faint)]">Shared data stores</div>}
        {stores.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick({ kind: 'store', id: s })}
            onMouseEnter={() => onHover({ kind: 'store', id: s })}
            onMouseLeave={() => onHover(null)}
            className={cn(
              'flex w-full items-start gap-2 rounded-[6px] px-2 py-[5px] text-left transition-colors hover:bg-[var(--color-panel)]',
              isSel('store', s) && 'bg-[var(--color-panel-2)] shadow-[inset_0_0_0_1px_var(--color-accent)]',
            )}
          >
            <span className="mt-[7px] h-[2px] w-3 shrink-0 rounded" style={{ background: C.copper }} />
            <span className="min-w-0 flex-1 leading-snug">
              <span className="block font-mono text-[11.5px] text-[var(--color-ink)]">{s}</span>
              <span className="block text-[11.5px] text-[var(--color-faint)]">{STORE[s].title}</span>
            </span>
            <span className="mt-[1px] shrink-0 text-[11px] text-[var(--color-faint)]">{pocketsUsingStore(s).length} pockets</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
