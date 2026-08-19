# First month-scoped run — 2026-08-19, audit month 2026-07

## JUL-SMOKE-01 — the plumbing works, and it scored nothing

Executions 93323 (Stage 1) → 93324 (Stage 2) → 93325 (Stage 3), all success,
33 seconds wall clock. 25 contracts, one chunk.

```
overall              HALTED EARLY   (chunk.max_chunks = 1, by design)
population_count     5393
in_scope             0
out_of_scope         25   {"started_after_month_start": 25}
green 0 | red 0 | pending 0
audit_runs_rows_written      1
audit_findings_rows_written  0   (correct - nothing to report)
```

**Every contract in the sample was out of scope, and that is the right answer.**
The dynamic API returns contracts in descending `contractId`, so offset 0 is the
25 newest contracts — all started in August, none active for the whole of July.
This is the sampling bias recorded in `first-real-verdicts.md`, and it is exactly
the population that produced nine false "under-priced" findings on 2026-08-18.
Month scoping now excludes them by rule instead of accusing them.

The corollary is that this smoke proved the pipeline, not the scoring. A smoke
run at offset 0 can never exercise a verdict for a past month, because the head
of the population is always too new. **Future smoke runs must sample the middle
of the population**, which needs `chunk.offset` to be settable from the payload
(Stage 1 currently pins it to 0).

## Stage 1, verified

```
population       5393 fetched, independent count 5393, delta 0
pages            12 at size 500, probe page empty
duplicates       0
nationality      5103 present, 290 absent
guard            ok
acting_user      Abdullaha
audit_month      2026-07 (explicit, not defaulted)
```

The projection now carries `scheduled_termination` (59 of 5,393 populated), the
field the whole-month scope test needs.

## What the smoke actually confirmed

- `audit_month` validation and threading through all three stages
- the population guard reconciling against an independent count on a fresh pull
- out-of-scope as a real third outcome, counted separately and excluded from the
  green/red/pending denominator
- the two spreadsheet tabs receiving a run summary, read back and count-checked
- `HALTED EARLY` surviving into the sheet, so a deliberately partial run cannot
  be mistaken for a finished audit

## Attribution

Run on a colleague's token (`Abdullaha`) at the operator's instruction. ERP logs
these reads under that id. `acting_user` is recorded on the run so the
attribution is visible rather than implicit. **This is not evidence that the
audit account has the `getactivecccontracts` grant** — that access gap is still
open and still a finding.
