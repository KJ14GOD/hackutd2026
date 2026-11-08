// Builds the org (people, teams, managers, ownership with evidence), resolves identities, scores authority
// and generates the approver list. Jira, Notion and Slack are read through their real APIs; a source that
// fails is reported and skipped, never quietly replaced. Only `offline` (tests) reads fixtures/org instead.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pass1 } from '../../segmenter/src/types';
import { approvers } from './approvers';
import { score, type AuthorityConfig } from './authority';
import type { Http } from './http';
import { resolveIdentities } from './identity';
import { scopeIndex } from './scopes';
import { github, handleToEmail } from './sources/github';
import { hrExport } from './sources/hrExport';
import { jira } from './sources/jira';
import { notion } from './sources/notion';
import { slack } from './sources/slack';
import type { Org, SourceResult } from './types';

export interface BuildOptions {
  pass1: Pass1;
  /** fixtures/org (the synthetic company). */
  orgDir: string;
  http: Http;
  env: Record<string, string | undefined>;
  authority: AuthorityConfig & { approverThreshold: number };
  log?: (line: string) => void;
  /** Tests only: read Jira, Notion and Slack from fixtures/org instead of their APIs. */
  offline?: boolean;
}

/** A GitHub token from GITHUB_TOKEN, else the gh CLI's login. */
export function githubToken(env: Record<string, string | undefined>): string | undefined {
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() || undefined; } catch { return undefined; }
}

export async function buildOrg(opts: BuildOptions): Promise<Org> {
  const { pass1, orgDir, http, env } = opts;
  const log = opts.log ?? (() => {});
  const index = scopeIndex(pass1);
  const hr = hrExport(join(orgDir, 'hr.json'));
  const workers = (JSON.parse(readFileSync(join(orgDir, 'hr.json'), 'utf8')) as { workers: { workerId: string; workEmail: string; firstName: string; lastName: string }[] }).workers;
  const emailOf = (id: string) => workers.find((w) => w.workerId === id)?.workEmail.toLowerCase() ?? id;
  const personOf = (id: string) => {
    const w = workers.find((x) => x.workerId === id);
    return w ? { name: `${w.firstName} ${w.lastName}`, email: w.workEmail.toLowerCase() } : { name: id };
  };
  const members = (JSON.parse(readFileSync(join(orgDir, 'github.json'), 'utf8')) as { members: Record<string, string> }).members;

  /** Runs a source against its API. A missing key or a failed call is reported, and the source is skipped. */
  const attempt = async (name: string, ready: boolean, live: () => Promise<SourceResult>, file: () => Promise<SourceResult>): Promise<SourceResult> => {
    if (opts.offline) { log(`${name}: fixture file (offline)`); return file(); }
    const empty: SourceResult = { source: name, live: false, people: [], teams: [], reportsTo: [], owns: [] };
    if (!ready) { log(`${name}: SKIPPED, no key in .env`); return empty; }
    try { const r = await live(); log(`${name}: live API`); return r; } catch (err) {
      log(`${name}: SKIPPED, live API failed (${err instanceof Error ? err.message.slice(0, 120) : err})`);
      return empty;
    }
  };

  const files = pass1.nodes.filter((n) => n.kind === 'program' && n.file).map((n) => n.file!);
  const token = githubToken(env);
  const results: SourceResult[] = [hr];
  log('hr: fixture file (Workday-style export)');
  if (token) {
    const gh = await github(http, index, { repo: env.GITHUB_ORG_REPO ?? 'KJ14GOD/harborcard-mainframe', token, files });
    // CODEOWNERS handles become HR emails through the org membership export.
    gh.owns = gh.owns.map((o) => (o.personId.startsWith('github:') ? { ...o, personId: handleToEmail(o.personId, members) ?? o.personId } : o));
    results.push(gh);
    log(`github: live API (${env.GITHUB_ORG_REPO ?? 'KJ14GOD/harborcard-mainframe'})`);
  } else log('github: skipped (no GITHUB_TOKEN and gh is not logged in)');

  const jiraOpts = env.JIRA_SITE && env.JIRA_EMAIL && env.JIRA_API_TOKEN ? { site: env.JIRA_SITE, email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN, project: env.JIRA_PROJECT ?? 'CARD' } : undefined;
  results.push(await attempt('jira', !!jiraOpts, () => jira(http, index, jiraOpts, join(orgDir, 'jira.json'), emailOf), () => jira(http, index, undefined, join(orgDir, 'jira.json'), emailOf)));
  results.push(await attempt('notion', !!env.NOTION_TOKEN, () => notion(http, index, env.NOTION_TOKEN, join(orgDir, 'notion.json'), emailOf), () => notion(http, index, undefined, join(orgDir, 'notion.json'), emailOf)));
  results.push(await attempt('slack', !!env.SLACK_BOT_TOKEN, () => slack(http, index, env.SLACK_BOT_TOKEN, join(orgDir, 'slack.json'), personOf), () => slack(http, index, undefined, join(orgDir, 'slack.json'), personOf)));

  const resolved = resolveIdentities(results);
  const owns = results.flatMap((r) => r.owns).map((o) => ({ ...o, personId: resolved.canonical.get(o.personId) ?? o.personId }));
  const scored = score(owns, resolved.people, hr.reportsTo, opts.authority);

  // Access (fixtures/org/access.json): batch and online card programs vs the DB2 transaction-type pocket.
  const access = JSON.parse(readFileSync(join(orgDir, 'access.json'), 'utf8')) as { grants: { person: string; scopes: string[] }[] };
  const pocketOf = (target: string) => (pass1.nodes.find((n) => n.id === target)?.file?.includes('app-transaction-type-db2') ? 'transaction-type' : 'card');
  const hasAccess = (personId: string, target: string) => {
    const grant = access.grants.find((g) => emailOf(g.person) === personId);
    return !!grant && (grant.scopes.includes('*') || grant.scopes.includes(pocketOf(target)));
  };

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: results.map((r) => ({ source: r.source, live: r.live, people: r.people.length, owns: r.owns.length })),
    people: resolved.people,
    teams: hr.teams,
    reportsTo: hr.reportsTo,
    owns: scored.owns,
    identityMatches: resolved.matches,
    successors: scored.successors,
    scores: scored.scores,
    approvers: approvers(scored.scores, resolved.people, hasAccess, opts.authority.approverThreshold),
  };
}
