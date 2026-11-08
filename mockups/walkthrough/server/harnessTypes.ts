// Frames /api/harness/stream sends. Kept apart from harness.ts so pages can import them without Node code.
// Row shapes mirror the SpacetimeDB tables (spacetime/src/index.ts), with u64 times as numbers.

export interface HarnessJob { id: string; program: string; status: string; waitingOnJson: string; stateJson: string; startedAtMs: number; updatedAtMs: number }
export interface HarnessEvent { id: number; jobId: string; atMs: number; kind: string; message: string; dataJson: string }
export interface HarnessQuestion { id: string; program: string; text: string; status: string; routeTo: string; routeName: string; routeWhy: string; optionsJson: string; answerText: string; answeredBy: string; answeredAtMs: number }

export type HarnessFrame =
  | { type: 'snapshot'; jobs: HarnessJob[]; events: HarnessEvent[]; questions: HarnessQuestion[]; people: { id: string; name: string; title: string }[] }
  | { type: 'event'; event: HarnessEvent }
  | { type: 'job'; job: HarnessJob }
  | { type: 'question'; question: HarnessQuestion }
  | { type: 'error'; message: string };
