// Phase 4: for each Part 2 question, search the company's documents, let Nemotron judge whether they
// answer it, and route what's left to an owner from Phase 3.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmProvider } from '../../../packages/llm/src/index';
import type { Org } from '../../people/src/types';
import type { Part2 } from '../../reader/src/contract';
import { judge } from './judge';
import { route } from './route';
import { search } from './search';
import type { ContextRun, Doc, Resolution } from './types';

export interface ContextOptions {
  part2: Part2;
  org: Org;
  docs: Doc[];
  provider: LlmProvider;
  /** The codebase, for the COBOL lines each question cites. */
  root: string;
  programs?: string[];
  concurrency: number;
  maxDocs: number;
  onResolution?: (r: Resolution) => void;
}

/** The cited lines of code, as "path:line| text". */
function codeLines(root: string, evidence: string[]): string[] {
  const out: string[] = [];
  for (const ref of evidence.slice(0, 4)) {
    const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(ref);
    if (!m) continue;
    try {
      const lines = readFileSync(join(root, m[1]), 'utf8').split(/\r?\n/);
      for (let n = Number(m[2]); n <= Math.min(Number(m[3] ?? m[2]), Number(m[2]) + 6); n++) out.push(`${m[1]}:${n}| ${(lines[n - 1] ?? '').slice(6, 72).trim()}`);
    } catch { /* a missing file just means no code shown */ }
  }
  return out;
}

export async function runContext(opts: ContextOptions): Promise<ContextRun> {
  const questions = opts.part2.results.filter((r) => !opts.programs?.length || opts.programs.includes(r.program)).flatMap((r) => r.questions);
  const out: Resolution[] = new Array(questions.length);
  let next = 0;
  let model = opts.provider.mode as string;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, questions.length)) }, async () => {
    while (next < questions.length) {
      const i = next++;
      const q = questions[i];
      const hits = search(opts.docs, { program: q.program, text: q.text }, opts.maxDocs);
      // A failed judge call (rate limit, outage) must not end the run: the question falls back to asking a person.
      const judged = await judge(opts.provider, { id: q.id, program: q.program, text: q.text }, codeLines(opts.root, q.evidence), hits)
        .catch((err: unknown) => ({ verdict: 'not-found' as const, answer: '', quotes: [], confidence: 'low' as const, note: `judge failed: ${String(err).slice(0, 120)}`, model: 'none' }));
      if (judged.model !== 'none') model = judged.model;
      const r: Resolution = {
        questionId: q.id, program: q.program, question: q.text, verdict: judged.verdict, answer: judged.answer, quotes: judged.quotes,
        confidence: judged.confidence, route: route(opts.org, q.program, q.text, judged),
        searched: hits.map((h) => ({ docId: h.doc.id, score: h.score })), ...(judged.note ? { note: judged.note } : {}),
      };
      out[i] = r;
      opts.onResolution?.(r);
    }
  }));
  return { version: 1, generatedAt: new Date().toISOString(), model, docs: opts.docs.length, resolutions: out };
}
