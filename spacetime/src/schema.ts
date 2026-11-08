// All SpacetimeDB tables. docs/DATA_MODEL.md is the source of truth for this schema:
// change both in the same commit (and keep schema changes in their own small PR, TASKS.md).
// Tables are camelCase here; SQL and the CLI see them as snake_case (graphNode -> graph_node).
import { schema, table, t } from 'spacetimedb/server';

const spacetimedb = schema({
  /** theseus.config.json as last pushed with `pnpm config:push`. Single row, id 0. */
  config: table(
    { public: true },
    {
      id: t.u32().primaryKey(),
      json: t.string(),
      version: t.u32(),
    },
  ),

  // ---- Segmentation (written only by loadSegmentation; docs/SEGMENTATION.md) ----

  /** The last segmentation run. Single row, id 0. */
  segmentationRun: table(
    { public: true },
    {
      id: t.u32().primaryKey(),
      sourceRoot: t.string(), // e.g. legacy/carddemo
      sourceRef: t.string(), // git commit of the legacy source
      depsPath: t.string(), // the deps.json that was segmented (docs/GRAPH_SCHEMA.md)
      depsHash: t.string(), // sha256 prefix of that file
      configHash: t.string(), // hash of the segmentation config used
      loadedAtMs: t.f64(), // real time of the load (provenance only, not sim time)
      metricsJson: t.string(), // modularity, cross-pocket weight share, sizes, ...
      warningsJson: t.string(),
      unresolvedJson: t.string(), // deps.json `unresolved`: references the extractor could not resolve
    },
  ),

  /** Every node of the dependency graph: programs, copybooks, datasets, jobs, ... */
  graphNode: table(
    { public: true },
    {
      id: t.string().primaryKey(), // deps.json id, e.g. prog:COACTUPC, data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS
      kind: t.string().index('btree'),
      name: t.string(),
      path: t.string(), // repo-relative source path, '' when the node has no file
      loc: t.u32(),
      pocketId: t.string().index('btree'), // '' for utilities, system APIs and missing programs
      domainId: t.string(),
      metaJson: t.string(),
    },
  ),

  depEdge: table(
    { public: true },
    {
      id: t.u32().primaryKey().autoInc(),
      src: t.string().index('btree'),
      dst: t.string().index('btree'),
      kind: t.string(), // deps.json rel: calls | links | transfers | copies | read | write | runs | starts | uses-api | shows | ... plus cochange
      count: t.u32(), // how many times the pair repeats in deps.json
      confidence: t.string(), // extracted | inferred | unknown | observed
      detail: t.string(), // deps.json `via`
      evidence: t.string(), // file:line, CSD, or git log
    },
  ),

  /** Domains and pockets share the table (`level`). */
  pocket: table(
    { public: true },
    {
      id: t.string().primaryKey(), // pkt-<anchor> / dom-<anchor>, plus pkt-shared / dom-shared
      parentId: t.string().index('btree'), // domain id for pockets, '' for domains
      level: t.string(), // domain | pocket
      kind: t.string(), // code | shared
      name: t.string(),
      anchor: t.string(), // node id of the program the pocket is named after
      programs: t.u32(),
      loc: t.u32(),
      cohesion: t.f64(),
      coupling: t.f64(),
      isolation: t.f64(), // cohesion / (cohesion + coupling)
      oversized: t.bool(), // over segmentation.maxPocketLoc and could not be split
    },
  ),

  /** Aggregated weights between pockets (and between domains) for the UI to draw. */
  pocketEdge: table(
    { public: true },
    {
      id: t.u32().primaryKey().autoInc(),
      level: t.string(),
      src: t.string(),
      dst: t.string(),
      weight: t.f64(),
      kindsJson: t.string(), // weight per source kind, e.g. {"dataset":3.2,"calls":1}
    },
  ),

  /** What traffic hits: CICS transactions and batch jobs. */
  endpoint: table(
    { public: true },
    {
      id: t.string().primaryKey(), // 'CICS CAVW' | 'JOB INTCALC'
      kind: t.string(), // cics | batch
      name: t.string(),
      description: t.string(),
      entryNode: t.string(), // program node id
      pocketId: t.string().index('btree'), // pocket of the entry program
      servedByJson: t.string(), // pockets the request can reach (entry pocket first)
    },
  ),
});

export default spacetimedb;
