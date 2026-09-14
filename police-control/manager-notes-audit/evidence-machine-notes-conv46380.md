`getCreator()` comes from the `BaseEntity` core class (the standard audit "creator" set from the authenticated user context). This confirms: when a note is created inside a scheduled job/background task with no authenticated user, `creator` is null. There's no explicit `requestedBy`/`approvedBy` field on the note — only `fromManager` (a picklist manager) and the inherited `creator`.

I have everything needed. Let me give the final answer.

## Audit findings

### 1) MV Prorated Salary additions (reason `mv_prorated_salary`)

**Creating code path — NOT a scheduled job.** It is triggered by a **user action** during payroll transfer processing, not by a cron/quartz job.

- **Class + method + module:** `AsyncService.processCurrentMonthHousemaidsBatchBT(...)` — `erp_magnamedia-payroll-management` (`com.magnamedia.service.Auditor.AsyncService`, note creation at line 478).
- **Trigger:** This is a background task (`...BatchBT`) fired when the payroll accountant processes/pays the current month's transfers (driven from `processHousemaidPayroll` → the accountant-to-do transfer flow). For a **not-terminated prorated MaidVisa** maid whose paid log is being merged into her latest paid payroll log, the code builds a new `PayrollManagerNote` of type `ADDITION` with `additionReason = mv_prorated_salary`.
- **Why `requestedBy` is null:** The path never sets it. The note is created programmatically inside a background task with no HTTP user session. It sets only `housemaid`, `amount`, `noteType`, `noteReasone` (from `paidOnStatus`), `additionReason`, `noteDate`, `paid`, `payrollMonth`, `paidOnPayrollMonth`, and `payrollAccountantTodo`. It does **not** set `requestedBy`, `approvedBy`, `fromManager`, or `creator`. There is no `requestedBy` field on the note at all — the entity (`AbstractPayrollManagerNote`) only has `fromManager` (a `managers` picklist) plus the inherited `creator` (from `BaseEntity`, populated from the logged-in user). Since this runs in a background task, the `creator` audit field is also left null.
- **Accounting param / approver / team:** None. No accounting parameter, config key, approver role, or team name is referenced on this path. (Note: `mv_prorated_salary` also appears in `HousemaidPayrollPaymentServiceV2.getMustBePaidManagerNotes()` at line 138, but that is only a "must-be-paid-in-secondary-payroll" inclusion list — it does not create notes.)

### 2) Airfare Ticket additions (reason `airfare_ticket`)

There is **no dedicated airfare quartz/scheduled job**. The airfare/ticket `ADDITION` is created reactively when a `ScheduledAnnualVacation` row is created, via two paths — both in `erp_magnamedia-payroll-management`:

- **Business rule (event-driven):** `HousemaidAirFareTicketBusinessRule.execute(...)` (`com.magnamedia.businessrule.HousemaidAirFareTicketBusinessRule`), a `@BusinessRule(moduleCode="visa", entity=ScheduledAnnualVacation.class, events={AfterCreate})`. On vacation create it POSTs to `/payroll/ManagerNotes/create` with `additionReason = airfare_ticket` and `fromManager = managers/jad`.
- **Controller (user endpoint):** `ScheduledAnnualVacationController.createEntity(...)` (`POST /ScheduledAnnualVacation/create`) directly builds the `airfare_ticket` `ADDITION`, also setting `fromManager = managers/jad`.

So the airfare entitlement note is tied to the **AfterCreate lifecycle of `ScheduledAnnualVacation`**, which is itself created by a user/endpoint, not by a periodic job. I could not find any `JobDefinition`/`MagnamediaJob` that generates airfare `ScheduledAnnualVacation` records or airfare additions — there is **no such quartz job name** in the codebase.

- **Fields set:** `fromManager = managers/jad` on both paths. Neither sets `requestedBy` or `approvedBy`, and neither sets `creator` explicitly (the controller path may inherit `creator` from the logged-in user via `BaseEntity`; the business-rule/IMC path does not).
- **Accounting param / team:** The airfare amount limits come from config parameters `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` (default 2000) and `PARAMETER_HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT` (default 1350) in `PayrollManagementModule`. The only "owner" identifier is the hardcoded approver/manager picklist item `managers/"jad"` set as `fromManager`.

### 3) Bonus additions created with no `requestedBy`

Two automatic Bonus-reason (`AdditionReasons/bonus`) `ADDITION` creators, both in `erp_magnamedia-housemaid-management`:

- **Creator method:** `HousemaidReferralService.createPayrollManagerNoteDeduction(...)` (`com.magnamedia.service.HousemaidReferralService`, line 426). Builds a `PayrollManagerNote` `ADDITION` with `additionReason = bonus` and `purpose = HousemaidPurposesForBonusAdditionalDescription/referral_bonus`.
- **Scheduled job that drives it:** `ReferralBonusesManagerJob.run → processReferralBonuses → addReferralBonus` (`com.magnamedia.scheduledjob.ReferralBonusesManagerJob`), quartz job name **`referral_bonuses_manager_job`** (registered in `SetupCustomJobDefinitions`). It calls the service above for eligible referrals (referring and referred maids).

**Is `DelighterService` one of them? No.** `DelighterService` (`com.magnamedia.service.DelighterService`) creates complaints, delighter to-dos, vacations, and bed assignments — it does **not** create any `PayrollManagerNote` or Bonus `ADDITION` (no `PayrollManagerNote`/`additionReason`/`bonus` references exist in it).

- **Fields set:** The referral-bonus creator sets `housemaid`, `purpose`, `noteType`, `amount`, `noteDate`, `additionReason=bonus`, `referredMaidId`, `noteReason`/`noteReasone`. It does **not** set `requestedBy`, `approvedBy`, `fromManager`, or `creator`. Running inside the scheduled job (no user session), the inherited `creator` audit field is null too.
- **Accounting param / approver / team:** No accounting parameter, approver role, or team name is set on the note. Bonus **amounts** are resolved from `ReferralBonusRule` records via `ReferralBonusRuleService.getReferralBonusAmounts(...)`, and there is a related config parameter `PARAM_MV_REFERRED_BY_MV_BONUS` (referenced by the job) plus a `PARAMETER_Referrals_EMAIL` used only for duplicate-referral alerts — none of which is written onto the note as an owning department/team.

(For completeness: `renewal_bonus` and other `bonus` references in `PayrollHousemaidFinalSettlementController` / `HousemaidPayrollPaymentServiceV2` are inclusion lists or final-settlement flows, not the automatic no-`requestedBy` bonus creators.)

### Summary table

| Case | Creator (class · method · module) | Scheduled job? | Job/quartz name | Sets requestedBy/approvedBy/creator? | Owning-dept/team/param identifier |
|---|---|---|---|---|---|
| MV prorated salary | `AsyncService.processCurrentMonthHousemaidsBatchBT` · payroll-management | No — user-triggered payroll transfer BGT | — | No (none set; no `requestedBy` field exists; `creator` null in BGT) | None |
| Airfare ticket | `HousemaidAirFareTicketBusinessRule.execute` + `ScheduledAnnualVacationController.createEntity` · payroll-management | No dedicated job — `ScheduledAnnualVacation` AfterCreate | none exists | Sets `fromManager=managers/jad` only; no requestedBy/approvedBy | `fromManager="jad"`; params `..._FILIPINO_AIRFARE_TICKET_LIMIT` (2000), `..._OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT` (1350) |
| Bonus | `HousemaidReferralService.createPayrollManagerNoteDeduction` via `ReferralBonusesManagerJob` · housemaid-management | Yes | `referral_bonuses_manager_job` | No (none set; `creator` null in job) | None on note; amounts from `ReferralBonusRule`; `DelighterService` is **not** involved |
