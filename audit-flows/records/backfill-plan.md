# Backfill dry-run — the 24 rows that predate the `superseded` column

Harness `0wR51wFA95VJSPmv`, execution **105031**. **Nothing was written.** The plan node
only reads rows the get nodes already pulled.

## The rule applied

Within a group — the same key each flow's own stamp matches on — rank the **runs** by when
they were written; the latest run stays current (`false`), every earlier run is superseded
(`true`).

Ranking is by **run**, not by row, and that is the one place this could have gone wrong.
MV writes one row per slice, so `mvmp-2026-07-full` owns four rows with four different
`createdAt` values. Ranking rows would have marked three of its own slices superseded by the
fourth. Each run is ranked on its latest row instead — which is why ids 5–8 all stay live.

Ordering uses `createdAt`, the system insert time, not `completed_at`, which a run's own
payload could carry wrong. **All 24 rows had a real `createdAt`** — no fallbacks, and no
ties, so no group needed a coin-flip.

## Result: 24 rows, all 24 change from NULL — 14 → true, 10 → false

### MV Monthly Payments Runs (test) · `5pArYsVWkARj2JXH`

| id | run_id | → | why |
|---|---|---|---|
| 1 | manual-84127 | **true** | later run exists (group `mv-non-received-monthly-payments \| 2026-06-01`) |
| 2 | manual-84247 | false | latest in its group |
| 3 | mvmp-2026-07-20260819102919 | **true** | later run exists |
| 4 | mvmp-2026-07-20260819110445 | **true** | later run exists |
| 5 | mvmp-2026-07-full | false | latest run — slice 1 of 4 |
| 6 | mvmp-2026-07-full | false | latest run — slice 2 of 4 |
| 7 | mvmp-2026-07-full | false | latest run — slice 3 of 4 |
| 8 | mvmp-2026-07-full | false | latest run — slice 4 of 4 |

Two groups, correctly separated: the 2026-06 rows belong to a **different check** and are
ranked among themselves.

### CC Price by Cohort — Runs · `EbuKj5JiMz0v7R0f`

| id | run_id | → | group |
|---|---|---|---|
| 1 | SMOKE-20260818-e2e | **true** | SMOKE \| `<null>` |
| 2 | SMOKE-dynapi-02 | false | SMOKE \| `<null>` |
| 3 | JUL-SMOKE-01 | **true** | SMOKE \| 2026-07 |
| 4 | **JUL2026-FULL-05** | **true** | **real \| 2026-07** |
| 5 | JUL-SMOKE-ABOVECARD | **true** | SMOKE \| 2026-07 |
| 6 | **JUL2026-FINAL** | false | **real \| 2026-07** — the survivor |
| 7 | SMOKE-NATFALLBACK-1 | **true** | SMOKE \| 2026-07 |
| 8 | SMOKE-NATFALLBACK-2 | false | SMOKE \| 2026-07 |

### Applicant Real Ticket — Runs · `qgb86RpbT4mAK8Vg`

| id | run_id | → | group |
|---|---|---|---|
| 1 | SMOKE-2026-07-a | **true** | SMOKE |
| 2 | SMOKE-2026-07-testcases | **true** | SMOKE |
| 3 | SMOKE-2026-07-verifier | **true** | SMOKE |
| 4 | SMOKE-2026-07-moneyout | **true** | SMOKE |
| 5 | **manual-2026-07-full-01** | **true** | **real** |
| 6 | **manual-2026-07-full-02-corrected** | **true** | **real** |
| 7 | SMOKE-anthropic-keycheck | false | SMOKE |
| 8 | **manual-2026-07-full-03** | false | **real** — the survivor |

### Terminated HM · Dummy Tickets — 0 rows, nothing to backfill

---

## One thing the backfill does NOT fix, and you should know before running it

**11 of the 24 rows are smoke tests, and the backfill leaves three of them marked current.**
CC id 2 and id 8, Applicant id 7 all come out `superseded = false` — correctly, because
each is the latest run *in its own SMOKE group*.

That is the flag behaving as designed: supersession answers "is there a newer run of this
check for this window", not "was this a real run". The two are separated by `check_id`, and
a reader who filters only on `superseded != true` will still pull smoke runs into a total.

So the filter a report should use is **`check_id = <the real check> AND superseded != true`**,
not supersession alone. If you would rather the smoke rows were simply gone, that is a
delete, and a different decision from this one — say so and I will plan it the same way
before touching anything.

## To execute

Say the word and I will apply exactly the 24 changes above — 14 to `true`, 10 to `false` —
and re-read the tables afterwards to show the result. Nothing has been written yet.
