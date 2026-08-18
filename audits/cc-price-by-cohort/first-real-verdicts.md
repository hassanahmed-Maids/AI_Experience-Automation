# First real verdicts — and why 9 of them are false, 2026-08-18

Run `SMOKE-dynapi-02`, executions 92527 → 92528 → 92529, all success.
The full chain worked end to end on the dynamic API for the first time.

```
overall            HALTED EARLY (chunk.max_chunks = 1, by design)
green 1 | red 9 | pending 0 | review 9
cases_scored       10
population_count   5402
gap_total_aed      20,751.50
nationality_source {"baton": 10}   ← all ten resolved, zero pendings
```

**Nationality is solved.** Every contract got a real cohort. The `pending` column
is zero for the first time.

## The 9 reds are pro-rated first payments, not findings

Every contract in the sample started **2026-08-18**. August has 31 days; the 18th
to the 31st inclusive is **14 days**, and `14/31 = 0.45161`.

| contract | cohort | actual | card | ratio | card × 14/31 | diff |
|---|---|---|---|---|---|---|
| 1103075 | liveout:Filipina | 2580 | 5712.0 | 0.4517 | 2579.6 | **+0.4** |
| 1103073 | livein:Filipina | 2129 | 4714.5 | 0.4516 | 2129.1 | **−0.1** |
| 1103072 | livein:Other | 1413 | 3129.0 | 0.4516 | 1413.1 | **−0.1** |
| 1103070 | livein:Other | 1413 | 3129.0 | 0.4516 | 1413.1 | **−0.1** |
| 1103067 | livein:Filipina | 2129 | 4714.5 | 0.4516 | 2129.1 | **−0.1** |
| 1103066 | liveout:Filipina | 2580 | 5712.0 | 0.4517 | 2579.6 | **+0.4** |
| 1103060 | liveout:Other | 1864 | 4126.5 | 0.4517 | 1863.6 | **+0.4** |
| 1103074 | livein:Ethiopian | 1318 | 3129.0 | 0.4212 | 1413.1 | −95.1 |
| 1103068 | livein:Ethiopian | 1318 | 3129.0 | 0.4212 | 1413.1 | −95.1 |
| 1103069 | livein:Filipina | 4715 | 4714.5 | 1.0001 | — | GREEN, full month |

Seven of nine land within **0.4 AED** of the pro-rata formula. The nine ratios
span 3 percentage points; nine independent underpayments would scatter widely.

`currentPayment.amountValue` is the **current period's** payment, and for a
contract signed mid-month that is the pro-rated remainder — not the monthly rate
the price card is denominated in.

### The two Ethiopian rows do not fit and are unexplained

Both sit 95 AED below the pro-rata figure (ratio 0.4212, not 0.4516). Could be a
different day-count basis, a discount, or a genuinely different card price for
that cohort. **Not resolved — do not assume they are pro-rating too.**

## What this means

**`pro_rated` is no longer a documentation footnote. It is the difference between
a usable check and one that accuses almost everyone who started recently.** On
this sample the check would produce a 90% false-positive rate.

The honest-accounting field did its job exactly as designed:
`unimplemented_tests_inflation: 9` — every one of the nine non-green verdicts was
flagged as potentially clearable by an unimplemented test. Anyone reading the run
summary was told not to act on them. That field earned its place today.

## Sampling bias worth fixing — and worth being glad about

The dynamic API returns contracts in **descending contractId**, so page 0 is the
newest contracts. A 10-row smoke test therefore samples exactly the population
most likely to be mid-month pro-rated — the worst possible sample for a check
whose pro-rating test is missing.

That bias is why this surfaced on the first real run rather than in production.
Future smoke tests should sample the middle of the population as well, but the
newest slice should stay in the mix precisely because it is the hostile case.

## Before this check reports anything

1. **Implement `pro_rated`.** Empirically the first-period payment is
   `card × remaining_days_in_month / days_in_month`, counting the start day.
   Confirm against ERP rather than curve-fitting these ten rows.
2. **Explain the two Ethiopian rows**, or the formula is incomplete.
3. **Then re-run** on a mixed sample — some new, some old — and expect the red
   count to collapse.

Until 1 and 2 are done, every red on a recently started contract should be read
as "probably pro-rated", and the check is only trustworthy on contracts that have
been running a full month or more.
