import { useState } from 'react'
import { Play } from 'lucide-react'
import type { Verification } from '@/types'
import { approverRows, fmtRel, verifsOf } from '@/data/requirements'
import { selectReqActions, selectReqs, useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Btn } from '@/components/shell/kit'
import { PersonChip, Select, StateNote, TextArea, VerifPill } from '@/components/shell/reqKit'

/* 12.7 Verification panel: how each requirement is proven and whether it
 * passes now. A check attached to an older version shows as stale. */

const METHOD: Record<Verification['method'], string> = { test: 'Test', shadow: 'Shadow run', lint: 'Lint rule', benchmark: 'Benchmark', attest: 'Attestation' }

export function VerificationPanel({ reqId }: { reqId: string }) {
  const w = useStore(selectReqs)
  const r = w.requirements[reqId]
  const vs = verifsOf(w, reqId).sort((a, b) => Number(b.versionId === r.currentVersionId) - Number(a.versionId === r.currentVersionId))
  if (!vs.length)
    return (
      <StateNote kind="empty" title="No checks yet">
        The verifier attaches a test, shadow run, lint rule or benchmark once the requirement is approved. Some need a person to attest instead.
      </StateNote>
    )
  return (
    <ul className="divide-y divide-[var(--color-line)] px-4 pb-6">
      {vs.map((v) => (
        <VerifRow key={v.id} v={v} />
      ))}
    </ul>
  )
}

function VerifRow({ v }: { v: Verification }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const r = w.requirements[v.requirementId]
  const ver = w.versions[v.versionId]
  const cur = v.versionId === r.currentVersionId
  const canAttest = approverRows(w, me, r).length > 0
  const candidates = w.approvers.filter((a) => (a.scope === r.pocketId || (a.scope === 'codebase' && r.scope === 'codebase')) && a.change !== 'removed' && w.people[a.personId]?.active)
  const [who, setWho] = useState(candidates[0]?.personId ?? '')
  const [attesting, setAttesting] = useState(false)
  const [comment, setComment] = useState('')
  const status = cur ? v.status : 'stale'
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-medium text-[var(--color-ink)]">{METHOD[v.method]}</span>
        <VerifPill status={status} />
        {!cur && <span className="text-[11.5px] text-[var(--color-warn)]">attached to version {ver?.n}; the requirement changed since</span>}
      </div>
      <div className="mt-0.5 text-[12.5px] leading-snug text-[var(--color-muted)]">{v.spec}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--color-faint)]">
        <span>{v.lastRunAtMs ? `last run ${fmtRel(v.lastRunAtMs, w.nowMs)}` : 'never run'}</span>
        {v.artifactRef && <span className="break-all font-mono text-[10.5px]">{v.artifactRef}</span>}
        {v.attestedByPersonId && (
          <span className="flex items-center gap-1">
            attested by <PersonChip id={v.attestedByPersonId} plain />
          </span>
        )}
        {v.requestedFromPersonId && !v.attestedByPersonId && (
          <span className="flex items-center gap-1">
            requested from <PersonChip id={v.requestedFromPersonId} plain />
          </span>
        )}
      </div>
      {v.attestComment && <p className="mt-1 text-[12px] italic text-[var(--color-muted)]">“{v.attestComment}”</p>}

      {cur && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {v.method !== 'attest' && (
            <Btn variant="outline" className="h-7 px-2 text-[12px]" onClick={() => act.runVerification(v.id)} disabled={v.status === 'pending' && v.lastRunAtMs > 0}>
              <Play className="size-3" /> Run now
            </Btn>
          )}
          {v.method === 'attest' && v.status !== 'passing' && (
            <>
              <Select label="Ask to attest" value={who} onChange={setWho} options={candidates.map((a) => ({ id: a.personId, label: w.people[a.personId].name }))} />
              <Btn variant="outline" className="h-7 px-2 text-[12px]" disabled={!who} onClick={() => act.requestAttestation(v.id, who, me)}>
                Request attestation
              </Btn>
              <Btn
                className="h-7 px-2 text-[12px]"
                disabled={!canAttest}
                title={canAttest ? 'Confirm this holds, with a comment' : 'Only approved people for this scope can attest'}
                onClick={() => setAttesting((x) => !x)}
              >
                Attest
              </Btn>
            </>
          )}
        </div>
      )}
      {attesting && (
        <div className="mt-2 space-y-2">
          <TextArea label="Attestation comment" value={comment} onChange={setComment} placeholder="What did you check? (required)" />
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setAttesting(false)}>Cancel</Btn>
            <Btn
              variant="primary"
              disabled={!comment.trim()}
              onClick={() => {
                act.attest(v.id, comment, me)
                setAttesting(false)
              }}
            >
              Attest
            </Btn>
          </div>
        </div>
      )}
    </li>
  )
}
