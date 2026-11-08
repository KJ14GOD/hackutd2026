# Segmentation

> **BUILT** (`services/segmenter/`, tables in `spacetime/src/schema.ts`). The design choices
> marked D-0xx below are logged in [DECISIONS.md](DECISIONS.md); D-019 to D-026 need team
> sign-off.

Goal: split the legacy code into nested **pockets**, code that depends heavily on itself
and only weakly on the rest. Keep the weak cross-pocket edges (with weights) because the
UI draws them. The graph comes from static analysis and git history, **not an LLM**:
the research shows LLMs recover components but not the arrows between them (under 0.18,
with 39% of errors being invented dependencies; R2ABench, see `research/`).

**Input is the dependency graph** (`deps.json`, format in [GRAPH_SCHEMA.md](GRAPH_SCHEMA.md),
D-026). The segmenter does not parse COBOL itself. Anything that writes that format works:
the team extractor (`tools/cobol_deps.py`, [EXTRACTOR_SPIKE.md](EXTRACTOR_SPIKE.md)) or the
TypeScript stand-in in `services/segmenter/src/extract/` (`pnpm deps:extract`).

```sh
pnpm deps:extract            # legacy/carddemo/app -> out/deps.json (stand-in extractor)
pnpm segment                 # out/deps.json -> out/segmentation.json + summary table
pnpm segment --publish       # ... and load it into SpacetimeDB (loadSegmentation)
pnpm segment --deps path/to/deps.json --legacy legacy/carddemo --no-cochange
```

`--legacy` is the git checkout the graph was extracted from. It's used for the commit id
and co-change history; `deps.json` paths are relative to it.

## Pipeline

| Step | File | What |
| --- | --- | --- |
| 1. Read | `deps.ts` | Validate `deps.json` against GRAPH_SCHEMA (zod) and turn it into typed nodes and edges (`fromDeps`). |
| 2. Co-change | `cochange.ts` | `git log --name-only` of the legacy checkout → `cochange` edges between programs. |
| 3. Project | `project.ts` | Collapse the graph to a weighted program-to-program graph (D-021). |
| 4. Cluster | `cluster.ts` | Seeded Louvain + connectivity repair + LOC-driven re-splits (D-022); domains = Louvain on the pocket graph. |
| 5. Assign | `assign.ts` | Every non-program node goes to a pocket (D-023). |
| 6. Measure | `segment.ts` | Cohesion, coupling, isolation, pocket edges, modularity, endpoints. |
| 7. Write | `cli.ts`, `publish.ts` | `out/segmentation.json` (= `SegmentationResult` in `types.ts`), optional `loadSegmentation`. |

Everything except `cochange.readCommits`, `cli.ts` and `publish.ts` is pure.

## Reading deps.json (D-019, D-020, D-026)

`fromDeps` keeps node ids exactly as given (`prog:COACTUPC`, `data:AWS.M2...KSDS`,
`cpy:COCOM01Y`), so ids in SpacetimeDB match the extractor's. Mapping:

| deps.json | Segmenter |
| --- | --- |
| node `kind` | `kind`. If missing, taken from the id prefix; a `prog:` node with no kind (referenced, no source) becomes `missing`. |
| node `file`, `lines` | `path` (`''` when absent), `loc` |
| other node fields (`mode`, `description`, …) | `meta` |
| edge `from`, `to`, `rel`, `via`, `evidence` | `src`, `dst`, `kind`, `detail`, `evidence` |
| edge `confidence` | missing = `extracted`; also `inferred`, `unknown`, `observed` (planned) |
| repeated `from`/`to`/`rel` | one edge, `count` = repeats, best confidence, first evidence |
| edge endpoint not in `nodes` | placeholder node + warning |
| `unresolved` | passed through to the result and `segmentationRun.unresolvedJson` |
| `components`, `datasets`, `ubiquitous_copybooks`, `counts` | ignored: the segmenter recomputes what it needs |

Only **code nodes** are clustered: `kind = program` with a `file`. `utility` (SORT,
IDCAMS), `system-api` (MQPUT, CEEDAYS) and `missing` programs are never assigned
(`pocketId` = ''). Transactions come from `starts` edges; a job's steps are its `runs`
edges to programs, in evidence line order.

Rels the segmenter uses, everything else (including planned ones like `triggers`, `next`,
`starts-async`) is counted in `metrics.ignoredEdges` and listed in a warning so nothing is
dropped silently:

| Rel | Used as |
| --- | --- |
| `calls`, `links`, `transfers` | direct program → program weight |
| `read`, `write`, `copies`, `shows` | access to a shared resource (dataset, copybook, screen, ims, mq, tsq, tdq, ...) |
| `runs` | the job is a shared resource of the programs it runs |
| `starts` | transaction → entry program (endpoints, assignment) |
| `uses-api` | not clustered (system APIs are not app coupling) |
| `cochange` | added by the segmenter from git history |

## Projection (D-021, `segmentation.*` in config)

Only code nodes are clustered. Their pairwise weight is the sum of:

| Source | Weight per pair |
| --- | --- |
| `calls` / `links` / `transfers` edge | `edgeWeights[rel] × confidence[c] × (1 + log2 count)` |
| `cochange` | `edgeWeights.cochange × (1 + log2 commits)` |
| resource of kind `k` touched by `n` programs | `resourceWeights[k] / (n − 1) × access × min(confidence)` |

`access` (`accessFactor`) is 1.0 if both programs write the resource, 0.6 if one does, 0.3
if both only read; `copies`, `shows` and `runs` use 1.0. A node kind is a shared resource
exactly when it has an entry in `resourceWeights`, so new kinds from the extractor
(`tsq:`, `tdq:`, `env:` ...) start counting by adding one config line. `unknown` confidence
weighs 0: a placeholder edge never pulls programs together.

Left out of the projection:
- **System copybooks** (no file in the repo, e.g. `DFHAID`, `CMQV`): not app coupling.
- **Omnipresent resources** (touched by more than `omnipresentThreshold` of all
  programs): after Bunch. On CardDemo: `COCOM01Y` (commarea), `CSMSG01Y`, `CVACT01Y`, ….
- **Hub programs** (invoke or are invoked by more than `hubThreshold` of all programs):
  `COMEN01C` (main menu) and `COSGN00C` (sign-on) on CardDemo. They go to `pkt-shared`.
  Their edges still show up in `pocketEdge`.

## Clustering (D-022)

1. Louvain (`graphology-communities-louvain`) on the projection, `resolution.pocket`,
   nodes added in sorted order, seeded PRNG (`seed`). Same input + config gives
   byte-identical output (tested).
2. **Connectivity repair:** Louvain can return disconnected communities (Leiden's fix,
   but there's no maintained Leiden for JS), so each community is split into its
   connected components.
3. **Soft LOC cap:** a pocket over `maxPocketLoc` is re-clustered at resolution
   `× splitResolutionFactor^d`, `d = 1..maxSplitDepth`, recursively. What still doesn't
   fit is kept and flagged `oversized` (e.g. a single huge program). LOC is the node's
   `lines` (total source lines, comments included).
4. **Domains:** Louvain on the pocket graph (weights = summed cross-pocket weight) at
   `resolution.domain`, plus the same repair. `pkt-shared` sits in `dom-shared`.

Ids: `pkt-<anchor>` / `dom-<anchor pocket>` where the anchor is the member with the
highest internal weighted degree, lowercased (`pkt-cousr00c`). Names come from the CSD
description of a transaction that starts the anchor (or another member), tidied
(`Account Update`), else the anchor's name.

## Assignment (D-023)

- A resource goes to the pocket with the largest access weight (write 2, read 1) if that is
  at least `resourceOwnershipMin` of its total; otherwise to `pkt-shared`.
- A job goes to the pocket of the programs it runs; with none of ours (IDCAMS-only jobs),
  to the pocket that owns most of its datasets; else `pkt-shared`.
- Resources only jobs touch follow those jobs. Transactions follow their program.
  `utility`, `system-api` and `missing` nodes are not assigned (`pocketId` = '').

## Measures

Over the projection, per pocket: `cohesion` (internal weight), `coupling` (weight to
other code pockets; edges to `pkt-shared` don't count, D-024), and
`isolation = cohesion / (cohesion + coupling)` (1.0 when both are 0). Ranking uses it (D-007).
`pocketEdge` rows hold the cross-pocket (and cross-domain) weights with a per-kind
breakdown. `metrics`: Newman modularity of the partition, cross-pocket weight share, pocket
sizes, oversized pockets, `unresolved` (count of deps.json `unresolved`), `ignoredEdges`.

## Endpoints

What traffic hits: every transaction with a `starts` edge (`CICS CAVW`) and every job that
runs one of our programs (`JOB INTCALC`). `pocketId` is the entry program's pocket (the
job's pocket for jobs), which drives traffic share. `servedBy` adds every pocket reachable
through `calls`/`links`/`transfers` without walking through hubs (and ignoring `unknown`
edges), which drives dead-code detection.

## Output and storage

`out/segmentation.json` (gitignored) is the `SegmentationResult` in `types.ts`, `version: 2`,
with `source = {root, ref, deps, depsHash}` so a run can be traced to the exact graph file.
`loadSegmentation(json)` validates it (`spacetime/src/segmentation.ts`) and replaces
`segmentationRun`, `graphNode`, `depEdge`, `pocket`, `pocketEdge`, `endpoint`, all or
nothing. Shapes are in [DATA_MODEL.md](DATA_MODEL.md).

## The stand-in extractor (`src/extract/`, `pnpm deps:extract`)

Writes GRAPH_SCHEMA `deps.json` from TypeScript so the pipeline runs today and in CI.
It covers the same findings as the spike (F1–F8: CICS variables, CSD/JCL dataset
unification, quoted COPY, XCTL through variables, system APIs, missing targets,
ubiquitous copybooks, DDs with no JCL step). If the team keeps the Python extractor
(DECISIONS Q20), delete the folder and the `deps:extract` script; nothing else imports it.

Differences from the Python example worth knowing:
- Uses planned prefixes already: `screen:` (+ `shows` from BMS `SEND/RECEIVE MAP`), `ims:`
  (DLI segments, PSB `SENSEG`), `mq:` (queue names). `data:db2:TABLE` for SQL tables.
- Program edge `evidence` is the file path without a line number (copybooks are inlined
  before matching, so line numbers would be misleading). Job edges use `job.jcl:STEP`.
- Heuristic resolutions (menu tables in `COMEN02Y`/`COADM02Y`, DD names bound in another
  job) are `inferred`; what's left goes to `unresolved`.

**COBOL** (`extract/cobol/`). Fixed format (cols 1–6 sequence, col 7 indicator, 8–72 code,
continuation lines joined) and free format (`*>`).

| Fact | Pattern | Rel |
| --- | --- | --- |
| static calls | `CALL 'X'` (not inside string literals, not `1000-CALL THRU`) | `calls` / `uses-api` |
| CICS flow | `EXEC CICS XCTL/LINK PROGRAM(var or 'X')` | `transfers` / `links` |
| CICS files | `READ/READNEXT/READPREV/STARTBR` read, `WRITE/REWRITE/DELETE` write, `FILE(...)`/`DATASET(...)` | `read` / `write` |
| batch files | `SELECT f ASSIGN TO DD` (`UT-S-`/`AS-` stripped) + `OPEN INPUT/OUTPUT/I-O/EXTEND` | `read` / `write` |
| copybooks | `COPY X`, `COPY 'X'`, `EXEC SQL INCLUDE X` (not `SQLCA`/`SQLDA`) | `copies` |
| DB2 tables | `FROM`, `JOIN`, `UPDATE`, `INSERT INTO` inside `EXEC SQL` | `read` / `write` |
| IMS segments | `EXEC DLI … SEGMENT(X)`; `ISRT/REPL/DLET` write | `read` / `write` |
| MQ queues | names flowing into a `*OBJECTNAME` field near `MQOPEN/MQPUT/MQGET` | `read` / `write` |
| maps | `EXEC CICS SEND/RECEIVE MAP … MAPSET(X)` | `shows` |

Dynamic targets are followed through `VALUE` clauses and `MOVE a TO b` chains to literals.

**JCL** (`extract/jcl/`): jobs, steps, `DD DSN=` bindings (generation `(+1)` stripped,
`DISP=NEW/MOD` = write), `SET` symbols, PROC defaults and EXEC overrides (`&HLQ..X`),
procstep DD overrides, `NULLFILE` and load libraries ignored, IDCAMS `DEFINE AIX … RELATE` /
`DEFINE PATH … PATHENTRY` folded into the base cluster. Wrappers are seen through:
`EXEC PGM=DFSRRC00,PARM='BMP,PAUDBLOD,PSBPAUTB'` runs `PAUDBLOD` with PSB `PSBPAUTB`;
`IKJEFT01` with `RUN PROGRAM(COBTUPDT)` runs `COBTUPDT`. **CSD**: transactions and
`DEFINE FILE ... DSNAME`. **PSB**: `SENSEG` per DB PCB, `PROCOPT` for read vs write.

## CardDemo result (commit `59cc6c2`, stand-in extractor, default config)

309 nodes, 769 edges, 46 programs → 14 pockets in 4 domains, modularity 0.50, 36% of
projected weight crosses pockets, 0 unused edges, 14 unresolved references: 4 MQ queue
names set at runtime, 7 batch DDs no JCL step binds (5 guessed from other jobs as
`inferred`), and 3 menu XCTLs through a variable (targets from the menu tables, `inferred`).

| Pocket | Programs | Lines | Isolation |
| --- | --- | --- | --- |
| `pkt-cousr00c` user admin | COADM01C COUSR00C–03C | 2055 | 0.91 |
| `pkt-paudblod` authorizations (IMS/MQ) | COPAUA0C COPAUS0C–2C CBPAUP0C DBUNLDGS PAUDBLOD PAUDBUNL | 4344 | 0.76 |
| `pkt-cotrtlic` transaction types (DB2) | COTRTLIC COTRTUPC COBTUPDT | 4037 | 0.68 |
| `pkt-coacct01` VSAM/MQ inquiries | COACCT01 CODATE01 | 1144 | 0.56 |
| `pkt-cocrdlic` cards | COCRDLIC COCRDSLC COCRDUPC CBACT02C | 4084 | 0.45 |
| `pkt-cbstm03a` statements | CBSTM03A CBSTM03B | 1154 | 0.44 |
| `pkt-csutldtc` add transaction + reports | COTRN02C CORPT00C CSUTLDTC | 1589 | 0.33 |
| `pkt-cbact01c` account file batch | CBACT01C + COBDATFT (asm) | 514 | 0.30 |
| `pkt-cbtrn02c` posting + interest | CBTRN01C CBTRN02C CBACT04C | 1877 | 0.25 |
| `pkt-cbexport` export/import | CBEXPORT CBIMPORT | 1069 | 0.24 |
| `pkt-cotrn00c` transactions + bill pay | COTRN00C COTRN01C COBIL00C | 1601 | 0.20 |
| `pkt-coactupc` accounts | COACTUPC COACTVWC CBCUS01C | 5355 | 0.10 |
| `pkt-cbact03c` xref + report batch | CBACT03C CBTRN03C | 827 | 0.04 |
| `pkt-cobswait` wait utility | COBSWAIT + MVSWAIT (asm) | 71 | 1.00 |
| `pkt-shared` | COMEN01C COSGN00C | 568 | – |

Domains are coarser and less meaningful; the UI can lean on pockets.

The weights were picked with a sweep over `omnipresentThreshold` × `copybook` weight ×
`maxPocketLoc` × `splitResolutionFactor`, choosing the setting with the highest
modularity that never separates a program from a subprogram it CALLs. `maxPocketLoc` is
6500 because `lines` counts comments and blank lines: the largest CICS programs are
4000+ lines, and lower caps shred the accounts pocket into singletons. CardDemo has only
32 commits, mostly bulk ones, so co-change adds nothing yet.

**To check against the team's graph:** run `pnpm segment --deps <their deps.json>`. Ids,
kinds and rels are the same, so the pockets should match up to the extra planned-prefix
nodes (`screen:`, `ims:`, `mq:`) this extractor emits.

## Tests

`services/segmenter/src/**/*.test.ts` and `spacetime/src/segmentation.test.ts`:
- `deps.test.ts`: GRAPH_SCHEMA examples, kinds from prefixes, `missing` programs, edge
  merging and confidence, placeholders for planned prefixes, transactions and job steps,
  schema rejections.
- `segment.test.ts`: projection (dampening, access factors, omnipresent, system copybooks,
  non-code nodes, hubs, jobs, `unknown` = 0, ignored rels), Louvain determinism,
  connectivity repair, modularity, LOC splits, assignment, co-change, the full pipeline.
- `extract/**`: extractor snippets (CALL false positives, XCTL through MOVE chains, CICS
  DATASET variables, SELECT/ASSIGN + OPEN, SQL, DLI, MQ, copybooks with cycles; JCL DDs,
  generations, IDCAMS aliases, procs, DFSRRC00/IKJEFT01; CSD; PSB).
- `carddemo.test.ts` (skipped until `pnpm legacy:fetch`): extractor → deps.json → schema
  check → segmentation; known edges, AIX paths unified, `CBSTM03A`+`CBSTM03B` and the
  `COUSR*` screens together, menu and sign-on are hubs, deterministic.

## Not done yet

- Run on the team extractor's `deps.json` once it's committed (or `tools/cobol_deps.py`).
- `legacy/fixture/` (D-018) doesn't exist yet. When it does, extract and segment it.
- No `pocket.discovered` events and no `route` rows: those tables are still PROPOSED.
- Traffic columns on `pocket`/`endpoint` (share, priority, status) arrive with the traffic
  work (D-007).
