// Slack: who discussed which program, and the display names people use there.
//   GET conversations.list?types=public_channel
//   GET conversations.history?channel=...&include_all_metadata=true
//   GET conversations.replies?channel=...&ts=...
// Seeded messages are posted under each person's display name, with their email and original date in
// message metadata (Slack can't backdate). A poster with no email (an old alias) stays name-only, so
// identity resolution can't merge it silently. Without a token, fixtures/org/slack.json is read.
import { readFileSync } from 'node:fs';
import type { Http } from '../http';
import type { ScopeIndex } from '../scopes';
import type { Owns, Person, SourceResult } from '../types';
import { linksFrom } from './text';

export const METADATA_EVENT = 'theseus_seed';

interface Message { name: string; email?: string; date: string; text: string; channel: string }
interface SlackMessage { ts: string; text: string; username?: string; reply_count?: number; metadata?: { event_type: string; event_payload: { author_email?: string; original_date?: string } } }

export async function slack(http: Http, index: ScopeIndex, token: string | undefined, fallbackFile: string, person: (id: string) => { name: string; email?: string }): Promise<SourceResult> {
  let messages: Message[];
  let live = false;
  if (token) {
    const headers = { Authorization: `Bearer ${token}` };
    const call = async <T>(method: string, params: Record<string, string>) => {
      const res = await http.json<T & { ok: boolean; error?: string }>(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers });
      if (!res.ok) throw new Error(`Slack ${method}: ${res.error}`);
      return res;
    };
    const { channels: all } = await call<{ channels: { id: string; name: string; is_member: boolean }[] }>('conversations.list', { types: 'public_channel', limit: '200', exclude_archived: 'true' });
    // Only channels the bot was added to; it can't read the others.
    const channels = all.filter((c) => c.is_member);
    messages = [];
    const take = (m: SlackMessage, channel: string) => {
      const meta = m.metadata?.event_type === METADATA_EVENT ? m.metadata.event_payload : undefined;
      if (!meta) return; // only messages Theseus seeded or that carry an author we can trace
      messages.push({ name: m.username ?? '', email: meta.author_email?.toLowerCase(), date: meta.original_date ?? '', text: m.text.replace(/^\[\d{4}-\d{2}-\d{2}\] /, ''), channel });
    };
    for (const ch of channels) {
      const hist = await call<{ messages: SlackMessage[] }>('conversations.history', { channel: ch.id, limit: '200', include_all_metadata: 'true' });
      for (const m of hist.messages) {
        take(m, ch.name);
        if (m.reply_count) {
          const replies = await call<{ messages: SlackMessage[] }>('conversations.replies', { channel: ch.id, ts: m.ts, include_all_metadata: 'true' });
          for (const r of replies.messages.slice(1)) take(r, ch.name);
        }
      }
    }
    live = true;
  } else {
    const data = JSON.parse(readFileSync(fallbackFile, 'utf8')) as { channels: Record<string, { user: string; date: string; text: string }[]> };
    messages = Object.entries(data.channels).flatMap(([channel, list]) => list.map((m) => {
      const p = person(m.user);
      return { name: p.name, email: p.email, date: m.date, text: m.text, channel };
    }));
  }
  const people = new Map<string, Person>();
  const owns: Owns[] = [];
  for (const m of messages) {
    const id = m.email ?? `slack:${m.name}`;
    if (!people.has(id)) people.set(id, { id, emails: m.email ? [m.email] : [], name: m.name, active: true, source: 'slack' });
    owns.push(...linksFrom(index, { personId: id, text: m.text, signal: 'chatParticipant', kind: 'rule', source: 'slack', evidence: `Slack #${m.channel} ${m.date}: "${m.text.slice(0, 80)}"`, observedAt: m.date }));
  }
  return { source: 'slack', live, people: [...people.values()], teams: [], reportsTo: [], owns };
}
