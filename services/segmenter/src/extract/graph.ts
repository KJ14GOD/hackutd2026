// TypeScript COBOL extractor that emits the dependency graph in the team format
// (`deps.json`, docs/GRAPH_SCHEMA.md). The segmenter itself only reads deps.json; this is
// one producer of it, kept so the pipeline runs end to end in this repo (see DECISIONS Q20).
// Beyond the schema's current prefixes it uses the *planned* ones: `ims:` (IMS segments from
// EXEC DLI and PSBs), `mq:` (queues), `screen:` with rel `shows` (BMS mapsets).
import { extractCobol, resolveRef, type ProgramFacts, type Ref } from './cobol/extract';
import { expandCopybooks } from './cobol/expand';
import { parseCsd } from './jcl/csd';
import { canonicalDataset, parseJcl, type JclStep } from './jcl/jcl';
import { parsePsb } from './jcl/psb';
import type { Sources } from './scan';

type Conf = 'extracted' | 'inferred';
export interface DepsNode {
  id: string;
  kind?: string;
  file?: string;
  mode?: 'online' | 'batch';
  lines?: number;
  [extra: string]: unknown;
}
export interface DepsEdge {
  from: string;
  to: string;
  rel: string;
  evidence: string;
  via?: string;
  confidence?: Conf;
}
export interface DepsUnresolved {
  program: string;
  what: string;
  token: string;
  at: string;
  inferred?: string[];
}
export interface DepsJson {
  counts: Record<string, number>;
  edge_counts: Record<string, number>;
  nodes: DepsNode[];
  edges: DepsEdge[];
  components: unknown[];
  datasets: [string, string[], string[]][];
  ubiquitous_copybooks: Record<string, number>;
  unresolved: DepsUnresolved[];
  producer: string;
}

/** System APIs: CALL targets that are middleware or runtime, not programs (spike F5). */
const SYSTEM_API = /^(MQ[A-Z0-9]*|CBLTDLI|AIBTDLI|CEE[A-Z0-9]*|CBL_[A-Z_]+|DSNTIAR|DSNHLI|IGZ[A-Z0-9]*|ILBO[A-Z0-9]*)$/;
const UBIQUITOUS_SHARE = 0.4; // matches the Python prototype's report; clustering has its own threshold

/** Total source lines (GRAPH_SCHEMA: "source line count"). */
const lineCount = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length;

export function extractDeps(src: Sources): DepsJson {
  const nodes = new Map<string, DepsNode>();
  const edges: DepsEdge[] = [];
  const unresolved: DepsUnresolved[] = [];

  const node = (id: string, fields: Omit<DepsNode, 'id'> = {}) => {
    const prev = nodes.get(id);
    if (prev) {
      for (const [k, v] of Object.entries(fields)) if (prev[k] === undefined) prev[k] = v;
    } else nodes.set(id, { id, ...fields });
    return id;
  };
  const edge = (from: string, to: string, rel: string, evidence: string, via?: string, confidence?: Conf) => {
    if (from === to) return;
    edges.push({ from, to, rel, evidence, ...(via ? { via } : {}), ...(confidence === 'inferred' ? { confidence } : {}) });
  };

  // Copybooks, maps, assembler.
  const copybookText = new Map<string, string>();
  for (const c of src.copybooks) {
    if (copybookText.has(c.name)) continue;
    copybookText.set(c.name, c.text);
    node(`cpy:${c.name}`, { kind: 'copybook', file: c.path });
  }
  const mapsets = new Set(src.maps.map((m) => m.name));
  for (const m of src.maps) node(`screen:${m.name}`, { kind: 'screen', file: m.path });

  const csd = parseCsd(src.csd.map((f) => f.text));
  const procs = new Map(src.procs.map((p) => [p.name, p.text]));
  const jcl = parseJcl(src.jcl, procs);
  const psbs = new Map(src.psbs.map((f) => parsePsb(f.text, f.name)).map((p) => [p.name, p.facts]));
  const dataId = (dsn: string) => `data:${canonicalDataset(dsn, jcl.aliases)}`;

  // Programs (COBOL) and assembler routines are both "program" nodes with source.
  const facts = new Map<string, { facts: ProgramFacts; path: string; text: string }>();
  for (const p of src.programs) {
    const f = extractCobol(expandCopybooks(p.text, (n) => copybookText.get(n)));
    const id = f.programId || p.name;
    if (!facts.has(id)) facts.set(id, { facts: f, path: p.path, text: p.text });
  }
  const asm = new Map(src.asm.map((a) => [a.name, a]));
  const code = new Set([...facts.keys(), ...asm.keys()]);
  const online = new Set(csd.transactions.map((t) => t.program));
  for (const [id, f] of facts) {
    node(`prog:${id}`, { kind: 'program', file: f.path, mode: f.facts.cics || online.has(id) ? 'online' : 'batch', lines: lineCount(f.text) });
  }
  for (const [name, a] of asm) node(`prog:${name}`, { kind: 'program', file: a.path, mode: 'batch', lines: lineCount(a.text), language: 'asm' });

  /** A call/XCTL/LINK/JCL target: our code, a system API, a JCL utility, or a missing program. */
  const target = (name: string, fromJcl: boolean) => {
    if (code.has(name)) return `prog:${name}`;
    if (SYSTEM_API.test(name)) return node(`sys:${name}`, { kind: 'system-api' });
    if (fromJcl) return node(`prog:${name}`, { kind: 'utility' });
    return node(`prog:${name}`); // no kind, no file: referenced but not in the repo (spike F6)
  };
  const resolve = (program: string, at: string, ref: Ref, f: ProgramFacts, accept: (n: string) => boolean, what: string, guess = true) => {
    const r = resolveRef(ref, f, accept, guess);
    if (r.confidence === 'unresolved' || r.confidence === 'heuristic') {
      unresolved.push({
        program,
        what,
        token: 'variable' in ref ? ref.variable : ref.literal,
        at,
        ...(r.values.length ? { inferred: r.values } : {}),
      });
    }
    return { values: r.values, conf: (r.confidence === 'heuristic' ? 'inferred' : 'extracted') as Conf, via: 'variable' in ref ? ref.variable : undefined };
  };

  // DD binding: the steps that run the program, else the steps that run its callers.
  const callers = new Map<string, string[]>();
  for (const [id, { facts: f }] of facts) {
    for (const inv of f.invocations) {
      if (inv.kind === 'call' && 'literal' in inv.ref) callers.set(inv.ref.literal, [...(callers.get(inv.ref.literal) ?? []), id]);
    }
  }
  const stepsFor = (program: string, seen = new Set<string>()): JclStep[] => {
    seen.add(program);
    const own = jcl.jobs.flatMap((j) => j.steps.filter((s) => s.program === program));
    if (own.length) return own;
    return (callers.get(program) ?? []).filter((c) => !seen.has(c)).flatMap((c) => stepsFor(c, seen));
  };
  const ddIndex = new Map<string, Set<string>>();
  for (const s of jcl.jobs.flatMap((j) => j.steps)) {
    for (const [dd, dsns] of s.dds) for (const d of dsns) ddIndex.set(dd, (ddIndex.get(dd) ?? new Set()).add(canonicalDataset(d, jcl.aliases)));
  }

  for (const [id, { facts: f, path }] of facts) {
    const me = `prog:${id}`;
    for (const inv of f.invocations) {
      const what = inv.kind === 'call' ? 'CALL target' : `CICS ${inv.kind.toUpperCase()} PROGRAM`;
      const r =
        inv.kind === 'call' && 'literal' in inv.ref
          ? { values: [inv.ref.literal], conf: 'extracted' as Conf, via: undefined }
          : resolve(id, path, inv.ref, f, (n) => code.has(n), what);
      for (const name of r.values) {
        const to = target(name, false);
        const rel = to.startsWith('sys:') ? 'uses-api' : inv.kind === 'call' ? 'calls' : inv.kind === 'link' ? 'links' : 'transfers';
        edge(me, to, rel, path, r.via, r.conf);
      }
    }
    for (const cb of f.copybooks.keys()) edge(me, node(`cpy:${cb}`, { kind: 'copybook' }), 'copies', path);
    for (const op of f.cicsFiles) {
      const r = resolve(id, path, op.ref, f, (n) => csd.files.has(n), 'CICS file');
      for (const name of r.values) edge(me, dataId(csd.files.get(name)!), op.mode, path, `CICS ${name}`, r.conf);
    }
    const steps = stepsFor(id);
    for (const dd of f.ddFiles) {
      const bound = [...new Set(steps.flatMap((s) => s.dds.get(dd.ddName) ?? []))];
      for (const dsn of bound) edge(me, dataId(dsn), dd.mode, path, `${dd.fd} -> DD ${dd.ddName}`);
      if (bound.length) continue;
      const elsewhere = [...(ddIndex.get(dd.ddName) ?? [])];
      unresolved.push({ program: id, what: 'batch DD with no JCL step', token: dd.ddName, at: path, ...(elsewhere.length === 1 ? { inferred: elsewhere } : {}) });
      if (elsewhere.length === 1) edge(me, `data:${elsewhere[0]}`, dd.mode, path, `DD ${dd.ddName} (same name elsewhere)`, 'inferred');
      else edge(me, node(`data:dd:${dd.ddName}`, { kind: 'dataset' }), dd.mode, path, `DD ${dd.ddName}`, 'inferred');
    }
    for (const s of steps) {
      const psb = psbs.get(s.psb);
      if (!psb) continue;
      for (const seg of psb.segments) edge(me, node(`ims:${seg.name}`, { kind: 'ims' }), seg.write ? 'write' : 'read', path, `PSB ${s.psb}`);
      for (const gs of psb.gsam) for (const dsn of s.dds.get(gs.dbd) ?? []) edge(me, dataId(dsn), gs.write ? 'write' : 'read', path, `GSAM ${gs.dbd}`);
    }
    for (const t of f.sql) edge(me, node(`data:db2:${t.table}`, { kind: 'dataset' }), t.mode, path, 'EXEC SQL');
    for (const s of f.segments) edge(me, node(`ims:${s.name}`, { kind: 'ims' }), s.mode, path, 'EXEC DLI');
    for (const q of f.queues) {
      const r = resolve(id, path, q.ref, f, (n) => /^[A-Z0-9][A-Z0-9._%-]*$/.test(n), 'MQ queue (name set at runtime)', false);
      for (const name of r.values) edge(me, node(`mq:${name}`, { kind: 'mq' }), q.mode, path, r.via, r.conf);
    }
    for (const m of f.maps) {
      const r = resolve(id, path, m, f, (n) => mapsets.has(n), 'BMS mapset');
      for (const name of r.values) edge(me, `screen:${name}`, 'shows', path, r.via, r.conf);
    }
  }

  // Jobs and the datasets their steps bind.
  for (const j of jcl.jobs) {
    const jid = node(`job:${j.name}`, { kind: 'job', file: j.path });
    for (const s of j.steps) {
      if (s.program) edge(jid, target(s.program, true), 'runs', `${j.path}:${s.name}`);
      for (const [dd, dsns] of s.dds) for (const d of dsns) edge(jid, dataId(d), s.ddWrites.has(dd) ? 'write' : 'read', `${j.path}:${s.name}`, `DD ${dd}`);
    }
  }
  for (const t of csd.transactions) {
    edge(node(`tran:${t.id}`, { kind: 'transaction', description: t.description }), target(t.program, false), 'starts', 'CSD');
  }

  // Every edge endpoint is a node.
  for (const e of edges) for (const id of [e.from, e.to]) if (!nodes.has(id) && id.startsWith('data:')) node(id, { kind: 'dataset' });

  return summarize([...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges, unresolved);
}

/** Adds the top-level summaries GRAPH_SCHEMA.md lists (counts, datasets, ubiquitous copybooks). */
function summarize(nodes: DepsNode[], edges: DepsEdge[], unresolved: DepsUnresolved[]): DepsJson {
  const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
  const programs = nodes.filter((n) => n.kind === 'program' && n.file).length;
  const copiers = new Map<string, Set<string>>();
  const rw = new Map<string, { w: Set<string>; r: Set<string> }>();
  for (const e of edges) {
    if (!e.from.startsWith('prog:')) continue;
    if (e.rel === 'copies') copiers.set(e.to, (copiers.get(e.to) ?? new Set()).add(e.from));
    if (e.to.startsWith('data:') && (e.rel === 'read' || e.rel === 'write')) {
      const d = rw.get(e.to) ?? { w: new Set(), r: new Set() };
      (e.rel === 'write' ? d.w : d.r).add(e.from.slice(5));
      rw.set(e.to, d);
    }
  }
  return {
    counts: count(nodes.map((n) => n.kind ?? 'unknown')),
    edge_counts: count(edges.map((e) => e.rel)),
    nodes,
    edges,
    components: [], // candidate pockets are the segmenter's job
    datasets: [...rw]
      .map(([id, d]) => [id.slice(5), [...d.w].sort(), [...d.r].filter((p) => !d.w.has(p)).sort()] as [string, string[], string[]])
      .sort((a, b) => b[1].length + b[2].length - (a[1].length + a[2].length) || a[0].localeCompare(b[0])),
    ubiquitous_copybooks: Object.fromEntries(
      [...copiers].filter(([, s]) => s.size / Math.max(1, programs) > UBIQUITOUS_SHARE).map(([id, s]) => [id.slice(4), s.size]).sort(),
    ),
    unresolved,
    producer: 'services/segmenter/src/extract (TypeScript)',
  };
}
