# Requirements layer: technical spec

Status: **PROPOSED**. The engineering detail behind [REQUIREMENTS_ANALYSIS.md](REQUIREMENTS_ANALYSIS.md) §17
(the plan) and [REQUIREMENTS_IMPLEMENTATION_STORY.md](REQUIREMENTS_IMPLEMENTATION_STORY.md) (the same plan as a
story). This doc says exactly what code gets written, where every piece of data is stored, and every network
call the system makes. Diagram: [REQUIREMENTS_ARCHITECTURE.drawio](REQUIREMENTS_ARCHITECTURE.drawio) (open at
app.diagrams.net). Last updated 2026-11-08.

**Scope of the build: backend only.** This spec covers the SpacetimeDB module, shared packages, workers,
the harness on Brev, and deployment. **UI features are listed, not built here**: §9 and
REQUIREMENTS_ANALYSIS §12 describe what the screens need so a separate effort can extract and build them.
The backend must expose everything those screens need (tables, views, reducers, events), but no `src/`
UI code is written as part of this work.

Items marked **(verify)** are API details taken from vendor docs or memory that must be checked against the
real API before coding. Numbers marked *(placeholder)* are starting config.

---

## 0. Conventions

- TypeScript everywhere we write code (repo rule). ESM, Node 22, pnpm workspace (`pnpm-workspace.yaml` already
  includes `packages/*` and `services/*`). Tests in vitest.
- Deterministic output: every JSON file a worker writes goes through the existing `stableJson()` (sorted keys
  and arrays) from `services/segmenter/src/pass1.ts`, moved to `packages/shared` so every worker can use it.
- Every worker is a SpacetimeDB client. It never keeps state of its own beyond caches; restart = resume.
- Every outside call (LLM, REST, Slack) goes through a cache layer keyed by request hash, with three modes from
  env: `live` (call and record), `replay` (cache only, fail on miss), `mock` (fixtures).
- Secrets come from `.env` only and never land in SpacetimeDB or logs.

**Repo note found while writing this:** the mission-control UI merge (`b427e26`) replaced the root
`package.json` with the Vite app's, so the root `stdb:*`, `config:push`, `part1` and `runtime` scripts that
CLAUDE.md lists are gone. Phase 1 needs to restore them (or move the UI into its own package).

---

## 1. What gets added to the repo

```
packages/
  shared/src/
    stableJson.ts            moved from services/segmenter (used by every worker)
    hash.ts                  sha256 helpers for cache keys and signatures
  llm/                       NEW  OpenAI-compatible client + cache
    src/client.ts            chat(), json() with zod schema
    src/cache.ts             prompt-hash cache on disk
    src/providers.ts         mock | replay | nvidia | brev
  http/                      NEW  fetch wrapper with request-hash cache + retry
    src/cachedFetch.ts
  stdb/                      NEW  shared SpacetimeDB client helpers
    src/connect.ts           connect(): DbConnection from STDB_URI / STDB_DB / STDB_TOKEN
    src/claim.ts             claim-then-work pattern
spacetime/src/
  schema.ts                  + requirement, people, access, outreach tables (§3)
  reducers/requirements.ts   NEW
  reducers/questions.ts      NEW
  reducers/people.ts         NEW
  reducers/outreach.ts       NEW
  reducers/verification.ts   NEW
  views.ts                   NEW  access-controlled views (§3.4)
services/
  requirements/              NEW  findings + answers → requirements (Phase 2)
  people/                    NEW  org/ownership connectors → approver list (Phase 3)
  context/                   NEW  Jira/Confluence/Notion search → contextHit (Phase 4)
  outreach/                  NEW  Slack bot, digests, escalation sending (Phase 5)
  harness/                   NEW  OpenHands adapter, runs on Brev (Phase 6)
  harness-tools/             NEW  MCP server for OpenHands, runs on Brev (Phase 6)
  verifier/                  NEW  test / lint / benchmark runners (Phase 7)
  llm-proxy/                 NEW  caching proxy in front of Nemotron on Brev (Phase 6)
  web-proxy/                 NEW  allowlisted browse + redacted search for OpenHands, on Brev (Phase 6)
src/                         UI (existing Shadow-Diff dashboard)
  types.ts                   + Requirement, Question, Person, … (§9)
  data/source.ts             + new SourceEvents
  data/spacetimeSource.ts    NEW  SpacetimeSource implementing RealtimeSource
  store/useStore.ts          + slices and selectors
  components/requirements/   NEW  screens 12.4, 12.5, 12.6, 12.7, 12.8
  components/questions/      NEW  screens 12.2, 12.3
  components/approvals/      NEW  screens 12.9, 12.12
  components/people/         NEW  screens 12.10, 12.11, 12.13 (stretch)
  components/outreach/       NEW  screens 12.14, 12.15 (stretch)
fixtures/requirements/       NEW  planted bundle + answer key (Phase 2)
fixtures/org/                NEW  synthetic org, git author map, Notion page ids (Phase 3)
config/owners.json           existing plan (Q14), now generated from fixtures/org for the demo
docker/workers/Dockerfile    NEW  one arm64 image with Node, JDK 21, GnuCOBOL, every worker
docker/workers/procfile      NEW  which workers the container starts
```

---

## 2. Where data lives

### 2.1 SpacetimeDB (Maincloud in shared runs, local Docker for solo testing)

Live state and anything a screen or worker queries. Full schema in §3.

### 2.2 Files on disk (inside the worker container's mounted folder `./out`, and on Brev for the harness)

| Path | Written by | Read by | Notes |
| --- | --- | --- | --- |
| `out/pass1.json` | segmenter (`pnpm part1`) | runtime, Part 2, requirements | exists today |
| `out/runtime.json` | runtime (`pnpm runtime`) | Part 2, requirements | exists today |
| `out/part2.json` | Part 2 reader | requirements | spec §3.7 |
| `out/requirements/<scope>.bundle.json` | requirements | requirements (rerun diff) | the hashed input bundle per scope |
| `out/requirements/<scope>.drafts.json` | requirements | debugging, tests | drafts before `proposeRequirement` |
| `out/people/org.json` | people | people | merged Person/Team/ReportsTo/Owns after identity resolution |
| `out/verify/<reqId>/<versionId>/` | verifier | UI (via `artifactRef`) | test output, lint report, benchmark timings |
| `brev:/work/<jobId>/` | harness | harness | OpenHands workspace: repo checkout + rewritten Java |

Each file's sha256 is stored in SpacetimeDB on the row that used it (`segmentationRun.depsHash` already does
this), so a database row always points to the exact file.

### 2.3 Caches (never committed)

| Path | Key | Contents |
| --- | --- | --- |
| `.cache/llm/<sha256>.json` | sha256(model + messages + params) | full response |
| `.cache/http/<sha256>.json` | sha256(method + url + sorted query + body) | status, headers subset, body |
| `brev:/cache/llm/` | same as `.cache/llm` | the proxy's cache for OpenHands calls |

For the demo these caches are recorded in a rehearsal and replayed with `LLM_MODE=replay`, `HTTP_MODE=replay`.

### 2.4 Secrets (`.env`, per machine)

| Var | Used by | Where |
| --- | --- | --- |
| `STDB_URI`, `STDB_DB`, `STDB_TOKEN` | every worker, harness | laptop container, Brev |
| `NVIDIA_API_KEY`, `NVIDIA_BASE_URL` | packages/llm (testing) | laptop container |
| `LLM_BASE_URL` | packages/llm, OpenHands | points at `llm-proxy` on Brev in shared runs |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | context, people | laptop container |
| `CONFLUENCE_BASE_URL` (same Atlassian token) | context, people | laptop container |
| `NOTION_TOKEN` | context, people | laptop container |
| `SLACK_BOT_TOKEN` (`xoxb-`), `SLACK_APP_TOKEN` (`xapp-`) | outreach | laptop container only |

---

## 3. SpacetimeDB module

Syntax follows the existing `spacetime/src/schema.ts` (`table({ public }, { ... })`, `t.string().index('btree')`).
Private tables omit `public: true`.

### 3.1 Requirement tables

```ts
requirement: table({ /* private */ }, {
  id: t.string().primaryKey(),              // REQ-<scope>-<sig hash 10>
  scope: t.string().index('btree'),         // node id, pocket id, or 'codebase'
  scopeLevel: t.string(),                   // codebase | pocket | program | function | lines | field
  category: t.string().index('btree'),      // style | structure | behavior | business-rule | technology | performance | security | data
  type: t.string(),                         // functional | quality | constraint
  status: t.string().index('btree'),        // draft | needs-info | proposed | approved | rejected | superseded
  currentVersionId: t.string(),
  ownerPersonId: t.string(),
  signature: t.string().index('btree'),     // scope + category + normalized condition
  sensitivity: t.string(),                  // normal | restricted
  reviewByMs: t.f64(),
}),
requirementVersion: table({}, {
  id: t.string().primaryKey(),              // <reqId>@<n>
  requirementId: t.string().index('btree'),
  n: t.u32(),
  statement: t.string(), actor: t.string(), condition: t.string(),
  outcome: t.string(), measure: t.string(), rationale: t.string(),
  authorIdentity: t.identity(),
  createdAtMs: t.f64(),
}),
requirementFlag: table({}, {
  id: t.u32().primaryKey().autoInc(),
  versionId: t.string().index('btree'),
  rule: t.string(),                         // missing-actor | vague-quantifier | ...
  word: t.string(),
  questionId: t.string(),
}),
requirementLink: table({}, {
  id: t.u32().primaryKey().autoInc(),
  requirementId: t.string().index('btree'),
  kind: t.string(),                         // source | code | verification
  ref: t.string().index('btree'),           // file:line, node id, finding id, contextHit id, verification id
  evidence: t.string(),
}),
conflict: table({}, {
  id: t.string().primaryKey(),
  aVersionId: t.string(), bVersionId: t.string(),
  questionId: t.string(),
  status: t.string(),                       // open | resolved
  resolvedBy: t.identity().optional(), resolution: t.string(), comment: t.string(),
}),
approval: table({}, {
  id: t.u32().primaryKey().autoInc(),
  requirementId: t.string().index('btree'),
  versionId: t.string().index('btree'),
  approver: t.identity(),                   // ctx.sender, never an argument
  personId: t.string(),
  authority: t.f64(),
  decision: t.string(),                     // approve | reject
  comment: t.string(),
  atMs: t.f64(),
}),
verification: table({}, {
  id: t.string().primaryKey(),
  requirementId: t.string().index('btree'),
  versionId: t.string(),
  method: t.string(),                       // test | shadow | lint | benchmark | attest
  spec: t.string(),                         // what to run: test name, lint rule id, benchmark command
  status: t.string(),                       // pending | passing | failing | stale
  lastRunAtMs: t.f64(),
  artifactRef: t.string(),                  // out/verify/... path + sha256
  attestedBy: t.identity().optional(),
}),
changeRequest: table({}, {
  id: t.string().primaryKey(),
  requirementId: t.string().index('btree'),
  proposedVersionId: t.string(),
  impactJson: t.string(),                   // computed by services/requirements (§5.1 impact)
  status: t.string(),                       // open | approved | rejected
}),
```

`question` (from DATA_MODEL.md) gains: `reason`, `requirementId`, `slot`, `urgency`, `scope`, `status`
(`open | claimed | answered | blocked`), `claimedBy`, `answerJson`. `contextHit` is new:
`{ id, questionId (btree), source, url, title, quote, score, fetchedAtMs }`.

### 3.2 People and access tables

```ts
person:      { id pk, emails, name, title, teamId (btree), active, sourcesJson }
team:        { id pk, name, parentTeamId }
reportsTo:   { id autoInc pk, personId (btree), managerId (btree), source }
ownership:   { id autoInc pk, personId (btree), target (btree), kind, signal, weight, source, evidence, observedAtMs }
identityMatch: { id pk, aRef, bRef, evidence, status }                 // pending | merged | rejected
approver:    { id pk, personId (btree), scope (btree), category, score, evidenceJson, signedOffBy (identity, optional) }
identityLink: { identity pk, personId (btree) }                        // SpacetimeDB identity → person
accessGrant: { id autoInc pk, personId (btree), scope (btree), sourcePermission }
```

`identityLink` is how a browser or Slack user becomes a `person`: the UI signs in to SpacetimeDB, gets an
identity, and an admin (or the demo's seed step) links it to a person. The outreach worker links Slack users
by email (`users.lookupByEmail`).

### 3.3 Outreach tables

```ts
outreach: {
  id pk, questionId (btree), digestKey (btree),      // approverPersonId + scope, for batching
  recipientPersonId (btree), channel,               // slack-dm | slack-channel
  rendering,                                         // business | engineer
  urgency, step,                                     // ask | follow-up | manager | approver | fte
  status (btree),                                    // queued | sent | answered | failed | cancelled
  slackTs, slackChannel,                             // set after send, for chat.update
  nextActionAtMs (btree), sentAtMs,
}
escalationSchedule: scheduled table driving escalationTick    // (verify) TS scheduled-table syntax on 2.14.1
```

### 3.3a Agent audit table

```ts
agentStep: {
  id autoInc pk, jobId (btree), attempt, seq,
  tool,                 // shell | edit | browser | search | package | mcp:<name>
  input,                // command, URL, query or tool args (redacted)
  outcome,              // ok | blocked | error
  ms, atMs,
}
```

Written by `services/harness` (from OpenHands' event stream) and `services/web-proxy` through a
`recordAgentStep` reducer. Kept per job; old attempts are pruned after `harness.auditKeepJobs`
*(placeholder 50)* so the table stays small.

### 3.4 Views (access control)

Restricted tables are private. Screens subscribe to views instead (R5). Views may only use indexed
`find`/`filter`, so every lookup below is on an indexed column.

```ts
export const myRequirements = spacetimedb.view(
  { name: 'my_requirements', public: true },
  t.array(requirement.rowType),
  (ctx) => {
    const link = ctx.db.identityLink.identity.find(ctx.sender);
    if (!link) return [];
    const out = [];
    for (const g of ctx.db.accessGrant.personId.filter(link.personId))
      for (const r of ctx.db.requirement.scope.filter(g.scope)) out.push(r);
    // plus non-restricted requirements: kept in a separate public table `requirementPublic`
    return out;
  },
);
```

Same pattern for `my_requirement_versions`, `my_questions`, `my_context_hits`, `my_conflicts`. Non-sensitive
rows are mirrored into public tables by the same reducers so views don't need a full scan (views can't
`iter()`).

### 3.5 Reducers

| Reducer | Args | Guards | Writes |
| --- | --- | --- | --- |
| `proposeRequirement` | draft (all slots), sources[], flags[] | caller is a worker identity (`workerIdentity` table) | `requirement`, `requirementVersion`, `requirementFlag`, `requirementLink` |
| `editRequirement` | reqId, slots | caller has access to scope | new `requirementVersion`; `requirement.status = proposed`; marks verifications `stale` |
| `markNeedsInfo` | reqId, slot | access | `requirement.status = needs-info` + `createQuestion` internally |
| `approveRequirement` | reqId, versionId, comment | `approver` row for (caller's person, scope, category); version is current; zero flags; quorum for critical | `approval`; status `approved` once quorum met |
| `rejectRequirement` | reqId, versionId, comment | approver | `approval`; status `rejected` |
| `linkRequirement` | reqId, kind, ref, evidence | worker or approver | `requirementLink` |
| `requestRequirementChange` | reqId, slots, impactJson | access | new version (proposed) + `changeRequest` |
| `resolveConflict` | conflictId, pick, comment | approver for both scopes | `conflict.status = resolved`; loser `superseded` |
| `createQuestion` | reason, requirementId, slot, scope, text, evidence, urgency | worker | `question` (deduped by signature) |
| `claimQuestion` | questionId, workerName | worker; status `open` | `status = claimed`, `claimedBy` (fails if already claimed) |
| `recordContextHits` | questionId, hits[] | worker; claimed by caller | `contextHit` rows; `status = open` again for routing |
| `answerQuestion` | questionId, answerJson | caller is a routed recipient or approver | `status = answered`; fills the requirement slot; cancels pending `outreach` |
| `queueOutreach` | questionId, recipients[], urgency, rendering | worker | `outreach` rows; schedules `escalationTick` |
| `markOutreachSent` | outreachId, slackChannel, slackTs | outreach worker | `status = sent`, `nextActionAtMs` |
| `escalationTick` | (scheduled) | scheduler only | advances overdue `outreach` to the next step per `humanLoop.escalation.byUrgency` |
| `recordVerification` | verificationId, status, artifactRef | worker | `verification` |
| `attest` | verificationId, comment | approver for scope | `verification.status = passing`, `attestedBy = ctx.sender` |
| `loadPeople` | org json (chunked) | worker | `person`, `team`, `reportsTo`, `ownership`, `identityMatch`, `approver` |
| `recordAgentStep` | jobId, attempt, tool, input, outcome, ms | harness or web-proxy identity | `agentStep` |
| `signOffApprovers` | runId | admin role | `approver.signedOffBy` |

`advanceJob` (AGENT_LOOP.md) gains the requirements gate: `capturing → rewriting` only when every
`behavior` / `business-rule` / `data` requirement in the pocket's scope is `approved` or waived;
`shadowing → canary` only when every verification in scope is `passing`.

---

## 4. Shared packages

### 4.1 `packages/llm`

```ts
export type Provider = 'mock' | 'replay' | 'nvidia' | 'brev';
export async function chat(req: { model: 'fast' | 'strong'; messages: Msg[]; json?: ZodSchema; maxTokens?: number }): Promise<{ text: string; parsed?: unknown; cached: boolean }>;
```

- Key = sha256(provider-independent model name + messages + temperature + maxTokens + schema id).
- `nvidia`: `POST ${NVIDIA_BASE_URL}/chat/completions` with `Authorization: Bearer ${NVIDIA_API_KEY}`,
  body `{ model, messages, temperature: 0, max_tokens, response_format? }`. Model ids from D-008.
- `brev`: same call against `${LLM_BASE_URL}` (the proxy on Brev).
- JSON outputs validated with zod; one retry with the validation error appended; then the item is dropped
  and counted (same rule as Part 2).

### 4.2 `packages/http`

`cachedFetch(url, init, { ttlMs?, mode })`: request-hash cache, exponential backoff on 429/5xx honoring
`Retry-After`, and a per-host rate limit (Atlassian and Notion both rate limit; **(verify)** current limits).

### 4.3 `packages/stdb`

`connect()` builds a `DbConnection` from the generated bindings with `STDB_URI`, `STDB_DB`, `STDB_TOKEN`, and
returns once the initial subscriptions are applied. `claim(table, id, reducer)` wraps the claim-then-work
pattern: call the claim reducer, proceed only if the row's `claimedBy` is us when the update arrives.
**(verify)** exact TS SDK builder names on 2.14.1 against the generated bindings.

---

## 5. Workers

### 5.1 `services/requirements` (container)

**Trigger:** a new `segmentationRun`, a new `out/part2.json` hash, or any `question` moving to `answered`.
**Files:**

| File | Does |
| --- | --- |
| `src/index.ts` | connect, subscribe to `question`, `requirement`, `requirementVersion`; run `processScope()` per changed scope |
| `src/collect.ts` | `collect(scope): Bundle` reads `out/part2.json` findings for the scope, answered questions, context hits; sorts; returns bundle + sha256 |
| `src/separate.ts` | LLM (fast): bundle → candidate needs `{ text, sourceRefs[] }`, schema-validated |
| `src/classify.ts` | LLM (fast): candidate → `{ type, category }`, enum-validated |
| `src/template.ts` | LLM (strong): candidate → slots; code builds `statement` from slots |
| `src/lint.ts` | pure: `lint(version, config.requirements.lint): Flag[]` |
| `src/signature.ts` | pure: `signature(draft)`, `requirementId(draft)` |
| `src/dedupe.ts` | pure: duplicates and conflicts against existing rows in scope |
| `src/questions.ts` | pure: flags and conflicts → question payloads (templates from REQUIREMENTS_ANALYSIS §4.6) |
| `src/impact.ts` | pure: `impact(reqId): Impact` from `requirementLink` code refs + `depEdge` read edges + overlapping requirements + verifications |
| `src/run.ts` | orchestrates, writes `out/requirements/<scope>.*.json`, calls `proposeRequirement` / `createQuestion` |

**Network:** LLM calls via `packages/llm` (3 per candidate, cached); SpacetimeDB WebSocket.
**Tests:** `fixtures/requirements/planted.bundle.json` + `planted.key.json`; vitest asserts exact match and a
zero-network replay.

### 5.2 `services/people` (container)

**Trigger:** start-up, then `PEOPLE_REFRESH_MINUTES` *(placeholder 60)*, or a manual run.

| File | Does | Network |
| --- | --- | --- |
| `src/sources/hrExport.ts` | reads `fixtures/org/hr.json` (demo) | none |
| `src/sources/git.ts` | `git log --format=%H%x09%ae%x09%an%x09%at --name-only` on `legacy/carddemo`, mapped through `fixtures/org/git-authors.json` | none (local git) |
| `src/sources/codeowners.ts` | parses CODEOWNERS if present | none |
| `src/sources/jira.ts` | component leads, ticket reporters for tickets linked to scopes | `GET /rest/api/3/project/{key}/components`; `GET /rest/api/3/search/jql?jql=...&fields=reporter,assignee,components` **(verify: Atlassian moved search to `/search/jql`)** |
| `src/sources/confluence.ts` | page owners for spec pages | `GET /wiki/rest/api/search?cql=...` **(verify)** |
| `src/sources/notion.ts` | page owner / created_by for policy pages | `GET https://api.notion.com/v1/pages/{id}`, `Notion-Version` header **(verify current version string)** |
| `src/sources/slack.ts` | titles and emails for mapping | `GET users.lookupByEmail`, `users.info` |
| `src/identity.ts` | email normalization, joins, `identityMatch` candidates | none |
| `src/authority.ts` | weighted score per (person, scope, category) with commit half-life | none |
| `src/approvers.ts` | threshold + active + access → approver rows with evidence | none |
| `src/index.ts` | writes `out/people/org.json`, calls `loadPeople` in chunks | SpacetimeDB |

`accessGrant` for the demo comes from `fixtures/org/access.json` (who has which pocket), standing in for repo
teams / RACF. In a real deployment it would come from the source systems' permission APIs.

### 5.3 `services/context` (container)

**Trigger:** `question` rows with `status = open` and no context hits yet.

```ts
interface Connector { name: string; search(q: SearchQuery): Promise<Hit[]> }
type Hit = { source: string; url: string; title: string; quote: string; score: number };
```

| Connector | Call | Auth |
| --- | --- | --- |
| Jira | `GET {JIRA_BASE_URL}/rest/api/3/search/jql?jql=text ~ "<terms>" ORDER BY updated DESC&fields=summary,description,comment&maxResults=10` **(verify)** | Basic `email:api_token` |
| Confluence | `GET {CONFLUENCE_BASE_URL}/wiki/rest/api/search?cql=text ~ "<terms>"&limit=10` then `GET /wiki/api/v2/pages/{id}?body-format=storage` **(verify)** | Basic `email:api_token` |
| Notion | `POST https://api.notion.com/v1/search {query, page_size:10}` then `GET /v1/blocks/{id}/children` to read text | `Bearer NOTION_TOKEN`, `Notion-Version` |
| Git history | local `git log -S<term>` / `git log -L` on cited lines | none |

Search terms come from code, not the LLM: program name, paragraph name, field names from the copybook, and the
requirement's slot words. Ranking: BM25 over the returned snippets, then the top 3 per source. Quotes are cut
to the matching sentence plus one either side. Flow: `claimQuestion` → search all connectors in parallel →
`recordContextHits`. All calls through `cachedFetch`.

### 5.4 `services/outreach` (container, the only Slack client)

**Library:** `@slack/bolt` in Socket Mode. **Network:**

| When | Call |
| --- | --- |
| Start | `POST apps.connections.open` (app token) → WebSocket for events and button clicks |
| Send a question or digest | `POST chat.postMessage { channel: <DM or user id>, blocks }` |
| After an answer elsewhere | `POST chat.update { channel, ts, blocks }` to show "answered by Maria" |
| Map person → Slack user | `GET users.lookupByEmail` (cached) |
| Tone (stretch) | `GET conversations.history` on channels the bot is in, admin-approved |

**Files:**

| File | Does |
| --- | --- |
| `src/index.ts` | connect to SpacetimeDB; subscribe to `outreach` where `status = queued`; start Bolt |
| `src/render/business.ts` | Block Kit: one-sentence rule, example table (3 rows from golden cases), impact line, buttons |
| `src/render/engineer.ts` | Block Kit: cleaned COBOL excerpt (comment lines dropped), file:line, neighbors, buttons |
| `src/render/digest.ts` | per-approver digest: summary line + up to N items ranked by `unblocks` |
| `src/tone.ts` | style rules (banned phrases list), few-shot examples, optional team profile |
| `src/actions.ts` | `block_actions` handler → `answerQuestion` / `approveRequirement` / `attest` |
| `src/send.ts` | sends due `outreach` rows; calls `markOutreachSent` |

Escalation itself is decided in the module (`escalationTick` writes new `outreach` rows at the next step); this
worker just sends whatever is queued. Business hours: `nextActionAtMs` is computed in the reducer from the
recipient's `person.tz` *(add `tz` to `person`)*.

### 5.5 `services/harness` (Brev)

**Trigger:** `migrationJob` with `state = rewriting` and no lease.

| File | Does |
| --- | --- |
| `src/index.ts` | connect; subscribe to `migrationJob`, `requirement*`, `requirementLink`; claim via `advanceJob` lease |
| `src/task.ts` | builds the OpenHands task: pocket files, copybooks, approved requirements in scope (as numbered rules), golden cases path, required trace links, definition of done |
| `src/openhands.ts` | starts OpenHands headless for the job workspace and streams its events; **(verify)** current headless entry point (CLI flag or Python module) and how it takes an MCP server and an OpenAI-compatible `base_url` |
| `src/workspace.ts` | `git worktree add /work/<jobId>`; copies golden cases; cleans up |
| `src/report.ts` | reads results (compile status, test results, trace links recorded via tools) → `advanceJob`, `linkRequirement` |

**Network:** SpacetimeDB WebSocket to Maincloud; OpenHands → `llm-proxy` on localhost; OpenHands → `harness-tools`
on localhost. No Slack, no outside REST.

### 5.6 `services/harness-tools` (Brev, MCP server)

TypeScript MCP server (`@modelcontextprotocol/sdk`), local HTTP transport on `127.0.0.1`, reading from its own
SpacetimeDB subscription cache:

| Tool | Input | Output | Source |
| --- | --- | --- | --- |
| `neighbors` | `{ id, depth≤3, rels? }` | nodes + edges | `graphNode`, `depEdge` |
| `who_touches` | `{ dataset }` | programs with read/write | `depEdge` |
| `get_requirements` | `{ scope }` | approved requirements with slots | `requirement`, `requirementVersion` |
| `record_trace` | `{ reqId, file, startLine, endLine, symbol }` | ok | calls `linkRequirement` |
| `ask` | `{ reqId?, text, evidence[] }` | questionId | calls `createQuestion` (reason `conflict` or `unmade-decision`) |
| `grep` | `{ pattern, path? }` | matches | ripgrep in the job workspace |

### 5.6a Harness tool access (full coding toolkit, behind guardrails)

OpenHands gets the full toolkit of a coding agent: shell, file editing, compiler and test runs, package
installs, a browser, and web search. The outside world is reached only through proxies so customer code
can't leak, runs stay replayable, and every action is audited.

| Tool | Setting (`harness.tools.*`) | How |
| --- | --- | --- |
| Shell, file edit, `javac`, tests, profilers | `on` | Inside the job sandbox (`/work/<jobId>`) |
| Package installs (Maven, npm) | `on` via mirror | Caching mirror on Brev; no direct registry access |
| Browser | `allowlist` (default) / `off` / `on` | Through `services/web-proxy`; default allowlist: IBM Enterprise COBOL reference, GnuCOBOL docs, Oracle Java docs **(placeholder list)** |
| Web search | `allowlist` (default) / `off` / `on` | Search API called by `services/web-proxy`; queries redacted first |
| Any other network | `off` | Sandbox egress firewall |
| Slack, Jira, Notion, `.env` secrets | never | People are reached only through the `ask` tool → `question` row → outreach worker |

**Guardrails:**

- **Egress firewall.** The sandbox can reach only `llm-proxy`, `harness-tools`, `web-proxy` and the package
  mirror, all on localhost. Implemented as a Docker network with no default route plus an allowlist
  (iptables or the container runtime's network policy, **verify** on the Brev image).
- **Scoped workspace.** The worktree contains only the pocket's files and the copybooks/shared code the job is
  entitled to, built from `accessGrant`, not the whole repo. No secrets in the sandbox environment.
- **Redaction.** `web-proxy` rejects queries and URLs containing code-shaped text, account/card-number
  patterns, or identifiers from the pocket (program, paragraph and field names) before anything leaves Brev.
- **Prompt-injection containment.** Web content is data. The agent can't change requirements (only `ask`), and
  every result still has to pass the verifier and the requirements gate.
- **Budgets per job.** `harness.budget.maxToolCalls`, `maxBrowserPages`, `maxSearches`, `wallClockMinutes`
  *(placeholders)*. Exceeding one fails the attempt and counts toward `llm.maxFixAttempts`.
- **Audit.** Every tool call is recorded as an `agentStep` row (§3.3a).

### 5.6b `services/web-proxy` (Brev)

| File | Does |
| --- | --- |
| `src/index.ts` | HTTP server on 127.0.0.1: `GET /fetch?url=` and `GET /search?q=` |
| `src/policy.ts` | mode (`off` / `allowlist` / `on`), domain allowlist, redaction rules |
| `src/redact.ts` | blocks code-shaped text, PAN/account-number patterns, pocket identifiers |
| `src/search.ts` | calls the configured search API **(verify provider: e.g. Brave Search or Tavily; key in Brev `.env`)** |

All responses go through `packages/http` caching, so demo runs replay with no outside calls. Each request
calls `recordAgentStep` with the URL or query and whether it was allowed.

### 5.7 `services/llm-proxy` (Brev)

A small HTTP server exposing `POST /v1/chat/completions`. It hashes the request, returns a cached response if
present, otherwise forwards to NIM/vLLM on `localhost:8000/v1`, stores and returns. Same three modes. This is
what makes OpenHands runs replayable.

### 5.8 `services/verifier` (container)

**Trigger:** a `verification` with `status = pending | stale`, or a new Java build reported by the harness.

| Method | Runs | Writes |
| --- | --- | --- |
| `test` | JUnit tests generated from the requirement (template in `src/gen/junit.ts`), run with the JDK in the container against the Java target | `out/verify/.../junit.xml` |
| `lint` | rules in `src/lint/` (semicolons, comment style, `BigDecimal` for money fields, function length, message-chain depth) run over the Java source tree with a Java parser **(verify choice: e.g. a tree-sitter Java grammar)** | `lint.json` |
| `benchmark` | the program's job run on `fixtures/bench/<job>.data`, timed 5 times, median | `bench.json` |
| `shadow` | reads `migrationJob` match rate for the requirement's endpoints | none (status only) |
| `attest` | nothing; waits for the `attest` reducer | none |

Calls `recordVerification` with the artifact path and sha256.

### 5.9 Existing workers touched

- **Part 2 reader**: writes `out/part2.json` (spec) and calls `createQuestion` for its questions instead of
  sending anything.
- **Router**: unchanged, but mismatch groups whose signature matches an approved `behavior` requirement are
  judged by that requirement (REQUIREMENTS_ANALYSIS §9.4).

---

## 6. Every network call

| From | To | Protocol / call | Auth | Cached | When |
| --- | --- | --- | --- | --- | --- |
| every worker, harness, UI | Maincloud `wss://maincloud.spacetimedb.com` | SpacetimeDB WebSocket (subscribe, reducer calls) | identity token | no (it's the state) | always |
| requirements, Part 2 | NVIDIA `integrate.api.nvidia.com/v1/chat/completions` (testing) or Brev proxy (shared) | HTTPS POST | Bearer | yes, `.cache/llm` | per candidate / pack |
| OpenHands | `llm-proxy` → NIM `localhost:8000/v1` | HTTP POST | none (local) | yes, `brev:/cache/llm` | per agent step |
| OpenHands | `harness-tools` `127.0.0.1` | MCP over HTTP | none (local) | no | per tool call |
| OpenHands | `web-proxy` `127.0.0.1` → allowlisted docs sites / search API | HTTP, then HTTPS out | search API key (Brev `.env`) | yes | per browse/search, if enabled |
| OpenHands | package mirror on Brev → Maven Central / npm | HTTP, then HTTPS out | none | yes | per install |
| context, people | Jira Cloud REST | HTTPS GET | Basic | yes, `.cache/http` | per question / refresh |
| context, people | Confluence Cloud REST | HTTPS GET | Basic | yes | per question / refresh |
| context, people | Notion API | HTTPS GET/POST | Bearer | yes | per question / refresh |
| outreach | Slack `apps.connections.open` + Socket Mode WS | HTTPS + WSS | app token | no | start-up |
| outreach | Slack Web API (`chat.postMessage`, `chat.update`, `users.lookupByEmail`, `conversations.history`) | HTTPS POST/GET | bot token | lookups only | per message |
| people, context | local git | process | none | n/a | per run |
| verifier, Java runner, legacy shim | localhost inside the container | HTTP | none | no | per run |

Nothing calls out from the browser except the SpacetimeDB WebSocket.

---

## 7. Flows end to end

### 7.1 A gap becomes an answered requirement

```
requirements ─ lint flags "normally" ─► createQuestion(reason=ambiguous-word, urgency=critical)
context      ─ claimQuestion ─► Jira/Confluence/Notion search ─► recordContextHits   (still unresolved)
requirements ─ routing (people tables) ─► queueOutreach([Priya, Dev], business/engineer)
outreach     ─ chat.postMessage ×2 ─► markOutreachSent
module       ─ escalationTick @ +6.5h ─► outreach row step=follow-up ─► outreach sends
module       ─ escalationTick @ +12h  ─► step=manager (Maria via reportsTo) ─► outreach sends
Slack        ─ Maria clicks ─► Bolt block_actions ─► answerQuestion
module       ─ fills slot, re-lint pending ─► requirements reruns scope ─► proposeRequirement (new version, clean)
outreach     ─ digest to approvers ─► Maria clicks Approve ─► approveRequirement (ctx.sender checked)
UI           ─ SpacetimeSource receives row updates ─► store ─► Requirements review shows "approved"
```

### 7.2 Migration with the gate

```
module   ─ advanceJob(capturing→rewriting) refused until behavior reqs approved ─► then allowed
harness  ─ claims job ─► builds task ─► OpenHands ⇄ llm-proxy ⇄ NIM ; OpenHands ⇄ harness-tools
harness  ─ record_trace / linkRequirement ─► advanceJob(rewriting→shadowing)
router   ─ shadow traffic ─► recordShadowBatch ─► match rate
verifier ─ runs test / lint / benchmark ─► recordVerification ; Maria attest ─► attest
module   ─ cutover reducer: canary only when all verifications passing
```

---

## 8. Worker container (friend's laptop)

```dockerfile
# docker/workers/Dockerfile (sketch)
FROM --platform=linux/arm64 node:22-bookworm
RUN apt-get update && apt-get install -y gnucobol openjdk-17-jdk-headless git ripgrep && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
CMD ["pnpm", "workers"]          # starts every long-running worker from docker/workers/procfile
```

- **(verify)** the JDK package available on bookworm arm64 (17 is in bookworm; the repo notes JDK 21 locally).
- Volumes: `./out`, `./.cache`, `./legacy` mounted from the host so outputs and caches survive restarts.
- `procfile`: `context`, `outreach`, `people` (refresh loop), `verifier`, `router`, `traffic`, `legacy-shim`,
  `java-runner`. One-shot commands (`part1`, `runtime`, `part2`, `requirements --scope`) run with
  `docker compose exec workers pnpm <cmd>`.
- Restart policy `unless-stopped`; each worker reconnects and resumes from tables.

Brev runs a separate setup: NIM/vLLM, `llm-proxy`, OpenHands, `harness`, `harness-tools`, and a JDK.

---

## 9. UI changes (root `src/`): listed only, built separately

**Not part of the backend build.** This section lists what the UI needs so a separate effort can extract
it. The backend's job is to provide the tables, views and reducers these screens consume; the TypeScript
shapes below must match §3 so the UI team can build against them.

### 9.1 Types (`src/types.ts`)

Add `Requirement`, `RequirementVersion`, `RequirementFlag`, `RequirementLink`, `Conflict`, `Approval`,
`Verification`, `ChangeRequest`, `Question` (extended), `ContextHit`, `Person`, `Team`, `Approver`,
`Outreach`, `Impact`, mirroring §3 field names in camelCase. `Decision` stays for the existing screens and
becomes a derived view of approved `behavior` requirements (R1).

### 9.2 Source events (`src/data/source.ts`)

```ts
| { type: 'requirementUpserted'; requirement: Requirement; version: RequirementVersion; flags: RequirementFlag[] }
| { type: 'approvalRecorded'; approval: Approval }
| { type: 'questionUpserted'; question: Question }
| { type: 'contextHitsAdded'; questionId: string; hits: ContextHit[] }
| { type: 'conflictUpserted'; conflict: Conflict }
| { type: 'verificationUpserted'; verification: Verification }
| { type: 'outreachUpserted'; outreach: Outreach }
| { type: 'peopleLoaded'; people: Person[]; teams: Team[]; approvers: Approver[] }
```

`RealtimeSource` gains action methods that map 1:1 to reducers: `approveRequirement`, `rejectRequirement`,
`editRequirement`, `markNeedsInfo`, `requestRequirementChange`, `resolveConflict`, `answerQuestion`,
`attest`, `signOffApprovers`. `MockSource` implements them against scenario data; `SpacetimeSource` calls the
reducers.

### 9.3 `SpacetimeSource` (`src/data/spacetimeSource.ts`)

Connects with the generated bindings, subscribes to the **views** (`my_requirements`, `my_questions`, …) and
the public tables, and turns `onInsert` / `onUpdate` callbacks into the events above. Switched on in
`src/data/factory.ts`, the one-line change the seam was designed for.

### 9.4 Store (`src/store/useStore.ts`)

New slices keyed by id (`requirements`, `versions`, `flagsByVersion`, `questions`, `hitsByQuestion`,
`conflicts`, `verificationsByReq`, `outreach`, `people`, `approvers`) and granular selectors:
`selectRequirements(filter)`, `selectRequirement(id)`, `selectQuestions(filter)`, `selectConflicts`,
`selectApproverInbox(personId)`, `selectGate(pocketId)`, `selectCanApprove(reqId)`.

### 9.5 Components

One folder per area (§1), one owner each, following CONTRACT.md. Screen specs are REQUIREMENTS_ANALYSIS §12.

---

## 10. Config additions (`theseus.config.json`, validated by zod in `packages/shared`)

As REQUIREMENTS_ANALYSIS §15, plus: `requirements.digest.maxItems` *(placeholder 10)*,
`people.refreshMinutes` *(placeholder 60)*, `context.maxHitsPerSource` (3), `context.quoteSentences` (1),
`verifier.benchmarkRuns` (5), and for the harness:

```jsonc
"harness": {
  "tools": { "shell": "on", "packages": "mirror", "browser": "allowlist", "search": "allowlist" },
  "browserAllowlist": ["www.ibm.com/docs", "gnucobol.sourceforge.io", "docs.oracle.com"],
  "budget": { "maxToolCalls": 300, "maxBrowserPages": 20, "maxSearches": 10, "wallClockMinutes": 30 },
  "auditKeepJobs": 50
}
```

All harness values are placeholders.

---

## 11. Tests

| Area | Test |
| --- | --- |
| Module | vitest on every reducer: allowed and refused transitions; approval by a non-approver refused; edit resets approval; view returns nothing without a grant |
| Requirements | planted bundle → exact keyed output; replay is byte-identical with zero network |
| People | planted org: merges, left-company successor, name-only match goes to review, approver evidence present |
| Context | planted Jira/Notion fixtures served from `.cache/http`; correct hits and quotes |
| Outreach | Block Kit snapshots for both renderings; escalation sequence on a fake clock; button → reducer |
| Harness | spike: one OpenHands run on a toy repo via the proxy; then CBACT04C end to end |
| Verifier | generated JUnit for the truncation requirement fails on a rounding implementation and passes on truncation |
| Harness tools | egress test: a sandbox `curl` to a non-allowlisted host fails; `web-proxy` blocks a query containing a PAN-shaped number and a pocket field name; every tool call produces an `agentStep` row |
| UI | built separately; not part of this build |

---

## 12. Things to verify before coding

1. SpacetimeDB 2.14.1: TS `spacetimedb.view` + `ViewContext.sender`, scheduled-table syntax for
   `escalationTick`, `t.identity().optional()`, client SDK builder names.
2. Jira Cloud search endpoint (`/rest/api/3/search/jql`) and its pagination; Confluence v1 vs v2 search.
3. Notion API version header string and rate limits.
4. OpenHands: headless entry point, how to point it at an OpenAI-compatible `base_url`, how to attach an MCP
   server, and whether Nemotron drives its tool calls reliably (the Phase 6 spike).
5. JDK package on bookworm arm64, and a Java parser for the lint runner.
6. Restoring the root `pnpm` scripts lost in the UI merge.
7. OpenHands' built-in browser and how to route it through `web-proxy`; the egress-firewall mechanism on the
   Brev image; which search API to use.
