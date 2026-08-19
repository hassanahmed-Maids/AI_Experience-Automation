# July 2026 audit — the first complete, corrected run

`JUL2026-FINAL`, 2026-08-19. Stage 1 → 8 chunks → Stage 3, ~2 hours, no crashes.
Executions 93582 → … → 94058 → 94074.

## Headline

**508 contracts were priced below the card during July 2026, AED 210,523.50 per
month.** That figure is an upper bound; the caveats below are part of the result,
not footnotes to it.

## Scope — 5,399 active CC contracts

| | |
|---|---|
| In scope for July | **4,548** |
| Out of scope | **851** |

Out of scope breaks down as `started_after_month_start` 795 and
`no_rate_for_month` 56. Out of scope is a third outcome: it is neither a pass nor
a finding, and it is excluded from every percentage below.

## Verdicts, as shares of IN-SCOPE

| Outcome | Count | % of in-scope |
|---|---|---|
| green | 2,717 | 59.7 |
| **red — under-priced** | **508** | **11.2** |
| above card — valid, not a finding | 671 | 14.8 |
| pending | 652 | 14.3 |
| **gap total** | **AED 210,523.50/month** | positive |

## Why these numbers can be trusted more than the previous run's

The run before this one (`JUL2026-FULL-05`) reported **1,259 reds and a gap of
MINUS 449,461**. A negative total is impossible when summing only under-priced
contracts, and that impossibility is what exposed the bug: the red gate fired
whenever every rate test failed, without ever checking `actual < expected`.

**Two independent routes now agree on 508 / 210,523.50:**

1. the corrected scorer, re-run end to end from ERP
2. a manual split of the previous run's findings tab by the sign of `gap_aed`

The 751 mislabelled over-payers in that run are the 671 `above_card` here; the
difference is chunk boundaries and five contracts created during the day.

Provenance, all asserted in-run rather than assumed:

- population reconciled against an independent count from a different route
- price card checksum: 49 windows across 5 cohorts
- 1 run row + 1,831 finding rows written **and read back** from the spreadsheet
- the new guard confirming the gap total is not negative

## What improved between the two runs

`details unreadable` went **1 → 0** while pending rose **571 → 652**. That is the
retry logic working: transient ERP failures are now retried three times instead
of being recorded as an unreadable-pending, so a wobbling ERP costs runtime
rather than silently degrading the result.

## Why 508 is an UPPER bound

Every one of these is declared in the run row:

- `upgrading_nationality` is unimplemented and scored NOT PASSED — it can only
  ever clear a contract, never create a finding
- the payment-term-nationality gate never fired, because that surface is unread
- 229 contracts have no maid nationality recorded
- `paymentsInfo` did not parse on 67 contracts
- **the nationality-bucket problem cuts both ways.** The card collapses every
  nationality except Filipina and Ethiopian into one "Other" price. Where ERP
  prices a nationality BELOW that bucket — Cameroonian at 2,100 against the
  bucket's 3,129 — a correctly-priced contract lands in the 508. See
  `erp-price-matrix-mapping.md`.

## Attribution

Run on a colleague's token (`Abdullaha`); ERP logs ~11,000 reads under that id
and the run records `acting_user`. **This is not evidence that the audit account
has the grant** — `getactivecccontracts` and `salesPaymentTermsConfig` both
return `INSUFFICIENT_PERMISSIONS` for Hassan.Ahmed and remain outstanding.

## Still open

1. the two ERP grants above
2. the Ethiopian card divergence — card 3,129 vs ERP 2,919, unattributable
   without a last-modified field
3. wiring in the tested ERP cross-check (built, 20 assertions, not yet in Stage 1)
4. the verifier, which would work the 652 pendings and the residue of the 508
