# MV Monthly Payment check — the built flow

Three staged workflows in the **`Adeeb`** n8n project (`gxKXV4pckO4b4pQM`).
**All three are DRAFT (`active: false`). None is published or scheduled.**

| Stage | Workflow | ID |
|---|---|---|
| 0 | MV Monthly Payment · 0-Sweep Population | `9jOMFEC2zEWy2RHM` |
| 1 | MV Monthly Payment · 1-Population | `IKRXhIco1mwxrcPq` |
| 2 | MV Monthly Payment · 2-Score chunk | `CopNHNsXUzFO59bW` |
| 3 | MV Monthly Payment · 3-Deliver | `Z9fTvmaM526eYofe` |
| 4 | MV Monthly Payment · 4-Verify findings | `9T91z5VFH5g69WyT` |

Case store: `MV Monthly Payments Cases (test)` `MlU50KCb0NEQC1ch` (extended with 10 columns).
Run log: `MV Monthly Payments Runs (test)` `5pArYsVWkARj2JXH` (extended with 8 columns).

## How a run is triggered

Manual only. POST to Stage 1's webhook:

```
POST https://sami-team.app.n8n.cloud/webhook/mv-monthly-payment-run
{ "bearer": "Bearer eyJ…", "device": "1783…", "token": "eyJ…",
  "auditedMonth": "2026-07", "limit": 25, "chunkSize": 25 }
```

`limit` caps the contracts scored and flags the run `populationSample`, which Stage 3 declares in
its notes. Omit it for a full run. **The ERP token is a per-run payload — no stage holds an ERP
credential**, so every read is attributable to whoever triggered the run, and Stage 1 throws if any
of the three values is missing.

## What each stage does

**Stage 1 — population and orchestration.** Validates the payload, counts both cohorts (which
doubles as the token check, with the denial shapes spelled out in the error), plans and runs the
two-pass sweep, reconciles each cohort against its own `response.total` with a tolerance, **aborts
rather than scoring a partial population**, unions and chunks, calls Stage 2 per chunk, then Stage 3.

The population is the **union of ACTIVE and CANCELLED-in-scope**. An ACTIVE-only sweep is a snapshot
of *today* and misses every contract that was live in the audited month but has since been
cancelled — which is how both verified reds would go unreported. The cancelled cutoff reaches **one
month before** the audited month, because a pre-collected contract is tested on the previous month.

**Stage 2 — scoring worker.** One chunk per execution. Reads the ledger (`size=1000`, one call,
**reconciled against `totalElements`** — an incomplete read is never trusted as a negative) plus
`CONTRACT_DETAILS`, scores the contract-month, writes one case row, and **returns counts only** so
the parent never retains payloads. The scoring logic is `scorer.js` embedded verbatim; the embedded
copy was run against both verified reds before the workflow was created.

**Stage 3 — deliver.** Reads the Cases table back **as ground truth** rather than trusting what
Stage 2 returned, and marks the run `NOT REPORTABLE` unless every planned contract produced a case
row. Writes one Runs row, reads it back, and throws if it did not persist. Emits **counts, flags and
totals only** — per-entity amounts and identifiers stay in the case store, and no names, contact
details or salary components leave the check.

## Proven end to end 2026-08-19

The full chain has run live and correctly: population union -> scoring -> verification -> delivery.
Two gentle sweeps of the whole 45,519-contract population, no 503, module healthy before, during
and after both. The first PIL-ready finding is on record (contract 1074171, June 2026, AED 2,405,
no staff explanation, no chase in 106 days).

Re-verify without re-sweeping: POST `{ runId, bearer, token, device }` to
`mv-monthly-payment-verify`. 2 ERP calls per finding instead of ~464.

## Not done yet — read this before running anything for real

1. ~~No live run has happened.~~ **Targeted runs done.** A FULL run (all ~23,000 in-scope
   contracts) has still not been attempted; extrapolated cost ~4 hours.
   Original note: Offline is 140/140, but the flow has never executed. The next step
   is a small `limit` run, output read back, then a full run — and a real run needs sign-off.
2. ~~Stage 2 is serial~~ **DONE.** Stage 2 is now item-parallel at 5 concurrent, so a full run is
   ~4 hours rather than ~20. Note the deliberate asymmetry with Stage 0: Stage 2 drops the loop to
   gain concurrency, while Stage 0 *keeps* a loop precisely to get a circuit breaker. Different
   requirements, different shapes.
3. ~~The verifier layer is NOT built.~~ **BUILT** — Stage 4, wired between scoring and delivery.
   All five verifier rules run; four branches are proven by pinned fixture tests
   (`VERIFIER-TESTS-2026-08-19.md`), including that an unreadable surface or a failed model call
   leaves a finding STANDING and PIL-blocked rather than clearing it. Still unproven: Stage 4
   against live ERP evidence end to end. Superseded note follows.
   ~~Original:~~ The spec's five verifier rules — read what staff wrote, the
   10-day chase rule, the follow-up qualification tests — do not run anywhere in this chain. Every
   finding it produces is **deterministic only and has not been checked against staff-written
   evidence**, so none is ready for the PIL queue. Stage 3 declares this in every run's notes. The
   logic exists and is tested in `scorer.js` (`applyVerifier`, `classifyFollowup`); it needs a
   Stage 4 that reads the WhatsApp log and complaint threads.
4. **The amount-mismatch red type has no verified live example.** Covered by synthetic tests only.

## Test seeds for the first live run

Contracts with known expected outcomes, all confirmed live 2026-08-19:

| contract | audited month | expected |
|---|---|---|
| 1023590 | 2026-03 | **finding** — missing 1st-of-month, gap 1838, gate 4 |
| 1074171 | 2026-07 | **finding** — missing previous-month (pre-collected), gap 2405, gate 8 |
| 1074171 | 2026-06 | clean — tests May, which was paid |
| 1099709 | 2026-07 | clean — tests June, start month, 168 received |
| 1099709 | 2026-08 | clean — tests July, 1638 = expected |
| 1029517 | 2026-04 | clean — 1575 received, three DELETED rows excluded |

Note 1023590 and 1074171 are **CANCELLED**, so they only appear if the cancelled cohort is swept.
That makes them the sharpest test of Stage 1's population.
