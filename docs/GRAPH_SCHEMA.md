# Dependency graph format (`deps.json`)

Produced by `tools/cobol_deps.py <repo> <out_dir>` → `<out_dir>/deps.json`.
The prototype extractor lives outside this repo (see `docs/EXTRACTOR_SPIKE.md`). Real example for CardDemo: `out/mine/deps.json` (358 nodes, 1,074 edges).

## Top level

```json
{
  "counts":               { "program": 44, "dataset": 129, ... },   // nodes per kind
  "edge_counts":          { "copies": 350, "read": 291, ... },      // edges per rel
  "nodes":                [ Node ],
  "edges":                [ Edge ],
  "components":           [ Component ],   // candidate pockets
  "datasets":             [ [name, [writers], [readers]] ],          // hottest first
  "ubiquitous_copybooks": { "COCOM01Y": 21 },                        // used by >40% of programs, ignored for grouping
  "unresolved":           [ Unresolved ]   // become questions
}
```

## Node

```json
{ "id": "prog:CBTRN02C", "kind": "program", "file": "app/cbl/CBTRN02C.cbl", "mode": "batch", "lines": 731 }
```

| Field | Always? | Meaning |
|---|---|---|
| `id` | yes | `<prefix>:<name>`, unique |
| `kind` | almost (3 nodes lack it) | see table below |
| `file` | when there's source | repo-relative path |
| `mode` | programs only | `online` (uses CICS) or `batch` |
| `lines` | programs only | source line count |

| Prefix | `kind` | Example |
|---|---|---|
| `prog:` | `program` | `prog:COACTUPC` |
| `prog:` | `utility` (system program run by JCL, no source) | `prog:SORT`, `prog:IDCAMS` |
| `cpy:` | `copybook` | `cpy:CVACT01Y` |
| `job:` | `job` | `job:POSTTRAN` |
| `tran:` | `transaction` (CICS) | `tran:CAUP` |
| `data:` | `dataset` | `data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS`, `data:db2:CARDDEMO.AUTHFRDS`, `data:dd:CARDOUT` (unresolved DD) |
| `sys:` | `system-api` | `sys:MQPUT`, `sys:CBLTDLI`, `sys:CEEDAYS` |

## Edge

```json
{ "from": "prog:CBTRN02C", "to": "data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS",
  "rel": "write", "evidence": "app/cbl/CBTRN02C.cbl:311",
  "via": "I-O ACCOUNT-FILE -> DD ACCTFILE", "confidence": "extracted" }
```

| Field | Always? | Meaning |
|---|---|---|
| `from`, `to` | yes | node ids. Directed. Same pair can repeat (e.g. one per JCL line) |
| `rel` | yes | see table below |
| `evidence` | yes | `file:line` where it was found, or `"CSD"` |
| `via` | sometimes | how a file name got resolved |
| `confidence` | sometimes | missing or `extracted` = read straight from code; `inferred` = educated guess; `unknown` = placeholder target |

| `rel` | From → to | Meaning |
|---|---|---|
| `copies` | program → copybook | `COPY` |
| `calls` | program → program | `CALL` |
| `transfers` | program → program | CICS `XCTL` |
| `links` | program → program | CICS `LINK` |
| `starts` | transaction → program | CICS transaction entry point |
| `runs` | job → program/utility | JCL `EXEC PGM=` |
| `read` | program or job → dataset | reads |
| `write` | program or job → dataset | writes (also covers rewrite/delete/I-O) |
| `uses-api` | program → system-api | MQ / IMS / runtime library call |

## Component (candidate pocket)

```json
{ "id": 1, "programs": ["CBTRN02C", ...], "lines": 14115,
  "internal_weight": 326.5, "boundary_weight": 228.5, "isolation": 0.59,
  "boundary": ["CBACT01C<->CBSTM03B: data:AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS", ...] }
```
`isolation` = internal / (internal + boundary). Closer to 1 = easier to cut out.

## Unresolved

```json
{ "program": "CBSTM03B", "what": "batch DD with no JCL step", "token": "TRNXFILE",
  "at": "app/cbl/CBSTM03B.CBL:136", "inferred": ["AWS.M2.CARDDEMO.TRXFL.VSAM.KSDS"] }
```
`what` values today: `CALL target`, `CICS XCTL PROGRAM`, `batch DD with no JCL step`, `MQ queue (name set at runtime)`, `IMS database access (segments via PSB)`.

## Planned additions (not produced yet; safe to code against)

New things will only **add** prefixes and rels; nothing above changes.

- Node prefixes: `screen:`, `tsq:`, `tdq:`, `mq:`, `ims:`, `http:`, `ws:`, `socket:`, `env:`, `external:`
- Rels: `next` (RETURN TRANSID), `starts-async` (START TRANSID), `shows` (SEND/RECEIVE MAP), `triggers` (job → job), `time-dependent` flag on programs
- `confidence: "observed"`, for edges confirmed by a runtime trace
