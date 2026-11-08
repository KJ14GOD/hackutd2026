// GitHub: CODEOWNERS and commit history for each program file, through the REST API.
//   GET /repos/{repo}/contents/.github/CODEOWNERS
//   GET /repos/{repo}/commits?path={file}&per_page=100
// Commit authors arrive as name + email; identity resolution joins them to HR by email.
import type { Http } from '../http';
import { programsForPath, type ScopeIndex } from '../scopes';
import type { Owns, Person, SourceResult } from '../types';

interface Commit { commit: { author: { name: string; email: string; date: string }; message: string } }

export interface GithubOptions { repo: string; token: string; files: string[] }

/** CODEOWNERS lines as (pattern, owners); later lines win, as on GitHub. */
export function parseCodeowners(text: string): { pattern: string; owners: string[] }[] {
  return text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
    .map((l) => { const [pattern, ...owners] = l.split(/\s+/); return { pattern, owners }; });
}

export async function github(http: Http, index: ScopeIndex, opts: GithubOptions): Promise<SourceResult> {
  const headers = { Authorization: `Bearer ${opts.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'theseus' };
  const api = `https://api.github.com/repos/${opts.repo}`;
  const owns: Owns[] = [];
  const people = new Map<string, Person>();

  const file = await http.json<{ content: string }>(`${api}/contents/.github/CODEOWNERS`, { headers });
  const rules = parseCodeowners(Buffer.from(file.content, 'base64').toString('utf8'));
  // For each program, the last matching rule wins: an individual line overrides a team glob.
  for (const p of index.programs) {
    const id = `prog:${p}`;
    const match = [...rules].reverse().find((r) => programsForPath(index, r.pattern).includes(id)
      || (r.pattern.endsWith('/') && opts.files.some((f) => `/${f}`.startsWith(r.pattern) && f.toUpperCase().includes(p))));
    if (!match) continue;
    for (const owner of match.owners) {
      const team = owner.includes('/');
      owns.push({
        personId: team ? `team:${owner.split('/')[1]}` : `github:${owner.slice(1)}`, target: id, kind: 'code',
        signal: team ? 'teamCodeOwner' : 'namedCodeOwner', weight: 0, source: 'github',
        evidence: `CODEOWNERS: ${match.pattern} ${owner}`, observedAt: '',
      });
    }
  }

  for (const path of opts.files) {
    const targets = programsForPath(index, path);
    if (!targets.length) continue;
    const commits = await http.json<Commit[]>(`${api}/commits?path=${encodeURIComponent(path)}&per_page=100`, { headers });
    for (const c of commits) {
      const email = c.commit.author.email.toLowerCase();
      if (!people.has(email)) people.set(email, { id: email, emails: [email], name: c.commit.author.name, active: true, source: 'github' });
      for (const target of targets) owns.push({
        personId: email, target, kind: 'code', signal: 'commits', weight: 0, source: 'github',
        evidence: `commit ${c.commit.author.date.slice(0, 10)} ${c.commit.message.split('\n')[0]}`, observedAt: c.commit.author.date,
      });
    }
  }
  return { source: 'github', live: true, people: [...people.values()], teams: [], reportsTo: [], owns };
}

/** CODEOWNERS handles to emails, from the org membership export (never guessed from names). */
export function handleToEmail(handle: string, members: Record<string, string>): string | undefined {
  return members[handle.replace(/^github:/, '')]?.toLowerCase();
}
