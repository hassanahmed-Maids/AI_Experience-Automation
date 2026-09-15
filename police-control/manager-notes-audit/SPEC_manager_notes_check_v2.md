# Spec — Manager Notes Overpayment Check

| | |
| --- | --- |
| **Requested by** | Police & Control |
| **Spec version** | v2 |
| **Date** | 2026-09-15 |
| **Supersedes** | `SPEC_manager_notes_check_v1.md` (same day — v1's C1, C3 and C4 carried rules that later measurement disproved) and `SPEC_manager_notes_audit_v1/v2/v3.md` / `_DEV.md`, which are investigation documents, not build specs |
| **Status** | 🟢 **Ready to build — no blocking open items.** Two rule decisions and one coverage boundary closed the three that remained; one measurement (O-C2) is queued before *publication*, not before build |
| **Evidence** | `OVERPAYMENT-LEDGER.md` · `queries/FINDINGS-RUN.sql` · `queries/absconded-payment-date.sql` · `queries/anti-attrition-abscondment-cases.sql` · `runs/2026-09-12month-audit-run.md` |

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

**What this check does NOT judge**, each settled by the requestor rather than assumed:

| Excluded | Ruling |
| --- | --- |
| **Deductions** | Out. `NOTE_TYPE = 'ADDITION'` only. Money taken *from* a maid is not audited here or anywhere |
| **Zero-amount notes** | Out. `AMOUNT > 0` is mandatory in **every** check — see §2.5 hygiene 1, which is why |
| **Money paid outside payroll** | Out of scope. ~15 notes say "paid manually" and were then zeroed. **Every total in this check has that hole in it**, and the page must say so |
| **Who may edit a note's amount or date** | Out — "we don't care about that cycle" |
| **Whether zeroing is the sanctioned cancellation** | Out |
| **ERP re-generating an already-paid addition** | Not ours. Hand the two evidence notes to payroll |
| **Self-approval** | Out of scope, ruled 2026-09-09 after three rounds of correct method on an excluded number |
| **The ERP's proration arithmetic** | 🔴 **Out, ruled 2026-09-15.** A maid who leaves mid-month **keeps the prorated part she worked**. The ERP already does this correctly and it is not to be questioned. Only the part paid for days after she left is a finding |
| **Whether a `NO_SHOW` maid should be on a retention scheme at all** | 🔴 **Closed 2026-09-15, not raised.** `Housemaid.rejectedStatuses` deliberately omits every `NO_SHOW*` value, so paying them is config, not a defect — and 63 of the 108 such notes went to maids **back at work on the day payroll ran** |
| **n8n-sent and notifier templates** | Never in scope |

**Reader and action.** Police & Control opens the dashboard and picks a window. A red row is one
note: open it, decide whether the money was owed, recover or excuse it.

**Grain. One row per NOTE**, not per maid. Every note is its own payment event with its own rule and
its own date, and a maid may hold notes on several types. *(This differs from the GCC checks, which
are per-maid because recovery is held per maid. Here there is nothing to allocate.)*

**Population in scope.** `NOTE_TYPE = 'ADDITION'`, `AMOUNT > 0`, inside the window the user picks.
In the twelve months to 2026-09-15: **16,831 notes, AED 6,851,419** across 24 types.

🔴 **What the build covers, stated so the gap cannot be mistaken for a clean result.** The eleven
checks score **AED 30,441 of red across the AED 6,851,419 examined**. Three payment types carry money
that **no check tests at all**, because no rule exists yet to test against — not because they passed:

| Type | AED | Why untested | Owner |
| --- | ---: | --- | --- |
| `Maids.at other expenses` | 51,260 | No entitlement rule exists. Seven departments raise it, at two distinct tariffs | George Abboud (K1) |
| Office work | 13,140 | Unknown whether she must be assigned on the day she is paid | George Abboud (L2) |
| Airfare — "renewal bonus on switch to MV" | ~32,500 | May be a different entitlement booked under the airfare head. **Excluded and named**, never scored against the airfare rule | George Abboud (A8) |
| `Bonus`, the non-referral part | **~865,000 of 876,316** | 🔴 **`Bonus` is a heterogeneous head.** At least seven purposes sit under it: referral (maid→maid), signing, **referral of a *client***, renewal/vacation bonus on MV switch, **ticket/flight allowance**, **Abu Dhabi Incentive**, MMR cases. **C2 can only ever test the first two** — `HOUSEMAID_REFERRALS` is maid→maid via `REFERRED_MAID_ID`, so for every other purpose the authorised amount is **0 by construction** and any `paid > authorised` rule fires on all of them. No entitlement source exists for client referrals or retention promises | George Abboud (new — C2q) |

**These do not block the build.** They are a coverage boundary, and the page must show them as
**grey — "no rule exists to test this"** — never as green. A type with no rule is not a clean type.

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
| D4 | **Contract type, as of** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS` | `HOUSEMAID_ID`, `TO_TYPE`, `FROM_TYPE`, `CHANGE_DATE`, `NEXT_CHANGE_DATE` | `TO_TYPE` ∈ {`MV`, `CC Live In`, `CC Live Out`}. 🔴 **`MV`, never `MAID_VISA`** — a `LIKE '%MAID_VISA%'` matched nothing and silently suppressed a real signal. Closed intervals — containment, no window function |
| D5 | **Status, as of** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS` | `HOUSEMAID_ID`, `TO_STATUS`, `CHANGE_DATE`, `NEXT_CHANGE_DATE` | Same shape as D4. Carries the `NO_SHOW_*` family |
| D6 | Maid master record | `…HOUSEMAIDS_INFO` | `ID`, `NAME`, `NATIONALITY`, `START_DATE`, `DATE_OF_TERMINATION`, `PRIMARY_SALARY`, `BASIC_SALARY`, `ACCOMMODATION_SALARY` | 🔴 **Current state only.** `DATE_OF_TERMINATION` is **not cleared on re-hire** — it killed a whole finding once |
| D7 | Point-in-time maid attributes | `…HOUSEMAIDS_INFO_REVISION` | `ID`, `LIVE_OUT`, `START_DATE`, `REPLACEMENT_SALARY_START_DATE`, `LAST_MODIFICATION_DATE` | Envers. **No `NEXT_CHANGE_DATE`** — needs "latest revision at or before the note" |
| D8 | Referral entitlement | `…HOUSEMAID_REFERRALS` | `HOUSEMAID_ID`, `REFERRED_MAID_ID`, `AMOUNT`, `IS_CANCELLED`, `IS_REQUESTED_BONUS`, `BONUS_REQUEST_DATE` | `HOUSEMAID_ID` is the **referrer**. The authorised amount |
| D9 | Referral bonuses paid | `…MAIDS_REFERRALS_BONUSES` | `REFERRED_HOUSEMAID_ID`, `BONUS_AMOUNT`, `PAYROLL_NOTE_DATE` | 🔴 **Built from the same `payrollmanagernotes` source** — circular as a price source. Paid amount only |
| D10 | Anti-attrition enrolment | `…HOUSEMAID_MANAGERACTIONLOGS` | `HOUSEMAID_ID`, `ACTION_TYPE`, `CREATION_DATE`, `ACTION_DATE` | `ACTION_TYPE ILIKE '%Incentive%Experiment%'`. **Use `CREATION_DATE`, not `ACTION_DATE`** — the latter is caller-supplied and never re-stamped on update. ⚠️ `INCENTIVE_AMOUNT` is **not exposed**; this view's `AMOUNT` maps to `DEDUCTION_AMOUNT` (I4) |
| D11 | Staff identity | `BA_VIEWS.CORE_SILVER.USERS_INFO` | `ID`, `NAME`, `EMAIL`, `IS_ACTIVE` | Name→email bridge. `IS_ACTIVE` is **numeric**, encoding unverified |
| D12 | Staff department | `BA_VIEWS.CORE_SILVER.OFFICE_STAFF` | `EMAIL`, `DEPARTMENT`, `JOB_TITLE`, `MANAGER_EMAIL` | 767 rows. **No name and no id — email only**, so D11 is mandatory |
| D13 | Department history | `BA_VIEWS.CORE_SILVER.OFFICE_STAFF_CHANGES` | `EMPLOYEE_NAME`, `EMPLOYEE_EMAIL`, `DEPARTMENT_NAME`, `PREVIOUS_/NEW_DEPARTMENT_NAME`, `CHANGED_AT`, `IS_DEPARTMENT_CHANGE` | **Joins by NAME** — `EMPLOYEE_EMAIL` is null on thousands of rows. History starts **2025-06-15** |
| **D14** | 🔴 **The payslip — NEW in v2, and mandatory** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | `HOUSEMAID_ID`, `PAYROLL_MONTH`, `ADDITIONS`, `PAID_ON_DATE_FORMATTED`, `IS_TRANSFERRED`, `STATUS` | From `mmdb.housemaidpayrolllogs`, one row per maid × payroll month. **`PAID_ON_DATE_FORMATTED` is the day money actually moved**; `IS_TRANSFERRED` says whether it moved at all. Without this the check cannot tell a payment from a note about a payment |

### 2.2 Approved KPI definitions reused

**One.** The undeducted-loan KPI in `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` (CC 80.2% /
MV 95.2%) is used **only** to contradict a wrong reading of a loan field; it defines none of the money
here. Every metric in §3 is a **new Police & Control definition** and should be added to the Data
Catalog.

### 2.3 New data ingestion request

| # | Column | Table | Why |
| --- | --- | --- | --- |
| I1 | `CREATOR` (`BIGINT` → `USERS.ID`) | `payrollmanagernotes` | **There is no author column for a manager note anywhere in the warehouse.** `MANAGER` maps to `EMPLOYEE_MANAGER_ID`, unmapped in the JPA entity and 100% null. `REQUESTED_BY` is the **expense record's** requester carried through the join, not the note's author |
| I2 | `FROM_MANAGER_ID` | `payrollmanagernotes` | The owning-manager picklist. Airfare hardcodes `managers/jad`; five of six other automated paths set nothing |
| **I3** | 🔴 **`PAID_ON_PAYROLL_MONTH` and `PAID`** | `payrollmanagernotes` | **The highest-value ask in this spec — it has now bitten three separate findings.** Nothing in the warehouse says which payroll month a note pays for. `anti_attrition_incentive` **is** one of the must-be-paid reasons, so the ERP writes these columns; they are simply not ingested. Without them the payslip must be guessed by month (§2.5 hygiene 13), and the documented fallback needs the payroll lock window — whose column `LAST_PAYROLL_LOCK_DATE` has **no non-null values** |
| **I4** | `INCENTIVE_AMOUNT` | `maidmanageractionlogs` | The maid's enrolled anti-attrition tier. Not exposed, so C1 and C10 must **proxy** it as the largest whole-entitlement note (100–500) she received across the window — NULL where she was never paid a whole month, which is **42 of 110 notes / AED 2,566** on C1's population alone |

🔴 **I1 alone is not sufficient, and the request must say so.** `creator` comes from `BaseEntity` and
is set from the authenticated user, so it is **null inside background tasks and scheduled jobs** —
which is exactly where most of this money is written. The fix is two-part: ingest the column **and**
have dev set an author on the automated paths. **`RafflePerformerJob` already does this**, stamping
`erp_user` when creator would be null — so the ask is "do what the raffle job does", not a design.

### 2.4 Join keys

| From | To | Key | Note |
| --- | --- | --- | --- |
| D1 `EXPENSE_ID` | D2 `ID` | NUMBER = NUMBER | Present on 11,819 of 16,831 |
| D1 `HOUSEMAID_ID` + the as-of day | D4 / D5 | interval containment | `day >= CHANGE_DATE::DATE AND (NEXT_CHANGE_DATE IS NULL OR day < NEXT_CHANGE_DATE::DATE)`. **Half-open. `BETWEEN` double-counts the change day** |
| D1 `HOUSEMAID_ID` + the as-of day | D7 | latest ≤ day | Envers has **no closing edge**; `QUALIFY ROW_NUMBER() … ORDER BY changed_on DESC = 1` |
| **D1 `HOUSEMAID_ID` + payroll month** | **D14** | `HOUSEMAID_ID` + `PAYROLL_MONTH` | **Many notes to one payslip row** — never join before the note-level tests finish or the grain fans. Month resolution: §2.5 hygiene 13 |
| D1 `REQUESTED_BY` (name) | D11 `NAME` → D12 `EMAIL` | name → email → department | Two hops. Normalise case **and internal whitespace** — `"Georgina  Wakim"` carries a double space |
| D1 `REQUESTED_BY` (name) | D13 `EMPLOYEE_NAME` | name | For department **as of the note date** |

**As-of and timezone.** `CHANGE_DATE`, `NEXT_CHANGE_DATE` and `CHANGED_AT` are `TIMESTAMP_NTZ`; a
maid whose type changes on the as-of day can fall either side of a UTC-versus-Gulf shift.
**Unresolved — O6.**

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
13. 🔴 **NEW — resolving which payslip paid a note, without I3.** Branch 1 (`PAID_ON_PAYROLL_MONTH`)
    is unavailable; the documented branch 2 needs a lock window that does not exist. So the payslip is
    found on `DATE_TRUNC('month', NOTE_DATE)`, and where that row has no paid date, the **prior**
    month is tried. **That fallback must only ever point forward** — `PAID_ON_DATE_FORMATTED >=
    NOTE_DATE`. Without the guard it returns payslips that paid *before* the note existed; it produced
    **five negative note-to-payment intervals** on C1's population. A note with no resolvable payslip
    is **AMBER, "payment date cannot be established"** — never assumed paid.
14. 🔴 **NEW — `HOUSEMAID_PAYROLL_HISTORY.STATUS` disagrees with D5 on many rows**, showing
    `WITH_CLIENT` where the status log says `NO_SHOW_LEFT_CLIENT_HOME`. It is a snapshot of unknown
    timing. **Read status from D5, never from the payslip.**
16. 🔴 **NEW — `IS_TRANSFERRED` is not a payment test.** Non-transfer rates by type: `MV Prorated
    Salary` **59.9%**, Bonus 3.7%, Maids.at 2.8%, Medical 2.3%, relocation 1.4%, Forgive Deduction 1.4%,
    prorated 1.1%, airfare 0.8%, anti-attrition 0.5%, and **0.0% on seven types**. The outlier is the
    terminated-maid type, so the column tracks **termination**, not non-payment. Reading it as "the
    money never left" would have removed AED 506,309 that was almost certainly settled.
15. 🔴 **NEW — MV conversions cluster hard at month end, and that is not the base rate.** Month-end
    switching is **10.6%** of all CC→MV changes (1,349 of 12,741). Any check that reads type as of a
    date shortly *after* a month boundary will over-fire on maids converting in the ordinary course.
    C4 fired at **90%** month-end before it was corrected.

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
3. **Base rates and chance baselines cannot live in the UI.** They are how a *finding* is validated
   before it becomes a check — the 10.6% month-end rate retracted AED 5,100 — but a rate computed
   over the displayed window is not a rate.

**The testable surface is therefore: one addition, `AMOUNT > 0`, given a verdict on its own terms,
with whatever lookback its own rule needs.**

### 🔴 Which instant a check reads — the v2 correction

**v1 defined one as-of instant and applied it everywhere. That was wrong, and it cost 88% of the
largest check.** A note is written at month end; payroll pays one to three days later. Those are
different days and the maid's state can differ on them.

| Instant | Definition |
| --- | --- |
| **`AS_OF(note)`** | State at `NOTE_DATE::DATE`, by interval containment (D4/D5) or latest-revision (D7). **Never today's value.** |
| **`AS_OF_PAYMENT(note)`** | State at `D14.PAID_ON_DATE_FORMATTED` for the payslip that paid the note (§2.5 hygiene 13). |
| **`ENTITLEMENT_DAY(note)`** | The day the rule's entitlement arose — the renewal, the enrolment, the first day of the pay period. Type- and rule-specific. |

🔴 **The choice is decided by the rule, never by convenience:**

- a rule about **entitlement** ("was she owed this?") reads `ENTITLEMENT_DAY`;
- a rule about **whether money should have left** reads `AS_OF_PAYMENT`;
- 🟡 **`D14.IS_TRANSFERRED` is an AMBER FLAG, not a filter — demoted 2026-09-15 after it failed its
  own first test.** It was briefly specified as a hard population filter above all eleven checks. The
  sweep across all 24 payment types shows **`MV Prorated Salary` at 59.9% not transferred** (471 notes,
  AED 506,309) against **0.5–3.7% everywhere else** — and that type pays **terminated** maids, whose
  payslips do not transfer through normal payroll and who the ledger already clears as entitled. So
  `IS_TRANSFERRED = 'NO'` **does not reliably mean the money did not move**; for terminated and
  absconded maids it may mean settled outside the normal transfer — which is exactly C1's population.
  Until **O-TRANSFER** establishes what it means for a terminated maid, a non-transferred note is
  flagged amber and named, never silently removed from the money;
- `AS_OF(note)` is the fallback only where the note date *is* the governed event.

**What getting this wrong cost.** C1 read status at the note date and had no transfer test. Of its 110
notes: **63 (AED 7,844) went to maids who were back at work on the day payroll ran**, and **13 (AED
1,097) sat on payslips that never transferred**. The check read **13,257**; it is **1,613**.

### Shared definitions

**`ROUTE`** — `expense` if `D1.EXPENSE_ID` resolves to a D2 row, else `direct`. **5,345 notes / AED
3,976,776 — 58% of the money — are `direct`**: no expense request, and therefore none of the
authorisation controls that live on it (approval threshold, invoice, requester, approver).
⚠️ `route` is **not** a control test: on the anti-attrition population **100% of notes on both sides
of every cut were approved**, because the note only comes into existence once its expense todo is
`confirmed`. Approval there is the creation mechanism, not evidence a human authorised anything.

**`SCORED`** — a note is scored only where its rule's mechanism existed. Checks with an era gate name
their own date; a gate is **observed from the data**, never hardcoded as policy.

### The checks

Each is one note, one verdict. Figures are as of **2026-09-15**; every one is a snapshot of a rolling
window and is date-stamped for that reason. **Live total: AED 30,441 across 11 checks.**

| # | Check | Archetype | Rule | AED | Notes |
| --- | --- | --- | --- | ---: | ---: |
| **C2** | Bonus over the referral entitlement | not deserved | 🔴 **INNER join to maids holding a referral entitlement**, then maid-level `SUM(bonus) > SUM(D8.AMOUNT where not cancelled and requested)`. **Absence of a referral record is NOT an entitlement of zero** — scoring it that way returns 40 maids / ~AED 58,000, because `REASON = 'Bonus'` carries seven purposes and D8 prices two | **11,500** | 16 maids |
| **C5** | Airfare to an MV maid | off-rule | **no CC interval anywhere in the 24-month entitlement window.** The window is the renewal cadence, not Guard 1's 5-month duplicate window — see §6 O-AF | **4,500** | 3 |
| **C6** | Accommodation Relocation to a live-in maid | not deserved | `AS_OF` type = `CC Live In` | **3,900** | 5 |
| **C7** | Prorated salary outside the eligibility window | not deserved | salary start not within 0–40 days before the note | **2,976** | 25 |
| **C8** | Forgive Deduction — 15+ days in one month | off-rule | maid-month with ≥15 notes | **2,492** | 55 |
| **C1** | Anti-attrition to a maid who had gone | not deserved | `AS_OF_PAYMENT` status ∈ {`NO_SHOW`, `NO_SHOW_WENT_OUT_DID_NOT_RETURN`, `NO_SHOW_LEFT_CLIENT_HOME`, `NO_SHOW_FOR_TERMINATION`, `EMPLOYEMENT_TERMINATED`} **AND** `D14.IS_TRANSFERRED = 'YES'` **AND** absent ≥ 10 days at payment, **net of the days she had earned** | **1,613** | 3 maids |
| **C9** | Note exceeds its approved request | off-rule | `AED` and `AMOUNT > req_amount + 0.01` | **1,304** | 4 |
| **C10** | Anti-attrition same-day excess | paid twice | same-day total > entitlement, **entitlement proxied as the largest whole-entitlement note (100–500) across the year** (I4) | **838** | 17 groups |
| **C11** | Airfare above its nationality tier | off-rule | `AMOUNT > MODE(AMOUNT)` for that nationality | **500** | 1 |
| **C4** | Anti-attrition she had not earned as CC | off-rule | **She was not CC throughout the pay period the note pays for**: `AS_OF` type = `MV` at the first day of that period, **OR** a full whole-entitlement amount (100–500) paid for a period she was CC for only part of. One rule, both notes — maid 104507 (MV at period start) and maid 38994 (CC 12 of 31 days, paid a full month) | **426** | 2 |
| **C12** | Live-out transport to a live-in maid | not deserved | head `Live-out Transportation Assistance` **and** `D7.LIVE_OUT = 0` as-of | **392** | 3 |
| | **TOTAL** | | | **30,441** | **11 checks** |

### Retired checks — do not implement

| # | Check | Why it is not a check |
| --- | --- | --- |
| ~~**C3**~~ | ~~Anti-attrition paid before enrolment existed~~ | ⚪ **Unfalsifiable, retired 2026-09-15 (was AED 9,019 / 42 notes).** The job selects on `EXISTS` against the enrolment row, so a maid **cannot** be paid without one; a note predating her earliest surviving row means the original was **deleted**. `deleteEntity` is an unguarded hard delete with no `@Audited`, no soft-delete flag and no history write, so *"never enrolled"* and *"enrolled, unenrolled, re-enrolled"* are **identical in data**. The 42 notes survive as the **control finding** below, not as money |

### Era gates

| Check | Gate | Why |
| --- | --- | --- |
| C1, C4, C10 | anti-attrition enrolment records begin with the scheme | Before it, absence of enrolment is a missing mechanism |
| C5, C11 | airfare rule is code-verified from `AddScheduledAnnualVacationService` | CC-only, no airfare within 5 months, ≥16 months since the last ticket |
| **All** | **department attribution: 2025-06-15** | `OFFICE_STAFF_CHANGES` carries no department change before it. Older notes resolve to *today's* department, which must be labelled as such |

### Control findings — a rule broken where the money may still be owed. **NEVER added to the money.**

| Finding | AED |
| --- | ---: |
| Bonus paid before the bonus was requested | 9,500 |
| A deprecated, config-disabled bonus path is still paying | 7,126 |
| 🔴 **Anti-attrition enrolment can be deleted without privilege or trace** | *no amount* |
| **Subtotal** | **16,626** |

🔴 **The delete-guard gap.** On `/maidNote`, `createEntity` (:116) and `updateEntity` (:147) both
enforce the incentive type check, `validateIncentiveExperimentPositionAccess` and
`validateIncentiveAmount`. **`deleteEntity` (:164-166) enforces none of them and carries no
`@PreAuthorize`.** So enrolling a maid onto a money-bearing programme is position-restricted, changing
her amount is position-restricted, and **erasing the enrolment entirely is not** — and the entity has
no Envers, no soft-delete flag and no history table, so the deletion leaves nothing behind. **18 maids
/ 42 notes** are the population where this demonstrably happened. Carries no amount: the money was
probably owed. This is a dev item, not a management question.

### V1 — The AI verifier

Every note reaching a red verdict is **read before it is reported**. The verifier does no arithmetic;
it decides whether the written record explains the payment.

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

**1 — the money.** Money-lost total = the sum of the eleven checks as **distinct note sets**. **No
figure here is a sum of tests**; C2 and the control row "paid before the bonus was requested" overlap
by 9 notes / AED 6,500 across 8 of C2's 16 maids, and sit in different tables for that reason.

**2 — the population.** Every addition is accounted for:

| Step | Notes | AED |
| --- | ---: | ---: |
| Additions, `AMOUNT > 0`, in window | 16,831 | 6,851,419 |
| of which `route = expense` | 11,486 | 2,874,643 |
| of which `route = direct` | **5,345** | **3,976,776** |

**3 — no check counts a subset of another.** 🔴 **This identity is not decorative.** A "selection-lag"
row of AED 3,050 sat on the ledger for a week before it was found to be a **subset of C4** — the run
report had said so in writing at the time. Every check must state the note set it claims, and no two
may intersect within the money table.

**4 — 🔴 NEW: a retracted check keeps its number and stays visible at zero.** C3 is retired, not
deleted. A silently removed row is indistinguishable from a dropped one, and that is exactly how the
old AED 103,100 headline drifted.

---

## 4. Finalised UI Report

**Layout:** four KPI tiles (money lost · notes red · red rate · money examined) → the four tie-out
lines → spend by month with the red share overlaid → **where the money goes missing**, by check →
by payment type → by **department that raised it** → the cases table.

**Columns.** Flag · Note id · Note date · **Payment date** · Payment type · Maid id · Amount · Check
that fired · Route (`expense` / `direct`) · **Transferred (yes/no)** · Department as of the note ·
**What the note says (the V1 verdict, quote on hover)**. Amounts right-aligned, 2 dp. **Default sort:
amount descending.**

🔴 **Payment date and Transferred are not decoration.** They are the two columns that separate a
payment from a note about a payment, and adding them moved the largest check by 88%. A row where the
payment date could not be established is **amber with the words "payment date cannot be established"**,
never silently treated as paid.

**By department — required, not optional.** Seven departments raise Maids.at alone. The department
column is what turns "this type has no rule" into "this team has no rule", which is the actionable
form. **Every department cell carries its resolution tier** — read from the log, or assumed from
today's directory — because before 2025-06-15 there is no history and the value is today's.

**Filters.** Window (user-chosen, default last 12 months) · payment type · check · route · department
· transferred. **There is no reviewed/unreviewed filter and there will not be one** — nothing stores a
review state and the check writes nothing back. Each run is a fresh read.

**Flags.** Red = a check fired with nothing written that explains it. Amber = explained but not
authorised, an entitlement date moved by request, or a payment date that cannot be established. Grey =
paid outside payroll, or no mechanism existed. Green = no check fired. **Every flag carries its word,
never colour alone.**

**Drill-down.** The note's full narrative; its expense request with status and approver if any; the
maid's type and status timeline **around both the note date and the payment date**; other notes to the
same maid within 5 months **with their amounts**, so a duplicate is visible and a cancellation is not
mistaken for one.

**Provenance line.** All fourteen source tables and the as-of timestamp, on the page.

**Export.** CSV of row-level detail. **The maid's name is in no column and no export.** Staff names
appear only as the department attribution, never as an accusation column.

🔴 **The page must carry two standing caveats:**
1. *"Payments made outside payroll are not visible to this check. Where a note says 'paid manually',
   the money moved and the amount here is zero."*
2. *"Which payslip paid a note is derived, not recorded. Rows where it cannot be established are
   flagged amber and excluded from the money."*

---

## 5. Worked Examples

### A — clean, no action
An anti-attrition note of AED 200. `AS_OF_PAYMENT` status is `WITH_CLIENT`, type is `CC Live In`, an
enrolment record exists dated before the note, the payslip transferred, and the amount matches her
enrolled tier. No check fires → **Green.**

### B — the exception this check exists for
An anti-attrition note of AED 200 to maid 73378. She absconded 2025-09-24; the payslip paid on
2025-11-03, **40 days later**, and transferred. She was enrolled 2025-10-07 — *thirteen days after she
had already gone*. C1 fires → **Red.** She received AED 600 across three months this way. **The whole
check is three maids and AED 1,613**, and that is the honest size of it.

### C — the instant is the whole answer *(replaces v1's example C)*
An anti-attrition note to a maid whose status on the **note date** is
`NO_SHOW_WENT_OUT_DID_NOT_RETURN`. On that reading, **110 notes / AED 13,257** fire. Read as of the
day payroll actually paid, she is `WITH_CLIENT` — she was back at work within three days. **63 of the
110 notes are this case.** A `NO_SHOW` flag at month end that reads `WITH_CLIENT` by the 3rd is a
transient operational state, not abscondment. → **Green, no money.**

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

### H — the arrears month that is not a violation *(new in v2)*
An anti-attrition note of AED 400 to a maid whose `AS_OF` type is `MV`, against a CC-only rule. She
switched to MV on **2026-03-31 — the last day of the month** — and the note is dated 2026-04-18, a
full whole-month amount for a month she spent **entirely as CC**. C4 does not fire: it reads type at
the first day of the pay period, and on 1 March she was CC. **18 of C4's original 20 notes were this
case, AED 5,100.** The month-end pattern is real, not a base rate: **10.6%** of CC→MV switches happen
on the last day of a month, against **90%** in that population.

---

## 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| **B3** | ✅ **CLOSED ON EVERY LIMB 2026-09-15** — (a) MV switch within 2 days is fine; (b) the ERP's proration is correct and not to be questioned; (c) the long-MV population is one note / AED 126; (d) `CREATION_DATE` is trustworthy and maid 73378 was genuinely enrolled 13 days after absconding; (e) the `NO_SHOW` policy question closed and **not raised with management**; (f) C3 unfalsifiable and retired; (g) row 4 retracted on a base-rate test. **Nothing from anti-attrition goes to management** | — | **Closed** |
| **O-AF** | ✅ **CLOSED 2026-09-15** — the rival airfare figure of AED 6,000 was a **5-month** lookback (Guard 1's duplicate window) against C5's **24-month** entitlement window. Run together: RED(24m) ⊆ RED(5m), 3 of 19. Disjoint sets, different questions; the 5m test reintroduces the confound C5 exists to defeat. **C5 stands at 4,500**; the 16 notes / AED 30,000 in the gap are the conservative floor's known cost and stay candidates | Audit | **Closed** |
| **O-INSTANT** | ✅ **RESOLVED BY INSPECTION 2026-09-15 — not a blocker.** Each check was read against its own rule to decide its instant: C1 money-leaving → `AS_OF_PAYMENT`; C4 entitlement accruing over a period → pay-period start; **C6 and C12** (was she live-in when the allowance was granted) and **C7** (salary start vs note) are entitlement tests where **the note date IS the governed event** — correct as written; **C11 uses no instant at all**, being a pure amount-vs-tier comparison. C2, C5, C8, C9, C10 were already keyed to their own events. **The one dimension that applies to every check is the transfer filter, now hoisted above all eleven** (§3) | Audit | **No** |
| **O-C4** | ✅ **RESOLVED BY RULE 2026-09-15 — not a blocker.** The 426 does not split across two checks; it needed one rule that covers both notes, and now has one: *she was not CC throughout the period the note pays for*. Maid 104507 was MV at the period's start; maid 38994 was CC for 12 of 31 days and paid a **full** whole-entitlement month. No orphaned note, no check invented for a single row | Audit | **No** |
| **O-TRANSFER** | 🟡 **What does `IS_TRANSFERRED = 'NO'` mean for a terminated or absconded maid?** The sweep shows the column tracks termination, not non-payment — `MV Prorated Salary` runs at 59.9% against 0.5-3.7% elsewhere. Until this is answered the flag cannot filter money. **C1 is unaffected in its core** (its eight surviving notes are all `YES`) but may be **understated** by the 13 notes / AED 1,097 it set aside — the safe direction | Payroll / ERP | **No** |
| **O-C2** | ✅ **CLOSED 2026-09-15 — C2 re-derived independently and confirmed at AED 11,500 / 16 maids.** The first attempt was a mis-scoped rule that returned 40 maids / ~AED 58,000 because it treated *absence* of a referral record as an entitlement of zero; `REASON = 'Bonus'` carries seven purposes and `HOUSEMAID_REFERRALS` prices two. Scoped by an **INNER join to maids holding an entitlement**, it reproduces the ledger to the dirham — seven over by 1,000, nine by 500. **Transfer exposure zero**, so O-TRANSFER cannot move it. ⚠️ Two corrections: the old basis line *"every one paid exactly double"* is **wrong** (12 of 16 at 2.0x, three at 3.0x, one at 1.5x), and the control-row overlap is **8 of 16 maids / AED 6,000** — half this check's money tells a second story about the same people | Audit | **Closed** |
| **C2q** | 🔴 **NEW — what is a `Bonus` note allowed to be, and who prices each kind?** The head carries referral, signing, client-referral, renewal/vacation, ticket allowance, Abu Dhabi Incentive and MMR payments. **Only maid→maid referrals have an authorised-amount source.** Narratives show retention promises made verbally (*"maid was promised AED 1000 if she finds a new employer"*, *"promised by RBs"*, *"approved by the sup"*) — real commitments with no structured record. **AED ~865,000 is untestable until each kind has a price** | George Abboud | **No for the build** — blocks *coverage* of the bonus head || **K1** | **What is `Maids.at other expenses` for, and who qualifies?** AED 51,260, 273 notes, clean on authorisation and **completely untested on entitlement because no rule exists to test against**. Seven departments raise it. Two distinct tariffs sit under it — PRO Services at ~AED 90 a note, Delighters L1 at ~AED 423 | George Abboud | **No for the build** — blocks *coverage* of Maids.at, not delivery |
| **L2** | **Office work — must she be assigned on the day she is paid?** Decides AED 13,140. Only 15 of 92 notes were assigned when paid; 62 were with a client | George Abboud | **No for the build** — blocks *coverage* of office work |
| **C5q** | **What are the rejection reasons for a bonus request?** The target set is bonuses that met a rejection condition and were paid anyway | George Abboud | No |
| **X1** | **Which payment types may each contract type receive?** CC live-in, CC live-out, MV, Freedom Operator, Walk-in. Two rows confirmed (airfare CC-only, relocation CC-live-out). **Paying against a rule that never applied is undetectable without the list** | George Abboud | No |
| **A7** | **Airfare tenure — 22 months or 2 years?** The narratives use both, interchangeably, in the same week. The code gives a third number: ≥16 months since the last ticket. Three thresholds, one rule | George Abboud / ERP | **No for the build** — C5 and C11 ship on the code-verified thresholds |
| **A8** | **Is "renewal bonus upon the switch to MV" the same entitlement as the airfare ticket?** ~18 notes / ~AED 32,500 booked under the airfare head with that narrative. If different, every airfare rule tested against them tests the wrong thing | George Abboud | **No for the build** — the ~18 notes are excluded and named, not silently scored |
| **O-DEL** | 🔴 **The delete-guard gap** (§3 control findings). `deleteEntity` enforces none of the incentive guards and leaves no trace. A **dev/security item**, free-standing — it depends on no ruling and no other finding. ⚠️ Residual: whether `magnamedia-core` applies framework-level Envers to `MaidManagerActionLog` is not readable from the housemaid-management repo. If it does, the deletions are recoverable and this downgrades | ERP | No |
| **O-MV** | **782 notes carry a string the code says is written to a payroll log and a to-do, not to a manager note.** Either something copies it across or there is another writer. `AccountantToDoService.createAccountantTodoForTerminatedProratedMVMaids` | ERP | No |
| **O-LIVE** | **Two as-of sources for live-in/live-out**, used by two different checks: `HOUSEMAID_TYPE_LOGS.TO_TYPE` (C6) and `HOUSEMAIDS_INFO_REVISION.LIVE_OUT` (C12). Reconcile, then pick one | Snowflake team | No |
| **O6** | Which timezone are `HOUSEMAID_TYPE_LOGS` / `HOUSEMAID_STATUS_LOGS` timestamps written in? A maid whose type changes on the as-of day can fall either side | Snowflake team | No |
| **I1–I4** | **The ingestion request in §2.3.** I3 (`PAID_ON_PAYROLL_MONTH`) is the highest-value one — it has now bitten three separate findings. Without I1 there is no author column and 58% of the money is unattributable to a person; `RafflePerformerJob` already shows the pattern | Data team / ERP | **I3 yes** |
| **O-MAN** | **Money paid outside payroll is invisible to this check.** ~15 notes say so in free text; the real population has never been measured. Out of scope by ruling — **but the size is worth knowing before anyone quotes a total** | Police & Control | No |
| **O-ERP** | **ERP re-generates additions it has already paid.** Two notes record it on the secondary payroll run; both were caught and zeroed by a person. Not ours — hand it to payroll | Payroll | No |

---

## Appendix — what this spec supersedes, and what changed

`SPEC_manager_notes_audit_v1/v2/v3.md` are investigation documents — 1,600+ lines each, written while
the data was still being learned. They are kept for their evidence and are **not build specs**.

### v1 → v2, same day

| v1 | v2 |
| --- | --- |
| **12 checks, AED 56,204** | **11 checks, AED 30,441.** C1 re-scoped (−11,644), C3 retired (−9,019), C4 retracted (−5,100) |
| One as-of instant, `NOTE_DATE`, for everything | **Three instants**, and a rule for choosing: entitlement / payment / note. Getting it wrong cost C1 88% |
| No payslip table | **D14 mandatory.** `PAID_ON_DATE_FORMATTED` and `IS_TRANSFERRED` separate a payment from a note about one |
| C3 a live check at AED 9,019 | **Retired — unfalsifiable.** Converted into the delete-guard control finding |
| C4 keyed on "more than 2 days before the note" | **Keyed on the pay period.** The 2-day line was arbitrary; 18 of 20 were month-end conversions paid in arrears |
| Airfare carried at 4,500 with a rival 6,000 unreconciled | **Reconciled and closed.** Different windows, disjoint sets — not rival estimates |

### Method rules this audit paid to learn

1. **A test's window must come from the rule it tests.** Five months was Guard 1's *duplicate* window, used to test the CC *gate*.
2. **A discriminator that cannot discriminate is not a test.** Expense head, approval rate and the 5-month lookback each returned a predictable answer — two of them predictable from evidence already written down.
3. **Resolve as of the event the rule governs**, not the date on the row. This moved C1, C4 and the airfare reconciliation.
4. **Validate a pattern against its base rate before retracting or asserting on it.** 10.6% vs 90% retracted AED 5,100; had the base rate been 85%, the pattern would have meant nothing.
5. **A retracted row keeps its number and stays visible at zero.**
6. **No figure is a sum of tests.** Four separate near-misses, one of them 58%.

### Over the audit's life

**AED 222,228 has been withdrawn across twelve retractions, against AED 30,441 standing — more than
seven dirhams retracted for every dirham that survived.** That ratio is the strongest evidence the
method works: every one of those retractions was found by this audit, before publication, not after.
