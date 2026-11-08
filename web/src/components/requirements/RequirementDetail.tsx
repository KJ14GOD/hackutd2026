import { useState } from 'react'
import { GitPullRequestArrow, Swords } from 'lucide-react'
import type { ReqSlot } from '@/types'
import type { VersionSlots } from '@/data/source'
import { POCKET } from '@/data/carddemo'
import {
  CATEGORY_LABEL,
  FLAG_HELP,
  SLOTS,
  approvalsOn,
  approverRows,
  canApprove,
  canSeeReq,
  fmtWhen,
  impactOf,
  openConflictOf,
  personName,
  quorumFor,
  segments,
  verifsOf,
  scopeLabel,
} from '@/data/requirements'
import { selectReqActions, selectReqs, useStore } from '@/store/useStore'
import { useUi, type ReqTab } from '@/store/useUi'
import { Btn, Segmented } from '@/components/shell/kit'
import { EvidenceCard, Eyebrow, Field, PersonChip, Restricted, StateNote, StatusPill, TextArea } from '@/components/shell/reqKit'
import { cn } from '@/lib/cn'
import { History } from './History'
import { VerificationPanel } from './Verification'
import { ImpactPreview, SlotsForm } from './Impact'

/* Requirement detail (right pane of 12.4): the statement with lint flags
 * inline, the slots, evidence, trace and approvals; tabs for History (12.5)
 * and Verification (12.7); Approve / Reject / Edit / Needs info / Request
 * change (12.8). Buttons a viewer can't use stay visible but disabled, with
 * the reason next to them. */

type Panel = null | 'reject' | 'edit' | 'needs-info' | 'change'

export function RequirementDetail({ id }: { id: string }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const mode = useUi((s) => s.mode)
  const tab = useUi((s) => s.reqTab)
  const setTab = useUi((s) => s.setReqTab)
  const openQuestion = useUi((s) => s.openQuestion)
  const openConflict = useUi((s) => s.openConflict)
  const [panel, setPanel] = useState<Panel>(null)
  const [comment, setComment] = useState('')
  const [slot, setSlot] = useState<ReqSlot>('measure')
  const [changeStep, setChangeStep] = useState<{ slots: VersionSlots; reason: string } | null>(null)

  const r = w.requirements[id]
  if (!r) return <StateNote kind="error" title="This requirement no longer exists" />
  if (!canSeeReq(w, me, r))
    return (
      <div className="px-4 py-10">
        <Restricted scope={r.pocketId || r.scope} />
      </div>
    )

  const v = w.versions[r.currentVersionId]
  const flags = w.flags[v.id] ?? []
  const can = canApprove(w, me, id)
  const isApprover = approverRows(w, me, r).length > 0
  const conflict = openConflictOf(w, r)
  const cr = Object.values(w.changeRequests).find((c) => c.requirementId === id && c.status === 'open')
  const q = quorumFor(r)
  const got = approvalsOn(w, v.id)
  const links = w.links[id] ?? []
  const sources = links.filter((l) => l.kind === 'source')
  const code = links.filter((l) => l.kind === 'code')
  const nVerif = verifsOf(w, id).length
  const nVersions = Object.values(w.versions).filter((x) => x.requirementId === id).length
  const approvalsAll = w.approvals.filter((a) => a.requirementId === id).sort((a, b) => b.atMs - a.atMs)
  const editable = r.status !== 'superseded' && r.status !== 'rejected'

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pb-3 pt-4">
        <div className="eyebrow">
          Requirement · {CATEGORY_LABEL[r.category]} · {r.type}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] text-[var(--color-ink)]">{r.id}</span>
          <StatusPill status={r.status} />
          {r.status === 'proposed' && (
            <span className="tnum text-[11.5px] text-[var(--color-faint)]">
              {got.length} of {q} approval{q > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--color-ink)]">
          {segments(v.statement, flags.map((f) => f.word)).map((s, i) => {
            if (!s.flag) return <span key={i}>{s.text}</span>
            const f = flags.find((x) => x.word.toLowerCase() === s.text.toLowerCase().replace(/\s+/g, ' '))
            const fq = f && w.questions[f.questionId]
            return (
              <button
                key={i}
                type="button"
                onClick={() => f && openQuestion(f.questionId)}
                title={f ? `${FLAG_HELP[f.rule]}${fq ? `\nQuestion ${fq.id}: ${fq.text[mode]}` : ''}` : ''}
                className="rounded-[3px] bg-[rgba(239,178,74,.16)] px-0.5 text-[var(--color-warn)] underline decoration-wavy decoration-[rgba(239,178,74,.6)] underline-offset-4"
              >
                {s.text}
              </button>
            )
          })}
        </p>
        {flags.filter((f) => !f.word).map((f) => (
          <button key={f.id} type="button" onClick={() => openQuestion(f.questionId)} className="mt-1.5 block text-left text-[12px] text-[var(--color-warn)] hover:underline">
            {FLAG_HELP[f.rule]} → question {f.questionId}
          </button>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--color-faint)]">
          <span>Version {v.n}</span>
          <span>{scopeLabel(r, mode)}</span>
          <span>review by {new Date(r.reviewByMs).toISOString().slice(0, 10)}</span>
          <span className="flex items-center gap-1">
            owner <PersonChip id={r.ownerPersonId} plain />
          </span>
        </div>
      </div>

      {conflict && (
        <button type="button" onClick={() => openConflict(conflict.id)} className="mx-4 mb-3 flex items-start gap-2 rounded-[8px] border border-[rgba(238,109,105,.35)] bg-[rgba(238,109,105,.07)] px-3 py-2 text-left text-[12px] leading-snug text-[var(--color-bad)] hover:border-[var(--color-bad)]">
          <Swords className="mt-[1px] size-3.5 shrink-0" />
          <span>Another requirement says the opposite. Resolve the conflict before this can be approved.</span>
        </button>
      )}
      {cr && (
        <div className="mx-4 mb-3 rounded-[10px] border border-[rgba(127,178,255,.3)] bg-[var(--color-accent-dim)] px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--color-accent-bright)]">
            <GitPullRequestArrow className="size-3.5" /> Change requested by {personName(w, cr.byPersonId)}
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-ink)]">{w.versions[cr.proposedVersionId]?.statement}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-[12px] text-[var(--color-muted)]">Impact preview</summary>
            <ImpactPreview impact={cr.impact} label={`${cr.id}: change to ${r.id}`} />
          </details>
          <ChangeDecision crId={cr.id} />
        </div>
      )}

      <div className="flex items-center border-y border-[var(--color-line)] px-4 py-2">
        <Segmented<ReqTab>
          size="sm"
          label="Requirement tab"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'detail', label: 'Detail' },
            { id: 'history', label: `History · ${nVersions}` },
            { id: 'verification', label: `Checks · ${nVerif}` },
          ]}
        />
      </div>

      <div className="flex-1">
        {tab === 'history' && <History reqId={id} />}
        {tab === 'verification' && <VerificationPanel reqId={id} />}
        {tab === 'detail' && (
          <div className="px-4 pb-6">
            <Eyebrow>Slots</Eyebrow>
            <Field label="Actor">{v.actor || <Missing />}</Field>
            <Field label="Condition">{v.condition || <Missing />}</Field>
            <Field label="Outcome">{v.outcome || <Missing />}</Field>
            <Field label="Measure">{v.measure || <Missing />}</Field>
            <Field label="Scope">
              {r.scope === 'codebase' ? 'Whole codebase' : `${POCKET[r.pocketId]?.title ?? ''}${r.scopeLevel !== 'pocket' ? ` · ${r.scope}` : ''}`} <span className="text-[var(--color-faint)]">({r.scopeLevel})</span>
            </Field>
            <Field label="Rationale">{v.rationale || <Missing />}</Field>

            <Eyebrow>Evidence</Eyebrow>
            {sources.length ? (
              <div className="space-y-2">
                {sources.map((l) => (
                  <EvidenceCard key={l.id} origin={l.origin} title={l.title} evidence={l.evidence} url={l.url} />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-[var(--color-faint)]">Drafted from code only; no document or person has backed it yet.</p>
            )}

            <Eyebrow>Trace to code</Eyebrow>
            {code.length ? (
              <div className="space-y-2">
                {code.map((l) => (
                  <EvidenceCard key={l.id} origin="code" title={l.title} refText={mode === 'engineer' ? l.ref.split(' · ')[0] : undefined} evidence={l.evidence} url={l.url} compact={mode === 'business'} />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-[var(--color-faint)]">Not traced to code yet. The harness links code when it rewrites this pocket.</p>
            )}

            <Eyebrow>Approvals</Eyebrow>
            {approvalsAll.length ? (
              <ul className="space-y-1.5">
                {approvalsAll.map((a) => (
                  <li key={a.id} className="text-[12px] leading-snug">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={a.decision === 'approve' ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}>{a.decision === 'approve' ? 'Approved' : 'Rejected'}</span>
                      <span className="text-[var(--color-faint)]">version {w.versions[a.versionId]?.n} by</span>
                      <PersonChip id={a.approverPersonId} plain />
                      <span className="text-[var(--color-faint)]">· {fmtWhen(a.atMs)}</span>
                      {a.versionId !== v.id && a.decision === 'approve' && <span className="text-[var(--color-faint)]">(older version)</span>}
                    </span>
                    {a.comment && <span className="mt-0.5 block text-[var(--color-muted)]">“{a.comment}”</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[var(--color-faint)]">No one has approved or rejected any version yet.</p>
            )}
          </div>
        )}
      </div>

      {/* actions */}
      <div className="sticky bottom-0 border-t border-[var(--color-line)] bg-[var(--color-bg-2)] px-4 py-3">
        {panel === 'reject' && (
          <div className="mb-3 space-y-2">
            <TextArea label="Reason for rejecting" value={comment} onChange={setComment} placeholder="Why is this wrong? (required)" />
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setPanel(null)}>Cancel</Btn>
              <Btn
                variant="outline"
                className="border-[var(--color-bad)] text-[var(--color-bad)]"
                disabled={!comment.trim()}
                onClick={() => {
                  act.rejectRequirement(id, v.id, comment, me)
                  setPanel(null)
                  setComment('')
                }}
              >
                Reject
              </Btn>
            </div>
          </div>
        )}
        {panel === 'needs-info' && (
          <div className="mb-3 space-y-2">
            <div className="text-[12px] text-[var(--color-muted)]">Which part is missing or unclear? This asks the owner a question.</div>
            <div className="flex flex-wrap gap-1.5">
              {SLOTS.map((s) => (
                <button key={s} type="button" aria-pressed={slot === s} onClick={() => setSlot(s)} className={cn('rounded-[7px] border px-2 py-1 text-[12px] capitalize', slot === s ? 'border-[var(--color-accent)] text-[var(--color-accent-bright)]' : 'border-[var(--color-line)] text-[var(--color-muted)]')}>
                  {s}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setPanel(null)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  act.markNeedsInfo(id, slot, me)
                  setPanel(null)
                }}
              >
                Ask the owner
              </Btn>
            </div>
          </div>
        )}
        {panel === 'edit' && (
          <div className="mb-3 max-h-[60vh] overflow-y-auto">
            <SlotsForm
              initial={v}
              type={r.type}
              submitLabel="Save as new version"
              warning={r.status === 'approved' ? 'This requirement is approved. Saving creates a new version, moves it back to proposed, and resets its approvals and checks.' : undefined}
              onCancel={() => setPanel(null)}
              onSubmit={(slots, reason) => {
                act.editRequirement(id, slots, reason, me)
                setPanel(null)
              }}
            />
          </div>
        )}
        {panel === 'change' && (
          <div className="mb-3 max-h-[60vh] overflow-y-auto">
            {!changeStep ? (
              <SlotsForm initial={v} type={r.type} submitLabel="Preview impact" onCancel={() => setPanel(null)} onSubmit={(slots, reason) => setChangeStep({ slots, reason })} />
            ) : (
              <div className="space-y-2">
                <div className="text-[12.5px] font-medium text-[var(--color-ink)]">What this change would touch</div>
                <ImpactPreview impact={impactOf(w, id)} label={`Proposed change to ${r.id}`} />
                <div className="flex justify-end gap-2 pt-1">
                  <Btn onClick={() => setChangeStep(null)}>Back</Btn>
                  <Btn
                    variant="primary"
                    onClick={() => {
                      act.requestRequirementChange(id, changeStep.slots, changeStep.reason, me)
                      setChangeStep(null)
                      setPanel(null)
                    }}
                  >
                    Submit for approval
                  </Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {!panel && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Btn
                variant="primary"
                disabled={!can.ok}
                title={can.ok ? 'Approve this version' : can.why}
                onClick={() => act.approveRequirement(id, v.id, '', me)}
              >
                Approve
              </Btn>
              <Btn variant="outline" disabled={!isApprover || !editable} title={isApprover ? 'Reject with a reason' : 'Only approved people for this scope can reject'} onClick={() => setPanel('reject')}>
                Reject
              </Btn>
              <Btn disabled={!editable} onClick={() => setPanel('edit')}>
                Edit
              </Btn>
              <Btn disabled={!editable} onClick={() => setPanel('needs-info')}>
                Needs info
              </Btn>
              <Btn disabled={!editable || !!cr} title={cr ? 'A change is already waiting for approval' : 'Propose a change and see its impact first'} onClick={() => setPanel('change')}>
                Request change
              </Btn>
            </div>
            {!can.ok && r.status !== 'approved' && editable && <p className="mt-2 text-[11.5px] leading-snug text-[var(--color-faint)]">Approve is off: {can.why}.</p>}
          </>
        )}
      </div>
    </div>
  )
}

function Missing() {
  return <span className="text-[var(--color-warn)]">Missing</span>
}


export function ChangeDecision({ crId }: { crId: string }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const [comment, setComment] = useState('')
  const cr = w.changeRequests[crId]
  const r = cr && w.requirements[cr.requirementId]
  if (!cr || !r) return null
  const mine = cr.byPersonId === me
  const can = !mine && approverRows(w, me, r).length > 0
  if (!can)
    return <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">{mine ? 'You requested this; another approved person decides.' : 'Waiting for an approved person for this scope.'}</p>
  return (
    <div className="mt-2 space-y-2">
      <TextArea label="Comment on the change" value={comment} onChange={setComment} placeholder="Comment (optional for approve)" rows={1} />
      <div className="flex justify-end gap-2">
        <Btn variant="outline" disabled={!comment.trim()} title="Reject needs a comment" onClick={() => act.decideChangeRequest(crId, 'reject', comment, me)}>
          Reject change
        </Btn>
        <Btn variant="primary" onClick={() => act.decideChangeRequest(crId, 'approve', comment, me)}>
          Approve change
        </Btn>
      </div>
    </div>
  )
}
