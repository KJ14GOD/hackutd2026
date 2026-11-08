---
name: dependency-graph
description: How to build and change the codebase map (the dependency graph in web/src/components/map) — data snapshot, chip floorplan layout, isometric SVG renderer, camera and semantic zoom, lenses, blast radius, flows. Use for any graph or map work in this repo.
---

# Dependency graph (the codebase map)

The map answers four FDE questions: what is this system, what breaks if I touch X, where can we cut, who do I ask. Every feature must serve one of them.

It is **hand-drawn SVG**, not React Flow. Files: `web/src/components/map/` (`layout.ts`, `MapCanvas.tsx`, `highlight.ts`, `iso.ts`, `theme.ts`, `useTween.ts`) and `web/src/data/carddemo.ts`.

## Data (real CardDemo, offline)
- `web/scripts/snapshot-graph.mjs <segmentation.json>` → `web/src/data/carddemo.graph.json`: `programs {id, mode, lang, loc, pocket}`, `pockets {id, domain, kind, isolation, loc, programs}`, `domains`, `stores {id, kind, datasets}`, `io {program, store, mode}`, `calls {from, to, kind}`, `entries {id, kind, program, desc}`. Never hand-edit; re-run the script.
- `carddemo.ts` adds curation (`POCKET_INFO` titles, short names, row and order; program/store titles; teams; seed migration states; `FLOWS`) and pure queries. Selection is a `Ref { kind: 'program' | 'store' | 'entry' | 'pocket', id }`.
- Edges come from static analysis + file I/O parsing + git co-change (the segmenter). Never from an LLM (AI recovers dependencies at <18% accuracy).

## Derived values (compute in code)
- **Blast radius(X)** (`blastRadius`) = readers of every store X writes (one hop) + transitive callers of X. Returns `hits[{program, via[{store?, caller?}]}]`, stores and pockets, so the UI can say *why* each program is hit.
- **Cut cost(pocket)** (`cutCost`) = links with exactly one end in the pocket.
- **Isolation** comes from the segmenter. Colour ≥0.6 good, ≥0.3 warn, else bad, and always pair it with a word (Easy to move / Some ties / Tangled).

## Layout (`layout.ts`, computed once as `LAYOUT`)
- Chip floorplan in world units: the 6 shared stores (`BUS_ORDER`) are horizontal **bus lanes** with a register at the left end; pockets sit in two rows facing the bus; programs inside a pocket are staggered so wires pass through the gaps; local (single-pocket) stores are tiles on the pocket's outer edge reached through channel sub-lanes; cross-pocket calls route through a control channel.
- Every wire is orthogonal with via dots at junctions. Pocket-level taps show in the overview; program-level taps replace them when a pocket is open.
- Never run auto-layout on data change; change `POCKET_INFO` order/rows or the `G` constants instead.

## Renderer (`MapCanvas.tsx`)
- Isometric projection `proj(x, y, z)`; strokes use `vector-effect: non-scaling-stroke`.
- Names you navigate by (pockets, plates, program ids) are `Billboard`s: screen-facing, constant size (`scale(1/var(--k))`), shown only when they fit (`fitName`, program ids once the cube is wide enough). Only faint background labels are engraved on the floor.
- The camera is a ref; `setCamera` writes the transform, `--k`, zoom % and mini-map directly. Never put per-frame camera values in React state; use the coarse `kR` for size-dependent decisions.
- Isolation words and colors come only from `ISO_LEVELS` in `theme.ts`.
- **Camera:** tweened `flyTo` (log-space zoom), wheel zoom about the cursor, drag to pan vs click to pick (<4 px = click), hit testing via `data-hit="kind:id"`. Fit targets: whole die, a focused pocket (`focusBox`), or a flow step (pocket + the bus lane it touches, via the `frame` prop). Don't refit after the user has panned unless focus/view changes.
- **Semantic zoom:** per-pocket "open" tween: block → slab, programs rise, local tiles and title plate appear.
- **Links stay at one level of detail:** while a pocket is focused and a strong highlight is active (selection, blast, flow), every pocket holding a lit program opens too (`expandKey`), so cross-pocket calls and taps land on the exact program; unrelated pockets stay closed. The camera frames the focused pocket plus those pockets, and flies back when the selection clears. Hover (soft) never opens pockets.
- **Layers view:** data plane, program plane (`LZ`) and entry plane (`LZ + LZE`) joined by vertical vias.

## Highlight (`highlight.ts`)
- One `Highlight` model: `tone` (accent | warn), `strength` (strong | soft), role maps for programs/stores (`source` | `hit` | `on`), lit link ids (`io:prog:store`, `call:from:to`, `entry:ID`), pockets, calls.
- Precedence in `MissionControl`: flow step → blast lens → selection → hover (soft).
- Lit wires animate (`trace-flow`). Dim the rest (strong 0.3, soft 0.45) — **never hide** them.

## Lenses (segmented control, keys 1–4)
| Lens | Colours | Inspector hero |
|---|---|---|
| Migration | legacy / shadowing (cyan) / cutting over (amber) / on Java (green) | % codebase on Java, counts |
| Coupling | pocket by isolation | most tangled pockets, most-shared stores |
| Blast radius | source cyan, hits amber, lanes lit | "Changing X means retesting N programs in M pockets", grouped by via |
| Owners | pocket by team | teams, open questions |

## Interaction
- Click pocket = fly in (focus). Click program/store/entry = select (drives the Inspector). `Esc` steps back out. `F` fit, `L` Iso/Layers, `/` or `Ctrl K` search, arrows step a flow.
- Systems sidebar rows and search results pick the same `Ref`s; hovering them lights the map.
- Respect `prefers-reduced-motion` (tweens jump to the end).

## Demo beat to protect
Blast radius lens, select CBTRN02C → 15 programs in 10 pockets light up through ACCTDATA (10), TRANSACT (6) and TCATBALF (local) although nothing calls CBTRN02C. Any change must keep this readable in one glance.
