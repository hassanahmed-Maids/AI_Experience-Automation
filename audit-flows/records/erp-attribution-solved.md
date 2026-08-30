# Transaction → housemaid attribution: solved with the permission we already hold

**Date:** 2026-08-30
**Supersedes the "Remaining steps" of `ask-code-transaction-attribution.md`.**
**No access request is needed. Do not ask Chekri Khalife for `HousemaidTransactions`.**

## The finding

`POST /accounting/transactions/page/advancesearch` — the **legacy** route, not `advancesearchNew` —
is whitelisted under **`ManageTransactions`**, the pageCode the audit user already holds, and its
projection carries the housemaid link that `advancesearchNew` structurally cannot.

Verified live against `erpbackendpro.maids.cc` on 2026-08-30, not inferred:

| Probe | Result |
|---|---|
| `POST /accounting/transactions/page/advancesearch?page=0&size=3`, body `[]`, pageCode `ManageTransactions` | **HTTP 200** — passes authorization |
| `POST /accounting/transactions/page/search?page=0&size=3`, same pageCode | **HTTP 200** — also passes, but ignores every filter (see below) |
| Batched: 120 transaction ids in one `in` filter, `size=200` | **HTTP 200**, `totalElements=120`, 120 rows returned, **114 carrying housemaid attribution** |

## The request contract (established by probe, field name by field name)

Pagination is by **query parameter**; the body is a **bare JSON array** of filter items — not an
object. Two field names are non-obvious and each cost a 500 to find:

```
POST /accounting/transactions/page/advancesearch?page=0&size=200
Headers: Authorization, secc-ch-ua-platform, pageCode: ManageTransactions
Body:    [ { "property": "id", "operation": "in", "value": ["2099685","2099670", ...] } ]
```

- The field is **`property`**, not `field` → otherwise `500 Cannot invoke "String.split" because "property" is null`.
- The field is **`operation`**, not `operator` → otherwise `500 Cannot invoke "String.toLowerCase()" because "this.operation" is null`.
- `operation: "equals"` is **not** a valid operation — it reaches Hibernate and dies with
  `QuerySyntaxException: unexpected token: equals`. `in` is verified working; other operations are untested.
- `in` takes a **JSON array**, not a comma-joined string (`For input string: "a,b"`).
- A body object rather than an array → `400 Cannot deserialize ArrayList<FilterItem> from Object value`.

## What each row carries

Every row projects a `housemaids` array. For `transactionType: HOUSEMAID` it is populated; for
`APPLICANT` / `UNKNOWN` it is empty — which is correct, not a defect. Each link carries:

| Field | Type | Why it matters |
|---|---|---|
| `housemaid` | `{id, label}` | **the attribution itself** |
| `amount` | float | the per-maid split of a shared transaction |
| `contractId` | int | the contract the cost lands on |
| `id`, `uuid`, `entityType`, `creator`, `creationDate` | — | provenance |

This is the *same* per-housemaid detail we believed only `HousemaidTransactionController.advancesearch`
could give. In the 120-row sample there were no multi-maid rows, but the field is a list and the code
path (`getTransactionFor()`, `HOUSEMAID` case) joins the names of *all* linked maids — so the flow
must handle `housemaids.length > 1`, not assume `[0]`.

## `page/search` is a trap — do not use it

`POST /accounting/transactions/page/search` also returns 200 under `ManageTransactions` and also
projects `housemaids`. But it **silently ignores the request body**: `page`, `size` and `filters`
all had no effect, and three structurally different bodies returned the identical newest-20 rows
against `totalElements = 1934557`. A flow built on it would look like it was filtering and would
not be. Use `advancesearch` with query-param pagination.

## The Section A claim in the drafts is now wrong

Five of the six unposted Jira drafts state that `advancesearchNew` is **Section A of the 2026-08-25
dead-end route ban, "no alternative exists"**, on the stated grounds that there is *no id-list
finder and no unpaged JSON accessor for the transaction ledger*.

**There is an id-list finder.** `advancesearch` with `[{property:"id", operation:"in", value:[...]}]`
takes a bounded, explicit list of ids and returns exactly those rows — 120 in a single call in the
probe above. That is the targeted accessor whose absence made the route a dead end. The drafts'
disclosure has been corrected accordingly; a claim of an unresolvable ERP dependency must not be
posted to Jira when a route we already have permission for resolves it.

The ban's underlying concern — open-ended paging sweeps over a 1.9M-row ledger — is *satisfied*, not
violated, by the id-list form: the flow pages the population once to get ids, then fetches
attribution in bounded chunks instead of one detail call per transaction.

## What this replaces

- **Drop** the `HousemaidTransactions` access request. It would have bought a richer per-maid row we
  do not need — `amount` and `contractId` are already here.
- **Drop** the `AddEditTransaction` request (already superseded).
- **Rewire** CC Overstay Fines' six `GET /accounting/transactions/{id}` detail nodes to one batched
  `advancesearch` per chunk. That was the point of the whole exercise and it is now unblocked.

## Still open

- Only `operation: "in"` on `property: "id"` is verified. Date-range and expense-code filters — which
  would let the flow skip the population sweep entirely — are **untested**.
- The four other CC Overstay endpoints remain untested; the breaker never reached them.

*Route contract established by live probe. The whitelist itself was read from the ERP code through
`scripts/ask-code.sh` (session 45318), the sanctioned API. No ERP code is held locally.*
