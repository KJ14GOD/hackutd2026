import { useMemo, useState } from 'react'
import { Swords } from 'lucide-react'
import type { ReqCategory, ReqStatus, ReqType, Requirement, ScopeLevel } from '@/types'
import { POCKETS } from '@/data/carddemo'
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  approvalsOn,
  canApprove,
  canSeeReq,
  flagsOf,
  openConflictOf,
  quorumFor,
  reqCounts,
  segments,
  verifSummary,
  scopeLabel,
} from '@/data/requirements'
import { selectReqActions, selectReqs, useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { C } from '@/components/map/theme'
import { Btn } from '@/components/shell/kit'
import { ModeToggle, PersonChip, ReqGate, Restricted, Select, Split, StateNote, StatusPill, Toggle, VerifPill, WsBar } from '@/components/shell/reqKit'
import { cn } from '@/lib/cn'
import { RequirementDetail } from './RequirementDetail'
import { ConflictView } from './ConflictView'

/* 12.4 Requirements review: the main working screen. Header counts are
 * filters; the list is two lines per requirement so nothing important is
 * cut; bulk approve only ever selects items the viewer can approve. */

const ORDER: ReqStatus[] = ['needs-info', 'proposed', 'draft', 'approved', 'rejected', 'superseded']
const CATS = Object.keys(CATEGORY_LABEL) as ReqCategory[]


export function RequirementsScreen() {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const pocket = useUi((s) => s.pocket)
  const setPocket = useUi((s) => s.setPocket)
  const reqId = useUi((s) => s.reqId)
  const openReq = useUi((s) => s.openReq)
  const conflictId = useUi((s) => s.conflictId)
  const openConflict = useUi((s) => s.openConflict)

  const [status, setStatus] = useState<'' | ReqStatus>('')
  const [category, setCategory] = useState<'' | ReqCategory>('')
  const [type, setType] = useState<'' | ReqType>('')
  const [level, setLevel] = useState<'' | ScopeLevel>('')
  const [flagged, setFlagged] = useState(false)
  const [mine, setMine] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const counts = reqCounts(w)
  const all = Object.values(w.requirements)
  const pocketsWithReqs = useMemo(() => POCKETS.filter((p) => all.some((r) => r.pocketId === p.id)), [all])

  const rows = all
    .filter((r) => {
      if (status && r.status !== status) return false
      if (category && r.category !== category) return false
      if (type && r.type !== type) return false
      if (level && r.scopeLevel !== level) return false
      if (pocket && (pocket === 'codebase' ? r.pocketId !== '' : r.pocketId !== pocket)) return false
      if (flagged && !flagsOf(w, r).length) return false
      if (mine && !canApprove(w, me, r.id).ok) return false
      return true
    })
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.pocketId.localeCompare(b.pocketId) || a.id.localeCompare(b.id))

  const conflicts = Object.values(w.conflicts).filter((c) => {
    if (c.status !== 'open') return false
    const a = w.requirements[w.versions[c.aVersionId]?.requirementId]
    return a && (!pocket || a.pocketId === pocket) && canSeeReq(w, me, a)
  })

  const selectable = [...picked].filter((id) => canApprove(w, me, id).ok)
  const clear = () => {
    setStatus('')
    setCategory('')
    setType('')
    setLevel('')
    setFlagged(false)
    setMine(false)
    setPocket('')
  }

  if (conflictId) return <ConflictView id={conflictId} onBack={() => openConflict(null)} />

  const countChip = (n: number, label: string, on: boolean, onClick: () => void, color?: string) => (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn('rounded-[6px] px-1.5 py-0.5 text-[12px] transition-colors hover:bg-[var(--color-panel-2)]', on && 'bg-[var(--color-panel-2)] shadow-[inset_0_0_0_1px_var(--color-line-2)]')}>
      <span className="tnum font-mono" style={{ color: n ? color : "var(--color-faint)" }}>
        {n}
      </span>{' '}
      <span className="text-[var(--color-muted)]">{label}</span>
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WsBar
        title="Requirements"
        right={<ModeToggle />}
      >
        <div className="flex flex-wrap items-center gap-0.5">
          {countChip(counts.proposed, 'proposed', status === 'proposed', () => setStatus(status === 'proposed' ? '' : 'proposed'), C.accent)}
          <span className="text-[var(--color-line-2)]">·</span>
          {countChip(counts.flagged, 'flagged', flagged, () => setFlagged(!flagged), C.warn)}
          <span className="text-[var(--color-line-2)]">·</span>
          {countChip(counts.conflicts, counts.conflicts === 1 ? 'conflict' : 'conflicts', false, () => conflicts[0] && openConflict(conflicts[0].id), C.bad)}
          <span className="text-[var(--color-line-2)]">·</span>
          {countChip(counts.approved, 'approved', status === 'approved', () => setStatus(status === 'approved' ? '' : 'approved'), C.good)}
        </div>
      </WsBar>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-4 py-2">
        <Select label="Status" value={status} onChange={setStatus} options={[{ id: '', label: 'Any status' }, ...ORDER.map((s) => ({ id: s, label: STATUS_LABEL[s] }))]} />
        <Select label="Category" value={category} onChange={setCategory} options={[{ id: '', label: 'Any category' }, ...CATS.map((c) => ({ id: c, label: CATEGORY_LABEL[c] }))]} />
        <Select label="Type" value={type} onChange={setType} options={[{ id: '', label: 'Any type' }, { id: 'functional', label: 'Functional' }, { id: 'quality', label: 'Quality' }, { id: 'constraint', label: 'Constraint' }]} />
        <Select
          label="Scope level"
          value={level}
          onChange={setLevel}
          options={[{ id: '', label: 'Any level' }, { id: 'codebase', label: 'Codebase' }, { id: 'pocket', label: 'Pocket' }, { id: 'program', label: 'Program' }, { id: 'function', label: 'Function' }, { id: 'lines', label: 'Lines' }, { id: 'field', label: 'Field' }]}
        />
        <Select label="Pocket" value={pocket} onChange={setPocket} options={[{ id: '', label: 'All pockets' }, { id: 'codebase', label: 'Whole codebase' }, ...pocketsWithReqs.map((p) => ({ id: p.id, label: p.title }))]} />
        <Toggle on={flagged} onChange={setFlagged}>
          Flagged only
        </Toggle>
        <Toggle on={mine} onChange={setMine}>
          I can approve
        </Toggle>
      </div>

      <ReqGate>
        <Split
          list={
            <div className="pb-20">
              {conflicts.length > 0 && (
                <div className="border-b border-[var(--color-line)] bg-[rgba(238,109,105,.04)] px-4 py-2.5">
                  {conflicts.map((c) => {
                    const a = w.versions[c.aVersionId]
                    const b = w.versions[c.bVersionId]
                    return (
                      <button key={c.id} type="button" onClick={() => openConflict(c.id)} className="flex w-full items-start gap-2.5 rounded-[8px] px-1 py-1 text-left hover:bg-[var(--color-panel)]">
                        <Swords className="mt-[2px] size-3.5 shrink-0 text-[var(--color-bad)]" />
                        <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
                          <span className="font-medium text-[var(--color-ink)]">Two requirements disagree</span>
                          <span className="text-[var(--color-muted)]"> · “{a?.statement}” vs “{b?.statement}”</span>
                        </span>
                        <span className="shrink-0 text-[11.5px] text-[var(--color-bad)]">Resolve</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {!all.length ? (
                <StateNote kind="empty" title="No requirements yet">
                  The requirements worker drafts them from the code, captured runs and your documents. They appear here as they are proposed.
                </StateNote>
              ) : !rows.length ? (
                <StateNote kind="empty" title="Nothing matches these filters" action={<Btn variant="outline" onClick={clear}>Clear filters</Btn>}>
                  Try another status or pocket.
                </StateNote>
              ) : (
                <ul aria-label="Requirements">
                  {rows.map((r) => (
                    <ReqRow
                      key={r.id}
                      r={r}
                      selected={reqId === r.id}
                      picked={picked.has(r.id)}
                      onPick={(on) => {
                        const n = new Set(picked)
                        if (on) n.add(r.id)
                        else n.delete(r.id)
                        setPicked(n)
                      }}
                      onOpen={() => openReq(r.id)}
                    />
                  ))}
                </ul>
              )}

              {selectable.length > 0 && (
                <div className="sticky bottom-3 mx-4 mt-3 flex items-center gap-3 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-raise)] px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,.5)]">
                  <span className="text-[12.5px] text-[var(--color-muted)]">
                    {selectable.length} clean requirement{selectable.length > 1 ? 's' : ''} selected
                  </span>
                  <span className="flex-1" />
                  <Btn onClick={() => setPicked(new Set())}>Clear</Btn>
                  <Btn
                    variant="primary"
                    onClick={() => {
                      for (const id of selectable) act.approveRequirement(id, w.requirements[id].currentVersionId, '', me)
                      setPicked(new Set())
                    }}
                  >
                    Approve selected
                  </Btn>
                </div>
              )}
            </div>
          }
          detail={
            reqId && w.requirements[reqId] ? (
              <RequirementDetail key={reqId} id={reqId} />
            ) : (
              <StateNote kind="empty" title="Pick a requirement">
                Its statement, slots, evidence, history and checks show here, with Approve, Edit and Request change.
              </StateNote>
            )
          }
        />
      </ReqGate>
    </div>
  )
}

function ReqRow({ r, selected, picked, onPick, onOpen }: { r: Requirement; selected: boolean; picked: boolean; onPick: (on: boolean) => void; onOpen: () => void }) {
  const w = useStore(selectReqs)
  const me = useUi((s) => s.viewerId)
  const mode = useUi((s) => s.mode)
  if (!canSeeReq(w, me, r)) {
    return (
      <li className="border-b border-[var(--color-line)] px-4 py-3 pl-11">
        <Restricted scope={r.pocketId || r.scope} />
      </li>
    )
  }
  const v = w.versions[r.currentVersionId]
  const flags = flagsOf(w, r)
  const can = canApprove(w, me, r.id)
  const vs = verifSummary(w, r)
  const conflict = openConflictOf(w, r)
  const q = quorumFor(r)
  const got = approvalsOn(w, r.currentVersionId).length
  return (
    <li
      className={cn('group flex cursor-pointer gap-3 border-b border-[var(--color-line)] px-4 py-2.5 transition-colors hover:bg-[var(--color-panel)]', selected && 'bg-[var(--color-panel-2)] shadow-[inset_2px_0_0_var(--color-accent)]')}
      onClick={onOpen}
    >
      <input
        type="checkbox"
        className="mt-[3px] size-3.5 shrink-0 accent-[var(--color-accent)] disabled:opacity-25"
        checked={picked && can.ok}
        disabled={!can.ok}
        title={can.ok ? 'Select to approve in bulk' : can.why}
        aria-label={`Select ${r.id}`}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onPick(e.target.checked)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] text-[var(--color-faint)]">{r.id}</span>
          <StatusPill status={r.status} />
          {conflict && <span className="text-[11px] text-[var(--color-bad)]">in conflict</span>}
          {r.status === 'proposed' && q > 1 && (
            <span className="tnum text-[11px] text-[var(--color-faint)]">
              {got} of {q} approvals
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--color-ink)]" title={v.statement}>
          {segments(v.statement, flags.map((f) => f.word)).map((s, i) =>
            s.flag ? (
              <mark key={i} className="rounded-[3px] bg-[rgba(239,178,74,.16)] px-0.5 text-[var(--color-warn)]">
                {s.text}
              </mark>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-[var(--color-faint)]">
          <span className="text-[var(--color-muted)]">{CATEGORY_LABEL[r.category]}</span>
          <span>{r.type}</span>
          <span className={mode === 'engineer' ? 'font-mono' : undefined}>{scopeLabel(r, mode)}</span>
          {flags.length > 0 && (
            <span style={{ color: C.warn }}>
              {flags.length} flag{flags.length > 1 ? 's' : ''}
            </span>
          )}
          {vs && <VerifPill status={vs} />}
          <PersonChip id={r.ownerPersonId} plain />
        </div>
      </div>
    </li>
  )
}
