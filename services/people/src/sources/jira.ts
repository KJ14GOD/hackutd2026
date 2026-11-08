// Jira: ticket reporters and assignees for tickets that mention a program.
//   GET {site}/rest/api/3/search/jql?jql=project=CARD&fields=summary,description,reporter,assignee,created,comment
// Seeded tickets carry the synthetic reporter and date in a footer ("Original reporter: x@y"), because a
// real Jira only lets tickets be reported by real accounts. Without credentials, fixtures/org/jira.json is read.
import { readFileSync } from 'node:fs';
import type { Http } from '../http';
import type { ScopeIndex } from '../scopes';
import type { Owns, SourceResult } from '../types';
import { linksFrom } from './text';

interface Ticket { key: string; created: string; reporter: string; assignee: string | null; summary: string; text: string }

export interface JiraOptions { site: string; email: string; token: string; project: string }

/** Plain text from Atlassian Document Format. */
export function adfText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { text?: string; content?: unknown[] };
  return (n.text ?? '') + (n.content ?? []).map(adfText).join(n.content && (node as { type?: string }).type === 'doc' ? '\n' : ' ');
}

const field = (text: string, name: string) => new RegExp(`${name}:\\s*(\\S+)`).exec(text)?.[1];

export async function jira(http: Http, index: ScopeIndex, opts: JiraOptions | undefined, fallbackFile: string, emailOf: (id: string) => string): Promise<SourceResult> {
  let tickets: Ticket[];
  let live = false;
  if (opts) {
    const auth = `Basic ${Buffer.from(`${opts.email}:${opts.token}`).toString('base64')}`;
    const res = await http.json<{ issues: { key: string; fields: { summary: string; description: unknown; created: string; comment?: { comments: { body: unknown }[] } } }[] }>(
      `${opts.site.replace(/\/$/, '')}/rest/api/3/search/jql?jql=${encodeURIComponent(`project=${opts.project} ORDER BY key`)}&fields=summary,description,created,comment&maxResults=100`,
      { headers: { Authorization: auth } });
    tickets = res.issues.map((i) => {
      const body = adfText(i.fields.description);
      const comments = (i.fields.comment?.comments ?? []).map((c) => adfText(c.body)).join('\n');
      return {
        key: field(body, 'Original key') ?? i.key, summary: i.fields.summary, text: `${i.fields.summary}\n${body}\n${comments}`,
        reporter: field(body, 'Original reporter') ?? '', assignee: field(body, 'Original assignee') ?? null,
        created: field(body, 'Original created') ?? i.fields.created.slice(0, 10),
      };
    });
    live = true;
  } else {
    const data = JSON.parse(readFileSync(fallbackFile, 'utf8')) as { issues: { key: string; created: string; reporter: string; assignee: string | null; summary: string; description: string; comments: { body: string }[] }[] };
    tickets = data.issues.map((i) => ({
      key: i.key, created: i.created, reporter: emailOf(i.reporter), assignee: i.assignee ? emailOf(i.assignee) : null, summary: i.summary,
      text: `${i.summary}\n${i.description}\n${i.comments.map((c) => c.body).join('\n')}`,
    }));
  }
  const owns: Owns[] = [];
  for (const t of tickets) {
    const evidence = `Jira ${t.key} ${t.summary}`;
    if (t.reporter) owns.push(...linksFrom(index, { personId: t.reporter, text: t.text, signal: 'ticketReporter', kind: 'rule', source: 'jira', evidence, observedAt: t.created }));
    if (t.assignee) owns.push(...linksFrom(index, { personId: t.assignee, text: t.text, signal: 'ticketAssignee', kind: 'code', source: 'jira', evidence, observedAt: t.created }));
  }
  return { source: 'jira', live, people: [], teams: [], reportsTo: [], owns };
}
