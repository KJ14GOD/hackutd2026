// Tests for the pure graph math: projection, clustering, assignment, co-change, the pipeline.
// Ids, kinds and rels follow docs/GRAPH_SCHEMA.md.
import { describe, expect, it } from 'vitest';
import { SHARED_POCKET, assignNodes, dominant } from './assign';
import { clusterPrograms, components, louvainGroups, modularity, weightedGraph } from './cluster';
import { cochangeEdges } from './cochange';
import type { BuiltGraph } from './deps';
import { countFactor, pairKey, project, type SegConfig } from './project';
import { segment } from './segment';
import type { Confidence, GraphEdge, GraphNode } from './segmentTypes';

const cfg: SegConfig = {
  seed: 7,
  resolution: { pocket: 1, domain: 1 },
  splitResolutionFactor: 1.5,
  edgeWeights: { calls: 1, links: 1, transfers: 0.5, cochange: 0.5 },
  resourceWeights: { dataset: 6, copybook: 0.5, job: 2, screen: 1 },
  accessFactor: { writeWrite: 1, readWrite: 0.6, readRead: 0.3 },
  confidence: { extracted: 1, observed: 1, inferred: 0.4, unknown: 0 },
  hubDampening: true,
  omnipresentThreshold: 0.6,
  hubThreshold: 0.6,
  maxPocketLoc: 10_000,
  maxSplitDepth: 3,
  resourceOwnershipMin: 0.6,
  cochange: { maxFilesPerCommit: 10, minCount: 2 },
};

const PREFIX: Record<string, string> = { program: 'prog', copybook: 'cpy', dataset: 'data', job: 'job', transaction: 'tran', 'system-api': 'sys', utility: 'prog' };
const n = (kind: string, name: string, loc = 100, path = `app/${name}`): GraphNode => ({
  id: `${PREFIX[kind] ?? kind}:${name}`,
  kind,
  name,
  path,
  loc,
  pocketId: '',
  domainId: '',
  meta: {},
});
const e = (src: string, dst: string, kind: string, confidence: Confidence = 'extracted', count = 1): GraphEdge => ({
  src,
  dst,
  kind,
  count,
  confidence,
  detail: '',
  evidence: 'test',
});
const P = (x: string) => `prog:${x}`;
const D = (x: string) => `data:${x}`;

describe('project', () => {
  it('weights calls by confidence and repeat count; unknown targets count for nothing', () => {
    const nodes = [n('program', 'A'), n('program', 'B'), n('program', 'C')];
    const p = project(nodes, [e(P('A'), P('B'), 'calls', 'inferred', 4), e(P('A'), P('C'), 'transfers', 'unknown')], cfg);
    expect(p.pairs.get(pairKey(P('A'), P('B')))!.weight).toBeCloseTo(1 * 0.4 * countFactor(4));
    expect(countFactor(4)).toBe(3);
    expect(p.pairs.has(pairKey(P('A'), P('C')))).toBe(false);
  });

  it('links programs through shared datasets with hub dampening and access factors', () => {
    // E and X touch nothing; they keep F (3 of 6 programs) under the omnipresent cutoff.
    const nodes = ['A', 'B', 'C', 'D', 'E', 'X'].map((x) => n('program', x)).concat([n('dataset', 'F', 0, ''), n('dataset', 'G', 0, '')]);
    const edges = [
      e(P('A'), D('F'), 'write'),
      e(P('B'), D('F'), 'write'),
      e(P('C'), D('F'), 'read'),
      e(P('C'), D('G'), 'read'),
      e(P('D'), D('G'), 'read'),
    ];
    const p = project(nodes, edges, cfg);
    // F has 3 accessors: 6 / (3-1) = 3 per pair, times the access factor.
    expect(p.pairs.get(pairKey(P('A'), P('B')))!.weight).toBeCloseTo(3 * 1.0);
    expect(p.pairs.get(pairKey(P('A'), P('C')))!.weight).toBeCloseTo(3 * 0.6);
    // G has 2 readers: 6 / 1 * 0.3.
    expect(p.pairs.get(pairKey(P('C'), P('D')))!.kinds).toEqual({ dataset: 6 * 0.3 });
  });

  it('ignores omnipresent resources, system copybooks and non-code nodes; finds hubs', () => {
    const progs = ['A', 'B', 'C', 'D', 'MENU'].map((x) => n('program', x));
    const nodes = [...progs, n('copybook', 'COMMON'), n('copybook', 'DFHAID', 0, ''), n('system-api', 'MQPUT', 0, ''), n('utility', 'SORT', 0, '')];
    const edges = [
      ...['A', 'B', 'C', 'D'].map((x) => e(P(x), 'cpy:COMMON', 'copies')),
      e(P('A'), 'cpy:DFHAID', 'copies'),
      e(P('B'), 'cpy:DFHAID', 'copies'),
      e(P('A'), 'sys:MQPUT', 'uses-api'),
      e(P('B'), 'sys:MQPUT', 'uses-api'),
      ...['A', 'B', 'C', 'D'].map((x) => e(P(x), P('MENU'), 'transfers')),
    ];
    const p = project(nodes, edges, cfg);
    expect(p.omnipresent).toEqual(['cpy:COMMON']); // 4 of 5 programs > 0.6
    expect(p.hubs).toEqual([P('MENU')]); // talks to 4 of 4 others
    expect(p.nodes).toEqual([P('A'), P('B'), P('C'), P('D')]); // no MENU, no SORT
    expect(p.pairs.has(pairKey(P('A'), P('B')))).toBe(false); // COMMON, DFHAID and MQPUT don't link them
    expect(p.ignored.size).toBe(0);
  });

  it('links programs run by the same job, and reports rels it does not use', () => {
    const nodes = [n('program', 'A'), n('program', 'B'), n('job', 'J'), n('screen', 'S1', 0)];
    const edges = [e('job:J', P('A'), 'runs'), e('job:J', P('B'), 'runs'), e('job:J', 'job:J2', 'triggers'), e(P('A'), 'tsq:Q', 'write')];
    const p = project([...nodes, n('job', 'J2'), { ...n('tsq', 'Q', 0, ''), id: 'tsq:Q' }], edges, cfg);
    expect(p.pairs.get(pairKey(P('A'), P('B')))!.kinds).toEqual({ job: 2 });
    expect(Object.fromEntries(p.ignored)).toEqual({ triggers: 1, 'write -> tsq': 1 });
  });
});

/** Two 4-cliques joined by one weak edge. */
function twoCliques() {
  const pairs = new Map<string, { weight: number }>();
  const left = ['a1', 'a2', 'a3', 'a4'];
  const right = ['b1', 'b2', 'b3', 'b4'];
  for (const grp of [left, right]) for (const x of grp) for (const y of grp) if (x < y) pairs.set(pairKey(x, y), { weight: 5 });
  pairs.set(pairKey('a1', 'b1'), { weight: 0.5 });
  return { g: weightedGraph([...left, ...right], pairs), left, right };
}

describe('cluster', () => {
  it('finds the two cliques, deterministically', () => {
    const { g, left, right } = twoCliques();
    const groups = louvainGroups(g, g.nodes, 1, 7);
    expect(groups).toEqual([left, right]);
    expect(louvainGroups(g, g.nodes, 1, 7)).toEqual(groups);
  });

  it('splits a group into connected components', () => {
    const g = weightedGraph(['a', 'b', 'c', 'd'], new Map([[pairKey('a', 'b'), { weight: 1 }]]));
    expect(components(g, ['a', 'b', 'c', 'd'])).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('computes Newman modularity', () => {
    const g = weightedGraph(
      ['a', 'b', 'c', 'x', 'y', 'z'],
      new Map(['a|b', 'b|c', 'a|c', 'x|y', 'y|z', 'x|z'].map((k) => [k, { weight: 1 }])),
    );
    expect(modularity(g, [['a', 'b', 'c'], ['x', 'y', 'z']])).toBeCloseTo(0.5);
    expect(modularity(g, [['a', 'b', 'c', 'x', 'y', 'z']])).toBeCloseTo(0);
  });

  it('re-splits pockets over the LOC cap and flags what cannot be split', () => {
    const { g, left, right } = twoCliques();
    const loc = new Map(g.nodes.map((x) => [x, 100]));
    loc.set('solo', 9999);
    // At resolution 0.01 Louvain merges both cliques (800 LOC > 500 cap); 0.04 splits them.
    const opt = { resolution: 0.01, splitResolutionFactor: 4, maxPocketLoc: 500, maxSplitDepth: 3, seed: 7 };
    expect(louvainGroups(g, g.nodes, opt.resolution, opt.seed)).toHaveLength(1);
    expect(clusterPrograms(g, loc, opt).map((c) => c.members)).toEqual([left, right]);
    const solo = weightedGraph(['solo'], new Map());
    expect(clusterPrograms(solo, loc, opt)).toEqual([{ members: ['solo'], oversized: true }]);
  });
});

describe('assign', () => {
  it('gives resources to a clear owner, else to the shared pocket; non-code stays unassigned', () => {
    expect(dominant(new Map([['p1', 3], ['p2', 1]]))).toEqual({ key: 'p1', share: 0.75 });
    const nodes = [
      n('program', 'A'),
      n('program', 'B'),
      n('dataset', 'OWNED'),
      n('dataset', 'SPLIT'),
      n('dataset', 'WORK'),
      n('job', 'J'),
      n('transaction', 'T1'),
      n('system-api', 'CEE3ABD'),
      n('utility', 'SORT'),
    ];
    const edges = [
      e(P('A'), D('OWNED'), 'write'), // A: 2
      e(P('B'), D('OWNED'), 'read'), // B: 1 -> A owns 2/3 >= 0.6
      e(P('A'), D('SPLIT'), 'read'),
      e(P('B'), D('SPLIT'), 'read'), // 50/50 -> shared
      e('job:J', P('B'), 'runs'),
      e('job:J', P('SORT'), 'runs'),
      e('job:J', D('WORK'), 'write'), // only the job touches it -> follows the job
      e('tran:T1', P('A'), 'starts'),
      e(P('A'), 'sys:CEE3ABD', 'uses-api'),
    ];
    const out = assignNodes(nodes, edges, new Map([[P('A'), 'pkt-a'], [P('B'), 'pkt-b']]), {
      ownershipMin: 0.6,
      resourceKinds: new Set(Object.keys(cfg.resourceWeights)),
    });
    expect(Object.fromEntries(out)).toEqual({
      'prog:A': 'pkt-a',
      'prog:B': 'pkt-b',
      'data:OWNED': 'pkt-a',
      'data:SPLIT': SHARED_POCKET,
      'job:J': 'pkt-b',
      'data:WORK': 'pkt-b',
      'tran:T1': 'pkt-a',
      'sys:CEE3ABD': '',
      'prog:SORT': '',
    });
  });
});

describe('cochangeEdges', () => {
  it('counts pairs, skips big commits, applies the minimum', () => {
    const map = (p: string) => (p.endsWith('.cbl') ? P(p.slice(0, -4).toUpperCase()) : undefined);
    const commits = [['a.cbl', 'b.cbl', 'README.md'], ['a.cbl', 'b.cbl'], ['a.cbl', 'c.cbl'], Array.from({ length: 11 }, (_, i) => `x${i}.cbl`)];
    expect(cochangeEdges(commits, map, { maxFilesPerCommit: 10, minCount: 2 })).toEqual([
      { src: P('A'), dst: P('B'), kind: 'cochange', count: 2, confidence: 'extracted', detail: '2 commits', evidence: 'git log' },
    ]);
  });
});

describe('segment', () => {
  // Two features (accounts, cards) that each own a file, a menu every screen returns to,
  // a batch job, and one cross-feature read.
  const nodes = [
    ...['ACCTVW', 'ACCTUP', 'CARDLI', 'CARDUP', 'MENU'].map((x) => n('program', x, 400)),
    n('dataset', 'ACCT', 0, ''),
    n('dataset', 'CARD', 0, ''),
    n('job', 'NIGHTLY'),
    n('transaction', 'CAVW'),
    n('transaction', 'CCLI'),
  ];
  const edges = [
    e(P('ACCTVW'), D('ACCT'), 'read'),
    e(P('ACCTUP'), D('ACCT'), 'write'),
    e(P('ACCTVW'), P('ACCTUP'), 'transfers'),
    e(P('CARDLI'), D('CARD'), 'read'),
    e(P('CARDUP'), D('CARD'), 'write'),
    e(P('CARDLI'), P('CARDUP'), 'transfers'),
    e(P('CARDUP'), D('ACCT'), 'read'),
    ...['ACCTVW', 'ACCTUP', 'CARDLI', 'CARDUP'].map((x) => e(P(x), P('MENU'), 'transfers')),
    e('job:NIGHTLY', P('CARDUP'), 'runs'),
    e('tran:CAVW', P('ACCTVW'), 'starts'),
    e('tran:CCLI', P('CARDLI'), 'starts'),
  ];
  const graph: BuiltGraph = {
    nodes,
    edges,
    transactions: [
      { id: 'tran:CAVW', name: 'CAVW', program: P('ACCTVW'), description: 'CREDIT CARD DEMO ACCOUNT VIEW' },
      { id: 'tran:CCLI', name: 'CCLI', program: P('CARDLI'), description: 'LIST CARDS' },
    ],
    jobs: [{ id: 'job:NIGHTLY', name: 'NIGHTLY', programs: [P('CARDUP')] }],
    unresolved: [{ program: 'MENU', what: 'CICS XCTL PROGRAM', token: 'NEXT-PGM', at: 'app/MENU:10' }],
    warnings: [],
  };
  const source = { root: 'test', ref: 'abc', deps: 'deps.json', depsHash: 'h' };
  const r = segment(graph, cfg, source);
  const pocket = (id: string) => r.pockets.find((p) => p.id === id)!;

  it('groups features, moves the menu to the shared pocket and names pockets', () => {
    const code = r.pockets.filter((p) => p.level === 'pocket' && p.kind === 'code');
    expect(code.map((p) => p.members.filter((m) => m.startsWith('prog:')))).toEqual([
      [P('ACCTUP'), P('ACCTVW')],
      [P('CARDLI'), P('CARDUP')],
    ]);
    expect(r.nodes.find((x) => x.id === P('MENU'))!.pocketId).toBe(SHARED_POCKET);
    const acct = r.nodes.find((x) => x.id === P('ACCTVW'))!.pocketId;
    expect(pocket(acct).name).toBe('Account View');
    expect(pocket(acct).members).toEqual(expect.arrayContaining([D('ACCT'), 'tran:CAVW']));
  });

  it('computes isolation from cohesion and coupling (shared pocket excluded)', () => {
    for (const p of r.pockets.filter((x) => x.level === 'pocket' && x.kind === 'code')) {
      expect(p.isolation).toBeCloseTo(p.cohesion / (p.cohesion + p.coupling), 3);
      expect(p.coupling).toBeGreaterThan(0); // CARDUP reads ACCT
      expect(p.isolation).toBeLessThan(1);
    }
    expect(r.metrics.modularity).toBeGreaterThan(0);
    expect(r.metrics.unresolved).toBe(1);
    expect(r.unresolved).toEqual(graph.unresolved);
  });

  it('builds endpoints, domains and pocket edges', () => {
    expect(r.endpoints.map((x) => [x.id, x.kind, x.entryNode])).toEqual([
      ['CICS CAVW', 'cics', P('ACCTVW')],
      ['CICS CCLI', 'cics', P('CARDLI')],
      ['JOB NIGHTLY', 'batch', P('CARDUP')],
    ]);
    const cavw = r.endpoints[0];
    expect(cavw.servedBy).toEqual([cavw.pocketId]); // does not walk through the menu
    expect(r.pockets.filter((p) => p.level === 'domain').length).toBeGreaterThan(0);
    expect(r.pocketEdges.some((x) => x.level === 'pocket' && x.kinds.dataset)).toBe(true);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(segment(structuredClone(graph), cfg, source))).toBe(JSON.stringify(r));
  });
});
