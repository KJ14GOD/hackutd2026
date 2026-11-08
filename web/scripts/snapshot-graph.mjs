#!/usr/bin/env node
/* Snapshot the segmenter's output into the small graph the map renders.
 *
 *   node scripts/snapshot-graph.mjs [path/to/segmentation.json]
 *
 * Default input is ../out/segmentation.json (written by `pnpm segment` at the
 * repo root). Output is src/data/carddemo.graph.json, committed so the UI runs
 * with no backend. Physical datasets collapse to logical stores
 * (AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS -> ACCTDATA). Copybooks, screens and
 * system APIs are left out: the map shows programs, entry points and data. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const input = resolve(process.argv[2] ?? resolve(here, '../../out/segmentation.json'))
const output = resolve(here, '../src/data/carddemo.graph.json')

const seg = JSON.parse(readFileSync(input, 'utf8'))
const byId = new Map(seg.nodes.map((n) => [n.id, n]))

/** logical store for a data-ish node, or null */
function storeOf(node) {
  if (!node) return null
  if (node.kind === 'dataset') {
    const m = node.name.match(/^AWS\.M2\.CARDDEMO\.([A-Z0-9]+)/)
    if (m) return { id: m[1], kind: /VSAM/.test(node.name) ? 'vsam' : 'sequential' }
    if (node.name.startsWith('db2:')) return { id: node.name.split('.').pop(), kind: 'db2' }
    return null
  }
  if (node.kind === 'ims') return { id: 'PAUTDB', kind: 'ims' }
  if (node.kind === 'mq') return { id: node.name.replace(/^CARD\.DEMO\./, 'MQ.'), kind: 'mq' }
  return null
}

const programs = seg.nodes
  .filter((n) => n.kind === 'program')
  .map((n) => ({
    id: n.name,
    mode: n.meta?.mode ?? 'batch',
    lang: n.meta?.language ?? 'cobol',
    loc: n.loc,
    pocket: n.pocketId,
  }))
  .sort((a, b) => a.id.localeCompare(b.id))
const progIds = new Set(programs.map((p) => p.id))

const pockets = seg.pockets
  .filter((p) => p.level === 'pocket')
  .map((p) => ({
    id: p.id,
    domain: p.parentId,
    kind: p.kind,
    isolation: Number(p.isolation.toFixed(3)),
    loc: p.loc,
    programs: p.members.filter((m) => m.startsWith('prog:')).map((m) => m.slice(5)).sort(),
  }))
const domains = seg.pockets
  .filter((p) => p.level === 'domain')
  .map((p) => ({ id: p.id, kind: p.kind, isolation: Number(p.isolation.toFixed(3)) }))

const stores = new Map() // id -> { id, kind, datasets:Set }
const io = new Map() // `${prog}|${store}` -> { program, store, read, write }
const calls = new Map()

for (const e of seg.edges) {
  const a = byId.get(e.src)
  const b = byId.get(e.dst)
  if (!a || !b || a.kind !== 'program') continue
  if (e.kind === 'read' || e.kind === 'write') {
    const s = storeOf(b)
    if (!s) continue
    const st = stores.get(s.id) ?? { id: s.id, kind: s.kind, datasets: new Set() }
    if (s.kind === 'vsam') st.kind = 'vsam'
    st.datasets.add(b.name)
    stores.set(s.id, st)
    const key = `${a.name}|${s.id}`
    const rec = io.get(key) ?? { program: a.name, store: s.id, read: false, write: false }
    rec[e.kind] = true
    io.set(key, rec)
  } else if (['calls', 'transfers', 'links'].includes(e.kind) && b.kind === 'program' && a.name !== b.name) {
    calls.set(`${a.name}|${b.name}`, { from: a.name, to: b.name, kind: e.kind })
  }
}

const entries = seg.endpoints
  .map((ep) => ({
    id: ep.name,
    kind: ep.kind === 'cics' ? 'cics' : 'job',
    program: ep.entryNode?.startsWith('prog:') ? ep.entryNode.slice(5) : null,
    desc: ep.description || '',
  }))
  .filter((ep) => ep.program && progIds.has(ep.program))

const out = {
  source: { ref: seg.source?.ref, depsHash: seg.source?.depsHash, configHash: seg.configHash },
  programs,
  pockets,
  domains,
  stores: [...stores.values()]
    .map((s) => ({ id: s.id, kind: s.kind, datasets: [...s.datasets].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  io: [...io.values()].map((r) => ({ program: r.program, store: r.store, mode: r.read && r.write ? 'readwrite' : r.write ? 'write' : 'read' })),
  calls: [...calls.values()],
  entries,
}

writeFileSync(output, JSON.stringify(out, null, 1) + '\n')
console.log(
  `wrote ${output}: ${programs.length} programs, ${pockets.length} pockets, ${out.stores.length} stores, ${out.io.length} io, ${out.calls.length} calls, ${entries.length} entries`,
)
