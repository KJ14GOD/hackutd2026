# Decisions

Lightweight log. Status: **Accepted** (in use / agreed), **Proposed** (needs team
sign-off before code), **Superseded**. When something is ambiguous, pick the most
reversible option, log it here, and keep going.

| ID | Decision | Why | Status |
| --- | --- | --- | --- |
| D-001 | Layout as in the brief, plus `scripts/` (tooling) and generated bindings in `packages/shared/src/module_bindings` (no extra package). | One place every service imports from. | Accepted |
| D-002 | pnpm `node-linker=hoisted` (`.npmrc`). | The Dockerized SpacetimeDB CLI builds from a bind mount and can't follow pnpm's Windows junctions. | Accepted |
| D-003 | Pin SpacetimeDB **2.14.1** (CLI, Docker image, npm package). `scripts/stdb.mjs` uses the native CLI when present, otherwise Docker. In Docker mode the CLI identity lives in `.cache/stdb-cli` (gitignored). | Bindings embed the CLI version. The DB belongs to the identity that created it, and a Docker named volume isn't writable by the image user (the CLI hangs). | Accepted |
| D-004 | One config file `theseus.config.json`, validated by zod in `packages/shared`, pushed to the `config` table by `pnpm config:push` so reducers can read it. | The module can't read files; one source for every tunable. | Accepted |
| D-005 | Ids `u32`, sim times `f64` ms. | The UI gets plain numbers, not `bigint`. | Proposed |
| D-006 | `event` is a normal, persistent, append-only table, not a SpacetimeDB 2.x `event: true` table. | Event tables drop rows after commit; a late-joining UI or the tail CLI would miss history. | Proposed |
| D-007 | **Ranking uses traffic and isolation.** Eligible: traffic share ≥ `traffic.thresholdShare` **and** isolation ≥ `ranking.minIsolation`. Order: `trafficWeight × share + isolationWeight × isolation`. Isolation = `cohesion / (cohesion + coupling)`. | Team decision (was Q1). Traffic says what matters; isolation says what is safe to cut out first (research: tangled code holds most defects). Weights in config. | Accepted |
| D-008 | LLM: OpenAI-compatible client, base `https://integrate.api.nvidia.com/v1`, key `NVIDIA_API_KEY`. `fast` = `nvidia/nemotron-3-nano-30b-a3b`, `strong` = `nvidia/nemotron-3-super-120b-a12b` (both in the NVIDIA API docs index, checked 2026-11-07). Fallbacks: `nvidia/nvidia-nemotron-nano-9b-v2`, `nvidia/llama-3.3-nemotron-super-49b-v1.5`. Also worth trying: `nvidia/nemotron-3.5-lightning-30b-a3b` (Nano class). Reasoning toggle: `chat_template_kwargs: {enable_thinking}` (Nemotron 3) or `/think` / `/no_think` (older). Docs recommend temperature 1.0 / top_p 0.95 (Super), 0.6 / 0.95 for tool calls (Nano). | Model names come from env, so swapping is free. | Proposed |
| D-009 | Segmentation adds hub dampening (`w/(n−1)` per shared resource) and Bunch-style omnipresent-node exclusion into a `shared` pocket. | Otherwise one shared module or copybook merges every pocket into one. | Proposed |
| D-010 | Shadow isolation by per-request snapshot: legacy A snapshots its data before a mirrored request; legacy B and the target load that snapshot. Only A's writes persist. | Without it the sandboxes drift and real diffs get learned as "noise". | Proposed |
| D-011 | The SpacetimeDB module stays a placeholder (`config` table + `setConfig`) until the data model is signed off. | Team asked not to commit undecided implementation. | Accepted |
| D-012 | Traffic rates, account ids, and the scenario in `theseus.config.json` are placeholders. | Endpoints get fixed once the CardDemo runtime plan (Q15, Q16) is settled. | Accepted |
| D-013 | **Target runtime: Java (plain JDK) behind `TargetRuntime`** (recommendation below). | See "D-013 tradeoffs". | Proposed (recommended) |
| D-014 | **Legacy codebase: AWS CardDemo** (Apache-2.0), fetched at pinned commit `59cc6c2` into `legacy/carddemo/` (gitignored) by `pnpm legacy:fetch`, not vendored. Our own `legacy/fixture/` covers what CardDemo lacks (see D-018). | Team decision (was Q2). Real code impresses the 8090 judges; pinning keeps segmentation deterministic; not vendoring keeps third-party code out of our history. | Accepted |
| D-015 | **Oracle: old behavior is the default truth; the knowledge base overrides it.** Details in [AGENT_LOOP.md](AGENT_LOOP.md#the-oracle) and [HUMAN_LOOP.md](HUMAN_LOOP.md). | Team decision (was Q4). Asks far fewer questions than "ask on every mismatch". It still covers the research's warning that the legacy system isn't automatically right: suspected legacy bugs and money fields still go to a person. | Accepted |
| D-016 | `AGENTS.md` (read by Codex and most other agents) is an identical copy of `CLAUDE.md`. A vitest check fails if they differ. | Teammates use different agents; one set of instructions, no drift. | Accepted |
| D-017 | CardDemo already contains two planted cases: `CBACT04C` computes interest with no `ROUNDED` (truncation) and stamps `FUNCTION CURRENT-DATE` (nondeterministic field). Its `1400-COMPUTE-FEES` paragraph is an empty "To be implemented" stub. | Found by reading the pinned source. Use them in the demo instead of planting copies. | Accepted |
| D-018 | The fixture app covers only what CardDemo can't give us: transactions runnable over HTTP without CICS, a legacy bug that overpays, a real business rule that looks like dead code, a transaction that is never called. It reuses CardDemo's record layouts (copybooks) where it can. | Keeps the fixture small and on-theme. | Proposed |

### D-013 tradeoffs: Java vs TypeScript inside SpacetimeDB

| | Java (separate process) | TypeScript reducers in SpacetimeDB |
| --- | --- | --- |
| Decimal math | `BigDecimal` with explicit scale and `RoundingMode` maps 1:1 to COBOL `PIC 9V99` / `ROUNDED` | No decimal type; floats cause their own rounding mismatches unless every rewrite uses a decimal library |
| Judges / story | COBOL → Java is the standard modernization path (what the 8090 track expects) | Unusual target; harder to explain as "modernization" |
| LLM output quality | Nemotron writes idiomatic Java; easy to compile and test with `javac` | Must also follow SpacetimeDB's module API and constraints |
| Blast radius | A bad rewrite crashes its own process; the source-of-truth DB is untouched | Generated code runs inside the database that holds all state |
| Deploy loop | Compile + restart one runner per pocket, independent of the DB | Every rewrite means republishing a module (or a separate DB per pocket), with schema/client-break prompts mid-demo |
| Shadowing | Same HTTP fan-out as legacy; sandbox = data copy | Reducers can't make HTTP calls; mirroring needs procedures or an extra router hop |
| SpacetimeDB track | Already satisfied: all state, triggers, routing and decisions live in SpacetimeDB | Adds more SpacetimeDB usage |
| Toolchain | Needs a JDK (installed: JDK 21) | Nothing extra |

**Recommendation: Java.** The two arguments that decide it are decimal fidelity, since
money rounding is the heart of the demo, and keeping LLM-generated code out of the
source-of-truth database. The `TargetRuntime` adapter keeps a TypeScript target possible
as a stretch goal. Confirm and this becomes Accepted.

## Open questions

| # | Question | Interim choice |
| --- | --- | --- |
| Q3 | Java or TS-in-SpacetimeDB target? | Java recommended (D-013), awaiting team OK. |
| Q5 | Is `fast` classifying vs `strong` rewriting enough separation of judge and generator? | Yes for now; the rewriter never classifies its own mismatches. |
| Q6 | Sign-off flow for "Doesn't matter" ignore rules | Store a waived-mismatch count; sign-off flow decided in M2. |
| Q7 | Compare effects (data written), not only responses? | Responses first; diff post-request sandbox data in M2. CardDemo batch programs are mostly effects (they write files), so this matters more now. |
| Q8 | Slack and Teams? | Slack only. |
| Q10 | Does the hosted NVIDIA endpoint honor `chat_template_kwargs`? | Verify with one live call; fall back to `/no_think`. |
| Q11 | Two sign-offs for money pockets? | Not planned; stricter `cutover.criticalMinMatchRate` instead. |
| Q12 | Synthetic rare scenarios on top of traffic? | `traffic.scenario` supports bursts; more later. |
| Q13 | Requirements playbook (why-ladder, write-back confirmation)? | Decision card first; thread follow-ups are a stretch goal. |
| Q14 | Where does the git-author → Slack mapping live? | `config/owners.json`, pushed like the main config. CardDemo's 32 commits are by AWS authors, so for the demo we map CardDemo paths to teammates. |
| Q15 | Can CardDemo's 14 batch programs (no `EXEC CICS`) compile and run under GnuCOBOL? Open issues: VSAM KSDS files become GnuCOBOL INDEXED files (needs a BDB/VBISAM build); unquoted `ASSIGN TO` names map through `DD_*` env vars; called assembler/LE routines (`CEE3ABD`, `MVSWAIT`, `COBDATFT`) need stubs; ASCII sample data exists in `app/data/ASCII`. | Spike in M1 (Backend B). If it fails, the fixture reimplements the interest batch logic using CardDemo's copybooks. |
| Q16 | CardDemo's 17 online programs need CICS, which won't run locally. What counts as their "endpoints"? | Segment them anyway (graph edges from `EXEC CICS XCTL/LINK` and file reads). Expose runnable work as HTTP endpoints: batch jobs as `POST /batch/<job>`, plus fixture transactions. Treat CICS transaction ids (CAVW, CB00, …) as graph-only nodes in M1. |
| Q17 | What feeds the knowledge base besides Slack answers? | Slack answers + expert notes imported from a repo folder (`knowledge/`), each tagged with its author. Format decided in M2. |
| Q18 | Adopt extractor-spike findings F1–F4 into SEGMENTATION.md: resolve CICS file and `XCTL` variables through `VALUE`/`MOVE`, key file edges by dataset (CICS names via `CARDDEMO.CSD`, DD names via JCL), and accept quoted `COPY 'NAME'`? See [EXTRACTOR_SPIKE.md](EXTRACTOR_SPIKE.md#2-findings-that-affect-segmentationmd). | Without F1/F2 no online and batch program ever shares a file, so the account-data hub (4 writers, 6 readers) disappears from the graph. Needs team sign-off (SEGMENTATION.md is PROPOSED). |
| Q19 | Classify `MQ*` / `CBLTDLI` / `CEE*` calls as system APIs, and emit missing or non-COBOL targets (`COBDATFT`, `MVSWAIT`, `COCRDSEC`) as typed nodes that raise questions (spike F5, F6, F8)? | Proposed alongside Q18. |
| Q20 | The spike prototype is Python and isn't committed (TypeScript-only rule). Port it into `services/segmenter/` as the starting point, or treat it as reference only? | Reference only until Q18 is decided; the owner of `services/segmenter/` chooses. |

## Resolved

- Q1 → D-007 (traffic + isolation). Q2 → D-014 (CardDemo + fixture). Q4 → D-015 (old by
  default, knowledge base overrides). Q9 → covered by D-010 (still Proposed).
