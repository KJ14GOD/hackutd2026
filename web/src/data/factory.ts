import type { RealtimeSource } from '@/data/source'
import { MockSource } from '@/data/mockSource'
import { SpacetimeSource } from '@/data/spacetimeSource'

/* ------------------------------------------------------------------ *
 * THE one-line backend swap.
 *
 * MockSource (offline, demo-safe) is the default. Set VITE_SOURCE=spacetime
 * or open the page with ?source=spacetime to read people, questions and
 * Slack outreach live from SpacetimeDB (VITE_STDB_URI, VITE_STDB_DB).
 *
 * No UI component changes when this changes.
 * ------------------------------------------------------------------ */
export function createSource(scenarioId?: string): RealtimeSource {
  const fromUrl = new URLSearchParams(window.location.search).get('source')
  if ((fromUrl ?? import.meta.env.VITE_SOURCE) === 'spacetime') {
    return new SpacetimeSource(
      { uri: import.meta.env.VITE_STDB_URI ?? 'ws://localhost:3000', database: import.meta.env.VITE_STDB_DB ?? 'theseus' },
      scenarioId,
    )
  }
  return new MockSource(scenarioId)
}
