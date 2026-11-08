// Authority scoring (§5.5): for each (person, program, category) the score is the sum of signal weights.
// Weights come from theseus.config.json so results are deterministic and explainable. Each signal counts
// once per program (its strongest instance), so filing ten tickets doesn't outrank owning the policy.
import type { Category, Owns, Person, ReportsTo, Score, Signal, Successor } from './types';

export interface AuthorityConfig { weights: Record<Signal, number>; commitHalfLifeDays: number }

/** Which signals count for which kind of decision (§5.5 table). */
export const COUNTS: Record<Category, Signal[]> = {
  'business-rule': ['policyOwner', 'managerOfOwningTeam', 'ticketReporter', 'chatParticipant'],
  behavior: ['namedCodeOwner', 'commits', 'specAuthor', 'ticketAssignee', 'chatParticipant'],
  data: ['namedCodeOwner', 'specAuthor', 'commits', 'chatParticipant'],
  style: ['managerOfOwningTeam', 'namedCodeOwner'],
};

const DAY = 86_400_000;

/** The manager most of a team's active members report to. */
export function teamManager(team: string, people: Person[], reportsTo: ReportsTo[]): string | undefined {
  const votes = new Map<string, number>();
  for (const p of people.filter((x) => x.team === team && x.active)) {
    const m = reportsTo.find((r) => r.personId === p.id)?.managerId;
    if (m && m !== p.id) votes.set(m, (votes.get(m) ?? 0) + 1);
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Weighs every ownership link, adds "manager of the owning team" links, and suggests successors for
 * links held by people who have left. Returns weighted links, scores and successors.
 */
export function score(owns: Owns[], people: Person[], reportsTo: ReportsTo[], cfg: AuthorityConfig): { owns: Owns[]; scores: Score[]; successors: Successor[] } {
  const byId = new Map(people.map((p) => [p.id, p]));
  // Commits decay relative to the newest commit seen, so the same sources always give the same scores.
  const newest = Math.max(0, ...owns.filter((o) => o.signal === 'commits').map((o) => Date.parse(o.observedAt) || 0));
  const weighted: Owns[] = owns.map((o) => ({
    ...o,
    weight: o.signal === 'commits'
      ? cfg.weights.commits * 0.5 ** (Math.max(0, newest - (Date.parse(o.observedAt) || newest)) / DAY / cfg.commitHalfLifeDays)
      : cfg.weights[o.signal],
  }));

  // The owning team is the team of each named code owner, plus any team named in CODEOWNERS.
  for (const target of new Set(weighted.map((o) => o.target))) {
    const teams = new Set<string>();
    for (const o of weighted.filter((x) => x.target === target)) {
      if (o.signal === 'namedCodeOwner' && byId.get(o.personId)?.team) teams.add(byId.get(o.personId)!.team!);
      if (o.signal === 'teamCodeOwner') teams.add(o.personId.replace(/^team:/, ''));
    }
    for (const team of teams) {
      const manager = teamManager(team, people, reportsTo);
      if (manager) weighted.push({ personId: manager, target, kind: 'app', signal: 'managerOfOwningTeam', weight: cfg.weights.managerOfOwningTeam, source: 'hr', evidence: `manages ${team}, which owns this code`, observedAt: '' });
    }
  }

  // People who left keep their history. Their scope is suggested to the active CODEOWNERS owner, else the
  // latest active committer, else their manager; a suggestion still needs someone to confirm it.
  const successors: Successor[] = [];
  const activeHr = (id: string) => byId.get(id)?.active && byId.get(id)?.source === 'hr';
  for (const target of new Set(weighted.map((o) => o.target))) {
    const here = weighted.filter((o) => o.target === target && byId.has(o.personId));
    const gone = [...new Set(here.filter((o) => !byId.get(o.personId)!.active && ['commits', 'namedCodeOwner'].includes(o.signal)).map((o) => o.personId))];
    for (const from of gone) {
      const owner = here.find((o) => o.signal === 'namedCodeOwner' && activeHr(o.personId));
      const latest = here.filter((o) => o.signal === 'commits' && activeHr(o.personId)).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
      const manager = reportsTo.find((r) => r.personId === from)?.managerId;
      const to = owner?.personId ?? latest?.personId ?? manager;
      const reason = owner ? `active code owner (${owner.evidence})` : latest ? `most recent active committer (${latest.observedAt.slice(0, 10)})` : 'their manager';
      if (to) successors.push({ from, to, target, reason });
    }
  }

  const scores: Score[] = [];
  const key = (o: Owns) => `${o.personId}|${o.target}`;
  const groups = new Map<string, Owns[]>();
  for (const o of weighted) { if (!byId.has(o.personId)) continue; if (!groups.has(key(o))) groups.set(key(o), []); groups.get(key(o))!.push(o); }
  for (const [k, list] of groups) {
    const [personId, target] = k.split('|');
    for (const category of Object.keys(COUNTS) as Category[]) {
      let total = 0;
      const evidence: string[] = [];
      for (const signal of COUNTS[category]) {
        const best = list.filter((o) => o.signal === signal).sort((a, b) => b.weight - a.weight)[0];
        if (!best || best.weight <= 0) continue;
        total += best.weight;
        evidence.push(`${signal} ${best.weight.toFixed(2)}: ${best.evidence}`);
      }
      if (total > 0) scores.push({ personId, target, category, score: Math.round(total * 100) / 100, evidence });
    }
  }
  scores.sort((a, b) => a.target.localeCompare(b.target) || a.category.localeCompare(b.category) || b.score - a.score);
  return { owns: weighted, scores, successors };
}
