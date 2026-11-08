# Research map

## Three core findings

| Finding | The number | What it means |
| --- | --- | --- |
| AI is strong on form, weak on content | **31%** LLM accuracy at identifying actors (who holds the knowledge); dependency recovery under 0.18 | People stay in the loop |
| Tangled code is where bugs live | **62%** of defect-fixing work sat in the tightly coupled 26% of files | Isolate loose components first |
| People can't just tell you | **3 reasons**: they describe solutions, skip the obvious, and can't picture what's possible | How you ask matters as much as whom |

## The six steps

| Step | The question | What the research says | Do this | The trap | Source |
| --- | --- | --- | --- | --- | --- |
| 1. Map the code | Which parts don't depend on each other? | Build the graph with static analysis and git history, not an LLM. Models recover components (up to 0.85) but not the arrows between them (under 0.18); 39% of their errors are invented dependencies. | Rank components by coupling type and boundary width. Count "how many modules must I open if this changes?" | Hidden coupling: shared DB tables, and humans doing integration by phone (Southwest 2022) | L15/L16, R2ABench 2026, MacCormack and Sturtevant 2016 |
| 2. Read before asking | What do the code, commits, and tickets already say? | Document study finds rules and history nobody remembers. A good session reads first so it never wastes someone's time. | Mine commits, tickets, and docs. Only uncertainty that survives becomes a question. | Code nobody asked for (blank traceability column): ask "who asked for this?" before porting | L9, L11 |
| 3. Rewrite and shadow-run | Does the new version behave like the old one? | Replay real traffic through both. Run two copies of the old code first to measure noise. | Compare effects (rows written, messages sent), not just return values. Add synthetic peaks and rare events. | Replay only covers history: storms, 248-day counters, peak-load double counts, and early checks (AWS 2025) slip through | L3, L15, L17, Diffy, Scientist |
| 4. Classify the mismatch | Is this a bug, or a decision nobody made? | A defect contradicts something agreed and is provable from it. An unmade decision has no answer anywhere and needs an owner. | Fix defects silently. Send only unmade decisions to people. | The old system isn't automatically right: Horizon was trusted over people and had 25 defects | L18, L17 |
| 5. Ask the right person | Who knows, and how do we get a one-click answer? | Pick the technique by gap: closed for coverage, open plus why for the unsaid, a scenario for autopilot steps, a prototype when they can't picture it. | Route by role, not person. Lead with a best guess and evidence. Two people disagree? Clarify with both. | Never make their business call. "Could not decide, ask Print Services" is the correct answer | L7, L9/L10, L11, L14 |
| 6. Lock in and cut over | How does an answer become permanent? | Every answer needs four properties: a need, stated, checkable, owned. Then a test that pins exact values and state, plus a decision record. | Turn decision records into CI checks. Cut over gradually with a canary, a kill switch, and a tested rollback. | Goodhart: a 99% target gets gamed. Chrysler's C3 rewrite never fully replaced its predecessor | L9, L16, L5, L2 |
