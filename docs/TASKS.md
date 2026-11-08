# Tasks

Owners: **Backend A**, **Backend B**, **Frontend**, **Research**. The two backend devs
work in different directories to avoid conflicts. `spacetime/` is shared, so each
backend dev owns separate reducer files (`spacetime/src/reducers/<area>.ts`), and
`schema.ts` changes go in their own small PR.

## Milestone 0: setup

| Task | Owner | Status |
| --- | --- | --- |
| pnpm workspace, tsconfig, vitest, `.env.example`, `.gitignore` | Backend A | ✅ |
| `scripts/stdb.mjs` (native or Docker), verified publish / republish / reset / generate | Backend A | ✅ |
| `theseus.config.json` (incl. `ranking`) + zod schema + `pnpm config:push` + tests | Backend A | ✅ |
| Placeholder module (`config` table) + generated bindings | Backend A | ✅ |
| `pnpm legacy:fetch` (CardDemo at a pinned commit) | Backend A | ✅ |
| CLAUDE.md = AGENTS.md (test-enforced) + all docs as drafts | Backend A | ✅ |
| Team decisions Q1, Q2, Q4 → D-007, D-014, D-015 | All | ✅ |
| Confirm D-013 (Java target) and review the remaining PROPOSED items | All | ☐ |

## Milestone 1: walking skeleton, no LLM (starts after sign-off)

| Task | Owner | Dirs |
| --- | --- | --- |
| Module tables + reducers per DATA_MODEL (clock, traffic + ranking, jobs, shadow, sweep). Segmentation tables are done (D-025); add new areas as `spacetime/src/reducers/<area>.ts` | Backend A | `spacetime/` |
| Router: proxy, per-endpoint counting, routing table from SpacetimeDB, shadow diff + Diffy noise filter, mismatch rows | Backend A | `services/router/` |
| Hand-written Java replacement for one pocket (CBACT04C interest) + runner + `TargetRuntime` | Backend A | `target/` |
| Tools CLI: `tail`, `state`, `shadow`, `route`, `reset` | Backend A | `tools/` |
| **Spike Q15:** compile and run CardDemo batch programs under GnuCOBOL (Docker image with Debian `gnucobol`), stubs for `CEE3ABD`/`MVSWAIT`/`COBDATFT`, ASCII data → indexed files | Backend B | `legacy/` |
| Fixture app (overpay bug, dead-looking rule, never-called transaction) + HTTP shim + stub runtime + `LegacyRuntime` | Backend B | `legacy/fixture/`, `legacy/src/` |
| ✅ Segmenter on the dependency graph (`deps.json`, GRAPH_SCHEMA): projection, Louvain + repair + LOC cap, domains, isolation, endpoints, `loadSegmentation` tables, stand-in extractor (`pnpm deps:extract`), tests on CardDemo (`pnpm segment --publish`). Next: run it on the team extractor's `deps.json`; run it on the fixture once it exists; review D-019–D-026 | Backend B | `services/segmenter/`, `spacetime/src/reducers/segmentation.ts` |
| Traffic generator (sim-clock-aware rates, scenario) + clock controls | Backend B | `services/traffic/` |
| UI shell: connect, subscribe, mirror into Zustand; react to `pocket.discovered` | Frontend | `web/` |
| Map CardDemo paths → teammates (`config/owners.json`); write 1–2 expert notes for `knowledge/`; Slack question copy | Research | `config/`, `knowledge/` |

## Milestone 2: LLM loop, resolution, Slack, cutover (proposed split)

| Task | Owner | Dirs |
| --- | --- | --- |
| LLM provider: NVIDIA client, mock, record/replay cache by prompt hash | Backend A | `packages/llm/` (new) |
| Capture worker (golden cases) + rewrite/fix worker (Nemotron Super with tools: read file, write file, compile, run tests) | Backend A | `services/agent/` |
| Cutover reducer (1 → 10 → 100), self-heal sampling, automatic rollback | Backend A | `spacetime/src/reducers/cutover.ts`, `services/router/` |
| Mismatch grouping + classification worker (Nemotron Nano) + oracle order (D-015) | Backend B | `services/agent/src/resolve/` |
| Knowledge base: `decision`/`question`/`testCase`/`legacyBug` tables + reducers, note import, assumed-old digest | Backend B | `spacetime/src/reducers/human.ts`, `services/agent/src/knowledge/` |
| Slack bot (Bolt, Socket Mode): post cards, buttons → reducers, escalation timers | Backend B | `services/slackbot/` |
| Answer → test generator, legacy-bug impact estimate | Backend B | `services/agent/src/answers/` |
| Graph view (incl. "hot, too coupled"), pocket timeline, match-rate chart, Slack-card mirror | Frontend | `web/` |
| Demo script + recorded LLM cache + rehearsal | Research | `docs/DEMO.md` |
