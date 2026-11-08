/* What lights up on the map, and in which role. Pure.
 *
 * Link ids:
 *   io:<program>:<store>   a program reading/writing a store
 *   call:<from>:<to>       call, link or CICS transfer between programs
 *   entry:<entry>          a job or transaction starting its program */
import {
  CALLS,
  ENTRIES,
  POCKET,
  PROGRAM,
  blastRadius,
  callsFrom,
  callsTo,
  entriesOf,
  ioOf,
  ioOfStore,
  linkId,
  type FlowStep,
  type Ref,
} from '@/data/carddemo'

export type Role = 'source' | 'hit' | 'on'
export interface Highlight {
  tone: 'accent' | 'warn'
  strength: 'strong' | 'soft'
  programs: Map<string, Role>
  stores: Map<string, Role>
  entries: Set<string>
  links: Set<string>
  /** pockets that contain something lit */
  pockets: Set<string>
  /** cross-pocket calls to route over the bus */
  calls: { from: string; to: string }[]
}

function empty(tone: Highlight['tone'] = 'accent', strength: Highlight['strength'] = 'strong'): Highlight {
  return { tone, strength, programs: new Map(), stores: new Map(), entries: new Set(), links: new Set(), pockets: new Set(), calls: [] }
}

function finish(h: Highlight): Highlight {
  for (const id of h.programs.keys()) h.pockets.add(PROGRAM[id].pocket)
  return h
}

function addCall(h: Highlight, from: string, to: string) {
  h.links.add(`call:${from}:${to}`)
  if (PROGRAM[from].pocket !== PROGRAM[to].pocket) h.calls.push({ from, to })
}

export function selectionHighlight(ref: Ref, strength: Highlight['strength'] = 'strong'): Highlight {
  const h = empty('accent', strength)
  if (ref.kind === 'program') {
    h.programs.set(ref.id, 'source')
    for (const r of ioOf(ref.id)) {
      h.stores.set(r.store, 'on')
      h.links.add(`io:${ref.id}:${r.store}`)
    }
    for (const e of entriesOf(ref.id)) {
      h.entries.add(e.id)
      h.links.add(`entry:${e.id}`)
    }
    for (const c of [...callsFrom(ref.id), ...callsTo(ref.id)]) {
      const other = c.from === ref.id ? c.to : c.from
      if (!h.programs.has(other)) h.programs.set(other, 'on')
      addCall(h, c.from, c.to)
    }
  } else if (ref.kind === 'store') {
    h.stores.set(ref.id, 'source')
    for (const r of ioOfStore(ref.id)) {
      h.programs.set(r.program, 'on')
      h.links.add(`io:${r.program}:${ref.id}`)
    }
  } else if (ref.kind === 'pocket') {
    for (const p of POCKET[ref.id].programs) {
      h.programs.set(p, 'on')
      for (const r of ioOf(p)) {
        h.stores.set(r.store, 'on')
        h.links.add(`io:${p}:${r.store}`)
      }
    }
  } else if (ref.kind === 'entry') {
    const e = ENTRIES.find((x) => x.id === ref.id)
    if (e) {
      h.entries.add(e.id)
      h.links.add(`entry:${e.id}`)
      h.programs.set(e.program, 'source')
    }
  }
  return finish(h)
}

export function blastHighlight(program: string): Highlight {
  const h = empty('warn')
  const b = blastRadius(program)
  h.programs.set(program, 'source')
  for (const s of b.writes) {
    h.stores.set(s, 'hit')
    h.links.add(`io:${program}:${s}`)
  }
  for (const hit of b.hits) {
    h.programs.set(hit.program, 'hit')
    for (const v of hit.via) if (v.store) h.links.add(`io:${hit.program}:${v.store}`)
  }
  // caller chains: only edges between lit programs that point into the source's ancestry
  const lit = new Set([program, ...b.hits.filter((x) => x.via.some((v) => v.caller)).map((x) => x.program)])
  for (const c of CALLS) if (lit.has(c.from) && lit.has(c.to) && c.from !== program) addCall(h, c.from, c.to)
  return finish(h)
}

export function flowHighlight(step: FlowStep): Highlight {
  const h = empty('accent')
  const put = (r: Ref, role: Role) => {
    if (r.kind === 'program') h.programs.set(r.id, role)
    if (r.kind === 'store') h.stores.set(r.id, role)
    if (r.kind === 'entry') {
      h.entries.add(r.id)
      const e = ENTRIES.find((x) => x.id === r.id)
      if (e) h.programs.set(e.program, role === 'source' ? 'source' : 'on')
    }
  }
  put(step.to, 'on')
  put(step.from, 'source')
  const id = linkId(step.from, step.to)
  if (id) {
    h.links.add(id)
    if (id.startsWith('call:')) {
      const [, a, b] = id.split(':')
      if (PROGRAM[a] && PROGRAM[b] && PROGRAM[a].pocket !== PROGRAM[b].pocket) h.calls.push({ from: a, to: b })
    }
  }
  return finish(h)
}
