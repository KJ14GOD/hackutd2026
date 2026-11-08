import { useMemo, useRef, useState } from 'react'

/* Architecture — groma.md-style C4 blueprint. Dark, monospace, nested
 * System → Container → Component boxes with thin orthogonal wires.
 * Views: 2D (flat C4) and Iso (CSS isometric of the same layout). */

// ---- palette (dark blueprint) ----
const C = {
  bg: '#0a0a0b',
  line: 'rgba(255,255,255,0.22)',
  lineStrong: 'rgba(255,255,255,0.5)',
  wire: 'rgba(255,255,255,0.16)',
  wireHot: 'rgba(255,255,255,0.75)',
  ink: '#e8e8ea',
  sub: 'rgba(255,255,255,0.55)',
  faint: 'rgba(255,255,255,0.32)',
  chip: 'rgba(255,255,255,0.04)',
  chipTop: 'rgba(255,255,255,0.4)',
  hot: '#D97757', // sparing accent (groma uses warm orange)
}
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

// ---- data (CardDemo as C4) ----
type Container = { id: string; title: string; x: number; y: number; w: number; h: number; comps: string[] }
const CONTAINERS: Container[] = [
  { id: 'tx', title: 'Transaction posting', x: 300, y: 96, w: 300, h: 150, comps: ['CBTRN01C', 'CBTRN02C', 'CBTRN03C'] },
  { id: 'ac', title: 'Accounts', x: 628, y: 96, w: 300, h: 150, comps: ['CBACT01C', 'CBACT02C', 'CBACT04C'] },
  { id: 'st', title: 'Statements', x: 956, y: 96, w: 250, h: 150, comps: ['CBSTM03A', 'CBSTM03B'] },
  { id: 'cu', title: 'Customers', x: 300, y: 280, w: 300, h: 128, comps: ['CBCUS01C', 'COCRDUPC'] },
  { id: 'se', title: 'Security and sign-on', x: 628, y: 280, w: 300, h: 128, comps: ['COSGN00C', 'COUSR01C'] },
  { id: 'sh', title: 'Shared utilities', x: 956, y: 280, w: 250, h: 128, comps: ['CBUTIL01'] },
  { id: 'data', title: 'Shared data', x: 300, y: 446, w: 906, h: 120, comps: ['DALYTRAN', 'CARDXREF', 'DALYREJS', 'TRANSACT', 'ACCTDATA', 'TCATBAL', 'CARDDATA', 'CUSTDATA', 'STMTFILE', 'USRSEC'] },
]
const EDGES: [string, string, string][] = [
  ['CBTRN01C', 'CBUTIL01', 'c'], ['CBTRN01C', 'DALYTRAN', 'r'], ['CBTRN01C', 'CARDXREF', 'r'],
  ['CBTRN02C', 'CBUTIL01', 'c'], ['CBTRN02C', 'DALYTRAN', 'r'], ['CBTRN02C', 'ACCTDATA', 'w'], ['CBTRN02C', 'TRANSACT', 'w'], ['CBTRN02C', 'DALYREJS', 'w'],
  ['CBTRN03C', 'TRANSACT', 'r'], ['CBACT01C', 'ACCTDATA', 'r'], ['CBACT02C', 'CARDDATA', 'r'],
  ['CBACT04C', 'CBUTIL01', 'c'], ['CBACT04C', 'ACCTDATA', 'r'], ['CBACT04C', 'TCATBAL', 'r'], ['CBACT04C', 'ACCTDATA', 'w'], ['CBACT04C', 'TRANSACT', 'w'],
  ['CBCUS01C', 'CUSTDATA', 'r'], ['COCRDUPC', 'CBUTIL01', 'c'], ['COCRDUPC', 'CARDDATA', 'r'], ['COCRDUPC', 'CUSTDATA', 'r'], ['COCRDUPC', 'CARDDATA', 'w'],
  ['CBSTM03A', 'CBSTM03B', 'c'], ['CBSTM03A', 'ACCTDATA', 'r'], ['CBSTM03A', 'CUSTDATA', 'r'], ['CBSTM03A', 'TRANSACT', 'r'], ['CBSTM03A', 'STMTFILE', 'w'],
  ['CBSTM03B', 'TRANSACT', 'r'], ['COSGN00C', 'COUSR01C', 'c'], ['COSGN00C', 'USRSEC', 'r'], ['COUSR01C', 'USRSEC', 'r'], ['COUSR01C', 'USRSEC', 'w'],
]
const ACTORS = ['Developer', 'Coding agent']
const EXTERNALS = ['Batch scheduler', 'Card network', 'Statement printer']

const SYS = { x: 272, y: 56, w: 962, h: 540 }

// ---- chip layout within containers ----
type Chip = { id: string; x: number; y: number; w: number; h: number; cx: number; cy: number }
function layoutChips(c: Container): Chip[] {
  const n = c.comps.length
  const cols = c.id === 'data' ? n : n <= 1 ? 1 : n <= 4 ? 3 : 3
  const padX = 16, padTop = 18, padBot = 30, gap = 10
  const innerW = c.w - padX * 2
  const cw = Math.floor((innerW - gap * (cols - 1)) / cols)
  const ch = 32
  const rows = Math.ceil(n / cols)
  const innerH = c.h - padTop - padBot
  const vgap = rows > 1 ? Math.min(gap, (innerH - ch * rows) / (rows - 1)) : 0
  return c.comps.map((id, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    const x = c.x + padX + col * (cw + gap)
    const y = c.y + padTop + row * (ch + vgap)
    return { id, x, y, w: cw, h: ch, cx: x + cw / 2, cy: y + ch / 2 }
  })
}

type View = '2d' | 'iso' | 'layers'

export default function GraphScreen() {
  const [view, setView] = useState<View>('2d')
  const [selArr, setSelArr] = useState<string[]>(['CBTRN02C'])
  const selSet = useMemo(() => new Set(selArr), [selArr])
  const toggle = (id: string) => setSelArr((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))
  const [px, setPx] = useState(0)
  const [py, setPy] = useState(0)
  const [zoom, setZoom] = useState(0.92)
  const pan = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const [panning, setPanning] = useState(false)

  const chips = useMemo(() => {
    const m: Record<string, Chip> = {}
    for (const c of CONTAINERS) for (const ch of layoutChips(c)) m[ch.id] = ch
    return m
  }, [])

  // every selected node + its neighbors (the "hot" highlight). Multi-select:
  // select 2+ components and all wires touching any of them light up.
  const hot = useMemo(() => {
    const s = new Set<string>()
    for (const id of selArr) {
      s.add(id)
      for (const [a, b] of EDGES) {
        if (a === id) s.add(b)
        if (b === id) s.add(a)
      }
    }
    return s
  }, [selArr])

  const connCount = useMemo(
    () => EDGES.filter(([a, b]) => selSet.has(a) || selSet.has(b)).length,
    [selSet],
  )

  const wirePath = (a: Chip, b: Chip) => {
    const mx = Math.round((a.cx + b.cx) / 2)
    return `M${a.cx},${a.cy} L${mx},${a.cy} L${mx},${b.cy} L${b.cx},${b.cy}`
  }

  const setZ = (z: number) => setZoom(Math.max(0.5, Math.min(1.8, Math.round(z * 100) / 100)))
  const fit = () => { setZoom(0.92); setPx(0); setPy(0) }

  const bgDown = (e: React.PointerEvent) => { pan.current = { sx: e.clientX, sy: e.clientY, ox: px, oy: py, moved: false } }
  const move = (e: React.PointerEvent) => {
    const d = pan.current; if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    d.moved = true; setPanning(true); setPx(d.ox + dx); setPy(d.oy + dy)
  }
  const up = () => { const d = pan.current; pan.current = null; setPanning(false); if (d && !d.moved) setSelArr([]) }

  const layerTransform = view === 'iso'
    ? `translate(${px}px, ${py}px) scale(${zoom}) rotateX(55deg) rotateZ(-45deg)`
    : `translate(${px}px, ${py}px) scale(${zoom})`

  const Toggle = ({ v, label }: { v: View; label: string }) => (
    <button
      onClick={() => setView(v)}
      aria-pressed={view === v}
      style={{ height: 30, padding: '0 14px', border: 'none', borderRadius: 999, background: view === v ? 'rgba(255,255,255,0.12)' : 'transparent', color: view === v ? C.ink : C.sub, fontSize: 12, fontFamily: MONO, cursor: 'pointer' }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, color: C.ink, fontFamily: MONO, borderRadius: 16, overflow: 'hidden' }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 18px', borderBottom: `1px solid ${C.line}` }}>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em' }}>CARDDEMO</span>
        <span style={{ fontSize: 11, color: C.faint, letterSpacing: '0.08em' }}>
          1 SYSTEM · 6 CONTAINERS · 13 COMPONENTS · scanned with groma.md
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: 3, borderRadius: 999, background: 'rgba(255,255,255,0.05)' }}>
          <Toggle v="iso" label="⬡ Iso" />
          <Toggle v="2d" label="▦ 2D" />
          <Toggle v="layers" label="☰ Layers" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 3, borderRadius: 8, background: 'rgba(255,255,255,0.05)', fontSize: 12 }}>
          <button onClick={fit} style={btn()}>⤢ FIT</button>
          <button onClick={() => setZ(zoom - 0.1)} style={btn()}>−</button>
          <span style={{ minWidth: 42, textAlign: 'center', color: C.sub }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZ(zoom + 0.1)} style={btn()}>+</button>
        </div>
      </div>

      {/* canvas */}
      <div
        onPointerDown={bgDown}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{ position: 'relative', flex: 1, overflow: 'hidden', cursor: panning ? 'grabbing' : 'grab', perspective: 1400, background: `radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)`, backgroundSize: '24px 24px' }}
      >
        <div style={{ position: 'absolute', left: '50%', top: 40, width: 1, height: 1, transform: `translateX(-50%) ${layerTransform}`, transformStyle: 'preserve-3d', transformOrigin: 'center top' }}>
          {view === 'layers' ? (
            <LayersView selSet={selSet} onSel={toggle} hot={hot} />
          ) : (
            <>
              {/* system boundary */}
              <Box x={SYS.x - 260} y={SYS.y} w={SYS.w + 300} h={SYS.h} title="GROMA · CardDemo system" strong />

              {/* actors */}
              <Cluster x={SYS.x - 236} y={210} w={150} h={150} title="ACTORS" items={ACTORS} />
              {/* externals */}
              <Cluster x={SYS.x + SYS.w + 24} y={190} w={168} h={190} title="EXTERNAL SYSTEMS" items={EXTERNALS} />

              {/* containers */}
              {CONTAINERS.map((c) => (
                <Box key={c.id} x={c.x} y={c.y} w={c.w} h={c.h} title={c.title} />
              ))}

              {/* wires */}
              <svg width="1" height="1" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} aria-hidden>
                {EDGES.map(([a, b, k], i) => {
                  const ca = chips[a], cb = chips[b]
                  if (!ca || !cb) return null
                  const isHot = selSet.has(a) || selSet.has(b)
                  return (
                    <path key={i} d={wirePath(ca, cb)} fill="none" stroke={isHot ? C.wireHot : C.wire} strokeWidth={isHot ? 1.4 : 1} strokeDasharray={k === 'w' ? '4 4' : undefined} opacity={selSet.size && !isHot ? 0.4 : 1} />
                  )
                })}
              </svg>

              {/* component chips */}
              {CONTAINERS.flatMap((c) => layoutChips(c).map((ch) => (
                <ComponentChip key={ch.id} ch={ch} sel={selSet.has(ch.id)} hot={hot.has(ch.id)} dim={selSet.size > 0 && !hot.has(ch.id)} onClick={() => toggle(ch.id)} />
              )))}
            </>
          )}
        </div>

        {/* legend */}
        <div style={{ position: 'absolute', left: 16, bottom: 14, display: 'flex', gap: 16, fontSize: 10, color: C.faint, letterSpacing: '0.08em' }}>
          <span>● ACTOR</span><span>■ SYSTEM</span><span>▱ CONTAINER</span><span>■ COMPONENT</span>
          <span style={{ marginLeft: 8 }}>solid · calls/reads</span><span>dashed · writes</span>
        </div>

        {/* selection readout */}
        <div style={{ position: 'absolute', right: 16, bottom: 14, fontSize: 10, color: C.sub, letterSpacing: '0.04em', textAlign: 'right' }}>
          {selArr.length === 0
            ? 'click components to connect · click canvas to clear'
            : `selected ${selArr.length} · ${connCount} connection${connCount === 1 ? '' : 's'} · click more to add`}
        </div>
      </div>
    </div>
  )
}

function btn(): React.CSSProperties {
  return { height: 26, padding: '0 8px', border: 'none', borderRadius: 6, background: 'transparent', color: C.ink, fontSize: 12, fontFamily: MONO, cursor: 'pointer' }
}

function Box({ x, y, w, h, title, strong }: { x: number; y: number; w: number; h: number; title: string; strong?: boolean }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, border: `1px solid ${strong ? C.lineStrong : C.line}`, borderRadius: 2, boxSizing: 'border-box' }}>
      <span style={{ position: 'absolute', left: 0, right: 0, bottom: 6, textAlign: 'center', fontSize: strong ? 12 : 11, letterSpacing: '0.06em', color: strong ? C.sub : C.faint }}>
        {title}
      </span>
    </div>
  )
}

function Cluster({ x, y, w, h, title, items }: { x: number; y: number; w: number; h: number; title: string; items: string[] }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, border: `1px solid ${C.line}`, borderRadius: 2, boxSizing: 'border-box', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 9, letterSpacing: '0.1em', color: C.faint }}>{title}</span>
      {items.map((it) => (
        <div key={it} style={{ border: `1px solid ${C.line}`, borderRadius: 2, padding: '4px 6px', fontSize: 10, color: C.sub }}>{it}</div>
      ))}
    </div>
  )
}

function ComponentChip({ ch, sel, hot, dim, onClick }: { ch: Chip; sel: boolean; hot: boolean; dim: boolean; onClick: () => void }) {
  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      aria-pressed={sel}
      aria-label={ch.id}
      style={{
        position: 'absolute', left: ch.x, top: ch.y, width: ch.w, height: ch.h, boxSizing: 'border-box',
        border: `1px solid ${sel ? C.hot : hot ? C.lineStrong : C.line}`, borderRadius: 2, background: C.chip,
        opacity: dim ? 0.4 : 1, cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: MONO,
      }}
    >
      <span style={{ height: 3, background: sel ? C.hot : C.chipTop, opacity: 0.8 }} />
      <span style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 9, color: sel ? C.hot : C.ink, letterSpacing: '0.02em' }}>{ch.id}</span>
    </button>
  )
}

/* Layers view — containers stacked as horizontal bands. */
function LayersView({ selSet, onSel, hot }: { selSet: Set<string>; onSel: (id: string) => void; hot: Set<string> }) {
  return (
    <div style={{ position: 'absolute', left: -480, top: 0, width: 960 }}>
      {CONTAINERS.map((c, i) => (
        <div key={c.id} style={{ border: `1px solid ${C.line}`, borderRadius: 2, margin: '0 0 14px', padding: '10px 14px 14px' }}>
          <div style={{ fontSize: 10, color: C.faint, letterSpacing: '0.08em', marginBottom: 8 }}>LAYER {i + 1} · {c.title}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {c.comps.map((id) => {
              const sgl = selSet.has(id)
              return (
                <button key={id} onPointerDown={(e) => e.stopPropagation()} onClick={() => onSel(id)} style={{ border: `1px solid ${sgl ? C.hot : hot.has(id) ? C.lineStrong : C.line}`, borderRadius: 2, background: C.chip, color: sgl ? C.hot : C.ink, padding: '6px 10px', fontSize: 10, fontFamily: MONO, cursor: 'pointer', opacity: selSet.size && !hot.has(id) ? 0.4 : 1 }}>
                  {id}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
