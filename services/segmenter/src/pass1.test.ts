// Acceptance for Part 1 (docs/SPEC_DEPENDENCY_PASSES.md §1.5).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeProgram, readRepo } from './inventory';
import { buildLookups, runPass1, stableJson } from './pass1';
import { SYSTEMS, type Pass1, type System } from './types';

const FIXTURE = join(__dirname, '..', 'fixtures', 'planted');
const CARDDEMO = join(__dirname, '..', '..', '..', 'legacy', 'carddemo');
const key = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'planted.key.json'), 'utf8')) as { edges: [System, string, string, string][]; unresolved: [System, string, string, string][] };

/** Precision and recall must both be 1 for every system, so any extra or missing tuple fails. */
function compare(system: System, got: string[], want: string[]) {
  const g = new Set(got);
  const w = new Set(want);
  return { system, missing: [...w].filter((x) => !g.has(x)), extra: [...g].filter((x) => !w.has(x)) };
}

/** Programs that own something in a system: an edge touching the program, or an open question about it. */
function ownersBySystem(p: Pass1, system: System): string[] {
  const owners = new Set<string>();
  for (const e of p.edges.filter((x) => x.system === system)) {
    if (system === 'batch') { if (e.rel === 'runs' && p.nodes.find((n) => n.id === e.to)?.kind === 'program') owners.add(e.to.slice(5)); continue; }
    if (e.from.startsWith('prog:')) owners.add(e.from.slice(5));
  }
  for (const u of p.unresolved.filter((x) => x.system === system)) owners.add(u.program);
  return [...owners].sort();
}

describe('Part 1 on the planted fixture', () => {
  const result = runPass1(FIXTURE);

  it.each(SYSTEMS)('%s scanner: 100% precision and recall', (system) => {
    const got = [...new Set(result.edges.filter((e) => e.system === system).map((e) => [e.from, e.to, e.rel].join(' ')))];
    const want = key.edges.filter(([s]) => s === system).map(([, f, t, r]) => [f, t, r].join(' '));
    const gotU = result.unresolved.filter((u) => u.system === system).map((u) => [u.program, u.what, u.token].join(' | '));
    const wantU = key.unresolved.filter(([s]) => s === system).map(([, p, w, t]) => [p, w, t].join(' | '));
    expect(compare(system, got, want)).toEqual({ system, missing: [], extra: [] });
    expect(compare(system, gotU, wantU)).toEqual({ system, missing: [], extra: [] });
  });

  it('expands procedures with symbolic parameters and DD overrides', () => {
    const sources = readRepo(FIXTURE);
    const lookups = buildLookups(sources, sources.filter((s) => s.kind === 'program').map(normalizeProgram));
    const step = lookups.steps.find((s) => s.step === 'STEP4.PS1');
    expect(step?.program).toBe('PLSUB1');
    expect(step?.dds.find((d) => d.name === 'DATAIN')?.dsn).toBe('PLX.PROCIN');
    expect(step?.dds.find((d) => d.name === 'DATAOUT')?.dsn).toBe('PL.OVERRIDE');
  });

  it('resolves names held in variables as inferred, never as extracted', () => {
    const dyn = result.edges.find((e) => e.to === 'prog:PLSUB2' && e.rel === 'calls');
    expect(dyn?.confidence).toBe('inferred');
    expect(result.edges.find((e) => e.to === 'data:PL.ONLINE2.KSDS')?.confidence).toBe('inferred');
  });

  it('classifies every planted file and reports no missing inputs', () => {
    expect(result.inventory.unknown).toEqual([]);
    expect(result.inventory.programs).toEqual(['PLBATCH1', 'PLONLN1', 'PLONLN2', 'PLSUB1', 'PLSUB2']);
  });

  it('counts two ways: per-program touches equal the programs that own edges, per system', () => {
    for (const system of SYSTEMS) {
      const touches = result.touches.filter((t) => t.system === system).map((t) => t.program).sort();
      expect({ system, touches }).toEqual({ system, touches: ownersBySystem(result, system) });
    }
  });

  it('is deterministic: two runs are byte-identical', () => {
    expect(stableJson(runPass1(FIXTURE))).toBe(stableJson(result));
  });
});

describe.skipIf(!existsSync(join(CARDDEMO, 'app')))('Part 1 on AWS CardDemo (run `pnpm legacy:fetch` first)', () => {
  const result = runPass1(CARDDEMO);
  const acct = 'data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS';
  const mode = (id: string) => result.nodes.find((n) => n.id === id)?.mode;

  it('classifies all 44 programs and leaves nothing unclassified', () => {
    expect(result.inventory.programs).toHaveLength(44);
    expect(result.inventory.unknown).toEqual([]);
  });

  it('puts online and batch programs on the accounts dataset: at least 4 writers and 6 readers', () => {
    const writers = new Set(result.edges.filter((e) => e.to === acct && e.rel === 'write' && e.from.startsWith('prog:')).map((e) => e.from));
    const readers = new Set(result.edges.filter((e) => e.to === acct && e.rel === 'read' && e.from.startsWith('prog:')).map((e) => e.from));
    expect(writers.size).toBeGreaterThanOrEqual(4);
    expect(readers.size).toBeGreaterThanOrEqual(6);
    const all = [...writers, ...readers];
    expect(all.some((p) => mode(p) === 'online')).toBe(true);
    expect(all.some((p) => mode(p) === 'batch')).toBe(true);
  });

  it('gives every edge evidence that points at a real line', () => {
    for (const e of result.edges) expect(e.evidence).toMatch(/^[^:]+:\d+$/);
  });

  it('counts two ways on CardDemo too', () => {
    for (const system of SYSTEMS) {
      const touches = result.touches.filter((t) => t.system === system).map((t) => t.program).sort();
      expect({ system, touches }).toEqual({ system, touches: ownersBySystem(result, system) });
    }
  });

  it('is deterministic', () => {
    expect(stableJson(runPass1(CARDDEMO))).toBe(stableJson(result));
  });
});
