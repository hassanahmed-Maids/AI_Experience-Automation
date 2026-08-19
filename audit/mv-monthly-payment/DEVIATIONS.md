# MV Monthly Payment check — declared gaps, deviations and spec corrections

Every item here changes numbers or verdicts. Nothing below is silently absorbed.

---

## A. Spec defects found (corrections to file back to Notion)

### A1. The call budget is wrong, and the population figure is a CC number
*(revised 2026-08-19 after probing — the error is ~3×, not the ~30× I projected beforehand;
the payments route turned out not to share the population route's page-0 cap, which absorbed
most of it. Correcting my own earlier figure.)*
*Where do the results go?* says "~2,950 contracts" and "≈ 3,000–8,000 payment-search calls".
The `mv_contract_population` variable row records **22,825**. 2,950 is the CC cohort that lost
460 rows to the pagination trap, transcribed into the MV budget. The 58-call sweep figure is
correct (computed for 22,825); only the contract count beside it is wrong. Correct
per-contract walk cost is **22,825–251,075 calls**, not 3,000–8,000.
Probed 2026-08-19: population `response.total` = **22,867**. Per-contract ledger reads are
**1 call each**, not 1–11, because page 0 honours `size` on the payments route — so the
spec's own architecture costs ~22,867 calls, about 3× its high estimate rather than 30×.
Still too many for one execution on this endpoint.
**Effect:** changes the execution architecture. See `surfaces.md`. **File against:** the
*Where do the results go?* heading.

### A2. Gate 5 (Pre-Collected) contradicts the spec's own test cases 3 and 5
Gate 5's body: the month under test becomes the **previous** month. But contract 1099709
reads `isPreCollectedSalary = true`, and test cases 3 and 5 score it against **each month's
own** ledger rows with no shift. Applying the shift literally makes case 3 (2026-06) test
May 2026 — before the 26 Jun contract start — so a month the spec calls *clean* becomes
either no case or a false red, depending on gate order.
**Taken (conservative):** score the audited month on its own rows. Where such a month is
unsettled **and** the contract is pre-collected, conclude neither red nor clean — route to the
verifier with the advance attached. This avoids the false red the literal shift produces and
the false clearance that letting the previous month's money cover this one would produce.
**Effect:** inflates the inconclusive count by the number of unsettled pre-collected
contract-months. Declared in the run summary. **Needs an owner ruling to close.**

### A3. Gate 2's Order (110) contradicts the order Gate 5 (140) implies
Gate 2 bounds the month against the contract's life; Gate 5 changes which month is examined.
At face value Gate 2 runs first (110 < 140), so it must bound the **audited** month, not the
shifted one. Implemented that way. Recorded because the reverse order silently produces
out-of-scope verdicts on pre-collected contracts.

### A4. Derivation gates are numbered after the comparison that consumes them
Gates 9 (180), 11 (200) and 12 (210) derive the expected amount, but Gate 6 (150) compares
against it. Both bodies say they are derivations that "run before the amount comparison".
Implemented as derivations-first. Not a rule change — an ordering observation. The `Order`
column cannot express "derivation" versus "verdict".

### A5. `Order` cannot carry a per-check position (already known, restated)
Gate 15 is Order 50 for Travel Assist and runs **seventh** on MV. Read the run position from
the check page's ordered list, never from the row's `Order`. Schema limitation.

---

## B. Rules implemented with a conservative default — ALL THREE NOW RULED (2026-08-19)

> Superseded by owner rulings; see `OWNER-QUESTIONS.md`. Kept for the reasoning trail.
> B1 (`vVip`) → **both flags count**. B2 (materiality) → **no floor, but zero raises no case**.
> The pre-collected question in A2 → **the shift is a scope shift**, tested month is M−1.

### B1. Gate 13 — VIP: does `vVip` alone count? (`Pending Business`, owner **Malaz**)
**Default taken:** only `vip` clears; `vVip` alone does not. Narrower exception = fewer
clearances = no false clearance. Flag `vipRuleUnresolved` is set on every VIP clearance so the
population is countable either way, and a single option flips it (`vipCountsVVip`).
**Effect if the ruling goes the other way:** some currently-red amount mismatches become
`OK — VIP Exception`. No red becomes hidden today.

### B2. Materiality floor — none applied
Some `BOUNCED` rows carry **zero**, so they are not money and arguably should not open a case
(the v0.8 minimum bounced amount is 0). **Default taken:** floor = 0, i.e. flag everything.
Wired as a single option (`materialityFloor`) so a ruling is a one-line change.
**Effect:** inflates case count at the low end. The v0.8 distribution is heavily skewed —
AED 27,928 across 154 contract-months, average 181, min 0 — so a floor would remove a
meaningful share of rows and very little money.

### B3. Gate 17 — amount tolerance: none applied
The rule body already rules this: expected is the plan's own amount, so exact comparison is
the conservative default and a 1-fil gap flags loud rather than failing silent. Implemented
as stated. Listed here only because the rule notes it as an open question for Jacky.

### B4. Gates 13 and 14 clear only the amount-mismatch shape, never a timing red
Both sit at Orders 220/230, after the timing reds at 165/170, so by construction they can only
act on a mismatch that survived. This matches Gate 13's own Never ("a VIP client who simply
never paid closes green" is the thing to prevent). **Consequence to be aware of:** a month
fully covered by a credit note still raises a timing red, with the note carried as context.
Conservative on purpose — over-flagging costs review time, a wrong clearance defeats the check.

---

## C. Verdict caps — surfaces that degrade rather than block

Each of these caps a verdict and names the gap on the case. None defaults silently.

| Condition | Cap applied |
|---|---|
| Message log unreadable | 10-day rule not evaluable; **PIL blocked**; finding stands |
| Complaint thread unreadable / truncated past message 20 | "unexplained" not assertable; route to human |
| `is_pre_collected` unreadable | case halted (`inconclusive`), never assumed false |
| Split (`workerSalary`/`visaFees`) null | expectation unknown; amount test suppressed, never zeroed |
| `currentPayment.amountValue` absent | expectation unknown; amount test suppressed |
| Monthly row with no `dateOfPayment` | row not counted in-month; case routed to a human |
| Refund present on the contract touching the month | context only, never netted; **PIL blocked** |
| Discount text present | duration not parsed; carried as context, never as coverage |
| Credit-note route not yet located | Gate 14 relief unreadable → cases proceed, relief unproven |
| Split ≠ `amountValue` | case routed to a human |

---

## D. Evidential gap the spec still carries

The **amount-mismatch red (Gate 17) has no verified live example.** v0.8 closed the
missing/unsettled-month shape with two ID-confirmed reds (1023590 · 2026-03, 1074171 ·
2026-06) but the short-paid shape remains unproven against real data. It is covered here by
**synthetic** guards only, labelled as such in `scorer.test.js`.
`Test cases verified` cannot be ticked until one real short-paid month is found and confirmed
ID-scoped in the ERP.

Related: the pre-collected status of the two confirmed reds is **not recorded** in the spec.
If either is pre-collected, deviation A2 routes it to the verifier instead of concluding red —
which would be a regression against a verified red. **Probe target for Phase 2:** read
`preCollectedInfo.isPreCollectedSalary` on 1023590 and 1074171.

---

## E. Deliberately not covered (owner-ruled, do not re-open)

- Whether the maid's salary or agreed profit is *right*. A mispriced plan paid in full is
  **clean**, permanently — owner ruling 2026-08-17, verbatim: *"we don't care about the
  pricing, as long as the client paid what he was supposed to pay, mark it as closed."*
  Contracts 1019110, 1065197, 1065858 are out of scope by design.
- Any payroll file, as population, cross-check or fallback — owner ruling 2026-08-11.
- CC contracts, Travel Assist, Same Day Recruitment, one-off and biennial lines,
  second-year insurance.


---

## F. Corrections produced by probing (2026-08-19)

Each was found by probing, contradicts a written record, and is filed against the named row.

### F1. The population route DOES require a pagecode
`mv_contract_population` records *"No pageCode is required here — gated only by
@PreAuthorize"*. Sending an empty pagecode returns **HTTP 401 `PAGE_CODE_MISSING`**. The
working value is **`ClientList`**. The source reading was about a different mechanism
(`CurrentRequest.getSource()`), not the gateway check that actually rejects the call.
**File against:** `mv_contract_population.pagecode`.

### F2. The page-0 40-row cap does NOT apply to the payments route
`monthly_payment_amount` and `payment_due_month` inherit no cap claim, but the spec's
pagination callout and the "walk every page at size=40" fix imply one. Probed: the payments
route returns **all 127 rows at `p0 size=500`**. The cap is specific to
`/clientmgmt/contract/search/page`. One call reads a whole contract's ledger.
**File against:** the pagination callout on the check page, and the budget line.

### F3. The message log needs two undocumented required params, and the spec names the wrong channel
`last_followup_date` records the route as `GET /clientmgmt/client/smsLog/{client_id}` with no
parameters. Live, it requires **`messageType`** (enum) **and `emailSubject`** (required on
every channel; pass empty). Omitting either is HTTP 400.

Worse, verifier rule 3 says date a follow-up from `sentDate` and **never** `creationDate`
because the latter "returns null on every row". Probed:
- `messageType=SMS` → `creationDate` **populated on 20/20 rows**, and **no `sentDate` at all**.
- `messageType=WHATSAPP` → `sentDate` populated on 27/27, plus `deliveryStatus`, `templateName`.

The rule was written against WhatsApp. **`WHATSAPP` is the channel to read** — the only one
that can satisfy all three of the rule's tests. The claim that `creationDate` is null
everywhere is false for SMS and vacuous for WhatsApp (the field is absent, not null).
**File against:** `last_followup_date` (route + params) and verifier rule 3 (channel).

### F4. `contract_discount` names a field that does not exist
The row records `API Parameter Name: discount` on `CONTRACT_DETAILS`. **There is no `discount`
key.** The real relief signals are two free-prose strings on the plan:
- `paymentPlan.additionalDiscount` — e.g. *"Discount Amount: 0 applied on 2-year visa"*
- `paymentPlan.creditNoteDiscount` — e.g. *"Credit Note Amount: 0 applied on 2-year visa"*

Both are `''` when absent and, when present, carry an amount **and the bucket they apply to** —
which makes gate 14's "never let relief clear a bucket its own text does not name" directly
implementable. A **zero** discount is still a non-empty string, so the truthiness trap is live.

**No structured credit-note source with a redemption pointer exists on this payload.** Gate 14
therefore **never auto-clears from prose**: relief is carried as context and the case is routed
to a human. The structured path is retained behind an explicit opt-in for when that route is
found. **Effect:** removes an auto-clearance path. **File against:** `contract_discount`.

### F5. A new false-clearance shape in the follow-up classifier
`MV_PAYMENT_RECEIVED_NOTIFICATION` is a payment **receipt** whose name contains "PAYMENT". A
naive `/payment/i` match counts it as chasing and **suppresses a real finding** — the same
failure shape as counting win-back marketing, which rule 3 already names. The classifier
therefore uses chase patterns **plus an explicit deny-list** (receipts, confirmations,
broadcasts, campaigns, OTPs, birthday and VAT notices), with deny winning. Bare numeric
template ids are unclassifiable and do **not** count as chasing.

### F6. Both verified reds terminate INSIDE the audited month
1023590 terminated 2026-03-03 while auditing 2026-03; 1074171 on 2026-06-14 while auditing
2026-06. They survive gate 2 only because the comparison is **month-to-month**. A date-to-date
test — the intuitive implementation — would silently delete both of the check's only verified
reds. Recorded so nobody "tightens" gate 2 later. Also note `dateOfTermination` is `''` when
absent and a **datetime** when present.

### F7. `nextMonthlyPaymentAmount` is populated on some contracts
It read 1638.0 on 1099709. The spec's warning stands (it came back empty on others including an
ACTIVE contract), but "always empty" is not the reason to avoid it — it holds the *next
scheduled* payment, which is a different number from the audited month's expectation.

### F8. THE PAYMENT STATUS ENUM HAS 14 CONSTANTS, NOT 5 — five dead ones were being read as in flight
The spec names five statuses (`RECEIVED`, `PDC`, `BOUNCED`, `DELETED`, `PRE_PDP`). A live row
carried **`RETURNED_TO_CLIENT`**, which is in none of them. LCP returned the full enum
(`PaymentStatus.java:15-29`):

| Category | Constants |
|---|---|
| Collected | `RECEIVED` |
| In flight | `PDC`, `PRE_PDP`, `ADCB_PDC`, `DEPOSIT`, `FROZEN`, `REQUESTED` |
| **Dead** | `BOUNCED`, `DELETED`, **`TEARED_UP`**, **`RETURNED_TO_CLIENT`**, **`UNCOLLECTED`**, **`CANCELLED`**, **`CANCELLED_WAITING_CLIENT_PICKUP`** |

Gate 15 says *"never treat an unrecognised status as dead — any unknown value counts as in
flight"*. That is correct as a safety net and **catastrophic as a substitute for knowing the
enum**: the five bolded constants are DEAD, and under the unknown-is-in-flight rule each would
have **covered the month's gap and parked a real finding in `pending` forever**. A month whose
only row is `UNCOLLECTED` — money explicitly written off — would never have been reported.

This is a suppressed finding, and the most serious defect found in this build. Fixed by
enumerating all 14 explicitly; the unknown-is-in-flight net now applies only to values
genuinely outside the enum, and any such value is surfaced on the case instead of hiding.

`RETURNED_TO_CLIENT` is specifically *"cheque handed back, never collected"* (UI label
"Returned to family"), not a reversal of collected money. No status means collected-then-refunded
— a genuine reversal is a separate payment of a refund **type** plus a `ClientRefundToDo`, which
is why gate 16 reads types rather than statuses.

**File against:** `payment_status` / the check page's status vocabulary, and gate 15.

### F9. Gate 10's blanket red on "unrecognised type" would flood the queue
A 14-contract sample carried **six legitimate type codes absent from the spec's vocabulary**:
`insurance`, `overstay_fee` (the spec says `overstay_fine`), `Urgent_visa_charges` (mixed case),
`non-mp-refund` (hyphenated), `service_charge`, `oec`. Gate 10 reds on a type *"absent, or
holding a value outside the known set"* — which would have raised a case on every clean contract
carrying an insurance row.

The failure gate 10 actually guards against is an unrecognised type *"falling through the monthly
filter and closing the month green"*. That cannot happen: only `monthly_payment` rows are ever
summed, so an excluded row makes a month look **less** paid, never more.

**Taken:** absent or empty code → red (a genuine data problem, as specified). Unrecognised but
present → surfaced on the case and routed to a human, never summed, never a blanket red. This
keeps "never a silent exclusion" while avoiding a false-positive flood.
**File against:** gate 10, and the payment-type vocabulary.

### F10. A date-range sweep of the payment ledger is NOT viable — the spec's warning is vindicated
Probed narrowly (a single day, `size=5`): **73 seconds**, reporting `totalElements` = **45,061**
rows for one day of monthly payments across both product lines. An `operation: "between"` filter
returns HTTP 500 (`NullPointerException`).

So the windowed-sweep architecture I proposed in `surfaces.md` before probing is **withdrawn**.
The spec's rule — *"sequential only, scoped by `contract.id`, never a bare date-range sweep at
width"* — is correct, and this is the endpoint that has already taken the Accounting module down.

**Architecture now:** per-contract ledger reads, scoped by `contract.id`, paced, in
sub-workflows returning slim projections. Measured cost: **mean 1.6 s per contract** (14 reads,
max 2.1 s). At the spec's pacing (5 concurrent, 500 ms between batches) that is roughly
**2 hours** for 22,867 contracts — acceptable for a manual monthly run, and it must be chunked
across staged executions so no single execution retains the payloads.

### F11. `size=500` does NOT always cover a contract's ledger
Within the same 14-contract sample, contract 1011565 reported **689 rows** — `size=500` returned
500 and `pulled == totalElements` was **false**. One call per contract is the common case, not a
guarantee. The reconcile-before-trusting-a-negative rule caught it on the first small sample,
which is exactly why that rule exists: without it, that contract's later months would read as
having no payment rows at all.
**Effect:** the ledger reader must page until `pulled == totalElements` and abort the case
otherwise. Never trust a negative from a single call.

### F12. THE POPULATION MISSES BOTH VERIFIED REDS — cancelled contracts are not in the default sweep
Probed 2026-08-19. Both confirmed reds carry **`contract.status = 'CANCELLED'`**
(1023590 terminated 2026-03-03, 1074171 terminated 2026-06-14), and the population sweep the
spec specifies does not return them:

| status filter sent | `response.total` | what comes back |
|---|---|---|
| *(none — the spec's default)* | 22,870 | the ACTIVE cohort |
| `ACTIVE` | 22,870 | same |
| `CANCELLED` | **22,870** | **silently the ACTIVE cohort** — the documented one-L trap, live |
| `FILTER_CANCELED` | **22,649** | genuinely cancelled contracts (500/500 sampled read `CANCELLED`) |
| `TERMINATED` / `ALL` | HTTP 400 | not enum members |

A run auditing 2026-03 or 2026-06 under the spec's population would therefore **never enumerate
either verified red**, and would report clean by omission. This is the completeness failure the
spec's own note predicts — *"the risk moved from matching to completeness"* — and it is the
single most serious defect found in this build, worse than the status-enum bug, because no gate
can catch a contract that was never listed.

**Why it happens:** the check audits a month that may be in the past. A contract live during that
month can have been cancelled since. The ACTIVE-only sweep is a snapshot of *today*, not of the
audited month.

**Fix, and it is cheap.** The population is the **union** of:
1. the ACTIVE sweep (no status) — 22,870, and
2. the `FILTER_CANCELED` sweep — 22,649, **filtered locally** to
   `dateOfTermination >= first day of the month under test`.

The cancelled rows all carry `dateOfTermination` (500/500 sampled), so the filter costs no extra
calls. Measured on a 500-row page, only **0.2%–1.6%** of cancelled contracts terminated in or
after a candidate audited month — roughly **50–350 contracts per month**, not 22,649. So the
correct population is about **23,000**, barely more than the incorrect one.

**File against:** `mv_contract_population` (the sweep is incomplete as recorded) and gate 1.

### F13. Runtime: a full run is hours, and the loop shape made it 5x worse than it needs to be
Measured per-contract cost is ~1.6 s, and each contract needs two reads (ledger +
`CONTRACT_DETAILS`), so ~23,000 contracts is ~46,000 calls. Run serially that is ~20 hours.

Stage 2 as first built loops with `splitInBatches` at batchSize 1, which is serial. The spec
permits **5 concurrent with 500 ms between batches**, and the HTTP node's own `batching` option
delivers exactly that when contracts are fed through as items instead of one per loop iteration.
Restructuring Stage 2 to item-parallel brings a full run to roughly **4 hours** — long, but this
is a manual monthly check, and it must still be chunked across staged executions so no single
execution retains the payloads.

**Recorded as a build note, not a spec defect.** The spec's pacing rule is correct; the loop shape
simply failed to use the concurrency it allows.

### F14. Pacing: the sweep was hardened, but scoring is 100x the calls and was left at 5-concurrent
Stage 0 was built gentle (pageSize 100, one request at a time, circuit breaker) after a size=500
sweep took clientmgmt to 503. That fixed **462 calls**. Scoring is **~46,000 calls**, half of them
to the same clientmgmt module, sustained for hours rather than in a burst — and it was still running
at the spec's ceiling of 5 concurrent / 500 ms.

The per-request weight is not comparable (a `size=500` contract search is a heavy query returning
500 fat rows; `get-client-details` for one contract is a point read), so this is not simply "worse
than the outage". But the run is 100x longer and nothing in it noticed refusal.

Both surfaces are now **3 concurrent / 750 ms**, and Stage 2's `Chunk Summary` is a circuit breaker:

| trip | threshold | why that threshold |
|---|---|---|
| `ERP_SESSION_INACTIVE` | **one** read | a slice with no live session cannot read anything |
| `ERP_MODULE_UNAVAILABLE` | 3 reads 5xx-unavailable | one blip must not kill a 5-hour run |
| `ERP_ACCESS_DENIED` | 3 reads 401/403 | an access gap is a finding to report, not to route around |
| `ERP_SURFACE_STORM` | ≥40% of a chunk unreadable | backstop for failure shapes the status codes miss |
| `CASE_ROWS_LOST` | any scored, none persisted | verdicts computed then lost read as a clean chunk |

A trip throws, which fails Stage 1's `Score Chunk` node and stops the run. Cost of a trip is one
chunk (≤25 contracts) of wasted calls. Mirrored offline in `breaker.js` with 34 assertions.

**Recorded as a build note, not a spec defect.** The spec's pacing ceiling is a ceiling, not a target.

### F15. The ERP *session* dies independently of the token, and `exp` tells you nothing either way
Probed 2026-08-19T11:33Z. The run token's JWT `exp` was 22:00Z — **10.4 hours of headroom by its own
claim**. Every request was already returning:

```
HTTP 500
{ "status": 498, "message": "Access Token is missing or malformed <LOGOUT>" }
```

The `<LOGOUT>` marker is the tell: the server-side session was terminated (operator logged out, or
the device session was invalidated) roughly 4 hours after the token was issued. The module itself was
healthy — sub-second responses throughout.

**Then, at 11:45Z, the byte-identical token returned HTTP 200 with `total: 22870`.** The operator had
logged back in, which revived the session behind the same JWT. So this shape is *not* proof the token
must be replaced — it means **the session is not currently active**, which is a different and
recoverable condition. The first version of the breaker said "retrying with the same token cannot
succeed", which is simply false; the trip is now `ERP_SESSION_INACTIVE` and tells the operator to
restore the session **or** supply a fresh token. It still fires on the first occurrence, because a
slice with no live session cannot read anything.

Two consequences:

1. **Never plan a run against the JWT's `exp`.** It is an upper bound the server does not honour, and
   it is uninformative in both directions — the same `exp` covered a window in which the token was
   dead, then alive again. Health-check the actual surface immediately before a long run, and treat
   the response **body** as the only authority on whether a read will succeed right now.
2. A long run must be **resumable**, because the token will die mid-flight sooner or later. Stage 1
   now takes `offset` and an optional `runId`, so the population is covered as consecutive slices by
   ascending `contractId` under one run id. A slice is always flagged `populationSample` and Stage 3
   declares the month partial — the slices being complete together is a fact about the operator's
   sequence, not something a single execution can assert.

**File against:** nothing in the spec — the spec assumes a token is valid until it expires, and
conflates the token's validity with the session's.

### F16. Gate 10 escalates on an OPEN vocabulary, so it flooded 55.6% of cases
Slice 1 of the full month (250 contracts) filed **139 cases as needing a human — 55.6%** — almost all
carrying nothing worse than `unrecognised payment type code(s)`. Extrapolated, that is ~13,500 clean
months parked in a review queue, and a queue that size stops being read at all. A check whose output
nobody reads has the same value as a check that never ran.

The spec treats an unrecognised `typeOfPayment.code` as an anomaly. ask-the-code explains why that can
never converge:

> `TypeOfPayment` is a **data-driven picklist**, so an operator can add codes that never appear as
> literals in source. To get the guaranteed exhaustive list you must query the picklist table.

So the allowlist is *permanently* incomplete by design, and "code not in my list" is not evidence of
anything. Two changes:

1. **The vocabulary is now the full code-defined set** (41 codes, from ask-the-code) rather than the
   spec's 12. Only `monthly_payment` satisfies `isMonthlyPayment()`; `monthly_payment_add_on` joins it
   in `monthlyTypes`. Nothing else is ever summed as a monthly payment.
2. **The human flag is deferred to cases that did not settle cleanly.** An unrecognised code is
   recorded on every case (`unrecognised_type_codes`), but only demands a human when the verdict is a
   finding or pending.

Why the deferral is safe on a clean month: an unrecognised code is never summed as a monthly payment,
so it cannot manufacture a clearance. The only way an unknown code could hide a monthly obligation is
if the monthly amount were billed under it — and then the monthly rows are simply *absent*, which
gates 4 and 8 already red. On a month that did **not** settle, the unknown code might be the payment
the case is about, so there the flag survives. An **absent** code still reds on sight: a payment row
with no type at all is a data defect, not an unlisted picklist entry.

Measured effect, slice 2 first chunk: **needsHuman 0 of 25**, against ~14 of 25 before.

**File against:** gate 10. The rule should escalate on an absent code and on unknown codes attached to
unsettled months, not on the mere existence of a code outside a list that cannot be completed.

### F17. The population estimate was extrapolated from one page of a sorted endpoint
F12 estimated 50–350 cancelled contracts in scope per month, from a 500-row sample. The measured
figure for 2026-07 is **2,097** — 6× to 40× higher, and the in-scope total is **24,378**, not ~23,000.

The sample was one page of an endpoint whose default sort returns oldest-first, so it was almost
entirely 2017–2018 terminations and could not have contained recent cancellations at their true
density. **One page of a sorted endpoint is not a sample of the population.** The estimate was used
only for sizing, so nothing downstream was wrong — but it was quoted as a population fact in
POPULATION-SIZE.md before it was measured, which is the actual mistake.

**File against:** nothing in the spec. A note against my own method: sizing numbers stay labelled as
estimates until a full sweep reports its own counts.
