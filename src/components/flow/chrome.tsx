import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

/* Shared dark atoms for the stepped workflow. */

export function StepHeader({ n, eyebrow, title }: { n: string; eyebrow: string; title: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="eyebrow mb-3">
        {n} · {eyebrow}
      </div>
      <h1 className="font-display text-[clamp(32px,4.6vw,60px)] font-semibold leading-[1.02] tracking-[-0.02em] text-[var(--color-ink)]">
        {title}
      </h1>
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)]/70 backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-5 py-2.5 text-[14px] font-semibold text-[#0a1400] transition',
        'hover:bg-[var(--color-accent-bright)] hover:shadow-[0_0_30px_-6px_var(--color-accent)] active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-none',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-[var(--color-line-2)] px-4 py-2 text-[13px] text-[var(--color-muted)] transition hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** fade/rise-in wrapper for step content pieces */
export function Rise({ delay = 0, children, className }: { delay?: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
