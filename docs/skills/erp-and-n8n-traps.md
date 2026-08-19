# ERP and n8n traps

Every item here was learned by hitting it. Read before Phase 1. Items marked **[LIVE-PROVEN]**
were confirmed against production; items marked **[SOURCE-ONLY]** come from reading Java and
have NOT been probed — treat those as hypotheses, because three separate "blockers" in the MV
Monthly spec were asserted from source and later disproven by a single payload read.

---

## 0. Environment facts — do not re-derive these

| Thing | Value |
|---|---|
| n8n project for all audit checks | **`Adeeb`** — team project, id `gxKXV4pckO4b4pQM` |
| n8n instance | `https://sami-team.app.n8n.cloud` |
| ERP backend base URL | `https://erpbackendpro.maids.cc` |
| ERP front end (origin/referer headers) | `https://erp.maids.cc` |
| Notion spec home | *Audit Flow Factory* → per-category *Checks —* databases |
| Rule bodies live in | *Audit Conditional Policy — \<category\>* (one page per rule) |
| Field/endpoint records live in | *ERP Variables Database* |

`search_projects` with a query like "audit" returns **nothing** — the project is named after a
person, not the work. Go straight to `Adeeb`. Audit workflows are NOT in the personal project.

### How to probe, and who to ask

**Probe the ERP with plain `curl`.** That is the house method — direct requests, one per
surface, paced. You do not need an n8n workflow to answer "does this route work"; build the
throwaway n8n probe only when you specifically want the run to happen inside n8n with its
credential binding. Curl first, it is faster and the output is easier to read.

**Any question about an ERP API — what a route does, what a field means, where a value comes
from, which module owns it — goes to LCP (ask-the-code).** Do not guess from field names and
do not reason it out from the payload alone; LCP reads the actual Java. It is the same
platform that answers "where do I get X from".

```
POST https://erpbackendpro.maids.cc/lowcode/c2d/query/async
GET  https://erpbackendpro.maids.cc/lowcode/c2d/session/{conversation_id}/messages?page=0&size=8
Headers: Authorization: $ERP_AUTH_TOKEN   secc-ch-ua-platform: $ERP_SECC_PLATFORM
         pageCode: lc_conversation        Content-Type: application/json  (submit only)
Body:    {"question":"...","project_alias":[],"model":"claude-opus-4-8-high",
          "repo_type":"erp","multi_workspace":true,"manual_rule_ids":[]}
```

- Submit → poll → read. `success` may be `false` even on success: the request succeeded iff
  `data.conversation_id` is present. Answer is ready when an assistant message has
  `request_status = 2` and a matching `request_id`. Markdown in `content`.
- `project_alias: []` searches all modules. Pass `session_id` to continue a conversation.
- A timeout does **not** cancel the job — re-poll the same `conversation_id` rather than
  re-asking. Prefer several small focused questions over one heavyweight one.
- If a model is rejected, retry with `"model": "auto"`.
- In the AI_Experience-Automation repo this is wrapped as `scripts/ask-code.sh "question"
  [module_aliases] [session_id]`, reading `.env`.

**LCP uses the same `ERP_AUTH_TOKEN` as the REST probes**, so a single token paste from the
operator unblocks probing *and* code questions. When a probe returns something surprising —
an unexpected 401, a field that looks absent, a filter value that seems to be ignored — ask
LCP before concluding. Several of the traps in this file exist because someone concluded from
a payload what the source would have told them outright.

**Golden flows to clone rails from** (newest architecture last):
- `Travel Assist Payments Audit` (`LM7ofq89VWXiLRU0`) — the original golden.
- `CC Non Received Monthly Payments` (`Qq473Ygj543jxPUN`) + its `· 2-Verify` / `· 3-Deliver` stages.
- `CC Price by Cohort · 1-Score / 2-Enrich+Score / 3-Deliver` — the current best staged chain.
- `PREFLIGHT - CC Price by Cohort (throwaway)` (`psroZBP7aFtiwnzz`) — **copy this for Phase 2.**
  It already has the paced probe matrix, `fullResponse`+`neverError`, the denial-shape
  classifier and a key-path walker that reports paths without leaking values.
- `CC Below Agreed · 0-Sweep Payments` / `0-Sweep Statuses` / `0-Enrich Candidates` — the
  sub-workflow pattern for keeping a huge payload out of the parent's retained data.

---

## 1. Authentication

**The token is a runtime payload, never a stored credential.** The working pattern, lifted from
the golden flows: a Webhook trigger receives `{bearer, token, device}` and every HTTP node sends

```
authorization: {{ $('Run Preflight').first().json.body.bearer }}
cookie:        authTokenProduction={{ ...body.token }}; deviceIdProduction={{ ...body.device }}
pagecode:      <per-surface>
accept:        application/json, text/plain, */*
origin:        https://erp.maids.cc
referer:       https://erp.maids.cc/
```

Both the `authorization` header **and** the cookie pair are sent. Do not assume one suffices
until probed.

**Stored ERP credentials in the `Adeeb` project are stale by design** — e.g. `ERP Token 12th Aug
2026`, `ERP Hassan Prod`. They are dated snapshots. A credential named for a date is almost
certainly expired; ERP tokens are short-lived. You also cannot read a credential's secret through
the MCP, so "try the existing credential" means binding it in a throwaway node and executing —
and it cannot supply the numeric device id at all. In practice: **ask the operator.**

**A dead token does NOT return 401.** It returns the *498-inside-500* shape — HTTP 5xx whose body
contains `Access Token is missing or malformed` or `498`. Say "that token is expired, I need a
fresh one", never "the server errored".

### The denial shapes, with their real discriminators **[LIVE-PROVEN 2026-08-19]**

Several distinct causes all present as HTTP 401. The `developermessage` **response header** is
what separates them — read it on every failure:

| `developermessage` | Meaning | What to do |
|---|---|---|
| `PAGE_CODE_MISSING` | pagecode header absent or empty | send one |
| `API_NOT_FOUND_FOR_PAGE` | route not registered for that pagecode | use the correct pagecode |
| *(absent)* on a 401 | genuine permission gap | request the permission — **this is a finding** |
| 5xx containing `498` / `malformed` | dead or expired token | get a fresh token |
| 5xx naming `SecurityException` | dynamic-API executor not authorised | different owner, different request |

Probe the documented pagecode **and** a plausible alternative, because a wrong pagecode and a
missing permission are indistinguishable without that header.

**A 400 is worth reading too.** Spring names the missing parameter outright
(`Required request parameter 'messageType' ... is not present`), and an invalid enum value names
the enum class. Two 400s in sequence discovered a required-parameter pair that no spec recorded.
But an invalid enum does **not** list its constants — ask LCP for those rather than guessing,
because a wrong-but-valid enum value can return HTTP 200 with the wrong data.

**Never route around a permission gap on a borrowed token.** A route once documented as
"verified" turned out to be refused on the auditing account because the original check was made
on a different login. If the operator's token lacks a permission, **that is a finding**.

---

## 2. Pagination — the single most expensive trap **[LIVE-PROVEN]**

### `POST /clientmgmt/contract/search/page`

**Page 0 caps at 40 rows no matter what `size` asks for, while offset stays `page × size`.**
So a `size=500` walk requests offsets 0–39, then 500–999, and **never asks for 40–499**. On one
CC cohort that silently lost **460 of 2,950** contracts and the loop terminated cleanly on an
empty page, looking entirely correct.

The API is not dropping rows. Every loss is client-side — offsets we never requested.

**The fix is a two-pass sweep, NOT `size=40` everywhere.** `size` is honoured on every page
except the first (live-probed):

```
page 0, any size           -> offsets 0–39         =  1 call
HEAD pass, size=40,  p1–12 -> offsets 40–519       = 12 calls
TAIL pass, size=500, p1–46 -> offsets 500–22,999   = ~46 calls
                                            total  = ~58 calls for 22,825 contracts
```

A flat `size=40` walk costs 571 calls on MV and blows the run budget — it is the intuitive
reading of this trap and it is wrong.

**Read `response.total`, not `response.clients.totalElements`.** The nested field is capped by
`Math.min(totalElements, limit)` and reports at most 40. The outer `response.total` is the true
uncapped count. Reconcile with a **tolerance, not equality** — the table moves under a sweep
(22,825 vs 22,823 six hours apart, same day).

**Page 0 returns the NEWEST rows.** Any sample from page 0 is a sample of new contracts. Never
quote a rate off page 0.

**The cap is route-specific — now confirmed by probe, 2026-08-19.** `/contract/search/page`
caps page 0 at 40; `/accounting/payments/page/advancesearch` **does not** — it returned all 127
rows at `p0 size=500`. So one call reads a whole contract's ledger. Never inherit a cap belief
across routes: probe each route's boundary before costing a sweep against it. Getting this wrong
in either direction is expensive — assuming the cap where it does not exist multiplies your call
budget by ~10.

**This route also requires a pagecode**, despite a source reading that said otherwise. Empty
pagecode → 401 `PAGE_CODE_MISSING`. The working value is **`ClientList`**. The "no pageCode
required" note came from reading `CurrentRequest.getSource()`, which is a different mechanism
from the gateway check that actually rejects the call — a good example of why **[SOURCE-ONLY]**
findings need a probe before they go in a spec.

### `POST /clientmgmt/contract/search/page` — IT WILL 503 THE WHOLE MODULE IF YOU SWEEP IT HARD

**[LIVE-PROVEN 2026-08-19, the expensive way.]** A sweep of ~116 requests at `size=500`, 5
concurrent with 500 ms between batches, took the **entire clientmgmt module** to
**HTTP 503 Service Temporarily Unavailable** — nginx-level, not an application error. Afterwards
even `page=0&size=1` 503'd, and `get-client-details` 503'd too, while `/accounting/*` stayed
healthy. The module had been probed healthily minutes earlier, `size=500` pages included.

**Call count is not load.** ~58 calls per cohort reads as cheap and is not: each `size=500`
response carries 500 nested contract records, and two cohorts were swept five at a time. That is
far heavier than any human ERP session. The spec's "never sweep at width" warning is written
about the payments endpoint — **carry it over to this one.**

So when sweeping the population on production: **serial or at most 2 concurrent, `size` 40–100,
longer intervals.** More calls, survivable load. And **put a circuit breaker on the first 5xx** —
a sweep that keeps firing ~100 more requests into an already-failing module, and only notices at
the reconcile step afterwards, makes the outage worse than the bug.

The one thing that saved it: the population guard reconciled the short sweep and **aborted rather
than scoring a partial population**, so the run produced no false clearances. Build that guard
before you build the sweep.

### `POST /accounting/payments/page/advancesearch`

Its pagination envelope is **honest**, unlike contract search. But a second trap fires here:

**Page 0 returns the newest rows, and on MV the newest rows are all FUTURE instalments.** Reading
page 0 only, at `size=50`, a target month came back EMPTY for a contract that does carry a
bounced payment — because that contract's newest 50 rows are future instalments. **"Not on page 0"
reads exactly like "does not exist."** Walk every page and assert `pulled == totalElements`
before trusting any negative. (`size=40` gives contiguous offsets; `size=50` skips 40–49.)

**This endpoint took the Accounting module down, and a date-range sweep is genuinely not
viable — measured, not feared [LIVE-PROVEN 2026-08-19].** A *single day* filtered to one payment
type took **73 seconds** and reported `totalElements` = **45,061**. `operation: "between"`
returns HTTP 500 (`NullPointerException`). Sequential only, scoped by `contract.id`. Body is a
filter **array**, not an object:
`[{"property":"contract.id","operation":"=","value":"<id>"}]`, `pageCode: PaymentReport`.
Supported operations seen working: `=`, `>=`, `<=`.

**Per-contract reads cost ~1.6 s each** (14 reads, mean 1.60 s, max 2.09 s). Budget from that
number, not from a guess: ~23k contracts is ~2 hours at 5 concurrent with 500 ms between
batches — fine for a manual monthly run, provided it is chunked across staged executions so no
single execution retains the payloads.

**`size=500` does NOT always cover one contract's ledger.** In the same 14-contract sample one
contract had **689 rows**. Page until `pulled == totalElements` and abort the case otherwise —
without that, the missing rows read as "this month has no payment", which is a manufactured
finding or a manufactured clearance depending on the month.

---

## 3. Recount the call budget — specs systematically undercount

A spec will cost the population sweep and silently omit per-entity enrichment. **Multiply
properly: per-contract calls × population.**

Worked example that changed an architecture: the MV Monthly spec said "population sweep ≈ 58
calls + one payment-history walk per contract at 1–11 pages ≈ **3,000–8,000** payment-search
calls". But its own population row says **22,825** contracts. 22,825 × 1–11 pages is
**23,000–250,000** calls, not 3,000–8,000 — the figure had been computed against a ~2,950-contract
CC cohort and carried over. That is 30× low, on the endpoint that has already taken a module down.

The parenthetical "(~2,950 contracts measured 2026-08-11)" in that spec is a **transcription of
the CC cohort size**, not MV's. Watch for a population figure quoted in one section that
contradicts the variable row in another.

**The fix pattern:** replace per-entity enrichment across the whole population with a
**windowed sweep + candidate-only enrichment**. Sweep the audited month once (paged) to get every
row for that month across all contracts, join in memory, then enrich only the contracts that look
like candidates. Turns 250,000 calls into ~100 + (candidates × k).

---

## 4. Payment-row semantics **[LIVE-PROVEN]**

- **KNOW THE WHOLE STATUS ENUM BEFORE YOU CLASSIFY. `PaymentStatus` has 14 constants**
  (`PaymentStatus.java:15-29`) **[LIVE-PROVEN 2026-08-19]**. A spec that lists five is not a
  vocabulary, it is a sample:

  | Category | Constants |
  |---|---|
  | Collected | `RECEIVED` |
  | In flight | `PDC`, `PRE_PDP`, `ADCB_PDC`, `DEPOSIT`, `FROZEN`, `REQUESTED` |
  | Dead | `BOUNCED`, `DELETED`, `TEARED_UP`, `RETURNED_TO_CLIENT`, `UNCOLLECTED`, `CANCELLED`, `CANCELLED_WAITING_CLIENT_PICKUP` |

  "Never treat an unrecognised status as dead — unknown counts as in flight" is a sound safety
  net and a **catastrophic** substitute for knowing the enum. Applied to a five-value list, it
  silently reclassifies **five dead statuses as in flight**, where they "cover the gap" and park
  a real finding in `pending` forever. A month whose only row is `UNCOLLECTED` — money
  explicitly written off — never gets reported. Enumerate all 14, then keep the net for values
  genuinely outside the enum, and surface those on the case rather than absorbing them.
  `RETURNED_TO_CLIENT` is "cheque handed back, never collected" (UI "Returned to family"), not
  a reversal. **No status means collected-then-refunded** — a real reversal is a separate
  payment of a refund *type* plus a `ClientRefundToDo`.
- **The type vocabulary is longer than any spec's too.** A 14-contract sample carried six codes
  absent from the spec: `insurance`, `overstay_fee` (the spec said `overstay_fine`),
  `Urgent_visa_charges` (mixed case), `non-mp-refund` (hyphenated), `service_charge`, `oec`.
  Before red-flagging "unrecognised type", ask which direction the error runs: if unrecognised
  rows are merely *excluded* from a sum, the month looks **less** paid, never more — so a
  blanket red just floods the queue with clean contracts. Red on an **absent** code; surface an
  unrecognised-but-present one.
- **`status.value` is authoritative; `status.label` lies.** On all 117 future instalments of one
  contract, `status.value` = `PDC` while `status.label` = `PDP`. Testing `status == 'PDP'`
  matches nothing, silently, forever.
- **A `RECEIVED` row can be `0.00`.** "A RECEIVED row exists for this month" and "this month was
  paid" are different tests. **Always SUM `amountOfPayment`, never count rows.**
- **The amount field is `amountOfPayment`.** There is no `amount` key (22 keys read live). An
  older variable row claiming `amount` was wrong and cost a reconciliation.
- **`dateOfPayment` is the due date; `dateChangedToReceived` is when the money landed**, and they
  routinely differ. Scoping a month on the settlement date leaves a late-paid month falsely open
  and the following month falsely closed.
- **Most rows are the future.** 117 of 127 rows on one contract were future `PDC` instalments. So
  "no payment row at all" is close to unreachable — a *row-count* test never fires. The real test
  is "no row for this month reached RECEIVED".
- **Replacement chains are contract-wide events**, not per-payment accidents:
  `DELETED → BOUNCED (replaced=true) → RECEIVED`, all on one date, and the same contract's other
  fee types show the identical pattern on the same date. Sampled live, **20/20 CC and 14/14 MV**
  bounced contracts had already settled by replacement. A bounce bucket audited without walking
  the chain produces hundreds of cases against money already collected.
- **`replaced = true` is not proof of settlement.** It marks that a successor exists, not that the
  successor was paid. Follow it to a `RECEIVED` row. `replaced = false` is the discriminator that
  separates a real red from a healed month.
- **Never widen a status filter to `RECEIVED or replaced = true` to sum money.** ERP's own
  predicate is a per-row *obligation satisfied* test, not a sum; widening double-counts and turns
  real shortfalls green.
- **The type filter does more work than it looks.** One contract had **eight** rows on a single
  date, only three of them monthly. Dropping the type filter made the month read 1,743 instead of
  168 — which *clears* the month against an expectation of 1,638 and hides the real shape.
- Watch for near-miss type names: `Monthly Payment` vs **`Monthly Payment Add-On`**. Match the
  literal exactly.

---

## 5. Contract-payload semantics **[LIVE-PROVEN]**

- **Walk nested objects before recording a field as absent.** Three separate probes enumerated
  only top-level keys and concluded `workerSalary` / `visaFees` did not exist. They were one level
  down, in payloads already saved on disk. This produced a five-day false blocker, twice.
- The plan split is on **`currentPayments[]` — PLURAL**. `currentPayment` (singular) is a display
  summary carrying no split. `workerSalary + visaFees == amountValue` exactly on all four active
  contracts read.
- **Never default a null split to zero.** On a terminated contract all three money fields come
  back `null` with `status: ""`. Zeroing makes the expectation the fee alone and manufactures a
  large false shortfall. Missing means **expectation unknown — halt the case.**
- **Do not use `nextMonthlyPaymentAmount`.** It holds the *next scheduled* payment and comes back
  empty when none is scheduled — including on contracts still `ACTIVE`. A blank expectation makes
  every amount look correct, or every amount look like a total shortfall, depending on the default.
- **Boolean-ish flags are not constant across a population.** `isWorkerSalaryVatted` was `true` on
  four contracts and `false` on a fifth in the same product line. It also sits **top-level**, not
  on the per-payment row where you would look for it.
- **Absent dates come back as `''`, not `null`; present ones are datetimes.**
  `dateOfTermination` / `scheduledDateOfTermination` are empty strings when unset and
  `"2026-03-03 23:00:10"` when set, and `contractStartDate` is a datetime too. Any date handling
  must treat `''` as absent, and must compare at **month** granularity where the rule is about
  months — two verified reds in one check terminate *inside* the audited month and survive only
  because the comparison is month-to-month. A date-to-date test deletes them silently.
- Money can arrive as a **formatted string** (`"AED 1,743"`). A naive `float()` throws. Parse it.
- Specialised arrays carry **dead rows**. One `currentPreCollectedPayments[]` returned the same
  amount and date twice, once `RECEIVED` and once `BOUNCED`, because the source query filters only
  `amount > 0 AND status <> DELETED`. Sum the `RECEIVED` entries only; never count entries.
- A "flat mirror" field (`precollectedAmount`) mirrors the **first array entry**, which is correct
  only because of an ordering accident. Do not trust it.
- Such an array is **not the ledger** and can **overlap** it — on one contract the named advance
  *is* the same ledger row. Combining the two double-counts a month.
- **A filter value that isn't a real enum member still returns HTTP 200.** The contract-search
  handler branches on four status values and everything else — including `ACTIVE` and `null` —
  falls to an `else` returning active contracts. The live filter value was `FILTER_CANCELED`
  (one L); passing the genuine enum `CANCELLED` returns 200 with the full ACTIVE population. **A
  wrong value returns a wrong population with every gate still passing.**

---

## 6. Evidence-reading traps (the verifier layer)

- **Never conclude from ERP's `summary` field.** It is auto-generated compression and is frequently
  blank; the real text is in `initialDescription` plus the comment thread. Reading only `summary`
  wrongly stamped a documented ticket "NO TEXT".
- **A label or keyword match is not an explanation.** Of **105** tickets matched by label, only
  **17** genuinely justified the flag — 68 had no content at all and 3 were about something else.
- **Matched-but-unrelated is the most common false clearance** in every reason-finder this team has
  run. Evidence about a different month or a different fee bucket must not close this one.
- **The message log is one route with five different row shapes.**
  `GET /clientmgmt/client/smsLog/{clientId}` requires **`messageType`** AND **`emailSubject`**
  (required on every channel — pass it empty); omit either and you get a 400.
  `MessageType` = `SMS` | `EMAIL` | `NOTIFICATION` | `WHATSAPP` | `WHATSAPP_CONVERSATION`.
  The channels return *different fields*, so which one you pick decides whether a rule is even
  implementable **[LIVE-PROVEN 2026-08-19]**:
  - `SMS` → `creationDate` (populated on 20/20 rows), **no `sentDate` at all**
  - `WHATSAPP` → `sentDate` (populated 27/27), plus `deliveryStatus`, `templateName`
  Use **`WHATSAPP`** for a follow-up date: it is the only channel that can satisfy "asks for
  money, was delivered, dated by sentDate" simultaneously. A spec that says "date from
  `sentDate`, never `creationDate`, which is always null" was written against WhatsApp — on SMS
  that instruction is simply wrong in both halves.
- **A row is not a delivery.** `deliveryStatus` observed: `READ`, `RESPONDED`, `DELIVERED`,
  `SKIPPED`, `FAILED`. Only the first three are deliveries.
- **Win-back marketing is not chasing** — and neither is a receipt. The latest message is often
  a campaign (`CM_CLIENT_BROADCAST_*`, `PRE_SALE_CRM_CAMPAIGN_ACTION_*`); counted as a follow-up
  it *suppresses a real finding*. The subtler one: **`MV_PAYMENT_RECEIVED_NOTIFICATION` contains
  the word PAYMENT but is a receipt**, so a `/payment/i` match suppresses the very finding it
  should leave standing. Classify with chase patterns **plus an explicit deny-list**, deny
  winning, and treat an unclassifiable template (some names are bare numeric ids like
  `669348018255590`) as **not** a chase — that keeps the finding alive.
- **Message threads are page-size 20 with no pagination** on the history route — a justification
  past message 20 is invisible, and the case reads unexplained when it is not. Known limit.
- **A failed or empty evidence read is `unknown`, not `nobody did it`.** Absent evidence must halt
  a case, never satisfy a comparison. Write "no follow-up found in the message log since X",
  never "the client was never contacted" — a call or email would not appear there.
- **Relief lives in free prose, under field names a spec will get wrong.** On
  `CONTRACT_DETAILS` there is **no `discount` key**; the real fields are
  `paymentPlan.additionalDiscount` and `paymentPlan.creditNoteDiscount`, `''` when absent
  **[LIVE-PROVEN 2026-08-19]**. Each string carries an amount *and the bucket it applies to*
  ("Discount Amount: 0 applied on 2-year visa"), which is what makes "relief only clears the
  bucket its own text names" implementable at all.
- **Relief text has a duration.** "Discount Amount: 1000 applied on Service Fee over 4 months" is
  250/month, not 1,000. And a **zero credit note is a non-empty string**, so a truthiness test
  counts it as relief.
- **Do not assume a structured relief source exists.** No credit-note object with a redemption
  pointer was found on `CONTRACT_DETAILS`. When the only signal is prose, the safe design is to
  carry it as context and route to a human — never auto-clear.
- **Match the redemption pointer, not just the contract id.** Matching `contract.id` alone stamped
  AED 3,665 of real relief as "NOT tied" and produced a false escalation.

---

## 7. Warehouse (Snowflake) traps

- **Never let the warehouse be the authority** — it orients, the ERP confirms. Org policy, and
  also just true.
- **The catalogue lists objects without telling you whether their dependencies are readable.** A
  `BA_VIEWS...` view failed at *view-expansion* time for the querying role because it wraps
  `GOLD.*` objects the grant does not reach. The object appears to exist and then does not resolve.
- Honour the **~2h ingestion lag**: exclude the most recent ~2h before calling anything a "miss".
- Snowflake is excellent for *hunting a candidate red* to then confirm ID-scoped in the ERP. That
  two-step — hunt in the warehouse, confirm in the system of record — is how the MV Monthly check
  finally got a verified red after five days of failing to find one.
- **Never schedule a recurring warehouse pull** as part of a build. Route it to the ERP/Data team.

---

## 8. n8n build traps

- **Build through the MCP, in the `Adeeb` project.** Never hand-edit workflow JSON.
- Call `get_sdk_reference` and `get_node_types` before writing workflow code — guessing parameter
  names produces invalid workflows.
- **Wire credentials via `addNode`** — the only path that binds them — then read back and verify.
  Assert credentials *inside the run* too: build-time success does not guarantee runtime binding.
- **Probe with `fullResponse: true` + `neverError: true`**, or a non-2xx gets swallowed by the
  error rail and you will document a blocked surface as working.
- **Pace production ERP:** max 5 concurrent, 500 ms between batches. In n8n that is
  `options.batching.batch = { batchSize: 1, batchInterval: 500 }`. A handful of probes should be
  serial.
- **Retained data kills large runs.** Per-entity payload × population can be tens of MB in one
  execution. Push the heavy read into a **sub-workflow that returns a slim projection**, so the
  parent retains kilobytes. This is why the CC chain has `0-Sweep` / `0-Enrich` sub-workflows.
- **`alwaysOutputData: true` is a footgun** unless paired with a dedicated empty-case branch.
- **`success` status means the workflow did not crash, not that it did the right thing.** Read the
  execution output back, every time.
- **Deliver as a draft. Never publish, never schedule, never activate.**

---

## 9. Failure modes to expect in your own logic

Bugs found at this stage are usually **false clearances**, not crashes — they look like success.
The two most common:

1. **A later passing test overrides an earlier gate's routing decision.** Once a gate concludes,
   stop. Ordering is load-bearing: an exception gate placed before the gate that establishes the
   problem suppresses the problem entirely.
2. **A NULL comparison result is indistinguishable from a genuine match.** Unknown must halt, not
   satisfy.

Also expect, in specs specifically:

- **Internal contradictions** — a policy body and a test-case table giving different answers for
  the same case. Implement the more conservative reading, flag it, note both. Do not pick silently.
- **`Order` fields that contradict rule bodies.** A shared rule row cannot express two positions,
  and derivation rules are often numbered *after* the comparison that consumes them. Read the run
  position from the check page's own ordered list, and let derivations run before comparisons.
- **Rules that name tests nobody wrote down.** Score them NOT PASSED, route to human review, and
  **declare the inflation in the run summary.**
- **A red shape the rules cannot produce.** If a spec promises a finding type and no rule emits it,
  that is a defect in the spec, not in your reading.

---

## 10. Output hygiene — non-negotiable

- Per-entity amounts, identifiers and gaps go **in the case store** (Data Table / portal record).
- Chat, run summaries and logs carry **counts, flags and totals only**.
- **Never** print names, contact details or salaries anywhere. When confirming a field exists,
  report the **key path, not the value**.
- A case states the total owed and received, never the salary component broken out. From a message
  log, **only the date** leaves the check.
