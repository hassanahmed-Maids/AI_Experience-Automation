# Run log — `mvmp-2026-07-full` (audited month 2026-07)

The first full-population run of the check. Sliced by ascending `contractId` under one `runId`,
because a paced full month runs longer than an ERP session stays alive (`DEVIATIONS.md` F15).

**Population:** 24,378 in scope = 22,281 active + 2,097 cancelled-in-scope.
Out of scope: 664 start after the audited month, 20,455 ended before the cutoff, 25 owner-account.
Both cohorts reconciled every slice; the cancelled cohort once swept 22,650 against a reported
22,649 — **one more than the total**, absorbed by the tolerance. An equality check would have
aborted a correct sweep.

**Pacing:** 3 concurrent / 750 ms per ERP surface. Sweep 12.5 min per slice (fixed cost, ~460 paced
calls per cohort). Scoring 15.7–26 s per 25-contract chunk — the variance is ledger size, not ERP
degradation (clientmgmt stayed at 1.4–3.9 s throughout).

**No circuit-breaker trip, and no 503, in any slice.**

## Slices

| # | offset | limit | exec | wall clock | chunks | result |
|---|---|---|---|---|---|---|
| 1 | 0 | 250 | 93591 | 15m03s | 10/10 | 241 OK, 1 red, 8 pending, **139 needing a human (55.6%)** |
| 2 | 250 | 3000 | 93657 | 45m28s | 120/120 | cumulative 3,160 OK, 13 red, 77 pending, 211 needing a human (6.5%) |
| 3 | 3250 | 3000 | 93900 | running | | |

Slice 1's 55.6% human rate was the run's most useful early result: it exposed that gate 10 escalated
on an open vocabulary (`DEVIATIONS.md` F16). Fixed before the bulk of the population was scored, which
is the only reason the queue is readable — the same rate over 24,378 contracts would have been ~13,500
cases parked awaiting a reviewer.

## Findings so far

Counts only. Per-contract figures live in the Cases table, never in a run log.

| red type | count |
|---|---|
| missing 1st-of-month payment | 6 |
| payment amount mismatch | 7 |

Total outstanding on findings: **AED 10,588** (cumulative through slice 2).
Verifier: 14 verified, 14 verdicts persisted, 13 stand as findings, 1 cleared by staff-written
evidence, 13 PIL-ready, 0 blocked.

## Declared limits on this run

- Every slice is flagged `populationSample`, so Stage 3 reports the month as PARTIAL. The month is
  covered only when consecutive slices reach 24,378 — completeness across slices is a fact about the
  operator's sequence, not something one execution can assert.
- 3 cases had an incomplete payment ledger and were routed to a human rather than trusted as negatives.
- 3 cases could not determine `is_pre_collected` and were halted rather than assumed not pre-collected.
- Unrecognised payment type codes are recorded per case and reported at run level; they no longer
  escalate a clean month (`DEVIATIONS.md` F16).
- All ERP reads are attributed to ERP user `Abdullaha`, whose token was supplied per run — not to the
  person who requested the audit.
