import type { Mismatch } from '@/types'
import { JevChip } from '@/components/ui/primitives'
import { EvidenceWidget } from './EvidenceWidget'
import { CATEGORY_COLOR, WIDGET_LABEL } from './meta'

const STATUS_FLOW = ['asked', 'answered', 'test_generated'] as const
const STATUS_LABEL: Record<string, string> = {
  asked: 'Asked',
  answered: 'Answered',
  test_generated: 'Test generated',
}

export function MismatchDetail({ mismatch }: { mismatch: Mismatch | null }) {
  if (!mismatch) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-[var(--color-fg-dim)]">
        Select a mismatch to inspect.
      </div>
    )
  }
  const isNoise = mismatch.classification === 'noise'
  const isDefect = mismatch.classification === 'defect'

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto pr-1">
      <div>
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: `${CATEGORY_COLOR[mismatch.category]}22`, color: CATEGORY_COLOR[mismatch.category] }}
          >
            {mismatch.category}
          </span>
          <span className="font-mono text-[11px] text-[var(--color-fg-dim)]">
            group {mismatch.rootCauseGroup}
          </span>
        </div>
        <h3 className="mt-1.5 text-[15px] font-semibold text-[var(--color-fg)]">{mismatch.title}</h3>
      </div>

      {/* input */}
      <Field label="Input">
        <code className="font-mono text-[12px] text-[var(--color-fg-muted)]">
          {JSON.stringify(mismatch.input)}
        </code>
      </Field>

      {/* evidence widget (Jev-chosen) */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">
            Evidence · {WIDGET_LABEL[mismatch.evidenceWidget ?? 'tableDiff']}
          </span>
          <JevChip confidence={mismatch.categoryConfidence} latencyMs={140} />
        </div>
        <EvidenceWidget mismatch={mismatch} />
      </div>

      {/* code snippets */}
      <div className="grid grid-cols-2 gap-2">
        <Snippet label="COBOL (old)" code={mismatch.snippet.old} color="var(--color-accent)" />
        <Snippet label="Rewrite (new)" code={mismatch.snippet.new} color="var(--color-good)" />
      </div>

      {/* resolution framing */}
      {isNoise ? (
        <Banner color="var(--color-noise)">
          Filtered as noise — this field is excluded from the diff. No one is asked.
        </Banner>
      ) : isDefect ? (
        <Banner color="var(--color-good)">
          Defect against an agreed invariant — the agent fixed it silently and generated a test. No human
          interrupt.
        </Banner>
      ) : (
        <SlackCard mismatch={mismatch} />
      )}
    </div>
  )
}

function SlackCard({ mismatch }: { mismatch: Mismatch }) {
  const idx = STATUS_FLOW.indexOf(mismatch.status as (typeof STATUS_FLOW)[number])
  return (
    <div className="rounded-lg border border-[var(--color-agent)]/40 bg-[var(--color-agent)]/5 p-3">
      <div className="mb-2 text-[11px] uppercase tracking-wider text-[var(--color-agent)]">
        Slack question · one-click answer
      </div>
      <p className="mb-2.5 text-[13px] text-[var(--color-fg)]">
        Old and new disagree. Which behavior is correct?
      </p>
      <div className="flex flex-wrap gap-1.5">
        {['Old', 'New', 'Neither', "Doesn't matter"].map((b) => (
          <span
            key={b}
            className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[12px] text-[var(--color-fg-muted)]"
          >
            {b}
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        {STATUS_FLOW.map((s, i) => (
          <div key={s} className="flex items-center gap-1.5">
            <span
              className="size-1.5 rounded-full"
              style={{ background: i <= idx ? 'var(--color-good)' : 'var(--color-surface-3)' }}
            />
            <span
              className="text-[10px]"
              style={{ color: i <= idx ? 'var(--color-good)' : 'var(--color-fg-dim)' }}
            >
              {STATUS_LABEL[s]}
            </span>
            {i < STATUS_FLOW.length - 1 && <span className="text-[var(--color-fg-dim)]">→</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)]">{label}</div>
      {children}
    </div>
  )
}

function Snippet({ label, code, color }: { label: string; code: string; color: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#1d1d1f]">
      <div
        className="border-b border-[rgb(255_255_255/0.08)] px-2.5 py-1 text-[10px] tracking-wide"
        style={{ color }}
      >
        {label}
      </div>
      <pre className="overflow-x-auto p-2.5 font-mono text-[11px] leading-relaxed text-[#f5f5f7]">
        {code}
      </pre>
    </div>
  )
}

function Banner({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border p-2.5 text-[12px] leading-relaxed"
      style={{ borderColor: `${color}55`, background: `${color}11`, color: 'var(--color-fg-muted)' }}
    >
      {children}
    </div>
  )
}
