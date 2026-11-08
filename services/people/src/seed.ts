// Seeds the synthetic Harbor Card org (fixtures/org) into the real tools, so the connectors read it back
// through their APIs. Safe to rerun: each seeder skips what already exists.
//   npx tsx services/people/src/seed.ts slack|jira|notion|all
//   npx tsx services/people/src/seed.ts slack-reset   (deletes only messages the seeder posted)
// GitHub is seeded separately by fixtures/org/seed-github.mjs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { METADATA_EVENT } from './sources/slack';
import { NOTION_VERSION, WIKI_TITLE } from './sources/notion';

const ROOT = resolve(import.meta.dirname, '../../..');
try { process.loadEnvFile(resolve(ROOT, '.env')); } catch { /* environment only */ }
const org = (f: string) => JSON.parse(readFileSync(resolve(ROOT, 'fixtures/org', f), 'utf8'));
const hr = org('hr.json') as { workers: { workerId: string; firstName: string; lastName: string; workEmail: string }[] };
const person = (id: string) => {
  const w = hr.workers.find((x) => x.workerId === id);
  return w ? { name: `${w.firstName} ${w.lastName}`, email: w.workEmail } : { name: id, email: undefined };
};

async function call<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await fetch(url, { ...init, body: init.json === undefined ? init.body : JSON.stringify(init.json), headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url.replace(/\?.*/, '')}: ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function seedSlack() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not set');
  const api = async <T>(method: string, body: Record<string, unknown>) => {
    const r = await call<T & { ok: boolean; error?: string }>(`https://slack.com/api/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, json: body });
    if (!r.ok) throw new Error(`Slack ${method}: ${r.error}${r.error === 'missing_scope' ? ' (add the scopes listed in fixtures/org/README.md and reinstall)' : ''}`);
    return r;
  };
  const data = org('slack.json') as { channels: Record<string, { user: string; date: string; text: string; thread?: number }[]> };
  const { channels } = await api<{ channels: { id: string; name: string }[] }>('conversations.list', { types: 'public_channel', limit: 200 });
  // Channels go in parallel; within a channel, about one post a second (Slack's posting limit).
  await Promise.all(Object.entries(data.channels).map(async ([name, messages]) => {
    let id = channels.find((c) => c.name === name)?.id;
    if (!id) id = (await api<{ channel: { id: string } }>('conversations.create', { name })).channel.id;
    await api('conversations.join', { channel: id });
    const history = await api<{ messages: { metadata?: { event_type: string } }[] }>('conversations.history', { channel: id, limit: 200, include_all_metadata: true });
    if (history.messages.some((m) => m.metadata?.event_type === METADATA_EVENT)) { console.log(`#${name}: already seeded`); return; }
    const posted: string[] = [];
    for (const m of messages) {
      const p = person(m.user);
      // Slack can't backdate, so the original date leads the text and is kept in metadata for the connector.
      const r = await api<{ ts: string }>('chat.postMessage', {
        channel: id, text: `[${m.date}] ${m.text}`, username: p.name, icon_emoji: ':bust_in_silhouette:',
        ...(m.thread !== undefined ? { thread_ts: posted[m.thread] } : {}),
        metadata: { event_type: METADATA_EVENT, event_payload: { ...(p.email ? { author_email: p.email } : {}), original_date: m.date } },
      });
      posted[messages.indexOf(m)] = r.ts;
      await new Promise((ok) => setTimeout(ok, 1100));
    }
    console.log(`#${name}: posted ${messages.length} messages`);
  }));
}

async function resetSlack() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN is not set');
  const api = async <T>(method: string, body: Record<string, unknown>) =>
    call<T & { ok: boolean; error?: string }>(`https://slack.com/api/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, json: body });
  type Msg = { ts: string; reply_count?: number; metadata?: { event_type: string } };
  const { channels } = await api<{ channels: { id: string; name: string; is_member: boolean }[] }>('conversations.list', { types: 'public_channel', limit: 200 });
  let deleted = 0;
  for (const ch of channels.filter((c) => c.is_member)) {
    const { messages } = await api<{ messages: Msg[] }>('conversations.history', { channel: ch.id, limit: 1000, include_all_metadata: true });
    for (const m of messages) {
      const thread = m.reply_count ? (await api<{ messages: Msg[] }>('conversations.replies', { channel: ch.id, ts: m.ts, include_all_metadata: true })).messages.slice(1) : [];
      for (const x of [...thread, m]) if (x.metadata?.event_type === METADATA_EVENT) { await api('chat.delete', { channel: ch.id, ts: x.ts }); deleted++; }
    }
  }
  console.log(`slack: deleted ${deleted} seeded messages`);
}

async function seedJira() {
  const { JIRA_SITE: site, JIRA_EMAIL: email, JIRA_API_TOKEN: token } = process.env;
  if (!site || !email || !token) throw new Error('JIRA_SITE, JIRA_EMAIL and JIRA_API_TOKEN must be set');
  const base = site.replace(/\/$/, '');
  const headers = { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` };
  const data = org('jira.json') as { project: { key: string; name: string }; issues: { key: string; created: string; reporter: string; assignee: string | null; status: string; component: string; summary: string; description: string; comments: { author: string; date: string; body: string }[] }[] };
  const key = process.env.JIRA_PROJECT ?? data.project.key;
  const projects = await call<{ key: string }[]>(`${base}/rest/api/3/project`, { headers });
  if (!projects.some((p) => p.key === key)) {
    const me = await call<{ accountId: string }>(`${base}/rest/api/3/myself`, { headers });
    await call(`${base}/rest/api/3/project`, { method: 'POST', headers, json: { key, name: data.project.name, projectTypeKey: 'software', projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic', leadAccountId: me.accountId } });
    console.log(`created Jira project ${key}`);
  }
  const doc = (paragraphs: string[]) => ({ type: 'doc', version: 1, content: paragraphs.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });
  const existing = await call<{ issues: { fields: { description: unknown } }[] }>(`${base}/rest/api/3/search/jql?jql=${encodeURIComponent(`project=${key}`)}&fields=description&maxResults=100`, { headers });
  const seeded = new Set(existing.issues.map((i) => /Original key: (\S+)/.exec(JSON.stringify(i.fields.description))?.[1]).filter(Boolean));
  for (const t of data.issues) {
    if (seeded.has(t.key)) { console.log(`${t.key}: already seeded`); continue; }
    const footer = [`Original key: ${t.key}`, `Original reporter: ${person(t.reporter).email}`, ...(t.assignee ? [`Original assignee: ${person(t.assignee).email}`] : []), `Original created: ${t.created}`, `Component: ${t.component}`, `Status: ${t.status}`];
    const made = await call<{ key: string }>(`${base}/rest/api/3/issue`, { method: 'POST', headers, json: { fields: { project: { key }, issuetype: { name: 'Task' }, summary: t.summary, description: doc([t.description, '', ...footer]) } } });
    for (const c of t.comments) await call(`${base}/rest/api/3/issue/${made.key}/comment`, { method: 'POST', headers, json: { body: doc([`${person(c.author).name} (${c.date}): ${c.body}`]) } });
    console.log(`${t.key}: created as ${made.key}`);
  }
}

async function seedNotion() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN is not set');
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION };
  const search = async (object: 'page' | 'database') => (await call<{ results: { id: string; object: string; title?: { plain_text: string }[]; properties?: { title?: { title: { plain_text: string }[] } } }[] }>(
    'https://api.notion.com/v1/search', { method: 'POST', headers, json: { query: WIKI_TITLE, filter: { value: object, property: 'object' } } })).results;
  const titleOf = (r: { title?: { plain_text: string }[]; properties?: { title?: { title: { plain_text: string }[] } } }) =>
    (r.title ?? r.properties?.title?.title ?? []).map((t) => t.plain_text).join('');
  let db = (await search('database')).find((r) => titleOf(r) === WIKI_TITLE);
  if (!db) {
    const parent = (await search('page')).find((r) => titleOf(r) === WIKI_TITLE);
    if (!parent) throw new Error(`share a Notion page titled "${WIKI_TITLE}" with the integration first`);
    db = await call<{ id: string; object: string }>('https://api.notion.com/v1/databases', { method: 'POST', headers, json: {
      parent: { type: 'page_id', page_id: parent.id }, title: [{ type: 'text', text: { content: WIKI_TITLE } }],
      properties: { Name: { title: {} }, Owner: { email: {} }, 'Last edited': { date: {} }, Tags: { multi_select: {} } },
    } });
    console.log('created the wiki database');
  }
  const rows = await call<{ results: { properties: { Name: { title: { plain_text: string }[] } } }[] }>(`https://api.notion.com/v1/databases/${db.id}/query`, { method: 'POST', headers, json: { page_size: 100 } });
  const have = new Set(rows.results.map((r) => r.properties.Name.title.map((t) => t.plain_text).join('')));
  const data = org('notion.json') as { pages: { title: string; owner: string; lastEdited: string; tags: string[]; body: string[] }[] };
  for (const p of data.pages) {
    if (have.has(p.title)) { console.log(`"${p.title}": already seeded`); continue; }
    await call('https://api.notion.com/v1/pages', { method: 'POST', headers, json: {
      parent: { database_id: db.id },
      properties: { Name: { title: [{ text: { content: p.title } }] }, Owner: { email: person(p.owner).email }, 'Last edited': { date: { start: p.lastEdited } }, Tags: { multi_select: p.tags.map((name) => ({ name })) } },
      children: p.body.map((t) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: t } }] } })),
    } });
    console.log(`"${p.title}": created`);
  }
}

const which = process.argv[2] ?? 'all';
for (const [name, run] of [['slack-reset', resetSlack], ['slack', seedSlack], ['jira', seedJira], ['notion', seedNotion]] as const) {
  if (which === 'all' ? name === 'slack-reset' : which !== name) continue;
  try { await run(); } catch (err) { console.error(`${name}: ${err instanceof Error ? err.message : err}`); process.exitCode = 1; }
}
