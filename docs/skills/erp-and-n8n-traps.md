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

### The three denial shapes — they need different requests to different owners

| Shape | How it looks | What it means |
|---|---|---|
| `INSUFFICIENT_PERMISSIONS` | HTTP **401** | Either a missing permission **or a wrong `pagecode`.** Only the `developermessage` response header separates them. Probe the documented pagecode *and* a plausible alternative. |
| `SecurityException` | HTTP 5xx, body names `SecurityException` | The dynamic-API executor is not authorised for this account. |
| Dead token | HTTP 5xx containing `498` / `malformed` | Expired token. Not an access finding. |

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

**The cap is route-specific.** `CLIENTS_LIST_MAX_RESULTS_RETURNED` has no other consumer, so do
not inherit the belief for other routes — and do not assume page-0-only behaviour generalises.
Probe each route's boundary before costing a sweep against it.

### `POST /accounting/payments/page/advancesearch`

Its pagination envelope is **honest**, unlike contract search. But a second trap fires here:

**Page 0 returns the newest rows, and on MV the newest rows are all FUTURE instalments.** Reading
page 0 only, at `size=50`, a target month came back EMPTY for a contract that does carry a
bounced payment — because that contract's newest 50 rows are future instalments. **"Not on page 0"
reads exactly like "does not exist."** Walk every page and assert `pulled == totalElements`
before trusting any negative. (`size=40` gives contiguous offsets; `size=50` skips 40–49.)

**This endpoint took the Accounting module down.** Sequential only, scoped by `contract.id`.
Never a bare date-range sweep at width. Body is a filter **array**, not an object:
`[{"property":"contract.id","operation":"=","value":"<id>"}]`, `pageCode: PaymentReport`.

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
  four contracts and `false` on a fifth in the same product line.
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
- **`creationDate` and `dateOfMessage` return null on every row.** Date a follow-up from
  **`sentDate`**. Getting this wrong makes a "nobody chased" rule fire across the entire
  population and sends everything to the review queue.
- **A row is not a delivery.** One channel returned a row with every field null.
- **Win-back marketing is not chasing.** The latest message is often a campaign; counted as a
  follow-up it *suppresses a real finding*.
- **Message threads are page-size 20 with no pagination** on the history route — a justification
  past message 20 is invisible, and the case reads unexplained when it is not. Known limit.
- **A failed or empty evidence read is `unknown`, not `nobody did it`.** Absent evidence must halt
  a case, never satisfy a comparison. Write "no follow-up found in the message log since X",
  never "the client was never contacted" — a call or email would not appear there.
- **Relief text has a duration.** "Discount Amount: 1000 applied on Service Fee over 4 months" is
  250/month, not 1,000. And a **zero credit note is a non-empty string**, so a truthiness test
  counts it as relief.
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
