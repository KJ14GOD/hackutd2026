import { useState } from 'react'
import { Pause, Play, Send, Zap } from 'lucide-react'
import type { Question } from '@/types'
import {
  ESCALATION,
  REASON_LABEL,
  STEP_LABEL,
  canAnswer,
  canSeeQuestion,
  fmtRel,
  fmtSpan,
  fmtWhen,
  isApproverFor,
  ladder,
  personName,
  segments,
} from '@/data/requirements'
import { selectReqActions, selectReqs, useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Btn, Segmented } from '@/components/shell/kit'
import { EvidenceCard, Eyebrow, PersonChip, Restricted, Select, StateNote, StatusPill, TextArea, UrgencyChip } from '@/components/shell/reqKit'
import { cn } from '@/lib/cn'

/* Question detail (12.2) with its escalation timeline (12.3). Answer buttons
 * are the one-click options the Slack card shows; a context hit can be used
 * as the answer, which links it to the requirement as evidence. */

export function QuestionDetail({ id }: { id: string }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const mode = useUi((s) => s.mode)
  const openReq = useUi((s) => s.openReq)
  const openConflict = useUi((s) => s.openConflict)
  const [tab, setTab] = useState<'detail' | 'timeline'>('detail')
  const [text, setText] = useState('')
  const [panel, setPanel] = useState<null | 'reassign' | 'snooze'>(null)
  const [who, setWho] = useState('')
  const [hours, setHours] = useState('24')
  const [why, setWhy] = useState('')

  const q = w.questions[id]
  if (!q) return <StateNote kind="error" title="This question no longer exists" />
  if (!canSeeQuestion(w, me, q))
    return (
      <div className="px-4 py-10">
        <Restricted scope={q.pocketId} />
      </div>
    )

  const can = canAnswer(w, me, q)
  const canManage = isApproverFor(w, me, q.pocketId) || q.routedTo.includes(me)
  const hits = (w.hits[q.id] ?? []).slice().sort((a, b) => b.score - a.score)
  const req = q.requirementId ? w.requirements[q.requirementId] : undefined
  const answered = q.status === 'answered'
  const people = Object.values(w.people).filter((p) => p.kind === 'person' && p.active)

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow">Question · {REASON_LABEL[q.reason]}</span>
          <UrgencyChip urgency={q.urgency} />
          <span className="font-mono text-[11px] text-[var(--color-faint)]">{q.id}</span>
        </div>
        <h2 className="mt-2 text-[16px] font-medium leading-snug text-[var(--color-ink)]">{q.text[mode]}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--color-faint)]">
          <span>Asked {fmtWhen(q.askedAtMs)} · to</span>
          {q.routedTo.map((p) => (
            <PersonChip key={p} id={p} via={q.routedWhy} />
          ))}
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-[var(--color-faint)]">Why them: {q.routedWhy}</p>
        {req && (
          <button type="button" onClick={() => openReq(req.id)} className="mt-2 flex items-center gap-2 text-left text-[12px] text-[var(--color-muted)] hover:text-[var(--color-accent)]">
            <span className="font-mono text-[11px]">{req.id}</span>
            <StatusPill status={req.status} />
            {q.slot && <span className="text-[var(--color-faint)]">fills: {q.slot}</span>}
          </button>
        )}
      </div>

      <div className="flex items-center border-y border-[var(--color-line)] px-4 py-2">
        <Segmented
          size="sm"
          label="Question tab"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'detail', label: 'Detail' },
            { id: 'timeline', label: 'Escalation' },
          ]}
        />
      </div>

      {tab === 'timeline' ? (
        <Timeline q={q} />
      ) : (
        <div className="flex-1 px-4 pb-6">
          <Eyebrow>What raised it</Eyebrow>
          {q.evidence.kind === 'flag' && (
            <p className="rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-[13px] leading-relaxed">
              {segments(q.evidence.statement, [q.evidence.word]).map((s, i) =>
                s.flag ? (
                  <mark key={i} className="rounded-[3px] bg-[rgba(239,178,74,.18)] px-0.5 text-[var(--color-warn)]">
                    {s.text}
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )}
            </p>
          )}
          {q.evidence.kind === 'conflict' &&
            (() => {
              const c = w.conflicts[(q.evidence as { conflictId: string }).conflictId]
              if (!c) return null
              return (
                <div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[c.aVersionId, c.bVersionId].map((vid, i) => (
                      <div key={vid} className="rounded-[8px] border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-[12.5px] leading-snug">
                        <span className="mr-1.5 font-mono text-[11px] text-[var(--color-faint)]">{i ? 'B' : 'A'}</span>
                        {w.versions[vid]?.statement}
                      </div>
                    ))}
                  </div>
                  <Btn variant="ghost" className="-ml-2 mt-1 h-7 px-2 text-[12px]" onClick={() => openConflict(c.id)}>
                    Open the conflict side by side
                  </Btn>
                </div>
              )
            })()}
          {q.evidence.kind === 'shadow' && <EvidenceCard origin="shadow" title="Shadow run mismatch" evidence={q.evidence.detail} />}
          {q.evidence.kind === 'none' && <p className="text-[12px] text-[var(--color-faint)]">Asked to find the right person; nothing in the code answers it.</p>}

          <Eyebrow right={<span className="text-[10.5px] text-[var(--color-faint)]">Jira · Confluence · Notion</span>}>What the docs already say</Eyebrow>
          {hits.length ? (
            <div className="space-y-2">
              {hits.map((h) => (
                <EvidenceCard
                  key={h.id}
                  origin={h.source}
                  title={h.title}
                  evidence={h.quote}
                  url={h.url}
                  refText={`${Math.round(h.score * 100)}% match`}
                  action={
                    !answered && (
                      <Btn variant="ghost" className="h-6 px-2 text-[11.5px]" disabled={!can.ok} title={can.ok ? 'Answer with this and link it as evidence' : can.why} onClick={() => act.answerQuestion(q.id, h.quote, me, h.id)}>
                        Use as the answer
                      </Btn>
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-[var(--color-faint)]">The context search found nothing that answers this.</p>
          )}

          <Eyebrow>Answer</Eyebrow>
          {answered && q.answer ? (
            <div className="rounded-[10px] border border-[rgba(55,202,149,.35)] bg-[rgba(55,202,149,.06)] px-3 py-2.5">
              <p className="text-[13px] leading-snug text-[var(--color-ink)]">{q.answer.text}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--color-faint)]">
                <PersonChip id={q.answer.byPersonId} plain /> · {fmtWhen(q.answer.atMs)}
                {q.answer.viaHitId && <span>· from {w.hits[q.id]?.find((h) => h.id === q.answer!.viaHitId)?.title}</span>}
              </div>
            </div>
          ) : (
            <>
              {q.options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o) => (
                    <Btn key={o} variant="outline" disabled={!can.ok} title={can.ok ? `Answer: ${o}` : can.why} onClick={() => act.answerQuestion(q.id, o, me)}>
                      {o}
                    </Btn>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-end gap-2">
                <div className="flex-1">
                  <TextArea label="Your answer" value={text} onChange={setText} placeholder={q.options.length ? 'Or write your own answer' : 'Write the answer'} />
                </div>
                <Btn variant="primary" disabled={!can.ok || !text.trim()} title={can.ok ? 'Send' : can.why} onClick={() => act.answerQuestion(q.id, text, me)}>
                  <Send className="size-3.5" /> Send
                </Btn>
              </div>
              {!can.ok && <p className="mt-1.5 text-[11.5px] text-[var(--color-faint)]">{can.why}.</p>}
            </>
          )}

          {q.snooze && q.snooze.untilMs > w.nowMs && !answered && (
            <p className="mt-3 text-[12px] text-[var(--color-muted)]">
              Snoozed until {fmtWhen(q.snooze.untilMs)} by {personName(w, q.snooze.byPersonId)}: “{q.snooze.reason}”
            </p>
          )}

          {!answered && (
            <>
              <div className="mt-4 flex gap-2">
                <Btn variant="ghost" className="-ml-2" disabled={!canManage} title={canManage ? 'Send it to someone else' : 'Only approved people for this scope can reassign'} onClick={() => setPanel(panel === 'reassign' ? null : 'reassign')}>
                  Reassign
                </Btn>
                <Btn variant="ghost" disabled={!canManage} title={canManage ? 'Hold the escalation for a while' : 'Only approved people for this scope can snooze'} onClick={() => setPanel(panel === 'snooze' ? null : 'snooze')}>
                  Snooze
                </Btn>
              </div>
              {panel === 'reassign' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Select label="Reassign to" value={who} onChange={setWho} options={[{ id: '', label: 'Choose a person' }, ...people.map((p) => ({ id: p.id, label: `${p.name} · ${p.title}` }))]} />
                  <Btn
                    variant="primary"
                    disabled={!who}
                    onClick={() => {
                      act.reassignQuestion(q.id, [who], me)
                      setPanel(null)
                    }}
                  >
                    Send to them
                  </Btn>
                </div>
              )}
              {panel === 'snooze' && (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Select label="Snooze for" value={hours} onChange={setHours} options={[{ id: '4', label: '4 hours' }, { id: '24', label: '1 day' }, { id: '72', label: '3 days' }]} />
                    <span className="text-[11.5px] text-[var(--color-faint)]">No reminders or escalation until then</span>
                  </div>
                  <TextArea label="Reason" value={why} onChange={setWhy} placeholder="Why wait? (required)" rows={1} />
                  <div className="flex justify-end gap-2">
                    <Btn onClick={() => setPanel(null)}>Cancel</Btn>
                    <Btn
                      variant="primary"
                      disabled={!why.trim()}
                      onClick={() => {
                        act.snoozeQuestion(q.id, Number(hours), why, me)
                        setPanel(null)
                        setWhy('')
                      }}
                    >
                      Snooze
                    </Btn>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* 12.3 Escalation timeline: what happened and when, then what will happen
 * and when, from humanLoop.escalation for this urgency. */
function Timeline({ q }: { q: Question }) {
  const w = useStore(selectReqs)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const [why, setWhy] = useState('')
  const [pausing, setPausing] = useState(false)
  const steps = ladder(w, q)
  const answered = q.status === 'answered'
  const hasNext = steps.some((s) => !s.done && s.step !== 'answered' && s.recipients.length)
  const canManage = isApproverFor(w, me, q.pocketId) || q.routedTo.includes(me)
  const plan = ESCALATION[q.urgency].map((e) => `${STEP_LABEL[e.step].toLowerCase()} after ${fmtSpan(e.afterH * 3_600_000)}`).join(', ')
  return (
    <div className="flex-1 px-4 pb-6 pt-4">
      <ol className="relative space-y-4 border-l border-[var(--color-line-2)] pl-5">
        <li className="relative">
          <Dot done />
          <div className="text-[12.5px] font-medium">Raised</div>
          <div className="text-[11.5px] text-[var(--color-faint)]">{fmtWhen(q.askedAtMs)} · {fmtRel(q.askedAtMs, w.nowMs)}</div>
        </li>
        {steps.map((s) => {
          const label = s.step === 'answered' ? 'Answered' : STEP_LABEL[s.step]
          const late = !s.done && s.atMs <= w.nowMs
          return (
            <li key={s.key} className={cn('relative', !s.done && 'opacity-80')}>
              <Dot done={s.done} good={s.step === 'answered'} />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={cn('text-[12.5px] font-medium', s.done ? 'text-[var(--color-ink)]' : 'text-[var(--color-muted)]')}>{label}</span>
                <span className={cn('text-[11.5px]', late ? 'text-[var(--color-warn)]' : 'text-[var(--color-faint)]')}>
                  {s.done ? `${fmtWhen(s.atMs)} · ${fmtRel(s.atMs, w.nowMs)}` : q.escalationPaused ? 'paused' : `due ${fmtWhen(s.atMs)} · ${fmtRel(s.atMs, w.nowMs)}`}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {s.recipients.length ? s.recipients.map((r) => <PersonChip key={r} id={r} />) : <span className="text-[11.5px] text-[var(--color-faint)]">nobody left to ask at this step</span>}
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-4 text-[11.5px] leading-snug text-[var(--color-faint)]">
        Ladder for {q.urgency} questions: {plan}.
      </p>
      {q.escalationPaused && (
        <p className="mt-2 text-[12px] text-[var(--color-warn)]">
          Paused by {personName(w, q.escalationPaused.byPersonId)}: “{q.escalationPaused.reason}”
        </p>
      )}
      {!answered && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn variant="outline" disabled={!hasNext || !!q.escalationPaused || !canManage} title={canManage ? 'Send the next step now' : 'Only approved people for this scope can escalate'} onClick={() => act.escalateNow(q.id, me)}>
            <Zap className="size-3.5" /> Escalate now
          </Btn>
          {q.escalationPaused ? (
            <Btn disabled={!canManage} onClick={() => act.pauseEscalation(q.id, null, me)}>
              <Play className="size-3.5" /> Resume escalation
            </Btn>
          ) : (
            <Btn disabled={!canManage} onClick={() => setPausing((x) => !x)}>
              <Pause className="size-3.5" /> Pause escalation
            </Btn>
          )}
        </div>
      )}
      {pausing && !q.escalationPaused && (
        <div className="mt-2 space-y-2">
          <TextArea label="Why pause" value={why} onChange={setWhy} placeholder="Why pause? (required)" rows={1} />
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setPausing(false)}>Cancel</Btn>
            <Btn
              variant="primary"
              disabled={!why.trim()}
              onClick={() => {
                act.pauseEscalation(q.id, why, me)
                setPausing(false)
                setWhy('')
              }}
            >
              Pause
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}

function Dot({ done, good }: { done?: boolean; good?: boolean }) {
  return (
    <span
      className={cn('absolute -left-[26px] top-[4px] size-2.5 rounded-full border-2 border-[var(--color-bg-2)]', !done && 'border-[var(--color-line-2)] bg-transparent')}
      style={done ? { background: good ? 'var(--color-good)' : 'var(--color-accent)' } : { boxShadow: 'inset 0 0 0 1.5px var(--color-faint)' }}
    />
  )
}
