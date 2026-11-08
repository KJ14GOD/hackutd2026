// Ranks documents for one question. Code, no LLM: a document about the same program (or the job that runs
// it) counts most, then shared rare words (an IDF weight, so "DEFAULT" counts more than "the"). Noise that
// only mentions the program in passing ranks below documents that also share the question's words.
import type { Doc, Hit } from './types';

const STOP = new Set('the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use that this with from have they will would there their what about which when make like time just know take into year your some them than then look only come over also back after work first well even want because these give most should could does is it of to in a an on be or as at by if no so do we he'.split(' '));

export const words = (text: string) => (text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter((w) => !STOP.has(w));

export function search(docs: Doc[], question: { program: string; text: string }, limit = 6): Hit[] {
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(words(d.sentences.join(' ')))) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log((docs.length + 1) / ((df.get(w) ?? 0) + 1));
  const q = new Set(words(question.text));
  const target = `prog:${question.program}`;
  const hits: Hit[] = [];
  for (const d of docs) {
    const terms = new Set(words(d.sentences.join(' ')));
    const shared = [...q].filter((w) => terms.has(w));
    const wordScore = shared.reduce((s, w) => s + idf(w), 0);
    const sameProgram = d.programs.includes(target);
    if (!sameProgram && wordScore < 2) continue;
    const score = (sameProgram ? 3 : 0) + wordScore;
    hits.push({ doc: d, score: Math.round(score * 100) / 100, why: `${sameProgram ? `mentions ${question.program}; ` : ''}shares ${shared.slice(0, 6).join(', ') || 'no words'}` });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
