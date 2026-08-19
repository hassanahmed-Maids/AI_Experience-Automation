# Dummy Tickets Submitted for Refund — Housemaids

Rebuild of the live check `FXrhGBJUnGYgrs9R`, against Notion spec **v0.4 draft (2026-08-17)**.
check_id `7d6e0c41-9b2a-4d6c-83f1-2a4c6e8d1f02`.

## What is where

| | |
|---|---|
| **1-Score** (main flow, PUBLISHED) | https://sami-team.app.n8n.cloud/workflow/aTmGMAlYLwsJQ7js |
| **0-Fetch Tickets** (sub-workflow, PUBLISHED) | https://sami-team.app.n8n.cloud/workflow/YQlNlxrnhbQpBbdl |
| Result workbook | https://docs.google.com/spreadsheets/d/172R3JzxXm1nf6Vc3qTesin7eys-jT0ng3SOxUsf3LD8 |
| Golden it is built on | `Qq473Ygj543jxPUN` — CC Non Received Monthly Payments |
| The flow it replaces (LIVE) | `FXrhGBJUnGYgrs9R` |

`scorer.js` · `test-cases.js` · `prod-comparison.js` · `SPEC-FINDINGS.md`

## Running it

```bash
node test-cases.js       # 49 assertions: spec test cases + one guard per "Never" clause
node prod-comparison.js  # scores the same fixtures through the LIVE flow's logic
```

For a live run: set the n8n workflow variable `ERP_BEARER` to `Bearer <token>` — **the token of
the person running the check** — and execute from the `Run Manually` trigger. Disable the three
`Callback —` nodes first unless you intend to post to the portal.

**Runs completed end to end** (both 2026-08-19, results in the workbook):

| window | population | applicants | findings | exposure | wall clock |
|---|---|---|---|---|---|
| 2026-05-01..05 (5d) | 137/137, 1 page | 93 | 4 | AED 11,517 | ~2m40s |
| 2026-06-01..30 (30d) | 1197/1197, 6 pages | 605 | 7 | AED 22,611.54 | **8m05s** |

The June run is the **first month-scale run ever to complete** — the spec records the only previous
attempt dying with `erp_unavailable`. 25 sequential chunks, zero ERP failures across ~1,200
authenticated reads.

## Before this goes live

1. **Sign-off.** The flow is a draft and must stay one until someone who has read the spec
   approves a production run. Findings here name real clients and real money.
2. **All four business questions are settled** (Hassan, 2026-08-19) — see `SPEC-FINDINGS.md`
   Parts 3 and 4. Every default is a ruling; each is overridable in `params` only so an
   alternative can be measured:
   - blank refund schedule → **flag it** (1 red in 93)
   - zero-amount siblings → **clean** when the money all came back (clean 61 → 82)
   - repeat-booking threshold → **2**, which sends **49 of 93** for a booking review
   - scope → **applicants only**; a housemaid charge is counted but caseless

   Note on the threshold: it drives review load only. Findings stay at 4 and exposure at
   AED 11,517 at any threshold. A threshold of 6 would send 8 for review instead of 49.
3. **Re-verify on the operator's own ERP account.** Everything in Part 2 was measured on a
   borrowed token; nothing should be marked `Technical Validated` until it is re-run under the
   identity that will own the findings.
4. **The live flow's webhook is unauthenticated** (Part 1 §1) and will stay that way until it is
   replaced or unpublished. That is independent of this build.

## The verifier

Rules 1 and 2 are **built** (see `SPEC-FINDINGS.md` Part 5). Enforcement lives in
`Merge Verdicts`, not the prompt: only `EXPLAINED`+quote or `CLAIMED_OFF_ERP`+quote may move a
ticket, a claimed off-ERP refund downgrades to *pending* and never clears the amount, and there
is no path by which a confirmed loss becomes clean.

**Rule 1 has no live case yet** — the reference window holds zero `Used` tickets. Covered offline
only; do not record it as validated.

## Publishing does not cut over

The portal calls the old flow's path; this one answers on `/webhook/dummy-tickets-housemaids`.
Both are live. When the portal is repointed, **unpublish the old flow** — that also closes its
unauthenticated-webhook exposure.
