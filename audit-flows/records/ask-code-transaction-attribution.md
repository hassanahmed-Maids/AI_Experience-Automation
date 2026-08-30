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

## PROBED LIVE — the answer changes which grant to request

Five probes plus a control, 2026-08-30. Results, and what each proved:

| Probe | Result | Proves |
|---|---|---|
| `/housemaidtransactions/...` (no module prefix) | bare nginx **403 HTML** | wrong path — no route without `/accounting`. The documented "missing module prefix reads like a ban" trap |
| **CONTROL** `/accounting/transactions/page/advancesearchNew`, pc `ManageTransactions` | **500**, a Java type error on the filter value | **the token is alive and authorised there** — so every 401 below is real, not an expired session |
| `/accounting/housemaidtransactions/...`, pc `ManageTransactions` | **401**, `developerMessage: API_NOT_FOUND_FOR_PAGE` | the route is genuinely not in that page's whitelist — exactly as the code said |
| `/accounting/housemaidtransactions/...`, pc **`HousemaidTransactions`** | **401**, `developerMessage: INSUFFICIENT_PERMISSIONS` | **the page EXISTS and whitelists the route. Only the user's policy is missing.** |

The disambiguation came from the **`developerMessage` response header**. The body message is a fixed
constant (`ApiAuthorizationService.java:56`) that never says why; the header carries the real reason
(`WebConfiguration.java:107`). Worth remembering — a 401 body from this ERP is not diagnostic on its
own, and reading only the body is what made the first probes look like a dead token.

## So the grant to request is NOT the one we were about to ask for

| | `AddEditTransaction` | **`HousemaidTransactions`** |
|---|---|---|
| Page | "Edit Transaction" | "Housemaid Transactions" |
| Whitelists the attribution route? | **no** — CRUD + a name lookup only | **yes**, exclusively (`security-staff-mgmt.json:113-116`) |
| Shape of the grant | read on a transaction-**editing** page | read on a maid-transaction **listing** page |
| Enables batching? | no — one detail call per transaction | **yes** — one filtered search per chunk |

**Request `HousemaidTransactions` — Read-only.** It is row 3 on the same access screen, also managed
by Chekri Khalife. It is the narrower grant *and* the one that unlocks the batched design; the
`AddEditTransaction` request can be dropped.

## Remaining steps

1. Request **`HousemaidTransactions` Read-only** (not `AddEditTransaction`).
2. Once granted, rewire the six detail nodes to one batched attribution search per chunk — the ERP
   load win is the point, not just the unblock.
3. Add `/accounting/housemaidtransactions/page/advancesearch` to the drafts' route-exception list
   (§A2, see above).
4. The four other CC Overstay endpoints remain **untested**, not confirmed — the breaker never
   reached them.

*Answer obtained through `scripts/ask-code.sh`, the sanctioned API. No ERP code is held locally.*
