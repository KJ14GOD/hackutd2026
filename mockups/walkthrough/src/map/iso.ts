// Ported from web/src/components/map (branch dhruv-aadit); same code, local imports, no Tailwind.
/* Isometric projection and SVG helpers. Pure.
 *
 * World: x runs down-right on screen, y runs down-left, z is height in screen
 * pixels. Everything on the map is built from these few functions. */

export const TW = 64 // screen px per world unit, horizontally (2:1 iso)
export const TH = 32
export const ZS = 30 // screen px per world unit of height

export type P3 = readonly [number, number, number]

export function proj(x: number, y: number, z = 0) {
  return { X: (x - y) * (TW / 2), Y: (x + y) * (TH / 2) - z }
}

const f = (n: number) => (Math.round(n * 10) / 10).toString()

export function path(points: readonly P3[]): string {
  let d = ''
  points.forEach(([x, y, z], i) => {
    const { X, Y } = proj(x, y, z)
    d += `${i ? 'L' : 'M'}${f(X)} ${f(Y)}`
  })
  return d
}

export function poly(points: readonly P3[]): string {
  return points
    .map(([x, y, z]) => {
      const { X, Y } = proj(x, y, z)
      return `${f(X)},${f(Y)}`
    })
    .join(' ')
}

/** faces of an axis-aligned box; only the three visible ones */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  return {
    top: poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]),
    right: poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]), // +x face
    left: poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]), // +y face
  }
}

export function rect(x0: number, x1: number, y0: number, y1: number, z = 0) {
  return poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]])
}

/** transform that lays text flat on the floor, reading along +x */
export function floorText(x: number, y: number, z = 0) {
  const { X, Y } = proj(x, y, z)
  return `matrix(0.894 0.447 -0.894 0.447 ${f(X)} ${f(Y)})`
}

/** length of one world unit along the x axis, in screen px (before camera) */
export const UNIT_X = Math.hypot(TW / 2, TH / 2)

export function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`
}

export function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** split a label into lines of at most `max` characters, on word boundaries */
export function wrap(text: string, max: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length > max && cur) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}
