# Stage 2 — Enrich + Score (`bBYbpHcWMWybDQxN`, draft)

Chain: Stage 1 `7j5Z5KPvBcWRPfvy` → Stage 2 `bBYbpHcWMWybDQxN` → (Stage 3 pending).
Both draft, neither published.

## Shape

```
Receive Baton (passthrough)
  → Explode Contracts        slices ONE chunk of the population
  → Batch of 5 ──loop──▶ Get Contract Details → Get LiveInOut Logs
                          → Get Active CPT → Assemble Contract Payload
                          → Score Batch → Write Cases → Pace 500ms ──back to Batch
       └──done──▶ Stage 2 Complete → More Chunks?
                                      ├─ yes → Launch Next Chunk (no wait)
                                      └─ no  → Run Complete (asserts completeness)
```

## Why it is chunked

Measured ERP latency, 5 samples each: `get-client-details` **1.71 s** mean,
`liveinoutlogs` **1.15 s** mean, `getActiveCptInfo` **0.81 s** mean. At the
5-concurrent / 500 ms rate law that is **~5.17 s per batch of five** in theory.

**Measured end to end it is worse than that.** The 2026-08-19 smoke did 60
contracts in 107 s — 1.78 s per contract, or ~8.9 s per batch of five, once
`Write Cases` and the 500 ms pace are counted. Chunk sizing follows the measured
number, not the theoretical one.

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

## Nationality — resolved in the scorer, not in a node

**Superseded 2026-08-19.** This section used to describe a `Resolve Nationality`
node with a pluggable `SOURCE` constant, and asserted that
`getActiveCptInfo.nationality` was "deliberately not an option" because it is the
*payment term's* nationality and `cptName` "provably contains it".

**That claim was wrong on both counts, and it was blocking the fix.**

- LCP says the endpoint returns `cpt.getHousemaid().getNationality().getName()` —
  the maid's nationality, not the term's FK. Verified against 14 contracts that
  have a maid: it agreed with the dynamic API 14 / 14.
- `cptName` does not contain the nationality reliably. Contract 1099770 reports
  nationality `Ethiopian` under cptName `CC - Default - Kenyan -OMG`.

The node is now **`Assemble Contract Payload`**: it collects the three ERP
payloads and decides nothing. Resolution lives in `resolveNationality()` in
`scorer-month.js`, where assertions cover it — live maid first, active payment
term second, `no_nationality` pending third. Full reasoning and the population
evidence: `erp-nationality-fallback.md`.

The self-comparison concern was real and survives as an explicit guard: when the
nationality itself came from the term, `upgrading_nationality` is declared
untestable rather than allowed to compare a value with itself.

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
- The `payment_term_nationality_mismatch` gate still wants the term's OWN
  `NATIONALITY_ID`, which is exposed only on
  `/accounting/contractpaymentterm/getcontractpaymentterminfo` — 401 on this
  account (`erp-401-pagecodes.md`). It stays declared-unavailable rather than
  being quietly satisfied by the `upgrading_nationality` test, which answers a
  related but not identical question off a field we can actually read.
