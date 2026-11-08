import { describe, expect, it } from 'vitest';
import { parseSegmentation } from './segmentation';

const valid = () => ({
  version: 2,
  source: { root: 'legacy/carddemo', ref: 'abc', deps: 'out/deps.json', depsHash: 'd' },
  configHash: 'h',
  nodes: [{ id: 'prog:A', kind: 'program', name: 'A', path: 'a.cbl', loc: 10, pocketId: 'pkt-a', domainId: 'dom-a', meta: {} }],
  edges: [{ src: 'prog:A', dst: 'data:F', kind: 'read', count: 1, confidence: 'extracted', detail: '', evidence: 'a.cbl:5' }],
  pockets: [
    { id: 'dom-a', parentId: '', level: 'domain', kind: 'code', name: 'A', anchor: 'prog:A', members: ['pkt-a'], programs: 1, loc: 10, cohesion: 0, coupling: 0, isolation: 1, oversized: false },
    { id: 'pkt-a', parentId: 'dom-a', level: 'pocket', kind: 'code', name: 'A', anchor: 'prog:A', members: ['prog:A'], programs: 1, loc: 10, cohesion: 0, coupling: 0, isolation: 1, oversized: false },
  ],
  pocketEdges: [],
  endpoints: [{ id: 'CICS AAAA', kind: 'cics', name: 'AAAA', description: '', entryNode: 'prog:A', pocketId: 'pkt-a', servedBy: ['pkt-a'] }],
  metrics: { modularity: 0 },
  warnings: [],
  unresolved: [{ program: 'A', what: 'CICS XCTL PROGRAM', token: 'WS-PGM', at: 'a.cbl:9' }],
});

describe('parseSegmentation', () => {
  it('maps a segmentation result to rows', () => {
    const rows = parseSegmentation(JSON.stringify(valid()));
    expect(rows.run).toMatchObject({ sourceRoot: 'legacy/carddemo', sourceRef: 'abc', depsPath: 'out/deps.json', depsHash: 'd', configHash: 'h' });
    expect(JSON.parse(rows.run.unresolvedJson)).toHaveLength(1);
    expect(rows.edges[0].evidence).toBe('a.cbl:5');
    expect(rows.pockets.map((p) => p.id)).toEqual(['dom-a', 'pkt-a']);
    expect(rows.pockets[0]).not.toHaveProperty('members');
    expect(rows.endpoints[0].servedByJson).toBe('["pkt-a"]');
  });

  it('rejects bad input', () => {
    expect(() => parseSegmentation('{')).toThrow('invalid JSON');
    expect(() => parseSegmentation(JSON.stringify({ ...valid(), version: 1 }))).toThrow('version');
    const badLoc = valid();
    badLoc.nodes[0].loc = -1;
    expect(() => parseSegmentation(JSON.stringify(badLoc))).toThrow('nodes[0].loc');
    const dangling = valid();
    dangling.endpoints[0].pocketId = 'pkt-missing';
    expect(() => parseSegmentation(JSON.stringify(dangling))).toThrow('unknown pocket');
  });
});
