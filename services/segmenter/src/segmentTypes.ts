// Shared shapes for the segmenter. docs/SEGMENTATION.md explains each one.
//
// Input: the dependency graph `deps.json` (docs/GRAPH_SCHEMA.md), owned by the extractor.
// Output: `SegmentationResult`, written to out/segmentation.json and sent to the
// loadSegmentation reducer. Node ids, kinds and edge rels are the extractor's, unchanged,
// so every part of the system names things the same way.

/**
 * Node kinds from GRAPH_SCHEMA.md: program, utility, copybook, job, transaction, dataset,
 * system-api; planned prefixes (screen, mq, ims, tsq, tdq, ...) arrive as their prefix.
 * 'missing' = a `prog:` node with no kind and no source (assembler, absent program).
 */
export type NodeKind = string;

/** Edge rels from GRAPH_SCHEMA.md (copies, calls, transfers, links, starts, runs, read,
 * write, uses-api, and planned ones), plus `cochange`, which the segmenter adds from git. */
export type EdgeRel = string;

/** extracted (from a code line), inferred (guess), unknown (placeholder target), observed (runtime trace). */
export type Confidence = 'extracted' | 'inferred' | 'unknown' | 'observed';

export interface GraphNode {
  id: string; // extractor id, e.g. prog:COACTUPC, data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS
  kind: NodeKind;
  name: string; // id without its prefix
  path: string; // repo-relative source path, '' if the node has no file
  loc: number; // source lines (programs), 0 otherwise
  pocketId: string; // '' = unassigned (utilities, system APIs, missing programs)
  domainId: string;
  meta: Record<string, unknown>; // extra node fields from deps.json (mode, description, ...)
}

export interface GraphEdge {
  src: string;
  dst: string;
  kind: EdgeRel;
  count: number; // how many times the extractor listed this (from, to, rel)
  confidence: Confidence; // the best one seen
  detail: string; // `via` from the extractor
  evidence: string; // first `evidence` (file:line or "CSD")
}

/** A reference the extractor could not resolve (GRAPH_SCHEMA.md). These become questions. */
export interface Unresolved {
  program: string;
  what: string;
  token: string;
  at: string;
  inferred?: string[];
}

export interface Pocket {
  id: string;
  name: string;
  level: 'domain' | 'pocket';
  parentId: string;
  anchor: string; // program with the highest internal weighted degree (names the pocket)
  members: string[]; // node ids (pockets) or pocket ids (domains)
  programs: number;
  loc: number;
  cohesion: number;
  coupling: number;
  isolation: number; // cohesion / (cohesion + coupling), 1 when both are 0
  oversized: boolean; // above segmentation.maxPocketLoc and could not be split further
  kind: 'code' | 'shared'; // shared = hub programs + resources with no clear owner
}

export interface PocketEdge {
  level: 'domain' | 'pocket';
  src: string;
  dst: string;
  weight: number;
  kinds: Record<string, number>; // weight contributed per source (rel or resource kind)
}

export interface Endpoint {
  id: string; // 'CICS CAVW' | 'JOB INTCALC'
  kind: 'cics' | 'batch';
  name: string; // transaction id or job name
  description: string;
  entryNode: string; // program node id
  pocketId: string; // pocket of the entry program (of the job, for jobs)
  servedBy: string[]; // pockets reachable through calls/links/transfers, not through hubs
}

export interface Metrics {
  programs: number;
  nodes: number;
  edges: number;
  pockets: number;
  domains: number;
  modularity: number; // Newman modularity of the program projection under the pocket partition
  crossPocketWeightShare: number; // share of projected weight crossing pocket boundaries
  oversizedPockets: string[];
  unresolved: number; // extractor's unresolved references
  ignoredEdges: number; // edges with rels/kinds the segmenter does not use (yet)
  pocketSizes: { min: number; median: number; max: number };
}

export interface SegmentationResult {
  version: 2;
  source: { root: string; ref: string; deps: string; depsHash: string };
  configHash: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  pockets: Pocket[];
  pocketEdges: PocketEdge[];
  endpoints: Endpoint[];
  unresolved: Unresolved[];
  metrics: Metrics;
  warnings: string[];
}
