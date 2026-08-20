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
| 3 | 3250 | 3000 | 93900 | 48m18s | 120/120 | cumulative 5,990 OK, 52 red, 208 pending, 349 needing a human (5.6%) |
| 4 | 6250 | 3000 | 94124 | 42m04s | **106/120 — BREAKER TRIPPED** | ERP session dropped at 14:35Z; 2,650 contracts scored, resume at offset 8900 |

### Slice 4 — the breaker firing in production

At 14:35Z, 106 chunks in, both ERP surfaces began returning `401 / UNAUTHENTICATED / UNAUTHORIZED
<LOGOUT>`. The session behind the token had dropped — 2 h 50 m after the operator logged back in, not
the ~4 h assumed. The breaker threw on the first affected chunk, which failed Stage 1's `Score Chunk`
node and stopped the run.

**This is the behaviour it was built for.** Without it the remaining 14 chunks — and every later slice —
would have been called against a refusing ERP and filed as ~18,000 cases "awaiting reviewer", which in
the case store is indistinguishable from work that was done.

What it got *wrong* was the advice: it reported `ERP_ACCESS_DENIED` and told the operator to report a
permission gap. Fixed — `<LOGOUT>` is now tested before any status-based branch (`DEVIATIONS.md` F15).

Resume point: **offset 8900**, the start of the failing chunk. Chunk 106's rows were written before the
breaker threw (it runs after the write), so re-running it re-scores the 7 contracts whose reads were
refused. Duplicates by `case_key` are expected and deduped on read.

Slice 1's 55.6% human rate was the run's most useful early result: it exposed that gate 10 escalated
on an open vocabulary (`DEVIATIONS.md` F16). Fixed before the bulk of the population was scored, which
is the only reason the queue is readable — the same rate over 24,378 contracts would have been ~13,500
cases parked awaiting a reviewer.

## STOPPED — operator accounts deactivated

The ERP session dropped mid-slice-4 (14:35Z), and both operator accounts were subsequently
deactivated. There is no ERP access, so the run cannot continue and **nothing was routed around**:
an access removal is reported, not worked past.

Everything already scored has been rolled up and is on record. That needed a new entry point —
Stage 3 was reachable only from Stage 1, which always sweeps the ERP first, so a run that died
mid-slice left every scored case unreportable. Stage 3 now has a `Rollup In` webhook that reports an
existing run from the Cases table with no ERP access at all, and counts cases **distinct by
`case_key`** so a resumed slice cannot pass the completeness gate on duplicates.

### Final state of this run

| | |
|---|---|
| covered | **8,925 of 24,378 in-scope contracts (36.6%)** |
| OK | 8,633 |
| red flags | **60** |
| pending (in flight) | 232 |
| needing a human | 397 (4.4%) |
| outstanding on findings | **AED 32,956** |
| rollup | exec 95094, `overall: FINDINGS`, Runs row persisted |

**The remaining 15,453 contracts are UNAUDITED, not clean.** The run's own notes say so, and Stage 3
reports it PARTIAL — this is the one distinction that must never blur, because a partial run read as
a clean month is the exact failure the whole population guard exists to prevent.

### To resume, when ERP access is restored

1. Health-check the surface and read the **body**, not the status code.
2. `offset: 8900` — the start of the failing chunk, so the 7 contracts whose reads were refused are
   actually scored. Its 25 rows were written before the breaker threw; duplicates collapse by `case_key`.
3. Then offsets 11900, 14900, 17900, 20900, and a final slice with **no `limit`**.
4. Slice 4's findings have **not** been through Stage 4, so none is PIL-ready. Re-run the verifier for
   the run once scoring completes.

## Findings so far

Counts only. Per-contract figures live in the Cases table, never in a run log.

| red type | count |
|---|---|
| payment amount mismatch | 42 |
| missing 1st-of-month payment | 14 |
| missing previous-month payment | 4 |
| missing or invalid payment type | 0 — still never observed in production |

Total outstanding on findings: **AED 32,956**.

Verifier (slices 1–3 only): 55 verified, 55 verdicts persisted, 51 stand as findings, 2 cleared by
staff-written evidence, 1 held for a reviewer, 51 PIL-ready, 1 blocked because the model call failed —
which correctly left the finding standing rather than clearing it.

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
