# Events: UI contract

> **DRAFT, version 1.** The UI teammate owns the final shape; reshape freely, but bump
> `v` and update this file in the same commit as the module change.

Events are rows in the append-only `event` table ([DATA_MODEL.md](DATA_MODEL.md)).
The UI subscribes to it to drive animations; `pnpm tail` (tools CLI) prints it. Current
state always lives in the other tables. Events say *what just happened*, so a client
that joins late can still render everything from state alone.

## Envelope

| field | type | meaning |
| --- | --- | --- |
| `id` | u32 | increasing; use it for ordering and "seen up to" |
| `v` | u32 | payload schema version (currently 1) |
| `type` | string | one of the types below |
| `simMs` | f64 | sim-clock time it happened |
| `realMs` | f64 | wall-clock time it happened |
| `pocketId` | string | '' if not about a pocket |
| `jobId` | u32 | 0 if not about a job |
| `payload` | string | JSON, shape per type |

## Types

| type | emitted when | payload |
| --- | --- | --- |
| `pocket.discovered` | segmentation loaded or world reset; domains before pockets | `{pocketId, name, level, parentId, members[], cohesion, coupling, endpoints[]}` |
| `pocket.revived` | traffic hits a pocket marked dead | `{pocketId, endpointId}` |
| `traffic.threshold_crossed` | a pocket's windowed traffic share ≥ `traffic.thresholdShare` | `{pocketId, share, threshold, windowRequests, windowSimMinutes}` |
| `migration.started` | a job is created (traffic or manual) | `{jobId, pocketId, reason: 'traffic'\|'manual'}` |
| `job.state_changed` | any job transition | `{jobId, pocketId, from, to, note}` |
| `capture.completed` | golden-master capture finished | `{jobId, cases}` |
| `rewrite.started` | LLM rewrite or fix attempt begins | `{jobId, attempt, model}` |
| `rewrite.completed` | Java written and compiled (or failed to) | `{jobId, attempt, files[], compiled}` |
| `shadow.started` | routes for the pocket switch to shadow | `{jobId, pocketId, endpoints[], targetBaseUrl, source: 'handwritten'\|'generated'}` |
| `shadow.match_rate_changed` | match rate moved by ≥ `shadow.matchRateEventDelta`, or first sample | `{jobId, matchRate, previous, total, matched}` |
| `mismatch.found` | a mismatch row is stored (capped per flush) | `{jobId, mismatchId, endpointId, fields[]}` |
| `mismatch.grouped` | mismatches grouped by root cause and classified | `{jobId, groupId, category, count, signature}` |
| `question.sent` | Slack question posted | `{questionId, groupId, askee, text}` |
| `question.escalated` | no answer within the escalation timeout | `{questionId, level, askee}` |
| `answer.received` | a button was clicked | `{questionId, answer: 'old'\|'new'\|'neither'\|'doesnt_matter', answeredBy}` |
| `test.generated` | a golden case or an answer became a test | `{testId, pocketId, source: 'golden'\|'answer', name}` |
| `cutover.step` | canary percentage changes (1 → 10 → 100) | `{jobId, fromPercent, toPercent, matchRate}` |
| `rollback.triggered` | self-heal saw a mismatch spike after cutover | `{jobId, pocketId, mismatchRate, threshold}` |
| `pocket.promoted` | 100% of a pocket's traffic is on the target | `{pocketId, jobId}` |
| `pocket.marked_dead` | zero traffic for `deadCode.simDays` | `{pocketId, idleSimDays, lastTrafficSimMs}` |
| `legacy_bug.found` | a human said the NEW behavior is correct | `{bugId, pocketId, description, impactUsd}` |

`pocket.revived` and `job.state_changed` were added to the starting list: the first
covers dormant code waking up (the Knight Capital case in the research), the second
gives the UI one generic hook for state-machine animations.

## Volume

Expect a few events per real second while shadowing. `mismatch.found` is capped by
`shadow.mismatchCapPerFlush`; match-rate events fire only on a meaningful change.
