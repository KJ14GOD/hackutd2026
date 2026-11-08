// The generated approved-people list (§5.6): active, already has access to the scope, and scored at or
// above the threshold. Each entry keeps the evidence so a customer admin can sign it off once.
import type { Approver, Person, Score } from './types';

export function approvers(scores: Score[], people: Person[], hasAccess: (personId: string, target: string) => boolean, threshold: number): Approver[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  return scores
    .filter((s) => s.score >= threshold && byId.get(s.personId)?.active && hasAccess(s.personId, s.target))
    .map((s) => ({ personId: s.personId, name: byId.get(s.personId)!.name, target: s.target, category: s.category, score: s.score, evidence: s.evidence }));
}
