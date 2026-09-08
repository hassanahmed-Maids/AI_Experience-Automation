# Ask-the-code · B1b — how can `anti_attrition_incentive` be paid with no enrolment log on file?

**Modules:** `erp/magnamedia-housemaid-management,erp/magnamedia-payroll-management,erp/magnamedia-accounting`
**Asked:** 2026-09-08 · **Session:** 46015 (answer verbatim in `evidence-antiattrition-actionlog-conv46015.md`)
**Drives:** B1b (53 notes, AED 11,418.75, 12 maids, median gap 49 days, max 176)

## Why we are asking

`MaidIncentiveExperimentJob` selects maids via
`MaidManagerActionLogRepository.findHousemaidsWithIncentiveNotes(...)`, whose `EXISTS` clause requires a
`MaidManagerActionLog` with `actionType.code = 'Maid_Incentive_Experiment'` and `incentiveAmount IS NOT NULL`.
So a payment should be impossible before an enrolment row exists.

Twelve months of `PayrollManagerNote` rows with `additionReason = anti_attrition_incentive` say otherwise:
53 notes land **before** the earliest `MaidManagerActionLog` row for that maid. Not a boundary effect —
only 2 of 53 are within 3 days, 36 are 30+ days apart, 12 exceed 90 days. 44 of the 53 belong to 12 maids
paid repeatedly (one paid every month Dec→May, first log dated 25 June). Every `paid_on` is a month-end
batch date, so the job did this on its normal run — these were not hand-added.

Three explanations fit the data equally well and we cannot separate them from the warehouse. Each names a
different fix, so the answer decides the remediation.

## The question (verbatim, as submitted)

> Context: `MaidIncentiveExperimentJob.processIncentiveExperimentNotes()` in magnamedia-housemaid-management
> selects maids through `MaidManagerActionLogRepository.findHousemaidsWithIncentiveNotes(actionTypeCode,
> inactiveStatuses, pageable)`, which requires an `EXISTS` on `MaidManagerActionLog` with
> `actionType.code = 'Maid_Incentive_Experiment'` and `incentiveAmount IS NOT NULL`. It then calls
> `MaidIncentiveService.createMaidIncentiveExpenseRequest(...)` against accounting expense code `AAI - 01`,
> and payroll's `ManagerNoteService.processExpenseRequestTodo()` creates the `PayrollManagerNote`.
>
> In production we observe 53 `anti_attrition_incentive` notes over the last 12 months whose note date is
> earlier — by a median of 49 days and up to 176 days — than the earliest `MaidManagerActionLog` row of that
> action type for the same housemaid. They fall on month-end dates, so the batch produced them. Please answer
> each of the following from the code, and say explicitly when something is DB configuration or runtime data
> rather than source, rather than inferring it:
>
> 1. **Lifecycle of `MaidManagerActionLog` rows of type `Maid_Incentive_Experiment`.** Show every code path
>    that creates, updates or deletes one — controllers, services, schedulers, bulk/import utilities,
>    cascade deletes from `Housemaid`/`Contract`, soft-delete flags, and any low-code or JPA listener path.
>    In particular: when a maid's incentive amount is *changed* (a new tier, a re-enrolment, an unenrol/
>    re-enrol), is the existing row **updated in place**, or is it **deleted and a new row inserted**? If
>    rows are ever removed, is the removal hard or soft, and is any history preserved anywhere?
>
> 2. **What populates the persisted date on that entity** — the column exposed to the warehouse as
>    `ACTION_DATE`. Name the exact field on `MaidManagerActionLog`, and say whether it is set once at
>    creation, re-stamped on every update (`@PreUpdate`, `@LastModifiedDate`, an auditing listener, or an
>    explicit `setX(new Date())` in a service), or supplied by the caller and therefore user-editable. If
>    the entity also carries a distinct creation timestamp and a distinct modification timestamp, name both.
>
> 3. **Every route into an `anti_attrition_incentive` note.** Besides `MaidIncentiveExperimentJob`, list all
>    producers that end at accounting expense `AAI - 01` or otherwise at a `PayrollManagerNote` with that
>    addition reason. Specifically confirm or deny each of:
>    - `AbuDhabiMaidIncentiveExpenseJob` / `MaidIncentiveService.processAbuDhabiIncentives()` — does it use
>      the same expense code `AAI - 01`, and therefore land under the same addition reason? It selects from
>      `HousemaidExtraFieldsRepository.findEligibleForAbuDhabiIncentive(...)` and needs **no**
>      `MaidManagerActionLog` at all, which alone would explain payments without an enrolment row. If it
>      resolves to a different expense/addition reason (e.g. the one surfacing as "Abu Dhabi Incentive"),
>      say which and where that is configured.
>    - Any manual/UI path where a user raises an expense request with code `AAI - 01`.
>    - Any retry, catch-up, back-fill or re-run path that processes an earlier month.
>    - Any low-code rule or API endpoint that writes the note directly.
>
> 4. **Is the enrolment check re-evaluated at payment time, or only at selection time?** If the maid list is
>    read once per run and the notes are created later in the run (or in a later stage/queue), can a maid be
>    paid for a month in which the `EXISTS` condition was not true at any point?
>
> 5. **Proration and back-dating.** Can the job produce a note whose `noteDate` (or the payroll month it is
>    attached to) is earlier than the run date — for example a catch-up covering prior months, or a note
>    attached to a payroll period that has not yet closed? If so, name the path, since that would make the
>    date comparison itself unsound rather than the enrolment.
>
> 6. **Amount validation.** Is `incentiveAmount` validated against `MAID_INCENTIVE_CONFIGS_PARAM.amount_values`
>    at *write* time, at *pay* time, or neither? We are separately checking observed amounts against the
>    allowed list.
>
> For each answer give the file path and line numbers, and mark anything you cannot see in source
> (DB config, `JobInstance` schedule, low-code rules) as unverified rather than assumed.

## What each answer implies

| Answer | Reading of the 53 | Fix |
|---|---|---|
| Rows are deleted and recreated on re-enrolment | The audit trail for AED 1.83m/year is **mutable**; `MIN(ACTION_DATE)` sees only the newest row | History table or soft-delete before any point-in-time control can be trusted |
| `ACTION_DATE` is a modification date | The justification is **retrofitted after the money moves** | Expose a true creation timestamp; B1b re-runs against it |
| A second route (Abu Dhabi or manual) pays without a log | The `EXISTS` guard is **not the control we documented**; N13 is incomplete | Correct N13, then re-scope B1b to the route that actually applies |
| None of the above | **AED 11,419 was paid to 12 maids with no justification on file**, by an unattended job, for up to six months each | Payment-time guard in the job |

**No answer clears the 53.** The question decides which fix, not whether there is a finding.

---

# Answered · session 46015 · 2026-09-08

Full answer: `evidence-antiattrition-actionlog-conv46015.md`. Verdict against the four readings:

| Reading | Code says | Status |
|---|---|---|
| Rows deleted and recreated | `deleteEntity` delegates to the generic base controller. **No soft-delete flag, no history snapshot, no `@Audited` visible.** Nothing in source deletes-then-reinserts incentive rows; the UI/low-code layer is unverified | **Not shown, not excluded** |
| `ACTION_DATE` is a modification date | **Worse than that.** `actionDate` is stamped `new LocalDate().toDate()` **only on create**; `updateEntity` never re-stamps it and only rejects null — so on any edit **it is whatever the caller sends. It is user-editable free-form data, not a system timestamp** | 🔴 **Confirmed — and it invalidates the column** |
| A second route pays with no enrolment row | **Two of them.** `AbuDhabiMaidIncentiveExpenseJob` calls the *same* `createMaidIncentiveExpenseRequest` and needs no `MaidManagerActionLog` at all; and **any manual `POST /expenseRequestTodo/...` carrying expense code `AAI - 01`** produces the identical note with no enrolment check. Whether the AD job resolves to `AAI - 01` is DB param config, unverified | 🔴 **Confirmed as a mechanism** |
| Paid with no justification on file | Still live for whatever survives the two tests below | **Open** |

## 🔴 The finding the question was not asking for

**The enrolment condition is evaluated once, at selection, and never again.** The `EXISTS` runs when
`findHousemaidsWithIncentiveNotes` reads its page; the job then only POSTs an `ExpenseRequestTodo`.
The `PayrollManagerNote` is created **two async hops later** — accounting confirmation, then a
`SequentialQueue` background task (`ExpenseRequestTodoBusinessRule` → `managerNoteService.processExpenseRequestTodo`).
Nothing re-checks enrolment at either hop. A maid whose incentive row is edited, retyped or deleted
after selection **is still paid**. The only guard in between is `incentiveRequestDate` within the
current month, which is de-duplication, not re-validation.

**This makes N13's "the job requires an enrolment log before it pays" wrong as stated.** It requires
one *at selection*. That is a different control, and a weaker one.

## 🔴 Two further findings, unprompted

1. **Amounts are validated at write time and never at pay time.** `validateIncentiveAmount` runs in
   the `/maidNote` controller against `MAID_INCENTIVE_CONFIGS_PARAM.amount_values`; neither the job
   nor `createMaidIncentiveExpenseRequest` re-checks. If the parameter is missing or blank the
   validator **silently falls back to a hard-coded `[100,150,200,250,300,350]`** — bad config passes
   as good config.
2. **`MaidManagerActionLogService.correctIncentiveHistoricalData` re-derives `incentiveAmount` by
   string-matching allowed amounts inside the enrolment's free-text note** (`extractIncentiveAmountFromNote`)
   **and saves without re-validating.** A back-fill utility sets the number that drives AED 1.83m/year
   of payments, from prose.

## What B1b becomes

B1b as run compared the note date against `MIN(ACTION_DATE)`. **`ACTION_DATE` is not an enrolment
timestamp** — it is a caller-supplied business date that survives every edit unchanged. The selection
query itself never reads it. So the 53 are **not yet a payment finding**; they are a finding about the
column, plus a population that needs re-testing against the right one.

Three follow-ups, in order — see `queries/phase1-verification.sql` block **B1b-F**:

- **F1** — does `HOUSEMAID_MANAGERACTIONLOGS` expose `CREATION_DATE`? Re-run B1b against it. That is
  the column the code actually orders by (`findByHousemaidAndActionTypeOrderByCreationDateDesc`).
- **F2** — who created the 53 notes? N13 says every batch note carries service account **2226**. A
  different creator means the **manual `AAI - 01` route**, and the enrolment check never applied.
- **F3** — are the 12 maids Abu Dhabi enrolments (`abuDhabiIncentiveType` / `abuDhabiIncentiveOffered`)?
  If so they were never supposed to have a `MaidManagerActionLog`.

**Whatever F1–F3 return, three findings stand already**, and none of them depended on the 53:
enrolment is not re-checked at payment, the amount is not re-checked at payment, and the field the
audit trail rests on is user-editable.
