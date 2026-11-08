// Shapes the step 4 API sends to the browser. Kept apart from read.ts so the page can import them
// without pulling in Node-only code.
import type { PackResult, Part2 } from '../../../services/reader/src/contract';

export interface ReadRun { id: string; mode: 'live' | 'replay'; startedAt: string; ms: number; networkCalls: number; part2: Part2 }

export type ReadEvent =
  | { type: 'stage'; message: string }
  | { type: 'log'; line: string }
  /** Nemotron's answer for one program as it's written, in ~20-character chunks. */
  | { type: 'token'; program: string; text: string }
  | { type: 'result'; result: PackResult; done: number; total: number }
  | { type: 'done'; run: ReadRun }
  | { type: 'error'; message: string };
