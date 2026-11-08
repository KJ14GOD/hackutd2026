# Shadow-Diff — Legacy Rewrite Communication Layer

HackUTD 2026. `web/` is the **UI layer** (the product) of the Theseus repo; everything else in the repo (map/capture/rewrite/shadow backend) is plumbing. It is its own npm project outside the pnpm workspace (D-027): `cd web && npm install && npm run dev` → http://localhost:5173. The demo must run **fully standalone — no backend required**. See [README.md](README.md) for what is on screen and where it lives.

## What the system does

Rewrites legacy COBOL one component at a time. Runs old + new side by side, diffs outputs, and when they disagree and the agent can't tell which is right, it asks the right human on Slack with a one-click question. Every answer becomes a test — tribal knowledge gets codified.

Loop: **Map → Capture → Rewrite → Shadow (diff) → Ask (Slack) → Lock in (test) → Cut over (1%→10%→100%)**.

## Two models — strict role split

- **Nemotron THINKS** (generative): rewrites COBOL, writes explanations, streams the reasoning panel. NVIDIA prize — must be visibly labeled in the UI.
- **Jev DECIDES** (bounded judgments, no text): what UI to show, whether to ask a human, mismatch category, who to route to, which evidence widget, whether cutover is safe. This is our **generative / agentic UI / AI-driven design system** story — the layout itself is model-driven.

Never mix roles: Jev generates nothing; Nemotron makes no typed decisions.

## Tech stack

Vite + React 19 + TypeScript + Tailwind v4 · Zustand (state) · lucide-react (icons) · clsx + tailwind-merge (`cn`). Nothing else at runtime. The map is **hand-drawn SVG** (custom isometric projection, camera and tweens in `src/components/map/`), not React Flow; don't add a graph or chart library for it. Lint with `npx oxlint src`. Path alias `@/` → `src/`. Typecheck with `npx tsc -b`.

Look: dark, near-black (`#000` map, `#0b0b0e`/`#121216` panels), Inter + JetBrains Mono, one cyan accent (`#45c7f5`) for selection and the live component; green = on Java / safe, amber = cutting over / retest, red = tangled. Copper (`#cb9d5f`) is reserved for data wires. Map colors live in `src/components/map/theme.ts` and must stay in step with the CSS tokens in `src/index.css`.

## Architecture — the realtime seam (do NOT break this)

The UI **never** talks to a backend directly. It reads a Zustand store (`@/store`), fed by whatever `createSource()` returns:

- today: **`MockSource`** — scripted scenario replay, 100% offline (demo-safe)
- live: **`SpacetimeSource`** (`src/data/spacetimeSource.ts`), opt-in with `?source=spacetime` or `VITE_SOURCE=spacetime` (`VITE_STDB_URI`, default `ws://localhost:3000`; `VITE_STDB_DB`, default `theseus`). It wraps MockSource and overlays the tables the backend has today: people, teams, reports-to, ownership, approvers, questions and Slack outreach. Requirements, conflicts, approvals, checks and the shadow run still come from the mock until their tables exist. Answering a live question calls the `answerQuestion` reducer. If SpacetimeDB is unreachable it logs a warning and stays on mock data.
- Slack (dev only): `MockSource` posts question cards to real Slack and takes button answers back through the Vite dev server (`server/slack.ts`, `src/data/slackOut.ts`); components never see it. See README "Real Slack".

Swapping backends is a **one-line change** in `src/data/factory.ts`. No UI component imports a source directly. Source emits `SourceEvent`s → store reducer applies them → components read granular selectors.

The codebase graph is separate from the live stream: `src/data/carddemo.graph.json` is a committed snapshot of the segmenter output (`out/segmentation.json`), made by `node scripts/snapshot-graph.mjs <path>`. `src/data/carddemo.ts` adds curation (pocket titles, rows, teams, seed migration states, flows) and pure queries (`blastRadius`, `cutCost`, `migrationProgress`, …). Never hand-edit the JSON; re-run the script.

### File ownership (keep disjoint for parallel work)
- Foundation (shared): `src/types.ts`, `src/data/**`, `src/store/**`, `App.tsx`, `src/index.css` theme tokens.
- Map: `src/components/map/**` (floorplan in `layout.ts`, renderer + camera in `MapCanvas.tsx`, highlight rules in `highlight.ts`).
- Shell: `src/components/shell/**` (Systems sidebar, Inspector, Search, kit) and `src/components/mission/MissionControl.tsx` (screen state, keyboard, layout).

## The screen: mission control (one screen, three columns)

1. **Map (centre, hero)** — CardDemo as a chip floorplan: 6 shared data files are copper bus lanes, 15 pockets sit in two rows and tap into the lanes they use; clicking a pocket flies in and raises its programs, local files and entry points (semantic zoom). Views: **Iso** / **Layers** (data, programs, entry points as stacked planes). Lenses: **Migration / Coupling / Blast radius / Owners / Requirements**. Named **flows** step through a business process. Precomputed layout; no live force sim on stage.
2. **Systems sidebar (left)** — business domains as an accordion with % on Java, pockets with isolation in words, filter box, shared data stores (id + name).
3. **Inspector (right)** — **Inspect** (system, pocket, program with live shadow card + "View source" link, data file, flow), **Agent** (Nemotron log rows), **People** (Slack questions with COBOL vs Java values and Keep COBOL / Use rewrite; answered list).
4. **Top bar** — on-Java progress (2xl and wider), shadowing chip with live match rate, **Viewing as** (stands in for sign-in), search, scenario, Replay, Reset, **Simulate answer**. Money moment: Simulate answer → match rate jumps in <1s and the question moves to Answered.
5. **Rail (far left)** — Map plus four requirements workspaces (D-028, `REQUIREMENTS_ANALYSIS.md` §12): **Requirements** (review list, detail with History and Checks tabs, conflicts side by side, change request with impact preview and "Show on map"), **Questions** (evidence, context hits, one-click answers, escalation timeline on the sim clock), **Inbox** (what waits on the viewer, grouped by pocket) and **People** (org, ownership with signal and source, corrections, approver list and sign-off). Every screen has loading / empty / error / restricted states and a Business / Engineer toggle remembered per viewer. The pocket Inspector gains **Requirements and progress** (job state, the gate and what blocks it, harness attempts, cutover 1/10/100 for the live pocket).

Requirements data: `src/data/requirements.ts` (pure rules: lint, access, quorum, gate, impact, escalation ladder, inbox), `reqEvents.ts` (events + reducer), `reqSeed.ts` (seed world: people, ownership, approvers, jobs), `findings.ts` (Nemotron's Part 2 rules and suspected bugs as draft requirements and its questions as open questions, from `carddemo.findings.json`, which `node scripts/snapshot-findings.mjs [part2.json]` makes from `out/part2.json`; these replace the hand-written requirements, conflicts, approvals, checks and change request), `reqMock.ts` (the actions, sim clock +1 min per second). Screen state shared across workspaces (workspace, viewer, mode, open ids, impact on map) lives in `src/store/useUi.ts`.

Keyboard: `1`–`5` lenses (5 = Requirements gate), `L` view, `M` map only, `F` fit, `/` or `Ctrl K` search, `Esc` back, `←`/`→` flow steps.

Layout rules: the map-only toggle hides both panels; below 1440 px the sidebar starts hidden and the Inspector overlays the map (MapCanvas gets `insetRight` so fits stay clear of it). Map labels are screen-facing billboards shown only when they fit. The camera is imperative (a ref written straight to the SVG transform and a `--k` CSS variable, plus a coarse `kR` state for label fitting), so panning never re-renders React. One noun: **pocket**; one isolation scale: `ISO_LEVELS` in `theme.ts`.

Still to build (the deleted earlier screens had versions in git history): mismatch detail with the Jev-chosen evidence widget, decision log, Jev decisions tab. Map keys only act when the Map workspace is showing.

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
