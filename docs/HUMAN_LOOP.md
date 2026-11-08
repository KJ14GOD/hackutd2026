# Human loop

> **PROPOSED (Milestone 2).** Based on `research/concept-brief.md` ("The communication
> layer" and "Ground truth"). Slack only; Teams is out of scope (Q8).

Old behavior is the default truth, and the **knowledge base** overrides it (D-015). The
agent asks a person only in the cases listed in
[AGENT_LOOP.md → The oracle](AGENT_LOOP.md#the-oracle): a suspected legacy bug,
conflicting or low-authority knowledge, a money field that can't be checked
independently, or code that looks dead or deliberate. Everything else is either settled by
the knowledge base, or assumed old-correct and reported in a digest.

## The knowledge base

The `decision` table in SpacetimeDB. One row per piece of expert knowledge:

| field | meaning |
| --- | --- |
| signature | what it applies to: endpoint + field paths + value shape (or a program/paragraph for notes) |
| ruling | `old` / `new` / `neither` (+ spec) / `ignore_field` |
| source | `slack_answer` / `imported_note` / `assumed_old` |
| expert | who said it (Slack user / git author) |
| authority | `owner` / `backup` / `other`, relative to the code it covers |
| status | `assumed` → `proposed` → `confirmed` → `retired` |
| evidence, test | the mismatch evidence and the test it produced |
| reviewBy | sim date after which the entry is re-checked (research: stale decisions mislead) |

An answer from the code owner is `confirmed` immediately. An answer from anyone else
starts as `proposed`; on money paths it needs owner confirmation before it can override
old behavior. `assumed_old` rows are created by the agent, never count as expert
knowledge, and are listed in a daily digest to owners: one message, with an
"overturn" button per row.

Expert notes can also be imported from `knowledge/` in the repo, e.g. "the
SCRA rule: military accounts pay no late fees", tagged with author and authority (Q17).

## Wording: ask for a decision, not an explanation

One Slack message per mismatch group, Block Kit:

> **Monthly interest: old and new disagree by a cent (41 accounts)**
> Input: account `00000000011`, category balance `1234.56`, rate `18.75`
> Old (COBOL): `monthlyInterest: "19.29"`  ·  New (Java): `monthlyInterest: "19.30"`
> ```cobol
>       * CBACT04C 1300-COMPUTE-INTEREST
>        COMPUTE WS-MONTHLY-INT
>         = ( TRAN-CAT-BAL * DIS-INT-RATE) / 1200
> ```
> Our guess: the old code truncates (no ROUNDED), and customers have always been billed this way. Which is correct?
> **[Old] [New] [Neither] [Doesn't matter]**

Rules: exact input, both outputs, a ~5-line snippet, our best guess, and the count of
mismatches the answer would settle. Before sending, the question text is checked for
ambiguous words (vague quantifiers, undefined actors, "and/or", "normally").

## Who gets asked

1. Owners of the pocket's files from `git blame` / commit history (most recent
   significant author first), overridden by `CODEOWNERS` when present. CardDemo's
   history is a few AWS authors, so for the demo `config/owners.json` maps CardDemo
   paths to teammates (Q14).
2. Mapped to Slack users through a small config file, e.g. `config/owners.json`
   (`{"git-email": "SLACK_USER_ID"}`) plus a backup owner and a team channel.
   PROPOSED; open whether that file lives in the repo or in SpacetimeDB (Q14).
3. Route by role, not person. Record who answered.

## Escalation and limits (`theseus.config.json` → `humanLoop`)

- No answer after `escalation.backupAfterSimMinutes` → backup owner;
  after `escalation.channelAfterSimMinutes` → team channel. Each step emits `question.escalated`.
- At most `maxQuestionsPerPersonPerSimDay` per person; extra questions queue, ranked by
  how many mismatches they'd resolve.
- The job keeps running the whole time (see AGENT_LOOP).

## Deduplication

- Check the knowledge base first: a decision whose signature matches the group settles
  it without asking (subject to the authority rules above).
- One answer applies to every mismatch with the same signature, now and in the future.
- Two people giving conflicting answers → go back to both of them. Never pick one or average them.

## Every answer becomes a test

| Answer | Generated | Also |
| --- | --- | --- |
| **Old** | golden-master test pinning the old value; rewrite is fixed to match | knowledge-base entry (`confirmed` if the owner answered) |
| **New** | test for the new behavior | knowledge-base entry; `legacyBug` row with estimated impact (e.g. $ overpaid × occurrences), `legacy_bug.found` |
| **Neither** | asks a free-text follow-up in the thread; test from the spec; flagged for review | decision stays Proposed until confirmed |
| **Doesn't matter** | comparison rule that ignores that field | needs owner sign-off; the UI shows how many mismatches were waved off (Goodhart guard) |

Tests pin exact values and every state change, not just types (research: PostcondBench).
Each decision record stores the question, evidence, who answered, when, the test it
produced, and a review date.
