// End-to-end on the real AWS CardDemo source: TS extractor -> deps.json -> segmentation.
// Skipped until `pnpm legacy:fetch` has run. These pin facts any sane segmentation of CardDemo
// must respect, not exact pocket ids, so tuning weights does not break them.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot, loadConfig } from '@theseus/shared';
import { describe, expect, it } from 'vitest';
import { SHARED_POCKET } from './assign';
import { fromDeps, parseDeps } from './deps';
import { extractDeps } from './extract/graph';
import { scanSources } from './extract/scan';
import { segment } from './segment';

const root = findRepoRoot();
const legacy = join(root, 'legacy/carddemo');

describe.skipIf(!existsSync(join(legacy, 'app')))('CardDemo', () => {
  const deps = extractDeps(scanSources(join(legacy, 'app'), legacy));
  const graph = fromDeps(parseDeps(JSON.parse(JSON.stringify(deps))));
  const source = { root: 'legacy/carddemo', ref: 'test', deps: 'test', depsHash: 'test' };
  const result = segment(structuredClone(graph), loadConfig().segmentation, source);
  const pocketOf = (id: string) => result.nodes.find((n) => n.id === id)?.pocketId;
  const edge = (from: string, to: string, rel: string) => deps.edges.find((e) => e.from === from && e.to === to && e.rel === rel);

  it('emits valid deps.json for every program, transaction and job', () => {
    expect(deps.counts.program).toBeGreaterThanOrEqual(44);
    expect(deps.nodes.every((n) => /^[a-z-]+:/.test(n.id))).toBe(true);
    expect(deps.nodes.find((n) => n.id === 'prog:CBTRN02C')).toMatchObject({ kind: 'program', file: 'app/cbl/CBTRN02C.cbl', mode: 'batch' });
    expect(result.endpoints.filter((e) => e.kind === 'cics').length).toBeGreaterThanOrEqual(20);
    expect(result.endpoints.find((e) => e.id === 'JOB INTCALC')?.entryNode).toBe('prog:CBACT04C');
  });

  it('resolves dynamic targets and unifies dataset names (spike F1, F2, F5)', () => {
    // CICS name ACCTDAT and batch DD ACCTFILE land on the same dataset node.
    expect(edge('prog:COACTVWC', 'data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS', 'read')).toBeTruthy();
    expect(edge('prog:CBACT04C', 'data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS', 'write')).toBeTruthy();
    expect(deps.nodes.some((n) => n.id.endsWith('.AIX.PATH'))).toBe(false);
    expect(edge('prog:COPAUA0C', 'sys:MQPUT1', 'uses-api') ?? edge('prog:COPAUA0C', 'sys:MQPUT', 'uses-api')).toBeTruthy();
    // IMS batch program behind DFSRRC00, segments from its PSB.
    expect(edge('job:LOADPADB', 'prog:PAUDBLOD', 'runs')).toBeTruthy();
    expect(edge('prog:PAUDBLOD', 'ims:PAUTSUM0', 'write')).toBeTruthy();
  });

  it('respects obvious structure', () => {
    expect(pocketOf('prog:CBSTM03B')).toBe(pocketOf('prog:CBSTM03A')); // CALLed subprogram
    const users = ['COUSR00C', 'COUSR01C', 'COUSR02C', 'COUSR03C'].map((p) => pocketOf(`prog:${p}`));
    expect(new Set(users).size).toBe(1);
    expect(pocketOf('prog:COMEN01C')).toBe(SHARED_POCKET); // main menu: hub
    expect(pocketOf('prog:COSGN00C')).toBe(SHARED_POCKET); // sign-on: hub
    expect(result.metrics.ignoredEdges).toBe(0);
    expect(result.metrics.modularity).toBeGreaterThan(0.3);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(segment(structuredClone(graph), loadConfig().segmentation, source))).toBe(JSON.stringify(result));
  });
});
