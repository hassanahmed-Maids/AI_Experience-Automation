# Ask-the-code · What can write a `PayrollManagerNote` with `amount = 0`?

**Modules:** `erp/magnamedia-payroll-management,erp/magnamedia-accounting,erp/magnamedia-housemaid-management`
**Asked:** 2026-09-08 · **Session:** 46017 (answer verbatim in `evidence-zeroamount-payroll-conv46017.md`)
**Drives:** V1 (18 Abu Dhabi notes) and V2/V3 (the 510-note zero population)

## Why we are asking, and what we got wrong last time

Conversation 46016 established that `AbuDhabiMaidIncentiveExpenseJob` **cannot** post a zero-amount
expense request — it returns early at `MaidIncentiveService` L305-308. So something else made the 18
zero-amount `Abu Dhabi Incentive` notes of 2026-08-31.

**That question was asked without the payroll module in scope**, and the answer duly reported
`ManagerNoteService.processExpenseRequestTodo` as not existing. It does exist. This re-asks with
payroll in scope, which is where the note is actually written.

**The new hypothesis is zeroing, not creation:** a note is created with a real amount and its amount is
later **set to 0 as a soft-cancel** instead of the note being deleted. 510 zero notes carry free text,
one shape reads *"not valid and canceled after checking with …"*, and one requester's every zero landed
on a single day.

## The question (verbatim, as submitted)

> Context: in magnamedia-payroll-management, `ManagerNoteService.processExpenseRequestTodo` creates a
> `PayrollManagerNote` from a confirmed SALARY `ExpenseRequestTodo`, copying `getAmount()` and taking
> the addition reason from `Expense.salaryAdditionType`. In production we see 510 ADDITION notes with
> `amount = 0` across 15 addition reasons over twelve months, almost all carrying free-text
> descriptions, and 18 of them under one reason on a single day from one requester that otherwise
> posts only non-zero notes on month-ends. Please answer from the code, marking DB config or runtime
> data as unverified rather than inferring it:
>
> 1. **Every path that CREATES an `AbstractPayrollManagerNote` / `PayrollManagerNote`.** Not just
>    `processExpenseRequestTodo` — list controllers, services, scheduled jobs, importers, bulk
>    utilities and any low-code-invoked service method. For each, say whether it can produce
>    `amount = 0`, and whether anything validates the amount before saving.
> 2. 🔴 **Every path that UPDATES an existing note's `amount`, and specifically anything that sets it
>    to 0.** Is there a cancel / void / reverse / "not valid" flow that **zeroes the amount instead of
>    deleting the note**? If so, name it, say who can call it, and say whether the original amount is
>    preserved anywhere (a history table, an audit column, the expense request it came from). This is
>    the hypothesis we most want confirmed or denied.
> 3. **Is the note deleted or kept when its expense request is cancelled, rejected or reversed?** Show
>    what happens to an existing `PayrollManagerNote` when the upstream `ExpenseRequestTodo` moves to a
>    cancelled/rejected state after the note was already created.
> 4. **Can `processExpenseRequestTodo` itself write 0?** Can an `ExpenseRequestTodo` reach the
>    confirmed state with `amount` 0 or null, and does the note-creation path guard against it? Show
>    the branch.
> 5. **Does payroll do anything with a zero-amount note?** Is a zero note included in
>    `getMustBePaidManagerNotes` / payslip generation, or silently ignored? We need to know whether a
>    zero note is inert or whether it still occupies a slot in a payroll run.
> 6. **Is there a bulk or scripted creation path** that would post many notes for many housemaids in
>    one action on a month-end — an import, an admin screen, a low-code rule, a "generate for all"
>    utility? Name any that exist and what they set the amount from.
>
> Give file paths and line numbers. Where a path exists only in DB-configured low-code rules, say so
> rather than concluding it does not exist.

## What each answer decides

| Answer | Consequence |
|---|---|
| **A zeroing / soft-cancel path exists (Q2)** | 🔴 **Reframes the entire 510-note population.** They are not failed payments — they are cancelled ones, and **the original amount is gone from the note**, so the audit has been reading cancellations as zero-value payments. It would also mean money figures in the free text are the only record of what was cancelled |
| No zeroing path, creation guards exist (Q1, Q4) | The zeros come from a path outside these three modules — low-code or direct DB — which is itself the finding |
| Zero notes still enter payroll runs (Q5) | The zeros are not inert and the population matters operationally, not just as noise |
| A bulk month-end creator exists (Q6) | Explains the 18 directly, and the requester's five-month-end shape |

---

# Answered · session 46017 · 2026-09-08

## My zeroing hypothesis is denied — for additions

The zero-instead-of-delete pattern **does exist**, in `MigrationService`
(`migrateCurrentDeductionManagerNotesForChunk` sets `amount = 0.0` and rewrites the reason to
*"Added to the maid's loans."*). **Both such paths are hard-scoped to `noteType = DEDUCTION`.**
There is **no cancel/void/reverse flow that zeroes an ADDITION note.** Second hypothesis in two
questions to be denied by the code — and both times the answer was worth more than the hypothesis.

## 🔴 The real mechanism: nothing validates the amount

**Twenty code paths create a `PayrollManagerNote`. Two refuse a zero.**
`AbstractPayrollManagerNote.amount` is a nullable `Double` with **no bean validation, no
`@PrePersist`/`@PreUpdate`, and no DB `NOT NULL` or `> 0` constraint**.

`processExpenseRequestTodo` copies `expenseRequestTodo.getAmount()` **verbatim, with no guard** — its
only conditions are `confirmed == true`, `paymentMethod == SALARY`, and not already paid. A confirmed
request carrying 0 or null becomes a zero note.

🔴 **And the asymmetry is inside one file.** `ExpenseRequestTodoBusinessRule` guards the **loan**
branch with `loanAmount > 0.0` and applies **no equivalent guard to the addition amount**. Someone
knew to check; the check was written on one branch.

The generic `PUT /ManagerNotes` (inherited, no override) persists whatever amount the client sends,
including 0. `POST /ManagerNotes/bulkcreate` posts a client-supplied list with no zero guard —
**the answer names it as the most likely origin of the 18**, alongside a DB-configured low-code rule,
both unverifiable from source.

## 🔴 The finding this question was not asked to find

**A `PayrollManagerNote` is never voided when its expense request is cancelled, rejected or reversed.**
There is no listener for those transitions, and **the note carries no foreign key back to the
`ExpenseRequestTodo`**, so nothing can link back to void it. Once created, the note survives
independently of the request that justified it.

For a zero note that is harmless. **For a non-zero one it is not — the note is what payroll pays
from.** If a confirmed expense can be cancelled after the note exists, the cancellation does not stop
the payment. ⚠️ **Whether accounting permits that transition after `PAID`/confirmed is not established**
— the answer marked it unverified — so this is raised as a question with a named mechanism, not as a
confirmed loss. **It is the largest thing in this answer and it has nothing to do with zero amounts.**

## 🟢 The forensic source exists: Envers

**`PayrollManagerNote` is `@org.hibernate.envers.Audited`.** Every revision — including an amount
before it was edited to zero — is retained in the Envers audit tables. **That decides born-zero versus
zeroed-later for all 510**, which no query so far could.

Note what it does *not* cover: `AuditorAction` rows are written only when `logActionRequired` is true
**and** the acting user holds position `payroll_auditor` — and `logActionRequired` is set only by
`customDelete`. **Background, service and generic-PUT edits produce no `AuditorAction` at all.** The
visible audit trail misses exactly the paths most likely to have made these notes; Envers is the one
that does not.

## Zero notes are inert but not absent

Excluded from payslip lines and from must-be-paid selection (both filter `amount > 0.0`), so they move
no money. But they **are** loaded by the regular-additions query, which has no amount filter, and the
mark-as-paid loop touches notes irrespective of amount — **so a zero note can be flagged paid and
linked to a `PayrollAccountantTodo`.** Cosmetically present, financially inert.
