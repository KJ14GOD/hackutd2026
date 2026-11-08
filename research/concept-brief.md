# Legacy Knowledge Agent — Concept Brief

Nov 7, 2026 · @aayush

An agent that modernizes legacy code one isolated component at a time, and asks the right person on Slack or Teams whenever it can't tell which behavior is correct. Every answer becomes a test, so the knowledge in people's heads ends up as verified code.

## The problem

Legacy modernization mostly stalls on knowledge, not code. An LLM can translate COBOL or old Java fast, but it can't know whether a quirk in the old system is a bug or a business rule someone depends on.

- **The rules aren't written down.** They live in the heads of engineers and domain experts, many of whom are busy or have moved on.
- **Big-bang rewrites fail.** Rewriting everything at once and switching over in one go is the classic way these projects blow up.
- **Asking people is slow and lossy.** Questions get sent to the wrong person, lack context, and get buried in chat. When answers do come back, they sit in a thread instead of in the code.

We attack all three: isolate the code, verify behavior automatically, and make asking a human fast, targeted, and permanent.

## How it works

The system runs a loop per component. Steps 4–6 repeat until the component passes its thresholds, then it cuts over on its own. There's no big merge at the end.

1. **Map dependencies.** Build a graph of imports, calls, and shared database tables. Collapse cycles, then cluster the graph to find components with the fewest edges crossing their boundary.
2. **Rank components.** Score each by isolation (fewest cross-edges) and existing test coverage. Start with the easiest.
3. **Capture behavior.** Record real inputs and outputs at the component's boundary. These become golden-master tests of what the old code actually does.
4. **Rewrite.** An LLM rewrites the component behind a switch (branch by abstraction), so old and new are interchangeable.
5. **Shadow run.** Replay traffic through old and new side by side. Only the old one is allowed to commit side effects. Compare the outputs.
6. **Ask when unsure.** When a mismatch can't be explained automatically, the agent asks the code's owner on Slack or Teams. The answer becomes a test, and the loop goes back to step 4.
7. **Cut over.** Once match rate, correctness, and uptime pass their thresholds, traffic moves gradually: 1% → 10% → 100%.

This is the **Strangler Fig** pattern, automated end to end.

## The communication layer

This is the core product: a layer that turns an agent's uncertainty into one question a busy person can answer in seconds. It solves three problems.

### 1. Framing the right problem

- **Ask for a decision, not an explanation.** "Old code rounds 2.345 → 2.34, new gives 2.35. Which is correct?" with buttons **[Old] [New] [Neither]**. Never "Can you explain the rounding logic?"
- **Show evidence inline.** The exact input, both outputs, and a 5-line code snippet. The person never has to open an IDE.
- **Batch and rank.** Group mismatches that share a root cause into one question. Only ask when the answer unblocks work, ranked by how many mismatches it would resolve.

### 2. Getting a response

- **Route to the right person.** Owners come from `git blame`, CODEOWNERS, and commit history for that component.
- **One-click answers.** Slack Block Kit buttons or Teams Adaptive Cards, with a free-text "Other" option.
- **Escalate, don't block.** No answer in N hours → a backup owner → the team channel. The agent keeps working on other components in the meantime.

### 3. Not asking twice

- Check the decision log before asking anything.
- When one answer settles a whole class of mismatches (e.g., "always round half-down"), apply it to every matching case.

## Requirements playbook

The agent follows the requirements-engineering process from UTD CS 3354 (Dr. Şeker, Chapters 5–7): elicit, specify, validate, manage, and go round again. Every pass finds what the last one missed.

### Why people can't just tell you

- **They describe solutions.** "Add a refresh button" really means "I can't tell if this is current." The agent asks why until it reaches a need that would survive a change of technology.
- **They leave out the obvious.** The most important facts go unsaid because everyone takes them for granted.
- **They can't picture what's possible.** Showing old vs. new output gives them something to react to.

### Pick the question by the gap

| Gap | Technique | Agent version |
| --- | --- | --- |
| Need broad coverage | Closed interview | Standard question set per component: who uses it, what happens on failure, what it must NOT do |
| Something important is unsaid | Open interview + why | Follow-ups in the same thread; chase the part they skip |
| Steps done on autopilot | Scenario walkthrough | "Walk me through the last time this broke" |
| What people say vs. what they do | Observation | Opt-in screen recording and production logs |
| Rules, history, regulation | Document study | Read commits, tickets, and docs before asking anyone |
| They can't picture it | Prototype | Show both outputs side by side |

### Every answer becomes a real requirement

1. **Separate:** split a quote into its distinct needs.
2. **Classify:** functional (adds behavior), quality (how well), or constraint (removes options).
3. **Make it checkable:** add a number, a condition, and who it applies to.
4. **Give it an ID and an owner,** then send the write-up back to the person to confirm.

The agent automatically flags ambiguous words: vague quantifiers (fast, most), undefined actors (the user, they), hidden alternatives (and/or, etc.), and escape words (normally, where possible).

### Conflict, priority, and change

- **Two people disagree:** name the conflict, find the shared need, design past it, and record who decided. Never average or silently pick one answer.
- **Priority:** value, risk, dependency, cost, urgency. Risky foundations go first even when they're low-value.
- **Validation, not just verification:** a match with old behavior proves it was built right. Confirming with the person who has the need proves it's the right thing.
- **Change control:** record the request → assess impact through traceability → the owner decides → revise the baseline. Decision records carry the trace from need to requirement to code to test.

### Why a human must stay in the loop

| Task | LLM correctness | Source |
| --- | --- | --- |
| Identifying actors (who has the knowledge) | 31% | [arXiv:2404.17739](https://arxiv.org/abs/2404.17739) |
| Recovering dependencies between components | under 0.18 | [R2ABench, arXiv:2604.06683](https://arxiv.org/abs/2604.06683) |
| Class attributes from requirements | under 4.5% | Cheng et al., Applied Sciences 16(13), 2026 |
| Sequence-diagram correctness | 3.22 / 5 | [arXiv:2404.06371](https://arxiv.org/abs/2404.06371) |

LLMs are strong on form and weak on content, and they get worse on ambiguous requirements, which is exactly where help is needed. So the dependency map comes from static analysis and git history, and the business rules come from people. Coupling is also where the defects are: tangled files drove 62% of defect-fixing work in two decade-old industrial systems (MacCormack & Sturtevant, 2016).

### Demo: stakeholders with secrets

Modeled on the course's CometWash role-play. Each fictional stakeholder holds a secret they reveal only when asked the right question (a vendor contract, an early "done" signal, a privacy worry). The demo shows which agent question found each secret, scored against teammates playing the forward-deployed engineer.

## Ground truth

An answer only counts once it's executable. Every reply is turned into code and a record, never left in a chat thread.

| Answer | What gets generated |
| --- | --- |
| Old is correct | Golden-master test locking in the old behavior; the rewrite is fixed to match |
| New is correct | Test for the new behavior, plus a documented bug fix in the old system |
| Neither | Test from the person's free-text spec; flagged for review |
| Doesn't matter | Comparison rule that ignores that field (e.g., timestamp formatting) |

Each answer is also saved as a **decision record**: question, evidence, who answered, when, and the test it produced. Over time, this becomes the business-rules documentation that legacy systems never had.

## Prior art and what's new

Each piece exists on its own. Nobody has connected them into one loop that closes on human answers.

| Existing work | What it does | Gap we fill |
| --- | --- | --- |
| Strangler Fig (Fowler) | Replace a system piece by piece | It's a pattern, not tooling; we automate it |
| GitHub Scientist, Twitter Diffy | Run old and new side by side, diff outputs | Report mismatches but don't resolve them |
| Software clustering (Bunch, DSM tools) | Find modular boundaries | Analysis only; not connected to a rewrite |
| HumanLayer, LangGraph `interrupt` | Pause agents for human approval | Approvals ("may I?"), not knowledge extraction ("what's right?") |
| Coding agents' Slack bots (Devin, etc.) | Chat with an agent | Unstructured; answers don't become tests |

**Our wedge:** structured, evidence-backed questions routed to the right owner, where every answer becomes a test.

## Risks and how we handle them

| Risk | Mitigation |
| --- | --- |
| Nondeterminism (timestamps, IDs, ordering) shows up as fake mismatches | Run two copies of the old code to measure noise, then filter it out of the old-vs-new diff (Diffy's technique) |
| Shadow runs duplicate side effects (DB writes, emails) | Only the old path commits; the new path runs against a sandbox or mocks |
| Hidden coupling through shared DB tables or config | Add table access and git co-change history as edges in the dependency graph |
| Internal components don't receive requests | Capture inputs and outputs at function/module boundaries, then replay |
| Question fatigue: people stop answering | Batch questions, rank by impact, cap per person per day, never ask twice |
| Wrong person answers | Route by code ownership; record who answered; let critical modules require two sign-offs |
| "99% match" hides a critical 1% | Classify mismatches (formatting vs. logic); set per-component thresholds, stricter for money paths |

## Edge cases from the full course read

The biggest change: **the legacy system is not automatically the ground truth.** Every mismatch is classified before anyone is asked, and the agent never makes a business decision on someone's behalf. Each case below comes from a CS 3354 lecture (L2–L18).

### Ground truth and grading

| Edge case | Real example | How the agent handles it |
| --- | --- | --- |
| Old output is wrong but trusted | UK Post Office Horizon: 25 defects, and only one side could assert the accounts were right (L17) | "Old is correct" is never the default. Where old output can't be independently checked, the agent flags it and asks a person |
| Grading your own work | Toyota "Task X" held a function and the monitor meant to catch its failure (L17) | The model that rewrites a component never grades it. The verifier and the oracle are separate from the generator |
| Match rate becomes the goal | Goodhart's law on velocity (L5) | Every "doesn't matter" ignore rule needs an owner's sign-off. The dashboard shows how many mismatches were waved off, not just the match % |
| Output claims something happened that didn't | `openLock()` returns void, but the audit log says OPENED (L18) | Compare effects (rows written, messages sent), not only return values |
| Tests that pass and forbid nothing | LLM postconditions were complete only 21–26% of the time; 78% under-specify the return value (PostcondBench, L17) | A test generated from an answer must pin the exact value and every state change, not just the type |

### What shadow replay won't catch

| Edge case | Real example | How the agent handles it |
| --- | --- | --- |
| Events that never happened in the replay window | Southwest 2022: "a use case that nobody defined" (L15) | Add synthetic rare scenarios (outages, bursts, irregular operations) on top of recorded traffic |
| Bugs that appear only under concurrency | CometPark double count when 40 sensors fired at the 9:50 peak; Healthcare.gov's defects were in the seams (L3) | Replay at peak concurrency and test end to end, not just per component |
| Faults that build up over time | Boeing 787 counter overflowed after 248 days (L17) | Check counter and field widths; run long-horizon tests on time-dependent logic |
| A check made too early | AWS US-EAST-1, Oct 2025: staleness checked at the start, trusted until the write; 14.5 hours of disruption (L17) | Replay with reordered and delayed events; flag time-of-check/time-of-use gaps |
| Dormant code that wakes up | Knight Capital: dead code woke on 1 of 8 servers; $460M lost in 45 minutes (L2, L3) | Ask about dead code before cutover; verify every node; canary, kill switch, and a named response owner |
| Silent defaults | Google Cloud 2024: a blank parameter defaulted to one year, and a customer environment was deleted (L17) | Ask explicitly about every implicit default the old code relies on |
| Same number, different meaning | Mars Climate Orbiter units mismatch; "meal" meant two things in CometDine (L3, L11) | Keep a glossary per field (units, meaning); ask when one word maps to two concepts |
| Old assumptions carried into a new context | Ariane 5 overflow; Therac-25 removed hardware interlocks (L2, L3) | Never silently drop a legacy guard or check during the rewrite; ask why it's there |
| Different toolchains compute differently | Airbus A380: CATIA V4 vs V5 bend-radius calculations (L3) | Separate language and library noise (rounding, floats, dates) from real logic diffs |

### Asking people

| Edge case | Source | How the agent handles it |
| --- | --- | --- |
| Defect vs. unmade decision | CometLab design round (L18) | A defect contradicts something already agreed, so the agent fixes it. An unmade decision has no answer anywhere, so it goes to a named owner |
| Business calls the agent has no authority to make | CometPrint: debit before or after printing? "Nobody is told": decision or oversight? (L14) | "Could not decide, ask <owner>" is the correct output. The decision record stays Proposed until the owner answers |
| Two mandatory rules that can't both hold | CometLab availability vs. revocation (L16) | Lay out both options with their costs, then hand the choice to whoever is entitled to make it |
| Unclear whether a step is trivial | L14 borderline step | Ask instead of guessing, because the guess decides the architecture |
| Code nobody asked for | Traceability blank column (L11) | Ask "who asked for this?" before porting it. An empty row for an out-of-scope item can be correct, so don't flag it automatically |
| Missed actors | LLMs scored 31% on actor identification; the Card Office system is the most-missed actor (L11) | Route by role, not by person. External systems are actors too; ask their owners |
| Several consumers of one output | CometPark: four stakeholders, but only one need made it into REQ-14 (L3) | Ask everyone who consumes the output, not just the code owner |
| A hidden extra state | LIVE/STALE/DARK: "what if it never comes back?" (L11) | When the answer depends on history, ask about the never-recovers case |
| Two answers conflict | L10, L11 | Clarify with both people first. Never pick one, average them, or model both |
| Decisions that go stale | "An out-of-date model is worse than no model" (L11) | Decision records get a review date and can be retired |

### Rewrite and cutover quality

| Edge case | Source | How the agent handles it |
| --- | --- | --- |
| AI-built code clusters into "manager" god classes | Modular Mirage: smells track lines of code at ρ = 0.94 (L17) | Gate on cohesion and coupling of the rewrite, not only output match |
| Message chains (`a.b().c().d()`) | The only antipattern linked to change-proneness in more than 75% of releases (L17) | Count the dots: two is a smell, three is a defect |
| Every boundary has a cost | Prime Video: supported 5% of load until boundaries were removed (L15) | Measure the latency and cost the switch and shadow calls add |
| The strangler never finishes | Chrysler C3 never fully replaced its predecessor (L5) | Track the share of the old path retired; removing the old code is part of done |
| "Done except deployment" | Definition of Done (L5); the Lesson 2 duplicate-charge incident had no tested rollback and nobody could identify the live version | Cutover requires a tested rollback and visible versions |
| Decisions erode after people leave | Fitness functions (L16) | Each decision record also becomes a CI check that runs on every build |

**Health metrics for cutover:** DORA's four keys: deployment frequency, lead time, change failure rate, and recovery time (L6). They're used to spot trends, never as targets.

**Gaps in the source material:** Lesson 8 (risk and the critical path) isn't in the folder, and the L7/L8 file matches the L7 v2 deck. L9 presents the 100× cost-of-change curve as a well-known shape, while L6 says its multipliers are untraced. Quote only the direction, not the numbers.

## Hackathon build plan and demo

**Target codebase:** AWS's open-source COBOL sample, [CardDemo](https://github.com/aws-samples/aws-mainframe-modernization-carddemo), or an old Java/PHP app.

**Build, in priority order:**

1. Dependency graph + component ranking (show it visually)
2. Boundary capture and replay harness for one component
3. LLM rewrite of the top-ranked component
4. Shadow-diff dashboard: match % over time, mismatches by category
5. Slack bot (Bolt SDK) that posts evidence cards with one-click answers
6. Answer → test generator + decision log
7. Cutover toggle

Teams support is out of scope for the hackathon; Slack's Bolt SDK is much faster to stand up.

**Demo script (~2 minutes):**

1. Show the dependency graph and the component we picked, with its isolation score.
2. Start the shadow run. Match rate sits around 80%.
3. The agent posts a Slack card: input, both outputs, code snippet, three buttons.
4. A teammate clicks one answer live.
5. The test is generated, and the dashboard jumps.
6. After a few answers, the match rate passes 99%. Flip the cutover switch.

## Success metrics

| Metric | Target |
| --- | --- |
| Output match rate (noise filtered) | ≥ 99% per component, 100% on critical paths |
| Questions answered | ≥ 80% within 24 hours |
| Mismatches resolved per answer | > 1 (shows batching works) |
| Time from question to merged test | < 5 minutes after the click |
| Uptime/error rate after cutover | No worse than the legacy component |

The hackathon targets are illustrative; the demo should report whatever the real numbers turn out to be.
