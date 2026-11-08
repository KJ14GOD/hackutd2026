# Worker Contract — read before building a screen

You are building ONE screen of the Shadow-Diff dashboard. The foundation (data layer, store, theme, app shell) is **done and frozen**. Build only inside your assigned folder. Read `CLAUDE.md` for product context and the research-driven principles.

## Hard rules

- **Only create/edit files inside your assigned folder** (e.g. `src/components/dashboard/**`). Replace the placeholder `*Screen.tsx` there.
- **Do NOT edit** `App.tsx`, `src/main.tsx`, `src/index.css`, `src/types.ts`, `src/store/**`, `src/data/**`, or another worker's folder. These are read-only to you.
- **Do NOT run** `npm run dev` / `npm install` / `vite build` — the dev server is already running on :5173 and the coordinator owns it. You may run `npx tsc -b` to typecheck.
- Your screen's default export path must stay the same so `App.tsx` keeps importing it.
- Match the existing dark theme. Use CSS vars (`var(--color-*)`) and the shared primitives.

## Reading data (the ONLY way to get state)

```ts
import {
  useStore, selectComponent, selectMatchRate, selectThreshold, selectHistory,
  selectMismatches, selectDecisions, selectAgentLog, selectUIDecisions,
  selectCutover, selectGraph, selectControls,
} from '@/store/useStore'

const rate = useStore(selectMatchRate)          // number 0..1, updates live
const mismatches = useStore(selectMismatches)    // Mismatch[]
const controls = useStore(selectControls)        // demo controls (see below)
```

Selectors are granular — subscribe to the narrowest slice so you only re-render on relevant changes. For a custom slice: `useStore(s => s.component.status)`.

## Controls (only the DemoBar calls these, but you may need the cutover ones)

```ts
controls.simulateSlackAnswer('old')   // hero moment — match rate jumps
controls.setCutover(1 | 10 | 100)     // guarded: no-op below threshold
controls.scenarios()                  // {id,name}[]
```

## Types (`@/types`) — the shapes you render

- `Component { id, name, isolation, coverage, status, matchRate, whyPicked, language }`
- `Mismatch { id, category, classification, rootCauseGroup, title, input, oldOut, newOut, snippet{old,new}, status, evidenceWidget, categoryConfidence }`
  - `category`: 'formatting' | 'rounding' | 'logic' | 'noise'
  - `classification`: 'defect' (auto-fixed) | 'unmade-decision' (asked) | 'noise' (filtered)
  - `status`: 'open' | 'asked' | 'answered' | 'test_generated'
  - `evidenceWidget`: 'numberLine' | 'charDiff' | 'branchTrace' | 'tableDiff' (Jev-chosen)
- `Decision { question, answer, answeredBy, at, testId, resolvedCount, groupId }`
- `AgentThought { phase, text, model }` — model is 'Nemotron'
- `UIDecision { question, type, choice, probabilities, confidence?, latencyMs, model:'Jev', drives }`
- `Snapshot.history`: `{ t, rate, label }[]` for the live chart. `threshold` ~0.99. `cutoverStage`: 0|1|10|100. `noiseBaseline` ~0.998.

## Shared primitives (`@/components/ui/primitives`)

`<Panel title right>`, `<Chip color>`, `<ModelBadge model="Nemotron"|"Jev">`, `<JevChip confidence latencyMs>`. Use `cn()` from `@/lib/cn` for class merging.

## Libraries available

`motion` (Framer Motion — `import { motion } from 'motion/react'`), `recharts`, `@xyflow/react` (React Flow), `lucide-react` icons.

## Definition of done

- `npx tsc -b` passes.
- Your screen renders live from the store and reacts to `simulateSlackAnswer` (match rate / mismatches / decisions / log update within ~1s).
- Dark-theme consistent, no console errors, no layout jitter.
