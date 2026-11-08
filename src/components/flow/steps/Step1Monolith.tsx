import { selectComponent, useStore } from '@/store/useStore'
import { StepHeader, Card, Rise } from '../chrome'

export default function Step1Monolith() {
  const c = useStore(selectComponent)
  return (
    <div className="grid h-full grid-cols-1 content-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <StepHeader
          n="01"
          eyebrow="The system nobody wants to touch"
          title={
            <>
              The code runs the bank.
              <br />
              <span className="text-[var(--color-muted)]">Nobody left can read it.</span>
            </>
          }
        />
        <Rise delay={0.1}>
          <p className="max-w-[46ch] text-[16px] leading-relaxed text-[var(--color-muted)]">
            Decades of COBOL still move real money. An LLM can translate it in seconds — but it
            can't tell a bug from a business rule someone quietly depends on. That knowledge was
            never written down. We're going to get it out, one component at a time.
          </p>
        </Rise>
        <Rise delay={0.2}>
          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            <Stat k="Born" v="1968" />
            <Stat k="Language" v={c.language} />
            <Stat k="Owners who remain" v="0" />
          </div>
        </Rise>
      </div>

      <Rise delay={0.15} className="self-center">
        <Card className="p-6">
          <div className="eyebrow mb-4">First target · the black box</div>
          <div className="font-mono text-[28px] font-semibold text-[var(--color-ink)]">{c.id}</div>
          <div className="mb-5 text-[14px] text-[var(--color-muted)]">{c.name}</div>
          <Row k="Isolation" v={`${c.isolation.toFixed(2)} · safest to cut first`} />
          <Row k="Test coverage" v={`${Math.round(c.coverage * 100)}%`} />
          <Row k="Status" v={c.status} />
          <Row k="Behavioral match" v={`${(c.matchRate * 100).toFixed(0)}% so far`} last />
        </Card>
      </Rise>
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="font-display text-[26px] font-semibold tnum text-[var(--color-ink)]">{v}</div>
      <div className="eyebrow mt-1">{k}</div>
    </div>
  )
}

function Row({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <div
      className="flex items-center justify-between py-2.5 text-[13px]"
      style={{ borderTop: '1px solid var(--color-line)', borderBottom: last ? '1px solid var(--color-line)' : undefined }}
    >
      <span className="text-[var(--color-muted)]">{k}</span>
      <span className="font-mono capitalize text-[var(--color-ink)]">{v}</span>
    </div>
  )
}
