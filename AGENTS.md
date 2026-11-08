# Theseus: read this first

<!-- CLAUDE.md (Claude Code) and AGENTS.md (Codex and other agents) must stay identical.
     Edit one, copy it to the other; `pnpm test` fails if they differ. -->

Theseus (working name) is an agent that modernizes legacy COBOL (AWS CardDemo) into Java
one "pocket" at a time. Live traffic and code isolation pick what to migrate. Shadow runs
check each rewrite. Old behavior is the default truth unless the knowledge base says
otherwise; when it's unclear, the agent asks an expert on Slack and the answer becomes a
test. HackUTD 2026 tracks: NVIDIA (Nemotron agent), SpacetimeDB (backend), 8090 (modernization).

**Status:** Milestone 0 (setup, config, draft docs). Designs in `docs/` marked PROPOSED
are not decided. Check `docs/DECISIONS.md` before building past one.

## Repo map

| Path | What | Status |
| --- | --- | --- |
| `spacetime/` | SpacetimeDB module (tables + reducers, TypeScript) | placeholder: `config` table only |
| `packages/shared/` | config loader + schema, SpacetimeDB connect helper, generated bindings | built |
| `scripts/` | `stdb.mjs` (SpacetimeDB native or Docker), `fetch-carddemo.mjs` | built |
| `theseus.config.json` | the one file for every tunable value | built (some values placeholders) |
| `legacy/carddemo/` | AWS CardDemo at a pinned commit; gitignored, run `pnpm legacy:fetch` | fetched |
| `legacy/` (rest) | `LegacyRuntime` adapter, our fixture COBOL app, HTTP shim | planned |
| `target/` | `TargetRuntime` adapter, generated Java, runner | planned |
| `services/router/` | HTTP proxy: counting, routing, shadow diff | planned |
| `services/traffic/` | traffic generator + sim-clock controls | planned |
| `services/segmenter/` | extractors, dependency graph, clustering | planned |
| `services/agent/` | workers: capture, rewrite, fix, classify, ask | planned (M2) |
| `services/slackbot/` | Slack Bolt app, buttons call reducers | planned (M2) |
| `tools/` | CLI that tails events/state (the backend demo until the UI exists) | planned |
| `web/` | frontend; owned by the frontend teammate | not ours |
| `docs/` | design docs (below) | draft |
| `research/` | background research; read-only | final |

## Commands

Prerequisites: Node >= 22, pnpm 10 (`corepack enable`, or `npm i -g pnpm@10`), git, and
Docker Desktop *or* the native SpacetimeDB CLI (`curl -sSf https://install.spacetimedb.com | sh`
on macOS/Linux, `iwr https://windows.spacetimedb.com -useb | iex` on Windows). Java 21 and
GnuCOBOL come in later milestones.

```sh
pnpm install                 # install the workspace
cp .env.example .env         # then fill in values (never commit .env)
pnpm legacy:fetch            # AWS CardDemo -> legacy/carddemo (pinned commit)

pnpm stdb:start              # local SpacetimeDB on :3000 (native, else Docker container theseus-stdb)
pnpm stdb:publish            # build + publish spacetime/ as database "theseus"
pnpm stdb:reset              # publish and DELETE all data (also use after breaking schema changes)
pnpm stdb:generate           # regenerate TS bindings into packages/shared/src/module_bindings
pnpm config:push             # validate theseus.config.json and store it in SpacetimeDB
pnpm stdb:sql "SELECT * FROM config"
pnpm stdb:logs               # module logs (add -f to follow)
pnpm stdb:stop               # stop the Docker container

pnpm test                    # vitest, all packages
pnpm typecheck               # tsc in every package
```

First run: `pnpm install && pnpm legacy:fetch && pnpm stdb:start && pnpm stdb:publish && pnpm config:push`.
Service and demo commands get added here when those services exist (see `docs/TASKS.md`).

SpacetimeDB gotchas (verified against v2.14.1):
- Export names become snake_case in SQL and the CLI: `setConfig` is `set_config` and
  `migrationJob` is `migration_job`. Generated TS bindings keep camelCase.
- The database belongs to the CLI identity that created it. In Docker mode that identity
  lives in `.cache/stdb-cli/`. If you lose it, `docker rm -f theseus-stdb`, delete that
  folder, then `pnpm stdb:start && pnpm stdb:publish`.
- After any change in `spacetime/`, run `pnpm stdb:publish && pnpm stdb:generate` and
  commit the regenerated bindings.

## Coding conventions

- TypeScript everywhere (ESM, strict), pnpm workspace, run with `tsx`. Java only for
  generated target code and its runner (plain JDK, no Spring).
- SpacetimeDB is the source of truth for **all** state. Services are clients: subscribe,
  do outside work (LLM, compile, HTTP, Slack), and write results back through reducers.
  State-transition rules live in reducers, never in services. There is no REST API for the UI.
- Every tunable value lives in `theseus.config.json`, validated by
  `packages/shared/src/config.ts`. No magic numbers in services.
- All time-based logic uses the sim clock stored in SpacetimeDB, never `Date.now()`.
- Every LLM call goes through the provider interface (mock + record/replay included).
- Pure logic lives in its own small files with no I/O so it can be unit tested.
- Never edit `legacy/carddemo/`; it is third-party code. Our own COBOL goes in `legacy/fixture/`.
- Names: files `camelCase.ts`; tables and reducers camelCase in TS; event types `noun.verb_past`.

## Working rules

- Docs are part of the code. Any change to tables, events, states or config updates the
  matching doc in the same commit.
- Small, focused commits with clear messages. Never commit secrets; maintain `.env.example`.
- Keep things simple and boring. Don't add abstractions beyond the adapters listed
  (`LegacyRuntime`, `TargetRuntime`, LLM provider, language extractor).
- Write tests for pure logic: segmentation, diff and noise filtering, mismatch grouping,
  state transitions. Every LLM call goes through the provider interface.
- Don't build the UI. The `tools/` CLI is how the backend gets demoed until the UI exists.
- When something is ambiguous, pick the most easily reversible option, log it in
  `docs/DECISIONS.md`, and keep going.
- Team rule for now: don't commit implementation for a PROPOSED design until the team
  signs off on it in `docs/DECISIONS.md`.
- CLAUDE.md and AGENTS.md are the same file for different agents. Change both together.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, data flow, who owns what
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md): every table and reducer (schema source of truth)
- [docs/EVENTS.md](docs/EVENTS.md): UI event contract (DRAFT, versioned)
- [docs/SEGMENTATION.md](docs/SEGMENTATION.md): extractors, graph, clustering, isolation
- [docs/AGENT_LOOP.md](docs/AGENT_LOOP.md): per-pocket state machine, ranking, the oracle
- [docs/HUMAN_LOOP.md](docs/HUMAN_LOOP.md): knowledge base, when to ask, routing, answer → test
- [docs/DEMO.md](docs/DEMO.md): demo storyline and what to seed
- [docs/DECISIONS.md](docs/DECISIONS.md): decision log + open questions
- [docs/TASKS.md](docs/TASKS.md): milestones, owners, and how the work is split
- [research/README.md](research/README.md): the research behind all of this
