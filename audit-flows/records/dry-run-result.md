# Dry-run of the five supersession stamps — 2026-08-27

Harness: `ZZ Supersession dry-run harness (throwaway)` · `0wR51wFA95VJSPmv`
(project Adeeb, draft, never published). Executions 104995 · 105000 · 105026.

The five `Mark Prior Runs Superseded` filters were copied out of the deployed flows
verbatim and re-run with `options.dryRun = true`, which the Data Table node documents as
*"simulates and returns affected rows in their before and after states"*. Nothing was
written to any table at any point.

---

## It found a real defect, in MV

**MV Monthly Payment writes one Runs row per SLICE, not per run.** Stage 1 calls Stage 3
at the end of each slice, and the live table already holds four rows under the single
runId `mvmp-2026-07-full`.

The stamp I shipped matched `check_id + window_from` only. Its own note argued that at
stamp time every matching row is a predecessor *by construction* — true for a flow that
writes one row per run, false here. Simulated, the two-condition filter matched **all six**
July rows including the current run's own four slices. Live, that means slice 2 supersedes
slice 1, slice 3 supersedes 1 and 2, and after the last slice a `superseded != true` reader
sees **one slice** and reads its counts as the month's.

That is a worse error than the double-count D16 set out to fix: D16 over-reported a re-run,
this would have under-reported a whole month, and silently.

### The fix, and the question it depended on

The node's note recorded `neq` as *"a condition this node's vocabulary may not offer for
string columns and which could not be tested from here."* The harness tested it: **`neq` is
supported.** The probe ran the three-condition filter against the live table and matched
exactly the two rows belonging to other runs.

So all five stamps now carry `run_id neq <this run>`. On MV it is load-bearing. On the
other four it is a no-op today — one row per run, stamp before the insert — and was added
anyway, because "two conditions suffice" rested on a fact about each flow that nothing
enforces, which is precisely how MV broke.

---

## Simulation results, after the fix (execution 105026)

| stamp | would touch | rows |
|---|---|---|
| **MV** | 2 | ids 3, 4 — the two foreign runs. **All four slices of `mvmp-2026-07-full` survive** |
| CC Price | 2 | ids 4, 6 (`JUL2026-FULL-05`, `JUL2026-FINAL`). The six SMOKE runs untouched |
| Applicant | 3 | ids 5, 6, 8. The five SMOKE runs untouched |
| Terminated HM | 0 | table empty — proves the config valid and the `window` column real |
| Dummy Tickets | 0 | same |

Every stamp hit its intended rows and nothing else. Notably the MV table is **shared with a
second check** (`mv-non-received-monthly-payments`, ids 1–2, window 2026-06-01); the
`check_id` condition excluded them, as designed — confirmed rather than assumed.

---

## One thing left, and it is your call not mine

**`superseded` is NULL on all 24 pre-existing rows, not `false`.** The column was added
after those runs; nothing backfilled them. A reader who writes the natural filter
`superseded = false` gets **zero** historical runs. Only `superseded != true` works.

I did not backfill, and deliberately. The honest backfill is not "set them all false" —
several of those rows genuinely *are* superseded (MV ids 3 and 4 by `mvmp-2026-07-full`;
CC id 4 by id 6). Writing the correct value means applying the supersession rule
retroactively to historical records, which is a one-time rewrite of what the audit trail
says about past runs. That is a decision about the record, not a flow fix, so it wants your
word before it happens.

Two ways out, either fine:
- **Document `!= true`** as the filter and leave history alone. Costs nothing, but relies
  on every future reader knowing.
- **Backfill by rule** — I can dry-run it first, same harness, and show you exactly which
  rows would flip before anything is written.

The five flows are correct either way; this only affects reading the 24 rows that predate
the column.

---

## Housekeeping

The harness is a draft in the Adeeb project and reads/simulates only. Worth keeping until
the first real run of each flow confirms the stamps in production, then delete it.
