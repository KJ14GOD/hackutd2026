// Ported from web/src/components/map (branch dhruv-aadit); same code, local imports, no Tailwind.
/* CardDemo as the map sees it.
 *
 * Facts (programs, pockets, data stores, who reads/writes what, calls, entry
 * points) come from the segmenter via carddemo.graph.json — regenerate with
 * `node scripts/snapshot-graph.mjs`. This file only adds what a person curates:
 * readable names, owners, the seeded migration state, and named flows.
 * Everything here is pure; no React, no I/O. */
import raw from './carddemo.graph'

export type Migration = 'legacy' | 'shadowing' | 'cutover' | 'done'
export type IoMode = 'read' | 'write' | 'readwrite'
export type StoreKind = 'vsam' | 'sequential' | 'db2' | 'ims' | 'mq'
export type CallKind = 'calls' | 'transfers' | 'links'

export const MIGRATION_META: Record<Migration, { label: string; weight: number }> = {
  legacy: { label: 'Legacy', weight: 0 },
  shadowing: { label: 'Shadowing', weight: 0.34 },
  cutover: { label: 'Cutting over', weight: 0.7 },
  done: { label: 'On Java', weight: 1 },
}
export const MIGRATION_ORDER: Migration[] = ['legacy', 'shadowing', 'cutover', 'done']

export interface Team { id: string; name: string; owner: string }
export const TEAMS: Record<string, Team> = {
  finance: { id: 'finance', name: 'Finance', owner: '@priya' },
  customer: { id: 'customer', name: 'Customer', owner: '@lee' },
  platform: { id: 'platform', name: 'Platform', owner: '@sam' },
  operations: { id: 'operations', name: 'Operations', owner: '@marcus' },
}

export interface Domain { id: string; title: string; team: string; isolation: number; pockets: string[]; desc: string }
export interface Pocket {
  id: string
  title: string
  short: string
  domain: string
  team: string
  isolation: number
  loc: number
  shared: boolean
  programs: string[]
  /** row on the die: 0 above the bus, 1 below */
  row: 0 | 1
}
export interface Program {
  id: string
  title: string
  mode: 'batch' | 'online'
  lang: string
  loc: number
  pocket: string
  seed: Migration
}
export interface Store { id: string; title: string; kind: StoreKind; datasets: string[]; shared: boolean }
export interface Io { program: string; store: string; mode: IoMode }
export interface Call { from: string; to: string; kind: CallKind }
export interface Entry { id: string; kind: 'job' | 'cics'; program: string; desc: string }

/* ----------------------------- curation ---------------------------- */

const DOMAIN_INFO: Record<string, { title: string; team: string; desc: string }> = {
  'dom-cotrn00c': { title: 'Posting & transactions', team: 'finance', desc: 'Posts the day’s card transactions and keeps every account balance correct.' },
  'dom-coactupc': { title: 'Accounts & authorizations', team: 'customer', desc: 'Opens, views and updates customer accounts and their pending authorizations.' },
  'dom-cocrdlic': { title: 'Cards & administration', team: 'platform', desc: 'Issues and maintains cards, plus admin and user management.' },
  'dom-cobswait': { title: 'Batch utilities', team: 'operations', desc: 'Scheduling, waits and shared plumbing that the nightly batch cycle runs on.' },
  'dom-shared': { title: 'Shared hub', team: 'platform', desc: 'Sign-on and the main menu every screen starts from.' },
}

/** title, short label for the overview, row on the die (order = left→right) */
const POCKET_INFO: Record<string, { title: string; short: string; row: 0 | 1; team?: string }> = {
  'pkt-cbtrn02c': { title: 'Transaction posting & interest', short: 'Posting', row: 0 },
  'pkt-cotrn00c': { title: 'Bill pay & transaction views', short: 'Bill pay', row: 0 },
  'pkt-csutldtc': { title: 'Reports & date checks', short: 'Reports', row: 0 },
  'pkt-cbact01c': { title: 'Account file reader', short: 'Account reader', row: 0 },
  'pkt-coacct01': { title: 'MQ account services', short: 'Account messaging', row: 0 },
  'pkt-cobswait': { title: 'Batch wait', short: 'Wait', row: 0 },
  'pkt-shared': { title: 'Sign-on & main menu', short: 'Sign-on', row: 0, team: 'platform' },
  'pkt-coactupc': { title: 'Account view & update', short: 'Accounts', row: 1 },
  'pkt-cbstm03a': { title: 'Statements', short: 'Statements', row: 1 },
  'pkt-cbact03c': { title: 'Card lookup & report', short: 'Card lookup', row: 1 },
  'pkt-paudblod': { title: 'Pending authorizations', short: 'Auths', row: 1, team: 'operations' },
  'pkt-cocrdlic': { title: 'Card management', short: 'Cards', row: 1 },
  'pkt-cotrtlic': { title: 'Transaction types (DB2)', short: 'Txn types', row: 1 },
  'pkt-cousr00c': { title: 'User administration', short: 'Users', row: 1 },
  'pkt-cbexport': { title: 'Data export & import', short: 'Export', row: 1 },
}
export const POCKET_ORDER = Object.keys(POCKET_INFO)

const PROGRAM_TITLES: Record<string, string> = {
  CBACT01C: 'Read account file',
  CBACT02C: 'Read card file',
  CBACT03C: 'Read cross-reference file',
  CBACT04C: 'Interest calculator',
  CBCUS01C: 'Read customer file',
  CBEXPORT: 'Export customer data',
  CBIMPORT: 'Import customer data',
  CBPAUP0C: 'Purge expired authorizations',
  CBSTM03A: 'Statement generator',
  CBSTM03B: 'Statement file I/O',
  CBTRN01C: 'Validate daily transactions',
  CBTRN02C: 'Post daily transactions',
  CBTRN03C: 'Transaction report',
  COACCT01: 'Account inquiry over MQ',
  COACTUPC: 'Update account',
  COACTVWC: 'View account',
  COADM01C: 'Admin menu',
  COBDATFT: 'Date formatter (assembler)',
  COBIL00C: 'Pay bill',
  COBSWAIT: 'Batch wait step',
  COBTUPDT: 'Batch transaction-type update',
  COCRDLIC: 'List cards',
  COCRDSLC: 'Card detail',
  COCRDUPC: 'Update card',
  CODATE01: 'Date inquiry over MQ',
  COMEN01C: 'Main menu',
  COPAUA0C: 'Authorize card request',
  COPAUS0C: 'Pending authorization summary',
  COPAUS1C: 'Pending authorization detail',
  COPAUS2C: 'Flag authorization as fraud',
  CORPT00C: 'Request report',
  COSGN00C: 'Sign on',
  COTRN00C: 'List transactions',
  COTRN01C: 'View transaction',
  COTRN02C: 'Add transaction',
  COTRTLIC: 'List transaction types',
  COTRTUPC: 'Update transaction type',
  COUSR00C: 'List users',
  COUSR01C: 'Add user',
  COUSR02C: 'Update user',
  COUSR03C: 'Delete user',
  CSUTLDTC: 'Date validation utility',
  DBUNLDGS: 'Unload authorization DB to GSAM',
  MVSWAIT: 'Wait (assembler)',
  PAUDBLOD: 'Load authorization DB',
  PAUDBUNL: 'Unload authorization DB',
}

const STORE_TITLES: Record<string, string> = {
  ACCTDATA: 'Account master',
  CARDDATA: 'Card master',
  CARDXREF: 'Card ↔ account ↔ customer xref',
  CUSTDATA: 'Customer master',
  TRANSACT: 'Transaction master',
  USRSEC: 'User security',
  TCATBALF: 'Category balances',
  DALYTRAN: 'Daily transaction input',
  DALYREJS: 'Rejected transactions',
  DISCGRP: 'Disclosure groups (rates)',
  SYSTRAN: 'System-generated transactions',
  STATEMNT: 'Statements output',
  TRXFL: 'Sorted transaction work file',
  EXPORT: 'Export file',
  IMPORT: 'Import file',
  PAUTDB: 'Pending authorizations (IMS)',
  AUTHFRDS: 'Fraud flags (DB2)',
  TRANSACTION_TYPE: 'Transaction types (DB2)',
  DATEPARM: 'Report date parameters',
  TRANCATG: 'Transaction categories',
  TRANREPT: 'Transaction report output',
  TRANTYPE: 'Transaction types',
  'MQ.ERROR': 'Error queue',
  'MQ.REPLY.ACCT': 'Account reply queue',
  'MQ.REPLY.DATE': 'Date reply queue',
}

/** Migration state before any live run: nothing has been converted, so every program starts as legacy. */
const SEED: Record<string, Migration> = {}

/* ------------------------------ graph ------------------------------ */

type Raw = typeof raw
const g = raw as Raw

export const PROGRAMS: Program[] = g.programs.map((p) => ({
  id: p.id,
  title: PROGRAM_TITLES[p.id] ?? p.id,
  mode: p.mode as Program['mode'],
  lang: p.lang === 'asm' ? 'Assembler' : 'COBOL',
  loc: p.loc,
  pocket: p.pocket,
  seed: SEED[p.id] ?? 'legacy',
}))
export const PROGRAM: Record<string, Program> = Object.fromEntries(PROGRAMS.map((p) => [p.id, p]))

export const IO: Io[] = g.io.map((r) => ({ program: r.program, store: r.store, mode: r.mode as IoMode }))
export const CALLS: Call[] = g.calls.map((c) => ({ from: c.from, to: c.to, kind: c.kind as CallKind }))
export const ENTRIES: Entry[] = g.entries.map((e) => ({ id: e.id, kind: e.kind as Entry['kind'], program: e.program!, desc: e.desc }))

const pocketsOfStore = new Map<string, Set<string>>()
for (const r of IO) {
  const set = pocketsOfStore.get(r.store) ?? new Set<string>()
  set.add(PROGRAM[r.program].pocket)
  pocketsOfStore.set(r.store, set)
}

export const STORES: Store[] = g.stores.map((s) => ({
  id: s.id,
  title: STORE_TITLES[s.id] ?? s.id,
  kind: s.kind as StoreKind,
  datasets: s.datasets,
  shared: (pocketsOfStore.get(s.id)?.size ?? 0) > 1,
}))
export const STORE: Record<string, Store> = Object.fromEntries(STORES.map((s) => [s.id, s]))

/** shared stores, in bus-lane order (top lane first) */
export const BUS_ORDER = ['TRANSACT', 'ACCTDATA', 'USRSEC', 'CARDXREF', 'CARDDATA', 'CUSTDATA'].filter((id) => STORE[id]?.shared)
for (const s of STORES) if (s.shared && !BUS_ORDER.includes(s.id)) BUS_ORDER.push(s.id)

export const POCKETS: Pocket[] = POCKET_ORDER.map((id) => {
  const p = g.pockets.find((x) => x.id === id)!
  const info = POCKET_INFO[id]
  const dom = DOMAIN_INFO[p.domain]
  return {
    id,
    title: info.title,
    short: info.short,
    domain: p.domain,
    team: info.team ?? dom.team,
    isolation: p.isolation,
    loc: p.loc,
    shared: p.kind === 'shared',
    programs: [...p.programs].sort((a, b) => PROGRAM[b].loc - PROGRAM[a].loc),
    row: info.row,
  }
})
export const POCKET: Record<string, Pocket> = Object.fromEntries(POCKETS.map((p) => [p.id, p]))

export const DOMAINS: Domain[] = g.domains.map((d) => ({
  id: d.id,
  title: DOMAIN_INFO[d.id]?.title ?? d.id,
  team: DOMAIN_INFO[d.id]?.team ?? 'platform',
  isolation: d.isolation,
  pockets: POCKETS.filter((p) => p.domain === d.id).map((p) => p.id),
  desc: DOMAIN_INFO[d.id]?.desc ?? '',
}))
export const DOMAIN: Record<string, Domain> = Object.fromEntries(DOMAINS.map((d) => [d.id, d]))

export const SOURCE = g.source

/* Link a program node to its real source on the AWS CardDemo repo.
 * COBOL lives in app/cbl, assembler in app/asm. */
export const SOURCE_REPO = 'aws-samples/aws-mainframe-modernization-carddemo'
export function sourceUrl(id: string): string {
  const p = PROGRAM[id]
  const dir = p?.lang === 'Assembler' ? 'asm' : 'cbl'
  const ext = p?.lang === 'Assembler' ? 'asm' : 'cbl'
  return `https://github.com/${SOURCE_REPO}/blob/main/app/${dir}/${id}.${ext}`
}

/* ---------------------------- queries ------------------------------ */

export const ioOf = (program: string) => IO.filter((r) => r.program === program)
export const ioOfStore = (store: string) => IO.filter((r) => r.store === store)
export const entriesOf = (program: string) => ENTRIES.filter((e) => e.program === program)
export const callsFrom = (program: string) => CALLS.filter((c) => c.from === program)
export const callsTo = (program: string) => CALLS.filter((c) => c.to === program)
export const pocketStores = (pocket: string) => {
  const progs = new Set(POCKET[pocket].programs)
  return [...new Set(IO.filter((r) => progs.has(r.program)).map((r) => r.store))]
}
export const sharedStoresOfPocket = (pocket: string) => pocketStores(pocket).filter((s) => STORE[s].shared)
export const localStoresOfPocket = (pocket: string) => pocketStores(pocket).filter((s) => !STORE[s].shared)
export const pocketsUsingStore = (store: string) => [...(pocketsOfStore.get(store) ?? [])]
export const writes = (m: IoMode) => m !== 'read'
export const reads = (m: IoMode) => m !== 'write'

/** taps from this pocket onto the bus: one per (program, shared store) */
export function cutCost(pocket: string) {
  const progs = new Set(POCKET[pocket].programs)
  return IO.filter((r) => progs.has(r.program) && STORE[r.store].shared).length
}

/* --------------------------- migration ----------------------------- */

export type MigrationMap = Record<string, Migration>

export function migrationProgress(mig: MigrationMap, programs: string[] = PROGRAMS.map((p) => p.id)) {
  if (!programs.length) return 0
  return programs.reduce((a, id) => a + MIGRATION_META[mig[id] ?? 'legacy'].weight, 0) / programs.length
}
export function migrationCounts(mig: MigrationMap) {
  const c: Record<Migration, number> = { legacy: 0, shadowing: 0, cutover: 0, done: 0 }
  for (const p of PROGRAMS) c[mig[p.id] ?? 'legacy']++
  return c
}

/* -------------------------- blast radius --------------------------- *
 * Changing X means retesting:
 *   - every program that reads a store X writes (one hop: data coupling)
 *   - every program that calls, links to or transfers into X (transitively)
 * Each hit keeps the reasons, so the UI can say *why* it lights up. */

export interface BlastHit { program: string; via: { store?: string; caller?: boolean }[] }
export interface Blast {
  source: string
  writes: string[]
  hits: BlastHit[]
  stores: string[]
  pockets: string[]
}

export function blastRadius(program: string): Blast {
  const written = ioOf(program).filter((r) => writes(r.mode)).map((r) => r.store)
  const hits = new Map<string, BlastHit>()
  const hit = (id: string, via: BlastHit['via'][number]) => {
    if (id === program) return
    const h = hits.get(id) ?? { program: id, via: [] }
    h.via.push(via)
    hits.set(id, h)
  }
  for (const s of written) for (const r of ioOfStore(s)) if (reads(r.mode)) hit(r.program, { store: s })
  const queue = [program]
  const seen = new Set(queue)
  while (queue.length) {
    const cur = queue.shift()!
    for (const c of callsTo(cur)) {
      if (seen.has(c.from)) continue
      seen.add(c.from)
      hit(c.from, { caller: true })
      queue.push(c.from)
    }
  }
  const list = [...hits.values()].sort((a, b) => a.program.localeCompare(b.program))
  return {
    source: program,
    writes: written,
    hits: list,
    stores: written,
    pockets: [...new Set(list.map((h) => PROGRAM[h.program].pocket))],
  }
}

/** a store changing shape: everyone who touches it */
export function storeBlast(store: string) {
  const users = ioOfStore(store)
  return {
    writers: users.filter((r) => writes(r.mode)).map((r) => r.program),
    readers: users.filter((r) => reads(r.mode)).map((r) => r.program),
    pockets: pocketsUsingStore(store),
  }
}

/* ------------------------------ flows ------------------------------ */

export type Ref = { kind: 'program' | 'store' | 'entry' | 'pocket'; id: string }
export interface FlowStep { from: Ref; to: Ref; verb: string; note: string }
export interface Flow { id: string; title: string; summary: string; steps: FlowStep[] }

const P = (id: string): Ref => ({ kind: 'program', id })
const S = (id: string): Ref => ({ kind: 'store', id })
const E = (id: string): Ref => ({ kind: 'entry', id })

export const FLOWS: Flow[] = [
  {
    id: 'nightly',
    title: 'Nightly batch cycle',
    summary: 'Post the day’s transactions, accrue interest, print statements.',
    steps: [
      { from: E('POSTTRAN'), to: P('CBTRN02C'), verb: 'runs', note: 'JCL job POSTTRAN starts the posting program.' },
      { from: P('CBTRN02C'), to: S('DALYTRAN'), verb: 'reads', note: 'Reads the day’s card transactions.' },
      { from: P('CBTRN02C'), to: S('CARDXREF'), verb: 'reads', note: 'Resolves each card to its account.' },
      { from: P('CBTRN02C'), to: S('TRANSACT'), verb: 'writes', note: 'Appends posted transactions to the master.' },
      { from: P('CBTRN02C'), to: S('ACCTDATA'), verb: 'updates', note: 'Moves balances on the account master.' },
      { from: P('CBTRN02C'), to: S('TCATBALF'), verb: 'updates', note: 'Rolls category balances for interest.' },
      { from: E('INTCALC'), to: P('CBACT04C'), verb: 'runs', note: 'JCL job INTCALC starts the interest calculator.' },
      { from: P('CBACT04C'), to: S('TCATBALF'), verb: 'reads', note: 'Reads category balances posted above.' },
      { from: P('CBACT04C'), to: S('ACCTDATA'), verb: 'updates', note: 'Writes accrued interest to accounts.' },
      { from: E('CREASTMT'), to: P('CBSTM03A'), verb: 'runs', note: 'JCL job CREASTMT builds statements.' },
      { from: P('CBSTM03A'), to: P('CBSTM03B'), verb: 'calls', note: 'File I/O is delegated to a subroutine.' },
      { from: P('CBSTM03B'), to: S('ACCTDATA'), verb: 'reads', note: 'Statements read the balances posting just wrote.' },
    ],
  },
  {
    id: 'billpay',
    title: 'Online bill payment',
    summary: 'A customer pays their balance from a CICS screen.',
    steps: [
      { from: E('CB00'), to: P('COBIL00C'), verb: 'starts', note: 'CICS transaction CB00 opens the bill-pay screen.' },
      { from: P('COBIL00C'), to: S('CARDXREF'), verb: 'reads', note: 'Finds the card for the account.' },
      { from: P('COBIL00C'), to: S('ACCTDATA'), verb: 'updates', note: 'Zeroes the current balance.' },
      { from: P('COBIL00C'), to: S('TRANSACT'), verb: 'writes', note: 'Records the payment as a transaction.' },
      { from: P('COBIL00C'), to: P('COMEN01C'), verb: 'returns to', note: 'XCTL back to the main menu.' },
    ],
  },
  {
    id: 'cardupdate',
    title: 'Card update',
    summary: 'Find a card in the list, open it, change it.',
    steps: [
      { from: E('CCLI'), to: P('COCRDLIC'), verb: 'starts', note: 'CICS transaction CCLI lists cards.' },
      { from: P('COCRDLIC'), to: S('CARDDATA'), verb: 'reads', note: 'Pages through the card master.' },
      { from: P('COCRDLIC'), to: P('COCRDUPC'), verb: 'transfers to', note: 'XCTL to the update screen.' },
      { from: P('COCRDUPC'), to: S('CARDDATA'), verb: 'updates', note: 'Rewrites the card record.' },
    ],
  },
]

/** canonical id for an edge between two refs, matching the map's link ids */
export function linkId(a: Ref, b: Ref): string | null {
  if (a.kind === 'entry' && b.kind === 'program') return `entry:${a.id}`
  if (a.kind === 'program' && b.kind === 'store') return `io:${a.id}:${b.id}`
  if (a.kind === 'store' && b.kind === 'program') return `io:${b.id}:${a.id}`
  if (a.kind === 'program' && b.kind === 'program') return `call:${a.id}:${b.id}`
  return null
}
