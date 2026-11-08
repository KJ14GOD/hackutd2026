---
name: shadow-diff-ui
description: Design system for the Shadow Diff dashboard (macOS-style, calm, one accent). Use for any new screen, component, or visual change in this repo.
---

# Shadow Diff UI

Calm, Apple-like control panel for a legacy-rewrite agent. Content first, chrome quiet. Judges should read the state of the system in 3 seconds.

## Principles
1. **Hierarchy** — one hero number per screen (match rate, blast radius, cut cost). Everything else is supporting.
2. **Deference** — the UI never competes with data. No borders on cards, no gradients, no glow, no emoji.
3. **Color means something** — accent = selection and primary actions. Green = safe, orange = needs attention/retest, red = coupled/danger. Never decorative.
4. **Nothing jumps** — selection uses `box-shadow` rings, never border-width changes. State changes fade (200–300 ms ease). Layout never shifts on hover or click.

## Tokens (Tailwind v4 `@theme`)
```css
@theme {
  --color-page: #F5F5F7;   --color-side: #ECECEE;  --color-card: #FFFFFF;
  --color-panel: #F5F5F7;  --color-canvas: #FAFAFB;
  --color-ink: #1D1D1F;    --color-sub: #6E6E73;   --color-faint: #86868B;
  --color-hair: rgb(0 0 0 / 0.06);
  --color-accent: #0071E3; /* alt: #5856D6 indigo, #0A7E8C teal, #636366 graphite */
  --color-safe: #248A3D;   --color-warn: #A35A00;  --color-warn-bg: #FFF3E3;
  --color-danger: #D70015; --color-wire: #D3D3D9;
  --radius-card: 22px; --radius-node: 14px; --radius-pill: 999px;
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
```
Dark mode (`.dark`): page `#111113`, side/card `#1C1C1E`, panel/node `#2C2C2E`, ink `#F5F5F7`, sub `#A1A1A6`, wire `#48484A`, safe `#30D158`, warn `#FFB547`, danger `#FF6961`, hairline `rgb(255 255 255 / 0.08)`.

Segment colors (dots and 9% tints, 16% in dark): transactions `#5E9BEB`, accounts `#5CB46E`, statements `#B47CC7`, customers `#E0A050`, security `#9A9AA2`, shared `#CDB24A`.

## Type
- Page title 28/600, tracking -0.02em. Section 19/600. Body 14–15/400. Meta 12–13 in `sub`.
- Hero numbers 72–104/600, tracking -0.04em, `tabular-nums`.
- Mono only for program IDs (CBTRN02C), file IDs, and agent tool calls.
- Sentence case everywhere. No ALL CAPS labels.

## Layout
- 8pt spacing grid (8/16/24/32/40). Page padding 32–40.
- Left sidebar nav (macOS), never top tabs. Sidebar 220–260 px, gray `side`.
- Cards: white, radius 22, padding 24–28, no border. Separate rows with 1px `hair` lines.

## Components
- **Segmented control** — track `#E3E3E7`, active pill white + `0 1px 2px rgb(0 0 0/.08)`.
- **Primary button** — accent pill, 32–40 px tall, white text. One per view.
- **Secondary button** — `rgb(0 0 0/.05)` pill.
- **Status chip** — tinted bg + darker same-hue text (e.g. warn-bg + warn).
- **Stat tile** — label 13 sub, value 30/600, footnote 12 sub.
- **Disposition + kind** — always two separate chips: disposition (Unmade decision / Defect / Noise) and kind (Rounding / Logic / Formatting).
- **Model attribution** — small meta line, e.g. `Jev · needs a person · 0.91 · 140ms`. Nemotron activity shows tool calls in mono, never prose.

## Motion (Framer Motion)
- Fades/color: 250 ms ease. Count-up on the hero number: 600 ms ease-out.
- No motion on drag (direct manipulation must track the pointer 1:1).
- Respect `prefers-reduced-motion`.

## Accessibility
- Real `<button>`/`<a>`; `aria-pressed` on toggles; `aria-label` on icon-only buttons.
- Text contrast ≥ 4.5:1 (11–12 px grays included). Don't encode meaning by hue alone — pair color with a word ("Retest", "isolated").

## Don't
- Borders on cards, drop shadows on everything, gradient washes, left-border accent cards.
- More than one accent. Red/green as the only signal.
- Placeholder copy like "@owner" or lorem ipsum — use real routed names and real questions.
