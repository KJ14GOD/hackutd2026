# How this project is built — step by step

A map of how the Shadow Diff dashboard is constructed, in the order it was built and the order you'd rebuild it. Each step names the files it owns and the one idea that makes it work.

> Rule that holds the whole thing together: **the UI never talks to a backend.** It reads a store that is fed by a swappable source. Today that source is a scripted mock; tomorrow it's the real backend — one line changes.

---

## 1 · Scaffold & tooling

- **Vite + React + TypeScript**, **Tailwind v4** (via `@tailwindcss/vite`), path alias `@/ → src/`.
- Files: `vite.config.ts`, `tsconfig.app.json` (paths), `package.json`.
- Libraries: `zustand` (state), `recharts` (chart), `motion` (animation), `lucide-react` (icons). (React Flow was tried for the graph, then dropped — the graph is hand-drawn.)

## 2 · Design system (theme tokens)

- One place defines every color/spacing as CSS variables — flip them and the whole app re-skins.
- File: `src/index.css` — light "Apple" tokens (`--color-page`, `--color-ink`, `--color-accent`, …), plus small transition classes for the graph.
- Shared primitives: `src/components/ui/primitives.tsx` — `Panel`, `Chip`, `ModelBadge`, `JevChip`.

## 3 · Data contracts (the shared shapes)

- File: `src/types.ts`. The vocabulary both UI and (future) backend agree on:
  - `Component` (match rate, status, isolation, coverage)
  - `Mismatch` (`category` = rounding/logic/formatting/noise, `classification` = **defect / unmade-decision / noise**)
  - `Decision` (a human answer frozen into a test)
  - `AgentThought` (Nemotron reasoning), `UIDecision` (Jev typed decision), `Snapshot` (everything aggregated).
- Core idea baked in: **the legacy system is not ground truth** — every mismatch is triaged, and only `unmade-decision` ever asks a human.

## 4 · The realtime seam (store + source) — the keystone

- **Store** (`src/store/useStore.ts`): a Zustand store holding one `Snapshot`. A reducer (`apply`) turns events into new state. Components subscribe to narrow slices via selectors, so one match-rate tick re-renders only the number.
- **Source interface** (`src/data/source.ts`): `RealtimeSource` = `getSnapshot()` + `subscribe()` + an event stream (`SourceEvent`).
- **Mock source** (`src/data/mockSource.ts`): replays a scripted scenario, fully offline. It's what makes the demo safe.
- **Factory** (`src/data/factory.ts`): `createSource()` returns the mock today; swap to `SpacetimeSource`/`WebSocketSource` later — **the only line that changes.**

## 5 · The Jev decision seam

- File: `src/data/jev.ts`. Mirrors the realtime seam for the **decision model**: `JevDecider` interface, `MockDecider` (recorded typed decisions), `createDecider()`.
- `summarize(snapshot)` converts state to **labels, never raw numbers** (Jev's hard rule).
- Split of roles: **Nemotron thinks** (writes/explains), **Jev decides** (needs-a-human? safe-to-cutover? which widget?).

## 6 · Scenario mock data

- File: `src/data/scenarios.ts`. Two self-contained scenarios (Transaction Poster, Interest Calculator): the component, its mismatches (with triage + evidence widget), a **scripted decision sequence** (each Slack answer → match-rate jump + generated test), and seed Nemotron reasoning.

## 7 · App shell

- File: `src/App.tsx` — left sidebar nav (Overview / Architecture / Decisions), the model badges footer, and the page header.
- File: `src/components/shell/DemoBar.tsx` — the demo controls: scenario switch, **Simulate Slack answer** (the hero moment), Live/Pause, **Replay recorded run** (hands-free safety net), Reset.

## 8 · Screen — Overview (the hero)

- Folder: `src/components/dashboard/**`.
- Animated match-rate that counts up and flashes on a jump (`MatchRateHero` + `AnimatedNumber`), live match-% chart with the 99% threshold line (`MatchChart`), mismatch breakdown by category + triage (`MismatchBreakdown`), and the cutover 1/10/100 control locked until 99% (`CutoverControl`).

## 9 · Screen — Decisions

- Folder: `src/components/inspect/**`.
- Mismatch list grouped by triage bucket, a detail pane (input / old vs new diff, COBOL-vs-Java snippets, a **Jev-chosen evidence widget**, and the Slack-style [Old][New][Neither] card), the **decision log** (Proposed → Accepted, "resolves N mismatches"), and the **Nemotron reasoning / Jev decisions** tabbed panel.

## 10 · Screen — Architecture (the dependency graph)

- Folder: `src/components/graph/` (`GraphScreen.tsx`).
- **groma.md-style C4 blueprint**: dark, monospace, nested **System → Container → Component** boxes drawn as thin lines, with **orthogonal wires** between components (dashed = writes). Data = CardDemo (13 programs / 10 files / 6 segments) "scanned with groma.md".
- Views: **2D** (flat C4), **Iso** (CSS-isometric tilt), **Layers** (stacked bands).
- **Multi-select**: click multiple components and every wire touching any of them lights up (so two or more can be connected at once); the rest dims. Click canvas to clear. Pan + zoom + Fit.

## 11 · Demo safety net

- Everything runs offline from the mock. `Replay recorded run` auto-fires the scripted answers hands-free, and two scenario presets prove it isn't hardcoded to one component.

## 12 · Config & running

- `.claude/settings.local.json` grants edit/build permissions (for agent-assisted work).
- Run: `npm install` then `npm run dev` → http://localhost:5173. Build check: `npm run build`.

---

## The one-paragraph version

Scaffold Vite/React/TS/Tailwind → define theme tokens and shared primitives → write the data contracts → build the **store + swappable source** (mock now, real backend later) and the **Jev decision seam** → load scripted scenario data → assemble the sidebar shell + demo controls → build the three screens (Overview hero, Decisions log, Architecture C4 graph) → everything reads the store, so a single scripted "Slack answer" ripples through every screen with no backend.
