Here is the audit trace across every module, keyed to your five questions.

## Bottom line for the warehouse audit

There is **no direct join key** between `COMPLAINTS` and payroll manager notes / expense requests / employee loans. A payment carries **no complaint id**, and the indirect path `ManagerNoteService.processExpenseRequestTodo()` **does not copy any complaint reference** onto the note — it copies `Expense.salaryAdditionType` (→ `additionReason`) and `ExpenseRequestTodo.purposeAdditionalDescription` (→ `purpose`), and links the maid via `relatedToId`/`relatedToType=MAID`. Corroboration by complaint must be reconstructed heuristically (housemaid_id + date window + reason/purpose semantics), not by FK.

---

## 1. Direct/indirect links between Complaint and the payment entities

**No direct FK exists on `PayrollManagerNote`, `ExpenseRequestTodo`, `EmployeeLoan`, or `Expense` to `Complaint`.** (Note: there is no `ExpenseRequest` entity — `ExpenseRequestTodo` is the request entity.)

- `PayrollManagerNote` (`AbstractPayrollManagerNote`): `housemaid`, `amount`, `noteReasone`, `noteDate`, `noteType`, `additionReason`/`deductionReason`/`purpose` (PicklistItems), `fromManager`, `referredMaidId`, `additionPayrollManagerNoteDeductionSource` (self-FK). No complaint column.
- `ExpenseRequestTodo`: polymorphic `relatedToId` + `relatedToType`. The enum `ExpenseRelatedTo.ExpenseRelatedToType` = `MAID, APPLICANT, OFFICE_STAFF, TEAM, COMPANY, NOT_DETERMINED` — **no `COMPLAINT` value**.
- `EmployeeLoan`: has `expenseRequestTodoId` link, `housemaid`, no complaint.

**Free-text does not carry it either.** `ExpenseRequestTodo.updateDescription()` builds text from id/caption/amount/maid-profile-id/passport — never a complaint id. `processExpenseRequestTodo` sets `note.noteReasone = expenseRequestTodo.getDescription()` (`ManagerNoteService.java:148`), so no complaint id lands in the note.

**The only indirect chains that actually reach a Complaint:**
- **Replacement-deduction path** (the one usable for maid money): `Complaint` → `Replacement.complaint` (FK) → `MaidManagerWorkOrder.replacement` → `MaidManagerWorkOrder.deduction` = `PayrollManagerNote`. Reverse-traversable via `PayrollManagerNoteController.checkCriminalDeduction()` (housemaid-management, ~L53–66): note → work order → replacement → complaint → `primaryType`. This is a validation lookup, not a stored key, and only exists for replacement/deduction notes, not general additions.
- Adjacent (out of scope for maid payslips): `ClientRefundToDo.complaint` is a **direct** `@ManyToOne Complaint` FK — but that's the client-refund workflow, not a housemaid payslip note.

So for your audit: **join on `HOUSEMAID_ID` + note/expense date + purpose/addition-reason semantics**; the only place a real FK to a complaint exists in the money graph is `Replacement.complaint` (and `MaidManagerWorkOrder.complaint`), reachable only for replacement-driven deductions.

---

## 2. Code paths that CREATE a complaint in a payment flow, or READ/REQUIRE one before paying

**Create-in-payment-flow:** essentially none in the expense/payroll/loan processors. The expense→payroll chain `ExpenseRequestTodoBusinessRule.execute` → `ManagerNoteService.processExpenseRequestTodo` → `PayrollManagerNote`/`EmployeeLoan` never touches Complaint. The closest complaint-creation adjacent to money is `VatSalaryService` (CPT/VAT change) → `ComplaintService.createComplaintFromModule(contract)`, gated by the accounting param `change_cpt_vat_salary_create_complaint`, creating a payroll-dispute-style complaint — but that is a side effect of a salary-config change, not a payment.

**Require/read-a-complaint-before-paying:** none of the payslip payment flows gate on a Complaint.
- `ExpenseRequestTodo` create/approve/pay, `ManagerNoteService.processExpenseRequestTodo`, and loan creation do **not** query `ComplaintRepository` or check complaint status.
- `PayrollManagerNoteController.checkCriminalDeduction()` reads a complaint for a UI/validation decision on a replacement deduction, but is not a payment gate.
- Payroll "complaint deductions" (`HousemaidPayrollInitializer.prepareComplaintDeductions`, `ComplaintDeductionTransaction`) use **WarningLetter** picklist types (e.g. `client_replaced_the_maid_due_to_complaint`), not the `Complaint` entity.

---

## 3. ComplaintType taxonomy

**Entity `ComplaintType`** fields: `name` (label), `code`, `category` (`ComplaintCategory`), `classification`, `seriousnessLevel`, `deductionCode`, `isReplacementReason`, `isCancellationReason`, `causeFaultReplacement`, `disabled`, `tags` (`COMPLAINT_TYPES_TAGS` join), `type` (PicklistItem — `TypeOfComplaintType`), `clientResponsibility` (FAULTY/INNOCENT), `ftmReportLabel`, `availabilityTimer`.
- **No `primaryType`/`secondaryType` on `ComplaintType` itself**, and **no team field**. The primary/secondary structure lives on `Complaint` (`primaryType` + `otherTypes` set + `category`). **Team assignment lives on `Complaint`** (`assignTo`, `creatorTeam`, `initialAssignedTeam`, `defaultTransferToTeam`), not on the type or category.
- **`ComplaintCategory`** fields: `name`, `classification`, `warnPoints`, `deduction`, `code`, `status`. Carries `classification`; **no team**.

**Codes referenced by name in code, grouped by your themes** (`__c` suffixes are Salesforce-style codes; several are parameter-resolved rather than literal):

- **Maid wants to leave / resign / attrition / retention / renew:**
  - `Maid_Wants_To_Resign__c` (`COMPLAINT_TYPE_MAID_WANTS_TO_RESIGN`) and MV variant `Maid_wants_to_resign_maidvisa`
  - `Refused_To_Work__c`, `Maid_Does_Not_Want_To_Work_With_Client`
  - `Maid_does_not_want_to_renew_with_the_company__c`
  - `Maid's_termination` / `maid_termination`, `Doctors_Termination_Request`
  - Retention (param-resolved): `mv_retention_complaint_type_code` → default **"MV Retention"**; renew-but-change-client → default `Maid_s_Repeat_Medical__c`
- **Salary complaints/disputes:** **not modeled as first-class ComplaintType codes.** Salary surfaces as Yaya sub-reason picklist codes: `i_want_a_higher_salary`, `i_want_to_get_my_salary_or_transfer_money_to_my_family` (routed in `YayaNotificationService`). Payroll disputes are created via the VAT/CPT accounting flow (runtime-resolved type).
- **Taxi / transportation:** tag `transportation` on the type; `Housemaid_Arrival_&_Transportation_Check-Ins`; `client_canceled_uber` (`COMPLAINT_TYPE_CLIENT_WILL_KEEP_MAID` / cancel-uber param); `live_out_transportation_check_in`; luggage-checkup type param.
- **Medical / sick / injury:** `Work_Injury_Sickness__c`, `Maid_s_Repeat_Medical__c`, `maid_pretended_to_be_sick`, `mv_maid_delayed_medical`, `MV_to_CC_medical_reevaluation`, `Doctors_Termination_Request`.
- **Accommodation / sleeping place:** `complaint_about_accommodation`, `not_comfortable_with_sleeping_place`, `liveout_maid_staying_in_accommodation`, tag `PR_Refusal`.
- **Relocation / switch live-out:** `liveout_maid_staying_in_accommodation` plus switch-eligibility tags (`eligible_switch_mv_live_out/in`); handled in `DelighterService.handleSwitchLiveOutHousemaid` and live-out routing.
- **Airfare / vacation / travel:** `Client_Wants_Free_Replacement_When_Current_Maid_Goes_On_Vacation__c`, `original_maid_came_back_from_vacation`, `travel_client_with_maid_complaint_type_code` (param), `luggage_checkup`.
- **Referral / referral bonus:** **not found as a ComplaintType code anywhere.** Referral logic exists (referral bonuses, `HousemaidReferral`, `referredMaidId` on notes/todos) but is never a complaint type.

Note the warehouse's 1–424 `COMPLAINT_TYPE_ID` range is the DB row set; only the subset above is referenced by name in code — the rest are data-only.

---

## 4. "Maid wants to leave" / `resignation_retraction` flow and where the reason is recorded

**Yes — the bonus flow originates from a resignation Complaint, via a DelighterToDo.**

Chain (immediate one-time bonus):
1. `POST /delighterToDo/retractResignation/{id}?retractMethod=ONE_TIME_BONUS` → `DelighterToDoController.retractResignation` (~L1069)
2. → `DelighterService.handleRetractDelighterWithOneTimeBonus` (L511–530)
3. → `DelighterService.addExpenseRequestForHousemaid` (L601–624) posts to `/accounting/expenseRequestTodo/create` with `purposeAdditionalDescription = resignation_retraction` and expense code from `PARAM_STAFF_RETRACTION_RESIGNATION_BONUS_EXPENSE_CODE`.
   (Conditional variant defers to `RetractingResignationJob.run` after the maid-stays-N-days condition.)

The `DelighterToDo` it acts on is always `taskName = CHECK_MAID_INSISTING_TO_RESIGN`, and that todo is **linked to a `Maid_Wants_To_Resign__c` complaint** through **`DelighterToDo.rbComplaint`** (FK column `RB_COMPLAINT_ID`). `DelighterToDoRepository.findLinkedResignation` is:

```
select d from DelighterToDo d where d.taskName like 'CHECK_MAID_INSISTING_TO_RESIGN'
and d.stopped=false and d.completed=false and d.rbComplaint = ?1
```

and `Complaint.getResignationTodoId()` uses it (only when `primaryType.code = Maid_Wants_To_Resign__c`). The complaint/todo is created by `ComplaintController.createResignationToDo` → `YayaAppService.createCheckMaidResignationToDo` → `DelighterToDoController.createEntity` → `DelighterService.createComplaintIfNotExists` (sets `rbComplaint`, guarded by `shouldTriggerCreateResignationFromCSM`).

**Where the reason is recorded and categorised:**
- **Categorised reason:** `DelighterToDo.resignationReason` (a `PicklistItem`, from picklist `yaya_dont_work_to_work_anymore_reasons` / Yaya `YAYA_APP_PICKLIST_DONT_WANT_TO_WORK_ANYMORE`).
- **Text fallback:** `DelighterToDo.maidResignationReason` (String).
- **On the complaint:** written into `Complaint.initialDescription` as `"Resignation case - {reason name}"`; `Complaint.maidResignationReason` also exists but is `@Transient` (not persisted). Manual edits via `DelighterToDoController.updateResignationReason` update the picklist and append to `rbComplaint.initialDescription`.

So for the audit, the *categorised* leave reason lives on `DELIGHTER_TODO.resignationReason` (picklist), and the bonus expense itself is only tagged `resignation_retraction` as its purpose — the link back to the complaint is `DelighterToDo.rbComplaint`, **not** anything on the expense/note.

---

## 5. `Maid_Incentive_Experiment` enrolment link to a Complaint / reason field

**No complaint link, and no dedicated justification field beyond free-text `notes`.**

- Constant `HousemaidManagementModule.MAID_INCENTIVE_EXPERIMENT_ACTION_TYPE_CODE = "Maid_Incentive_Experiment"` (a `PicklistItem` used as `MaidManagerActionLog.actionType`).
- Created in exactly two places (both housemaid-management): `MaidManagerActionLogController.createEntity` (~L100–124) and, programmatically, `GptDataGatheringService.addMaidNote` (~L3615–3624, via `POST /chat-gpt/add-maid-note` with `note_type=Maid_Incentive_Experiment`).
- `MaidManagerActionLog` fields: `housemaid`, `notes` (Lob), `actionType`, `workOrder`, `incentiveAmount`, `client`, `contract`, `incentiveRequestDate`. **There is no Complaint FK.** `client`/`contract` are auto-filled from the maid's current active contract in `validateIncentiveAmount` — **not from any complaint**.
- **`workOrder` is never set** on the incentive-experiment log, so even the indirect `MaidManagerWorkOrder.complaint` path is not populated here.
- The **only** recorded justification is the required free-text **`notes`** field (creation throws if null). There is no structured reason/complaint reference.

So enrolment reason is unstructured free text in `MAIDMANAGERACTIONLOG.NOTES`, with `INCENTIVE_AMOUNT` and `client`/`contract` context — no way to join it to a complaint in the warehouse.

---

**Net guidance for your audit model:** corroborating a housemaid payment with a complaint is only possible by (a) heuristic matching on `HOUSEMAID_ID` + date + purpose/additionReason semantics for the general expense→note path, or (b) a real FK walk `PayrollManagerNote → MaidManagerWorkOrder → Replacement → Complaint` for replacement-driven deductions only. Resignation-bonus payments (`resignation_retraction`) can be tied to a `Maid_Wants_To_Resign__c` complaint only via the intermediate `DelighterToDo.rbComplaint`, and incentive-experiment enrolments cannot be tied to a complaint at all.