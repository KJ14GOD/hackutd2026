import type {
  AccessGrant,
  Approval,
  Approver,
  ContextHit,
  Conflict,
  HarnessAttempt,
  MigrationJob,
  Outreach,
  Ownership,
  Person,
  Question,
  ReqWorld,
  Requirement,
  RequirementFlag,
  RequirementLink,
  RequirementVersion,
  Team,
  Verification,
} from '@/types'
import { POCKETS, PROGRAM, TEAMS, sourceUrl } from './carddemo'
import { HOUR, T0, impactOf } from './requirements'
import { withFindings } from './findings'

/* ------------------------------------------------------------------ *
 * Demo seed for the requirements layer: a small synthetic org (CardDemo's
 * own commits are by AWS authors, Q14) and requirements drawn from the
 * real posting and interest programs. The story (REQUIREMENTS_ANALYSIS §13):
 * one ambiguous word escalating to a manager, one conflict, a blocked
 * cutover, a change request, a restricted pocket, someone who left.
 * ------------------------------------------------------------------ */

const at = (h: number) => T0 + h * HOUR

/* ------------------------------ people ------------------------------ */

const TEAM_LIST: Team[] = [
  { id: 't-eng', name: 'Engineering', parentTeamId: '', managerId: 'p-elena' },
  { id: 't-finance', name: 'Finance systems', parentTeamId: 't-eng', managerId: 'p-maria' },
  { id: 't-customer', name: 'Customer platform', parentTeamId: 't-eng', managerId: 'p-omar' },
  { id: 't-platform', name: 'Platform', parentTeamId: 't-eng', managerId: 'p-grace' },
  { id: 't-ops', name: 'Batch operations', parentTeamId: 't-eng', managerId: 'p-tom' },
  { id: 't-risk', name: 'Risk & compliance', parentTeamId: '', managerId: 'p-elena' },
  { id: 't-modern', name: 'Modernization (Theseus)', parentTeamId: '', managerId: 'p-alex' },
  { id: 't-external', name: 'External systems', parentTeamId: '', managerId: '' },
]

function person(id: string, name: string, title: string, teamId: string, managerId: string, sources: string[], extra: Partial<Person> = {}): Person {
  const handle = '@' + id.replace(/^p-|^sys-/, '')
  return { id, name, handle, title, teamId, emails: [`${handle.slice(1)}@cardco.example`], active: true, managerId, sources, kind: 'person', ...extra }
}

const PEOPLE: Person[] = [
  person('p-elena', 'Elena Ruiz', 'VP Engineering', 't-eng', '', ['workday', 'slack']),
  person('p-maria', 'Maria Chen', 'Director, finance systems', 't-finance', 'p-elena', ['workday', 'slack', 'confluence']),
  person('p-priya', 'Priya Nair', 'Senior engineer, posting', 't-finance', 'p-maria', ['workday', 'git', 'slack', 'jira']),
  person('p-dev', 'Dev Patel', 'Engineer, interest and fees', 't-finance', 'p-maria', ['workday', 'git', 'slack', 'jira']),
  person('p-omar', 'Omar Haddad', 'Engineering manager, accounts', 't-customer', 'p-elena', ['workday', 'slack']),
  person('p-lee', 'Lee Wong', 'Staff engineer, accounts', 't-customer', 'p-omar', ['workday', 'git', 'slack']),
  person('p-grace', 'Grace Kim', 'Head of platform', 't-platform', 'p-elena', ['workday', 'slack', 'confluence']),
  person('p-sam', 'Sam Okafor', 'Platform lead', 't-platform', 'p-grace', ['workday', 'git', 'slack']),
  person('p-aayush', 'Aayush Rao', 'Platform engineer', 't-platform', 'p-grace', ['workday', 'git', 'slack']),
  person('p-tom', 'Tom Becker', 'Operations manager', 't-ops', 'p-elena', ['workday', 'slack']),
  person('p-marcus', 'Marcus Bell', 'Batch operations lead', 't-ops', 'p-tom', ['workday', 'slack', 'confluence', 'jira']),
  person('p-riley', 'Riley Shaw', 'Compliance analyst', 't-risk', 'p-elena', ['workday', 'jira']),
  person('p-hal', 'Hal Morgan', 'Senior engineer, statements (left Oct 2026)', 't-customer', 'p-omar', ['git', 'workday'], { active: false, successorId: 'p-lee' }),
  person('p-alex', 'Alex Rivera', 'Forward deployed engineer', 't-modern', '', ['slack']),
  person('p-agent', 'Theseus agent', 'Drafts requirements from code and runtime', 't-modern', '', ['theseus'], { kind: 'system', handle: '@theseus' }),
  person('sys-fraud', 'Fraud reporting', 'External system: reads the reject file at 06:00', 't-external', '', ['runbook'], { kind: 'system' }),
  person('sys-gl', 'General ledger feed', 'External system: takes the posted-transaction extract', 't-external', '', ['runbook'], { kind: 'system' }),
]

const TEAM_OWNER: Record<string, string> = { finance: 'p-priya', customer: 'p-lee', platform: 'p-sam', operations: 'p-marcus' }

function ownershipSeed(): Ownership[] {
  const out: Ownership[] = []
  let n = 0
  const own = (personId: string, target: string, kind: Ownership['kind'], signal: Ownership['signal'], weight: number, source: string, evidence: string, h = -400) =>
    out.push({ id: `OW-${++n}`, personId, target, kind, signal, weight, source, evidence, observedAtMs: at(h) })
  for (const p of POCKETS) {
    const who = TEAM_OWNER[p.team]
    if (p.id === 'pkt-cbstm03a') continue // set below: the owner left
    own(who, p.id, 'owns', 'codeowners', 0.9, `CODEOWNERS: ${p.programs[0]}* → ${TEAMS[p.team].owner}`, `${TEAMS[p.team].name} team owns ${p.programs.join(', ')}`)
  }
  own('p-dev', 'pkt-cbtrn02c', 'contributes', 'git-blame', 0.74, 'git log 2019–2024', '61% of current CBACT04C lines')
  own('p-maria', 'pkt-cbtrn02c', 'consulted', 'org-chart', 0.6, 'Workday: manages Finance systems', 'Signs off rate and fee changes (Confluence: Finance approvals)')
  own('sys-fraud', 'pkt-cbtrn02c', 'consumes', 'runbook', 0.8, 'Ops runbook, step 7', 'Fraud report reads DALYREJS at 06:00 every day')
  own('sys-gl', 'pkt-cbtrn02c', 'consumes', 'runbook', 0.7, 'Ops runbook, step 9', 'GL feed takes the TRANSACT extract after posting')
  own('p-hal', 'pkt-cbstm03a', 'owns', 'git-blame', 0.82, 'git log 2017–2026', 'Wrote 78% of CBSTM03A/B; left the company Oct 2026')
  own('p-lee', 'pkt-cbstm03a', 'owns', 'codeowners', 0.7, 'CODEOWNERS: CBSTM03* → @lee', 'Customer platform team')
  own('p-riley', 'pkt-cousr00c', 'consulted', 'jira-assignee', 0.66, 'Jira SEC-88', 'Assignee on the password-storage finding')
  own('p-dev', 'pkt-cotrn00c', 'contributes', 'jira-assignee', 0.58, 'Jira CARD-377', 'Fixed bill-pay rounding in 2025')
  own('p-marcus', 'pkt-cbtrn02c', 'consulted', 'runbook', 0.62, 'Ops runbook, step 4', 'Reviews DALYREJS every morning')
  return out
}

function approverSeed(): Approver[] {
  let n = 0
  const a = (personId: string, scope: string, category: Approver['category'], score: number, evidence: string[], change?: Approver['change']): Approver => ({
    id: `AV-${++n}`,
    personId,
    scope,
    category,
    score,
    evidence,
    signedOff: !change,
    change,
  })
  return [
    a('p-priya', 'pkt-cbtrn02c', '*', 0.88, ['CODEOWNERS for CBTRN02C and CBACT04C', '112 commits since 2019', 'Approved 9 earlier decisions']),
    a('p-maria', 'pkt-cbtrn02c', 'business-rule', 0.93, ['Director of finance systems (Workday)', 'Signs off rate changes (Confluence)']),
    a('p-dev', 'pkt-cbtrn02c', 'behavior', 0.64, ['git blame: 61% of CBACT04C'], 'new'),
    a('p-marcus', 'pkt-cbtrn02c', 'performance', 0.7, ['Runs the nightly cycle (runbook)']),
    a('p-maria', 'pkt-cotrn00c', 'business-rule', 0.9, ['Director of finance systems (Workday)']),
    a('p-priya', 'pkt-cotrn00c', '*', 0.72, ['CODEOWNERS for COBIL00C', 'Score rose past 0.7 this week'], 'crossed-threshold'),
    a('p-lee', 'pkt-coactupc', '*', 0.9, ['CODEOWNERS for COACTUPC', '204 commits']),
    a('p-lee', 'pkt-cbstm03a', '*', 0.76, ['CODEOWNERS for CBSTM03*', 'Suggested successor to Hal Morgan']),
    a('p-hal', 'pkt-cbstm03a', 'behavior', 0.7, ['git blame: 78% of CBSTM03A', 'Left the company Oct 2026'], 'left'),
    a('p-sam', 'pkt-cousr00c', 'security', 0.91, ['CODEOWNERS for COUSR0*', 'RACF admin for USRSEC']),
    a('p-riley', 'pkt-cousr00c', 'security', 0.78, ['Compliance owner of SEC-88']),
    a('p-sam', 'pkt-shared', '*', 0.85, ['CODEOWNERS for COSGN00C, COMEN01C']),
    a('p-sam', 'codebase', 'technology', 0.8, ['Platform lead (Workday)']),
    a('p-grace', 'codebase', '*', 0.86, ['Head of platform (Workday)', 'Owns the architecture decision log']),
    a('p-marcus', 'pkt-paudblod', '*', 0.84, ['Runs authorization purge jobs (runbook)']),
    a('p-marcus', 'pkt-cobswait', '*', 0.8, ['Runs batch scheduling (runbook)']),
    a('p-marcus', 'pkt-cbact01c', '*', 0.55, ['Score fell below 0.6: no activity in 18 months'], 'removed'),
  ]
}

const ACCESS: AccessGrant[] = ['p-sam', 'p-grace', 'p-riley', 'p-aayush', 'p-alex', 'p-elena'].map((personId) => ({
  personId,
  scope: 'pkt-cousr00c',
  sourcePermission: personId === 'p-riley' || personId === 'p-elena' ? 'RACF dataset USRSEC (audit read)' : 'GitHub team platform + RACF USRSEC',
}))

/* --------------------------- requirements --------------------------- */

interface VSeed {
  statement: string
  actor: string
  condition: string
  outcome: string
  measure: string
  rationale: string
  author: string
  h: number
  reason: string
}
interface RSeed {
  id: string
  scope: string
  pocketId: string
  category: Requirement['category']
  type: Requirement['type']
  status: Requirement['status']
  owner: string
  restricted?: boolean
  versions: VSeed[]
  flags?: Omit<RequirementFlag, 'id' | 'versionId'>[]
  links: Omit<RequirementLink, 'id' | 'requirementId'>[]
}

const code = (program: string, lines: string, para: string, evidence: string): RSeed['links'][number] => ({
  kind: 'code',
  ref: `${program}.cbl:${lines} · ${para}`,
  evidence,
  origin: 'code',
  title: `${program} · ${para}`,
  url: sourceUrl(program),
  program,
})

const REQS: RSeed[] = [
  {
    id: 'REQ-cbtrn02c-1b7e40c9d2',
    scope: 'CBTRN02C',
    pocketId: 'pkt-cbtrn02c',
    category: 'behavior',
    type: 'functional',
    status: 'approved',
    owner: 'p-priya',
    versions: [
      {
        statement: 'When a daily transaction’s card number has no cross-reference record, posting rejects it with reason code 100 and writes it to the reject file.',
        actor: 'Posting batch (CBTRN02C)',
        condition: 'The card number is not found in CARDXREF',
        outcome: 'Reject with code 100 and write the record to DALYREJS',
        measure: 'Every such record; none reach an account balance',
        rationale: 'Unknown cards must never change a balance.',
        author: 'p-agent',
        h: -60,
        reason: 'First draft from CBTRN02C and a captured batch run',
      },
    ],
    links: [
      code('CBTRN02C', '410-421', '1500-B-LOOKUP-XREF', "READ XREF-FILE ... INVALID KEY\n  MOVE 100 TO WS-VALIDATION-FAIL-REASON\n  MOVE 'INVALID CARD NUMBER FOUND' TO WS-VALIDATION-FAIL-REASON-DESC"),
      { kind: 'source', ref: 'runtime:dalytran-2026-11-06', evidence: '14 of 2,000 captured records were rejected with code 100; none were posted.', origin: 'runtime', title: 'Captured batch run, 6 Nov' },
    ],
  },
  {
    id: 'REQ-cbtrn02c-5c02e8a1f4',
    scope: 'CBTRN02C',
    pocketId: 'pkt-cbtrn02c',
    category: 'behavior',
    type: 'functional',
    status: 'approved',
    owner: 'p-priya',
    versions: [
      {
        statement: 'Posting rejects a transaction with reason code 102 when the account is over its credit limit.',
        actor: 'Posting batch (CBTRN02C)',
        condition: 'The account is over its credit limit',
        outcome: 'Reject with code 102',
        measure: 'Every such record',
        rationale: 'Customers cannot spend past their limit.',
        author: 'p-agent',
        h: -50,
        reason: 'First draft from CBTRN02C',
      },
      {
        statement: 'Posting rejects a transaction with reason code 102 when the cycle’s credits minus debits plus the transaction amount would exceed the account’s credit limit.',
        actor: 'Posting batch (CBTRN02C)',
        condition: 'Cycle credits − cycle debits + amount > credit limit',
        outcome: 'Reject with code 102',
        measure: 'Every such record',
        rationale: 'Customers cannot spend past their limit; the check uses cycle totals, not the current balance.',
        author: 'p-priya',
        h: -26,
        reason: 'Clarified what counts toward the limit (answer to Q-0007)',
      },
    ],
    links: [
      code('CBTRN02C', '440-452', '1500-C-LOOKUP-ACCT', 'COMPUTE WS-TEMP-BAL = ACCT-CURR-CYC-CREDIT\n  - ACCT-CURR-CYC-DEBIT + DALYTRAN-AMT\nIF ACCT-CREDIT-LIMIT >= WS-TEMP-BAL ... ELSE\n  MOVE 102 TO WS-VALIDATION-FAIL-REASON'),
      { kind: 'source', ref: 'slack:priya-2026-11-08', evidence: 'It’s cycle credits minus cycle debits plus the new amount. Current balance isn’t used.', origin: 'slack', title: 'Priya Nair, answer to Q-0007' },
    ],
  },
  {
    id: 'REQ-cbtrn02c-9a3d11e05b',
    scope: 'CBACT04C',
    pocketId: 'pkt-cbtrn02c',
    category: 'business-rule',
    type: 'functional',
    status: 'needs-info',
    owner: 'p-priya',
    versions: [
      {
        statement: 'Interest is normally calculated on each category balance at month end.',
        actor: 'Interest batch (CBACT04C)',
        condition: 'Month end',
        outcome: 'One interest transaction per category balance',
        measure: '',
        rationale: 'Interest must match what customers were promised.',
        author: 'p-agent',
        h: -14,
        reason: 'First draft from CBACT04C and the interest runbook',
      },
    ],
    flags: [{ rule: 'ambiguous-word', word: 'normally', questionId: 'Q-0001' }],
    links: [
      code('CBACT04C', '290-310', '1300-COMPUTE-INTEREST', 'COMPUTE WS-MONTHLY-INT\n  = (TRAN-CAT-BAL * DIS-INT-RATE) / 1200'),
      { kind: 'source', ref: 'confluence:FIN/interest-runbook', evidence: 'Interest posts on the last business day of the month.', origin: 'confluence', title: 'Interest calculation runbook', url: 'https://cardco.atlassian.net/wiki/spaces/FIN/pages/interest-runbook' },
    ],
  },
  {
    id: 'REQ-cbtrn02c-e4b7a2c816',
    scope: 'CBACT04C',
    pocketId: 'pkt-cbtrn02c',
    category: 'business-rule',
    type: 'functional',
    status: 'proposed',
    owner: 'p-priya',
    versions: [
      {
        statement: 'Monthly interest for each category balance is the balance times the annual rate, divided by 1,200, rounded half-up to the cent.',
        actor: 'Interest batch (CBACT04C)',
        condition: 'Each category balance with a non-zero rate',
        outcome: 'Interest = balance × rate ÷ 1,200, rounded half-up to the cent',
        measure: 'Matches COBOL to the cent on every captured account',
        rationale: 'Customers are charged exactly what the old system charged.',
        author: 'p-agent',
        h: -12,
        reason: 'First draft from 1300-COMPUTE-INTEREST',
      },
    ],
    links: [code('CBACT04C', '290-310', '1300-COMPUTE-INTEREST', 'COMPUTE WS-MONTHLY-INT ROUNDED\n  = (TRAN-CAT-BAL * DIS-INT-RATE) / 1200')],
  },
  {
    id: 'REQ-cbtrn02c-0f6c93d2a7',
    scope: 'CBTRN02C',
    pocketId: 'pkt-cbtrn02c',
    category: 'behavior',
    type: 'functional',
    status: 'proposed',
    owner: 'p-priya',
    versions: [
      {
        statement: 'Posting rejects a transaction dated after its account’s expiration date with reason code 103.',
        actor: 'Posting batch (CBTRN02C)',
        condition: 'Transaction date is after ACCT-EXPIRAION-DATE',
        outcome: 'Reject with code 103',
        measure: 'Every such record',
        rationale: 'Expired accounts must not take new charges.',
        author: 'p-agent',
        h: -10,
        reason: 'First draft from CBTRN02C',
      },
    ],
    links: [code('CBTRN02C', '455-460', '1500-C-LOOKUP-ACCT', "IF ACCT-EXPIRAION-DATE >= DALYTRAN-ORIG-TS (1:10) ... ELSE\n  MOVE 103 TO WS-VALIDATION-FAIL-REASON")],
  },
  {
    id: 'REQ-cbtrn02c-7d21b5e0c3',
    scope: 'pkt-cbtrn02c',
    pocketId: 'pkt-cbtrn02c',
    category: 'data',
    type: 'constraint',
    status: 'proposed',
    owner: 'p-priya',
    versions: [
      {
        statement: 'Every TRAN-ID in TRANSACT is unique; posting never overwrites an existing transaction record.',
        actor: 'Posting batch (CBTRN02C)',
        condition: 'Writing a posted transaction',
        outcome: 'A duplicate key fails the write and the record is reported',
        measure: 'Zero overwritten records',
        rationale: 'Statements and the GL feed assume one record per transaction.',
        author: 'p-agent',
        h: -9,
        reason: 'First draft from 2000-POST-TRANSACTION',
      },
    ],
    links: [code('CBTRN02C', '560-575', '2000-POST-TRANSACTION', 'WRITE FD-TRANFILE-REC FROM TRAN-RECORD\n  INVALID KEY ... DISPLAY "ERROR WRITING TO TRANSACTION FILE"')],
  },
  {
    id: 'REQ-cbtrn02c-3e8f0a64b1',
    scope: 'pkt-cbtrn02c',
    pocketId: 'pkt-cbtrn02c',
    category: 'behavior',
    type: 'functional',
    status: 'proposed',
    owner: 'p-priya',
    versions: [
      {
        statement: 'Rejected transactions are retried automatically in the next business day’s posting run.',
        actor: 'Posting batch (CBTRN02C)',
        condition: 'A record was written to DALYREJS',
        outcome: 'It is re-read in the next day’s DALYTRAN input',
        measure: 'Every rejected record is retried once',
        rationale: 'From the 2019 batch operations runbook.',
        author: 'p-agent',
        h: -8,
        reason: 'First draft from the batch operations runbook',
      },
    ],
    links: [{ kind: 'source', ref: 'confluence:OPS/batch-runbook-2019', evidence: 'Rejects in DALYREJS are appended to the next day’s DALYTRAN and retried once.', origin: 'confluence', title: 'Batch operations runbook (2019)', url: 'https://cardco.atlassian.net/wiki/spaces/OPS/pages/batch-runbook' }],
  },
  {
    id: 'REQ-cbtrn02c-b5a9c7d230',
    scope: 'pkt-cbtrn02c',
    pocketId: 'pkt-cbtrn02c',
    category: 'behavior',
    type: 'functional',
    status: 'proposed',
    owner: 'p-priya',
    versions: [
      {
        statement: 'Rejected transactions are never retried automatically; operations reviews the reject file each morning and re-keys valid ones by hand.',
        actor: 'Batch operations team',
        condition: 'A record was written to DALYREJS',
        outcome: 'Reviewed by a person; valid ones re-keyed, the rest closed',
        measure: 'Every rejected record is reviewed by 10:00',
        rationale: 'Auto-retry was removed after duplicate postings in 2022.',
        author: 'p-agent',
        h: -8,
        reason: 'First draft from Jira CARD-412 and Slack',
      },
    ],
    links: [
      { kind: 'source', ref: 'jira:CARD-412', evidence: 'Stop auto-retry of rejects; it double-posted 31 transactions on 2022-03-14.', origin: 'jira', title: 'CARD-412 · Stop auto-retry of rejects (2022)', url: 'https://cardco.atlassian.net/browse/CARD-412' },
      { kind: 'source', ref: 'slack:marcus-2026-10-30', evidence: 'We read DALYREJS every morning and re-key what’s valid. Nothing retries on its own.', origin: 'slack', title: 'Marcus Bell in #batch-ops' },
    ],
  },
  {
    id: 'REQ-cbtrn02c-c19e64f07a',
    scope: 'CBTRN02C',
    pocketId: 'pkt-cbtrn02c',
    category: 'performance',
    type: 'quality',
    status: 'needs-info',
    owner: 'p-marcus',
    versions: [
      {
        statement: 'Nightly posting finishes quickly enough for statements to start on time.',
        actor: 'Posting batch (CBTRN02C)',
        condition: 'Nightly cycle, up to 2 million records',
        outcome: 'Posting completes before statements start',
        measure: '',
        rationale: 'Statements (CBSTM03A) and the GL feed wait on posting.',
        author: 'p-agent',
        h: -21,
        reason: 'First draft from the nightly schedule',
      },
    ],
    flags: [
      { rule: 'vague-quantifier', word: 'quickly', questionId: 'Q-0003' },
      { rule: 'missing-number', word: '', questionId: 'Q-0003' },
    ],
    links: [{ kind: 'source', ref: 'confluence:OPS/nightly-schedule', evidence: 'POSTTRAN → INTCALC → CREASTMT. CREASTMT must finish by 06:00.', origin: 'confluence', title: 'Nightly batch schedule' }],
  },
  {
    id: 'REQ-codebase-2a7c5e91d0',
    scope: 'codebase',
    pocketId: '',
    category: 'technology',
    type: 'constraint',
    status: 'approved',
    owner: 'p-grace',
    versions: [
      {
        statement: 'Rewritten programs run as plain Java 21 with no application framework.',
        actor: 'Every rewritten program',
        condition: 'Always',
        outcome: 'Plain JDK only; no Spring or similar',
        measure: 'Zero framework imports (ArchUnit rule)',
        rationale: 'Keeps the runtime small and the batch start-up fast.',
        author: 'p-grace',
        h: -120,
        reason: 'Architecture decision D-012',
      },
    ],
    links: [{ kind: 'source', ref: 'notion:architecture/D-012', evidence: 'Target: Java 21, plain JDK. No Spring.', origin: 'notion', title: 'Architecture decision D-012' }],
  },
  {
    id: 'REQ-cousr00c-8b1f3d6e29',
    scope: 'pkt-cousr00c',
    pocketId: 'pkt-cousr00c',
    category: 'security',
    type: 'constraint',
    status: 'proposed',
    owner: 'p-sam',
    restricted: true,
    versions: [
      {
        statement: 'User passwords are checked only through the security service; the rewrite never compares plain-text passwords.',
        actor: 'Sign-on and user admin programs',
        condition: 'Any password check or change',
        outcome: 'Call the security service; never read SEC-USR-PWD directly',
        measure: 'Zero reads of SEC-USR-PWD outside the service',
        rationale: 'Closes audit finding SEC-88.',
        author: 'p-agent',
        h: -16,
        reason: 'First draft from COSGN00C and SEC-88',
      },
    ],
    links: [
      code('COUSR01C', '200-214', 'PROCESS-ENTER-KEY', 'MOVE PASSWDI OF COUSR1AI TO SEC-USR-PWD\nWRITE SEC-USER-DATA'),
      { kind: 'source', ref: 'jira:SEC-88', evidence: 'Passwords stored and compared in clear text in USRSEC.', origin: 'jira', title: 'SEC-88 · Plain-text passwords', url: 'https://cardco.atlassian.net/browse/SEC-88' },
    ],
  },
  {
    id: 'REQ-coactupc-41d8e2b6c5',
    scope: 'COACTUPC',
    pocketId: 'pkt-coactupc',
    category: 'behavior',
    type: 'functional',
    status: 'approved',
    owner: 'p-lee',
    versions: [
      {
        statement: 'Account update rejects a ZIP code that does not belong to the customer’s state.',
        actor: 'Account update screen (COACTUPC)',
        condition: 'ZIP prefix not valid for the state code',
        outcome: 'Show “Invalid zip code for state” and keep the old value',
        measure: 'Every update',
        rationale: 'Statements go to the wrong address otherwise.',
        author: 'p-agent',
        h: -70,
        reason: 'First draft from COACTUPC',
      },
    ],
    links: [code('COACTUPC', '2120-2140', '1280-EDIT-US-STATE-ZIP-CD', "IF FUNCTION ... US-STATE-ZIPCODE-TO-EDIT NOT VALID\n  MOVE 'Invalid zip code for state' TO WS-RETURN-MSG")],
  },
  {
    id: 'REQ-coactupc-6e0a9f37b8',
    scope: 'COACTUPC',
    pocketId: 'pkt-coactupc',
    category: 'behavior',
    type: 'functional',
    status: 'proposed',
    owner: 'p-lee',
    versions: [
      {
        statement: 'Account update writes ACCTDATA and CUSTDATA together; if either write fails, neither change is kept.',
        actor: 'Account update screen (COACTUPC)',
        condition: 'The user confirms an update',
        outcome: 'Both records change, or neither does (SYNCPOINT ROLLBACK)',
        measure: 'Every update',
        rationale: 'A half-saved account shows the wrong name on statements.',
        author: 'p-agent',
        h: -6,
        reason: 'First draft from 9600-WRITE-PROCESSING',
      },
    ],
    links: [code('COACTUPC', '3900-3960', '9600-WRITE-PROCESSING', 'EXEC CICS REWRITE FILE(LIT-ACCTFILENAME) ...\nEXEC CICS REWRITE FILE(LIT-CUSTFILENAME) ...\nEXEC CICS SYNCPOINT ROLLBACK END-EXEC')],
  },
  {
    id: 'REQ-cbstm03a-d27b80e4f1',
    scope: 'CBSTM03A',
    pocketId: 'pkt-cbstm03a',
    category: 'behavior',
    type: 'functional',
    status: 'proposed',
    owner: 'p-lee',
    versions: [
      {
        statement: 'Statements list each account’s transactions in posting order, oldest first.',
        actor: 'Statement batch (CBSTM03A)',
        condition: 'Building a statement',
        outcome: 'Transactions sorted by posting timestamp, ascending',
        measure: 'Every statement',
        rationale: 'Matches the printed statement customers know.',
        author: 'p-agent',
        h: -30,
        reason: 'First draft from CBSTM03A',
      },
    ],
    links: [code('CBSTM03A', '600-640', '4000-TRNXFILE-GET', 'PERFORM UNTIL WS-TRNX-EOF ... (file is pre-sorted by TRAN-PROC-TS)')],
  },
  {
    id: 'REQ-cbtrn02c-5f40d9a3e8',
    scope: 'CBACT04C',
    pocketId: 'pkt-cbtrn02c',
    category: 'behavior',
    type: 'functional',
    status: 'rejected',
    owner: 'p-priya',
    versions: [
      {
        statement: 'Posting also recalculates interest every day.',
        actor: 'Interest batch (CBACT04C)',
        condition: 'Every posting run',
        outcome: 'Interest recalculated',
        measure: 'Daily',
        rationale: 'Seen in a test job.',
        author: 'p-agent',
        h: -40,
        reason: 'First draft from a test JCL',
      },
    ],
    links: [{ kind: 'source', ref: 'jcl:INTCALC-TEST', evidence: '//STEP05 EXEC PGM=CBACT04C (in a test-only job)', origin: 'code', title: 'INTCALC test job' }],
  },
  {
    id: 'REQ-cbtrn02c-a6e3c1b072',
    scope: 'CBTRN02C',
    pocketId: 'pkt-cbtrn02c',
    category: 'data',
    type: 'constraint',
    status: 'superseded',
    owner: 'p-priya',
    versions: [
      {
        statement: 'Reject file records are fixed width, 350 bytes.',
        actor: 'Posting batch (CBTRN02C)',
        condition: 'Writing a reject',
        outcome: '350-byte record',
        measure: 'Every record',
        rationale: 'Downstream readers expect a fixed layout.',
        author: 'p-agent',
        h: -55,
        reason: 'First draft from the FD',
      },
    ],
    links: [],
  },
  {
    id: 'REQ-cbtrn02c-1d9b7f6a40',
    scope: 'CBTRN02C',
    pocketId: 'pkt-cbtrn02c',
    category: 'data',
    type: 'constraint',
    status: 'approved',
    owner: 'p-priya',
    versions: [
      {
        statement: 'Each reject record is the 350-byte transaction followed by an 80-byte validation trailer with the reason code and description.',
        actor: 'Posting batch (CBTRN02C)',
        condition: 'Writing a reject',
        outcome: '430-byte record: transaction + trailer',
        measure: 'Every record; byte-identical to COBOL',
        rationale: 'The fraud report and the re-key team parse the trailer.',
        author: 'p-priya',
        h: -45,
        reason: 'Replaced the 350-byte draft after the conflict was resolved',
      },
    ],
    links: [code('CBTRN02C', '180-188', 'FD-REJS-RECORD', '05 REJECT-TRAN-DATA      PIC X(350).\n05 VALIDATION-TRAILER    PIC X(80).')],
  },
]

/* ------------------------- approvals and checks ------------------------- */

const APPROVALS: [string, number, string, number, Approval['decision'], string][] = [
  ['REQ-cbtrn02c-1b7e40c9d2', 1, 'p-priya', -30, 'approve', ''],
  ['REQ-cbtrn02c-5c02e8a1f4', 1, 'p-priya', -40, 'approve', ''],
  ['REQ-cbtrn02c-5c02e8a1f4', 2, 'p-priya', -24, 'approve', 'Matches what we agreed in Q-0007.'],
  ['REQ-cbtrn02c-e4b7a2c816', 1, 'p-maria', -3, 'approve', 'Formula is right. Needs a second approver per the finance rule.'],
  ['REQ-codebase-2a7c5e91d0', 1, 'p-grace', -118, 'approve', ''],
  ['REQ-cousr00c-8b1f3d6e29', 1, 'p-sam', -4, 'approve', 'Riley needs to approve too.'],
  ['REQ-coactupc-41d8e2b6c5', 1, 'p-lee', -60, 'approve', ''],
  ['REQ-cbtrn02c-5f40d9a3e8', 1, 'p-maria', -36, 'reject', 'Interest is monthly. This came from a test-only job.'],
  ['REQ-cbtrn02c-1d9b7f6a40', 1, 'p-priya', -44, 'approve', ''],
]

const VERIFS: [string, string, number, Verification['method'], string, Verification['status'], number, string][] = [
  ['VF-0001', 'REQ-cbtrn02c-1b7e40c9d2', 1, 'test', 'PostingRejectsUnknownCardTest', 'passing', -20, 'out/verify/REQ-cbtrn02c-1b7e40c9d2/@1/junit.xml'],
  ['VF-0002', 'REQ-cbtrn02c-5c02e8a1f4', 1, 'test', 'OverLimitRejectTest (current balance)', 'stale', -39, 'out/verify/REQ-cbtrn02c-5c02e8a1f4/@1/junit.xml'],
  ['VF-0003', 'REQ-cbtrn02c-5c02e8a1f4', 2, 'test', 'OverLimitRejectTest (cycle totals)', 'passing', -20, 'out/verify/REQ-cbtrn02c-5c02e8a1f4/@2/junit.xml'],
  ['VF-0004', 'REQ-cbtrn02c-5c02e8a1f4', 2, 'shadow', 'Shadow diff on reason code 102, 2,000 records', 'passing', -18, 'out/verify/REQ-cbtrn02c-5c02e8a1f4/@2/shadow.json'],
  ['VF-0005', 'REQ-cbtrn02c-e4b7a2c816', 1, 'shadow', 'Shadow diff on WS-MONTHLY-INT, 2,000 accounts', 'failing', -2, 'out/verify/REQ-cbtrn02c-e4b7a2c816/@1/shadow.json'],
  ['VF-0006', 'REQ-cbtrn02c-0f6c93d2a7', 1, 'test', 'ExpiredAccountRejectTest', 'pending', 0, ''],
  ['VF-0007', 'REQ-cbtrn02c-7d21b5e0c3', 1, 'lint', 'No upsert on TRANSACT writes', 'pending', 0, ''],
  ['VF-0008', 'REQ-cbtrn02c-c19e64f07a', 1, 'benchmark', 'Post 2M records end to end', 'pending', 0, ''],
  ['VF-0009', 'REQ-codebase-2a7c5e91d0', 1, 'lint', 'ArchUnit: no framework imports', 'passing', -6, 'out/verify/REQ-codebase-2a7c5e91d0/@1/archunit.txt'],
  ['VF-0010', 'REQ-coactupc-41d8e2b6c5', 1, 'test', 'ZipStateCheckTest', 'failing', -12, 'out/verify/REQ-coactupc-41d8e2b6c5/@1/junit.xml'],
  ['VF-0011', 'REQ-cousr00c-8b1f3d6e29', 1, 'attest', 'Security review of the password path', 'pending', 0, ''],
  ['VF-0012', 'REQ-cbtrn02c-1d9b7f6a40', 1, 'test', 'RejectRecordLayoutTest (byte compare)', 'passing', -20, 'out/verify/REQ-cbtrn02c-1d9b7f6a40/@1/junit.xml'],
]

/* ------------------------------ questions ------------------------------ */

const QUESTIONS: Question[] = [
  {
    id: 'Q-0001',
    reason: 'ambiguous-word',
    requirementId: 'REQ-cbtrn02c-9a3d11e05b',
    slot: 'condition',
    urgency: 'critical',
    scope: 'CBACT04C',
    pocketId: 'pkt-cbtrn02c',
    status: 'open',
    claimedBy: '',
    text: {
      business: 'When is monthly interest calculated: on the last calendar day of the month, the last business day, or each account’s statement date?',
      engineer: 'CBACT04C runs from JCL INTCALC. Which date should the Java job use as the month-end cut-off for 1300-COMPUTE-INTEREST: calendar month end, last business day, or the account’s cycle date?',
    },
    evidence: { kind: 'flag', statement: 'Interest is normally calculated on each category balance at month end.', word: 'normally' },
    options: ['Last calendar day', 'Last business day', 'Statement cycle date'],
    routedTo: ['p-priya', 'p-dev'],
    routedWhy: 'Priya owns CBACT04C (CODEOWNERS); Dev wrote 61% of it (git blame)',
    askedAtMs: at(-13),
  },
  {
    id: 'Q-0002',
    reason: 'conflict',
    requirementId: 'REQ-cbtrn02c-3e8f0a64b1',
    slot: '',
    urgency: 'high',
    scope: 'pkt-cbtrn02c',
    pocketId: 'pkt-cbtrn02c',
    status: 'open',
    claimedBy: '',
    text: {
      business: 'Two sources disagree about rejected card transactions. Are they retried automatically the next day, or reviewed and re-keyed by hand?',
      engineer: 'The 2019 runbook says DALYREJS records re-enter the next DALYTRAN run; CARD-412 (2022) says auto-retry was removed. Which does the Java posting job implement?',
    },
    evidence: { kind: 'conflict', conflictId: 'CF-0001' },
    options: ['Retried next day', 'Re-keyed by hand'],
    routedTo: ['p-maria', 'p-marcus'],
    routedWhy: 'Maria approves posting business rules; Marcus runs the reject review (runbook)',
    askedAtMs: at(-3),
  },
  {
    id: 'Q-0003',
    reason: 'missing-number',
    requirementId: 'REQ-cbtrn02c-c19e64f07a',
    slot: 'measure',
    urgency: 'normal',
    scope: 'CBTRN02C',
    pocketId: 'pkt-cbtrn02c',
    status: 'open',
    claimedBy: '',
    text: {
      business: 'By what time does nightly posting need to finish so statements can start on time?',
      engineer: 'The requirement says posting “finishes quickly enough”. What is the latest end time, or the longest run time, for the CBTRN02C step?',
    },
    evidence: { kind: 'flag', statement: 'Nightly posting finishes quickly enough for statements to start on time.', word: 'quickly' },
    options: ['By 02:00', 'Within 90 minutes', 'Before CBSTM03A starts'],
    routedTo: ['p-marcus'],
    routedWhy: 'Marcus runs the nightly cycle (runbook)',
    askedAtMs: at(-20),
  },
  {
    id: 'Q-0004',
    reason: 'unmade-decision',
    requirementId: 'REQ-cbtrn02c-e4b7a2c816',
    slot: '',
    urgency: 'high',
    scope: 'CBACT04C',
    pocketId: 'pkt-cbtrn02c',
    status: 'open',
    claimedBy: '',
    text: {
      business: 'When interest comes to a fraction of a cent, should the new system round the way the old one does (half-up), or use banker’s rounding?',
      engineer: 'Shadow diff on CBACT04C: 4 of 2,000 accounts differ by $0.01. COBOL COMPUTE ROUNDED is half-up; the rewrite uses BigDecimal HALF_EVEN. Keep COBOL or switch?',
    },
    evidence: { kind: 'shadow', detail: '4 of 2,000 accounts differ by one cent in WS-MONTHLY-INT' },
    options: ['Keep COBOL (half-up)', 'Use banker’s rounding'],
    routedTo: ['p-priya'],
    routedWhy: 'Priya owns CBACT04C (CODEOWNERS)',
    askedAtMs: at(-2),
  },
  {
    id: 'Q-0005',
    reason: 'who-asked',
    requirementId: '',
    slot: '',
    urgency: 'low',
    scope: 'pkt-cbtrn02c',
    pocketId: 'pkt-cbtrn02c',
    status: 'answered',
    claimedBy: '',
    text: { business: 'Who relies on the reject file downstream?', engineer: 'Which jobs or teams read DALYREJS after CBTRN02C writes it?' },
    evidence: { kind: 'none' },
    options: [],
    routedTo: ['p-marcus'],
    routedWhy: 'Marcus runs the nightly cycle (runbook)',
    askedAtMs: at(-22),
    answer: { byPersonId: 'p-marcus', text: 'The re-key team every morning, and the fraud report reads it at 06:00.', atMs: at(-18) },
  },
  {
    id: 'Q-0006',
    reason: 'who-asked',
    requirementId: 'REQ-cousr00c-8b1f3d6e29',
    slot: 'actor',
    urgency: 'normal',
    scope: 'pkt-cousr00c',
    pocketId: 'pkt-cousr00c',
    status: 'open',
    claimedBy: '',
    text: {
      business: 'Which team owns the password service the new sign-on code should call?',
      engineer: 'COUSR01C and COSGN00C compare SEC-USR-PWD in plain text. Which service and team own password hashing for the Java rewrite?',
    },
    evidence: { kind: 'none' },
    options: ['Platform security service', 'Identity team (Okta)'],
    routedTo: ['p-sam'],
    routedWhy: 'Sam owns COUSR0* (CODEOWNERS) and administers USRSEC',
    askedAtMs: at(-5),
  },
  {
    id: 'Q-0007',
    reason: 'missing-actor',
    requirementId: 'REQ-cbtrn02c-5c02e8a1f4',
    slot: 'condition',
    urgency: 'normal',
    scope: 'CBTRN02C',
    pocketId: 'pkt-cbtrn02c',
    status: 'answered',
    claimedBy: '',
    text: { business: 'Which balances count toward the credit limit check?', engineer: 'In 1500-C-LOOKUP-ACCT, is the limit compared to the current balance or to cycle credits minus debits?' },
    evidence: { kind: 'flag', statement: 'Posting rejects a transaction with reason code 102 when the account is over its credit limit.', word: 'over its credit limit' },
    options: ['Current balance', 'Cycle credits minus debits'],
    routedTo: ['p-priya'],
    routedWhy: 'Priya owns CBTRN02C (CODEOWNERS)',
    askedAtMs: at(-34),
    answer: { byPersonId: 'p-priya', text: 'Cycle credits minus cycle debits plus the new amount.', atMs: at(-27) },
  },
]

const HITS: Omit<ContextHit, 'fetchedAtMs'>[] = [
  { id: 'CH-1', questionId: 'Q-0001', source: 'confluence', url: 'https://cardco.atlassian.net/wiki/spaces/FIN/pages/interest-runbook', title: 'Interest calculation runbook', quote: 'Interest posts on the last business day of the month.', score: 0.81 },
  { id: 'CH-2', questionId: 'Q-0001', source: 'jira', url: 'https://cardco.atlassian.net/browse/CARD-388', title: 'CARD-388 · Month-end interest for promo APR accounts', quote: 'Promo accounts accrue on the statement cycle date, not month end.', score: 0.74 },
  { id: 'CH-3', questionId: 'Q-0001', source: 'notion', url: 'https://notion.so/cardco/finance-glossary', title: 'Finance glossary: month end', quote: 'Month end means the last calendar day unless the ledger closes early.', score: 0.52 },
  { id: 'CH-4', questionId: 'Q-0003', source: 'confluence', url: 'https://cardco.atlassian.net/wiki/spaces/OPS/pages/nightly-schedule', title: 'Nightly batch schedule', quote: 'CREASTMT must finish by 06:00; it takes about 2 hours.', score: 0.69 },
  { id: 'CH-5', questionId: 'Q-0004', source: 'jira', url: 'https://cardco.atlassian.net/browse/CARD-377', title: 'CARD-377 · Bill pay rounding', quote: 'Kept half-up to match the statement printer.', score: 0.63 },
]

const OUTREACH: [string, string, Outreach['step'], number, Outreach['status']][] = [
  ['Q-0001', 'p-priya', 'ask', -13, 'sent'],
  ['Q-0001', 'p-dev', 'ask', -13, 'sent'],
  ['Q-0001', 'p-priya', 'follow-up', -6.5, 'sent'],
  ['Q-0001', 'p-dev', 'follow-up', -6.5, 'sent'],
  ['Q-0001', 'p-maria', 'manager', -1, 'sent'],
  ['Q-0002', 'p-maria', 'ask', -3, 'sent'],
  ['Q-0002', 'p-marcus', 'ask', -3, 'sent'],
  ['Q-0003', 'p-marcus', 'ask', -20, 'sent'],
  ['Q-0004', 'p-priya', 'ask', -2, 'sent'],
  ['Q-0005', 'p-marcus', 'ask', -22, 'answered'],
  ['Q-0006', 'p-sam', 'ask', -5, 'sent'],
  ['Q-0007', 'p-priya', 'ask', -34, 'answered'],
]

/* ------------------------------ migration ------------------------------ */

const TRAFFIC: Record<string, number> = {
  'pkt-shared': 0.22,
  'pkt-cotrn00c': 0.18,
  'pkt-coactupc': 0.14,
  'pkt-cbtrn02c': 0.12,
  'pkt-cocrdlic': 0.09,
  'pkt-paudblod': 0.08,
  'pkt-cousr00c': 0.05,
  'pkt-cbstm03a': 0.04,
}
const JOB_STATE: Record<string, MigrationJob['state']> = {
  'pkt-cbtrn02c': 'shadowing',
  'pkt-coactupc': 'capturing',
  'pkt-cbstm03a': 'capturing',
}

function jobsSeed(): Record<string, MigrationJob> {
  const jobs = POCKETS.map((p) => {
    const seeds = p.programs.map((x) => PROGRAM[x].seed)
    const derived: MigrationJob['state'] = seeds.every((s) => s === 'done') ? 'done' : seeds.some((s) => s === 'cutover') ? 'canary' : seeds.some((s) => s === 'shadowing') ? 'shadowing' : 'queued'
    const trafficShare = TRAFFIC[p.id] ?? 0.01
    return { pocketId: p.id, state: JOB_STATE[p.id] ?? derived, trafficShare, rank: 0, score: p.isolation * 0.7 + trafficShare }
  })
  jobs.sort((a, b) => b.score - a.score)
  return Object.fromEntries(jobs.map((j, i) => [j.pocketId, { pocketId: j.pocketId, state: j.state, trafficShare: j.trafficShare, rank: i + 1 }]))
}

const ATTEMPTS: HarnessAttempt[] = [
  { id: 'HA-1', pocketId: 'pkt-cbtrn02c', attempt: 1, outcome: 'failed', failedRequirementId: 'REQ-cbtrn02c-1b7e40c9d2', note: 'Posted 14 unknown-card records instead of rejecting them', atMs: at(-40) },
  { id: 'HA-2', pocketId: 'pkt-cbtrn02c', attempt: 2, outcome: 'failed', failedRequirementId: 'REQ-cbtrn02c-5c02e8a1f4', note: 'Limit check used the current balance, not cycle totals', atMs: at(-30) },
  { id: 'HA-3', pocketId: 'pkt-cbtrn02c', attempt: 3, outcome: 'passed', failedRequirementId: '', note: 'Every approved requirement passes; moved to shadowing', atMs: at(-22) },
]

/* -------------------------------- build -------------------------------- */

export function seedWorld(): ReqWorld {
  const w: ReqWorld = {
    nowMs: T0,
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
    people: Object.fromEntries(PEOPLE.map((p) => [p.id, p])),
    teams: Object.fromEntries(TEAM_LIST.map((t) => [t.id, t])),
    ownership: ownershipSeed(),
    approvers: approverSeed(),
    access: ACCESS,
    jobs: jobsSeed(),
    attempts: ATTEMPTS,
    approverSignOff: { byPersonId: 'p-elena', atMs: at(-168) },
  }

  for (const s of REQS) {
    const versions: RequirementVersion[] = s.versions.map((v, i) => ({
      id: `${s.id}@${i + 1}`,
      requirementId: s.id,
      n: i + 1,
      statement: v.statement,
      actor: v.actor,
      condition: v.condition,
      outcome: v.outcome,
      measure: v.measure,
      rationale: v.rationale,
      authorPersonId: v.author,
      createdAtMs: at(v.h),
      reason: v.reason,
    }))
    const cur = versions[versions.length - 1]
    w.requirements[s.id] = {
      id: s.id,
      scope: s.scope,
      scopeLevel: s.scope === 'codebase' ? 'codebase' : s.scope.startsWith('pkt-') ? 'pocket' : 'program',
      pocketId: s.pocketId,
      category: s.category,
      type: s.type,
      status: s.status,
      currentVersionId: cur.id,
      ownerPersonId: s.owner,
      signature: `${s.scope}|${s.category}|${cur.condition.toLowerCase()}`,
      sensitivity: s.restricted ? 'restricted' : 'normal',
      reviewByMs: at(24 * 90),
    }
    for (const v of versions) {
      w.versions[v.id] = v
      w.flags[v.id] = []
    }
    w.flags[cur.id] = (s.flags ?? []).map((f, i) => ({ ...f, id: `FL-${s.id.slice(-4)}-${i + 1}`, versionId: cur.id }))
    w.links[s.id] = s.links.map((l, i) => ({ ...l, id: `LK-${s.id.slice(-4)}-${i + 1}`, requirementId: s.id }))
  }

  APPROVALS.forEach(([reqId, n, who, h, decision, comment], i) => {
    const r = w.requirements[reqId]
    const rows = w.approvers.filter((a) => a.personId === who && (a.scope === r.pocketId || a.scope === 'codebase'))
    w.approvals.push({ id: `AP-${i + 1}`, requirementId: reqId, versionId: `${reqId}@${n}`, approverPersonId: who, authority: Math.max(0, ...rows.map((a) => a.score)), decision, comment, atMs: at(h) })
  })

  for (const [id, reqId, n, method, spec, status, h, artifactRef] of VERIFS) {
    w.verifications[id] = { id, requirementId: reqId, versionId: `${reqId}@${n}`, method, spec, status, lastRunAtMs: h ? at(h) : 0, artifactRef: artifactRef ? `${artifactRef} · sha256 ${(id.charCodeAt(4) * 7919).toString(16)}e1c` : '' }
  }

  const conflict: Conflict = { id: 'CF-0001', aVersionId: 'REQ-cbtrn02c-3e8f0a64b1@1', bVersionId: 'REQ-cbtrn02c-b5a9c7d230@1', questionId: 'Q-0002', status: 'open', resolution: '', comment: '' }
  w.conflicts[conflict.id] = conflict

  for (const q of QUESTIONS) w.questions[q.id] = q
  for (const h of HITS) (w.hits[h.questionId] ??= []).push({ ...h, fetchedAtMs: w.questions[h.questionId].askedAtMs + 0.2 * HOUR })
  OUTREACH.forEach(([questionId, recipientPersonId, step, h, status], i) => {
    const q = w.questions[questionId]
    const id = `OR-${String(i + 1).padStart(3, '0')}`
    w.outreach[id] = { id, questionId, recipientPersonId, channel: 'slack-dm', rendering: ['p-maria', 'p-marcus', 'p-riley'].includes(recipientPersonId) ? 'business' : 'engineer', urgency: q.urgency, step, status, sentAtMs: at(h) }
  })

  // an open change request: Dev wants unknown cards flagged for the fraud report too
  const r1 = 'REQ-cbtrn02c-1b7e40c9d2'
  const base = w.versions[`${r1}@1`]
  const proposed: RequirementVersion = {
    ...base,
    id: `${r1}@2`,
    n: 2,
    statement: 'When a daily transaction’s card number has no cross-reference record, posting rejects it with reason code 100, writes it to the reject file, and flags the card number for the fraud report.',
    outcome: 'Reject with code 100, write to DALYREJS, and add the card to the fraud watch list',
    authorPersonId: 'p-dev',
    createdAtMs: at(-1.5),
    reason: 'Change request CR-0001: fraud team asked for unknown cards to be flagged',
  }
  w.versions[proposed.id] = proposed
  w.flags[proposed.id] = []
  w.changeRequests['CR-0001'] = { id: 'CR-0001', requirementId: r1, proposedVersionId: proposed.id, impact: impactOf(w, r1), status: 'open', byPersonId: 'p-dev', atMs: at(-1.5) }

  // Nemotron's real findings replace the hand-written requirements above (src/data/findings.ts).
  return withFindings(w)
}
