import type { ReactNode } from 'react'
import { Activity, AlertTriangle, BookOpen, ExternalLink, FileCode2, GitCompare, Loader2, Lock, MessageSquare, StickyNote, Ticket } from 'lucide-react'
import type { EvidenceOrigin, ReqStatus, Urgency, Verification } from '@/types'
import { STATUS_LABEL, ownerOfScope, personName } from '@/data/requirements'
import { selectReqs, useStore } from '@/store/useStore'
import { useUi, type Mode } from '@/store/useUi'
import { C, TEAM_COLOR } from '@/components/map/theme'
import { cn } from '@/lib/cn'
import { Segmented } from './kit'

/* Shared pieces for the requirements screens (REQUIREMENTS_ANALYSIS §12):
 * status pill, urgency chip, evidence card, person chip, the Business /
 * Engineer toggle, and the loading / empty / error / restricted states. */

const STATUS_COLOR: Record<ReqStatus, string> = {
  draft: C.faint,
  'needs-info': C.warn,
  proposed: C.accent,
  approved: C.good,
  rejected: C.bad,
  superseded: C.faint,
}

export function StatusPill({ status }: { status: ReqStatus }) {
  const c = STATUS_COLOR[status]
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-[1px] text-[11px] font-medium', status === 'superseded' && 'line-through')} style={{ background: `${c}1f`, color: c }}>
      {STATUS_LABEL[status]}
    </span>
  )
}

const URGENCY_COLOR: Record<Urgency, string> = { critical: C.bad, high: C.warn, normal: C.sub, low: C.faint }
export function UrgencyChip({ urgency }: { urgency: Urgency }) {
  const c = URGENCY_COLOR[urgency]
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-[1px] text-[11px] font-medium capitalize" style={{ background: `${c}1a`, color: c }}>
      {urgency === 'critical' && <AlertTriangle className="size-3" />}
      {urgency}
    </span>
  )
}

const VERIF_COLOR: Record<Verification['status'], string> = { passing: C.good, failing: C.bad, pending: C.faint, stale: C.warn }
export function VerifPill({ status }: { status: Verification['status'] }) {
  const c = VERIF_COLOR[status]
  return (
    <span className="inline-flex shrink-0 items-center rounded-[6px] px-1.5 py-[1px] text-[11px] font-medium capitalize" style={{ background: `${c}1a`, color: c }}>
      {status}
    </span>
  )
}

const ORIGIN: Record<EvidenceOrigin, { icon: typeof FileCode2; label: string }> = {
  code: { icon: FileCode2, label: 'Code' },
  runtime: { icon: Activity, label: 'Captured run' },
  jira: { icon: Ticket, label: 'Jira' },
  confluence: { icon: BookOpen, label: 'Confluence' },
  notion: { icon: StickyNote, label: 'Notion' },
  slack: { icon: MessageSquare, label: 'Slack' },
  shadow: { icon: GitCompare, label: 'Shadow run' },
}

/** One piece of evidence: where it came from, the quote or code, a link out. */
export function EvidenceCard({ origin, title, evidence, url, refText, compact, action }: { origin: EvidenceOrigin; title: string; evidence: string; url?: string; refText?: string; compact?: boolean; action?: ReactNode }) {
  const O = ORIGIN[origin]
  const isCode = origin === 'code'
  return (
    <div className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <O.icon className="mt-[2px] size-3.5 shrink-0 text-[var(--color-faint)]" aria-label={O.label} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[12.5px] font-medium leading-snug text-[var(--color-ink)]">{title}</span>
            {refText && <span className="font-mono text-[10.5px] text-[var(--color-faint)]">{refText}</span>}
          </div>
          {!compact && evidence && (
            isCode ? (
              <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-[6px] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--color-muted)]">{evidence}</pre>
            ) : (
              <p className="mt-1 text-[12px] leading-snug text-[var(--color-muted)]">“{evidence}”</p>
            )
          )}
        </div>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="shrink-0 text-[var(--color-faint)] hover:text-[var(--color-accent)]" aria-label={`Open ${title}`} title="Open the source">
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      {action && <div className="mt-2 flex justify-end">{action}</div>}
    </div>
  )
}

const TEAM_TINT: Record<string, string> = {
  't-finance': TEAM_COLOR.finance,
  't-customer': TEAM_COLOR.customer,
  't-platform': TEAM_COLOR.platform,
  't-ops': TEAM_COLOR.operations,
}

export function Avatar({ id, size = 18 }: { id: string; size?: number }) {
  const w = useStore(selectReqs)
  const p = w.people[id]
  const initials = p ? p.name.split(' ').map((s) => s[0]).slice(0, 2).join('') : '?'
  const tint = (p && TEAM_TINT[p.teamId]) ?? C.sub
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold', p?.kind === 'system' && 'rounded-[4px]')}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `${tint}2b`, color: tint, opacity: p?.active === false ? 0.5 : 1 }}
      aria-hidden
    >
      {initials}
    </span>
  )
}

/** Name, title on hover, and why we linked them (source + confidence). Click opens their page. */
export function PersonChip({ id, via, confidence, plain }: { id: string; via?: string; confidence?: number; plain?: boolean }) {
  const w = useStore(selectReqs)
  const openPerson = useUi((s) => s.openPerson)
  const p = w.people[id]
  const hint = [p?.title, via && `via ${via}`, confidence !== undefined && `${Math.round(confidence * 100)}% confidence`, p && !p.active && 'has left'].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        openPerson(id)
      }}
      title={hint}
      className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full text-[12px] transition-colors hover:text-[var(--color-accent)]', !plain && 'bg-[var(--color-panel-2)] py-[1px] pl-[2px] pr-2', p?.active === false && 'text-[var(--color-faint)] line-through')}
    >
      <Avatar id={id} />
      <span className="truncate">{personName(w, id)}</span>
    </button>
  )
}

export function ModeToggle() {
  const mode = useUi((s) => s.mode)
  const setMode = useUi((s) => s.setMode)
  return (
    <Segmented<Mode>
      size="sm"
      label="Wording"
      value={mode}
      onChange={setMode}
      items={[
        { id: 'business', label: 'Business', hint: 'Plain wording for business owners' },
        { id: 'engineer', label: 'Engineer', hint: 'Program names, paragraphs and code' },
      ]}
    />
  )
}

/** Loading, empty and error states, each saying what will appear or what to do. */
export function StateNote({ kind, title, children, action }: { kind: 'loading' | 'empty' | 'error'; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className="mx-auto flex max-w-[420px] flex-col items-center px-6 py-14 text-center">
      {kind === 'loading' && <Loader2 className="mb-3 size-5 animate-spin text-[var(--color-faint)]" />}
      {kind === 'error' && <AlertTriangle className="mb-3 size-5 text-[var(--color-bad)]" />}
      <div className="text-[13.5px] font-medium text-[var(--color-ink)]">{title}</div>
      {children && <div className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Shown in place of anything the viewer may not see. Never the content. */
export function Restricted({ scope, className }: { scope: string; className?: string }) {
  const w = useStore(selectReqs)
  const owner = ownerOfScope(w, scope)
  return (
    <div className={cn('flex items-center gap-2 text-[12px] text-[var(--color-faint)]', className)}>
      <Lock className="size-3.5 shrink-0" />
      <span>Restricted · ask {owner ? owner.name : 'the owner'} for access</span>
    </div>
  )
}

/** Wraps a screen's body with the store's subscription state. */
export function ReqGate({ children }: { children: ReactNode }) {
  const status = useStore((s) => s.reqStatus)
  const error = useStore((s) => s.reqError)
  const reset = useStore((s) => s.controls.reset)
  if (status === 'loading') return <StateNote kind="loading" title="Loading requirements">Subscribing to requirements, questions and people.</StateNote>
  if (status === 'error')
    return (
      <StateNote kind="error" title="Couldn’t load requirements" action={<button type="button" onClick={reset} className="text-[12.5px] text-[var(--color-accent)] hover:underline">Try again</button>}>
        {error || 'The connection to the database dropped.'} The map still works; this screen comes back when the subscription does.
      </StateNote>
    )
  return <>{children}</>
}

/** A labelled field for slot views and forms. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-3 py-1.5">
      <div className="pt-[1px] text-[11.5px] text-[var(--color-faint)]" title={hint}>
        {label}
      </div>
      <div className="min-w-0 text-[12.5px] leading-snug text-[var(--color-ink)]">{children}</div>
    </div>
  )
}

export function Select<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={label}
      className="h-7 rounded-[7px] border border-[var(--color-line)] bg-[var(--color-panel)] px-1.5 text-[12px] text-[var(--color-muted)] outline-none hover:border-[var(--color-line-2)] focus:border-[var(--color-accent)]"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn('h-7 rounded-[7px] border px-2 text-[12px] transition-colors', on ? 'border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent-bright)]' : 'border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-line-2)]')}
    >
      {children}
    </button>
  )
}

export function TextArea({ value, onChange, placeholder, rows = 2, label }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; label: string }) {
  return (
    <textarea
      value={value}
      rows={rows}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 py-1.5 text-[12.5px] leading-snug text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
    />
  )
}

/** Toolbar row at the top of each workspace. */
export function WsBar({ title, children, right }: { title: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-1.5">
      <h1 className="shrink-0 text-[14px] font-semibold tracking-[-0.01em]">{title}</h1>
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>
    </div>
  )
}

/** List on the left, detail on the right. */
export function Split({ list, detail, detailWidth = 480 }: { list: ReactNode; detail: ReactNode; detailWidth?: number }) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto">{list}</div>
      <aside className="flex shrink-0 flex-col overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-bg-2)]" style={{ width: detailWidth }}>
        {detail}
      </aside>
    </div>
  )
}

export function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between pb-1.5 pt-4">
      <span className="eyebrow">{children}</span>
      {right}
    </div>
  )
}
