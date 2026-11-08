# Demo

> **DRAFT.** Storyline for the judges (~3 minutes), built on AWS CardDemo (D-014) plus our
> fixture (D-018). Everything under "Seed" must exist so the demo is reliable and runs offline.

## Storyline

1. **The mess.** The graph of AWS CardDemo: online CICS screens, batch jobs, VSAM files,
   in nested pockets with thin weighted edges. "We didn't ask an LLM what depends on
   what; we parsed it."
2. **Traffic and isolation decide.** Start the traffic generator at a compressed sim
   clock. Shares climb. The interest pocket (`CBACT04C`) is both hot and well isolated,
   so it starts first. A tangled hot pocket is shown as "hot, too coupled" and waits. A
   purchase burst starts a second pocket in parallel.
3. **Rewrite.** Nemotron Super writes Java behind the generated interface, step by step:
   read code → write → compile → run golden tests → fix.
4. **Shadow.** Every request goes to old and new; only old answers. `CBACT04C` stamps
   `CURRENT-DATE`: two legacy copies disagree on it, so it's noise and filtered out.
5. **Old wins by default.** The Java rounds interest, the COBOL truncates (no
   `ROUNDED`). There's no knowledge-base entry, and it's a money field, so the agent asks
   instead of assuming. A Slack card arrives: input, both outputs, the 3-line COMPUTE,
   four buttons. A teammate clicks **[Old]**. The answer goes into the knowledge base and
   becomes a test, and the match rate jumps. The other pocket kept migrating the whole time.
6. **Knowledge base overrides.** An imported expert note ("military accounts pay no late
   fees") settles a fixture mismatch with no question asked. The dead-looking branch is
   real business logic.
7. **Legacy bug.** A fixture refund mismatch: the agent suspects a legacy bug (it pays
   out more than the credit balance) and asks. A teammate clicks **[New]**, and a legacy
   bug is recorded: "overpays by the last late fee, est. $X across N refunds".
8. **Cut over.** 1% → 10% → 100%. Inject a bad build: mismatches spike, automatic
   rollback, the job reopens.
9. **Dead code.** Sim a month: the never-called fixture transaction is flagged dead.
   CardDemo's empty `1400-COMPUTE-FEES` stub gets a question, not a deletion.

## Seed / script for reliability

- `pnpm legacy:fetch` at the pinned CardDemo commit; ASCII sample data from
  `app/data/ASCII`.
- Fixture app (`legacy/fixture/`, to be built): overpaying refund, military fee rule,
  never-called transaction.
- `knowledge/` with one or two expert notes, tagged with author and authority.
- Fixed `traffic.seed`, account weights, and a scripted traffic `scenario`.
- LLM in **replay** mode from a recorded cache (`.cache/llm/`), so no network is needed.
  Live mode is optional.
- Slack: a demo workspace and channel; `config/owners.json` maps CardDemo paths to
  teammates. A `tools` command can answer a question if Slack is down.
- `pnpm stdb:reset` + reset between runs; sim speed set by script.
- Until the UI exists, demo with `pnpm tail` (event stream) and a `state` command.
