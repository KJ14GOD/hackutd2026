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

  // ---- People, questions, outreach and the harness feed (docs/REQUIREMENTS_IMPLEMENTATION.md §3.2-3.3) ----

  // People and ownership (Phase 3, services/people). Rebuilt as a whole by loadOrg.
  person: table({ public: true }, {
    id: t.string().primaryKey(),
    name: t.string(),
    title: t.string(),
    team: t.string().index('btree'),
    active: t.bool(),
    emailsJson: t.string(),
    source: t.string(),
  }),
  team: table({ public: true }, { id: t.string().primaryKey(), name: t.string(), parentTeamId: t.string() }),
  reportsTo: table({ public: true }, {
    id: t.u64().primaryKey().autoInc(),
    personId: t.string().index('btree'),
    managerId: t.string().index('btree'),
    source: t.string(),
  }),
  ownership: table({ public: true }, {
    id: t.u64().primaryKey().autoInc(),
    personId: t.string().index('btree'),
    target: t.string().index('btree'),
    kind: t.string(),
    signal: t.string(),
    weight: t.f64(),
    source: t.string(),
    evidence: t.string(),
    observedAt: t.string(),
  }),
  /** A possible same-person pair sharing no email: pending until someone merges or rejects it. */
  identityMatch: table({ public: true }, { id: t.string().primaryKey(), aRef: t.string(), bRef: t.string(), evidence: t.string(), status: t.string() }),
  approver: table({ public: true }, {
    id: t.string().primaryKey(),
    personId: t.string().index('btree'),
    scope: t.string().index('btree'),
    category: t.string(),
    score: t.f64(),
    evidenceJson: t.string(),
    signedOffBy: t.string(),
  }),

  /**
   * A question from Part 2 (Nemotron's read) with what Phase 4 found. status: answered-by-docs | known-issue |
   * conflict | needs-person | asking | answered.
   */
  question: table({ public: true }, {
    id: t.string().primaryKey(),
    program: t.string().index('btree'),
    text: t.string(),
    evidenceJson: t.string(),
    optionsJson: t.string(),
    blocks: t.string(),
    status: t.string().index('btree'),
    verdict: t.string(),
    answer: t.string(),
    quotesJson: t.string(),
    confidence: t.string(),
    routeTo: t.string().index('btree'),
    routeName: t.string(),
    routeWhy: t.string(),
    answeredBy: t.string(),
    answerText: t.string(),
    answeredAtMs: t.u64(),
  }),

  /** One question sent to one person; questions to the same person and program share a digestKey (one message). */
  outreach: table({ public: true }, {
    id: t.u64().primaryKey().autoInc(),
    questionId: t.string().index('btree'),
    digestKey: t.string().index('btree'),
    recipientPersonId: t.string().index('btree'),
    channel: t.string(),
    rendering: t.string(),
    urgency: t.string(),
    step: t.string(),
    status: t.string().index('btree'),
    slackTs: t.string(),
    slackChannel: t.string(),
    nextActionAtMs: t.u64(),
    sentAtMs: t.u64(),
  }),

  /** One harness run over a program. status: reading | looking-up | asking | waiting | resuming | done | failed. */
  harnessJob: table({ public: true }, {
    id: t.string().primaryKey(),
    program: t.string().index('btree'),
    status: t.string().index('btree'),
    /** Question ids the job is paused on. */
    waitingOnJson: t.string(),
    /** Whatever the worker needs to pick up where it stopped. */
    stateJson: t.string(),
    startedAtMs: t.u64(),
    updatedAtMs: t.u64(),
  }),
  /** The live step feed: what the harness did, who it's waiting on, and who answered. */
  harnessEvent: table({ public: true }, {
    id: t.u64().primaryKey().autoInc(),
    jobId: t.string().index('btree'),
    atMs: t.u64(),
    kind: t.string(),
    message: t.string(),
    dataJson: t.string(),
  }),
});

export default spacetimedb;
