# Dummy Tickets Submitted for Refund — Housemaids

Rebuild of the live check `FXrhGBJUnGYgrs9R`, against Notion spec **v0.4 draft (2026-08-17)**.
check_id `7d6e0c41-9b2a-4d6c-83f1-2a4c6e8d1f02`.

## What is where

| | |
|---|---|
| **1-Score** (main flow, DRAFT) | https://sami-team.app.n8n.cloud/workflow/aTmGMAlYLwsJQ7js |
| **0-Fetch Tickets** (sub-workflow, DRAFT) | https://sami-team.app.n8n.cloud/workflow/YQlNlxrnhbQpBbdl |
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

## Before this goes live

1. **Sign-off.** The flow is a draft and must stay one until someone who has read the spec
   approves a production run. Findings here name real clients and real money.
2. **Three owner decisions**, each with its measurement in `SPEC-FINDINGS.md`:
   - the empty-`requestRefundAutomaticallyType` contradiction (§4.1, §13) — Jacky
   - `immaterial` vs `refunded` case ranking, worth 26 of 93 cases (§14) — Jacky
   - `repeat_threshold` for gate 110, currently inert with 54 candidates (§4.2) — Malaz
   - what happens to a housemaid charge in the dummy expense (§9)
3. **Re-verify on the operator's own ERP account.** Everything in Part 2 was measured on a
   borrowed token; nothing should be marked `Technical Validated` until it is re-run under the
   identity that will own the findings.
4. **The live flow's webhook is unauthenticated** (Part 1 §1) and will stay that way until it is
   replaced or unpublished. That is independent of this build.

## Not built

Verifier rules 1 and 2. Gate 80 (`Used`) and finding cases are *routed* to human review with
their evidence rather than adjudicated. Every run declares this in `record.declared_gaps`.
