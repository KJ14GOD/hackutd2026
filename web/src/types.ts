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
