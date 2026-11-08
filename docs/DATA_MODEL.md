# Data model

> **Source of truth for the SpacetimeDB schema.** Status of each table and reducer:
> **BUILT** (exists in `spacetime/src`), **PROPOSED** (agreed shape pending, not built),
> or **PLANNED M2** (rough shape only). Change this file in the same commit as the module.

## Conventions

- Tables are camelCase in TS (`migrationJob`); SpacetimeDB exposes them as snake_case
  in SQL and the CLI (`migration_job`). Reducers likewise: `recordTraffic` is `record_traffic`.
- All tables are `public: true` so the UI can render from subscriptions alone. The one
  exception is internal schedule tables.
- PROPOSED: ids are `u32` and sim times are `f64` milliseconds, so the UI gets plain JS
  numbers instead of `bigint` (D-005).
- Lists and payloads are JSON strings, named `*Json` or `payload`.
- "Sim ms" means milliseconds on the sim clock (see `simClock`).

## Tables

### `config`: BUILT
| column | type | notes |
| --- | --- | --- |
| id | u32 PK | always 0 |
| json | string | `theseus.config.json`, validated client-side before push |
| version | u32 | increments on every push |

### `simClock`: PROPOSED
Single row. Sim now = `paused ? anchorSimMs : anchorSimMs + (realNow − anchorRealMs) × speed`.
Every client computes this locally; reducers use `ctx.timestamp` as real now.
| id u32 PK (0) | anchorRealMs f64 | anchorSimMs f64 | speed f64 | paused bool |

### Segmentation tables: BUILT
Written only by `loadSegmentation` (whole replace). Produced by `services/segmenter`;
meaning of every field in [SEGMENTATION.md](SEGMENTATION.md). Node and pocket ids are
strings (`prog:COACTUPC`, `pkt-cousr00c`) because they are stable across runs. Node ids, kinds
and edge rels are the dependency graph's ([GRAPH_SCHEMA.md](GRAPH_SCHEMA.md)), unchanged.

#### `segmentationRun` (single row, id 0)
| id u32 PK | sourceRoot | sourceRef (git commit) | depsPath (the deps.json segmented) | depsHash | configHash | loadedAtMs f64 (real time, provenance only) | metricsJson | warningsJson | unresolvedJson (deps.json `unresolved`) |

#### `graphNode` (replaces the proposed `codeUnit`: every node kind, not just programs)
| id string PK (`prefix:NAME`, e.g. `prog:`, `data:`, `cpy:`) | kind (btree: `program`/`utility`/`system-api`/`missing`/`copybook`/`dataset`/`screen`/`ims`/`mq`/`job`/`transaction`/...) | name | path ('' if no file) | loc u32 (total source lines) | pocketId (btree, '' for utility/system-api/missing) | domainId | metaJson (`mode`, `description`, `language`, ...) |

#### `depEdge`
| id u32 PK auto | src (btree) | dst (btree) | kind (the rel: `calls`/`links`/`transfers`/`copies`/`read`/`write`/`runs`/`starts`/`uses-api`/`shows`/..., plus `cochange`) | count u32 (repeats in deps.json) | confidence (`extracted`/`inferred`/`unknown`/`observed`) | detail (`via`) | evidence (`file:line`, `CSD`, `git log`) |

#### `pocket`
Domains and pockets share the table (`level`). Members are not stored: a pocket's members are
the `graphNode` rows with its `pocketId`; a domain's are the pockets with its `parentId`.
| id string PK | parentId (btree; domain id, '' for domains) | level (`domain`/`pocket`) | kind (`code`/`shared`) | name | anchor (node id) | programs u32 | loc u32 | cohesion f64 | coupling f64 | isolation f64 | oversized bool |

PROPOSED additions with the traffic and agent work (D-007): priority f64, status
(`legacy`/`migrating`/`promoted`/`dead`), trafficShare f64, lastTrafficSimMs f64,
discoveredSimMs f64, activeJobId u32. Adding them needs `pnpm stdb:reset` and a re-run of
`pnpm segment --publish`.

#### `pocketEdge`
Aggregated weights between pockets (and between domains) that the UI draws.
| id u32 PK auto | level | src | dst | weight f64 | kindsJson (weight per source kind) |

#### `endpoint`
What traffic hits: CICS transactions and batch jobs.
| id string PK (`CICS CAVW`, `JOB INTCALC`) | kind (`cics`/`batch`) | name | description | entryNode | pocketId (btree, pocket of the entry program) | servedByJson (pockets reachable through calls, entry pocket first) |

PROPOSED additions with the traffic work: totalRequests u32, lastSeenSimMs f64. How
traffic reaches CICS endpoints that can't run locally is Q16.

### `trafficBucket`: PROPOSED
Per endpoint, per sim-minute bucket. Pruned to 2× the traffic window by `sweep`.
| id u32 PK auto | endpointId | minute u32 (btree, sim minutes since epoch) | count u32 |

### `migrationJob`: PROPOSED
States in [AGENT_LOOP.md](AGENT_LOOP.md). One active job per pocket.
| id u32 PK auto | pocketId (btree) | state | attempt u32 | startedSimMs | updatedSimMs | shadowTotal u32 | shadowMatched u32 | matchRate f64 | cutoverPercent u32 | targetBaseUrl | worker (lease holder) | note |

### `route`: PROPOSED
The routing table the router subscribes to. Written only by job transitions or `setRoute`.
| endpointId string PK | pocketId | mode (`legacy`/`shadow`/`canary`/`target`) | targetPercent u32 | targetBaseUrl | updatedSimMs |

### `noiseField`: PROPOSED
JSON paths that differed between two legacy copies; ignored when diffing old vs new.
| id u32 PK auto | endpointId (btree) | path | hits u32 | firstSeenSimMs |

### `mismatch`: PROPOSED
| id u32 PK auto | jobId (btree) | pocketId | endpointId | requestJson | legacyJson | targetJson | fieldsJson (diff paths after noise filter) | simMs | groupId u32 (0 = ungrouped) | status (`open`/`grouped`/`resolved`) |

### `event`: PROPOSED
Append-only feed that drives UI animations and the tail CLI. Contract: [EVENTS.md](EVENTS.md).
| id u32 PK auto | v u32 (schema version) | type | simMs | realMs | pocketId | jobId u32 | payload (JSON) |

### `sweepSchedule`: PROPOSED (private)
Schedule table driving the `sweep` reducer every 2 real seconds.
| scheduledId u64 PK auto | scheduledAt ScheduleAt |

### PLANNED M2 (shapes to be agreed)
- `goldenCase`: id, pocketId, endpointId, requestJson, responseJson, capturedSimMs
- `mismatchGroup`: id, jobId, signature, category (`noise`/`formatting`/`logic`/`legacy_bug`/`unknown`), count, summary, status
- `question`: id, groupId, pocketId, askee, channel, text, evidenceJson, status, sentSimMs, escalationLevel, slackTs
- `decision` (the knowledge base, see HUMAN_LOOP): id, signature, ruling, source (`slack_answer`/`imported_note`/`assumed_old`), expert, authority (`owner`/`backup`/`other`), status (`assumed`/`proposed`/`confirmed`/`retired`), questionId, evidenceJson, testId, simMs, reviewBySimMs
- `testCase`: id, pocketId, source (`golden`/`answer`), decisionId, name, specJson
- `legacyBug`: id, pocketId, decisionId, description, impactUsd, occurrences
- `owner`: code-owner → Slack user mapping (or keep it in a config file; Q14)

## Reducers

| Reducer | Status | Called by | What it does |
| --- | --- | --- | --- |
| `init` | BUILT | SpacetimeDB on first publish | inserts the empty config row (PROPOSED: also clock row + sweep schedule) |
| `setConfig(json)` | BUILT | `pnpm config:push` | stores the config; PROPOSED: first push starts the sim clock at `sim.startIso` |
| `setSimClock(speed, paused)` | PROPOSED | traffic service / CLI | re-anchors the clock so sim time never jumps |
| `resetWorld()` | PROPOSED | CLI | clears traffic, jobs, mismatches, events; keeps segmentation |
| `loadSegmentation(json)` | BUILT | `pnpm segment --publish` | validates and replaces the segmentation tables, all or nothing. PROPOSED: also reset `route` rows and emit `pocket.discovered` once those tables exist |
| `recordTraffic(counts[])` | PROPOSED | router | upserts buckets, updates shares + priority, starts eligible jobs by priority (D-007) |
| `recordShadowBatch(counts[], mismatches[], noise[])` | PROPOSED | router | updates match rate, stores capped mismatches, learns noise fields |
| `startMigration(pocketId)` | PROPOSED | CLI | manual job start |
| `advanceJob(jobId, to, note)` | PROPOSED | workers | guarded transition; syncs pocket status + routes; emits `job.state_changed` |
| `beginShadow(pocketId, targetBaseUrl)` | PROPOSED | CLI (M1) | puts a pocket in shadow against a hand-written target |
| `setRoute(endpointId, mode, pct, url)` | PROPOSED | CLI | manual override / kill switch |
| `sweep` (scheduled) | PROPOSED | scheduler | marks dead pockets, prunes old buckets |
| capture/rewrite/group/question/answer/cutover reducers | PLANNED M2 | workers, slackbot | see AGENT_LOOP and HUMAN_LOOP |

## Config (`theseus.config.json`)

Validated by `packages/shared/src/config.ts` (zod). Sections: `sim`, `ports`, `traffic`
(window, threshold, rates, scenario), `ranking` (traffic/isolation weights, min isolation), `segmentation` (edge and resource weights, access and confidence factors, omnipresent/hub thresholds, LOC cap, resolution, seed; see SEGMENTATION.md),
`shadow` (caps, noise), `cutover` (steps, match-rate thresholds), `selfHeal`, `deadCode`,
`humanLoop` (question caps, escalation timeouts), `llm`. The endpoint rates and account
ids under `traffic` are placeholders until the CardDemo endpoints are fixed (D-012).
