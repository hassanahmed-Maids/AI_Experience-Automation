I have sufficient detail to answer precisely. Let me compile the final answer.

## Anti-attrition Incentive: how the `PayrollManagerNote` rows are produced

The key finding: **no code path directly does `setAdditionReason("anti_attrition_incentive")`**. Those notes are produced by a two-stage, indirect pipeline. A monthly job in **housemaid-management** posts a SALARY **expense request** to accounting; accounting auto-creates the `PayrollManagerNote` and copies the addition reason from the expense setup. The literal `anti_attrition_incentive` string lives only in the accounting **Expense** config (field `salaryAdditionType`) of expense code **`AAI - 01`**, plus in payroll's "must-be-paid" list.

---

### 1. Which job/service creates the notes

Two producers feed the same expense code (`AAI - 01`) → same addition reason:

- **`MaidIncentiveExperimentJob.processIncentiveExperimentNotes()`** — `magnamedia-housemaid-management/.../scheduledjob/MaidIncentiveExperimentJob.java`. Registered as JobDefinition name **"Maid Incentive Experiment Job"**, code **`maid_incentive_experiment_job`** (`SetupCustomJobDefinitions.java` ~L438). This is the ~900/maid monthly batch.
- **`AbuDhabiMaidIncentiveExpenseJob`** → `MaidIncentiveService.processAbuDhabiIncentives()` — the Abu Dhabi variant (same expense code).

Both call `MaidIncentiveService.createMaidIncentiveExpenseRequest(...)`, which IMC-POSTs to accounting `/expenseRequestTodo/createExpenseRequestTodoWithCreator?userId=<requesterId>` with `paymentMethod=SALARY`, `expenseRequestType=MAID_PAYMENT`, `expense.code = "AAI - 01"`.

The actual `PayrollManagerNote` is then created in payroll by **`ManagerNoteService.processExpenseRequestTodo()`** (`magnamedia-payroll-management/.../service/ManagerNoteService.java`, L113–174) when the SALARY expense is confirmed:

```146:151:magnamedia-payroll-management/src/main/java/com/magnamedia/service/ManagerNoteService.java
                    PayrollManagerNote managerNote = new PayrollManagerNote();
                    managerNote.setAmount(expenseRequestTodo.getAmount());
                    managerNote.setNoteReasone(expenseRequestTodo.getDescription());
                    managerNote.setNoteType(AbstractPayrollManagerNote.ManagerNoteType.ADDITION);
                    if (expense != null && expense.getSalaryAdditionType() != null)
                        managerNote.setAdditionReason(expense.getSalaryAdditionType());
```

**Cron / "last day of month":** The job's schedule is **not** in source — `maid_incentive_experiment_job` is registered with a `null` trigger and is seeded as a DB `JobInstance` (the ERP schedule table). There is no `if (isLastDayOfMonth) return` guard in code; the last-day behavior is operational (the DB schedule fires it month-end) and the proration math (denominator = days elapsed month-start→today) naturally yields whole-month proration when run on the final day.

---

### 2. Who gets it each month (eligibility)

Enrolment is by a per-maid manager-action note, not a dedicated table. Selection query:

- **`MaidManagerActionLogRepository.findHousemaidsWithIncentiveNotes(actionTypeCode, inactiveStatuses, pageable)`** (`magnamedia-housemaid-management/.../repository/maidManager/MaidManagerActionLogRepository.java`), called at `MaidIncentiveExperimentJob` L111–112, batched 50/page. Filters:
  - `h.housemaidType <> MAID_VISA`
  - `h.status NOT IN :inactiveStatuses` (`Housemaid.rejectedStatuses`)
  - `EXISTS` a `MaidManagerActionLog` with `actionType.code = 'Maid_Incentive_Experiment'` and `incentiveAmount IS NOT NULL`

- Per-maid guard in the job: skip if any note for the same contract already has `incentiveRequestDate` in the current month (`filterNotesWithContractIncentiveCheck`, `hasIncentiveRequestThisMonth`).

Abu Dhabi variant: **`HousemaidExtraFieldsRepository.findEligibleForAbuDhabiIncentive(...)`**, filtering `abuDhabiIncentiveType IS NOT NULL AND code <> 'NO_AD_INCENTIVE'`, `abuDhabiIncentiveOffered <> 0/NULL`, and `lastAbuDhabiIncentiveProcessedDate IS NULL OR < firstDayOfMonth`.

---

### 3. What decides the amount

There is **no tier table / switch**. The amount is a **per-maid field** captured at enrolment, plus a parameter-driven allowed list:

- Per-maid amount: **`MaidManagerActionLog.incentiveAmount`** (`Double`). Used full in the "normal case" (`MaidIncentiveExperimentJob` L186).
- Allowed values (validation only): parameter **`MAID_INCENTIVE_CONFIGS_PARAM`** JSON key **`amount_values`**, default `"100,150,200,250,300,350"` (`SetupCustomParameters.java` ~L1467–1473; reader `MaidManagerActionLogService.getAllowedIncentiveAmounts()`, fallback `[100,150,200,250,300,350]`). Production has clearly extended this to include 400/500. The same param carries **`expenseCode="AAI - 01"`** and **`requesterId="2226"`**.
- Abu Dhabi field: **`HousemaidExtraFields.abuDhabiIncentiveOffered`** (`Integer`), type `abuDhabiIncentiveType` (`PIT_STOP`/`RELOCATION`/`AD_CANCELLED`).

**Proration formula** (the ~1/3 of prorated rows):

```335:338:magnamedia-housemaid-management/src/main/java/com/magnamedia/scheduledjob/MaidIncentiveExperimentJob.java
        int daysBetween = DateUtil.daysBetweenDates(startDate, endDate) + 1;
        int totalMonthDaysTillNow = DateUtil.daysBetweenDates(firstDayOfMonth, currentDate) + 1;
        return (daysBetween / (double) totalMonthDaysTillNow) * noteAmount;
```

Dates used: `startDate = max(tagDate, firstOfMonth)`, `endDate = untag/termination date` (`getDateWhenMaidBecameWithClient`, `getNextDateWhenContractMaidChanged`, `getDateOfTermination`). Abu Dhabi variant uses `offered * (eligibleDays / totalDaysInMonth)` (`MaidIncentiveService` L298–299). Run on the last day, `totalMonthDaysTillNow` = days-in-month — matching your "days / days-in-month" observation.

The final label (`anti_attrition_incentive`) is **not** set by these jobs; it comes from `Expense.salaryAdditionType` on expense `AAI - 01` (accounting DB config).

---

### 4. Is there an enrolment / participant entity?

No dedicated anti-attrition/winner table. Enrolment lives on existing entities:

- **`MaidManagerActionLog`** (`entity/maidManager/MaidManagerActionLog.java`) — the de-facto "participant" record: `housemaid` FK, `actionType = Maid_Incentive_Experiment`, `incentiveAmount` (the chosen amount/"tier"), `contract`/`client`, and `incentiveRequestDate` (last monthly grant, used for idempotency).
- **`HousemaidExtraFields`** — Abu Dhabi enrolment: `abuDhabiIncentiveType`, `abuDhabiIncentiveOffered`, `lastAbuDhabiIncentiveProcessedDate`.

(`RaffleDrawParticipant` is the analogous participant pattern but is unrelated to anti-attrition. `ContractAttritionHistory` in reporting is analytics-only.)

---

### 5. What sets REQUESTED_BY / APPROVED_BY — human approval or fixed operator?

**It's a fixed operator stamped by the batch, not a human approval step.**

- The expense request is created with `?userId=<requesterId>` where `requesterId` comes from the config parameter (`MAID_INCENTIVE_CONFIGS_PARAM.requesterId`, default **`2226`**). In `ExpenseRequestTodoController.createExpenseRequestTodoWithCreator`, that user becomes `expenseRequestTodo.setRequestedBy(creator)` (L525–526).
- When the note is created, `ManagerNoteService.processExpenseRequestTodo` does:

```131:171:magnamedia-payroll-management/src/main/java/com/magnamedia/service/ManagerNoteService.java
            User requestedBy = expenseRequestTodo.getRequestedBy();
            ...
                    managerNote.setCreator(requestedBy);
```

So the note's creator/requester is always the same configured user (2226). `PayrollManagerNote` has no separate `approvedBy` column — the reporting "requester = approver" is because SALARY expense additions are auto-confirmed (no manager/COO approval gate for the SALARY payment method in `paymentTrigger`/expense setup) and the single service account is stamped on every row. That is exactly why one person appears as both requester and approver on all ~7,684 rows — it's a batch service account, not a human review.

---

**Caveat:** the literal `anti_attrition_incentive` mapping and the actual monthly cron are stored in accounting **Expense (`AAI - 01`, `salaryAdditionType`)** and the ERP **`JobInstance`** table respectively — both DB config, not in the repo source — so those two exact values can't be read from code here. Everything else above is code-verified.