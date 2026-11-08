import { useMemo, useRef, useState } from 'react'

/* A pure isometric renderer: blocks + clean elbow edges, pan/zoom, multi-select.
 * Used at both zoom levels (segment clusters, then files within a cluster). */

export interface SceneItem {
  id: string
  wx: number
  wy: number
  foot: number // footprint in tiles
  height: number
  color: string
  label: string
  sub?: string
  metric?: string
  live?: boolean
}
export interface SceneEdge {
  from: string
  to: string
  weight?: number
}

const TW = 62, TH = 31

function iso(wx: number, wy: number, z = 0) {
  return { x: (wx - wy) * (TW / 2), y: (wx + wy) * (TH / 2) - z }
}
const p = (q: { x: number; y: number }) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`
function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${Math.round((n >> 16) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`
}

export function IsoScene({
  items,
  edges,
  selected,
  onItemClick,
  onBackground,
}: {
  items: SceneItem[]
  edges: SceneEdge[]
  selected: Set<string>
  onItemClick: (id: string) => void
  onBackground?: () => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null)

  const item = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items])

  const base = useMemo(() => {
    const xs: number[] = [], ys: number[] = []
    for (const it of items) {
      for (const [cx, cy] of [[it.wx, it.wy], [it.wx + it.foot, it.wy], [it.wx + it.foot, it.wy + it.foot], [it.wx, it.wy + it.foot]]) {
        const g = iso(cx, cy, 0), t = iso(cx, cy, it.height)
        xs.push(g.x, t.x); ys.push(g.y, t.y)
      }
    }
    const pad = 90
    const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad
    return { x: minX, y: minY, w: Math.max(...xs) + pad - minX, h: Math.max(...ys) + pad - minY }
  }, [items])

  const [vb, setVb] = useState<typeof base | null>(null)
  const view = vb ?? base

  const zoom = (f: number) => {
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2
    const w = Math.max(260, Math.min(3200, view.w * f))
    const h = (w / view.w) * view.h
    setVb({ x: cx - w / 2, y: cy - h / 2, w, h })
  }

  // hot edges (touch a selected item)
  const selHas = (id: string) => selected.has(id)
  const center = (it: SceneItem, z = it.height) => iso(it.wx + it.foot / 2, it.wy + it.foot / 2, z)
  const elbow = (a: SceneItem, b: SceneItem) => {
    const A = center(a), B = center(b)
    const corner = iso(b.wx + b.foot / 2, a.wy + a.foot / 2, Math.max(a.height, b.height))
    return `M${p(A)} L${p(corner)} L${p(B)}`
  }

  const ordered = [...items].sort((a, b) => a.wx + a.wy - (b.wx + b.wy))

  return (
    <svg
      ref={ref}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="h-full w-full touch-none select-none"
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false } }}
      onPointerMove={(e) => {
        const d = drag.current; if (!d || !ref.current) return
        const dx = e.clientX - d.x, dy = e.clientY - d.y
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
        d.moved = true
        const k = view.w / ref.current.clientWidth
        setVb({ ...view, x: d.vx - dx * k, y: d.vy - dy * k })
      }}
      onPointerUp={() => { const d = drag.current; drag.current = null; if (d && !d.moved) onBackground?.() }}
      onPointerLeave={() => { drag.current = null }}
      onWheel={(e) => zoom(e.deltaY > 0 ? 1.08 : 0.93)}
      style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
    >
      {/* cool edges (non-hot) under blocks */}
      {edges.map((e, i) => {
        const a = item[e.from], b = item[e.to]
        if (!a || !b) return null
        if (selected.size && (selHas(e.from) || selHas(e.to))) return null // drawn hot later
        return (
          <path key={`c${i}`} d={elbow(a, b)} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={Math.min(1 + (e.weight ?? 1) * 0.5, 3)} opacity={selected.size ? 0.3 : 0.7} />
        )
      })}

      {/* blocks */}
      {ordered.map((it) => {
        const h = it.height, F = it.foot
        const isSel = selHas(it.id), isHover = hover === it.id
        const dim = selected.size > 0 && !isSel && !edges.some((e) => (selHas(e.from) && e.to === it.id) || (selHas(e.to) && e.from === it.id))
        const A = iso(it.wx, it.wy, h), B = iso(it.wx + F, it.wy, h), C = iso(it.wx + F, it.wy + F, h), D = iso(it.wx, it.wy + F, h)
        const Bg = iso(it.wx + F, it.wy, 0), Cg = iso(it.wx + F, it.wy + F, 0), Dg = iso(it.wx, it.wy + F, 0)
        const topMid = { x: A.x + (C.x - A.x) / 2, y: A.y + (C.y - A.y) / 2 }
        return (
          <g
            key={it.id}
            opacity={dim ? 0.3 : 1}
            style={{ cursor: 'pointer' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onItemClick(it.id) }}
            onPointerEnter={() => setHover(it.id)}
            onPointerLeave={() => setHover(null)}
          >
            <polygon points={[B, C, Cg, Bg].map(p).join(' ')} fill={shade(it.color, 0.6)} />
            <polygon points={[D, C, Cg, Dg].map(p).join(' ')} fill={shade(it.color, 0.42)} />
            <polygon points={[A, B, C, D].map(p).join(' ')} fill={it.color} stroke={isSel ? '#fff' : isHover ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.35)'} strokeWidth={isSel ? 1.8 : 1} />
            {it.live && <polygon points={[A, B, C, D].map(p).join(' ')} fill="#9be23c" className="pulse-soft" opacity={0.22} />}
            {it.metric && (
              <text x={topMid.x} y={topMid.y + 3} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fontWeight={600} fill="#0a1400">{it.metric}</text>
            )}
            <text x={topMid.x} y={A.y - 8} textAnchor="middle" fontSize={it.sub ? 11 : 9.5} fontFamily="var(--font-mono)" fontWeight={it.sub ? 600 : 400} fill={isSel || isHover ? 'var(--color-ink)' : 'var(--color-muted)'}>{it.label}</text>
            {it.sub && <text x={topMid.x} y={A.y + 5} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill="var(--color-faint)">{it.sub}</text>}
          </g>
        )
      })}

      {/* hot edges on top */}
      {edges.map((e, i) => {
        const a = item[e.from], b = item[e.to]
        if (!a || !b) return null
        if (!(selected.size && (selHas(e.from) || selHas(e.to)))) return null
        return <path key={`h${i}`} d={elbow(a, b)} fill="none" stroke="#9be23c" strokeWidth={2} />
      })}
    </svg>
  )
}
