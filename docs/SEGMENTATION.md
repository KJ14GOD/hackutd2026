# Segmentation

> **PROPOSED.** Algorithm per the brief; the omnipresent-node rule and hub dampening are
> our additions (D-009) and need sign-off.

Goal: split the legacy code into nested **pockets**, code that depends heavily on itself
and only weakly on the rest. Keep the weak cross-pocket edges (with weights) because the
UI draws them. The graph comes from static analysis and git history, **not an LLM**:
the research shows LLMs recover components but not the arrows between them (under 0.18,
with 39% of errors being invented dependencies; R2ABench, see `research/`).

## Pipeline

1. **Extract**, one extractor per language behind one interface:
   `extract(path, source) -> {id, kind, loc, calls[{target,count}], copybooks[], files[], tables[], txnMap}`.
2. **Build** a weighted, undirected graph over programs.
3. **Cluster** hierarchically with Louvain: domain → pocket → file (program).
4. **Map endpoints** to pockets.
5. **Write** to SpacetimeDB (`loadSegmentation`) and export `out/segmentation.json` for debugging.

## COBOL extractor (first)

Pragmatic line-based parsing (tree-sitter optional later). It handles fixed format
(columns 1–6 sequence, column 7 indicator, `*`/`/` comment lines) and free format (`*>`).
It extracts:

| Item | Pattern |
| --- | --- |
| program id | `PROGRAM-ID. NAME.` |
| CALL targets (with counts) | `CALL 'NAME'` / `CALL "NAME"` |
| CICS program flow | `EXEC CICS XCTL PROGRAM(...)` / `EXEC CICS LINK PROGRAM(...)` (CardDemo's online programs navigate this way, not with CALL); counted as `call` edges |
| CICS file access | `EXEC CICS READ/WRITE/REWRITE/STARTBR ... FILE(...)` or `DATASET(...)`; counted as `file` edges |
| copybooks | `COPY NAME.` |
| files | `SELECT f ASSIGN TO 'EXT'` or `ASSIGN TO EXT` (external name; CardDemo uses unquoted DD names like `ACCTFILE`) and `FD f` |
| SQL tables | inside `EXEC SQL … END-EXEC`: `FROM`, `JOIN`, `INTO`, `UPDATE`, `DELETE FROM` |
| transaction map | in a dispatcher, `WHEN 'TXN'` followed by `CALL 'PROG'` in the same WHEN block |

A program with a transaction map is a **dispatcher**. It is not clustered; its map
gives transaction → entry program.

## Edges and weights (`segmentation.edgeWeights`)

| kind | weight |
| --- | --- |
| `call` | `call × number of call sites` |
| `file` (shared SELECT/FD) | `file` (heavy, default 6) |
| `table` (shared SQL table) | `table` (heavy, default 6) |
| `copybook` (shared COPY) | `copybook` (default 2) |
| `cochange` (git log) | `cochange × commits touching both`, ignoring commits with more than `cochange.maxFilesPerCommit` files and pairs seen fewer than `cochange.minCount` times |

**Hub dampening** (`hubDampening`): a resource shared by `n` programs adds
`weight / (n − 1)` per pair, so a copybook everyone includes does not glue everything
together.

**Omnipresent nodes** (`omnipresentThreshold`, after Bunch): a program called by more than
this share of programs (e.g. a shared I/O module), or a resource used by more than this
share, is left out of clustering. The program goes into a `shared` pocket. Its edges still
count toward `pocketEdge`, so the UI shows the dependency.

## Clustering

- Louvain via `graphology-communities-louvain`, with `getEdgeWeight: 'weight'` and
  `resolution` from config (`resolution.pocket`, `resolution.domain`).
- **Deterministic:** nodes are added in sorted order and `rng` is a seeded PRNG
  (`segmentation.seed`), so pocket ids and the UI layout stay the same between runs.
- **Levels:** pockets come from Louvain on the program graph. Domains come from Louvain
  on the aggregated pocket graph. Files are the programs themselves.
- Pocket ids are stable and readable: `pkt-<lowest member, lowercased>`, `dom-…`.

For each pocket the output includes: `members`, `cohesion` (sum of internal edge
weights), `coupling` (sum of boundary edge weights), `isolation`
(`cohesion / (cohesion + coupling)`, 1.0 when both are 0; used for ranking, D-007), aggregated edges to other pockets
(weight, plus a breakdown by kind), and `endpoints` (entry endpoints).

## Endpoint mapping

Endpoint catalog (route → transaction code) + dispatcher map (transaction → entry
program) + program → pocket. `endpoint.pocketId` is the entry program's pocket, which
drives traffic share. `servedBy` adds every pocket reachable through calls, which drives
dead-code detection, so a shared library is never "dead".

## Inputs

- `legacy/carddemo/app` (pinned, D-014): 31 core programs in `cbl/`, 30 copybooks in
  `cpy/`, plus optional modules (DB2/IMS/MQ) whose programs contain `EXEC SQL`. Map
  copybooks: `cpy-bms/` (screen layouts) count as copybooks.
- `legacy/fixture/` (ours, D-018), segmented together with CardDemo or on its own.

## Tests (on CardDemo + the fixture app)

- Extractor finds every CALL, CICS XCTL/LINK, COPY, SELECT/FD, CICS FILE, and EXEC SQL table (inline snippets).
- Same input + seed gives an identical JSON output.
- Expected grouping on the fixture: heavy file sharing lands in one pocket; the
  never-called transaction lands in its own pocket.
