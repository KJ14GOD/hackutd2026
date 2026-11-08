// Reads the dependency graph (`deps.json`, docs/GRAPH_SCHEMA.md) into the segmenter's graph.
// Pure. Forward compatible on purpose: GRAPH_SCHEMA.md promises only to *add* prefixes and
// rels, so unknown ones are kept in the graph and simply not used for clustering.
import { z } from 'zod';
import type { Confidence, GraphEdge, GraphNode, Unresolved } from './types';

const Node = z
  .object({
    id: z.string().regex(/^[a-z-]+:.+/, 'node id must be <prefix>:<name>'),
    kind: z.string().optional(),
    file: z.string().optional(),
    mode: z.string().optional(),
    lines: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const Edge = z
  .object({
    from: z.string(),
    to: z.string(),
    rel: z.string(),
    evidence: z.string(),
    via: z.string().optional(),
    confidence: z.enum(['extracted', 'inferred', 'unknown', 'observed']).optional(),
  })
  .passthrough();

const UnresolvedRef = z
  .object({
    program: z.string(),
    what: z.string(),
    token: z.string(),
    at: z.string(),
    inferred: z.array(z.string()).optional(),
  })
  .passthrough();

export const DepsSchema = z
  .object({
    nodes: z.array(Node),
    edges: z.array(Edge),
    unresolved: z.array(UnresolvedRef).default([]),
    ubiquitous_copybooks: z.record(z.string(), z.number()).optional(),
    components: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type Deps = z.infer<typeof DepsSchema>;

export interface BuiltGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** CICS transactions: `starts` edges from a tran node to a program. */
  transactions: { id: string; name: string; program: string; description: string }[];
  /** JCL jobs and the program nodes they run, in step order. */
  jobs: { id: string; name: string; programs: string[] }[];
  unresolved: Unresolved[];
  warnings: string[];
}

/** Node kind for a prefix, for nodes that lack `kind` and for planned prefixes. */
const KIND_BY_PREFIX: Record<string, string> = {
  prog: 'missing', // a prog: node without kind has no source we know of
  cpy: 'copybook',
  job: 'job',
  tran: 'transaction',
  data: 'dataset',
  sys: 'system-api',
};

const RANK: Record<Confidence, number> = { unknown: 0, inferred: 1, extracted: 2, observed: 3 };

const prefixOf = (id: string) => id.slice(0, id.indexOf(':'));
const nameOf = (id: string) => id.slice(id.indexOf(':') + 1);
const lineOf = (evidence: string) => Number(evidence.match(/:(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);

export function parseDeps(raw: unknown): Deps {
  return DepsSchema.parse(raw);
}

export function fromDeps(deps: Deps): BuiltGraph {
  const warnings: string[] = [];
  const nodes = new Map<string, GraphNode>();
  for (const n of deps.nodes) {
    if (nodes.has(n.id)) {
      warnings.push(`duplicate node ${n.id}; using the first`);
      continue;
    }
    const { id, kind, file, lines, ...rest } = n;
    nodes.set(id, {
      id,
      kind: kind ?? KIND_BY_PREFIX[prefixOf(id)] ?? prefixOf(id),
      name: nameOf(id),
      path: file ?? '',
      loc: lines ?? 0,
      pocketId: '',
      domainId: '',
      meta: rest,
    });
  }

  const edges = new Map<string, GraphEdge>();
  for (const e of deps.edges) {
    if (e.from === e.to) continue;
    for (const end of [e.from, e.to]) {
      if (nodes.has(end)) continue;
      warnings.push(`edge endpoint ${end} is not in nodes; added as a placeholder`);
      nodes.set(end, {
        id: end,
        kind: KIND_BY_PREFIX[prefixOf(end)] ?? prefixOf(end),
        name: nameOf(end),
        path: '',
        loc: 0,
        pocketId: '',
        domainId: '',
        meta: { placeholder: true },
      });
    }
    const confidence = e.confidence ?? 'extracted';
    const key = `${e.from}|${e.to}|${e.rel}`;
    const prev = edges.get(key);
    if (!prev) {
      edges.set(key, { src: e.from, dst: e.to, kind: e.rel, count: 1, confidence, detail: e.via ?? '', evidence: e.evidence });
      continue;
    }
    prev.count++;
    if (RANK[confidence] > RANK[prev.confidence]) Object.assign(prev, { confidence, detail: e.via ?? prev.detail, evidence: e.evidence });
  }

  const sortedEdges = [...edges.values()].sort((a, b) => `${a.src}|${a.dst}|${a.kind}`.localeCompare(`${b.src}|${b.dst}|${b.kind}`));
  const kindOf = (id: string) => nodes.get(id)!.kind;

  const transactions = sortedEdges
    .filter((e) => e.kind === 'starts' && kindOf(e.src) === 'transaction')
    .map((e) => ({
      id: e.src,
      name: nameOf(e.src),
      program: e.dst,
      description: String(nodes.get(e.src)!.meta.description ?? ''),
    }));

  const jobs = [...nodes.values()]
    .filter((n) => n.kind === 'job')
    .map((j) => ({
      id: j.id,
      name: j.name,
      programs: [
        ...new Set(
          deps.edges
            .filter((e) => e.from === j.id && e.rel === 'runs' && nodes.get(e.to)?.kind === 'program')
            .sort((a, b) => lineOf(a.evidence) - lineOf(b.evidence))
            .map((e) => e.to),
        ),
      ],
    }));

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: sortedEdges,
    transactions,
    jobs,
    unresolved: deps.unresolved,
    warnings,
  };
}
