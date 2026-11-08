---
name: dependency-graph
description: How to build and change the Architecture (dependency graph) screen with React Flow — data shape, layout, lenses, blast radius, drag/pan/zoom. Use for any graph work in this repo.
---

# Dependency graph

The graph answers four FDE questions: what is this system, what breaks if I touch X, where can we cut, who do I ask. Every feature must serve one of them.

## Data contract (from backend or mock)
```ts
type GraphNode = {
  id: string; label: string;
  kind: "job" | "program" | "file";
  segment: string;              // cluster id from community detection
  isolation?: number;           // 0..1, programs only
  owner: string; migration: "legacy" | "shadowing" | "cutover" | "retired";
  openQuestions: number;
};
type GraphEdge = { from: string; to: string; kind: "call" | "reads" | "writes" | "cochange" | "runs" };
type Segment = { id: string; title: string; color: string; owner: string };
```
- Edges come from static analysis + groma.md scan + file I/O parsing + git co-change. Never from an LLM (AI recovers dependencies at <18% accuracy).
- Edge id = `${from}->${to}:${kind}` (deterministic).

## Derived values (compute in code, memoized)
- **Blast radius(X)** = BFS over: callers of X (reverse `call`), and readers of any file X `writes`. Return programs and files separately.
- **Cut cost(segment)** = edges with exactly one endpoint in the segment (files count as outside).
- **Isolation** = provided by backend; color ≥0.8 safe, ≥0.6 warn, else danger, and always print the word.

## Layout
- Shared data files run as a horizontal **spine** in the middle; segments above and below. Program → file wires go straight up/down.
- Segment groups are React Flow **group/parent nodes** whose bounds are recomputed from children (padding 22, 52 on top for the title) so dragging a child stretches its segment.
- Initial positions: precomputed (dagre/ELK offline, or hand-tuned). Never run auto-layout on every data change.
- Preserve the user's manual moves; only "Reset layout" restores defaults. Persist positions per component in localStorage (try/catch).

## Edges
- Custom bezier edge: exits the side facing the target (vertical when mostly above/below, horizontal otherwise), control offset = max(30, 0.5·distance).
- Solid = call/read, dashed = write, dotted = co-change. Base stroke 1.25 px `wire`; highlighted stroke 2 px.
- Render highlighted edges last (on top). Dim the rest to ~45% opacity — never hide them.

## Lenses (segmented control, one at a time)
| Lens | Node tag | Highlight |
|---|---|---|
| Coupling | `0.87 · isolated` in iso color | none |
| Blast radius | "Changing this" / "Retest" | selected + dependents, orange wires, others 32% |
| Owners | `@priya · Finance` in segment ink | none |
| Migration | Legacy / Shadowing / Cut over | shadowing node tinted accent, dashed draft node for the rewrite |
A **Segments** zoom level collapses each segment into a tile showing cut cost, with bundled edges labeled by count.

## Interaction
- Drag node = move (cursor grab/grabbing, lift shadow while dragging). Click without moving (<4 px) = select.
- Drag empty canvas = pan. Zoom buttons −/+ (0.5–1.8), Fit, Reset layout, bottom-right floating control.
- Click segment region or sidebar chip = focus segment (others 40%).
- "Play flow" animates a named flow step by step (1.3 s/step) in accent color.
- Selection always drives the right-hand detail panel: kind, title, hero metric (blast radius or cut cost), owner, migration, writes, one-line insight.

## React Flow rules
- Define `nodeTypes`/`edgeTypes` outside render. Controlled `nodes`/`edges` (selection and lens are domain state).
- Don't subscribe each custom node to the whole nodes array; pass derived props.
- Buttons inside nodes get `nodrag nopan`.
- Container needs explicit height (640 px). Don't auto-`fitView` after the user has panned/zoomed.
- Keep drag/pan transient state out of Zustand; commit positions on drag stop.
- Accessibility: `ariaLabelConfig`, `aria-label` on nodes (`CBTRN02C, program`), visible focus ring, keyboard: Tab between nodes, Enter selects, Esc clears.

## Demo beat to protect
Select CBTRN02C under Blast radius → interest (CBACT04C), statements (CBSTM03A) and three other programs light up through ACCTDATA/TRANSACT although nothing calls CBTRN02C. Any change must keep this readable in one glance.
