# Investigation: `anti_attrition_incentive` notes dated earlier than any enrolment row

Note on scope: `MaidManagerActionLog extends BaseEntity`, and `BaseEntity` (with `creationDate` / `lastModificationDate`) lives in the shared `com.magnamedia.core` library, **not** in any of the three repos in this workspace. Statements about `BaseEntity`'s auditing behavior are inferred from usage and are marked **unverified against source** below.

---

## 1. Lifecycle of `MaidManagerActionLog` rows of type `Maid_Incentive_Experiment`

**Entity** — `erp_magnamedia-housemaid-management/.../entity/maidManager/MaidManagerActionLog.java`. It has **no** `@PrePersist`/`@PreUpdate`/`@EntityListeners`/soft-delete flag of its own; it just extends `BaseEntity`.

**The only writers of incentive-typed rows are the CRUD controller** `MaidManagerActionLogController` (extends `BaseRepositoryController`), routed at `/maidNote`:

- **Create** — `createEntity(...)`:

```100:125:erp_magnamedia-housemaid-management/src/main/java/com/magnamedia/controller/MaidManagerActionLogController.java
    public ResponseEntity<?> createEntity(MaidManagerActionLog log) {
        ...
        if (HousemaidManagementModule.MAID_INCENTIVE_EXPERIMENT_ACTION_TYPE_CODE.equals(actionType.getCode())) {
            maidManagerActionLogService.validateIncentiveExperimentPositionAccess();
            maidManagerActionLogService.validateIncentiveAmount(log);
        }
        log.setActionDate(new LocalDate().toDate());
        return new ResponseEntity<>(super.createEntity(log), HttpStatus.OK);
    }
```

- **Update** — `updateEntity(...)` (lines 127-162): validates the same way but **does not touch `actionDate`** (it only requires it be non-null). If the type is changed away from incentive it nulls `incentiveAmount`/`client`/`contract`/`incentiveRequestDate`.
- **Delete** — `deleteEntity(...)` (lines 164-166) delegates to `super.deleteEntity(log)`. This is the generic base-controller delete; there is **no source-level soft-delete flag** and **no history snapshot written on delete**. Whether the base library performs a hard `DELETE` or an audited/Envers soft delete is **unverified** (base class is in the core library).

**Update-in-place vs delete+insert (tier change / re-enrol):** In source there is no "unenrol/re-enrol" routine. A tier change or re-enrolment goes through the **same generic update endpoint** and **updates the existing row in place** (same PK; `actionDate` is *not* re-stamped). A brand-new enrolment is a fresh `createEntity` insert. Nothing in source deletes-then-reinserts incentive rows. **Whether the UI/low-code layer instead issues a delete + create is DB/low-code config and unverified.**

**Other creators of `MaidManagerActionLog`** (grep of `new MaidManagerActionLog()`): `StandUpShootingStep`, `NewArrivalAssessmentStep`, `AdjustmentStandUpShootingStep`, `PrepRBsToDoService:854`, `HousemaidService:4124`, `AttendanceService:1320`, `GptDataGatheringService:3615`, `InterviewVisitController:229/237`, `TerminationController:1238/1288/1334`, `MaidManagerWorkOrderController` (multiple). **None of these set the `Maid_Incentive_Experiment` action type** — they create arrival/attendance/termination/forgiveness/GPT notes. So the incentive-typed rows are only ever produced by the `/maidNote` create path.

**Cascade from `Housemaid`/`Contract`:** `Housemaid.java` has **no** `@OneToMany` to `MaidManagerActionLog` — the only action-collection is commented out at lines 407-412. `Contract.java` has **no** reference to `MaidManagerActionLog` at all. So **there is no JPA cascade-delete** from either parent; the association is one-directional `MaidManagerActionLog → Housemaid/Contract` (`@ManyToOne`, lines 27-30 and 71-77 of the entity). A DB-level `ON DELETE CASCADE` FK, if any, is **unverified**.

**History:** The batch reads Contract *history* via `HistorySelectQuery` (so `Contract` is Envers-audited). Whether `MaidManagerActionLog` itself is audited/`@Audited` is **unverified** — not visible in this entity's source.

---

## 2. What populates the persisted date (`ACTION_DATE`)

- **Exact field:** `private Date actionDate;` — `MaidManagerActionLog.java:36`, getter/setter at lines 91-97. The setter is a plain `this.actionDate = ...` with no timestamping logic. This is the column the warehouse exposes as `ACTION_DATE`.
- **Set once at creation, to "now":** only in `MaidManagerActionLogController.createEntity:123` (`new LocalDate().toDate()`).
- **NOT re-stamped on update:** `updateEntity` never calls `setActionDate`; it only rejects a null value (lines 135-137). So on any edit the date is **whatever the caller sends in the request body → user-editable**. There is no `@PreUpdate`, `@LastModifiedDate`, or auditing listener on this field (confirmed: entity has no such annotations).
- **Distinct create/modify timestamps:** the entity itself declares none. It relies on `BaseEntity` for `creationDate` and `lastModificationDate` — the job reads `note.getCreationDate()` (e.g. `MaidIncentiveExperimentJob.java:225, 370`) and `contract.getLastModificationDate()`. So there are effectively **three** dates in play: `actionDate` (business/user date, on this entity), plus `creationDate` and `lastModificationDate` (from `BaseEntity`, **unverified — not in this repo's source**; their auto-stamping behavior is assumed from Spring Data auditing conventions).

**This is the crux of the finding:** the batch's `EXISTS`/selection and proration use **`creationDate`** (see `findHousemaidsWithIncentiveNotes` and `findByHousemaidAndActionTypeOrderByCreationDateDesc`), while the warehouse compares against `ACTION_DATE` = `actionDate`. Because `actionDate` is caller-supplied on update and never re-stamped, an incentive row can carry an `actionDate` far earlier than its `creationDate`, which alone can make the note look "older than the earliest action-log row."

---

## 3. Every route into an `anti_attrition_incentive` note (expense `AAI - 01`)

**How the addition reason is derived (shared by ALL routes):** In payroll, `ManagerNoteService.processExpenseRequestTodo` sets the note's addition reason from the *expense's* `salaryAdditionType`:

```146:153:erp_magnamedia-payroll-management/src/main/java/com/magnamedia/service/ManagerNoteService.java
                    PayrollManagerNote managerNote = new PayrollManagerNote();
                    managerNote.setAmount(expenseRequestTodo.getAmount());
                    managerNote.setNoteReasone(expenseRequestTodo.getDescription());
                    managerNote.setNoteType(AbstractPayrollManagerNote.ManagerNoteType.ADDITION);
                    if (expense != null && expense.getSalaryAdditionType() != null)
                        managerNote.setAdditionReason(expense.getSalaryAdditionType());
                    managerNote.setNoteDate(new java.util.Date());
```

`Expense.salaryAdditionType` is a `PicklistItem` (`erp_magnamedia-accounting/.../entity/Expense.java:189`), configured per expense code via `salary_addition_type` (`ExpenseSetupLegacySyncService:436-455`, `UnifiedExpenseRequestService:980`). **The mapping `AAI - 01` → addition reason `anti_attrition_incentive` is DB configuration on the Expense row — unverified in source.** Consequently **any** producer that resolves to the Expense whose code is `AAI - 01` lands under the same addition reason.

Now each sub-question:

- **`AbuDhabiMaidIncentiveExpenseJob` / `processAbuDhabiIncentives()`:** It calls the **same** `createMaidIncentiveExpenseRequest(...)` helper (`MaidIncentiveService.java:314-317`) and needs **no `MaidManagerActionLog`** — it selects from `extraFieldsRepository.findEligibleForAbuDhabiIncentive(...)` (line 100). **However, it uses a *different* expense code:** it loads `ABU_DHABI_MAID_INCENTIVE_CONFIGS_PARAM` (`loadConfig`, lines 192-201), whereas the experiment job loads `MAID_INCENTIVE_CONFIGS_PARAM` (`MaidIncentiveExperimentJob.java:69`). **Whether those two params carry the same or different `expenseCode` values is DB parameter config — unverified.** 
  - If the AD param's `expenseCode` is also `AAI - 01`, then yes, AD payments land under `anti_attrition_incentive` **with no enrolment row at all** — which by itself explains payments without a `MaidManagerActionLog`.
  - If it is a different code, it resolves to that expense's own `salaryAdditionType` (e.g. an "Abu Dhabi Incentive" reason). The reason is configured on the accounting `Expense` row keyed by whatever `expenseCode` that param holds — **not determinable from source**.
- **Manual / UI path with code `AAI - 01`:** Yes. `POST /expenseRequestTodo/createExpenseRequestTodoWithCreator` (and the plain `createEntity`) both funnel through `createExpenseRequestTodo → validateAndPrepareEntity` (`ExpenseRequestTodoController.java:154-215`). A user (or any module) submitting an expense request with expense code `AAI - 01`, once confirmed, produces the identical note with the same addition reason. There is no enrolment-row check on this path.
- **Retry / catch-up / back-fill / prior-month re-run:** **None found in source** for the incentive flow. `MaidIncentiveExperimentJob` always uses `new Date()` for the current month (`initializeDateVariables:141-145`) — no month parameter, no back-fill loop; grep for catch-up/backfill/prior-month/retry in that job returned nothing. The AD job is likewise always "current month." (A manual re-run of the *job* would still stamp the current month.)
- **Low-code rule / API writing the note directly:** In source, the note is only ever written by payroll's `processExpenseRequestTodo`, triggered asynchronously (see #4). No source path writes a `PayrollManagerNote` with this addition reason directly. **Any low-code rule that creates an ExpenseRequestTodo or PayrollManagerNote directly is unverified.**

---

## 4. Is enrolment re-evaluated at payment time, or only at selection time?

**Only at selection time — and payment happens later, decoupled.** The `EXISTS` on `MaidManagerActionLog` is evaluated **once**, when the page is read:

```72:81:erp_magnamedia-housemaid-management/src/main/java/com/magnamedia/repository/maidManager/MaidManagerActionLogRepository.java
      @Query("SELECT DISTINCT h.id FROM Housemaid h " +
             "WHERE h.housemaidType <> 'MAID_VISA' " +
             "AND h.status NOT IN :inactiveStatuses " +
             "AND EXISTS (SELECT 1 FROM MaidManagerActionLog mal " +
             "            WHERE mal.housemaid = h " +
             "            AND mal.actionType.code = :actionTypeCode " +
             "            AND mal.incentiveAmount IS NOT NULL)")
```

The job iterates that page and calls `createMaidIncentiveExpenseRequest` (`MaidIncentiveExperimentJob.java:190-193, 236-238`). That helper only **POSTs an ExpenseRequestTodo** to accounting (`MaidIncentiveService.java:366-372`). The `PayrollManagerNote` is **not** created there. It is created much later, only when the ExpenseRequestTodo becomes `confirmed`, via a **background task on the `SequentialQueue`**:

```106:118:erp_magnamedia-payroll-management/src/main/java/com/magnamedia/businessrule/ExpenseRequestTodoBusinessRule.java
                BackgroundTask backgroundTask = new BackgroundTask.builder(
                        "processExpenseRequestTodo_" + expenseRequestTodo.getId() + "_" + businessEvent.toString(),
                        Setup.getCurrentModule().getCode(),
                        "managerNoteService",
                        "processExpenseRequestTodo")
                        .withQueue(BackgroundTaskQueues.SequentialQueue)
                        ...
```

So between selection and note creation there are two async hops (accounting approval + payroll background task), and **the enrolment condition is never re-checked** at any of them. **Yes — a maid can be paid for a month even if the `EXISTS` condition ceased to be true after selection** (e.g. the incentive row was later edited/retyped/deleted, nulling `incentiveAmount` as `updateEntity` does for non-incentive types). The job's only guard against re-processing is `incentiveRequestDate` within the current month (`filterNotesWithContractIncentiveCheck` + `hasIncentiveRequestThisMonth`, lines 453-495), which is about de-duplication, not re-validation.

---

## 5. Proration and back-dating

**The note date itself is stamped `new Date()` at payroll-processing time** (`ManagerNoteService.java:152`) — payroll does **not** back-date `noteDate` to a prior month. So the payroll `noteDate` should be the *processing* date, not earlier than the run.

The **proration** logic in the housemaid job **does reach into prior periods** but only affects the *amount*, not the note date: `noteMonthPartAmountCalculation`/`calculateDateRangeAmount` walk contract history backward and clamp to `[firstDayOfMonth, currentDate]` (`MaidIncentiveExperimentJob.java:262-339`). No `noteDate`/payroll-month override is passed to accounting (`createMaidIncentiveExpenseRequest` sends only amount, expense code, requester, notes, contractId — no date; `MaidIncentiveService.java:347-364`).

**Therefore the unsound-date candidates are, in order of likelihood:**
1. **`ACTION_DATE` = `actionDate` being user-editable / not re-stamped on update** (see #2) — the note's warehouse date can predate its own `creationDate`, making the comparison against "earliest action-log row" meaningless. This is the strongest source-level explanation.
2. **A different producer with no enrolment row** — AD job or a manual `AAI - 01` request (see #3) — where there is simply no `MaidManagerActionLog` to compare against, so *any* note date looks "earlier than the earliest row."
3. **Whether the payroll note is later *attached* to an already-closed/earlier payroll period** (i.e. `noteDate` = now, but the warehouse's "note date" actually reflects the payroll period it settles into) is **unverified** — that mapping lives in payroll generation config/DB, not in the paths read here.

No source path back-dates `noteDate` to cover prior months.

---

## 6. Amount validation against `MAID_INCENTIVE_CONFIGS_PARAM.amount_values`

**At write time only — never at pay time.** Validation happens in the `/maidNote` create/update controller via `MaidManagerActionLogService.validateIncentiveAmount → isValidIncentiveAmount → getAllowedIncentiveAmounts`:

```117:134:erp_magnamedia-housemaid-management/src/main/java/com/magnamedia/service/MaidManagerActionLogService.java
    public List<Integer> getAllowedIncentiveAmounts() {
        ...
        incentiveParameters = mapper.readValue(
                Setup.getParameter(Setup.getCurrentModule(), HousemaidManagementModule.MAID_INCENTIVE_CONFIGS_PARAM),
                Map.class);
        ...  // reads "amount_values"
    }
    public boolean isValidIncentiveAmount(Double amount) {
        ...
        return getAllowedIncentiveAmounts().contains(amount.intValue());
    }
```

Notable gaps:
- **No validation at pay time.** Neither `MaidIncentiveExperimentJob` nor `MaidIncentiveService.createMaidIncentiveExpenseRequest` re-checks the amount against `amount_values`. The job even **prorates** the stored amount (`calculateProportionalAmount:335-339`), so the amount actually paid is routinely **not** one of the allowed discrete values by design.
- **Default fallback masks bad config:** if the param is missing/blank, `getAllowedIncentiveAmounts` returns the hard-coded `[100,150,200,250,300,350]` (line 115) — so validation silently uses defaults rather than the configured list.
- The `correctIncentiveHistoricalData` back-fill utility (`MaidManagerActionLogService:213-289`) can *re-derive* `incentiveAmount` by string-matching allowed amounts inside the free-text note (`extractIncentiveAmountFromNote:377-404`) and **saves without re-validating** — another write path that can set amounts.
- The actual contents of `MAID_INCENTIVE_CONFIGS_PARAM.amount_values` are **DB parameter config — unverified**.

---

### Bottom line (source-supported)
The two most defensible source explanations for "note dated before the earliest action-log row" are: **(a)** `ACTION_DATE`/`actionDate` is a caller-supplied, non-re-stamped field independent of `creationDate`, so it is not a reliable proxy for enrolment time (§2); and **(b)** at least one legitimate producer — the Abu Dhabi job and any manual `AAI - 01` request — creates the same addition-reason note **with no `MaidManagerActionLog` enrolment row at all** (§3), which trivially produces "payments without/earlier-than an enrolment row." The enrolment condition is also never re-checked between selection and payment (§4). Everything hinging on the `AAI - 01` → `anti_attrition_incentive` mapping, the two jobs' `expenseCode` values, the job schedules, and the `amount_values` list is **DB/low-code configuration and unverified from source.**
