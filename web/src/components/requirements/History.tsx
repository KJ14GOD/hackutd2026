import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { approvalsOn, fmtWhen, personName, wordDiff } from '@/data/requirements'
import { selectReqActions, selectReqs, useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Btn } from '@/components/shell/kit'
import { Eyebrow, PersonChip, Select } from '@/components/shell/reqKit'
import { cn } from '@/lib/cn'

/* 12.5 Requirement history: every version with its author, time, reason and
 * approval state; a word-level diff between any two; restore an old one
 * (that makes a new version, which needs approval again). */

export function History({ reqId }: { reqId: string }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const r = w.requirements[reqId]
  const versions = Object.values(w.versions)
    .filter((v) => v.requirementId === reqId)
    .sort((a, b) => b.n - a.n)
  const pendingCr = Object.values(w.changeRequests).find((c) => c.requirementId === reqId && c.status === 'open')
  const cur = w.versions[r.currentVersionId]
  const older = versions.find((v) => v.n < cur.n)
  const [from, setFrom] = useState(older?.id ?? cur.id)
  const [to, setTo] = useState(pendingCr?.proposedVersionId ?? cur.id)
  const a = w.versions[from]
  const b = w.versions[to]

  const stateOf = (vid: string) => {
    if (pendingCr?.proposedVersionId === vid) return { text: `Proposed change ${pendingCr.id}`, color: 'var(--color-accent)' }
    const ok = approvalsOn(w, vid)
    const rej = w.approvals.find((x) => x.versionId === vid && x.decision === 'reject')
    if (vid === r.currentVersionId) {
      if (r.status === 'approved') return { text: `Current · approved by ${ok.map((x) => personName(w, x.approverPersonId)).join(', ')}`, color: 'var(--color-good)' }
      if (r.status === 'rejected' && rej) return { text: `Current · rejected by ${personName(w, rej.approverPersonId)}`, color: 'var(--color-bad)' }
      return { text: ok.length ? `Current · ${ok.length} approval${ok.length > 1 ? 's' : ''} so far` : 'Current · not approved yet', color: 'var(--color-muted)' }
    }
    if (ok.length) return { text: `Replaced · was approved by ${ok.map((x) => personName(w, x.approverPersonId)).join(', ')}`, color: 'var(--color-faint)' }
    return { text: 'Replaced · never approved', color: 'var(--color-faint)' }
  }

  const opts = versions.map((v) => ({ id: v.id, label: `Version ${v.n}${v.id === r.currentVersionId ? ' (current)' : pendingCr?.proposedVersionId === v.id ? ' (proposed)' : ''}` }))

  return (
    <div className="px-4 pb-6">
      <Eyebrow>Compare</Eyebrow>
      {versions.length < 2 ? (
        <p className="text-[12.5px] text-[var(--color-faint)]">Only one version so far. Edits and answered questions add versions here.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-faint)]">
            <Select label="From version" value={from} onChange={setFrom} options={opts} />
            <span>→</span>
            <Select label="To version" value={to} onChange={setTo} options={opts} />
          </div>
          {a && b && (
            <p className="mt-2.5 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--color-ink)]">
              {wordDiff(a.statement, b.statement).map((d, i) => (
                <span
                  key={i}
                  className={cn(d.op === 'add' && 'rounded-[3px] bg-[rgba(55,202,149,.16)] text-[var(--color-good)]', d.op === 'del' && 'rounded-[3px] bg-[rgba(238,109,105,.14)] text-[var(--color-bad)] line-through')}
                >
                  {d.text}
                </span>
              ))}
            </p>
          )}
          {a && b && a.id !== b.id && (
            <div className="mt-2 space-y-1 text-[12px]">
              {(['actor', 'condition', 'outcome', 'measure', 'rationale'] as const)
                .filter((k) => a[k] !== b[k])
                .map((k) => (
                  <div key={k} className="grid grid-cols-[80px_1fr] gap-2">
                    <span className="capitalize text-[var(--color-faint)]">{k}</span>
                    <span>
                      {wordDiff(a[k] || '(empty)', b[k] || '(empty)').map((d, i) => (
                        <span key={i} className={cn(d.op === 'add' && 'text-[var(--color-good)]', d.op === 'del' && 'text-[var(--color-bad)] line-through', d.op === 'same' && 'text-[var(--color-muted)]')}>
                          {d.text}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      <Eyebrow>Versions</Eyebrow>
      <ol className="relative space-y-3 border-l border-[var(--color-line-2)] pl-4">
        {versions.map((v) => {
          const st = stateOf(v.id)
          const restorable = v.id !== r.currentVersionId && pendingCr?.proposedVersionId !== v.id
          return (
            <li key={v.id} className="relative">
              <span className="absolute -left-[21px] top-[5px] size-2.5 rounded-full border-2 border-[var(--color-bg-2)]" style={{ background: st.color }} />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[12.5px] font-medium text-[var(--color-ink)]">Version {v.n}</span>
                <span className="text-[11.5px] text-[var(--color-faint)]">{fmtWhen(v.createdAtMs)}</span>
                <PersonChip id={v.authorPersonId} plain />
              </div>
              <div className="mt-0.5 text-[12px] leading-snug text-[var(--color-muted)]">{v.reason}</div>
              <div className="mt-0.5 text-[11.5px]" style={{ color: st.color }}>
                {st.text}
              </div>
              {restorable && (
                <Btn variant="ghost" className="-ml-2 mt-0.5 h-7 px-2 text-[12px]" onClick={() => act.restoreVersion(reqId, v.id, me)} title="Creates a new version with this text. It needs approval again.">
                  <RotateCcw className="size-3.5" /> Restore this version
                </Btn>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
