import type {
  AgentThought,
  ComponentStatus,
  CutoverStage,
  Decision,
  DecisionAnswer,
  Mismatch,
  Snapshot,
  UIDecision,
  ReqSlot,
  ReqWorld,
  RequirementVersion,
} from '@/types'
import type { ReqEvent } from '@/data/reqEvents'

/* ------------------------------------------------------------------ *
 * The realtime seam.
 *
 * The UI NEVER talks to a backend directly. It reads the Zustand store,
 * which is fed by whatever RealtimeSource `createSource()` returns.
 *
 *   today:  MockSource      (scripted, fully offline — demo-safe)
 *   later:  SpacetimeSource / WebSocketSource (same interface)
 *
 * Swapping backends is a ONE-LINE change in `createSource()`. No UI
 * component changes, because none of them import a source directly.
 * ------------------------------------------------------------------ */

/** Events a source emits. The store applies them to produce new snapshots. */
export type SourceEvent =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'matchTick'; rate: number; label: string }
  | { type: 'mismatchAdded'; mismatch: Mismatch }
  | {
      type: 'decisionMade'
      decision: Decision
      resolvedIds: string[]
      newRate: number
    }
  | { type: 'agentThought'; thought: AgentThought }
  | { type: 'uiDecision'; decision: UIDecision }
  | { type: 'statusChange'; status: ComponentStatus }
  | { type: 'cutover'; stage: CutoverStage }
  | ReqEvent

export type SourceListener = (event: SourceEvent) => void

/** A question still waiting on a human — surfaced to Slack / Jira / GitHub mocks. */
export interface PendingQuestion {
  groupId: string
  question: string
  owner: string // "@priya"
  team: string // "Finance"
  routedBy: string // "git blame" | "CODEOWNERS"
  cases: number
  confidence: number
  category: string
  input: string
  old: string
  new: string
  snippetOld: string
  snippetNew: string
  testId: string
  /** true for the next question in line (the interactive one) */
  active: boolean
}

/** Demo affordances. On a real backend these become no-ops or real calls. */
export interface SourceControls {
  /** Start / resume the scripted timeline. */
  play(): void
  pause(): void
  /** Jump back to the beginning of the current scenario. */
  reset(): void
  /** Load a different scenario preset (e.g. interest calc vs fee posting). */
  loadScenario(id: string): void
  /** The hero demo moment: a Slack answer lands and the number jumps. */
  simulateSlackAnswer(answer?: DecisionAnswer): void
  /** Request a cutover stage change (allowed only past threshold). */
  setCutover(stage: CutoverStage): void
  /** Is the timeline currently playing? */
  isPlaying(): boolean
  /** Recorded-replay: auto-fire Slack answers hands-free (demo safety net). */
  setAutoReplay(on: boolean): void
  isAutoReplay(): boolean
}

/** The editable slots of a requirement version. */
export type VersionSlots = Pick<RequirementVersion, 'statement' | 'actor' | 'condition' | 'outcome' | 'measure' | 'rationale'>

/**
 * Requirements-layer actions, one per reducer (REQUIREMENTS_IMPLEMENTATION.md §3.5).
 * `as` is the person acting. The mock has no sign-in, so the UI passes the
 * "Viewing as" person; SpacetimeSource ignores it because the reducers use
 * ctx.sender. Every action is allowed or refused by the same rules the screens
 * show (src/data/requirements.ts).
 */
export interface ReqActions {
  world(): ReqWorld
  approveRequirement(reqId: string, versionId: string, comment: string, as: string): void
  rejectRequirement(reqId: string, versionId: string, comment: string, as: string): void
  editRequirement(reqId: string, slots: VersionSlots, reason: string, as: string): void
  restoreVersion(reqId: string, versionId: string, as: string): void
  markNeedsInfo(reqId: string, slot: ReqSlot, as: string): void
  requestRequirementChange(reqId: string, slots: VersionSlots, reason: string, as: string): string
  decideChangeRequest(changeId: string, decision: 'approve' | 'reject', comment: string, as: string): void
  resolveConflict(conflictId: string, pick: 'a' | 'b' | 'escalate', comment: string, as: string): void
  answerQuestion(questionId: string, text: string, as: string, viaHitId?: string): void
  reassignQuestion(questionId: string, personIds: string[], as: string): void
  snoozeQuestion(questionId: string, hours: number, reason: string, as: string): void
  escalateNow(questionId: string, as: string): void
  pauseEscalation(questionId: string, reason: string | null, as: string): void
  runVerification(verificationId: string): void
  requestAttestation(verificationId: string, personId: string, as: string): void
  attest(verificationId: string, comment: string, as: string): void
  correctOwnership(ownershipId: string, personId: string, reason: string, as: string): void
  markPersonLeft(personId: string, as: string): void
  decideApproverChange(approverId: string, decision: 'accepted' | 'rejected', as: string): void
  signOffApprovers(as: string): void
  startMigration(pocketId: string, as: string): void
  /** demo only: move the sim clock forward (the traffic service owns it for real) */
  advanceClock(ms: number): void
}

export interface RealtimeSource extends SourceControls {
  /** requirements layer: questions, requirements, approvals, people */
  req: ReqActions
  /** Current full state — read once on mount. */
  getSnapshot(): Snapshot
  /** Subscribe to the live event stream. Returns an unsubscribe fn. */
  subscribe(listener: SourceListener): () => void
  /** List available scenario presets. */
  scenarios(): { id: string; name: string }[]
  /** Questions still waiting on a human (remaining decision script). */
  pendingQuestions(): PendingQuestion[]
}
