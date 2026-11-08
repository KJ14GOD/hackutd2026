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

### `codeUnit`: PROPOSED
One row per legacy program (graph node).
| id string PK (program name) | path | language | kind (`program`/`dispatcher`) | loc u32 | pocketId (btree) | domainId | resourcesJson `{copybooks,files,tables}` |

### `depEdge`: PROPOSED
| id u32 PK auto | src (btree) | dst | kind (`call`/`file`/`table`/`copybook`/`cochange`) | weight f64 | detail (resource name) |

### `pocket`: PROPOSED
Domains and pockets share the table (`level`).
| id string PK | parentId (domain id, '' for domains) | level | name | membersJson | cohesion f64 | coupling f64 | isolation f64 (`cohesion/(cohesion+coupling)`) | priority f64 (D-007) | status (`legacy`/`migrating`/`promoted`/`dead`) | trafficShare f64 | lastTrafficSimMs f64 | discoveredSimMs f64 | activeJobId u32 (0 = none) |

### `pocketEdge`: PROPOSED
Aggregated weak edges between pockets (and between domains) that the UI draws.
| id u32 PK auto | level | src | dst | weight f64 | kindsJson (weight per edge kind) |

### `endpoint`: PROPOSED
| id string PK (`GET /accounts/:id/interest`) | method | path | txnCode | entryProgram | pocketId (btree, pocket of the entry program) | servedByJson (all pockets reachable by calls) | totalRequests u32 | lastSeenSimMs f64 |

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
| `loadSegmentation(json)` | PROPOSED | segmenter | replaces graph, pockets, endpoints, routes; emits `pocket.discovered` |
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
(window, threshold, rates, scenario), `ranking` (traffic/isolation weights, min isolation), `segmentation` (edge weights, resolution, seed),
`shadow` (caps, noise), `cutover` (steps, match-rate thresholds), `selfHeal`, `deadCode`,
`humanLoop` (question caps, escalation timeouts), `llm`. The endpoint rates and account
ids under `traffic` are placeholders until the CardDemo endpoints are fixed (D-012).

## Built: people, questions and the harness feed (Phases 3-5)

Implemented in `spacetime/src/index.ts` (published to the local server by `node scripts/stdb.mjs publish`;
the native `spacetime` CLI is needed to build TypeScript modules). Shapes follow
REQUIREMENTS_IMPLEMENTATION.md §3.2-3.3; all tables are public for now (views and access control come later).

| Table | Written by | Holds |
| --- | --- | --- |
| `person`, `team`, `reportsTo`, `ownership`, `identityMatch`, `approver` | `loadOrg` (from `out/people/org.json`) | Phase 3 org, ownership with evidence, merge-review pairs, generated approvers |
| `question` | `loadQuestions` (Part 2 + `out/context/resolutions.json`) | each question with its Phase 4 verdict, quotes and route; status `needs-person`, `answered-by-docs`, `known-issue`, `conflict`, `asking`, `answered` |
| `outreach` | `queueOutreach`, `markOutreachSent`, `answerQuestion` | one row per question per person; rows sharing a `digestKey` (person + program) go out as one Slack message |
| `harnessJob` | `upsertJob`, `answerQuestion` | one job per program: `reading`, `looking-up`, `asking`, `waiting` (with the question ids), `resuming`, `done` |
| `harnessEvent` | `upsertJob`, `recordEvent`, `answerQuestion` | the live step feed the UI shows |

`answerQuestion` is the only way a question is answered (Slack button or the UI). It marks the question and its
outreach answered, logs an event on every job waiting for it, and moves a job to `resuming` once nothing it waits
on is still open. Reloading questions never erases a human answer. `resetRuns` clears jobs, events and outreach
for a fresh demo.
