import { useState } from 'react'
import { ArrowLeft, Bot, ChevronRight, Lock, ShieldCheck } from 'lucide-react'
import type { Approver, Ownership, OwnershipSignal, Person } from '@/types'
import { POCKETS } from '@/data/carddemo'
import { ADMINS, CATEGORY_LABEL, canSeeScope, fmtWhen, isRestrictedScope, personName, scopeName } from '@/data/requirements'
import { selectReqActions, selectReqs, useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Btn, Segmented } from '@/components/shell/kit'
import { Avatar, Eyebrow, PersonChip, ReqGate, Select, StateNote, TextArea, WsBar } from '@/components/shell/reqKit'
import { cn } from '@/lib/cn'

/* 12.10 People and ownership, 12.12 Approver list. Who owns what and why we
 * think so (every row names its signal and source), who may approve, and
 * the list an admin signs off. Corrections are overrides, never silent. */

const SIGNAL_LABEL: Record<OwnershipSignal, string> = {
  codeowners: 'CODEOWNERS',
  'git-blame': 'Git history',
  'jira-assignee': 'Jira assignee',
  'confluence-author': 'Confluence author',
  'org-chart': 'Org chart',
  runbook: 'Runbook',
  chat: 'Slack',
  override: 'Corrected',
}
const KIND_LABEL: Record<Ownership['kind'], string> = { owns: 'Owns', contributes: 'Contributes', consulted: 'Consulted', consumes: 'Consumes' }
const CHANGE_LABEL: Record<NonNullable<Approver['change']>, string> = { new: 'New', removed: 'Removed', 'crossed-threshold': 'Crossed threshold', left: 'Left the company' }

export function PeopleScreen() {
  const tab = useUi((s) => s.peopleTab)
  const setTab = useUi((s) => s.setPeopleTab)
  const personId = useUi((s) => s.personId)
  const scopeId = useUi((s) => s.scopeId)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WsBar title="People">
        <Segmented
          size="sm"
          label="People view"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'org', label: 'Ownership' },
            { id: 'approvers', label: 'Approver list' },
          ]}
        />
      </WsBar>
      <ReqGate>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'approvers' ? <ApproverList /> : personId ? <PersonPage id={personId} /> : scopeId ? <ScopePage id={scopeId} /> : <Org />}
        </div>
      </ReqGate>
    </div>
  )
}

/* ------------------------------ org ------------------------------ */

function Org() {
  const w = useStore(selectReqs)
  const openPerson = useUi((s) => s.openPerson)
  const openScope = useUi((s) => s.openScope)
  const systems = Object.values(w.people).filter((p) => p.kind === 'system')
  const roots = Object.values(w.teams).filter((t) => !t.parentTeamId)
  const ownerOf = (scope: string) => w.ownership.filter((o) => o.target === scope && o.kind === 'owns').sort((a, b) => b.weight - a.weight)[0]

  return (
    <div className="mx-auto grid max-w-[1100px] gap-8 px-6 py-5 lg:grid-cols-[1fr_1fr]">
      <section aria-label="Teams">
        <h2 className="text-[13px] font-semibold">Teams</h2>
        <p className="mt-0.5 text-[12px] text-[var(--color-faint)]">From the org chart (Workday), joined to git, Jira and Slack identities. Click a person for what they own and why.</p>
        {roots.map((t) => (
          <TeamNode key={t.id} id={t.id} depth={0} />
        ))}
        <Eyebrow>Systems with a stake</Eyebrow>
        <ul>
          {systems.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => openPerson(s.id)} className="flex w-full items-center gap-2 rounded-[7px] px-1.5 py-1 text-left hover:bg-[var(--color-panel)]">
                <Bot className="size-4 text-[var(--color-faint)]" />
                <span className="text-[12.5px]">{s.name}</span>
                <span className="truncate text-[11.5px] text-[var(--color-faint)]">{s.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Scopes">
        <h2 className="text-[13px] font-semibold">Pockets and their owners</h2>
        <p className="mt-0.5 text-[12px] text-[var(--color-faint)]">The strongest ownership signal per pocket. Open one for everyone with a stake.</p>
        <ul className="mt-2">
          {['codebase', ...POCKETS.map((p) => p.id)].map((id) => {
            const o = ownerOf(id)
            const locked = isRestrictedScope(w, id)
            return (
              <li key={id}>
                <button type="button" onClick={() => openScope(id)} className="flex w-full items-center gap-2 border-b border-[var(--color-line)] px-1.5 py-2 text-left hover:bg-[var(--color-panel)]">
                  {locked && <Lock className="size-3.5 shrink-0 text-[var(--color-faint)]" aria-label="Restricted" />}
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{scopeName(id)}</span>
                  {o ? (
                    <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-muted)]">
                      <Avatar id={o.personId} />
                      <span className={cn(!w.people[o.personId]?.active && 'text-[var(--color-faint)] line-through')}>{personName(w, o.personId)}</span>
                      {!w.people[o.personId]?.active && w.people[o.personId]?.successorId ? (
                        <span className="text-[11px] text-[var(--color-warn)]">left · ask {personName(w, w.people[o.personId].successorId!)}</span>
                      ) : (
                        <span className="text-[11px] text-[var(--color-faint)]">{SIGNAL_LABEL[o.signal]}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[12px] text-[var(--color-warn)]">No owner found</span>
                  )}
                  <ChevronRight className="size-3.5 text-[var(--color-faint)]" />
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

/** One team and its sub-teams; empty teams (no people, no sub-teams) are skipped. */
function TeamNode({ id, depth }: { id: string; depth: number }) {
  const w = useStore(selectReqs)
  const me = useUi((s) => s.viewerId)
  const openPerson = useUi((s) => s.openPerson)
  const t = w.teams[id]
  const members = Object.values(w.people)
    .filter((p) => p.kind === 'person' && p.teamId === id)
    .sort((a, b) => Number(b.id === t.managerId) - Number(a.id === t.managerId) || Number(b.active) - Number(a.active))
  const kids = Object.values(w.teams).filter((x) => x.parentTeamId === id)
  if (!members.length && !kids.length) return null
  return (
    <div style={{ marginLeft: depth ? 16 : 0 }} className={cn(depth > 0 && 'border-l border-[var(--color-line)] pl-3')}>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[13px] font-medium">{t.name}</span>
        {t.managerId && <span className="text-[11.5px] text-[var(--color-faint)]">led by {personName(w, t.managerId)}</span>}
      </div>
      <ul className="mt-1">
        {members.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => openPerson(p.id)} className={cn('flex w-full items-center gap-2 rounded-[7px] px-1.5 py-1 text-left hover:bg-[var(--color-panel)]', !p.active && 'opacity-50')}>
              <Avatar id={p.id} size={20} />
              <span className={cn('text-[12.5px]', !p.active && 'line-through')}>{p.name}</span>
              <span className="truncate text-[11.5px] text-[var(--color-faint)]">{p.title}</span>
              {p.id === me && <span className="text-[10.5px] text-[var(--color-accent)]">you</span>}
              {!p.active && <span className="text-[11px] text-[var(--color-faint)]">left</span>}
              <span className="ml-auto font-mono text-[11px] text-[var(--color-faint)]" title="Pockets or programs they own">
                {w.ownership.filter((o) => o.personId === p.id && o.kind === 'owns').length || ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {kids.map((k) => (
        <TeamNode key={k.id} id={k.id} depth={depth + 1} />
      ))}
    </div>
  )
}

/* ---------------------------- person ---------------------------- */

function PersonPage({ id }: { id: string }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const openPerson = useUi((s) => s.openPerson)
  const openScope = useUi((s) => s.openScope)
  const p = w.people[id]
  if (!p) return <StateNote kind="error" title="We don’t know this person" />
  const owns = w.ownership.filter((o) => o.personId === id).sort((a, b) => b.weight - a.weight)
  const auth = w.approvers.filter((a) => a.personId === id)
  const team = w.teams[p.teamId]
  const reports = Object.values(w.people).filter((x) => x.managerId === id)
  const canMarkLeft = p.kind === 'person' && p.active && (me === p.managerId || ADMINS.includes(me))
  const waiting = Object.values(w.questions).filter((q) => q.status !== 'answered' && q.routedTo.includes(id))
  return (
    <div className="mx-auto max-w-[920px] px-6 py-5">
      <Btn className="-ml-2" onClick={() => openPerson(null)}>
        <ArrowLeft className="size-3.5" /> Everyone
      </Btn>
      <div className="mt-3 flex items-start gap-3">
        {p.kind === 'system' ? <Bot className="size-10 text-[var(--color-faint)]" /> : <Avatar id={p.id} size={40} />}
        <div className="min-w-0 flex-1">
          <h2 className={cn('text-[18px] font-semibold tracking-[-0.01em]', !p.active && 'text-[var(--color-faint)] line-through')}>{p.name}</h2>
          <p className="text-[12.5px] text-[var(--color-muted)]">
            {p.title}
            {team && ` · ${team.name}`}
            {p.handle && <span className="ml-1.5 font-mono text-[11.5px] text-[var(--color-faint)]">{p.handle}</span>}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--color-faint)]">
            {p.managerId && (
              <span className="flex items-center gap-1">
                Reports to <PersonChip id={p.managerId} />
              </span>
            )}
            {reports.length > 0 && <span>{reports.length} direct report{reports.length > 1 ? 's' : ''}</span>}
            {p.sources.length > 0 && <span>Known from {p.sources.join(', ')}</span>}
          </div>
          {!p.active && (
            <p className="mt-2 text-[12.5px] text-[var(--color-warn)]">
              Has left. Their questions now go to {p.successorId ? personName(w, p.successorId) : 'their manager'}; approver rows wait for an admin.
            </p>
          )}
        </div>
        {p.kind === 'person' && p.active && (
          <Btn variant="outline" disabled={!canMarkLeft} title={canMarkLeft ? 'Reroute their questions and flag their approver rows' : 'Only their manager or an admin can do this'} onClick={() => act.markPersonLeft(p.id, me)}>
            Mark as left
          </Btn>
        )}
      </div>

      <Eyebrow>Ownership</Eyebrow>
      {owns.length ? (
        <div className="overflow-hidden rounded-[10px] border border-[var(--color-line)]">
          {owns.map((o) => (
            <OwnRow key={o.id} o={o} onScope={() => openScope(o.target)} />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-[var(--color-faint)]">No ownership signals point at {p.name}.</p>
      )}

      <Eyebrow>May approve</Eyebrow>
      {auth.length ? (
        <ul className="space-y-1.5">
          {auth.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <ShieldCheck className="size-3.5 text-[var(--color-faint)]" />
              <button type="button" onClick={() => openScope(a.scope)} className="hover:text-[var(--color-accent)]">
                {scopeName(a.scope)}
              </button>
              <span className="text-[var(--color-faint)]">{a.category === '*' ? 'any category' : CATEGORY_LABEL[a.category]}</span>
              <span className="tnum font-mono text-[11.5px] text-[var(--color-muted)]">{a.score.toFixed(2)}</span>
              {a.change && <ChangeBadge a={a} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-[var(--color-faint)]">Not on the approver list.</p>
      )}

      {waiting.length > 0 && (
        <>
          <Eyebrow>Questions waiting on {p.name.split(' ')[0]}</Eyebrow>
          <ul className="space-y-1">
            {waiting.map((q) => (
              <li key={q.id}>
                <QuestionLink id={q.id} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function QuestionLink({ id }: { id: string }) {
  const w = useStore(selectReqs)
  const mode = useUi((s) => s.mode)
  const openQuestion = useUi((s) => s.openQuestion)
  const q = w.questions[id]
  return (
    <button type="button" onClick={() => openQuestion(id)} className="text-left text-[12.5px] leading-snug text-[var(--color-muted)] hover:text-[var(--color-accent)]">
      <span className="mr-1.5 font-mono text-[11px] text-[var(--color-faint)]">{id}</span>
      {q.text[mode]}
    </button>
  )
}

function OwnRow({ o, onScope }: { o: Ownership; onScope: () => void }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const [fixing, setFixing] = useState(false)
  const [who, setWho] = useState('')
  const [why, setWhy] = useState('')
  const people = Object.values(w.people).filter((p) => p.kind === 'person' && p.active && p.id !== o.personId)
  return (
    <div className="border-b border-[var(--color-line)] px-3 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-[86px] shrink-0 text-[11.5px] text-[var(--color-faint)]">{KIND_LABEL[o.kind]}</span>
        <button type="button" onClick={onScope} className="text-[12.5px] hover:text-[var(--color-accent)]">
          {scopeName(o.target)}
        </button>
        <span className={cn('rounded-[6px] px-1.5 py-[1px] text-[11px]', o.signal === 'override' ? 'bg-[var(--color-accent-dim)] text-[var(--color-accent-bright)]' : 'bg-[var(--color-panel-2)] text-[var(--color-muted)]')}>{SIGNAL_LABEL[o.signal]}</span>
        <Confidence v={o.weight} />
        <span className="ml-auto">
          <Btn variant="ghost" className="h-6 px-2 text-[11.5px]" onClick={() => setFixing((x) => !x)}>
            Correct
          </Btn>
        </span>
      </div>
      <p className="mt-1 pl-[98px] text-[11.5px] leading-snug text-[var(--color-faint)]">
        {o.source} · {o.evidence} · seen {fmtWhen(o.observedAtMs)}
      </p>
      {o.override && (
        <p className="mt-0.5 pl-[98px] text-[11.5px] text-[var(--color-accent-bright)]">
          Was {o.override.was}; corrected by {personName(w, o.override.byPersonId)}: “{o.override.reason}”
        </p>
      )}
      {fixing && (
        <div className="mt-2 space-y-2 pl-[98px]">
          <Select label="Should be" value={who} onChange={setWho} options={[{ id: '', label: 'Who should it be?' }, ...people.map((p) => ({ id: p.id, label: `${p.name} · ${p.title}` }))]} />
          <TextArea label="Why" value={why} onChange={setWhy} placeholder="Why? (required, kept as an override)" rows={1} />
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setFixing(false)}>Cancel</Btn>
            <Btn
              variant="primary"
              disabled={!who || !why.trim()}
              onClick={() => {
                act.correctOwnership(o.id, who, why, me)
                setFixing(false)
              }}
            >
              Save correction
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}

function Confidence({ v }: { v: number }) {
  const pct = Math.round(v * 100)
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-[var(--color-faint)]" title={`${pct}% confidence`}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
        <span className="block h-full rounded-full bg-[var(--color-muted)]" style={{ width: `${pct}%` }} />
      </span>
      <span className="tnum font-mono">{pct}%</span>
    </span>
  )
}

/* ----------------------------- scope ----------------------------- */

function ScopePage({ id }: { id: string }) {
  const w = useStore(selectReqs)
  const openScope = useUi((s) => s.openScope)
  const setPocket = useUi((s) => s.setPocket)
  const go = useUi((s) => s.go)
  const locked = isRestrictedScope(w, id)
  // one row per person: their strongest stake, plus whether they may approve
  const byPerson = new Map<string, { p: Person; stake: Ownership[]; auth: Approver[]; rank: number }>()
  const row = (pid: string) => {
    let r = byPerson.get(pid)
    if (!r && w.people[pid]) byPerson.set(pid, (r = { p: w.people[pid], stake: [], auth: [], rank: 0 }))
    return r
  }
  for (const o of w.ownership.filter((x) => x.target === id)) {
    const r = row(o.personId)
    if (r) {
      r.stake.push(o)
      r.rank = Math.max(r.rank, o.weight * (o.kind === 'owns' ? 1 : 0.6))
    }
  }
  for (const a of w.approvers.filter((x) => x.scope === id && x.change !== 'removed')) {
    const r = row(a.personId)
    if (r) {
      r.auth.push(a)
      r.rank = Math.max(r.rank, a.score)
    }
  }
  const rows = [...byPerson.values()].sort((a, b) => Number(b.p.active) - Number(a.p.active) || b.rank - a.rank)
  const grants = w.access.filter((g) => g.scope === id)
  return (
    <div className="mx-auto max-w-[920px] px-6 py-5">
      <Btn className="-ml-2" onClick={() => openScope(null)}>
        <ArrowLeft className="size-3.5" /> Everyone
      </Btn>
      <div className="mt-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.01em]">
            {locked && <Lock className="size-4 text-[var(--color-faint)]" aria-label="Restricted" />}
            {scopeName(id)}
          </h2>
          <p className="text-[12.5px] text-[var(--color-muted)]">{id === 'codebase' ? 'Rules that hold everywhere' : <span className="font-mono text-[11.5px]">{id}</span>}</p>
        </div>
        <Btn
          variant="ghost"
          onClick={() => {
            setPocket(id)
            go('requirements')
          }}
        >
          Requirements
        </Btn>
      </div>
      {locked && (
        <p className="mt-3 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-[12px] leading-snug text-[var(--color-muted)]">
          Restricted. Only {grants.map((g) => personName(w, g.personId)).join(', ')} can see its requirements ({[...new Set(grants.map((g) => g.sourcePermission))].join('; ')}). Nobody else is asked or listed as an approver.
        </p>
      )}
      <Eyebrow>Stakeholders, by authority</Eyebrow>
      {rows.length ? (
        <div className="overflow-hidden rounded-[10px] border border-[var(--color-line)]">
          {rows.map(({ p, stake, auth, rank }) => (
            <div key={p.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] px-3 py-2.5 last:border-b-0', !p.active && 'opacity-55')}>
              {p.kind === 'system' ? (
                <span className="flex items-center gap-1.5 text-[12.5px]">
                  <Bot className="size-4 text-[var(--color-faint)]" />
                  {p.name}
                </span>
              ) : (
                <PersonChip id={p.id} />
              )}
              <span className="text-[11.5px] text-[var(--color-faint)]">{[...new Set(stake.map((s) => `${KIND_LABEL[s.kind].toLowerCase()} (${SIGNAL_LABEL[s.signal]})`))].join(', ')}</span>
              {auth.length > 0 && (
                <span className="flex items-center gap-1 text-[11.5px] text-[var(--color-good)]">
                  <ShieldCheck className="size-3.5" /> approves {auth.map((a) => (a.category === '*' ? 'all' : CATEGORY_LABEL[a.category].toLowerCase())).join(', ')}
                </span>
              )}
              {locked && !canSeeScope(w, p.id, id) && p.kind === 'person' && <span className="text-[11.5px] text-[var(--color-warn)]">no access</span>}
              <span className="tnum ml-auto font-mono text-[11.5px] text-[var(--color-muted)]">{rank.toFixed(2)}</span>
            </div>
          ))}
        </div>
      ) : (
        <StateNote kind="empty" title="Nobody yet">
          No signal points at this pocket. The agent asks the domain’s manager until someone claims it.
        </StateNote>
      )}
    </div>
  )
}

/* --------------------------- approvers --------------------------- */

function ChangeBadge({ a }: { a: Approver }) {
  if (!a.change) return null
  const tone = a.change === 'new' || a.change === 'crossed-threshold' ? 'text-[var(--color-accent-bright)] bg-[var(--color-accent-dim)]' : 'text-[var(--color-warn)] bg-[rgba(239,178,74,.12)]'
  return (
    <span className={cn('rounded-[6px] px-1.5 py-[1px] text-[11px]', tone)}>
      {CHANGE_LABEL[a.change]}
      {a.changeDecision && ` · ${a.changeDecision}`}
    </span>
  )
}

function ApproverList() {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const admin = ADMINS.includes(me)
  const pending = w.approvers.filter((a) => a.change && !a.changeDecision)
  const scopes = [...new Set(w.approvers.map((a) => a.scope))].sort((a, b) => (a === 'codebase' ? -1 : b === 'codebase' ? 1 : scopeName(a).localeCompare(scopeName(b))))
  const so = w.approverSignOff
  return (
    <div className="mx-auto max-w-[1000px] px-6 py-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Who may approve what</h2>
          <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--color-muted)]">
            Scored from ownership, review history and the org chart. An admin signs the list off; changes since the last sign-off wait for a decision.
          </p>
          <p className="mt-1 text-[12px] text-[var(--color-faint)]">{so ? `Last signed off by ${personName(w, so.byPersonId)} · ${fmtWhen(so.atMs)}` : 'Never signed off'}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Btn variant="primary" disabled={!admin || pending.length > 0} title={!admin ? 'Only admins (Elena, Alex) can sign off' : pending.length ? `Decide the ${pending.length} pending changes first` : 'Sign off the current list'} onClick={() => act.signOffApprovers(me)}>
            <ShieldCheck className="size-3.5" /> Sign off the list
          </Btn>
          <span className="text-[11.5px] text-[var(--color-faint)]">{pending.length ? `${pending.length} change${pending.length > 1 ? 's' : ''} to decide` : 'No pending changes'}</span>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-[10px] border border-[var(--color-line)]">
        <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
          <thead className="text-[11px] text-[var(--color-faint)]">
            <tr className="border-b border-[var(--color-line)]">
              <th className="px-3 py-2 font-normal">Person</th>
              <th className="px-3 py-2 font-normal">Category</th>
              <th className="px-3 py-2 text-right font-normal">Score</th>
              <th className="px-3 py-2 font-normal">Evidence</th>
              <th className="px-3 py-2 font-normal">Status</th>
            </tr>
          </thead>
          {scopes.map((s) => (
            <tbody key={s}>
              <tr className="bg-[var(--color-panel)]">
                <td colSpan={5} className="px-3 py-1.5 text-[12px] font-medium">
                  <span className="flex items-center gap-1.5">
                    {isRestrictedScope(w, s) && <Lock className="size-3 text-[var(--color-faint)]" aria-label="Restricted" />}
                    {scopeName(s)}
                  </span>
                </td>
              </tr>
              {w.approvers
                .filter((a) => a.scope === s)
                .sort((a, b) => b.score - a.score)
                .map((a) => {
                  const noAccess = isRestrictedScope(w, s) && !canSeeScope(w, a.personId, s)
                  const gone = a.change === 'removed' || a.change === 'left' || noAccess
                  return (
                    <tr key={a.id} className={cn('border-t border-[var(--color-line)] align-top', gone && 'opacity-60')}>
                      <td className="px-3 py-2">
                        <PersonChip id={a.personId} />
                      </td>
                      <td className="px-3 py-2 text-[var(--color-muted)]">{a.category === '*' ? 'Any' : CATEGORY_LABEL[a.category]}</td>
                      <td className="tnum px-3 py-2 text-right font-mono">{a.score.toFixed(2)}</td>
                      <td className="max-w-[300px] px-3 py-2 text-[11.5px] leading-snug text-[var(--color-faint)]">{a.evidence.join(' · ')}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {noAccess ? (
                            <span className="text-[11.5px] text-[var(--color-warn)]">Excluded: no access</span>
                          ) : a.change ? (
                            <ChangeBadge a={a} />
                          ) : (
                            <span className="text-[11.5px] text-[var(--color-faint)]">{a.signedOff ? 'Signed off' : 'Not signed off'}</span>
                          )}
                          {a.change && !a.changeDecision && !noAccess && (
                            <>
                              <Btn variant="ghost" className="h-6 px-2 text-[11.5px]" disabled={!admin} title={admin ? 'Accept this change' : 'Only admins decide'} onClick={() => act.decideApproverChange(a.id, 'accepted', me)}>
                                Accept
                              </Btn>
                              <Btn variant="ghost" className="h-6 px-2 text-[11.5px]" disabled={!admin} title={admin ? 'Reject this change' : 'Only admins decide'} onClick={() => act.decideApproverChange(a.id, 'rejected', me)}>
                                Reject
                              </Btn>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          ))}
        </table>
      </div>
      {!admin && <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">You are viewing as {personName(w, me)}. Switch “Viewing as” to Elena or Alex to decide changes and sign off.</p>}
    </div>
  )
}
