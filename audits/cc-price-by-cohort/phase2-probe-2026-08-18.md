# Phase 2 — ERP access probe, 2026-08-18

Run on **Hassan.Ahmed's own token** (device 1765547372465, matched the token's own
device claim). Read-only. Status, shapes and key paths only — no values.

## Results vs the 2026-08-17 baseline

| # | Surface | pagecode | Baseline | Now | Change |
|---|---|---|---|---|---|
| 1 | `dynamicApi/evaluateApi?code=getactivecccontracts` | (none) | 500 SecurityException | **500 SecurityException** | unchanged — **still the blocker** |
| 2 | `contract/search/page` | ClientList | 200 | **200** | unchanged |
| 3 | `get-client-details ?type=CONTRACT_DETAILS` | ClientSummary | 200 | **200** | unchanged |
| 4 | `contract/liveinoutlogs/{id}` | ClientSummary | 200, 11 rows | **200, 11 rows** | unchanged |
| 5 | `directDebit/getActiveCptInfo/{id}` | ClientMgmtClientDirectDebits | 401 | **200** | **NOW OPEN** |

Endpoints 6–10 were not re-probed: #5 opening answers the payment-term question,
and the remaining four are verifier-evidence surfaces that do not gate the score.

Exact denial body for #1: `message: "Can't evaluate API - java.lang.SecurityException: Access denied."`,
`exception/rootException: java.lang.RuntimeException`, `path: /admin/dynamicApi/evaluateApi`.

## THE BLOCKER: the fallback path cannot build a cohort key

The cohort key is `nationality bucket × live-in/out`. On the fallback path:

| Cohort input | Surface | Status |
|---|---|---|
| live-out axis | `contract/search/page` → `liveOut` (boolean) | **free, inline** |
| contract start date | `contract/search/page` → `startOfContract` | **free, inline** |
| **maid nationality** | — | **NO CONFIRMED SURFACE** |

- `contract/search/page` → `housemaid` carries only `id`, `label`, `travelAssist`,
  `liveOut`. `housemaid.nationality` is **null on all 40 sampled rows**.
- `CONTRACT_DETAILS` has **no current-maid object at all**. The only nationality
  values anywhere in it are `replacements[].oldHousemaidNationality` /
  `newHousemaidNationality`.
- `getActiveCptInfo.nationality` is the **payment term's** nationality, not the
  maid's — proved by `cptName` provably containing the `nationality` value. That
  is the gate-15 comparison value; using it as the maid's nationality would
  destroy the very gate that detects a term priced for the wrong nationality.

**Consequence:** run today on the fallback path, every contract scores
`pending / Unpriceable / no_nationality` and ~5,392 contracts route to human
review. The check produces no findings and no clearances. Verified in
`n8n/score-node-body.js` — supplying the confirmed fields without nationality
yields exactly that; adding nationality yields `red / Under-priced` reproducing
the spec's gap figure.

The scorer does **not** guess a bucket. An unknown nationality would default to
"Other", the cheapest live-in bucket, and manufacture false clearances at scale.

**So the dynamic-API access request is the critical path, not an optimisation.**

Alternatives, if that grant stalls: find the maid-nationality surface via
ask-the-code or the ERP Variables DB (both currently unavailable to this
container), or derive from the last `replacements[].newHousemaidNationality` —
which only covers contracts that had a replacement and is therefore unfit as
the primary source.

## Probe-confirmed field paths (were guesses, now read off live 200s)

| Field | Path | Note |
|---|---|---|
| live_out | `search.liveOut` | agreed with `housemaid.liveOut` on 40/40 rows |
| contract_start_date | `search.startOfContract` | also `details.contractStartDate` |
| agreed_monthly_rate | `details.currentPayment.amountValue` | number |
| additional_discount | `details.paymentPlan.additionalDiscount` | **under paymentPlan, not top level** |
| credit_note_discount | `details.paymentPlan.creditNoteDiscount` | same |
| payment_term_nationality | `cpt.nationality` | flat string, separate call |
| live_in_out_logs | bare array; `date`, `oldValue`, `newValue` | as assumed |

## Corrections to file

1. **The handover says the fallback "does not carry `maidNationality` / `maidLiveOut`
   / `startDate` inline."** Two of those three ARE inline, under different names
   (`liveOut`, `startOfContract`). Only nationality is genuinely missing. The
   enrichment budget was costed against the wrong premise.
2. **The preflight workflow's note claiming the dynamic-API 500 is "a server-side
   SPEL fault, not access"** is wrong. The body is the documented
   `SecurityException: Access denied.` shape — it is an access denial.
3. **There is a FOURTH denial shape**, absent from the traps file:
   `401` + `developermessage: API_NOT_FOUND_FOR_PAGE` — the route is not
   registered for that pagecode, which is distinct from a missing permission.
   Only the `developermessage` header separates the two 401s.
4. **Population count is 5392 today** (`total` on `contract/search/page`), against
   the handover's ~5,283 and the 5,005/5,003 pair. The abort floor of 4,600 and
   warn band to 4,900 remain appropriate.
5. `getActiveCptInfo` is **open** — the ERP Variables row calling it working was
   right after all, though it was 401 yesterday. Permissions changed between the
   two runs, which is itself worth recording.
