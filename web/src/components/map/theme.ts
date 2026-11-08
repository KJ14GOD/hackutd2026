/* Map palette ("dark silicon"). Hex only, so faces can be shaded in code.
 * Keep in step with the CSS tokens in src/index.css. */
import type { Migration } from '@/data/carddemo'

export const C = {
  bg: '#0B0D10',
  die: '#0E1115',
  dieEdge: '#1C2129',
  grid: '#161B22',
  plate: '#14181E',
  slab: '#191E25',
  slabEdge: '#2B323C',
  block: '#2A3039',
  ink: '#E6E8EB',
  sub: '#9AA3AE',
  faint: '#6B737E',
  copper: '#B08D57',
  copperHi: '#D4AE74',
  accent: '#4CC9F0',
  good: '#3FB68B',
  warn: '#D9A441',
  bad: '#E0605E',
  dark: '#0B0D10',
}

export const MIG_COLOR: Record<Migration, string> = {
  legacy: '#3A424D',
  shadowing: '#4CC9F0',
  cutover: '#D9A441',
  done: '#3FB68B',
}

export const TEAM_COLOR: Record<string, string> = {
  finance: '#6E9BF5',
  customer: '#C792EA',
  platform: '#4FB6A8',
  operations: '#E5A06A',
}

export function isoColor(isolation: number) {
  return isolation >= 0.6 ? C.good : isolation >= 0.3 ? C.warn : C.bad
}
export function isoWord(isolation: number) {
  return isolation >= 0.6 ? 'isolated' : isolation >= 0.3 ? 'coupled' : 'tangled'
}

/** readable text on top of a filled face */
export function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const l = 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  return l > 140 ? C.dark : C.ink
}
