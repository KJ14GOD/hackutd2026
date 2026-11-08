// GET /api/connectors: which sources Theseus can use right now, checked live with each one's key (results
// cached for a minute). The pipeline already skips a source with no key: Phase 3 (services/people) and
// Phase 4 (services/context) log it as SKIPPED and never read a stand-in file, so "not connected" here means
// that source contributes nothing to ownership or lookups.
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { sessionFor } from './githubAuth';
import type { Connector } from './connectorTypes';

const REPO_ROOT = resolve(__dirname, '../../..');
let cached: { at: number; list: Omit<Connector, 'connected' | 'detail'>[]; checks: Pick<Connector, 'id' | 'connected' | 'detail'>[] } | null = null;

async function ok(url: string, init: RequestInit): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
    return { ok: r.ok, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch { return { ok: false, body: {} }; }
}

const DEFS: Omit<Connector, 'connected' | 'detail'>[] = [
  { id: 'github', name: 'GitHub', usedFor: 'The code, commit history and CODEOWNERS: who wrote and owns each program', needs: 'Sign in with GitHub' },
  { id: 'slack', name: 'Slack', usedFor: 'Old threads as knowledge, and where Theseus asks people', needs: 'SLACK_BOT_TOKEN and SLACK_APP_TOKEN in .env' },
  { id: 'jira', name: 'Jira', usedFor: 'Tickets: who asked for a behavior, known bugs, decisions', needs: 'JIRA_SITE, JIRA_EMAIL, JIRA_API_TOKEN in .env' },
  { id: 'notion', name: 'Notion', usedFor: 'Policies, runbooks and data dictionaries, with their owners', needs: 'NOTION_TOKEN in .env, shared with the wiki page' },
  { id: 'confluence', name: 'Confluence', usedFor: 'Specs and wiki pages (same role as Notion)', needs: 'CONFLUENCE_SITE, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN in .env' },
  { id: 'hr', name: 'HR directory', usedFor: 'People, titles, teams, managers and who has left', needs: 'An HR export at fixtures/org/hr.json' },
  { id: 'nemotron', name: 'Nemotron (NVIDIA)', usedFor: 'Reads each program and judges what the documents answer', needs: 'NVIDIA_API_KEY in .env' },
];

async function check(req: IncomingMessage) {
  const env = process.env;
  const session = sessionFor(req);
  const results: Pick<Connector, 'id' | 'connected' | 'detail'>[] = [
    { id: 'github', connected: !!session, detail: session ? `Signed in as ${session.user.login}` : 'Not signed in' },
  ];
  if (env.SLACK_BOT_TOKEN) {
    const r = await ok('https://slack.com/api/auth.test', { headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` } });
    results.push({ id: 'slack', connected: r.ok && r.body.ok === true, detail: r.body.ok ? `Workspace ${String(r.body.team)}` : `Slack said: ${String(r.body.error ?? 'unreachable')}` });
  } else results.push({ id: 'slack', connected: false, detail: 'No token' });
  if (env.JIRA_SITE && env.JIRA_EMAIL && env.JIRA_API_TOKEN) {
    const r = await ok(`${env.JIRA_SITE.replace(/\/$/, '')}/rest/api/3/myself`, { headers: { Authorization: `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')}` } });
    results.push({ id: 'jira', connected: r.ok, detail: r.ok ? `${env.JIRA_SITE.replace(/^https?:\/\//, '')}, project ${env.JIRA_PROJECT ?? 'CARD'}` : 'Key rejected or site unreachable' });
  } else results.push({ id: 'jira', connected: false, detail: 'No site or token' });
  if (env.NOTION_TOKEN) {
    const r = await ok('https://api.notion.com/v1/users/me', { headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' } });
    results.push({ id: 'notion', connected: r.ok, detail: r.ok ? `Connection "${String(r.body.name)}"` : 'Token rejected' });
  } else results.push({ id: 'notion', connected: false, detail: 'No token' });
  results.push({ id: 'confluence', connected: !!(env.CONFLUENCE_SITE && env.CONFLUENCE_API_TOKEN), detail: env.CONFLUENCE_SITE ? 'Keys set (connector not built yet)' : 'Not set up' });
  const hr = existsSync(resolve(REPO_ROOT, 'fixtures/org/hr.json'));
  results.push({ id: 'hr', connected: hr, detail: hr ? 'Workday-style export (Harbor Card)' : 'No export' });
  results.push({ id: 'nemotron', connected: !!env.NVIDIA_API_KEY, detail: env.NVIDIA_API_KEY ? `${env.LLM_MODEL_STRONG ?? 'Nemotron'}` : 'No key' });
  return results;
}

/** Returns true when it handled the request. */
export function connectorRoutes(url: URL, req: IncomingMessage, res: ServerResponse): boolean {
  if (url.pathname !== '/api/connectors') return false;
  void (async () => {
    // GitHub depends on who's asking, so only the other checks are cached.
    if (!cached || Date.now() - cached.at > 60_000 || url.searchParams.get('refresh') === '1') cached = { at: Date.now(), list: DEFS, checks: await check(req) };
    const session = sessionFor(req);
    const checks = cached.checks.map((c) => (c.id === 'github' ? { ...c, connected: !!session, detail: session ? `Signed in as ${session.user.login}` : 'Not signed in' } : c));
    const list: Connector[] = DEFS.map((d) => ({ ...d, ...checks.find((c) => c.id === d.id)! }));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(list));
  })();
  return true;
}
