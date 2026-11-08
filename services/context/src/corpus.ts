// Gathers every document the company has in Jira, Notion and Slack, through their REST APIs (the same
// cached client as Phase 3, so REST_MODE=replay works offline). Each document keeps a link back to it.
//   Jira:   GET  {site}/rest/api/3/search/jql?jql=project=CARD&fields=summary,description,comment,status
//   Notion: POST /v1/search, POST /v1/databases/{id}/query, GET /v1/blocks/{page}/children
//   Slack:  GET  auth.test, conversations.list, conversations.history, conversations.replies
import type { Http } from '../../people/src/http';
import { mentions, type ScopeIndex } from '../../people/src/scopes';
import { adfText } from '../../people/src/sources/jira';
import { NOTION_VERSION, WIKI_TITLE } from '../../people/src/sources/notion';
import { METADATA_EVENT } from '../../people/src/sources/slack';
import type { Doc } from './types';

/** Splits text into sentences and lines, dropping empties. */
export function sentences(text: string): string[] {
  return text.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/).map((s) => s.trim()).filter((s) => s.length > 1);
}

const field = (text: string, name: string) => new RegExp(`${name}:\\s*(.+)`).exec(text)?.[1]?.trim();

export async function jiraDocs(http: Http, index: ScopeIndex, o: { site: string; email: string; token: string; project: string }): Promise<Doc[]> {
  const base = o.site.replace(/\/$/, '');
  const headers = { Authorization: `Basic ${Buffer.from(`${o.email}:${o.token}`).toString('base64')}` };
  const res = await http.json<{ issues: { key: string; fields: { summary: string; description: unknown; created: string; comment?: { comments: { body: unknown }[] } } }[] }>(
    `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(`project=${o.project} ORDER BY key`)}&fields=summary,description,created,comment&maxResults=100`, { headers });
  return res.issues.map((i) => {
    const body = adfText(i.fields.description);
    const comments = (i.fields.comment?.comments ?? []).map((c) => adfText(c.body));
    const key = field(body, 'Original key') ?? i.key;
    const text = [i.fields.summary, ...body.split('\n').filter((l) => !/^Original (key|reporter|assignee|created):/.test(l.trim())), ...comments].join('\n');
    return {
      id: `jira:${key}`, source: 'jira', url: `${base}/browse/${i.key}`, title: `${key} ${i.fields.summary}`,
      sentences: sentences(text), author: field(body, 'Original reporter') ?? '', date: field(body, 'Original created') ?? i.fields.created.slice(0, 10),
      programs: mentions(index, text),
    } satisfies Doc;
  });
}

type RichText = { plain_text: string }[];

export async function notionDocs(http: Http, index: ScopeIndex, token: string): Promise<Doc[]> {
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION };
  const found = await http.json<{ results: { id: string; title?: RichText }[] }>('https://api.notion.com/v1/search', { method: 'POST', headers, body: { query: WIKI_TITLE, filter: { value: 'database', property: 'object' } } });
  const db = found.results.find((r) => r.title?.map((t) => t.plain_text).join('') === WIKI_TITLE);
  if (!db) throw new Error(`Notion database "${WIKI_TITLE}" not found`);
  const rows = await http.json<{ results: { id: string; url: string; properties: Record<string, { title?: RichText; email?: string | null; date?: { start: string } | null; multi_select?: { name: string }[] }> }[] }>(
    `https://api.notion.com/v1/databases/${db.id}/query`, { method: 'POST', headers, body: { page_size: 100 } });
  const docs: Doc[] = [];
  for (const p of rows.results) {
    const blocks = await http.json<{ results: { type: string; [k: string]: unknown }[] }>(`https://api.notion.com/v1/blocks/${p.id}/children?page_size=100`, { headers });
    const body = blocks.results.map((b) => ((b[b.type] as { rich_text?: RichText })?.rich_text ?? []).map((t) => t.plain_text).join('')).filter(Boolean);
    const title = (p.properties.Name?.title ?? []).map((t) => t.plain_text).join('');
    const tags = (p.properties.Tags?.multi_select ?? []).map((t) => t.name).join(' ');
    docs.push({
      id: `notion:${p.id}`, source: 'notion', url: p.url, title, sentences: [title, ...body.flatMap(sentences)],
      author: p.properties.Owner?.email ?? '', date: p.properties['Last edited']?.date?.start ?? '', programs: mentions(index, `${title} ${tags} ${body.join(' ')}`),
    });
  }
  return docs;
}

interface SlackMsg { ts: string; text: string; username?: string; reply_count?: number; metadata?: { event_type: string; event_payload: { author_email?: string; original_date?: string } } }

/** One document per Slack thread (or lone message), in the speakers' words, dated as originally posted. */
export async function slackDocs(http: Http, index: ScopeIndex, token: string): Promise<Doc[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const call = async <T>(method: string, params: Record<string, string>) => {
    const r = await http.json<T & { ok: boolean; error?: string }>(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers });
    if (!r.ok) throw new Error(`Slack ${method}: ${r.error}`);
    return r;
  };
  const { url: workspace } = await call<{ url: string }>('auth.test', {});
  const { channels } = await call<{ channels: { id: string; name: string; is_member: boolean }[] }>('conversations.list', { types: 'public_channel', limit: '200', exclude_archived: 'true' });
  const line = (m: SlackMsg) => `${m.username ?? 'someone'}: ${m.text.replace(/^\[\d{4}-\d{2}-\d{2}\] /, '')}`;
  const docs: Doc[] = [];
  for (const ch of channels.filter((c) => c.is_member)) {
    const { messages } = await call<{ messages: SlackMsg[] }>('conversations.history', { channel: ch.id, limit: '1000', include_all_metadata: 'true' });
    for (const m of messages) {
      if (m.metadata?.event_type !== METADATA_EVENT) continue;
      const thread = m.reply_count ? (await call<{ messages: SlackMsg[] }>('conversations.replies', { channel: ch.id, ts: m.ts, include_all_metadata: 'true' })).messages : [m];
      const text = thread.map(line);
      docs.push({
        id: `slack:${ch.name}:${m.ts}`, source: 'slack', url: `${workspace}archives/${ch.id}/p${m.ts.replace('.', '')}`,
        title: `#${ch.name} ${m.metadata.event_payload.original_date ?? ''}: ${text[0].slice(0, 60)}`, sentences: text,
        author: m.metadata.event_payload.author_email ?? m.username ?? '', date: m.metadata.event_payload.original_date ?? '', programs: mentions(index, text.join(' ')),
      });
    }
  }
  return docs;
}
