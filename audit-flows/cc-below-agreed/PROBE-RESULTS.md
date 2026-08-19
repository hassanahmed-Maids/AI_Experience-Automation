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
