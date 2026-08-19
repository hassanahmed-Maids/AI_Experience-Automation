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

## B. Rules implemented with a conservative default, pending a ruling

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
