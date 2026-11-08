/* Map palette ("dark silicon"). Hex only, so faces can be shaded in code.
 * Keep in step with the CSS tokens in src/index.css. */
import type { Migration } from '@/data/carddemo'

export const C = {
  bg: '#000000',
  die: '#000000',
  dieEdge: '#24242B',
  grid: '#141418',
  plate: '#131318',
  slab: '#1C1C22',
  slabEdge: '#36363F',
  block: '#3A414D',
  ink: '#EDEEF1',
  sub: '#A9AFBA',
  faint: '#73737E',
  copper: '#CB9D5F',
  copperHi: '#E6C288',
  accent: '#45C7F5',
  good: '#37CA95',
  warn: '#EFB24A',
  bad: '#EE6D69',
  dark: '#000000',
}

export const MIG_COLOR: Record<Migration, string> = {
  legacy: '#4C4C57',
  shadowing: '#45C7F5',
  cutover: '#EFB24A',
  done: '#37CA95',
}

export const TEAM_COLOR: Record<string, string> = {
  finance: '#7FA8FF',
  customer: '#D2A2F2',
  platform: '#5FCCBB',
  operations: '#EBAC76',
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
