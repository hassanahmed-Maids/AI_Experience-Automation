# Can the price card come from ERP? — asked and answered, 2026-08-19

**Short answer: partly. ERP holds a price card, but it is NOT historised, so ERP
cannot answer "what was the published price in July 2026".**

## What the spec said, and why that was not the end of it

`standard_price_card` states plainly:

> **API Link:** NOT AN ERP ENDPOINT. Drive file 'Price trends.xlsx' …

with `ERP Field Link` and `pagecode` both empty and `ERP Value Status: Confirmed`.

That is a clear statement about the route the check *uses*, not evidence that ERP
holds no price table anywhere — the author may simply never have looked. So the
code was asked.

## Asked the code twice, independently

Two sessions, per the module-visibility hazard in `docs/code-llm-api.md` (a
pinned session has twice returned a confident "doesn't exist" for a module it
could not see):

| Session | Scope |
|---|---|
| 44266 | pinned: client-management, prospects, accounting, admin |
| 44267 | all modules |

**They agree, with citations.** Both were told that "ERP has no historised price
card" would be a valid answer and not to point at an approximation.

## What ERP actually has

A **current-value price template**, not a dated card:

- **`PaymentTermConfig`** extends **`AbstractPaymentTerm`** (`magnamedia-prospects/.../entity/`),
  keyed on `nationality` (FK PicklistItem), `contractProspectType` (CC vs MV),
  `type` (`PaymentTermConfigType`, `LIVE_OUT` marks live-out), `packageType`,
  `ccPackageType` (MONTHLY / WEEKLY / LONG_TERM), plus `liveOutAmount`,
  `weeklyAmount`, `dailyRateAmount`.
- The money sits on child **`PaymentTypeConfig`** rows (`AbstractPaymentTypeConfig.amount`,
  line 45), one per fee component; the monthly fee is the child with code
  `monthly_payment`, read via `AbstractPaymentTerm.getMonthlyPayment()` (lines 87-90).
- Resolved by `PaymentTermConfigRepository.findSuitableConfig(...)`
  (`PaymentTermConfigRepository.java` 46-99), filtered `isDefault = true` and
  `disabled = false` — **it returns the current default row only**.
- At contract creation the template is **snapshotted onto the contract** by
  `ContractPaymentTerm.setPaymentTermConfig(...)` (lines 183-236), copying each
  `PaymentTypeConfig` into per-contract `ContractPaymentType` rows. Later template
  edits do not touch signed contracts.

So the cohort key this check uses — nationality × live-in/out — is exactly how ERP
keys its own pricing. That part lines up.

## The part that does not exist

**No dated validity anywhere.** Both sessions searched for
`effectiveFrom` / `effectiveTo` / `validFrom` / `validTo` on `AbstractPaymentTerm`,
`PaymentTermConfig`, `AbstractPaymentTypeConfig`, `PaymentTypeConfig` — nothing,
and no `@Audited` / version / history table. `updatePaymentTermConfig`
(`PaymentTermConfigController.java` 309-326) **saves over the existing record**.
A workspace-wide entity scan for `PriceList` / `Tariff` / `RateCard` /
`PricingMatrix` / `PriceHistory` / `PricePlan` found none.

`ClonedPaymentTermConfig` is not a history: it copies values with no dates, to
freeze a config against later edits.

`startsOn` / `endsAfter` / `recurrence` on `AbstractPaymentTypeConfig` (53-60) are
**month offsets inside a contract's lifecycle** — which month a charge starts —
not calendar validity windows for the price. Easy to mistake for what we need.

## Endpoints, for whichever option is chosen

Base `/paymenttermconfig`, pagecode `paymenttermconfig`:

| Endpoint | Use |
|---|---|
| `GET /paymenttermconfig/findsuitableconfigforcontract/{contractId}?nationality=&isLiveOut=&planType=&cptId=` | **the audit-friendly one** — permissionless, `@ApiCacheable`, already used by n8n; returns `{nationality, ccType (Live-in/Live-out), contractType, amount}` |
| `GET /paymenttermconfig/getconfigs?nationalityIds=&contractProspectTypeId=&type=&packageType=&isDefault=&…` | browse the whole matrix; needs `hasPermission('paymenttermconfig','getConfigs')` |
| `GET /paymenttermconfig/findsuitableconfig/{nationalityId}/{contractProspectTypeId}/{type}?packageType=` | resolve one default config |

Both return **today's** value. Neither takes a month.

### PROBED, AND THE ROUTES ARE NOT REACHABLE AT ALL — 2026-08-19

`/paymenttermconfig/*` answers **403 from `server: awselb/2.0`** — an HTML body,
not ERP's `SecurityException` JSON — which means the request is refused at the
**edge**, before it reaches the application, so it is not a permission problem
that a grant could fix.

Tested from **two independent egress paths** with the same valid token:

| From | Result |
|---|---|
| shell in the build environment | 403 `awselb/2.0` |
| n8n cloud (workflow `0oB2SX1nN2D3nyIE`, execution 93373) | **403 `awselb/2.0` on 11 of 11 probes** |

The n8n probe covered all five cohorts against **two unrelated contract ids**
(1005750 and 1103069) plus `getconfigs`. Every one returned 403.
`cohorts_answered: 0`.

That n8n reaches ERP fine on `/clientmgmt/*`, `/admin/dynamicApi/*` and
`/lowcode/c2d/*` in the same runs rules out an egress or token problem. The
`/paymenttermconfig/*` family simply is not exposed publicly.

**So the cross-check cannot be built against these endpoints.** The probe also
answered a question it no longer matters to have answered: whether
`findsuitableconfigforcontract` is cohort-keyed or contract-keyed is untestable
while the route is closed.

## What this means for the check

| Needs | ERP can supply? |
|---|---|
| The current published price per cohort | **Yes** |
| The published price for a named past month | **No** — only today's template value |
| The 49 dated windows the grandfathering test compares against | **No** |

Two consequences worth being blunt about:

1. **Sourcing the audit-month price from ERP would silently stop being
   reproducible.** Re-running July's audit after a price change would score it
   against the new price. The whole point of month-scoping was that July's audit
   gives July's answer whenever it runs.
2. **The grandfathering test would die.** `any_historic_price` needs the dated
   window history; on the spec's own measurement it alone clears **154**
   contracts, and dropping it takes the flag count from ~172 to ~465 against a
   true ~10. That is not a degradation, it is a broken check.

## The part of this that IS worth taking from ERP

**A staleness cross-check, which closes the biggest named risk on the spec page.**
The card's own `Traps` field records the owner's warning that there might be
"unregistered later prices", and the final window of each cohort is open-ended
(`=TODAY()`). Nothing currently detects the sheet going stale.

ERP's current default per cohort is exactly the right thing to compare the
sheet's current window against:

- equal → the card's leading edge is confirmed against the system of record
- different → the sheet is stale, or ERP was repriced without the sheet being
  updated. **Stop the run** rather than audit 5,393 contracts against a stale card.

This is pure gain: it adds an ERP-sourced assertion without removing the dated
history only the sheet has.

## If ERP is to become the sole source

It needs a new historised entity — effective-from / effective-to per cohort price,
written on every reprice. That is an ERP change request, not a flow change, and it
would only start accumulating history from the day it ships; the 49 windows back
to 1970 would still have to be seeded from the sheet.
