# The 14 live payment types — everything the code and the data say

**Date:** 2026-09-08 · **Author:** Hassan Ahmed, Police & Control
**Evidence:** seven all-modules ERP interrogations (conversations 45939–45945), two earlier ones
(45932 raffle, 45934 anti-attrition), and the live/dead triage over 44,151 addition notes.

These 14 types carry **AED 6.76m over the last 12 months — 99.7% of live addition money.** The other
49 types in the picklist are dead, fading or trivial. This document is what is known about each one,
end to end. Where the code contradicts the spec, the code wins and the divergence is called out.

---

## The two creation architectures

Every note in this system is made one of two ways. Knowing which decides where to look, and it is
why five payroll-scoped interrogations this week returned "no rule exists" when a rule did.

### A. Direct creation inside payroll

A payroll job or service builds the `PayrollManagerNote` itself and sets `additionReason` from a
picklist constant. Searchable in `magnamedia-payroll-management`.
Used by: `prorated_salary`, `mv_prorated_salary`, `last_day_cc_switch_adjustment`,
`forgive_deduction`, `cover_deduction_limit`, `office_work_addition`, and (from another module)
`airfare_ticket` and `raffle_prize`.

### B. The expense bridge — `ManagerNoteService.processExpenseRequestTodo()`

An accounting **`Expense`** row carries a `salaryAdditionType` picklist link. When an
`ExpenseRequestTodo` reaches `PAID` + `confirmed` with `paymentMethod = SALARY`, a background task
calls `processExpenseRequestTodo()`, which builds the note and **copies the reason verbatim**:

```
managerNote.setAmount(expenseRequestTodo.getAmount());
managerNote.setNoteReasone(expenseRequestTodo.getDescription());
managerNote.setNoteType(ADDITION);
if (expense != null && expense.getSalaryAdditionType() != null)
    managerNote.setAdditionReason(expense.getSalaryAdditionType());
```

**No code anywhere writes the reason string.** It lives in accounting DB config. This is why a string
search in payroll finds nothing for anti-attrition, accommodation relocation, salary dispute,
taxi reimbursement, medical assistance, Maids.at other expenses and the bonuses.

> 🟢 **N14 is answered by this, and needs no business owner.** The mapping "payment type → allowed
> expense category" the spec has been waiting on *is the `Expense.salaryAdditionType` column*. Read
> the Expense table and the mapping is complete and authoritative. Reclassify N14 from
> "someone must write this" to "read this config table" — see O25.

The same method also creates the **paired loan** when the expense has `allowToAddLoan = true`, a
`loanType`, and a positive loan amount on the request. That pairing is **generic**, not specific to
Accommodation Relocation — any expense configured that way produces addition + loan in one
transaction.

---

# The 14, by last-12-month money

| # | Type | Notes 12m | AED 12m | Share | Distinct amts | Midnight | No requester |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | Airfare Ticket | 1,428 | 2,342,500 | 34.7% | **7** | 94% | 98% |
| 2 | Anti-attrition Incentive | 9,167 | 1,829,736 | 27.1% | 331 | 1% | 0% |
| 3 | Bonus | 1,201 | 849,316 | 12.6% | 280 | 25% | 58% |
| 4 | MV Prorated Salary | 762 | 771,889 | 11.4% | 251 | 0% | 100% |
| 5 | Salary Dispute | 1,086 | 386,096 | 5.7% | **1,194** | 49% | 52% |
| 6 | Raffle Prize | 576 | 180,000 | 2.7% | **2** | 100% | 100% |
| 7 | Prorated salary | 619 | 98,836 | 1.5% | 139 | 100% | 100% |
| 8 | Taxi Reimbursement | 496 | 83,080 | 1.2% | 362 | 2% | 16% |
| 9 | Forgive Deduction | 1,060 | 53,325 | 0.8% | 62 | 24% | 100% |
| 10 | Maids.at other expenses | 341 | 51,198 | 0.8% | 130 | 17% | 0% |
| 11 | Accommodation Relocation | 62 | 46,000 | 0.7% | 5 | 0% | 0% |
| 12 | Office Work Addition | 96 | 29,684 | 0.4% | 65 | 3% | 100% |
| 13 | Medical Assistance | 88 | 21,821 | 0.3% | 88 | 6% | 14% |
| 14 | Last Day CC Switch Adjustment | 213 | 13,616 | 0.2% | 23 | 0% | 100% |

**Four types carry 86%. Six carry 94%.**

---

## 1 · Airfare Ticket — AED 2.34m/12m · AED 7.77m all-time

🔴 **The spec's rule for this is wrong, and this is the largest category in the audit.**

**Architecture:** A, from `magnamedia-visa-processing`.

**What creates it.** `AddScheduledAnnualVacationService.execute(RenewRequest)` — a workflow task that
fires when a housemaid passes the **"Upload The e-Residency"** step of visa renewal. It creates a
`ScheduledAnnualVacation` of type `vacation_airfare`. That row's `AfterCreate` triggers
`HousemaidAirFareTicketBusinessRule`, which POSTs to `/payroll/ManagerNotes/create` with
`additionReason = airfare_ticket`, `fromManager = jad`, `noteDate = payrollDueDate`.
A backfill twin exists: `MigrationController.housemaidScheduledAnnualVacations()`.

**The amount — a flat per-nationality constant, not a cap.**
1. Base: visa-processing parameter **`default_ticket_allowance_amount`**.
2. Override: if the maid's `Nationality` carries the tag **`ScheduledAnnualVacationAmount`**, its
   value replaces the default.

There are only ~7 configured nationality tiers, **which is exactly why 4,881 notes hold 7 distinct
amounts.** The amount is not derived from salary or tenure.

**Eligibility — renewal-anchored month arithmetic.** Two gates in `AddScheduledAnnualVacationService`:
- Gate A: `isforOfficeStaff()` returns early; the amount block runs only for `isforHousemaid()`.
- Gate B, `validateOnExpiryDateOrLastAirfareTicket()`, branching on completed renewals:
  - **First renewal:** labor-card expiry within `param_airfare_ticket_after_expiry_date_months`
    (default **6**) months.
  - **Later renewals:** last airfare at least `param_airfare_ticket_last_ticket_months_ago`
    (default **16**) months ago — checked against both the last `vacation_airfare` and the last
    `airfare_ticket` note.
- Duplicate guard `isThereMultipleAirFareTickets()`: blocks if any airfare vacation or note exists
  within the last **5 months**.

**Why the notes are dated into 2028, and stamped midnight.** `noteDate = ScheduledAnnualVacation.payrollDueDate`,
copied verbatim. `payrollDueDate` is normalised to 00:00, hence 94% midnight; when a vacation is
scheduled for a future payroll cycle, the note inherits that future date. **98% no requester** because
these paths set `fromManager = "jad"` and never set a creator.

### 🔴 Four divergences from the spec

| Spec says (from George, 2026-09-07) | Code says |
|---|---|
| `cc_months >= 22` accumulated CC tenure | **No tenure test at all.** Eligibility is renewal-driven: 6 months before expiry, then 16 months since last. |
| CC only; MV intervals bridge or reset | **No contract-type gate in this path.** It gates housemaid vs office-staff. |
| Cap AED 2,000 Filipina / 1,350 other | **Exact per-nationality value** from a Nationality tag. A cap comparison would pass amounts an exact test rejects. |
| `% 24 == 22` modulo in the ERP (O17) | **No modulo anywhere in this flow.** The only `% 24` matches are in bundled JS date libraries. O17's divergence belongs to `HousemaidsVacationAllowanceController`, a different path. |

**And a control gap:** nothing checks whether the company already bought her a ticket. The only
ticket logic is `TicketMatchingLibrary`, a post-hoc credit-card reconciliation in accounting with no
link back to the note. **Cash can be paid on top of a purchased flight** and nothing detects it.

**Archetypes: CEIL · ELIG · UNIQ.**
- **A1 — amount is exact.** `AMOUNT = Nationality.tag('ScheduledAnnualVacationAmount')`, else
  `default_ticket_allowance_amount`. Not a range. Divergence → RED by the difference.
- **A2 — a `ScheduledAnnualVacation` of type `vacation_airfare` exists** behind the note, with
  matching `payrollDueDate`. None → RED.
- **A3 — 16-month spacing.** No prior airfare note or vacation within 16 months (5 for the hard
  duplicate guard). Violation → RED.
- **A4 — not office staff.**
- **A5 (new) — no company-bought ticket covering the same journey.** Currently uncheckable in code;
  needs the ticket source (O4).

**Blocked on:** the Nationality tag values (a config read, O26) and confirming with George whether the
22-month CC rule is a *policy the system does not implement* — because if so, that is a finding
larger than any single note.

---

## 2 · Anti-attrition Incentive — AED 1.83m/12m

**Architecture:** B, expense code **`AAI - 01`**, from `magnamedia-housemaid-management`.
Fully documented in the spec's N13 and group B (six tests). Summary:

- **`MaidIncentiveExperimentJob.processIncentiveExperimentNotes()`** posts the SALARY expense monthly;
  `AbuDhabiMaidIncentiveExpenseJob` feeds the same code.
- **Enrolment** is a `MaidManagerActionLog` with `actionType.code = 'Maid_Incentive_Experiment'` and
  `incentiveAmount IS NOT NULL`.
- **Eligibility:** `housemaidType <> MAID_VISA` (CC only), status not in `rejectedStatuses`,
  once per contract per month.
- **Amount:** per-maid `incentiveAmount`, validated against `MAID_INCENTIVE_CONFIGS_PARAM.amount_values`
  (default `100,150,200,250,300,350`), prorated
  `(daysBetween / totalMonthDaysTillNow) × incentiveAmount`. **99.5% of 9,167 real notes fit exactly.**
- **No human approval:** requester is service account **2226**; SALARY expenses auto-confirm.

**Archetypes: ELIG · CORR · RECOMP · CEIL · UNIQ.** B1–B3 and B6 run on the existing grant;
B4/B5 need `INCENTIVE_AMOUNT` exposed (O23).

---

## 3 · Bonus — AED 849k/12m · AED 2.84m all-time

**Architecture:** A (the referral job) and B (the retraction expense). Both write reason `bonus`.

🔴 **Two different payments have been conflated in the spec's group C.**

**Referral bonus** — `ReferralBonusesManagerJob` (`referral_bonuses_manager_job`) →
`processReferralBonuses()` → `addReferralBonus()` → `HousemaidReferralService.createPayrollManagerNoteDeduction()`.
It writes **two notes per referral event**: one to the referrer (reason text
*"\<B\> was referred by \<A\>"*, `referredMaidId` set) and one to the referred maid (*"Signing bonus
for being referred by \<A\>"*, `referredMaidId = null`). **Both carry purpose `referral_bonus`.**

**Retraction bonus** — purpose **`resignation_retraction`**, posted as an expense by
`DelighterService.addExpenseRequestForHousemaid()`. This is what George described as "promised by
retractors". It is a *different purpose*, not the referral's second half.

> 🔴 **Withdraw the "expose PURPOSE_ID" recommendation as stated.** `PURPOSE_ID` does **not**
> separate referral from signing — both halves share `referral_bonus`. Separation is by target maid
> and free text. What `PURPOSE_ID` *does* separate is referral from **retraction**, which is still
> worth exposing, but it will not solve the problem I said it would.

**🟢 The referral price source exists — N11 and O10 are answerable.**
`ReferralBonusRuleService.getReferralBonusAmounts()` queries **`ReferralBonusRule`** rows by
(MaidA type, MaidB type, MaidA nationality, MaidB nationality), ordered by `priority`, returning
`[maidAValue, maidBValue]`. Seeded defaults:

| Combination | MaidA / MaidB |
|---|---|
| CC→CC and MV→CC, Filipina (priority 1–2) | **1000 / 0** |
| MV→MV Filipina→ANY, MV→MV ANY→ANY, CC→MV ANY→ANY (3, 6, 7) | **500 / 500** |
| all other CC/MV combinations (4, 5, 8, 9) | 0 / 0 |
| CC→TA and MV→TA, ANY→ANY (`addTARules`) | **1200 / 0** |

**So the unexplained AED 1,200 is a seeded rule for referrals to TA.** The 1500, 2000 and 250 values
are **runtime rows** added through the rule CRUD — governed, but not seeded, so they must be read
from the table rather than assumed.

**Code-enforced conditions** (`isEligibleForBonus()` and the referral lifecycle):
1. Phone normalised; duplicate number by the same maid → rejected.
2. Duplicate number by a different maid → rejected.
3. Referred number already a Housemaid → rejected.
4. Referred number already an applicant beyond the
   `allowed_adding_referral_after_maids_at_profile_creatoin_in_hours` window → rejected.
5. `RequestedBonus` already true → locked.
6. Referrer in a rejected status → referral **cancelled**.
7. Duplicate referred maid (two referrers) → duplicate email, bonus not processed.
8. **CC referred maid: `daysWithClient > 30`. MV referred maid: medical status `"Passed"`.**
9. Rule engine must return a non-zero amount; `createPayrollManagerNoteDeduction` skips `amount == 0`.

### 🔴 Correction: the date postponement is manual, not systematic

**No code moves a note's date.** When the 30 days aren't met the job simply *doesn't create the note*
and retries next run, dating it the day it finally fires. The future-dated notes carrying rejection
text are therefore **humans hand-editing the date** — one note's own text names the person who did it
(*"bonus date updated since the referred maid didn't complete 30 days with client / Musaab"*).

This is a weaker control than a coded deferral, and it produces a checkable finding: a `bonus` note
dated in the future is a manual edit, and every one should be listed.

**Archetypes: CEIL · CORR · ELIG · UNIQ.** The rejection reasons in free text are **reviewer
judgement, not code** — items 1–9 above are the automated set. Both lists matter; only the second is
enforced.

---

## 4 · MV Prorated Salary — AED 772k/12m

**Architecture:** A. **Not** a contract-type branch of `prorated_salary` — an entirely separate pipeline.

**Chain:** a **Last MV Salary** `MaidService` (`LAST_MV_SALARY_FOR_A_PRE_COLLECTED_CONTRACT`) is
created when a pre-collected Maid-Visa contract is cancelled/terminated → the daily
**`LastMvSalaryMaidServiceJob`** (`create_last_mv_salary_todo_job`) flips it to `READY_TO_BE_PAID` on
the termination day and asks payroll for a single-maid WPS todo
(`AccountantToDoService.createAccountantTodoForTerminatedProratedMVMaids`) → on WPS authorisation,
**`AsyncService.processCurrentMonthHousemaidsBatchBT()`** writes the note.

**Amount:** `note.amount = log.getTotalSalary()`, computed upstream as
`round( (maidService.salary / daysInTerminationMonth) × lastPaidDate.dayOfMonth )`.

**Eligibility:** MAID_VISA (or MV-switched-to-CC), pre-collected contract cancelled in the window,
client payment covers the salary, **and at transfer time the maid is NOT `EMPLOYEMENT_TERMINATED` or
`VISA_UNSUCCESSFUL`**. Terminated maids get a plain WPS payment with no note.

**Note date** is the processing timestamp — hence 0% midnight — with no requester (100%), because it
is written inside a batch.

**Archetypes: RECOMP · ELIG · CORR.** Needs the `MaidService.salary` snapshot and `lastPaidDate`
(O27) — **this does not need N10's general salary history**, because the salary is snapshotted on the
service record. That removes a blocker the spec assumed.

---

## 5 · Salary Dispute — AED 386k/12m · AED 2.57m all-time

🔴 **The single largest control gap found in this audit.**

**Architecture:** B (main volume) plus two direct services and one job. Three uncoordinated creators:

- **Expense bridge** — any expense whose `salaryAdditionType` is the `salary_dispute` picklist item.
  The configured one is parameter `EXPENSE_SALARY_DISPUTE_CODE` (default `expense_salary_dispute`),
  raisable via UI, `add-maid-refund` in acc-angular, **or the GPT/WhatsApp path**
  `ExpenseRequestTodoService.addExpensesForMaidByGPT` (keyed off a maid's mobile number).
- **`ManagerNoteService.addFilipinaSalaryAdjustment()`** — hardcodes the reason, **defaults the
  amount to 500 when null**.
- **`ManagerNoteService.addReducedOverstayFinesAddition()`** — "Overstay Fines Waived".
- **`ProRatedSalariesService.processProRatedSalaries()`** tags prorated starting-salary additions
  with this reason.

**The DEDUCTION side is explained:** the same picklist code doubles as
`AbstractEmployeeLoan.LoanType.SALARY_DISPUTE`. Additions are the note; deductions are the loan
recovery.

### What the code confirms is absent

| Control | Present? |
|---|---|
| Amount cap or ceiling | **No** |
| Business rule on the reason | **No** — `PayrollManagerNoteBR` fires only for `taxi_reimbursement` (an SMS) |
| Validation in `processExpenseRequestTodo` | **None** — copies `expenseRequestTodo.getAmount()` straight through |
| Four-eyes | **No** — and `recalculateAndUpdateApprover` **auto-approves whenever creator == approver** |
| `@PreAuthorize` on `POST /payrollmanagernote` create | **None**, in either payroll or housemaid-management |
| A stored "disputed"/"needed" amount to reconcile against | **None anywhere** |

The only gate is upstream and bypassable: `Expense.approvalMethod` — `AUTO_APPROVED` skips approval
entirely, `APPROVAL_REQUIRED_ON_LIMIT` only bites above `limitForApproval`. The only dispute-specific
validation is `validateMaidPaymentPurposeAdditionalDescription`, which forces the purpose to
`"No show"` — categorical, not monetary.

**This is why 1,194 distinct amounts appear across 9,610 notes.** Free entry, no cap, no reconciliation
target.

**Archetypes: UNRULED, unavoidably.** No RECOMP is possible — the correct figure is never captured.
What *can* be built: outlier detection, requester concentration, the `addFilipinaSalaryAdjustment`
default-500 population isolated, and a same-maid-repeat list. **New O28: this needs a policy
decision, not data** — either a cap and an approval gate are introduced, or the audit reports the
whole category as unverifiable every month.

---

## 6 · Raffle Prize — AED 180k/12m

**Architecture:** A, from `magnamedia-housemaid-management`. Fully documented in the spec's N12 and
group F. `RafflePerformerJob` draws weighted by ticket points, sets `isWinner`/`winOn`/`prize` on
`RaffleDrawParticipant`, and `addPrizesToPayroll()` writes the note with `amount = prize.worth`.
Prizes are parameters: `raffle_first_prize` **2,000** × 3, `raffle_second_prize` **200** × 45.
**2 distinct amounts in the data — exactly as predicted.**

**Archetypes: ROSTER · CEIL · UNIQ.** Blocked only on ingesting the five `raffledraw` tables (O3b).

---

## 7 · Prorated salary — AED 99k/12m

**Architecture:** A. `_ProratedSalariesTransaction.calculate()` — a phase-zero salary transaction
auto-discovered by reflection inside `HousemaidPayrollPaymentServiceV2.runTransactionsNew()` during
**monthly payroll generation**.

**Eligibility:** salary start date (`replacementSalaryStartDate` else `startDate`) is **on/after the
27th of the previous payroll month and before the 1st of the current** — maids who started in the
last days of the prior month and were missed by that file. Skips maids with a transferred payroll log.

**Amount:**
- **MAID_VISA:** `round( (basicSalary / daysInPreviousMonth) × daysBetween(startDate, 1st of payroll month) )`
- **CC and others:** group-based — for each of gr1 (basic), gr2, gr4, gr5 (live-out basic),
  gr6 (live-out accommodation): `(groupSalary / daysInPreviousMonth) × groupDaysInPreviousMonth`, summed.

**Note date** is the 1st of the payroll month — a pure calendar date, hence **100% midnight**, and
no requester because the payroll engine writes it.

**Archetypes: RECOMP · ELIG.** Needs the salary groups (gr1–gr6) and the start date — N10 in its
narrow form.

---

## 8 · Taxi Reimbursement — AED 83k/12m

**Architecture:** B. Expense parameter **`TAXI_REIMBURSEMENT_EXPENSE_CODE`** (default
`taxi_reimbursement_expense`); applicants use `taxi_reimbursement__applicant_expense`.

**Validation is unusually strong here** — the expense is checked to have
`beneficiaryType = TAXI_DRIVER`, and requests carry supplier/invoice validation: Hala/Careem, invoice
uniqueness, and a **≤ AED 100 variance against parsed taxi orders**.

**Approval:** the expense's `approvalMethod`/`approveHolderType` routes to a final manager, a
configured user, or an email; COO approval when `isLimitedCOO`/`LimitCOO`/`limitForApproval` are
exceeded.

**The one reason with a business rule:** `PayrollManagerNoteBR` fires on `taxi_reimbursement` to send
the maid an SMS. It does not create notes.

**16% no requester** = the minority entered directly rather than through an expense.

**Archetypes: CORR · ROSTER.** Runnable as soon as `EXPENSES_REQUESTS` is granted (O20) and
`EXPENSE_ID` is exposed (N4/R5).

---

## 9 · Forgive Deduction — AED 53k/12m

**Architecture:** A. `HousemaidUnpaidDayService.takeAction(...)`, fired when a `HousemaidUnpaidDay`
is marked `forgiven = true`.

**Trigger condition — the subtle part:** a note is created **only if that month's payroll is already
closed** (`HousemaidPayrollLog` exists and is `transferred` or status `FINAL`). If the month is still
open, the forgiveness just re-groups the attendance day and no note appears. So every note is a
"we already paid you short, here is the catch-up" case.

**Amount:** `round( dailyRate / daysInMonth )` where the rate depends on forgiveness type:
- **Full-day** (`forgivenessType` code contains `"full"`): `liveOut ? gr5Salary : gr1Salary`,
  fallback `HousemaidPayrollLog.basicSalary`.
- **Accommodation:** `liveOut ? gr6Salary : gr2Salary`, fallback `accommodationSalary`.

Inherently bounded at one day's salary. Links back to the original deduction via
`additionPayrollManagerNoteDeductionSource` (display only).

**Archetypes: RECOMP · PAIR.** The PAIR is available today via the deduction-source link — worth
using, because it makes this the one part-month type with a direct pointer to what it reverses.

---

## 10 · Maids.at other expenses — AED 51k/12m

**Architecture:** B, exclusively. Parameter `PARAMETER_EXPENSE_MAIDS_AT_OTHER_EXPENSES_CODE`
(default `expense_maids_at_other_expenses`). No direct programmatic setter exists — **0% no requester
confirms every one came from a human-submitted expense request.**

⚠️ Not to be confused with the recruitment "Expenses refund" flow
(`MaidsAtHustlerActionService.fillPayrollManagerNoteHousemaidAndDate`), which is a **different**
reason, `expenses_refund`.

**Archetypes: CORR.** Same expense-grant dependency as taxi.

---

## 11 · Accommodation Relocation — AED 46k/12m

**Architecture:** B. `LoanType.ACCOMMODATION_RELOCATION` ("Accommodation Relocation"), introduced
under ticket **PAY-1616**.

🔴 **The CC live-out condition is not enforced anywhere in code.** Not in `processExpenseRequestTodo`,
not in `ExpenseRequestService`/`UnifiedExpenseRequestService`; `ExpenseRequestTodo` carries no
live-out field at all. Live-out status exists elsewhere (contract/housemaid `liveOut`, payroll group
status `IN_ACCOMMODATION_LIVE_OUT`) but is never consulted. **It is manual policy** — consistent with
0% midnight, 0% no-requester, fully human-entered.

**The paired loan is automatic** — same method, same transaction, `EmployeeLoan` created when
`expenseRequestTodo.getLoanAmount() > 0`, type copied from `expense.getLoanType()`.

**The five amounts are typed in.** The expense config has an optional `defaultAmount` that *pre-fills*
an editable field. Not a tier, not a locked parameter — the clustering is human convention.

**Archetypes: PAIR · ELIG.** The PAIR test is exact and runnable. The ELIG test (CC live-out) is a
**policy check with no system counterpart** — every note needs it precisely because code does not.

---

## 12 · Office Work Addition — AED 30k/12m

**Architecture:** A. **The only one of the expense-family four with no expense behind it.** Created
directly by `PayrollGroupService` during payroll generation.

**Amount:** `basicSalary / daysInMonth × daysWorkedAtOffice`, from `HousemaidPayrollAttendanceLog`,
storing `numberOfDaysWorkedAtOffice` on the note.

**No pre-payment approval.** Instead `AssignedOfficeWorkAdditionsConfirmationJob` runs daily and
emails the prior day's notes to `PARAMETER_PAYROLL_ASSIGNED_OFFICE_WORK_ADDITIONS_EMAIL_RECIPIENTS`
for **after-the-fact** review.

**100% no requester** because no expense request exists. This confirms the spec's N16 entry: office
work legitimately has no expense record, so absence is not a finding.

**Archetypes: RECOMP · CORR** (against the attendance log).

---

## 13 · Medical Assistance — AED 22k/12m

**Architecture:** B, exclusively — no Java code sets this reason directly. Upstream triggers are in
**visa-processing**: `MedicalAssistantJob` / `MaidLeftMedicalAssistantJob` create `MedicalAssistant`
records for maids in medical/EID steps; the money is posted as an expense request.

Loan taxonomy: `MEDICAL_ASSISTANCE`, `MEDICAL_ASSISTANT`, `NON_INSURANCE_MEDICAL_ASSISTANCE` — the
insurance vs non-insurance split is the legitimate category family.

**14% no requester** = the subset raised by the GPT endpoint `addExpensesForMaidByGPT`, which builds
the todo with no human `requestedBy`.

**Archetypes: CORR · ROSTER.**

---

## 14 · Last Day CC Switch Adjustment — AED 14k/12m · brand new

**Architecture:** A. First note **2026-06-30**; the picklist item is not even in the test seed data.

🔴 **The name is misleading.** It fires when a **CC maid switches TO Maid Visa**, not the reverse.
Creating an MV contract in Sales (`ContractController.createContract`) for a maid whose prior type was
not `MAID_VISA` calls `bindContractWithMaidVisaHousemaid()` and `createCcSwitchedToMvRecord()`,
persisting `CcMaidSwitchedToMv` with `switchDate = now`, `lastCcSalary = basicSalary`.

**What writes the note:** `PayrollAuditTodoService.doMaidSwitchedToMvCalculations()`, driven by the
daily `PayrollAuditTodoJob` on the payroll lock date (or on demand when an auditor opens the
"CC switching to MV" todo).

**Eligibility — all must hold:** a `CcMaidSwitchedToMv` record in the window; **`switchDate` equals
the last calendar day of the payroll month**; `lastCcSalary > 0` and daily rate `> 0`; not excluded by
"Rule 2" (switch within the first 3 days of its month and on/after the prior primary payment date).

**Amount:** one day of CC salary — `round( lastCcSalary / daysInPayrollMonth )`. It exists because the
main CC proration only pays through `switchDate − 1`, so the switch day is added back.

**Archetypes: RECOMP · ELIG · CORR.** Fully specified, tiny, and clean — a good first build to prove
the pipeline end to end.

---

# What the data confirmed, and the two things it reframed

Nine profiling queries were run against the live set on 2026-09-08. The code predictions held
arithmetically in four places, and the data resolved two open contradictions.

## 🟢 The raffle matches the code *exactly*

| | Code | Data (12m) |
|---|---|---|
| Second prize | 200 × 45 winners × 12 draws | **200 → 540 notes** (45 × 12) |
| First prize | 2,000 × 3 winners × 12 draws | **2,000 → 36 notes** (3 × 12) |

Two distinct amounts, no others, exact counts. `RafflePerformerJob` is running precisely to
specification. Group F will be a formality once the tables are ingested.

## 🟢 Four formulas confirmed arithmetically

- **Anti-attrition:** every fractional amount is `tier × days/31` — 38.71 = 100×12/31,
  19.35 = 100×6/31, 154.84 = 200×24/31, 193.55 = 200×30/31.
- **MV Prorated Salary:** 967.74 = 1000×30/31, 483.87 = 1000×15/31, 1064.52 = 1500×22/31.
  **65% of its amounts carry fils** — the signature of proration.
- **Forgive Deduction:** 65 ≈ 2000/31, 67 ≈ 2000/30, 32 ≈ 1000/31. One day of salary, as coded.
  **Only 2% are multiples of 50** — nothing typed in.
- **Last Day CC Switch Adjustment:** 32–107, median 65. One day of CC salary.

## 🔴 Reframe 1 — the 22-month CC airfare rule is real, and enforced *by hand*

The code has no tenure test. The **free text on the notes does**:

> *"postponed, didn't accumulate 22 months under CC"* — 19 notes
> *"postponed to complete 22 months under CC"* — 7 notes

**George's rule is genuine policy. The system does not implement it. Human reviewers enforce it by
postponing notes — editing the date forward, exactly as they do for referral bonuses.** That
reconciles the divergence completely, and it changes what the audit must test.

The system creates an airfare note on visa renewal for anyone, with no tenure check. **The only thing
standing between that and paying an ineligible maid is a person noticing.** So group A needs two
tests, not one:

- **A6 (policy, not code) — CC tenure ≥ 22 months at the note date.** Every note failing this is a
  case the manual control should have caught. The ~26 postponed notes are evidence it usually works;
  the audit's job is to find the ones it did not.
- The coded tests (exact nationality tier, renewal anchor, 16-month spacing) still stand.

**This is the highest-value single check in the audit**: a manual control, unsupported by code,
guarding the largest category of money.

## 🔴 Reframe 2 — "Live-out Transportation Assistance" exists, and I was wrong to say it didn't

On 2026-09-08 this spec recorded that *"Live-out Transportation Assistance does not exist as an ERP
addition reason"*, and the business-rules request asked owners what it really was.

**It is a real expense category, booked under the `taxi_reimbursement` addition reason.** In the last
12 months:

| Taxi Reimbursement, by expense category | Notes | AED |
|---|---:|---:|
| **Live-out Transportation Assistance** | **340** | **70,450** |
| Taxi Reimbursement | 155 | 12,630 |
| Taxi rides - maids | 1 | 0 |

**It is 69% of all taxi-reimbursement money and the dominant use of the payment type.** The error was
the same shape as the raffle error: I searched for it as an *addition reason* and concluded it did not
exist, when it lives one level down as an *expense category*. → withdraw Part 1 item 7 of the
business-rules request; the question is answered.

## 🟢 N14 recovered from the data as well as the code

Each type-B payment maps to exactly one expense category — the mapping is clean, and taxi is the only
one-to-many:

| Payment type | Expense category | Coverage |
|---|---|---|
| Anti-attrition Incentive | Anti-attrition Incentive | 9,164 / 9,167 |
| Salary Dispute | Salary disputes for housemaids | 1,069 / 1,084 |
| Maids.at other expenses | Maids.at other expenses | 341 / 341 |
| Medical Assistance | Medical Assistance Bill | 88 / 88 |
| Accommodation Relocation | Accommodation Relocation | 62 / 62 |
| **Taxi Reimbursement** | **Live-out Transportation Assistance** *and* Taxi Reimbursement | 340 + 155 |

Anything outside a type's category list is a finding. Three already visible: one anti-attrition note
booked under *Live-out Transportation Assistance*, two salary disputes under *Bonuses for Housemaids*,
and **77 `bonus` notes booked under *CC Housemaids Expenses - Abu Dhabi Incentive*** — the AD
incentive landing on the wrong addition reason.

## 🔴 Airfare tiers are 2,000 / 1,500 / 1,000 — the spec's 1,350 does not exist

| Amount | Notes | Share |
|---|---:|---:|
| 2,000 | 773 | 54.1% |
| 1,500 | 529 | 37.0% |
| **0** | **123** | **8.6%** |
| 1,000 | 3 | 0.2% |

**AED 1,350 appears zero times.** The spec's cap figures are wrong on both the mechanism (exact tier,
not cap) and the value. → **O26** must read the `ScheduledAnnualVacationAmount` tags to get the
authoritative set.

## Salary Dispute — the concentration risk is low; the design risk is not

My earlier framing implied misuse concentration. The 12-month data does not support that:

| | |
|---|---|
| Distinct requesters | **36** |
| Top requester's share of money | **17%** |
| Self-approved | **2%** |
| No requester | **1%** (the 47% all-time figure is historical) |

So it is not one person moving money. **The finding is structural** — no cap, no reconciliation
target, no `@PreAuthorize` — and it stands unchanged. Correcting the emphasis matters for how it is
raised: this is a design gap to close, not an individual to investigate.

## Where humans *do* self-approve

| Type | Self-approved | Requesters / approvers |
|---|---:|---|
| VIP Bonus | **100%** | 1 / 1 |
| Medical Assistance | **48%** | 8 / 8 |
| Taxi Reimbursement | 25% | 43 / 10 |
| Accommodation Relocation | 5% | 8 / 2 (top requester holds **80%** of the money) |

Anti-attrition's 88% is the service account and is not a segregation issue. **Medical Assistance at
48% across 8 people is**, and it is small enough to fix by policy tomorrow.

Separately, **Maids.at other expenses has 0% missing requesters but 82% missing approvers** — every
note is human-raised and four in five reach payroll with nobody recorded as approving.

## Growth — three types are new and four are exploding

| Type | First 6m | Last 6m | Change |
|---|---:|---:|---|
| Maids.at other expenses | 232 | 45,593 | **+19,552%** |
| Medical Assistance | 447 | 13,742 | +2,974% |
| Taxi Reimbursement | 7,602 | 58,192 | +665% |
| Anti-attrition Incentive | 193,331 | 1,176,879 | +509% |
| Forgive Deduction | 12,986 | 40,230 | +210% |
| Airfare Ticket | 833,000 | 1,180,000 | +42% |
| MV Prorated Salary / Accommodation Relocation / Last Day CC Switch | 0 | 580,118 / 44,800 / 13,616 | **NEW** |
| Office Work Addition | 12,028 | 7,573 | −37% |

Everything else is flat. **Nothing in the live set is shrinking except office work.**

## Duplicates, zeros and outliers

**481 same-maid-same-day cases, AED 133,545.** Most are benign: Forgive Deduction's 213 cases
(90% identical amounts) are multiple forgiven days processed together, and anti-attrition's 169 cases
are only 5% identical — consistent with two contracts prorated differently, which is the legitimate
case the code's per-contract guard allows. **The ones to open: 12 `Bonus` cases (AED 22,000, 67% at
identical amounts) and 29 of 34 `Prorated salary` cases at identical amounts.** One airfare case has
**four notes for one maid on one day**.

**472 zero-amount notes** across the live set — airfare 123, salary dispute 104, bonus 70,
Maids.at 69. These are voided or superseded entries; they need a rule, because a zero note is
currently indistinguishable from a real one in every count.

**112 rows beyond 3σ, AED 201,620.** MV Prorated Salary dominates (13 rows, max 4,838.71 = 5,000×30/31
— a high salary, not an error). The genuine outlier is **note 174632, Salary Dispute, AED 4,554.84 at
9.93σ against a type average of 356** — the single most anomalous note in the live set.

---

# Cross-cutting findings

## F1 — `POST /payrollmanagernote` has no authorisation check
No `@PreAuthorize` on `createEntity` in either the payroll or housemaid-management controller.
The permission-guarded endpoints (`customdelete`, `bulkcreate`, `bulkrefund`, …) do not cover plain
create. **Anyone with generic endpoint access can create a payment note of any type and any amount.**
→ **O29**, and it is a security finding, not an audit one.

## F2 — self-approval is coded, not incidental
`recalculateAndUpdateApprover` **auto-approves whenever creator == approver.** Combined with F1 and
the absence of a cap on `salary_dispute`, one person can create and approve an uncapped payment.
→ folded into **O28**.

## F3 — the payroll lock date is the only gate on manual creation
`PayrollManagerNoteController.createEntity` (payroll) applies a payroll-lock check and nothing else.
The housemaid-management controller has **no gate at all** — so the lock is bypassable by choosing
the other endpoint. → **O30**, and it materially weakens N7.

## F4 — cash airfare and purchased tickets never meet
See §1. → **O31**.

## F5 — `cover_deduction_limit` died at the V2 payroll cutover, and its replacement is invisible
`NegativeSalariesService.negativeSalariesBean(...)` (legacy generator) created a
`cover_deduction_limit` addition plus a matching `COVER_DEDUCTION_LIMIT` loan for
`totalDeduction − nationalityLimit`. V2 never calls it. The current mechanism is
`Z_DeductionCapTransaction` + `PayrollGenerationHelperService.getDefaultCap(...)`:
1. Nationality cap (now including **Sri Lankan** alongside African/Filipino/Ethiopian/default).
2. Deduction capped at `min(outstanding loan balance, nationality cap)`.
3. **WPS floor:** net salary must stay ≥ `0.85 × (MOHRE salary + holiday)`, prorated by working days.
4. The capped amount becomes a **`Repayment`** against the loan, not an addition note.
5. The remainder is carried as **`UnpaidDeduction` / `UnpaidDeductionRepayment`**, with month-end
   balances in `HousemaidBalancesHistory`.

**Consequence for the audit:** deduction capping no longer produces manager notes, so it is invisible
to a notes-only audit — while remaining a real money mechanism with a statutory WPS floor.
→ **O32**: decide whether the audit's scope should extend to the repayment/unpaid-deduction chain.

## F6 — two payment types are their own rulebook
`salary_dispute` and `Accommodation Relocation` both rely on rules that exist only in people's heads:
an uncapped free amount, and an unenforced CC live-out condition. They are the two places where the
audit is the *only* control.

---

# What this changes in the spec

| Item | Change |
|---|---|
| **Group A (airfare)** | Rewrite. CEIL against the Nationality tag, not a cap. Eligibility is renewal-anchored, not tenure. Drop the contract-type gate from this path. Raise the 22-month divergence with George. |
| **N14** | 🟢 Answered — the mapping is `Expense.salaryAdditionType`. Not a business ask. → O25 |
| **N11 / O10** | 🟢 Answered — `ReferralBonusRule` is the price table. AED 1,200 = the seeded CC/MV→TA rule. |
| **Group C** | Split referral (`referral_bonus`, two notes per event) from retraction (`resignation_retraction`). Withdraw the PURPOSE_ID claim as stated. |
| **N10** | Narrowed. MV Prorated Salary needs only the `MaidService.salary` snapshot; `prorated_salary` needs gr1–gr6. |
| **O17** | Reassigned — the `% 24` divergence is not in the airfare note path. |
| **Group I** | `cover_deduction_limit` is dead; document the V2 replacement instead. |
| **New** | O25 (Expense config read), O26 (Nationality tags), O27 (MaidService.salary), O28 (salary-dispute policy), O29 (missing @PreAuthorize), O30 (lock bypass), O31 (ticket/cash), O32 (deduction-cap scope) |

# What is runnable the day the warehouse grant lands

Four of the top six by money are now fully specified:

1. **Last Day CC Switch Adjustment** — complete, tiny, proves the pipeline.
2. **Airfare** — needs only the Nationality tag values (a config read).
3. **Anti-attrition** — B1/B2/B3/B6 today; B4/B5 on one column.
4. **Raffle** — needs one ingestion, no decisions.

That is **AED 4.37m of the AED 6.76m**, or 65% of live money, reachable without a single business
owner writing a new rule.
