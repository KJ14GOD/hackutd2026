/* The die floorplan. Pure and deterministic: same graph in, same layout out.
 *
 *   top row of pockets   (title plate faces the bus)
 *   ── bus: one lane per shared data store, register at the left end ──
 *   bottom row of pockets
 *
 * Inside a pocket, programs sit in two staggered rows so every program's
 * traces leave through a clear gap: towards the bus for shared stores, away
 * from it for the pocket's local stores. */
import {
  BUS_ORDER,
  ENTRIES,
  POCKETS,
  PROGRAM,
  STORE,
  ioOf,
  localStoresOfPocket,
  sharedStoresOfPocket,
  type IoMode,
} from '@/data/carddemo'

export const G = {
  PITCH: 1.45,
  BLOCK: 0.95,
  PADX: 0.45,
  GAP: 0.9,
  DGAP: 1.8,
  V: 4.45,
  MINW: 3.6,
  TITLE: 1.3,
  LANE0: 1.6,
  LANE_STEP: 1.3,
  LANE_CLEAR: 1.6,
  REG_X0: -5.6,
  REG_X1: -0.9,
  REG_HALF: 0.4,
  REG_H: 0.42,
  SLAB_H: 0.22,
  TILE_W: 1.05,
  TILE_D: 0.55,
  TILE_SP: 1.5,
  LOCAL_DEPTH: 2.5,
  TAP_SP: 0.1,
}

export interface ProgGeo {
  id: string
  pocket: string
  cx: number
  cy: number
  v: number
  front: boolean
  h: number
  entries: string[]
}
export interface TileGeo { store: string; cx: number; cy: number; v: number; chanV: number }
export interface PocketGeo {
  id: string
  row: 0 | 1
  dir: 1 | -1
  frontY: number
  x0: number
  x1: number
  y0: number
  y1: number
  /** overview block height, world units */
  h: number
  programs: ProgGeo[]
  tiles: TileGeo[]
  shared: string[]
  locals: string[]
  title: [number, number]
  corridorV: number
  y: (v: number) => number
}
export interface LaneGeo { store: string; y: number; x1: number; users: number }
export interface DomainGeo { id: string; row: 0 | 1; x0: number; x1: number; y0: number; y1: number }

/** a bus tap or local trace, as plan-view waypoints; z is decided at render */
export interface TraceGeo {
  id: string
  pocket: string
  program?: string
  store: string
  mode: IoMode
  /** waypoints on the slab (z = slab top), then the edge, then the floor */
  slab: [number, number][]
  floor: [number, number][]
  weight: number
}

export interface Layout {
  pockets: Record<string, PocketGeo>
  order: string[]
  lanes: Record<string, LaneGeo>
  laneOrder: string[]
  domains: DomainGeo[]
  progTaps: TraceGeo[]
  pocketTaps: TraceGeo[]
  progLocals: TraceGeo[]
  pocketLocals: TraceGeo[]
  ctrlY: number
  yBottom: number
  bounds: { x0: number; x1: number; y0: number; y1: number }
}

function modeOf(modes: IoMode[]): IoMode {
  const r = modes.some((m) => m !== 'write')
  const w = modes.some((m) => m !== 'read')
  return r && w ? 'readwrite' : w ? 'write' : 'read'
}

function spread(n: number, step: number) {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step)
}

export function buildLayout(): Layout {
  const laneOrder = BUS_ORDER
  const laneY = Object.fromEntries(laneOrder.map((s, i) => [s, G.LANE0 + i * G.LANE_STEP]))
  const yBottom = G.LANE0 + (laneOrder.length - 1) * G.LANE_STEP + G.LANE_CLEAR

  /* widths first, so the shorter row can be centered */
  const widthOf = (n: number) => {
    const cols = Math.ceil(n / 2)
    const gw = (cols - 1) * G.PITCH + G.BLOCK + (n > 1 ? G.PITCH / 2 : 0)
    return { gw, w: Math.max(G.MINW, gw + 2 * G.PADX) }
  }
  const rows: [typeof POCKETS, typeof POCKETS] = [POCKETS.filter((p) => p.row === 0), POCKETS.filter((p) => p.row === 1)]
  const rowWidth = (ps: typeof POCKETS) =>
    ps.reduce((a, p, i) => a + widthOf(p.programs.length).w + (i ? (ps[i - 1].domain !== p.domain ? G.DGAP : G.GAP) : 0), 0)
  const widths = rows.map(rowWidth)
  const maxW = Math.max(...widths)

  const pockets: Record<string, PocketGeo> = {}
  const order: string[] = []
  const maxLoc = Math.max(...POCKETS.map((p) => p.loc))

  rows.forEach((ps, row) => {
    let cursor = 0.4 + (maxW - widths[row]) / 2
    const dir = row === 0 ? -1 : 1
    const frontY = row === 0 ? 0 : yBottom
    const y = (v: number) => frontY + dir * v
    ps.forEach((p, i) => {
      if (i) cursor += ps[i - 1].domain !== p.domain ? G.DGAP : G.GAP
      const { gw, w } = widthOf(p.programs.length)
      const x0 = cursor
      const x1 = cursor + w
      cursor = x1
      const u0 = x0 + (w - gw) / 2
      const vFront = row === 0 ? G.TITLE + 0.3 + G.BLOCK / 2 : 0.35 + G.BLOCK / 2
      const vBack = vFront + G.PITCH
      const programs: ProgGeo[] = p.programs.map((id, k) => {
        const front = k % 2 === 0
        const col = Math.floor(k / 2)
        const cx = u0 + col * G.PITCH + (front ? 0 : G.PITCH / 2) + G.BLOCK / 2
        const v = front ? vFront : vBack
        const loc = PROGRAM[id].loc
        return {
          id,
          pocket: p.id,
          cx,
          cy: y(v),
          v,
          front,
          h: 0.45 + 1.25 * Math.sqrt(loc / 4236),
          entries: ENTRIES.filter((e) => e.program === id).map((e) => e.id),
        }
      })

      /* local stores: two staggered rows of tiles beyond the outer edge */
      const locals = localStoresOfPocket(p.id)
      const meanU = (s: string) => {
        const us = programs.filter((g) => ioOf(g.id).some((r) => r.store === s)).map((g) => g.cx)
        return us.reduce((a, b) => a + b, 0) / Math.max(1, us.length)
      }
      const cols = Math.ceil(locals.length / 2)
      const gridW = (cols - 1) * G.TILE_SP + G.TILE_W + (locals.length > cols ? G.TILE_SP / 2 : 0)
      const start = (x0 + x1) / 2 - gridW / 2
      const slots = locals
        .map((_, i) => {
          const second = i >= cols
          const c = second ? i - cols : i
          return { cx: start + c * G.TILE_SP + (second ? G.TILE_SP / 2 : 0) + G.TILE_W / 2, v: G.V + (second ? 2.0 : 1.15) }
        })
        .sort((a, b) => a.cx - b.cx)
      const sortedLocals = [...locals].sort((a, b) => meanU(a) - meanU(b))
      const tiles: TileGeo[] = sortedLocals.map((store, i) => ({
        store,
        cx: slots[i].cx,
        v: slots[i].v,
        cy: y(slots[i].v),
        chanV: G.V + 0.22 + i * 0.11,
      }))

      pockets[p.id] = {
        id: p.id,
        row: row as 0 | 1,
        dir: dir as 1 | -1,
        frontY,
        x0,
        x1,
        y0: Math.min(y(0), y(G.V)),
        y1: Math.max(y(0), y(G.V)),
        h: 0.55 + 1.15 * Math.sqrt(p.loc / maxLoc),
        programs,
        tiles,
        shared: sharedStoresOfPocket(p.id).sort((a, b) => laneOrder.indexOf(a) - laneOrder.indexOf(b)),
        locals,
        title: row === 0 ? [0, G.TITLE] : [G.V - G.TITLE, G.V],
        corridorV: (vFront + vBack) / 2,
        y,
      }
      order.push(p.id)
    })
  })

  /* traces */
  const progTaps: TraceGeo[] = []
  const pocketTaps: TraceGeo[] = []
  const progLocals: TraceGeo[] = []
  const pocketLocals: TraceGeo[] = []

  for (const id of order) {
    const pg = pockets[id]
    // pocket-level taps: one per shared store, spread along the bus edge
    const us = spread(pg.shared.length, (pg.x1 - pg.x0) / (pg.shared.length + 1))
    pg.shared.forEach((s, i) => {
      const progs = pg.programs.filter((g) => ioOf(g.id).some((r) => r.store === s))
      const u = (pg.x0 + pg.x1) / 2 + us[i]
      pocketTaps.push({
        id: `ptap:${id}:${s}`,
        pocket: id,
        store: s,
        mode: modeOf(progs.flatMap((g) => ioOf(g.id).filter((r) => r.store === s).map((r) => r.mode))),
        slab: [],
        floor: [
          [u, pg.frontY],
          [u, laneY[s]],
        ],
        weight: progs.length,
      })
    })
    pg.tiles.forEach((t) => {
      const progs = pg.programs.filter((g) => ioOf(g.id).some((r) => r.store === t.store))
      pocketLocals.push({
        id: `plocal:${id}:${t.store}`,
        pocket: id,
        store: t.store,
        mode: modeOf(progs.flatMap((g) => ioOf(g.id).filter((r) => r.store === t.store).map((r) => r.mode))),
        slab: [],
        floor: [
          [t.cx, pg.y(G.V)],
          [t.cx, pg.y(t.v - G.TILE_D / 2)],
        ],
        weight: progs.length,
      })
    })

    // program-level traces
    for (const g of pg.programs) {
      const io = ioOf(g.id)
      const toBus = io.filter((r) => STORE[r.store].shared).sort((a, b) => laneOrder.indexOf(a.store) - laneOrder.indexOf(b.store))
      const offs = spread(toBus.length, G.TAP_SP)
      toBus.forEach((r, i) => {
        const u = g.cx + offs[i]
        progTaps.push({
          id: `io:${g.id}:${r.store}`,
          pocket: id,
          program: g.id,
          store: r.store,
          mode: r.mode,
          slab: [
            [u, pg.y(g.v - G.BLOCK / 2)],
            [u, pg.frontY],
          ],
          floor: [
            [u, pg.frontY],
            [u, laneY[r.store]],
          ],
          weight: 1,
        })
      })
      const toLocal = io.filter((r) => !STORE[r.store].shared)
      const loffs = spread(toLocal.length, 0.12)
      toLocal.forEach((r, i) => {
        const t = pg.tiles.find((x) => x.store === r.store)!
        const u = g.cx + loffs[i]
        progLocals.push({
          id: `io:${g.id}:${r.store}`,
          pocket: id,
          program: g.id,
          store: r.store,
          mode: r.mode,
          slab: [
            [u, pg.y(g.v + G.BLOCK / 2)],
            [u, pg.y(G.V)],
          ],
          floor: [
            [u, pg.y(G.V)],
            [u, pg.y(t.chanV)],
            [t.cx, pg.y(t.chanV)],
            [t.cx, pg.y(t.v - G.TILE_D / 2)],
          ],
          weight: 1,
        })
      })
    }
  }

  const lanes: Record<string, LaneGeo> = {}
  for (const s of laneOrder) {
    const xs = [...progTaps, ...pocketTaps].filter((t) => t.store === s).map((t) => t.floor[0][0])
    lanes[s] = {
      store: s,
      y: laneY[s],
      x1: Math.max(...xs) + 0.5,
      users: new Set([...pocketTaps].filter((t) => t.store === s).map((t) => t.pocket)).size,
    }
  }

  /* domain regions: consecutive pockets of one domain in a row */
  const domains: DomainGeo[] = []
  for (const row of [0, 1] as const) {
    const ids = order.filter((id) => pockets[id].row === row)
    let start = 0
    for (let i = 1; i <= ids.length; i++) {
      const prev = POCKETS.find((p) => p.id === ids[i - 1])!
      const cur = i < ids.length ? POCKETS.find((p) => p.id === ids[i])! : null
      if (cur && cur.domain === prev.domain) continue
      const group = ids.slice(start, i).map((id) => pockets[id])
      const frontY = group[0].frontY
      const outer = frontY + group[0].dir * (G.V + G.LOCAL_DEPTH + 0.4)
      domains.push({
        id: prev.domain,
        row,
        x0: Math.min(...group.map((g) => g.x0)) - 0.4,
        x1: Math.max(...group.map((g) => g.x1)) + 0.4,
        y0: Math.min(frontY - group[0].dir * 0.35, outer),
        y1: Math.max(frontY - group[0].dir * 0.35, outer),
      })
      start = i
    }
  }

  const xMax = Math.max(...order.map((id) => pockets[id].x1), ...Object.values(lanes).map((l) => l.x1))
  return {
    pockets,
    order,
    lanes,
    laneOrder,
    domains,
    progTaps,
    pocketTaps,
    progLocals,
    pocketLocals,
    ctrlY: (laneY[laneOrder[2]] + laneY[laneOrder[3]]) / 2,
    yBottom,
    bounds: {
      x0: G.REG_X0 - 0.6,
      x1: xMax + 0.6,
      y0: Math.min(...domains.map((d) => d.y0)) - 0.2,
      y1: Math.max(...domains.map((d) => d.y1)) + 0.2,
    },
  }
}

export const LAYOUT = buildLayout()
