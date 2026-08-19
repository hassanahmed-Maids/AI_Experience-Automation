# MV Monthly Payment check — declared gaps, deviations and spec corrections

Every item here changes numbers or verdicts. Nothing below is silently absorbed.

---

## A. Spec defects found (corrections to file back to Notion)

### A1. The call budget is wrong by ~30× — and the population figure is a CC number
*Where do the results go?* says "~2,950 contracts" and "≈ 3,000–8,000 payment-search calls".
The `mv_contract_population` variable row records **22,825**. 2,950 is the CC cohort that lost
460 rows to the pagination trap, transcribed into the MV budget. The 58-call sweep figure is
correct (computed for 22,825); only the contract count beside it is wrong. Correct
per-contract walk cost is **22,825–251,075 calls**, not 3,000–8,000.
**Effect:** changes the execution architecture. See `surfaces.md` for the windowed-sweep
replacement. **File against:** the *Where do the results go?* heading.

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
