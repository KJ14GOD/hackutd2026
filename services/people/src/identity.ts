// Identity resolution (§5.4): join people across sources on normalized email, never on name alone. Anyone
// left over who looks like a known person by name goes to merge review instead of being merged.
import type { IdentityMatch, Person, SourceResult } from './types';

/** Lowercase, drop +tags. */
export const normalizeEmail = (e: string) => e.trim().toLowerCase().replace(/\+[^@]*@/, '@');

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);

/** "D. Okafor" and "Dev Okafor": same last name, first names agree as far as both go. */
function similarName(a: string, b: string): boolean {
  const [x, y] = [nameKey(a), nameKey(b)];
  if (x.length < 2 || y.length < 2 || x[x.length - 1] !== y[y.length - 1]) return false;
  return x[0].startsWith(y[0]) || y[0].startsWith(x[0]);
}

export interface Resolved {
  people: Person[];
  /** Any source-local key (email, slack:name) to the canonical person id. */
  canonical: Map<string, string>;
  matches: IdentityMatch[];
}

export function resolveIdentities(results: SourceResult[]): Resolved {
  const people = new Map<string, Person>();
  const canonical = new Map<string, string>();
  const byEmail = new Map<string, string>();
  // HR is the directory: its people are canonical. Then every other source joins by email or stands alone.
  const ordered = [...results].sort((a, b) => (a.source === 'hr' ? -1 : b.source === 'hr' ? 1 : 0));
  for (const r of ordered) for (const p of r.people) {
    const emails = p.emails.map(normalizeEmail);
    const hit = emails.map((e) => byEmail.get(e)).find(Boolean);
    if (hit) {
      const known = people.get(hit)!;
      known.emails = [...new Set([...known.emails, ...emails])];
      canonical.set(p.id, hit);
      continue;
    }
    const person = { ...p, emails };
    people.set(p.id, person);
    canonical.set(p.id, p.id);
    for (const e of emails) byEmail.set(e, p.id);
  }
  const hr = [...people.values()].filter((p) => p.source === 'hr');
  const matches: IdentityMatch[] = [];
  for (const p of people.values()) {
    if (p.source === 'hr') continue;
    for (const h of hr) if (similarName(p.name, h.name)) {
      matches.push({ a: p.id, b: h.id, reason: `"${p.name}" (${p.source}${p.emails.length ? `, ${p.emails[0]}` : ', no email'}) looks like ${h.name} but shares no email`, sources: [p.source, 'hr'] });
    }
  }
  return { people: [...people.values()], canonical, matches };
}
