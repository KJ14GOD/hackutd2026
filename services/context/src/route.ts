// Who gets asked: conflicts go to whoever may decide the business rule; things nobody wrote down go to the
// code owner, or the rule owner when the question is about policy. Answers that rest only on chat are sent
// to the code owner to confirm. Owners come from Phase 3 (out/people/org.json), never from a guess.
import type { Org } from '../../people/src/types';
import type { Judged } from './judge';
import type { Resolution } from './types';

// Questions about business policy go to the rule owner; everything else to the code owner.
const RULE_WORDS = /\b(policy|business|customers?|fees?|round(ing)?|interest rate|audit|compliance|pci|regulat\w*|contract)\b/i;

export function route(org: Org, program: string, question: string, judged: Judged): Resolution['route'] {
  const target = `prog:${program}`;
  const pick = (category: string) => org.approvers.filter((a) => a.target === target && a.category === category).sort((a, b) => b.score - a.score)[0];
  const chatOnly = judged.verdict === 'answered' && judged.quotes.every((q) => q.source === 'slack');
  if (judged.verdict === 'answered' && judged.confidence !== 'low' && !chatOnly && !judged.openTicket) return undefined;
  const wantRule = judged.verdict === 'conflict' || !!judged.openTicket || (judged.verdict !== 'known-issue' && RULE_WORDS.test(question));
  const order = wantRule ? ['business-rule', 'behavior'] : ['behavior', 'business-rule'];
  for (const category of order) {
    const a = pick(category);
    if (a) {
      const why = judged.verdict === 'conflict' ? `decides ${category} for ${program}: ${a.evidence[0]}`
        : judged.verdict === 'known-issue' ? `open issue: decide whether the rewrite keeps or fixes it; ${a.evidence[0]}`
        : judged.openTicket ? `confirm: the documents answer it, but open ticket ${judged.openTicket} asks for a change; ${a.evidence[0]}`
        : chatOnly || judged.confidence === 'low' ? `confirm: the answer rests on ${chatOnly ? 'chat only' : 'a low-confidence reading'}; ${a.evidence[0]}`
        : `owns ${category} for ${program}: ${a.evidence[0]}`;
      return { to: a.personId, name: a.name, category, why };
    }
  }
  // No approver for this program: the successor of a departed owner; else the active person with the most
  // authority over it (named as below the approver threshold); else the modernization FTE, the last stop.
  const s = org.successors.find((x) => x.target === target);
  if (s) return { to: s.to, name: org.people.find((p) => p.id === s.to)?.name ?? s.to, category: 'behavior', why: `successor of ${org.people.find((p) => p.id === s.from)?.name}: ${s.reason}` };
  const active = new Set(org.people.filter((p) => p.active && p.source === 'hr').map((p) => p.id));
  // Code owned by a team (CODEOWNERS names a team): an engineer on that team, not its manager, for anything
  // that isn't a business rule. The member with the most authority over this program goes first.
  const team = org.owns.find((o) => o.target === target && o.signal === 'teamCodeOwner')?.personId.replace(/^team:/, '');
  const managers = new Set(org.reportsTo.map((r) => r.managerId));
  const members = team ? org.people.filter((p) => p.team === team && active.has(p.id) && !managers.has(p.id)) : [];
  if (members.length && !wantRule) {
    const scoreOf = (id: string) => Math.max(0, ...org.scores.filter((x) => x.personId === id && x.target === target).map((x) => x.score));
    const m = [...members].sort((a, b) => scoreOf(b.id) - scoreOf(a.id) || a.name.localeCompare(b.name))[0];
    return { to: m.id, name: m.name, category: 'behavior', why: `engineer on ${team}, which owns ${program} in CODEOWNERS` };
  }
  const best = org.scores.filter((x) => x.target === target && active.has(x.personId)).sort((a, b) => b.score - a.score)[0];
  if (best) return { to: best.personId, name: org.people.find((p) => p.id === best.personId)?.name ?? best.personId, category: best.category, why: `no approver for ${program}; most authority (${best.score}, below the threshold): ${best.evidence[0]}` };
  const fte = org.people.find((p) => p.active && p.team === 'theseus');
  return fte ? { to: fte.id, name: fte.name, category: 'escalation', why: `no one in the sources owns ${program}; the modernization lead decides who should` } : undefined;
}
