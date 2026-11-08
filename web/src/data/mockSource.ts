import type { CutoverStage, DecisionAnswer, Snapshot } from '@/types'
import type { RealtimeSource, SourceEvent, SourceListener } from '@/data/source'
import { MockDecider } from '@/data/jev'
import { buildSnapshot, getScenario, SCENARIOS, type Scenario } from '@/data/scenarios'
import { ReqMock } from '@/data/reqMock'
import { PROGRAM } from '@/data/carddemo'

/* ------------------------------------------------------------------ *
 * MockSource — scripted, fully offline replay engine.
 *
 * Owns the scenario script + a cursor. Emits semantic SourceEvents that
 * the store reduces into snapshots. Nothing here touches the network.
 *
 *   play()/pause()      ambient "alive" activity (agent thoughts)
 *   simulateSlackAnswer the hero moment — pops the next planned decision,
 *                       match rate JUMPS, a test is generated
 *   setAutoReplay       hands-free end-to-end run (demo safety net)
 * ------------------------------------------------------------------ */

/** Who owns what, and how we found them (for Slack / GitHub routing). */
const OWNER_META: Record<string, { team: string; routedBy: string }> = {
  '@priya': { team: 'Finance', routedBy: 'CODEOWNERS' },
  '@aayush': { team: 'Platform', routedBy: 'git blame' },
  '@marcus': { team: 'Operations', routedBy: 'git blame' },
  '@lee': { team: 'Customer', routedBy: 'CODEOWNERS' },
  '@sam': { team: 'Platform', routedBy: 'CODEOWNERS' },
  '@dev': { team: 'Platform', routedBy: 'git blame' },
}

const AMBIENT_THOUGHTS = [
  'Replaying captured inputs through old + new in parallel…',
  'Noise filter: dropped volatile fields (timestamps, sequence ids).',
  'Re-clustering residual mismatches by AST diff of the branch taken.',
  'Confidence on remaining groups holding steady.',
  'Golden-master cache warm — reruns completing in <2s.',
]

export class MockSource implements RealtimeSource {
  private scenario: Scenario
  private snapshot: Snapshot
  private listeners = new Set<SourceListener>()
  private decider = new MockDecider()

  private cursor = 0 // index into decisionScript
  private currentRate: number
  private cutoverStage: CutoverStage = 0
  private playing = false
  private autoReplay = false
  private ambientTimer: number | null = null
  private autoTimer: number | null = null
  private ambientIdx = 0
  private seq = 0 // monotonic id suffix
  /** requirements layer: questions, requirements, approvals, people */
  readonly req: ReqMock

  constructor(scenarioId: string = SCENARIOS[0].id) {
    this.scenario = getScenario(scenarioId)
    this.snapshot = buildSnapshot(this.scenario)
    this.currentRate = this.scenario.component.matchRate
    this.req = new ReqMock((e) => this.emit(e))
    this.req.start()
  }

  /* --------------------------- plumbing --------------------------- */

  getSnapshot(): Snapshot {
    return this.snapshot
  }

  subscribe(listener: SourceListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  scenarios() {
    return SCENARIOS.map((s) => ({ id: s.id, name: s.name }))
  }

  pendingQuestions() {
    const remaining = this.scenario.decisionScript.slice(this.cursor)
    return remaining.map((d, i) => {
      const m = this.scenario.mismatches.find((x) => x.rootCauseGroup === d.groupId)
      const meta = OWNER_META[d.answeredBy] ?? { team: 'Engineering', routedBy: 'git blame' }
      const fmt = (o?: Record<string, unknown>) =>
        o ? Object.values(o).map(String).join(', ') : '—'
      return {
        groupId: d.groupId,
        question: d.question,
        owner: d.answeredBy,
        team: meta.team,
        routedBy: meta.routedBy,
        cases: d.resolvedCount,
        confidence: m?.categoryConfidence ?? 0.9,
        category: m?.category ?? 'logic',
        input: m ? fmt(m.input) : '—',
        old: m ? fmt(m.oldOut) : '—',
        new: m ? fmt(m.newOut) : '—',
        snippetOld: m?.snippet.old ?? '',
        snippetNew: m?.snippet.new ?? '',
        testId: d.testId,
        active: i === 0,
      }
    })
  }

  private emit(event: SourceEvent) {
    for (const l of this.listeners) l(event)
  }

  private uid(prefix: string) {
    return `${prefix}-${this.scenario.id}-${++this.seq}`
  }

  /* --------------------------- controls --------------------------- */

  play() {
    if (this.playing) return
    this.playing = true
    this.ambientTimer = window.setInterval(() => this.ambientTick(), 1900)
  }

  pause() {
    this.playing = false
    if (this.ambientTimer !== null) {
      window.clearInterval(this.ambientTimer)
      this.ambientTimer = null
    }
  }

  isPlaying() {
    return this.playing
  }

  reset() {
    this.loadScenario(this.scenario.id)
    this.req.reset()
  }

  loadScenario(id: string) {
    const wasPlaying = this.playing
    const wasAuto = this.autoReplay
    this.pause()
    this.setAutoReplay(false)
    this.scenario = getScenario(id)
    this.snapshot = buildSnapshot(this.scenario)
    this.currentRate = this.scenario.component.matchRate
    this.cutoverStage = 0
    this.cursor = 0
    this.seq = 0
    this.ambientIdx = 0
    this.emit({ type: 'snapshot', snapshot: this.snapshot })
    if (wasPlaying) this.play()
    if (wasAuto) this.setAutoReplay(true)
  }

  isAutoReplay() {
    return this.autoReplay
  }

  setAutoReplay(on: boolean) {
    this.autoReplay = on
    if (on) {
      if (!this.playing) this.play()
      // Fire the first answer shortly, then on a cadence.
      this.autoTimer = window.setInterval(() => this.autoStep(), 3600)
    } else if (this.autoTimer !== null) {
      window.clearInterval(this.autoTimer)
      this.autoTimer = null
    }
  }

  setCutover(stage: CutoverStage) {
    // Guarded by the UI too, but enforce the threshold here as well.
    if (stage > 0 && this.currentRate < this.scenario.threshold) return
    // the requirements gate (§7.2): no canary until requirements are approved and verified
    const pocket = PROGRAM[this.scenario.component.id]?.pocket
    const blocked = stage > 0 && pocket ? this.req.cutoverBlocked(pocket) : ''
    if (blocked) {
      this.emit({ type: 'agentThought', thought: { id: this.uid('t'), at: new Date().toISOString(), phase: 'shadow', text: `Cutover held. ${blocked}.`, model: 'Nemotron' } })
      if (this.autoReplay) this.setAutoReplay(false)
      return
    }
    this.cutoverStage = stage
    this.emit({ type: 'cutover', stage })
    if (stage === 100) this.emit({ type: 'statusChange', status: 'cutover' })
  }

  /** A synthetic snapshot reflecting live progress, for re-running Jev. */
  private jevView(): Snapshot {
    const resolvedGroups = new Set(
      this.scenario.decisionScript.slice(0, this.cursor).map((d) => d.groupId),
    )
    const atThreshold = this.currentRate >= this.scenario.threshold
    return {
      ...this.snapshot,
      component: {
        ...this.snapshot.component,
        matchRate: this.currentRate,
        status: atThreshold ? 'ready' : 'shadowing',
      },
      // mark resolved mismatches so summarize() sees the open count shrink
      mismatches: this.snapshot.mismatches.map((m) =>
        resolvedGroups.has(m.rootCauseGroup) ? { ...m, status: 'test_generated' } : m,
      ),
      history: [
        ...this.snapshot.history,
        { t: this.cursor + 1, rate: this.currentRate, label: 'progress' },
      ],
      cutoverStage: this.cutoverStage,
    }
  }

  /** The hero moment. */
  simulateSlackAnswer(answer: DecisionAnswer = 'old') {
    if (this.cursor >= this.scenario.decisionScript.length) {
      this.emit({
        type: 'agentThought',
        thought: {
          id: this.uid('t'),
          at: new Date().toISOString(),
          phase: 'ask',
          text: 'No open questions — every root-cause group is resolved.',
          model: 'Nemotron',
        },
      })
      return
    }

    const planned = this.scenario.decisionScript[this.cursor++]
    const resolvedIds = this.scenario.mismatches
      .filter((m) => m.rootCauseGroup === planned.groupId)
      .map((m) => m.id)

    const decisionId = this.uid('d')
    const now = new Date().toISOString()

    this.emit({
      type: 'decisionMade',
      decision: {
        id: decisionId,
        groupId: planned.groupId,
        componentId: this.scenario.component.id,
        question: planned.question,
        answer,
        answeredBy: planned.answeredBy,
        at: now,
        testId: planned.testId,
        resolvedCount: planned.resolvedCount,
      },
      resolvedIds,
      newRate: planned.newRate,
    })

    this.currentRate = planned.newRate

    // Stream the Nemotron reasoning behind turning the answer into a test.
    planned.thoughts.forEach((text, i) => {
      window.setTimeout(() => {
        this.emit({
          type: 'agentThought',
          thought: {
            id: this.uid('t'),
            at: new Date().toISOString(),
            phase: i === planned.thoughts.length - 1 ? 'test' : 'ask',
            text,
            model: 'Nemotron',
          },
        })
      }, 450 * (i + 1))
    })

    // Re-run Jev for the new state → fresh UI decisions (cutover may unlock).
    window.setTimeout(() => {
      for (const d of this.decider.decideForSnapshot(this.jevView())) {
        this.emit({ type: 'uiDecision', decision: d })
      }
    }, 500)

    if (this.currentRate >= this.scenario.threshold) {
      window.setTimeout(
        () => this.emit({ type: 'statusChange', status: 'ready' }),
        450 * (planned.thoughts.length + 1),
      )
    }
  }

  /* --------------------------- internals -------------------------- */

  private ambientTick() {
    const text = AMBIENT_THOUGHTS[this.ambientIdx % AMBIENT_THOUGHTS.length]
    this.ambientIdx++
    this.emit({
      type: 'agentThought',
      thought: {
        id: this.uid('amb'),
        at: new Date().toISOString(),
        phase: 'shadow',
        text,
        model: 'Nemotron',
      },
    })
  }

  /** Auto-replay driver: answer questions, then walk the cutover up. */
  private autoStep() {
    if (this.cursor < this.scenario.decisionScript.length) {
      this.simulateSlackAnswer('old')
      return
    }
    // All answered — advance cutover 1 → 10 → 100, then stop.
    const next: Record<number, CutoverStage> = { 0: 1, 1: 10, 10: 100 }
    const stage = next[this.cutoverStage]
    if (stage) {
      this.setCutover(stage)
    } else {
      this.setAutoReplay(false)
    }
  }
}
