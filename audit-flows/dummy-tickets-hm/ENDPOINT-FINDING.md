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

---

# The run after the fix: it completed, and reported a FALSE CLEAN

Execution **100409**, 2026-08-24 07:06Z, 3m52s, status `success`. First time this check has ever
run to its delivery stage.

## What worked

| | |
|---|---|
| population | **581 declared, 581 collected, 3 pages** — gate 2 passed |
| identity | **560** applicant ids parsed off the swept row |
| housemaid charges | **18**, with their ids — including 138719 on tx 2042434, the row that broke the previous run |
| unattributable | **3**, declared as a gap, not silently dropped |
| unique applicants | **399** |
| detail calls | **0** — the deleted call cost nothing |

## What it then concluded, and why that is the worst bug found today

```
overall: "pass"        findings: 0        clean: 0
pending: 399           applicants_unreachable: 399
by_verdict: {"erp_unreachable": 399}
```

**Every single applicant came back unreachable, and the run called the month a pass.**

The summary row is not hiding it — `applicants_unreachable: 399` is right there. But `overall` is
computed from `findings == 0`, and a check that could not read a single applicant's tickets has
zero findings for the same reason a check with nothing wrong does. Those two states are
indistinguishable in the field a reader looks at first.

This is the exact failure this check family exists to prevent, stated in this flow's own gate-2
comment: *a partial audit that looks complete*. Gate 2 guards the POPULATION and passed honestly;
nothing guards the EVIDENCE. **`overall` must not be able to say `pass` while
`applicants_unreachable > 0`** — 399 of 399 is not a pass, it is a run that did not happen.

## Why they were unreachable — and it is NOT a flow bug

`GET /recruitment/maid-at-common/get-main-data/{applicant_id}`, pagecode
`RECRUITMENT__HustlersWorkflow`:

```
HTTP 401   developerMessage: INSUFFICIENT_PERMISSIONS
```

Contrast with the transaction-detail call above, which returned `API_NOT_FOUND_FOR_PAGE`. The
discriminator works: **this pagecode is correct and this API is mapped to it — the operator's ERP
identity simply lacks the grant.** Per this project's own denial classifier, that is *a FINDING to
report, not something to route around*. Hassan needs the permission; no change to the flow can
produce one.

## `<LOGOUT>` now has THREE meanings

All three seen live on 2026-08-24, all with the session demonstrably alive:

| body | developerMessage | means |
|---|---|---|
| `UNAUTHORIZED <LOGOUT>` | `API_NOT_FOUND_FOR_PAGE` | the request is wrong — re-tokening loops for ever |
| `UNAUTHORIZED <LOGOUT>` | `INSUFFICIENT_PERMISSIONS` | a real permission gap — report it |
| `Access Token is missing or malformed <LOGOUT>` | (absent) | the session really is dead |

`tools/erp_capture_failure.js` v3 names the first and third. It should name all three, and it should
say plainly that the marker alone settles nothing.

---

# What was done about it (2026-08-24) — the breaker now stops this on call 25, not call 800

The permission gap itself is unchanged and is still Hassan's to resolve: no change to any flow can
produce a grant. What changed is that the run no longer *pays* for it 399 times.

## What a breaker can actually see, settled rather than assumed

Pulled from stored execution data, not reasoned about. Execution **100522**, workflow
`YQlNlxrnhbQpBbdl`, node `Get Hustler Tickets` — the item the projection node receives, verbatim:

```
{ error: { message: '401 - "<html>…<div>UNAUTHORIZED &lt;LOGOUT&gt;</div></body></html>"',
           name: 'AxiosError', code: 'ERR_BAD_REQUEST', status: 401, stack: '…' } }
```

- There is **no `response` key**, therefore no headers, therefore **`developerMessage` is
  unreachable**. The `<LOGOUT>` table above cannot be applied at runtime from this item.
- The string `INSUFFICIENT_PERMISSIONS` **is not in the item at all**. It was only ever in the
  header. Anything claiming to detect it from the response body is inventing a signal.
- `error.status` is a reliable numeric `401`.

So the runtime test cannot be *which* refusal. It is **how total**: all three meanings of
`<LOGOUT>` are fixed for the whole run, so a batch that produced **not one success** cannot be
improved by making the next call. That is the rule the breaker now enforces
(`auth_wall`, ERP-LOAD-POLICY.md §5). A **per-entity** denial still arrives mixed with successes,
still does not trip, and still just marks those entities unreachable.

## Where the header IS readable, and the experiment that has not been run

Execution **93601**, workflow `YXRZdtk2Geeeqaal`, node `Get Flight Tickets` — the **same endpoint
and pagecode**, on a node configured `fullResponse: true` **and** `neverError: true` — returns
`{body, headers, statusCode, statusMessage}`. Headers are present. On a 200 ERP sends
`access-control-expose-headers: … developerMessage` but **no `developerMessage` of its own**.

Whether a **401** under `neverError: true` carries `developerMessage` in `headers` has **not been
observed**, because observing it costs a live ERP call. If it does, that node configuration would
settle the three-way ambiguity at runtime *and* stop n8n retrying refusals at all (a non-2xx no
longer throws). That is the one worthwhile follow-up here — see the retry section of §5.

The breaker reads the header opportunistically **as a header lookup, never as a text scan**: a
`has('developermessage')` scan would match the CORS list on every healthy 200 ERP returns.
