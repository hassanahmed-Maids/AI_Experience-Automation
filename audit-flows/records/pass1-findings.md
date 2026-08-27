# Dry-run harness · pass 1 (inventory) — execution 104995, 2026-08-27

24 rows across the three populated Runs tables; the two new ones are empty.

## Finding 1 — `superseded` is NULL on all 24 pre-existing rows, not false

`superseded_type` came back `"object"` (i.e. `null`) for every row in all three tables.
The column was added by me; existing rows were never backfilled.

Consequence: a reader who filters `superseded = false` sees **zero** historical runs.
Only `superseded != true` behaves. Either the docs say `!= true`, or the 24 rows get a
one-off backfill to `false`. This is not a flow bug — it is the flag's meaning on day one,
and it would have been discovered by someone summing an empty column.

## Finding 2 — MV writes one Runs row PER SLICE, and the stamp does not know that

| id | run_id | check_id | window_from |
|---|---|---|---|
| 3 | mvmp-2026-07-20260819102919 | mv-monthly-payment | 2026-07-01 |
| 4 | mvmp-2026-07-20260819110445 | mv-monthly-payment | 2026-07-01 |
| 5 | **mvmp-2026-07-full** | mv-monthly-payment | 2026-07-01 |
| 6 | **mvmp-2026-07-full** | mv-monthly-payment | 2026-07-01 |
| 7 | **mvmp-2026-07-full** | mv-monthly-payment | 2026-07-01 |
| 8 | **mvmp-2026-07-full** | mv-monthly-payment | 2026-07-01 |

Four rows share one run_id. Stage 1 calls Stage 3 at the end of **each slice**, so a
multi-slice run writes one Runs row per slice, all under the same runId.

The stamp I shipped matches `check_id + window_from` and nothing else, on the reasoning
(written into the node's own note) that at stamp time every matching row is a predecessor
*by construction*. That reasoning holds for one-row-per-run checks. It is **wrong for MV**:
slice 2 would stamp slice 1 superseded, slice 3 would stamp 1 and 2, and after slice 4 only
the final slice survives the `superseded != true` filter — so the month's totals would read
as one slice's, which is a worse under-count than the double-count D16 set out to fix.

The filter needs a third condition, `run_id != <this run>`. Whether the Data Table node
offers `neq` on a string column is the open question the node note flagged as untestable;
pass 2 tests it directly.

Rows 1-2 of the same table belong to a DIFFERENT check (`mv-non-received-monthly-payments`,
window 2026-06-01). The `check_id` condition correctly excludes them - worth confirming in
the simulation rather than assuming.

## Finding 3 — CC Price: two rows carry a NULL audit_month

ids 1 and 2 (`SMOKE-20260818-e2e`, `SMOKE-dynapi-02`) have `audit_month = null`. They also
carry the SMOKE check_id, so the stamp excludes them on check_id alone. No action; recorded
so a later reader does not mistake the null for a stamp failure.

## Expected matches, to be checked against the simulation

| stamp | filter values | rows that SHOULD match |
|---|---|---|
| MV | check_id=mv-monthly-payment, window_from=2026-07-01 | 3,4,5,6,7,8 (six) |
| CC Price | check_id=manual-cc-price-by-cohort, audit_month=2026-07 | 4,6 (two) |
| Applicant | check_id=applicant-real-ticket, window_from=2026-07-01 | 5,6,8 (three) |
| Terminated HM | window=2026-07 | 0 - table empty |
| Dummy Tickets | window=2026-07 | 0 - table empty |
