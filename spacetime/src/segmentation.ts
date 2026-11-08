// Pure: turns the segmenter's JSON (services/segmenter/src/types.ts, SegmentationResult) into
// table rows. No SpacetimeDB imports so it can be unit tested. Throws Error on bad input.

export interface SegmentationRows {
  run: {
    sourceRoot: string;
    sourceRef: string;
    depsPath: string;
    depsHash: string;
    configHash: string;
    metricsJson: string;
    warningsJson: string;
    unresolvedJson: string;
  };
  nodes: { id: string; kind: string; name: string; path: string; loc: number; pocketId: string; domainId: string; metaJson: string }[];
  edges: { src: string; dst: string; kind: string; count: number; confidence: string; detail: string; evidence: string }[];
  pockets: {
    id: string;
    parentId: string;
    level: string;
    kind: string;
    name: string;
    anchor: string;
    programs: number;
    loc: number;
    cohesion: number;
    coupling: number;
    isolation: number;
    oversized: boolean;
  }[];
  pocketEdges: { level: string; src: string; dst: string; weight: number; kindsJson: string }[];
  endpoints: { id: string; kind: string; name: string; description: string; entryNode: string; pocketId: string; servedByJson: string }[];
}

type Obj = Record<string, unknown>;

const str = (o: Obj, k: string, where: string): string => {
  if (typeof o[k] !== 'string') throw new Error(`${where}.${k}: expected string`);
  return o[k] as string;
};
const num = (o: Obj, k: string, where: string): number => {
  if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) throw new Error(`${where}.${k}: expected number`);
  return o[k] as number;
};
const u32 = (o: Obj, k: string, where: string): number => {
  const v = num(o, k, where);
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`${where}.${k}: expected u32`);
  return v;
};
const list = (o: Obj, k: string): Obj[] => {
  if (!Array.isArray(o[k])) throw new Error(`${k}: expected array`);
  return o[k] as Obj[];
};

export function parseSegmentation(json: string): SegmentationRows {
  let root: Obj;
  try {
    root = JSON.parse(json) as Obj;
  } catch {
    throw new Error('invalid JSON');
  }
  if (root?.version !== 2) throw new Error(`unsupported segmentation version ${String(root?.version)} (expected 2)`);
  const source = (root.source ?? {}) as Obj;

  const rows: SegmentationRows = {
    run: {
      sourceRoot: str(source, 'root', 'source'),
      sourceRef: str(source, 'ref', 'source'),
      depsPath: str(source, 'deps', 'source'),
      depsHash: str(source, 'depsHash', 'source'),
      configHash: str(root, 'configHash', 'root'),
      metricsJson: JSON.stringify(root.metrics ?? {}),
      warningsJson: JSON.stringify(root.warnings ?? []),
      unresolvedJson: JSON.stringify(root.unresolved ?? []),
    },
    nodes: list(root, 'nodes').map((n, i) => ({
      id: str(n, 'id', `nodes[${i}]`),
      kind: str(n, 'kind', `nodes[${i}]`),
      name: str(n, 'name', `nodes[${i}]`),
      path: str(n, 'path', `nodes[${i}]`),
      loc: u32(n, 'loc', `nodes[${i}]`),
      pocketId: str(n, 'pocketId', `nodes[${i}]`),
      domainId: str(n, 'domainId', `nodes[${i}]`),
      metaJson: JSON.stringify(n.meta ?? {}),
    })),
    edges: list(root, 'edges').map((e, i) => ({
      src: str(e, 'src', `edges[${i}]`),
      dst: str(e, 'dst', `edges[${i}]`),
      kind: str(e, 'kind', `edges[${i}]`),
      count: u32(e, 'count', `edges[${i}]`),
      confidence: str(e, 'confidence', `edges[${i}]`),
      detail: str(e, 'detail', `edges[${i}]`),
      evidence: str(e, 'evidence', `edges[${i}]`),
    })),
    pockets: list(root, 'pockets').map((p, i) => ({
      id: str(p, 'id', `pockets[${i}]`),
      parentId: str(p, 'parentId', `pockets[${i}]`),
      level: str(p, 'level', `pockets[${i}]`),
      kind: str(p, 'kind', `pockets[${i}]`),
      name: str(p, 'name', `pockets[${i}]`),
      anchor: str(p, 'anchor', `pockets[${i}]`),
      programs: u32(p, 'programs', `pockets[${i}]`),
      loc: u32(p, 'loc', `pockets[${i}]`),
      cohesion: num(p, 'cohesion', `pockets[${i}]`),
      coupling: num(p, 'coupling', `pockets[${i}]`),
      isolation: num(p, 'isolation', `pockets[${i}]`),
      oversized: p.oversized === true,
    })),
    pocketEdges: list(root, 'pocketEdges').map((e, i) => ({
      level: str(e, 'level', `pocketEdges[${i}]`),
      src: str(e, 'src', `pocketEdges[${i}]`),
      dst: str(e, 'dst', `pocketEdges[${i}]`),
      weight: num(e, 'weight', `pocketEdges[${i}]`),
      kindsJson: JSON.stringify(e.kinds ?? {}),
    })),
    endpoints: list(root, 'endpoints').map((e, i) => ({
      id: str(e, 'id', `endpoints[${i}]`),
      kind: str(e, 'kind', `endpoints[${i}]`),
      name: str(e, 'name', `endpoints[${i}]`),
      description: str(e, 'description', `endpoints[${i}]`),
      entryNode: str(e, 'entryNode', `endpoints[${i}]`),
      pocketId: str(e, 'pocketId', `endpoints[${i}]`),
      servedByJson: JSON.stringify(Array.isArray(e.servedBy) ? e.servedBy : []),
    })),
  };

  // Referential checks: every node/endpoint points at a pocket that exists.
  const pocketIds = new Set(rows.pockets.map((p) => p.id));
  if (pocketIds.size !== rows.pockets.length) throw new Error('duplicate pocket id');
  if (new Set(rows.nodes.map((n) => n.id)).size !== rows.nodes.length) throw new Error('duplicate node id');
  for (const n of rows.nodes) if (n.pocketId && !pocketIds.has(n.pocketId)) throw new Error(`node ${n.id}: unknown pocket ${n.pocketId}`);
  for (const p of rows.pockets) if (p.parentId && !pocketIds.has(p.parentId)) throw new Error(`pocket ${p.id}: unknown parent ${p.parentId}`);
  for (const e of rows.endpoints) if (!pocketIds.has(e.pocketId)) throw new Error(`endpoint ${e.id}: unknown pocket ${e.pocketId}`);
  return rows;
}
