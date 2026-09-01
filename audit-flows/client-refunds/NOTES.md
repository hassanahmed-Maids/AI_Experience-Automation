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

---

# Live findings, 2026-08-30 evening (runs 110687 / 110692 / 110695)

## 10. Authentication is SOLVED — and it was simpler than the earlier note implied

`authTokenProduction` holds the **same JWT as the bearer**. There is no third secret to
find; the same token goes in two places:

```
authorization: Bearer <JWT>
cookie:        deviceIdProduction=<numeric device id>; authTokenProduction=<the same JWT>
```

The earlier run failed only because that cookie was sent **empty**. Section 7 above,
which reasoned that the bearer "is not the session", was half right: ERP requires the
cookie, but it is not a separate credential. **Corrected here rather than rewritten above,
so the reasoning trail stays visible.**

The `erp_is_auth` field in every golden flow is therefore just the token again.

## 11. The real blocker: BOTH pagecodes are refused on this account

With the cookie populated, the refusal changed from `498 Access Token is missing` to:

```
HTTP 401   developermessage: INSUFFICIENT_PERMISSIONS
```

on **both** endpoints the check needs:

| Pagecode | Endpoint | Result on hassan.ahmed |
|---|---|---|
| `accounting_ClientRefundSetup` | `GET /accounting/clientRefundSetup/list` | ❌ 401 INSUFFICIENT_PERMISSIONS |
| `accounting_client-refund-summary` | `POST /accounting/clientRefundTodo/search/page` | ❌ 401 INSUFFICIENT_PERMISSIONS |

The session is valid — a dead session returns 498 and this does not. This is a **grant
gap on the account running the check**, and nothing in the flow can produce one.

### This contradicts the spec on both rows, and the reason matters

The spec records both as verified:

- `clientRefundSetup/list` — *"LIVE-VERIFIED 2026-08-27 … 68 rows in one call"*, and the
  permission ask for `clientRefundSetup` was explicitly **WITHDRAWN**: *"it was never
  needed."*
- `clientRefundTodo/search/page` — *"pagecode accounting_client-refund-summary (PROVEN
  LIVE 26 Aug 2026 — the population read runs on this)"*.

Both were verified on **a different login** from the one that would run the check. That is
the exact failure the builder process warns about: *a route documented as verified turns
out to be refused on the auditing account, because the original check was made on a
different login.* A permission tested on a borrowed token gets recorded as working and
stays recorded.

**Spec corrections to file:**
1. Re-open the `clientRefundSetup` permission ask — the withdrawal was made on evidence
   from an account that is not the one running the check.
2. Add `accounting_client-refund-summary` to the outstanding-permissions list; it is
   currently recorded as proven and is not.
3. Both "verified" rows should record **which identity** the verification was made on.
   A verification without an identity attached is not reusable.

**The permission list to request** (superseding the spec's six):
`accounting_ClientRefundSetup` · `accounting_client-refund-summary` — these two are what
stand between the flow and a first real run. The previously listed six
(`clientRefundTodo:getClientRefundsPreviousRequests`, `getRefundProofs`,
`getClientRefundPaymentsSummary`, `payments:search`, `Payments:getAllPayments`,
`contract:getTheRefundAndPaidEndDateFromContract`) remain outstanding but only widen
coverage beyond rule 11.

## 12. A fourth trap: the LOGOUT marker cannot identify which refusal happened

ERP appends `<LOGOUT>` to the body of **both** a dead session (498) and a permission
denial (401). The first classifier tested the body for that marker *before* looking at the
status code, so the 401 printed *"Access Token is missing or malformed — get a fresh
token"* — sending the operator to refresh a token that had 416 minutes left, for a problem
no token can fix.

**Classify by status first; use the `developermessage` RESPONSE HEADER to separate the
three refusals; never let a body marker decide.** Both assert nodes now do this. This is
the same lesson the shared circuit breaker already carries in a different form, and it
belongs in the traps file.

## 13. Flow status

| Stage | State |
|---|---|
| Token shape + expiry gate | ✅ verified live |
| Auth (bearer + cookie) | ✅ **solved** — session accepted |
| Refusal classifier | ✅ verified live against both 498 and 401 |
| Config read (68-row checksum) | ⛔ 401 — grant needed |
| Population sweep | ⛔ 401 — grant needed |
| Scoring (rule 11) | ✅ built, 38 offline tests green; refuses to run without config |
| Delivery | not built — stage 2 |

On a smoke run a config denial now records and continues, so one run probes both
endpoints and reports how far access extends. A full run still aborts on the first denial.
Every failed run so far has cost **two ERP requests**.

## 14. Credential hygiene

The cookie was supplied as a full browser blob. Only `deviceIdProduction` and
`authTokenProduction` were used; the analytics and marketing cookies (VWO, GA, Mixpanel,
Meta, TikTok, Reddit, Clarity, Snapchat) and the `user` cookie — which carries the login
email and a second copy of the token — were not read, not stored and not sent anywhere.
**Ask for the two named values, never the blob:** a blob puts unrelated secrets into
transcripts and logs for no benefit.

---

# Rule set completed, 2026-08-30 (offline work while the grants move)

## 15. The full partition is now in code, and it reconciles

`groups.js` holds all **41 purposes across 12 groups** (13 keys — G2 splits into G2a/G2b).
`assertPartition()` re-checks the spec's claim rather than trusting it:

- 41 purposes, **no duplicates, none orphaned** ✅
- group totals sum to **AED 8,344,605** against the spec's stated **8,344,603** — a
  **AED 2** delta, which is rounding in the per-group figures. ✅

An **unmapped purpose is PENDING and says so**, never scored. If ERP adds or renames a
purpose the partition has drifted, and a silently unmatched purpose would otherwise fall
through every group test and reach ⓭ looking like an ordinary unsettled case.

## 16. A SECOND gate can conclude today: G-ATTACH

Reading the group rules end to end turned up one control the coverage table missed.
Three groups name it independently:

| Group | Purpose | `requireAttachment` |
|---|---|---|
| G2b | `Full refunds of unused monthly payments` | ✅ *"a new deterministic control on this group"* |
| G7 | `Removing Bad Google Review` | ✅ *"a missing document there **is** a violation"* |
| G10 | `Taxi Reimbursements` | ✅ (and `Passport renewal refund` explicitly **not**) |
| G2a | the three escalation rows of `Partial Refunds for Cancellation` | ✅ (default row: not) |

**It needs no extra call and no extra permission.** `requireAttachment` comes from the
same config read ⓫ already uses, and `attachments` / `paymentProofAttachment` /
`proofUploaded` all arrive inline on the population row.

Two safeguards, both tested:

- **Presence is never evidence the amount is right** (G10 says so outright). The gate
  fires only on *absence where the config demands presence*.
- **A missing field is not an absent document.** If a slim projection dropped the
  attachment fields the gate returns `pending`, not `finding`. Inventing a finding from a
  missing input is the mirror of a false clearance and just as wrong.

This raises the check from one concluding gate to **two**, and G7's *"all three controls
are closed"* verdict now holds for **three of its four members, not four** — which is a
smaller and more precise ask than the whole group.

## 17. What each group can conclude, once the two grants land

| Group | AED/qtr | Can it conclude? |
|---|---|---|
| G1 duplicate payments | 368,727 | 🔴 **Coverage gap, permanent.** The offending row is deleted or replaced once refunded; notes 0%. A charge may be CONFIRMED by the payment log but never DENIED by it. |
| G2a partial cancellation | 850,335 | Termination readable; day arithmetic needs the write-only detail lines. → verifier (+ G-ATTACH on 3 of 4 setup rows) |
| G2b full cancellation | 800,980 | Gross match needs the 401 payment reads. → verifier (+ G-ATTACH on the big member) |
| G3 partial freeze | 636,831 | Neither leg readable, **permanently**. → verifier |
| G4 full freeze | 981,814 | Same. Live CEO limit 6,000, both methods auto-approved. → verifier |
| G5 recruitment fee | 1,937,804 | Expense ledger has no legal ERP read. → verifier |
| G6 trial-day / travel | 642,673 | Agreed rate readable; days-claimed is write-only. **All eight have their own limits (800–2,000)**, all auto-approved. → verifier |
| G7 goodwill / overstay | 1,138,014 | 🔴 Gap on the **two big members only**; `Removing Bad Google Review` and `Overstay fines` now have live controls. |
| G8 WPS / service charge | 88,089 | Detail lines + 401 payment reads. → verifier |
| G9 maid salary | 578,577 | Ledger read documented but unread; ⚠️ `Maid's salary due to missing medical certificate` is **unauditable** — ledger 53%, notes 0%, approval 0%, detail lines 0%. |
| G10 taxi / passport | 44,752 | Only the receipt's **amount** is a control → verifier. **G-ATTACH fires on Taxi.** |
| G11 nationality switch | 45,296 | No confirmed ERP route yet; two calls would settle `getReplacementHistory`. → verifier |
| G12 other / referral | 230,713 | `Other` is reclassification-only; **`Referral Case` has no source at all** — every REFERRAL object in the warehouse is maid-side and this is a client bonus. |

## 18. A discrepancy worth a ruling

⓮ states the purpose list carries **both** `Pre-collected Salary` and
`Pre-collected Salary - No VAT` as separate purposes — that is its whole argument for
never deriving VAT. But G9 lists only `Pre-collected Salary` among its six, and the
partition totals 41 with that one entry. So either the `- No VAT` variant is folded into
G9's count, or the partition is 42 and one purpose is unassigned.

Not resolved here, and deliberately not guessed: an unmapped purpose returns `pending`
with the drift named, so a real `Pre-collected Salary - No VAT` row routes to a human
instead of being silently scored under the wrong VAT assumption.

## 19. Test coverage

- `scorer.test.js` — **38 cases**, the framing gates, the AED 0.50 basis and ⓫.
- `groups.test.js` — **27 cases**, the partition, G-ATTACH and group routing.
- **65 total, all green**, no regression on the original 38.

---

# Stage 2 — delivery, built 2026-08-30

**`Client Refunds · 2-Deliver (draft)`** — n8n `OznVXTRb1hApsYRH`, Adeeb project. Draft,
never published, never scheduled. Called by 1-Score as a sub-workflow.

```
Called by 1-Score → Validate Baton (assess) → Write Runs Row FIRST → May Deliver?
                                                                      ├─ yes → Build Case Rows → Write Case Rows → Build Reviewer Email → Create Draft
                                                                      └─ no  → Refuse After Logging (throws)
```

## 20. The runs log is written before the cases — and before the refusal

The spec: *"Runs log — written before the cases, so a failed run still leaves a record."*

The first build got this **backwards**, and the test caught it. `Validate Baton` threw on a
short case set, which aborted the run **upstream of the runs row** — so the run that most
deserved a record left no trace at all.

Now `Validate Baton` **assesses and does not throw**; the runs row is written with
`status = DELIVERING | REFUSED` and the reason; a `May Deliver?` gate stops the chain
afterwards. The refusal is still loud and still blocks both the workbook and the email —
it is simply recorded first.

Verified both ways:
- **Refused** (execution 110734) — *"1740 cases scored against a population of 1768 …
  The runs row was written first, so this refusal is on the record. No case rows were
  written and no email draft was created."*
- **Delivered** (execution 110735) — 2 cases through to a draft, no regression.

## 21. Three refusals, all in the false-negative direction

`Validate Baton` refuses a run that is: a **page-capped smoke run**; a **short case set**
(`scored != in_scope`); or a population whose **server-side month filter was not honoured**.
All three share a shape — fewer rows read as fewer findings — which is the direction
nobody notices.

`Build Reviewer Email` adds a fourth: the workbook write-back must return exactly as many
rows as there were cases, or no email is built. A report that does not match the sheet it
cites is worse than no report.

## 22. Where the sensitive data goes

| Destination | Carries |
|---|---|
| Cases tab | per-case rows **including staff-note text** — the only place it exists |
| Runs tab | counts, timings, status, refusal reason |
| Email draft | **counts, flags and totals only** — no names, no amounts, no note text |
| Run summary / logs | counts only |

`handlingExtraData: 'error'` on the Cases write: an audit workbook that silently grows a
column when the projection changes is one nobody can reconcile.

**The staff-note field question is now answered by the flow itself.** `Build Case Rows`
takes the first populated of `notes` / `managerNotes` / `description` / `rejectionNotes`,
writes the text to the workbook, and records **which key it came from** in
`note_source_key`. The run log reports **key names and counts only** — never values. So
the first real run settles open item 6 without anyone reading a note.

## 23. A credential auto-assignment worth flagging

On creation, n8n auto-assigned **another colleague's personal Gmail** to the draft node. A
draft is created in the **sender's** mailbox, so that would have put an audit report about
named clients into someone else's inbox, attributed to them — the same attribution problem
the ERP-token rule exists to prevent. Reassigned to the operator's own Gmail.

**Auto-assigned credentials need reading, not accepting.** The Sheets one was correct; the
mail one was not, and nothing in the success response flagged the difference.

## 24. Two values stage 2 still needs

- **The workbook.** The spec's `Google Sheet link` property is empty — no workbook exists
  yet. `documentId` is a picker placeholder; it needs a real sheet with `Runs` and `Cases`
  tabs. Colour-coding is set once in the sheet (conditional formatting on `verdict`); the
  Sheets node cannot apply it per write.
- **The reviewer's address.** Left as a `placeholder()`; the spec names Jacky as
  maker/checker but not an address.

---

# Build complete, 2026-08-31 — three stages chained, plus what testing found

```
1-Score  XNAeirfksS1dIpZl   form → prepare → ERP LEASE → config+checksum → population sweep
                            → score (⓫ + G-ATTACH + group routing) → summary → RELEASE LEASE
2-Verify xGXVJyGkPgZYIn0X   select unsettled → needs judgement? → model → normalise → apply
3-Deliver OznVXTRb1hApsYRH  validate → runs row FIRST → may deliver? → cases → email DRAFT
```

All three are DRAFT. Nothing is published, scheduled or activated.

## 25. One source of truth for scoring, generated into the node

The n8n Score node was a hand-copy of the scorer and **had already drifted before it ever
ran** — it knew nothing about group routing or G-ATTACH. A hand-copy of scoring logic is a
second implementation nobody tests.

`score-core.js` is now the only implementation. `build-node.js` inlines it into
`dist/score-node.js` with a thin n8n harness; `parity.test.js` executes that emitted body
in a sandbox with mocked n8n globals and compares every verdict, group and reason against
a direct call into the core. A drift now fails in tests rather than in production.

*(A regex tree-shake of the emitted body was tried and reverted — the optional doc-comment
group matched from an arbitrary earlier point and swallowed most of the file. The
replacement counts braces from the `function name(` line. Boring and correct.)*

## 26. Two real bugs, both found by running it rather than reading it

**Findings lost their group label.** `scoreRefundWithGroups` returned early on the findings
branch and stamped `group` only afterwards. So a FINDING — the case that matters most — came
out unlabelled: the run's group spread counted it as `(unrouted)` and it would have reached
the workbook with a blank group column. The unit tests missed it because they asserted the
verdict and never looked at the label. There is now one exit and one place the label is set,
plus a regression test on both paths. *(Executions 112408 → 112414.)*

**The verifier was being handed cases with nothing to read.** Every selected case went to
the model, including ones already settled as `NO TEXT` or `OVERSIZED` — a wasted call per
case, and an invitation to return a confident verdict on an empty note. Caught by the
by-index pairing guard rather than by inspection. A `Needs Judgement?` gate now sends only
cases with usable text; the rest bypass the model and rejoin through a Merge.
*(Execution 112415 → 112416.)*

## 27. The verifier, verified

Execution 112416, four cases, verdicts pinned:

| Case | Verifier said | Result | Rule |
|---|---|---|---|
| finding + note naming the missing approval | `JUSTIFIED` | → **clean** | only JUSTIFIED downgrades a red |
| finding + note claiming a receipt elsewhere | `PLAUSIBLE` | **stays a finding** | PLAUSIBLE cannot clear |
| … same case, note contradicts the purpose | — | routing gap added, **verdict unchanged** | a mismatch routes, never reds |
| pending, no note at all | `NO TEXT` | pending + **inconclusive** | unread is not absent |
| already clean | — | **never sent to the model** | the verifier only sees what the gates could not settle |

Counts recomputed after the verifier: findings 1, pending 1, clean 2. Run record carries
`{judged: 3, vocabulary: {...}, downgraded: 1, inconclusive: 1, purpose_mismatches: 1}` —
the gap between matched and verified, reported rather than collapsed.

## 28. The ERP lease is wired, and it proved itself by refusing

Stage 1 acquires the shared lease (`9gVijqvtLVEhQZXz`) with `no_wait` before the first ERP
call and releases it **immediately after the last one** — before the verifier, so an LLM
pass over ~1,700 notes cannot block every other audit for the duration.

Execution 112412 **refused to start**: the lease was held by `change-of-status` and this run
was queue position 3. No ERP call was made. That is the integration working — per-flow
pacing bounds one flow to 4 req/s and says nothing about two, and bursts are what got the
ERP account disabled in June 2026.

## 29. Test inventory

**Offline — 87, all green.**
- `scorer.test.js` 38 — framing gates, the AED 0.50 basis, ⓫
- `groups.test.js` 31 — partition, G-ATTACH, group routing, group-label regression
- `parity.test.js` 18 — emitted node body vs core, plus output hygiene on the emitted node

**In n8n — every stage exercised against pinned data:**
- 112414 — 1-Score: 3 refunds → 2 findings, 1 pending; groups G2a/G7 stamped; `note_key_coverage` reported by key
- 112412 — 1-Score: lease correctly refused, no ERP call
- 112416 — 2-Verify: all five verdict behaviours above
- 110735 — 3-Deliver: delivered, draft created
- 110734 — 3-Deliver: refused a short case set **after** writing the runs row

**Not yet exercised, and worth saying plainly:**
- The **live ERP legs** — both endpoints are still 401 for this account. Every ERP response in every test above is pinned.
- The **chain end to end in one execution**. Execute Workflow nodes cannot be pinned, so a full-chain test would hit the real lease, spend real model calls and attempt a real Sheets write against a placeholder document. The stages are wired and each is proven in isolation; the seam between them is verified structurally, not by execution.
- The **real Sheets write and Gmail draft** — no workbook exists yet and the reviewer address is a placeholder.

---

# The workbook exists, 2026-09-01

**`Client Refunds audit workbook`** — `1kuLvDBjXvxfiOWZh-ds0P0hlNV331_hjQorwnKVaNtQ`
in Drive → **Audits** (`1DyG9PHws8-52t_vNN96ZAh-T0Ewpoh1w`). Two tabs, both header rows
written. Both Sheets nodes in 3-Deliver now point at it by id.

Created by a one-off flow that **refused to create anything until exactly one folder named
`audits` was found** — zero matches or several would both have stopped the run and named
what they found. An audit workbook in the wrong folder is the kind of mistake discovered
months later by whoever goes looking for it. It found exactly one, "Audits". Both throwaway
copies are archived so nobody re-runs one into a duplicate workbook.

Headers were written through the Sheets API rather than the Sheets node, because `append`
maps onto an existing header row and a brand-new tab has none.

| Tab | Columns |
|---|---|
| `Runs` | 14 — run_id, audit_month, started_at, mode, population_declared, rows_pulled, in_scope, scored, findings, pending, clean, coverage_gaps, status, refusal |
| `Cases` | 18 — the 12 deterministic fields plus inconclusive, verifier_verdict, verifier_quote, verifier_reasoning, purpose_mismatch, evidence_link |

## 30. An integration gap the workbook exposed

`Build Case Rows` emitted only the deterministic fields. So everything 2-Verify produces —
its verdict, the sentence it relied on, the inconclusive flag, the purpose mismatch, the
evidence link — was being computed and then **silently dropped on the way to the sheet**.
The projection and the schema now match the 18-column header exactly, which matters
because that write runs with `handlingExtraData: 'error'`. Verified: execution 112994 puts
all 18 columns in header order with the verifier fields populated.

## 31. ⚠️ Credentials are not shared with the Adeeb project — 3-Deliver will fail on this

The first attempt at the workbook flow died with:

> Node "Find Audits Folder" does not have access to the credential.
> Please make sure that the credential is shared with the project "Adeeb".

**Hassan's Google credentials live in his personal project; the audit flows live in Adeeb.**
The one-off was moved to the personal project to get the workbook made, but **3-Deliver
sits in Adeeb and uses the same two personal credentials** — `Hassan Maids Account`
(Sheets) and `Hassan Maids Gmail` — so it will hit exactly this error on its first real
delivery. Every test so far pinned those nodes, which is why it has not surfaced yet.

**The fix is to share those two credentials with the Adeeb project** — one setting each, and
it keeps attribution correct. The alternative, switching to the Adeeb-project Google
credentials, means the workbook writes and the draft email land under a colleague's account:
the same attribution problem as the ERP token, and it was already caught once on this build
when auto-assignment reached for another colleague's Gmail.

## 32. Still to do by hand, once

Colour-coding is conditional formatting on the `Cases!verdict` column, set once in the
sheet — the Sheets node cannot apply formatting per write. Suggested: red on `finding`,
amber on `pending`, green on `clean`, grey where `inconclusive` is `YES`.

---

# Production-readiness pass, 2026-09-01

## 33. The ERP lease was removed, on request

Stage 1 no longer takes the shared lease. Removed: `Acquire ERP Lease`, `Lease Granted?`,
`Stop - Another Audit Holds ERP`, `Release ERP Lease`, and `Resume Baton` (which existed
only to pick the payload back up after the release replaced it).

**What still protects ERP:** this flow's own pacing — one request in flight, 500 ms apart,
2 req/s against the ERP-LOAD-POLICY §1 ceiling of 4 — on a run of roughly 45 calls, against
the thousands the lease was designed for.

**What is given up, stated plainly:** two audits can now hit ERP at the same time. Per-flow
pacing bounds this flow and says nothing about a second one. The lease had already proved
itself once on this build by refusing a run while `change-of-status` held it.

## 34. Production settings on all three

`executionTimeout` 2400s, `timezone` Asia/Dubai, error **and** success run data retained,
`callerPolicy` restricted to same-owner workflows on the two sub-flows.

## 35. The verifier was failing every second case, and it was not the model

Two live runs both failed the item at **index 1** with `{"error":"Bad request - please check
your parameters"}` while index 0 succeeded — the same position each time, regardless of note
content. Positional, not evidential. With `batchSize: 5` the calls fire concurrently against
a shared parser subnode, and the second concurrent call was rejected.

The fallback behaved correctly throughout — an unparseable verdict became `READ FAILED` and
`inconclusive`, never a clearance — but a verifier that turns half its cases into human work
for a formatting reason is quietly doubling the review queue.

**Fixed by running serially:** `batchSize: 1`, 200 ms apart. `autoFix` is also on the parser
now, so a badly-shaped response gets one repair attempt before the fallback.

⚠️ **This fix is UNVERIFIED.** Confirming it needs a live model call, and the standing
instruction is now pinned-data testing only. The pinned tests cannot exercise it: pinning
`Judge Note` replaces exactly the node under test. **First real run should check the
`verifier.vocabulary` counts — a `READ FAILED` rate near 50% means the fix did not take.**

## 36. What the verifier actually did on live notes

Worth recording, because it is the only evidence of judgement quality so far:

- Note: *"COO signed this off verbally on 3 July, approval ticket 8891 raised after the fact"*
  against a missing-approval gap → **UNRESOLVED**, reasoning that a verbal approval is not a
  recorded one and a retroactive ticket is not a pre-approval. It refused to clear it.
- Note: *"client cancelled mid-month"* against the same gap → **NOT RELATED**, reasoning that
  the note explains the cancellation timing and says nothing about approval.

Both are the right call, and both are the *hard* direction — declining to clear on a
plausible-sounding note is exactly what ❷ warns is the most common trap in this data.

## 37. ⚠️ Test runs touched production artifacts

Executions 113040 and 113050 were run as pinned tests, but **Execute Workflow nodes cannot be
pinned**, so the chain ran for real: roughly four live Anthropic calls, and 3-Deliver wrote
**two rows into the Runs tab** of the real workbook with `status = REFUSED`. No case rows and
no email draft — the smoke-run guard blocked both.

The rows are honest records of runs that happened, but they are test artifacts and should be
cleared before the first real run so the Runs tab starts clean.

**From here: pinned-data testing only, and the chain is not to be executed again until the
grants land and a real run is authorised.** A pinned test of stage 1 with the sub-workflow
calls disabled (execution 113058) is the safe shape and confirms stage 1 after the lease
removal.

## 38. Notion is updated

`Status` → **Built on n8n — Staging**. `n8n Staging Link` → 1-Score. `Google Sheet link` →
the workbook. `Flow Version` → v1.0 (staging, draft). `Skeleton Version` → records that this
was not cloned from a golden but built on the golden rails by hand. `Last Reviewed` → today.

A **"Built on n8n — staging"** section was added to the page body carrying all three flow
links, the workbook, what the two live gates are, the five blockers, and the lease removal
with its trade-off. The url property holds one link only, which is why the full set lives in
the body.

---

## 39. The publish route is SD, not a free-form Jira task

Every n8n non-chatbot flow reaches production through **one** route, set by Maya Ali's
standardisation email: an **SD (Service Desk)** ticket, issue type **n8n Flow**, in her
template, routed SD → Technical Analyst (business logic, conflicts) → PM → **NF / Ali
Hachem** (stress test, infinite-loop check, security validation, deploy). NF then adds a
read-only production mirror link to its own ticket. **We do not deploy, and filing is not
going live.**

Two required Jira fields have fixed dropdowns and reject anything off-list:

| Field | Key | Value for this check |
|---|---|---|
| Company Department | `customfield_10822` | `Money Control` (id 12011) |
| Accountable PIL | `customfield_10825` | **ask** — it decides who is answerable in production, so it is never inferred from whoever ran the session |

**Tickets missing artifacts are rejected**, and a rejection costs a full routing cycle. The
required artifacts are the flow export `.json`, the workflow link, and the credential
**names** (never values). The Atlassian MCP cannot upload files, so the three `.json`
exports have to be attached by hand after the issue exists — nobody should assume that
happened because the ticket got created.

### What must not go in the ticket

- **No secrets.** Credential names exactly as the n8n dropdown shows them, nothing else.
  Our three: `Hassan LangCC` (Anthropic), `Hassan Maids Account` (Google Sheets),
  `Hassan Maids Gmail` (Gmail). The ERP token is not a credential at all — it is a per-run
  form field, which is the point.
- **No run details.** No execution ids, run counts, findings tallies, sample records or
  amounts observed. SD is widely readable and this check reads notes carrying IBANs; live
  figures also date immediately, and narrative buries the mandated fields so a reviewer
  scanning for artifacts calls one missing. State capability, not results.

### Blocking the export itself

3-Deliver's Gmail draft node still carries a `__PLACEHOLDER_VALUE__` in `sendTo`. An export
taken today attaches that placeholder to the ticket. Fill the reviewer address (blocker 3)
**before** exporting.

### Self-containment

Step 1b of the publish skill requires the flow to stand on its own — NF deploys a workflow,
not a workflow plus somebody else's. The shared ERP lease is already gone (§38). What
remains is our own chain: 1-Score holds Execute Workflow nodes referencing
`xGXVJyGkPgZYIn0X` and `OznVXTRb1hApsYRH` by **id**. Those ids are ours and travel in the
same submission, but they are ids — if NF re-imports the three flows anywhere the ids
change, and 1-Score must be re-pointed. That belongs in the ticket as a deployment note, not
discovered at run time.

### Enhancements and bugs later

Same template, same route, a **new** SD ticket linked to the original with `Relates`. The
deployed flow's ticket is never reopened or edited — including for API failures.
