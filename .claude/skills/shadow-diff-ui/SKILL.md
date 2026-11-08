---
name: shadow-diff-ui
description: Design system for the Shadow Diff mission-control UI in web/ (dark, near-black, one cyan accent, Groma-style panels). Use for any new screen, component, or visual change in this repo.
---

# Shadow Diff UI

Dark, sleek mission control for a legacy-rewrite agent. Content first, chrome quiet. Judges should read the state of the system in 3 seconds. Inspiration: groma.md (calm panels, a map you can explore), chip schematics (architectural wires).

## Principles
1. **Hierarchy** — one hero per view: the map in the centre, one hero number per Inspector view (% on Java, blast radius, match rate). Everything else supports it.
2. **Deference** — the UI never competes with data. Hairline borders only, no gradient washes, no glow, no emoji, no chat bubbles (log rows instead).
3. **Color means something** — cyan accent = selection, the live component and primary actions. Green = on Java / safe, amber = cutting over / retest, red = tangled / danger, copper = data wires. Never decorative.
4. **Nothing jumps** — selection uses `box-shadow` rings, never border-width changes. State changes fade (200–300 ms). Layout never shifts on hover or click.
5. **Nothing covers text** — no side fades or overlays on the canvas except small readouts, the legend and zoom controls.

## Tokens (Tailwind v4 `@theme` in `web/src/index.css`)
```css
@theme {
  --color-bg: #000000;      --color-bg-2: #0b0b0e;
  --color-panel: #121216;   --color-panel-2: #18181d;  --color-raise: #202026;
  --color-line: #222228;    --color-line-2: #33333c;
  --color-ink: #edeef1;     --color-muted: #a9afba;    --color-faint: #73737e;
  --color-accent: #45c7f5;  --color-accent-dim: rgba(69, 199, 245, 0.16);
  --color-copper: #cb9d5f;
  --color-good: #37ca95;    --color-warn: #efb24a;     --color-bad: #ee6d69;
  --color-agent: #b4a8f8;   --color-nvidia: #76b900;
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```
Older names (`--color-fg`, `--color-card`, `--color-hair`, …) are aliases kept for the earlier screens; don't use them in new code.

Map hex palette lives in `web/src/components/map/theme.ts` (`C`, `MIG_COLOR`, `TEAM_COLOR`) — keep it in step with the tokens. Team colors: finance `#7FA8FF`, customer `#D2A2F2`, platform `#5FCCBB`, operations `#EBAC76`. Migration: legacy `#4C4C57`, shadowing `#45C7F5`, cutting over `#EFB24A`, on Java `#37CA95`.

## Type
- Inspector title 20–22/600. Section heads are small `eyebrow` labels. Body 12.5–14. Meta 10.5–12 in `faint`.
- Hero numbers 28–40/600, `tabular-nums`.
- Mono only for program IDs (CBTRN02C), file IDs (ACCTDATA), owners (@priya), and agent tool calls.
- Sentence case for copy; eyebrows may be uppercase small caps.

## Layout
- Three columns: **Systems** sidebar (left, ~264 px, collapsible), map (centre, full-bleed `#000`), **Inspector** (right, ~368 px). Top bar h-12, map toolbar h-11.
- Sidebar rows are 24–28 px tall with 6 px radius; hover = `panel`, selected = `panel-2` + accent ring.
- Panels separate sections with 1 px `line` rules, not cards inside cards.

## Components (`web/src/components/shell/kit.tsx`)
- **Segmented** — views and lenses; active segment `panel-2` with ink text.
- **Btn primary** — accent fill, dark text. One per view (top bar: Simulate answer).
- **Btn ghost / outline**, **IconBtn** (always `aria-label`), **Chip** (tinted bg + same-hue text), **Dot**, **Stat**, **Kbd**.
- **Questions (People tab)** — COBOL value vs Java value side by side, then Keep COBOL / Use rewrite; meta line `@owner · team · via CODEOWNERS`.
- **Disposition + kind** — always two separate chips: disposition (Unmade decision / Defect / Noise) and kind (Rounding / Logic / Formatting).
- **Model attribution** — small meta line, e.g. `Jev · needs a person · 0.91 · 140ms`. Nemotron activity shows tool calls in mono, never prose.

## Motion
- Fades/color: 200–300 ms ease. Camera flights 500–750 ms ease-in-out, zoom in log space. Lit wires use the `trace-flow` dash animation.
- No motion on drag (direct manipulation tracks the pointer 1:1).
- Respect `prefers-reduced-motion`.

## Accessibility
- Real `<button>`/`<a>`; `aria-pressed` on toggles; `aria-label` on icon-only buttons; visible `:focus-visible` ring.
- Text contrast ≥ 4.5:1 (10–12 px grays included). Don't encode meaning by hue alone — pair color with a word ("Retest", "Tangled", "On Java").

## Don't
- Light theme tokens, gradient washes, glows, chat bubbles, edge fades over content.
- More than one accent. Red/green as the only signal.
- Placeholder copy like "@owner" or lorem ipsum — use real routed names and real questions.
