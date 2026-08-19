# Phase 2 — ERP surface probe, CC Monthly Payments Below Agreed Amount
Probed live 2026-08-18 with Hassan's own token (attribution correct). Counts and shapes only.

| # | Surface | pagecode | HTTP | Verdict |
|---|---|---|---|---|
| 1 | POST /admin/dynamicApi/evaluateApi?code=getactivecccontracts | (none/any) | **500** | **BLOCKER** — `SecurityException: Access denied.` on 4 pagecode variants |
| 2 | GET /accounting/payments/getReceivedClientsPayments | none | 200 | 33,213 rows July, 2.79s, 7.8 MB. `{message, payments[]}`, **no status field** |
| 3 | POST /accounting/payments/page/advancesearch | PaymentReport | 200 | 43,727 rows / **1,094 pages** May–Jul. Envelope HONEST |
| 4 | POST /clientmgmt/contract/search/page (FILTER_CANCELED) | ClientList | 200 | 949 rows / 24 pages |
| 5 | POST /clientmgmt/client/get-client-details?type=CONTRACT_DETAILS | ClientSummary | 200 | `currentPayment` present |
| 6 | GET /complaints/replacement/page/contract/{id} | ClientReplacement | **401** | **DEGRADATION** — `INSUFFICIENT_PERMISSIONS` |
| 7 | GET /clientmgmt/client/smsLog/{clientId} | ClientMgmtSMSLog | 200 | 40 msgs on test client |
| 8 | GET /clientmgmt/contract/client-contracts-v2/{clientId} | ClientSummary | 200 | **spec says blocked — it is NOT** |

## Denial shapes, correctly separated
- #1 `SecurityException: Access denied.` — permission denial on the dynamic-API code. Same on
  pagecode `<none>`, `ClientList`, `ClientSummary`, `AdminDynamicApi`, so it is NOT a pagecode error.
- #6 `INSUFFICIENT_PERMISSIONS` with the CORRECT pagecode (`ClientReplacement`), vs
  `API_NOT_FOUND_FOR_PAGE` with three wrong ones. This is the method the skill prescribes and it
  proves the pagecode is right and the permission is genuinely missing.
- No dead-token shape seen (the 498-inside-500). Token verified live before probing.

## Spec corrections to file
1. **The freeze permission is NOT missing.** The spec states `/contract/clientcontracts/{id}` and
   `/contract/client-contracts-v2/{id}` "both require hasPermission('contract','clientContracts') —
   the permission this workspace is already known to lack." Both return **200** today and
   `isCurrentlyFrozen` IS in the payload. The spec's *interim ask* (add the flag to the population
   route) is therefore unnecessary — v2 already returns it, one call per client.
   **But the spec's core finding stands and gate 60 is still unbuildable:** the payload carries only
   the boolean — no `lastFreezingDate`, no `paidEndDate`, no freeze history. A currently-frozen test
   is a proven 4-of-4 false positive. So the blocker is DATA, not ACCESS. Correct the reason, keep the gate pending.
2. **`clients.totalPages` on contract/search/page is not a total — it is `currentPage + 1`.**
   Measured: 1, 2, 3 … 24 across pages 0..23, resetting to 1 on the empty page 24, with
   `last: true` on EVERY page including page 0. The real count is the top-level `total` (949).
   Consequence: the `$pageCount > totalPages` guard on `Get Terminated Contracts` can never fire
   (pageCount > pageCount+1 is never true) — it is inert, not harmful. Completeness rests entirely
   on the empty-page terminator, which does work. `last` must never be trusted on this route.
3. **advancesearch's envelope IS honest** — `totalElements` 43,727 and `totalPages` 1,094 constant,
   `last` correctly false then true, over-range page returns 0 rows. Unlike route #4. The two paged
   routes behave differently and must not share a terminator idiom.
4. **Gate 2's stated obstacle disappears if population moves to route #4.** The spec says the
   population route "returns a bare JSON array with no `totalElements`, so `content.length ==
   totalElements` is impossible against it". Route #4 returns a top-level `total`, which makes a real
   completeness reconciliation possible for the first time.

## Two probe errors of MINE, recorded so they are not mistaken for flow defects
Both came from reading jq's `tostring` rendering of an absent/null param as the literal string "null".
- `sort=null` on advancesearch → 500 `could not resolve property: null`. The node has **no value** for
  `sort`; n8n sends `sort=` (empty) → **200**. Not a bug.
- `from=null&to=null` on smsLog → 400 `Invalid format: "null"`. The node's nulls serialise **empty** → **200**.
  `emailSubject` IS required-present (empty is fine); only Date-typed params break on a literal "null". Not a bug.

## Call budget, recounted
- Population (route #4 fallback): 5,392 contracts / 40 per page = **135 calls** (the dynamicApi did 100/page = 54).
- Bulk payments: **3 calls** (one per persistence window). Status sweep: **1,094 calls**.
- Terminated: **24 calls**. Per-candidate enrichment: 2 calls x candidates. Messages: 2 x candidates.
- Floor before any enrichment: **~1,256 calls/run**, against the spec's stated "500-per-run budget".
  The spec counted only the population sweep and the message reads. The status sweep alone is 2x the
  whole stated budget. This is an architecture fact, not a tuning knob.

## Independent population count (Phase 7 input)
5,392 ACTIVE CC contracts today (route #4 top-level `total`). Spec cites 5,612 paid in July, 4,997
active, 5,317 — all same order; the delta is month-of-measurement, not an omission.

## Follow-up probes, 2026-08-19 (fresh token, Hassan.Ahmed)

| # | route | pagecode | result |
|---|---|---|---|
| 9 | GET /bytable/PaymentsReport (all param shapes) | none/PaymentReport/ClientList/AdminDynamicApi | **bare HTML 403**, content-type text/html, identical on all four — load balancer, not ERP |
| 10 | GET /accounting/ContractPaymentTerm/getnewddInfo?contractId=&startDate= | ContractPaymentTerm | **401** on 7/7 contracts — permission `ContractPaymentTerm/getNewDDInfo` missing |
| 11 | POST /clientmgmt/contract/search/page | ClientList | 200, `total` 5,405, **5.03s per 40-row page** (so ~136 pages = 11-14 min; no page-size lever) |
| 12 | POST /clientmgmt/client/get-client-details CONTRACT_DETAILS | ClientSummary | 200, **3,851 B minified, 1.80s**, 33 top-level keys, `currentPayment` present |
| 13 | GET /complaints/replacement/page/contract/{id} | ClientReplacement | **401**, 185 B, 1.11s — unchanged since 2026-08-18 |
| 14 | GET /accounting/payments/getReceivedClientsPayments?from=2026-08-01&to=2026-08-19 | none | 200, 6,173 CC rows, 2.72s |

Two facts worth keeping out of the "defect" column:

- The `/bytable/**` 403 is the SAME shape as the missing-`/accounting/`-prefix 403 recorded
  earlier: an HTML body from the edge, no ERP JSON, no `developermessage`. Do not read it as
  a permission problem or chase a pagecode for it.
- The bulk feed spells the monthly type **"Monthly Payment"**, never `monthly_payment`
  (checked across every CC payment type in the August window). `monthly_payment` is the
  `code`; `name` is the human string. The ERP query at `PaymentRepository.java:519-531`
  filters on the NAME against the code-shaped literal, which is worth remembering before
  concluding anything about which tier of `currentPayment` fires.

## Probe 15 — the Google Sheets append echo, settled from execution history (2026-08-19)

**Question, and why it mattered:** `Return Batch Result` (WF-T) and `Join Scored` (WF-A) both
reconcile rows-appended against the batch's case count, reading the count off the Sheets node's
output. In WF-A the Cases append was a TERMINAL node — nothing ever read its output — so the
shape was an assumption. If the node returned one summary item per call instead of one item per
row, every batch would throw and the first run would die ~30 minutes in, after the sweeps.

**Method:** no token and no run needed. Execution **88906** of `CC Non Received · 2-Verify`
(`qAuvLHhae2sKD7mM`, success, 2026-08-15) contains a `Verdicts -> Google Sheet` append on the
same node type and version (`n8n-nodes-base.googleSheets` 4.7, operation `append`,
`autoMapInputData`). Read its stored output.

**Answer: one output item per input item.** The output items carry the appended row's own json
and `pairedItem: {item: 0}`, `{item: 1}`, `{item: 2}` — a per-input pairing, not a summary. So
`rows.length === cases.length` on a healthy append, and the reconciliation in both directions
(short write, duplicated write) is measuring the right thing.

Worth remembering as a method as much as a fact: an execution record answers questions about
node behaviour for free, and a sibling audit had already run the exact node this one depends on.

## Probes 16-21 — the testing session, 2026-08-19 (token issued to Abdullaha, supplied by Hassan)

Fired before the first end-to-end run. **Two rows above are wrong and are corrected here.**

| # | route | pagecode | HTTP | note |
|---|---|---|---|---|
| 16 | POST /clientmgmt/client/get-client-details?type=CONTRACT_DETAILS&contractId={id} — **no path segment** | ClientSummary / ClientList / none / bogus | **401** | `UNAUTHORIZED <LOGOUT>` on all four pagecodes alike |
| 17 | POST /clientmgmt/client/get-client-details/**{clientId}**?type=CONTRACT_DETAILS&contractId={id} | ClientSummary | **200** | 5,033 B, 2.00 s, 33 keys, `currentPayment.amountValue` a number |
| 18 | POST /clientmgmt/contract/search/page (empty body) | ClientList | 400 | `searchKey ... is not present` — proves auth passes on this token |
| 19 | POST /clientmgmt/contract/search/page (full WF-Pop body) | ClientList | 200 | `total` **5,401**, 40 rows, **6.61 s/page** |
| 20 | GET /complaints/replacement/page/contract/{id} | ClientReplacement | **200** | paged envelope, 11 keys — **NOT denied on this account** |
| 21 | GET /accounting/payments/getReceivedClientsPayments?from=&to= (1 day) | none | 200 | 68 rows; row keys `contractID, contractType, paymentAmount, paymentDate, paymentId, paymentMethod, paymentType` — **no clientId** |

### Correction 1 — the plan read needs the clientId PATH SEGMENT (probes #5 and #12 are wrong as written)

Rows #5 and #12 record the plan read as `POST /clientmgmt/client/get-client-details?type=CONTRACT_DETAILS`
returning 200. Reproduced today, **that exact URL returns 401**. The route only answers when the
client id is a path segment: `/get-client-details/{clientId}?type=CONTRACT_DETAILS&contractId={contractId}`
— which is what `Fetch Contract Plan` in WF-E has always sent (`.../get-client-details/{{ $json.client_id }}`),
so **the flow is correct and only the probe record was wrong**. The earlier probes must have included
the segment and recorded the URL without it. Anyone re-probing from row #5 as written would conclude
the account had lost the permission.

### Correction 2 — ClientReplacement is NOT denied on every account (rows #6 and #13)

Rows #6/#13 record `/complaints/replacement/page/contract/{id}` as a standing
401 `INSUFFICIENT_PERMISSIONS`, described as "half the enrichment calls fail by design" and
"~5,632 wasted round trips per uncapped run". On **this** token the same route returns **200** with a
full paged envelope. The denial is therefore **account-scoped, not check-scoped**: Hassan's account
lacks `ClientReplacement`, Abdullaha's has it. Consequences:

- The "~5,632 wasted round trips" figure holds only for a run fired under an account without the
  permission. Under one that has it, the enrichment is fully useful and gate 7's coverage answer is
  the real one rather than the capped one.
- This is precisely the failure the skill warns about — a permission recorded as absent from one
  account's probe and then read as a property of the check. **Which account fires the run changes
  what the audit can see.** Record the account with the result, every time.

### `UNAUTHORIZED <LOGOUT>` is ERP's GENERIC 401 — it does not mean one thing

HTTP 401 `{"status":401,"error":"Unauthorized","message":"UNAUTHORIZED <LOGOUT>"}` was seen
twice in one session, from two unrelated causes:

1. **A malformed route** — `get-client-details` without the `{clientId}` path segment, at
   14:41, while the very same token returned 200 on `contract/search/page` and 200 on the
   correctly-formed plan read. Identical message on a correct pagecode, a wrong one and a
   deliberately bogus one, so the pagecode-discrimination method cannot separate it.
2. **A genuinely dead token** — at 14:49, on `contract/search/page`, the exact request that
   had returned 200 eight minutes earlier and had just walked 136 pages successfully inside
   execution 94122. Confirmed by re-curling the route by hand.

So the message carries **no diagnostic weight on its own**. It means "this request is not
authorized right now", nothing more precise. Separate the two by **testing a second, known-good
route with the same token**: if that route answers, the token is alive and the first URL is
wrong; if both refuse, the token is dead. That test costs one call and is the only reliable
discriminator found.

**What this means for the live detector.** `isTokenDead()` in `wf-e/nodes/project_plan.js`
and `project_replacements.js` matches the substring `logout`. Against cause 2 — by far the
common one, and the one that actually threatens a run — it is **correct**, and execution 94355
is the proof: the token died mid-session and the rail caught it in 346 ms. Against cause 1 it
would name the wrong culprit, but cause 1 requires a malformed URL that no deployed node has.
Leave the matcher alone; the one improvement worth making is to the throw text, which should
say "re-issue the bearer **or** check the request URL", so the rarer cause is at least named.
