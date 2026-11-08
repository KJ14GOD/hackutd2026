# Shadow Diff — recent changes (frontend)

Compressed summary of where the UI is right now, to pass along. Latest first.

## Now (uncommitted): requirements layer (D-028)
- **Rail + four workspaces:** Requirements, Questions, Inbox, People, plus **Viewing as**
  and a Business / Engineer toggle remembered per viewer.
- **Requirements:** review list, detail, History (word diff, restore), Checks, conflicts
  side by side, change request with impact preview and **Show on map**.
- **Questions:** evidence, context hits, answers that write a new version, reassign,
  snooze, escalation timeline on the sim clock.
- **Inbox**, **People and ownership** (signal, source, confidence, corrections, mark as
  left), **Approver list** with admin sign-off.
- **Map:** Requirements lens (`5`), restricted pockets, impact highlight with a banner;
  pocket Inspector gets Requirements and progress (gate, blockers, harness attempts,
  cutover 1/10/100). The mock now holds cutover while the gate is closed (Replay stops).
- Data behind `RealtimeSource.req` (`requirements.ts`, `reqEvents.ts`, `reqSeed.ts`,
  `reqMock.ts`), so a SpacetimeDB source can replace it.

## Earlier (uncommitted): professional pass
- **Nothing truncates:** header, sidebar, breadcrumb and readouts wrap or shorten on
  purpose (search goes compact below 1440 px).
- **One vocabulary:** "pocket" everywhere, and one isolation scale (`ISO_LEVELS`: Easy to
  move >= 0.6, Some ties >= 0.3, Tangled) used by the map, sidebar, Inspector and legend.
- **Billboard labels:** pocket names, plates and program ids face the viewer at a fixed
  size and only show when they fit, so a zoomed-out blast radius stays readable.
- **Data stores** show id and title together (ACCTDATA · Account master).
- **Layout:** map-only toggle (`M`); below 1440 px the sidebar starts hidden and the
  Inspector overlays the map with the camera inset to match.
- **Mini-map + zoom controls** bottom right; the mini-map appears once you zoom in.
- **Inspector relationships grouped** by kind with CALL / XCTL / LINK tags and
  shared / this-pocket tags on data.
- **Start here** note (three steps, dismissible, remembered).
- **Camera without re-render:** the transform is written straight to the SVG; React only
  re-renders when the zoom changes enough to refit labels.
- **Error boundary** with Reset view. Stale hover after a camera flight fixed.
- **Cleanup:** deleted the earlier screens, `@xyflow/react`, `recharts`, `motion` and
  `class-variance-authority`; package renamed `shadow-diff-web`; oxlint clean.

## PR #9 (`529aaed`): dark-pro polish
- **Palette:** near-black across the app, pure `#000` map background, brighter blocks and
  team colors so the map reads at a glance.
- **Sidebar → "Systems":** business domains as an accordion (collapsed by default, one
  open at a time, remembered), a % on Java bar per domain, one-line domain descriptions,
  isolation in words (Easy to move / Some ties / Tangled) instead of decimals, full names on
  hover (no truncation), a filter box, hover-only chevrons.
- **View source:** program details link to the real AWS CardDemo file on GitHub.
- **Clickable question pin:** the pin on a pocket opens that person's message in the
  People tab.
- Hover-float labels on map nodes; tidier top bar.

## PR #8 (`aad0951`): chip-schematic map, Groma-style panels
- **The map is real data.** 46 programs, 15 pockets, 25 data stores, 86 read/write links,
  64 calls and 40 entry points from the segmenter, snapshotted into
  `src/data/carddemo.graph.json` so the demo stays offline.
- **Chip floorplan:** the 6 shared data files are copper bus lanes with registers at the
  left; pockets sit in two rows and tap into the lanes they read/write (orthogonal wires,
  via dots). Local files are tiles on the pocket's outer edge. Cross-pocket calls are drawn
  only when lit, so the overview never turns into spaghetti.
- **Semantic zoom:** click a pocket and the camera flies in; the pocket flattens to a slab
  and its programs rise, with their own taps, local files and job/screen entry markers.
- **Views:** Iso and Layers (data / programs / entry points as three stacked planes joined
  by vias).
- **Lenses** recolour the same map and explain themselves in the Inspector: Migration
  (% on Java, shadowing in cyan), Coupling (isolation, most-shared stores), Blast radius
  (pick CBTRN02C → 15 programs in 10 pockets to retest via ACCTDATA / TRANSACT), Owners
  (teams, open questions).
- **Flows:** Nightly batch cycle (12 steps), Online bill pay, Card update. Arrow keys step;
  the camera keeps the step's program and data lane in shot.
- **Panels:** left hierarchy, right Inspector with Inspect / Agent / People tabs (log rows,
  not chat bubbles); nothing floats over the canvas except small readouts and zoom controls.
- Search (`Ctrl K`), keyboard (`1`–`4`, `L`, `F`, `Esc`, arrows), reduced-motion support.
- Moved the app into `web/` (D-027) so the root pnpm workspace works again.

## Architecture (unchanged, so the real backend drops in cleanly)
- **Vite + React + TypeScript + Tailwind v4**, Zustand store.
- **One realtime seam**: the UI reads a Zustand store fed by a swappable `RealtimeSource`
  (`MockSource` today → `SpacetimeSource`/WebSocket later — **one line** in `factory.ts`).
- **Two models, clear split**: **Nemotron thinks** (rewrites/explains), **Jev decides**
  (typed judgments). Both mocked with recorded data now, behind the same swap pattern.

## Design journey (for context)
Tabbed dashboard → light "Apple" style → groma.md-style blueprint graph → stepped flow →
isometric mission control with rails (PR #7) → chip-schematic floorplan with lenses (PR #8)
→ dark-pro polish (PR #9) → professional pass. Earlier directions are in git history.

## Known next steps
- Bring the mismatch detail (Jev evidence widget), decision log, cutover control and Jev
  decisions tab into the Inspector.
- Swap `MockSource` for the SpacetimeDB source once the backend tables exist.
