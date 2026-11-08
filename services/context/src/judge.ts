// Nemotron reads one question, the COBOL lines it cites, and the best documents, and says whether the
// company already answered it. Every quote must be a sentence id from the pack; code checks each one and
// downgrades a verdict whose quotes don't hold up.
import { z } from 'zod';
import type { LlmProvider } from '../../../packages/llm/src/index';
import { extractJson } from '../../reader/src/read';
import type { Hit, Quote, Verdict } from './types';

export const JUDGE_PROMPT = `You check whether a company's own documents already answer a question about its legacy COBOL code.
Use only the documents given. Prefer newer documents over older ones when they disagree about the same fact, and policies,
runbooks and decided tickets over casual chat. Reply with JSON only.`;

const TASK = `TASK
Decide one verdict:
- "answered": the documents settle the question (a later correction counts: use the newest word on it).
- "conflict": two DOCUMENTS that both still stand give different answers. A policy page plus an open ticket asking to change
  that behavior is a conflict, not an answer. The question's own assumptions are not a document: never call a conflict
  between a document and the question or the code.
- "known-issue": an open ticket records this as a bug or problem that is not fixed yet.
- "not-found": nothing here settles it; a person has to be asked.
Quote the sentences that support your verdict by their ids (like D2.3), exactly as listed. For "conflict", quote both sides.
OUTPUT
{"verdict":"answered|conflict|known-issue|not-found","answer":"one or two sentences, empty if not-found","quotes":["D1.2"],"confidence":"high|medium|low"}`;

const Reply = z.object({
  verdict: z.enum(['answered', 'conflict', 'known-issue', 'not-found']),
  answer: z.string().default(''),
  quotes: z.array(z.string()).default([]),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
});

export interface Judged { verdict: Verdict; answer: string; quotes: Quote[]; confidence: 'high' | 'medium' | 'low'; note?: string; model: string;
  /** An open ticket about the same program that the answer didn't quote: someone should confirm. */
  openTicket?: string }

/** The text Nemotron reads: the question, its code lines, and each document as numbered sentences. */
export function judgePack(question: { id: string; program: string; text: string }, code: string[], hits: Hit[]): string {
  return [
    `QUESTION ${question.id} about program ${question.program}`, question.text, '',
    'CODE IT CITES', ...(code.length ? code : ['(none)']), '',
    ...hits.flatMap((h, i) => [
      `D${i + 1} ${h.doc.source.toUpperCase()} "${h.doc.title}" by ${h.doc.author || 'unknown'}, dated ${h.doc.date || 'unknown'}`,
      ...h.doc.sentences.map((s, j) => `D${i + 1}.${j + 1} ${s}`), '',
    ]),
    hits.length ? '' : 'DOCUMENTS: none matched this question.',
    TASK,
  ].join('\n');
}

export async function judge(provider: LlmProvider, question: { id: string; program: string; text: string }, code: string[], hits: Hit[]): Promise<Judged> {
  if (!hits.length) return { verdict: 'not-found', answer: '', quotes: [], confidence: 'high', note: 'no document matched', model: 'none' };
  const reply = await provider.complete({ role: 'strong', maxTokens: 1500, messages: [{ role: 'system', content: JUDGE_PROMPT }, { role: 'user', content: judgePack(question, code, hits) }] });
  let parsed: z.infer<typeof Reply>;
  try { parsed = Reply.parse(extractJson(reply.text).value); } catch (err) {
    return { verdict: 'not-found', answer: '', quotes: [], confidence: 'low', note: `reply was not the contract JSON: ${String(err).slice(0, 120)}`, model: reply.model };
  }
  const quotes: Quote[] = [];
  const bad: string[] = [];
  for (const id of parsed.quotes) {
    const m = /^D(\d+)\.(\d+)$/.exec(id.trim());
    const hit = m ? hits[Number(m[1]) - 1] : undefined;
    const text = hit?.doc.sentences[Number(m![2]) - 1];
    if (!hit || !text) { bad.push(id); continue; }
    quotes.push({ docId: hit.doc.id, source: hit.doc.source, url: hit.doc.url, title: hit.doc.title, text, date: hit.doc.date });
  }
  // A verdict that claims the documents say something must show it; otherwise it falls back to asking.
  if (parsed.verdict !== 'not-found' && !quotes.length) {
    return { verdict: 'not-found', answer: '', quotes: [], confidence: 'low', note: `verdict ${parsed.verdict} had no valid quote (${bad.join(', ') || 'none given'})`, model: reply.model };
  }
  // An "answered" that skips an open ticket on the same program among the top hits needs a human to confirm.
  const quoted = new Set(quotes.map((q) => q.docId));
  const open = parsed.verdict === 'answered'
    ? hits.slice(0, 3).find((h) => h.doc.source === 'jira' && !quoted.has(h.doc.id) && h.doc.programs.includes(`prog:${question.program}`) && h.doc.sentences.some((s) => /^Status: (Open|In Progress|To Do)/i.test(s)))
    : undefined;
  // Evidence that's only about other programs can't settle this one: a person has to confirm it applies.
  const target = `prog:${question.program}`;
  const offProgram = parsed.verdict === 'answered' && !quotes.some((q) => hits.find((h) => h.doc.id === q.docId)?.doc.programs.includes(target));
  const notes = [...(bad.length ? [`dropped invalid quotes ${bad.join(', ')}`] : []), ...(open ? [`open ticket ${open.doc.title.split(' ')[0]} on the same program was not addressed`] : []),
    ...(offProgram ? [`the quoted documents are about other programs, so it may not apply to ${question.program}`] : [])];
  return { verdict: parsed.verdict, answer: parsed.answer, quotes, confidence: offProgram ? 'low' : parsed.confidence, ...(notes.length ? { note: notes.join('; ') } : {}), model: reply.model, ...(open ? { openTicket: open.doc.title.split(' ')[0] } : {}) };
}
