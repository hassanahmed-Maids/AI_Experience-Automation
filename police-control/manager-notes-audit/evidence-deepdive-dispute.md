I now have everything needed. The `PayrollManagerNoteBR` only fires for `taxi_reimbursement` (SMS), not `salary_dispute`. I've traced all creation paths, validation, and confirmed no dispute entity exists. Here is the complete answer.

## `salary_dispute` — full cross-module trace

The `salary_dispute` picklist item (list code `PICKLIST_MANAGER_NOTE_ADDITION_REASONS_CODE`) is a payroll **addition reason**, mirrored as an `EmployeeLoan`/`LoanType.SALARY_DISPUTE` and a payslip label. It is written onto `PayrollManagerNote.additionReason` (and read back in the payslip/loan reporting layers). Notes are created by **three** distinct paths, none of which validate the figure.

### 1. What creates a `salary_dispute` note — job, service, or manual? Both directions?

Three creators, all producing **ADDITION** notes on the reason itself; the DEDUCTION side comes from a separate mechanism.

- **Indirect (the main volume) — expense-code path across modules.** Any module can post an expense request; when an `ExpenseRequestTodo` reaches `PAID`+`confirmed`, `ExpenseRequestTodoBusinessRule` (in payroll) queues a `BackgroundTask` → `ManagerNoteService.processExpenseRequestTodo()`. That method builds a `PayrollManagerNote`, sets amount = the todo amount, type = ADDITION, and copies `additionReason` **verbatim** from `Expense.getSalaryAdditionType()`. So any expense whose `salaryAdditionType` is configured to the `salary_dispute` picklist becomes a `salary_dispute` note — a string search inside payroll finds nothing because the reason is inherited from the accounting `Expense` row at runtime. The expense itself is the one at parameter `EXPENSE_SALARY_DISPUTE_CODE` (default code `expense_salary_dispute`), raisable via UI, the GPT/WhatsApp path (`ExpenseRequestTodoService.addExpensesForMaidByGPT`), or `add-maid-refund` in acc-angular.
- **Service, direct.** `ManagerNoteService` hard-codes the reason to `salary_dispute` in two methods that have nothing to do with disputes: `addFilipinaSalaryAdjustment()` (defaults amount to 500 if null) and `addReducedOverstayFinesAddition()` ("Overstay Fines Waived"). Both build the note and save directly.
- **Job, direct.** `ProRatedSalariesService.processProRatedSalaries()` (payroll generation, new version) tags prorated starting-salary additions with `salary_dispute` as the reason.

**Both directions:** the reason itself is only ever set on ADDITIONs. It appears as a DEDUCTION because the same picklist code doubles as `EmployeeLoan`/`AbstractEmployeeLoan.LoanType.SALARY_DISPUTE` (`LoansController` sums it into `EmployeeLoansBean.salaryDispute`), and loan repayments are recovered as deductions. So ADDITION = manager note, DEDUCTION = the corresponding loan recovery — explaining the two-sided production data. Manual creation is also possible directly through `POST /payrollmanagernote` (`PayrollManagerNoteController.createEntity` in both housemaid-management and payroll).

### 2. Validation, cap, approval gate, or four-eyes?

**On the `salary_dispute` amount itself: none.**

- The payroll `PayrollManagerNote` business rule (`PayrollManagerNoteBR`) fires only for `taxi_reimbursement` (sends an SMS). There is **no** BR, cap, or ceiling for `salary_dispute`. `HousemaidDeductionBusinessRule` / `PayrollManagerNoteDeletedBR` don't gate it either.
- `PayrollManagerNoteController.createEntity` (payroll) applies only a **payroll-lock date** check (rejects additions during the lock window) — not an amount or approval check. The housemaid-management controller's `createEntity` has no gate at all.
- `processExpenseRequestTodo` performs **zero** validation on the amount — it copies `expenseRequestTodo.getAmount()` straight through.
- The **only** amount-based gate is upstream, on the *expense request*, and it is configurable/bypassable: `Expense.approvalMethod` — `AUTO_APPROVED` skips approval entirely; `APPROVAL_REQUIRED_ON_LIMIT` only requires approval when `amount > limitForApproval`; COO review only when `isLimitedCOO` and `amount > LimitCOO`. If the salary-dispute expense is auto-approved or under-limit, the note is created with no human sign-off. There is **no four-eyes rule** tying the requester to a different approver on this reason (and `recalculateAndUpdateApprover` auto-approves whenever creator == approver).
- The only dispute-specific validation anywhere is `ExpenseRequestTodoService.validateMaidPaymentPurposeAdditionalDescription`, which forces the purpose picklist to be `"No show"` — a categorical check, **not** an amount/cap/approval control.

This matches the production signal: 1,194 distinct amounts across 9,610 notes (free-entry amount, no cap), 49% midnight (batch/job-created), 52% no requester (job/service paths set no `requestedBy`, or the copied `creator` is null).

### 3. Is the disputed/needed amount stored anywhere an audit could compare against?

**No.** There is no dispute record, dispute ticket, or complaint entity that stores a "claimed" or "needed" amount for a salary dispute. Searches for `dispute`/`disputedAmount`/`neededAmount`/`claimedAmount` return only:

- `PicklistItem` "salary_dispute" (a label/reason, no amount),
- `LoanType.SALARY_DISPUTE` / `EmployeeLoan` (stores the *paid* amount as a loan, not a target),
- `Expense.salaryAdditionType` (the reason link, no target amount),
- `EmployeeLoansBean.salaryDispute` (a *sum of paid* loans).

The `Complaint`/`ComplaintType` entities exist but carry no monetary "amount owed" field for salary disputes (the only complaint hook is `checkCriminalDeduction`, unrelated to amount). **The paid amount is authoritative and self-referential** — there is no independent figure to reconcile against. An audit cannot verify whether AED X was the correct disputed sum, because the "correct" sum is never captured.

### 4. Who is allowed to raise one? Role/permission check?

**Effectively unrestricted, and inconsistent:**

- **Direct note creation** (`POST /payrollmanagernote`) has **no `@PreAuthorize`** on `createEntity` in either the payroll or housemaid-management controller. The permission-guarded endpoints (`customdelete`, `bulkcreate`, `bulkrefund`, `getHousemaidManagerNotes`, etc., all under `ManagerNotes`) do not cover plain create. So anyone with generic access to the endpoint can create the note.
- **Service/job paths** (`addFilipinaSalaryAdjustment`, `addReducedOverstayFinesAddition`, `ProRatedSalariesService`, `processExpenseRequestTodo`) run as **background/system code** with no user role check — the note is often created with `requestedBy`/`creator` null (matching the 52% "no requester").
- **Expense-request path** inherits only the expense's `approveHolderType` (FINAL_MANAGER / USER / EMAIL) approver configuration — a routing rule, not a "who may raise" permission; raising the request has no dedicated role gate beyond general expense-request access, and the GPT/WhatsApp entry point (`addExpensesForMaidByGPT`) is keyed off a maid mobile number.

**Bottom line:** `salary_dispute` is an uncapped, free-amount ADDITION reason created by three uncoordinated paths (an expense-request background task copying `Expense.salaryAdditionType`, two unrelated `ManagerNoteService` methods, and the proration job), with no amount validation, no cap, no four-eyes, no dedicated create-permission, and no stored target amount to audit the paid figure against.