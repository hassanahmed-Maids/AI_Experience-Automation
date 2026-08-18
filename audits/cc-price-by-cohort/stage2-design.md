# Stage 2 — Enrich + Score (`bBYbpHcWMWybDQxN`, draft)

Chain: Stage 1 `7j5Z5KPvBcWRPfvy` → Stage 2 `bBYbpHcWMWybDQxN` → (Stage 3 pending).
Both draft, neither published.

## Shape

```
Receive Baton (passthrough)
  → Explode Contracts        slices ONE chunk of the population
  → Batch of 5 ──loop──▶ Get Contract Details → Get LiveInOut Logs
                          → Resolve Nationality → Score Batch
                          → Write Cases → Pace 500ms ──back to Batch
       └──done──▶ Stage 2 Complete → More Chunks?
                                      ├─ yes → Launch Next Chunk (no wait)
                                      └─ no  → Run Complete (asserts completeness)
```

## Why it is chunked

Measured ERP latency, 5 samples each: `get-client-details` **1.71 s** mean,
`liveinoutlogs` **1.15 s** mean. At the 5-concurrent / 500 ms rate law that is
**~4.36 s per batch of five**, so 5,392 contracts = 1,079 batches ≈ **78 minutes**.

This n8n instance refuses any `executionTimeout` above **2400 s (40 min)**. A
single-execution Stage 2 would therefore have been killed around contract 2,700
with no completion signal — the failure mode being a run that *looks* finished
and silently covers half the population.

So Stage 2 processes **1,500 contracts per execution** (~22 min, comfortable
headroom) and fires the next chunk **without waiting**, giving each chunk a
fresh 2400 s budget. 5,392 contracts = 4 chunks.

Two independent protections against a partial answer:

1. **Cases are written per batch**, not at the end. A killed execution still
   leaves every contract it scored persisted in the Cases table.
2. **`Run Complete` throws** unless `cumulative_processed === population_count`.
   A short run fails loudly rather than handing Stage 3 a subset.

Stage 1's `Population Guard` was hardened the same way: any short read against
the route's own `total` now aborts **unconditionally**, and `warn_only` can no
longer suppress it — it only softens the low-population warn band. The page
ceiling went from 200 pages (8,000 contracts) to 2,000 as a runaway backstop.

## The pluggable nationality node

`Resolve Nationality` holds one constant:

```js
const SOURCE = "unavailable";
```

| Value | Behaviour |
|---|---|
| `unavailable` *(current)* | yields `null` → every contract routes to a human via `no_nationality` |
| `baton` | reads `maid_nationality` off the Stage 1 row — correct once the dynamic API is granted |
| `search_page` | reads `housemaid.nationality` if it ever starts populating |

**`getActiveCptInfo.nationality` is deliberately not an option.** That is the
*payment term's* nationality — `cptName` provably contains it. Wiring it here
would make the `payment_term_nationality_mismatch` gate compare a value with
itself and never fire, destroying the gate that catches a term priced for the
wrong nationality.

Flipping `SOURCE` is the whole change once a surface is authorised.

## Field paths (probe-confirmed 2026-08-18)

| Field | Source |
|---|---|
| `live_out` | Stage 1 row `liveOut`, falling back to `details.liveOut` |
| `contract_start_date` | Stage 1 row `startOfContract`, falling back to `details.contractStartDate` |
| `agreed_monthly_rate` | `details.currentPayment.amountValue` |
| `additional_discount` | `details.paymentPlan.additionalDiscount` |
| `credit_note_discount` | `details.paymentPlan.creditNoteDiscount` |
| live-in/out logs | bare array, `date` / `oldValue` / `newValue` |

## Deliberate omissions

- **`client_name` is left unpopulated.** The Cases table has the column, but
  surfacing personal data is not authorised. Contract and client IDs are enough
  to act on a case.
- Both HTTP nodes use `neverError` + `fullResponse`, so a per-contract failure
  records `details_unreadable_<status>` and routes to a human instead of
  aborting the chunk or silently scoring on an empty payload.
- `payment_term_nationality_mismatch` is hard-`false` and
  `payment_term_surface_unavailable` hard-`true` until the CPT call is wired in;
  the gate is declared unavailable rather than quietly passing.
