The literal strings `"Maids_at_other_expenses"` and `"medical_assistant"` only appear as `setAdditionReason` in `HousemaidPayrollPaymentServiceV2.java` (the read list, not creation). No direct programmatic note creator uses them — confirming both are purely expense-backed. I have everything needed to answer.

Here's the complete trace across modules.

## How the expense → payroll note bridge works (all four rely on this except Office Work)

An `ExpenseRequestTodo` is created/paid in **accounting**. On `AfterCreate`/`AfterUpdate` with `status=PAID`, `relatedToType=MAID`, and `confirmed=true`, `ExpenseRequestTodoBusinessRule` queues a `SequentialQueue` background task → `ManagerNoteService.processExpenseRequestTodo()`. That method builds a `PayrollManagerNote` (type `ADDITION`) and sets:
- `amount` ← todo amount
- `noteReasone` ← todo description
- **`additionReason` ← `Expense.salaryAdditionType`** (the picklist link that decides which "payment type" the note appears as)
- `creator` ← `expenseRequestTodo.getRequestedBy()` (this is why "no-requester %" reveals the origin)

The addition only fires when `paymentMethod == SALARY` and `amountAlreadyPaid != true`. So the **payment-type → expense-category mapping lives in expense setup** (`Expense.salaryAdditionType`), not anywhere in payroll code — a string search in payroll finds nothing.

---

## 1. Taxi Reimbursement (`taxi_reimbursement`)

- **Creator:** `ManagerNoteService.processExpenseRequestTodo()` copying `Expense.salaryAdditionType`.
- **Expense code / category:** the expense resolved by parameter `TAXI_REIMBURSEMENT_EXPENSE_CODE` (default code `taxi_reimbursement_expense`) for maids; `PARAMETER_TAXI_REIMBURSEMENT_APPLICANT_EXPENSE_CODE` (`taxi_reimbursement__applicant_expense`) for applicants. Legitimate expense: the **Taxi Reimbursement expense**, which is validated to have `beneficiaryType = TAXI_DRIVER` in `ExpenseRequestTodoController` (`TAXI_REIMBURSEMENT` case). Requests carry supplier/invoice validation (Hala/Careem, invoice uniqueness, ≤100 AED variance vs parsed taxi orders).
- **Expense always required?** Effectively yes for the copied path. But this is the one reason with a **direct programmatic entry point too**: only `PayrollManagerNoteBR` keys off `taxi_reimbursement` (to send the maid an SMS on `AfterCreate`) — it doesn't *create* notes. The 362 distinct amounts + 16% no-requester fits: mostly expense-backed (human requester on the todo), with a minority entered directly with no requester.
- **Approval gate:** yes — the expense's `approvalMethod`/`approveHolderType` drives routing (`validateAndPrepareEntity` → `AUTO_APPROVED` skips to COO step; `FINAL_MANAGER` routes to the requester's calculated final manager; `USER` to the configured `approveHolder`; `EMAIL` to `approveHolderEmail`). COO approval kicks in when the approver holds `EXPENSE_COO_USER_POSITION` or COO limits (`isLimitedCOO`/`LimitCOO`, `limitForApproval`) are exceeded.

## 2. Medical Assistance (`medical_assistant`)

- **Creator:** exclusively `processExpenseRequestTodo()` copying `Expense.salaryAdditionType`. No Java code sets `additionReason = medical_assistant` directly (confirmed).
- **Expense code / category:** a configured expense whose `salaryAdditionType` picklist = `medical_assistant`. The upstream trigger is in **visa-processing** (`MedicalAssistantJob` / `MaidLeftMedicalAssistantJob` create `MedicalAssistant` records for maids in medical/EID steps); the actual money is posted as an expense request to accounting, which then bridges to payroll. Related loan taxonomy (`MEDICAL_ASSISTANCE`, `MEDICAL_ASSISTANT`, `NON_INSURANCE_MEDICAL_ASSISTANCE`) is the legitimate category family — with insurance vs non-insurance variants.
- **Expense always required?** Yes — 100% expense-backed. The 14% no-requester is the subset requested by system/automation (e.g. the GPT `addExpensesForMaidByGPT` endpoint, which builds the todo with no human `requestedBy`) rather than a payroll officer.
- **Approval gate:** yes, same expense-driven approval routing as above (manager / configured user / email / COO on limit).

## 3. Maids.at other expenses (`Maids_at_other_expenses`)

- **Creator:** exclusively `processExpenseRequestTodo()` copying `Expense.salaryAdditionType`. No direct programmatic setter (confirmed). This matches **0% no-requester** — every one originates from a human-submitted expense request.
- **Expense code / category:** parameter `PARAMETER_EXPENSE_MAIDS_AT_OTHER_EXPENSES_CODE` (default code `expense_maids_at_other_expenses`) — the "Maids at other expenses" expense, whose `salaryAdditionType` = `Maids_at_other_expenses`. Note: the recruitment "Expenses refund" flow (`MaidsAtHustlerActionService.fillPayrollManagerNoteHousemaidAndDate`) is a **separate** addition reason (`expenses_refund`), not this one.
- **Expense always required?** Yes — always backed by the "Maids at other expenses" expense; no direct salary-adjustment path.
- **Approval gate:** yes — expense-configured approval (manager/user/email/COO-on-limit).

## 4. Office Work Addition (`office_work_addition`) — the outlier

- **Creator:** created **directly** in payroll by `PayrollGroupService` during payroll generation (the `office_work_addition` branch). It computes the amount from the maid's office-work attendance logs (`HousemaidPayrollAttendanceLog`): `basicSalary / days-in-month × days worked at office`, sets `numberOfDaysWorkedAtOffice`, and saves the note directly.
- **Expense code / category:** **none.** No expense, no `ExpenseRequestTodo`, no `salaryAdditionType`. This is why a "100% no-requester" — there's never a `requestedBy` because no expense request exists.
- **Expense required?** **No** — this is a pure direct salary adjustment (the only one of the four booked with no expense behind it).
- **Approval gate:** no expense-approval gate. Instead there's a **downstream confirmation email**: `AssignedOfficeWorkAdditionsConfirmationJob` runs daily and emails the prior day's office-work-addition notes to the recipients in `PARAMETER_PAYROLL_ASSIGNED_OFFICE_WORK_ADDITIONS_EMAIL_RECIPIENTS` for review, rather than pre-payment approval.

---

### Summary table

| Payment type | Created by | Expense code (category) | Expense required? | Approval gate |
|---|---|---|---|---|
| Taxi Reimbursement | `processExpenseRequestTodo` (copies `salaryAdditionType`) | `TAXI_REIMBURSEMENT_EXPENSE_CODE` = `taxi_reimbursement_expense` (applicant: `taxi_reimbursement__applicant_expense`); beneficiary `TAXI_DRIVER` | Mostly (16% direct/no-requester) | Yes — expense approval (manager/user/email/COO-on-limit) |
| Medical Assistance | `processExpenseRequestTodo` | Configured expense with `salaryAdditionType=medical_assistant`; loan family `MEDICAL_ASSISTANCE`/`MEDICAL_ASSISTANT`/non-insurance; triggered from visa `MedicalAssistantJob` | Yes (14% no-requester = system/GPT-requested) | Yes — expense approval |
| Maids.at other expenses | `processExpenseRequestTodo` | `EXPENSE_MAIDS_AT_OTHER_EXPENSES_CODE` = `expense_maids_at_other_expenses` | Yes — always (0% no-requester) | Yes — expense approval |
| Office Work Addition | `PayrollGroupService` **directly** in payroll generation | **None** (direct salary adjustment from attendance logs) | **No** | No pre-approval; daily confirmation email only |

The one mapping you most needed — **payment type → allowed expense category** — is stored in expense setup as `Expense.salaryAdditionType`, and the note-creation code simply copies it. The only "payment type" with no expense behind it is **Office Work Addition**.