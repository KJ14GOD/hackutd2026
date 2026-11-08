// `npx tsx services/harness/src/load.ts`: pushes Phase 3 (out/people/org.json) and Phase 4
// (out/context/resolutions.json, with the question details from out/part2.json) into SpacetimeDB, where the
// harness, the Slack worker and the UI all read them. Safe to rerun: answers people already gave are kept.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { connectStdb } from '../../../packages/shared/src/stdb';
import type { Org } from '../../people/src/types';
import type { ContextRun } from '../../context/src/types';
import type { Part2 } from '../../reader/src/contract';

const ROOT = resolve(import.meta.dirname, '../../..');
const read = <T>(f: string) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')) as T;

/** Question rows for loadQuestions: Part 2's question plus Phase 4's verdict, quotes and route. */
export function questionRows(part2: Part2, context: ContextRun) {
  const byId = new Map(part2.results.flatMap((r) => r.questions).map((q) => [q.id, q]));
  return context.resolutions.map((r) => {
    const q = byId.get(r.questionId);
    return {
      id: r.questionId, program: r.program, text: r.question, evidence: q?.evidence ?? [], options: q?.options ?? [], blocks: q?.blocks ?? 'none',
      verdict: r.verdict, answer: r.answer, quotes: r.quotes, confidence: r.confidence,
      ...(r.route ? { route: { to: r.route.to, name: r.route.name, why: r.route.why } } : {}),
    };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const org = read<Org>('out/people/org.json');
  const rows = questionRows(read<Part2>('out/part2.json'), read<ContextRun>('out/context/resolutions.json'));
  const conn = await connectStdb();
  await conn.reducers.loadOrg({ json: JSON.stringify({ people: org.people, teams: org.teams, reportsTo: org.reportsTo, owns: org.owns, identityMatches: org.identityMatches, approvers: org.approvers }) });
  for (let i = 0; i < rows.length; i += 50) await conn.reducers.loadQuestions({ json: JSON.stringify(rows.slice(i, i + 50)) });
  console.log(`loaded ${org.people.length} people, ${org.owns.length} ownership links, ${org.approvers.length} approvers, ${rows.length} questions`);
  conn.disconnect();
}
