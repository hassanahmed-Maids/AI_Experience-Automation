All paths are traced. Here is the answer, grounded in the code. Line numbers are for `magnamedia-payroll-management`. Runtime/DB-config items are flagged **unverified**.

## Summary of the mechanism

`AbstractPayrollManagerNote.amount` is a plain nullable `Double` with **no bean validation, no `@PrePersist`/`@PreUpdate`, and no DB `NOT NULL`/`> 0` check** (`AbstractPayrollManagerNote.java:27-29`, `99-101`). Nothing in the entity or the generic save path rejects `amount = 0` or `null`. So a zero ADDITION can enter from any creation path and from generic updates.

---

## 1. Every path that CREATES a PayrollManagerNote

All construct `new PayrollManagerNote()` and call the generic repository `save`. None validate the amount before saving.

| # | Path | File:line | Amount source | Can be 0? |
|---|------|-----------|---------------|-----------|
| 1 | `processExpenseRequestTodo` (the one in question) | `ManagerNoteService.java:146-173` | `expenseRequestTodo.getAmount()` | **Yes** – copied verbatim, no guard |
| 2 | `addFilipinaSalaryAdjustment` | `ManagerNoteService.java:52-65` | param, defaults to 500 if null | Yes if caller passes 0 |
| 3 | `createUnemploymentInsuranceDeductionForMaid` (DEDUCTION) | `ManagerNoteService.java:72-79` | param | Yes |
| 4 | `addReducedOverstayFinesAddition` | `ManagerNoteService.java:85-94` | param | Yes |
| 5 | `PayrollManagerNoteController.createEntity` (generic REST `POST /ManagerNotes`) | `PayrollManagerNoteController.java:84-100` | request body | **Yes** – only checks housemaid non-null and payroll-lock window |
| 6 | `bulkCreate` (`POST /ManagerNotes/bulkcreate`) | `PayrollManagerNoteController.java:127-157` | request body list; loops `createEntity` | **Yes** |
| 7 | `bulkRefund` (`POST /ManagerNotes/bulkrefund`) | `PayrollManagerNoteController.java:165-205` | copies `note.getAmount()` of source note | Yes if source is 0 |
| 8 | `syncSigningBonus` | `PayrollManagerNoteController.java:421-454` | param; **guards `> 0.0`** (deletes/skips at 0) | No |
| 9 | `MigrationController /housemaidScheduledAnnualVacations` | `MigrationController.java:405-416` | `entity.getAmount()` | Yes |
| 10 | `ScheduledAnnualVacationController.createEntity` | `ScheduledAnnualVacationController.java:69-81` | `entity.getAmount()` | Yes |
| 11 | `ProRatedSalariesService` (prorated / held salary) | `ProRatedSalariesService.java:57-59, 76-78` | rounded computed value | Yes if rounds to 0 |
| 12 | `_ProratedSalariesTransaction` | `_ProratedSalariesTransaction.java:151-153, 171-173` | rounded computed value | Yes if rounds to 0 |
| 13 | `NegativeSalariesService` | `NegativeSalariesService.java:271-273, 447-449, 510-512` | `tempBalance` | Yes |
| 14 | `PayrollGroupService` (office work addition) | `PayrollGroupService.java:704-714` | `Math.round(amount)`, seeded from 0 | **Yes** if no days worked |
| 15 | `PayrollAuditTodoService` (MV last-day) | `PayrollAuditTodoService.java:603-605` | `dailyRate` | Yes |
| 16 | `HousemaidUnpaidDayService` | `HousemaidUnpaidDayService.java:176` | rounded computed value | Yes |
| 17 | `AsyncService` (MV prorated re-add) | `AsyncService.java:473-484` | `log.getTotalSalary()`, created `paid=true` | Yes |
| 18 | `ScheduledMonthlyService` (DEDUCTION 150) | `ScheduledMonthlyService.java:214` | constant 150 | No |
| 19 | `NoKidsDeductionSchedualedJob` (DEDUCTION) | `NoKidsDeductionSchedualedJob.java:329-331` | computed | n/a to additions |
| 20 | `MvExtraSalaryScheduledJob` | `MvExtraSalaryScheduledJob.java:127-138` | `amount` | Yes |

**None of these validate the amount before `save`.** The only two that actively refuse a zero are `syncSigningBonus` (#8) and `syncExitLoan` (loan, not a note).

Low-code note: `ManagerNoteService` methods (`managerNoteService` bean, e.g. `processExpenseRequestTodo`, `createUnemploymentInsuranceDeductionForMaid`) are invoked via `BackgroundTask` builders wired from business rules (`ExpenseRequestTodoBusinessRule.java:105-117`, `PayrollManagerNoteController.java:332-338`). Whether additional DB-configured low-code rules call `managerNoteService.*` or post to `/ManagerNotes` **cannot be determined from source** — those live in DB config (**unverified**).

---

## 2. 🔴 Paths that UPDATE an existing note's amount / set it to 0

**There IS a zero-the-amount-instead-of-delete pattern, but only for DEDUCTION notes — not for ADDITION notes.** Two background-task methods do this:

- `MigrationService.migrateCurrentDeductionManagerNotesForChunk` — `MigrationService.java:489-503`: for each DEDUCTION note it creates an `EmployeeLoan` then sets `note.setAmount(0.0)` and rewrites the reason to `"Added to the maid's loans."`. Filtered to `noteType = DEDUCTION` (`:480`) and `amount > 0` (`:491`).
- `MigrationService.resetUnpaidDeductionsBalanceToZeroForChunk` — `MigrationService.java:389, 396`: sets DEDUCTION note amounts to 0 (or reduces them) to offset an unpaid balance. Loads only `findDeductionNotesByHousemaid(DEDUCTION, …)` (`:372`).

**Who can call them:** `MigrationController` admin endpoints (`/migrate/...`) that fan out into chunked `BackgroundTask`s — `MigrationController.java:1367-1370` (migrate) and `:1638-1641` (reset). Access is whatever guards those `/migrate` endpoints (**unverified** — controller-level security not shown here).

**These do NOT explain the ADDITION-note case.** Both are hard-scoped to DEDUCTION. There is **no cancel/void/reverse flow that zeroes an ADDITION note.**

**Generic update path that CAN zero any note (incl. ADDITION):** `PayrollManagerNoteController` has no update override, so it inherits `BaseRepositoryController`'s generic `PUT /ManagerNotes`. That persists whatever `amount` the client sends, including 0 — no amount validation. This is the only source-visible way to zero an ADDITION note's amount (plus the low-code/DB-rule possibility, **unverified**).

**Is the original amount preserved?**
- **Yes, in Hibernate Envers.** `PayrollManagerNote` is annotated `@org.hibernate.envers.Audited` (`PayrollManagerNote.java:26`), so every revision (including the pre-zero `amount`) is retained in the Envers audit tables. That is your best forensic source. (Whether the Envers tables are actually populated/retained in prod is **unverified**.)
- **Conditionally, in `AuditorAction`.** `@AfterUpdate afterCreateAndUpdate` (`PayrollManagerNote.java:179-190`) writes an `AuditorAction` row **only if** `logActionRequired == true` AND the current user has position `payroll_auditor`. `logActionRequired` is `@Transient` and set only by `customDelete` (`PayrollManagerNoteController.java:116-119`). So background/service/generic-PUT edits will **not** produce an `AuditorAction`.
- **No** dedicated history table, and **no** back-reference to the originating `ExpenseRequestTodo` on the note (the note only stores `referredMaidId` and the copied `description`), so the source amount is not recoverable from the note row itself.

---

## 3. Note lifecycle when the expense request is cancelled / rejected / reversed

**The note is kept, unchanged.** There is no listener or code that reacts to an `ExpenseRequestTodo` transitioning to a cancelled/rejected/reversed state:

- `ExpenseRequestTodoBusinessRule` fires only on `AfterCreate`/`AfterUpdate` when `status == PAID` and `confirmed` flips to true (`ExpenseRequestTodoBusinessRule.java:57-80, 101-104`). It only ever *creates* the note (via the BGT); it never deletes or edits it on a later status change.
- No `ExpenseRequestStatus.CANCELLED/REJECTED/REVERSED` handling exists anywhere in this module (grep returned nothing).
- The `PayrollManagerNote` has no FK to `ExpenseRequestTodo`, so nothing links back to void it.

So once created, the note survives independently of the expense request's later state. A downstream cancel/reject/reverse in the accounting/housemaid module (**unverified** — outside this repo) would have no effect on the note unless it went through `/ManagerNotes` PUT/delete.

---

## 4. Can `processExpenseRequestTodo` itself write 0?

**Yes.** The branch (`ManagerNoteService.java:134-173`):

```1:1:erp_magnamedia-payroll-management/src/main/java/com/magnamedia/service/ManagerNoteService.java
if (expenseRequestTodo.getConfirmed() != null && expenseRequestTodo.getConfirmed()) {
  if (paymentMethod == SALARY && !amountAlreadyPaid) {
    PayrollManagerNote managerNote = new PayrollManagerNote();
    managerNote.setAmount(expenseRequestTodo.getAmount());   // line 147 — verbatim copy, no guard
    ...
  }
}
```

- The guards are only: `confirmed == true`, `paymentMethod == SALARY`, and `amountAlreadyPaid` not true. **There is no `amount != null` / `amount > 0` check** before `setAmount` or before `save` (`:147`, `:168`, `:171-173`).
- `expenseRequestTodo.getAmount()` is passed straight through. If the confirmed todo carries `amount = 0` or `null`, the note is created with `amount = 0`/`null`.
- Can a todo reach confirmed with amount 0/null? The creation of the todo and its `confirmed`/`amount` fields live in the **accounting/housemaid module (upstream), not this repo** — whether that side enforces a non-zero amount is **unverified** from here. The payroll side does **not** guard it. Note the mirror logic in `ExpenseRequestTodoBusinessRule` guards the *loan* branch with `loanAmount > 0.0` (`:181-182`) but applies **no** equivalent guard to the addition amount — asymmetric, consistent with zero additions slipping through.

---

## 5. Does payroll do anything with a zero-amount note?

**A zero note is effectively inert for money, but it is not ignored everywhere — it can still be selected and mutated.**

- **Excluded from the "must be paid" generation:** `findHousemaidsWithNonPaidSalaryDisputeAndTaxiNotes` requires `p.amount > 0.0` (`PayrollManagerNoteRepository.java:292-293`). So a zero ADDITION does **not** trigger a forced payroll for its reason. (`getMustBePaidManagerNotes()` itself just returns the list of *reason picklist items* — `HousemaidPayrollPaymentServiceV2.java:107-146` — it is not a note filter.)
- **Excluded from payslip breakdown lines:** in `HousemaidPayrollBreakdownService`, notes are only rendered/summed when `note.getAmount() > 0.0` (`:246` and `:1734`). Zero notes add nothing to `additions_notes` and contribute 0 to totals.
- **BUT it can still be fetched and touched.** The regular-additions query `getByHousemaidAndNoteTypeAndAdditionReasonNotInV2` (`PayrollManagerNoteRepository.java:257-258`) has **no `amount > 0` filter**, so a zero note is loaded into `getAllManagerNotes` (`HousemaidPayrollBreakdownService.java:291-296`) before being dropped at the `> 0.0` line. And the "mark important as paid / attach todo" loop (`HousemaidPayrollBreakdownService.java:1449-1459`) operates on notes irrespective of amount. So a zero note can be flagged `paid`/linked to a `PayrollAccountantTodo`.

**Net:** a zero ADDITION contributes no money and occupies no forced-payment slot, but it is a live row that appears in note lists/queries and can be marked paid — i.e. cosmetically present, financially inert. The 510 zero rows are consistent with "created but contribute nothing."

---

## 6. Bulk / scripted creation paths (month-end mass posting)

Real paths that create many notes for many housemaids in one action:

- **`POST /ManagerNotes/bulkcreate`** (`PayrollManagerNoteController.java:127-157`) — arbitrary list from the client; amount from each body element; no zero guard. Permission `ManagerNotes.bulkcreate` + `create`.
- **`POST /ManagerNotes/bulkrefund`** (`:165-205`) — builds an inverse note per source id, copying `note.getAmount()`; funnels through `bulkCreate`. Permission `ManagerNotes.bulkrefund`.
- **`MvExtraSalaryScheduledJob`** (`MvExtraSalaryScheduledJob.java:110-138`) — iterates housemaids, one ADDITION each, `amount` from job logic; runs on a schedule.
- **`ScheduledMonthlyService`** (`ScheduledMonthlyService.java:214`) — mass monthly DEDUCTION (150), not additions.
- **`MigrationController` batch endpoints** — `/migrate/housemaidScheduledAnnualVacations` mass-creates airfare additions (`:386-416`); `/migrate/migrateCurrentDeductionManagerNotes` and `/migrate/resetUnpaidDeductions...` mass-**zero** DEDUCTIONs via chunked BGTs (`:1367`, `:1638`).
- **Payroll-generation services** (`ProRatedSalariesService`, `NegativeSalariesService`, `PayrollGroupService`, `PayrollAuditTodoService`, `HousemaidUnpaidDayService`, `AsyncService`) create additions in bulk during a payroll run, amount from computed salary math.

The month-end, single-day, single-requester, one-reason cluster of 18 zeros described is **most consistent with a scripted/low-code batch that posts ADDITION notes with a fixed reason and an amount pulled from a field that was empty/zero for those rows** — i.e. `bulkcreate` or a DB-configured low-code rule invoking `managerNoteService`/`/ManagerNotes` — since none of these paths validate the amount. **Any such low-code rule lives in DB config and cannot be confirmed or ruled out from source (unverified).**

---

## Bottom line on your hypothesis (Q2)

The "zero the amount instead of deleting" pattern **does exist in code, but only for DEDUCTION notes** (`MigrationService`), so it **does not explain 510 zero ADDITION notes**. For ADDITIONs, the plausible source-visible origins are: (a) `processExpenseRequestTodo` copying a 0/null `getAmount()` with no guard (Q4), (b) a generic `PUT /ManagerNotes` or `bulkcreate` posting 0, and (c) a DB-configured low-code rule doing either (**unverified**). The original amount, if a note was edited down to 0, is preserved in the **Hibernate Envers audit tables** (entity is `@Audited`) — that's where to confirm whether these were born-zero or zeroed-later.
