# Ask-the-code: is there a route to transaction→housemaid attribution that avoids `AddEditTransaction`?

**Date:** 2026-08-30 · **Session:** `45316` · **Module pinned:** `erp/magnamedia-accounting`

## Why we asked

`GET /accounting/transactions/{id}` (pageCode **`AddEditTransaction`**) is Restricted for our user.
Six GET nodes across five checks call it, purely to read `housemaids[]` and attribute a charge to a
maid. Attribution by parsing the description name is banned — `overstay_txn_maid_id` records why.

## The answer, with its citations

**1. The search endpoint cannot do it.** `TransactionsController.advanceSearchAcc7274` (1516–1522)
→ `QueryService.manageTransactionsAdvanceSearch` (2161) projects into `TransactionsSearchDto` via
the JPQL constructor at `QueryService.getQueryTransaction` (1780–1808). The select list has no
housemaid field, **no request flag or projection toggle adds one**, and the join clause (1796–1802)
never joins `HousemaidTransaction`. Client identity exists only through payment→contract→client
(1791–1792), which is *not* the housemaid link.

**2. There IS another route, under a different permission.**

| | |
|---|---|
| Controller | `HousemaidTransactionController`, `@RequestMapping("/housemaidtransactions")` (line 36) |
| Route | `POST /housemaidtransactions/page/advancesearch` (`advanceSearch`, 51–55) |
| Permission | `@PreAuthorize("hasPermission('transactions','advancesearch')")` (line 51) — **not `AddEditTransaction`** |
| Returns | `HousemaidTransactionProjection` (96–99), which exposes `housemaids: target.getTransaction().getHousemaids()` plus transaction id and contractId (`HousemaidTransactionProjection.java` 13–46) |
| Batching | accepts a `List<FilterItem>` (line 56), so a filter on `transaction.id` `in` a list returns links for many transactions in ONE call |

**3. The restriction is per-endpoint, not per-controller.** `TransactionsController` has no
class-level `@PreAuthorize` (63–66); each secured method carries its own. The `get(Long id)`
override (122–129) has no annotation — its `AddEditTransaction` restriction comes through the
page-code→permission layer driven by `@Searchable(permissionCode = "ManageTransactions")` on
`Transaction` (`Transaction.java` line 57). **So restricting `AddEditTransaction` blocks only the
detail read and leaves the sibling endpoints usable.**

**4. No dedicated bulk id→housemaid route.** The `List<Long>` endpoints on `TransactionsController`
are all writes (`markListAsDoneByCooAPI` 1372, `addTransactionForPayment` 1624,
`addAttachmentToTransactionsFromPayments` 1642). `HousemaidTransactionRepository.findByTransaction`
(line 24) is single-transaction; there is no `findByTransactionIdIn`. The batching comes from the
`advancesearch` filter, not a bespoke route.

## What this changes

**The access request may be unnecessary.** There is a supported read path to the same data under
`transactions/advancesearch` — a permission the audit plausibly already holds, since the population
call under `ManageTransactions` works today. *That needs confirming before the request is dropped.*

**It is also the better design.** It collapses N per-transaction detail calls into batched searches.
That is a direct ERP-load win on the exact axis the budget gate polices — CC Overstay's gate
projects worst-case per-entity calls and has refused runs over it before.

## ⚠ But it lands on a route that is already banned

`housemaidtransactions advancesearch` is **§A2 of `NO_NONPAGE_ALTERNATIVE`** in the 2026-08-25
dead-end route ban — recorded verbatim on the ERP Variables row `maid_visa_cost_already_incurred`:

> *"transactions advancesearchNew and housemaidtransactions advancesearch are §A1/§A2 of
> NO_NONPAGE_ALTERNATIVE: no id-list finder, CSV-only unpaged accessors"*

So the swap trades a **Restricted** paginated route (§A1, already in use and already disclosed) for a
**permitted** paginated route in the same Section A bucket. It is not a new class of problem and it
does not make the ban position worse — but it is not an escape from the ban either, and the
deployment ticket's *Known route exceptions* section must list it.

## Recommended next steps, in order

1. **Probe `POST /housemaidtransactions/page/advancesearch` with the current token.** One call
   settles whether the permission is already held. If it is, the access request is moot.
2. If held, rewire the six detail nodes to a **single batched** attribution call per chunk rather
   than one call per transaction — the load win is the point, not just the permission.
3. Keep the `AddEditTransaction` request open **only** if the probe fails.
4. Either way, add `/housemaidtransactions/page/advancesearch` to the drafts' route-exception list.

*Answer obtained through `scripts/ask-code.sh`, the sanctioned API. No ERP code is held locally.*
