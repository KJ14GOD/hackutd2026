import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { RequirementVersion } from '@/types'
import { approverRows, canSeeReq, fmtWhen, impactOf, personName } from '@/data/requirements'
import { selectReqActions, selectReqs, useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Btn } from '@/components/shell/kit'
import { EvidenceCard, Eyebrow, ModeToggle, PersonChip, ReqGate, Restricted, StateNote, StatusPill, TextArea, WsBar } from '@/components/shell/reqKit'

/* 12.6 Conflicts: two requirements that can't both hold, side by side, with
 * their sources, who backs each, and what happens if it wins. Never
 * preselects a winner; resolving needs a comment and records who decided. */

export function ConflictView({ id, onBack }: { id: string; onBack: () => void }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const openQuestion = useUi((s) => s.openQuestion)
  const [comment, setComment] = useState('')
  const c = w.conflicts[id]
  const a = c && w.versions[c.aVersionId]
  const b = c && w.versions[c.bVersionId]
  const ra = a && w.requirements[a.requirementId]
  const rb = b && w.requirements[b.requirementId]

  const back = (
    <Btn onClick={onBack} className="-ml-2">
      <ArrowLeft className="size-3.5" /> Requirements
    </Btn>
  )
  if (!c || !a || !b || !ra || !rb)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <WsBar title={back} />
        <StateNote kind="error" title="This conflict no longer exists" />
      </div>
    )
  if (!canSeeReq(w, me, ra) || !canSeeReq(w, me, rb))
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <WsBar title={back} />
        <Restricted scope={ra.pocketId} className="p-6" />
      </div>
    )

  const can = approverRows(w, me, ra).length > 0 && approverRows(w, me, rb).length > 0
  const q = w.questions[c.questionId]
  const open = c.status === 'open'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WsBar title={back} right={<ModeToggle />}>
        <span className="text-[12.5px] text-[var(--color-muted)]">Conflict {c.id}</span>
        {q && (
          <button type="button" onClick={() => openQuestion(q.id)} className="text-[12px] text-[var(--color-accent)] hover:underline">
            Question {q.id} ({q.status})
          </button>
        )}
      </WsBar>
      <ReqGate>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1100px] px-6 py-5">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em]">These two can’t both be true</h2>
            <p className="mt-1 text-[12.5px] text-[var(--color-muted)]">Pick the one the business wants. The other is marked superseded and stays in the history. Nothing is chosen for you.</p>

            {!open && (
              <div className="mt-4 rounded-[10px] border border-[rgba(55,202,149,.35)] bg-[rgba(55,202,149,.06)] px-3.5 py-2.5 text-[12.5px] leading-snug">
                <span className="text-[var(--color-good)]">Resolved</span>
                <span className="text-[var(--color-muted)]">
                  {' '}
                  by {c.resolvedByPersonId ? personName(w, c.resolvedByPersonId) : 'someone'}: kept {c.resolution === 'a' ? 'A' : 'B'}.
                </span>{' '}
                <span className="text-[var(--color-ink)]">“{c.comment}”</span>
              </div>
            )}
            {open && c.resolution === 'escalated' && <div className="mt-4 text-[12.5px] text-[var(--color-warn)]">Escalated: {c.comment}</div>}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Side tag="A" v={a} />
              <Side tag="B" v={b} />
            </div>

            {open && (
              <div className="mt-6 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-bg-2)] p-4">
                <div className="text-[13px] font-medium">Decide</div>
                {!can && <p className="mt-1 text-[12px] text-[var(--color-faint)]">Only approved people for both scopes can resolve this. {personName(w, me)} can comment on the question instead.</p>}
                <div className="mt-2">
                  <TextArea label="Why" value={comment} onChange={setComment} placeholder="Why this one? (required, kept with the decision)" />
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Btn variant="outline" disabled={!can || !comment.trim()} onClick={() => act.resolveConflict(c.id, 'escalate', comment, me)}>
                    Escalate
                  </Btn>
                  <Btn variant="outline" disabled={!can || !comment.trim()} onClick={() => act.resolveConflict(c.id, 'a', comment, me)}>
                    Keep A
                  </Btn>
                  <Btn variant="outline" disabled={!can || !comment.trim()} onClick={() => act.resolveConflict(c.id, 'b', comment, me)}>
                    Keep B
                  </Btn>
                </div>
              </div>
            )}
          </div>
        </div>
      </ReqGate>
    </div>
  )
}

function Side({ tag, v }: { tag: string; v: RequirementVersion }) {
  const w = useStore(selectReqs)
  const mode = useUi((s) => s.mode)
  const openReq = useUi((s) => s.openReq)
  const r = w.requirements[v.requirementId]
  const sources = (w.links[r.id] ?? []).filter((l) => l.kind === 'source')
  // who backs it: people named on its sources, plus anyone who approved it
  const backers = [
    ...new Set([
      ...Object.values(w.people).filter((p) => p.kind === 'person' && sources.some((s) => s.title.includes(p.name))).map((p) => p.id),
      ...w.approvals.filter((a) => a.versionId === v.id && a.decision === 'approve').map((a) => a.approverPersonId),
    ]),
  ]
  const impact = impactOf(w, r.id)
  return (
    <section className="flex flex-col rounded-[12px] border border-[var(--color-line)] bg-[var(--color-bg-2)] p-4" aria-label={`Requirement ${tag}`}>
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-[6px] bg-[var(--color-panel-2)] font-mono text-[12px] font-semibold">{tag}</span>
        <button type="button" onClick={() => openReq(r.id)} className="font-mono text-[11px] text-[var(--color-faint)] hover:text-[var(--color-accent)]">
          {r.id}
        </button>
        <StatusPill status={r.status} />
      </div>
      <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--color-ink)]">{v.statement}</p>
      {mode === 'engineer' && (
        <div className="mt-2 text-[12px] leading-snug text-[var(--color-muted)]">
          <span className="text-[var(--color-faint)]">Actor</span> {v.actor} · <span className="text-[var(--color-faint)]">Outcome</span> {v.outcome}
        </div>
      )}

      <Eyebrow>Sources</Eyebrow>
      <div className="space-y-2">
        {sources.map((l) => (
          <EvidenceCard key={l.id} origin={l.origin} title={l.title} evidence={l.evidence} url={l.url} />
        ))}
        {!sources.length && <p className="text-[12px] text-[var(--color-faint)]">No sources.</p>}
      </div>

      <Eyebrow>Who backs it</Eyebrow>
      <div className="flex flex-wrap gap-1.5">
        {backers.length ? backers.map((id) => <PersonChip key={id} id={id} />) : <span className="text-[12px] text-[var(--color-faint)]">Only documents so far.</span>}
      </div>

      <Eyebrow>If it wins</Eyebrow>
      <p className="text-[12.5px] leading-snug text-[var(--color-muted)]">
        The rewrite does this: <span className="text-[var(--color-ink)]">{v.outcome}</span>.
      </p>
      <p className="mt-1 text-[12px] text-[var(--color-faint)]">
        {impact.programs.length
          ? `Touches ${impact.programs.join(', ')}; ${impact.downstream.length} downstream programs to retest.`
          : 'Not traced to code yet; the harness links the code before rewriting.'}
      </p>
      <p className="mt-auto pt-3 text-[11px] text-[var(--color-faint)]">Drafted {fmtWhen(v.createdAtMs)} · {v.reason}</p>
    </section>
  )
}
