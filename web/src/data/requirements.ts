import type {
  Approver,
  OutreachStep,
  Question,
  ReqCategory,
  ReqStatus,
  ReqWorld,
  Requirement,
  RequirementFlag,
  RequirementVersion,
  Urgency,
  Impact,
} from '@/types'
import { POCKET, PROGRAM, blastRadius } from './carddemo'

/* ------------------------------------------------------------------ *
 * Requirements layer: pure rules, no I/O. The mock source and every
 * screen use these, so the UI shows exactly what the reducers enforce.
 * Values marked (config) mirror theseus.config.json placeholders from
 * docs/REQUIREMENTS_IMPLEMENTATION.md §10; the backend owns the real ones.
 * ------------------------------------------------------------------ */

export const HOUR = 3_600_000
export const MINUTE = 60_000
/** Sim-clock start of the demo: Monday 9 Nov 2026, 09:00. */
export const T0 = Date.UTC(2026, 10, 9, 9, 0)

/** humanLoop.escalation.byUrgency (config): hours after the first ask. */
export const ESCALATION: Record<Urgency, { step: OutreachStep; afterH: number }[]> = {
  critical: [
    { step: 'follow-up', afterH: 6.5 },
    { step: 'manager', afterH: 12 },
    { step: 'approver', afterH: 18 },
    { step: 'fte', afterH: 24 },
  ],
  high: [
    { step: 'follow-up', afterH: 12 },
    { step: 'manager', afterH: 24 },
    { step: 'approver', afterH: 36 },
    { step: 'fte', afterH: 48 },
  ],
  normal: [
    { step: 'follow-up', afterH: 24 },
    { step: 'manager', afterH: 48 },
    { step: 'approver', afterH: 72 },
    { step: 'fte', afterH: 96 },
  ],
  low: [
    { step: 'follow-up', afterH: 48 },
    { step: 'manager', afterH: 96 },
  ],
}
/** ranking.minIsolation and the traffic share that counts as "hot" (config). */
export const MIN_ISOLATION = 0.3
export const HOT_TRAFFIC = 0.15
/** Categories that gate a rewrite (§9.2). */
export const GATING: ReqCategory[] = ['behavior', 'business-rule', 'data']
/** Approvals needed: business rules and security need two people (config). */
export const quorumFor = (r: Requirement) => (r.category === 'business-rule' || r.category === 'security' ? 2 : 1)

export const SLOTS = ['actor', 'condition', 'outcome', 'measure', 'rationale'] as const

/* ------------------------------ labels ------------------------------ */

export const STATUS_LABEL: Record<ReqStatus, string> = {
  draft: 'Draft',
  'needs-info': 'Needs info',
  proposed: 'Proposed',
  approved: 'Approved',
  rejected: 'Rejected',
  superseded: 'Superseded',
}
export const CATEGORY_LABEL: Record<ReqCategory, string> = {
  style: 'Style',
  structure: 'Structure',
  behavior: 'Behavior',
  'business-rule': 'Business rule',
  technology: 'Technology',
  performance: 'Performance',
  security: 'Security',
  data: 'Data',
}
export const REASON_LABEL: Record<Question['reason'], string> = {
  'missing-actor': 'Missing actor',
  'missing-number': 'Missing number',
  'ambiguous-word': 'Ambiguous word',
  conflict: 'Conflict',
  'unmade-decision': 'Unmade decision',
  'who-asked': 'Who asked',
}
export const STEP_LABEL: Record<OutreachStep, string> = {
  ask: 'Asked',
  'follow-up': 'Follow-up',
  manager: 'Manager',
  approver: 'Next approver',
  fte: 'Our engineer',
}
export const FLAG_HELP: Record<RequirementFlag['rule'], string> = {
  'ambiguous-word': 'Ambiguous word: two readers could build two different things',
  'vague-quantifier': 'Vague amount: needs a number someone can test',
  'missing-actor': 'Missing actor: say who or what does this',
  'missing-number': 'Missing number: a quality needs a measurable target',
}

/* ------------------------------- lint ------------------------------- */

const AMBIGUOUS = ['normally', 'usually', 'typically', 'generally', 'often', 'sometimes', 'as needed', 'appropriate', 'appropriately', 'reasonable', 'etc']
const VAGUE = ['quickly', 'fast', 'soon', 'timely', 'several', 'many', 'few']

const hasWord = (text: string, w: string) => new RegExp(`\\b${w.replace(/ /g, '\\s+')}\\b`, 'i').test(text)

/** Deterministic lint (§4.4). Returns the problems, the caller turns them into flags + questions. */
export function lint(v: Pick<RequirementVersion, 'statement' | 'actor' | 'measure'>, type: Requirement['type']): { rule: RequirementFlag['rule']; word: string }[] {
  const out: { rule: RequirementFlag['rule']; word: string }[] = []
  for (const w of AMBIGUOUS) if (hasWord(v.statement, w)) out.push({ rule: 'ambiguous-word', word: w })
  for (const w of VAGUE) if (hasWord(v.statement, w)) out.push({ rule: 'vague-quantifier', word: w })
  if (!v.actor.trim()) out.push({ rule: 'missing-actor', word: '' })
  if (type === 'quality' && !/\d/.test(v.measure)) out.push({ rule: 'missing-number', word: '' })
  return out
}

/** Split a statement so flagged words can be highlighted inline. */
export function segments(text: string, words: string[]): { text: string; flag: boolean }[] {
  const ws = words.filter(Boolean)
  if (!ws.length) return [{ text, flag: false }]
  const re = new RegExp(`\\b(${ws.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b`, 'gi')
  const out: { text: string; flag: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), flag: false })
    out.push({ text: m[0], flag: true })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), flag: false })
  return out
}

/* ---------------------------- access ---------------------------- */

/** A scope is access-controlled once any grant names it (grants mirror the source system). */
export const isRestrictedScope = (w: ReqWorld, scope: string) => w.access.some((g) => g.scope === scope)
export const canSeeScope = (w: ReqWorld, personId: string, scope: string) =>
  !isRestrictedScope(w, scope) || w.access.some((g) => g.scope === scope && g.personId === personId)
export const canSeeReq = (w: ReqWorld, personId: string, r: Requirement) => r.sensitivity !== 'restricted' || canSeeScope(w, personId, r.pocketId || r.scope)
export const canSeeQuestion = (w: ReqWorld, personId: string, q: Question) => canSeeScope(w, personId, q.pocketId)

export const scopeName = (scope: string) => (scope === 'codebase' ? 'Whole codebase' : (POCKET[scope]?.title ?? PROGRAM[scope]?.title ?? scope))
export const personName = (w: ReqWorld, id: string) => w.people[id]?.name ?? id
export const ownerOfScope = (w: ReqWorld, scope: string) => {
  const own = w.ownership.filter((o) => o.target === scope && o.kind === 'owns' && w.people[o.personId]?.active).sort((a, b) => b.weight - a.weight)[0]
  return own ? w.people[own.personId] : undefined
}

/* --------------------------- approval --------------------------- */

export function approverRows(w: ReqWorld, personId: string, r: Requirement): Approver[] {
  const p = w.people[personId]
  if (!p?.active || !canSeeReq(w, personId, r)) return []
  return w.approvers.filter(
    (a) =>
      a.personId === personId &&
      a.change !== 'removed' &&
      !(a.change && a.changeDecision === 'rejected') &&
      (a.scope === r.pocketId || a.scope === r.scope || (a.scope === 'codebase' && r.scope === 'codebase')) &&
      (a.category === '*' || a.category === r.category),
  )
}
export const authority = (w: ReqWorld, personId: string, r: Requirement) => Math.max(0, ...approverRows(w, personId, r).map((a) => a.score))
export const approvalsOn = (w: ReqWorld, versionId: string) => w.approvals.filter((a) => a.versionId === versionId && a.decision === 'approve')
export const flagsOf = (w: ReqWorld, r: Requirement) => w.flags[r.currentVersionId] ?? []
export const openConflictOf = (w: ReqWorld, r: Requirement) =>
  Object.values(w.conflicts).find((c) => c.status === 'open' && [c.aVersionId, c.bVersionId].some((v) => w.versions[v]?.requirementId === r.id))

/** Can this person approve this requirement right now? Always says why not. */
export function canApprove(w: ReqWorld, personId: string, reqId: string): { ok: boolean; why: string } {
  const r = w.requirements[reqId]
  if (!r) return { ok: false, why: 'Not found' }
  if (!canSeeReq(w, personId, r)) return { ok: false, why: 'Restricted' }
  if (r.status !== 'proposed') return { ok: false, why: `Only proposed requirements can be approved; this one is ${STATUS_LABEL[r.status].toLowerCase()}` }
  const f = flagsOf(w, r).length
  if (f) return { ok: false, why: `${f} open flag${f > 1 ? 's' : ''} must be answered first` }
  if (openConflictOf(w, r)) return { ok: false, why: 'In an open conflict; resolve it first' }
  if (!approverRows(w, personId, r).length) return { ok: false, why: `${personName(w, personId)} is not an approved person for ${scopeName(r.pocketId || r.scope)} · ${CATEGORY_LABEL[r.category]}` }
  if (approvalsOn(w, r.currentVersionId).some((a) => a.approverPersonId === personId)) return { ok: false, why: 'You already approved this version' }
  return { ok: true, why: '' }
}

/** Clean = could be approved by someone: proposed, no flags, no open conflict. */
export const isClean = (w: ReqWorld, r: Requirement) => r.status === 'proposed' && !flagsOf(w, r).length && !openConflictOf(w, r)

/* ------------------------------ gate ------------------------------ */

export interface Blocker {
  kind: 'requirement' | 'question' | 'verification' | 'conflict'
  id: string
  text: string
}
export interface Gate {
  stage: 'rewrite' | 'cutover' | 'done'
  open: boolean
  blockers: Blocker[]
  summary: string
}

/** A short quote of a requirement for one-line lists (ids are long). */
export function snippet(w: ReqWorld, reqId: string, n = 44) {
  const s = w.versions[w.requirements[reqId]?.currentVersionId]?.statement ?? reqId
  return `“${s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s.replace(/\.$/, '')}”`
}

const live = (r: Requirement) => r.status !== 'rejected' && r.status !== 'superseded'

/** The requirements gate for a pocket (§9.2): rewriting needs the behavior,
 * business-rule and data requirements approved; cutover also needs every
 * verification in scope passing. Every blocker names its cause. */
export function gate(w: ReqWorld, pocketId: string): Gate {
  const job = w.jobs[pocketId]
  const state = job?.state ?? 'queued'
  if (state === 'done') return { stage: 'done', open: true, blockers: [], summary: 'Migrated' }
  const stage: Gate['stage'] = state === 'queued' || state === 'capturing' ? 'rewrite' : 'cutover'
  const reqs = Object.values(w.requirements).filter((r) => r.pocketId === pocketId && live(r))
  const blockers: Blocker[] = []
  for (const r of reqs.filter((x) => GATING.includes(x.category) && x.status !== 'approved')) {
    const c = openConflictOf(w, r)
    const q = Object.values(w.questions).find((x) => x.requirementId === r.id && x.status !== 'answered')
    const what = snippet(w, r.id)
    if (c) {
      if (!blockers.some((b) => b.id === c.id)) blockers.push({ kind: 'conflict', id: c.id, text: 'Two requirements disagree' })
    } else if (q) blockers.push({ kind: 'question', id: q.id, text: `${what} waits on an answer` })
    else blockers.push({ kind: 'requirement', id: r.id, text: `${what} is ${STATUS_LABEL[r.status].toLowerCase()} (${approvalsOn(w, r.currentVersionId).length} of ${quorumFor(r)} approvals)` })
  }
  if (stage === 'cutover') {
    for (const v of Object.values(w.verifications)) {
      const r = w.requirements[v.requirementId]
      if (!r || r.pocketId !== pocketId || !live(r) || v.status === 'passing') continue
      blockers.push({ kind: 'verification', id: v.id, text: `${snippet(w, r.id)}: ${v.method} check is ${v.status}` })
    }
  }
  const nReq = blockers.filter((b) => b.kind !== 'verification').length
  const nVer = blockers.length - nReq
  const what = stage === 'rewrite' ? 'Rewrite' : 'Cutover'
  const parts = [nReq && `${nReq} requirement${nReq > 1 ? 's' : ''} not approved`, nVer && `${nVer} verification${nVer > 1 ? 's' : ''} not passing`].filter(Boolean)
  return { stage, open: !blockers.length, blockers, summary: blockers.length ? `${what} blocked: ${parts.join(', ')}` : `${what} gate open` }
}

/** One word per pocket for the map lens. */
export function gateState(w: ReqWorld, pocketId: string): 'open' | 'blocked' | 'none' | 'done' {
  if (w.jobs[pocketId]?.state === 'done') return 'done'
  if (!Object.values(w.requirements).some((r) => r.pocketId === pocketId && live(r))) return 'none'
  return gate(w, pocketId).open ? 'open' : 'blocked'
}

export function reqCounts(w: ReqWorld, pocketId?: string) {
  const rs = Object.values(w.requirements).filter((r) => !pocketId || r.pocketId === pocketId)
  const by = (s: ReqStatus) => rs.filter((r) => r.status === s).length
  const conflicts = Object.values(w.conflicts).filter((c) => c.status === 'open' && (!pocketId || w.requirements[w.versions[c.aVersionId]?.requirementId]?.pocketId === pocketId)).length
  const flagged = rs.filter((r) => live(r) && flagsOf(w, r).length).length
  return { total: rs.length, approved: by('approved'), proposed: by('proposed'), needsInfo: by('needs-info'), rejected: by('rejected'), superseded: by('superseded'), conflicts, flagged }
}

/* ----------------------------- impact ----------------------------- */

/** What changing this requirement would touch (§7.3), from trace links and the graph only. */
export function impactOf(w: ReqWorld, reqId: string): Impact {
  const links = w.links[reqId] ?? []
  const code = links.filter((l) => l.kind === 'code' && l.program)
  const programs = [...new Set(code.map((l) => l.program!))]
  const downstream: Impact['downstream'] = []
  for (const p of programs) {
    for (const h of blastRadius(p).hits) {
      if (programs.includes(h.program) || downstream.some((d) => d.program === h.program)) continue
      const via = h.via.map((v) => v.store ?? (v.caller ? `calls ${p}` : '')).filter(Boolean)
      downstream.push({ program: h.program, via: [...new Set(via)].join(', ') })
    }
  }
  const overlapping = Object.values(w.requirements)
    .filter((r) => r.id !== reqId && live(r) && (w.links[r.id] ?? []).some((l) => l.kind === 'code' && l.program && programs.includes(l.program)))
    .map((r) => r.id)
  const staleVerifications = Object.values(w.verifications).filter((v) => v.requirementId === reqId && v.status !== 'stale').map((v) => v.id)
  const pocketsBack = [...new Set(programs.map((p) => PROGRAM[p]?.pocket).filter((pk): pk is string => !!pk && ['shadowing', 'canary', 'done'].includes(w.jobs[pk]?.state ?? '')))]
  return { lines: code.map((l) => ({ ref: l.ref, program: l.program!, excerpt: l.evidence })), programs, downstream, overlapping, staleVerifications, pocketsBack }
}

/* ------------------------------ diff ------------------------------ */

/** Word-level diff (LCS over words and spaces). */
export function wordDiff(a: string, b: string): { op: 'same' | 'add' | 'del'; text: string }[] {
  // words only: matching the spaces between them interleaves deletions and additions
  const A = a.split(/\s+/).filter(Boolean)
  const B = b.split(/\s+/).filter(Boolean)
  const n = A.length
  const m = B.length
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: { op: 'same' | 'add' | 'del'; text: string }[] = []
  const push = (op: 'same' | 'add' | 'del', text: string) => {
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += ' ' + text
    else {
      if (last) last.text += ' '
      out.push({ op, text })
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push('same', A[i])
      i++
      j++
    } else if (L[i + 1][j] >= L[i][j + 1]) push('del', A[i++])
    else push('add', B[j++])
  }
  while (i < n) push('del', A[i++])
  while (j < m) push('add', B[j++])
  return out
}

/* --------------------------- escalation --------------------------- */

export function recipientsFor(w: ReqWorld, q: Question, step: OutreachStep): string[] {
  if (step === 'ask' || step === 'follow-up') return q.routedTo
  if (step === 'manager') return [...new Set(q.routedTo.map((id) => w.people[id]?.managerId).filter((m): m is string => !!m && !!w.people[m]?.active))]
  if (step === 'approver') {
    const asked = new Set(Object.values(w.outreach).filter((o) => o.questionId === q.id).map((o) => o.recipientPersonId))
    const best = w.approvers
      .filter((a) => a.scope === q.pocketId && !asked.has(a.personId) && w.people[a.personId]?.active && a.change !== 'removed')
      .sort((a, b) => b.score - a.score)[0]
    return best ? [best.personId] : []
  }
  return Object.values(w.people).filter((p) => p.teamId === 't-modern' && p.active && p.kind === 'person').map((p) => p.id)
}

export interface LadderStep {
  key: string
  step: OutreachStep | 'answered'
  atMs: number
  done: boolean
  recipients: string[]
}

/** The question's escalation ladder: what happened, then what will happen and when. */
export function ladder(w: ReqWorld, q: Question): LadderStep[] {
  const sent = Object.values(w.outreach).filter((o) => o.questionId === q.id && o.status !== 'cancelled' && o.status !== 'queued')
  const out: LadderStep[] = []
  const order: OutreachStep[] = ['ask', 'follow-up', 'manager', 'approver', 'fte']
  for (const s of order) {
    const rows = sent.filter((o) => o.step === s)
    if (rows.length) out.push({ key: s, step: s, atMs: Math.min(...rows.map((r) => r.sentAtMs)), done: true, recipients: [...new Set(rows.map((r) => r.recipientPersonId))] })
  }
  if (q.answer) {
    out.push({ key: 'answered', step: 'answered', atMs: q.answer.atMs, done: true, recipients: [q.answer.byPersonId] })
    return out
  }
  for (const e of ESCALATION[q.urgency]) {
    if (out.some((s) => s.step === e.step)) continue
    out.push({ key: e.step, step: e.step, atMs: q.askedAtMs + e.afterH * HOUR, done: false, recipients: recipientsFor(w, q, e.step) })
  }
  return out
}

/** Steps whose time has come (the scheduled escalationTick reducer). */
export function dueSteps(w: ReqWorld, q: Question): LadderStep[] {
  if (q.status === 'answered' || q.escalationPaused) return []
  if (q.snooze && q.snooze.untilMs > w.nowMs) return []
  return ladder(w, q).filter((s) => !s.done && s.step !== 'answered' && s.atMs <= w.nowMs && s.recipients.length)
}
export const nextStep = (w: ReqWorld, q: Question) => ladder(w, q).find((s) => !s.done)

/* ------------------------------ inbox ------------------------------ */

export interface InboxGroup {
  pocketId: string
  items: { kind: 'requirement' | 'change' | 'conflict'; id: string; reqId: string }[]
  summary: { found: number; complete: number; needInfo: number; conflicts: number }
  unblocks: number
}

/** The approver's queue, grouped by scope and ranked by what it unblocks (§12.9). */
export function inbox(w: ReqWorld, personId: string): InboxGroup[] {
  const groups = new Map<string, InboxGroup>()
  const group = (pocketId: string) => {
    let g = groups.get(pocketId)
    if (!g) {
      const rs = Object.values(w.requirements).filter((r) => r.pocketId === pocketId && live(r))
      g = {
        pocketId,
        items: [],
        summary: {
          found: rs.length,
          complete: rs.filter((r) => r.status === 'approved' || isClean(w, r)).length,
          needInfo: rs.filter((r) => r.status === 'needs-info' || flagsOf(w, r).length).length,
          conflicts: reqCounts(w, pocketId).conflicts,
        },
        unblocks: pocketId ? gate(w, pocketId).blockers.length : 0,
      }
      groups.set(pocketId, g)
    }
    return g
  }
  for (const r of Object.values(w.requirements)) {
    if (r.status !== 'proposed' || !approverRows(w, personId, r).length) continue
    if (approvalsOn(w, r.currentVersionId).some((a) => a.approverPersonId === personId)) continue
    group(r.pocketId).items.push({ kind: 'requirement', id: r.id, reqId: r.id })
  }
  for (const c of Object.values(w.changeRequests)) {
    const r = w.requirements[c.requirementId]
    if (c.status !== 'open' || !r || c.byPersonId === personId || !approverRows(w, personId, r).length) continue
    group(r.pocketId).items.push({ kind: 'change', id: c.id, reqId: r.id })
  }
  for (const c of Object.values(w.conflicts)) {
    if (c.status !== 'open') continue
    const a = w.requirements[w.versions[c.aVersionId]?.requirementId]
    const b = w.requirements[w.versions[c.bVersionId]?.requirementId]
    if (!a || !b || !approverRows(w, personId, a).length || !approverRows(w, personId, b).length) continue
    group(a.pocketId).items.push({ kind: 'conflict', id: c.id, reqId: a.id })
  }
  return [...groups.values()].filter((g) => g.items.length).sort((a, b) => b.unblocks - a.unblocks || b.items.length - a.items.length)
}

/* ------------------------------ time ------------------------------ */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n).padStart(2, '0')
/** "Mon 09:00" on the sim clock. */
export function fmtWhen(ms: number) {
  const d = new Date(ms)
  return `${DAYS[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
export function fmtSpan(ms: number) {
  const m = Math.round(Math.abs(ms) / MINUTE)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  return `${Math.round(h / 24)}d`
}
/** "in 5h 10m" or "2h ago", relative to the sim clock. */
export const fmtRel = (ms: number, now: number) => (ms >= now ? `in ${fmtSpan(ms - now)}` : `${fmtSpan(now - ms)} ago`)

/* ---------------------------- small helpers ---------------------------- */

export const isApproverFor = (w: ReqWorld, personId: string, pocketId: string) =>
  !!w.people[personId]?.active && w.approvers.some((a) => a.personId === personId && a.scope === pocketId && a.change !== 'removed')

/** Routed recipients, anyone it escalated to, and approved people for the scope may answer. */
export function canAnswer(w: ReqWorld, personId: string, q: Question): { ok: boolean; why: string } {
  if (q.status === 'answered') return { ok: false, why: 'Already answered' }
  if (!canSeeQuestion(w, personId, q)) return { ok: false, why: 'Restricted' }
  const asked = q.routedTo.includes(personId) || Object.values(w.outreach).some((o) => o.questionId === q.id && o.recipientPersonId === personId)
  if (asked || isApproverFor(w, personId, q.pocketId)) return { ok: true, why: '' }
  return { ok: false, why: `Only the people it went to, or approved people for ${scopeName(q.pocketId)}, can answer` }
}

/** Customer admin and our engineer sign off the approver list (§12.12). */
export const ADMINS = ['p-elena', 'p-alex']

export const verifsOf = (w: ReqWorld, reqId: string) => Object.values(w.verifications).filter((v) => v.requirementId === reqId)
const VERIF_RANK = { failing: 0, stale: 1, pending: 2, passing: 3 } as const
/** The most worrying status among the checks on the current version. */
export function verifSummary(w: ReqWorld, r: Requirement): 'failing' | 'stale' | 'pending' | 'passing' | '' {
  const vs = verifsOf(w, r.id).filter((v) => v.versionId === r.currentVersionId)
  if (!vs.length) return ''
  return vs.map((v) => v.status).sort((a, b) => VERIF_RANK[a] - VERIF_RANK[b])[0]
}

/** Share of live requirements in a pocket that trace to code and have a passing check. */
export function traceCoverage(w: ReqWorld, pocketId: string) {
  const rs = Object.values(w.requirements).filter((r) => r.pocketId === pocketId && r.status !== 'rejected' && r.status !== 'superseded')
  if (!rs.length) return { covered: 0, total: 0 }
  const covered = rs.filter((r) => (w.links[r.id] ?? []).some((l) => l.kind === 'code') && verifSummary(w, r) === 'passing').length
  return { covered, total: rs.length }
}

/** Where a requirement applies, in the reader's register. */
export function scopeLabel(r: Requirement, mode: 'business' | 'engineer') {
  if (r.scope === 'codebase') return 'Whole codebase'
  const pk = POCKET[r.pocketId]
  if (mode === 'engineer') return r.scopeLevel === 'pocket' ? (pk?.short ?? r.scope) : `${r.scope} · ${pk?.short ?? ''}`
  return pk?.title ?? r.scope
}
