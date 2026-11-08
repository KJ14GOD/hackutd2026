import type { EvidenceWidget, MismatchCategory, Snapshot, UIDecision } from '@/types'

/* ------------------------------------------------------------------ *
 * The Jev (TypeSafe) decision seam — mirrors the RealtimeSource seam.
 *
 * Jev DECIDES (typed judgments, no generated text). The UI reads the
 * decisions; it never calls Jev directly. Today a MockDecider replays
 * recorded responses (offline, demo-safe). Later, swap to a real
 * OpenRouter `typesafe/jev-1.13` call behind the SAME interface — one
 * line in `createDecider()`.
 *
 * HARD RULE (from the Jev reference): never send raw numbers. Always
 * summarize state into labels in code, then ask Jev. `summarize()` is
 * where that happens.
 * ------------------------------------------------------------------ */

export interface JevDecider {
  /** Which UI decisions to (re)evaluate for the current snapshot. */
  decideForSnapshot(snap: Snapshot): UIDecision[]
  /** Category + evidence widget for one mismatch. */
  decideForMismatch(category: MismatchCategory): {
    widget: EvidenceWidget
    categoryConfidence: number
  }
  /** Human-readable label of where decisions come from (for the UI badge). */
  readonly label: string
}

/** Jev's hard rule: numbers degrade accuracy. Convert to labels here. */
export function summarize(snap: Snapshot): Record<string, string> {
  const rate = snap.component.matchRate
  const threshold = snap.threshold
  const open = snap.mismatches.filter((m) => m.status !== 'test_generated').length
  return {
    phase: snap.component.status,
    matchLevel:
      rate >= threshold ? 'at-threshold' : rate >= 0.9 ? 'high' : rate >= 0.8 ? 'climbing' : 'low',
    trend: snap.history.length > 1 ? 'rising' : 'flat',
    openMismatches: open === 0 ? 'none' : open <= 3 ? 'few' : 'many',
    noise: snap.noiseBaseline >= 0.99 ? 'clean-baseline' : 'noisy-baseline',
  }
}

/** Deterministic category → widget mapping Jev tends to pick. */
export function widgetForCategory(category: MismatchCategory): EvidenceWidget {
  switch (category) {
    case 'rounding':
      return 'numberLine'
    case 'formatting':
      return 'charDiff'
    case 'logic':
      return 'branchTrace'
    case 'noise':
      return 'tableDiff'
  }
}

/** Recorded confidence per category (calibrated-looking, stable for demo). */
const CATEGORY_CONFIDENCE: Record<MismatchCategory, number> = {
  rounding: 0.94,
  formatting: 0.97,
  logic: 0.82,
  noise: 0.66, // low → UI shows a "?" and lets a human confirm
}

/**
 * MockDecider — replays recorded Jev responses. Deterministic so the
 * demo is identical every run. Latencies mimic the real ~70–500ms band.
 */
export class MockDecider implements JevDecider {
  readonly label = 'Jev (recorded)'

  decideForSnapshot(snap: Snapshot): UIDecision[] {
    const s = summarize(snap)
    const atThreshold = s.matchLevel === 'at-threshold'
    const now = new Date().toISOString()

    const heroP = atThreshold
      ? { cutover: 0.72, shadow: 0.2, graph: 0.08 }
      : { shadow: 0.68, cutover: 0.07, graph: 0.25 }

    return [
      {
        id: `jev-hero-${snap.history.length}`,
        at: now,
        question: 'Which panel leads the dashboard right now?',
        type: 'choice',
        choice: atThreshold ? 'cutover' : 'shadow',
        probabilities: heroP,
        confidence: atThreshold ? 0.72 : 0.68,
        latencyMs: 140,
        model: 'Jev',
        drives: 'dashboard hero layout',
      },
      {
        id: `jev-cutover-${snap.history.length}`,
        at: now,
        question: 'Safe to advance cutover? (yes = match rate at threshold and baseline clean)',
        type: 'noul',
        choice: atThreshold && s.noise === 'clean-baseline' ? 'yes' : 'no',
        probabilities: atThreshold ? { yes: 0.91, no: 0.09 } : { yes: 0.12, no: 0.88 },
        latencyMs: 96,
        model: 'Jev',
        drives: 'cutover slider unlock',
      },
    ]
  }

  decideForMismatch(category: MismatchCategory) {
    return {
      widget: widgetForCategory(category),
      categoryConfidence: CATEGORY_CONFIDENCE[category],
    }
  }
}

/* ------------------------------------------------------------------ *
 * Backend swap point. Replace the return to go live:
 *
 *   return new OpenRouterDecider(import.meta.env.VITE_OPENROUTER_KEY)
 *
 * Nothing else in the app changes.
 * ------------------------------------------------------------------ */
export function createDecider(): JevDecider {
  return new MockDecider()
}
