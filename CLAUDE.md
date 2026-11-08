# Shadow-Diff — Legacy Rewrite Communication Layer

HackUTD 2026. This repo is the **UI layer** (the product). Everything else (map/capture/rewrite/shadow backend) is plumbing. The demo is **tomorrow** and must run **fully standalone — no backend required**.

## What the system does

Rewrites legacy COBOL one component at a time. Runs old + new side by side, diffs outputs, and when they disagree and the agent can't tell which is right, it asks the right human on Slack with a one-click question. Every answer becomes a test — tribal knowledge gets codified.

Loop: **Map → Capture → Rewrite → Shadow (diff) → Ask (Slack) → Lock in (test) → Cut over (1%→10%→100%)**.

## Two models — strict role split

- **Nemotron THINKS** (generative): rewrites COBOL, writes explanations, streams the reasoning panel. NVIDIA prize — must be visibly labeled in the UI.
- **Jev DECIDES** (bounded judgments, no text): what UI to show, whether to ask a human, mismatch category, who to route to, which evidence widget, whether cutover is safe. This is our **generative / agentic UI / AI-driven design system** story — the layout itself is model-driven.

Never mix roles: Jev generates nothing; Nemotron makes no typed decisions.

## Tech stack

Vite + React + TypeScript + Tailwind v4 · Zustand (state) · React Flow (graph) · Recharts · Framer Motion (count-up + layout). Path alias `@/` → `src/`.

## Architecture — the realtime seam (do NOT break this)

The UI **never** talks to a backend directly. It reads a Zustand store (`@/store`), fed by whatever `createSource()` returns:

- today: **`MockSource`** — scripted scenario replay, 100% offline (demo-safe)
- later: `SpacetimeSource` / `WebSocketSource` — same `RealtimeSource` interface

Swapping backends is a **one-line change** in `src/data/factory.ts`. No UI component imports a source directly. Source emits `SourceEvent`s → store reducer applies them → components read granular selectors.

### File ownership (keep disjoint for parallel work)
- Foundation (shared, read-only to screens): `src/types.ts`, `src/data/**`, `src/store/**`, `App.tsx`, `src/index.css` theme tokens.
- Screens (one owner each): `src/components/dashboard/**`, `src/components/graph/**`, `src/components/inspect/**`.

## Screens (priority order)

1. **Shadow-diff dashboard (hero)** — animated match-rate (82%→99%), live match-% chart, mismatches by category (formatting/rounding/logic/noise) + root cause, locked cutover slider (unlocks at 99%). Money moment: Slack answer lands → number jumps <1s.
2. **Dependency graph** — nodes=programs, edges=calls/shared-files, colored by isolation, chosen component highlighted (React Flow, precomputed layout — no live force sim on stage).
3. **Mismatch detail** — input / old / new diff + COBOL-vs-rewrite snippet; evidence widget chosen by Jev.
4. **Decision log** — question → answer → who → test → # mismatches resolved.
5. **Nemotron reasoning panel** + **Jev decisions tab** beside it.

## Data contracts (`src/types.ts`)

`Component`, `Mismatch`, `Decision` (human/Slack answers frozen into tests), `AgentThought {phase, text, model:"Nemotron"}`, `Snapshot` (aggregate). Keep in lockstep with the backend team.

## Research-driven principles (see `research/` — read `research-map.md` first)

These come from the team's research (UTD CS 3354 + 8090 + clarifying-question benchmarks). Bake them into the UI; they're the credibility signals judges reward.

1. **The legacy system is NOT ground truth.** Every mismatch is triaged by `classification`:
   - `defect` → contradicts an agreed invariant → **agent fixes silently, never asks** (show it as already auto-fixed).
   - `unmade-decision` → no answer exists anywhere → **this is the only kind that becomes a Slack card.**
   - `noise` → nondeterminism (timestamps, ids) → **filtered** (measured via two-copies-of-old baseline = `noiseBaseline`).
   This is exactly Jev's "Needs a human?" Noul decision. Surface the three buckets distinctly.
2. **Ask for a decision, not an explanation.** [Old] [New] [Neither] [Doesn't matter] buttons. Each answer maps to a different generated artifact (`DecisionAnswer` doc comment).
3. **Batch & rank.** One answer resolves a whole root-cause group (`resolvedCount`) — show "resolves N mismatches".
4. **Compare effects, not just return values** (rows written, messages sent) — richer than scalar diffs.
5. **Classify by impact, show what was waved off.** Dashboard should show how many mismatches were auto-filtered/auto-fixed, not just the match %. Money/critical paths get stricter thresholds.
6. **Route by role** (git blame / CODEOWNERS) — `answeredBy`. Jev decides which owner.
7. **Every answer → a test AND a decision record** (the "business rules doc that never existed") → later a CI fitness check.

Demo target is AWS CardDemo COBOL — our component ids (CBTRN02C, CBACT04C) are real CardDemo programs.

---

# Jev (TypeSafe) — Decision Model Reference

## What it is
- Jev = TypeSafe's "System One" decision model. Text/JSON in → **typed decision out**. Generates NO text, code, or explanations.
- A general-purpose classifier with a world model. Use for **bounded judgments**; use Nemotron for anything generative.
- Access: TypeSafe API (waitlist), OpenRouter (`typesafe/jev-1.13`), or Braintrust. Verify exact request field names in docs before coding.
- Latency ~70–500ms. Cost $0.042 / 1M input tokens, output free.

## Request shape
- `state`: the info Jev reads (string, object, or array — **text only, no images**).
- `questions`: named object of **independent** questions, evaluated in parallel against the same state.
  - Extra questions barely add latency (but add input tokens).
  - Questions CANNOT depend on each other in one request → chain dependencies in app code.

## Question types
| Type   | Provide                                    | Returns                                                                 |
|--------|--------------------------------------------|-------------------------------------------------------------------------|
| Choice | question + options (max 255)               | selected option, per-option probabilities, confidence                   |
| Score  | question + 2–10 ordered levels in words    | probability-weighted mean of level index (0-based, can be fractional e.g. 1.4), probabilities, confidence |
| Noul   | yes/no question + definition of "yes"      | P(yes) in [0,1]; ~0.5 = unsure. No separate confidence                  |

## Rules / gotchas
- **Confidence (Choice/Score) = how concentrated the distribution is, NOT probability of being correct.** Calibrate thresholds on real examples.
- Typed output ≠ correct output: it can pick the wrong valid option.
- Weak at arithmetic, counting, date ordering → **NEVER send raw numbers; compute in code, pass labels** ("at threshold", "rising").
- Irrelevant context degrades accuracy → send minimal, summarized state.
- Not hostile to prompt injection by default → don't put untrusted text in state without guarding.
- **Always have a deterministic fallback** when confidence is low or the call fails.

## How we use it (Shadow-diff UI)
Pattern: **Snapshot → summarize() (labels, no numbers) → Jev → gate vs. component catalog → render (Framer Motion layout).**
Roles: Nemotron THINKS (rewrite, explain, reasoning panel). Jev DECIDES (what to show, whether to ask a human).

| Decision                                                          | Type   | Drives                                     |
|-------------------------------------------------------------------|--------|--------------------------------------------|
| Hero panel now?                                                   | Choice | dashboard layout per phase                 |
| Mismatch category (formatting/rounding/logic/noise)               | Choice | category chips, "?" if low confidence      |
| Needs a human (vs. auto-resolve)?                                 | Noul   | send Slack question or not (core product)  |
| How much does answering unblock?                                  | Score  | question queue ranking                     |
| Which owner to ask (git blame candidates)?                        | Choice | Slack routing                              |
| Best evidence widget (numberLine/charDiff/branchTrace/tableDiff)? | Choice | generative detail view + Slack card        |
| Safe to advance cutover?                                          | Noul   | unlock cutover slider                      |

## Implementation notes
- Add event type: `UIDecision { question, type, choice, probabilities, confidence?, latencyMs, model: "Jev" }`.
- **Record real Jev responses into MockSource replay scripts → demo runs offline.**
- Cache by snapshot hash; debounce ~300ms.
- Show `Jev · 94% · 140ms` chips on decided UI + a **Decisions tab** beside the Nemotron reasoning panel.
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
- [docs/EXTRACTOR_SPIKE.md](docs/EXTRACTOR_SPIKE.md): prototype findings on CardDemo and beyond-code dependencies (feeds SEGMENTATION.md)
- [docs/AGENT_LOOP.md](docs/AGENT_LOOP.md): per-pocket state machine, ranking, the oracle
- [docs/HUMAN_LOOP.md](docs/HUMAN_LOOP.md): knowledge base, when to ask, routing, answer → test
- [docs/DEMO.md](docs/DEMO.md): demo storyline and what to seed
- [docs/DECISIONS.md](docs/DECISIONS.md): decision log + open questions
- [docs/TASKS.md](docs/TASKS.md): milestones, owners, and how the work is split
- [research/README.md](research/README.md): the research behind all of this
