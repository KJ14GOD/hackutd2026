# Spec: Part 1 (static map), Runtime (witness), Part 2 (reader)

Status: **PROPOSED**. Needs team sign-off before implementation (repo rule). Last updated 2026-11-08.
Language: TypeScript. Tunable values live in `theseus.config.json`. Output formats extend `docs/GRAPH_SCHEMA.md`.

## 0. Overview

| Layer | Question it answers | Uses an LLM? | Runs customer code? | Output |
|---|---|---|---|---|
| Part 1 | What does each program touch? | No | No | `pass1.json` |
| Runtime | What did it actually touch when run? | No | Yes (sandboxed) | `runtime.json` |
| Part 2 | What does it mean? | Yes | No | `part2.json` |

```
repo ─► Part 1 ─► pass1.json ─► Runtime ─► runtime.json
                      └──────────► Part 2 ◄───────┘
                                     └─► questions ─► Slack ─► decisions ─► tests
```

Each layer reads only the previous layers' files and adds to them. Each can be built and tested alone.

**Non-goals for Part 1 and Runtime:** values (which queue, which user, which SQL text), clustering into pockets, judging coupling. Those belong to Part 2.

---

## 1. Part 1: static map

### 1.1 Input
A directory containing the codebase (a clone). Optional extra files the customer uploads: online config (CSD), scheduler export, database definitions, IMS definitions (PSB/DBD), queue definitions.

### 1.2 Steps
1. **Inventory.** Walk every file. Classify by **content first, extension second**:
   - program: has an identification division
   - copybook: layout fragment, no program header
   - job script: lines starting with `//`
   - online config: `DEFINE` statements
   - scheduler / DB / IMS / queue definitions: by their own markers
   - Detect EBCDIC and convert. Anything unclassified is listed in `inventory.unknown[]`.
2. **Normalize source.** Fixed-format: drop comment lines, keep the code area, uppercase. Keep a map back to original line numbers.
3. **Build lookups** (before scanning programs):
   - `fileAlias`: online file nickname → real dataset (from the online config)
   - `stepFiles`: (program, file label) → dataset + mode (from the job scripts, with procedures expanded and symbolic parameters substituted)
   - `tranProgram`: transaction id → program
   - `jobTriggers`: job → job (from the scheduler export, if given)
4. **Scan each program** with one scanner per system (§1.3). Every scanner has the same signature:
   ```ts
   type Scanner = (prog: NormalizedProgram, lookups: Lookups) => { edges: Edge[]; unresolved: Unresolved[]; touches: SystemTag[] };
   ```
5. **Resolve names held in variables.** Use literal values the program assigns (initial values, literal moves), searching the program and its copybooks. If exactly one dataset or program is found, the edge gets `confidence: "inferred"`. If none or several are found, record it as unresolved.
6. **Roll up `touches`.** One entry per (program, system), with the first evidence line.
7. **Write `pass1.json`.** Output must be deterministic: sorted keys and sorted arrays. Two runs on the same input must be byte-identical.

### 1.3 Systems and scanners

| `system` | Detects | Edge it emits |
|---|---|---|
| `programs` | static/dynamic calls, online hand-offs (transfer, link, next transaction, async start), alternate entry points, nested programs | program → program / transaction |
| `layouts` | copybook includes (with library and replacing) | program → copybook |
| `files` | batch open/read/write, sort/merge files, online file commands (incl. remote) | program → dataset |
| `db` | embedded SQL (tables, read vs. write), stored procedures, dynamic SQL (flag only) | program → table / procedure |
| `ims` | IMS calls; segments via PSB/DBD if supplied | program → IMS database |
| `mq` | queue open/put/get | program → `mq:?` (name is a value, Part 2) |
| `cics-queue` | temporary-storage and transient-data queues | program → queue; transient queue → transaction or dataset via its definition |
| `screen` | send/receive screen maps; fields from map definitions | program ↔ screen |
| `network` | HTTP, web service invoke, sockets | program → external |
| `identity` | current-user lookups, security checks, sign-on | program → identity |
| `time` | date/time accepts, current-date functions, online time commands, auto-filled online date/time fields, date runtime calls | program → time |
| `batch` | run by a job step, run parameters, job input/output streams, return codes, step conditions, generation datasets, utility control cards, file-transfer steps | job ↔ program ↔ dataset |
| `scheduler` | job triggers from the scheduler export; time-triggered online starts | job → job |
| `external` | call targets with no source (Assembler, C, vendor) | program → `external:NAME` |

### 1.4 Output: `pass1.json`
Extends `GRAPH_SCHEMA.md` (nodes, edges, unresolved). New fields:

```ts
type Edge = { from: string; to: string; rel: string; evidence: string /* file:line */;
              via?: string; confidence: "extracted" | "inferred" | "unknown" };
type Unresolved = { program: string; system: System; what: string; token: string; at: string; candidates?: string[] };
type Touch = { program: string; system: System; evidence: string };
type Pass1 = { version: 1; inventory: { programs: string[]; copybooks: string[]; jobs: string[]; unknown: string[] };
               missingInputs: string[];  // e.g. "scheduler export", "online config"
               nodes: Node[]; edges: Edge[]; unresolved: Unresolved[]; touches: Touch[] };
```

### 1.5 Acceptance
- **Planted fixture:** one or more planted cases per row of §1.3, with the answer key written before the scanner. Each scanner scores **100% precision and 100% recall** on its planted cases.
- **CardDemo regression:** 44 programs classified; the accounts dataset has ≥4 writers and ≥6 readers, with online and batch programs on the same node; every edge has evidence.
- **Count two ways:** the per-program touch totals must equal the edge totals by system.
- **Determinism:** two runs give byte-identical output.

---

## 2. Runtime: witness

### 2.1 Input
`pass1.json`, the clone, and sample data (from the repo or uploaded).

### 2.2 Environment
- A container with GnuCOBOL. **No network.** CPU, memory, and wall-clock limits. A fresh container per run; one tenant per container.
- Datasets are loaded from sample data using the copybook layouts. Indexed files stand in for VSAM.
- File labels are mapped to local files through environment variables, using `stepFiles`.

### 2.3 Recording stubs
Every outside system a program can reach is replaced with a stub that **answers the call and appends one JSON line**:

```json
{"run":"r-0007","scenario":"month-end","program":"CBTRN02C","system":"time","target":"?","seq":42}
```

- `target` is a node id when it's known without reading values (for example, the dataset of a file open). Otherwise it's `"?"`.
- The stub records **which system was touched, not the values passed**.
- Batch file access is logged by a thin wrapper around the file layer.
- First stub set: the helper routines in spike Q15 (`CEE3ABD`, `MVSWAIT`, `COBDATFT`), plus time and files. Online, DB, MQ, and IMS stubs come later.

### 2.4 Scenarios
Each program runs under several named scenarios defined in `theseus.config.json`: normal day, bad records, empty input, month-end, year-end. The GnuCOBOL trace records which paragraphs ran.

### 2.5 Merge
Join the logs with `pass1.json`:

| Static | Runtime | Mark |
|---|---|---|
| yes | yes | `confirmed` |
| no | yes | `added` (Part 1 missed it; becomes a new planted case) |
| yes | no | `never-fired` |

### 2.6 Output: `runtime.json`

```ts
type Runtime = { version: 1; runs: { id: string; scenario: string; program: string; exitCode: number; timedOut: boolean }[];
                 marks: { edge: EdgeKey; mark: "confirmed" | "added" | "never-fired"; runs: string[] }[];
                 touches: { program: string; system: System; how: "static" | "observed" | "both" }[];
                 coverage: { program: string; paragraphsTotal: number; paragraphsRun: string[] }[] };
```

### 2.7 Acceptance
- Planted programs with known behavior, including one that reaches the clock through a variable call. Runtime must mark that edge `added`.
- A run that exceeds its limits is killed and recorded as `timedOut`. It never hangs the pipeline.
- No network access is possible from the sandbox, and a test proves it.

---

## 3. Part 2: reader (LLM)

### 3.1 Input
`pass1.json`, `runtime.json`, and the clone. Also the decision log, so already-answered questions aren't asked again.

### 3.2 Context pack (built by code, one per program)

| Section | Content |
|---|---|
| `program` | Full normalized source with original line numbers |
| `layouts` | Every copybook it includes, after replacing |
| `connections` | Its edges from Part 1, each with evidence and runtime mark |
| `neighbors` | For each dataset/queue/table it touches: the other programs touching it, with read/write |
| `coverage` | Paragraphs that never ran |
| `open` | Its unresolved items |
| `decisions` | Prior human decisions about this program |
| `task` | Fixed instructions (§3.3) |

If a pack exceeds `part2.maxPackTokens`, split it by paragraph range. `connections` and `layouts` are repeated in every chunk.

### 3.3 What the model must do (one call per pack)
1. **Explain every connection** in `connections`: what it's for, in one line.
2. **Report missed connections** it sees in the code that aren't in the list.
3. **Find rules:** business logic, including logic driven by data (a file or table acting as configuration).
4. **Find suspected defects:** silent truncation, unchecked errors, uninitialized fields, unreachable code, date windowing. **Never fix; only report.**
5. **Derive edge values** for each input field from its layout: max, min, zero, negative, blank, one past the limit, special dates.
6. **Explain coverage gaps:** what condition reaches each paragraph that never ran.
7. **Ask questions** for anything it can't decide from the pack.
8. Optionally, ask for more context (`needMore`). Code fetches it and re-calls, up to `part2.maxNeedMoreRounds`.

### 3.4 Output contract (validated with zod)
Every finding **must cite** at least one `file:line` that's inside the pack. A finding without a valid citation is dropped and counted.

```ts
type Finding = { kind: "connection" | "missed-connection" | "rule" | "defect" | "edge-value" | "coverage-gap" | "mismatch";
                 summary: string; evidence: string[]; confidence: "high" | "medium" | "low" };
type Question = { id: string; program: string; text: string; evidence: string[];
                  options: string[];           // e.g. ["Keep old behavior", "Fix it"]
                  blocks: "rewrite" | "cutover" | "none" };
type PackResult = { program: string; findings: Finding[]; questions: Question[];
                    needMore?: { kind: "file" | "program" | "data"; id: string }[] };
```

### 3.5 Cross-program pass (code, then one LLM call per shared resource)
For each dataset, table, or queue touched by more than one program, compare the programs' layouts and findings. Report:
- **mismatches:** the same field used differently by different programs
- **conflicting rules**
- **outputs nobody reads** and **inputs nobody writes**, which become questions about outside parties

### 3.6 Questions → humans → tests
- Questions are deduplicated against the decision log, then sent to the Slack bot (Backend B).
- Each answer is stored as a decision with who, when, and evidence.
- Each decision generates a test:
  - **Preserve:** the test checks that the new code matches the old behavior.
  - **Fix:** the test checks the new behavior, and the shadow difference is marked approved.

### 3.7 LLM settings
- Calls go through `packages/llm`: NVIDIA client, mock, and record/replay cache keyed by prompt hash.
- Temperature 0. Model id, token limits, and retry counts live in `theseus.config.json`.
- No agent framework. Optional `needMore` round trips only.

### 3.8 Output: `part2.json`

```ts
type Part2 = { version: 1; results: PackResult[]; crossProgram: Finding[];
               notVerified: { kind: "unresolved" | "never-fired" | "never-ran" | "unanswered"; ref: string }[];
               dropped: { program: string; reason: "no-citation" | "bad-citation" | "schema" }[] };
```

### 3.9 Acceptance
- **Planted programs** with known rules, known defects, a known mismatch between two programs, and a known rare path. Score recall per kind, against a key written first.
- **Every connection** in each pack gets an explanation. Explanation coverage per pack = 100%.
- **Zero uncited findings** reach `part2.json`.
- **Replay:** with the cache on, a rerun makes zero network calls and produces identical output.

---

## 4. Shared conventions
- **Node ids:** `<prefix>:<name>`, as in `GRAPH_SCHEMA.md`. New prefixes only add to the scheme; existing ones never change.
- **Evidence** is always `path:line`, relative to the repo root.
- **Every output** carries `version` and the input commit SHA.
- **Not-verified list:** each layer adds to it, and it's never silently emptied.

## 5. Build order
1. Part 1: port the existing scanners (programs, layouts, files, db, batch), then add time, identity, and external. Planted cases first for each.
2. Runtime: batch programs only, with time and file stubs, plus the merge.
3. Part 2: pack builder, then a single-call reader with the planted key, then the cross-program pass, then questions to Slack.
4. Later: online/DB/MQ/IMS stubs, the remaining scanners, the scheduler, and `needMore`.

## 6. Open questions for the team
- Sign-off on Q18–Q20 and on this split (Part 2 owns clustering).
- Who owns Part 2's reader: Backend A (`packages/llm`) or Backend B (`services/agent/src/resolve/`)?
- Which sample data to use for scenarios beyond CardDemo's ASCII files.
