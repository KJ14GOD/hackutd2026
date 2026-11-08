// Phase 5 pieces that need no Slack or SpacetimeDB: the digest layout and the question rows the loader sends.
import { expect, it } from 'vitest';
import { digestBlocks, markAnswered } from './digest';
import { questionRows } from './load';
import type { Part2 } from '../../reader/src/contract';
import type { ContextRun } from '../../context/src/types';

const q = { id: 'CBACT04C-Q1', program: 'CBACT04C', text: 'Is the empty fee paragraph intentional?', options: ['Keep it', 'Implement fees'], evidence: ['app/cbl/CBACT04C.cbl:518'], why: 'policy owner', quotes: [{ title: 'Fees policy', url: 'https://notion/x' }] };

it('puts every question for one person in one message, each with its own buttons', () => {
  const blocks = digestBlocks({ name: 'Maria Lopez', title: 'Manager' }, 'CBACT04C', [q, { ...q, id: 'CBACT04C-Q2' }], 'maria@x') as { type: string; block_id?: string; elements?: { value: string }[] }[];
  const actions = blocks.filter((b) => b.type === 'actions');
  expect(actions.map((a) => a.block_id)).toEqual(['q:CBACT04C-Q1', 'q:CBACT04C-Q2']);
  expect(JSON.parse(actions[0].elements![1].value)).toEqual({ q: 'CBACT04C-Q1', o: 'Implement fees', p: 'maria@x' });
});

it('replaces only the answered question\'s buttons', () => {
  const blocks = digestBlocks({ name: 'Maria', title: '' }, 'CBACT04C', [q, { ...q, id: 'CBACT04C-Q2' }], 'maria@x') as { type: string; block_id?: string }[];
  const after = markAnswered(blocks, 'CBACT04C-Q1', 'Keep it', 'Maria') as { type: string; block_id?: string }[];
  expect(after.filter((b) => b.type === 'actions').map((b) => b.block_id)).toEqual(['q:CBACT04C-Q2']);
});

it('joins Part 2 questions with their Phase 4 resolution for loading', () => {
  const part2 = { results: [{ program: 'CBACT04C', questions: [{ id: 'CBACT04C-Q1', program: 'CBACT04C', text: 't', evidence: ['a:1'], options: ['x', 'y'], blocks: 'rewrite' }] }] } as unknown as Part2;
  const ctx = { resolutions: [{ questionId: 'CBACT04C-Q1', program: 'CBACT04C', question: 't', verdict: 'not-found', answer: '', quotes: [], confidence: 'high', route: { to: 'dev@x', name: 'Dev', category: 'behavior', why: 'owner' }, searched: [] }] } as unknown as ContextRun;
  expect(questionRows(part2, ctx)[0]).toMatchObject({ id: 'CBACT04C-Q1', options: ['x', 'y'], blocks: 'rewrite', route: { to: 'dev@x' } });
});
