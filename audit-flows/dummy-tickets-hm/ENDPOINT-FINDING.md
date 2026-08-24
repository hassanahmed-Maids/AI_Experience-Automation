# `Get Transaction Detail` calls a route that does not exist — and does not need to

Probed 2026-08-24 against live ERP and the ask-the-code API (conversation 44674, module
`erp/magnamedia-accounting`). Three findings, and the third makes the first two moot.

## 1. `GET /accounting/transactions/{id}` is not a real route

Live: `401` with response header `developerMessage: API_NOT_FOUND_FOR_PAGE`, while the SAME token
gets `200` from `/accounting/transactions/page/advancesearchNew` and `/clientmgmt/contract/search/page`
in the same second. Three other pagecodes (`TransactionDetails`, `ManageTransaction`, `Transactions`)
return `PAGE_NOT_FOUND`, so `ManageTransactions` is a real page and this API is simply not mapped to it.

Ask-the-code confirms from the source: `TransactionsController` (mapped at `/transactions`, line 63)
declares **no** `@GetMapping("/{id}")`. Its only path-variable routes are `/byBucket/{id}` (line 220),
`/fix/{dd}/{mm}/{yyyy}` (line 367) and `/getDDBankInfoAttachments/{id}` (line 1473). The pageCode →
route whitelist lives in the FRONTEND repo (`acc-angular/src/custom/security-accounting.json`), not
in the backend, which is why no backend grep would ever have found this.

## 2. The correct endpoint returns the SAME projection

`POST /accounting/transactions/page/advancesearchNew` → `advanceSearchAcc7274` (line 1533) →
`QueryService.manageTransactionsAdvanceSearch` (`QueryService.java` line 1959) returns
`Page<TransactionsSearchDto>` — a hand-written JPQL constructor projection
(`QueryService.java` 1672–1684, fields at `TransactionsSearchDto.java` 19–45).

That is the same DTO the flow's own sweep node already receives. **There is no richer
"detail" view of a transaction under this pageCode.** The projection is the ceiling.

(Filtering it by `id` is also not straightforward: `[{"property":"id","operation":"=","value":2042434}]`
returns `500 IllegalArgumentException - Parameter value [2042434] did not match expected type
[java.lang.Long]`, and quoting the value does not help. Not pursued, because of finding 3.)

## 3. The data the call wanted is already on the swept row

The run that exposed this (execution 99951) failed on transaction **2042434**. That transaction IS in
the sweep's own result set, and its `description` reads:

```
Ex160024/Applicants dummy tickets (refundable)/Maid - ROBIE VERBAL ATIENZA/3714.00/AED/
... Maid Profile ID - 138719  Passport Number - P0538404D  Qashio Date: 28-07-2026
```

`Verify Population` marks a row `needs_detail` when this regex misses:

```js
const ID_RE = /Applicant\s*ID\s*[-–:]\s*(\d+)/i;
needs_detail: pid === null,
```

`Maid Profile ID - 138719` does not match `Applicant ID - N`. So the row is sent to a detail call
that (a) does not exist and (b) could only ever have returned the identical description.

The node's own comment already saw half of this — *"'Maid -' rows are housemaid charges in the dummy
bucket: they resolve a housemaid"* — and `desc_prefix` is computed to distinguish them. The parser
just never learned the second label.

## What this costs

`ERP_CALLS_PER_TRANSACTION = 3` in the budget gate, one of which is this detail call. Removing it cuts
the check's ERP load by a third — 605 calls on the modelled 605-transaction month — and removes the
only call in the chain that can never succeed.

## The open question, which is NOT mine to decide

Fixing the regex to also accept `Maid Profile ID - (\d+)` is one line. But the id it yields is a
**housemaid profile id**, not an applicant id, and `Fetch Tickets (0-Fetch)` downstream is built to
take applicant ids. Whether a maid-profile row should resolve through the same lookup, a different
one, or be excluded from the population, is a question about what this check is supposed to catch —
not a wiring detail. Flagged for Moe rather than guessed at.
