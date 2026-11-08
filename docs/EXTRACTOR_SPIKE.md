# Extractor spike: mapping CardDemo and everything around it

> **FINDINGS, not a design.** A throwaway prototype was run against CardDemo and three
> other real repos to test the assumptions in [SEGMENTATION.md](SEGMENTATION.md) before
> anyone builds `services/segmenter/`. Nothing here is implemented in this repo. The
> findings that would change SEGMENTATION.md are listed in [section 2](#2-findings-that-affect-segmentationmd)
> and logged as Q18–Q20 in [DECISIONS.md](DECISIONS.md) for sign-off.

Contents:
1. [The story, for developers](#1-the-story-for-developers)
2. [Findings that affect SEGMENTATION.md](#2-findings-that-affect-segmentationmd)
3. [Beyond the code: the other categories](#3-beyond-the-code-the-other-categories)
4. [How accuracy was tested](#4-how-accuracy-was-tested)
5. [Other languages](#5-other-languages)
6. [Limits](#6-limits)

---

## 1. The story, for developers

### The file nobody touches

You inherit a credit-card system on a mainframe. Its biggest program, `COACTUPC.cbl`, is
4,236 lines. The people who wrote it are gone. Here is the nightly interest calculation
in `CBACT04C.cbl`:

```cobol
1300-COMPUTE-INTEREST.
    COMPUTE WS-MONTHLY-INT
     = ( TRAN-CAT-BAL * DIS-INT-RATE) / 1200
    ADD WS-MONTHLY-INT  TO WS-TOTAL-INT
```

No `ROUNDED`, so cents are truncated (already logged as D-017). A Java rewrite would
probably round. Is truncation a rule or an accident? Nothing in the code says. That gap,
knowledge that lives only in people, is the problem Theseus exists to solve.

### Why the obvious fixes fail

- **Rewrite everything at once:** the FBI's Virtual Case File wrote off about $170M that way.
  The incremental restart (Sentinel) shipped.
- **Let an AI translate it:** LLMs are strong on form, weak on content. They score 31% at
  identifying actors and under 0.18 at recovering dependencies (sources in `research/`).
- **Use an off-the-shelf code-graph tool:** Graphify (v0.8.39) pointed at CardDemo reports
  `code: 0, documents: 13`. It doesn't recognize `.cbl`, `.cpy` or `.jcl`.

So the map has to be built from facts in the code, and every remaining gap becomes a
question for a person.

### Reading COBOL

COBOL states its dependencies, but often through variables. Most CICS programs do this:

```cobol
EXEC CICS READ
     DATASET (LIT-ACCTFILENAME)        *> a variable, not a file name
...
05 LIT-ACCTFILENAME  PIC X(8)  VALUE 'ACCTDAT '.
```

The prototype resolves the variable through its `VALUE` clause (and `MOVE 'literal' TO var`),
then follows the CICS system definitions (`app/csd/CARDDEMO.CSD`) to the real dataset:

```
LIT-ACCTFILENAME → 'ACCTDAT' → DEFINE FILE(ACCTDAT) DSNAME(AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS)
```

Batch programs reach the same data another way: `SELECT ACCOUNT-FILE ASSIGN TO ACCTFILE`,
then the JCL step that runs the program maps DD `ACCTFILE` to `DSN=AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS`.
Following both paths puts online and batch programs on the **same dataset node**, which
showed the biggest hub in the system:

| Dataset | Written by | Also read by |
| --- | --- | --- |
| `ACCTDATA.VSAM.KSDS` | `CBACT04C` (interest), `CBTRN02C` (posting), `COACTUPC` (update), `COBIL00C` (bill pay) | 6 more programs |
| `CARDXREF.VSAM.KSDS` | none | 11 programs |
| `TRANSACT.VSAM.KSDS` | `CBTRN02C`, `COBIL00C`, `COTRN02C` | 3 more |

Every edge carries a receipt:

```json
{"from": "prog:COACTUPC", "to": "data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS",
 "rel": "write", "via": "CICS REWRITE ACCTDAT",
 "evidence": "app/cbl/COACTUPC.cbl:<line>", "confidence": "extracted"}
```

Run on all 44 programs (31 core plus the DB2, IMS and MQ modules):

| Result | Count |
| --- | --- |
| Edges taken directly from a code line | 1,001 |
| Edges inferred (labeled `inferred`) | 71 |
| References that couldn't be resolved, so each became a question | 48 |
| Louvain components | 6 (largest: 17 account and transaction programs, isolation 0.59) |

### Tools compared

| | Prototype | [cobol-rekt](https://github.com/avishek-sen-gupta/cobol-rekt) | [ProLeap](https://github.com/uwol/proleap-cobol-parser) |
| --- | --- | --- | --- |
| Programs parsed | 44/44 | 31/31 (after stubbing IBM's `DFHAID` / `DFHBMSCA`) | 26/31: fails on quoted `COPY 'NAME'` |
| CICS `XCTL` / `LINK` | yes | no (its dependency task follows `CALL` and IDMS only) | no (CICS blocks are opaque text) |
| Files and tables | yes | no | partial (`SELECT`/`OPEN`, no dataset link) |
| JCL jobs | yes | no | no |
| Inside one program | no | best: flowcharts, field types (`PIC S9(09)V99`), CFG | parser library |

**Takeaway:** the system-wide graph needs our own extractor. cobol-rekt is the right tool
for looking *inside* a pocket (field types, control flow) when the rewrite starts.

---

## 2. Findings that affect SEGMENTATION.md

Each item below says what CardDemo actually does, why the current pattern table misses
it, and what the prototype did instead.

| # | Finding | Evidence | Effect if ignored | What the prototype did |
| --- | --- | --- | --- | --- |
| F1 | CICS file names are almost always **variables** | `DATASET (LIT-ACCTFILENAME)` in `COACTVWC` and others; all 51 `FILE/DATASET(...)` operands in `app/cbl` are variables, none are literals | `file` edges point at variable names, so no two programs share a "file" | Resolve via `VALUE` clauses (program plus its copybooks) and `MOVE 'lit' TO var` |
| F2 | Online and batch use **different names for the same dataset** | CICS `ACCTDAT` vs DD `ACCTFILE`, both `AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS` | The heaviest coupling in the system (the account hub above) is invisible | Map CICS names through `CARDDEMO.CSD` (`DEFINE FILE … DSNAME`) and DD names through the JCL step running the program; key file edges by dataset |
| F3 | **Quoted copybook names** | `COPY 'CSSTRPFY'` in `COACTVWC`, `COCRDLIC`, `COCRDSLC`, `COCRDUPC`, `COACTUPC` | `COPY NAME.` misses copybooks in 5 programs, including the largest; it's also exactly what broke ProLeap | Accept `COPY 'NAME'` and `COPY NAME` |
| F4 | Many **`XCTL` targets are variables** set at runtime | `PROGRAM (CDEMO-TO-PROGRAM)`, `CDEMO-ADMIN-OPT-PGMNAME(WS-OPTION)` (12 sites) | Menus show no outgoing edges | Resolve literals where possible; otherwise add `inferred` edges to program names appearing as literals in the program or its copybooks, and raise a question |
| F5 | **Middleware and runtime calls look like program calls** | `CALL 'MQPUT'`, `'CBLTDLI'`, `'CEE3ABD'` | MQ and IMS appear as programs and distort clusters | Classify `MQ*`, `CBLTDLI`, `AIBTDLI`, `CEE*` as system APIs; record them as questions (queue names are set at runtime) |
| F6 | **Targets with no COBOL source** | `COBDATFT`, `MVSWAIT` (assembler); `COCRDSEC` referenced but absent from the repo | Silent missing nodes | Emit them as typed `missing/non-COBOL` nodes and raise a question for each |
| F7 | **Omnipresent copybooks** confirmed | `COCOM01Y`, `COTTL01Y`, `CSDAT01Y`, `CSMSG01Y`, `DFHAID`, `DFHBMSCA` are each in 21 programs | Supports D-009 | Excluded copybooks used by more than 40% of programs from clustering and reported them separately (a placeholder threshold) |
| F8 | **Batch DDs with no JCL step** | 16 DD names in programs that no JCL runs (e.g. `CBTRN01C`) | Batch file edges vanish | If the DD name maps to exactly one dataset elsewhere, add an `inferred` edge; otherwise raise a question |

Edge weights used in the prototype (call 3, shared written data 2, shared read data 1,
copybook 0.5) were placeholders, not a proposal; SEGMENTATION.md's weights stand.

---

## 3. Beyond the code: the other categories

Code connects to much more than code. The research lists 15 categories; CardDemo
exercises 9 (data stores, MQ, CICS transactions and screens, JCL scheduling, system
definitions, binaries with no source, copybook record formats, printed statements,
EBCDIC data). A second prototype covered the other six, against repos that have them:

| Category | What it reads | Example from a real repo |
| --- | --- | --- |
| Infrastructure | Terraform blocks and references, k8s/Helm YAML, Docker, compose | Online Boutique: all 17 service-to-service links came from k8s env vars such as `PAYMENT_SERVICE_ADDR: "paymentservice:50051"`, not from code |
| Identity and secrets | `secretKeyRef`, service accounts, IAM policies, credential env vars, secret-store clients | `cartservice → AccessSecretVersion` |
| ETL | Airflow DAGs via Python's `ast`; dbt `ref()`, `source()`, macros; SFTP | jaffle-shop: `orders ← stg_orders, order_items` |
| Third parties | SDKs in package manifests, external hosts | services → Google Cloud, OpenTelemetry |
| Time and environment | cron schedules, time zones, business calendars, encodings, devices | Airflow `AfterWorkdayTimetable()`; `plugins/workday.py` holiday calendar |
| People and process | manual steps in docs, scripts nothing automated runs, CODEOWNERS, TODOs | Online Boutique README: SSH into a VM and paste setup scripts by hand |

Not needed for the CardDemo demo. Relevant to the pitch ("code-only graphs miss the real
system") and to any customer codebase after the hackathon.

---

## 4. How accuracy was tested

**Planted fixture.** A fake billing repo with 46 known dependencies across the six
categories, plus 6 decoys that must *not* be reported (commented-out URL, test-only API,
`example.com`, a script the Makefile already runs, commented-out Terraform, a non-manual
doc line). The answer key was written **before** the first run.

| Run | Recall | Precision | Decoys hit |
| --- | --- | --- | --- |
| First | 100% | 88% | 0 |
| After fixing 2 bugs (Python `from x import` read as SQL `FROM`; duplicate findings) | 100% | 100% | 0 |

This is in-sample (the same person wrote fixture and extractor), so it proves the logic,
not real-world accuracy.

**Real repos, checked by hand:**

| Repo | Result |
| --- | --- |
| Google Online Boutique | service map, Terraform, SDKs, secrets correct; external hosts 3 of 5; manual steps about 40% genuine (prose is noisy) |
| dbt jaffle-shop | 6/6 sources, 11/11 refs, 3 macro calls, the calendar model |
| Airflow example DAGs (50 files) | about 96% of tasks; every hand-checked edge correct after replacing regex with `ast` |

**The regex lesson.** The first Airflow version used regex and missed fan-out
(`t1 >> [t2, t3]`), dropped middle links (`a >> b >> c`), treated `Label(...)` as a task,
ignored `chain()` and TaskFlow `@task`, and missed non-string schedules. Moving to a real
syntax tree fixed all six. On `example_complex.py` the extractor then disagreed with the
hand count, and the hand count was wrong (it missed a third `chain()` call). Lesson for
the segmenter tests: always count two independent ways.

**Applies to SEGMENTATION.md's tests:** add a planted-fixture test with an answer key
written first, and include decoys, so precision is measured and not only recall.

---

## 5. Other languages

One contract per language, matching SEGMENTATION.md's `extract(path, source)` interface.
Each adapter answers six questions: what code does this use, what runs next, what data
does it touch, what does it call over the network, what config does it read, and what's
decided at runtime.

| Tier | Languages | Approach |
| --- | --- | --- |
| A | Java, C#, Python, TypeScript, Go | Compiler-grade indexers for name resolution; add the data, network and config layer by library signatures (JDBC, JPA, SQLAlchemy, EF, HTTP clients) |
| B | Languages with only a syntax parser | Syntax tree plus our own scope tracking (the Airflow approach) |
| C | COBOL, PL/I, RPG, Natural, VB6, stored procedures | Custom extractors; mainframe languages share JCL, CICS and DB2, so the COBOL layer carries over |

A language counts as covered only with a scored fixture plus one hand-checked real repo.

---

## 6. Limits

- Runtime-only behavior (menu tables, tasks generated in loops, reflection) needs the
  traffic replay, not static analysis.
- Prose sources (docs, comments) are noisy. Their findings should become questions, never
  graph edges.
- Real-repo accuracy is partly hand-judged; only the planted fixture has a true answer key.
- Tool capability claims for other languages (SCIP, sqlglot, CodeQL, tree-sitter coverage)
  come from memory and are unverified.
- The prototype is Python, not committed here (TypeScript-only rule, and SEGMENTATION.md is
  PROPOSED). See Q20.
