# The rate field is wrong — `currentPayment` is not the monthly rate

2026-08-18. Supersedes the pro-rating explanation in `first-real-verdicts.md`.
That reading was half right and led somewhere better.

## The evidence

Contract 1103073 (livein:Filipina, started today), scored `red` at 2129 against a
card price of 4714.5 — a claimed 2585.50 AED/month shortfall.

```
currentPayment            {'amount': 'AED 2,129', 'amountValue': 2129.0}
paymentPlan.paymentsInfo  [
  'Service Fees: 2027 + 102 VAT, on Today (One Time Payment)',
  'Service Fees: 3990 + 200 VAT, on Sep 01 2026 (Monthly (for 2 months))',
  'Service Fees: 4490 + 225 VAT, on Nov 01 2026 (Monthly)'
]
```

- 2027 + 102 = **2129** — exactly `currentPayment.amountValue`, and it is a
  **One Time Payment**, not a monthly rate.
- 3990 + 200 = **4190/month** for two months (an introductory rate).
- 4490 + 225 = **4715/month** from Nov 2026 — the steady-state rate.
- Card price for livein:Filipina today: **4714.5**.

**The contract is priced correctly.** The steady-state monthly rate matches the
card to within 0.5 AED. There was never a 2585.50 shortfall.

## What this means

`currentPayment.amountValue` is *whatever period happens to be current* — a
one-time joining fee, an introductory rate, or the steady-state monthly. It only
coincides with the monthly rate on simple single-entry plans, which is why the
established contract looked fine:

```
contract 1005750, started 2020-06-10
currentPayment.amountValue  4301.0
paymentsInfo                ['Service Fees: 4096 + 205 VAT, on Jun 10 2020 (Monthly)']
```

One entry, labelled Monthly, 4096 + 205 = 4301. Agreement there is a coincidence
of plan shape, not evidence the field is right.

**The real monthly rate lives in `paymentPlan.paymentsInfo`** — a list of
human-readable strings carrying amount, VAT, effective date, and a frequency
label. It is the only place a plan's structure is visible.

`nextMonthlyPaymentAmount` is **not** the answer either: empty string on both the
new and the established contract. That hypothesis is dead.

## Required change

Parse `paymentsInfo` into structured entries and select the monthly rate, rather
than reading `currentPayment.amountValue`:

| Entry label | Treatment |
|---|---|
| `One Time Payment` | **ignore** — joining or pro-rated period, never the rate |
| `Monthly (for N months)` | an introductory rate, effective from its date for N months |
| `Monthly` | the steady-state rate |

Amount = the two numbers summed (service fee + VAT), matching how the card is
denominated (minimum monthly payment **+ VAT**).

If no `Monthly` entry can be parsed → `pending / no_monthly_rate`, routed to a
human. Never fall back to `currentPayment`.

## RESOLVED 2026-08-19 — the rate in effect during the audit month

A stepped plan has more than one monthly rate. Which does the check test?

1. **Steady-state** (the final `Monthly` entry, 4715 here) — the contract ends up
   at card price, so it passes. Introductory discounts are invisible to the check.
2. **In effect at the run date** — today that is the One Time Payment period, so
   most new contracts become unpriceable rather than scored.
3. **Every monthly entry** — the intro rate (4190 vs 4714.5) is a real, if
   temporary, discount and would be flagged.

These give materially different answers on the same contract. Option 1 says
"priced correctly"; option 3 says "under-priced by 524.50/month for two months".

**The spec owner chose option 3, scoped to a month** (2026-08-19): the check
tests the rate in effect during the audit month, whichever rate that is. On this
contract September and October are reported as under-priced by 524.50 and
November onward is green. An approved promotion is cleared by a human on review,
not exempted from measurement — the check errs toward showing rather than hiding.

Month-scoping is what makes that answerable: there is exactly one applicable
rate per month, so nothing has to be chosen. Where a month genuinely has two
covering monthly entries the scorer still refuses to pick and routes to a human
with the entries attached (`multiple_rates_in_month`), and a time-bounded rate
carries the flag `bounded_rate_period` so the reviewer sees why the figure sits
below card. Implemented in `scorer-month.js`; see `design-month-scoped-audit.md`.

## How common are stepped plans?

Unknown, and worth measuring before choosing. One query over the population's
`paymentsInfo` entry counts would size the problem — if stepped plans are rare
the decision is low-stakes; if they are the norm for new contracts it changes the
check's headline numbers.

## Status of the earlier reds

All nine reds from `SMOKE-dynapi-02` are **withdrawn**. They compared a one-time
or introductory payment against a monthly card price. The AED 20,751.50 figure is
not a finding and must not be reported.

The two Ethiopian outliers that did not fit the pro-rata formula are explained by
this too: their plans simply have different entry structures. No date arithmetic
was ever needed.
