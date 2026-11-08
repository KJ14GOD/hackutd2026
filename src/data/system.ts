/* The whole codebase as a hierarchy for semantic zoom.
 *
 *   level 0 (overview): segments = clusters of tightly-coupled files.
 *                       edges between segments = the WEAK cross-cluster deps.
 *   level 1 (segment):  the files inside one cluster + their DENSE internal deps.
 *
 * This hierarchy is the scaling trick: we never draw every file at once.
 * A 10k-file repo is still 6–20 cluster blocks at the top level. */

export type Migration = 'legacy' | 'shadowing' | 'cutover' | 'done'
export const MIGRATION_ORDER: Migration[] = ['legacy', 'shadowing', 'cutover', 'done']
export const MIGRATION_WEIGHT: Record<Migration, number> = { legacy: 0, shadowing: 0.34, cutover: 0.7, done: 1 }
export const MIGRATION_META: Record<Migration, { label: string; color: string }> = {
  legacy: { label: 'Legacy', color: '#4c5247' },
  shadowing: { label: 'Shadowing', color: '#5aa9ff' },
  cutover: { label: 'Cutting over', color: '#e0a84a' },
  done: { label: 'On Java', color: '#76b900' },
}

export interface Segment {
  id: string
  title: string
  owner: string
  team: string
  col: number
  row: number
}

export const SEGMENTS: Segment[] = [
  { id: 'tx', title: 'Transaction posting', owner: '@priya', team: 'Finance', col: 0, row: 0 },
  { id: 'ac', title: 'Accounts', owner: '@priya', team: 'Finance', col: 1, row: 0 },
  { id: 'st', title: 'Statements', owner: '@lee', team: 'Customer', col: 2, row: 0 },
  { id: 'sh', title: 'Shared utilities', owner: '@sam', team: 'Platform', col: 0, row: 1 },
  { id: 'cu', title: 'Customers', owner: '@lee', team: 'Customer', col: 1, row: 1 },
  { id: 'se', title: 'Security', owner: '@sam', team: 'Platform', col: 2, row: 1 },
]
export const SEG_BY_ID: Record<string, Segment> = Object.fromEntries(SEGMENTS.map((s) => [s.id, s]))

export interface FileNode {
  id: string
  name: string
  segment: string
  migration: Migration
  matchRate: number
  openQuestions: number
  isolation: number
  lx: number // local grid position within its segment
  ly: number
}

type Spec = [string, string, Migration, number] // id, name, migration, isolation
const POOLS: Record<string, Spec[]> = {
  tx: [
    ['CBTRN01C', 'Txn validator', 'legacy', 0.63],
    ['CBTRN02C', 'Transaction poster', 'shadowing', 0.87],
    ['CBTRN03C', 'Posting report', 'cutover', 0.81],
    ['TRANREC', 'Txn record layout', 'done', 0.9],
    ['POSTBAL', 'Balance posting', 'legacy', 0.4],
    ['EDITCHK', 'Edit checks', 'done', 0.72],
    ['REJWRIT', 'Reject writer', 'legacy', 0.55],
  ],
  ac: [
    ['CBACT01C', 'Account master', 'legacy', 0.41],
    ['CBACT02C', 'Card master read', 'done', 0.72],
    ['CBACT04C', 'Interest calc', 'shadowing', 0.44],
    ['ACCTREC', 'Account record', 'done', 0.88],
    ['INTCALC', 'Interest tables', 'legacy', 0.5],
    ['CYCPROC', 'Cycle processor', 'cutover', 0.6],
  ],
  st: [
    ['CBSTM03A', 'Statement build', 'legacy', 0.33],
    ['CBSTM03B', 'Statement I/O', 'done', 0.78],
    ['STMTFMT', 'Statement format', 'legacy', 0.45],
    ['PRINTQ', 'Print queue', 'cutover', 0.7],
    ['STMTREC', 'Statement record', 'done', 0.85],
  ],
  sh: [
    ['CBUTIL01', 'Date/amount utils', 'legacy', 0.29],
    ['DATEUTL', 'Date helpers', 'cutover', 0.75],
    ['AMTUTL', 'Amount helpers', 'done', 0.82],
    ['STRUTL', 'String helpers', 'done', 0.8],
    ['ERRHND', 'Error handler', 'legacy', 0.5],
  ],
  cu: [
    ['CBCUS01C', 'Customer read', 'cutover', 0.69],
    ['COCRDUPC', 'Card update', 'legacy', 0.52],
    ['CUSTREC', 'Customer record', 'done', 0.86],
    ['CRDXREF', 'Card cross-ref', 'legacy', 0.48],
    ['DEDUPE', 'Dedup service', 'cutover', 0.66],
  ],
  se: [
    ['COSGN00C', 'Sign-on', 'done', 0.84],
    ['COUSR01C', 'User admin', 'done', 0.8],
    ['USRSEC', 'User security', 'done', 0.9],
    ['AUTHCHK', 'Auth checks', 'done', 0.78],
    ['PWDVAL', 'Password rules', 'cutover', 0.7],
  ],
}

function matchFor(m: Migration): number {
  return m === 'done' ? 1 : m === 'cutover' ? 0.994 : m === 'shadowing' ? 0.82 : 0
}

// build file nodes with a local grid layout per segment
export const FILES: FileNode[] = Object.entries(POOLS).flatMap(([seg, specs]) => {
  const cols = Math.ceil(Math.sqrt(specs.length))
  return specs.map(([id, name, migration, isolation], i) => ({
    id,
    name,
    segment: seg,
    migration,
    matchRate: matchFor(migration),
    openQuestions: migration === 'shadowing' ? 2 : 0,
    isolation,
    lx: i % cols,
    ly: Math.floor(i / cols),
  }))
})
export const FILE_BY_ID: Record<string, FileNode> = Object.fromEntries(FILES.map((f) => [f.id, f]))

export interface FileEdge { from: string; to: string }
// dense INTERNAL edges within each cluster (chain + hub)
export const INTRA_EDGES: FileEdge[] = Object.values(POOLS).flatMap((specs) => {
  const ids = specs.map((s) => s[0])
  const out: FileEdge[] = []
  for (let i = 1; i < ids.length; i++) {
    out.push({ from: ids[i], to: ids[i - 1] })
    if (i % 2 === 0) out.push({ from: ids[i], to: ids[0] })
  }
  return out
})

// WEAK inter-cluster edges, aggregated per segment pair (weight = # of file deps)
export interface SegEdge { a: string; b: string; weight: number }
export const SEG_EDGES: SegEdge[] = [
  { a: 'tx', b: 'ac', weight: 3 },
  { a: 'tx', b: 'st', weight: 2 },
  { a: 'tx', b: 'sh', weight: 2 },
  { a: 'ac', b: 'sh', weight: 2 },
  { a: 'ac', b: 'st', weight: 1 },
  { a: 'cu', b: 'sh', weight: 1 },
  { a: 'cu', b: 'ac', weight: 1 },
  { a: 'st', b: 'cu', weight: 1 },
  { a: 'se', b: 'sh', weight: 1 },
]

export function filesOf(seg: string) {
  return FILES.filter((f) => f.segment === seg)
}
export function intraEdgesOf(seg: string) {
  const ids = new Set(filesOf(seg).map((f) => f.id))
  return INTRA_EDGES.filter((e) => ids.has(e.from) && ids.has(e.to))
}
export function externalDepCount(seg: string) {
  return SEG_EDGES.filter((e) => e.a === seg || e.b === seg).reduce((a, e) => a + e.weight, 0)
}

export function segMigration(seg: string): Migration {
  const fs = filesOf(seg)
  const avg = fs.reduce((a, f) => a + MIGRATION_WEIGHT[f.migration], 0) / fs.length
  return avg >= 0.95 ? 'done' : avg >= 0.6 ? 'cutover' : avg >= 0.3 ? 'shadowing' : 'legacy'
}
export function segProgress(seg: string): number {
  const fs = filesOf(seg)
  return fs.reduce((a, f) => a + MIGRATION_WEIGHT[f.migration], 0) / fs.length
}

export function overallProgress(files: FileNode[] = FILES): number {
  if (!files.length) return 0
  return files.reduce((a, f) => a + MIGRATION_WEIGHT[f.migration], 0) / files.length
}
export function statusCounts(files: FileNode[] = FILES) {
  const c: Record<Migration, number> = { legacy: 0, shadowing: 0, cutover: 0, done: 0 }
  for (const f of files) c[f.migration]++
  return c
}
