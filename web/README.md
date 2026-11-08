# Shadow Diff: mission-control UI

The frontend for Theseus. A single screen that shows the AWS CardDemo COBOL codebase as a
chip-style floorplan, lets you inspect any program, data file or job, and follows the
agent while it shadows a rewrite and asks people on Slack. It runs **fully offline** on
mock data; no backend is needed for the demo.

## Run it

```sh
cd web
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck (tsc -b) + production build
npx tsc -b           # typecheck only
```

This is its own npm project, outside the root pnpm workspace (see D-027 in
`../docs/DECISIONS.md`).

### Real Slack (optional, dev server only)

With `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` and `SLACK_DEMO_USER` in the repo-root `.env`,
`npm run dev` posts a Block Kit card to that Slack user whenever a question is asked,
reassigned or escalated by hand (`docs/HUMAN_LOOP.md`, "Wording"): the question in the
recipient's wording, the evidence, up to five cited COBOL lines, why they were asked, and
one button per answer. Escalations fired by the sim clock stay in the app. A button click
comes back over Socket Mode to the dev server and on to every open tab over SSE
(`/api/slack/events`), and the question closes as answered by that person. The dev server
also answers clicks on the harness worker's digests (same Slack app, so Slack can hand a
click to either connection) by calling `answer_question` on SpacetimeDB. Without the
tokens nothing is sent and the app runs offline as before. Code: `server/slack.ts`,
`src/data/{slackCard,slackOut}.ts`.

## What's on screen

- **Top bar:** codebase-on-Java progress, the component being shadowed and its live match
  rate, search (`Ctrl K` or `/`), scenario switch, Replay, Reset, and **Simulate answer**.
- **Left, Systems:** business domains as an accordion (one open at a time), each with a
  % on Java bar and its pockets, whose isolation is shown in words (Easy to move >= 0.6 /
  Some ties >= 0.3 / Tangled, one scale everywhere). A filter box at the top, and the shared
  data stores underneath (id and name together, as on the map).
- **Centre, the map:** shared data files are copper bus lanes; pockets (groups of
  programs) sit either side and tap into the lanes they read or write. Click a pocket to
  fly in: the programs rise out of it, with their local files and job/screen entry points.
  Selecting a program there also opens every pocket it links to, so each wire ends on the
  exact program at the other end (unrelated pockets stay collapsed), and the camera frames them all.
  - **Views:** Iso, or Layers (data / programs / entry points as three stacked planes).
  - **Lenses:** Migration, Coupling, Blast radius, Owners, Requirements (gate open /
    blocked / none / restricted). Each recolours the same map.
  - **Flows:** Nightly batch cycle, Online bill pay, Card update; step through with arrows.
  - The pin on a pocket with open questions opens that person's message in the People tab.
  - Names face the viewer at a constant size (billboards) and only show when they fit;
    zoomed out you get short names, zoomed in the full title and a detail line.
  - Bottom right: zoom − / % / + / Fit, and a **mini-map** once you zoom past the
    overview (click or drag it to move the camera).
- **Right, Inspector:** tabs **Inspect** (system, pocket, program, data file or flow
  details; programs link to their real CardDemo source on GitHub), **Agent** (the
  Nemotron log) and **People** (Slack questions waiting and answered). Relationships are
  grouped by kind (Started by / Reads and writes / Writes / Reads / Calls / Called by). A
  small dismissible **Start here** note explains pockets and the first three clicks.
- **Requirements workspaces** (rail on the far left; D-028, mock data):
  - **Requirements:** count chips and filters, open conflicts on top, bulk approve for
    what you may approve. Detail: statement with flagged words, slots, evidence, trace to
    code, approvals, and Approve / Reject / Edit / Needs info / Request change. Tabs
    **History** (word diff between any two versions, restore) and **Checks** (run,
    attest). A change request shows its impact and **Show on map**.
  - **Conflicts:** both sides with sources, backers and what happens if each wins; keep
    A, keep B or escalate, with a required comment.
  - **Questions:** why it was asked, what the docs already say ("Use as the answer"),
    one-click options, reassign, snooze, and an **Escalation** tab with the ladder on the
    sim clock (`+1h` / `+6h` to move it).
  - **Inbox:** what waits on the viewer, grouped by pocket, "Approve N clean".
  - **People:** teams, who owns each pocket and why (signal, source, confidence),
    corrections, mark as left (questions reroute), and the **Approver list** an admin
    signs off.
  - **Viewing as** in the top bar picks the person (no sign-in in the demo); restricted
    pockets (User administration) show a lock for anyone without access.
  - The pocket Inspector shows **Requirements and progress**: job state, the gate and
    each blocker (click through), harness attempts, and cutover 1/10/100 for the live
    pocket. The mock holds cutover while the gate is closed.
- **Layout:** the expand button in the toolbar (or `M`) shows the map only. Below 1440 px
  wide (projectors) the Systems panel starts hidden and the Inspector slides over the
  map instead of squeezing it; the camera keeps the subject clear of it.
- If a render ever throws, an error panel offers **Reset view** instead of a blank page.

Keys (map only): `1`–`5` lenses, `L` Iso/Layers, `M` map only, `F` fit, `/` or `Ctrl K` search,
`Esc` back out, `←`/`→` flow steps.

## Where things live

| Path | What |
| --- | --- |
| `src/components/mission/MissionControl.tsx` | the screen: state, keyboard, layout |
| `src/components/map/` | the map: `layout.ts` (floorplan), `MapCanvas.tsx` (SVG renderer + camera), `highlight.ts`, `iso.ts`, `theme.ts`, `useTween.ts` |
| `src/components/shell/` | `Hierarchy.tsx` (Systems sidebar), `Inspector.tsx`, `Search.tsx`, `kit.tsx` (buttons, chips, segmented control), `ErrorBoundary.tsx` |
| `src/data/carddemo.ts` | the CardDemo graph plus curation (titles, teams, flows) and queries (blast radius, cut cost) |
| `src/data/carddemo.graph.json` | snapshot of the segmenter output; regenerate with `node scripts/snapshot-graph.mjs <path to segmentation.json>` |
| `src/data/{source,mockSource,factory,scenarios,jev}.ts`, `src/store/useStore.ts` | the realtime seam: store fed by a swappable source (mock today) |
| `src/data/{requirements,reqEvents,reqSeed,reqMock}.ts` | requirements layer: pure rules, events + reducer, seed world, mock actions |
| `src/data/{slackCard,slackOut}.ts`, `server/slack.ts` | real Slack in dev: the question card, the browser bridge, and the dev-server endpoint + Socket Mode listener |
| `src/store/useUi.ts` | workspace, viewing as, Business / Engineer, cross-links |
| `src/components/{requirements,questions,approvals,people}/` | the requirements workspaces; `shell/reqKit.tsx` holds their shared pieces, `shell/Rail.tsx` the nav |
| `src/index.css` | theme tokens (Tailwind v4 `@theme`) |

The earlier screens (dashboard, flow, React Flow graph) were deleted along with their
libraries; they are in git history.

Checks: `npx tsc -b` and `npx oxlint src` (both clean).

More context: [CLAUDE.md](CLAUDE.md) (product and rules), [CHANGES.md](CHANGES.md)
(current state), [BUILD_STEPS.md](BUILD_STEPS.md) (how it is built),
[CONTRACT.md](CONTRACT.md) (rules for parallel work).
