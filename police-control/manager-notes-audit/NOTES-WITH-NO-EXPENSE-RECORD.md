# Manager notes with no expense record — the 58%

> **RENAMED 2026-09-14 (was MACHINE-WRITTEN-NOTES.md).** The original title asserted a
> mechanism the evidence did not support. Read the correction below before the rest.

**Measured 2026-09-14.** Window: rolling 12 months, `NOTE_TYPE='ADDITION'`, `AMOUNT > 0`.


## 🔴 CORRECTION THAT RESETS THE PREMISE (ask-the-code session 46380)

**`REQUESTED_BY` is NOT the note's author.** `jira/DNA_ATTACHMENT_source_tables.md:42` maps it
to `ep.REQUESTED_BY` — the EXPENSE record, carried in through the join (SPEC_v2 D7: "Requester /
approver carried from the expense side ... arrives through the heuristic join"). The note entity
has **no `requestedBy` field at all**: `AbstractPayrollManagerNote` has `fromManager` (a
picklist) plus the inherited `creator` from `BaseEntity`.

So `REQUESTED_BY IS NULL` never meant "no author recorded". It meant **"no expense record behind
it"** — exactly what the 0-of-5,345 `EXPENSE_ID` probe measured. The same test was run twice and
the second read as confirming the first.

**Honest restatement:** AED 3,976,775.54 across 5,345 notes — 58% of manager-note money — has
**no expense record behind it**, and the warehouse **carries no author column for manager notes
at all** (`MANAGER` = the dead `EMPLOYEE_MANAGER_ID`; `CREATOR` not ingested). "58% is written by
bots" was NOT established: some is jobs, some is people working through background tasks.

### What this does to the CREATOR ingestion ask

It survives, but it is **not sufficient**. `creator` comes from `BaseEntity` and is set from the
authenticated user, so it is **null inside background tasks and scheduled jobs** (code-stated).
Ingesting it attributes user-session writes and leaves the automated paths blank.

**Two-part fix:**
1. **Data:** ingest `CREATOR` **and `FROM_MANAGER_ID`** — airfare's owner is written to
   `fromManager` and is invisible today.
2. **Dev:** set an author on the automated paths.

### The hour fingerprint measured the wrong thing

The code is explicit that **no airfare job exists**, so airfare's 100%-exactly-midnight cannot be
a run time — it is a **date-valued `noteDate`**. The signature detects whether the code wrote a
DATE or a TIMESTAMP, not when work happened. Where a real timestamp is written (MV Prorated
Salary 9–21, Last Day CC Switch 7–22) the reading holds; where it is midnight-exact it says
nothing. The "MV Prorated Salary is a person, not a bot" read SURVIVES — and the code explains
why no author is recorded.

## ✅ ANSWERED — what creates each, and who owns it (session 46380)

| Type | Creator (class · module) | Job? | Owning department |
|---|---|---|---|
| **MV Prorated Salary** AED 803,257 | `AsyncService.processCurrentMonthHousemaidsBatchBT` · payroll-management | **No** — background task fired when the payroll accountant processes the month's transfers | **Maid Payroll.** A person clicks; the async hand-off drops the user context, so nothing records who |
| **Airfare Ticket** AED 2,189,000 | `HousemaidAirFareTicketBusinessRule` on `ScheduledAnnualVacation` AfterCreate (`moduleCode="visa"`) + `ScheduledAnnualVacationController.createEntity` · payroll-management | **No job exists** | **Visa** — both paths hardcode `fromManager = managers/jad`, so the note names its owner in a field the warehouse does not ingest |
| **Bonus (automatic)** AED 604,775 | `HousemaidReferralService.createPayrollManagerNoteDeduction` driven by `ReferralBonusesManagerJob` · housemaid-management | **Yes** — quartz `referral_bonuses_manager_job` | The referral programme owner |

Airfare amount config: `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` (2000) and
`PARAMETER_HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT` (1350), in `PayrollManagementModule`.

**`DelighterService` is NOT a bonus creator.** It creates complaints, delighter to-dos, vacations
and bed assignments — no `PayrollManagerNote`. This corrects a working assumption carried since
the retraction-bonus work: that path reaches payroll through the **expense** route, a different
mechanism.

### ⚠️ Tension not smoothed over

Bonus shows **20 distinct hours** (0.7% midnight) but the code found a **single** quartz job.
Either `referral_bonuses_manager_job` runs many times a day, or a second creator exists that the
question did not surface. One follow-up owed.

Full answer: `evidence-machine-notes-conv46380.md`.


## ✅ ALL TEN ATTRIBUTED (ask-the-code session 46381) — 99.93% of the money

**AED 3,973,992 of AED 3,976,776 now has a named code path and an owning function.**
Remaining: AED 2,784 (7 machine Salary Dispute notes + 1 MV Extra Salary).

| Type | AED | Creator (class · module) | Job | Owner |
|---|---:|---|---|---|
| MV Prorated Salary | 803,257 | `AsyncService.processCurrentMonthHousemaidsBatchBT` · payroll-mgmt | no — accountant transfer BGT | **Maid Payroll** |
| Prorated salary | 98,836 | `_ProratedSalariesTransaction.calculate()` · payroll-mgmt | daily `generate_payroll_audit_todo_list` | **Maid Payroll** (`payroll_auditor`) |
| Forgive Deduction | 53,680 | `NegativeSalariesService.negativeSalariesBean()` · payroll-mgmt | none — inline in payroll file generation, gated days **26→5** (`Payroll Jobs Start`=26 / `End`=5) | **Maid Payroll** (`payroll_auditor`) |
| Last Day CC Switch | 13,616 | `PayrollAuditTodoService.doMaidSwitchedToMvCalculations()` · payroll-mgmt | BGT `createCcSwitchingToMvTodo` off the daily job | **Maid Payroll**; source rows from the sales-side CC→MV switch (SAL-3842) |
| Airfare Ticket | 2,189,000 | `HousemaidAirFareTicketBusinessRule` · payroll-mgmt | **none exists** | **Visa** (`fromManager = managers/jad`) |
| Bonus | 604,775 | `HousemaidReferralService.createPayrollManagerNoteDeduction` **and** `PayrollManagerNoteController.syncSigningBonus` | `referral_bonuses_manager_job` / recruitment-driven | Referral programme **and Recruitment** |
| Raffle Prize | 180,000 | `RafflePerformerJob.addPrizesToPayroll()` · housemaid-mgmt | `job_to_start_raffle_draw` | Raffle programme |
| Office Work Addition | 30,828 | `PayrollGroupService.checkOfficeWorkDaysBeforeStartDate()` · payroll-mgmt | BGT `calculateSalaryBeforeStartDate` off `HousemaidStartDateBR` | Assigned by the **accommodation-manager team** (`PARAM_STAFF_ACCOMMODATION_MANAGER_TEAM`); confirmation email names **"Delighters Manager"** and **"money control manager"** |

### 🔴 The authorship mechanism ALREADY EXISTS in the codebase

`RafflePerformerJob` sets `creator` to the system user **`erp_user`** (`USER_ERP_LOGIN_NAME`)
when it would otherwise be null. **One path out of six does this; the other five set nothing.**

That reframes the dev ask from "invent a way to stamp automated notes" to **"do what the raffle
job already does"** — and it is evidence that nobody decided these notes should be authorless.

### 🔴 A SECOND automatic bonus path

`PayrollManagerNoteController.syncSigningBonus` (payroll-mgmt) — the **signing bonus**, driven
cross-module from recruitment when a `MaidsAtCandidateWA` reaches `SUCCESSFULL`.
`noteReasone = "Singing Bonus"` (the typo is in the code), and **no `referral_bonus` purpose**.

So the AED 604,775 of expense-less Bonus is **two programmes with different owners**, not one.
The 20-hour tension was legitimate; the answer is BOTH — run duration explains most of the
spread (heavy per-row I/O, per-maid IMC HTTP calls, one execution stretching hours) AND a second
path genuinely exists.

### Three of my own readings the code corrected

1. **Last Day CC Switch is NOT human bulk entry.** 16 distinct hours over three days read as a
   person typing; it is `PayrollAuditTodoService` in a background task off the daily job. It
   *can* be triggered lazily when an auditor opens the CC-switch screen — which is likely what
   put the timestamps in working hours. Automated creation, human-triggered timing.
2. **`FROM_MANAGER_ID` is worth far less than claimed above.** Five of these six paths set no
   `fromManager` at all. Airfare is the exception (AED 2.19m — the largest single type, but not
   the general fix implied in the earlier correction).
3. **Prorated salary is not a monthly batch.** It is the DAILY job with a narrow eligibility
   window (start date ≥27th of the previous month), which is why it lands on ~11 days a year.

### The verification owed

The `noteReasone` strings are now known, so the code answer can be tested against the data
rather than taken on trust — group expense-less additions by `NOTE_REASON` and map each to its
predicted code path. **The column that matters is `(unmatched)`**: anything there is a producer
the code answer did not account for, which is exactly the check that caught `syncSigningBonus`.
Query in the audit transcript; it also splits Bonus into referral vs signing for the first time.

Full answer: `evidence-machine-notes-conv46381.md`.

## The headline (as first measured — read the correction above first)

**AED 3,976,775.54 across 5,345 notes — 58% of all manager-note money — is written with no
human identity at all.** It is the `(no requester recorded)` producer: 14.64 notes/day across
10 payment types and 3,887 maids. Nothing else in the data comes close; the busiest real
person (Jed Torres, Delighter Coach) runs at 3.25/day.

## What the warehouse can and cannot say

| Field | Result on the 5,345 machine notes |
|---|---|
| `REQUESTED_BY` | NULL on all — this is the defining filter |
| `APPROVED_BY` | **0 notes carry an approver** |
| `EXPENSE_ID` | **0 of 5,345 link to an expense request** |
| `MANAGER` | dead column (`EMPLOYEE_MANAGER_ID` unmapped in the JPA entity) |

🔴 **The warehouse route is exhausted.** There is no field in `BA_VIEWS` recording which
system wrote a note.

### Two consequences

1. **These additions bypass the entire expense-authorisation pathway.** The AED 200 approval
   gate, invoice upload, named requester, named approver — all live on `EXPENSES_REQUESTS`.
   These notes never touch it. The controls are not failing on this money; they were never
   in the path.
2. **`raised_by_profile` cannot apply here.** That heuristic (queries/maids-at-sample.sql)
   keys off `APPROVAL_METHOD` on the expense head. No head, no signal. The **rate** signature
   (14.64 notes/day) is the only thing that identifies the machine set.

## The fix, now priced

`payrollmanagernotes.CREATOR` (`BIGINT` → `USERS.ID`) exists in the ERP and is **not** in the
warehouse view. It is N6 in `SPEC_manager_notes_audit_v2.md` and sits in the DNA ingestion
ticket as a nice-to-have.

**It is not a nice-to-have. Ingesting `CREATOR` makes AED 3.98m — 58% of manager-note money —
attributable for the first time.** Jobs run under a system user, so it should resolve the
machine set as well; that last clause is an EXPECTATION until the column is actually seen.

## 🔴 CORRECTION (same day): "no author recorded" is NOT the same as "written by a bot"

The first pass classified these by RUN-DAY COUNT alone and called all ten "jobs". The HOUR
fingerprint breaks that. Three distinct signatures, two of them anchored to a known case:

| Fingerprint | Types | Reading |
|---|---|---|
| **One hour, midnight, all 7 days** | Airfare (100% exactly midnight), Raffle Prize (100%), Prorated salary (100%), Salary Dispute (87.5%) | A true **scheduled job**. 2,423 notes, AED 2.47m |
| **All 24 hours, ~0% midnight** | Bonus (20 distinct hours), Forgive Deduction (19) | **Event-driven service** — fires when its trigger fires |
| **Business hours only, never Sunday** | **MV Prorated Salary** (9–21, six days, 226 run days), Last Day CC Switch (7–22, Fri/Mon/Tue only) | **A HUMAN IS ACTING** and requestedBy is simply not recorded |

**Both fingerprints are anchored, not guessed:**
- *Positive control on row 2:* **Forgive Deduction is code-confirmed automatic** (the
  `cover_deduction_limit` / `cover_negative_salary` additions) and it shows the all-hours
  spread. So that signature genuinely means automatic-but-event-triggered, not human.
- *Positive control on row 1:* Airfare's single-midnight-hour matches the airfare **producer
  signature** (midnight timestamps) independently identified earlier in this audit.

### The standout

**MV Prorated Salary — AED 803,257 across 782 notes, 226 days a year, 9am to 9pm, never on a
Sunday, with no author recorded.** That is not a bot. Something a PERSON does is writing
AED 803k onto payslips without stamping who did it. This is now the highest-value open
question in the machine-written set, ahead of Airfare by mechanism if not by amount.

### Anomaly RESOLVED

Last Day CC Switch's "213 notes over 3 run days" is **not** a job that fired three times: the
notes spread over 16 hours of the day on Fri/Mon/Tue. It is a **human bulk-entry session**.
That also removes the tension with the earlier `median_days_to_switch = 0` measurement.

## Schedule fingerprint — the raw evidence

| Payment type | Notes | AED | Run days | /day | % month-edge | Reads as |
|---|---:|---:|---:|---:|---:|---|
| Airfare Ticket | 1,220 | 2,189,000 | 313 | 3.9 | 19.8 | Scheduled job, midnight, 100% |
| MV Prorated Salary | 782 | 803,256.89 | 226 | 3.5 | 15.9 | 🔴 **Human hours** (9–21, never Sunday) |
| Bonus | 801 | 609,775 | 264 | 3.0 | 20.3 | Event-driven service (20 hours) |
| Raffle Prize | 576 | 180,000 | 12 | 48.0 | 0.0 | Monthly, off-cycle draw |
| Prorated salary | 619 | 98,836 | 11 | 56.3 | 100.0 | Monthly payroll batch |
| Forgive Deduction | 1,038 | 53,680 | 91 | 11.4 | 38.6 | Payroll-adjacent, > monthly |
| Office Work Addition | 93 | 30,828 | 72 | 1.3 | 14.0 | Sporadic |
| Last Day CC Switch | 213 | 13,616 | 3 | 71.0 | 100.0 | Human bulk entry (16 hours, Fri/Mon/Tue) |
| Salary Dispute (machine) | 7 | 2,483.65 | 3 | 2.3 | 100.0 | Rare, month-edge |
| MV Extra Salary | 1 | 300 | 1 | 1.0 | 100.0 | Once |

### Why there are TWO prorated-salary heads — a specific hypothesis

They are not duplicates. `Prorated salary` is a **monthly payroll batch** (11 runs, 100%
month-edge); `MV Prorated Salary` is **event-driven** (226 runs, 15.9% month-edge). Different
mechanisms, therefore different owners. AED 902,092.89 between them. Confirm against code.

### ⚠️ Anomaly as first recorded (now resolved above — kept for the method)

**Last Day CC Switch Adjustment: 213 notes across only 3 run days** (71 per run). A monthly
job would show ~12. Either it fired three times in a year or the switch events themselves
batch. This sits awkwardly beside the earlier measurement that `median_days_to_switch = 0`
(the note IS the event, which implies a continuous trickle). Flagged, not smoothed over.

## Already known from code (do not re-ask)

- **Forgive Deduction** — the automatic `cover_deduction_limit` / `cover_negative_salary`
  additions, each paired with an `EmployeeLoan` in the same transaction.
- **Raffle Prize** — `RaffleService` / `GenerateRaffleTicketLogsJob` (staffmgmt).
- **Last Day CC Switch** — the note is the event; 213/213 passed all three stated rules.

## Open — needs ask-the-code (CLAUDE.md rule 1), in money order

1. Which job writes the **Airfare Ticket** additions? (AED 2,189,000)
2. Which writes the machine **Bonus** additions — is it the same `DelighterService` path as
   the retraction bonus? (AED 604,775)
3. **MV Prorated Salary vs Prorated salary** — confirm the two-mechanism hypothesis above.
   (AED 902,092.89)

Submitted 2026-09-14, ask-the-code session **46380**, pinned to
`erp/magnamedia-housemaid-management, erp/magnamedia-payroll-management,
erp/magnamedia-accounting`. Question order revised after the hour fingerprint: **MV Prorated
Salary first** (is it user-triggered, and why is `requestedBy` null on that path?), then
Airfare, then Bonus.

⚠️ Alias trap: `erp/magnamedia-payroll` does not exist and fails the whole multi-repo clone
(`require_all_modules_to_exit is enabled: all 3 repositories must succeed, but only 2
succeeded`). The alias is **`erp/magnamedia-payroll-management`** — see `docs/code-llm-api.md`.

Token goes in `.env` only — never into a prompt, a doc, or a commit.
