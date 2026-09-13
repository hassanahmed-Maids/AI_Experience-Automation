# Scope as defined by the business — and what already exists against it

The chart defines **four checks**, branching on inside- vs outside-country, with change-of-status
hanging off the inside branch only. That branch matches the code exactly:
`CheckEntryVisaImmigrationApprovalStep.onDone` sends inside-UAE cases (and all office staff) to
`ChangeOfStatusStep`, and outside-UAE cases straight to medical/flight.

| # | Check (as defined) | Applies to | Status |
| --- | --- | --- | --- |
| **A** | No duplicate payments **for the same maid** | both branches | Built as F4 — **but at the wrong grain**, see below |
| **B** | Rejected → partial refund claimed **within 60 days**, else record a loss | both branches | Built as F1 + the proven tariff. **The 60 days needs a ruling**, see below |
| **C** | Correct entry-visa **type** used (inside vs outside) | both branches | 🔴 **BLOCKED and now first-class.** Location is computed, never stored |
| **D** | Change of status (**cost 572**): no duplicate payments; if fines apply, who repays | inside branch only | 🔴 **NOT BUILT.** Explicitly scoped out of v1 |

---

## Three things this changes

### A · "for the same maid" is a wider net than I built

F4 works at **request grain** — two charges on one visa request. The check says **maid grain**. A maid
can hold more than one visa request (a stopped case then a fresh one; a cancellation then a
re-application), so paying twice for the same maid **across** requests is a duplicate the current rule
cannot see. The per-request version is a subset.

**Consequence:** F4 must be re-cut on `OWNER_ID` with `OWNER_TYPE='HOUSEMAID'`, keeping the
justifying-event logic from W4. Expect the population to grow, and expect a new legitimate case to
appear — a genuinely new visa journey after a failed one — which needs its own justifying event
(a new request whose predecessor was stopped or cancelled).

### B · The 60 days does not exist where the check assumes it does

The check reads *"confirm the partial refund was claimed within 60 days"*. Three findings bear on it:

- **The ERP has no 60-day rule.** No constant, parameter or job encodes a refund deadline. Verified
  directly against the code.
- **GDRFA publishes 60 days as the ENTRY PERMIT's own validity** — *"valid for 60 days from the date
  of issue and cannot be extended"* — not as a refund window. The two clocks are different things.
- **Measured, it makes no practical difference.** Of 556 refunds paired to a dated rejection,
  **547 arrived within 7 days**, 9 more within 30, and **none ever later than 30 days**. A 60-day test
  therefore flags the same cases as "was it refunded at all".

**This does not block the check** — implement 60 days as written, since it is the business's stated
rule and it is conservative. But report the ageing distribution beside it, and record that the
operational reality is **7 days, not 60**: a claim not filed in the first week is not late, it is
almost certainly never coming.

### C · "Correct entry-visa type" is the one check with no data

This was `M6`, marked non-blocking in v1. As a named check it is now **blocking**, and it cannot run:

- `NewRequest.isInsideUae()` is **computed at runtime and never persisted**. There is no
  `is_inside_uae` column on the request or on the expense.
- The only durable trace is the expense **purpose**, which is derived from the **amount**, not from
  location — so using it to test "was the right type used" is circular.
- The reference prices are the measured modes, **1,022.50** and **372.50**, since no price list exists
  in the system at all.

**To unblock:** ingest `new_request.location_id` → `picklist_item.name` (emirate names ⇒ inside), and
`office_staff.location_enum` for staff. There is no flag to copy; it must be re-derived.

⚠️ A partial proxy exists and must not be mistaken for the attribute: nationality correlates with
location (Kenyan, Ethiopian and Indonesian maids cluster on the outside-country price; Filipina and
Indian on the inside price). That is recruitment geography. **Useful as a cross-check, never as the
test.**

### D · Change of status is not built at all

In scope per the chart, out of scope in v1. What exists already:

- `CHANGE_OF_STATUS` is a live expense purpose with **40,163 rows** in the ledger.
- It is reached from `ChangeOfStatusStep`, on the inside-UAE branch only — matching the chart.
- The stated cost is **572**. Three other figures circulate for change of status elsewhere in the
  company (590.54, 575.65, 572.50), so the first task is establishing which is authoritative and what
  the ledger actually shows.
- The fines question maps to real columns: `OVERSTAY_FINE`, `OVERSTAY_FEE`,
  `OVERSTAY_FINES_BEFORE_CHALLENGING`, `OVERSTAY_FINES_AFTER_CHALLENGING`, and **`FINES_PAID_TO_US`**
  — which is precisely *"who is responsible for repayment"*.

Duplicate-payment logic transfers directly from A; the fines question is new work.

---

## What was found that the chart does not ask for

Reported so the decision to drop it is deliberate rather than accidental. Both are larger than
anything in scope:

| Finding | Measured | Why it may still matter |
| --- | --- | --- |
| **F10 — approved, then cancelled** | **5,747 cases · AED 3,454,994** | The largest single number in the audit. After validating against GDRFA it is a **cost, not recoverable** — the refund entitlement is scoped to rejection. Worth managing (cancel *before* approval) rather than auditing |
| **F3 — permit expired unused** | **444 cases · AED 329,107 gross, ~203,455 recoverable** | Larger than the rejection channel the chart does ask for. The company's own loss view already calls it *"Should Have Been Refunded"*. A permit has a hard 60-day life it cannot extend |
| F9, F11, F7, F8 | ≈ AED 36,000 plus hygiene | Ledger-integrity errors found on the way. F9 is the only finding **getting worse** — one operator, 4 cases in 2025 → 25 in 2026 |

**Recommendation:** keep F3 in scope. It is the same money, the same fee and the same failure — *the
application did not succeed and the money did not come back* — differing only in whether immigration
said no or the clock ran out. The chart's branch B already covers the rejection half; excluding the
expiry half leaves the larger portion uncontrolled.


---

# Measured, 2026-09-13

## Check A — duplicate payments per maid

| verdict | pairs | maids | AED | median days apart |
| --- | --- | --- | --- | --- |
| a · justified — refund / rejection / refund step | 911 | 873 | 878,712 | **8.0** |
| b · justified — a new journey after the last one ended | 391 | 387 | 339,712 | **214.0** |
| **c · DUPLICATE across requests** | **76** | 75 | **36,575** | 74.0 |
| **d · DUPLICATE on one request** | **522** | 486 | **459,865** | 17.5 |

> ### Check A's answer: **598 duplicate charge pairs across ~561 maids, AED 496,440.**

**Both justifying rules are doing real work and neither is over-forgiving.** (a)'s median gap is
**8 days**, which lines up almost exactly with the measured refund turnaround of 7 — the
reject → refund → re-charge cycle, visible as a timing signature rather than an assumption. (b)'s
median gap is **214 days**, which is a genuinely new visa journey, not a re-payment.

⚠️ **I over-stated the case for the re-cut.** I said request grain was "structurally blind" to
cross-request duplicates, implying a large hidden population. Measured, it is **76 pairs and
AED 36,575 — 7% of the finding**. The maid-grain rule is still correct, and it is the business's
stated definition, but it adds a small population rather than a large one.

## Check D — change of status

### 🔴 The three "competing tariffs" are one tariff on three payment channels

| observed | lines | what it is |
| --- | --- | --- |
| **572.50** | 7,407 (**78.6%**) | the base fee — the chart's 572, confirmed |
| 575.65 | 302 | **572.50 + 3.15** — flat channel surcharge |
| 590.54 | 793 | **572.50 × 1.0315** — proportional 3.15% channel surcharge |

**This settles a question that was open across three documents.** 590.54, 575.65 and 572.50 were
circulating as rival figures for change of status with nothing reconciling them. They are the same
fee. And the **same two surcharges appear on the entry visa**: 1,025.65 = 1,022.50 + 3.15 and
1,054.71 = 1,022.50 × 1.0315; 375.65 = 372.50 + 3.15 and 384.24 = 372.50 × 1.0315. One surcharge
structure, both fees, consistent to the fils.

### 🔴 The overstay fine is bundled inside the change-of-status fee

The long tail is an arithmetic progression: **572.50 + 50.00 × n**, and on the surcharged channel
**590.54 + 51.57 × n** — the same AED 50/day carrying the same 3.15%. Observed up to 2,272.50, i.e.
**34 days of overstay charged inside a line labelled `CHANGE_OF_STATUS`**.

Three consequences, and they change what check D can be:

1. **"If fines apply, check who is responsible for repayment" cannot be answered from the expense
   ledger** — the fine has no line of its own. It must be decomposed as `amount − base`, or read from
   the request's own overstay columns, which the spec already records as **not reconciled to each
   other**.
2. **A duplicate test on change of status cannot compare amounts.** Two different amounts can both be
   correct for the same maid because the overstay differs. Match on the **base**, not the total.
3. **The company has a fines exposure it cannot currently see.** `D4` decomposes and prices it.
