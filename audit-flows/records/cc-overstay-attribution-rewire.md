# CC Overstay Fines — rewired to the filtered call (2026-08-30)

Workflow `3465kkSf4JYjlpXk`. Identity now arrives with the population. `Get Transaction Detail` —
one ERP call per over-base transaction, purely to learn which maid a transaction belonged to — is
deleted, along with its `Judge Detail Batch` breaker.

## What changed

| Node | Change |
|---|---|
| `Get CC Change of Status Transactions` | route `advancesearchNew` → legacy `advancesearch`; filter `expense.name =` → **`expense.id = 1589`** |
| `Verify Cohort Pull` | carries `housemaids` into `cohort_rows`; **new gate (d)**, the attribution-present guard |
| `Split Transactions` | carries `housemaids` onto each case (and onto unreadable-amount rows) |
| `Attach Identity` | reads the link off the case row instead of an HTTP response; gate-3 contract unchanged |
| `ERP Budget Gate` | `ERP_CALLS_PER_TRANSACTION` **3 → 2**; now sits before `Attach Identity` |
| `Get Transaction Detail`, `Judge Detail Batch` | **deleted** |
| Sticky note 2 · Cohort | rewritten to the new route, with the reason and the measurements |

67 nodes → 65. No dangling connections; no reference to `AddEditTransaction` remains anywhere in
the workflow.

## Verified before changing anything

The filter swap had to not move the population. Probed live:

| Filter | All-time | Apr–Aug 2026 |
|---|---|---|
| `expense.name = "NEW - CC Housemaids - Change of Status Application"` (what the flow did) | 1084 | 694 |
| `expense.id = 1589` (what it does now) | 1084 | 694 |

`expense.id` is also the more robust of the two — see the searchable-vs-projected name trap in
`erp-attribution-solved.md`. `date` `between` + `secondValue` was confirmed to work on the legacy
route and to agree exactly with a `>=`/`<=` pair (27,579 both ways on a five-day window).

## The new gate (d), and why it exists

`advancesearchNew` returns rows identical to `advancesearch` in **every field this flow reads except
`housemaids`**, which it omits. If anyone repoints the URL back, gates (a) pagination, (b) empty and
(c) foreign-expense all still pass, every case then fails gate 3, and the run reports a clean month
it never audited. Gate (d) aborts when *not one* cohort row carries attribution. It deliberately
does not throw on a partial shortfall — a single unlinked transaction is a real data condition, and
gate 3 already routes it to review. `population.rows_with_attribution` is published either way.

## Live run — execution 110371, window 2026-07-01…2026-07-31

```
cohort_count            58        (matches the 2026-08-12 nine-month measurement: "Jul 58")
population_complete     true
rows_with_attribution   58
rows_without_attribution 0
excluded_at_or_below_base 53
txns_with_overstay       5
Attach Identity          identity_resolved on every case, 0 unresolved
```

**58 of 58 rows carried attribution, and identity cost zero ERP calls.** The old path would have
spent 5 detail calls to reach the same point on this window.

## The run still fails — on a different endpoint, and it is not this change

`Judge Fines Batch` tripped the breaker on **total refusal** from
`GET /visa/overstay-fines/housemaid/{id}`. That is one of the four endpoints already recorded as
untested, and it is unrelated to the rewire: the run reached it only *because* identity resolved.

Probed directly, the refusal is a permission problem, not a token problem:

| pageCode tried | `developerMessage` |
|---|---|
| `OverstayFines` | `PAGE_NOT_FOUND` — no such page code |
| `ManageTransactions` | `API_NOT_FOUND_FOR_PAGE` — page exists, this API is not whitelisted under it |
| `HousemaidProfile` | `PAGE_NOT_FOUND` |

The same method that solved attribution applies: ask the code which pageCode whitelists that route,
then check it against what the audit user already holds before requesting any grant. Not yet done.

## Still open

- The fines endpoint above, and the three other untested CC Overstay endpoints (loans, complaints,
  complaint threads) — the breaker has still never reached them.
- The deploy draft for this check names `advancesearchNew`; it must be regenerated from the flow as
  it now stands before posting.
