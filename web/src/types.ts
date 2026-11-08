/* ------------------------------------------------------------------ *
 * Data contracts — the single source of truth shared with the backend.
 * These extend the agreed JSON shapes; keep them in lockstep with the
 * team so the UI and backend never drift.
 * ------------------------------------------------------------------ */

export type ComponentStatus =
  | 'queued'
  | 'mapping'
  | 'capturing'
  | 'rewriting'
  | 'shadowing'
  | 'ready' // match-rate threshold met, cutover unlocked
  | 'cutover'

export type MismatchCategory = 'formatting' | 'rounding' | 'logic' | 'noise'

/**
 * The core research insight: the legacy system is NOT automatically ground
 * truth. Every mismatch is triaged before anyone is asked.
 *   - defect:          contradicts something already agreed → agent fixes silently
 *   - unmade-decision: no answer exists anywhere → ask a named human on Slack
 *   - noise:           nondeterminism (timestamps, ids) → filtered out of the diff
 * Only `unmade-decision` mismatches ever become Slack cards.
 */
export type MismatchClassification = 'defect' | 'unmade-decision' | 'noise'

export type MismatchStatus = 'open' | 'asked' | 'answered' | 'test_generated'

/**
 * Which output the human picked. Each maps to a different generated artifact:
 *   old         → golden-master test locking old behavior
 *   new         → test for new behavior + logged bug fix in the old system
 *   neither     → test from the free-text spec, flagged for review
 *   doesnt-matter → comparison rule that ignores that field (e.g. timestamp)
 */
export type DecisionAnswer = 'old' | 'new' | 'neither' | 'doesnt-matter'

export type CutoverStage = 0 | 1 | 10 | 100

/** A rewritten legacy component under shadow evaluation. */
export interface Component {
  id: string // e.g. "CBTRN02C"
  name: string // human label e.g. "Transaction Poster"
  isolation: number // 0..1 — how decoupled it is (pick target)
  coverage: number // 0..1 — existing test coverage
  status: ComponentStatus
  matchRate: number // 0..1 — shadow-diff agreement old vs new
  whyPicked: string
  language: string // e.g. "COBOL"
}

/** One recorded disagreement between old and new outputs. */
export interface Mismatch {
  id: string
  componentId: string
  category: MismatchCategory // the output-diff type
  classification: MismatchClassification // defect / unmade-decision / noise
  rootCauseGroup: string // g7 — mismatches that share a cause batch together
  title: string
  input: Record<string, unknown>
  oldOut: Record<string, unknown>
  newOut: Record<string, unknown>
  snippet: { old: string; new: string }
  status: MismatchStatus
  /** set once a decision resolves this mismatch */
  resolvedBy?: string // decision id
  /** Jev-selected evidence widget for the detail view / Slack card */
  evidenceWidget?: EvidenceWidget
  /** Jev confidence in the category label (0..1); low → show "?" */
  categoryConfidence?: number
}

/** A human answer captured from Slack, frozen into a test. */
export interface Decision {
  id: string
  groupId: string // rootCauseGroup it resolves
  componentId: string
  question: string
  answer: DecisionAnswer
  answeredBy: string // "@aayush"
  at: string // ISO timestamp
  testId: string // generated test
  resolvedCount: number // mismatches this one answer closed
}

/** A single reasoning step from the Nemotron agent (NVIDIA prize visibility). */
export interface AgentThought {
  id: string
  at: string
  phase: 'rewrite' | 'shadow' | 'triage' | 'ask' | 'test'
  text: string
  model: string // "Nemotron" — shown in the UI
}

/* --------------------------- Jev decisions ------------------------ *
 * Jev (TypeSafe) DECIDES — typed judgments, no generated text.
 * Nemotron thinks; Jev picks. These drive the agentic/generative UI:
 * which widget to render, whether to ask a human, cutover safety, etc.
 * ------------------------------------------------------------------ */

export type JevQuestionType = 'choice' | 'score' | 'noul'

/** Evidence widget Jev selects for a mismatch detail / Slack card. */
export type EvidenceWidget = 'numberLine' | 'charDiff' | 'branchTrace' | 'tableDiff'

export interface UIDecision {
  id: string
  at: string
  question: string
  type: JevQuestionType
  /** selected option, "yes"/"no", or Score level label */
  choice: string
  /** distribution over options (choice/score) or {yes,no} (noul) */
  probabilities: Record<string, number>
  /** concentration of the distribution — NOT p(correct). absent for noul */
  confidence?: number
  latencyMs: number
  model: 'Jev'
  /** what this decision drives, shown in the Decisions tab */
  drives: string
}

/* ----------------------------- graph ------------------------------ */

export interface GraphNode {
  id: string
  label: string
  isolation: number // drives color
  x: number // precomputed layout — no live force sim on stage
  y: number
  isTarget: boolean // the chosen component
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: 'call' | 'shared-file'
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/* --------------------------- snapshot ----------------------------- */

export interface MatchPoint {
  t: number // sequence index (stable, no wall clock)
  rate: number // 0..1
  label: string // short caption for the event that moved it
}

/** The full dashboard state the UI renders. Source-agnostic. */
export interface Snapshot {
  scenarioId: string
  scenarioName: string
  component: Component
  history: MatchPoint[]
  mismatches: Mismatch[]
  decisions: Decision[]
  agentLog: AgentThought[]
  /** Jev typed decisions driving the agentic UI */
  uiDecisions: UIDecision[]
  cutoverStage: CutoverStage
  graph: GraphData
  /** noise baseline: match rate of old-vs-old (should be ~100%). */
  noiseBaseline: number
  threshold: number // cutover unlock threshold, e.g. 0.99
}

/* ------------------------------------------------------------------ *
 * Requirements layer (docs/REQUIREMENTS_IMPLEMENTATION.md §3, PROPOSED).
 * Field names mirror the SpacetimeDB tables in camelCase. A few fields are
 * UI-only conveniences and are marked so; the backend can derive them.
 * Times are sim-clock milliseconds, never wall-clock.
 * ------------------------------------------------------------------ */

export type ReqStatus = 'draft' | 'needs-info' | 'proposed' | 'approved' | 'rejected' | 'superseded'
export type ReqCategory = 'style' | 'structure' | 'behavior' | 'business-rule' | 'technology' | 'performance' | 'security' | 'data'
export type ReqType = 'functional' | 'quality' | 'constraint'
export type ScopeLevel = 'codebase' | 'pocket' | 'program' | 'function' | 'lines' | 'field'
export type Urgency = 'critical' | 'high' | 'normal' | 'low'
/** The slots of the requirement template (§4.3). */
export type ReqSlot = 'actor' | 'condition' | 'outcome' | 'measure' | 'rationale'

export interface Requirement {
  id: string // REQ-<scope>-<sig hash 10>
  scope: string // pocket id, program id, or 'codebase'
  scopeLevel: ScopeLevel
  /** UI convenience: the pocket the scope sits in ('' for codebase) */
  pocketId: string
  category: ReqCategory
  type: ReqType
  status: ReqStatus
  currentVersionId: string
  ownerPersonId: string
  signature: string
  sensitivity: 'normal' | 'restricted'
  reviewByMs: number
}

export interface RequirementVersion {
  id: string // <reqId>@<n>
  requirementId: string
  n: number
  statement: string
  actor: string
  condition: string
  outcome: string
  measure: string
  rationale: string
  /** person id (the table stores an identity; the UI resolves it to a person) */
  authorPersonId: string
  createdAtMs: number
  /** why this version exists: first draft, an answer, an edit, a restore */
  reason: string
}

export interface RequirementFlag {
  id: string
  versionId: string
  rule: 'ambiguous-word' | 'missing-actor' | 'missing-number' | 'vague-quantifier'
  word: string
  questionId: string
}

export type EvidenceOrigin = 'code' | 'runtime' | 'jira' | 'confluence' | 'notion' | 'slack' | 'shadow'

export interface RequirementLink {
  id: string
  requirementId: string
  kind: 'source' | 'code' | 'verification'
  ref: string // file:line, node id, finding id, contextHit id, verification id
  evidence: string // the quote or code excerpt
  /** UI-only: how to draw the evidence card */
  origin: EvidenceOrigin
  title: string
  url?: string
  /** for code links: the program the lines belong to */
  program?: string
}

export interface Conflict {
  id: string
  aVersionId: string
  bVersionId: string
  questionId: string
  status: 'open' | 'resolved'
  resolvedByPersonId?: string
  resolution: '' | 'a' | 'b' | 'merged' | 'reworded' | 'escalated'
  comment: string
}

export interface Approval {
  id: string
  requirementId: string
  versionId: string
  approverPersonId: string // ctx.sender on the backend, never an argument
  authority: number
  decision: 'approve' | 'reject'
  comment: string
  atMs: number
}

export type VerificationMethod = 'test' | 'shadow' | 'lint' | 'benchmark' | 'attest'
export interface Verification {
  id: string
  requirementId: string
  versionId: string
  method: VerificationMethod
  spec: string
  status: 'pending' | 'passing' | 'failing' | 'stale'
  lastRunAtMs: number
  artifactRef: string
  attestedByPersonId?: string
  attestComment?: string
  /** UI-only: an attestation was requested from this person */
  requestedFromPersonId?: string
}

/** What a change would touch, computed from trace links and the graph (never the LLM). */
export interface Impact {
  lines: { ref: string; program: string; excerpt: string }[]
  programs: string[]
  downstream: { program: string; via: string }[]
  overlapping: string[] // requirement ids
  staleVerifications: string[] // verification ids
  pocketsBack: string[] // pockets that would move back to rewriting
}

export interface ChangeRequest {
  id: string
  requirementId: string
  proposedVersionId: string
  impact: Impact
  status: 'open' | 'approved' | 'rejected'
  byPersonId: string
  atMs: number
}

export type QuestionReason = 'missing-actor' | 'missing-number' | 'ambiguous-word' | 'conflict' | 'unmade-decision' | 'who-asked'
export interface Question {
  id: string
  reason: QuestionReason
  requirementId: string // '' when not tied to one
  slot: ReqSlot | ''
  urgency: Urgency
  scope: string
  pocketId: string // UI convenience
  status: 'open' | 'claimed' | 'answered' | 'blocked'
  claimedBy: string
  /** the same question in two registers (§6.4) */
  text: { business: string; engineer: string }
  /** what triggered it: a lint flag in a statement, a conflict, or a shadow mismatch */
  evidence:
    | { kind: 'flag'; statement: string; word: string }
    | { kind: 'conflict'; conflictId: string }
    | { kind: 'shadow'; detail: string }
    | { kind: 'none' }
  options: string[] // one-click answers
  routedTo: string[] // person ids
  routedWhy: string
  askedAtMs: number
  answer?: { byPersonId: string; text: string; atMs: number; viaHitId?: string }
  snooze?: { untilMs: number; reason: string; byPersonId: string }
  escalationPaused?: { reason: string; byPersonId: string }
}

export interface ContextHit {
  id: string
  questionId: string
  source: 'jira' | 'confluence' | 'notion'
  url: string
  title: string
  quote: string
  score: number
  fetchedAtMs: number
}

export type OutreachStep = 'ask' | 'follow-up' | 'manager' | 'approver' | 'fte'
export interface Outreach {
  id: string
  questionId: string
  recipientPersonId: string
  channel: 'slack-dm' | 'slack-channel'
  rendering: 'business' | 'engineer'
  urgency: Urgency
  step: OutreachStep
  status: 'queued' | 'sent' | 'answered' | 'failed' | 'cancelled'
  sentAtMs: number
}

export interface Person {
  id: string
  name: string
  handle: string // "@priya"
  title: string
  teamId: string
  emails: string[]
  active: boolean
  managerId: string // '' at the top (reportsTo)
  sources: string[] // where we learned about them: workday, git, slack, jira
  kind: 'person' | 'system' // external systems can hold a stake too
  successorId?: string // suggested when they leave
}

export interface Team {
  id: string
  name: string
  parentTeamId: string
  managerId: string
}

export type OwnershipSignal = 'codeowners' | 'git-blame' | 'jira-assignee' | 'confluence-author' | 'org-chart' | 'runbook' | 'override'
export interface Ownership {
  id: string
  personId: string
  target: string // pocket id or program id
  kind: 'owns' | 'contributes' | 'consulted' | 'consumes'
  signal: OwnershipSignal
  weight: number // 0..1 confidence
  source: string // "CODEOWNERS line 14", "git log 2019-2024"
  evidence: string
  observedAtMs: number
  override?: { reason: string; byPersonId: string; was: string }
}

export interface Approver {
  id: string
  personId: string
  scope: string // pocket id or 'codebase'
  category: ReqCategory | '*'
  score: number
  evidence: string[]
  signedOff: boolean
  /** change since the last sign-off (§12.12) */
  change?: 'new' | 'removed' | 'crossed-threshold' | 'left'
  changeDecision?: 'accepted' | 'rejected'
}

export interface AccessGrant {
  personId: string
  scope: string
  sourcePermission: string // "RACF dataset USRSEC", "repo team platform"
}

export type JobState = 'queued' | 'capturing' | 'rewriting' | 'shadowing' | 'canary' | 'done'
export interface MigrationJob {
  pocketId: string
  state: JobState
  trafficShare: number // 0..1 of live traffic
  rank: number // 1 = migrate first
}

export interface HarnessAttempt {
  id: string
  pocketId: string
  attempt: number
  outcome: 'passed' | 'failed'
  failedRequirementId: string
  note: string
  atMs: number
}

/** Everything the requirements screens read. Keyed by id where screens look things up. */
export interface ReqWorld {
  nowMs: number // the sim clock
  requirements: Record<string, Requirement>
  versions: Record<string, RequirementVersion>
  flags: Record<string, RequirementFlag[]> // by version id
  links: Record<string, RequirementLink[]> // by requirement id
  conflicts: Record<string, Conflict>
  approvals: Approval[]
  verifications: Record<string, Verification>
  changeRequests: Record<string, ChangeRequest>
  questions: Record<string, Question>
  hits: Record<string, ContextHit[]> // by question id
  outreach: Record<string, Outreach>
  people: Record<string, Person>
  teams: Record<string, Team>
  ownership: Ownership[]
  approvers: Approver[]
  access: AccessGrant[]
  jobs: Record<string, MigrationJob> // by pocket id
  attempts: HarnessAttempt[]
  approverSignOff: { byPersonId: string; atMs: number } | null
}
