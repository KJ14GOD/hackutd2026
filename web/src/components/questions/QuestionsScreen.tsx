import { useState } from 'react'
import { Clock3 } from 'lucide-react'
import type { Question, QuestionReason, Urgency } from '@/types'
import { POCKET, POCKETS } from '@/data/carddemo'
import { HOUR, REASON_LABEL, STEP_LABEL, canSeeQuestion, fmtRel, fmtWhen, nextStep, personName } from '@/data/requirements'
import { selectReqActions, selectReqs, useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'

import { ModeToggle, PersonChip, ReqGate, Restricted, Select, Split, StateNote, Toggle, UrgencyChip, WsBar } from '@/components/shell/reqKit'
import { cn } from '@/lib/cn'
import { QuestionDetail } from './QuestionDetail'

/* 12.2 Questions: every open question, why it exists, who it went to, and
 * where it is on the escalation ladder. Times are on the sim clock. */

const URG: Urgency[] = ['critical', 'high', 'normal', 'low']
const URG_RANK: Record<Urgency, number> = { critical: 0, high: 1, normal: 2, low: 3 }

export function SimClock() {
  const now = useStore((s) => s.reqs.nowMs)
  const act = useStore(selectReqActions)
  return (
    <div className="flex items-center gap-1 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] py-0.5 pl-2 pr-0.5" title="Sim clock: escalations fire on this time, not the wall clock">
      <Clock3 className="size-3.5 text-[var(--color-faint)]" />
      <span className="tnum font-mono text-[11.5px] text-[var(--color-muted)]">{fmtWhen(now)}</span>
      <button type="button" onClick={() => act.advanceClock(HOUR)} className="rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-faint)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]" title="Move the sim clock forward an hour">
        +1h
      </button>
      <button type="button" onClick={() => act.advanceClock(6 * HOUR)} className="rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-faint)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]" title="Move the sim clock forward six hours">
        +6h
      </button>
    </div>
  )
}

export function QuestionsScreen() {
  const w = useStore(selectReqs)
  const me = useUi((s) => s.viewerId)
  const pocket = useUi((s) => s.pocket)
  const setPocket = useUi((s) => s.setPocket)
  const questionId = useUi((s) => s.questionId)
  const openQuestion = useUi((s) => s.openQuestion)
  const [reason, setReason] = useState<'' | QuestionReason>('')
  const [urgency, setUrgency] = useState<'' | Urgency>('')
  const [status, setStatus] = useState<'' | 'waiting' | 'answered'>('waiting')
  const [mine, setMine] = useState(false)

  const all = Object.values(w.questions)
  const rows = all
    .filter((q) => {
      if (reason && q.reason !== reason) return false
      if (urgency && q.urgency !== urgency) return false
      if (pocket && q.pocketId !== pocket) return false
      if (status === 'waiting' && q.status === 'answered') return false
      if (status === 'answered' && q.status !== 'answered') return false
      if (mine && !q.routedTo.includes(me) && !Object.values(w.outreach).some((o) => o.questionId === q.id && o.recipientPersonId === me)) return false
      return true
    })
    .sort((a, b) => Number(a.status === 'answered') - Number(b.status === 'answered') || URG_RANK[a.urgency] - URG_RANK[b.urgency] || a.askedAtMs - b.askedAtMs)
  const pockets = POCKETS.filter((p) => all.some((q) => q.pocketId === p.id))
  const waiting = all.filter((q) => q.status !== 'answered').length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WsBar
        title="Questions"
        right={
          <>
            <SimClock />
            <ModeToggle />
          </>
        }
      >
        <span className="text-[12px] text-[var(--color-muted)]">
          <span className="tnum font-mono text-[var(--color-warn)]">{waiting}</span> waiting on people
        </span>
      </WsBar>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-4 py-2">
        <Select label="Status" value={status} onChange={setStatus} options={[{ id: 'waiting', label: 'Waiting' }, { id: 'answered', label: 'Answered' }, { id: '', label: 'All' }]} />
        <Select label="Reason" value={reason} onChange={setReason} options={[{ id: '', label: 'Any reason' }, ...(Object.keys(REASON_LABEL) as QuestionReason[]).map((r) => ({ id: r, label: REASON_LABEL[r] }))]} />
        <Select label="Urgency" value={urgency} onChange={setUrgency} options={[{ id: '', label: 'Any urgency' }, ...URG.map((u) => ({ id: u, label: u[0].toUpperCase() + u.slice(1) }))]} />
        <Select label="Pocket" value={pocket} onChange={setPocket} options={[{ id: '', label: 'All pockets' }, ...pockets.map((p) => ({ id: p.id, label: p.title }))]} />
        <Toggle on={mine} onChange={setMine}>
          Routed to me
        </Toggle>
      </div>
      <ReqGate>
        <Split
          list={
            !all.length ? (
              <StateNote kind="empty" title="No questions yet">
                When a requirement has a gap, an ambiguous word, or two sources disagree, the agent asks the right person. Those questions land here.
              </StateNote>
            ) : !rows.length ? (
              <StateNote kind="empty" title={mine ? `Nothing is waiting on ${personName(w, me)}` : 'Nothing matches these filters'}>
                {mine ? 'Questions routed to you, or escalated to you, show up here.' : 'Try another status or pocket.'}
              </StateNote>
            ) : (
              <ul aria-label="Questions" className="pb-10">
                {rows.map((q) => (
                  <QRow key={q.id} q={q} selected={q.id === questionId} onOpen={() => openQuestion(q.id)} />
                ))}
              </ul>
            )
          }
          detail={
            questionId && w.questions[questionId] ? (
              <QuestionDetail key={questionId} id={questionId} />
            ) : (
              <StateNote kind="empty" title="Pick a question">
                You’ll see the evidence that raised it, what the docs already say, who it went to, and its escalation timeline.
              </StateNote>
            )
          }
        />
      </ReqGate>
    </div>
  )
}

function QRow({ q, selected, onOpen }: { q: Question; selected: boolean; onOpen: () => void }) {
  const w = useStore(selectReqs)
  const me = useUi((s) => s.viewerId)
  const mode = useUi((s) => s.mode)
  if (!canSeeQuestion(w, me, q))
    return (
      <li className="border-b border-[var(--color-line)] px-4 py-3">
        <Restricted scope={q.pocketId} />
      </li>
    )
  const next = nextStep(w, q)
  const answered = q.status === 'answered'
  return (
    <li onClick={onOpen} className={cn('cursor-pointer border-b border-[var(--color-line)] px-4 py-3 transition-colors hover:bg-[var(--color-panel)]', selected && 'bg-[var(--color-panel-2)] shadow-[inset_2px_0_0_var(--color-accent)]', answered && 'opacity-70')}>
      <p className="text-[13px] leading-snug text-[var(--color-ink)]">{q.text[mode]}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-[var(--color-faint)]">
        <span className="font-mono text-[11px]">{q.id}</span>
        <span className="rounded-[6px] bg-[var(--color-panel-2)] px-1.5 py-[1px] text-[var(--color-muted)]">{REASON_LABEL[q.reason]}</span>
        <UrgencyChip urgency={q.urgency} />
        <span>{mode === 'engineer' ? q.scope : (POCKET[q.pocketId]?.title ?? q.scope)}</span>
        <span className="flex flex-wrap items-center gap-1">
          {q.routedTo.map((id) => (
            <PersonChip key={id} id={id} />
          ))}
        </span>
        {answered ? (
          <span className="text-[var(--color-good)]">Answered by {personName(w, q.answer!.byPersonId)}</span>
        ) : q.escalationPaused ? (
          <span className="text-[var(--color-warn)]">Escalation paused</span>
        ) : q.snooze && q.snooze.untilMs > w.nowMs ? (
          <span>Snoozed {fmtRel(q.snooze.untilMs, w.nowMs)}</span>
        ) : next && next.step !== 'answered' ? (
          <span className={next.atMs <= w.nowMs ? 'text-[var(--color-warn)]' : undefined}>
            {STEP_LABEL[next.step]} {fmtRel(next.atMs, w.nowMs)}
          </span>
        ) : (
          <span>No more escalation steps</span>
        )}
      </div>
    </li>
  )
}

