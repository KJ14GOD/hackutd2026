// Part 1 (static map): repo in, pass1.json out. No LLM, no running customer code.
// Steps follow docs/SPEC_DEPENDENCY_PASSES.md §1.2.
import { spawnSync } from 'node:child_process';
import { normalizeLines, normalizeProgram, readRepo, type SourceFile } from './inventory';
import { jobSteps, parseProc, statements, type Proc } from './jcl';
import { parseBms, parseCa7, parseControlM, parseCsd, parsePsb, type CsdInfo } from './defs';
import type { Edge, Lookups, Node, NormalizedProgram, Pass1, Touch, Unresolved } from './types';
import { scanJobs } from './scanners/batch';
import { cicsQueue } from './scanners/cicsQueue';
import { db } from './scanners/db';
import { external } from './scanners/external';
import { files } from './scanners/files';
import { identity } from './scanners/identity';
import { ims } from './scanners/ims';
import { layouts } from './scanners/layouts';
import { mq } from './scanners/mq';
import { network } from './scanners/network';
import { programs } from './scanners/programs';
import { timedStarts, triggerEdges } from './scanners/scheduler';
import { screen } from './scanners/screen';
import { time } from './scanners/time';
import type { Scanner } from './scanners/util';

/** One scanner per system (§1.3). batch and the job->job half of scheduler work on jobs, not programs. */
export const PROGRAM_SCANNERS: Scanner[] = [programs, layouts, files, db, ims, mq, cicsQueue, screen, network, identity, time, timedStarts, external];

function gitCommit(root: string): string {
  const r = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

export function buildLookups(sources: SourceFile[], programs: NormalizedProgram[]): Lookups {
  const csd: CsdInfo = { files: new Map(), transactions: new Map(), tdQueues: new Map() };
  for (const f of sources.filter((s) => s.kind === 'online-config')) parseCsd(f.text, f.path, csd);

  const procs = new Map<string, Proc>();
  for (const f of sources.filter((s) => s.kind === 'proc')) procs.set(f.name, parseProc(f.name, f.text, f.path));
  const steps = sources.filter((s) => s.kind === 'job').flatMap((f) => {
    const job = statements(f.text).find((s) => s.op === 'JOB')?.name.toUpperCase() || f.name;
    return jobSteps(job, f.text, f.path, procs);
  });

  // A step is a utility unless it runs a program in this repo (compilers, linkers, DB2/IMS tools are utilities).
  const programNames = new Set(programs.map((p) => p.name));
  for (const step of steps) step.utility = !programNames.has(step.program);

  const stepFiles = new Map<string, { dsn: string; disp?: string; evidence: string }[]>();
  const ddAnywhere = new Map<string, Set<string>>();
  for (const step of steps) {
    for (const dd of step.dds) {
      if (!dd.dsn) continue;
      if (!ddAnywhere.has(dd.name)) ddAnywhere.set(dd.name, new Set());
      ddAnywhere.get(dd.name)!.add(dd.dsn);
      if (step.utility) continue;
      const key = `${step.program}|${dd.name}`;
      if (!stepFiles.has(key)) stepFiles.set(key, []);
      stepFiles.get(key)!.push({ dsn: dd.dsn, disp: dd.disp, evidence: dd.evidence });
    }
  }

  const jobTriggers = sources.filter((s) => s.kind === 'scheduler').flatMap((f) =>
    f.text.includes('<DEFTABLE') ? parseControlM(f.text, f.path) : parseCa7(f.text, f.path));

  const psbDatabases = new Map<string, string[]>();
  for (const f of sources.filter((s) => s.kind === 'ims-def')) {
    const { psb, dbds } = parsePsb(f.text);
    if (psb && dbds.length) psbDatabases.set(psb, dbds);
  }
  const mapFields = new Map<string, number>();
  for (const f of sources.filter((s) => s.kind === 'screen-def')) for (const [m, n] of parseBms(f.text)) mapFields.set(m, n);

  const copybooks = new Map<string, string>();
  for (const f of sources.filter((s) => s.kind === 'copybook')) {
    if (!copybooks.has(f.name)) copybooks.set(f.name, normalizeLines(f.text).map((l) => l.text).join(' '));
  }
  const externalSources = new Map<string, string>();
  for (const f of sources.filter((s) => s.kind === 'external-source')) if (!externalSources.has(f.name)) externalSources.set(f.name, f.path);

  return {
    fileAlias: new Map([...csd.files].map(([k, v]) => [k, v.dsn])),
    stepFiles, tranProgram: csd.transactions, tdQueues: csd.tdQueues, mapFields, psbDatabases, ddAnywhere,
    programs: programNames, copybooks, externalSources, steps, jobTriggers,
  };
}

const KIND_BY_PREFIX: Record<string, string> = {
  prog: 'program', cpy: 'copybook', job: 'job', tran: 'transaction', data: 'dataset', sys: 'system-api',
  external: 'external', mq: 'queue', tsq: 'queue', tdq: 'queue', screen: 'screen', ims: 'ims-database',
  identity: 'identity', time: 'time', http: 'external', ws: 'external', socket: 'external',
};

export function runPass1(root: string): Pass1 {
  const sources = readRepo(root);
  const programFiles = sources.filter((s) => s.kind === 'program');
  const progs = programFiles.map(normalizeProgram);
  const lookups = buildLookups(sources, progs);

  let edges: Edge[] = [];
  let unresolved: Unresolved[] = [];
  let touches: Touch[] = [];
  for (const prog of progs) {
    for (const scan of PROGRAM_SCANNERS) {
      const r = scan(prog, lookups);
      edges.push(...r.edges);
      unresolved.push(...r.unresolved);
      touches.push(...r.touches);
    }
  }
  const controlMembers = new Map(sources.filter((s) => s.kind === 'control').map((s) => [s.name, { text: s.text, path: s.path }]));
  const jobs = scanJobs(lookups.steps, controlMembers);
  edges.push(...jobs.edges, ...triggerEdges(lookups.jobTriggers));
  touches.push(...jobs.touches);
  for (const [tran, { program, evidence }] of lookups.tranProgram) {
    edges.push({ from: `tran:${tran}`, to: `prog:${program}`, rel: 'starts', evidence, confidence: 'extracted', system: 'programs' });
  }
  for (const [queue, q] of lookups.tdQueues) {
    if (q.trigger) edges.push({ from: `tdq:${queue}`, to: `tran:${q.trigger}`, rel: 'triggers', evidence: q.evidence, confidence: 'extracted', system: 'cics-queue' });
    if (q.dsn) edges.push({ from: `tdq:${queue}`, to: `data:${q.dsn}`, rel: 'write', evidence: q.evidence, confidence: 'extracted', system: 'cics-queue' });
  }

  edges = dedupe(edges, (e) => [e.from, e.to, e.rel, e.system, e.via ?? ''].join('|'));
  unresolved = dedupe(unresolved, (u) => [u.program, u.system, u.what, u.token, u.at].join('|'));
  touches = dedupe(touches, (t) => `${t.program}|${t.system}`);

  const nodes = new Map<string, Node>();
  for (const p of progs) {
    const file = programFiles.find((f) => f.path === p.path)!;
    nodes.set(`prog:${p.name}`, { id: `prog:${p.name}`, kind: 'program', file: file.path, mode: p.online ? 'online' : 'batch', lines: p.totalLines });
  }
  for (const f of sources.filter((s) => s.kind === 'copybook')) if (!nodes.has(`cpy:${f.name}`)) nodes.set(`cpy:${f.name}`, { id: `cpy:${f.name}`, kind: 'copybook', file: f.path });
  for (const step of lookups.steps) nodes.set(`job:${step.job}`, { id: `job:${step.job}`, kind: 'job', file: step.evidence.replace(/:\d+$/, '') });
  for (const e of edges) {
    for (const id of [e.from, e.to]) {
      if (nodes.has(id)) continue;
      const prefix = id.split(':')[0];
      let kind = KIND_BY_PREFIX[prefix] ?? 'unknown';
      if (prefix === 'prog') kind = lookups.steps.some((s) => s.utility && `prog:${s.program}` === id) ? 'utility' : 'missing';
      const src = prefix === 'external' ? lookups.externalSources.get(id.slice(9)) : undefined;
      nodes.set(id, { id, kind, ...(src ? { file: src } : {}) });
    }
  }

  const missingInputs = [
    ['online config', 'online-config'], ['scheduler export', 'scheduler'], ['database definitions', 'db-def'],
    ['IMS definitions', 'ims-def'], ['screen definitions', 'screen-def'],
  ].filter(([, kind]) => !sources.some((s) => s.kind === kind)).map(([label]) => label);
  if (!sources.some((s) => /DEFINE\s+(QLOCAL|QREMOTE|QALIAS)\b/.test(s.text))) missingInputs.push('queue definitions');

  const byName = (k: SourceFile['kind']) => [...new Set(sources.filter((s) => s.kind === k).map((s) => s.name))].sort();
  return {
    version: 1,
    commit: gitCommit(root),
    inventory: {
      programs: [...lookups.programs].sort(),
      copybooks: byName('copybook'),
      jobs: [...new Set(lookups.steps.map((s) => s.job))].sort(),
      unknown: sources.filter((s) => s.kind === 'unknown').map((s) => s.path).sort(),
    },
    missingInputs: missingInputs.sort(),
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.rel, b.rel) || cmp(a.evidence, b.evidence) || cmp(a.via ?? '', b.via ?? '')),
    unresolved: unresolved.sort((a, b) => cmp(a.program, b.program) || cmp(a.system, b.system) || cmp(a.at, b.at) || cmp(a.token, b.token)),
    touches: touches.sort((a, b) => cmp(a.program, b.program) || cmp(a.system, b.system)),
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** JSON with object keys sorted, so two runs on the same input are byte-identical. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + '\n';
}
