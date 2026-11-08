import type { Approver, Outreach, Ownership, OwnershipSignal, Person, Question, ReqWorld, Team, Urgency } from '@/types'
import type { DbConnection } from '../../../packages/shared/src/module_bindings'
import type * as Row from '../../../packages/shared/src/module_bindings/types'
import type { RealtimeSource, ReqActions, SourceEvent, SourceListener } from '@/data/source'
import { MockSource } from '@/data/mockSource'
import { PROGRAM } from '@/data/carddemo'

/* ------------------------------------------------------------------ *
 * SpacetimeSource: the live backend behind the same RealtimeSource seam.
 *
 * Only some of the requirements layer exists in the database so far:
 * people, teams, reports-to, ownership, approvers, questions and Slack
 * outreach. Those come from SpacetimeDB. Everything else (map, shadow
 * run, requirements, conflicts, approvals, checks) still comes from the
 * wrapped MockSource until the backend has tables for it.
 *
 * If SpacetimeDB can't be reached, the page keeps showing the mock data
 * and logs a warning, so the demo never goes blank.
 * ------------------------------------------------------------------ */

export interface StdbOptions {
  uri: string
  database: string
}

interface Live {
  people: Map<string, Row.Person>
  teams: Map<string, Row.Team>
  managers: Map<string, string> // personId -> managerId
  ownership: Map<bigint, Row.Ownership>
  approvers: Map<string, Row.Approver>
  questions: Map<string, Row.Question>
  outreach: Map<bigint, Row.Outreach>
}

const ANSWERED = new Set(['answered', 'answered-by-docs', 'known-issue'])
/** Part 2 resolved these from the docs or known issues, not a person. */
const AGENT_ID = 'p-agent'

const SIGNAL: Record<string, OwnershipSignal> = {
  namedCodeOwner: 'codeowners',
  teamCodeOwner: 'codeowners',
  commits: 'git-blame',
  ticketAssignee: 'jira-assignee',
  ticketReporter: 'jira-assignee',
  policyOwner: 'confluence-author',
  specAuthor: 'confluence-author',
  managerOfOwningTeam: 'org-chart',
  chatParticipant: 'chat',
}
const KIND: Record<string, Ownership['kind']> = {
  namedCodeOwner: 'owns',
  teamCodeOwner: 'owns',
  policyOwner: 'owns',
  commits: 'contributes',
  ticketAssignee: 'contributes',
  specAuthor: 'contributes',
}

const program = (target: string) => target.replace(/^prog:/, '')
const pocketOf = (target: string) => PROGRAM[program(target)]?.pocket ?? program(target)
const parseList = (json: string): string[] => {
  try {
    const v: unknown = JSON.parse(json)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}
const handleOf = (p: Row.Person) => '@' + (p.id.includes('@') ? p.id.split('@')[0].split('.')[0] : p.name.toLowerCase().replace(/[^a-z]/g, ''))

/* ------------------------- row -> UI mapping ------------------------- */

function toPerson(p: Row.Person, managers: Map<string, string>): Person {
  return {
    id: p.id,
    name: p.name,
    handle: handleOf(p),
    title: p.title,
    teamId: p.team,
    emails: parseList(p.emailsJson),
    active: p.active,
    managerId: managers.get(p.id) ?? '',
    sources: [p.source],
    kind: 'person',
  }
}

function toTeam(t: Row.Team, people: Person[]): Team {
  // The team's manager is the member whose own manager sits outside the team.
  const members = people.filter((p) => p.teamId === t.id)
  const head = members.find((p) => !members.some((m) => m.id === p.managerId))
  return { id: t.id, name: t.name, parentTeamId: t.parentTeamId, managerId: head?.id ?? '' }
}

function toOwnership(o: Row.Ownership): Ownership {
  return {
    id: `own-${o.id}`,
    personId: o.personId,
    target: program(o.target),
    kind: KIND[o.signal] ?? 'consulted',
    signal: SIGNAL[o.signal] ?? 'org-chart',
    weight: o.weight,
    source: o.source,
    evidence: o.evidence,
    observedAtMs: Date.parse(o.observedAt) || 0,
  }
}

function toApprover(a: Row.Approver): Approver {
  return {
    id: a.id,
    personId: a.personId,
    scope: pocketOf(a.scope),
    category: a.category as Approver['category'],
    score: a.score,
    evidence: parseList(a.evidenceJson),
    signedOff: a.signedOffBy !== '',
  }
}

function toOutreach(o: Row.Outreach): Outreach {
  return {
    id: `out-${o.id}`,
    questionId: o.questionId,
    recipientPersonId: o.recipientPersonId,
    channel: o.channel as Outreach['channel'],
    rendering: o.rendering as Outreach['rendering'],
    urgency: o.urgency as Urgency,
    step: o.step as Outreach['step'],
    status: o.status as Outreach['status'],
    sentAtMs: Number(o.sentAtMs),
  }
}

function toQuestion(q: Row.Question, sent: Row.Outreach[], nowMs: number): Question {
  const answered = ANSWERED.has(q.status)
  const refs = parseList(q.evidenceJson)
  // Shadow-run questions have ids like CBACT04C-S651A; Part 2 questions CBACT04C-Q1.
  const fromShadow = /-S[0-9A-F]+$/.test(q.id)
  // Queued Slack rows have sentAtMs 0; only ones actually sent date the question.
  const first = sent.filter((o) => o.sentAtMs > 0n).reduce<Row.Outreach | null>((a, o) => (!a || o.sentAtMs < a.sentAtMs ? o : a), null)
  return {
    id: q.id,
    // The question table has no reason, slot or urgency columns yet (pending the schema change).
    reason: 'unmade-decision',
    requirementId: '',
    slot: '',
    urgency: ((first ?? sent[0])?.urgency as Urgency | undefined) ?? 'normal',
    scope: q.program,
    pocketId: PROGRAM[q.program]?.pocket ?? '',
    status: answered ? 'answered' : 'open',
    claimedBy: '',
    text: { business: q.text, engineer: q.text },
    evidence: fromShadow && refs.length ? { kind: 'shadow', detail: refs.join(' · ') } : { kind: 'none' },
    options: parseList(q.optionsJson),
    routedTo: q.routeTo ? [q.routeTo] : [],
    routedWhy: q.routeWhy,
    // Not sent to Slack yet: treat it as raised now on the sim clock.
    askedAtMs: first ? Number(first.sentAtMs) : nowMs,
    answer: q.answeredBy
      ? { byPersonId: q.answeredBy, text: q.answerText || q.answer, atMs: Number(q.answeredAtMs) }
      : answered
        ? { byPersonId: AGENT_ID, text: q.answer, atMs: Number(q.answeredAtMs) }
        : undefined,
  }
}

/* ------------------------------ source ------------------------------ */

export class SpacetimeSource implements RealtimeSource {
  private mock: MockSource
  private listeners = new Set<SourceListener>()
  private conn: DbConnection | null = null
  private ready = false
  private live: Live = {
    people: new Map(),
    teams: new Map(),
    managers: new Map(),
    ownership: new Map(),
    approvers: new Map(),
    questions: new Map(),
    outreach: new Map(),
  }
  readonly req: ReqActions

  constructor(opts: StdbOptions, scenarioId?: string) {
    this.mock = new MockSource(scenarioId)
    // The mock resets its world on Reset; put the live rows back on top each time.
    this.mock.subscribe((e) => this.emit(e.type === 'reqWorld' && this.ready ? { type: 'reqWorld', world: this.overlay(e.world) } : e))
    const mockReq = this.mock.req
    const overrides: Partial<ReqActions> = {
      world: () => (this.ready ? this.overlay(mockReq.world()) : mockReq.world()),
      // Live questions are answered through the reducer; the mock's own seed questions stay local.
      answerQuestion: (questionId, text, as, viaHitId) => {
        if (this.conn && this.live.questions.has(questionId)) {
          this.conn.reducers.answerQuestion({ questionId, answer: text, answeredBy: as }).catch((err: unknown) => console.warn('[SpacetimeSource] answerQuestion failed', err))
        } else mockReq.answerQuestion(questionId, text, as, viaHitId)
      },
    }
    // Every other action runs on the mock itself, so its state stays in one place.
    this.req = new Proxy(mockReq, {
      get: (target, prop) => {
        if (prop in overrides) return overrides[prop as keyof ReqActions]
        const v: unknown = Reflect.get(target, prop)
        return typeof v === 'function' ? v.bind(target) : v
      },
    })
    void this.connect(opts)
  }

  /* ---------------------------- connection ---------------------------- */

  private async connect({ uri, database }: StdbOptions) {
    try {
      // Loaded on demand so the offline demo never pulls in the SDK.
      const { DbConnection } = await import('../../../packages/shared/src/module_bindings')
      const conn = await new Promise<DbConnection>((resolve, reject) => {
        DbConnection.builder()
          .withUri(uri)
          .withDatabaseName(database)
          .onConnect((c) => resolve(c))
          .onConnectError((_ctx, err) => reject(err))
          .build()
      })
      this.conn = conn
      this.watch(conn)
      await new Promise<void>((ok, fail) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => ok())
          .onError((ctx) => fail(ctx.event ?? new Error('subscription failed')))
          .subscribe([
            'SELECT * FROM person',
            'SELECT * FROM team',
            'SELECT * FROM reports_to',
            'SELECT * FROM ownership',
            'SELECT * FROM approver',
            'SELECT * FROM question',
            'SELECT * FROM outreach',
          ])
      })
      this.ready = true
      this.emit({ type: 'reqWorld', world: this.overlay(this.mock.req.world()) })
    } catch (err) {
      console.warn(`[SpacetimeSource] SpacetimeDB at ${uri}/${database} isn't reachable; showing mock data.`, err)
    }
  }

  /** Mirror table changes into `live`, then push the affected slice to the store. */
  private watch(conn: DbConnection) {
    const db = conn.db
    const people = () => this.ready && this.emit(this.peopleEvent())
    db.person.onInsert((_c, r) => { this.live.people.set(r.id, r); people() })
    db.person.onUpdate((_c, _o, r) => { this.live.people.set(r.id, r); people() })
    db.person.onDelete((_c, r) => { this.live.people.delete(r.id); people() })
    db.team.onInsert((_c, r) => { this.live.teams.set(r.id, r); people() })
    db.team.onUpdate((_c, _o, r) => { this.live.teams.set(r.id, r); people() })
    db.team.onDelete((_c, r) => { this.live.teams.delete(r.id); people() })
    db.reportsTo.onInsert((_c, r) => { this.live.managers.set(r.personId, r.managerId); people() })
    db.reportsTo.onDelete((_c, r) => { this.live.managers.delete(r.personId); people() })
    db.ownership.onInsert((_c, r) => { this.live.ownership.set(r.id, r); people() })
    db.ownership.onUpdate((_c, _o, r) => { this.live.ownership.set(r.id, r); people() })
    db.ownership.onDelete((_c, r) => { this.live.ownership.delete(r.id); people() })
    db.approver.onInsert((_c, r) => { this.live.approvers.set(r.id, r); people() })
    db.approver.onUpdate((_c, _o, r) => { this.live.approvers.set(r.id, r); people() })
    db.approver.onDelete((_c, r) => { this.live.approvers.delete(r.id); people() })

    const question = (id: string) => {
      const q = this.live.questions.get(id)
      if (this.ready && q) this.emit({ type: 'questionUpserted', question: toQuestion(q, this.sentFor(id), this.mock.req.world().nowMs) })
    }
    db.question.onInsert((_c, r) => { this.live.questions.set(r.id, r); question(r.id) })
    db.question.onUpdate((_c, _o, r) => { this.live.questions.set(r.id, r); question(r.id) })
    db.outreach.onInsert((_c, r) => {
      this.live.outreach.set(r.id, r)
      if (this.ready) this.emit({ type: 'outreachUpserted', outreach: toOutreach(r) })
      question(r.questionId)
    })
    db.outreach.onUpdate((_c, _o, r) => {
      this.live.outreach.set(r.id, r)
      if (this.ready) this.emit({ type: 'outreachUpserted', outreach: toOutreach(r) })
    })
  }

  private sentFor(questionId: string) {
    return [...this.live.outreach.values()].filter((o) => o.questionId === questionId)
  }

  private livePeople(): Person[] {
    return [...this.live.people.values()].map((p) => toPerson(p, this.live.managers))
  }

  private peopleEvent(): SourceEvent {
    const live = this.livePeople()
    // Seed people stay so the seeded requirements' authors and approvers still resolve by name.
    const people = [...Object.values(this.mock.req.world().people), ...live]
    const teams = [...this.live.teams.values()].map((t) => toTeam(t, live))
    const ownership = [...this.live.ownership.values()].filter((o) => !o.personId.startsWith('team:')).map(toOwnership)
    const approvers = [...this.live.approvers.values()].map(toApprover)
    return { type: 'peopleLoaded', people, teams, approvers, ownership }
  }

  /** The mock world with the live tables laid over it. */
  private overlay(w: ReqWorld): ReqWorld {
    const live = this.livePeople()
    const questions = { ...w.questions }
    for (const q of this.live.questions.values()) questions[q.id] = toQuestion(q, this.sentFor(q.id), w.nowMs)
    const outreach = { ...w.outreach }
    for (const o of this.live.outreach.values()) outreach[`out-${o.id}`] = toOutreach(o)
    return {
      ...w,
      people: { ...w.people, ...Object.fromEntries(live.map((p) => [p.id, p])) },
      teams: Object.fromEntries([...this.live.teams.values()].map((t) => [t.id, toTeam(t, live)])),
      ownership: [...this.live.ownership.values()].filter((o) => !o.personId.startsWith('team:')).map(toOwnership),
      approvers: [...this.live.approvers.values()].map(toApprover),
      questions,
      outreach,
    }
  }

  /* ---------------------------- plumbing ---------------------------- */

  private emit(e: SourceEvent) {
    for (const l of this.listeners) l(e)
  }

  subscribe(listener: SourceListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // The shadow-run half is still the scripted mock.
  getSnapshot = () => this.mock.getSnapshot()
  scenarios = () => this.mock.scenarios()
  pendingQuestions = () => this.mock.pendingQuestions()
  play = () => this.mock.play()
  pause = () => this.mock.pause()
  reset = () => this.mock.reset()
  loadScenario = (id: string) => this.mock.loadScenario(id)
  simulateSlackAnswer: RealtimeSource['simulateSlackAnswer'] = (a) => this.mock.simulateSlackAnswer(a)
  setCutover: RealtimeSource['setCutover'] = (s) => this.mock.setCutover(s)
  isPlaying = () => this.mock.isPlaying()
  setAutoReplay = (on: boolean) => this.mock.setAutoReplay(on)
  isAutoReplay = () => this.mock.isAutoReplay()
}
