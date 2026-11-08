// What the model must return for one pack (spec §3.4), validated with zod. Anything that fails
// validation, or cites a line outside the pack, is dropped and counted, never passed on.
import { z } from 'zod';

export const FindingSchema = z.object({
  kind: z.enum(['connection', 'missed-connection', 'rule', 'defect', 'edge-value', 'coverage-gap', 'mismatch']),
  /** For kind "connection": which connection in the pack this explains, e.g. "C3". */
  ref: z.string().optional(),
  summary: z.string().min(3),
  evidence: z.array(z.string()),
  // Models sometimes leave this out; a missing confidence isn't worth losing a cited finding over.
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
});

export const QuestionSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(5),
  evidence: z.array(z.string()),
  options: z.array(z.string()).min(2),
  blocks: z.enum(['rewrite', 'cutover', 'none']),
});

export const ModelOutputSchema = z.object({
  findings: z.array(z.unknown()).default([]),
  questions: z.array(z.unknown()).default([]),
  // A malformed request for more context must not cost the whole reply: "copybook" and "jcl" mean a file,
  // and anything else unrecognized is ignored.
  needMore: z.array(z.unknown()).optional().transform((asks) => (asks ?? []).flatMap((a) => {
    const o = (a ?? {}) as { kind?: unknown; id?: unknown };
    const kind = o.kind === 'copybook' || o.kind === 'jcl' ? 'file' : o.kind;
    return (kind === 'file' || kind === 'program' || kind === 'data') && typeof o.id === 'string' ? [{ kind, id: o.id } as const] : [];
  })),
});

export type Finding = z.infer<typeof FindingSchema>;
export type Question = z.infer<typeof QuestionSchema> & { id: string; program: string };

export interface PackResult {
  program: string;
  findings: Finding[];
  questions: Question[];
  needMore?: { kind: 'file' | 'program' | 'data'; id: string }[];
  /** Connections in the pack, and how many got an explanation (spec §3.9: must be 100%). */
  coverage: { connections: number; explained: number; missing: string[] };
}

export interface Dropped {
  program: string;
  reason: 'no-citation' | 'bad-citation' | 'schema' | 'truncated';
  detail: string;
}

export interface Part2 {
  version: 1;
  commit: string;
  model: string;
  results: PackResult[];
  crossProgram: Finding[];
  notVerified: { kind: 'unresolved' | 'never-fired' | 'never-ran'; ref: string }[];
  dropped: Dropped[];
}
