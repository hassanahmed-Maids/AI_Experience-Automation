I now have a comprehensive understanding of both paths and all five questions. Let me compile the answer.

## Airfare Ticket (`airfare_ticket`) Payroll Manager Notes — full trace

The airfare_ticket notes are **not** authored inside `magnamedia-payroll-management`. They originate in the **visa-processing** module from the visa-renewal workflow, flow through a cross-module business rule, and land in payroll. There is also a secondary generic expense path. Here is the complete picture.

### 1. What job/service/expense-code creates airfare_ticket notes

There are **three creators**, all producing the same `additionReason = airfare_ticket` note; the machine-generated 4,881 come from the first (and its migration twin).

**Primary (automatic) path — the visa renewal workflow:**
- **Class + method:** `com.magnamedia.workflow.renew.AddScheduledAnnualVacationService.execute(RenewRequest)` in `magnamedia-visa-processing`. This is a `WorkflowServiceTask` fired when a housemaid passes the **"Upload The e-Residency"** step of visa renewal. It creates a `ScheduledAnnualVacation` of type `vacation_airfare` with `information = "Auto added by the system when the housemaid passes Upload The e-Residency step"`.
- The `ScheduledAnnualVacation` `AfterCreate` then triggers `com.magnamedia.businessrule.HousemaidAirFareTicketBusinessRule.execute()` (in payroll-management, `moduleCode="visa"`), which POSTs to the payroll endpoint `/payroll/ManagerNotes/create` via `InterModuleConnector`, setting `additionReason = airfare_ticket`, `fromManager = jad`, `noteType = ADDITION`, and `noteDate = payrollDueDate`.
- The actual note row is written by the payroll `ManagerNotes` create endpoint (and equivalently `ScheduledAnnualVacationController.createEntity()`, which builds the identical note: `additionReason = airfare_ticket`, `fromManager = "jad"`, `amount = vacation.amount`, `noteDate = payrollDueDate`).

**Migration/backfill twin:** `MigrationController.housemaidScheduledAnnualVacations()` (payroll) loops over airfare `ScheduledAnnualVacation` rows and creates the same airfare_ticket note for any that don't yet have one — same field values, `fromManager = jad`.

**Secondary generic expense path (the one you flagged):** `ManagerNoteService.processExpenseRequestTodo(expenseRequestTodoId)` (payroll). When an `ExpenseRequestTodo` is confirmed with `paymentMethod = SALARY`, it creates a `PayrollManagerNote` and copies `expense.getSalaryAdditionType()` into `additionReason`. If an accounting `Expense` is configured with `salaryAdditionType = airfare_ticket`, this produces airfare_ticket notes too. **But** these carry a real `requestedBy` requester, `noteDate = new Date()` (current timestamp, not midnight), and free-text `description` as the reason — so they do **not** match your midnight/no-requester machine profile. The 4,881 machine notes are the ScheduledAnnualVacation path.

- **Expense code:** there is no single hard-coded expense *code* for the salary-note path; it keys off the picklist item `AdditionReasons / airfare_ticket`. The only place airfare expense **codes** appear is accounting card-reconciliation (`TicketMatchingLibrary`: `FT 07/29/75/76/77/78/88`), which is unrelated to manager notes (see Q5).

### 2. Exact amounts / tiers and why only 7 values

The amount comes from `AddScheduledAnnualVacationService.execute()`:

1. **Base default:** visa-processing parameter **`default_ticket_allowance_amount`** ("Default Ticket Allowance Amount for all nationalities"), parsed as an integer → this is the fallback for everyone.
2. **Nationality override:** if the housemaid's `Nationality` has the tag **`ScheduledAnnualVacationAmount`**, its tag value overrides the default: `defaultAmount = Double.parseDouble(nationality.getTagValue("ScheduledAnnualVacationAmount").getValue())`.

So amounts are **per-nationality constants**, sourced from the nationality's `ScheduledAnnualVacationAmount` tag value, with a single global parameter fallback. **Only ~7 distinct amounts exist because there are only a handful of nationality tiers** (the distinct configured tag values across all nationalities) plus the one global default. Every maid of a given nationality gets the identical flat ticket allowance — hence heavy clustering on 7 values rather than a continuous distribution.

**Nationality (Filipina vs other) is absolutely a factor** — it is the *only* discriminator. Filipina maids (and any nationality with its own `ScheduledAnnualVacationAmount` tag) get their tiered value; nationalities without the tag fall back to `default_ticket_allowance_amount`. The amount is not computed from salary or tenure — it is a flat per-nationality figure.

(`AirfareTicketType` is a separate ACC-1472 lookup entity with a `name`/`amount`; it is not what feeds these auto notes — those pull from the nationality tag/parameter.)

### 3. Eligibility rule — tenure/contract condition and evaluation date

Eligibility is decided in `AddScheduledAnnualVacationService` by **two gates**, evaluated at renewal time (`new Date()`, normalized to midnight):

**Gate A — contract type / not office staff:** `if (entity.isforOfficeStaff()) return;` and the amount block only runs for `entity.isforHousemaid()`. Office-staff renew requests are excluded; this is a housemaid-contract entitlement.

**Gate B — `validateOnExpiryDateOrLastAirfareTicket(renewRequest)`**, which branches on how many *completed* renewals the maid has (`countByHousemaidAndCompletedTrue`):
- **First renewal (count == 0):** eligible only if the labor-card expiry is within the next `param_airfare_ticket_after_expiry_date_months` months (parameter default **6**). i.e. `today + 6 months >= laborCardExpiryDate`.
- **Subsequent renewals (count > 0):** the last airfare must be at least `param_airfare_ticket_last_ticket_months_ago` months old (parameter default **-16**, i.e. **16 months ago**). It checks both the most recent `vacation_airfare` `ScheduledAnnualVacation` creationDate and the most recent airfare_ticket `PayrollManagerNote` creationDate; if either is newer than "16 months ago," it returns false.

**Plus a duplicate guard — `isThereMultipleAirFareTickets()`:** blocks if any airfare vacation *or* airfare_ticket note exists with date **within the last 5 months** (`Calendar.MONTH, -5`). This prevents two tickets in one cycle.

**About `% 24` / modulo:** there is **no modulo/`% 24` arithmetic in this Java flow**. The only `% 24` matches in the repos are in bundled JS date libraries (moment.js, flatpickr, angular) and unrelated timezone/duration pipes — none touch airfare eligibility. The airfare "24-month cycle" is expressed instead as **plain month arithmetic** via `Calendar.add(Calendar.MONTH, …)` with the 16-month "last ticket ago", 6-month "before expiry", and 5-month duplicate-guard parameters (and the `vacationFrom = today - 2 years` window). If a report or query you saw uses `% 24`, it is not part of the entitlement logic here — the effective cadence is roughly biennial because renewals recur ~every 2 years and the 16-month guard blocks earlier repeats.

**Which date is evaluated:** the renewal event date (`new Date()` at the moment of the "Upload e-Residency" step, normalized to 00:00) is compared against `laborCardExpiryDate` and against prior airfare vacation/note dates.

### 4. Why notes are dated in the FUTURE (up to 2028)

The note date is **not** "now" — it is deliberately set to the **entitlement/payroll due date**:

- In `ScheduledAnnualVacationController.createEntity()` and both `MigrationController`/`HousemaidAirFareTicketBusinessRule` paths: `note.setNoteDate(entity.getPayrollDueDate())`.
- The driving field is **`ScheduledAnnualVacation.payrollDueDate`**. In the automatic renewal path it is set to the current renewal date (`scheduledAnnualVacation.setPayrollDueDate(currentDate)` at midnight — which is exactly why **94% are stamped at midnight**: `currentDate` is normalized with `HOUR_OF_DAY/MINUTE/SECOND = 0`).
- Future dates (up to 2028) occur when `payrollDueDate` is set to a **future entitlement date** rather than today — e.g. records created/edited with the airfare scheduled *for a future payroll cycle* (the vacation is scheduled ahead, and `noteDate` inherits that future `payrollDueDate`). Because the note date is slaved to `payrollDueDate`, any vacation scheduled for a future cycle produces a note dated in the future. So the field/logic responsible is `ScheduledAnnualVacation.payrollDueDate` → copied verbatim into `PayrollManagerNote.noteDate`.

The "**98% have NO requester**" also follows from this: all these paths set `fromManager = "jad"` (a fixed picklist manager) and **never set a `creator`/`requestedBy`** — only the human `processExpenseRequestTodo` expense path sets a real requester.

### 5. Is a company-bought ticket checked before paying cash? 

**No — the airfare_ticket manager-note (cash) path does not check whether the company already bought a ticket.** `AddScheduledAnnualVacationService` only guards against *duplicate cash entitlements* (another airfare vacation or airfare_ticket note in the last 5/16 months). It does not look up `HOUSEMAIDS_TICKETS`, purchased `Ticket` records, or any company-provided flight before creating the cash addition.

The only ticket-vs-company logic in the codebase is **`TicketMatchingLibrary`** (accounting), which is a **post-hoc credit-card reconciliation** tool: it fuzzy-matches purchased `Ticket` rows against `CreditCardStatement` rows (by confirmation code, date, fare margin, and airline-name similarity) and assigns accounting expense codes (`FT 07/29/75/76/77/78/88`, buckets `BC 06/23`). It runs on the accounting/cost side and has **no link back to the payroll airfare_ticket note** — it never suppresses or offsets the cash allowance. So a maid can receive the cash airfare addition independently of whether a company ticket was purchased and reconciled.

---

**Summary of the money profile:** the 4,881 / AED 7.77m notes are machine-created by the visa-renewal `AddScheduledAnnualVacationService` → `HousemaidAirFareTicketBusinessRule`/`ScheduledAnnualVacationController` chain; amounts are flat per-nationality tag values (`ScheduledAnnualVacationAmount`) or the `default_ticket_allowance_amount` param (→ only ~7 distinct values); eligibility is renewal-driven month arithmetic (6-month-before-expiry on first renewal, 16-month-since-last afterward, 5-month duplicate guard), not modulo; future dates come from `noteDate = payrollDueDate`; and no company-ticket check gates the cash payout.