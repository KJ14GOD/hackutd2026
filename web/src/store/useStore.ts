import { create } from 'zustand'
import type { Snapshot } from '@/types'
import type { RealtimeSource, SourceEvent } from '@/data/source'
import { createSource } from '@/data/factory'

/* ------------------------------------------------------------------ *
 * The single source of truth the UI reads.
 *
 * A RealtimeSource (mock today, real backend later) pushes SourceEvents;
 * `apply()` reduces them into new snapshot state. Components subscribe to
 * narrow slices via selectors, so a match-rate tick re-renders only the
 * number — not the page.
 *
 * Components NEVER import a source. They read selectors and call
 * `useStore(s => s.controls).simulateSlackAnswer()` etc.
 * ------------------------------------------------------------------ */

const MAX_LOG = 60

const source = createSource()

export interface StoreState extends Snapshot {
  controls: RealtimeSource
  /** last event tag — lets components flash/animate on specific changes */
  lastEvent: SourceEvent['type'] | null
  apply: (event: SourceEvent) => void
}

function reduce(state: StoreState, e: SourceEvent): Partial<StoreState> {
  switch (e.type) {
    case 'snapshot':
      return { ...e.snapshot, lastEvent: 'snapshot' }

    case 'matchTick':
      return {
        component: { ...state.component, matchRate: e.rate },
        history: [...state.history, { t: state.history.length, rate: e.rate, label: e.label }],
        lastEvent: 'matchTick',
      }

    case 'mismatchAdded':
      return { mismatches: [e.mismatch, ...state.mismatches], lastEvent: 'mismatchAdded' }

    case 'decisionMade': {
      const resolved = new Set(e.resolvedIds)
      return {
        component: { ...state.component, matchRate: e.newRate },
        history: [
          ...state.history,
          { t: state.history.length, rate: e.newRate, label: `${e.decision.answeredBy} → ${e.decision.groupId}` },
        ],
        mismatches: state.mismatches.map((m) =>
          resolved.has(m.id)
            ? { ...m, status: 'test_generated' as const, resolvedBy: e.decision.id }
            : m,
        ),
        decisions: [e.decision, ...state.decisions],
        lastEvent: 'decisionMade',
      }
    }

    case 'agentThought':
      return {
        agentLog: [e.thought, ...state.agentLog].slice(0, MAX_LOG),
        lastEvent: 'agentThought',
      }

    case 'uiDecision': {
      // replace a same-question decision if present, else prepend
      const rest = state.uiDecisions.filter((d) => d.question !== e.decision.question)
      return { uiDecisions: [e.decision, ...rest].slice(0, MAX_LOG), lastEvent: 'uiDecision' }
    }

    case 'statusChange':
      return { component: { ...state.component, status: e.status }, lastEvent: 'statusChange' }

    case 'cutover':
      return { cutoverStage: e.stage, lastEvent: 'cutover' }

    default:
      return {}
  }
}

export const useStore = create<StoreState>((set) => ({
  ...source.getSnapshot(),
  controls: source,
  lastEvent: null,
  apply: (event) => set((state) => reduce(state, event)),
}))

// Wire the source stream into the store once, at module load.
source.subscribe((event) => useStore.getState().apply(event))

/* ---- tiny selector helpers (stable references) ------------------- */
export const selectControls = (s: StoreState) => s.controls
export const selectComponent = (s: StoreState) => s.component
export const selectMatchRate = (s: StoreState) => s.component.matchRate
export const selectThreshold = (s: StoreState) => s.threshold
export const selectHistory = (s: StoreState) => s.history
export const selectMismatches = (s: StoreState) => s.mismatches
export const selectDecisions = (s: StoreState) => s.decisions
export const selectAgentLog = (s: StoreState) => s.agentLog
export const selectUIDecisions = (s: StoreState) => s.uiDecisions
export const selectCutover = (s: StoreState) => s.cutoverStage
export const selectGraph = (s: StoreState) => s.graph
