# Client Refunds — build notes (spec v0.8)

Notion spec: `3c8fe1c78bf0810894a2fb0a55ca521a`. Status on arrival: *Spec'd — pending build on n8n*,
`Test cases verified: NO`, maker/checker required (Jacky), handles sensitive data.

Phases 1–2 are **blocked on an ERP token** (see below). Everything recorded here came from the
spec, the ERP-APIs response-shape database and the existing n8n audit flows — no live ERP call
has been made in this session.

---

## 1. The headline: only ONE scoring gate has a live source

The spec reads as 26 rules. Read the *run-time sourcing* paragraph at the foot of each rule and
the buildable set collapses:

| Rule | What it concludes | Source today |
|---|---|---|
| ❶❷❸❹❺⓮ | population framing + comparison basis | ✅ all on `clientRefundTodo/search/page` |
| **⓫ approval vs configured limit** | **finding (red)** | ✅ **`clientRefundSetup/list`, 200, 68 rows** |
| ❻ trace to a RECEIVED payment | route to verifier | ❌ 401 `payments:search` / `Payments:getAllPayments` |
| ❼ refunded ≤ received (ceiling) | finding | ❌ 401 (both sums) + 401 `getClientRefundsPreviousRequests` |
| ❽ duplicate (4-leg key) | finding | ⚠️ affected-period leg is `@JsonIgnore` — **no route, permanently** |
| ❾ freeze windows | finding | ❌ **no ERP route at all**, hunt closed 2026-08-27 |
| ❿ pre-collected reconciliation | finding | ❌ 401 `getTheRefundAndPaidEndDateFromContract` |
| G3 partial freeze (AED 637k/qtr) | finding | ❌ neither leg readable — "every G3 case routes to the verifier, permanently" |
| G5 recruitment fee (AED 1.94M/qtr) | finding | ❌ expense ledger has no legal ERP read; ceiling needs the 401 payment reads |
| G8 WPS / service charge | finding | ❌ detail lines (no route) + 401 payment reads |
| G1 duplicate charges, G7 goodwill | — | 🔴 declared coverage gaps, 0 findings possible by design |

⓫ is also the only rule in the whole set carrying **both** `Business Validated: YES` and
`Technical Validated: YES`.

**Consequence the spec has not absorbed.** It sizes the AI verifier at *"208 of 1,768 paid July
refunds (11.8%), 189 of 1,352 clients"*, on the assumption that the mechanical gates settle the
rest. With ❻❼❽❾❿ and G3/G5/G8 all routing to the verifier by their own stated fallback, the
verifier's real intake is close to the **whole population — roughly 1,742 refunds a month, ~8×
the specced volume**, and the verifier reads staff notes, which are the sensitive-data surface.
That is a cost, review-capacity and data-exposure change, not a runtime one. **Flagged for Jacky
— see the ask at the end.**

Nothing here is a reason to skip the gates. They are built, they declare their gap, and ⓭ keeps
the affected cases at `pending`. A gap that is loud is fine; a gap that reads as green is the
failure this check has already had three times.

## 2. Spec correction: the ⛔ "do not build" note is superseded

The population section carries:

> ⛔ **Do not build the flow against these endpoints yet.** Purpose-built replacements have been
> requested from the developers and are not yet delivered.

Two things have changed since that was written, and they point in opposite directions:

1. **The replacement was delivered** — `POST /admin/dynamicApi/evaluateApi?code=get_paid_client_refunds`,
   supplied by Jacky 2026-08-27.
2. **It cannot serve as the population source.** It returns 12 flat fields and is confirmed to
   carry **no refund id, no refund status, no date field of any kind, and no payment id**. ❶ needs
   status, ❷ needs the paid date, ❽ needs an id, and "one case = one refund" needs a key. Two of
   the ten rows in Jacky's own sample are byte-for-byte identical and undecidable.

Meanwhile rule ❸ (Order 30, `Live`, updated 2026-08-27 — *after* the ⛔) states plainly:

> The population comes from `POST /accounting/clientRefundTodo/search/page`. That is a named,
> **PERMANENT** exception to the no-`page` ban — no Jira ticket and no exit.

**Resolution taken:** build the population read on `clientRefundTodo/search/page` under ❸'s five
mandatory safeguards. That is the conservative reading — it is the only source carrying every
field the gates need — and it is the one the governing rule names. The ⛔ note should be edited to
say "superseded by ❸; the replacement lacks id/status/date". *Filed as a spec correction, not
applied to Notion by me.*

## 3. Verified call convention (from the existing golden flows)

Base `https://erpbackendpro.maids.cc`. Headers on every ERP call:

```
authorization: {{ $json.erp_token }}
pagecode:      <per-endpoint>
cookie:        deviceIdProduction={{ $json.erp_device_id }}; authTokenProduction={{ $json.erp_is_auth }}
```

- **The token is a runtime payload, never a stored credential.** Every audit flow in this project
  does it this way; the flow holds no ERP credential of its own.
- **Pacing: `batchSize: 2`, `batchInterval: 500`** = 4 req/s, the `ERP-LOAD-POLICY.md` §1 ceiling.
  §1 caps the *in-flight count* at 2 as well as the rate — 3/750ms is also 4 req/s and still
  violates it. Bursts got the ERP account disabled in June 2026.
- **`fullResponse: true`**, so a non-2xx is not swallowed by the error rail.
- **ERP lease** — acquire `9gVijqvtLVEhQZXz` before the first ERP call, release on both rails. A
  sub-workflow must NOT take its own lease; it would deadlock against the caller holding it.
- **Circuit breaker** — generated from `audit-flows/tools/erp_breaker.js`, dropped into the first
  node after each ERP batch. Do not hand-edit it; it is byte-compared.
- `developerMessage` must be read as a **header lookup, never a text scan** — every healthy ERP
  response carries `access-control-expose-headers: ... developerMessage`, so a substring scan
  matches every 200.

### Endpoints this check needs

| Surface | Method + path | pagecode | Status |
|---|---|---|---|
| Population | `POST /accounting/clientRefundTodo/search/page` | `accounting_client-refund-summary` | ✅ 200, live-verified 26 Aug, 64 leaf keys |
| Purpose config | `GET /accounting/clientRefundSetup/list` | `accounting_ClientRefundSetup` | ✅ 200, 68 rows, ids 1–68 contiguous |
| Duplicate probe | `GET /accounting/clientRefundTodo/checkClientRefundStatusByPurpose` | — | ✅ 200; **key name varies per purpose at runtime** |
| Client's other refunds | `getClientRefundsPreviousRequests` | — | ❌ 401 |
| Receipts | `getRefundProofs` | — | ❌ 401 |
| Payments summary | `getClientRefundPaymentsSummary` | — | ❌ 401 (also takes `contractID`, capital ID) |
| Payments | `payments:search`, `Payments:getAllPayments` | — | ❌ 401 |
| Contract refund totals | `contract:getTheRefundAndPaidEndDateFromContract` | — | ❌ 401 |

The 401s are **permission gaps for this role, not breakage** — a fourth endpoint on the same
controller returned 200 with the same token, same pagecode, same minute. `getSetupByPurpose` is
401 while `/list` on the same controller is 200: the gap is **per-method**.

### ❸'s five mandatory safeguards on the paged read

1. `size=40`, never 50 — `offset = page × size`, and page 0 caps at 40 rows whatever `size` asks,
   so 50 requests rows 0–39 then 50–99 and **silently never asks for 40–49**.
2. Walk until rows pulled `== totalElements`, or **fail the run**.
3. Never conclude an absence from a single page.
4. Assert `totalElements` is unchanged between the first and last page; a drift means re-walk.
5. Filter the month on `statusChangeDate` (the paid date).

Also: `totalElements` is a **floor, not a ceiling** — if the walk exceeds it, keep going. And no
warehouse read may be wired into the run (ERP-only, and recurring warehouse queries are org-banned).

## 4. Call budget

Population only: 1,742 refunds/month ÷ 40 per page ≈ **44 calls**, plus **1** for the setup config.
At 4 req/s that is seconds, not hours — comfortably inside the 500-call budget.

The spec's warning that per-refund enrichment (contract, payments, freeze record) would blow the
budget is correct, but **moot for now**: every endpoint that enrichment would call is 401 or has no
route. The check is currently a two-call population sweep. If the six pending permissions land, the
budget goes to ~1,742 × 3 ≈ 5,200 calls and the staged sub-workflow architecture becomes mandatory —
the golden `CC Below Agreed` chain is the pattern to clone.

**Free win:** `managerAction`, `ceoAction`, `methodOfPayment`, `partialRefundForCancellationPaymentMethod`,
`amount`, `purpose{id,name}`, `contractType` and `status` all arrive **inline on the population
read**. ⓫ therefore needs no per-refund enrichment at all — it is population + one config call.
That is what makes ⓫ runnable today while everything else waits on grants.

## 5. Data-minimisation note

The population read returns `iban`, `eid`, `accountName` and four note fields
(`notes`, `managerNotes`, `description`, `rejectionNotes`) that this check does not need for the
deterministic layer. The flow reads ~12 of 54 record fields. A projection without banking detail
is the standing trim ask on this endpoint. Until it lands, the slim projection must be taken in the
**first Code node after the HTTP node**, so the raw rows never travel further into the run.

Four notes in May–Jul 2026 contain an IBAN, an account number and a SWIFT code with the holder's
name. Note text goes to the workbook and nowhere else — never to chat, a run summary, a log or an
email.

## 6. Open items carried into the build

- **Which field is the staff note.** `notes` / `managerNotes` / `description` / `rejectionNotes` all
  exist on the response and the sample was redacted before anyone read a value. The verifier layer
  cannot be written until one is identified. Settle it on the first live read by reporting *which
  key is populated and how often* — never the values.
- **`allNotes` vs `notes`** are flagged in the spec as possibly the same field: "do not build on both".
- **`numberOfUsedDays` / `numberOfUnusedDays` / `numberOfMonthlyPayments`** were populated **0 of 40**
  on the measured page. Present is not available.
- **`paymentId` is an ARRAY**, not a scalar.
- **`detail` is a STRING echoing the refund id** — *not* the per-month detail lines. Those are
  `@JsonIgnore` and returned by no route. This is what makes ❽'s period leg and G3/G8's arithmetic
  permanently unsourceable.
- **⓫ tolerance.** ⓮ sets an AED 0.50 absolute tolerance for comparisons against "a payment, a fee
  or a rate". ⓫ compares against a *configured threshold*, and its condition text says plain
  `amount >= limitForCeoApproval`. Implemented as exact `>=`. Worth one line of confirmation from
  Jacky; the difference only bites a refund landing within 50 fils of its purpose's limit.
- **The AED 1.92M question** (679 refunds over AED 1,000 with no approval) is decidable by the
  first ⓫ population run and is *not yet decided*. No split of that figure may be quoted until it runs.

---

# Live findings, 2026-08-30 (n8n smoke runs 110421 / 110426 / 110427)

Flow: **`Client Refunds · 1-Score (draft)`** — n8n `XNAeirfksS1dIpZl`, Adeeb project.
Draft, never published, never scheduled. Three smoke runs, one ERP request each,
all stopped on the first (cheapest) call exactly as designed.

## 7. ERP authentication needs TWO values, not one — the bearer is not the session

The bearer token alone is refused. Every call returns:

```
HTTP 500  (content-type: text/html)
<html>… type=Http Status 498, status=498 …
Access Token is missing or malformed &lt;LOGOUT&gt;</html>
set-cookie: authTokenProduction=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 …
```

**The `set-cookie` line is the proof.** ERP responds by *clearing* `authTokenProduction`,
which means it reads the session from that **cookie**, not from the `Authorization` header.
The header is necessary but not sufficient.

This retro-explains the golden flows: they carry **three** run values —
`erp_token`, `erp_device_id` and **`erp_is_auth`** — and `erp_is_auth` is the
`authTokenProduction` cookie value. It was never optional; nothing had documented it as
load-bearing.

Ruled out, so this is not guesswork:

- **Not expiry.** `Prepare Run` decoded the JWT and reported **416 minutes left**
  (issued 10:42 UTC, expires 22:00 UTC, ERP's own clock 19:07 GST).
- **Not a wrong pagecode or a missing grant.** Those produce 401 with a
  `developerMessage`, not 498, and 498 arrives before any pagecode check.
- **Not the `Bearer` prefix.** Probed both with and without; byte-identical refusal.
- **Not ERP being down.** It answered in ~300 ms every time with a well-formed refusal.

**What the operator must supply:** bearer + numeric device id + the `authTokenProduction`
cookie value. The form now has a field for it.

## 8. Three n8n traps, each found by a run that "worked"

Each of these produced a *plausible-looking* failure that pointed at the wrong culprit.
Worth adding to the shared traps file — the first two would silently mis-diagnose any
ERP auth problem in any check in this family.

1. **`neverError: true` does NOT cover a response-parse failure.** With
   `responseFormat: 'json'` and an HTML body, the HTTP node throws
   *"Response body is not valid JSON. Change Response Format to Text"* **before** any
   downstream classification runs. The carefully-written 498 message was unreachable, and
   the run died pointing at a JSON parser. **Use `responseFormat: 'autodetect'`** on any
   node whose error path might not be JSON — which, on this ERP, is all of them.

2. **With `fullResponse` + `autodetect`, the payload key depends on the content type:**
   JSON lands under `body`, anything else under **`data`**. A classifier reading only
   `body` gets `undefined` on exactly the responses it exists to classify, and falls
   through to a generic branch. Read `body ?? data`.

3. **ERP wraps 498 in a 500 and serves it as HTML,** so neither the HTTP status nor a
   JSON `.status` field is reliable. The inner status has to be regex-read out of the
   whitelabel page. A bare status-code check reads "dead session" as "server error" and
   sends the operator to look at a server that is working perfectly.

## 9. Flow status

| Stage | State |
|---|---|
| Token shape + expiry gate | ✅ works (correctly reported 416 min left) |
| Refusal classifier | ✅ works — names the cookie, the remedy and where to get it |
| Config read + 68-row checksum | ⛔ blocked on the cookie value |
| Population sweep | ⛔ never runs; the flow stops on the first call by design |
| Scoring (rule 11) | ✅ built, 38 offline tests green; unexercised live |
| Delivery (workbook / email draft / runs log) | not built — stage 2 |

**One ERP request per failed run.** The cheap config read is deliberately first, so an
access problem costs one call rather than a 44-page population sweep. That ordering has
now paid for itself three times.
