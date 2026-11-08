# Theseus: Devpost submission

Paste-ready text for hackutd-zeroday.devpost.com. Every number below comes from a real run on AWS CardDemo today; nothing is mocked.

**Tagline (pick one, 60 chars max)**

- Modernize COBOL one program at a time, and ask a human only when nobody has decided.
- Old code is right until a person says otherwise. Theseus proves it, then asks.
- COBOL to Java with receipts: mapped, run, read, rewritten, shadowed, and asked.

---

## Inspiration

Every bank still runs COBOL, and every modernization pitch is "point an LLM at it." That fails for one reason: the code is the only complete spec, and nobody alive remembers why line 1347 does what it does. The hard part was never writing Java. It is deciding, for each place where old and new disagree, whether the old behavior is a rule or a bug, and finding the one person who can say.

We built Theseus around that. The old program is the default truth. The agent does everything it can prove by itself, and interrupts a human only for a decision nobody has written down anywhere.

## What it does

Theseus takes a COBOL codebase (we used AWS CardDemo, 44 programs) and walks it through seven steps, each one visible in a single screen:

1. **Connect a repository.** Sign in with GitHub and pick the repo.
2. **Map the code.** No LLM. A parser reads the COBOL, JCL and CICS config into a dependency map: 367 nodes (programs, copybooks, datasets, jobs, screens, transactions) and 946 links.
3. **Run the code.** Each batch program compiles and runs in a GnuCOBOL sandbox in Docker, with PostgreSQL standing in for DB2, under scenarios built from its own code. A link on the map is confirmed only when the line that makes it actually executes: 44 links confirmed, 16 never fired, 5 found that the static map missed.
4. **Read the code.** Nemotron reads each program with its map links and run results, and reports rules, suspected bugs and open questions. Anything it cannot cite to a real line is thrown out. Across the 44 programs: 1,549 cited findings, 265 rules, 260 suspected defects, 193 questions, and 630 of 630 links explained.
5. **Rewrite the code.** Nemotron writes the Java for one program at a time. It compiles, fixes what javac rejects, runs the same sandbox scenarios as the COBOL, and the outputs are diffed line by line.
6. **Watch it work.** Several programs are read at once and the lines being cited light up in the COBOL as the model writes. A second model, Jev, decides which program takes the stage.
7. **Shadow the rewrite.** Old and new run on the same inputs. Mismatches are grouped into root causes and sorted: noise is waved off, places where the legacy run itself is provably wrong are set aside, and everything else becomes a question routed to the owner on Slack. Traffic moves 1% to 10% to 100% only when the effective match rate clears the 99% gate.

The Slack part is the point. Each unsettled root cause becomes one question with four buttons: keep the COBOL behavior, keep the new behavior, neither, or doesn't matter. The answer is written back as a decision, the rewrite reruns with it, and the match rate moves. Before asking anyone, the agent checks Jira, Notion and old Slack threads; questions those already answer never reach a person.

Real numbers from today: CBACT04C (interest calculation) rewritten and shadowed at 81.4% across 9 scenarios, with 2 root causes waiting on its owner. CBACT01C at 73.4% raw and 82.6% once the legacy run's own sign-decoding errors are set aside.

## How we built it

- **TypeScript everywhere**, pnpm workspace, strict ESM. Java only for the generated code.
- **SpacetimeDB** is the source of truth for all state: questions, people, ownership, outreach, harness jobs, events. Services are clients that subscribe, do outside work, and write back through reducers. The UI and the Slack worker both just watch the database, so an answer clicked in Slack shows up in the browser within a second with no REST API in between.
- **NVIDIA Nemotron** (nemotron-3-ultra) through the NVIDIA API for reading and rewriting. Every call goes through one provider interface with record and replay, so the demo runs offline from a cache and live when we want it to.
- **Our own COBOL segmenter.** graphify and tree-sitter read zero COBOL, so we wrote the Part 1 extractor: programs, copybooks, CALL and EXEC CICS links, JCL datasets, BMS screens.
- **GnuCOBOL + PostgreSQL in Docker** as the legacy runtime witness; the same sandbox compiles and runs the Java.
- **Slack Bolt in Socket Mode** for the outreach worker: one digest per person per program, buttons that call reducers.
- **Vite + React** walkthrough UI, plain CSS, one focal thing per screen.

## Challenges we ran into

- **Fake confidence.** Early LLM output described code that did not exist. We made citation mandatory: a finding with no real line reference is dropped, and we track the drop count.
- **The legacy run can be wrong.** GnuCOBOL on ASCII decodes signed overpunch fields differently from z/OS, so some "mismatches" were the old side's fault. We added a baseline category: the raw match rate stays the headline, and a second effective rate, with proven legacy errors set aside, is what gates the cutover. Both are shown.
- **Noise versus decisions.** Timestamps and run ids differ every time. Grouping mismatches into root causes and classifying them was what turned 50 diff lines into 2 questions.
- **Parallel builds on one repo.** Several of us and several agents on the same checkout. We split ownership by file and kept SpacetimeDB as the one shared state.

## Accomplishments that we're proud of

- The full loop runs end to end on real code: map, run, read, rewrite, shadow, ask, answer, rerun.
- Zero uncited findings reach the screen.
- A Slack button click changes a match rate in the browser, live, with the decision recorded as a requirement.
- The runtime witness found 5 real dependencies the static parser missed and proved 16 were never exercised.

## What we learned

Modernization is a people problem wearing a code costume. The model is good at the Java. The value is in knowing what can be proven, what the documents already answer, and what one specific person has to decide, and interrupting them only for the last kind.

## What's next

- The traffic router that actually moves live requests through the 1/10/100% stages with automatic rollback.
- Answers as generated tests, versioned next to the requirement they settle.
- Escalation when an owner does not answer, and conflict handling when two owners disagree.
- More languages in the segmenter: PL/I and RPG.

## Built with

TypeScript, Node.js, pnpm, Vite, React, SpacetimeDB, NVIDIA Nemotron (nemotron-3-ultra), NVIDIA API, Slack Bolt, Docker, GnuCOBOL, PostgreSQL, Java, OpenRouter (Jev), vitest

**Tracks:** NVIDIA (Nemotron agent), SpacetimeDB (backend), 8090 (legacy modernization)

---

## Demo video script (about 3 minutes)

Record the real app at localhost:5173 with Slack open beside it. Say less than you want to.

**0:00 The problem (20 s).** "Banks run on COBOL nobody fully understands. Rewriting it with an LLM is easy. Knowing which differences are bugs and which are rules is the whole problem. Theseus treats the old program as the truth until a human says otherwise."

**0:20 Map (20 s).** Step 2. Drag the map. "No LLM here. We parsed CardDemo: 44 programs, 946 links."

**0:40 Run (25 s).** Step 3. "Every batch program runs in a GnuCOBOL sandbox. A link is confirmed only when its line executes. 44 confirmed, 16 never fired, 5 the parser missed."

**1:05 Read (25 s).** Step 4. Open one program. "Nemotron reads it with the map and the run. Every finding is cited to a line or it's thrown out. 1,549 findings across the codebase, zero uncited."

**1:30 Rewrite (25 s).** Step 5, CBACT04C. "Nemotron writes the Java, compiles, fixes, runs the same scenarios. Outputs diffed line by line."

**1:55 Shadow and ask (45 s).** Step 7. Point at the big number. "81.4% match. Not 50 diff lines: 2 root causes. Noise is waved off. Where the old run is provably wrong, we set it aside and show both rates. What's left goes to the owner." Switch to Slack, show the digest, click "Keep the COBOL behavior." Switch back: the question moves to answered. "That decision is now a requirement, and the rewrite reruns with it."

**2:40 Cut over and close (20 s).** Step 7 bottom. "Traffic moves 1, 10, 100 percent only when the effective rate clears 99. Everything is in SpacetimeDB, so the browser, Slack and the agent see the same state at the same time." Name the tracks. Stop.
