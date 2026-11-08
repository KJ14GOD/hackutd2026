import type { RealtimeSource } from '@/data/source'
import { MockSource } from '@/data/mockSource'

/* ------------------------------------------------------------------ *
 * THE one-line backend swap.
 *
 *   today:  return new MockSource(scenarioId)
 *   later:  return new SpacetimeSource(...)  // same RealtimeSource API
 *
 * No UI component changes when this changes.
 * ------------------------------------------------------------------ */
export function createSource(scenarioId?: string): RealtimeSource {
  return new MockSource(scenarioId)
}
