import { useState } from 'react'
import { Check, X } from 'lucide-react'
import type { InboxGroup } from '@/data/requirements'
import { approvalsOn, canApprove, flagsOf, inbox, isClean, personName, quorumFor, scopeName } from '@/data/requirements'
import { selectReqActions, selectReqs, useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Btn } from '@/components/shell/kit'
import { ModeToggle, PersonChip, ReqGate, StateNote, StatusPill, TextArea, WsBar } from '@/components/shell/reqKit'
import { ChangeDecision } from '@/components/requirements/RequirementDetail'

/* 12.9 Approver inbox: what is waiting on me, grouped by pocket and ranked by
 * how much each group unblocks. Bulk approve only covers clean items I am
 * allowed to approve; anything flagged or contested needs a look. */

export function InboxScreen() {
  const w = useStore(selectReqs)
  const me = useUi((s) => s.viewerId)
  const groups = inbox(w, me)
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WsBar title="Inbox" right={<ModeToggle />}>
        <span className="text-[12px] text-[var(--color-muted)]">
          <span className="tnum font-mono text-[var(--color-ink)]">{total}</span> waiting on {personName(w, me)}
        </span>
      </WsBar>
      <ReqGate>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!groups.length ? (
            <StateNote kind="empty" title={`Nothing is waiting on ${personName(w, me)}`}>
              Requirements, change requests and conflicts you are an approver for land here. Try “Viewing as” another person to see their queue.
            </StateNote>
          ) : (
            <div className="mx-auto max-w-[920px] space-y-5 px-6 py-5">
              {groups.map((g) => (
                <Group key={g.pocketId || 'codebase'} g={g} />
              ))}
            </div>
          )}
        </div>
      </ReqGate>
    </div>
  )
}

function Group({ g }: { g: InboxGroup }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const setPocket = useUi((s) => s.setPocket)
  const go = useUi((s) => s.go)
  const clean = g.items.filter((i) => i.kind === 'requirement' && isClean(w, w.requirements[i.reqId]) && canApprove(w, me, i.reqId).ok)
  const { found, complete, needInfo, conflicts } = g.summary
  const name = g.pocketId ? scopeName(g.pocketId) : 'Whole codebase'
  return (
    <section className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-bg-2)]" aria-label={name}>
      <header className="flex flex-wrap items-start gap-3 border-b border-[var(--color-line)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[14px] font-semibold">{name}</h2>
            {g.unblocks > 0 && <span className="text-[11.5px] text-[var(--color-warn)]">{g.unblocks} gate blocker{g.unblocks > 1 ? 's' : ''}</span>}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--color-muted)]">
            We found {found} requirement{found === 1 ? '' : 's'} for {name}: {complete} complete, {needInfo} need info, {conflicts} conflict{conflicts === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Btn
            variant="ghost"
            onClick={() => {
              setPocket(g.pocketId || 'codebase')
              go('requirements')
            }}
          >
            See all
          </Btn>
          <Btn variant="primary" disabled={!clean.length} title={clean.length ? 'Approve every clean, unflagged item here' : 'Nothing here is clean enough to approve in bulk'} onClick={() => clean.forEach((i) => act.approveRequirement(i.reqId, w.requirements[i.reqId].currentVersionId, 'Approved from the inbox', me))}>
            <Check className="size-3.5" /> Approve {clean.length || ''} clean
          </Btn>
        </div>
      </header>
      <ul>
        {g.items.map((i) => (
          <li key={i.kind + i.id} className="border-b border-[var(--color-line)] px-4 py-3 last:border-b-0">
            {i.kind === 'requirement' ? <ReqItem reqId={i.reqId} /> : i.kind === 'change' ? <ChangeItem crId={i.id} /> : <ConflictItem id={i.id} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ReqItem({ reqId }: { reqId: string }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const openReq = useUi((s) => s.openReq)
  const [rejecting, setRejecting] = useState(false)
  const [why, setWhy] = useState('')
  const r = w.requirements[reqId]
  const v = w.versions[r.currentVersionId]
  const can = canApprove(w, me, reqId)
  const have = approvalsOn(w, v.id).length
  const flags = flagsOf(w, r)
  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--color-faint)]">
            <span className="font-mono text-[11px]">{r.id}</span>
            <StatusPill status={r.status} />
            <span>
              {have} of {quorumFor(r)} approvals
            </span>
            {flags.length > 0 && <span className="text-[var(--color-warn)]">{flags.length} flag{flags.length > 1 ? 's' : ''}</span>}
          </div>
          <p className="mt-1 text-[13px] leading-snug">{v.statement}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Btn variant="ghost" onClick={() => openReq(r.id)}>
            Open
          </Btn>
          <Btn variant="outline" disabled={!can.ok} title={can.ok ? 'Reject with a reason' : can.why} onClick={() => setRejecting((x) => !x)}>
            <X className="size-3.5" /> Reject
          </Btn>
          <Btn variant="primary" disabled={!can.ok} title={can.ok ? 'Approve this version' : can.why} onClick={() => act.approveRequirement(r.id, v.id, '', me)}>
            <Check className="size-3.5" /> Approve
          </Btn>
        </div>
      </div>
      {rejecting && (
        <div className="mt-2 space-y-2">
          <TextArea label="Why reject" value={why} onChange={setWhy} placeholder="Why? (required, the author sees it)" rows={1} />
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setRejecting(false)}>Cancel</Btn>
            <Btn variant="primary" disabled={!why.trim()} onClick={() => act.rejectRequirement(r.id, v.id, why, me)}>
              Reject
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}

function ChangeItem({ crId }: { crId: string }) {
  const w = useStore(selectReqs)
  const openReq = useUi((s) => s.openReq)
  const cr = w.changeRequests[crId]
  const r = w.requirements[cr.requirementId]
  const proposed = w.versions[cr.proposedVersionId]
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--color-faint)]">
        <span className="rounded-[6px] bg-[rgba(239,178,74,.12)] px-1.5 py-[1px] text-[var(--color-warn)]">Change request</span>
        <span className="font-mono text-[11px]">{cr.id}</span>
        <span>on {r.id} by</span>
        <PersonChip id={cr.byPersonId} />
        <Btn variant="ghost" className="ml-auto h-6 px-2 text-[11.5px]" onClick={() => openReq(r.id)}>
          Open
        </Btn>
      </div>
      <p className="mt-1 text-[13px] leading-snug">{proposed?.statement}</p>
      <p className="mt-0.5 text-[12px] text-[var(--color-faint)]">Why: {proposed?.reason.replace(/^Change request [^:]+: /, '')}</p>
      <div className="mt-2">
        <ChangeDecision crId={crId} />
      </div>
    </div>
  )
}

function ConflictItem({ id }: { id: string }) {
  const w = useStore(selectReqs)
  const openConflict = useUi((s) => s.openConflict)
  const c = w.conflicts[id]
  const a = w.versions[c.aVersionId]
  const b = w.versions[c.bVersionId]
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11.5px] text-[var(--color-faint)]">
          <span className="rounded-[6px] bg-[rgba(255,107,107,.12)] px-1.5 py-[1px] text-[var(--color-bad)]">Conflict</span>
          <span className="font-mono text-[11px]">{c.id}</span>
          <span>
            {a?.requirementId} vs {b?.requirementId}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-snug">
          <span className="text-[var(--color-faint)]">A</span> {a?.statement}
        </p>
        <p className="mt-0.5 text-[13px] leading-snug">
          <span className="text-[var(--color-faint)]">B</span> {b?.statement}
        </p>
      </div>
      <Btn variant="outline" className="shrink-0" onClick={() => openConflict(c.id)}>
        Decide
      </Btn>
    </div>
  )
}
