# How this project is built — step by step

A map of how the Shadow Diff mission-control UI is constructed, in the order you'd rebuild it. Each step names the files it owns and the one idea that makes it work.

> Rule that holds the whole thing together: **the UI never talks to a backend.** It reads a store that is fed by a swappable source. Today that source is a scripted mock; tomorrow it's the real backend — one line changes.

---

## 1 · Scaffold & tooling

- **Vite + React 19 + TypeScript**, **Tailwind v4** (via `@tailwindcss/vite`), path alias `@/ → src/`, `resolveJsonModule` on for the graph snapshot.
- Files: `vite.config.ts`, `tsconfig.app.json`, `package.json`. Lives in `web/`, outside the root pnpm workspace (D-027).
- Libraries: `zustand` (state), `lucide-react` (icons), `clsx` + `tailwind-merge` (`cn`). Nothing else at runtime. Lint: `npx oxlint src`.

## 2 · Design system (theme tokens)

- `src/index.css` — Tailwind v4 `@theme` tokens: near-black surfaces (`--color-bg`, `--color-panel`, `--color-line`), ink/muted/faint text, one cyan accent, good/warn/bad, copper for data wires, Inter + JetBrains Mono.
- `src/components/map/theme.ts` — the same palette as hex for the SVG map (faces are shaded in code), plus `MIG_COLOR`, `TEAM_COLOR`, and the one isolation scale `ISO_LEVELS` (`isoColor`, `isoWord`).
- `src/components/shell/kit.tsx` — `Segmented`, `Btn`, `IconBtn`, `Chip`, `Dot`, `SectionHead`, `Stat`, `Kbd`.

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

- File: `src/data/scenarios.ts`. Two self-contained scenarios (Transaction Poster · CBTRN02C, Interest Calculator · CBACT04C): the component, its mismatches (with triage + evidence widget), a **scripted decision sequence** (each Slack answer → match-rate jump + generated test), and seed Nemotron reasoning.

## 7 · The codebase graph (real CardDemo structure)

- `scripts/snapshot-graph.mjs` reads the segmenter output (`out/segmentation.json`) and writes `src/data/carddemo.graph.json`: programs, pockets, domains, stores, read/write links, calls, entry points. Dataset names are collapsed to short ids (ACCTDATA, TRANSACT, …). Run: `node scripts/snapshot-graph.mjs <path to segmentation.json>`.
- `src/data/carddemo.ts` adds curation (pocket titles and row order, program/store titles, teams, seed migration states, flows) and pure queries: `ioOf`, `callsFrom/To`, `sharedStoresOfPocket`, `cutCost`, `migrationProgress`, `blastRadius` (readers of what X writes + transitive callers), GitHub source links.

## 8 · The floorplan (layout, computed once)

- `src/components/map/layout.ts` turns the graph into a chip floorplan in world units: shared stores become **bus lanes** (with registers at the left end), pockets sit in two rows facing the bus, programs are staggered so wires pass between them, local stores are tiles on the outer edge, cross-pocket calls run in a control channel. Every wire is orthogonal. Exported once as `LAYOUT`.
- `src/components/map/iso.ts` — the isometric projection (`proj`), box faces, floor-engraved text, shading helpers.

## 9 · The map renderer (SVG + camera)

- `src/components/map/MapCanvas.tsx` draws the die, grid, domain regions, lanes, taps, pockets, programs, local tiles and entry points as SVG.
- **Camera:** translate/scale with tweened `flyTo` (log-space zoom), wheel zoom about the cursor, drag to pan vs click to pick (4 px threshold), fit-to-box for the overview, a focused pocket, or a flow step (pocket + the data lane it touches). The camera lives in a ref: `setCamera` writes the `<g>` transform, a `--k` CSS variable, the zoom % and the mini-map directly, so panning never re-renders React. A coarse `kR` state changes only when zoom moves ~20%, to refit labels. `insetRight` keeps fits clear of an overlaid Inspector.
- **Labels:** names you navigate by are `Billboard`s (screen-facing, constant size via `scale(1/var(--k))`, dark halo) and show only when they fit (`fitName`); faint background labels stay engraved on the floor.
- **Mini-map** (bottom right, with zoom controls): appears past the overview zoom; click or drag to move the camera.
- **Semantic zoom:** each pocket has an "open" tween; opening flattens it to a slab and raises its programs, swapping pocket-level taps for program-level ones. **Layers** lifts programs and entry points onto their own planes.
- `src/components/map/highlight.ts` — one `Highlight` model (programs/stores/links/pockets with roles) built from a selection, the blast radius, or a flow step; the renderer dims everything else (never hides it).
- `src/components/map/useTween.ts` — rAF tweens that respect reduced motion.

## 10 · The shell

- `src/components/mission/MissionControl.tsx` — the one screen: lens/view/focus/selection/flow state, highlight precedence (flow → blast → selection → hover), keyboard, top bar, toolbar (breadcrumb, view + lens switches, map-only toggle), canvas overlays (readout, legend). Below 1440 px the sidebar starts hidden and the Inspector overlays the map.
- `src/components/shell/ErrorBoundary.tsx` — wraps the screen in `App.tsx`; Reset view remounts it.
- `src/components/shell/Hierarchy.tsx` — **Systems** sidebar: domain accordion, % on Java, areas with isolation in words, filter, shared data list.
- `src/components/shell/Inspector.tsx` — **Inspect / Agent / People** tabs: lens-aware system view with a dismissible Start here note, pocket/program/store/entry details with relationships grouped by kind, live shadow card, blast summary, flow stepper, Nemotron log, Slack questions.
- `src/components/shell/Search.tsx` — search programs, pockets, data and jobs.

## 11 · Demo safety net

- Everything runs offline from the mock and the graph snapshot. **Simulate answer** fires the next scripted Slack answer (match rate jumps, question moves to Answered); **Replay** auto-answers hands-free; two scenario presets prove it isn't hardcoded to one component.

## 12 · Running

- `npm install` then `npm run dev` → http://localhost:5173. Typecheck: `npx tsc -b`. Build: `npm run build`.

---

## The one-paragraph version

Scaffold Vite/React/TS/Tailwind → define dark theme tokens and a small kit → write the data contracts → build the **store + swappable source** (mock now, real backend later) and the **Jev decision seam** → load scripted scenarios → snapshot the real CardDemo graph from the segmenter → compute a chip floorplan once → render it as an isometric SVG with a flying camera, semantic zoom, layers, lenses and flows → wrap it in the Systems sidebar, Inspector and top bar. Everything reads the store, so a single scripted "Slack answer" ripples through the map, the Inspector and the top bar with no backend.
