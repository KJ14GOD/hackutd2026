import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/* Shared, dependency-free UI primitives — light Apple style (UI_SPEC §3).
 * White cards, no borders, hairline dividers, one accent. */

export function Panel({
  title,
  right,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode
  right?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'relative flex flex-col rounded-[22px] bg-[var(--color-card)]',
        'shadow-[0_1px_2px_rgb(0_0_0/0.04),0_6px_20px_-12px_rgb(0_0_0/0.08)]',
        className,
      )}
    >
      {(title || right) && (
        <header className="flex items-center justify-between border-b border-[var(--color-hair)] px-5 py-3">
          <div className="text-[13px] font-medium text-[var(--color-sub)]">{title}</div>
          {right}
        </header>
      )}
      <div className={cn('flex-1', bodyClassName ?? 'p-5')}>{children}</div>
    </section>
  )
}

export function Chip({
  children,
  color = 'default',
  className,
}: {
  children: ReactNode
  color?: 'default' | 'good' | 'warn' | 'bad' | 'noise' | 'accent'
  className?: string
}) {
  const colors: Record<string, string> = {
    default: 'bg-[rgb(0_0_0/0.05)] text-[var(--color-sub)]',
    good: 'bg-[rgb(36_138_61/0.12)] text-[var(--color-good)]',
    warn: 'bg-[var(--color-warn-bg)] text-[var(--color-warn)]',
    bad: 'bg-[rgb(215_0_21/0.1)] text-[var(--color-bad)]',
    noise: 'bg-[rgb(0_0_0/0.05)] text-[var(--color-noise)]',
    accent: 'bg-[rgb(0_113_227/0.1)] text-[var(--color-accent)]',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
        colors[color],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Model attribution — Nemotron (agent) or Jev (decisions). */
export function ModelBadge({ model }: { model: 'Nemotron' | 'Jev' }) {
  const isNv = model === 'Nemotron'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
        isNv ? 'bg-[rgb(118_185_0/0.14)] text-[#4f7d00]' : 'bg-[rgb(88_86_214/0.12)] text-[var(--color-agent)]',
      )}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: isNv ? 'var(--color-nvidia)' : 'var(--color-agent)' }}
      />
      {model}
    </span>
  )
}

/** The `Jev · 0.94 · 140ms` attribution line (UI_SPEC §1). */
export function JevChip({
  confidence,
  latencyMs,
  label,
  className,
}: {
  confidence?: number
  latencyMs: number
  label?: string
  className?: string
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 font-mono text-[10px] text-[var(--color-agent)]', className)}
      title="Decided by Jev (TypeSafe). Confidence = distribution concentration, not p(correct)."
    >
      <span className="font-semibold">Jev</span>
      {label && <span className="text-[var(--color-faint)]">· {label}</span>}
      {confidence != null && <span>· {confidence.toFixed(2)}</span>}
      <span className="text-[var(--color-faint)]">· {latencyMs}ms</span>
    </span>
  )
}
