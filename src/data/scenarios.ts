import type {
  AgentThought,
  Component,
  Decision,
  GraphData,
  Mismatch,
  Snapshot,
} from '@/types'
import { MockDecider } from '@/data/jev'

/* ------------------------------------------------------------------ *
 * Scenario presets.
 *
 * Each scenario is fully self-contained demo data: a focused component,
 * a precomputed dependency graph, the open mismatches, and a SCRIPTED
 * sequence of human decisions. The MockSource replays this; nothing here
 * touches the network, so the demo is 100% offline.
 *
 * To prove the system isn't hardcoded to one component, there are two:
 *   - CBTRN02C  Transaction Poster   (rounding / formatting / logic)
 *   - CBACT04C  Interest Calculator  (rounding / logic)
 * ------------------------------------------------------------------ */

/** A planned human answer — popped one at a time to drive match-rate jumps. */
export interface PlannedDecision {
  groupId: string
  question: string
  answeredBy: string
  /** match rate after this group is resolved (0..1) */
  newRate: number
  testId: string
  /** how many mismatches this single answer closes (the batching payoff) */
  resolvedCount: number
  /** reasoning lines the agent emits while turning the answer into a test */
  thoughts: string[]
}

export interface Scenario {
  id: string
  name: string
  component: Component
  graph: GraphData
  mismatches: Mismatch[]
  /** streamed on load to populate the reasoning panel */
  initialThoughts: Omit<AgentThought, 'id' | 'at'>[]
  /** ordered: each Slack answer pops the next one */
  decisionScript: PlannedDecision[]
  noiseBaseline: number
  threshold: number
  /** decisions already made before the demo starts (seed the log) */
  seedDecisions: Decision[]
}

const MODEL = 'Nemotron'

/* ========================= Scenario 1 ============================= */

const cbtrn02cGraph: GraphData = {
  nodes: [
    { id: 'CBACT01C', label: 'Account Master', isolation: 0.41, x: 0, y: 40, isTarget: false },
    { id: 'CBTRN02C', label: 'Transaction Poster', isolation: 0.87, x: 300, y: 0, isTarget: true },
    { id: 'CBTRN01C', label: 'Txn Validator', isolation: 0.63, x: 300, y: 180, isTarget: false },
    { id: 'CBCUS01C', label: 'Customer Reader', isolation: 0.52, x: 0, y: 220, isTarget: false },
    { id: 'CBSTM03A', label: 'Statement Writer', isolation: 0.33, x: 600, y: 60, isTarget: false },
    { id: 'DALYREJS', label: 'Reject File', isolation: 0.74, x: 600, y: 230, isTarget: false },
  ],
  edges: [
    { id: 'e1', source: 'CBACT01C', target: 'CBTRN02C', kind: 'call' },
    { id: 'e2', source: 'CBTRN01C', target: 'CBTRN02C', kind: 'call' },
    { id: 'e3', source: 'CBCUS01C', target: 'CBTRN01C', kind: 'call' },
    { id: 'e4', source: 'CBTRN02C', target: 'CBSTM03A', kind: 'call' },
    { id: 'e5', source: 'CBTRN02C', target: 'DALYREJS', kind: 'shared-file' },
    { id: 'e6', source: 'CBACT01C', target: 'CBSTM03A', kind: 'shared-file' },
  ],
}

const cbtrn02cMismatches: Mismatch[] = [
  {
    id: 'm41',
    componentId: 'CBTRN02C',
    category: 'rounding',
    classification: 'unmade-decision',
    rootCauseGroup: 'g7',
    title: 'Interest rounds down instead of half-even',
    input: { balance: 1024.555, rate: 0.015, cycle: 'DEC' },
    oldOut: { interest: 15.37 },
    newOut: { interest: 15.36 },
    snippet: {
      old: "COMPUTE WS-INT ROUNDED = WS-BAL * WS-RATE\n    ON SIZE ERROR MOVE ZERO TO WS-INT",
      new: 'const interest = Math.round(bal * rate * 100) / 100 // floor bias',
    },
    status: 'asked',
  },
  {
    id: 'm42',
    componentId: 'CBTRN02C',
    category: 'rounding',
    classification: 'unmade-decision',
    rootCauseGroup: 'g7',
    title: 'Penny difference on fee proration',
    input: { fee: 30, days: 17, period: 30 },
    oldOut: { prorated: 17.0 },
    newOut: { prorated: 16.99 },
    snippet: {
      old: 'COMPUTE WS-FEE ROUNDED = (FEE * DAYS) / PERIOD',
      new: 'const prorated = Math.round((fee * days) / period * 100) / 100',
    },
    status: 'open',
  },
  {
    id: 'm43',
    componentId: 'CBTRN02C',
    category: 'formatting',
    classification: 'unmade-decision',
    rootCauseGroup: 'g3',
    title: 'Date emitted as ISO instead of MM/DD/YY',
    input: { postDate: '2026-11-07' },
    oldOut: { date: '11/07/26' },
    newOut: { date: '2026-11-07' },
    snippet: {
      old: 'STRING MM "/" DD "/" YY DELIMITED BY SIZE INTO WS-DATE',
      new: 'const date = d.toISOString().slice(0, 10)',
    },
    status: 'open',
  },
  {
    id: 'm44',
    componentId: 'CBTRN02C',
    category: 'logic',
    classification: 'unmade-decision',
    rootCauseGroup: 'g9',
    title: 'Overdraft fee applied at $0.00 balance',
    input: { balance: 0.0, withdrawal: 0.0 },
    oldOut: { fee: 0 },
    newOut: { fee: 35 },
    snippet: {
      old: 'IF WS-BAL < ZERO\n    ADD OD-FEE TO WS-CHARGES',
      new: 'if (balance <= 0) charges += OD_FEE // off-by-equals',
    },
    status: 'open',
  },
  {
    id: 'm45',
    componentId: 'CBTRN02C',
    category: 'noise',
    classification: 'noise',
    rootCauseGroup: 'gN',
    title: 'Trace timestamp differs (non-deterministic)',
    input: { txn: 'T-8841' },
    oldOut: { trace: '14:02:11.004' },
    newOut: { trace: '14:02:11.006' },
    snippet: {
      old: 'MOVE FUNCTION CURRENT-DATE TO WS-TRACE',
      new: 'const trace = clock.now() // volatile — filtered',
    },
    status: 'open',
  },
  {
    id: 'm40',
    componentId: 'CBTRN02C',
    category: 'logic',
    classification: 'defect',
    rootCauseGroup: 'g0',
    title: 'Old code double-counts reversal on retry (agent auto-fixed)',
    input: { txn: 'T-5521', retry: true },
    oldOut: { posted: 2, note: 'duplicate on retry' },
    newOut: { posted: 1 },
    snippet: {
      old: 'PERFORM POST-TXN\n*> no idempotency guard on retry',
      new: 'if (!seen.has(txn.id)) post(txn) // idempotent',
    },
    // A defect contradicts an agreed invariant (post-once). The agent fixes it
    // silently and never asks a human — status is already a generated test.
    status: 'test_generated',
  },
]

const scenario1: Scenario = {
  id: 'cbtrn02c',
  name: 'Transaction Poster · CBTRN02C',
  threshold: 0.99,
  noiseBaseline: 0.998,
  component: {
    id: 'CBTRN02C',
    name: 'Transaction Poster',
    isolation: 0.87,
    coverage: 0.4,
    status: 'shadowing',
    matchRate: 0.82,
    language: 'COBOL',
    whyPicked:
      'Highest isolation score (0.87) in the batch. Two callers, one shared file, no global working-storage leaks — the safest first cut.',
  },
  graph: cbtrn02cGraph,
  mismatches: cbtrn02cMismatches,
  initialThoughts: [
    { phase: 'shadow', model: MODEL, text: 'Replayed 2,418 captured inputs through old + new. 1,982 exact matches (82.0%).' },
    { phase: 'triage', model: MODEL, text: 'Clustered 436 mismatches into 4 root-cause groups. Filtered 1 noise group (volatile timestamps).' },
    { phase: 'ask', model: MODEL, text: 'Group g7 (rounding, 14 cases) is ambiguous: COBOL ROUNDED is banker’s rounding, rewrite uses half-up. Escalating to @aayush.' },
  ],
  seedDecisions: [
    {
      id: 'd1',
      groupId: 'g2',
      componentId: 'CBTRN02C',
      question: 'Should negative balances block posting entirely?',
      answer: 'old',
      answeredBy: '@priya',
      at: '2026-11-07T20:41:00Z',
      testId: 't07',
      resolvedCount: 23,
    },
  ],
  decisionScript: [
    {
      groupId: 'g7',
      question: 'Rounding: old uses banker’s rounding (half-even), new uses half-up. Which is correct?',
      answeredBy: '@aayush',
      newRate: 0.94,
      testId: 't19',
      resolvedCount: 14,
      thoughts: [
        'Answer = OLD (banker’s rounding). Regulation DD requires half-even on interest accrual.',
        'Rewrote rounding to Math round half-to-even. Froze golden master into test t19.',
        'Re-ran 14 cases in g7 → all match. Match rate 82.0% → 94.0%.',
      ],
    },
    {
      groupId: 'g3',
      question: 'Date format: emit MM/DD/YY (old) or ISO-8601 (new)?',
      answeredBy: '@priya',
      newRate: 0.985,
      testId: 't20',
      resolvedCount: 8,
      thoughts: [
        'Answer = OLD. Downstream statement writer CBSTM03A parses fixed-width MM/DD/YY.',
        'Pinned formatter, generated test t20. Match rate 94.0% → 98.5%.',
      ],
    },
    {
      groupId: 'g9',
      question: 'Overdraft fee at exactly $0.00 balance: charge (new) or skip (old)?',
      answeredBy: '@aayush',
      newRate: 0.994,
      testId: 't21',
      resolvedCount: 5,
      thoughts: [
        'Answer = OLD. Fee applies only on strictly negative balance (< 0), not <= 0.',
        'Fixed boundary condition, generated test t21. Match rate 98.5% → 99.4%. Threshold met — cutover unlocked.',
      ],
    },
  ],
}

/* ========================= Scenario 2 ============================= */

const cbact04cGraph: GraphData = {
  nodes: [
    { id: 'CBACT04C', label: 'Interest Calculator', isolation: 0.79, x: 300, y: 10, isTarget: true },
    { id: 'CBACT01C', label: 'Account Master', isolation: 0.44, x: 0, y: 70, isTarget: false },
    { id: 'DISCGRP', label: 'Rate Table', isolation: 0.81, x: 0, y: 220, isTarget: false },
    { id: 'CBTRN03C', label: 'Posting Engine', isolation: 0.57, x: 300, y: 200, isTarget: false },
    { id: 'CBSTM03A', label: 'Statement Writer', isolation: 0.3, x: 600, y: 120, isTarget: false },
  ],
  edges: [
    { id: 'e1', source: 'CBACT01C', target: 'CBACT04C', kind: 'call' },
    { id: 'e2', source: 'DISCGRP', target: 'CBACT04C', kind: 'shared-file' },
    { id: 'e3', source: 'CBACT04C', target: 'CBTRN03C', kind: 'call' },
    { id: 'e4', source: 'CBACT04C', target: 'CBSTM03A', kind: 'call' },
  ],
}

const cbact04cMismatches: Mismatch[] = [
  {
    id: 'n11',
    componentId: 'CBACT04C',
    category: 'rounding',
    classification: 'unmade-decision',
    rootCauseGroup: 'h2',
    title: 'Daily accrual truncates at 4th decimal',
    input: { principal: 5000, apr: 0.1899, days: 1 },
    oldOut: { accrual: 2.6014 },
    newOut: { accrual: 2.6015 },
    snippet: {
      old: 'COMPUTE WS-ACCR = WS-PRIN * (WS-APR / 365)',
      new: 'const accr = prin * (apr / 365) // full float, no truncation',
    },
    status: 'asked',
  },
  {
    id: 'n12',
    componentId: 'CBACT04C',
    category: 'logic',
    classification: 'unmade-decision',
    rootCauseGroup: 'h5',
    title: 'Leap-year day count uses 365 not 366',
    input: { year: 2028, apr: 0.12 },
    oldOut: { basis: 366 },
    newOut: { basis: 365 },
    snippet: {
      old: 'IF FUNCTION MOD(YYYY, 4) = 0 MOVE 366 TO WS-BASIS',
      new: 'const basis = 365 // leap-year rule dropped',
    },
    status: 'open',
  },
  {
    id: 'n13',
    componentId: 'CBACT04C',
    category: 'rounding',
    classification: 'unmade-decision',
    rootCauseGroup: 'h2',
    title: 'Grace-period interest off by a cent',
    input: { principal: 1200, apr: 0.0, days: 25 },
    oldOut: { interest: 0.0 },
    newOut: { interest: 0.01 },
    snippet: {
      old: 'IF WS-APR = ZERO MOVE ZERO TO WS-INT',
      new: 'const interest = round(prin * (apr/365) * days)',
    },
    status: 'open',
  },
  {
    id: 'n14',
    componentId: 'CBACT04C',
    category: 'noise',
    classification: 'noise',
    rootCauseGroup: 'hN',
    title: 'Record sequence id differs',
    input: { batch: 'B-02' },
    oldOut: { seq: 100481 },
    newOut: { seq: 100482 },
    snippet: {
      old: 'ADD 1 TO WS-SEQ',
      new: 'const seq = nextSeq() // environment-dependent — filtered',
    },
    status: 'open',
  },
]

const scenario2: Scenario = {
  id: 'cbact04c',
  name: 'Interest Calculator · CBACT04C',
  threshold: 0.99,
  noiseBaseline: 0.997,
  component: {
    id: 'CBACT04C',
    name: 'Interest Calculator',
    isolation: 0.79,
    coverage: 0.31,
    status: 'shadowing',
    matchRate: 0.76,
    language: 'COBOL',
    whyPicked:
      'Isolation 0.79, reads a read-only rate table and the account master. Pure computation, no file writes — easy to shadow in parallel.',
  },
  graph: cbact04cGraph,
  mismatches: cbact04cMismatches,
  initialThoughts: [
    { phase: 'shadow', model: MODEL, text: 'Replayed 1,760 captured inputs. 1,338 exact matches (76.0%).' },
    { phase: 'triage', model: MODEL, text: 'Clustered into 3 root-cause groups + 1 noise group (sequence ids).' },
    { phase: 'ask', model: MODEL, text: 'Group h2 (accrual rounding, 19 cases) ambiguous: truncation vs round-half-up. Escalating to @dev.' },
  ],
  seedDecisions: [],
  decisionScript: [
    {
      groupId: 'h2',
      question: 'Daily accrual: truncate at 4 decimals (old) or round (new)?',
      answeredBy: '@dev',
      newRate: 0.92,
      testId: 't31',
      resolvedCount: 19,
      thoughts: [
        'Answer = OLD. Core system truncates accrual to 4dp before posting; rounding compounds error over a cycle.',
        'Applied truncation, generated test t31. Match rate 76.0% → 92.0%.',
      ],
    },
    {
      groupId: 'h5',
      question: 'Day-count basis in leap years: 366 (old) or 365 (new)?',
      answeredBy: '@priya',
      newRate: 0.993,
      testId: 't32',
      resolvedCount: 12,
      thoughts: [
        'Answer = OLD. Actual/actual basis — leap years use 366. Restored MOD(year,4) rule.',
        'Generated test t32. Match rate 92.0% → 99.3%. Threshold met — cutover unlocked.',
      ],
    },
  ],
}

/* ------------------------------------------------------------------ */

export const SCENARIOS: Scenario[] = [scenario1, scenario2]

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]
}

/** Build the initial snapshot for a scenario (before the timeline runs). */
export function buildSnapshot(scenario: Scenario): Snapshot {
  const decider = new MockDecider()
  const snap: Snapshot = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    component: { ...scenario.component },
    history: [
      { t: 0, rate: scenario.component.matchRate, label: 'shadow start' },
    ],
    // Jev annotates each mismatch with its evidence widget + category confidence.
    mismatches: scenario.mismatches.map((m) => {
      const jev = decider.decideForMismatch(m.category)
      return { ...m, evidenceWidget: jev.widget, categoryConfidence: jev.categoryConfidence }
    }),
    decisions: scenario.seedDecisions.map((d) => ({ ...d })),
    agentLog: scenario.initialThoughts.map((t, i) => ({
      ...t,
      id: `seed-${scenario.id}-${i}`,
      at: `seq-${i}`,
    })),
    uiDecisions: [],
    cutoverStage: 0,
    graph: scenario.graph,
    noiseBaseline: scenario.noiseBaseline,
    threshold: scenario.threshold,
  }
  // Seed the initial Jev UI decisions for the current state.
  snap.uiDecisions = decider.decideForSnapshot(snap)
  return snap
}
