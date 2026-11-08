// Phase 3 against fixtures/org/answer-key.md, with no network (offline mode): GitHub answers come from
// github.json shaped like the REST API, and Jira, Notion and Slack read the files they were seeded from.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { loadConfig } from '../../../packages/shared/src/config';
import { runPass1 } from '../../segmenter/src/pass1';
import type { Http } from './http';
import { normalizeEmail } from './identity';
import { buildOrg } from './index';
import type { Org } from './types';

const ORG = 'fixtures/org';
const gh = JSON.parse(readFileSync(`${ORG}/github.json`, 'utf8'));
const hr = JSON.parse(readFileSync(`${ORG}/hr.json`, 'utf8'));
const author = (id: string) => {
  const w = hr.workers.find((x: { workerId: string }) => x.workerId === id);
  return w ? { name: `${w.firstName} ${w.lastName}`, email: w.workEmail } : gh.aliases[id];
};

/** Answers GitHub REST calls from the fixture, the way the seeded repo would. */
const fakeGithub: Http = {
  calls: 0,
  async json<T>(url: string): Promise<T> {
    if (url.endsWith('/contents/.github/CODEOWNERS')) return { content: Buffer.from(gh.codeowners).toString('base64') } as T;
    const path = decodeURIComponent(/path=([^&]+)/.exec(url)?.[1] ?? '');
    const list = gh.commits.filter((c: { path: string }) => c.path === path).map((c: { author: string; date: string; message: string }) => ({ commit: { author: { ...author(c.author), date: `${c.date}T15:00:00Z` }, message: c.message } }));
    if (gh.commits.some((c: { path: string }) => c.path === path)) list.push({ commit: { author: { ...author('dana'), date: '2018-12-03T10:00:00Z' }, message: 'Import CardDemo programs' } });
    return list as T;
  },
};

let org: Org;
const name = (id: string) => org.people.find((p) => p.id === id)?.name;
const approversOf = (prog: string, category: string) => org.approvers.filter((a) => a.target === `prog:${prog}` && a.category === category).map((a) => a.name);

beforeAll(async () => {
  org = await buildOrg({
    pass1: runPass1('legacy/carddemo'), orgDir: ORG, http: fakeGithub,
    env: { GITHUB_TOKEN: 'test' }, authority: loadConfig().requirements.authority, offline: true,
  });
}, 60_000);

it('makes Maria the interest-rule approver and keeps Priya, who only files tickets, below her', () => {
  expect(approversOf('CBACT04C', 'business-rule')[0]).toBe('Maria Lopez');
  expect(approversOf('CBACT04C', 'business-rule')).not.toContain('Priya Nair');
});

it('also finds Ana for CBACT04C rules through the fees policy, so the fees conflict has both sides', () => {
  expect(approversOf('CBACT04C', 'business-rule')).toContain('Ana Ruiz');
});

it('names the code owners for behavior: Dev, Tom and Grace', () => {
  expect(approversOf('CBACT04C', 'behavior')).toEqual(['Dev Okafor']);
  expect(approversOf('COTRN02C', 'behavior')).toEqual(['Tom Becker']);
  expect(approversOf('COBTUPDT', 'behavior')).toEqual(['Grace Kim']);
});

it('never makes Dana an approver and suggests her code owners as successors', () => {
  expect(org.approvers.some((a) => a.name === 'Dana Whitfield')).toBe(false);
  const forInterest = org.successors.find((s) => s.target === 'prog:CBACT04C');
  expect([name(forInterest!.from), name(forInterest!.to)]).toEqual(['Dana Whitfield', 'Dev Okafor']);
  expect(org.successors.some((s) => name(s.to) === 'Jordan Reyes')).toBe(false);
});

it('sends "D. Okafor" to merge review instead of merging it into Dev on name alone', () => {
  expect(org.identityMatches.some((m) => m.reason.startsWith('"D. Okafor"') && name(m.b) === 'Dev Okafor')).toBe(true);
  expect(org.people.find((p) => p.name === 'Dev Okafor')!.emails).not.toContain('dokafor@oldmail.example');
});

it('keeps evidence on every approver and normalizes emails', () => {
  for (const a of org.approvers) expect(a.evidence.length).toBeGreaterThan(0);
  expect(normalizeEmail(' Dev.Okafor+jira@HarborCard.example ')).toBe('dev.okafor@harborcard.example');
});
