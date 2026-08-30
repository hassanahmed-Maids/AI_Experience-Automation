# CC Price — the Cases table does not keep a per-run record (2026-08-27)

**Symptom.** Filtering `CC Price by Cohort — Cases` (`CwVPKkhck8kOdY6q`) to
`run_id = JUL2026-FINAL` returns **1 row**. The Runs row for that same run reports
`cases_scored: 5399`.

Those two numbers came from the *same query*. Stage 3's `Reconcile + Aggregate` does:

```js
const casesFound = rows.length;          // from Read Cases For Run
...
cases_scored: casesFound,
```

and `Read Cases For Run` is `get` on `CwVPKkhck8kOdY6q` filtered `run_id eq params.run_id`.
So when the run finished, that filter returned 5,399 rows. Today it returns 1. **The rows that
carried `run_id = JUL2026-FINAL` no longer carry it.**

## What the schema says, and it is unambiguous

The Cases table carries `case_key`, `first_seen`, `times_reported`, `run_id`, `scored_at`.

`first_seen` and `times_reported` are only meaningful if a row **survives across runs** and is
updated in place. This is an **upsert-keyed-on-`case_key`** store: one row per case, holding
its *current* state, where `run_id` and `scored_at` name **the last run that touched it** — not
the run that produced the verdict beside them.

Note the sibling divergence, because it matters: **MV Monthly's Cases table appends.** Its
Stage 3 explicitly dedupes — *"a slice restarted after a breaker trip re-scores its failing
chunk, so the same case_key can appear twice"*. Two sibling checks, two opposite storage
models, and nothing on either page says so.

## Three consequences, in increasing order of seriousness

**1. Stage 3's ground-truth read is only true at the instant it runs.** The gate that
*"refuses to report unless every contract has a case row"* — `DELIVERY REFUSED: … a report
covering part of the population would read like a complete audit`— is correct at write time and
**cannot be re-verified afterwards**. Re-reading a past run under-counts, exactly as it did here.

**2. The supersession work I did does not mean what it looks like.** D16 stamps *Runs* rows
`superseded`, which implies a preserved history. The **Cases** table keeps none: an older run's
case rows are **overwritten, not superseded**. The Runs row for JUL2026-FINAL still says 508
reds and AED 210,524 — but the list of *which* 508 contracts is no longer reconstructable.

**3. A smoke run can overwrite a real run's evidence.** `SMOKE-NATFALLBACK-1` and
`SMOKE-NATFALLBACK-2` are Runs ids 7 and 8, created **after** `JUL2026-FINAL` (id 6). If they
re-scored the same population, they re-stamped its case rows — which is exactly the shape of
5,399 → 1.

That reframes the smoke-row question I raised earlier. I described 11 smoke rows as cosmetic
noise in the Runs tables. On this check they are not cosmetic: **a smoke run against the real
population destroys the real run's per-case record.** These flows repeatedly state that
per-entity detail lives "behind the case" in the Cases table. For CC Price, that store is
last-write-wins.

## What is established vs inferred

**Established:** the 5,399/1 discrepancy from the live table and the run row; that Stage 3
derives `cases_scored` from that exact filtered read; the column set; that MV's equivalent table
appends while this one does not.

**Inferred, and needing one read to confirm:** that Stage 2's `Write Cases` node is an
`upsert` on `case_key`. The column design admits no other sensible reading, but I have not read
that node's `operation` — the n8n connector dropped before I could. The alternative explanations
are that the table was manually cleared, or that the smoke runs wrote a different `run_id` over
the population for some other reason.

## The checks that close this

1. Read Stage 2 (`bBYbpHcWMWybDQxN`) node **`Write Cases`** — is `operation` `upsert`, and are
   `matchingColumns` `["case_key"]`?
2. Tally `run_id` across the whole Cases table with no filter. If nearly all rows now carry
   `SMOKE-NATFALLBACK-2`, consequence 3 is confirmed rather than suspected.
3. Compare `first_seen` against `scored_at` on those rows — a wide gap is a row that has been
   re-stamped by later runs.

## If it is confirmed, the fix is a design decision, not a patch

Either the Cases table becomes **append-per-run** (row key `run_id + case_key`, as MV already
is), which makes every past run reconstructable and costs table growth; or it stays a
current-state store and **Stage 3 stops claiming to read ground truth for a named run**, with
per-run evidence written somewhere immutable instead. The one option not available is leaving it
as-is while the Runs table advertises a history the Cases table does not keep.

A prerequisite either way: **smoke runs must not share a population or a table with real runs.**

## Blocked on

The **Sami_s_n8n** connector requires re-authentication. All three checks above need it.
