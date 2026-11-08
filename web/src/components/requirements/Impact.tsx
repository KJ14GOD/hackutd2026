import { useState } from 'react'
import { Map as MapIcon } from 'lucide-react'
import type { Impact } from '@/types'
import type { VersionSlots } from '@/data/source'
import { POCKET, PROGRAM, sourceUrl } from '@/data/carddemo'
import { lint, FLAG_HELP } from '@/data/requirements'
import { selectReqs, useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Btn } from '@/components/shell/kit'
import { Eyebrow, TextArea } from '@/components/shell/reqKit'

/* 12.8 Impact preview: computed from trace links and the graph, never the
 * LLM. Every line links to the code; "Show on map" lights the same set. */

function Section({ title, n, children }: { title: string; n: number; children: React.ReactNode }) {
  return (
    <div>
      <Eyebrow right={<span className="tnum font-mono text-[10.5px] text-[var(--color-faint)]">{n}</span>}>{title}</Eyebrow>
      {n ? children : <div className="text-[12px] text-[var(--color-faint)]">None</div>}
    </div>
  )
}

export function ImpactPreview({ impact, label }: { impact: Impact; label: string }) {
  const w = useStore(selectReqs)
  const openReq = useUi((s) => s.openReq)
  const showImpact = useUi((s) => s.showImpact)
  return (
    <div className="text-[12.5px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-[var(--color-muted)]">
          {impact.programs.length} program{impact.programs.length === 1 ? '' : 's'} changed · {impact.downstream.length} downstream to retest
        </span>
        <Btn variant="outline" className="h-7 px-2 text-[12px]" disabled={!impact.programs.length} onClick={() => showImpact({ label, programs: impact.programs, downstream: impact.downstream.map((d) => d.program) })}>
          <MapIcon className="size-3.5" /> Show on map
        </Btn>
      </div>
      <Section title="Lines and functions" n={impact.lines.length}>
        <ul className="space-y-1">
          {impact.lines.map((l) => (
            <li key={l.ref}>
              <a href={sourceUrl(l.program)} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-[var(--color-ink)] underline decoration-[var(--color-line-2)] underline-offset-[3px] hover:text-[var(--color-accent)]">
                {l.ref}
              </a>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Downstream programs" n={impact.downstream.length}>
        <ul className="space-y-0.5">
          {impact.downstream.map((d) => (
            <li key={d.program} className="flex items-baseline gap-2">
              <span className="font-mono text-[11.5px] text-[var(--color-ink)]">{d.program}</span>
              <span className="min-w-0 flex-1 text-[11.5px] text-[var(--color-faint)]">{PROGRAM[d.program]?.title}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-[var(--color-copper)]">via {d.via}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Overlapping requirements" n={impact.overlapping.length}>
        <ul className="space-y-0.5">
          {impact.overlapping.map((id) => (
            <li key={id}>
              <button type="button" onClick={() => openReq(id)} className="text-left text-[12px] leading-snug text-[var(--color-muted)] hover:text-[var(--color-accent)]">
                <span className="font-mono text-[11px] text-[var(--color-faint)]">{id}</span> {w.versions[w.requirements[id]?.currentVersionId]?.statement}
              </button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Checks that go stale" n={impact.staleVerifications.length}>
        <ul className="space-y-0.5">
          {impact.staleVerifications.map((id) => (
            <li key={id} className="text-[12px] text-[var(--color-muted)]">
              <span className="text-[var(--color-faint)]">{w.verifications[id]?.method}</span> · {w.verifications[id]?.spec}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Pockets that move back to rewriting" n={impact.pocketsBack.length}>
        <ul className="space-y-0.5">
          {impact.pocketsBack.map((id) => (
            <li key={id} className="text-[12px] text-[var(--color-warn)]">
              {POCKET[id]?.title} <span className="text-[var(--color-faint)]">({w.jobs[id]?.state} → rewriting)</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

const SLOT_FIELDS: { key: keyof VersionSlots; label: string; rows: number }[] = [
  { key: 'statement', label: 'Statement', rows: 3 },
  { key: 'actor', label: 'Actor', rows: 1 },
  { key: 'condition', label: 'Condition', rows: 1 },
  { key: 'outcome', label: 'Outcome', rows: 2 },
  { key: 'measure', label: 'Measure', rows: 1 },
  { key: 'rationale', label: 'Rationale', rows: 2 },
]

/** The slots as a form, linted as you type so you see the flags before saving. */
export function SlotsForm({ initial, type, submitLabel, onSubmit, onCancel, warning, withReason = true }: {
  initial: VersionSlots
  type: 'functional' | 'quality' | 'constraint'
  submitLabel: string
  onSubmit: (slots: VersionSlots, reason: string) => void
  onCancel: () => void
  warning?: string
  withReason?: boolean
}) {
  const [s, setS] = useState(initial)
  const [reason, setReason] = useState('')
  const problems = lint(s, type)
  return (
    <div className="space-y-2.5">
      {warning && <div className="rounded-[8px] border border-[rgba(239,178,74,.35)] bg-[rgba(239,178,74,.08)] px-3 py-2 text-[12px] leading-snug text-[var(--color-warn)]">{warning}</div>}
      {SLOT_FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="mb-1 block text-[11.5px] text-[var(--color-faint)]">{f.label}</span>
          <TextArea label={f.label} rows={f.rows} value={s[f.key]} onChange={(v) => setS({ ...s, [f.key]: v })} />
        </label>
      ))}
      {withReason && (
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-[var(--color-faint)]">Why the change</span>
          <TextArea label="Why the change" rows={1} value={reason} onChange={setReason} placeholder="Shown in the history" />
        </label>
      )}
      {problems.length > 0 && (
        <ul className="space-y-0.5 text-[12px] text-[var(--color-warn)]">
          {problems.map((p, i) => (
            <li key={i}>
              {FLAG_HELP[p.rule]}
              {p.word && <> (“{p.word}”)</>}. Saving will ask a question.
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={!s.statement.trim()} onClick={() => onSubmit(s, reason)}>
          {submitLabel}
        </Btn>
      </div>
    </div>
  )
}
