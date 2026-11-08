// Notion: owners of policy, runbook and spec pages that mention a program.
//   POST /v1/search            (finds the "Harbor Card wiki" database)
//   POST /v1/databases/{id}/query
//   GET  /v1/blocks/{page}/children
// The seeded database has an Owner (email) property, since pages created through the API are "created by"
// the integration. Without a token, fixtures/org/notion.json is read.
import { readFileSync } from 'node:fs';
import type { Http } from '../http';
import type { ScopeIndex } from '../scopes';
import type { Owns, SourceResult } from '../types';
import { linksFrom } from './text';

export const NOTION_VERSION = '2022-06-28';
export const WIKI_TITLE = 'Harbor Card wiki';

interface Page { title: string; owner: string; edited: string; text: string }

type RichText = { plain_text: string }[];
interface NotionPage { id: string; properties: Record<string, { title?: RichText; rich_text?: RichText; email?: string | null; date?: { start: string } | null; multi_select?: { name: string }[] }> }

/** Policy and controls pages make their owner a rule authority; other pages make them a spec author. */
export const isPolicy = (title: string) => /\b(policy|controls?)\b/i.test(title);

export async function notion(http: Http, index: ScopeIndex, token: string | undefined, fallbackFile: string, emailOf: (id: string) => string): Promise<SourceResult> {
  let pages: Page[];
  let live = false;
  if (token) {
    const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION };
    const found = await http.json<{ results: { id: string; title?: RichText }[] }>('https://api.notion.com/v1/search', { method: 'POST', headers, body: { query: WIKI_TITLE, filter: { value: 'database', property: 'object' } } });
    const db = found.results.find((r) => r.title?.map((t) => t.plain_text).join('') === WIKI_TITLE);
    if (!db) throw new Error(`Notion database "${WIKI_TITLE}" not found; run the seeder or share it with the integration`);
    const rows = await http.json<{ results: NotionPage[] }>(`https://api.notion.com/v1/databases/${db.id}/query`, { method: 'POST', headers, body: { page_size: 100 } });
    pages = [];
    for (const p of rows.results) {
      const blocks = await http.json<{ results: { type: string; [k: string]: unknown }[] }>(`https://api.notion.com/v1/blocks/${p.id}/children?page_size=100`, { headers });
      const body = blocks.results.map((b) => ((b[b.type] as { rich_text?: RichText })?.rich_text ?? []).map((t) => t.plain_text).join('')).join('\n');
      const tags = (p.properties.Tags?.multi_select ?? []).map((t) => t.name).join(' ');
      pages.push({
        title: (p.properties.Name?.title ?? []).map((t) => t.plain_text).join(''),
        owner: (p.properties.Owner?.email ?? '').toLowerCase(),
        edited: p.properties['Last edited']?.date?.start ?? '',
        text: `${tags}\n${body}`,
      });
    }
    live = true;
  } else {
    const data = JSON.parse(readFileSync(fallbackFile, 'utf8')) as { pages: { title: string; owner: string; lastEdited: string; tags: string[]; body: string[] }[] };
    pages = data.pages.map((p) => ({ title: p.title, owner: emailOf(p.owner), edited: p.lastEdited, text: `${p.tags.join(' ')}\n${p.body.join('\n')}` }));
  }
  const owns: Owns[] = [];
  for (const p of pages) {
    if (!p.owner) continue;
    const policy = isPolicy(p.title);
    owns.push(...linksFrom(index, {
      personId: p.owner, text: `${p.title}\n${p.text}`, signal: policy ? 'policyOwner' : 'specAuthor', kind: policy ? 'policy' : 'rule',
      source: 'notion', evidence: `Notion "${p.title}" (owner, edited ${p.edited})`, observedAt: p.edited,
    }));
  }
  return { source: 'notion', live, people: [], teams: [], reportsTo: [], owns };
}
