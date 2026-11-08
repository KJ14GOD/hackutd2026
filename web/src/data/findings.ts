import type { Question, ReqWorld, Requirement, RequirementLink, RequirementVersion, Urgency } from '@/types'
import snapshot from './carddemo.findings.json'
import { PROGRAM } from './carddemo'
import { HOUR, T0, ownerOfScope } from './requirements'

/* ------------------------------------------------------------------ *
 * Nemotron's Part 2 read as the requirements layer's starting point.
 * carddemo.findings.json is a snapshot of out/part2.json (made by
 * scripts/snapshot-findings.mjs): each rule or suspected bug becomes a
 * draft requirement proposed by the Theseus agent, and each of
 * Nemotron's questions becomes an open question routed to the pocket's
 * owner. These replace the hand-written seed requirements, so the
 * conflicts, approvals, checks and change request that pointed at those
 * are dropped too.
 * ------------------------------------------------------------------ */

interface Cite {
  ref: string
  code: string
}
interface Finding {
  id: string
  kind: 'rule' | 'defect'
  confidence: string
  summary: string
  cites: Cite[]
}
interface Snapshot {
  model: string
  programs: {
    program: string
    findings: Finding[]
    questions: { id: string; text: string; options: string[]; blocks: string; cites: Cite[] }[]
  }[]
}

const AGENT = 'p-agent'
const DRAFTED_AT = T0 - 2 * HOUR
const URGENCY: Record<string, Urgency> = { rewrite: 'high', cutover: 'normal' }

const link = (requirementId: string, program: string, c: Cite, i: number): RequirementLink => ({
  id: `LK-${requirementId.slice(-6)}-${i + 1}`,
  requirementId,
  kind: 'code',
  ref: c.ref,
  evidence: c.code,
  origin: 'code',
  title: c.ref,
  program,
})

/** Replace the hand-written requirements and questions with the ones from the snapshot. */
export function withFindings(w: ReqWorld): ReqWorld {
  const s = snapshot as Snapshot
  const out: ReqWorld = {
    ...w,
    requirements: {},
    versions: {},
    flags: {},
    links: {},
    conflicts: {},
    approvals: [],
    verifications: {},
    changeRequests: {},
    questions: {},
    hits: {},
    outreach: {},
    attempts: [],
  }
  for (const p of s.programs) {
    const pocketId = PROGRAM[p.program]?.pocket ?? ''
    const owner = ownerOfScope(w, pocketId)?.id ?? ''
    for (const f of p.findings) {
      const v: RequirementVersion = {
        id: `${f.id}@1`,
        requirementId: f.id,
        n: 1,
        statement: f.summary,
        actor: '',
        condition: '',
        outcome: '',
        measure: '',
        rationale: f.kind === 'defect' ? `Suspected bug (Nemotron, ${f.confidence} confidence)` : `Rule read from the code (Nemotron, ${f.confidence} confidence)`,
        authorPersonId: AGENT,
        createdAtMs: DRAFTED_AT,
        reason: `Drafted from Part 2 (${s.model})`,
      }
      const r: Requirement = {
        id: f.id,
        scope: p.program,
        scopeLevel: 'program',
        pocketId,
        category: f.kind === 'defect' ? 'behavior' : 'business-rule',
        type: 'functional',
        status: 'draft',
        currentVersionId: v.id,
        ownerPersonId: owner,
        signature: `${p.program}|${f.kind}|${f.summary.toLowerCase()}`,
        sensitivity: 'normal',
        reviewByMs: T0 + 90 * 24 * HOUR,
      }
      out.requirements[r.id] = r
      out.versions[v.id] = v
      out.flags[v.id] = []
      out.links[r.id] = f.cites.map((c, i) => link(r.id, p.program, c, i))
    }
    for (const q of p.questions) {
      const question: Question = {
        id: q.id,
        reason: 'unmade-decision',
        requirementId: '',
        slot: '',
        urgency: URGENCY[q.blocks] ?? 'low',
        scope: p.program,
        pocketId,
        status: 'open',
        claimedBy: '',
        text: { business: q.text, engineer: q.text },
        evidence: { kind: 'none' },
        options: q.options,
        cites: q.cites,
        routedTo: owner ? [owner] : [],
        routedWhy: owner ? 'Owns this pocket' : '',
        askedAtMs: DRAFTED_AT,
      }
      out.questions[q.id] = question
    }
  }
  return out
}
