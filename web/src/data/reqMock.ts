import type {
  Approval,
  Outreach,
  OutreachStep,
  Question,
  ReqSlot,
  ReqWorld,
  Requirement,
  RequirementFlag,
  RequirementLink,
  RequirementVersion,
  Verification,
} from '@/types'
import type { ReqActions, VersionSlots } from './source'
import { reduceReq, type ReqEvent } from './reqEvents'
import { seedWorld } from './reqSeed'
import {
  ADMINS,
  HOUR,
  MINUTE,
  approvalsOn,
  approverRows,
  authority,
  canApprove,
  canSeeReq,
  dueSteps,
  gate,
  impactOf,
  ladder,
  lint,
  personName,
  quorumFor,
} from './requirements'
import { onSlackAnswer, postToSlack } from './slackOut'
import { BUSINESS, questionCard, wordingProblems } from './slackCard'

/* ------------------------------------------------------------------ *
 * The requirements half of MockSource. It keeps its own copy of the world
 * (updated with the same reducer as the store) and turns each action into
 * events. Refusals are silent here because the UI already explains them;
 * the real reducers will throw instead.
 * ------------------------------------------------------------------ */

/** Recorded rewrites for the seeded questions: what the requirements worker
 * produces once an answer fills a slot (deterministic, replayed offline). */
const FILLS: Record<string, Partial<VersionSlots>> = {
  'Q-0001|Last calendar day': { statement: 'Interest is calculated on each category balance on the last calendar day of the month.', condition: 'Last calendar day of the month' },
  'Q-0001|Last business day': { statement: 'Interest is calculated on each category balance on the last business day of the month.', condition: 'Last business day of the month' },
  'Q-0001|Statement cycle date': { statement: 'Interest is calculated on each category balance on the account’s statement cycle date.', condition: 'The account’s statement cycle date' },
  'Q-0003|By 02:00': { statement: 'Nightly posting of up to 2 million records finishes by 02:00 so statements can start on time.', measure: 'Finished by 02:00' },
  'Q-0003|Within 90 minutes': { statement: 'Nightly posting of up to 2 million records finishes within 90 minutes so statements can start on time.', measure: '≤ 90 minutes end to end' },
  'Q-0003|Before CBSTM03A starts': { statement: 'Nightly posting of up to 2 million records finishes before the statement job (CBSTM03A) is scheduled to start.', measure: 'Done before CBSTM03A’s 03:30 start' },
  'Q-0006|Platform security service': { actor: 'Platform security service (called by sign-on and user admin)' },
  'Q-0006|Identity team (Okta)': { actor: 'Identity team’s Okta service (called by sign-on and user admin)' },
}

/** Recorded verification results (what the verifier returns in the rehearsal). */
const RUNS: Record<string, (w: ReqWorld) => Verification['status']> = {
  'VF-0005': (w) => (w.questions['Q-0004']?.status === 'answered' ? 'passing' : 'failing'),
  'VF-0010': () => 'failing',
}

type Slots = VersionSlots
const slotsOf = (v: RequirementVersion): Slots => ({ statement: v.statement, actor: v.actor, condition: v.condition, outcome: v.outcome, measure: v.measure, rationale: v.rationale })
const SLOT_REASON: Record<ReqSlot, Question['reason']> = { actor: 'missing-actor', measure: 'missing-number', condition: 'ambiguous-word', outcome: 'unmade-decision', rationale: 'unmade-decision' }

export class ReqMock implements ReqActions {
  private w: ReqWorld = seedWorld()
  private seq = 100
  private clock: number | null = null

  private emit: (e: ReqEvent) => void
  constructor(emit: (e: ReqEvent) => void) {
    this.emit = emit
  }

  world() {
    return this.w
  }

  /** Start the sim clock: one sim minute per real second; escalations fire when due. */
  start() {
    if (this.clock !== null || typeof window === 'undefined') return
    onSlackAnswer(({ q, o, p }) => this.answerQuestion(q, o, p))
    this.clock = window.setInterval(() => this.tick(MINUTE), 1000)
  }

  reset() {
    this.w = seedWorld()
    this.emit({ type: 'reqWorld', world: this.w })
  }

  advanceClock(ms: number) {
    this.tick(ms)
  }

  /* ------------------------------ plumbing ------------------------------ */

  private commit(...events: ReqEvent[]) {
    for (const e of events) {
      this.w = reduceReq(this.w, e)
      this.emit(e)
    }
  }
  private id(prefix: string) {
    return `${prefix}-${String(++this.seq).padStart(4, '0')}`
  }
  private get now() {
    return this.w.nowMs
  }

  private tick(ms: number) {
    this.commit({ type: 'clockTick', nowMs: this.now + ms })
    // Clock-driven escalations stay in the UI; at one sim minute per second they would flood Slack.
    for (const q of Object.values(this.w.questions)) {
      for (const s of dueSteps(this.w, q)) this.send(q, s.step as OutreachStep, s.recipients, s.atMs, false)
    }
  }

  private send(q: Question, step: OutreachStep, recipients: string[], atMs = this.now, toSlack = true) {
    if (toSlack) this.toSlack(q, step, recipients)
    for (const r of recipients) {
      const o: Outreach = {
        id: this.id('OR'),
        questionId: q.id,
        recipientPersonId: r,
        channel: 'slack-dm',
        rendering: BUSINESS.includes(r) ? 'business' : 'engineer',
        urgency: q.urgency,
        step,
        status: 'sent',
        sentAtMs: atMs,
      }
      this.commit({ type: 'outreachUpserted', outreach: o })
    }
  }

  /** One card per recipient, posted to real Slack in dev; a click answers through onSlackAnswer. */
  private toSlack(q: Question, step: OutreachStep, recipients: string[]) {
    const vague = wordingProblems(`${q.text.business} ${q.text.engineer}`)
    if (vague.length) console.warn(`[slack] ${q.id} wording is vague: ${vague.join(', ')}`)
    for (const r of recipients) postToSlack(questionCard(this.w, q, step, r))
  }

  /** Write a new current version: lint it, raise questions for new gaps, stale the checks. */
  private newVersion(r: Requirement, slots: Slots, reason: string, as: string, opts: { status?: Requirement['status']; extraLinks?: RequirementLink[] } = {}) {
    const n = Math.max(...Object.values(this.w.versions).filter((v) => v.requirementId === r.id).map((v) => v.n)) + 1
    const v: RequirementVersion = { ...slots, id: `${r.id}@${n}`, requirementId: r.id, n, authorPersonId: as, createdAtMs: this.now, reason }
    const problems = lint(v, r.type)
    let flags: RequirementFlag[] = []
    if (problems.length) {
      const q = this.createQuestion(r, problems[0].rule === 'missing-actor' ? 'actor' : problems[0].rule === 'missing-number' || problems[0].rule === 'vague-quantifier' ? 'measure' : 'condition', v.statement, problems[0].word, problems[0].rule === 'missing-actor' ? 'missing-actor' : problems[0].rule === 'ambiguous-word' ? 'ambiguous-word' : 'missing-number')
      flags = problems.map((p, i) => ({ id: `FL-${v.id}-${i}`, versionId: v.id, rule: p.rule, word: p.word, questionId: q.id }))
    }
    const status = problems.length ? 'needs-info' : (opts.status ?? 'proposed')
    const req: Requirement = { ...r, currentVersionId: v.id, status }
    const links = opts.extraLinks ? [...(this.w.links[r.id] ?? []), ...opts.extraLinks] : undefined
    this.commit({ type: 'requirementUpserted', requirement: req, version: v, flags, links })
    // checks on the old version no longer prove anything
    for (const ver of Object.values(this.w.verifications)) {
      if (ver.requirementId === r.id && ver.versionId !== v.id && ver.status !== 'stale') {
        this.commit({ type: 'verificationUpserted', verification: { ...ver, status: 'stale' } })
        this.commit({ type: 'verificationUpserted', verification: { ...ver, id: this.id('VF'), versionId: v.id, status: 'pending', lastRunAtMs: 0, artifactRef: '', attestedByPersonId: undefined, attestComment: undefined } })
      }
    }
    // questions this version settles
    if (!problems.length) {
      for (const q of Object.values(this.w.questions)) {
        if (q.requirementId === r.id && q.status !== 'answered' && q.evidence.kind === 'flag') {
          this.commit({ type: 'questionUpserted', question: { ...q, status: 'answered', answer: { byPersonId: as, text: `Settled by version ${n}: ${reason}`, atMs: this.now } } })
        }
      }
    }
    return v
  }

  private createQuestion(r: Requirement, slot: ReqSlot, statement: string, word: string, reason: Question['reason']) {
    const owner = this.w.people[r.ownerPersonId]
    const to = owner?.active ? owner.id : (owner?.successorId ?? owner?.managerId ?? r.ownerPersonId)
    const what = word ? `“${word}”` : `the ${slot}`
    const q: Question = {
      id: this.id('Q'),
      reason,
      requirementId: r.id,
      slot,
      urgency: r.category === 'business-rule' || r.category === 'security' ? 'high' : 'normal',
      scope: r.scope,
      pocketId: r.pocketId,
      status: 'open',
      claimedBy: '',
      text: {
        business: `In “${statement}”, what exactly does ${what} mean? Please give a value someone could test.`,
        engineer: `${r.id} (${r.scope}): ${slot} is unclear (${what}). What should the Java code do?`,
      },
      evidence: word ? { kind: 'flag', statement, word } : { kind: 'none' },
      options: [],
      routedTo: [to],
      routedWhy: owner?.active ? `${owner.name} owns this requirement` : `${owner?.name ?? 'The owner'} left; routed to ${personName(this.w, to)}`,
      askedAtMs: this.now,
    }
    this.commit({ type: 'questionUpserted', question: q })
    this.send(q, 'ask', q.routedTo)
    return q
  }

  /* ---------------------------- requirements ---------------------------- */

  approveRequirement(reqId: string, versionId: string, comment: string, as: string) {
    const r = this.w.requirements[reqId]
    if (!r || r.currentVersionId !== versionId || !canApprove(this.w, as, reqId).ok) return
    const a: Approval = { id: this.id('AP'), requirementId: reqId, versionId, approverPersonId: as, authority: authority(this.w, as, r), decision: 'approve', comment, atMs: this.now }
    this.commit({ type: 'approvalRecorded', approval: a })
    if (approvalsOn(this.w, versionId).length >= quorumFor(r)) {
      this.commit({ type: 'requirementUpserted', requirement: { ...r, status: 'approved' }, version: this.w.versions[versionId], flags: this.w.flags[versionId] ?? [] })
    }
  }

  rejectRequirement(reqId: string, versionId: string, comment: string, as: string) {
    const r = this.w.requirements[reqId]
    if (!r || r.currentVersionId !== versionId || !approverRows(this.w, as, r).length || !comment.trim()) return
    this.commit({ type: 'approvalRecorded', approval: { id: this.id('AP'), requirementId: reqId, versionId, approverPersonId: as, authority: authority(this.w, as, r), decision: 'reject', comment, atMs: this.now } })
    this.commit({ type: 'requirementUpserted', requirement: { ...r, status: 'rejected' }, version: this.w.versions[versionId], flags: this.w.flags[versionId] ?? [] })
  }

  editRequirement(reqId: string, slots: Slots, reason: string, as: string) {
    const r = this.w.requirements[reqId]
    if (!r || !canSeeReq(this.w, as, r)) return
    this.newVersion(r, slots, reason || `Edited by ${personName(this.w, as)}`, as)
  }

  restoreVersion(reqId: string, versionId: string, as: string) {
    const r = this.w.requirements[reqId]
    const v = this.w.versions[versionId]
    if (!r || !v || v.requirementId !== reqId || !canSeeReq(this.w, as, r)) return
    this.newVersion(r, slotsOf(v), `Restored version ${v.n}`, as)
  }

  markNeedsInfo(reqId: string, slot: ReqSlot, as: string) {
    const r = this.w.requirements[reqId]
    if (!r || !canSeeReq(this.w, as, r)) return
    const v = this.w.versions[r.currentVersionId]
    this.commit({ type: 'requirementUpserted', requirement: { ...r, status: 'needs-info' }, version: v, flags: this.w.flags[v.id] ?? [] })
    this.createQuestion(r, slot, v.statement, '', SLOT_REASON[slot])
  }

  requestRequirementChange(reqId: string, slots: Slots, reason: string, as: string) {
    const r = this.w.requirements[reqId]
    if (!r || !canSeeReq(this.w, as, r)) return ''
    const n = Math.max(...Object.values(this.w.versions).filter((v) => v.requirementId === r.id).map((v) => v.n)) + 1
    const v: RequirementVersion = { ...slots, id: `${r.id}@${n}`, requirementId: r.id, n, authorPersonId: as, createdAtMs: this.now, reason: reason || 'Change request' }
    // the requirement itself is unchanged until the change is approved
    this.commit({ type: 'versionAdded', version: v, flags: [] })
    const id = this.id('CR')
    this.commit({ type: 'changeRequestUpserted', changeRequest: { id, requirementId: r.id, proposedVersionId: v.id, impact: impactOf(this.w, r.id), status: 'open', byPersonId: as, atMs: this.now } })
    return id
  }

  decideChangeRequest(changeId: string, decision: 'approve' | 'reject', comment: string, as: string) {
    const c = this.w.changeRequests[changeId]
    const r = c && this.w.requirements[c.requirementId]
    if (!c || !r || c.status !== 'open' || c.byPersonId === as || !approverRows(this.w, as, r).length) return
    const v = this.w.versions[c.proposedVersionId]
    this.commit({ type: 'approvalRecorded', approval: { id: this.id('AP'), requirementId: r.id, versionId: v.id, approverPersonId: as, authority: authority(this.w, as, r), decision, comment, atMs: this.now } })
    this.commit({ type: 'changeRequestUpserted', changeRequest: { ...c, status: decision === 'approve' ? 'approved' : 'rejected' } })
    if (decision === 'reject') return
    const enough = approvalsOn(this.w, v.id).length >= quorumFor(r)
    this.commit({ type: 'requirementUpserted', requirement: { ...r, currentVersionId: v.id, status: enough ? 'approved' : 'proposed' }, version: v, flags: [] })
    for (const ver of Object.values(this.w.verifications)) {
      if (ver.requirementId !== r.id || ver.versionId === v.id || ver.status === 'stale') continue
      this.commit({ type: 'verificationUpserted', verification: { ...ver, status: 'stale' } })
      this.commit({ type: 'verificationUpserted', verification: { ...ver, id: this.id('VF'), versionId: v.id, status: 'pending', lastRunAtMs: 0, artifactRef: '' } })
    }
    for (const pk of c.impact.pocketsBack) {
      const job = this.w.jobs[pk]
      if (job) this.commit({ type: 'jobUpserted', job: { ...job, state: 'rewriting' } })
    }
  }

  resolveConflict(conflictId: string, pick: 'a' | 'b' | 'escalate', comment: string, as: string) {
    const c = this.w.conflicts[conflictId]
    if (!c || c.status !== 'open' || !comment.trim()) return
    const a = this.w.requirements[this.w.versions[c.aVersionId].requirementId]
    const b = this.w.requirements[this.w.versions[c.bVersionId].requirementId]
    if (!approverRows(this.w, as, a).length || !approverRows(this.w, as, b).length) return
    if (pick === 'escalate') {
      this.commit({ type: 'conflictUpserted', conflict: { ...c, resolution: 'escalated', comment } })
      this.escalateNow(c.questionId, as)
      return
    }
    const [win, lose] = pick === 'a' ? [a, b] : [b, a]
    this.commit({ type: 'conflictUpserted', conflict: { ...c, status: 'resolved', resolution: pick, resolvedByPersonId: as, comment } })
    this.commit({ type: 'requirementUpserted', requirement: { ...lose, status: 'superseded' }, version: this.w.versions[lose.currentVersionId], flags: this.w.flags[lose.currentVersionId] ?? [] })
    this.commit({ type: 'requirementUpserted', requirement: { ...win }, version: this.w.versions[win.currentVersionId], flags: this.w.flags[win.currentVersionId] ?? [] })
    const q = this.w.questions[c.questionId]
    if (q && q.status !== 'answered') this.closeQuestion(q, `Picked ${win.id}: ${comment}`, as)
  }

  /* ------------------------------ questions ------------------------------ */

  private closeQuestion(q: Question, text: string, as: string, viaHitId?: string) {
    this.commit({ type: 'questionUpserted', question: { ...q, status: 'answered', answer: { byPersonId: as, text, atMs: this.now, viaHitId } } })
    for (const o of Object.values(this.w.outreach)) {
      if (o.questionId !== q.id) continue
      if (o.status === 'queued') this.commit({ type: 'outreachUpserted', outreach: { ...o, status: 'cancelled' } })
      else if (o.status === 'sent') this.commit({ type: 'outreachUpserted', outreach: { ...o, status: 'answered' } })
    }
  }

  answerQuestion(questionId: string, text: string, as: string, viaHitId?: string) {
    const q = this.w.questions[questionId]
    if (!q || q.status === 'answered' || !text.trim()) return
    const asked = new Set([...q.routedTo, ...Object.values(this.w.outreach).filter((o) => o.questionId === q.id).map((o) => o.recipientPersonId)])
    const r = q.requirementId ? this.w.requirements[q.requirementId] : undefined
    if (!asked.has(as) && !(r && approverRows(this.w, as, r).length) && !this.w.approvers.some((a) => a.personId === as && a.scope === q.pocketId)) return

    // a conflict question is answered by picking a side
    if (q.evidence.kind === 'conflict') {
      const i = q.options.indexOf(text)
      const c = this.w.conflicts[q.evidence.conflictId]
      if (c && c.status === 'open' && i >= 0) {
        this.commit({ type: 'conflictUpserted', conflict: { ...c, status: 'resolved', resolution: i === 0 ? 'a' : 'b', resolvedByPersonId: as, comment: `Answered in Slack: ${text}` } })
        const lose = this.w.requirements[this.w.versions[i === 0 ? c.bVersionId : c.aVersionId].requirementId]
        this.commit({ type: 'requirementUpserted', requirement: { ...lose, status: 'superseded' }, version: this.w.versions[lose.currentVersionId], flags: this.w.flags[lose.currentVersionId] ?? [] })
      }
      this.closeQuestion(q, text, as, viaHitId)
      return
    }

    this.closeQuestion(q, text, as, viaHitId)
    if (!r) return
    const hit = viaHitId ? (this.w.hits[q.id] ?? []).find((h) => h.id === viaHitId) : undefined
    const link: RequirementLink = hit
      ? { id: this.id('LK'), requirementId: r.id, kind: 'source', ref: `${hit.source}:${hit.id}`, evidence: hit.quote, origin: hit.source, title: hit.title, url: hit.url }
      : { id: this.id('LK'), requirementId: r.id, kind: 'source', ref: `slack:${q.id}`, evidence: text, origin: 'slack', title: `${personName(this.w, as)}, answer to ${q.id}` }
    const cur = this.w.versions[r.currentVersionId]
    const fill = FILLS[`${q.id}|${text}`]
    if (q.slot || fill) {
      const slots = slotsOf(cur)
      const filled: Slots = fill ? { ...slots, ...fill } : { ...slots, [q.slot as ReqSlot]: text, statement: q.evidence.kind === 'flag' && q.evidence.word ? cur.statement.replace(new RegExp(`\\s*\\b${q.evidence.word}\\b`, 'i'), '') : cur.statement }
      // the requirements worker re-runs the scope: new version, re-linted
      this.newVersion(r, filled, `Answer to ${q.id} from ${personName(this.w, as)}`, 'p-agent', { extraLinks: [link] })
    } else {
      this.commit({ type: 'requirementUpserted', requirement: r, version: cur, flags: this.w.flags[cur.id] ?? [], links: [...(this.w.links[r.id] ?? []), link] })
    }
  }

  reassignQuestion(questionId: string, personIds: string[], as: string) {
    const q = this.w.questions[questionId]
    if (!q || q.status === 'answered' || !personIds.length) return
    const nq = { ...q, routedTo: personIds, routedWhy: `Reassigned by ${personName(this.w, as)}` }
    this.commit({ type: 'questionUpserted', question: nq })
    this.send(nq, 'ask', personIds)
  }

  snoozeQuestion(questionId: string, hours: number, reason: string, as: string) {
    const q = this.w.questions[questionId]
    if (!q || q.status === 'answered' || !reason.trim()) return
    this.commit({ type: 'questionUpserted', question: { ...q, snooze: { untilMs: this.now + hours * HOUR, reason, byPersonId: as } } })
  }

  escalateNow(questionId: string, as: string) {
    const q = this.w.questions[questionId]
    if (!q || q.status === 'answered') return
    void as
    const next = ladder(this.w, q).find((s) => !s.done && s.step !== 'answered' && s.recipients.length)
    if (next) this.send(q, next.step as OutreachStep, next.recipients)
  }

  pauseEscalation(questionId: string, reason: string | null, as: string) {
    const q = this.w.questions[questionId]
    if (!q) return
    this.commit({ type: 'questionUpserted', question: { ...q, escalationPaused: reason ? { reason, byPersonId: as } : undefined } })
  }

  /* ---------------------------- verification ---------------------------- */

  runVerification(verificationId: string) {
    const v = this.w.verifications[verificationId]
    if (!v || v.method === 'attest') return
    const r = this.w.requirements[v.requirementId]
    // a stale check re-runs against the current version
    const target: Verification = { ...v, versionId: r.currentVersionId, status: 'pending' }
    this.commit({ type: 'verificationUpserted', verification: target })
    window.setTimeout(() => {
      const status = RUNS[v.id]?.(this.w) ?? 'passing'
      this.commit({
        type: 'verificationUpserted',
        verification: { ...target, status, lastRunAtMs: this.now, artifactRef: `out/verify/${r.id}/@${this.w.versions[r.currentVersionId].n}/${v.method}.out · sha256 ${(this.seq * 2654435761).toString(16).slice(0, 8)}` },
      })
    }, 1200)
  }

  requestAttestation(verificationId: string, personId: string, as: string) {
    const v = this.w.verifications[verificationId]
    if (!v) return
    void as
    this.commit({ type: 'verificationUpserted', verification: { ...v, requestedFromPersonId: personId } })
  }

  attest(verificationId: string, comment: string, as: string) {
    const v = this.w.verifications[verificationId]
    const r = v && this.w.requirements[v.requirementId]
    if (!v || !r || !comment.trim() || !approverRows(this.w, as, r).length) return
    this.commit({ type: 'verificationUpserted', verification: { ...v, status: 'passing', attestedByPersonId: as, attestComment: comment, lastRunAtMs: this.now } })
  }

  /* -------------------------------- people -------------------------------- */

  private pushPeople() {
    this.commit({ type: 'peopleLoaded', people: Object.values(this.w.people), teams: Object.values(this.w.teams), approvers: this.w.approvers, ownership: this.w.ownership })
  }

  correctOwnership(ownershipId: string, personId: string, reason: string, as: string) {
    const o = this.w.ownership.find((x) => x.id === ownershipId)
    if (!o || !reason.trim() || !this.w.people[personId]) return
    this.w = {
      ...this.w,
      ownership: this.w.ownership.map((x) => (x.id === ownershipId ? { ...x, personId, signal: 'override', weight: 1, source: `Correction by ${personName(this.w, as)}`, override: { reason, byPersonId: as, was: personName(this.w, o.personId) } } : x)),
    }
    this.pushPeople()
  }

  markPersonLeft(personId: string, as: string) {
    const p = this.w.people[personId]
    if (!p || !p.active || (as !== p.managerId && !ADMINS.includes(as))) return
    const successor = p.successorId ?? p.managerId
    this.w = {
      ...this.w,
      people: { ...this.w.people, [personId]: { ...p, active: false, successorId: successor } },
      approvers: this.w.approvers.map((a) => (a.personId === personId ? { ...a, change: 'left' as const, changeDecision: undefined } : a)),
    }
    this.pushPeople()
    for (const q of Object.values(this.w.questions)) {
      if (q.status === 'answered' || !q.routedTo.includes(personId)) continue
      const routed = [...new Set(q.routedTo.map((x) => (x === personId ? successor : x)).filter(Boolean))]
      const nq = { ...q, routedTo: routed, routedWhy: `${p.name} left; rerouted to ${personName(this.w, successor)}` }
      this.commit({ type: 'questionUpserted', question: nq })
      if (successor) this.send(nq, 'ask', [successor])
    }
  }

  decideApproverChange(approverId: string, decision: 'accepted' | 'rejected', as: string) {
    if (!ADMINS.includes(as)) return
    this.w = { ...this.w, approvers: this.w.approvers.map((a) => (a.id === approverId && a.change ? { ...a, changeDecision: decision } : a)) }
    this.pushPeople()
  }

  signOffApprovers(as: string) {
    if (!ADMINS.includes(as)) return
    if (this.w.approvers.some((a) => a.change && !a.changeDecision)) return
    this.commit({ type: 'approverSignOff', byPersonId: as, atMs: this.now })
  }

  startMigration(pocketId: string, as: string) {
    const job = this.w.jobs[pocketId]
    if (!job || !this.w.approvers.some((a) => a.personId === as && a.scope === pocketId && a.change !== 'removed')) return
    if (job.state === 'queued') this.commit({ type: 'jobUpserted', job: { ...job, state: 'capturing' } })
    else if (job.state === 'capturing' && gate(this.w, pocketId).open) this.commit({ type: 'jobUpserted', job: { ...job, state: 'rewriting' } })
  }

  /** The cutover reducer's requirements check (§7.2). */
  cutoverBlocked(pocketId: string) {
    const g = gate(this.w, pocketId)
    return g.stage === 'cutover' && !g.open ? g.summary : ''
  }
}
