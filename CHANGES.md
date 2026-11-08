# Shadow Diff — recent changes (frontend)

Compressed summary of where the UI is right now, to pass along.

## What it is
A single-screen **mission-control dashboard** for watching a legacy COBOL codebase get
modernized one component at a time. Dark, cinematic, game-HUD layout: one focal visual in
the center, context on the wings. Runs **fully offline** on scripted mock data — no backend
needed for the demo.

## The centerpiece: isometric migration map (semantic zoom)
- The whole codebase as an **isometric 2.5D map**. Two levels of detail:
  - **Overview** — 6 **segment clusters** (Transaction posting, Accounts, Statements, Shared
    utilities, Customers, Security), each colored by migration status (Legacy → Shadowing →
    Cutting over → On Java) with a **% progress**. Only the **weak cross-cluster dependencies**
    are drawn between them — clean, never spaghetti.
  - **Click a segment → zoom in** to a detailed view of the **files inside** and their **dense
    internal dependencies**. Back button / click-empty to zoom out. Smooth scale-fade both ways.
- **Scales to a large codebase**: only one level renders at a time, so N files stay ~N clusters
  at the top. Adding files doesn't make it messier.
- **Clean architectural edges** (right-angle elbows along the iso axes).
- **Multi-select** files → all their connecting edges highlight green, the rest dims.
- Pan (drag), zoom (scroll), hover, click-to-select.

## The HUD (sides fade into the center)
- **Left rail — Agent updates**: live Nemotron reasoning stream. Click to expand the full feed.
- **Right rail — Messages to people**: the outbound Slack questions (waiting / answered). Click
  to expand the full thread with evidence.
- Rails **fade cleanly inward** (gradient mask), no hard borders — map is full-bleed behind them.

## Controls
- Top bar: overall **"Codebase migrated %"**, scenario switch, **Simulate answer**, **Replay**
  (hands-free auto-answer), **Reset**.
- **Lenses** reshape the same map: **Status / Segments / Dependencies / Metrics**.
- Clicking **Simulate answer** ripples live: the focused component (CBTRN02C) climbs, the
  progress bar moves, the agent rail streams, a message flips to "answered."

## Architecture (so the real backend drops in cleanly)
- **Vite + React + TypeScript + Tailwind v4**, Zustand store, Framer Motion.
- **One realtime seam**: the UI reads a Zustand store fed by a swappable `RealtimeSource`
  (`MockSource` today → `SpacetimeSource`/WebSocket later — **one line** in `factory.ts`).
- **Two models, clear split**: **Nemotron thinks** (rewrites/explains), **Jev decides** (typed
  judgments). Both mocked with recorded data now, behind the same swap pattern.
- Theme: dark, **Space Grotesk** + **JetBrains Mono**, single **NVIDIA-green** accent.

## Design journey (for context)
Went through tabbed dashboard → light "Apple" style → groma.md-style blueprint graph →
dedalus/hone-style stepped flow → **landed here**: the mission-control with semantic-zoom map.
Earlier directions are in git history if we want to revisit.

## Known next tunes
Cluster spacing/zoom depth, edge-routing polish, the whole-codebase data (currently ~33 mock
files across 6 clusters; real `groma.md` scan data drops into `src/data/system.ts`).
