import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import {
  BUS_ORDER,
  CALLS,
  DOMAIN,
  ENTRIES,
  POCKET,
  PROGRAM,
  STORE,
  TEAMS,
  migrationProgress,
  pocketsUsingStore,
  type MigrationMap,
  type Ref,
} from '@/data/carddemo'
import { G, LAYOUT, type PocketGeo, type TraceGeo } from './layout'
import { box, clamp, floorText, lerp, mix, path, poly, proj, rect, shade, wrap, ZS, type P3 } from './iso'
import { C, GATE_COLOR, MIG_COLOR, TEAM_COLOR, inkOn, isoColor, isoWord, type GateState } from './theme'
import { useTweenMap, easeInOut } from './useTween'
import type { Highlight } from './highlight'
import { Btn, IconBtn } from '@/components/shell/kit'

export type Lens = 'migration' | 'coupling' | 'blast' | 'owners' | 'gate'
/** the requirements gate per pocket, for the Requirements lens ('locked' = restricted and the viewer has no access) */
export type PocketGate = { state: GateState; blockers: number }
export type View = 'iso' | 'layers'

export interface MapHandle {
  fit(): void
  zoomBy(f: number): void
}

interface Props {
  lens: Lens
  view: View
  focus: string | null
  selection: Ref | null
  hover: Ref | null
  highlight: Highlight | null
  mig: MigrationMap
  /** per pocket, for the Requirements lens */
  gate?: Record<string, PocketGate>
  live: { id: string; pending: number } | null
  /** shared stores the camera must also keep in frame (flow steps) */
  frame?: string[]
  onPick(ref: Ref | null): void
  onHover(ref: Ref | null): void
  /** px of the map hidden behind an overlaid panel on the right; the camera centres in what is left */
  insetRight?: number
  /** click the pending-question pin → open that program's message */
  onOpenMessages?(): void
}

const LZ = 400 // px from the data plane up to the program plane
const LZE = 150 // px from the program plane up to the entry plane
const L = LAYOUT
const MONO = 'JetBrains Mono, ui-monospace, monospace'

type Cam = { x: number; y: number; k: number }
const camTransform = (c: Cam) => `translate(${c.x} ${c.y}) scale(${c.k})`

/* Sizes that stay put on screen whatever the zoom. The camera writes the zoom to
 * the CSS variable --k, so these never need a React render. lo/hi clamp the size
 * in world units, which stops text growing huge or vanishing at the extremes. */
const onScreen = (px: number, lo: number, hi: number) => `clamp(${lo}px, calc(${px}px / var(--k)), ${hi}px)`
const fs = (px: number, lo: number, hi: number) => ({ fontSize: onScreen(px, lo, hi) })
const UNZOOM = { transform: 'scale(calc(1 / var(--k)))' }
/** JetBrains Mono advance width, as a fraction of the font size */
const MONO_W = 0.6

function parseHit(el: EventTarget | null): Ref | null {
  const node = (el as Element | null)?.closest?.('[data-hit]')
  const v = node?.getAttribute('data-hit')
  if (!v) return null
  const i = v.indexOf(':')
  return { kind: v.slice(0, i) as Ref['kind'], id: v.slice(i + 1) }
}
const sameRef = (a: Ref | null, b: Ref | null) => a?.kind === b?.kind && a?.id === b?.id

/* screen-space bounds of a world box at the given layer spread */
function screenBounds(x0: number, x1: number, y0: number, y1: number, z1: number) {
  const pts = [
    proj(x0, y0, 0), proj(x1, y0, 0), proj(x1, y1, 0), proj(x0, y1, 0),
    proj(x0, y0, z1), proj(x1, y0, z1), proj(x1, y1, z1), proj(x0, y1, z1),
  ]
  const xs = pts.map((p) => p.X)
  const ys = pts.map((p) => p.Y)
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

function focusBox(id: string, frame: string[] = []) {
  const pg = L.pockets[id]
  // the pocket, its local stores, and the first stretch of bus its taps run into,
  // stretched to reach any bus lane the current step touches
  const outer = pg.frontY + pg.dir * (G.V + G.LOCAL_DEPTH)
  const ys = [outer, pg.frontY - pg.dir * 2.6]
  for (const s of frame) if (L.lanes[s]) ys.push(L.lanes[s].y - pg.dir * 1.8)
  return { x0: pg.x0 - 0.6, x1: pg.x1 + 0.6, y0: Math.min(...ys), y1: Math.max(...ys) }
}

export const MapCanvas = forwardRef<MapHandle, Props>(function MapCanvas(props, ref) {
  const { lens, view, focus, selection, hover, highlight: hl, mig, gate, live, frame, onPick, onHover, onOpenMessages } = props
  const inset = props.insetRight ?? 0
  const frameKey = (frame ?? []).join(',')
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // The camera lives outside React. Pan and zoom write the transform and --k
  // straight to the DOM, so a gesture never re-renders the scene. kR is a coarse
  // copy (updated every ~20% of zoom) for the few choices made in JS, like how
  // much of a label fits.
  const camRef = useRef<Cam>({ x: 0, y: 0, k: 0.5 })
  const [kR, setKR] = useState(0.5)
  const kRRef = useRef(0.5)
  const gRef = useRef<SVGGElement>(null)
  const zoomTextRef = useRef<HTMLSpanElement>(null)
  const miniWrapRef = useRef<HTMLDivElement>(null)
  const miniViewRef = useRef<SVGRectElement>(null)
  const viewport = useRef({ w: 0, h: 0, inset: 0, homeK: 0.5 })
  const camAnim = useRef(0)

  /* ---------------- tweened scene state ---------------- */
  // Once you are working at program level (a pocket is open), links you are looking at
  // must land on programs too: open every pocket that holds a lit program. Unrelated
  // pockets stay closed. Hover (soft) highlights never open anything, so the map
  // doesn't churn as the pointer moves.
  const expandKey = useMemo(() => {
    if (!focus || !hl || hl.strength !== 'strong') return ''
    return [...new Set([...hl.programs.keys()].map((id) => PROGRAM[id].pocket))].sort().join(',')
  }, [focus, hl])
  const targets = useMemo(() => {
    const expand = new Set(expandKey ? expandKey.split(',') : [])
    const t: Record<string, number> = { L: view === 'layers' ? 1 : 0 }
    for (const id of L.order) t[id] = focus === id || expand.has(id) ? 1 : 0
    return t
  }, [focus, view, expandKey])
  const tw = useTweenMap(targets, 700)
  const Lv = tw.L
  const open = (id: string) => tw[id] ?? 0

  /* ---------------- camera ---------------- */
  const setCamera = useCallback((c: Cam) => {
    camRef.current = c
    gRef.current?.setAttribute('transform', camTransform(c))
    svgRef.current?.style.setProperty('--k', String(c.k))
    if (zoomTextRef.current) zoomTextRef.current.textContent = `${Math.round(c.k * 100)}%`
    updateMinimap(c, viewport.current, miniWrapRef.current, miniViewRef.current)
    if (Math.abs(Math.log(c.k / kRRef.current)) > 0.18) {
      kRRef.current = c.k
      setKR(c.k)
    }
  }, [])

  const flyTo = useCallback(
    (target: Cam, ms = 750) => {
      cancelAnimationFrame(camAnim.current)
      const from = camRef.current
      const start = performance.now()
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (reduce) return setCamera(target)
      // zoom in log space so scale changes feel even
      const lk0 = Math.log(from.k)
      const lk1 = Math.log(target.k)
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / ms)
        const e = easeInOut(t)
        const k = Math.exp(lerp(lk0, lk1, e))
        setCamera({ x: lerp(from.x, target.x, e), y: lerp(from.y, target.y, e), k })
        if (t < 1) camAnim.current = requestAnimationFrame(tick)
      }
      camAnim.current = requestAnimationFrame(tick)
    },
    [setCamera],
  )

  const fitTarget = useCallback(
    (f: string | null, layers: boolean): Cam | null => {
      const w = size.w - inset
      const h = size.h
      if (w <= 0 || !h) return null
      const zTop = layers ? LZ + LZE + 40 : 70
      // the focused pocket, plus every pocket opened to show where the lit links land
      const ids = f ? [f, ...(expandKey ? expandKey.split(',') : [])] : []
      const fr = frameKey ? frameKey.split(',') : []
      const b = ids.length
        ? ids.map((id) => focusBox(id, fr)).reduce((a, c) => ({ x0: Math.min(a.x0, c.x0), x1: Math.max(a.x1, c.x1), y0: Math.min(a.y0, c.y0), y1: Math.max(a.y1, c.y1) }))
        : L.bounds
      const s = screenBounds(b.x0, b.x1, b.y0, b.y1, zTop)
      const pad = f ? 56 : 36
      const k = clamp(Math.min((w - pad * 2) / (s.x1 - s.x0), (h - pad * 2) / (s.y1 - s.y0)), 0.15, 2.6)
      return { k, x: w / 2 - k * (s.x0 + s.x1) / 2, y: h / 2 - k * (s.y0 + s.y1) / 2 }
    },
    [size, inset, frameKey, expandKey],
  )

  // the whole-board zoom: the mini-map shows once you are well past it
  const homeK = useMemo(() => fitTarget(null, view === 'layers')?.k ?? 0.5, [fitTarget, view])
  useEffect(() => {
    viewport.current = { w: size.w, h: size.h, inset, homeK }
    updateMinimap(camRef.current, viewport.current, miniWrapRef.current, miniViewRef.current)
  }, [size.w, size.h, inset, homeK])

  const centerOn = (X: number, Y: number) => {
    const c = camRef.current
    cancelAnimationFrame(camAnim.current)
    setCamera({ k: c.k, x: (size.w - inset) / 2 - X * c.k, y: size.h / 2 - Y * c.k })
  }
  const fit = () => {
    const t = fitTarget(focus, view === 'layers')
    if (t) flyTo(t, 500)
  }

  const zoomAround = (f: number) => {
    const c = camRef.current
    const k = clamp(c.k * f, 0.15, 5)
    const cx = (size.w - inset) / 2
    const cy = size.h / 2
    flyTo({ k, x: cx - ((cx - c.x) * k) / c.k, y: cy - ((cy - c.y) * k) / c.k }, 260)
  }
  useImperativeHandle(ref, () => ({ fit, zoomBy: zoomAround }))

  // size
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // first fit happens instantly; later focus/view changes fly
  const fitted = useRef(false)
  const hasSize = size.w > 0 && size.h > 0
  useEffect(() => {
    const t = fitTarget(focus, view === 'layers')
    if (!t) return
    if (!fitted.current) {
      fitted.current = true
      setCamera(t)
    } else flyTo(t)
    // keyed on what should move the camera, not on the helpers it reads:
    // fitTarget/flyTo are rebuilt every render and would refly constantly
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, view, frameKey, expandKey, inset, hasSize])

  // keep the frame when the window resizes
  const lastSize = useRef(size)
  useEffect(() => {
    const prev = lastSize.current
    lastSize.current = size
    if (!prev.w || !size.w) return
    const c = camRef.current
    setCamera({ ...c, x: c.x + (size.w - prev.w) / 2, y: c.y + (size.h - prev.h) / 2 })
  }, [size, setCamera])

  // wheel zoom around the cursor (non-passive so the page never scrolls)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cancelAnimationFrame(camAnim.current)
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      const c = camRef.current
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      const k = clamp(c.k * Math.exp(-delta * 0.0016), 0.15, 5)
      setCamera({ k, x: px - ((px - c.x) * k) / c.k, y: py - ((py - c.y) * k) / c.k })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setCamera])

  /* ---------------- pointer: pan vs pick ---------------- */
  const drag = useRef<{ sx: number; sy: number; x: number; y: number; moved: boolean; hit: Ref | null; id: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const hoverRef = useRef<Ref | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    cancelAnimationFrame(camAnim.current)
    const c = camRef.current
    drag.current = { sx: e.clientX, sy: e.clientY, x: c.x, y: c.y, moved: false, hit: parseHit(e.target), id: e.pointerId }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (d) {
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      if (!d.moved && Math.hypot(dx, dy) < 4) return
      if (!d.moved) {
        d.moved = true
        setDragging(true)
        ;(e.currentTarget as Element).setPointerCapture(d.id)
      }
      setCamera({ ...camRef.current, x: d.x + dx, y: d.y + dy })
      return
    }
    const h = parseHit(e.target)
    if (!sameRef(h, hoverRef.current)) {
      hoverRef.current = h
      onHover(h)
    }
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (d && !d.moved) onPick(d.hit)
  }
  const onPointerLeave = () => {
    if (!drag.current && hoverRef.current) {
      hoverRef.current = null
      onHover(null)
    }
  }

  /* ---------------- derived visuals ---------------- */
  const zPlane = LZ * Lv
  const zEntry = (LZ + LZE) * Lv

  const litPocketStore = useMemo(() => {
    const s = new Set<string>()
    if (!hl) return s
    for (const id of hl.links) {
      if (!id.startsWith('io:')) continue
      const [, p, st] = id.split(':')
      s.add(`${PROGRAM[p].pocket}:${st}`)
    }
    return s
  }, [hl])

  const toneColor = hl?.tone === 'warn' ? C.warn : C.accent
  const dimFor = (lit: boolean) => (!hl ? 1 : lit ? 1 : hl.strength === 'strong' ? 0.3 : 0.45)
  // with a pocket open and nothing lit, everything else steps back
  const focusDim = (pocket: string) => (!hl && focus && focus !== pocket ? 0.3 : 1)
  const progLit = (id: string) => !!hl?.programs.has(id)
  const storeLit = (id: string) => !!hl?.stores.has(id)
  const pocketLit = (id: string) => !!hl?.pockets.has(id) || (selection?.kind === 'pocket' && selection.id === id)

  const progColor = (id: string): string => {
    const p = PROGRAM[id]
    if (lens === 'migration') return MIG_COLOR[mig[id] ?? 'legacy']
    if (lens === 'coupling') return mix(C.block, isoColor(POCKET[p.pocket].isolation), 0.62)
    if (lens === 'owners') return mix(C.block, TEAM_COLOR[POCKET[p.pocket].team], 0.72)
    if (lens === 'gate' && !hl) return mix(C.block, GATE_COLOR[gate?.[p.pocket]?.state ?? 'none'], 0.5)
    const role = hl?.programs.get(id)
    if (role === 'source') return C.accent
    if (role === 'hit') return C.warn
    return C.block
  }

  const pocketTop = (id: string): string => {
    const p = POCKET[id]
    if (lens === 'coupling') return mix(C.block, isoColor(p.isolation), 0.58)
    if (lens === 'owners') return mix(C.block, TEAM_COLOR[p.team], 0.68)
    if (lens === 'gate') return mix(C.block, GATE_COLOR[gate?.[id]?.state ?? 'none'], 0.55)
    if (lens === 'blast' && hl) {
      const roles = p.programs.map((x) => hl.programs.get(x))
      if (roles.includes('source')) return mix(C.block, C.accent, 0.66)
      if (roles.includes('hit')) return mix(C.block, C.warn, 0.6)
    }
    return C.block
  }

  const pocketMetric = (id: string): string => {
    const m = lensMetric(id)
    // restricted pockets say so in every lens (the viewer can't see their requirements)
    return gate?.[id]?.state === 'locked' && lens !== 'gate' ? `restricted · ${m}` : m
  }
  const lensMetric = (id: string): string => {
    const p = POCKET[id]
    if (lens === 'migration') return `${Math.round(migrationProgress(mig, p.programs) * 100)}% on Java`
    if (lens === 'coupling') return isoWord(p.isolation)
    if (lens === 'owners') return TEAMS[p.team].owner
    if (lens === 'gate' && !hl) {
      const g = gate?.[id]
      if (!g || g.state === 'none') return 'no requirements'
      if (g.state === 'locked') return 'restricted'
      if (g.state === 'done') return 'migrated'
      if (g.state === 'open') return 'gate open'
      return `${g.blockers} blocking`
    }
    if (hl) {
      const n = p.programs.filter((x) => hl.programs.get(x) === 'hit').length
      if (p.programs.some((x) => hl.programs.get(x) === 'source')) return 'changing'
      if (n) return `${n} retest`
    }
    return `${p.programs.length} programs`
  }

  /* ---------------- render helpers ---------------- */
  const traceStyle = (mode: string, lit: boolean, width: number) => ({
    stroke: lit ? toneColor : C.copper,
    strokeWidth: lit ? Math.max(1.8, width) : width,
    strokeDasharray: lit ? '7 5' : mode === 'read' ? '3 3' : undefined,
    className: lit ? 'trace-flow' : undefined,
  })

  const pocketZTop = (id: string) => zPlane + lerp(L.pockets[id].h, G.SLAB_H, open(id)) * ZS

  function floorTrace(t: TraceGeo, zFrom: number): P3[] {
    const [u, yEdge] = t.floor[0]
    const pts: P3[] = []
    if (zFrom > 0.5) pts.push([u, yEdge, zFrom])
    for (const [x, y] of t.floor) pts.push([x, y, 0])
    return pts
  }

  /* grid lines on the die (static) */
  const grid = useMemo(() => {
    const b = L.bounds
    let d = ''
    for (let x = Math.ceil(b.x0); x <= b.x1; x += 1) d += path([[x, b.y0, 0], [x, b.y1, 0]])
    for (let y = Math.ceil(b.y0); y <= b.y1; y += 1) d += path([[b.x0, y, 0], [b.x1, y, 0]])
    return d
  }, [])

  const showCalls = hl ? hl.calls : []
  const b = L.bounds

  /* ---------------- scene ---------------- */
  // The camera lives in a ref and is written to the DOM directly (no re-render
  // per frame). Renders read it once so they never undo what setCamera wrote.
  // oxlint-disable-next-line react/refs
  const cam0 = camRef.current

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        style={{ cursor: dragging ? 'grabbing' : hover ? 'pointer' : 'grab', ['--k' as string]: cam0.k }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        role="img"
        aria-label="CardDemo architecture map"
      >
        <defs>
          <marker id="arrow-accent" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill={C.accent} />
          </marker>
          <marker id="arrow-warn" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill={C.warn} />
          </marker>
          <marker id="arrow-faint" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill={C.faint} />
          </marker>
        </defs>

        <g ref={gRef} transform={camTransform(cam0)}>
          {/* die substrate = data plane */}
          <polygon points={rect(b.x0, b.x1, b.y0, b.y1)} fill={C.die} stroke={C.dieEdge} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={grid} stroke={C.grid} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.9} />
          <polygon points={rect(b.x0 + 0.25, b.x1 - 0.25, b.y0 + 0.25, b.y1 - 0.25)} fill="none" stroke={C.dieEdge} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 4" />
          <DieMarks />

          {/* domain regions */}
          {L.domains.map((d) => {
            const dom = DOMAIN[d.id]
            const team = TEAMS[dom.team]
            const tint = lens === 'owners' ? TEAM_COLOR[dom.team] : null
            const lit = !hl || dom.pockets.some((p) => pocketLit(p))
            const labelY = d.row === 0 ? d.y0 + 0.55 : d.y1 - 0.55
            return (
              <g key={`${d.id}-${d.row}-${d.x0}`} opacity={lit ? 1 : 0.5} style={{ transition: 'opacity 300ms' }}>
                <polygon
                  points={rect(d.x0, d.x1, d.y0, d.y1)}
                  fill={tint ?? 'transparent'}
                  fillOpacity={tint ? 0.07 : 0}
                  stroke={tint ?? C.slabEdge}
                  strokeOpacity={tint ? 0.6 : 1}
                  strokeWidth={1}
                  strokeDasharray="5 4"
                  vectorEffect="non-scaling-stroke"
                />
                <text transform={floorText(d.x0 + 0.35, labelY)} fontFamily={MONO} style={fs(10, 4, 15)} fill={tint ?? C.faint} dominantBaseline="middle">
                  {dom.title}
                  <tspan fill={C.faint}>{`  ·  ${team.owner} · ${team.name}`}</tspan>
                </text>
              </g>
            )
          })}

          {/* bus lanes */}
          {L.laneOrder.map((s) => {
            const lane = L.lanes[s]
            const lit = storeLit(s)
            const w = lens === 'coupling' ? 1.4 + lane.users * 0.55 : 2
            return (
              <g key={s} data-hit={`store:${s}`} opacity={dimFor(lit)} style={{ transition: 'opacity 300ms' }}>
                <path d={path([[G.REG_X1, lane.y, 0], [lane.x1, lane.y, 0]])} stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" />
                <path
                  d={path([[G.REG_X1, lane.y, 0], [lane.x1, lane.y, 0]])}
                  stroke={lit ? toneColor : C.copper}
                  strokeWidth={lit ? w + 0.8 : w}
                  vectorEffect="non-scaling-stroke"
                  opacity={lit ? 1 : 0.8}
                />
                <text transform={floorText(lane.x1 + 0.25, lane.y)} fontFamily={MONO} style={fs(9, 3.5, 12)} fill={lit ? toneColor : C.faint} dominantBaseline="middle">
                  {s}
                  <tspan fill={C.faint}>{`  ·  ${STORE[s].title}`}</tspan>
                </text>
              </g>
            )
          })}

          {/* registers (shared stores) */}
          {L.laneOrder.map((s) => {
            const lane = L.lanes[s]
            const f = box(G.REG_X0, G.REG_X1, lane.y - G.REG_HALF, lane.y + G.REG_HALF, 0, G.REG_H * ZS)
            const lit = storeLit(s)
            const sel = selection?.kind === 'store' && selection.id === s
            const top = lit ? mix('#232A33', toneColor, 0.35) : '#232A33'
            const users = pocketsUsingStore(s).length
            return (
              <g key={`reg-${s}`} data-hit={`store:${s}`} opacity={dimFor(lit)} style={{ transition: 'opacity 300ms' }}>
                <polygon points={f.left} fill={shade(top, 0.5)} />
                <polygon points={f.right} fill={shade(top, 0.65)} />
                <polygon points={f.top} fill={top} stroke={sel ? C.accent : lit ? toneColor : C.copper} strokeOpacity={sel || lit ? 1 : 0.55} strokeWidth={sel ? 1.8 : 1} vectorEffect="non-scaling-stroke" />
                <text transform={floorText((G.REG_X0 + G.REG_X1) / 2, lane.y, G.REG_H * ZS)} fontFamily={MONO} style={fs(12, 5, 17)} fontWeight={600} fill={C.ink} textAnchor="middle" dominantBaseline="middle">
                  {s}
                  {lens === 'coupling' && <tspan fill={C.sub} fontWeight={400}>{` ×${users}`}</tspan>}
                </text>
              </g>
            )
          })}

          {/* pocket-level taps (overview) */}
          {L.pocketTaps.map((t) => {
            const o = 1 - open(t.pocket)
            if (o < 0.02) return null
            const lit = litPocketStore.has(`${t.pocket}:${t.store}`)
            const st = traceStyle(t.mode, lit, lens === 'coupling' ? 0.9 + t.weight * 0.7 : 1.2)
            const pts = floorTrace(t, zPlane)
            const end = pts[pts.length - 1]
            return (
              <g key={t.id} opacity={o * dimFor(lit) * focusDim(t.pocket)} style={{ transition: 'opacity 300ms' }}>
                <path d={path(pts)} fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" {...st} />
                <Via at={end} color={lit ? toneColor : C.copper} />
              </g>
            )
          })}

          {/* program-level taps: floor + via part (slab part is drawn with the pocket) */}
          {L.progTaps.map((t) => {
            const o = open(t.pocket)
            if (o < 0.02) return null
            const lit = !!hl?.links.has(t.id)
            const st = traceStyle(t.mode, lit, 1.1)
            const pts = floorTrace(t, zPlane)
            return (
              <g key={t.id} opacity={o * dimFor(lit)} style={{ transition: 'opacity 300ms' }}>
                <path d={path(pts)} fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" {...st} />
                <Via at={pts[pts.length - 1]} color={lit ? toneColor : C.copper} />
              </g>
            )
          })}

          {/* local stores: tiles + their traces (visible when a pocket opens, or in layers) */}
          {L.order.map((pid) => {
            const pg = L.pockets[pid]
            const o = open(pid)
            const vis = Math.max(o, Lv)
            if (vis < 0.02 || !pg.tiles.length) return null
            const traces = o > 0.5 ? L.progLocals.filter((t) => t.pocket === pid) : L.pocketLocals.filter((t) => t.pocket === pid)
            return (
              <g key={`loc-${pid}`} opacity={vis}>
                {traces.map((t) => {
                  const lit = t.program ? !!hl?.links.has(t.id) : litPocketStore.has(`${pid}:${t.store}`)
                  const pts = floorTrace(t, zPlane)
                  return (
                    <path key={t.id} d={path(pts)} fill="none" vectorEffect="non-scaling-stroke" strokeLinejoin="round" opacity={dimFor(lit)} {...traceStyle(t.mode, lit, 1)} />
                  )
                })}
                {pg.tiles.map((tile) => {
                  const lit = storeLit(tile.store)
                  const sel = selection?.kind === 'store' && selection.id === tile.store
                  const x0 = tile.cx - G.TILE_W / 2
                  const x1 = tile.cx + G.TILE_W / 2
                  const y0 = tile.cy - G.TILE_D / 2
                  const y1 = tile.cy + G.TILE_D / 2
                  const f = box(x0, x1, y0, y1, 0, 5)
                  const top = lit ? mix('#20262E', toneColor, 0.3) : '#20262E'
                  return (
                    <g key={tile.store} data-hit={`store:${tile.store}`} opacity={dimFor(lit)}>
                      <polygon points={f.left} fill={shade(top, 0.55)} />
                      <polygon points={f.right} fill={shade(top, 0.7)} />
                      <polygon points={f.top} fill={top} stroke={sel ? C.accent : C.copper} strokeOpacity={sel ? 1 : 0.5} strokeWidth={sel ? 1.6 : 1} vectorEffect="non-scaling-stroke" />
                      <text transform={floorText(tile.cx, tile.cy, 5)} fontFamily={MONO} style={fs(8, 4.2, 8.5)} fill={C.sub} textAnchor="middle" dominantBaseline="middle">
                        {tile.store.replace(/^MQ\./, '')}
                      </text>
                    </g>
                  )
                })}
              </g>
            )
          })}

          {/* layer planes */}
          {Lv > 0.02 && (
            <g opacity={Lv}>
              <polygon points={rect(b.x0, b.x1, b.y0, b.y1, zPlane)} fill="#11151B" fillOpacity={0.3} stroke={C.dieEdge} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <PlaneLabel z={0} text={`Data  ·  ${BUS_ORDER.length} shared stores on the bus  ·  local stores beside their pocket`} />
              <PlaneLabel z={zPlane} text={`Programs  ·  ${L.order.length} pockets`} />
            </g>
          )}

          {/* pockets */}
          {L.order.map((pid) => (
            <PocketView
              key={pid}
              pg={L.pockets[pid]}
              o={open(pid)}
              zBase={zPlane}
              zTop={pocketZTop(pid)}
              kR={kR}
              lens={lens}
              mig={mig}
              hl={hl}
              selection={selection}
              hover={hover}
              live={live}
              top={pocketTop(pid)}
              metric={pocketMetric(pid)}
              metricColor={lens === 'gate' && gate?.[pid] && !hl ? GATE_COLOR[gate[pid].state] : undefined}
              progColor={progColor}
              dim={dimFor(pocketLit(pid)) * focusDim(pid)}
              progDim={(id) => dimFor(progLit(id))}
              toneColor={toneColor}
              hideEntriesInline={Lv > 0.5}
              onOpenMessages={onOpenMessages}
            />
          ))}

          {/* cross-pocket calls, routed over the control channel */}
          {showCalls.map((c, i) => (
            <CallRoute key={`${c.from}-${c.to}-${i}`} from={c.from} to={c.to} open={open} zPlane={zPlane} zTop={pocketZTop} color={toneColor} warn={hl?.tone === 'warn'} index={i} />
          ))}

          {/* entry plane */}
          {Lv > 0.02 && (
            <g opacity={Lv}>
              <polygon points={rect(b.x0, b.x1, b.y0, b.y1, zEntry)} fill="#11151B" fillOpacity={0.12} stroke={C.dieEdge} strokeDasharray="3 5" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <PlaneLabel z={zEntry} text={`Entry points  ·  ${ENTRIES.filter((e) => e.kind === 'job').length} JCL jobs  ·  ${ENTRIES.filter((e) => e.kind === 'cics').length} CICS transactions`} />
              {L.order.flatMap((pid) =>
                L.pockets[pid].programs.flatMap((g) =>
                  g.entries.map((eid, j) => {
                    const e = ENTRIES.find((x) => x.id === eid)!
                    const lit = !!hl?.entries.has(eid) || progLit(g.id)
                    const off = (j - (g.entries.length - 1) / 2) * 0.7
                    const cx = g.cx + off
                    const zTop = pocketZTop(pid) + g.h * open(pid) * ZS
                    const f = box(cx - 0.3, cx + 0.3, g.cy - 0.3, g.cy + 0.3, zEntry, zEntry + 6)
                    const col = e.kind === 'cics' ? '#1F4B5C' : '#4A3F2C'
                    const sel = selection?.kind === 'entry' && selection.id === eid
                    return (
                      <g key={eid} data-hit={`entry:${eid}`} opacity={dimFor(lit)}>
                        <path d={path([[cx, g.cy, zEntry], [cx, g.cy, zTop]])} stroke={lit ? toneColor : C.faint} strokeWidth={lit ? 1.6 : 1} strokeDasharray={lit ? '7 5' : '2 3'} className={lit ? 'trace-flow' : undefined} vectorEffect="non-scaling-stroke" />
                        <polygon points={f.left} fill={shade(col, 0.6)} />
                        <polygon points={f.right} fill={shade(col, 0.75)} />
                        <polygon points={f.top} fill={col} stroke={sel || lit ? toneColor : e.kind === 'cics' ? C.accent : C.copper} strokeOpacity={sel || lit ? 1 : 0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                        <text transform={floorText(cx, g.cy, zEntry + 6)} fontFamily={MONO} style={fs(8, 4.2, 8.5)} fill={C.ink} textAnchor="middle" dominantBaseline="middle">
                          {eid}
                        </text>
                      </g>
                    )
                  }),
                ),
              )}
            </g>
          )}
          {/* label lifts off the surface on hover */}
          {hover && (hover.kind === 'program' || hover.kind === 'pocket') && (() => {
            let ax = 0, ay = 0, az = 0, label = '', sub = ''
            if (hover.kind === 'program') {
              const prog = PROGRAM[hover.id]
              const pg = L.pockets[prog.pocket]
              const o = open(prog.pocket)
              const g = pg.programs.find((x) => x.id === hover.id)
              if (!g || o < 0.4) return null
              ax = g.cx; ay = g.cy; az = pocketZTop(prog.pocket) + g.h * o * ZS
              label = g.id; sub = PROGRAM[hover.id].title
            } else {
              const pg = L.pockets[hover.id]
              if (!pg) return null
              ax = (pg.x0 + pg.x1) / 2; ay = (pg.y0 + pg.y1) / 2; az = pocketZTop(hover.id)
              label = POCKET[hover.id].title; sub = `${POCKET[hover.id].programs.length} programs`
            }
            const { X, Y } = proj(ax, ay, az)
            const text = sub ? `${label}  ·  ${sub}` : label
            const w = Math.max(54, text.length * 6.4 + 16)
            const H = 21, RISE = 32
            return (
              <g key={`hl:${hover.kind}:${hover.id}`} transform={`translate(${X} ${Y})`} pointerEvents="none">
                <g style={UNZOOM}>
                <g className="float-in">
                  <line x1={0} y1={0} x2={0} y2={-RISE} stroke={C.accent} strokeWidth={1.1} />
                  <circle cx={0} cy={0} r={2.2} fill={C.accent} />
                  <rect x={-w / 2} y={-RISE - H} width={w} height={H} rx={6} fill="#12171f" stroke={C.slabEdge} strokeWidth={1} />
                  <text x={0} y={-RISE - H / 2 + 0.5} fontFamily={MONO} fontSize={11} fill={C.ink} textAnchor="middle" dominantBaseline="middle">
                    <tspan fontWeight={600}>{label}</tspan>
                    {sub && <tspan fill={C.sub} fontWeight={400}>{`  ·  ${sub}`}</tspan>}
                  </text>
                </g>
                </g>
              </g>
            )
          })()}
        </g>
      </svg>

      {/* camera controls: mini-map (once zoomed in) above zoom and fit */}
      <div className="absolute bottom-3 flex flex-col items-end gap-2 transition-[right] duration-200" style={{ right: 12 + inset }}>
        <Minimap wrapRef={miniWrapRef} viewRef={miniViewRef} focus={focus} hl={hl} toneColor={toneColor} onCenter={centerOn} />
        <div className="flex items-center gap-0.5 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-panel)] p-[3px]">
          <IconBtn label="Zoom out" onClick={() => zoomAround(1 / 1.35)} className="size-7">
            <Minus className="size-3.5" />
          </IconBtn>
          <span ref={zoomTextRef} className="tnum w-11 text-center font-mono text-[11px] text-[var(--color-muted)]" aria-hidden>
            {Math.round(cam0.k * 100)}%
          </span>
          <IconBtn label="Zoom in" onClick={() => zoomAround(1.35)} className="size-7">
            <Plus className="size-3.5" />
          </IconBtn>
          <div className="mx-0.5 h-4 w-px bg-[var(--color-line-2)]" />
          <Btn onClick={fit} className="h-7 px-2 text-[11.5px]" title="Fit to view (F)">
            <Maximize2 className="size-3.5" /> Fit
          </Btn>
        </div>
      </div>
    </div>
  )
})

/* ------------------------------------------------------------------ */

function Via({ at, color }: { at: P3; color: string }) {
  const { X, Y } = proj(at[0], at[1], at[2])
  return <circle cx={X} cy={Y} style={{ r: onScreen(2.6, 1.6, 5) }} fill={color} />
}

function PlaneLabel({ z, text }: { z: number; text: string }) {
  const b = LAYOUT.bounds
  return (
    <text transform={floorText(b.x0 + 0.4, b.y1 - 0.45, z)} fontFamily={MONO} style={fs(11, 5, 18)} fill={C.sub} dominantBaseline="middle">
      {text}
    </text>
  )
}

function DieMarks() {
  const b = LAYOUT.bounds
  const m = 1.1
  const corners: [number, number, number, number][] = [
    [b.x0, b.y0, 1, 1],
    [b.x1, b.y0, -1, 1],
    [b.x1, b.y1, -1, -1],
    [b.x0, b.y1, 1, -1],
  ]
  return (
    <g>
      {corners.map(([x, y, dx, dy], i) => (
        <path key={i} d={path([[x + dx * m, y + dy * 0.12, 0], [x + dx * 0.12, y + dy * 0.12, 0], [x + dx * 0.12, y + dy * m, 0]])} fill="none" stroke={C.sub} strokeWidth={1.2} vectorEffect="non-scaling-stroke" opacity={0.6} />
      ))}
    </g>
  )
}

/* one pocket: block at overview, slab with programs when open */
function PocketView(p: {
  pg: PocketGeo
  o: number
  zBase: number
  zTop: number
  kR: number
  lens: Lens
  mig: MigrationMap
  hl: Highlight | null
  selection: Ref | null
  hover: Ref | null
  live: { id: string; pending: number } | null
  top: string
  metric: string
  metricColor?: string
  progColor: (id: string) => string
  dim: number
  progDim: (id: string) => number
  toneColor: string
  hideEntriesInline: boolean
  onOpenMessages?: () => void
}) {
  const { pg, o, zBase, zTop, kR, lens, mig, hl, selection, hover, live } = p
  const pocket = POCKET[pg.id]
  const isSel = selection?.kind === 'pocket' && selection.id === pg.id
  const isHover = hover?.kind === 'pocket' && hover.id === pg.id
  const faces = box(pg.x0, pg.x1, pg.y0, pg.y1, zBase, zTop)
  const topCol = o > 0.5 ? C.slab : p.top
  const progress = migrationProgress(mig, pocket.programs)
  const hasLive = !!live && pocket.programs.includes(live.id)
  const cx = (pg.x0 + pg.x1) / 2
  const cy = (pg.y0 + pg.y1) / 2

  // names you navigate by face the viewer at a fixed size; fit them to the block's
  // on-screen width (one block unit along x is TW/2 = 32 px before the camera)
  const blockPx = (pg.x1 - pg.x0) * 32 * kR * 1.15
  const name = fitName(pocket.title, pocket.short, blockPx)
  const metricColor = p.metricColor ?? (lens === 'coupling' ? isoColor(pocket.isolation) : C.sub)
  const overview = name.length
    ? [...name.map((t) => ({ text: t, weight: 600 })), ...(blockPx > 60 ? [{ text: p.metric, size: 10.5, color: metricColor }] : [])]
    : []

  const plateY = pg.y((pg.title[0] + pg.title[1]) / 2)
  const platePx = (pg.x1 - pg.x0) * 32 * kR * 1.6
  const plateName = fitName(pocket.title, pocket.short, platePx)
  const plateMeta = `${pocket.programs.length} programs · ${isoWord(pocket.isolation)} · ${TEAMS[pocket.team].owner}`
  const plate = plateName.length
    ? [
        ...plateName.map((t) => ({ text: t, weight: 600 })),
        // the detail line only when there is room for it (zoomed-out views open many pockets)
        ...(platePx > plateMeta.length * 10.5 * MONO_W ? [{ text: plateMeta, size: 10.5, color: C.sub }] : []),
      ]
    : []
  // a program's id shows once its cube is wide enough on screen to hold it;
  // the selected or hovered one always shows
  const progLabels = G.BLOCK * 64 * kR >= 8 * 10.5 * MONO_W - 6
  const sorted = [...pg.programs].sort((a, b) => a.cx + a.cy - (b.cx + b.cy))

  return (
    <g opacity={p.dim} style={{ transition: 'opacity 300ms' }}>
      <g data-hit={`pocket:${pg.id}`}>
        <polygon points={faces.left} fill={shade(topCol, 0.48)} />
        <polygon points={faces.right} fill={shade(topCol, 0.64)} />
        <polygon
          points={faces.top}
          fill={topCol}
          stroke={isSel || hasLive && o < 0.5 ? C.accent : isHover ? C.sub : C.slabEdge}
          strokeWidth={isSel ? 1.8 : 1}
          vectorEffect="non-scaling-stroke"
          className={hasLive && !isSel && o < 0.5 ? 'pulse-stroke' : undefined}
        />
        {/* migration fill: the block "fills" toward Java from the left */}
        {lens === 'migration' && o < 0.98 && progress > 0 && (
          <polygon
            points={rect(pg.x0, pg.x0 + (pg.x1 - pg.x0) * progress, pg.y0, pg.y1, zTop)}
            fill={C.good}
            opacity={0.32 * (1 - o)}
          />
        )}
        {/* title plate (open): the plate is part of the slab, the name faces you */}
        {o > 0.02 && (
          <polygon points={rect(pg.x0 + 0.08, pg.x1 - 0.08, pg.y(pg.title[0] + 0.08), pg.y(pg.title[1] - 0.08), zTop + 0.4)} fill={C.plate} stroke={C.slabEdge} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={o} />
        )}
      </g>
      <Billboard at={proj(cx, cy, zTop)} lines={overview} opacity={1 - o} />
      <Billboard at={proj((pg.x0 + pg.x1) / 2, plateY, zTop + 0.4)} lines={plate} opacity={clamp((o - 0.4) / 0.6, 0, 1)} />

      {/* slab-level traces, then programs */}
      {o > 0.02 && (
        <g opacity={o}>
          <SlabTraces pg={pg} z={zTop} hl={hl} toneColor={p.toneColor} />
          {sorted.map((g) => {
            const z1 = zTop + g.h * o * ZS
            const fb = box(g.cx - G.BLOCK / 2, g.cx + G.BLOCK / 2, g.cy - G.BLOCK / 2, g.cy + G.BLOCK / 2, zTop, z1)
            const col = p.progColor(g.id)
            const sel = selection?.kind === 'program' && selection.id === g.id
            const hov = hover?.kind === 'program' && hover.id === g.id
            const isLive = live?.id === g.id
            const shadowing = mig[g.id] === 'shadowing'
            return (
              <g key={g.id} data-hit={`program:${g.id}`} opacity={p.progDim(g.id)} style={{ transition: 'opacity 300ms' }}>
                <polygon points={fb.left} fill={shade(col, 0.5)} />
                <polygon points={fb.right} fill={shade(col, 0.66)} />
                <polygon points={fb.top} fill={col} stroke={sel ? C.ink : hov ? C.sub : 'rgba(0,0,0,0.35)'} strokeWidth={sel ? 1.8 : 1} vectorEffect="non-scaling-stroke" />
                {lens === 'migration' && shadowing && <polygon points={fb.top} fill={C.accent} className="pulse-soft" opacity={0.35} />}
                {(progLabels || sel || hov) && <Billboard at={proj(g.cx, g.cy, z1)} lines={[{ text: g.id, size: 10.5, weight: 600 }]} opacity={clamp((o - 0.5) * 2, 0, 1)} />}
                {!p.hideEntriesInline && g.entries.length > 0 && (
                  <polygon
                    points={poly([
                      [g.cx + G.BLOCK / 2 - 0.28, g.cy + G.BLOCK / 2 - 0.08, z1],
                      [g.cx + G.BLOCK / 2 - 0.08, g.cy + G.BLOCK / 2 - 0.08, z1],
                      [g.cx + G.BLOCK / 2 - 0.08, g.cy + G.BLOCK / 2 - 0.28, z1],
                    ])}
                    fill={inkOn(col)}
                    opacity={0.7}
                  />
                )}
                {isLive && live!.pending > 0 && <Pin x={g.cx} y={g.cy} z={z1} n={live!.pending} onOpen={p.onOpenMessages} />}
              </g>
            )
          })}
        </g>
      )}
      {/* pin on the closed block */}
      {o < 0.5 && live && pocket.programs.includes(live.id) && live.pending > 0 && (() => {
        const g = pg.programs.find((x) => x.id === live.id)!
        return <Pin x={g.cx} y={g.cy} z={zTop} n={live.pending} onOpen={p.onOpenMessages} />
      })()}
    </g>
  )
}

function SlabTraces({ pg, z, hl, toneColor }: { pg: PocketGeo; z: number; hl: Highlight | null; toneColor: string }) {
  const zs = z + 0.5
  const taps = LAYOUT.progTaps.filter((t) => t.pocket === pg.id)
  const locals = LAYOUT.progLocals.filter((t) => t.pocket === pg.id)
  const calls = CALLS.filter((c) => PROGRAM[c.from].pocket === pg.id && PROGRAM[c.to].pocket === pg.id)
  const pos = Object.fromEntries(pg.programs.map((g) => [g.id, g]))
  const dim = (lit: boolean) => (!hl ? 0.9 : lit ? 1 : hl.strength === 'strong' ? 0.15 : 0.4)
  return (
    <g>
      {[...taps, ...locals].map((t) => {
        const lit = !!hl?.links.has(t.id)
        return (
          <path
            key={`s-${t.id}`}
            d={path(t.slab.map(([x, y]) => [x, y, zs] as P3))}
            fill="none"
            stroke={lit ? toneColor : C.copper}
            strokeWidth={lit ? 1.8 : 1}
            strokeDasharray={lit ? '7 5' : t.mode === 'read' ? '3 3' : undefined}
            className={lit ? 'trace-flow' : undefined}
            vectorEffect="non-scaling-stroke"
            opacity={dim(lit)}
          />
        )
      })}
      {calls.map((c, i) => {
        const a = pos[c.from]
        const b = pos[c.to]
        const lit = !!hl?.links.has(`call:${c.from}:${c.to}`)
        const vOff = ((i % 3) - 1) * 0.09
        const cv = pg.corridorV + vOff
        const faceV = (g: typeof a) => (g.v < pg.corridorV ? g.v + G.BLOCK / 2 : g.v - G.BLOCK / 2)
        const ua = a.cx + 0.22
        const ub = b.cx - 0.22
        const pts: P3[] = [
          [ua, pg.y(faceV(a)), zs],
          [ua, pg.y(cv), zs],
          [ub, pg.y(cv), zs],
          [ub, pg.y(faceV(b)), zs],
        ]
        return (
          <path
            key={`c-${c.from}-${c.to}`}
            d={path(pts)}
            fill="none"
            stroke={lit ? toneColor : C.sub}
            strokeWidth={lit ? 1.8 : 1}
            strokeDasharray={c.kind === 'transfers' ? '1 3' : undefined}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={dim(lit)}
            markerEnd={lit ? (toneColor === C.warn ? 'url(#arrow-warn)' : 'url(#arrow-accent)') : 'url(#arrow-faint)'}
          />
        )
      })}
    </g>
  )
}

function CallRoute(p: {
  from: string
  to: string
  open: (id: string) => number
  zPlane: number
  zTop: (pocket: string) => number
  color: string
  warn: boolean
  index: number
}) {
  const end = (id: string, outward: boolean): P3[] => {
    const prog = PROGRAM[id]
    const pg = LAYOUT.pockets[prog.pocket]
    const g = pg.programs.find((x) => x.id === id)!
    const o = p.open(prog.pocket)
    const u = o > 0.5 ? g.cx + 0.3 : (pg.x0 + pg.x1) / 2 + 0.3 + p.index * 0.12
    const face = o > 0.5 ? pg.y(g.v - G.BLOCK / 2) : pg.frontY
    const z = o > 0.5 ? p.zTop(prog.pocket) + 0.5 : p.zPlane
    const pts: P3[] = [
      [u, face, z],
      [u, pg.frontY, z],
      [u, pg.frontY, 0],
      [u, LAYOUT.ctrlY + p.index * 0.08, 0],
    ]
    return outward ? pts : pts.reverse()
  }
  const a = end(p.from, true)
  const b = end(p.to, false)
  return (
    <path
      d={path([...a, ...b])}
      fill="none"
      stroke={p.color}
      strokeWidth={1.8}
      strokeDasharray="7 5"
      strokeLinejoin="round"
      className="trace-flow"
      vectorEffect="non-scaling-stroke"
      markerEnd={p.warn ? 'url(#arrow-warn)' : 'url(#arrow-accent)'}
    />
  )
}

/* a flag on a stalk, drawn in screen pixels so it reads at any zoom */
function Pin({ x, y, z, n, onOpen }: { x: number; y: number; z: number; n: number; onOpen?: () => void }) {
  const base = proj(x, y, z)
  const h = 34
  const r = 7
  const click = onOpen
    ? { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onClick: (e: React.MouseEvent) => { e.stopPropagation(); onOpen() }, style: { cursor: 'pointer' } }
    : {}
  return (
    <g transform={`translate(${base.X} ${base.Y})`} pointerEvents={onOpen ? 'auto' : 'none'} {...click}>
      <g style={{ transform: 'scale(clamp(0.65, calc(1 / var(--k)), 1.76))' }}>
        <title>{`${n} question${n > 1 ? 's' : ''} waiting · click to open`}</title>
        <line x1={0} y1={0} x2={0} y2={-h} stroke={C.warn} strokeWidth={1.2} />
        {onOpen && <circle cx={0} cy={-h} r={r * 1.9} fill={C.warn} opacity={0.14} />}
        <polygon points={`0,${-h - r} ${r},${-h} 0,${-h + r} ${-r},${-h}`} fill={C.warn} />
        <text x={0} y={-h + 0.5} fontFamily={MONO} fontSize={r * 1.15} fontWeight={700} fill={C.dark} textAnchor="middle" dominantBaseline="middle">
          {n}
        </text>
      </g>
    </g>
  )
}

/* Text that faces the viewer at a fixed screen size, pinned to a point on the
 * map. Used for the names you navigate by; floor-engraved text is kept for faint
 * background labels. A dark halo keeps it readable over wires and colored faces. */
type BillboardLine = { text: string; size?: number; weight?: number; color?: string }
function Billboard({ at, lines, opacity = 1 }: { at: { X: number; Y: number }; lines: BillboardLine[]; opacity?: number }) {
  const lh = 14.5
  if (!lines.length || opacity < 0.02) return null
  return (
    <g transform={`translate(${at.X} ${at.Y})`} pointerEvents="none" opacity={opacity}>
      <g style={UNZOOM}>
        <text fontFamily={MONO} textAnchor="middle" dominantBaseline="middle" stroke="#000" strokeWidth={3.2} strokeOpacity={0.75} strokeLinejoin="round" paintOrder="stroke">
          {lines.map((l, i) => (
            <tspan key={i} x={0} y={(i - (lines.length - 1) / 2) * lh} fontSize={l.size ?? 11.5} fontWeight={l.weight ?? 400} fill={l.color ?? C.ink}>
              {l.text}
            </tspan>
          ))}
        </text>
      </g>
    </g>
  )
}

/* What part of a name fits in `px` of screen width: the full title (one or two
 * lines), else the short name, else nothing. */
function fitName(title: string, short: string, px: number, size = 11.5): string[] {
  const chars = Math.floor(px / (size * MONO_W))
  if (chars < 4) return []
  if (title.length <= chars) return [title]
  const lines = wrap(title, chars)
  if (lines.length <= 2 && lines.every((l) => l.length <= chars)) return lines
  return [short]
}

/* ------------------------------ mini-map ------------------------------ */
/* The whole board, its pockets, and the part you are looking at. Moved straight
 * from the camera (no React render); fades in once you zoom past the overview. */

const MINI_W = 196
const MINI_PAD = 14
const MINI = (() => {
  const b = LAYOUT.bounds
  const s = screenBounds(b.x0, b.x1, b.y0, b.y1, 0)
  const vb = { x: s.x0 - MINI_PAD, y: s.y0 - MINI_PAD, w: s.x1 - s.x0 + MINI_PAD * 2, h: s.y1 - s.y0 + MINI_PAD * 2 }
  return { vb, h: Math.round((MINI_W * vb.h) / vb.w) }
})()

function updateMinimap(c: Cam, v: { w: number; h: number; inset: number; homeK: number }, wrapEl: HTMLDivElement | null, rectEl: SVGRectElement | null) {
  if (wrapEl) {
    const show = c.k > v.homeK * 1.35
    wrapEl.style.opacity = show ? '1' : '0'
    wrapEl.style.pointerEvents = show ? 'auto' : 'none'
  }
  if (rectEl) {
    rectEl.setAttribute('x', String(-c.x / c.k))
    rectEl.setAttribute('y', String(-c.y / c.k))
    rectEl.setAttribute('width', String(Math.max(0, v.w - v.inset) / c.k))
    rectEl.setAttribute('height', String(v.h / c.k))
  }
}

function Minimap({
  wrapRef,
  viewRef,
  focus,
  hl,
  toneColor,
  onCenter,
}: {
  wrapRef: React.RefObject<HTMLDivElement | null>
  viewRef: React.RefObject<SVGRectElement | null>
  focus: string | null
  hl: Highlight | null
  toneColor: string
  onCenter: (X: number, Y: number) => void
}) {
  const b = LAYOUT.bounds
  const dragging = useRef(false)
  const toMap = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onCenter(MINI.vb.x + ((e.clientX - r.left) / r.width) * MINI.vb.w, MINI.vb.y + ((e.clientY - r.top) / r.height) * MINI.vb.h)
  }
  return (
    <div ref={wrapRef} className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-bg-2)] p-1 transition-opacity duration-200" style={{ opacity: 0, pointerEvents: 'none' }}>
      <svg
        width={MINI_W}
        height={MINI.h}
        viewBox={`${MINI.vb.x} ${MINI.vb.y} ${MINI.vb.w} ${MINI.vb.h}`}
        className="block cursor-crosshair touch-none"
        role="img"
        aria-label="Mini-map. Click or drag to move the view."
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          toMap(e)
        }}
        onPointerMove={(e) => dragging.current && toMap(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <polygon points={rect(b.x0, b.x1, b.y0, b.y1)} fill="#0b0b0e" stroke={C.dieEdge} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {LAYOUT.laneOrder.map((s) => {
          const lane = LAYOUT.lanes[s]
          const lit = !!hl?.stores.has(s)
          return <path key={s} d={path([[G.REG_X0, lane.y, 0], [lane.x1, lane.y, 0]])} stroke={lit ? toneColor : C.copper} strokeOpacity={lit ? 1 : 0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        })}
        {LAYOUT.order.map((id) => {
          const pg = LAYOUT.pockets[id]
          const lit = !!hl?.pockets.has(id)
          const on = id === focus
          return (
            <polygon
              key={id}
              points={rect(pg.x0, pg.x1, pg.y0, pg.y1)}
              fill={on ? C.accent : lit ? toneColor : '#2a2f37'}
              fillOpacity={on ? 0.55 : lit ? 0.4 : 1}
              stroke={on ? C.accent : 'none'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
        <rect ref={viewRef} fill="rgba(237,238,241,0.06)" stroke={C.ink} strokeWidth={1.2} vectorEffect="non-scaling-stroke" rx={2} />
      </svg>
    </div>
  )
}
