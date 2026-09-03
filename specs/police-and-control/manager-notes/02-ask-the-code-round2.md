# Manager Notes — Ask the Code, round 2 (2026-09-03)

Five questions, aimed at the open items the ERP could settle rather than P&C. Four are now closed,
one is narrowed, and **two answers change the spec's substance** — the entitlement figures are wrong
in the source material, and part of this check already exists inside the ERP.

*(Written as a separate file because the v2 auditor is reading the spec. Folds into v3.)*

---

## 1. MN-O11 — the 22-vs-24 question, and the price list. **CLOSED, and the source material is wrong twice.**

> **Threshold: 22 months** (not 24). The only eligibility check is inline in
> `HousemaidsVacationAllowanceController`: `numOfMnths % 24 == 22` (with `numOfMnths >= 6`). There is
> **no named constant** — literals `22` and `24` only (`24` is the recurrence cycle).

**The checklist and the payroll team's 110 postponement notes were right; the "policy says 24"
belief was wrong.** The 24 in the code is the *recurrence cycle* — every 24 months — and someone
read it as the threshold. `% 24 == 22` also means eligibility is **periodic, not once-only**: month
22, then 46, then 70. The Notion rule says *"once only"*; the code does not.

**The amounts are worse.** They are module parameters in the `Parameter` config table, read via
`Setup.getParameter()`:

| Parameter | Default |
| --- | --- |
| `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` | **2,000** |
| `PARAMETER_HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT` | **1,350** |

> **1500 does not appear** in housemaid airfare code in this repo.
> `AirfareTicketType.amount` is for **office staff**, not housemaids.

⛔ **The Notion page's price list — "only 2,000 and 1,500 exist" — is wrong for the "other
nationality" figure, and every count built on it is suspect**, including *"128 of 1,358 fail on the
amount alone"* and *"3 payments sit at 1,000 and match no entitlement"*. A payment at 1,350 would
have been counted as a failure by the requestor's analysis and is in fact the correct amount.
**These are caps, not fixed prices** — the ERP flags amounts *over* the limit, so paying less is not
in itself an exception. **The G1 rule has to be rewritten before it is built. Now MN-O21.**

Nationality: `Housemaid.nationality` (PicklistItem; Filipino = picklist `nationalities`, code
`philippines`). Actual paid amount: `ScheduledAnnualVacation.amount`.

---

## 2. MN-O17 — which notes should have an expense record. **CLOSED enough to build.**

> **No dedicated path/origin field.** `PayrollManagerNote` has no `ENTITY_TYPE` and no
> `expenseRequestTodoId`.

But the reason id partitions the population well enough for ❻b and MG2's denominator:

**Definitely should NOT have an expense record** — `cover_deduction_limit`, `cover_negative_salary`,
`prorated_salary`, `office_work_addition`, `mv_extra_salary`, `mv_prorated_salary`,
`last_day_cc_switch_adjustment`, `refund`, **or `SCHEDULED_ANNUAL_VACATION_ID` is set**.

**Ambiguous** — `salary_dispute`, `taxi_reimbursement`, `forgive_deduction`, `airfare_ticket`,
`bonus`: each can come from the expense path *or* a system/manual path. Match to a todo, or treat as
manual when no todo matches.

**So MG2's denominator = notes not in the "definitely not" list.** Structural signals that help:
`SCHEDULED_ANNUAL_VACATION_ID` (airfare), `PAYROLL_ACCOUNTANT_TODO_ID` + `PAID` (MV prorated),
`NUMBER_OF_DAYS_WORKED_AT_OFFICE` (office work), `IS_REFUND` (refund). All are ingestion items.

⚠ **And the reverse gap, which no rule covers:** *"an `EXPENSEREQUESTTODO` can exist without a note"*
(non-SALARY payment, or `amountAlreadyPaid = true` → loan only). An authorised expense that never
reached a payslip is invisible to a check that starts from notes. **MN-O22.**

---

## 3. MN-O18 — G4's recalculation. **CLOSED. G4 is buildable.**

| Type | Field | Formula | Divisor |
| --- | --- | --- | --- |
| `prorated_salary` (`ProRatedSalariesService`) | `housemaid.basicSalary` | `round((basicSalary / calendarDaysInPreviousPayrollMonth) × daysBetween(startDate, 1st of payroll month))` | **calendar days in the *previous* payroll month** |
| `last_day_cc_switch_adjustment` (`PayrollAuditTodoService`) | `CcMaidSwitchedToMv.lastCcSalary` | `round(lastCcSalary / monthDays)` — one daily rate | **calendar days in the payroll month** |
| `mv_extra_salary` (`MvExtraSalaryScheduledJob`) | — | **No proration.** A literal from `BaseAdditionalInfo.infoValue` where `infoKey = 'mvExtraAmount'` | n/a |
| `mv_prorated_salary` (`AsyncService`) | not covered by this answer | | |

Trigger conditions matter as much as the formulas: `prorated_salary` fires only when `startDate` is
on or after the **27th of the previous payroll month** and before the 1st of the current one;
`last_day_cc_switch_adjustment` only when `switchDate` is the **last calendar day** of the payroll
month and `lastCcSalary > 0`. A note of that type outside its trigger window is itself a finding.

**Two divisors, and they are different months.** Using one for both inverts a whole group.

---

## 4. MN-O13 — the AED basis. **CLOSED.**

> **Always AED: `LOCAL_CURRENCY_AMOUNT` only.** `AMOUNT` and `AMOUNT_TO_PAY` follow `currency_id`.

`AMOUNT` is the invoice amount in the expense's own currency; `AMOUNT_TO_PAY` is set equal to it on
save; **`LOCAL_CURRENCY_AMOUNT` is the AED equivalent** — equal to `AMOUNT` when the currency is AED,
FX-converted otherwise, and it is what the ERP uses for transactions and reporting.

AED itself is not a fixed id: it is `PICKLISTS_ITEMS.ID` where `CODE = 'AED'` under
`PICKLISTS.CODE = 'EXPENSE_CURRENCY'`; the local currency is also a module parameter,
`EXPENSE_LOCAL_CURRENCY`, defaulting to `AED`.

**The fix is one column.** Every comparison against an expense payment uses
**`LOCAL_CURRENCY_AMOUNT`**, never `AMOUNT`. No FX table, no as-of date, no currency filter needed.
**MN-O13 comes off the blocking list.**

---

## 5. MN-O7 — the auditor flags. **CLOSED, and it is the biggest scoping finding of this round.**

> **Yes — largely duplicates existing controls** for these two fields.

The ERP already runs an internal payroll audit over exactly this population:

| Existing ERP control | How it detects | Where it goes |
| --- | --- | --- |
| **Airfare additions over the nationality limit** | amount > `PARAMETER_HOUSEMAID_*_AIRFARE_TICKET_LIMIT` | `HousemaidsExceptions` → auditor approves → `CONFIRMED_AMOUNT_BY_AUDITOR = true` |
| **Repetitive additions** | **more than one addition in a configurable month window** (`PARAMETER_HOUSEMAID_REPETITIVE_ADDITION_LIMIT`), **excluding `cover_deduction_limit` and `cover_negative_salary`** | `HOUSEMAID_REPETITIVE_ADDED_PAYMENTS` exception → `CONFIRMED_REPEATED_BY_AUDITOR = true` |
| **Google-review additions** | `recommendation_from_client` unconfirmed | `googleReviewTakeAction` |

There is an **`auditors-to-do` screen** (`PayrollAuditController` / `PayrollAuditTodoController`),
users hold the position **`payroll_auditor`**, and a monthly **`PayrollAuditTodo`** is auto-created
**at lock date** with sub-todos including *"Check X Exceptions"*. The flags are set on approval, and
are used to **suppress re-flagging**.

**Three consequences, and they are not small.**

1. **G1's amount arm and the duplicate rule are not new.** The ERP detects both, monthly, and routes
   them to a named internal auditor. The honest framing for this dashboard is *independence from
   the internal `payroll_auditor` role, plus coverage of the 22 payment types the ERP checks
   nothing about* — not that nobody is looking. **MN-O23 for P&C: is that the intent?**
2. **The dashboard must read the flags or it will re-raise closed cases.** A note with
   `CONFIRMED_AMOUNT_BY_AUDITOR = true` has already been adjudicated. Re-raising it wastes the
   auditor's month and destroys trust in the finding list. **N10 moves from "nice to have" to
   required**, and the ladder needs a gate: *already signed off by the payroll auditor → clean,
   with the sign-off shown*, or a deliberate decision to re-examine.
3. **The duplicate rule has a real definition now** — *more than one addition in a configurable
   window, excluding two reasons* — which is a better starting point than the key v2 proposed.
   **MN-O19 narrows to: adopt the ERP's window and exclusions, or state why P&C's differs.**

---

## Open items after this round

**Closed:** MN-O11 (and reopened as MN-O21), MN-O13, MN-O17, MN-O18, MN-O7.

**New:**

| ID | Item | Owner |
| --- | --- | --- |
| **MN-O21** | **G1's rule is wrong in the source material.** The limits are **2,000 / 1,350 as caps**, not 2,000 / 1,500 as fixed prices; eligibility is **periodic (`% 24 == 22`)**, not once-only. Every G1 count in the Notion page needs re-deriving | P&C |
| **MN-O22** | **An expense request that never became a note is invisible.** A check that starts from notes cannot see an authorised payment that took a non-SALARY route | P&C |
| **MN-O23** | **Scope vs the ERP's own payroll audit.** Airfare over-limit and repetition are already detected and worked by the internal `payroll_auditor`. Is this dashboard independence, wider coverage, or both? | P&C |
