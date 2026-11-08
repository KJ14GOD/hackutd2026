// Phase 4 without the network: search ranking, quote checking, the open-ticket check, and routing.
import { expect, it } from 'vitest';
import { createProvider } from '../../../packages/llm/src/index';
import type { Org } from '../../people/src/types';
import { judge } from './judge';
import { route } from './route';
import { search } from './search';
import type { Doc } from './types';

const doc = (id: string, source: Doc['source'], title: string, sentences: string[], programs: string[] = []): Doc =>
  ({ id, source, url: `https://example/${id}`, title, sentences, author: 'x', date: '2024-01-01', programs });

const docs = [
  doc('notion:runbook', 'notion', 'Disclosure group runbook', ['The DEFAULT row must always exist.', 'If DEFAULT is missing, INTCALC abends. That is intended.'], ['prog:CBACT04C']),
  doc('jira:CARD-41', 'jira', 'CARD-41 Implement fee computation in INTCALC', ['The 1400-COMPUTE-FEES paragraph is an empty stub.', 'Status: Open'], ['prog:CBACT04C']),
  doc('notion:fees', 'notion', 'Fees policy', ['Late fees are assessed by the Billing platform, not by the mainframe interest job.'], ['prog:CBACT04C']),
  doc('slack:random:1', 'slack', '#random lunch', ['pizza on friday'], []),
];

it('ranks documents about the same program that share the question words first, and skips unrelated chatter', () => {
  const hits = search(docs, { program: 'CBACT04C', text: 'Does the DEFAULT disclosure group always exist?' });
  expect(hits[0].doc.id).toBe('notion:runbook');
  expect(hits.some((h) => h.doc.id === 'slack:random:1')).toBe(false);
});

const reply = (json: object) => createProvider({ cacheDir: '/nonexistent', env: { LLM_PROVIDER: 'mock' }, mock: () => JSON.stringify(json) });

it('keeps quotes that exist and downgrades a verdict whose quotes do not', async () => {
  const hits = search(docs, { program: 'CBACT04C', text: 'Does the DEFAULT disclosure group always exist?' });
  const good = await judge(reply({ verdict: 'answered', answer: 'yes', quotes: ['D1.1'], confidence: 'high' }), { id: 'Q', program: 'CBACT04C', text: 'x' }, [], hits);
  expect(good.verdict).toBe('answered');
  expect(good.quotes[0].text).toBe('The DEFAULT row must always exist.');
  const made_up = await judge(reply({ verdict: 'answered', answer: 'yes', quotes: ['D9.9'], confidence: 'high' }), { id: 'Q', program: 'CBACT04C', text: 'x' }, [], hits);
  expect(made_up.verdict).toBe('not-found');
  expect(made_up.note).toMatch(/no valid quote/);
});

it('flags an answer that skips an open ticket on the same program', async () => {
  const hits = search(docs, { program: 'CBACT04C', text: 'Is the empty 1400-COMPUTE-FEES paragraph intentional?' });
  const fees = hits.findIndex((h) => h.doc.id === 'notion:fees') + 1;
  const j = await judge(reply({ verdict: 'answered', answer: 'Billing does fees', quotes: [`D${fees}.1`], confidence: 'high' }), { id: 'Q', program: 'CBACT04C', text: 'x' }, [], hits);
  expect(j.openTicket).toBe('CARD-41');
});

const org = {
  people: [{ id: 'maria', name: 'Maria Lopez' }, { id: 'dev', name: 'Dev Okafor' }],
  approvers: [
    { personId: 'maria', name: 'Maria Lopez', target: 'prog:CBACT04C', category: 'business-rule', score: 2.4, evidence: ['policy owner'] },
    { personId: 'dev', name: 'Dev Okafor', target: 'prog:CBACT04C', category: 'behavior', score: 1.6, evidence: ['code owner'] },
  ],
  successors: [],
  scores: [{ personId: 'tom', target: 'prog:COSGN00C', category: 'behavior', score: 0.6, evidence: ['commits'] }],
  owns: [{ personId: 'team:card-online', target: 'prog:COMEN01C', signal: 'teamCodeOwner' }],
  reportsTo: [{ personId: 'tom', managerId: 'maria' }],
} as unknown as Org;
org.people.push({ id: 'tom', name: 'Tom Becker', active: true, source: 'hr' } as never, { id: 'alex', name: 'Alex Chen', active: true, source: 'hr', team: 'theseus' } as never);
const judged = (verdict: 'answered' | 'conflict' | 'known-issue' | 'not-found', extra: object = {}) =>
  ({ verdict, answer: '', quotes: [{ docId: 'd', source: 'notion' as const, url: '', title: '', text: '', date: '' }], confidence: 'high' as const, model: 'm', ...extra });

it('routes conflicts and policy questions to the rule owner, the rest to the code owner, and leaves settled answers alone', () => {
  expect(route(org, 'CBACT04C', 'anything', judged('conflict'))?.name).toBe('Maria Lopez');
  expect(route(org, 'CBACT04C', 'Should the counter wrap at 999999?', judged('not-found'))?.name).toBe('Dev Okafor');
  expect(route(org, 'CBACT04C', 'Is the fee rule intended?', judged('not-found'))?.name).toBe('Maria Lopez');
  expect(route(org, 'CBACT04C', 'x', judged('answered'))).toBeUndefined();
  expect(route(org, 'CBACT04C', 'x', judged('answered', { openTicket: 'CARD-41' }))?.name).toBe('Maria Lopez');
  expect(route(org, 'CBACT04C', 'x', judged('known-issue'))?.name).toBe('Dev Okafor');
});

it('sends programs with no approver to whoever has the most authority, else to the modernization lead', () => {
  expect(route(org, 'COSGN00C', 'x', judged('not-found'))?.name).toBe('Tom Becker');
  expect(route(org, 'NOSUCHPG', 'x', judged('not-found'))?.name).toBe('Alex Chen');
});

it('sends technical questions about team-owned code to an engineer on the team, not its manager', () => {
  (org.people.find((p) => p.id === 'tom') as { team?: string }).team = 'card-online';
  expect(route(org, 'COMEN01C', 'Why does the menu loop twice?', judged('not-found'))?.name).toBe('Tom Becker');
});

it('does not let evidence about another program settle a question', async () => {
  const other = [doc('jira:CARD-102', 'jira', 'CARD-102 duplicate DALYTRAN crashed POSTTRAN', ['Keeping the abend on purpose.'], ['prog:CBTRN02C'])];
  const hits = [{ doc: other[0], score: 5, why: 'shares abend' }];
  const j = await judge(reply({ verdict: 'answered', answer: 'abend is intended', quotes: ['D1.1'], confidence: 'high' }), { id: 'Q', program: 'CBACT03C', text: 'x' }, [], hits);
  expect(j.confidence).toBe('low');
  expect(j.note).toMatch(/about other programs/);
});
