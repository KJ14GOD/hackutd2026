// Projects the dependency graph onto programs: one weighted, undirected program-to-program
// graph that the clustering runs on. Pure. docs/SEGMENTATION.md ("Projection") explains it.
import type { TheseusConfig } from '@theseus/shared';
import type { GraphEdge, GraphNode } from './types';

export type SegConfig = TheseusConfig['segmentation'];

export interface Projection {
  /** code node ids that get clustered, sorted, hubs excluded */
  nodes: string[];
  /** hub programs (talk to too many others); they go to the shared pocket */
  hubs: string[];
  /** resources skipped because too many programs touch them */
  omnipresent: string[];
  /** `a|b` (a < b) -> weight and the weight each source contributed. Includes hub pairs. */
  pairs: Map<string, { weight: number; kinds: Record<string, number> }>;
  /** node id -> LOC, for the size cap */
  loc: Map<string, number>;
  /** edges the projection does not use, grouped as `rel` or `rel -> kind`, with counts */
  ignored: Map<string, number>;
}

/** Program -> program rels that count directly (weights in segmentation.edgeWeights). */
export const DIRECT_RELS = new Set(['calls', 'links', 'transfers', 'cochange']);
/** Program -> resource rels that make programs share a resource. */
const ACCESS_RELS = new Set(['read', 'write', 'copies', 'shows']);
/** Rels the segmenter understands but that do not link programs to each other. */
const OTHER_RELS = new Set(['starts', 'uses-api', 'runs']);

/** Clustered code: programs with source. Utilities, system APIs, missing programs are not. */
export const isCodeNode = (n: GraphNode) => n.kind === 'program' && n.path !== '';

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Repeated references count, but with diminishing returns. */
export const countFactor = (count: number) => 1 + Math.log2(Math.max(1, count));

export function project(nodes: GraphNode[], edges: GraphEdge[], cfg: SegConfig): Projection {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const code = nodes.filter(isCodeNode).map((n) => n.id).sort();
  const codeSet = new Set(code);
  const pairs: Projection['pairs'] = new Map();
  const ignored = new Map<string, number>();
  const ignore = (why: string) => ignored.set(why, (ignored.get(why) ?? 0) + 1);
  const add = (a: string, b: string, kind: string, w: number) => {
    if (a === b || w <= 0) return;
    const key = pairKey(a, b);
    const p = pairs.get(key) ?? { weight: 0, kinds: {} };
    p.weight += w;
    p.kinds[kind] = (p.kinds[kind] ?? 0) + w;
    pairs.set(key, p);
  };
  const conf = (e: GraphEdge) => cfg.confidence[e.confidence];
  const resourceWeight = (kind: string): number | undefined => cfg.resourceWeights[kind];
  // Copybooks with no source here are system includes (DFHAID, CMQV): not app coupling.
  const isSystemCopybook = (n: GraphNode) => n.kind === 'copybook' && !n.path;

  // 1. Direct program-to-program edges.
  for (const e of edges) {
    if (!DIRECT_RELS.has(e.kind)) continue;
    if (!codeSet.has(e.src) || !codeSet.has(e.dst)) {
      ignore(`${e.kind} to non-code`);
      continue;
    }
    add(e.src, e.dst, e.kind, cfg.edgeWeights[e.kind as keyof SegConfig['edgeWeights']] * conf(e) * countFactor(e.count));
  }

  // 2. Shared resources: everyone who touches the same resource is linked.
  const accessors = new Map<string, Map<string, { rel: string; conf: number }>>();
  const touch = (resource: string, program: string, rel: string, c: number) => {
    const m = accessors.get(resource) ?? new Map();
    const prev = m.get(program);
    // write beats read; anything beats nothing
    const best = prev && (prev.rel === 'write' || rel !== 'write') ? prev.rel : rel;
    m.set(program, { rel: best, conf: Math.max(prev?.conf ?? 0, c) });
    accessors.set(resource, m);
  };
  for (const e of edges) {
    if (DIRECT_RELS.has(e.kind)) continue;
    if (ACCESS_RELS.has(e.kind) && codeSet.has(e.src)) {
      const target = byId.get(e.dst)!;
      if (isSystemCopybook(target)) continue;
      if (resourceWeight(target.kind) === undefined) ignore(`${e.kind} -> ${target.kind}`);
      else touch(e.dst, e.src, e.kind, conf(e));
    } else if (e.kind === 'runs' && codeSet.has(e.dst) && resourceWeight('job') !== undefined) {
      touch(e.src, e.dst, 'runs', conf(e)); // programs run by the same job are related
    } else if (!ACCESS_RELS.has(e.kind) && !OTHER_RELS.has(e.kind)) {
      ignore(e.kind);
    }
  }

  const omnipresent: string[] = [];
  const access = (a: string, b: string) => {
    const rw = (r: string) => r === 'read' || r === 'write';
    if (!rw(a) || !rw(b)) return 1; // copybooks, screens, jobs: no access mode
    if (a === 'write' && b === 'write') return cfg.accessFactor.writeWrite;
    if (a === 'write' || b === 'write') return cfg.accessFactor.readWrite;
    return cfg.accessFactor.readRead;
  };
  for (const [resource, progs] of [...accessors].sort(([a], [b]) => a.localeCompare(b))) {
    const n = progs.size;
    if (n < 2) continue;
    if (code.length > 2 && n / code.length > cfg.omnipresentThreshold) {
      omnipresent.push(resource);
      continue;
    }
    const kind = byId.get(resource)!.kind;
    const base = resourceWeight(kind)! / (cfg.hubDampening ? n - 1 : 1);
    const list = [...progs].sort(([a], [b]) => a.localeCompare(b));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, ai] = list[i];
        const [b, bi] = list[j];
        add(a, b, kind, base * access(ai.rel, bi.rel) * Math.min(ai.conf, bi.conf));
      }
    }
  }

  // 3. Hub programs: directly invoke or are invoked by too many distinct programs (menus, sign-on).
  const neighbors = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.kind === 'cochange' || !DIRECT_RELS.has(e.kind) || !codeSet.has(e.src) || !codeSet.has(e.dst)) continue;
    if (cfg.confidence[e.confidence] === 0) continue;
    for (const [x, y] of [[e.src, e.dst], [e.dst, e.src]]) {
      if (!neighbors.has(x)) neighbors.set(x, new Set());
      neighbors.get(x)!.add(y);
    }
  }
  const hubs = code.filter((id) => code.length > 2 && (neighbors.get(id)?.size ?? 0) / (code.length - 1) > cfg.hubThreshold);
  const hubSet = new Set(hubs);

  return {
    nodes: code.filter((id) => !hubSet.has(id)),
    hubs,
    omnipresent,
    pairs,
    loc: new Map(code.map((id) => [id, byId.get(id)!.loc])),
    ignored,
  };
}
