import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ClipboardCheck, Inbox, Map as MapIcon, MessagesSquare, Users } from 'lucide-react'
import { inbox } from '@/data/requirements'
import { useStore } from '@/store/useStore'
import { useUi, type Workspace } from '@/store/useUi'
import { cn } from '@/lib/cn'

/* The left rail: the map plus the four requirements workspaces. Badges are
 * counts for whoever is "viewing as": proposed requirements, questions routed
 * to them, and what waits in their inbox. */

export function Rail() {
  const ws = useUi((s) => s.workspace)
  const go = useUi((s) => s.go)
  const me = useUi((s) => s.viewerId)
  const [proposed, questions, waiting] = useStore(
    useShallow((s) => {
      const w = s.reqs
      return [
        Object.values(w.requirements).filter((r) => r.status === 'proposed').length,
        Object.values(w.questions).filter((q) => q.status !== 'answered' && q.routedTo.includes(me)).length,
        inbox(w, me).reduce((n, g) => n + g.items.length, 0),
      ]
    }),
  )
  const items: { id: Workspace; label: string; icon: ReactNode; badge?: number; hint: string }[] = [
    { id: 'map', label: 'Map', icon: <MapIcon className="size-[18px]" />, hint: 'The codebase map' },
    { id: 'requirements', label: 'Reqs', icon: <ClipboardCheck className="size-[18px]" />, badge: proposed, hint: `Requirements (${proposed} proposed)` },
    { id: 'questions', label: 'Asks', icon: <MessagesSquare className="size-[18px]" />, badge: questions, hint: `Questions (${questions} routed to you)` },
    { id: 'inbox', label: 'Inbox', icon: <Inbox className="size-[18px]" />, badge: waiting, hint: `Your approvals (${waiting} waiting)` },
    { id: 'people', label: 'People', icon: <Users className="size-[18px]" />, hint: 'People, ownership and the approver list' },
  ]
  return (
    <nav aria-label="Workspaces" className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-[var(--color-line)] bg-[var(--color-bg-2)] py-2">
      {items.map((it) => {
        const on = ws === it.id
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => go(it.id)}
            aria-current={on ? 'page' : undefined}
            title={it.hint}
            className={cn(
              'relative flex w-[50px] flex-col items-center gap-0.5 rounded-[9px] py-1.5 text-[10.5px] transition-colors',
              on ? 'bg-[var(--color-panel-2)] text-[var(--color-ink)]' : 'text-[var(--color-faint)] hover:bg-[var(--color-panel)] hover:text-[var(--color-muted)]',
            )}
          >
            <span className={cn(on && 'text-[var(--color-accent)]')}>{it.icon}</span>
            {it.label}
            {!!it.badge && (
              <span className="tnum absolute right-1 top-0.5 min-w-4 rounded-full bg-[var(--color-warn)] px-1 text-center font-mono text-[9.5px] font-semibold leading-4 text-[#1a1203]">{it.badge}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

export function ViewingAs() {
  const me = useUi((s) => s.viewerId)
  const setViewer = useUi((s) => s.setViewer)
  const people = useStore(useShallow((s) => Object.values(s.reqs.people).filter((p) => p.kind === 'person' && p.active && p.id !== 'p-agent').map((p) => `${p.id}|${p.name}|${p.title}`)))
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-[var(--color-faint)]" title="No sign-in in the demo: pick who you are to see their queue and permissions">
      <span className="hidden xl:inline">Viewing as</span>
      <select
        value={me}
        onChange={(e) => setViewer(e.target.value)}
        aria-label="Viewing as"
        title={people.find((r) => r.startsWith(me + "|"))?.split("|")[2]} className="h-8 max-w-[160px] rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-2 text-[12px] text-[var(--color-ink)] outline-none hover:border-[var(--color-line-2)]"
      >
        {people.map((row) => {
          const [id, name] = row.split('|')
          return (
            <option key={id} value={id}>
              {name}
            </option>
          )
        })}
      </select>
    </label>
  )
}
