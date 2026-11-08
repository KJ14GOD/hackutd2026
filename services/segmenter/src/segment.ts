// The whole segmentation, from a built graph to the result the CLI writes and publishes. Pure.
import { createHash } from 'node:crypto';
import { SHARED_POCKET, assignNodes } from './assign';
import { clusterPrograms, components, louvainGroups, modularity, weightedGraph, type WeightedGraph } from './cluster';
import { buildEndpoints } from './endpoints';
import type { BuiltGraph } from './deps';
import { isCodeNode, project, type Projection, type SegConfig } from './project';
import type { Metrics, Pocket, PocketEdge, SegmentationResult } from './segmentTypes';

export const SHARED_DOMAIN = 'dom-shared';

const round = (x: number) => Math.round(x * 1e4) / 1e4;
const isolationOf = (cohesion: number, coupling: number) => (cohesion + coupling === 0 ? 1 : cohesion / (cohesion + coupling));

/** Cohesion/coupling per group from projected pairs. Pairs touching `ignore` groups are left out. */
function groupWeights(proj: Projection, groupOf: (n: string) => string | undefined, ignore: Set<string>) {
  const cohesion = new Map<string, number>();
  const coupling = new Map<string, number>();
  const cross = new Map<string, PocketEdge>();
  for (const [key, p] of proj.pairs) {
    const [a, b] = key.split('|');
    const ga = groupOf(a);
    const gb = groupOf(b);
    if (!ga || !gb) continue;
    if (ga === gb) {
      cohesion.set(ga, (cohesion.get(ga) ?? 0) + p.weight);
      continue;
    }
    const [s, d] = ga < gb ? [ga, gb] : [gb, ga];
    const e = cross.get(`${s}|${d}`) ?? { level: 'pocket', src: s, dst: d, weight: 0, kinds: {} };
    e.weight += p.weight;
    for (const [k, w] of Object.entries(p.kinds)) e.kinds[k] = (e.kinds[k] ?? 0) + w;
    cross.set(`${s}|${d}`, e);
    if (ignore.has(ga) || ignore.has(gb)) continue;
    coupling.set(ga, (coupling.get(ga) ?? 0) + p.weight);
    coupling.set(gb, (coupling.get(gb) ?? 0) + p.weight);
  }
  return { cohesion, coupling, cross: [...cross.values()] };
}

/** The member with the highest weighted degree inside the group (ties: name). */
function anchorOf(g: WeightedGraph, members: string[]): string {
  const inside = new Set(members);
  let best = members[0];
  let bestW = -1;
  for (const m of [...members].sort()) {
    const w = (g.neighbors.get(m) ?? []).filter((n) => inside.has(n)).reduce((s, n) => s + g.weight(m, n), 0);
    if (w > bestW) [best, bestW] = [m, w];
  }
  return best;
}

const nameOf = (id: string) => id.slice(id.indexOf(':') + 1);

export function segment(graph: BuiltGraph, cfg: SegConfig, source: SegmentationResult['source']): SegmentationResult {
  const warnings = [...graph.warnings];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const proj = project(graph.nodes, graph.edges, cfg);
  const g = weightedGraph(proj.nodes, proj.pairs);
  const clusters = clusterPrograms(g, proj.loc, {
    resolution: cfg.resolution.pocket,
    splitResolutionFactor: cfg.splitResolutionFactor,
    maxPocketLoc: cfg.maxPocketLoc,
    maxSplitDepth: cfg.maxSplitDepth,
    seed: cfg.seed,
  });

  // Pockets of programs.
  const programPocket = new Map<string, string>();
  const pocketMeta = new Map<string, { anchor: string; oversized: boolean; programs: string[] }>();
  for (const c of clusters) {
    const anchor = anchorOf(g, c.members);
    const id = `pkt-${nameOf(anchor).toLowerCase()}`;
    pocketMeta.set(id, { anchor, oversized: c.oversized, programs: c.members });
    for (const m of c.members) programPocket.set(m, id);
  }
  for (const h of proj.hubs) programPocket.set(h, SHARED_POCKET);
  if (proj.hubs.length) warnings.push(`hub programs moved to ${SHARED_POCKET}: ${proj.hubs.map(nameOf).join(', ')}`);
  if (proj.omnipresent.length) warnings.push(`omnipresent resources ignored for clustering: ${proj.omnipresent.join(', ')}`);
  if (proj.ignored.size) warnings.push(`edges not used for clustering: ${[...proj.ignored].map(([k, n]) => `${k} (${n})`).join(', ')}`);

  const pocketOf = assignNodes(graph.nodes, graph.edges, programPocket, {
    ownershipMin: cfg.resourceOwnershipMin,
    resourceKinds: new Set(Object.keys(cfg.resourceWeights)),
  });
  const members = new Map<string, string[]>();
  for (const [node, pocket] of [...pocketOf].sort(([a], [b]) => a.localeCompare(b))) {
    if (!pocket) continue;
    if (!members.has(pocket)) members.set(pocket, []);
    members.get(pocket)!.push(node);
  }

  // Cohesion and coupling. Coupling to the shared pocket does not count against isolation.
  const pw = groupWeights(proj, (n) => programPocket.get(n), new Set([SHARED_POCKET]));

  // Domains: Louvain again, on the pocket graph.
  const codePockets = [...pocketMeta.keys()].sort();
  const pocketPairs = new Map(
    pw.cross.filter((e) => e.src !== SHARED_POCKET && e.dst !== SHARED_POCKET).map((e) => [`${e.src}|${e.dst}`, { weight: e.weight }]),
  );
  const pg = weightedGraph(codePockets, pocketPairs);
  const domainGroups = louvainGroups(pg, codePockets, cfg.resolution.domain, cfg.seed).flatMap((grp) => components(pg, grp));
  const pocketDomain = new Map<string, string>([[SHARED_POCKET, SHARED_DOMAIN]]);
  const domainIds: { id: string; anchor: string; pockets: string[] }[] = [];
  for (const grp of domainGroups) {
    const anchorPocket = grp.length === 1 ? grp[0] : anchorOf(pg, grp);
    const id = `dom-${anchorPocket.slice('pkt-'.length)}`;
    domainIds.push({ id, anchor: pocketMeta.get(anchorPocket)!.anchor, pockets: grp });
    for (const p of grp) pocketDomain.set(p, id);
  }
  const dw = groupWeights(proj, (n) => pocketDomain.get(programPocket.get(n) ?? ''), new Set([SHARED_DOMAIN]));

  // Names: the description of a transaction that starts the anchor (or any member), else the anchor.
  const tidy = (d: string) =>
    d
      .replace(/^(CREDIT CARD DEMO|CARDDEMO|CARD DEMO)\s+/, '')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const txByProgram = new Map(graph.transactions.filter((t) => t.description).map((t) => [t.program, tidy(t.description)]));
  const pocketName = (anchor: string, programs: string[]) =>
    txByProgram.get(anchor) || programs.map((p) => txByProgram.get(p)).find(Boolean) || nameOf(anchor);

  const locOf = (ids: string[]) => ids.reduce((s, id) => s + (proj.loc.get(id) ?? 0), 0);
  const pockets: Pocket[] = [];
  for (const id of codePockets) {
    const meta = pocketMeta.get(id)!;
    const c = pw.cohesion.get(id) ?? 0;
    const k = pw.coupling.get(id) ?? 0;
    pockets.push({
      id,
      name: pocketName(meta.anchor, meta.programs),
      level: 'pocket',
      parentId: pocketDomain.get(id)!,
      anchor: meta.anchor,
      members: members.get(id) ?? [],
      programs: meta.programs.length,
      loc: locOf(meta.programs),
      cohesion: round(c),
      coupling: round(k),
      isolation: round(isolationOf(c, k)),
      oversized: meta.oversized,
      kind: 'code',
    });
  }
  const sharedMembers = members.get(SHARED_POCKET) ?? [];
  if (sharedMembers.length) {
    pockets.push({
      id: SHARED_POCKET,
      name: 'Shared',
      level: 'pocket',
      parentId: SHARED_DOMAIN,
      anchor: '',
      members: sharedMembers,
      programs: proj.hubs.length,
      loc: locOf(proj.hubs),
      cohesion: 0,
      coupling: 0,
      isolation: 0,
      oversized: false,
      kind: 'shared',
    });
  }
  for (const d of domainIds) {
    const c = dw.cohesion.get(d.id) ?? 0;
    const k = dw.coupling.get(d.id) ?? 0;
    const progs = d.pockets.flatMap((p) => pocketMeta.get(p)!.programs);
    pockets.push({
      id: d.id,
      name: pocketName(d.anchor, progs),
      level: 'domain',
      parentId: '',
      anchor: d.anchor,
      members: d.pockets,
      programs: progs.length,
      loc: locOf(progs),
      cohesion: round(c),
      coupling: round(k),
      isolation: round(isolationOf(c, k)),
      oversized: false,
      kind: 'code',
    });
  }
  if (sharedMembers.length) {
    pockets.push({
      id: SHARED_DOMAIN,
      name: 'Shared',
      level: 'domain',
      parentId: '',
      anchor: '',
      members: [SHARED_POCKET],
      programs: proj.hubs.length,
      loc: locOf(proj.hubs),
      cohesion: 0,
      coupling: 0,
      isolation: 0,
      oversized: false,
      kind: 'shared',
    });
  }

  const roundEdge = (e: PocketEdge): PocketEdge => ({
    ...e,
    weight: round(e.weight),
    kinds: Object.fromEntries(Object.entries(e.kinds).sort().map(([k, w]) => [k, round(w)])),
  });
  const pocketEdges = [
    ...pw.cross.map((e) => roundEdge({ ...e, level: 'pocket' })),
    ...dw.cross.map((e) => roundEdge({ ...e, level: 'domain' })),
  ].sort((a, b) => `${a.level}|${a.src}|${a.dst}`.localeCompare(`${b.level}|${b.src}|${b.dst}`));

  const nodes = graph.nodes.map((n) => {
    const pocketId = pocketOf.get(n.id) ?? '';
    return { ...n, pocketId, domainId: pocketId ? (pocketDomain.get(pocketId) ?? '') : '' };
  });
  const endpoints = buildEndpoints(graph, pocketOf, new Set(proj.hubs));

  // Metrics, over the clustered programs (hubs excluded, as in clustering).
  const sizes = clusters.map((c) => c.members.length).sort((a, b) => a - b);
  let total = 0;
  let crossing = 0;
  for (const [key, p] of proj.pairs) {
    const [a, b] = key.split('|');
    if (proj.hubs.includes(a) || proj.hubs.includes(b)) continue;
    total += p.weight;
    if (programPocket.get(a) !== programPocket.get(b)) crossing += p.weight;
  }
  const metrics: Metrics = {
    programs: [...nodeById.values()].filter(isCodeNode).length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    pockets: codePockets.length,
    domains: domainIds.length,
    modularity: round(modularity(g, clusters.map((c) => c.members))),
    crossPocketWeightShare: round(total ? crossing / total : 0),
    oversizedPockets: pockets.filter((p) => p.oversized).map((p) => p.id),
    unresolved: graph.unresolved.length,
    ignoredEdges: [...proj.ignored.values()].reduce((a, b) => a + b, 0),
    pocketSizes: {
      min: sizes[0] ?? 0,
      median: sizes.length ? sizes[Math.floor((sizes.length - 1) / 2)] : 0,
      max: sizes[sizes.length - 1] ?? 0,
    },
  };

  return {
    version: 2,
    source,
    configHash: createHash('sha256').update(JSON.stringify(cfg)).digest('hex').slice(0, 16),
    nodes,
    edges: graph.edges,
    pockets,
    pocketEdges,
    endpoints,
    unresolved: graph.unresolved,
    metrics,
    warnings,
  };
}
