# Harbor Card: answer key (written first; connectors and agents never read this file)

Harbor Card is the synthetic company that "owns" AWS CardDemo for the demo. Its knowledge is scattered on
purpose across an HR export, GitHub history, Jira, Notion and Slack. Each row below targets a real question
Part 2 (Nemotron) asked in `out/part2.json`, and says where the truth is and what the pipeline should do.

| Part 2 question | Truth lives in | Expected outcome |
|---|---|---|
| CBACT04C-Q1: empty 1400-COMPUTE-FEES, intentional? | Notion "Fees policy" (Ana, 2021): fees are assessed by the Billing platform, not INTCALC. Jira CARD-41 (Priya, 2023, open): "implement fee computation in INTCALC"; Dev parked it pending Finance. | **Answered by the policy, but an open ticket asks for the opposite:** confirm with Maria (decider for Card Services rules). Either "conflict" or "answered + open ticket" routed to Maria passes. |
| CBACT04C rounding (Aayush's CARD-88 story) | Notion "Interest policy" (Maria, 2019): truncate to the cent, per the card-network contract. Jira CARD-88 (Priya, 2024): "round interest normally". | **Conflict.** Policy owner vs ticket reporter; Maria wins on authority. Maria's secret: the network contract requires truncation. |
| CBACT04C-Q4: does the DEFAULT disclosure group always exist? | Notion "Disclosure group runbook" (Leo): DEFAULT must exist; the DISCGRP load job verifies it; abend if missing is intended. | **Answered by docs.** Cite the runbook. |
| CBACT04C-Q3: DISPLAY of the balance record, production or debug? | Slack #card-batch, Dev (2022): left in while chasing INC-2207, safe to remove. GitHub commit by Dev says the same. | **Answered, low authority** (chat + commit). Confirm with Dev. Ana's secret: balances in SYSOUT are a PCI finding; she wants it gone. |
| CBACT04C-Q2: TRANID suffix wraps at 999,999? | Nowhere. CODEOWNERS and history point to Dana, who left in 2024. | **Ask a person:** Dana is inactive, so route to her successor Dev. |
| CBTRN02C-Q1: duplicate transaction IDs, reject or abend? | Jira CARD-102 (Leo, 2024 incident): duplicate DALYTRAN record crashed POSTTRAN; resolution: upstream dedupes, the abend is the wanted safety stop. Slack #mainframe-ops thread agrees. | **Answered by docs.** Matches what Runtime saw (Duplicate records scenario abends). |
| CBTRN02C-Q2: alphanumeric date compare for expiry intended? | Notion "Account data dictionary" (Grace): dates stored YYYY-MM-DD, so string compare orders correctly. | **Answered by docs.** |
| CBTRN02C-Q4: DALYREJS close uses XREFFILE-STATUS, typo? | Only a GitHub commit by Dana: "copy close blocks from XREF". Nothing says it's intended. | **Ask a person:** Dev (successor), engineer rendering. |
| CBTRN03C-Q4: double-counting the last transaction? | Jira CARD-77 (Priya, 2023, open, assigned Dev): report totals off by one transaction. | **Known bug, still open.** Cite the ticket; don't preserve it blindly. |
| COTRN02C-Q3: TRAN-ID is max + 1, safe under concurrency? | Slack #online-dev, Tom (2020): known race, accepted because volume is low. Jira CARD-130 (Priya, 2024, in progress): duplicate TRAN-ID seen in production; Tom: "we need a real sequence now". | **Known issue.** The 2024 ticket supersedes the 2020 acceptance; route to Tom to decide keep or fix in the rewrite. (Revised after the first Phase 4 run: an open ticket that supersedes old acceptance is a known issue, not a conflict.) |
| COBTUPDT-Q1: SQLCODE +100 on UPDATE/DELETE, warning or abend? | Nowhere. Grace (DBA) owns the TRANSACTION_TYPE table. | **Ask a person:** Grace. Grace's secret: the maintenance file is hand-edited by ops, so missing keys are common. |

## Ownership truths (Phase 3 must recover these from the sources, not from this file)

| Scope | Approver(s) | Signals that should find them |
|---|---|---|
| CBACT04C interest rules | Maria Lopez | HR: manager of Card Services; Notion: owner of "Interest policy" |
| CBACT04C code | Dev Okafor | CODEOWNERS; most recent commits; successor of Dana |
| Batch scheduling, DISCGRP, incidents | Leo Park | HR: Platform on-call lead; Notion runbook owner; Jira incident reporter |
| COTRN02C (online) | Tom Becker | CODEOWNERS; commits; Slack #online-dev |
| TRANSACTION_TYPE (DB2) | Grace Kim | HR: DBA; CODEOWNERS for app-transaction-type-db2 |
| Fees, PCI controls | Ana Ruiz | HR: Finance compliance; Notion "Fees policy" and "PCI controls" owner |

## Planted traps

- **Dana Whitfield left 2024-03-15.** She still dominates `git log` for batch programs. Her ownership must pass
  to Dev as a *suggested successor*, never stay with her.
- **"D. Okafor"** posts in Slack with no email. Phase 3 must send it to identity merge review, not auto-merge
  it into Dev Okafor on name alone.
- **Priya** reports many tickets (high activity) but owns no rules; she must not outrank Maria for business rules.
- **Noise:** tickets, pages and threads that mention program names in passing (a printer migration, a team
  offsite, a VPN outage) so lookups have to rank, not just match.
