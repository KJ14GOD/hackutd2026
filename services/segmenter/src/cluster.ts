// Community detection on the program projection. Pure and deterministic for a given seed.
//
// Louvain can return communities that are internally disconnected (Leiden fixes this, but
// there is no maintained Leiden for JS), so every community is split into its connected
// components afterwards. Communities over the LOC cap are re-clustered at a higher
// resolution, up to maxSplitDepth times; what still does not fit is flagged oversized.
import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';

export interface WeightedGraph {
  nodes: string[]; // sorted
  weight: (a: string, b: string) => number; // 0 when no edge
  neighbors: Map<string, string[]>;
}

/** mulberry32: tiny seeded PRNG so runs are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weightedGraph(nodes: string[], pairs: Map<string, { weight: number }>): WeightedGraph {
  const set = new Set(nodes);
  const w = new Map<string, number>();
  const neighbors = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const [key, p] of pairs) {
    const [a, b] = key.split('|');
    if (!set.has(a) || !set.has(b) || p.weight <= 0) continue;
    w.set(key, p.weight);
    neighbors.get(a)!.push(b);
    neighbors.get(b)!.push(a);
  }
  for (const list of neighbors.values()) list.sort();
  return {
    nodes: [...nodes].sort(),
    weight: (a, b) => w.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0,
    neighbors,
  };
}

/** Louvain over the subgraph induced by `members`. Returns groups of node ids, each sorted. */
export function louvainGroups(g: WeightedGraph, members: string[], resolution: number, seed: number): string[][] {
  const inside = new Set(members);
  const graph = new UndirectedGraph();
  for (const n of [...members].sort()) graph.addNode(n);
  for (const a of [...members].sort()) {
    for (const b of g.neighbors.get(a) ?? []) {
      if (a < b && inside.has(b)) graph.addEdge(a, b, { weight: g.weight(a, b) });
    }
  }
  if (graph.size === 0) return members.map((m) => [m]).sort(byFirst);
  const mapping = louvain(graph, { resolution, rng: rng(seed), getEdgeWeight: 'weight' });
  const groups = new Map<number, string[]>();
  for (const n of graph.nodes()) {
    const c = mapping[n];
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(n);
  }
  return [...groups.values()].map((x) => x.sort()).sort(byFirst);
}

/** Splits a group into its connected components (inside the group). */
export function components(g: WeightedGraph, group: string[]): string[][] {
  const inside = new Set(group);
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const start of [...group].sort()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const m of g.neighbors.get(n) ?? []) {
        if (inside.has(m) && !seen.has(m)) {
          seen.add(m);
          stack.push(m);
        }
      }
    }
    out.push(comp.sort());
  }
  return out.sort(byFirst);
}

export interface ClusterOptions {
  resolution: number;
  splitResolutionFactor: number;
  maxPocketLoc: number;
  maxSplitDepth: number;
  seed: number;
}

export interface Cluster {
  members: string[];
  oversized: boolean;
}

export function clusterPrograms(g: WeightedGraph, loc: Map<string, number>, opt: ClusterOptions): Cluster[] {
  const size = (group: string[]) => group.reduce((s, n) => s + (loc.get(n) ?? 0), 0);
  const out: Cluster[] = [];
  const settle = (group: string[], depth: number) => {
    if (size(group) <= opt.maxPocketLoc || group.length === 1) {
      out.push({ members: group, oversized: size(group) > opt.maxPocketLoc });
      return;
    }
    // Too big: try higher resolutions until it breaks apart or we run out of depth.
    for (let d = depth + 1; d <= opt.maxSplitDepth; d++) {
      const resolution = opt.resolution * opt.splitResolutionFactor ** d;
      const parts = louvainGroups(g, group, resolution, opt.seed + d).flatMap((p) => components(g, p));
      if (parts.length > 1) {
        for (const p of parts) settle(p, d);
        return;
      }
    }
    out.push({ members: group, oversized: true });
  };
  const top = louvainGroups(g, g.nodes, opt.resolution, opt.seed).flatMap((p) => components(g, p));
  for (const group of top) settle(group, 0);
  return out.sort((a, b) => byFirst(a.members, b.members));
}

/** Newman modularity of a partition of a weighted graph (resolution 1). */
export function modularity(g: WeightedGraph, groups: string[][]): number {
  const community = new Map<string, number>();
  groups.forEach((grp, i) => grp.forEach((n) => community.set(n, i)));
  let m2 = 0; // 2m: sum of weighted degrees
  const degree = new Map<string, number>();
  const internal = new Array(groups.length).fill(0); // sum of internal edge weights (each once)
  for (const a of g.nodes) {
    for (const b of g.neighbors.get(a) ?? []) {
      const w = g.weight(a, b);
      degree.set(a, (degree.get(a) ?? 0) + w);
      m2 += w;
      if (a < b && community.has(a) && community.get(a) === community.get(b)) internal[community.get(a)!] += w;
    }
  }
  if (m2 === 0) return 0;
  let q = 0;
  groups.forEach((grp, i) => {
    const d = grp.reduce((s, n) => s + (degree.get(n) ?? 0), 0);
    q += (2 * internal[i]) / m2 - (d / m2) ** 2;
  });
  return q;
}

const byFirst = (a: string[], b: string[]) => (a[0] ?? '').localeCompare(b[0] ?? '');
