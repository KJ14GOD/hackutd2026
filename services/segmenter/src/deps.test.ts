// The deps.json adapter, checked against the examples in docs/GRAPH_SCHEMA.md.
import { describe, expect, it } from 'vitest';
import { fromDeps, parseDeps } from './deps';

const sample = {
  counts: { program: 2 },
  edge_counts: { write: 1 },
  nodes: [
    { id: 'prog:CBTRN02C', kind: 'program', file: 'app/cbl/CBTRN02C.cbl', mode: 'batch', lines: 731 },
    { id: 'prog:COACTUPC', kind: 'program', file: 'app/cbl/COACTUPC.cbl', mode: 'online', lines: 4236 },
    { id: 'prog:SORT', kind: 'utility' },
    { id: 'prog:COCRDSEC' }, // no kind: referenced, not in the repo
    { id: 'data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS', kind: 'dataset' },
    { id: 'data:db2:CARDDEMO.AUTHFRDS', kind: 'dataset' },
    { id: 'tran:CAUP', kind: 'transaction', description: 'ACCOUNT UPDATE' },
    { id: 'job:POSTTRAN', kind: 'job', file: 'app/jcl/POSTTRAN.jcl' },
    { id: 'sys:MQPUT', kind: 'system-api' },
  ],
  edges: [
    {
      from: 'prog:CBTRN02C',
      to: 'data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS',
      rel: 'write',
      evidence: 'app/cbl/CBTRN02C.cbl:311',
      via: 'I-O ACCOUNT-FILE -> DD ACCTFILE',
      confidence: 'extracted',
    },
    { from: 'prog:CBTRN02C', to: 'data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS', rel: 'write', evidence: 'app/cbl/CBTRN02C.cbl:420' },
    { from: 'prog:COACTUPC', to: 'prog:COCRDSEC', rel: 'transfers', evidence: 'app/cbl/COACTUPC.cbl:900', confidence: 'inferred' },
    { from: 'tran:CAUP', to: 'prog:COACTUPC', rel: 'starts', evidence: 'CSD' },
    { from: 'job:POSTTRAN', to: 'prog:SORT', rel: 'runs', evidence: 'app/jcl/POSTTRAN.jcl:40' },
    { from: 'job:POSTTRAN', to: 'prog:CBTRN02C', rel: 'runs', evidence: 'app/jcl/POSTTRAN.jcl:20' },
    { from: 'prog:COACTUPC', to: 'screen:COACTUP', rel: 'shows', evidence: 'app/cbl/COACTUPC.cbl:100' }, // planned prefix
  ],
  components: [{ id: 1, programs: ['CBTRN02C'] }],
  datasets: [['AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS', ['CBTRN02C'], []]],
  ubiquitous_copybooks: { COCOM01Y: 21 },
  unresolved: [{ program: 'CBSTM03B', what: 'batch DD with no JCL step', token: 'TRNXFILE', at: 'app/cbl/CBSTM03B.CBL:136', inferred: ['AWS.M2.CARDDEMO.TRXFL.VSAM.KSDS'] }],
};

describe('fromDeps', () => {
  const g = fromDeps(parseDeps(sample));
  const node = (id: string) => g.nodes.find((n) => n.id === id)!;

  it('keeps ids, maps fields, and derives kinds for nodes that lack one', () => {
    expect(node('prog:CBTRN02C')).toMatchObject({ kind: 'program', name: 'CBTRN02C', path: 'app/cbl/CBTRN02C.cbl', loc: 731, meta: { mode: 'batch' } });
    expect(node('prog:COCRDSEC')).toMatchObject({ kind: 'missing', path: '' });
    expect(node('data:db2:CARDDEMO.AUTHFRDS').name).toBe('db2:CARDDEMO.AUTHFRDS');
    expect(node('screen:COACTUP')).toMatchObject({ kind: 'screen', meta: { placeholder: true } });
    expect(g.warnings).toEqual(['edge endpoint screen:COACTUP is not in nodes; added as a placeholder']);
  });

  it('merges repeated edges, counting them and keeping the first evidence', () => {
    const w = g.edges.filter((e) => e.kind === 'write');
    expect(w).toEqual([
      {
        src: 'prog:CBTRN02C',
        dst: 'data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS',
        kind: 'write',
        count: 2,
        confidence: 'extracted',
        detail: 'I-O ACCOUNT-FILE -> DD ACCTFILE',
        evidence: 'app/cbl/CBTRN02C.cbl:311',
      },
    ]);
    expect(g.edges.find((e) => e.kind === 'transfers')!.confidence).toBe('inferred');
  });

  it('finds transactions and job steps (programs only, in line order)', () => {
    expect(g.transactions).toEqual([{ id: 'tran:CAUP', name: 'CAUP', program: 'prog:COACTUPC', description: 'ACCOUNT UPDATE' }]);
    expect(g.jobs).toEqual([{ id: 'job:POSTTRAN', name: 'POSTTRAN', programs: ['prog:CBTRN02C'] }]);
    expect(g.unresolved).toHaveLength(1);
  });

  it('rejects input that does not match the schema', () => {
    expect(() => parseDeps({ nodes: [{ id: 'no-prefix' }], edges: [] })).toThrow('prefix');
    expect(() => parseDeps({ nodes: [], edges: [{ from: 'a:x', to: 'b:y', rel: 'calls' }] })).toThrow(); // no evidence
    expect(() => parseDeps({ nodes: [], edges: [{ from: 'a:x', to: 'b:y', rel: 'calls', evidence: 'x', confidence: 'maybe' }] })).toThrow();
  });
});
