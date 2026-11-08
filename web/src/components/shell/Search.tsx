import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { ENTRIES, POCKETS, PROGRAMS, STORES, type Ref } from '@/data/carddemo'
import { cn } from '@/lib/cn'
import { Kbd } from './kit'

interface Item { ref: Ref; label: string; sub: string; kind: string }

const ITEMS: Item[] = [
  ...PROGRAMS.map((p) => ({ ref: { kind: 'program' as const, id: p.id }, label: p.id, sub: p.title, kind: 'program' })),
  ...POCKETS.map((p) => ({ ref: { kind: 'pocket' as const, id: p.id }, label: p.title, sub: `${p.programs.length} programs`, kind: 'pocket' })),
  ...STORES.map((s) => ({ ref: { kind: 'store' as const, id: s.id }, label: s.id, sub: s.title, kind: s.shared ? 'shared data' : 'data' })),
  ...ENTRIES.map((e) => ({ ref: { kind: 'entry' as const, id: e.id }, label: e.id, sub: `${e.kind === 'job' ? 'job' : 'CICS'} → ${e.program}`, kind: e.kind === 'job' ? 'job' : 'transaction' })),
]

export interface SearchHandle { focus(): void }

export const Search = forwardRef<SearchHandle, { onPick: (r: Ref) => void; compact?: boolean }>(function Search({ onPick, compact }, ref) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), [])

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return ITEMS.filter((it) => it.label.toLowerCase().includes(s) || it.sub.toLowerCase().includes(s))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(s)) - Number(!b.label.toLowerCase().startsWith(s)))
      .slice(0, 9)
  }, [q])

  const choose = (it: Item) => {
    onPick(it.ref)
    setQ('')
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div className={cn('relative', compact ? 'w-[200px]' : 'w-[304px]')}>
      <div className="flex h-8 items-center gap-2 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 focus-within:border-[var(--color-line-2)]">
        <SearchIcon className="size-3.5 shrink-0 text-[var(--color-faint)]" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setI(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setI((x) => Math.min(results.length - 1, x + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setI((x) => Math.max(0, x - 1))
            } else if (e.key === 'Enter' && results[i]) choose(results[i])
            else if (e.key === 'Escape') {
              setQ('')
              input.current?.blur()
            }
          }}
          placeholder={compact ? 'Search' : 'Search programs, data, jobs'}
          aria-label="Search the map"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
        />
        <span className="shrink-0">
          <Kbd>Ctrl K</Kbd>
        </span>
      </div>
      {open && results.length > 0 && (
        <div role="listbox" className="absolute right-0 top-10 w-[360px] z-50 overflow-hidden rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-panel)] py-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,.6)]">
          {results.map((it, n) => (
            <button
              key={`${it.ref.kind}:${it.ref.id}`}
              type="button"
              role="option"
              aria-selected={n === i}
              onMouseEnter={() => setI(n)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(it)
              }}
              className={cn('flex w-full items-center gap-2.5 px-3 py-1.5 text-left', n === i && 'bg-[var(--color-panel-2)]')}
            >
              <span className={cn('text-[12.5px] text-[var(--color-ink)]', it.ref.kind !== 'pocket' && 'font-mono text-[12px]')}>{it.label}</span>
              <span className="truncate text-[11.5px] text-[var(--color-faint)]">{it.sub}</span>
              <span className="ml-auto shrink-0 text-[10.5px] text-[var(--color-faint)]">{it.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
