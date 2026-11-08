# Requirements analysis

Status: **PROPOSED**. Needs team sign-off before implementation (repo rule). Last updated 2026-11-08.
Written from a planning session; nothing here is built yet. Numbers marked *(placeholder)* are config
values to tune, not measured results.

This doc covers what happens **after Part 2** ([SPEC_DEPENDENCY_PASSES.md](SPEC_DEPENDENCY_PASSES.md#3-part-2-reader-llm)):
how findings and questions become approved requirements, who gets asked and approves them, how each
requirement is traced to code and verified, how requirements drive the code migration, and what every
UI screen has to do.

Related docs: [AGENT_LOOP.md](AGENT_LOOP.md) (job state machine, oracle), [HUMAN_LOOP.md](HUMAN_LOOP.md)
(knowledge base, wording), [DATA_MODEL.md](DATA_MODEL.md), [DECISIONS.md](DECISIONS.md).

---

## 1. How we got here

### 1.1 Sources

The requirements process comes from Dr. Şeker's **CS 3354 Software Engineering** lectures (UT Dallas,
Fall 2026, L2–L18; L8 was not available), summarized in [research/concept-brief.md](../research/concept-brief.md)
and [research/research-map.md](../research/research-map.md). We read every lecture, pulled out everything
about requirements, and turned each technique into a step an agent can run.

| Lecture idea | What we took from it | Where it shows up below |
| --- | --- | --- |
| Requirements engineering is a loop: elicit → specify → validate → manage → repeat (Ch 5–7) | The layer runs every time new findings, answers or source documents arrive; each pass finds what the last missed | §2 |
| People can't just tell you: they describe solutions, leave out the obvious, can't picture what's possible (L9, L11) | Ask for decisions with concrete examples, never "explain the logic"; show old vs. new output | §6.4 |
| Pick the elicitation technique by the gap (closed interview, open + why, scenario walkthrough, observation, document study, prototype) (L7, L9/L10, L11, L14) | Each kind of gap gets its own question template | §4.6 |
| A good requirement has four properties: a need, stated, checkable, owned (L9) | The requirement template and lint rules | §4.3, §4.4 |
| Separate → classify (functional / quality / constraint) → make checkable → ID + owner → write back to confirm (L9) | The deterministic pipeline | §4 |
| Ambiguous words: vague quantifiers, undefined actors, hidden alternatives, escape words (L9) | The lint word list | §4.4 |
| List everyone with a stake (L4); several consumers of one output (CometPark, L3) | Stakeholder discovery asks every consumer, not only the code owner | §5 |
| External systems are actors too; LLMs identify actors correctly only 31% of the time; the Card Office is the most-missed actor (L11, arXiv:2404.17739) | Ownership comes from data sources, never from an LLM guess | §5 |
| Traceability: need → requirement → code → test; a blank traceability row means "who asked for this?" (L11) | Every requirement links to source, code and verification; code with no requirement is flagged | §7 |
| Validation (right thing) vs. verification (built right) (L9) | Matching old output verifies; an approved person confirming validates | §8 |
| Defect vs. unmade decision (CometLab, L18); business calls the agent has no authority to make (CometPrint, L14) | Conflicts and unmade decisions go to people with authority; the agent never decides | §6.3 |
| Two mandatory rules that can't both hold (L16) | Conflict view lays out both options with costs | §6.3, §12.6 |
| Change control: request → impact via traceability → owner decides → new baseline (L9) | Versioned requirements and the impact view | §7.3, §12.8 |
| "An out-of-date model is worse than no model" (L11) | Requirements and approvals carry review dates | §7.2 |
| The old system isn't automatically right: UK Post Office Horizon (L17) | Approved requirements override legacy behavior | §9.3 |
| Tests that pass and forbid nothing: LLM postconditions complete only 21–26% of the time (PostcondBench, L17) | Generated tests pin exact values and every state change | §8 |
| Goodhart's law on velocity (L5) | Waived mismatches are counted and shown | §9.4 |
| Definition of Done; fitness functions (L5, L16) | A pocket isn't done until old code is retired; requirements become CI checks | §9.5 |
| CometWash role-play: stakeholders with secrets (course activity) | Demo scenario | §13 |

### 1.2 What we decided in planning

- The Part 2 reader ends at **questions** and cited findings. It does not talk to people.
- A separate **requirements layer** turns findings, questions and context hits into requirements.
- **SpacetimeDB is the only database.** Raw JSON outputs stay as files linked by hash.
- **Gaps become questions, not rejections.** A missing actor, a missing number, an ambiguous word or a
  conflict produces a targeted question.
- **A requirement can be any size**: a style rule, a structural rule, a behavior, a technology choice, a
  performance budget.
- **Verification is in scope**, and one of its methods is a person attesting.
- **The approved-people list is generated** from company sources, then signed off once.
- **Outreach is its own worker.** The harness never messages people directly.
- **Access mirrors source-system permissions.** Nobody sees code or rules they couldn't already see.

---

## 2. Where this sits in the pipeline

```
repo ─► Part 1 ─► pass1.json ─► Runtime ─► runtime.json
                     └──────────► Part 2 ◄─────┘
                                    │ findings (rules, defects, edge values) + questions
                                    ▼
              context connectors (Jira, Notion, Confluence, git history) ─► contextHit
                                    │
                                    ▼
                  ┌──────── requirements layer ────────┐
                  │ collect → separate → classify →     │
                  │ fill template → lint → dedupe /     │
                  │ conflict → ID → propose             │
                  └────────────────┬────────────────────┘
          gaps become questions ◄──┤
          (outreach worker asks) ──┘
                                   ▼
                    approval by approved people (versioned)
                                   ▼
               traced requirement: source ↔ code ↔ verification
                                   ▼
                 migration: harness rewrites against requirements,
                 shadow run checks them, cutover needs them all green
```

---

## 3. Vocabulary

| Term | Meaning |
| --- | --- |
| **Finding** | A cited observation from Part 2: a rule, defect, edge value, coverage gap or mismatch |
| **Question** | Something the system can't decide from evidence. Has a reason and a routing target |
| **Context hit** | A cited snippet from an outside source (Jira, Notion, …) that may answer a question |
| **Requirement** | One checkable statement about what the system must do or be, with an owner |
| **Requirement version** | An immutable revision of a requirement's text. Approvals attach to a version |
| **Approved person** | Someone the generated list says has authority for a scope and category |
| **Verification** | The method that proves a requirement holds: test, shadow check, lint rule, benchmark, or a person attesting |
| **Scope** | What a requirement applies to: codebase, pocket, program, function (COBOL paragraph or Java method), or line range |
| **Stakeholder** | Any person, team or external system that produces, consumes or decides about the behavior |

---

## 4. From findings and questions to requirements (deterministic)

The rule: **the model writes wording; code decides validity.** Every step that can be code is code, and
every LLM step is temperature 0, schema-validated, and cached by prompt hash, so a rerun on the same inputs
produces byte-identical output.

### 4.1 Steps

| # | Step | Done by | Input | Output |
| --- | --- | --- | --- | --- |
| 1 | **Collect** | code | Part 2 `rule` / `defect` / `edge-value` findings, answered questions, context hits, imported notes, for one scope | A sorted, hashed bundle per scope |
| 2 | **Separate** | LLM | The bundle | Candidate statements, one need each, each citing its sources |
| 3 | **Classify** | LLM, checked by code | A candidate | `type` (functional / quality / constraint) and `category` (§4.2) |
| 4 | **Fill the template** | LLM fills, code validates | A candidate | The slots in §4.3 |
| 5 | **Lint** | code only | A filled draft | Flags (§4.4). Each flag becomes a question (§4.6) |
| 6 | **Dedupe and detect conflicts** | code only | All drafts in scope + existing requirements | Merges duplicates; opens a conflict when outcomes differ (§4.5) |
| 7 | **Assign an ID** | code | A draft | `REQ-<scope>-<hash of source signature>` (stable across reruns) |
| 8 | **Propose** | reducer `proposeRequirement` | A clean or flagged draft | A `requirement` row, status `proposed` or `needs-info` |
| 9 | **Confirm** | outreach worker + approver | Proposed requirements | The "we found X, Y and Z" confirmation digest (§6.5) |

### 4.2 Categories and scope

A requirement is any single checkable statement, at any size. Every requirement has one **category**, one
**type** and one **scope**.

| Category | Examples | Typical scope | Typical verification |
| --- | --- | --- | --- |
| `style` | Statements end with semicolons; comments use `//`; file header on every file | codebase | lint rule |
| `structure` | Functions do one thing and stay under 50 lines; no message chains deeper than two dots | codebase, pocket | lint rule |
| `behavior` | Monthly interest is truncated to 2 decimals, not rounded | program, function | test, shadow check |
| `business-rule` | Fees are waived for accounts open fewer than 30 days | function | test + person attests |
| `technology` | Money uses `BigDecimal`; dates use `java.time` | codebase | lint rule, review |
| `performance` | The INTCALC job finishes in under 5 s for 10,000 accounts | program, job | benchmark |
| `security` | Card numbers never appear in logs | codebase | lint rule, test |
| `data` | `ACCT-CURR-BAL` keeps 2 decimal places end to end | field | test, shadow check |

`type` follows the course: **functional** adds behavior, **quality** says how well, **constraint** removes
options. Style and technology rules are usually constraints; performance is quality.

### 4.3 The requirement template

Every requirement version has these slots. Required slots depend on category.

| Slot | Meaning | Required for | Example |
| --- | --- | --- | --- |
| `statement` | One sentence, generated from the slots below | all | "When the nightly INTCALC job computes monthly interest, the system truncates the result to 2 decimals." |
| `actor` | Who or what triggers it | behavior, business-rule, performance | "the nightly INTCALC batch job" |
| `condition` | When it applies | behavior, business-rule | "for every account category balance" |
| `outcome` | The expected result, with an exact value, number or unit | all except style | "result truncated to 2 decimals" |
| `measure` | Number + unit for quality requirements | performance, quality | "< 5 s for 10,000 accounts" |
| `scope` | What it applies to | all | `prog:CBACT04C` § `1300-COMPUTE-INTEREST` |
| `rationale` | Why it exists, in plain words | all | "Customers have always been billed this way" |
| `sources` | ≥1 citation: `file:line`, finding id, context-hit URL, person | all | `app/cbl/CBACT04C.cbl:212`, Jira `CARD-88` |
| `owner` | The approved person or group accountable | all (filled at approval) | "Card Services – interest policy owner" |

### 4.4 Lint rules (code only)

Lint never rejects a draft. Each failure becomes a flag, and each flag becomes a question.

| Rule | Fails when | Becomes question type |
| --- | --- | --- |
| `missing-actor` | `actor` is empty or a pronoun (they, it, the user, the system) | `missing-actor` |
| `missing-number` | A quality or performance requirement has no number + unit in `measure` | `missing-number` |
| `missing-outcome` | `outcome` has no exact value, threshold or observable effect | `missing-outcome` |
| `vague-quantifier` | Contains: fast, slow, most, many, few, some, usually, large, small, quickly, timely, efficient, user-friendly | `ambiguous-word` |
| `undefined-actor` | Contains: the user, users, they, someone, the team, the system (without a named system) | `missing-actor` |
| `hidden-alternative` | Contains: and/or, etc., e.g., such as, or similar | `ambiguous-word` |
| `escape-word` | Contains: normally, generally, where possible, if needed, as appropriate, typically | `ambiguous-word` |
| `multiple-needs` | More than one `outcome`, or "and" joining two independent results | split the draft into two (no question) |
| `no-source` | No valid citation inside the evidence pack | dropped and counted (same rule as Part 2) |
| `glossary-clash` | One term maps to two meanings in the field glossary (CometDine "meal", L11) | `ambiguous-word` |

The word lists live in config (`requirements.lint.*`) so the team can extend them without code changes.

### 4.5 Duplicates and conflicts

Each draft gets a **signature**: `scope + category + normalized condition`.

- Same signature, same outcome: **duplicate**. Merge them, union the sources, keep the oldest ID.
- Same signature, different outcome: **conflict**. Both stay `needs-info` and a `conflict` question opens (§6.3).
- Overlapping scope (a codebase rule vs. a function rule) with contradicting outcomes: also a conflict. The
  narrower scope never silently wins.

### 4.6 Gaps become questions

| Question reason | Generated from | Template (business view) |
| --- | --- | --- |
| `missing-actor` | lint | "Who starts {behavior}: {candidate A} or {candidate B}?" |
| `missing-number` | lint | "What's the limit for {thing}? For example, under how many seconds?" |
| `missing-outcome` | lint | "When {condition}, what should happen? Here's what it does today: {example}." |
| `ambiguous-word` | lint | "'{word}' could mean a few things here. Which of these is right? {options}" |
| `conflict` | dedupe | "{Source A} says {X}; {source B} says {Y}. Which is correct?" |
| `unmade-decision` | Part 2 (empty stub, dead-looking path) | "{Paragraph} is empty / never runs. Should it {option A} or {option B}?" |
| `who-asked` | trace (code with no requirement) | "Nobody seems to have asked for {behavior}. Do we keep it?" |

Each question stores `reason`, `requirementId`, the slot or word that triggered it, and the evidence.

---

## 5. Stakeholders, ownership and the approved-people list

### 5.1 Principles

- **List everyone with a stake** (L4): producers, consumers, deciders, and external systems.
- **External systems are actors** (L11): the card network, the statement printer, the regulator feed.
- **Every ownership link keeps its source and a confidence.** No link without evidence.
- **Ownership comes from sources, never from an LLM guess** (31% actor accuracy).

### 5.2 Sources we can pull

Any source works if it has a connector that outputs the common shape in §5.3. Connectors call each
source's **REST API** directly (R6), and every response is cached by request hash so demo runs replay
without the network.

| Source type | Examples | Tells us |
| --- | --- | --- |
| Org chart / directory | Workday, BambooHR, Rippling, Microsoft Entra ID (Graph `manager`), Google Workspace Directory, Okta | People, titles, teams, managers, active/left |
| Code history | `git log` / `git blame`, CODEOWNERS, PR authors and reviewers, GitHub/GitLab teams | Who wrote, reviewed and owns each file and line |
| Mainframe change tools | Endevor, ChangeMan, CA-7 / Control-M, RACF | Who promoted each COBOL change; job owners; dataset owners |
| Service catalog / CMDB | ServiceNow CMDB, Backstage, PagerDuty | Application owner, on-call team |
| Tickets and docs | Jira (reporter, assignee, component lead), Confluence (page owner), Notion | Who asked for a behavior; who wrote the spec |
| Business-rule authority | Rules engines (IBM ODM, Drools), policy documents, compliance control owners (SOX, PCI), RACI matrices | Who may **decide** a business rule |
| Chat | Slack / Teams profiles and threads the bot can see | Titles, who discussed the behavior |

### 5.3 Common shape

```ts
type Person   = { id: string; emails: string[]; name: string; title?: string; team?: string; active: boolean; source: string };
type Team     = { id: string; name: string; parentTeamId?: string; source: string };
type ReportsTo = { personId: string; managerId: string; source: string };
type Owns     = { personId: string; target: string;            // node id, rule id, dataset, app, policy
                  kind: "code" | "rule" | "data" | "app" | "job" | "policy";
                  signal: string; weight: number; source: string; evidence: string; observedAt: string };
```

### 5.4 Identity resolution

1. Join on normalized email first (lowercase, strip `+tags`, known domain aliases).
2. Then on directory id links (Slack profile email, Jira account email).
3. Anything left with a similar name but no shared key goes to the **identity merge review** (§12.11). Never
   auto-merge on name alone.
4. People marked inactive keep their history; their ownership passes to their manager, or to the most recent
   active contributor to the same code, as a *suggested successor* that needs confirmation.

### 5.5 Authority scoring

For each `(person, scope, category)` the score is the sum of signal weights. Weights are config
(`requirements.authority.weights`) so results are deterministic and explainable.

| Signal | Example weight *(placeholder)* |
| --- | --- |
| Named owner (CODEOWNERS, CMDB app owner, control owner, policy owner) | 1.0 |
| Manager of the owning team | 0.8 |
| Commits to the scope, decaying with a 180-day half-life | up to 0.6 |
| Jira component lead, or reporter of the ticket that introduced the behavior | 0.5 |
| Author of the Confluence/Notion spec for it | 0.5 |
| Reviewer of PRs touching it | 0.3 |
| Participant in a related chat thread | 0.1 |

Category decides which signals count:

| Category | Signals that count most |
| --- | --- |
| business-rule | policy owner, control owner, product/business owner, ticket reporter |
| behavior, data | code owner, recent committers, spec author |
| style, structure, technology | tech lead (team manager in engineering), CODEOWNERS |
| performance | service owner, on-call team |
| security | security/control owner |

### 5.6 The generated approved-people list

A person is an **approved person** for a `(scope, category)` when all three hold:

1. they are **active**,
2. they **already have access** to that scope (§10), and
3. their authority score is at or above `requirements.authority.approverThreshold` *(placeholder 1.0)*.

Each entry stores the score and the evidence ("Maria: manager of Card Services (Workday); owner of the
interest policy page (Confluence)"). A customer admin, or our FTE, signs off the generated list **once**.
After that the list refreshes when sources change, and every change (new person, someone left, score
crossed the threshold) is flagged for review rather than applied silently.

---

## 6. Asking people

### 6.1 Who sends messages

The **outreach worker** (Slack bot) is the only process that talks to people. The harness, the Part 2
reader and the requirements layer only write `question` / `outreach` rows. Reasons:

- Outreach is mostly waiting (follow-ups take hours or days). That shouldn't run on Brev GPU credits.
- Slack tokens live in one worker, not inside the agent that edits code.
- One place for dedupe, batching, rate limits, business hours, tone and escalation.

### 6.2 Routing

For each question, in order:

1. **Look at history first**: Part 1 code, Runtime behavior, git history (who changed it, commit message,
   linked ticket), and context hits. If that settles it, no question is sent.
2. **Ask both sides together** when the question involves two sources (a conflict, or a consumer and a
   producer). One message to both.
3. **The author of the source** that caused the gap (ticket reporter, spec author).
4. **The code owner** (highest authority score for `behavior` on that scope).
5. Only people with access to the evidence (§10). If the right person lacks access, they get a redacted
   version, or the question goes to someone who has access.

### 6.3 Escalation ladder

```
ask (both sides) ─► follow-up after followUp[urgency]
                 ─► their manager (org chart) after manager[urgency]
                 ─► an approved person for the scope
                 ─► an FTE at our company after fte[urgency]
                 ─► still open: blocks the requirement and any rewrite that depends on it
```

| Urgency | Set when | First follow-up | Manager | Our FTE |
| --- | --- | --- | --- | --- |
| `critical` | blocks a cutover, or touches a money field | 6–7 h | 12 h *(placeholder)* | 24 h *(placeholder)* |
| `high` | blocks a rewrite | 12 h *(placeholder)* | 1 day *(placeholder)* | 2 days *(placeholder)* |
| `normal` | blocks a requirement only | 1 day | 2 days *(placeholder)* | 4 days *(placeholder)* |
| `low` | informational | 2 days *(placeholder)* | 4 days *(placeholder)* | 1 week *(placeholder)* |

- Timers are **scheduled reducers** in SpacetimeDB. They count business hours in the recipient's time zone.
- In demo mode the same table is scaled by the sim clock, as `humanLoop.escalation` does today.
- **Conflicts are never resolved by the system.** Never pick one, average them, or default to old behavior.
  If nobody answers, the conflict stays open and blocks.
- The existing `maxQuestionsPerPersonPerSimDay` cap still applies; extra questions queue, ranked by what
  they unblock.

### 6.4 Two renderings: business and engineer

Every question and requirement renders two ways. The recipient's role (from the directory) picks the
default; they can switch.

| Business view | Engineer view |
| --- | --- |
| The rule in one plain sentence | The COBOL paragraph, cleaned (comment lines dropped, aligned), with a plain-English summary beside it |
| A concrete example table: input → today's result → proposed result | `file:line`, the graph neighborhood (who reads and writes the same data) |
| Impact in their terms: accounts affected, money per month | Trace links: requirement → code → verification |
| One-click answers: **[Today's result is right] [Proposed is right] [Neither]** | Same buttons, plus "Open in repo" |

Rules for both: lead with the decision and an example, never raw code first; one question per message;
evidence inline; decision tables for business rules; old and new output side by side.

### 6.5 Approval digests (no flooding)

- One digest per approver per scope, not one message per item.
- Ranked by what each item unblocks (a cutover blocker first).
- Items sharing a root cause are grouped into one approval.
- **One approver from the group is enough**, except `critical` items and money fields, which need
  `requirements.approval.criticalQuorum` *(placeholder 2)*.
- Load is spread across the group (least recently asked first).
- The digest opens with the confirmation summary: "We found 12 requirements for Interest calculation:
  9 look complete, 2 need a number, 1 conflicts with Jira CARD-88."

### 6.6 Tone

- Sound like a colleague: first name, say who's asking, the context in the first line, one ask, end with
  buttons.
- Banned: "I hope this finds you well", "Great question", em dashes, stacks of bullets, over-apologizing.
- **Match the team's register**, not one person: message length, formality, greetings and emoji use,
  learned from channels the bot is invited to, with the workspace admin's consent. Always identify as the
  Theseus assistant.
- Few-shot sources: the Software-related Slack Chats dataset (Chatterjee et al., MSR 2020; ~39k
  conversations) and DISCO (Discord, MSR 2022; ~28.7k conversations), for tone only, plus 10–20
  hand-written examples in our exact format.

---

## 7. Approval, versions and change control

### 7.1 Lifecycle

```
draft ──lint clean──► proposed ──approve──► approved ──edit──► proposed (new version)
  │                       ├──reject──► rejected            └──retire──► superseded
  └──flags──► needs-info ─┘ (answers fill the slots, re-lint)
```

### 7.2 Rules

- **Every edit creates a new `requirementVersion`.** Versions are immutable.
- **Approval attaches to a version.** Editing an approved requirement moves it back to `proposed`; the old
  approval stays in history.
- An approval records: who (SpacetimeDB `ctx.sender`, so it can't be faked), their authority for this scope
  and category, decision, comment, time, and the version id.
- Only approved people for the scope and category can approve. Anyone else's input is stored as an opinion.
- Each approved requirement has a `reviewBy` date (stale knowledge misleads, L11).

### 7.3 Change requests and impact

Anyone with access can **request a change** to a requirement. Before an approver decides, the system
computes the impact from trace links and the graph:

| Impact item | How it's computed |
| --- | --- |
| Lines and functions | The requirement's `code` links: file:line ranges, COBOL paragraphs, Java methods |
| Programs | The graph nodes those lines belong to |
| Downstream | Programs that read datasets/tables/queues the affected code writes (`depEdge` read edges) |
| Other requirements | Requirements whose scope overlaps; flagged as possible conflicts |
| Stale verifications | Tests, benchmarks, lint rules and attestations attached to the old version |
| Migration state | Pockets whose job is past `rewriting` and would need to go back |

On approval, the stale verifications are re-run (or re-requested for attestations) and affected pockets
move back to `rewriting` if needed.

---

## 8. Verification

Every approved requirement needs at least one verification. A requirement isn't **satisfied** until all its
verifications pass on its current version.

| Method | Good for | How it runs | Passes when |
| --- | --- | --- | --- |
| `test` | behavior, business-rule, data | Generated from the requirement; pins exact values and every state change (PostcondBench) | The test passes on the target |
| `shadow` | behavior over real traffic | Router compares old and new on replayed traffic | Match rate ≥ `cutover.minMatchRate` (or `criticalMinMatchRate`) for this requirement's endpoints |
| `lint` | style, structure, technology, security | A static rule run over the rewritten code | Zero violations in scope |
| `benchmark` | performance | Timed run on fixed data | Measured value within `measure` |
| `attest` | anything a machine can't check | An approved person confirms in the UI or Slack | Signed by an approved person for the scope; recorded with who and when |

Matching old output **verifies**; an approved person confirming **validates** (L9). Business rules use both.

---

## 9. How the code migration uses requirements

The existing job state machine ([AGENT_LOOP.md](AGENT_LOOP.md#state-machine)) stays. Requirements add gates
and inputs to it.

### 9.1 Choosing a pocket

Unchanged: traffic share and isolation (D-007). New: a pocket with open `critical` questions is ranked last
until they're answered.

### 9.2 Before rewriting: the requirements gate

A job can't leave `capturing` for `rewriting` until every requirement scoped to the pocket (or the
codebase) with category `behavior`, `business-rule` or `data` is `approved` or explicitly waived by an
approved person. Style, structure and technology requirements don't block rewriting; they're checked on
the output.

### 9.3 The harness loop (on Brev)

The harness runs next to Nemotron on Brev. For one pocket:

1. **Read** the pocket's source, its copybooks, its context packs, and every approved requirement in scope
   (codebase-wide style/technology rules included).
2. **Plan**: list which requirement each new function satisfies (the trace links it will write).
3. **Rewrite** to Java behind `TargetRuntime` (D-013), following style, structure and technology
   requirements as hard rules.
4. **Compile** with `javac`.
5. **Run the requirement checks**: generated tests, lint rules, benchmarks.
6. **Run the golden-master cases** from `capturing`.
7. **Fix** on failure, up to `llm.maxFixAttempts`. Each attempt records which requirement failed.
8. **Record trace links** from each requirement to the Java methods that implement it.
9. **Report** through `advanceJob`; never message people. If it can't satisfy a requirement, or finds the
   requirement contradicts the golden master, it writes a `question` (reason `conflict`) and the job waits.

**The harness is OpenHands** (R2), running headless on Brev with Nemotron served by NIM/vLLM as its
OpenAI-compatible model. Our code wraps it so it fits the rest of the system:

- **`services/harness/` (TypeScript adapter, on Brev).** Subscribes to `migrationJob`, claims a job through a
  reducer, builds the task prompt (pocket source, approved requirements, golden cases, the trace links to
  write), starts an OpenHands run in a sandboxed workspace containing the repo checkout, and reports
  progress and results through `advanceJob`.
- **`services/harness-tools/` (TypeScript MCP server, on Brev).** Gives OpenHands our project tools:
  `neighbors(id, depth)`, `who_touches(dataset)`, `get_requirements(scope)`, `record_trace(reqId, file, lines)`,
  `ask(question)` (writes a `question` row; never sends a message). OpenHands keeps its own file, shell and
  edit tools for compiling and running tests.
- **Requirements as hard rules.** Style, structure and technology requirements are given to OpenHands as
  instructions and checked afterwards by the lint verifications; a run that violates them fails step 5.
- **Caveats to check in Phase 6:** OpenHands is Python, which is fine as a third-party tool but means the
  adapter shells out to it or calls its headless API; record/replay of its LLM calls needs a caching proxy
  in front of the model endpoint; how well Nemotron drives OpenHands' tool calling is unverified.

### 9.4 Shadow run and mismatches

The router, legacy shim and Java runner run in the shared worker container (§11). For each mismatch group:

1. If an **approved requirement** covers the signature, it decides: the new code must satisfy the
   requirement, even when that differs from legacy behavior. This replaces "old by default" where a
   requirement exists (extends D-015).
2. Otherwise the oracle runs as today (noise → old by default → ask when suspicious).
3. Every answer from a person becomes, or updates, a requirement through §4, so the knowledge lands as a
   requirement with an owner and a verification, not just a test.
4. "Doesn't matter" waivers need an approved person and are counted on the dashboard (Goodhart guard, L5).

### 9.5 Cutover and done

- A pocket can enter `canary` only when every requirement in scope is **satisfied** (§8) and the shadow
  match rate holds.
- Steps 1% → 10% → 100% with rollback, as today (`cutover.*`, `selfHeal.*`).
- **Done** means: promoted, all requirements satisfied, the old code path retired, and each requirement's
  checks added to CI (fitness functions, L16). "Done except deployment" doesn't count (L5).

### 9.6 Relationship to the knowledge base

HUMAN_LOOP.md's `decision` table and this doc's `requirement` table overlap: a confirmed decision on a
mismatch signature is an approved `behavior` requirement with a `shadow` verification. **Decided (R1):** fold
`decision` into `requirement` (category `behavior`, with the mismatch signature as scope) so there's one
source of truth. HUMAN_LOOP.md is rewritten to match once the team signs off on this doc.

---

## 10. Access control

- **Classify sensitive scopes**: card numbers and PII, payment and interest logic, credentials and security
  code, anything under PCI or SOX. CardDemo is a credit-card system, so much of it qualifies.
- **Mirror source permissions.** A person sees a pocket, program, requirement or rule only if they can
  already see the underlying thing: repo access, the Jira project, the Confluence space, RACF dataset access.
  Never grant broader.
- **Questions only go to people with access.** If the right expert lacks access to some evidence, they get a
  redacted version, or the question goes to someone with access.
- **Enforcement in SpacetimeDB**: sensitive tables become private (not `public: true`) and clients read
  them through **views** that filter by the caller's identity (`ctx.sender`) against an `accessGrant` table.
  SpacetimeDB's docs recommend views over row-level security for this. *(Docs checked are for 1.12; confirm
  behavior on the pinned 2.14.1.)* Today every table is `public: true`.

---

## 11. Workers and hosting

| Where | What runs |
| --- | --- |
| Maincloud (team credits) | SpacetimeDB module (shared state for every process) |
| Brev | Nemotron (NIM / vLLM), the harness (OpenHands + `services/harness/` adapter + `services/harness-tools/` MCP server), a caching proxy in front of the model for replay, `services/web-proxy`, a package mirror, and the sandbox egress firewall |
| One Docker container on a teammate's laptop (Apple Silicon, arm64 image) | Segmenter, Part 2 reader, requirements layer, context connectors, **outreach worker**, people/ownership connectors, router, traffic generator, legacy shim (GnuCOBOL), Java runner |
| Browser | Web UI |

While testing, anyone can run SpacetimeDB in local Docker and point at the hosted NVIDIA API. Raw JSON
outputs stay on disk in the container's mounted folder, linked by hash.

---

## 12. UI specification

> **Built separately.** This section describes what the screens need so another effort can extract and build
> them. The backend build ([REQUIREMENTS_IMPLEMENTATION.md](REQUIREMENTS_IMPLEMENTATION.md)) provides the
> tables, views, reducers and events listed here but writes no UI code.

These screens extend the existing Shadow-Diff dashboard at the repo root (`src/`, Vite + React + TypeScript +
Tailwind v4, Zustand, React Flow, Recharts, Framer Motion). They follow the realtime seam in `CLAUDE.md` and
the rules in `CONTRACT.md`:

- Components read **only** the Zustand store through granular selectors (`@/store/useStore`). No component
  talks to a backend or imports a source.
- New data arrives as `SourceEvent`s from the `RealtimeSource` (today `MockSource`, later `SpacetimeSource`,
  which subscribes to the tables named under each screen). Every user action goes through the source and
  becomes a reducer call; the UI never writes tables directly.
- New shapes (`Requirement`, `RequirementVersion`, `Question`, `Outreach`, `Person`, `Approver`, …) go in
  `src/types.ts`, kept in lockstep with the tables in §14. New screens get their own folder under
  `src/components/<area>/` so owners stay disjoint.
- Each screen ships with a mock scenario in `MockSource` so it demos offline.
- The existing **Decision log** screen becomes the entry point to 12.4 (decisions are approved `behavior`
  requirements, §9.6); the existing isometric **migration map** (segment clusters, semantic zoom) and **Dependency graph**
are the base for 12.1, which adds the requirement and question counts to them.

Every screen must handle four states: **loading** (subscribing), **empty** (with a sentence saying what will
appear and how), **error** (what failed and what to do), and **restricted** (items the viewer can't access
show as "Restricted · ask {owner} for access", never the content). Match the dark theme with
`var(--color-*)` tokens and the shared primitives.

Shared components:

- **Status pill**: `draft` grey, `needs-info` amber, `proposed` blue, `approved` green, `rejected` red,
  `superseded` grey strikethrough.
- **Urgency chip**: critical / high / normal / low.
- **Evidence card**: source icon, title, quote or code excerpt, link out. Code excerpts show file:line.
- **Person chip**: name, title, the source of the link and its confidence on hover.
- **Business / Engineer toggle**: on every question and requirement view; remembered per viewer.

### 12.1 Pocket map

- **Purpose**: see how the codebase splits into pockets and where to start.
- **Data**: `pocket`, `pocketEdge`, `graphNode`, `depEdge`, `migrationJob`, requirement counts per pocket.
- **Layout**: force-directed graph of pockets sized by LOC, colored by job state; edges weighted by
  `pocketEdge.weight`. Side panel for the selected pocket.
- **Side panel**: name, programs, LOC, isolation, traffic share, rank, job state, open questions, and
  requirements by status ("8 approved · 3 proposed · 1 conflict").
- **Signals**: a "hot, too coupled" badge when traffic share is high but isolation is below
  `ranking.minIsolation`; a lock icon on restricted pockets.
- **Actions**: Open requirements (→ 12.4 filtered), Open questions (→ 12.2 filtered), Start migration
  (`startMigration`, approved people only).
- **Acceptance**: a pocket's color changes within a second of `advanceJob`; restricted pockets show no
  program names to viewers without access.

### 12.2 Questions

- **Purpose**: every open question, why it exists, and where it is in the escalation ladder.
- **Data**: `question`, `contextHit`, `outreach`, `person`.
- **List columns**: question text (current view mode), reason chip (missing actor, missing number,
  ambiguous word, conflict, unmade decision, who asked), urgency, scope, routed to (person chips), status,
  next follow-up due.
- **Filters**: reason, urgency, pocket, status, "routed to me".
- **Detail**: the question in business or engineer view; the evidence that triggered it (the lint flag and
  the offending word highlighted, or the two conflicting sources side by side); context hits under it with
  source, URL and quote; answer buttons.
- **Actions**: Answer (`answerQuestion`), Reassign (`reassignQuestion`, approved people), Snooze with reason,
  Mark answered by evidence (links a context hit as the answer).
- **Acceptance**: a question answered in Slack shows as answered here without a reload; every question
  shows who it was routed to and why.

### 12.3 Escalation timeline

- **Purpose**: see what happened to one question over time.
- **Placement**: a tab in the question detail.
- **Content**: a vertical timeline: asked (to whom), each follow-up, manager escalation, approved-person
  escalation, FTE escalation, answer. Each step shows the time and the recipient. The next step shows its
  due time and a countdown.
- **Actions**: Escalate now, Pause escalation (with reason).
- **Acceptance**: the timeline matches the `humanLoop.escalation` config for the question's urgency.

### 12.4 Requirements review

- **Purpose**: the main working screen for reviewing, editing and approving requirements.
- **Data**: `requirement`, `requirementVersion`, `requirementFlag`, `requirementLink`, `approval`,
  `verification`.
- **Header counts**: "12 proposed · 3 flagged · 2 conflicts · 40 approved", each clickable as a filter.
- **List columns**: ID, statement (truncated), category, type, scope, status pill, flags count,
  verification status, owner.
- **Filters**: status, category, type, scope level, pocket, flagged only, "I can approve".
- **Bulk action**: Approve selected, enabled only for clean (no flags, no conflict) items the viewer can
  approve.
- **Detail** (right pane):
  - Statement with **lint flags highlighted inline** (hover shows the rule and the generated question).
  - Slots as labeled fields: actor, condition, outcome, measure, scope, rationale.
  - Category, type, version number, reviewBy date.
  - Evidence: all sources as evidence cards.
  - Trace: links to code (file:line, paragraph, Java method) and verifications.
  - Approvals on this version and previous ones.
- **Actions**:
  - **Approve** (`approveRequirement`): approved people for the scope and category only; needs zero open
    flags.
  - **Reject** (`rejectRequirement`) with a reason.
  - **Edit** (`editRequirement`): opens the slots as a form; saving creates a new version and resets
    approval. Shows a warning first if the requirement is approved.
  - **Needs info** (`markNeedsInfo`): picks a slot and generates a question.
  - **Request change** (→ 12.8).
- **Acceptance**: an approve button is never shown enabled to someone without authority; editing an
  approved requirement visibly moves it back to proposed.

### 12.5 Requirement history

- **Purpose**: see how a requirement changed and who approved each version.
- **Placement**: a tab in requirement detail.
- **Content**: version list with author, time and approval state; a word-level diff between any two
  versions; the reason for each change.
- **Actions**: Restore this version (creates a new version with the old text; needs approval again).

### 12.6 Conflicts

- **Purpose**: resolve two requirements, or a requirement and a source, that can't both hold.
- **Data**: `conflict`, the two `requirementVersion` rows, their sources, the question.
- **Layout**: two columns side by side, each with the statement, sources, who supports it, and what
  happens to the code if it wins (from the impact computation in §7.3).
- **Actions** (approved people only): Pick A, Pick B, Merge (opens an editor prefilled from both), Reword
  both, Escalate. A comment is required.
- **Acceptance**: the screen never preselects a winner; resolving records who decided and why.

### 12.7 Verification panel

- **Purpose**: see how each requirement is proven and whether it currently passes.
- **Placement**: a tab in requirement detail, plus a column in 12.4.
- **Content**: one row per verification: method, what it checks, status (pending, passing, failing,
  stale), last run, link to the test/benchmark output, or who attested and when.
- **Actions**: Run now (machine checks), Request attestation (picks from approved people), Attest (approved
  people only; requires a comment).
- **Acceptance**: a verification attached to an older version shows as stale.

### 12.8 Change request and impact

- **Purpose**: propose a change to a requirement and see what it would affect before anyone approves it.
- **Flow**: Request change → edit the slots → **Impact preview** → submit for approval.
- **Impact preview sections**: lines and functions (file:line, paragraphs, Java methods), programs,
  downstream programs (with the dataset that links them), overlapping requirements, verifications that will
  go stale, pockets that would move back to `rewriting`.
- **Actions**: Submit (`requestRequirementChange`), Cancel. Approvers see the same impact preview with
  Approve / Reject.
- **Acceptance**: every line listed in the preview links to the code; the preview is computed from trace
  links and the graph, not the LLM.

### 12.9 Approver inbox

- **Purpose**: the approver's queue, matching the Slack digest.
- **Content**: items grouped by scope, ranked by what they unblock; the confirmation summary at the top
  ("We found 12 requirements for Interest calculation: 9 complete, 2 need a number, 1 conflict").
- **Actions**: Approve, Reject, Open detail; Approve all clean in this group.
- **Acceptance**: an item approved by another member of the group disappears from everyone's inbox
  (one approver is enough unless quorum applies; quorum items show "1 of 2 approvals").

### 12.10 People and ownership

- **Purpose**: see who owns what and why.
- **Views**: org chart (teams and managers); a person page (titles, teams, what they own with the signal
  and source for each, authority scores per scope and category); a scope page (everyone with a stake,
  including external systems, ranked by authority).
- **Actions**: Correct a link (creates a reviewed override with a reason), Mark as left.
- **Acceptance**: every ownership link shows its source and confidence.

### 12.11 Identity merge review

- **Purpose**: confirm when two identities from different sources are the same person.
- **Content**: candidate pairs (`jsmith` in git, "John S." in Slack, john@co.com in Workday) with the
  matching evidence.
- **Actions**: Merge, Not the same person, Skip.
- **Acceptance**: no merge happens without a confirmation here, except exact email matches.

### 12.12 Generated approver list

- **Purpose**: review and sign off who can approve and attest, per scope and category.
- **Content**: rows of person × scope × category with score, the signals behind it, and access status.
  Changes since the last sign-off are highlighted (new, removed, crossed threshold, left the company with
  suggested successor).
- **Actions**: Sign off the list (customer admin or our FTE), Accept / reject individual changes.
- **Acceptance**: a person without access to a scope never appears as its approver.

### 12.13 Access matrix

- **Purpose**: see and audit who can see which pockets, programs and rules.
- **Content**: a matrix of people or roles × scopes; each cell shows granted / not granted and the source
  permission it mirrors (repo team, Jira project, RACF dataset).
- **Actions**: none that grant broader access than the source. "Request access" opens a link to the source
  system.
- **Acceptance**: the matrix is read-only for grants; restricted cells show the source of the restriction.

### 12.14 Outreach queue

- **Purpose**: see every message the system sends, before and after it goes out.
- **Content**: queued, sent, answered and failed messages; recipient; channel; question link; urgency; next
  follow-up time; a preview in the recipient's view mode and the team tone.
- **Actions**: Send now, Edit wording before send (approved people), Cancel.
- **Acceptance**: nothing reaches Slack without a row here first.

### 12.15 Tone preview

- **Purpose**: see how messages will read for a team.
- **Content**: the learned team register (average length, formality, greeting and emoji use, sample
  phrases), and the same question rendered in the default tone vs. the team's tone.
- **Actions**: Turn off tone matching for a team; edit the banned-phrase list.

### 12.16 Pocket progress

- **Purpose**: follow a pocket through the migration.
- **Content**: the job state machine with the current state highlighted; requirement gate status
  ("rewrite blocked: 2 behavior requirements not approved"); harness attempts with which requirement each
  failed; shadow match rate chart; cutover step; trace coverage (share of requirements with code links and
  passing verifications).
- **Acceptance**: every blocker names the requirement or question that causes it, with a link.

---

## 13. Demo scenario

Modeled on the course's CometWash role-play. Teammates play stakeholders in a small synthetic org (an
HR-export-shaped JSON plus git history mapped to them, since CardDemo's commits are by AWS authors, Q14),
with Notion as a live source. Each stakeholder holds a secret revealed only to the right question (a vendor
contract, an early "done" signal, a privacy worry). The demo shows which generated question found each
secret, the escalation when someone doesn't answer, the conflict screen, and a pocket that can't cut over
until its requirements are approved and verified. One teammate plays the customer admin and signs off the
generated approver list on screen (R3).

---

## 14. Data model additions (SpacetimeDB)

| Table | Key fields | Notes |
| --- | --- | --- |
| `requirement` | id, scope, scopeLevel, category, type, status, currentVersion, ownerId, reviewBy, signature | Head row |
| `requirementVersion` | id, requirementId, n, statement, actor, condition, outcome, measure, rationale, authorId, createdAt | Immutable |
| `requirementFlag` | versionId, rule, word, questionId | From lint |
| `requirementLink` | requirementId, kind (`source` / `code` / `verification`), ref, evidence | Traceability |
| `conflict` | id, aVersionId, bVersionId, questionId, status, resolvedBy, resolution | |
| `approval` | requirementId, versionId, approverId, authority, decision, comment, at | `approverId` from `ctx.sender` |
| `verification` | id, requirementId, versionId, method, status, lastRunAt, attestedBy, artifactRef | |
| `changeRequest` | id, requirementId, proposedVersionId, impactJson, status | |
| `person`, `team`, `reportsTo`, `ownership` | as §5.3, plus source and confidence | Generated from connectors |
| `identityMatch` | candidate pair, evidence, status | Merge review |
| `approver` | personId, scope, category, score, evidence, signedOffBy | Generated list |
| `accessGrant` | personId, scope, sourcePermission | Mirrors source ACLs; private |
| `outreach` | id, questionId, recipientId, channel, urgency, status, sentAt, nextFollowUpAt, step | Escalation state |
| `question` (extended) | + reason, requirementId, slot, urgency | Existing table from DATA_MODEL |

Reducers: `proposeRequirement`, `editRequirement`, `markNeedsInfo`, `approveRequirement`,
`rejectRequirement`, `linkRequirement`, `requestRequirementChange`, `resolveConflict`, `recordVerification`,
`attest`, `createQuestion`, `claimQuestion`, `recordContextHits`, `answerQuestion` (existing name in ARCHITECTURE.md), `reassignQuestion`,
`queueOutreach`, `markOutreachSent`, `signOffApprovers`, and a scheduled `escalationTick`.

## 15. Config additions (`theseus.config.json`)

```jsonc
"requirements": {
  "lint": { "vagueQuantifiers": [...], "undefinedActors": [...], "hiddenAlternatives": [...], "escapeWords": [...] },
  "authority": { "weights": { ... }, "commitHalfLifeDays": 180, "approverThreshold": 1.0 },
  "approval": { "criticalQuorum": 2 }
},
"humanLoop": {
  "escalation": {
    "byUrgency": {
      "critical": { "followUpHours": 6.5, "managerHours": 12, "fteHours": 24 },
      "high":     { "followUpHours": 12,  "managerHours": 24, "fteHours": 48 },
      "normal":   { "followUpHours": 24,  "managerHours": 48, "fteHours": 96 },
      "low":      { "followUpHours": 48,  "managerHours": 96, "fteHours": 168 }
    },
    "businessHoursOnly": true
  }
}
```

All values except the critical follow-up are placeholders.

## 16. Questions and resolutions

| # | Question | Resolution (2026-11-08) |
| --- | --- | --- |
| R1 | Fold HUMAN_LOOP's `decision` table into `requirement` (§9.6)? | **Yes.** One `requirement` table. A mismatch ruling is an approved `behavior` requirement scoped to the mismatch signature, with a `shadow` verification. HUMAN_LOOP.md gets rewritten to point here when the team signs off. |
| R2 | Which harness? | **OpenHands**, running headless on Brev with Nemotron as its OpenAI-compatible model. See §9.3 for how it plugs in. |
| R3 | Who signs off the generated approver list in the demo? | **A teammate playing the customer admin**, on screen (12.12). |
| R4 | Escalation values. | The table in §6.3 and §15 is the starting config. Only the critical follow-up came from the team; the rest get tuned after the first rehearsal. Demo runs on the sim clock. |
| R5 | Do SpacetimeDB views work for access control? | **Yes, in the TypeScript module API** (`spacetimedb.view`, `ViewContext` with `ctx.sender`; clients subscribe with `SELECT * FROM view_name`). Constraints from the 2.0 docs: views read tables only through **indexed** `find`/`filter` (no `iter`), and SQL can't add `WHERE` or joins, so filtering happens inside the view. So `accessGrant` must be indexed by person identity and by scope. Row-level security is marked experimental; don't use it. *(Docs are for 2.0; confirm on the pinned 2.14.1 in Phase 1.)* |
| R6 | Connectors via MCP or raw REST? | **Raw REST** (Jira, Confluence, Notion APIs). Deterministic, cacheable and replayable for the demo. |
| R7 | Where does clustering live? | **Recommended: the built segmenter** (deterministic, D-019–D-026), and change SPEC_DEPENDENCY_PASSES §6 to drop "Part 2 owns clustering". Needs team sign-off. |

## 17. Implementation plan

The same plan told as a story, following CBACT04C from start to finish:
[REQUIREMENTS_IMPLEMENTATION_STORY.md](REQUIREMENTS_IMPLEMENTATION_STORY.md). The engineering detail (files,
tables, reducers, every network call, where data is stored): [REQUIREMENTS_IMPLEMENTATION.md](REQUIREMENTS_IMPLEMENTATION.md).

Owners follow TASKS.md (**Backend A**, **Backend B**, **Frontend**, **Research**). Each phase lists what it
delivers and how we know it's done. Phases in the same lane run in order; different lanes run in parallel
once Phase 1 lands. Nothing here starts until the team signs off this doc (repo rule).

### Phase 0: sign-off (all)

- Review this doc; record R1, R2, R3, R6, R7 in DECISIONS.md as new D-entries.
- Update ARCHITECTURE.md (new workers, Brev contents), DATA_MODEL.md (§14 tables), HUMAN_LOOP.md (decision →
  requirement, outreach worker, escalation ladder), TASKS.md (these phases).
- **Done when:** DECISIONS.md has the entries and the other docs no longer contradict this one.

### Phase 1: data model and reducers (Backend A, `spacetime/`)

- Tables from §14, in their own small schema PR (repo rule).
- Reducers from §14 with their guards: authority check in `approveRequirement`, version reset in
  `editRequirement`, lint-clean check before approval, `escalationTick` as a scheduled reducer.
- Access: make sensitive tables private, add `accessGrant` (indexed by person and scope) and one
  `spacetimedb.view` per screen-facing table that filters by `ctx.sender`. Confirm views on 2.14.1 first (R5).
- Generate bindings; extend `src/types.ts` in lockstep.
- **Done when:** vitest covers each reducer's legal and illegal transitions, and a test client without a
  grant can't read a restricted row through the view.

### Phase 2: requirements layer, deterministic core (Backend B, `services/requirements/`)

- Code-only steps first: collect, lint (word lists from config), signatures, dedupe, conflict detection,
  stable IDs, gap → question generation.
- Planted fixture: a hand-written bundle of findings and answers with an **answer key written first**
  (expected requirements, flags, questions, conflicts), like the Part 1 planted cases.
- Then the LLM steps (separate, classify, fill template) through `packages/llm` with replay cache, temperature 0.
- **Done when:** the planted bundle produces exactly the keyed requirements, flags and questions, and a
  rerun with the cache on makes zero network calls and is byte-identical.

### Phase 3: people and ownership (Research + Backend B, `services/people/`)

- Synthetic org for the demo: an HR-export-shaped JSON (teammates as people, managers, teams), git history
  mapped to them (Q14), and a Notion page owner as a live REST source.
- Connectors → common shape (§5.3) → identity resolution → authority scores → generated approver list.
- **Done when:** for each CardDemo pocket the list names at least one approver with evidence, a planted
  "left the company" person shows a successor, and a planted name-only match lands in merge review.

### Phase 4: context connectors (Backend B, `services/context/`)

- REST connectors for Jira, Confluence and Notion; one `search(question) → {source, url, quote, score}[]`
  interface; responses cached by request hash.
- Subscribes to `question` rows, claims with `claimQuestion`, writes `recordContextHits`.
- **Done when:** a planted question finds its planted Jira ticket and Notion page, cited with URL and quote,
  and replays offline.

### Phase 5: outreach worker (Backend B, `services/outreach/`)

- Slack bot (Bolt, Socket Mode). Reads `outreach` rows; sends business or engineer rendering by recipient
  role; buttons call `answerQuestion` / `approveRequirement`; digests per approver per scope.
- Escalation driven by `escalationTick` (sim clock in demo mode).
- Tone: default style rules and hand-written few-shot examples first; team-register matching is a stretch.
- **Done when:** in a rehearsal, an unanswered planted question escalates follow-up → manager → FTE on the
  sim clock, and a button click in Slack shows in the UI within a second.

### Phase 6: harness on Brev (Backend A, `services/harness/`, `services/harness-tools/`)

- Brev box: NIM/vLLM serving Nemotron, a caching proxy in front of it, OpenHands headless, a JDK.
- TS adapter: claim job → build task from requirements → run OpenHands → collect results → `advanceJob`.
- TS MCP tools server (§9.3) so OpenHands can search the graph, read requirements, record trace links and
  ask questions.
- Requirements gate before `rewriting`; requirement checks in the fix loop.
- Full coding toolkit for OpenHands behind guardrails: `web-proxy` (allowlisted browsing, redacted search),
  a package mirror, a sandbox egress firewall, per-job budgets, and an `agentStep` audit row for every tool
  call (REQUIREMENTS_IMPLEMENTATION §5.6a–b).
- **Done when:** the CBACT04C interest pocket goes from `capturing` to `shadowing` with every behavior
  requirement linked to a Java method and passing its test, and a sandbox call to a non-allowlisted host is
  blocked and logged. **Spike first:** one OpenHands run against
  Nemotron on a toy task, to confirm tool calling works before building the adapter.

### Phase 7: verification runners (Backend A)

- Test runner (generated tests on the Java target), lint runner (style/structure/technology rules over the
  rewrite), benchmark runner (timed run on fixed data), attestation flow (UI and Slack).
- Wire into cutover: `canary` only when all requirements in scope are satisfied.
- **Done when:** editing an approved requirement marks its verifications stale and blocks cutover until
  they pass again.

### Phase 8: UI (Frontend, `src/components/<area>/`): separate effort

Not part of the backend build. Listed so the UI work can be extracted and scheduled on its own. Built against
`MockSource` scenarios first, then `SpacetimeSource`.

| Priority | Screens | Why |
| --- | --- | --- |
| Must have for the demo | 12.4 Requirements review, 12.2 Questions, 12.6 Conflicts, 12.16 Pocket progress, 12.9 Approver inbox | The story: questions → requirements → approval → migration unblocks |
| Should have | 12.3 Escalation timeline, 12.7 Verification panel, 12.8 Change request + impact, 12.1 Pocket map additions, 12.12 Approver list | Shows depth: escalation, verification, traceability |
| Stretch | 12.5 History, 12.10 People, 12.11 Identity merge, 12.13 Access matrix, 12.14 Outreach queue, 12.15 Tone preview | Nice for judges' questions, not on the main path |

- **Done when:** each must-have screen runs offline on a mock scenario, handles loading / empty / error /
  restricted, and passes `npx tsc -b`.

### Phase 9: demo and rehearsal (Research + all)

- The CometWash-style scenario (§13): stakeholder secrets, one conflict, one escalation, one blocked
  cutover that unblocks after approval.
- Record the LLM and REST caches; rehearse twice on the friend's laptop + Brev + Maincloud setup.
- **Done when:** the full demo runs end to end from caches with the network unplugged (except Slack and
  Maincloud).

### Critical path

```
Phase 0 ─► Phase 1 ─┬─► Phase 2 ─► Phase 5 ─┐
                    ├─► Phase 3 ────────────┤
                    ├─► Phase 4 ────────────┼─► Phase 9
                    ├─► Phase 6 ─► Phase 7 ─┤
                    └─► Phase 8 (mock first)┘
```

The riskiest item is **Phase 6** (OpenHands driven by Nemotron), so its spike starts alongside Phase 0
and finishes before the Phase 6 adapter is built.

## 18. Sources

- Dr. Şeker, CS 3354 Software Engineering lectures L2–L18, UT Dallas, Fall 2026 (via `research/`).
- Actor identification: [arXiv:2404.17739](https://arxiv.org/abs/2404.17739).
- PostcondBench and Horizon cases: cited in L17 (see `research/concept-brief.md`).
- Chatterjee et al., Software-related Slack Chats with Disentangled Conversations, MSR 2020:
  [NSF PAR](https://par.nsf.gov/servlets/purl/10175899).
- Subash et al., DISCO: A Dataset of Discord Chat Conversations for Software Engineering Research, MSR 2022:
  [paper](https://soar-lab.github.io//papers/DISCO.pdf).
- SpacetimeDB access control: [Row Level Security](https://spacetimedb.com/docs/how-to/rls),
  [Table access permissions (1.12)](https://spacetimedb.com/docs/1.12.0/tables/access-permissions).
