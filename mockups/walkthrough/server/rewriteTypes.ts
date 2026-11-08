// What a saved rewrite holds: the result and every event of the run with its time, so a replay is exact.
// Kept apart from rewrite.ts so pages can import it without Node code.
import type { RewriteEvent, RewriteResult } from '../../../services/rewrite/src/types';

export interface RewriteRecord { result: RewriteResult; timeline: { atMs: number; event: RewriteEvent }[] }

/** GET /api/rewrite: the latest result plus the gate threshold and every earlier run, oldest first. */
export type RewriteResponse = RewriteResult & { threshold: number; history: { at: string; matchRate: number; status: string; passes: number }[] };
export type { RewriteEvent, RewriteResult };
