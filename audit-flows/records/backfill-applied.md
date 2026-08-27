# Backfill APPLIED and verified — 2026-08-27

Harness `0wR51wFA95VJSPmv`. Executions **105265** (mechanism check, dryRun) →
**105267** (live write + read-back).

## What ran

Three writers, one per table, keyed on **`run_id`** rather than row id — every run_id in
these tables maps to exactly one wanted value, and `mvmp-2026-07-full`'s four slices all
want `false`, so one call per run covers them (the Data Table update matches row(s) plural).

Two guards ran before any write, and both had to pass:

1. **Drift check.** Each build node asserts the live rows still match the approved plan —
   that `run_id` X still covers exactly the row ids the plan covered. A table that moved
   since approval aborts the run rather than being written with something nobody agreed to.
2. **Coverage check.** Any row present in the table but absent from the plan aborts too,
   because leaving one NULL silently is the exact failure the backfill exists to end.

Then the mechanism itself was dry-run (105265) before `dryRun` was turned off: **24 rows,
14 → true, 10 → false**, matching the approved plan exactly.

## Verified from a fresh read, not from the writers

A real Data Table update returns only `id` and timestamps, so its own output can confirm
that rows were *touched*, not that they hold the right *value*. Three get nodes re-read the
tables after the write and the report compares every row against the approved plan.

**Result: all 24 rows hold the approved value. 0 wrong, 0 still NULL.**

| table | stored |
|---|---|
| **MV** | 1 true · 2 false · 3 true · 4 true · **5–8 false** (all four slices of `mvmp-2026-07-full`) |
| **CC Price** | 1 true · 2 false · 3 true · **4 true** · 5 true · **6 false** · 7 true · 8 false |
| **Applicant** | 1–6 true · 7 false · **8 false** |

The real-check pairs came out as intended: CC `JUL2026-FULL-05` retired behind
`JUL2026-FINAL`; Applicant `-full-01` and `-full-02-corrected` retired behind `-full-03`.

## State now

- **`superseded = false` is a working filter.** No row in any of the three tables holds NULL.
- The two new tables (Terminated HM, Dummy Tickets) were empty and remain so; their first
  run writes `false` directly.
- **The harness writers are back on `dryRun`.** The backfill is idempotent — it writes
  absolute values, not toggles — but a workflow able to silently rewrite audit rows should
  not sit around armed.

## Still true, and not fixed by this

Three SMOKE runs are now marked current: CC ids 2 and 8, Applicant id 7 — each correctly the
latest run in its own SMOKE group. Supersession answers "is there a newer run of this check
for this window", not "was this a real run". A report must filter
**`check_id = <the real check> AND superseded != true`**. Deleting the 11 smoke rows is a
separate decision; say the word and I will plan it the same way first.
