import type { DecisionAnswer } from '@/types'
import { selectControls, selectDecisions, useStore } from '@/store/useStore'
import { StepHeader, Card, Rise, PrimaryButton, GhostButton } from '../chrome'

export default function Step4Ask() {
  const controls = useStore(selectControls)
  const decisions = useStore(selectDecisions) // re-render after each answer
  const pending = controls.pendingQuestions()
  const q = pending.find((p) => p.active) ?? null

  const answer = (a: DecisionAnswer) => controls.simulateSlackAnswer(a)

  return (
    <div className="grid h-full grid-cols-1 content-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <StepHeader n="04" eyebrow="Ask the right people" title={<>One question.<br />The right human.</>} />
        <Rise delay={0.1}>
          <p className="max-w-[42ch] text-[15px] leading-relaxed text-[var(--color-muted)]">
            Only <span className="text-[var(--color-ink)]">unmade decisions</span> ever reach a person —
            defects are fixed silently, noise is filtered. The owner comes from git blame and CODEOWNERS,
            and the answer is one click.
          </p>
        </Rise>
        <Rise delay={0.2}>
          <div className="mt-6 text-[13px] text-[var(--color-faint)]">
            {decisions.length} answered · {pending.length} waiting
          </div>
        </Rise>
      </div>

      <Rise delay={0.15} className="self-center">
        {q ? (
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-5 py-3">
              <span className="grid size-7 place-items-center rounded-md bg-[var(--color-accent-dim)] font-mono text-[11px] font-bold text-[var(--color-accent-bright)]">
                SD
              </span>
              <span className="text-[13px] font-medium text-[var(--color-ink)]">Shadow Diff</span>
              <span className="rounded bg-[var(--color-line)] px-1 text-[10px] font-semibold text-[var(--color-muted)]">APP</span>
              <span className="ml-auto font-mono text-[11px] text-[var(--color-agent)]">
                Jev · needs a person · {q.confidence.toFixed(2)}
              </span>
            </div>
            <div className="border-l-2 border-[var(--color-warn)] p-5">
              <div className="mb-1 flex gap-1.5">
                <Tag text="Unmade decision" color="var(--color-warn)" />
                <Tag text={q.category} color="var(--color-faint)" />
              </div>
              <div className="text-[16px] font-medium text-[var(--color-ink)]">{q.question}</div>
              <div className="mt-1 font-mono text-[11px] text-[var(--color-faint)]">input: {q.input}</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Val label="Old (COBOL)" v={q.old} />
                <Val label="New (Java)" v={q.new} />
              </div>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-2.5 font-mono text-[11px] text-[var(--color-muted)]">
                {q.snippetOld}
              </pre>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <PrimaryButton onClick={() => answer('old')}>Old is right · {q.old}</PrimaryButton>
                <GhostButton onClick={() => answer('new')}>New is right · {q.new}</GhostButton>
                <GhostButton onClick={() => answer('neither')}>Neither</GhostButton>
              </div>
              <div className="mt-3 text-[11px] text-[var(--color-faint)]">
                Routed to <span className="text-[var(--color-muted)]">{q.owner} · {q.team}</span> from {q.routedBy} ·
                settles {q.cases} cases · becomes test {q.testId}
              </div>
            </div>
          </Card>
        ) : (
          <Card className="p-8 text-center">
            <div className="font-display text-[22px] font-semibold text-[var(--color-accent-bright)]">
              Nothing left to ask.
            </div>
            <p className="mt-2 text-[14px] text-[var(--color-muted)]">
              Every root-cause group is resolved. {decisions.length} answers became {decisions.length} tests.
            </p>
          </Card>
        )}
      </Rise>
    </div>
  )
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
      {text}
    </span>
  )
}
function Val({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-2.5">
      <div className="text-[10px] text-[var(--color-faint)]">{label}</div>
      <div className="font-mono text-[14px] text-[var(--color-ink)]">{v}</div>
    </div>
  )
}
