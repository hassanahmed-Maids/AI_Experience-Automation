# Spec — Manager Notes Overpayment Check

| | |
| --- | --- |
| **Requested by** | Police & Control |
| **Spec version** | v1 |
| **Date** | 2026-09-15 |
| **Supersedes** | `SPEC_manager_notes_audit_v1/v2/v3.md` and `SPEC_manager_notes_audit_DEV.md` — investigation documents, not build specs |
| **Status** | Draft — awaiting requestor approval |
| **Evidence** | `OVERPAYMENT-LEDGER.md` · `queries/FINDINGS-RUN.sql` · `runs/2026-09-12month-audit-run.md` |

---

## 1. Business Logic

**What a manager note is.** A line added to a housemaid's payslip outside her salary — an allowance,
a bonus, a reimbursement, a correction. Some are typed by a person; most are written by ERP itself.
**24 payment types, AED 6.85m in a rolling twelve months.**

**The control.** Every addition should be traceable to a rule that entitles that maid to that amount
on that day. There is no single gate: each payment type has its own rule, some in code, some in
config, some only in somebody's head.

**Plain terms:** we pay a maid something extra; this checks that she was owed it.

**The failure it catches.** Four shapes, and the spec names them because they need different actions:

| Archetype | Meaning |
| --- | --- |
| **not deserved** | She did not meet the condition the payment exists for |
| **off-rule** | A stated rule was broken — the money may still have been owed |
| **paid twice** | The same entitlement paid more than once |
| **control violated** | The authorisation path was bypassed; money may be correct |

**What this check does NOT judge**, each settled by the requestor on 2026-09-15 rather than assumed:

| Excluded | Ruling |
| --- | --- |
| **Deductions** | Out. `NOTE_TYPE = 'ADDITION'` only. Money taken *from* a maid is not audited here or anywhere |
| **Zero-amount notes** | Out. `AMOUNT > 0` is mandatory in **every** check — see §2.4 hygiene 1, which is why |
| **Money paid outside payroll** | Out of scope. ~15 notes say "paid manually" and were then zeroed. **Every total in this check has that hole in it**, and the page must say so |
| **Who may edit a note's amount or date** | Out — "we don't care about that cycle" |
| **Whether zeroing is the sanctioned cancellation** | Out |
| **ERP re-generating an already-paid addition** | Not ours. Hand the two evidence notes to payroll |
| **Self-approval** | Out of scope, ruled 2026-09-09 after three rounds of correct method on an excluded number |
| **n8n-sent and notifier templates** | Never in scope |

**Reader and action.** Police & Control opens the dashboard and picks a window. A red row is one
note: open it, decide whether the money was owed, recover or excuse it.

**Grain. One row per NOTE**, not per maid. Every note is its own payment event with its own rule and
its own date, and a maid may hold notes on several types. *(This differs from the GCC checks, which
are per-maid because recovery is held per maid. Here there is nothing to allocate.)*

**Population in scope.** `NOTE_TYPE = 'ADDITION'`, `AMOUNT > 0`, inside the window the user picks.
In the twelve months to 2026-09-15: **16,831 notes, AED 6,851,419** across 24 types.

**Refresh expectation.** 🔴 **Live. There is no fixed window** — the dashboard reads current data in
whatever window the user selects. §3's *Check design* rule exists entirely because of this.

---

## 2. Data Points Needed

### 2.1 Verified — already in Snowflake

| # | Data point | Table | Columns | Verification |
| --- | --- | --- | --- | --- |
| D1 | **The addition** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | `ID`, `HOUSEMAID_ID`, `EXPENSE_ID`, `NOTE_TYPE`, `REASON`, `NOTE_REASON`, `AMOUNT`, `NOTE_DATE`, `REQUESTED_BY`, `APPROVED_BY`, `MANAGER` | 16,831 additions / AED 6,851,419 in 12 months. `REASON` is the payment type |
| D2 | The authorising expense request | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | `ID`, `EXPENSE_TYPE`, `REQUEST_STATUS`, `AMOUNT`, `CURRENCY_NAME`, `REQUESTED_BY`, `APPROVED_BY`, `BENEFICIARY_NAME`, `EXPENSE_PAYMENT_ID`, `CREATION_DATE`, `REFUNDED`, `REFUND_DATE` | Joins on `D1.EXPENSE_ID`. **11,819 of 16,831 notes carry one. 5,345 carry none** |
| D3 | Expense head configuration | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` | `EXPENSE_TYPE`, `CODE`, `APPROVAL_METHOD`, `LIMIT_FOR_APPROVAL`, `APPROVE_HOLDER`, `REQUIRE_INVOICE`, `ALLOW_TO_ADD_LOAN` | **Not unique on `EXPENSE_TYPE`** — deduplicate or every downstream sum inflates |
| D4 | **Contract type as of the note date** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS` | `HOUSEMAID_ID`, `TO_TYPE`, `CHANGE_DATE`, `NEXT_CHANGE_DATE` | `TO_TYPE` ∈ {`MV`, `CC Live In`, `CC Live Out`}. Closed intervals — containment, no window function |
| D5 | **Status as of the note date** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS` | `HOUSEMAID_ID`, `TO_STATUS`, `CHANGE_DATE`, `NEXT_CHANGE_DATE` | Same shape as D4. Carries the `NO_SHOW_*` family |
| D6 | Maid master record | `…HOUSEMAIDS_INFO` | `ID`, `NAME`, `NATIONALITY`, `START_DATE`, `DATE_OF_TERMINATION`, `PRIMARY_SALARY`, `BASIC_SALARY`, `ACCOMMODATION_SALARY` | 🔴 **Current state only.** `DATE_OF_TERMINATION` is **not cleared on re-hire** — it killed a whole finding once |
| D7 | Point-in-time maid attributes | `…HOUSEMAIDS_INFO_REVISION` | `ID`, `LIVE_OUT`, `START_DATE`, `REPLACEMENT_SALARY_START_DATE`, `LAST_MODIFICATION_DATE` | Envers. **No `NEXT_CHANGE_DATE`** — needs "latest revision at or before the note" |
| D8 | Referral entitlement | `…HOUSEMAID_REFERRALS` | `HOUSEMAID_ID`, `REFERRED_MAID_ID`, `AMOUNT`, `IS_CANCELLED`, `IS_REQUESTED_BONUS`, `BONUS_REQUEST_DATE` | `HOUSEMAID_ID` is the **referrer**. The authorised amount |
| D9 | Referral bonuses paid | `…MAIDS_REFERRALS_BONUSES` | `REFERRED_HOUSEMAID_ID`, `BONUS_AMOUNT`, `PAYROLL_NOTE_DATE` | 🔴 **Built from the same `payrollmanagernotes` source** — circular as a price source. Paid amount only |
| D10 | Anti-attrition enrolment | `…HOUSEMAID_MANAGERACTIONLOGS` | `HOUSEMAID_ID`, `ACTION_TYPE`, `CREATION_DATE`, `ACTION_DATE` | `ACTION_TYPE ILIKE '%Incentive%Experiment%'`. **Use `CREATION_DATE`, not `ACTION_DATE`** |
| D11 | Staff identity | `BA_VIEWS.CORE_SILVER.USERS_INFO` | `ID`, `NAME`, `EMAIL`, `IS_ACTIVE` | Name→email bridge. `IS_ACTIVE` is **numeric**, encoding unverified |
| D12 | Staff department | `BA_VIEWS.CORE_SILVER.OFFICE_STAFF` | `EMAIL`, `DEPARTMENT`, `JOB_TITLE`, `MANAGER_EMAIL` | 767 rows. **No name and no id — email only**, so D11 is mandatory |
| D13 | Department history | `BA_VIEWS.CORE_SILVER.OFFICE_STAFF_CHANGES` | `EMPLOYEE_NAME`, `EMPLOYEE_EMAIL`, `DEPARTMENT_NAME`, `PREVIOUS_/NEW_DEPARTMENT_NAME`, `CHANGED_AT`, `IS_DEPARTMENT_CHANGE` | **Joins by NAME** — `EMPLOYEE_EMAIL` is null on thousands of rows. History starts **2025-06-15** |

### 2.2 Approved KPI definitions reused

**One.** The undeducted-loan KPI in `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` (CC 80.2% /
MV 95.2%) is used **only** to contradict a wrong reading of a loan field; it defines none of the money
here. Every metric in §3 is a **new Police & Control definition** and should be added to the Data
Catalog.

### 2.3 New data ingestion request

| # | Column | Table | Why |
| --- | --- | --- | --- |
| I1 | `CREATOR` (`BIGINT` → `USERS.ID`) | `payrollmanagernotes` | **There is no author column for a manager note anywhere in the warehouse.** `MANAGER` maps to `EMPLOYEE_MANAGER_ID`, which is unmapped in the JPA entity and 100% null. `REQUESTED_BY` is the **expense record's** requester carried through the join, not the note's author |
| I2 | `FROM_MANAGER_ID` | `payrollmanagernotes` | The owning-manager picklist. Airfare hardcodes `managers/jad`; five of six other automated paths set nothing |

🔴 **I1 alone is not sufficient, and the request must say so.** `creator` comes from `BaseEntity` and
is set from the authenticated user, so it is **null inside background tasks and scheduled jobs** —
which is exactly where most of this money is written. The fix is two-part: ingest the column **and**
have dev set an author on the automated paths. **`RafflePerformerJob` already does this**, stamping
`erp_user` when creator would be null — so the ask is "do what the raffle job does", not a design.

### 2.4 Join keys

| From | To | Key | Note |
| --- | --- | --- | --- |
| D1 `EXPENSE_ID` | D2 `ID` | NUMBER = NUMBER | Present on 11,819 of 16,831 |
| D1 `HOUSEMAID_ID` + `NOTE_DATE` | D4 / D5 | interval containment | `note_day >= CHANGE_DATE::DATE AND (NEXT_CHANGE_DATE IS NULL OR note_day < NEXT_CHANGE_DATE::DATE)`. **Half-open. `BETWEEN` double-counts the change day** |
| D1 `HOUSEMAID_ID` + `NOTE_DATE` | D7 | latest ≤ note | Envers has **no closing edge**; `QUALIFY ROW_NUMBER() … ORDER BY changed_on DESC = 1` |
| D1 `REQUESTED_BY` (name) | D11 `NAME` → D12 `EMAIL` | name → email → department | Two hops. Normalise case **and internal whitespace** — `"Georgina  Wakim"` carries a double space |
| D1 `REQUESTED_BY` (name) | D13 `EMPLOYEE_NAME` | name | For department **as of the note date** |

**As-of and timezone.** Every as-of read cuts on `NOTE_DATE::DATE`. `CHANGE_DATE`,
`NEXT_CHANGE_DATE` and `CHANGED_AT` are `TIMESTAMP_NTZ`; a maid whose type changes on the note date
can fall either side of a UTC-versus-Gulf shift. **Unresolved — O6.**

### 2.5 Known data hygiene issues — each one measured

1. 🔴 **Zero-amount notes are the single most dangerous artefact in this data, and they have already
   produced one retracted finding of AED 49,500.** A note at amount 0 is how the business **cancels**
   an addition — the narratives say "postponed", "RBs confirmed NOT to release", "Duplicated", "paid
   manually". A test that treats *the existence* of a prior note as evidence of a prior **payment**
   pairs a real payment against a cancellation and calls it a duplicate. **`AMOUNT > 0` is mandatory
   in every check.** The general rule: *a check may use another note's **amount**; it may never use
   another note's **existence** unless that note has `AMOUNT > 0`.*
2. **`MANAGER` is dead** — `FIXED(38,0)`, no non-null values, because `EMPLOYEE_MANAGER_ID` is
   unmapped in the current JPA entity. Never join on it.
3. **`REQUESTED_BY` and `APPROVED_BY` are TEXT names, not ids**, and arrive **from the expense side**.
   They are `''` not NULL on absence — `IS NOT NULL` clears a note nobody approved. Use
   `NULLIF(TRIM(x),'')`.
4. **43% of approvals that exist carry a bare first name.** A first name resolves to a person only
   when unique among staff; otherwise BLOCKED, never guessed.
5. **`NOTE_DATE` carries a time, and what that time means varies by producer.** Airfare is 100%
   exactly midnight because the code writes a **date**; MV Prorated Salary spans 09:00–21:00 because
   it writes a **timestamp**. 🔴 **The hour is therefore not a mechanism detector** — a conclusion
   reached the wrong way once already. And `NOTE_DATE = LAST_DAY(NOTE_DATE)` is **false for every
   row**; cast to `::DATE` before any date equality.
6. **Batch run days are observed, never assumed.** The anti-attrition batch ran **2026-09-01** — the
   largest in the series, 918 notes — so August's notes carry September dates. Any "last calendar day
   of the month" rule misfiles all of them.
7. **`EXPENSES_CONFIGURATION.LIMIT_FOR_APPROVAL` is a threshold above which approval is required, not
   a ceiling.** Read as a ceiling it turned 217 compliant notes into an AED 20,532 finding.
8. **`EXPENSE_REQUEST_TASK_NAME` is a workflow state, not a category.** Reading it as a category
   produced a "no defects across 944 notes" clearance that meant nothing.
9. **`HOUSEMAIDS_INFO.DATE_OF_TERMINATION` is not cleared on re-hire.** A returning maid reads as
   "terminated 558 days ago" forever. It voided a AED 3,000 raffle finding.
10. **`PURPOSE_ID` does not exist in the warehouse.** It appears in this project's own ingestion wish
    list and was once cited as if it were schema.
11. **Expense-linked notes fan out.** `EXPENSES_CONFIGURATION` is not unique on `EXPENSE_TYPE`;
    deduplicate with `QUALIFY ROW_NUMBER() … ORDER BY CODE = 1`.
12. **Two as-of sources exist for live-in/live-out and they are not interchangeable.** The relocation
    check uses `HOUSEMAID_TYPE_LOGS.TO_TYPE`; the transport check uses
    `HOUSEMAIDS_INFO_REVISION.LIVE_OUT`. **Unreconciled — O-LIVE.**

---

## 3. Metric Calculations

### 🔴 Check design — what a live, user-chosen window forces

The dashboard reads current data in whatever window the user picks. **Any rule expressed as an
aggregate over that window silently changes answer as the window moves.** Three binding consequences:

1. **Lookbacks ignore the display window.** "No second airfare within 5 months" looks 5 months back
   from **the note**, even when the user is viewing one month. A check that sees only the displayed
   rows reports a clean month that is not clean.
2. **Anything expressed as a share of the window is not a check.** Requester concentration, producer
   share, "% of notes" — investigative tools, not dashboard rules.
3. **Base rates and chance baselines cannot live in the UI.**

**The testable surface is therefore: one addition, `AMOUNT > 0`, given a verdict on its own terms,
with whatever lookback its own rule needs.**

### Shared definitions

**`AS_OF(note)`** — every attribute is read at `NOTE_DATE::DATE` by interval containment (D4/D5) or
latest-revision (D7). **Never today's value.** Reading current state instead of as-of state moved six
findings in this audit, one of them by 97%.

**`ROUTE`** — `expense` if `D1.EXPENSE_ID` resolves to a D2 row, else `direct`. **5,345 notes / AED
3,976,776 — 58% of the money — are `direct`**: no expense request, and therefore none of the
authorisation controls that live on it (approval threshold, invoice, requester, approver).

**`SCORED`** — a note is scored only where its rule's mechanism existed. Checks with an era gate name
their own date; a gate is **observed from the data**, never hardcoded as policy.

### The checks

Each is one note, one verdict. Figures are as of **2026-09-15**; every one is a snapshot of a rolling
window and is date-stamped for that reason.

| # | Check | Archetype | Rule | AED | Notes |
| --- | --- | --- | --- | ---: | ---: |
| **C1** | Anti-attrition to a maid in a NO-SHOW or terminated state | not deserved | `AS_OF` status ∈ {`NO_SHOW`, `NO_SHOW_WENT_OUT_DID_NOT_RETURN`, `NO_SHOW_LEFT_CLIENT_HOME`, `NO_SHOW_FOR_TERMINATION`, `EMPLOYEMENT_TERMINATED`} | **13,257** | 110 |
| **C2** | Bonus over the referral entitlement | not deserved | maid-level `SUM(bonus) > SUM(D8.AMOUNT where not cancelled and requested)` | **11,500** | 16 maids |
| **C3** | Anti-attrition paid before enrolment existed | not deserved | `note_day < MIN(D10.CREATION_DATE)` | **9,019** | 42 |
| **C4** | Anti-attrition to an MV maid against a CC-only rule | off-rule | `AS_OF` type = `MV` | **5,526** | 20 |
| **C5** | Airfare to an MV maid | off-rule | no CC interval in the 24-month entitlement window | **4,500** | 3 |
| **C6** | Accommodation Relocation to a live-in maid | not deserved | `AS_OF` type = `CC Live In` | **3,900** | 5 |
| **C7** | Prorated salary outside the eligibility window | not deserved | salary start not within 0–40 days before the note | **2,976** | 25 |
| **C8** | Forgive Deduction — 15+ days in one month | off-rule | maid-month with ≥15 notes | **2,492** | 55 |
| **C9** | Note exceeds its approved request | off-rule | `AED` and `AMOUNT > req_amount + 0.01` | **1,304** | 4 |
| **C10** | Anti-attrition same-day excess | paid twice | same-day total > entitlement, **entitlement = largest whole-entitlement note (100–500) across the year** | **838** | 17 groups |
| **C11** | Airfare above its nationality tier | off-rule | `AMOUNT > MODE(AMOUNT)` for that nationality | **500** | 1 |
| **C12** | Live-out transport to a live-in maid | not deserved | head `Live-out Transportation Assistance` **and** `D7.LIVE_OUT = 0` as-of | **392** | 3 |
| | **Money lost, total** | | | **56,204** | |

**Control violated — a separate table that must never be added to the one above.**

| # | Check | AED | Notes |
| --- | --- | ---: | ---: |
| **K1** | Bonus paid before the bonus was requested | 9,500 | 12 |
| **K2** | A deprecated, config-disabled bonus path is still paying | 7,126 | 10 |
| | **Total** | **16,626** | |

⚠️ **9 notes / AED 6,500 across 8 maids appear in both C2 and K1.** Neither total double-counts — the
tables are never summed — but **half the C2 maids are in both findings**, and a write-up that tells
both stories tells the same maids twice.

### Era gates

| Check | Gate | Why |
| --- | --- | --- |
| C1, C3, C4, C10 | anti-attrition enrolment records begin with the scheme | Before it, absence of enrolment is a missing mechanism |
| C5, C11 | airfare rule is code-verified from `AddScheduledAnnualVacationService` | CC-only, no airfare within 5 months, ≥16 months since the last ticket |
| **All** | **department attribution: 2025-06-15** | `OFFICE_STAFF_CHANGES` carries no department change before it. Older notes resolve to *today's* department, which must be labelled as such |

### V1 — The AI verifier

Every note reaching a red verdict is **read before it is reported**. The verifier does no arithmetic;
it answers one question — **does anything written explain why this money was paid?**

**The verdicts are the house set**, identical in every Police & Control check.

| Verdict | Means, for this check |
| --- | --- |
| `JUSTIFIED` | The text authorises this payment, decidably |
| `PLAUSIBLE` | The text explains the case but does not authorise the amount |
| `AMBIGUOUS` | Relevant text, nothing decidable |
| `NOT_RELATED` | Read in full; nothing addresses this payment |
| `UNRESOLVED` | Contradicts itself or breaks off |
| `NO_TEXT` | No note text and no complaint in the window |

**Categories** — `category_id` is null and must be null for `NOT_RELATED`, `NO_TEXT`, `UNRESOLVED`.

| # | Category |
| --- | --- |
| 1 | **An exception was approved and written down** — a named person authorised it |
| 2 | **The entitlement date was moved by request** — postponed or released early |
| 3 | A dispute or complaint was settled by this payment |
| 4 | The payment is a top-up to an earlier one, not a second entitlement |
| 5 | Paid outside payroll and the note is a record, not a payment |
| 6 | New reason — you name it |

**What a verdict does to a case.**

| Verdict | Effect |
| --- | --- |
| `JUSTIFIED`, category 1 or 3 | **Green.** Authorised, or settled a dispute |
| `JUSTIFIED`, category 4 | **Green**, and links to the earlier note |
| `JUSTIFIED`, category 2 | **Amber.** The date was moved by a person with no structured record — the payment may be owed, the control was not followed |
| `JUSTIFIED`, category 5 | **Grey, removed from the money.** The note records a payment made elsewhere |
| `PLAUSIBLE`, `AMBIGUOUS` | **Amber**, routed for a human read |
| `NOT_RELATED`, `UNRESOLVED`, `NO_TEXT`, `NOT_READ` | **Stays red** |

🔴 **`HOUSEMAID_MANAGER_NOTES.NOTE_REASON` is the primary evidence and it is unusually rich here.**
Unlike the GCC checks, where coverage was thin, **airfare narratives routinely carry the whole
decision**: *"Postponed till she completes 22 months"*, *"Approved by Medhat to release earlier
todo/657202"*, *"RBs confirmed NOT to release the renewal bonus"*. The verifier reads:

1. **`D1.NOTE_REASON`** for the note being scored — the primary source.
2. `COMPLAINT_COMMENTS.TEXT` on the maid's complaints, ±90 days. **Never `GPT_SUMMARY`, never
   `ORIGINAL_TEXT`.**

**The quote is redacted at the model, not at the report.** Narratives name staff (*"approved by
Nadine"*, *"requested by Alaa"*) and carry todo and complaint ids. Names, phone numbers, emails, URLs
and ids are replaced with `[placeholder]` before the quote leaves the verifier.

**Two mechanical guardrails.** `threads_read` lower than what was supplied is **rejected and re-run**.
A read that did not happen is stamped **`NOT_READ`** — a run state, not a seventh verdict — **stays
red and is counted separately from `NOT_RELATED`.**

### Tie-out rules

**1 — the money.** Money-lost total = the sum of C1…C12 as distinct note sets. **No figure here is a
sum of tests**; C2 and K1 overlap by 9 notes and sit in different tables for that reason.

**2 — the population.** Every addition is accounted for:

| Step | Notes | AED |
| --- | ---: | ---: |
| Additions, `AMOUNT > 0`, in window | 16,831 | 6,851,419 |
| of which `route = expense` | 11,486 | 2,874,643 |
| of which `route = direct` | **5,345** | **3,976,776** |

**3 — no check counts a subset of another.** 🔴 **This identity is not decorative.** A "selection-lag"
row of AED 3,050 sat on the ledger for a week before it was found to be a **subset of C4** — the run
report had said so in writing at the time. Every check must state the note set it claims, and no two
may intersect within the money-lost table.

---

## 4. Finalised UI Report

**Layout:** four KPI tiles (money lost · notes red · red rate · money examined) → the three tie-out
lines → spend by month with the red share overlaid → **where the money goes missing**, by check →
by payment type → by **department that raised it** → the cases table.

**Columns.** Flag · Note id · Note date · Payment type · Maid id · Amount · Check that fired · Route
(`expense` / `direct`) · Department as of the note · **What the note says (the V1 verdict, quote on
hover)**. Amounts right-aligned, 2 dp. **Default sort: amount descending.**

**By department — required, not optional.** Seven departments raise Maids.at alone. The department
column is what turns "this type has no rule" into "this team has no rule", which is the actionable
form. **Every department cell carries its resolution tier** — read from the log, or assumed from
today's directory — because before 2025-06-15 there is no history and the value is today's.

**Filters.** Window (user-chosen, default last 12 months) · payment type · check · route · department.
**There is no reviewed/unreviewed filter and there will not be one** — nothing stores a review state
and the check writes nothing back. Each run is a fresh read.

**Flags.** Red = a check fired with nothing written that explains it. Amber = explained but not
authorised, or an entitlement date moved by request. Grey = paid outside payroll, or no mechanism
existed. Green = no check fired. **Every flag carries its word, never colour alone.**

**Drill-down.** The note's full narrative; its expense request with status and approver if any; the
maid's type and status timeline around the note date; other notes to the same maid within 5 months
**with their amounts**, so a duplicate is visible and a cancellation is not mistaken for one.

**Provenance line.** All thirteen source tables and the as-of timestamp, on the page.

**Export.** CSV of row-level detail. **The maid's name is in no column and no export.** Staff names
appear only as the department attribution, never as an accusation column.

🔴 **The page must carry one standing caveat:** *"Payments made outside payroll are not visible to
this check. Where a note says 'paid manually', the money moved and the amount here is zero."*

---

## 5. Worked Examples

### A — clean, no action
An anti-attrition note of AED 200. `AS_OF` status is `WITH_CLIENT`, type is `CC Live In`, an enrolment
record exists dated before the note, and the amount matches her enrolled tier. No check fires →
**Green.**

### B — the exception this check exists for
An anti-attrition note of AED 271 to a maid whose `AS_OF` status is `EMPLOYEMENT_TERMINATED`. C1 fires
→ **Red, AED 271.** A retention incentive paid to a maid who had already gone. **110 notes, AED
13,257** — the largest single finding.

### C — as-of is the whole answer
An anti-attrition note to a maid who is `MV` today. On a current-state read, **941 notes / AED 172,967**
fire. Read as-of the note date, **20 notes / AED 5,526** do. **The other 97% switched after they were
paid and were correctly paid as CC.**

### D — the cancellation that looks like a duplicate
A maid has an airfare note at AED 0 on 2026-05-02 with narrative *"…/ postponed, didn't accumulate 22
months under CC"*, and a real AED 2,000 airfare note on 2026-06-14. A check that pairs on **existence**
calls the second a duplicate inside the 5-month guard. **It is not: the first is a cancellation and no
money moved.** This exact shape produced **26 false pairs worth AED 46,000**, since retracted. `AMOUNT
> 0` removes it structurally.

### E — the verifier changes the flag, not the arithmetic
An airfare note of AED 2,000 fires C5 — she was MV in the entitlement window. V1 reads the narrative
and finds *"CC converted to MV, approved by switch to MV team to pay the maid renewal airfare ticket,
todo;559648"*. **The amount does not move.** The flag does: red → **green**, verdict `JUSTIFIED`,
category 1, with the note quoted and its id on the row.

### F — explained but not authorised
An airfare note whose narrative reads *"…/ DM requested to release now before completing 22 months
under CC"*. The payment was decided by a person, but **no structured field records the override, no
approver column exists, and `AuditorAction` does not fire on ordinary edits**. Verdict `JUSTIFIED`,
**category 2 → Amber.** The money is probably owed; the control was not followed, and that is a
different report to a different owner.

### G — out of scope, counted and visible
An airfare note at AED 0 whose narrative reads *"…/ 2000 dhs paid manually"*. The maid was paid AED
2,000 outside payroll. **This check scores it as zero and always will.** It appears grey on the page
with the standing caveat, because silent exclusion is how a hole becomes a lie.

---

## 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| **B3** | **Must anti-attrition eligibility hold at payment, or only at selection?** The job checks at selection and pays two async hops later. **This one line decides AED 16,307** — C1 plus C4's lag half. If selection-only is intended, both stop being findings | George Abboud | **Yes — the largest single dependency in the spec** |
| **K1** | **What is `Maids.at other expenses` for, and who qualifies?** AED 51,260, 273 notes, clean on authorisation and **completely untested on entitlement because no rule exists to test against**. Seven departments raise it. Two distinct tariffs sit under it — PRO Services at ~AED 90 a note, Delighters L1 at ~AED 423 | George Abboud | **Yes for that type** |
| **L2** | **Office work — must she be assigned on the day she is paid?** Decides AED 13,140. Only 15 of 92 notes were assigned when paid; 62 were with a client | George Abboud | Yes for that type |
| **C5q** | **What are the rejection reasons for a bonus request?** The target set is bonuses that met a rejection condition and were paid anyway | George Abboud | No |
| **X1** | **Which payment types may each contract type receive?** CC live-in, CC live-out, MV, Freedom Operator, Walk-in. Two rows confirmed (airfare CC-only, relocation CC-live-out). **Paying against a rule that never applied is undetectable without the list** | George Abboud | No |
| **A7** | **Airfare tenure — 22 months or 2 years?** The narratives use both, interchangeably, in the same week. The code gives a third number: ≥16 months since the last ticket. Three thresholds, one rule | George Abboud / ERP | Yes for airfare |
| **A8** | **Is "renewal bonus upon the switch to MV" the same entitlement as the airfare ticket?** ~18 notes / ~AED 32,500 booked under the airfare head with that narrative. If different, every airfare rule tested against them tests the wrong thing | George Abboud | Yes for airfare |
| **O-MV** | **782 notes carry a string the code says is written to a payroll log and a to-do, not to a manager note.** Either something copies it across or there is another writer. `AccountantToDoService.createAccountantTodoForTerminatedProratedMVMaids` | ERP | No |
| **O-LIVE** | **Two as-of sources for live-in/live-out**, used by two different checks: `HOUSEMAID_TYPE_LOGS.TO_TYPE` (C6) and `HOUSEMAIDS_INFO_REVISION.LIVE_OUT` (C12). Reconcile, then pick one | Snowflake team | No |
| **O6** | Which timezone are `HOUSEMAID_TYPE_LOGS` / `HOUSEMAID_STATUS_LOGS` timestamps written in? A maid whose type changes on the note date can fall either side | Snowflake team | No |
| **I1/I2** | **The ingestion request in §2.3, and the dev change beside it.** Without an author column, 58% of the money is unattributable to a person. `RafflePerformerJob` already shows the pattern | Data team / ERP | No |
| **O-MAN** | **Money paid outside payroll is invisible to this check.** ~15 notes say so in free text; the real population has never been measured. Out of scope by ruling — **but the size is worth knowing before anyone quotes a total** | Police & Control | No |
| **O-ERP** | **ERP re-generates additions it has already paid.** Two notes record it on the secondary payroll run; both were caught and zeroed by a person. Not ours — hand it to payroll | Payroll | No |

---

## Appendix — what this spec supersedes, and what changed

`SPEC_manager_notes_audit_v1/v2/v3.md` are investigation documents — 1,600+ lines each, written while
the data was still being learned. They are kept for their evidence and are **not build specs**.

| Earlier | Here |
| --- | --- |
| Findings totalling ~AED 103,100 | **AED 56,204**, rebuilt row by row. AED 196,465 has been withdrawn across nine retractions — **more than three dirhams retracted for every dirham standing** |
| A fixed 12-month window | **No window.** Live, user-chosen, with the check-design rule that forces |
| Zero-amount notes unfiltered in 90 statements | **`AMOUNT > 0` mandatory**, with the rule that generalises it |
| "Selection-lag" as its own finding | **Retracted — a subset of C4, counted twice** |
| Deductions listed as an open question | **Closed: out of scope** |
| Self-approval pursued through three rounds | **Closed: out of scope** |
| Per-maid grain inherited from the GCC checks | **Per note.** Each note is its own payment event with its own rule |

**Figures measured live 2026-09-15** via `queries/FINDINGS-RUN.sql`, one statement, every row carrying
measured against recorded. Nine of twelve rows returned drift of exactly zero.
