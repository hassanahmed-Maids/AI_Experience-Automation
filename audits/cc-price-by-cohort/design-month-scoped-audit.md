# Design change: scope the check to an audit MONTH

Status: proposed, not built. Supersedes task #11 ("implement pro_rated").

Today the check asks *"is this contract priced correctly right now?"* and reads
whatever payment happens to be current. That framing is the root of every
scoring problem found on 2026-08-18. Re-scoping it to *"was this contract priced
correctly during month M?"* dissolves most of them and makes runs reproducible.

## The parameter

```
params.audit_month = "YYYY-MM"    default: the last COMPLETED calendar month
```

The current month is never a valid default. On 18 August you cannot say whether
August was billed correctly — the month has not finished. A run with no
`audit_month` audits **July**.

Everything else in the check resolves *as of* that month rather than as of now.

## What changes, stage by stage

### Stage 1 — the card is read as of the audit month

Card price for cohort C in month M = the window covering **the first day of M**.

If a card window boundary falls **inside** M, that cohort had two prices that
month. Flag `card_changed_mid_month` and route affected contracts to a human
rather than picking one. Do not average.

This also kills the `=TODAY()` problem: the trailing window's moving end date
stops mattering, because M is always in the past and covered by a settled
window. Re-running July's audit in December gives July's answer.

### Stage 1 — scope, computed from data already on the population payload

A contract is **in scope** for month M when both hold:

- it was active for the whole of M — `startDate` on or before the first day of
  M, and no termination (`dateOfTermination` / `scheduledDateOfTermination`)
  before the last day of M
- a monthly rate entry covers M (see below)

Otherwise it is **out of scope**, with a reason. Out of scope is a *third*
outcome, not a pending and not a finding, and it must not inflate the denominator
that green/red/pending are measured against.

A contract that started mid-M is simply not audited for M; it enters the
population for M+1. **This removes the brand-new-contract problem without
pro-rating and without a special gate** — no date arithmetic, no inferred rate.

### Stage 2 — the rate comes from `paymentsInfo`, selected for M

Stop reading `currentPayment.amountValue`. Parse `paymentPlan.paymentsInfo`
entries, each of the shape:

```
'Service Fees: 4490 + 225 VAT, on Nov 01 2026 (Monthly)'
'Service Fees: 3990 + 200 VAT, on Sep 01 2026 (Monthly (for 2 months))'
'Service Fees: 2027 + 102 VAT, on Today (One Time Payment)'
```

| Field | Rule |
|---|---|
| amount | the two numbers **summed** (fee + VAT) — the card is denominated inc. VAT |
| effective from | the date in the entry |
| frequency | the parenthesised label |
| duration | `(for N months)` bounds the entry; otherwise it runs until the next entry |

- `One Time Payment` entries are **ignored entirely** — joining fees and
  pro-rated periods are not rates.
- Applicable rate for M = the monthly entry whose effective range covers M.
- **No entry covers M** → out of scope (`no_rate_for_month`).
- **More than one covers M** → `multiple_rates_in_month`, route to a human with
  the entries attached. Never pick.
- **Nothing parses** → `pending / rate_unreadable`. Never fall back to
  `currentPayment`.

Parsing a human-readable string is unpleasant and should be treated as
load-bearing: any entry that does not match the expected shape is a parse
failure routed to a human, never a silently skipped line.

### Stage 3 — report scope honestly

The run summary gains `in_scope`, `out_of_scope`, and a breakdown of
out-of-scope reasons. `green / red / pending` are percentages **of in-scope**,
and the summary states the audit month prominently. A reader must not be able to
mistake "5,000 contracts out of scope for July" for "5,000 contracts clean".

## What this fixes

| Problem | How |
|---|---|
| 9 false reds from joining payments | one-time entries ignored; those contracts out of scope for the month |
| pro-rating (task #11) | not needed — partial months are never audited |
| the two unexplained Ethiopian outliers | different plan shapes, resolved by parsing entries rather than fitting a formula |
| `=TODAY()` card drift | M is always a settled past month |
| runs not reproducible | July's audit gives the same answer whenever it is run |
| "which of a stepped plan's rates" | the one in effect during M |

## What it does NOT fix

**An approved introductory rate below card still gets flagged.** The example
contract pays 4,190 in September against a card price of 4,714.50, so September's
audit would call it under-priced by 524.50.

I think that is correct behaviour — the check reports what was true that month
and a human clears approved promotions through the existing `needs_human` path,
exactly as it handles living-switches. But it is a policy call, not a data one,
and it is the one question that still needs the spec owner.

It is a much narrower question than before: not *"which rate do we test"* but
*"should an approved intro discount be flagged in the month it applies?"*

## Implementation checklist

1. `Validate Inputs` — accept `audit_month`, default to last completed month,
   reject a month that has not finished.
2. `Parse + Assert Card` — resolve each cohort's price as of the first of M;
   detect a mid-month boundary and mark the cohort.
3. `Population Guard` — compute in-scope/out-of-scope from `startDate` and the
   termination fields; carry the scope reason on each contract.
4. `Score Batch` — replace `currentPayment.amountValue` with a `paymentsInfo`
   parser and month selection; add `multiple_rates_in_month`,
   `rate_unreadable`, `no_rate_for_month`.
5. `scorer.js` + the assertion harness — port the same logic and add cases for
   stepped plans, one-time-only plans, mid-month card changes, and contracts
   starting mid-month.
6. Stage 3 — scope reporting, percentages of in-scope, audit month in the
   headline.

Order matters: 5 before 4. The harness is where this logic gets proven, and it
runs in a second with no ERP access — the reason the scorer's gate order survived
today intact while everything touching live payloads needed three attempts.

## Measurement worth taking first

How common are stepped plans, and how many contracts have no monthly entry
covering a given past month? One pass over `paymentsInfo` for a sample would
size both, and tells us whether this is an edge case or the norm before any of
the above is built.
