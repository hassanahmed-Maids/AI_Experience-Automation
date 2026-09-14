All findings confirmed. Here is the complete audit.

# PayrollManagerNote ADDITION Audit — No Linked Expense Request

All six paths create additions **directly** (no expense request; the entity has no expense-request field), and — critically — **none of them set `fromManager`, `purpose` (except referral bonus), or an explicit `creator`/picklist manager.** There is therefore **no owning-department stamped on the note itself** in any of the six. Ownership is only inferable from the driving module/job and surrounding config. Details per item below.

---

## 1) Prorated Salary (the NON-MaidVisa one)

- **Creator**: `_ProratedSalariesTransaction.calculate()` — module **payroll-management** (`salarycalculation/version2NewZeroPhase/_ProratedSalariesTransaction.java`, note created ~L150–162).
- **Is it the monthly payroll batch?** Not a dedicated cron. It runs reflectively during **primary payroll audit-log generation** (`HousemaidPayrollPaymentServiceV2.runTransactionsNew` → phase-zero transactions), driven indirectly by the daily Quartz job **`generate_payroll_audit_todo_list`** (`PayrollAuditTodoJob`, "runs every day"; cron is DB-configured, `null` in source). It fires **only for primary payroll** (`!isSecondary`), for maids whose start date is ≥27th of the previous payroll month and <1st of the current one.
- **Fields set**: `noteType=ADDITION`, `additionReason=` picklist **`AdditionReasons` / code `prorated_salary`**, `noteReasone="Prorated salary for maids with salary start date greater than 26th of previous month"`. **No creator, no fromManager, no purpose.**
- **Owning-department signal**: none on the note. Only implied by the Payroll module / `payroll_auditor` review position.
- **Difference from the MV path** (`AsyncService.processCurrentMonthHousemaidsBatchBT`):
  - Different picklist code: ordinary = **`prorated_salary`** vs MV = **`mv_prorated_salary`**.
  - Different phase/trigger: ordinary is created during **audit-log generation (pre-payment)**; MV is created during the **payment-transfer phase** (accountant-todo closing, `allTransfersAreDone…`) for maids with a linked `MaidService` who are still active.
  - MV sets `paid=true`, `payrollMonth`, `payrollAccountantTodo`, and is in `getMustBePaidManagerNotes()`; ordinary is a plain non-must-pay addition.
  - Note: there's also a legacy `ProRatedSalariesService.processProRatedSalaries()` using reason `salary_dispute`, but it has **no live callers** — not the current ordinary path.

## 2) Raffle Prize

- **Creator**: `RafflePerformerJob.addPrizesToPayroll()` — module **housemaid-management** (`scheduledjob/raffle/RafflePerformerJob.java`, note created L264–279).
- **Job that drives it**: Quartz job **`job_to_start_raffle_draw`** ("Job to start Raffle Draw", `RafflePerformerJob.class`, registered in `SetupCustomJobDefinitions.java` L196–199). **Cron/interval is not in source** (4th arg `null`; schedule lives in the DB `JobInstance`). Can also be triggered manually via `GET /jobstriggercontroller/performRaffle`.
- **Fields set**: `noteType=ADDITION`, `additionReason=` **`AdditionReasons` / `raffle_prize`**. `fromManager` never set. **`creator` IS set** here (the one exception): if null or `admin`, it's overwritten with the system user login **`erp_user`** (`USER_ERP_LOGIN_NAME`).
- **Owning-department signal**: none beyond the system user `erp_user`; prize amounts/winners come from `raffle_*` parameters (no department).

## 3) Forgive Deduction — automatic `cover_deduction_limit` / `cover_negative_salary`

- **Creator**: `NegativeSalariesService.negativeSalariesBean(...)` — module **payroll-management** (`service/NegativeSalariesService.java`; `cover_deduction_limit` note L271–288, `cover_negative_salary` note L447–464). Each also creates a matching `EmployeeLoan`.
- **Trigger**: **No active dedicated Quartz job** (the old `@Scheduled(cron="0 0 1 27 * ?")` `run()` is commented out). It's invoked inline during **housemaid payroll file generation** (`HousemaidPayrollGenerationService.generateHousemaidsPayrollList` / `HousemaidPayrollController` endpoints such as `/generatePayrollv2`, `/generateFinalPayroll`), **gated to the payroll-jobs window** — day **26** through day **5** — via params **`Payroll Jobs Start`=26** / **`Payroll Jobs End`=5**, only when `withJop=true`.
- **Fields set**: `noteType=ADDITION`; reason codes **`cover_deduction_limit`** / **`cover_negative_salary`** on `AdditionReasons`; `noteReasone="Automatic Addition to Cover Deduction Limit"` / `"…Cover Negative Salary."`. **No creator, no fromManager, no purpose.**
- **Owning-department / config**: nationality-specific deduction-cap params (`Deduction Limit`=250, `Filipinoes Deduction Limit`=700, `Maids.at Deduction Limit`=700, `Ethiopian`/`Africans`=250) drive the amount; the payroll-jobs window params drive timing. Reviewed downstream under the **`payroll_auditor`** position (flagged as `HOUSEMAID_REPETITIVE_ADDED_PAYMENTS`). Distinct from **manual** `forgive_deduction` additions (`MaidManagerWorkOrderController.addPayrollManagerNoteAddition`, `HousemaidUnpaidDayService`).

## 4) Last Day CC Switch Adjustment

- **Creator**: `PayrollAuditTodoService.doMaidSwitchedToMvCalculations(...)` — module **payroll-management** (`service/payroll/generation/PayrollAuditTodoService.java`, note L603–612).
- **Automated, not user-facing bulk entry.** It runs in the background task **`createCcSwitchingToMvTodo`**, enqueued by the daily Quartz job **`generate_payroll_audit_todo_list`** (`PayrollAuditTodoJob`) for HOUSEMAIDS/WPS/PRIMARY rules (also reachable from the 7 PM early-generation service, and lazily when an auditor opens the CC-switch screen). Condition: switch date = last day of switch month and `lastCcSalary>0`; amount = one day's rate. The user-facing `/payrollAuditTodo/*` endpoints only **review/confirm/pay/modify/exclude** — they don't create the note.
- **Fields set**: `noteType=ADDITION`; reason **`last_day_cc_switch_adjustment`** on `AdditionReasons`; `noteReasone="Last-day CC switch adjustment"`. **No creator, no fromManager, no purpose.**
- **Owning-department / config**: audit owned by **`payroll_auditor`** (resource `payrollAuditTodo`); config keys `PARAMETER_PAYROLL_CC_SWITCHING_TO_MV_DEPLOYMENT_PAYROLL_MONTH` and `PARAMETER_MAX_ADDITION_VALUE_TO_MAID_AFTER_SWITCH_TO_MV` (default 5000). Source rows (`CcMaidSwitchedToMv`) originate from the sales-side CC→MV switch (SAL-3842).

## 5) Office Work Addition

- **Creator**: `PayrollGroupService.checkOfficeWorkDaysBeforeStartDate(...)` — module **payroll-management** (`service/payroll/generation/newVersion2/PayrollGroupService.java`, note L704–714).
- **Hybrid**: a **person assigns** office work (user-facing `POST /housemaiddetails/assignOfficeWork`, setting status `ASSIGNED_OFFICE_WORK`; also `CameraReadyService` automated), but the **note is created automatically** by a background task **`calculateSalaryBeforeStartDate`** (≈65-min delay) fired by `HousemaidStartDateBR` when a maid's `startDate` first goes null→value. It tallies `ASSIGNED_OFFICE_WORK` attendance-log days (logged daily by `housemaid_unpaid_day_job`) between landing and start date.
- The Quartz job **`assigned_office_work_additions_job`** (`AssignedOfficeWorkAdditionsConfirmationJob`) is **confirmation/email only** — it does **not** create notes.
- **Fields set**: `noteType=ADDITION`; reason **`office_work_addition`** on `AdditionReasons`; dynamic `noteReasone` ("She has worked for N days…"); `numberOfDaysWorkedAtOffice`. **No creator, no fromManager, no purpose.**
- **Owning-department signal**: assignment tied to the accommodation-manager team (`PARAM_STAFF_ACCOMMODATION_MANAGER_TEAM`); confirmation email recipients via `PARAMETER_PAYROLL_ASSIGNED_OFFICE_WORK_ADDITIONS_EMAIL_RECIPIENTS`; the email text explicitly names **"Delighters Manager"** and **"money control manager."**

## 6) Bonus follow-up — ReferralBonusesManagerJob schedule & other bonus paths

**Schedule of `ReferralBonusesManagerJob`**: registered as Quartz job **`referral_bonuses_manager_job`** ("Referral Bonuses Manager Job", `SetupCustomJobDefinitions.java` L405–407) with the 4th arg **`null`** — **no cron/interval in source**. The schedule lives in the ERP DB (`JobInstance` for `referral_bonuses_manager_job`); to get the exact cron you must query production. The only legacy in-code cron was `GrantReferralScheduledTask` (`0 0 6 * * *`, daily 6 AM) — but that file is **entirely commented out** and superseded.

**Why bonuses land across ~20 different hours** — it is **not** multiple jobs or multiple background tasks. The referral bonus write path (`createPayrollManagerNoteDeduction`) saves **synchronously in a `for` loop with no batching/sleeps/requeues**. The spread is explained by:
- **Long single runs**: each referral row does heavy per-row I/O — status-history scans (`getDaysWithClient`), a per-maid IMC HTTP call (`getVisaMedicalStatus` → `/visa/newRequest/getMedicalStatus/{id}`), and per-MV history queries — so one execution can stretch over many hours.
- **Time-varying eligibility** combined with a likely **multiple-runs-per-day JobInstance schedule**: CC maids cross the >30-days-with-client threshold and MV maids pass medical at different times, so notes get created whenever the maid becomes eligible.

**`createPayrollManagerNoteDeduction` details** (`HousemaidReferralService.java` L427–448): despite the name it creates an **`ADDITION`** (not the `BONUS` enum). Sets `additionReason = AdditionReasons / bonus`, `purpose = HousemaidPurposesForBonusAdditionalDescription / referral_bonus`, `referredMaidId`, `noteReasone`. **No creator, no fromManager.** Only caller is `ReferralBonusesManagerJob.addReferralBonus` (Maid A referrer + Maid B referred). There is **no** `createPayrollManagerNoteAddition` sibling.

**Other automatic bonus-reason ADDITION paths (besides the referral service):**
- **`PayrollManagerNoteController.syncSigningBonus`** (payroll-management, L421–454): creates an `ADDITION` with `additionReason = bonus`, `noteReasone="Singing Bonus"` (no `referral_bonus` purpose), driven cross-module from recruitment when a `MaidsAtCandidateWA` reaches `SUCCESSFULL`. No `fromManager`/`creator`. This is a **second** direct, no-expense bonus path — but it's the signing bonus, distinguishable from referral notes by having **no `referral_bonus` purpose** and `noteReasone="Singing Bonus"`.
- **`ManagerNoteService.processExpenseRequestTodo`** (payroll-management): can produce a `bonus` addition, but only via a confirmed **expense request** (`creator = requestedBy`) — i.e. it **does** have an expense link, so it's outside your "no expense request" filter.
- Not bonus but adjacent automatic additions: `RafflePerformerJob` (`raffle_prize`) and `HousemaidAirFareTicketBusinessRule` (`airfare_ticket`).

Bottom line: for a `bonus`-reason ADDITION with `purpose=referral_bonus` and **no expense request**, the **only** automatic creator is `ReferralBonusesManagerJob → HousemaidReferralService.createPayrollManagerNoteDeduction`; the 20-hour spread comes from run duration + eligibility timing (+ frequent JobInstance runs), not multiple code paths.
