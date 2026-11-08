import type {
  AgentThought,
  ComponentStatus,
  CutoverStage,
  Decision,
  DecisionAnswer,
  Mismatch,
  Snapshot,
  UIDecision,
} from '@/types'

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

export interface RealtimeSource extends SourceControls {
  /** Current full state — read once on mount. */
  getSnapshot(): Snapshot
  /** Subscribe to the live event stream. Returns an unsubscribe fn. */
  subscribe(listener: SourceListener): () => void
  /** List available scenario presets. */
  scenarios(): { id: string; name: string }[]
  /** Questions still waiting on a human (remaining decision script). */
  pendingQuestions(): PendingQuestion[]
}
