import type {
  Approval,
  Approver,
  ChangeRequest,
  Conflict,
  ContextHit,
  HarnessAttempt,
  MigrationJob,
  Outreach,
  Ownership,
  Person,
  Question,
  ReqWorld,
  Requirement,
  RequirementFlag,
  RequirementLink,
  RequirementVersion,
  Team,
  Verification,
} from '@/types'

/* ------------------------------------------------------------------ *
 * Requirements-layer events (REQUIREMENTS_IMPLEMENTATION.md §9.2) and the
 * one pure reducer that applies them. The store uses it to update the UI;
 * MockSource uses the same function to keep its own copy, the way a
 * SpacetimeDB client cache mirrors the server's tables.
 * ------------------------------------------------------------------ */

export type ReqEvent =
  | { type: 'reqWorld'; world: ReqWorld }
  | { type: 'requirementUpserted'; requirement: Requirement; version: RequirementVersion; flags: RequirementFlag[]; links?: RequirementLink[] }
  | { type: 'versionAdded'; version: RequirementVersion; flags: RequirementFlag[] }
  | { type: 'approvalRecorded'; approval: Approval }
  | { type: 'questionUpserted'; question: Question }
  | { type: 'contextHitsAdded'; questionId: string; hits: ContextHit[] }
  | { type: 'conflictUpserted'; conflict: Conflict }
  | { type: 'verificationUpserted'; verification: Verification }
  | { type: 'changeRequestUpserted'; changeRequest: ChangeRequest }
  | { type: 'outreachUpserted'; outreach: Outreach }
  | { type: 'peopleLoaded'; people: Person[]; teams: Team[]; approvers: Approver[]; ownership: Ownership[] }
  | { type: 'approverSignOff'; byPersonId: string; atMs: number }
  | { type: 'jobUpserted'; job: MigrationJob }
  | { type: 'attemptRecorded'; attempt: HarnessAttempt }
  | { type: 'clockTick'; nowMs: number }

export const REQ_EVENT_TYPES = new Set<string>([
  'reqWorld',
  'requirementUpserted',
  'versionAdded',
  'approvalRecorded',
  'questionUpserted',
  'contextHitsAdded',
  'conflictUpserted',
  'verificationUpserted',
  'changeRequestUpserted',
  'outreachUpserted',
  'peopleLoaded',
  'approverSignOff',
  'jobUpserted',
  'attemptRecorded',
  'clockTick',
])

export function reduceReq(w: ReqWorld, e: ReqEvent): ReqWorld {
  switch (e.type) {
    case 'reqWorld':
      return e.world
    case 'requirementUpserted':
      return {
        ...w,
        requirements: { ...w.requirements, [e.requirement.id]: e.requirement },
        versions: { ...w.versions, [e.version.id]: e.version },
        flags: { ...w.flags, [e.version.id]: e.flags },
        links: e.links ? { ...w.links, [e.requirement.id]: e.links } : w.links,
      }
    case 'versionAdded':
      return { ...w, versions: { ...w.versions, [e.version.id]: e.version }, flags: { ...w.flags, [e.version.id]: e.flags } }
    case 'approvalRecorded':
      return { ...w, approvals: [...w.approvals.filter((a) => a.id !== e.approval.id), e.approval] }
    case 'questionUpserted':
      return { ...w, questions: { ...w.questions, [e.question.id]: e.question } }
    case 'contextHitsAdded':
      return { ...w, hits: { ...w.hits, [e.questionId]: [...(w.hits[e.questionId] ?? []).filter((h) => !e.hits.some((x) => x.id === h.id)), ...e.hits] } }
    case 'conflictUpserted':
      return { ...w, conflicts: { ...w.conflicts, [e.conflict.id]: e.conflict } }
    case 'verificationUpserted':
      return { ...w, verifications: { ...w.verifications, [e.verification.id]: e.verification } }
    case 'changeRequestUpserted':
      return { ...w, changeRequests: { ...w.changeRequests, [e.changeRequest.id]: e.changeRequest } }
    case 'outreachUpserted':
      return { ...w, outreach: { ...w.outreach, [e.outreach.id]: e.outreach } }
    case 'peopleLoaded':
      return {
        ...w,
        people: Object.fromEntries(e.people.map((p) => [p.id, p])),
        teams: Object.fromEntries(e.teams.map((t) => [t.id, t])),
        approvers: e.approvers,
        ownership: e.ownership,
      }
    case 'approverSignOff':
      return {
        ...w,
        approverSignOff: { byPersonId: e.byPersonId, atMs: e.atMs },
        // accepted changes become the new baseline; rejected ones drop out
        approvers: w.approvers
          .filter((a) => !(a.change && a.changeDecision === 'rejected') && a.change !== 'removed' && a.change !== 'left')
          .map((a) => ({ ...a, signedOff: true, change: undefined, changeDecision: undefined })),
      }
    case 'jobUpserted':
      return { ...w, jobs: { ...w.jobs, [e.job.pocketId]: e.job } }
    case 'attemptRecorded':
      return { ...w, attempts: [...w.attempts, e.attempt] }
    case 'clockTick':
      return { ...w, nowMs: e.nowMs }
    default:
      return w
  }
}
