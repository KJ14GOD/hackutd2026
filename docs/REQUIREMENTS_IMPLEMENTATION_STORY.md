# The implementation plan, as a story

Status: **PROPOSED**, a companion to [REQUIREMENTS_ANALYSIS.md](REQUIREMENTS_ANALYSIS.md) §17. Same plan, same
phases, same owners and checks, told by following one piece of code from start to finish. Written for a
technical PM: every detail from the plan is here, in the order you'd see it happen. Names of people are
the synthetic demo org; numbers marked *(placeholder)* are starting config, not measurements.

---

## The cast

**The code.** `CBACT04C`, CardDemo's interest-calculation batch program. Every night the `INTCALC` job runs
it: for each account category balance it computes monthly interest and posts it. Part 2 already flagged two
things about it: the interest is **truncated, not rounded** (there's no `ROUNDED` clause), and its
`1400-COMPUTE-FEES` paragraph is an **empty "to be implemented" stub** (D-017).

**The people** (the synthetic org from Phase 3, played by teammates):

- **Maria**, manager of Card Services, owner of the interest policy page in Notion.
- **Dev**, the engineer who last changed `CBACT04C` in git history.
- **Priya**, who filed Jira ticket `CARD-88` asking for interest to be "rounded normally".
- **Sam**, a teammate playing the customer admin who signs off the approver list.
- **Alex**, a teammate playing the FTE at our company, the last stop on escalation.

**The machines.**

- **Maincloud** runs SpacetimeDB: every table and every rule. Nothing happens unless a reducer records it.
- **The friend's laptop** runs one Docker container with every worker: segmenter, Part 2 reader,
  requirements layer, people connectors, context connectors, outreach bot, router, traffic generator, legacy
  shim and Java runner.
- **Brev** runs Nemotron, a caching proxy in front of it, and the harness: OpenHands plus our TypeScript
  adapter and tools server.
- **The browser** runs the Shadow-Diff dashboard, which only ever reads the store.

---

## Chapter 0: The team agrees on the plan (Phase 0, everyone)

Before any code, the team reads REQUIREMENTS_ANALYSIS.md and turns its resolutions into decision records:
one `requirement` table instead of a separate `decision` table (R1), OpenHands as the harness (R2), Sam
signing off in the demo (R3), REST connectors (R6), and the built segmenter owning clustering (R7). Then the
older docs are brought in line: ARCHITECTURE.md learns about the new workers and what lives on Brev,
DATA_MODEL.md gets the new tables, HUMAN_LOOP.md points at requirements instead of decisions and describes
the outreach worker and escalation ladder, and TASKS.md gets these phases.

At the same time, Backend A starts the riskiest experiment early: **one OpenHands run against Nemotron on a
toy task**, just to see whether Nemotron can drive OpenHands' tool calling. If it can't, the team finds out
now, not in Phase 6.

> **Done when** DECISIONS.md has the new entries and no other doc contradicts the requirements doc.

---

## Chapter 1: The database learns about requirements (Phase 1, Backend A)

`CBACT04C` needs a place for its requirements to live, so Backend A adds the tables: `requirement` (the
head row), `requirementVersion` (immutable text for each revision), `requirementFlag` (lint results),
`requirementLink` (source, code and verification links), `conflict`, `approval`, `verification`,
`changeRequest`, the people tables (`person`, `team`, `reportsTo`, `ownership`, `identityMatch`,
`approver`), `accessGrant`, `outreach`, and new columns on `question` (`reason`, `requirementId`, `slot`,
`urgency`). Schema changes go in their own small PR, as the repo requires.

Then the reducers, each one guarding a rule from the requirements doc:

- `approveRequirement` refuses anyone who isn't an approved person for that scope and category, and refuses
  any version that still has lint flags.
- `editRequirement` creates a new version and resets approval, so an approved requirement that changes
  goes back to proposed.
- `escalationTick` is a **scheduled reducer**: SpacetimeDB's built-in timer that moves unanswered questions
  up the ladder.

Because `CBACT04C` handles card and interest data, its rows are sensitive. Backend A makes those tables
private and exposes them through **views** that check the caller's identity against `accessGrant`. One catch
from SpacetimeDB's docs: views may only read through indexed lookups, so `accessGrant` is indexed by person
and by scope. Backend A first confirms views behave this way on the pinned 2.14.1. The generated bindings
and `src/types.ts` are updated together so the frontend sees the same shapes.

> **Done when** tests cover every reducer's allowed and refused transitions, and a test client without a
> grant can't read a restricted `CBACT04C` row through a view.

---

## Chapter 2: Findings become requirements (Phase 2, Backend B)

The requirements layer, `services/requirements/`, picks up everything known about `CBACT04C`: Part 2's
`rule` findings, its `defect` finding about truncation, its `edge-value` findings, and any answered
questions. It sorts and hashes that bundle so the same input always looks the same.

The code-only steps come first, because they're what make the process deterministic:

- **Lint** checks each draft against word lists kept in config. Priya's ticket says interest should be
  "rounded **normally**". "Normally" is an escape word, so lint flags it.
- **Signatures** (scope + category + normalized condition) let the layer notice that the code's behavior
  (truncate) and Priya's ticket (round) describe the same thing with different outcomes. That's a
  **conflict**, not a duplicate.
- **IDs** are a hash of the source signature, so the interest requirement is
  `REQ-pkt-cbact04c-…` every time the layer reruns.
- **Gaps become questions.** The "normally" flag becomes an `ambiguous-word` question, the conflict becomes
  a `conflict` question, and the empty `1400-COMPUTE-FEES` stub becomes an `unmade-decision` question.

Only after that do the LLM steps run through `packages/llm`: separating each source into single needs,
classifying them (functional, quality or constraint, plus a category like `behavior` or `business-rule`),
and filling the template slots (actor, condition, outcome, measure, scope, rationale, sources). Temperature
0, schema-checked, cached by prompt hash.

To prove it works, Backend B writes a **planted bundle with its answer key first**: the requirements, flags,
questions and conflicts it must produce, the same way Part 1's planted cases work.

> **Done when** the planted bundle produces exactly the keyed output, and a rerun with the cache on makes
> zero network calls and produces byte-identical results.

---

## Chapter 3: Finding the right people (Phase 3, Research + Backend B)

Questions are useless without someone to ask. `services/people/` pulls the synthetic org: an HR-export-style
JSON with teammates as people, their managers and teams; git history mapped onto them (CardDemo's real
commits are by AWS authors, Q14); and a Notion page whose owner is Maria.

Every connector produces the same five shapes: person, team, reports-to, owns, evidence. Identity matching
joins `dev@…` in git with Dev in the HR export by email. A planted entry with only a similar name and no
shared email lands in merge review instead of being auto-merged.

Authority scoring then adds up weighted signals per person, scope and category *(weights are placeholders)*:
Maria scores high on `business-rule` for interest because she manages Card Services and owns the policy page;
Dev scores high on `behavior` because of his recent commits. Someone becomes an **approved person** only if
they're active, already have access to `CBACT04C`, and clear the threshold. Each entry says why ("Maria:
manager of Card Services, owner of the interest policy page"). A planted person marked as having left the
company shows a suggested successor.

Sam, playing the customer admin, signs off the generated list once on screen.

> **Done when** every CardDemo pocket has at least one approver with evidence, the left-company person shows
> a successor, and the name-only match lands in merge review.

---

## Chapter 4: Looking things up before asking (Phase 4, Backend B)

Before anyone gets a message, `services/context/` tries to answer the questions from documents. It watches
for new `question` rows, claims one with `claimQuestion` so no other connector takes it, and searches Jira,
Confluence and Notion through their REST APIs behind one interface: question in, a ranked list of
`{source, url, quote, score}` out. It finds `CARD-88` (Priya's ticket) and Maria's Notion policy page, and
records both as context hits with their URLs and exact quotes. Every response is cached by request hash, so
the demo replays without the network.

The documents disagree, so the conflict stays open. Now it's time to ask people.

> **Done when** a planted question finds its planted Jira ticket and Notion page, cited with URL and quote,
> and the lookup replays offline.

---

## Chapter 5: Asking, following up, escalating (Phase 5, Backend B)

`services/outreach/` is the only process allowed to message anyone. It's a Slack bot (Bolt, Socket Mode)
that reads `outreach` rows the other workers created.

For the conflict, it **asks both sides together**: Priya (who wrote the ticket) and Dev (who owns the code),
in one message. Because Priya's directory role is business, she sees the business rendering: one sentence,
a small table of three real accounts with today's result and the rounded result, how many accounts and
roughly how much money it affects, and three buttons. Dev sees the engineer rendering: the cleaned-up COBOL
paragraph with a plain summary, `CBACT04C.cbl` line numbers, and which other programs read the same balance
file. The message sounds like a colleague: first name, who's asking, one question, no filler phrases.

Nobody answers. This touches money, so it's `critical` urgency. After 6–7 hours the scheduled
`escalationTick` sends a follow-up. Still nothing, so after 12 hours *(placeholder)* it goes to their
manager, Maria, found through the org chart. In the demo this runs on the sim clock, so the whole ladder
plays out in minutes. Maria clicks a button in Slack; the dashboard shows it within a second.

Maria's answer also goes through the approval digest: one message per approver per scope, ranked by what
each item unblocks, with a summary at the top ("We found 12 requirements for Interest calculation: 9 look
complete, 2 need a number, 1 conflicts with CARD-88"). One approver is enough, except for critical and money
items, which need 2 *(placeholder)*. Team-tone matching is a stretch goal; the default style rules and
hand-written examples come first.

> **Done when** in a rehearsal an unanswered planted question escalates follow-up → manager → FTE on the sim
> clock, and a Slack button click shows in the UI within a second.

---

## Chapter 6: The harness rewrites the code (Phase 6, Backend A)

With its behavior requirements approved, `CBACT04C`'s pocket passes the **requirements gate** and its
migration job can leave `capturing` for `rewriting`.

On Brev, our TypeScript adapter (`services/harness/`) sees the job, claims it, and builds a task for
OpenHands: the pocket's source and copybooks, every approved requirement in scope (the interest truncation
rule, plus codebase-wide rules like "money uses `BigDecimal`"), the golden-master cases recorded during
capture, and the trace links it's expected to write. OpenHands runs headless in a sandboxed checkout, with
Nemotron (served by NIM/vLLM behind a caching proxy) as its model.

OpenHands has its own tools for files, shell and editing. Our TypeScript MCP server
(`services/harness-tools/`) adds the project-specific ones: `neighbors` and `who_touches` to search the
graph, `get_requirements` to read requirements, `record_trace` to link a requirement to the Java method that
implements it, and `ask` to write a question row if it gets stuck. It can't message anyone.

OpenHands writes the Java, compiles it with `javac`, runs the requirement tests and the golden-master cases,
and fixes failures up to the attempt limit, noting which requirement failed each time. Style and technology
rules are checked afterward by lint, so a rewrite that ignores them fails. When it finishes, the adapter
reports through `advanceJob` and the pocket moves to `shadowing`.

> **Done when** the CBACT04C pocket goes from `capturing` to `shadowing` with every behavior requirement
> linked to a Java method and passing its test.

---

## Chapter 7: Proving it (Phase 7, Backend A)

Each approved requirement carries at least one verification, and the pocket can't cut over until all of them
pass on the current versions:

- the interest truncation requirement has a **test** pinning exact values and every state change, and a
  **shadow** check against replayed traffic;
- "money uses `BigDecimal`" has a **lint** rule over the rewrite;
- "INTCALC finishes in under 5 seconds for 10,000 accounts" has a **benchmark**;
- the fee-waiver rule from the empty stub has an **attestation**: Maria signs it off in the UI.

Then someone requests a change: Priya still wants rounding. The change-request screen shows the impact from
trace links and the graph: the exact lines and Java methods, the downstream programs that read the balance
file, the other requirements on the same code, and the verifications that would go stale. If Maria approves
it, those verifications are marked stale and cutover blocks until they pass again.

> **Done when** editing an approved requirement marks its verifications stale and blocks cutover until they
> pass again.

---

## Chapter 8: What people see (Phase 8, Frontend, built separately)

This chapter is a separate effort: the backend build provides everything these screens read and call, and
the UI team extracts this list and builds it on its own schedule.

Everything above shows up in the Shadow-Diff dashboard, built against `MockSource` scenarios first so it
demos offline, then switched to `SpacetimeSource`. Screens live in their own folders under
`src/components/<area>/` and read only the store.

**Must have for the demo:** Requirements review (Maria approves, with lint flags highlighted), Questions
(why each was asked and who it went to), Conflicts (truncate vs. round side by side, no winner preselected),
Pocket progress (the gate saying "rewrite blocked: 2 behavior requirements not approved", then clearing),
and the Approver inbox.

**Should have:** Escalation timeline, Verification panel, Change request + impact, the requirement and
question counts on the pocket map, and the generated approver list for Sam's sign-off.

**Stretch:** Requirement history, People and ownership, Identity merge review, Access matrix, Outreach
queue, Tone preview.

Every screen handles loading, empty, error and restricted states.

> **Done when** each must-have screen runs offline on a mock scenario, handles all four states, and passes
> `npx tsc -b`.

---

## Chapter 9: The demo (Phase 9, Research + everyone)

On stage, the story above runs as a CometWash-style role-play. Teammates play stakeholders, each holding a
secret only the right question reveals (a vendor contract, an early "done" signal, a privacy worry). The
judges watch the system find each secret, escalate one unanswered question, resolve the truncate-vs-round
conflict through Maria, and unblock the interest pocket's cutover once its requirements are approved and
verified. Sam signs off the approver list on screen.

The LLM and REST caches are recorded beforehand, and the team rehearses twice on the real setup: friend's
laptop, Brev and Maincloud.

> **Done when** the full demo runs end to end from caches with the network unplugged, except Slack and
> Maincloud.

---

## How the chapters overlap

Chapter 0 has to finish first, and Chapter 1 (the database) unblocks everyone. After that four lanes run at
once: the requirements layer and outreach (Chapters 2 and 5), people (Chapter 3), context lookups
(Chapter 4), and the harness and verification (Chapters 6 and 7). The UI (Chapter 8) starts on mock data
right after Chapter 1. Everything meets in the demo (Chapter 9).

```
Ch 0 ─► Ch 1 ─┬─► Ch 2 ─► Ch 5 ─┐
              ├─► Ch 3 ─────────┤
              ├─► Ch 4 ─────────┼─► Ch 9
              ├─► Ch 6 ─► Ch 7 ─┤
              └─► Ch 8 (mock) ──┘
```

**The biggest risk is Chapter 6**: nobody has confirmed that Nemotron can drive OpenHands' tool calling, and
replaying its calls needs the caching proxy. That's why its spike starts in Chapter 0 and finishes before the
adapter is built.
