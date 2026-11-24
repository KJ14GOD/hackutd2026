import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'

/* Small dark-silicon primitives for the mission-control shell. */

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  label,
}: {
  items: { id: T; label: ReactNode; hint?: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-panel)] p-[3px]">
      {items.map((it) => {
        const on = it.id === value
        return (
          <button
            key={it.id}
            type="button"
            title={it.hint}
            aria-pressed={on}
            onClick={() => onChange(it.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-[7px] font-medium transition-colors duration-200',
              size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-[5px] text-[12.5px]',
              on ? 'bg-[var(--color-raise)] text-[var(--color-ink)] shadow-[inset_0_0_0_1px_var(--color-line-2)]' : 'text-[var(--color-faint)] hover:text-[var(--color-muted)]',
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

export function Btn({ variant = 'ghost', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-medium transition-colors duration-200 disabled:opacity-40',
        variant === 'primary' && 'bg-[var(--color-accent)] text-[#06212b] hover:bg-[var(--color-accent-bright)]',
        variant === 'outline' && 'border border-[var(--color-line-2)] text-[var(--color-muted)] hover:border-[var(--color-faint)] hover:text-[var(--color-ink)]',
        variant === 'ghost' && 'text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]',
        className,
      )}
    />
  )
}

export function IconBtn({ label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cn(
        'grid size-8 place-items-center rounded-[8px] text-[var(--color-muted)] transition-colors duration-200 hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]',
        className,
      )}
    />
  )
}

export function Chip({ color, children, mono }: { color?: string; children: ReactNode; mono?: boolean }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-[2px] text-[11px] font-medium', mono && 'font-mono')}
      style={{ background: color ? `${color}1f` : 'var(--color-panel-2)', color: color ?? 'var(--color-muted)' }}
    >
      {children}
    </span>
  )
}

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-[2px]', pulse && 'pulse-soft')} style={{ background: color }} />
}

export function SectionHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pb-2 pt-4">
      <span className="eyebrow">{children}</span>
      {right}
    </div>
  )
}

/* A trend delta, SnowUI-style: arrow + value, green rising / red falling.
 * `trend` is the direction of movement; `good` says which direction is positive
 * (defaults to up = good, so rising reads green). Kept small and tabular. */
export function Delta({ value, trend, good = 'up' }: { value: string; trend: 'up' | 'down' | 'flat'; good?: 'up' | 'down' }) {
  const positive = trend === 'flat' ? null : trend === good
  const color = positive === null ? 'var(--color-faint)' : positive ? 'var(--color-good)' : 'var(--color-bad)'
  const Icon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus
  return (
    <span className="tnum inline-flex items-center gap-0.5 text-[11px] font-medium" style={{ color }}>
      {value}
      <Icon className="size-3" strokeWidth={2.5} />
    </span>
  )
}

export function Stat({ label, value, sub, color, delta, card }: {
  label: string
  value: ReactNode
  sub?: ReactNode
  color?: string
  delta?: { value: string; trend: 'up' | 'down' | 'flat'; good?: 'up' | 'down' }
  card?: boolean
}) {
  return (
    <div className={cn('min-w-0', card && 'rounded-[10px] border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5')}>
      <div className="text-[11.5px] text-[var(--color-faint)]">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="tnum text-[22px] font-semibold tracking-[-0.02em]" style={{ color: color ?? 'var(--color-ink)' }}>
          {value}
        </span>
        {delta && <Delta {...delta} />}
      </div>
      {sub && <div className="mt-0.5 text-[11.5px] text-[var(--color-faint)]">{sub}</div>}
    </div>
  )
}

/* Collapsible section: an eyebrow header with a chevron that abstracts
 * secondary detail behind a dropdown so the main view stays uncluttered.
 * `right` shows a count or summary even while collapsed. */
export function Disclosure({ title, right, defaultOpen = false, children }: {
  title: string
  right?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-4 pb-2 pt-4 text-left"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-[var(--color-faint)] transition-transform duration-200', open && 'rotate-90')} />
        <span className="eyebrow">{title}</span>
        {right != null && <span className="ml-auto text-[11px] text-[var(--color-faint)]">{right}</span>}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[4px] border border-[var(--color-line-2)] px-1 font-mono text-[10px] text-[var(--color-faint)]">{children}</kbd>
}
