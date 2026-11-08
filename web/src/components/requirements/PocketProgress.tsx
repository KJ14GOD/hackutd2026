import { Lock } from 'lucide-react'
import type { CutoverStage, JobState } from '@/types'
import { PROGRAM } from '@/data/carddemo'
import { HOT_TRAFFIC, MIN_ISOLATION, canSeeScope, fmtWhen, gate, isApproverFor, isRestrictedScope, ownerOfScope, reqCounts, traceCoverage } from '@/data/requirements'
import { selectControls, selectCutover, selectHistory, selectReqActions, selectReqs, useStore } from '@/store/useStore'
import { useUi } from '@/store/useUi'
import { Btn, SectionHead } from '@/components/shell/kit'
import { cn } from '@/lib/cn'

/* 12.16 Pocket progress, inside the Inspector's pocket view: where the
 * migration job is, what the requirements gate is waiting on (each blocker
 * links to its cause), harness attempts, and for the live pocket the match
 * rate and cutover 1 / 10 / 100. */

const STATES: JobState[] = ['queued', 'capturing', 'rewriting', 'shadowing', 'canary', 'done']
const STATE_LABEL: Record<JobState, string> = { queued: 'Queued', capturing: 'Capture', rewriting: 'Rewrite', shadowing: 'Shadow', canary: 'Canary', done: 'Done' }

export function PocketProgress({ pocketId, isolation, liveProgram, threshold }: { pocketId: string; isolation: number; liveProgram: string; threshold: number }) {
  const w = useStore(selectReqs)
  const status = useStore((s) => s.reqStatus)
  const act = useStore(selectReqActions)
  const me = useUi((s) => s.viewerId)
  const setPocket = useUi((s) => s.setPocket)
  const go = useUi((s) => s.go)
  const openReq = useUi((s) => s.openReq)
  const openQuestion = useUi((s) => s.openQuestion)
  const openConflict = useUi((s) => s.openConflict)
  if (status !== 'ready') return null

  const job = w.jobs[pocketId]
  const locked = isRestrictedScope(w, pocketId)
  const canSee = canSeeScope(w, me, pocketId)
  if (locked && !canSee) {
    const owner = ownerOfScope(w, pocketId)
    return (
      <div className="pb-3">
        <SectionHead>Requirements</SectionHead>
        <p className="flex items-center gap-2 px-4 text-[12px] text-[var(--color-faint)]">
          <Lock className="size-3.5" /> Restricted · ask {owner?.name ?? 'the owner'} for access
        </p>
      </div>
    )
  }
  const n = reqCounts(w, pocketId)
  const g = gate(w, pocketId)
  const cov = traceCoverage(w, pocketId)
  const openQs = Object.values(w.questions).filter((q) => q.pocketId === pocketId && q.status !== 'answered').length
  const attempts = w.attempts.filter((a) => a.pocketId === pocketId).sort((a, b) => a.attempt - b.attempt)
  const hot = !!job && job.trafficShare >= HOT_TRAFFIC && isolation < MIN_ISOLATION
  const isLive = PROGRAM[liveProgram]?.pocket === pocketId
  const approver = isApproverFor(w, me, pocketId)
  const canStart = approver && job && (job.state === 'queued' || (job.state === 'capturing' && g.open))
  const goReqs = () => {
    setPocket(pocketId)
    go('requirements')
  }
  const goQs = () => {
    setPocket(pocketId)
    go('questions')
  }
  const at = job ? STATES.indexOf(job.state) : -1

  return (
    <div className="pb-2">
      <SectionHead>
        <span className="flex items-center gap-1.5">
          Requirements and progress {locked && <Lock className="size-3 text-[var(--color-faint)]" aria-label="Restricted" />}
        </span>
      </SectionHead>
      <div className="px-4">
        {hot && (
          <p className="mb-2 rounded-[8px] border border-[rgba(238,109,105,.35)] bg-[rgba(238,109,105,.07)] px-2.5 py-1.5 text-[11.5px] leading-snug text-[var(--color-bad)]">
            Hot and too coupled: {Math.round(job.trafficShare * 100)}% of traffic but isolation {isolation.toFixed(2)} (under {MIN_ISOLATION}). Ranked later until it’s split.
          </p>
        )}
        {n.total ? (
          <p className="text-[12.5px] leading-snug text-[var(--color-muted)]">
            <span className="tnum font-mono text-[var(--color-ink)]">{n.total}</span> requirements: <span className="text-[var(--color-good)]">{n.approved} approved</span>, {n.proposed} proposed
            {n.needsInfo > 0 && <span className="text-[var(--color-warn)]">, {n.needsInfo} need info</span>}
            {n.conflicts > 0 && <span className="text-[var(--color-bad)]">, {n.conflicts} in conflict</span>}.
          </p>
        ) : (
          <p className="text-[12px] text-[var(--color-faint)]">No requirements extracted yet. Capture runs when the job starts.</p>
        )}
        <div className="mt-1.5 flex gap-1">
          <Btn variant="ghost" className="-ml-2 h-7 px-2 text-[12px]" onClick={goReqs}>
            Open requirements
          </Btn>
          {openQs > 0 && (
            <Btn variant="ghost" className="h-7 px-2 text-[12px]" onClick={goQs}>
              {openQs} open question{openQs > 1 ? 's' : ''}
            </Btn>
          )}
        </div>

        {job && (
          <>
            <ol className="mt-2 flex gap-[3px]" aria-label="Migration job state">
              {STATES.map((s, i) => (
                <li key={s} className="min-w-0 flex-1">
                  <div className={cn('h-1 rounded-full', i < at ? 'bg-[var(--color-good)]' : i === at ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-panel-2)]')} />
                  <div className={cn('mt-1 truncate text-[10.5px]', i === at ? 'text-[var(--color-ink)]' : 'text-[var(--color-faint)]')}>{STATE_LABEL[s]}</div>
                </li>
              ))}
            </ol>
            <p className="mt-1 text-[11px] text-[var(--color-faint)]">
              Rank #{job.rank} · {Math.round(job.trafficShare * 100)}% of live traffic
            </p>
          </>
        )}

        {n.total > 0 && (
          <div className="mt-3">
            <div className={cn('text-[12px] font-medium', g.open ? 'text-[var(--color-good)]' : 'text-[var(--color-warn)]')}>{g.summary}</div>
            {g.blockers.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {g.blockers.slice(0, 6).map((b) => (
                  <li key={b.kind + b.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (b.kind === 'question') openQuestion(b.id)
                        else if (b.kind === 'conflict') openConflict(b.id)
                        else if (b.kind === 'verification') openReq(w.verifications[b.id]?.requirementId ?? null, 'verification')
                        else openReq(b.id, 'detail')
                      }}
                      className="text-left text-[11.5px] leading-snug text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                    >
                      · {b.text}
                    </button>
                  </li>
                ))}
                {g.blockers.length > 6 && <li className="text-[11.5px] text-[var(--color-faint)]">and {g.blockers.length - 6} more</li>}
              </ul>
            )}
            <p className="mt-1.5 text-[11px] text-[var(--color-faint)]">
              Traced and verified: {cov.covered} of {cov.total}
            </p>
          </div>
        )}

        {attempts.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] text-[var(--color-faint)]">Harness attempts</div>
            <ul className="mt-1 space-y-1">
              {attempts.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 text-[11.5px] leading-snug">
                  <span className="font-mono text-[var(--color-faint)]">#{a.attempt}</span>
                  <span className={a.outcome === 'passed' ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}>{a.outcome}</span>
                  <span className="min-w-0 text-[var(--color-muted)]">
                    {a.failedRequirementId && (
                      <button type="button" onClick={() => openReq(a.failedRequirementId)} className="mr-1 font-mono hover:text-[var(--color-accent)]">
                        {a.failedRequirementId}
                      </button>
                    )}
                    {a.note}
                  </span>
                  <span className="ml-auto shrink-0 text-[10.5px] text-[var(--color-faint)]">{fmtWhen(a.atMs)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isLive && <LiveCutover blocked={!g.open} threshold={threshold} />}

        {job && (job.state === 'queued' || job.state === 'capturing') && (
          <Btn
            variant="outline"
            className="mt-3 w-full"
            disabled={!canStart}
            title={!approver ? 'Only approvers for this pocket can start it' : job.state === 'capturing' && !g.open ? g.summary : undefined}
            onClick={() => act.startMigration(pocketId, me)}
          >
            {job.state === 'queued' ? 'Start migration' : 'Start the rewrite'}
          </Btn>
        )}
      </div>
    </div>
  )
}

function LiveCutover({ blocked, threshold }: { blocked: boolean; threshold: number }) {
  const history = useStore(selectHistory)
  const stage = useStore(selectCutover)
  const controls = useStore(selectControls)
  const rate = history.length ? history[history.length - 1].rate : 0
  const pts = history.slice(-24)
  const W = 120
  const H = 26
  const lo = Math.min(threshold, ...pts.map((p) => p.rate)) - 0.02
  const hi = 1
  const y = (r: number) => H - ((r - lo) / (hi - lo)) * H
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ')
  const ready = rate >= threshold && !blocked
  const why = blocked ? 'Requirements gate is closed' : rate < threshold ? `Match rate under ${Math.round(threshold * 100)}%` : ''
  return (
    <div className="mt-3 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[11px] text-[var(--color-faint)]">Shadow match</div>
          <div className="tnum font-mono text-[18px] font-semibold">{(rate * 100).toFixed(1)}%</div>
        </div>
        {pts.length > 1 && (
          <svg width={W} height={H} className="ml-auto" aria-label="Match rate over time">
            <line x1={0} x2={W} y1={y(threshold)} y2={y(threshold)} stroke="var(--color-line-2)" strokeDasharray="2 3" />
            <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />
          </svg>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="mr-1 text-[11px] text-[var(--color-faint)]">Cutover</span>
        {([1, 10, 100] as CutoverStage[]).map((s) => (
          <Btn key={s} variant={stage === s ? 'primary' : 'outline'} className="h-7 px-2.5 font-mono text-[11.5px]" disabled={!ready || stage >= s} title={why || `Send ${s}% of traffic to Java`} onClick={() => controls.setCutover(s)}>
            {s}%
          </Btn>
        ))}
      </div>
      {why && <p className="mt-1.5 text-[11px] text-[var(--color-warn)]">{why}.</p>}
    </div>
  )
}
