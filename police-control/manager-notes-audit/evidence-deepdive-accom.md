Confirmed. The `defaultAmount` from the expense config pre-fills the amount field, but the requester can override it (it's an editable form control). There is no live-out check anywhere in the expense request → todo → note/loan pipeline. The `ExpenseRequestTodo` carries no live-out field at all.

I have enough to answer all five questions comprehensively.

---

## Accommodation Relocation — how it works

**The core mechanism (why a payroll string search finds nothing):** This payment type is not defined anywhere in payroll code. It is a configured **expense** in the accounting module. When that expense request is confirmed, a background task calls `ManagerNoteService.processExpenseRequestTodo()`, which builds the `PayrollManagerNote` by *copying* the expense's configured addition-reason picklist item (`expense.getSalaryAdditionType()`) and, in the same method, creates the paired loan by copying `expense.getLoanType()`. The reason text lives in a database picklist row, not in source — hence invisible to a code search in payroll.

### 1. What creates it, and the exact reason/expense code
- **Creator:** `ManagerNoteService.processExpenseRequestTodo()` in payroll-management, triggered by a confirmed `ExpenseRequestTodo` from accounting.
- **Addition reason code:** it is **not hardcoded**. It's a `PicklistItem` under the `AdditionReasons` picklist, assigned to the expense's `salaryAdditionType`, and copied verbatim onto the note:

```150:151:magnamedia-payroll-management/src/main/java/com/magnamedia/service/ManagerNoteService.java
                    if (expense != null && expense.getSalaryAdditionType() != null)
                        managerNote.setAdditionReason(expense.getSalaryAdditionType());
```
- **Loan/expense code:** the enum `LoanType.ACCOMMODATION_RELOCATION("Accommodation Relocation")`, introduced under ticket **PAY-1616**, in `magnamedia-accounting/.../module/type/LoanType.java`. The label string "Accommodation Relocation" is what the business sees.

### 2. Is the CC live-out condition enforced in code?
**No.** There is no live-out gate anywhere in the creation pipeline — not in `processExpenseRequestTodo`, not in `ExpenseRequestService`/`UnifiedExpenseRequestService`, and the `ExpenseRequestTodo` entity carries no live-out field at all. The "maid must be CC live-out" rule is an operational/manual policy, enforced by the humans raising the request — consistent with your production facts (0% midnight, 0% no-requester, fully human-entered). Live-out status itself is carried elsewhere (e.g. contract/housemaid `liveOut` fields and payroll group status `IN_ACCOMMODATION_LIVE_OUT`), but none of those are checked when this note is created.

### 3. Is the paired LOAN automatic or manual?
**Automatic, within the same method** — but only if the requester entered a loan amount. In `processExpenseRequestTodo`, right after the addition, it creates an `EmployeeLoan` when `expenseRequestTodo.getLoanAmount() > 0`, setting its type from `expense.getLoanType()`:

```184:193:magnamedia-payroll-management/src/main/java/com/magnamedia/service/ManagerNoteService.java
                            EmployeeLoan employeeLoan = new EmployeeLoan();
                            employeeLoan.setHousemaid(housemaid);
                            employeeLoan.setLoanDate(new java.util.Date());
                            employeeLoan.setAmount(expenseRequestTodo.getLoanAmount());
                            employeeLoan.setExpenseRequestTodo(expenseRequestTodo);
                            ...
                            if (expense != null && expense.getLoanType() != null)
                                employeeLoan.setLoanType(AbstractEmployeeLoan.LoanType.valueOf(expense.getLoanType().name()));
```
- **Entity:** `EmployeeLoan`; **service:** `ManagerNoteService`. The "same time" pairing is real: the addition and the loan are booked in one transactional call off the same expense/todo. The addition amount comes from `expenseRequestTodo.getAmount()`; the loan amount from `expenseRequestTodo.getLoanAmount()` (both confirmed by copying from the `ExpensePayment` in `ExpenseRequestService.confirmRequests`).

### 4. Where do the five amounts come from?
**Typed in by the requester** on the expense request form. The expense config has an optional `defaultAmount` that *pre-fills* the amount field (`add-expense-form` sets `amount = res.defaultAmount`), but it is an editable control and can be overridden. It is **not a tier and not a locked parameter**. The clustering into only five distinct values reflects a small set of standard relocation costs that requesters type (or accept from the default) — a human convention, not a coded tier table.

### 5. Any other addition reason that also creates a paired loan?
The paired-addition-plus-loan behavior is **generic, not specific to Accommodation Relocation**. `processExpenseRequestTodo` applies the same two-step (addition from `salaryAdditionType`, loan from `loanType`) to **any** expense that is configured with:
- a SALARY payment method + a `salaryAdditionType` picklist item, **and**
- `allowToAddLoan = true` with a `loanType` (the expense-setup UI ties the loan-type selector to the `allowToAddLoan` toggle), **and**
- a positive loan amount entered on the request.

So any expense set up this way produces a matched addition + loan. Enum siblings created in the same PAY-1616 change (e.g. `TRANSPORTATION_ALLOWANCE_LOAN`) and other relocation-style codes (`CASH_ADVANCE_FOR_CLEANER_RELOCATION`) are configured the same way and would exhibit identical paired behavior if their expense records set both an addition reason and a loan type.

**Bottom line:** Accommodation Relocation is a data-configured accounting expense, not a payroll rule. One accounting service (`ManagerNoteService.processExpenseRequestTodo`) creates both the addition (reason copied from the expense's picklist) and the paired `EmployeeLoan` (type copied from the expense) in a single transaction. The live-out requirement and the five amounts are human-enforced/human-entered, not enforced or fixed in code.