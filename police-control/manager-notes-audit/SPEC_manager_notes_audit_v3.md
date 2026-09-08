# Spec — Manager Notes Audit

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Spec version** | v3 |
| **Date** | 2026-09-08 |
| **UI mockup** | https://claude.ai/code/artifact/75d6c4b8-ee4e-431a-aa8a-b19daa19e051 |
| **Delivered on** | MaidsInsights. Snowflake is the warehouse underneath — not interchangeable |
| **Evidence log** | `snowflake-discovery.md` (catalog claims) · Ask the Code conversations 45815–45818, 45932, 45934, 45948, 45949 (code claims) · `COMPLAINTS-CORROBORATION-DESIGN.md` §3f–§3s (live-data claims) · `AUDIT_v2_2026-09-08.md` (the audit this version answers) |
| **Status** | Draft — blocked on the warehouse grant. 12 requestor decisions open (the group rules). Answers all 3 critical and 5 major findings of the v2 audit |
| **Last amended** | **2026-09-08** — first version written against **live query results** rather than catalog metadata and code alone. See "What changed 2026-09-08 (v3)" |

### What changed 2026-09-08 (v3)

**v1 and v2 were built on catalog metadata and ERP code. v3 is the first version corrected by
running the data.** Eleven queries over the live warehouse produced results that changed the logic
in eight places — and, as often, *withdrew* claims the earlier versions made confidently. Every item
below cites the evidence.

**Scope note, 2026-09-08:** this audit tests **whether each payment follows the rule for its payment
type**. Segregation of duties, self-approval and attribution checks are **out of scope** and have been
removed — who approved a payment is a separate control question, not part of whether the payment was
correct.

**The changes that alter what gets reported:**

1. 🔴 **Group B — 59% of the population by count — had no rule that could run.** All four candidate
   checks are now closed off by evidence (see group B). Its rule is **Job 1**, and Job 1 is now
   evidenced viable: the enrolment reason box is 100% filled, 96% distinct, median 43 chars.

**The three obligations added to every future check:**

2. **Chance baselines.** A window-based test has a hit rate that owes nothing to the business. A
   105-day window with a 30-day proximity band yields **p = 0.286**, so at 1.7 records per subject
   chance alone produces a 40% hit rate — which is exactly what anti-attrition's complaint
   corroboration produced (**1.00× chance: zero signal**), while reading as "40% corroborated".
   Every window test now publishes its chance rate beside its observed rate.
3. **Trends, not point counts.** A monthly count renders a rule that started failing, a backlog being
   worked off, and a chronic weakness as the same number — and only the first needs an owner this
   week. Every finding metric publishes a 24-month series beside its current value.
4. **Batch days are observed, never assumed.** The anti-attrition batch ran on **2026-09-01**, not
   08-31 — 918 notes, the largest in the series. And `NOTE_DATE` carries a time, so
   `NOTE_DATE = LAST_DAY(NOTE_DATE)` is false for *every* row and returns a well-formed, plausible,
   meaningless split.

**The two withdrawals, recorded because a spec that only accumulates claims cannot be trusted:**

5. **"Anti-attrition amounts hide a second payment type" — withdrawn.** Two hand-picked rows implied
   a salary-scale figure; across all 9,167 notes it is one mechanism with proration. The buckets
   reconcile to the note and the dirham.
6. **"Hand-added amounts fit no rule" — withdrawn as a check.** It detects whole-dirham typing, not
   error: the widened test that reconciles 34 of 35 accepts **97.2%** of arbitrary amounts, and the
   observed rate is 97.1%. The note date says the same thing more directly.

### What changed from v1

v1 was written before an Ask the Code token was available, so its entire ingestion request was
`UNVERIFIED` guesswork about column names. Four code interrogations replaced that guesswork.
Six of the changes alter the **logic**, not the wording:

1. **`PAID = true` as a scope filter would have silently dropped most of the population.**
   *(code-verified)* For routine additions the ERP writes **neither** `PAID` nor
   `PAID_ON_PAYROLL_MONTH`; those two are written only for carried-forward *must-be-paid*
   additions. v1's scope sentence — "applied, **paid**, not a refund" — read literally against
   the real column would have audited a minority of notes and reported the month clean.
   §1 and §3 M0 now define the paid month in two branches.
2. **The flight-home cap exists.** v1 said it was nowhere in the company. It is
   `PARAMETERS.VALUE` on `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` (default `2000`)
   and `PARAMETER_HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT` (default `1350`). Group A
   goes from unbuildable to testable (§3 M6 group A).
3. **The internal auditor's clearance flag is a blinding risk, and now has a named guard.**
   The ERP's over-limit detection only looks at notes where `CONFIRMED_AMOUNT_BY_AUDITOR = false`.
   Once confirmed, the case leaves the ERP's list while the payment stays over the limit.
   G9 forbids this audit from reading either confirmation flag as a filter.
4. **Referral and signing bonus share one addition reason.** Both are `bonus`; only `PURPOSE_ID`
   separates them. v1 routed on the reason id alone, which would have applied the referral rule
   to signing bonuses and vice versa (§3 M2, §2.3 N5).
5. **"Final salary" is not a payment type.** No dedicated addition reason exists; it is computed
   in `PayrollHousemaidFinalSettlementController.calculateProrated`. v1's group D promised a test
   for a category that has no notes in it.
6. **`NOTE_TYPE` has seven values, not three.** `EXTRA_SHIFT, BONUS, SALARY_RAISE, REDUCTION` are
   legacy or office-staff remnants *(code-verified)*, and `MANAGER_ADDITIONS` counts only
   `ADDITION`. Scoping on `ADDITION` is correct — but it is now G10, a guard that fails the run
   if the other four appear, rather than an assumption.

Two things v1 got right and v2 keeps unchanged: the single-verdict rule (§3 M5) and the payslip
tie-out (G1). Both survived the code check intact.

### What changed 2026-09-07

Four business rules arrived from **George Abboud** (Housemaid Payroll) via Hassan Ahmed, and three
facts came out of Snowflake. Six of them change the logic.

1. 🔴 **Airfare is `cc_months >= 22`, CC only — not the code's `% 24 == 22`.** The code rule is true
   one month in twenty-four and never reads contract type; it agrees with the business only at
   months 22, 46 and 70. Building on it would have flagged or withheld judgement on most legitimate
   airfare payments. A2 and A3 are rewritten; the divergence itself is the finding.
2. 🔴 **CC tenure bridges a short MV break.** An MV interval under a year keeps the earlier CC
   service; a year or longer resets the clock. This needs a **contract-type timeline** (N17), which
   `HOUSEMAIDS_INFO_REVISION` is built for and is entirely empty — two working routes named instead.
3. 🔴 **The referral scheme exists**: AED 1,000 per referral event, 1,000/0 for a CC referral and
   500/500 for MV, on the referred maid completing 30 days with the client, and the referred maid
   must not already be with the company — *George's most common rejection reason*. Group C is
   rewritten at the **referral-event** grain. **AED 1,200 is profiled in two tables and is not in
   the scheme.**
4. 🔴 **A signing bonus has no price by construction** — "promised by retractors", negotiated per
   case. v2's inference ("paid on signing or renewing") was wrong. And referral and signing bonus
   are **entangled in free text** (H15), so `PURPOSE_ID` does not separate them.
5. 🔴 **The payment-type list is incomplete.** Accommodation Relocation, Sim card Loan, WPS
   Compliance Loan, PCR Test & medical assistance Loan, Live-out Transportation Assistance, NOL Card
   and Part-Time Cleaners categories are live in the warehouse and absent from the code-recovered
   list — **an outstanding ask confirmed**. Specified as the new **group L**, whose pairing rule
   (`addition = loan`) is **already breaking**: the loan-to-addition ratio profiles from 0 % to
   114.75 %.
6. 🔴 **`EXPENSES_REQUESTS` is not granted to the role.** `SHOW WAREHOUSES` returns zero rows
   and `SHOW GRANTS TO ROLE PAYROLL_AND_MONEY_CONTROL_ROLE` returns 668 grants — 426 view SELECTs,
   zero warehouses. So an outstanding ask is one grant; but a warehouse alone will **not** unblock T4, T5, group G,
   group E or M13, because the expense view is not readable.

Also settled: the payroll **lock window is not in Snowflake by any route** — no `%PAYMENT_RULE%`
object exists, and `LAST_PAYROLL_LOCK_DATE`, `LOCK_DATE` and their `_MODIFIED` twins all profile as
`"no non-null values"`. N7 must come from the ERP.

---

## 1. Business Logic

**The control.** Every month managers add money to housemaids' payslips — roughly 1,300
additions worth about AED 0.5m, some AED 6.3m a year across ~16,000 payments. Each addition is
supposed to be justified by the rule governing that type of payment. Nobody checks. This report
checks, one addition at a time, and names every case where the justification is absent, exceeded,
duplicated, or inapplicable.

**The failure it catches.** Four shapes:

| # | Failure | Plain statement |
| --- | --- | --- |
| F1 | **Over-limit** | More money paid than the rule allowed |
| F2 | **Duplicate** | The same payment made twice |
| F3 | **Not entitled** | Paid against a rule that never applied to that maid |
| F4 | **No basis** | Nothing behind it explaining why it was paid |

**Reader and action.** A Police & Control auditor opens it once a month and works the month's
cases one at a time. A second person reviews before anything is acted on — maker–checker. Red
means money went out above what was allowed, or with nothing behind it. Amber means the check
could not reach a conclusion, and always says why. Green means a rule actually ran and cleared it.

**What the population actually looks like** *(live census, 12 months, 2026-09-08)*. **25 payment
types carry activity: 17,566 notes, AED 7,179,262.** One type dominates by count and a different one
by money — **`anti_attrition_incentive` is 9,167 notes, 52% of the population by count but 25% of the
money; `Airfare Ticket` is AED 2.73m, 38% of the money on 1,654 notes.** A count-ranked tile and a
money-ranked tile therefore name different types at the top, and both are correct. A
reader who does not know this will misread every count-based tile on the dashboard. Its volume is
also growing fast: 409 payments in the first monthly batch of the series, **918 in the twelfth**.

🔴 **Future-dated notes are normal for at least one payment type and must NOT be filtered out.**
An earlier draft of this paragraph called them a feed defect and said to reject them. That was wrong,
and dangerously so: **`Airfare Ticket` — AED 2,733,500, the largest type by money — carries notes
dated up to 2028-06-02**, 21 months ahead, spanning 34 active months inside a 12-month window. Its
note date is almost certainly the *travel* date, not the payment date. A rule rejecting notes dated
after the audit month would delete 38% of the money this report exists to examine — a scope filter
that removes the evidence. Such notes land **AMBER** through M0 branch 3 with the reason *"paid month
cannot be established"*, and resolving the date semantics **per payment type**.

**Grain.** **One row per manager note.** Not per maid, not per month, not per payment type. A maid
who received four additions in a month is four separate cases, judged separately. Edits do not
create rows — *(code-verified)* `PayrollManagerNoteController` updates in place and `OLD_NOTE_ID`
is dead code — so one note is one row for the life of the note. A **refund** does create a second
row, linked by `REFUNDED_NOTE_ID`; the refund row is out of scope and the original stays in.

**Population in scope.**
- `PAYROLLMANAGERNOTES.NOTE_TYPE = 'ADDITION'`, on a housemaid (`HOUSEMAID_ID IS NOT NULL`).
- **Applied**: `APPLIED = true` and `NOT_FINAL = false`.
- **Not a refund**: `IS_REFUND = false` and the addition reason is not `refund`.
- **Paid in the audit month**, defined in two branches because the ERP populates the paid-month
  columns for only some notes — see M0. This is the single most load-bearing definition in the
  spec and v1 had it wrong.
- Both contract types, because contract type decides which payments a maid may receive at all:
  company-contract maids we hired (`HOUSEMAID_TYPE = 'Normal'`) and MaidVisa maids who are our
  employees only on paper (`MAID_VISA`).
- **Negative amounts are in scope.** Money taken back is not an overpayment, but it is not
  nothing either, so it is reported rather than silently dropped, and never netted against a
  positive finding (§3 M5 row 8, §5 Example D).
- **System-generated additions are in scope pending Q3.** `cover_deduction_limit`,
  `cover_negative_salary` and `forgive_deduction` are written by automation, not by a manager.
  They are still money on a payslip. The ERP's own repeated-additions rule excludes the first two
  *(code-verified)*, which is evidence the business treats them as non-discretionary.

**Explicitly out of scope.**

| Excluded | Why |
| --- | --- |
| `DEDUCTION` and `PENALTY_DEDUCTION` notes | The feed stopped recording amounts and then stopped recording rows. A test built on them would report a clean result forever |
| Addition reason `office_work_addition` | A separate check owns office work. *(code-verified: written by `PayrollGroupService`, confirmed by `AssignedOfficeWorkAdditionsConfirmationJob`)* |
| Addition reason `refund`, and any note with `IS_REFUND = true` | Refunds reverse a payment; the payment itself is the case |
| Client-side notes | `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGER_NOTES` — different records, opposite direction |
| Free-text profile notes | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS` — the maid-notes screen, no money attached. The warehouse's own table comment says so |
| Office-staff payroll | `PAYROLL.RAW_DATA.OFFICESTAFF*` is a different population |

**Refresh expectation.** Monthly and **manual**, run after the payroll month is paid.
Deliberately never scheduled: recurring warehouse processes go through the ERP team, and ad hoc
Snowflake is not a governed system of record. This spec is the handoff for anything recurring.

**Relationship to the ERP's own payroll auditor.** Part of this audit already runs inside the
ERP. `HousemaidsExceptions.generateHousemaidExceptions` raises
`HOUSEMAID_FILIPINO_AIRFARE_TICKET`, `HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET` and
`HOUSEMAID_REPETITIVE_ADDED_PAYMENTS`, and an auditor clears them by setting
`CONFIRMED_AMOUNT_BY_AUDITOR` / `CONFIRMED_REPEATED_BY_AUDITOR` to `true`.

**This dashboard is an independent second check.** An internal sign-off is displayed as context
and **never clears a case here** — see G9, which exists because the ERP's own detection filters
on `CONFIRMED_* = false`, so a confirmed-but-still-over-limit payment is invisible to it. That is
precisely the population this report must be able to see.

**Sensitivity class.** This report pairs an internal housemaid id with an amount and a payment
reason. It is **financial data about an identified employee**. No maid name, phone number,
contact detail, passport number, EID, address or **salary** appears in the report, the export or
the mockup — read access to `HOUSEMAIDS_INFO.BASIC_SALARY` does not authorise displaying it. Maids
are identified by internal id only, which is what an auditor needs to work a case. The addition
amount **is** the subject of the audit and is shown. Access statement needed

---

## 2. Data Points Needed

> **Verification note.** Two independent verification paths, and a third that is empty.
> **(a) Snowflake catalog** — the P&C role (`PAYROLL_AND_MONEY_CONTROL_ROLE`) has **no warehouse
> grant**: `SHOW WAREHOUSES` returns 0 rows and `CURRENT_WAREHOUSE` is empty. `SHOW`, `GET_DDL`
> and column-comment reads succeed; every row-level scan fails. Table, column, type,
> `source_expression`, extracted `WHERE` clause and profiled `allowed_values` claims below come
> from that catalog. **(b) ERP source code** — claims about ERP behaviour, native column names,
> enums and business rules are verified via Ask the Code (conversations 45815–45818) and marked
> *(code-verified)*. **(c) Rows** — row counts, freshness, cardinality and population are
> verified **nowhere**. Every such claim is marked `NEEDS COMPUTE`.

### 2.1 Verified — already in Snowflake

| # | Data point | Database.Schema.Table | Column | Notes / verification |
| --- | --- | --- | --- | --- |
| **D1** | **The manager note** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | `ID` `FIXED(38,0)`, `HOUSEMAID_ID` `FIXED(38,0)` | From `mmdb_transformed.payrollmanagernotes`. Model filters `RELATED_TO_TYPE = 'MAID'` and `HOUSEMAID_ID IS NOT NULL`. 🔴 **Grain unproven — see H1** |
| D2 | Note type | same | `NOTE_TYPE` `TEXT` | Catalog profiles **3** values (`DEDUCTION, ADDITION, PENALTY_DEDUCTION`); the ERP enum has **7** *(code-verified)*. See G10 |
| D3 | Amount | same | `AMOUNT` `REAL` | Catalog range `−3032 – 44230.26`. Negatives are real and in scope |
| **D4** | **Payment type** | same | `REASON` `TEXT` | `COALESCE(a.NAME, d.NAME)` from `mmdb.picklists_items` on `ADDITION_REASON_ID` / `DEDUCTION_REASON_ID`. 🔴 **This is the resolved NAME, not the code.** Routing on it is fragile — see N5 |
| D5 | Free-text reason | same | `NOTE_REASON` `TEXT` | ← `p.NOTE_REASONE` (the typo is in the source). Input to the E2 judgement field |
| D6 | Note date | same | `NOTE_DATE` `TIMESTAMP_NTZ` | Catalog min `2016-11-21`. 🔴 **Timezone unstated** Load-bearing: for most notes this *is* the paid-month anchor (M0) |
| D7 | Requester / approver carried from the expense side | same | `REQUESTED_BY`, `APPROVED_BY` `TEXT` | ← `ep.REQUESTED_BY`, `ep.APPROVED_BY`. 🔴 **Arrives through the heuristic join, so it inherits H1's fan-out** |
| — | ~~Note author~~ | same | `MANAGER` `FIXED(38,0)` | ⚠️ **Profiled "no non-null values" — dead.** *(code-verified why: `EMPLOYEE_MANAGER_ID` is not mapped in the current JPA entity.)* The real column is `CREATOR` — N6 |
| **D8** | **Payslip month, and the payslip's own additions total** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | `HOUSEMAID_ID`, `PAYROLL_MONTH` `DATE`, `ADDITIONS` `REAL` | From `mmdb.housemaidpayrolllogs`; `ADDITIONS` ← `MANAGER_ADDITIONS`, which counts **only `NOTE_TYPE='ADDITION'`** *(code-verified)*. **This is the tie-out anchor (G1) and the only expected-population source in the design**. 🔴 `ADDITIONS` profiles **−1,516 to 8,800** — a payslip's manager-additions total **can be negative**, so G1's residual arithmetic and M14's over/under split must both handle it |
| D9 | Payslip payment state | same | `PAID_ON_DATE` `TEXT`, `PAID_ON_DATE_FORMATTED` `DATE`, `IS_TRANSFERRED` `TEXT` | 🔴 `PAID_ON_DATE` is **TEXT** parsed by a 3-format `TRY_TO_DATE` chain — a 4th format yields NULL silently. `IS_TRANSFERRED` is **TEXT** `'YES'/'NO'`; `= TRUE` matches nothing |
| **D10** | **The hold record** *(reframed 2026-09-08 — this is not just drill-down context)* | same | `AUTOMATIC_EXCLUSION_REASONS`, `MANUAL_EXCLUSION_REASON` `TEXT`, `STATUS` `TEXT`, `EXPECTED_RELEASE_DATE` `DATE` | 🔴 **Together with `IS_TRANSFERRED` (D9) this *is* the withholding event** — the evidence group D's `previously_held_salary` needs. `AUTOMATIC_EXCLUSION_REASONS` is enumerated and states **why**: *client's payment not received* · *not on the latest MOL list* · *no Ansari account* · *medical not passed* · *MV contract cancelled with pre-collected salary* — **list truncated in the profile, more exist**. `EXPECTED_RELEASE_DATE` has data only from **2025-10-04**. `STATUS` carries **20** values including `ON_VACATION`, `PENDING_VACATION`, `EMPLOYEMENT_TERMINATED`, `SICK_WITHOUT_CLIENT`, `ASSIGNED_OFFICE_WORK` — relevant to Q7's termination-vs-vacation airfare question |
| **D10b** | **The payslip's own arithmetic** | same | `TOTAL_SALARY` `REAL` (← `TOTAL_EARNINGS`, 0–13,000), `DEDUCTIONS` `REAL` (← `TOTAL_DEDUCTION`, 0–2,800), `NET_SALARY` `REAL` (← `TOTAL_SALARY`, 0–13,200) | 🔴 **What she was actually paid, per month, exactly.** This is half of what group E needs — the other half is the entitled salary (N10). Note the source-column names are **crossed over**: warehouse `TOTAL_SALARY` ← source `TOTAL_EARNINGS`, warehouse `NET_SALARY` ← source `TOTAL_SALARY` |
| **D10c** | **Partial holds at final settlement** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_FINAL_SETTLEMENT_DETAILS_SHEET` | `"Prorated Salary we paid (FS Paid)"`, `"Prorated Salary kept on hold (FS Collected)"` — both `TEXT` | 🔴 **A second, partial hold mechanism.** Where D9/D10 is whole-payslip and binary, this is an explicit paid/retained split on a prorated amount at termination. ⚠️ Both columns are **TEXT**, so they need casting and carry the empty-string-vs-NULL trap; and the view's column names are human labels with spaces, which usually means a sheet-derived source — **confirm it is maintained before building on it (Q13)** |
| **D11** | **Contract type** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | `HOUSEMAID_TYPE` `TEXT` | 🔴 **Four values, not two**: `Normal, MAID_VISA, FREEDOM_OPERATOR, WALKIN`. An `IF MV … ELSE CC` rule silently treats the last two as company-contract — see H5 |
| D12 | Nationality | same | `NATIONALITY` `TEXT`, `NATIONALITY_CATEGORY` `TEXT` | `NATIONALITY_CATEGORY ∈ {Filipina, African, Ethiopian, Other}`. 🔴 **The ERP's airfare rule splits on the raw nationality picklist code `philippines`, not on this category** *(code-verified)* — do not substitute one for the other |
| D13 | Service dates | same | `START_DATE`, `SALARY_STARTING_DATE`, `NET_HIRED_DATE` `TIMESTAMP_NTZ` | `SALARY_STARTING_DATE = COALESCE(REPLACEMENT_SALARY_START_DATE, START_DATE)`. 🔴 **All bottom out at `1970-01-01`** — epoch-zero standing in for unknown (H6). The ERP's airfare service rule counts months from `START_DATE` *(code-verified)* |
| D14 | Termination detail | same | `DATE_OF_TERMINATION` `TIMESTAMP_NTZ`, `MODE_OF_TERMINATION` `TEXT`, `STATUS` `TEXT` | `MODE_OF_TERMINATION ∈ {QUIT, FIRED, NON_RENEWAL, RESIGNATION, CONVERTED_TO_MAIDSAE}` |
| D15 | Hygiene flags | same | `IS_DELETED` `TEXT`, `EXCLUDED_FROM_PAYROLL` `TEXT` | 🔴 **TEXT `'00'`/`'01'`, and nullable.** Filter `(IS_DELETED = '00' OR IS_DELETED IS NULL)` — `= TRUE` matches nothing and reads as "no findings" |
| — | ~~Payroll lock date~~ | same | `LAST_PAYROLL_LOCK_DATE` | ⚠️ **Profiled "no non-null values" — dead.** The lock window that M0 needs must come from the payroll rules table, not from here — N7 |
| **D16** | **Authorising expense record** | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | `ID`, `EXPENSE_TYPE`, `RELATED_TO_TYPE`, `RELATED_TO_ID`, `REQUEST_STATUS`, `AMOUNT`, `CURRENCY_NAME`, `BENEFICIARY_TYPE`, `BENEFICIARY_NAME`, `APPROVED_BY`, `REQUESTED_BY`, `PAYMENT_METHOD`, `EXPENSE_PAYMENT_ID`, `CREATION_DATE` | `REQUEST_STATUS ∈ {PAID, REJECTED, DISMISSED, PENDING_PAYMENT, CANCELED, PENDING}`; `BENEFICIARY_TYPE ∈ {SUPPLIER, MAID, OFFICE_STAFF, TAXI_DRIVER, NOT_DETERMINED}`; `CURRENCY_NAME` spans **10** currencies. 🔴 **Requests whose expense category is `is_secure = 1` are excluded from this view entirely** — H3 |
| D17 | Expense head | same, + `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_HIERARCHY` | `EXPENSE_TYPE` `TEXT` | Name resolved from `mmdb.expenses` by INNER JOIN — which is *how* the secure exclusion happens |
| — | ~~Approval date~~ | same | `STATUS_CHANGE_DATE` | ⚠️ Catalog min **`2025-12-16`** — history truncated. Cannot date an approval for an earlier audit month. Use `CREATION_DATE` (min `2021-10-21`) |
| D18 | Referral evidence | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_BONUSES`, `…HOUSEMAID_REFERRALS` | referral id, referred maid, bonus-requested date, cancelled date | `MAIDS_REFERRALS_BONUSES` is built from the **same** `payrollmanagernotes` source, filtered `NOTE_TYPE='ADDITION' AND pi3.NAME='Referral bonus' AND AMOUNT != 0`. 🔴 It records what was **paid**, never what was **due** — auditing paid against paid proves nothing |
| D19 | Tickets purchased | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS` | `HOUSEMAID_ID`, `TICKET_TYPE`, `BUYER`, `ORIGINAL_FARE`, `FARE_IN_REF_CURRENCY`, `CURRENCY_ID`, `EXCHANGE_RATE`, `PURCHASE_DATE`, `REFUNDED`, `IS_DELETED`, `IS_LATEST_HM_TICKET` | `TICKET_TYPE ∈ {TO_DUBAI, TO_EXIT, TO_MANILA, TERMINATION, PREWORK_VACATION, VACATION, OFFICE_STAFF, OFFICE_TICKET}`; `BUYER ∈ {PRIVATE, MAIDCC}`. `ID` tops at 14,564 — small. `NEEDS COMPUTE`: still written to?. `IS_DELETED` TEXT `'00'/'01'` |
| D20 | Vacations | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_VACATIONS` | vacation start/end, contract | For the airfare repeat cycle |
| D21 | Payment-type reference | `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` | picklist item id, code, name | Resolves `ADDITION_REASON_ID` and `PURPOSE_ID` to codes. `NEEDS COMPUTE` to enumerate — the §3 M2 mapping is code-referenced, not picklist-read |

⚠️ **`BA_VIEWS.HOUSEMAID_MANAGEMENT_GOLD.BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` must not be
used as a source.** It joins `EXPENSES_REQUESTS.RELATED_TO_ID` to a **manager-note id**, while
that column's own documentation makes it a **housemaid id**; the ranges overlap
(`RELATED_TO_ID` 0–2076983, note `ID` 5–183975, `HOUSEMAID_ID` 1–138006), so a wrong reading
matches rows and raises no error. Every column of that view profiles as all-NULL. One of the two
artefacts is wrong today — X1.

### 2.2 Approved KPI definitions reused

| Metric | Source of definition | Reused verbatim? |
| --- | --- | --- |
| — | `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` | **Check not performed.** The container **exists** (`SHOW OBJECTS LIKE '%INSIGHTS%' IN ACCOUNT`) but cannot be read without a warehouse |

This is an **outstanding** check, not a negative result. Until it runs, M1–M10 are labelled **new
Police & Control definitions, not approved KPIs**, and should be added to the Data Catalog once
agreed. If the container holds a definition for any of them, that definition wins verbatim with
all its filters (including flags such as `FAKE = false`) and this spec is amended.

**One existing modelled answer must be reconciled with, not ignored.** The GOLD model named above
is maids.cc's other answer to "what were salary additions this month, by category". Shipping M1
without stating the relationship leaves two official answers to one question. Given X1, the
reconciliation is currently: **that model is not trustworthy and this report supersedes it** —
but that must be said out loud to the Data team, not assumed.

### 2.3 New data ingestion request — NOT yet in Snowflake

**Every column below exists in the ERP and is code-verified.** None of it is a guess, and none of
it needs building — it needs bringing across. **The mechanism is the data team's to choose**
(extend the existing `HOUSEMAID_MANAGER_NOTES` dbt model, add a new model, or land the raw table);
this spec states *what* must be available and *why*, not *how*.

**History needed:** from **2024-01-01**, backfilled, for every item.

#### N1 — Applied state · `PAYROLLMANAGERNOTES.APPLIED` `BOOLEAN`, `NOT_FINAL` `BOOLEAN`
Whether the addition was actually applied to a payslip rather than entered and left. **Blocking**
— it is the first predicate of the population, and everything downstream inherits its error.

#### N2 — Paid state and payslip month · `PAYROLLMANAGERNOTES.PAID` `BOOLEAN`, `PAID_ON_PAYROLL_MONTH` `DATE`, `PAYROLL_MONTH` `DATE`, `PAYROLL_ACCOUNTANT_TODO_ID` `BIGINT`
🔴 **Read the code note before writing any filter on these.** *(code-verified)*

- `PAID_ON_PAYROLL_MONTH` is the payment-month anchor **when populated** — `AsyncService` sets it
  together with `PAID = true` and `PAYROLL_ACCOUNTANT_TODO_ID` when a carried-forward
  *must-be-paid* addition is settled during accountant-todo transfer processing.
- `PAYROLL_MONTH` is written on **one** path only (retroactive MV prorated salary), where it
  equals `PAID_ON_PAYROLL_MONTH`. It is **not** the general "which payslip paid this" field.
- **For most routine additions neither is written.** The note is picked up by `NOTE_DATE` falling
  in the payroll lock window and rolled into that month's `MANAGER_ADDITIONS`.
- `HousemaidPayrollController`'s manual "mark salary as paid" sets `PAID = true` **without**
  setting `PAID_ON_PAYROLL_MONTH`.

**Therefore `PAID = false` does not mean "not paid".** It usually means "not a carried-forward
must-be-paid note". Using `PAID = true` as a scope filter drops the majority of the population and
reports the month clean. M0 defines the correct two-branch rule.

#### N3 — Refund and reversal links · `IS_REFUND` `BOOLEAN`, `REFUNDED_NOTE_ID` `BIGINT`, `ADDITION_PAYROLL_MANAGER_NOTE_DEDUCTION_SOURCE_ID` `BIGINT`
*(code-verified)* `/ManagerNotes/bulkrefund` creates a **new** row and leaves the original
untouched, linking back via `REFUNDED_NOTE_ID`. `OLD_NOTE_ID` exists but is **dead code** — the
only `setOldNote(.)` is in commented-out logic — so a normal edit does **not** leave a
duplicate-looking pair. `ADDITION_PAYROLL_MANAGER_NOTE_DEDUCTION_SOURCE_ID` is read for
`forgive_deduction` display but **not populated by current automation**, so it cannot be relied on.

#### N4 — Expense pointer · `PAYROLLMANAGERNOTES.EXPENSE_ID` `BIGINT`
🔴 *(code-verified)* It is a FK to **`EXPENSES.ID`** — the expense **catalogue/type** row — and
**no FK exists from a note to `EXPENSEREQUESTTODOS` or to `EXPENSEPAYMENTS`.** The ERP copies
fields across rather than storing the relationship. The note→payment link is therefore a
**heuristic by construction**, which is what M4's confidence floor exists for. The column is
already used inside the `HOUSEMAID_MANAGER_NOTES` model's join but never selected — expose it so
the link can be re-checked downstream.

#### N5 — Payment-type ids · `ADDITION_REASON_ID` `BIGINT`, `PURPOSE_ID` `BIGINT` (both FK → `PICKLISTS_ITEMS.ID`)
🔴 **Blocking for correct group routing.** *(code-verified)* **Referral bonus and signing bonus
share the same addition reason `bonus`** and are separated only by `PURPOSE_ID`
(`referral_bonus`, on picklist `HousemaidPurposesForBonusAdditionalDescription`). Routing on the
reason alone applies the referral rule to signing bonuses and vice versa. Routing on the resolved
**name** (D4) is worse still — a rename silently re-routes every note.
⚠️ `HousemaidPurposesForBonusAdditionalDescription` is **not seeded in the repo**, so its full item
list cannot be recovered from code

#### N6 — Note author · `CREATOR` `BIGINT` (FK → `USERS.ID`), `CREATION_DATE` `DATETIME`, `LAST_MODIFIER`, `LAST_MODIFICATION_DATE`
Answers "who made this addition", which is unanswerable today. ⚠️ Two decoys: `EMPLOYEE_MANAGER_ID`
is **unmapped in the JPA entity** (which is why the warehouse's `MANAGER` column is entirely
NULL), and `FROM_MANAGER_ID` is a **picklist item, not a user**.

#### N7 — Payroll lock window · `MONTHLYPAYMENTRULES` (lock date per payroll month)
M0's branch 2 and the ERP's own auditor window both depend on the lock dates bounding a payroll
month. `HOUSEMAIDS_INFO.LAST_PAYROLL_LOCK_DATE` is entirely NULL, so it cannot serve. Exact
column name `UNVERIFIED` — one Ask the Code follow-up closes it.

#### N8 — Airfare limits · `PARAMETERS.CODE` / `PARAMETERS.VALUE`
*(code-verified)* Two rows carry the flight-home cap:

| `PARAMETERS.CODE` | Default `VALUE` | Applies to |
| --- | --- | --- |
| `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` | `"2000"` | `HOUSEMAIDS.NATIONALITY` = picklist code `philippines` |
| `PARAMETER_HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT` | `"1350"` | all other nationalities |
| `PARAMETER_HOUSEMAID_REPETITIVE_ADDITION_LIMIT` | `"3"` | months in the ERP's repeated-additions window |

🔴 **`VALUE` is TEXT and these are the seeded defaults, not necessarily today's values** — read the
row, never the constant. 🔴 **They are not effective-dated**, so a cap changed mid-year
retroactively re-judges settled months. That is a real limitation of the source, and it becomes
G8 rather than being quietly ignored.

#### N9 — Internal auditor state · `CONFIRMED_AMOUNT_BY_AUDITOR` `BOOLEAN`, `CONFIRMED_REPEATED_BY_AUDITOR` `BOOLEAN`, `PAYROLLAUDITHOUSEMAIDEXCEPTIONS`, `AUDITORACTIONS`
*(code-verified)* `PAYROLLAUDITHOUSEMAIDEXCEPTIONS.PAYROLL_AUDIT_EXCEPTION_TYPE ∈
{HOUSEMAID_REPETITIVE_ADDED_PAYMENTS, HOUSEMAID_FILIPINO_AIRFARE_TICKET,
HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET, …}`; `AUDITORACTIONS.SOURCE ∈ {PAYROLL_MANAGER_NOTE,
LOAN, LOAN_REPAYMENT}` with `ACTION_TYPE ∈ {ADDING, EDITING, DELETING}`, `USER_ID`, `AMOUNT`,
`NOTE`, `CREATION_DATE`. **Displayed as context only. G9 forbids any test reading these as a
filter or as evidence.**

#### N10 — Effective-dated salary history
`HOUSEMAIDS_INFO.BASIC_SALARY` / `PRIMARY_SALARY` are **profile-current**; a part-month salary for
a past month cannot be recomputed from a current value. Candidate: the `mmdb` revision tables
(`HOUSEMAIDS_INFO_REVISION` is already referenced by other models). Exact shape `UNVERIFIED`.
**Individual salary values must never be displayed** (§1 sensitivity class).

#### N11 — Referral and signing bonus scheme prices — 🔴 **largely resolved 2026-09-07**
**The referral scheme is now stated** (George Abboud, §3 M6 group C): AED 1,000 per referral event,
split 1,000/0 for a CC referral and 500/500 for MV, on the referred maid completing 30 days with the
client. **A signing bonus has no price by construction** — it is negotiated case by case by a
retractor.

🔴 **And a price source exists that v2 said did not.** `HOUSEMAID_REFERRALS.AMOUNT` is the amount
authorised **on the referral record**; `MAIDS_REFERRALS_BONUSES.BONUS_AMOUNT` is what the note
actually paid. Comparing them is a conformance test needing no scheme document (C6).

⚠️ **Still open.** (a) **AED 1,200** is profiled in both tables and is not in the stated scheme; 250, 1,500 and 2,000 also appear on the payment side, 0 on the referral side, with **no counts
available**. (b) Whether these were always the amounts — an unchanged scheme is assumed, and if it
changed, historical months need the then-current values. (c) `MAIDS_REFERRALS_BONUSES` is **built
from `payrollmanagernotes` itself**, filtered `AMOUNT != 0 AND AMOUNT IS NOT NULL` — it is circular
as a price source and its filter deletes exactly the notes T3 exists to flag. Use it for the paid
amount, never as the authority.

#### N12 — Raffle winners — 🟢 **resolved 2026-09-08; two corrections, one in each direction**

**The complete raffle subsystem exists in the ERP.** *(code-verified, conversation 45932, all
modules.)* It is not in `erp/magnamedia-payroll-management` — it lives in
**`erp/magnamedia-housemaid-management`** (staffmgmt), which is why the earlier payroll-scoped
interrogation (conversation 45929) found nothing and why this file briefly recorded the opposite.
**Both prior claims were wrong:** v2's original "the job plausibly exists" was right by luck and
unverified; the 2026-09-08 correction that said it does not exist was a scoping artefact. Neither
was evidence. This one is.

**How a winner is chosen.** Scheduled job **`RafflePerformerJob`** (job definition
`job_to_start_raffle_draw`) picks up the current month's `RaffleDraw` when its `drawDate`/`drawTime`
arrives and its status is `PENDING`. It builds a pool holding **one entry per ticket point** per
participant — so odds are weighted by tickets — shuffles it, and draws with `Random.nextInt(.)`,
setting `isWinner = true`, `winOn = now` and a prize on the chosen `RaffleDrawParticipant`.
Second-prize winners are drawn first; existing first-prize winners are then removed from the pool
before the first-prize picks. On completion it calls `addPrizesToPayroll` and marks the draw
`FINISHED`.

**What creates the note.** `RafflePerformerJob.addPrizesToPayroll` is the **only** automatic
writer of a `PayrollManagerNote` with `additionReason = raffle_prize`. It sets
`noteType = ADDITION`, `amount = prize.getWorth`, the winning housemaid, and re-assigns the creator
to the ERP system user when the creator is null or `admin`. It also fires the Customer.io event
`raffle_winner_selected`. The two other code references to `raffle_prize` are read-only:
`ChatGPTController.getLastRafflePrize` and
`PayrollHousemaidFinalSettlementController.calculateAdditionsWithoutRaffleAndReferral(.)`, which
**excludes** raffle additions from a final settlement. The generic manual endpoint can still set the
reason by hand — that is the path an audit exists to catch.

**Where the record lives** — package `com.magnamedia.entity.raffledraw`, one table per entity:

| Entity | What it holds | The columns the audit needs |
| --- | --- | --- |
| `RaffleDraw` | the draw | `drawDate`, `drawTime`, `endDate`, `status` (`INITIALING/PENDING/ONGOING/FINISHED/EXPIRED`) |
| `RaffleDrawParticipant` | participants **and** winners — a winner is a participant row with the flag | `draw`, `housemaid`, `points`, **`isWinner`**, **`winOn`**, **`prize`** |
| `RaffleDrawPrizeGrand` | the prizes | `draw`, `name`, **`worth`** (the amount), `isGrand` (first/grand) |
| `RaffleTicketLog` | the ticket ledger feeding participation | `ticketsCount`, `ticketsReason` (`ONE_MONTH_WITH_SAME_CLIENT`, `MAID_RENEWED`, `REPLACEMENT`, `ELIGIBLE_FOR_RAFFLE`) |
| `RaffleDrawLog` | draw event log (live-draw display) | — |

**The prize amounts are parameters, not typed in.** Seeded in `SetupCustomParameters`, read by
`RaffleService.createRaffle` into each `RaffleDrawPrizeGrand.worth`:

| Parameter | Default |
| --- | --- |
| `raffle_first_prize` | **2,000** |
| `raffle_second_prize` | **200** |
| `raffle_first_prize_winners` | 3 |
| `raffle_second_prize_winners` | 45 |

Ticket weights: `raffle_renewal_tickets` 35 · `raffle_with_client_tickets` 5 ·
`raffle_faulty_replacements_tickets` 10 · `raffle_eligible_tickets` 1.

**What this changes for the audit.** `raffle_prize` moves from **UNRULED** to a fully specified
**ROSTER · CEIL · UNIQ** type — see group F below. The amount is knowable exactly
(`participant.prize.worth`), the entitlement is a membership test against a real table, and a
hand-entered raffle note with no winning participant row behind it is a finding, not an unknown.

**🔴 What still blocks it: ingestion, not knowledge.** Verified 2026-09-08 —
`SHOW TERSE OBJECTS LIKE '%RAFFLE%' | '%PRIZE%' | '%DRAW%' IN ACCOUNT` each return **zero rows**.
None of the five tables is in the warehouse. So group F is **BLOCKED on an ingestion, with a named
source** (O3b) rather than on a business owner. That is a materially cheaper ask, and it is the only
thing standing between this payment type and a running check.

#### N13 — The loyalty rule — 🟢 **resolved 2026-09-08; the rule exists and the code has it**
**v2's "no rule exists to test against, anywhere" was wrong, and wrong the same way N12 was.**
*(code-verified, conversation 45934, all modules; corroborated against 9,167 real notes.)* That claim
came from a payroll-module search finding only `HousemaidPayrollPaymentServiceV2.getMustBePaidManagerNotes`
— a payment-routing list. The rule is not in payroll. It is in
**`erp/magnamedia-housemaid-management`**, and it is fully specified.

**Nothing sets `additionReason = anti_attrition_incentive` directly.** The notes are produced by a
two-stage pipeline, which is why a string search in payroll found nothing:

1. **`MaidIncentiveExperimentJob.processIncentiveExperimentNotes`** (job definition
   `maid_incentive_experiment_job`, *"Maid Incentive Experiment Job"*) posts a **SALARY expense
   request** to accounting with `expense.code = "AAI - 01"`, `expenseRequestType = MAID_PAYMENT`.
   A second producer, `AbuDhabiMaidIncentiveExpenseJob` → `MaidIncentiveService.processAbuDhabiIncentives`,
   feeds the same expense code.
2. **`ManagerNoteService.processExpenseRequestTodo`** (payroll, L113–174) then creates the
   `PayrollManagerNote` when the SALARY expense is confirmed, copying the reason from
   `Expense.salaryAdditionType`. **The literal string `anti_attrition_incentive` lives only in the
   accounting Expense config for `AAI - 01`** — DB config, not source. That is the whole reason the
   payroll search came up empty.

**Eligibility** — `MaidManagerActionLogRepository.findHousemaidsWithIncentiveNotes(.)`, batched 50/page:

- `h.housemaidType <> MAID_VISA` — **CC only** (a second confirmed row for N15)
- `h.status NOT IN Housemaid.rejectedStatuses`
- `EXISTS` a `MaidManagerActionLog` with `actionType.code = 'Maid_Incentive_Experiment'`
  **and `incentiveAmount IS NOT NULL`** — this is the **enrolment record**
- per-maid guard: skip if a note for the **same contract** already has `incentiveRequestDate` in the
  current month

**Amount** — there is no tier table. The amount is a **per-maid field set at enrolment**,
`MaidManagerActionLog.incentiveAmount`, validated against parameter
`MAID_INCENTIVE_CONFIGS_PARAM.amount_values`, **default `100,150,200,250,300,350`**. The same
parameter carries `expenseCode = "AAI - 01"` and `requesterId = "2226"`.

**Proration** — `MaidIncentiveExperimentJob` L335–338:

```
daysBetween           = daysBetweenDates(startDate, endDate) + 1
totalMonthDaysTillNow = daysBetweenDates(firstDayOfMonth, currentDate) + 1
amount                = (daysBetween / totalMonthDaysTillNow) * incentiveAmount
```

`startDate = max(tagDate, firstOfMonth)`; `endDate` = untag / contract-change / termination date.
Run on the last day of the month, `totalMonthDaysTillNow` is the length of the month. **Confirmed
against the data: 99.5% of 9,167 real notes fit `incentiveAmount × days ÷ days-in-month` exactly**
(6,116 whole-month, 3,051 prorated).

**How the note is stamped.** `requesterId` from the parameter (default **user 2226**) is stamped on
the expense, becomes `expenseRequestTodo.requestedBy`, and then the note's creator. `PayrollManagerNote`
has **no `approvedBy` column at all**, and SALARY expense additions are auto-confirmed. *Recorded as
mechanism, not as a check — approval is out of this audit's scope. It matters here only because it
explains why these notes carry a service account rather than a person, which a reader would otherwise
misread as a data gap.*

**Two values still cannot be read from code**, because both are DB config, not source: the
`AAI - 01` → `anti_attrition_incentive` mapping (accounting `Expense.salaryAdditionType`) and the
actual monthly schedule (`JobInstance` — the job is registered with a `null` trigger). The data
settles the schedule empirically: **12 batches, roughly monthly, gaps of 28–32 days**. 🔴 **They are
not always the last day of the month** — August's ran on **2026-09-01** — so the run days must be
observed from the data, never inferred from the calendar.

**What this changes.** `anti_attrition_incentive` moves from **UNRULED** to
**ELIG · CORR · RECOMP · CEIL · UNIQ** — see group B. Q4 ("someone must write the loyalty rule")
is **withdrawn**: the rule is written, in code.

#### N13 corrected — 🔴 **the enrolment check is weaker than N13 said, and the audit trail under it is not a timestamp**
*(code-verified 2026-09-08, conversation 46015 — housemaid-management + payroll + accounting.)*
Raised by B1b: 53 notes over twelve months are dated before the earliest enrolment row of the maid
they paid. Three readings were possible. The code separates them, and two are confirmed.

**1. The `EXISTS` runs once, at selection, and is never re-checked.** N13 above says the job "requires
an enrolment record before it pays". It requires one *when it reads its page*. It then only POSTs an
`ExpenseRequestTodo`; the `PayrollManagerNote` is created **two async hops later** — accounting
confirmation, then a `SequentialQueue` background task (`ExpenseRequestTodoBusinessRule` →
`ManagerNoteService.processExpenseRequestTodo`). Neither hop re-reads the enrolment. A maid whose
incentive row is edited, retyped or removed after selection **is still paid**. The only intervening
guard is `incentiveRequestDate` in the current month, which is de-duplication, not re-validation.

**2. `ACTION_DATE` is not an enrolment timestamp.** `MaidManagerActionLog.actionDate` is stamped
`new LocalDate().toDate()` **only in `createEntity`**. `updateEntity` never re-stamps it and only
rejects null — so after any edit it is **whatever the caller sent**. It is a user-editable business
date. The entity carries no `@PreUpdate`, no `@LastModifiedDate`, no soft-delete flag and no visible
`@Audited`; the real timestamps are `creationDate` / `lastModificationDate` on the shared `BaseEntity`,
and **`creationDate` is the field the code itself orders enrolments by**
(`findByHousemaidAndActionTypeOrderByCreationDateDesc`). **Any point-in-time test built on
`ACTION_DATE` is testing a field the sending code never reads.** B1b must be re-run against
`CREATION_DATE` — see `queries/phase1-verification.sql` block **B1b-F**.

**3. Two routes pay under this reason with no enrolment row at all.**
`AbuDhabiMaidIncentiveExpenseJob` calls the same `createMaidIncentiveExpenseRequest`, selecting from
`HousemaidExtraFields` (`abuDhabiIncentiveType`, `abuDhabiIncentiveOffered`) and needing no
`MaidManagerActionLog`; and **any manual `POST /expenseRequestTodo/createExpenseRequestTodoWithCreator`
carrying expense code `AAI - 01`** produces the identical note, with no enrolment check on that path.
Whether the AD job's parameter (`ABU_DHABI_MAID_INCENTIVE_CONFIGS_PARAM`) resolves to `AAI - 01` or to
its own code is DB config and unverified — the census's separate *Abu Dhabi Incentive* type suggests
the latter, but suggestion is not verification. Discriminated in data by **F2** (creator ≠ the
service account ⇒ manual route) and **F3** (Abu Dhabi enrolment present ⇒ never needed a log).

**4. The amount is validated at write time and never at pay time.** `validateIncentiveAmount` runs
only in the `/maidNote` controller against `MAID_INCENTIVE_CONFIGS_PARAM.amount_values`; neither the
job nor `createMaidIncentiveExpenseRequest` re-checks. **If the parameter is missing or blank the
validator falls back to a hard-coded `[100,150,200,250,300,350]`** — a broken configuration passes as
a good one. And `MaidManagerActionLogService.correctIncentiveHistoricalData` re-derives
`incentiveAmount` by **string-matching amounts inside the enrolment's free-text note**
(`extractIncentiveAmountFromNote`) **and saves without re-validating**. A back-fill utility sets the
number driving AED 1.83m a year, from prose.

**Re-tested 2026-09-08 — 🔴 42 survive, AED 9,019.** F1b ran B1b against `CREATION_DATE`, the column
the paying code orders enrolments by. **The right column clears 11 of the 53 and leaves 42**, a strict
subset — the correction removes cases, it invents none. B1b is **RED at 42 notes / AED 9,019**, and
the semantic doubt that hung over the 53 is now closed rather than open, which makes the smaller
number the stronger finding.

F1c settles it independently: of **3,757** incentive enrolment rows, **3,632 (96.7%) carry
`ACTION_DATE = CREATION_DATE`**; 121 are back-dated (median 18 days, max 102) and 4 run ahead. The
column is editable in principle and barely edited in practice, so the 42 were never going to be a
date-editing artefact.

🔴 **`USER_WHO_LAST_MODIFIED` cannot detect an edit.** It is populated on **100% of rows in every
bucket, same-day rows included** — stamped on create, not only on update. **No mutation check may be
built on it**, and the "is the trail mutable" question stays unanswerable from the warehouse.

**B1 — no enrolment row at all — is 11 notes.** Those are the population F2 discriminates: the batch
stamps one configured service account on every note it makes, so a different `REQUESTED_BY` means the
manual `AAI - 01` route, where no enrolment check exists on any path.

**What this changes in the audit.** Three findings stand that never needed the 42: enrolment is not
re-checked at payment, the amount is not re-checked at payment, and the field the audit trail rests on
is user-editable. **Trap 19: a date column is not a timestamp until the code that writes it says so —
and the correction is worth running even when it costs you cases, because 42 with the doubt closed
beats 53 with it open.**

#### N14 — Payment type → allowed expense heads
🟢 **ANSWERED 2026-09-08 — from code and confirmed in data. This is no longer a business ask.**
The mapping *is* the accounting **`Expense.salaryAdditionType`** column: `processExpenseRequestTodo`
copies it verbatim onto the note, so the set of expenses carrying a given `salaryAdditionType` **is**
that payment type's allowed category list. Read the Expense table. Confirmed against 12 months
of free text — each type maps to exactly one category, except taxi which has two:

| Payment type | Allowed expense category | Coverage |
|---|---|---|
| Anti-attrition Incentive | Anti-attrition Incentive | 9,164 / 9,167 |
| Salary Dispute | Salary disputes for housemaids | 1,069 / 1,084 |
| Maids.at other expenses | Maids.at other expenses | 341 / 341 |
| Medical Assistance | Medical Assistance Bill | 88 / 88 |
| Accommodation Relocation | Accommodation Relocation | 62 / 62 |
| Taxi Reimbursement | **Live-out Transportation Assistance** · Taxi Reimbursement | 340 + 155 |

Violations already visible: 1 anti-attrition note under *Live-out Transportation Assistance*, 2 salary
disputes under *Bonuses for Housemaids*, and **77 `bonus` notes under *CC Housemaids Expenses - Abu
Dhabi Incentive*** — the AD incentive on the wrong addition reason.

Which `EXPENSES_REQUESTS.EXPENSE_TYPE` values are legitimate behind each addition reason. Test T5
fires RED (F3) on a mismatch, so **without this list T5 has two silent failure modes**: an empty
list reds every note, a permissive default greens every note. **A payment type absent from the
list makes T5 BLOCKED — never a pass, never a red.** Effective-dated. **Owner to name.**

#### N15 — Contract type → allowed payment types — **first rows confirmed**
Which addition reasons each `HOUSEMAID_TYPE` may receive. Same two silent failure modes as N14, and
the same rule: absent → **BLOCKED**. Note H5 — the mapping must cover all four contract types, not
two. Effective-dated. **Owner to name.**

🔴 **Two rows are now confirmed** (George Abboud, 2026-09-07): `airfare_ticket` is **CC only**, and
Accommodation Relocation is **CC live-out only**. Both are evaluated **as of the note date**, not
against the profile-current type.

🔴 **And the warehouse has already settled H5/.** Several models carry
`IFF(h.HOUSEMAID_TYPE = 'MAID_VISA', 'MV', 'CC')`, with one comment stating *"'CC' (all other types,
including Normal, FREEDOM_OPERATOR, and WALKIN)"*. The rest of the company treats those two as CC.
**Whether a `FREEDOM_OPERATOR` or `WALKIN` month counts as a CC month for airfare tenure is P&C's to
rule (Q10)** — diverging from the house convention is allowed, but must be a written choice.

#### N16 — Payment types that always carry an expense record
The list T4 needs to distinguish "no expense record found, and there should be one" (a finding)
from "no expense record expected" (not a finding). Absent → T4 **BLOCKED**. **Owner to name.**

> N14–N16 are business rules, not warehouse data. They do not exist in either system today and
> were the unstated assumption underneath v1's T5, T7 and T4. Until they exist, those three tests
> return BLOCKED and their notes are amber — which is the correct reading of the current state,
> not a gap in the build.

#### N17 — Contract-type timeline per maid 🔴 **new, blocking for group A**
A2/A3 need every CC and MV interval with start and end dates, not a single `START_DATE`.
**The purpose-built columns exist and are empty:** `HOUSEMAIDS_INFO_REVISION` carries
`OLD_HOUSEMAID_TYPE`, `HOUSEMAID_TYPE` and `SWITCH_HOUSEMAID_TYPE_DATE` — all six profile as
`"no non-null values"`.
**Two working routes exist.** The VISA models derive `FIRST_HOUSEMAID_TYPE` from
`mmdb.housemaids_revisions` (*"earliest non-null revision, ORDER BY REVISION ASC"*) and those columns
**are** populated; and `BI_HOUSEMAID_STATUS_LOGS` / `BI_HISTORICAL_STATUS_LOGS` build type from a
`to_type` column in a `StatusLogsWithHousemaidType` CTE — a transition log, which is the segment
timeline A2 walks. Ask the data team for one of those, not for "history" in general.

#### N18 — Loans 🔴 **new, blocking for group L**
Group L needs the loan booked alongside an addition. **No raw or silver loans table is in the
warehouse** — only three gold views, all granted:
`BI_PAYROLL_MAID_SALARY_ADDITIONS_AS_LOAN_IMPACT_BY_CATEGORY` (aggregated addition vs loan by
category, from 2026-01), `BI_PAYROLL_LOAN_DEDUCTIONS_VS_POSSIBLE_DEDUCTIONS`, `BI_MEDICAL_LOANS`.
Row-level addition↔loan pairing needs a loan source that is not yet ingested.
⚠️ Loan **repayment** cannot be verified at all: repayments run through deductions, and `DEDUCTION`
notes are out of scope because that feed stopped recording. L1 therefore proves the loan was
*created*, never that it was *recovered*.

#### N19 — Live-in / live-out flag 🔴 **new, blocking for L1 and L3**
`HOUSEMAID_TYPE` (`Normal, MAID_VISA, FREEDOM_OPERATOR, WALKIN`) does **not** carry live-out. The
gold layer derives a three-way `CC Live In / CC Live Out / MV` from a separate `live_out` flag
(`WHEN h2.live_out = 1 THEN 'CC Live Out' WHEN h2.live_out = 0 THEN 'CC Live In'`). Expose
`live_out`, effective-dated like N17 — L1's first condition is untestable without it.

#### N20 — The referrer↔referred link
`HOUSEMAID_REFERRALS.REFERRED_MAID_ID` is
`COALESCE(h.REFERRED_MAID_ID, <latest housemaid by phone>, <latest by WhatsApp>)` — a contact-match
fallback, so the pairing C2 depends on is partly heuristic. Publish the share of rows carrying the
direct id, per period, and apply M4's confidence-floor treatment to C2.
⚠️ **Sensitivity.** `HOUSEMAID_REFERRALS` carries the referred maid's **name and phone number**, and
`CREATOR` / `LAST_MODIFIER` are staff **full names, not ids**. None may reach the report, the export
or a mockup — the same rule §1 applies to `HOUSEMAIDS_INFO`.

#### Join keys

| From | To | Key | Types | Risk |
| --- | --- | --- | --- | --- |
| D1 | D11–D15 | `HOUSEMAID_MANAGER_NOTES.HOUSEMAID_ID = HOUSEMAIDS_INFO.ID` | `FIXED(38,0)` both ✓ | clean |
| D1 | D8 | `HOUSEMAID_ID` + M0's paid month → `HOUSEMAID_PAYROLL_HISTORY.HOUSEMAID_ID` + `PAYROLL_MONTH` | `FIXED(38,0)`, `DATE` | **many notes to one payslip row** — never join before the note-level tests finish, or the grain fans |
| D1 | D16 | **heuristic — no key exists** (N4) | — | M4's confidence floor |
| D1 | D21 | `ADDITION_REASON_ID` / `PURPOSE_ID` → `PICKLISTS_INFO.ID` | `BIGINT` → `FIXED(38,0)` | needs N5; do not route on the name |
| D1 | D19 | `HOUSEMAID_ID` + window | `FIXED(38,0)` | for the airfare duplicate test |
| N8 | — | `PARAMETERS.CODE` literal | `TEXT` **value** | cast before comparing to a `REAL` amount |

#### Known data hygiene issues

| # | Issue | Consequence if ignored |
| --- | --- | --- |
| **H1** | **The note view may emit more rows than there are notes.** `HOUSEMAID_MANAGER_NOTES` LEFT JOINs `expensepayments` on `HOUSEMAID_ID + EXPENSE_ID` with no visible dedup, and `EXPENSE_ID` is a **catalogue** id *(code-verified, N4)* — one maid with two payments in one category matches both | The grain of the entire report is wrong, and so is every count and total. **G2 asserts `COUNT(*) = COUNT(DISTINCT ID)` and blocks publication.** Multi-match notes route to amber, never to the first match |
| **H2** | **`PAID = true` is not "was paid"** (N2) | Drops most of the population; the month reports clean. The defect this spec exists to prevent, in the population definition itself |
| **H3** | **`EXPENSES_REQUESTS` excludes secure expense categories entirely** (`is_secure = 1`) | A note backed by a secure category is indistinguishable from one backed by nothing. Must be amber, never red "no basis", never green — and it is undetectable from the view, which is why M4 has a confidence floor rather than a per-row test |
| **H4** | **TEXT flags that look boolean**: `HOUSEMAIDS_INFO.IS_DELETED`, `EXCLUDED_FROM_PAYROLL` (`'00'/'01'`, nullable); `HOUSEMAID_PAYROLL_HISTORY.IS_TRANSFERRED` (`'YES'/'NO'`); `HOUSEMAIDS_TICKETS.IS_DELETED` | `= TRUE` matches nothing and raises no error. Zero rows reads exactly like "no findings" |
| **H5** | `HOUSEMAID_TYPE` has **four** values (D11) | An `IF MV … ELSE CC` eligibility rule treats `FREEDOM_OPERATOR` and `WALKIN` as company-contract and clears them against the wrong rule |
| **H6** | `START_DATE` / `SALARY_STARTING_DATE` bottom out at **`1970-01-01`**; `LAST_PAYROLL_LOCK_DATE`, `EID` and `MANAGER` are entirely NULL | Epoch-zero is "unknown" wearing a date. The ERP's airfare service test (`months >= 6`, cycle `% 24 == 22`) computes a confident wrong answer on it |
| **H7** | **Multi-currency.** `EXPENSES_REQUESTS.CURRENCY_NAME` spans 10 currencies; `HOUSEMAIDS_TICKETS` carries its own `CURRENCY_ID` and `EXCHANGE_RATE` | Comparing an AED note against a PHP request without FX is wrong, not approximately right |
| **H8** | `EXPENSES_REQUESTS.AMOUNT` reaches **2.2 × 10¹¹**; `STATUS_CHANGE_DATE` history starts **2025-12-16** | One outlier dominates the "amount at risk" headline; truncated status history cannot date an approval for an earlier month |
| **H9** | `BENEFICIARY_NAME` and `RELATED_TO_NAME` return **`''`, not NULL**, when nothing matched | `IS NULL` misses them; they read as present-and-blank |
| **H10** | `PAID_ON_DATE` is TEXT parsed by a 3-format `TRY_TO_DATE` chain (D9) | A 4th format yields NULL silently — the note drops out of its month rather than erroring |
| **H11** | **`PARAMETERS.VALUE` is TEXT and not effective-dated** (N8) | A string/number comparison matches nothing; a cap changed mid-year retroactively re-judges settled months |
| **H12** | **Timezone unstated** on `NOTE_DATE` and the payslip dates (`TIMESTAMP_NTZ`) | A note near midnight on the 1st or 31st crosses a month boundary |
| **H13** | **Referral and signing bonus share reason `bonus`** (N5) | Each is judged by the other's rule |
| **H14** | The ERP's own auditor filters on `CONFIRMED_* = false` (N9) | Inheriting that filter blinds this report to exactly the payments a human waved through — G9 |
| **H15** | 🔴 **Referral and signing bonus are entangled in free text.** `MAIDS_REFERRALS_BONUSES` classifies an MV referral by exact-matching the note reason *"Signing bonus for this MV maid because she was referred by an MV maid"* | `PURPOSE_ID` alone does **not** separate the two (contra N5). One wording change silently reclassifies the population, with no error |
| **H16** | `HOUSEMAID_REFERRALS.HOUSEMAID_TYPE` profiles as `"CC, MV, "` — an **empty-string** third value, on the column that decides which referral price applies | The H9 sentinel trap on a verdict-bearing column: `IS NULL` misses it and it reads as present-and-blank |

---

## 3. Metric Calculations

All amounts in **AED**, 2 dp, rounded at row level and summed after — never rounded on a total.
⚠️ **The note's currency is an assumption.** `HOUSEMAID_MANAGER_NOTES` has no currency column
(D1–D7), so every note `AMOUNT` is taken as AED. Confirm Every metric below is a **new
Police & Control definition pending the §2.2 check**, not an approved KPI.

### M0 — Audit month (the paid-month rule)

- **Business definition.** The month whose payslip actually paid this note. Not the month it was
  created in, and not the payroll month it was raised against.
- **Formula.** Two branches, because the ERP populates the paid-month columns for only some notes
  *(code-verified, N2)*:
  - **Branch 1 — recorded.** `PAID_ON_PAYROLL_MONTH IS NOT NULL` → `AUDIT_MONTH = PAID_ON_PAYROLL_MONTH`.
    Authoritative. `PAYROLL_ACCOUNTANT_TODO_ID` is carried into the drill-down as the evidence.
  - **Branch 2 — derived.** Otherwise `AUDIT_MONTH` = the payroll month whose **lock window**
    (N7) contains `NOTE_DATE`, **and** the note must reconcile into that month's
    `HOUSEMAID_PAYROLL_HISTORY.ADDITIONS` (G1).
  - **Branch 3 — neither.** No lock window covers `NOTE_DATE`, or the maid has no payslip row for
    that month → the note is **in the population** with `M5 = AMBER`, reason *"paid month cannot
    be established"*. It is never dropped.
- 🔴 **`PAID = true` is not a scope filter and must not appear in one.** It means "carried-forward
  must-be-paid note", not "was paid" (N2, H2). Filtering on it drops the majority of the
  population and reports the month clean.
- **`AUDIT_MONTH` is a payroll month, expressed as its first day (`DATE`)** — the same domain as
  `HOUSEMAID_PAYROLL_HISTORY.PAYROLL_MONTH`, so G1 joins on equal keys. `PAID_ON_DATE_FORMATTED`
  is a calendar settlement date and is **displayed, never used to window**.
- **Timezone.** `NOTE_DATE` is `TIMESTAMP_NTZ` with no stated zone (H12). Truncate once, centrally,
  in the zone an outstanding ask settles, and list every note within 3 hours of a lock-window edge as a data defect.
- 🔴 **`NOTE_DATE` carries a time, so cast before any date equality.**
  `NOTE_DATE = LAST_DAY(NOTE_DATE)` compares `08:15:00` against midnight and is **false for every
  row** — it returns a well-formed, plausible, entirely meaningless result, which is the dangerous
  shape. Always `NOTE_DATE::DATE`. *(Verified: a batch/manual split built this way classified 3,728
  of 3,728 notes into one side.)*
- 🔴 **A job's run days are observed, never assumed.** The anti-attrition batch ran on
  **2026-09-01**, not 2026-08-31 — 918 notes, the largest batch in the series. Any rule that
  identifies machine-created notes by "the last calendar day of the month" misfiles all of them.
  Derive batch days from the data (`GROUP BY NOTE_DATE::DATE HAVING COUNT(*) > n`, threshold set per
  payment type), which independently reproduced the known hand-added population **to the note**.

### M1 — Cases in scope

- **Business definition.** The manager-note additions this audit judges.
- **Formula.** `COUNT(DISTINCT note_id)` where all of:
  `NOTE_TYPE = 'ADDITION'` (D2) · `HOUSEMAID_ID IS NOT NULL` (D1) · `APPLIED = true` **and**
  `NOT_FINAL = false` (N1) · `IS_REFUND = false` **and** addition reason ≠ `refund` (N3) ·
  addition reason ≠ `office_work_addition` · `M0.AUDIT_MONTH` = the selected audit month.
- 🔴 **No profile predicate appears here.** v1 filtered `IS_DELETED <> '01'`, which silently
  deleted exactly the notes T1 exists to flag: a missing profile row and a NULL flag both make
  `<> '01'` UNKNOWN, so the note vanished from every count, every money total, every amber reason
  and every tie-out — while TO-1 still balanced on the survivors. **The note→profile join is a
  LEFT JOIN. Profile state is a test outcome (T1 → amber), never a population filter.**
- **Nulls.** A note with a NULL `AMOUNT` is in scope; T3 catches it (see M3 T3).
- **Inputs.** D1, D2, N1, N2, N3, M0.

### M2 — Money in scope

- **Formula.** `M2 = SUM(D3.AMOUNT)` over M1's population.
- **Subtotals, both displayed, never netted into one another.**
  `M2.positive = SUM(AMOUNT) WHERE AMOUNT > 0` · `M2.negative = SUM(AMOUNT) WHERE AMOUNT < 0`.
  `M2 = M2.positive + M2.negative`.
- **Why.** A month of clawbacks must not net away a month of overpayments.
- **Nulls.** Excluded from the sum and counted in `M2.null_count`, displayed beside M2 so the two
  cannot silently diverge.

### M3 — The test battery

🔴 **Every applicable test is evaluated and recorded. There is no early exit.** v1 said "the first
test that fires decides the outcome", which contradicts the verdict algebra: a test that cannot
run does not fire, so under an early exit the note falls through to the group rule and can reach
GREEN with an applicable test silently unrun. **The ladder below is display precedence for the
*reason*, not control flow for the *verdict*.**

Each test returns exactly one of **`RED(failure_type)` · `GREEN` · `BLOCKED(reason)` · `N_A`**,
and all outcomes are written to `TEST_TRACE`.

| Test | Question | RED when | BLOCKED when | N_A when |
| --- | --- | --- | --- | --- |
| **T1** | Is the maid's profile readable? | never | no `HOUSEMAIDS_INFO` row · `IS_DELETED = '01'` · `HOUSEMAID_TYPE ∉ {Normal, MAID_VISA}` (H5) · a needed date is epoch-zero (H6) | never |
| **T2** | Is a payment type recorded? | `ADDITION_REASON_ID IS NULL` → **F4** | `ADDITION_REASON_ID` set but resolves to no picklist row | never |
| **T3** | Is the amount usable? | never | `AMOUNT IS NULL` → *"amount not recorded"* · `AMOUNT = 0` → *"zero-amount addition"* · `AMOUNT < 0` → *"negative addition — money taken back"* | `AMOUNT > 0` |
| **T4** | Authorised expense record, and does the amount agree? | matched, authorised, currencies equal, and `\|note − request\|` > tolerance → **F1** · matched but not authorised (see below) → **F4** · unmatched, reason ∈ N16, and that reason's M13 ≥ floor → **F4** | unmatched and M13 < floor · unmatched and reason ∉ N16 or N16 absent · multiple candidates (H1) · currencies differ and no FX (H7) · the N4 link unresolved | reason ∉ N16 and N16 present |
| **T5** | Expense head consistent with payment type? | matched and head ∉ N14 list for that reason → **F3** | N14 absent, or the reason is not in it · T4 did not match | T4 returned N_A |
| **T6** | Duplicate? | a duplicate group exists → **F2** on every member | the entitlement window for the reason is unknown · the window extends outside loaded history | never |
| **T7** | May this contract type receive this payment? | reason ∉ N15 list for `HOUSEMAID_TYPE` → **F3** | N15 absent, or the reason/type pair is not in it · T1 blocked | never |
| **G** | The one group rule for this payment type (M6) | per rule | per rule; **always** when no group is mapped | never |

**T4's authorisation predicate** *(this was absent in v1 and is the difference between "an expense
record exists" and "a live authorisation exists")*: a matched request counts as authorised only when
`REQUEST_STATUS = 'PAID'` **and** `REFUNDED = FALSE`. `PENDING_PAYMENT` → **BLOCKED**
(*"authorisation not yet settled"*). `REJECTED`, `DISMISSED`, `CANCELED`, `PENDING` → **RED (F4)**,
*"matched to an expense request that authorises nothing"*. Without this, a note matched to a
cancelled request with an equal amount passes T4 and reaches green.

**T4's tolerance.** Compare at 2 dp with **AED 0.01** for float artefacts only (`AMOUNT` is `REAL`).
It is not a materiality threshold — Q2 sets the materiality band if P&C wants one.

**Blocking-reason precedence.** A note can be blocked by several tests at once. The **one**
`BLOCKING_REASON` displayed is the first blocked test in ladder order T1→T7→G; every blocked test
is in `TEST_TRACE` and shown in the drill-down. Without this rule the reason buckets are
assignment-order dependent and two builds of one spec produce different charts from identical data.

### M3b — Two obligations on every test 🔴 *new in v3*

Both were learned by getting them wrong on live data, and both apply to checks already written above.

**(1) A window-based test must publish its chance rate.** Any test of the form *"is there a related
record within N days"* has a hit rate that owes nothing to the business. If the window spans W days
and "close enough" covers C of them, one record lands inside by geometry alone with `p = C/W`, and a
subject with *k* related records does so at `1 − (1 − p)^k`.

Worked, from the complaint-corroboration layer: a 105-day window with a 30-day band gives
**p = 0.286**; at k ≈ 1.7 chance alone produces **40.2%**. The observed rate was **40.3% — 1.00×
chance, zero signal** — and on a dashboard it would have read "40% of payments corroborated". The
same test on a different payment type returned **2.33× chance**, which is a real result. The
difference is invisible without the baseline.

Three rules follow:
- **State the chance rate beside the observed rate**, computed **per subject** from that subject's
  own *k*, never from a cohort average. Cohort *k* is a Jensen trap: `AVG(1−(1−p)^k) ≠ 1−(1−p)^AVG(k)`,
  and estimating rather than measuring it produced errors of 1.46× vs 2.33× — enough to misrank two
  payment types against each other.
- **Carry a null cohort where one exists.** A population selected by a mechanism unrelated to the
  thing tested — a random draw, a lottery, a scheduled batch — is a free control group. The raffle
  winners served as exactly this.
- **Check the shape, not just the count.** Bin related records by signed distance, normalised per
  day. A causal driver spikes in the nearest bin and decays. **Flat** means the window is talking to
  itself; **a peak in a bin that is not the nearest** means one cycle is beating against another.

**(2) A control-failure metric must publish its trend, not a point count.** M7–M11 are monthly
counts, and a monthly count cannot distinguish three different situations that need three different
owners:

| Shape | Live example | What it needs |
|---|---|---|
| A control that **broke** and is still broken | `Bonus` attribution: 2.2% → 85.4% → **48.2%** | an owner, this week |
| A **backlog** being worked off | Salary Dispute: 4,211 all-time → **12** in 12 months | a remediation scope, once |
| A control that **holds** | Taxi Reimbursement: **0% across 36 months** | nothing — and it is the proof the others are fixable |

**Every control-failure metric publishes a 24-month monthly series beside its current value.** One
sparkline per finding class. Without it the dashboard reports a mostly-closed historical problem and
a live one as the same number, and the auditor cannot tell which month's work is theirs.

### M4 — The note→expense match, and the confidence floor

- **Business definition.** Which expense request, if any, authorised this note.
- 🔴 **There is no key.** *(code-verified, N4)* `PAYROLLMANAGERNOTES.EXPENSE_ID` points at the
  expense **catalogue** row, and no FK exists to `EXPENSEREQUESTTODOS` or `EXPENSEPAYMENTS`. The
  ERP copies fields across. **The match is a heuristic and the report says so on its face.**
- **The heuristic, stated in full.** Candidate requests are `EXPENSES_REQUESTS` rows where
  `RELATED_TO_TYPE = 'MAID'` **and** `RELATED_TO_ID = HOUSEMAID_MANAGER_NOTES.HOUSEMAID_ID`
  **and** the request's `EXPENSE_TYPE` resolves from the note's `EXPENSE_ID` (N4) **and**
  `CREATION_DATE` falls within the note's entitlement window.
  - Exactly one candidate → matched.
  - More than one → **BLOCKED**, *"multiple candidate expense records"*. **Never take the first**:
    with two payments in one category, first-match manufactures either a clearance or a finding
    depending on sort order (§4 Example F).
  - Zero → unmatched; T4 decides red or blocked by N16 and the floor.
- ⚠️ **This heuristic is not implementable until N4/R5 lands** — `EXPENSE_ID` is used inside the
  view's own join but never selected, so it is unavailable downstream. Until then **T4 returns
  BLOCKED for every note**, groups E and G are amber, and coverage is lower than §8 states. The
  alternative bridge visible in the warehouse (`related_to_id_text = to_varchar(note.id)`) is
  **frozen by X1** and must not be used.
- **M13** publishes the match rate; §M4's floor consumes it.

### M5 — Verdict

**The construction.** Let `A` = the applicable tests for this note (those returning anything but
`N_A`).

```
RED    ⟸  any test in A returned RED                      (one is enough)
AMBER  ⟸  not RED, and any test in A returned BLOCKED
GREEN  ⟺  every test in A ran and returned GREEN
```

A finding is evidence; a clearance is only the absence of one. One red outweighs any number of
greens; one blocked outweighs any number of greens. **There is no fourth state** — v1's
`REPORTED` for negative and zero amounts was a fourth value that belonged to no metric, so those
notes were amber on screen and countable nowhere. Negatives and zeros are **AMBER**, carrying
their own blocking reasons (M3 T3), and their amounts sit in `M2.negative`.

Evaluated for display in this order; first match names the verdict, but **every** test outcome is
already recorded:

| # | Condition | Verdict label | Colour | Finding? |
| --- | --- | --- | --- | --- |
| 1 | any test RED with `F4` and T2 fired | **NO PAYMENT TYPE RECORDED** | 🔴 Red | **Yes** |
| 2 | any test RED with `F4` and T4 fired | **NO BASIS** / **AUTHORISATION NOT LIVE** | 🔴 Red | **Yes** |
| 3 | any test RED with `F1` | **OVER LIMIT** by `\|note − authorised\|` | 🔴 Red | **Yes** |
| 4 | any test RED with `F2` | **DUPLICATE** | 🔴 Red | **Yes** |
| 5 | any test RED with `F3` | **NOT ENTITLED** | 🔴 Red | **Yes** |
| 6 | T3 blocked, `AMOUNT < 0` | **NEGATIVE — REPORTED** | 🟠 Amber | No |
| 7 | T3 blocked, `AMOUNT = 0` or NULL | **AMOUNT NOT USABLE** | 🟠 Amber | No |
| 8 | T1 blocked | **PROFILE UNREADABLE** | 🟠 Amber | No |
| 9 | group rule blocked, no rule exists | **NO RULE EXISTS** | 🟠 Amber | No |
| 10 | any other applicable test blocked | **UNVERIFIABLE** + its reason | 🟠 Amber | No |
| 11 | every applicable test ran and returned GREEN | **CLEARED** | 🟢 Green | No |

**One column, computed once.** The build produces one note-level table carrying exactly one
`AUDIT_VERDICT ∈ {RED, AMBER, GREEN}`, one `VERDICT_LABEL`, one `FAILURE_TYPE ∈ {F1,F2,F3,F4}` or
null, one `BLOCKING_REASON` or null, `DUPLICATE_GROUP_ID`, `IS_RISK_REPRESENTATIVE`, and
`TEST_TRACE`. **Every tile, chart, filter, row colour and export column aggregates that table and
nothing re-derives eligibility.** If a number and a pill can disagree, the build is wrong by
construction.

### The check archetypes — the shape M6 is actually built in

🔴 **Added 2026-09-07.** M6 below organises payments by **business family**, which is how payroll
thinks about them and the right way to talk to payroll. It is the wrong way to build. Group A and
group G share no business meaning but do the same thing — *find a corroborating record and compare a
number to it*. Groups D and K share nothing either, but both *recompute an amount from a rate and a
period*. Meanwhile group C alone needs four different mechanisms.

**Classified by mechanism, twelve bespoke group rules collapse into nine reusable functions plus a
configuration table.** A new payment type then becomes a row in that table rather than new code —
which matters, because the payment-type list is known to be incomplete and the warehouse's own
category profile is truncated.

Every archetype obeys the same contract as every test in M3: `RED(type)` · `GREEN` ·
`BLOCKED(reason)` · `N_A`.

| Key | Archetype | Asks | Tier | Characteristic silent failure |
| --- | --- | --- | --- | --- |
| **CEIL** | Ceiling | is it more than the rule allows? | row | a TEXT threshold compared to a number matches nothing; a threshold with no effective dating re-judges closed months |
| **ELIG** | Eligibility | did this person qualify at all? | row | reading a **profile-current** attribute to judge a historical payment |
| **CORR** | Corroboration | is there a record authorising this? | row | taking the first of several candidates; accepting a matched record without checking its **status** |
| **RECOMP** | Recomputation | does the arithmetic reproduce the amount? | row | a confident wrong figure from a current rate — worse than none, because it looks like evidence |
| **PAIR** | Pairing | is the counter-entry there, and equal? | row | proving the counterpart was *created* and calling that recovery |
| **ROSTER** | Roster | is this person on the list? | row | defaulting — an empty list reds everything, a permissive default greens everything, both silently |
| **UNIQ** | Uniqueness | has this already been paid? | **set** | scanning one month when the entitlement window is longer |
| **RECON** | Reconciliation | does the set sum to an independently known figure? | **set** | comparing a *filtered* set against an *unfiltered* total, so the tie-out fails definitionally every period |
| **UNRULED** | No rule exists | — | null | being mistaken for a data gap and put in a backlog, where it waits forever |

🔴 **The row/set split is the load-bearing distinction.** UNIQ and RECON cannot be evaluated in a
scalar expression per note — they need the note's siblings, and their verdicts attach to a *group*
(a duplicate group, a referral event, a maid-month). They run in a second pass.

**The check plan per payment type** — this is the configuration; nothing below it knows what a
payment type is:

| Payment type | Plan |
| --- | --- |
| `airfare_ticket` | ELIG · CEIL · UNIQ |
| `bonus` + `referral_bonus` | ELIG · CORR · RECON · UNIQ |
| `bonus` + other | CORR |
| `anti_attrition_incentive` | **ELIG · CORR · RECOMP · CEIL · UNIQ** — *(specified 2026-09-08; was UNRULED)* |
| `prorated_salary`, `mv_prorated_salary`, `mv_extra_salary`, `last_day_cc_switch_adjustment` | RECOMP · ELIG |
| `previously_held_salary` | **PAIR** · ELIG — *(corrected 2026-09-08; needs no salary history)* |
| `salary_dispute` | CORR · UNRULED *(E2 has no field)* |
| `raffle_prize` | **ROSTER · CEIL · UNIQ** — *(specified 2026-09-08; was UNRULED)* |
| the four group-G reasons | CORR · ROSTER |
| `forgive_deduction` | PAIR |
| `cover_deduction_limit`, `cover_negative_salary` | RECOMP |
| Accommodation Relocation | ELIG · PAIR |
| Sim card / WPS Compliance / PCR & medical Loan | PAIR · UNRULED |
| Live-out Transportation Assistance | ELIG · CEIL |
| `recommendation_from_client` | **CEIL · CORR · UNIQ** — 🔴 *fully specified 2026-09-08, no longer UNRULED* |
| `pay_vacation_days` | RECOMP |
| `renewal_bonus`, `low_exchange_rate_compensation`, `AR-1` | UNRULED |
| `office_work_addition`, `refund` | RECON only — named lines in the tie-out |

**Two archetypes run on every note regardless of type**, because they are properties of the
population rather than the payment: the payslip RECON at maid × `AUDIT_MONTH` (G1 → M14), and the
duplicate UNIQ scan (T6 → M12).

**The two passes.**

```
pass 1 — row-level
for note in population:
    plan = CHECK_PLAN[note.payment_type]
    if plan is empty or unmapped:
        trace(BLOCKED("payment type not mapped to a check plan")); continue
    for (archetype, params) in plan:
        trace(archetype.run(note, params)) if archetype.tier == ROW else trace(DEFERRED)

pass 2 — set-level
for g in duplicate_groups(window = per-type entitlement period): UNIQ.resolve(g)
for e in referral_events:                                        RECON.resolve(e, expected = 1000)
for (maid, month) in payslips:                                   RECON.resolve_payslip(maid, month)

verdict — unchanged from M5, and it must stay unchanged
```

🔴 **The safety property.** A payment type with no plan yields an **empty archetype set**, and an
empty set cannot satisfy *"every applicable test ran and returned GREEN"* (M5). So an unmapped type
is **BLOCKED by construction**, not by anyone remembering to handle it. Given that new payment types
will keep appearing, this is the property that keeps them arriving as amber-with-a-reason rather than
as silent greens.

**What the reframing exposes.** Grouped by archetype rather than by payment type, **UNIQ, RECON and
the airfare CEIL are unblocked today** — every input they need is already granted. Duplicate
detection, the payslip tie-out, the referral-event tie-out and the airfare cap are therefore
buildable the day an outstanding ask lands, with no modelling work waiting on anyone. Everything else is blocked on
six archetypes, and **ROSTER + UNRULED together cover fourteen payment types** — neither of which
engineering can unblock. The largest lever on coverage is a decision, not a pipeline.

### M6 — The group rules

**Routing is on `(ADDITION_REASON_ID, PURPOSE_ID)` (N5), never on the resolved name (D4).** A rename
would otherwise silently re-route every note. A reason mapped to no group is **BLOCKED** →
verdict 9, never green.

The addition reasons **recovered from the ERP code** *(code-verified; the picklist itself has still
not been read)*. 🔴 **This list is incomplete by an unknown amount.** As of 2026-09-07 the
warehouse's own `ADDITION_CATEGORY` profile carries live categories absent from it — Accommodation
Relocation, Sim card Loan, WPS Compliance Loan, PCR Test & medical assistance Loan, Live-out
Transportation Assistance, NOL Card, and several Part-Time Cleaners categories — and that profile is
itself truncated. They are specified as **group L** below. Do not cite "24 payment types" as a
count.

| Addition reason `CODE` | Name | Group | Buildable today? |
| --- | --- | --- | --- |
| `airfare_ticket` | Airfare Ticket | **A — Flight home** | **Yes** (N8 lands the cap) |
| `anti_attrition_incentive` | Anti-attrition Incentive | **B — Loyalty** | **Yes — 4 of 6 tests need only the grant; B4/B5 need one column** (N13) |
| `bonus` + purpose `referral_bonus` | Referral bonus | **C — Referral** | Partly — event yes (D18), price no (N11) |
| `bonus` + other/no purpose | Signing bonus | **C — Signing** | Partly — price no (N11) |
| `renewal_bonus` | Renewal Bonus | **H — unmapped** | No |
| `prorated_salary` | Prorated Salary | **D — Part-month** | Partly — needs N10 |
| `mv_prorated_salary` | MV Prorated Salary | **D — Part-month (MV)** | Partly — needs N10 |
| `previously_held_salary` | Previously Held Salary | **D** | Partly — needs N10 |
| `mv_extra_salary` | MV Extra Salary | **D (MV only)** | Partly |
| `last_day_cc_switch_adjustment` | Last-day CC Switch Adjustment | **D** | Partly |
| `salary_dispute` | Salary correction | **E — Correction** | Partly — E1 yes, E2 needs the judgement field |
| `raffle_prize` | Raffle Winner | **F — Raffle** | **Fully specified**; blocked only on ingesting the five raffle tables (N12, O3b) |
| `taxi_reimbursement` | Transportation Fare Reimbursement | **G — Reimbursement** | **Yes**, once N4 lands |
| `medical_assistant` | Medical Assistant | **G** | Yes, once N4 lands |
| `Maids_at_other_expenses` | Maids at Other Expenses | **G** | Yes, once N4 lands |
| `lost_luggage_compensation` | Lost Luggage Compensation | **G** | Yes, once N4 lands |
| `forgive_deduction` | Forgive Deduction | **I — system-generated** | Pending Q3 |
| `cover_deduction_limit` | Cover Deduction Limit | **I — system-generated** | Pending Q3 |
| `cover_negative_salary` | Cover Negative Salary | **I — system-generated** | Pending Q3 |
| `recommendation_from_client` | Google Review | **J — Client recommendation** | No rule found |
| `pay_vacation_days` | Pay Vacation Days | **K — Vacation** | No rule found |
| `low_exchange_rate_compensation` | Low Exchange Rate Compensation | **H — unmapped** | *(code-verified: constant only, no rule class)* |
| `AR-1` | AR-1 | **H — unmapped** | No |
| `office_work_addition` | Office Work Addition | — | **Out of scope** |
| `refund` | Refund | — | **Out of scope** |

**Group A — Flight home.** Four tests, all conjunctive.
- **A1 — cap.** `AMOUNT > limit` → RED (F1), where limit = `PARAMETERS.VALUE` (N8) cast to number:
  `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` when `HOUSEMAIDS.NATIONALITY` = picklist code
  `philippines`, else `PARAMETER_HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT`. 🔴 Use the raw
  nationality code, **not** `NATIONALITY_CATEGORY` (D12) — they are different partitions. 🔴 Strictly
  greater, matching the ERP *(code-verified)*. BLOCKED if the parameter row is missing, or if the
  audit month predates the parameter's current value (H11 — no effective dating).
> 🔴 **Read this before A2 — corrected 2026-09-08 from code + data.** The ERP does **not** implement
> a tenure rule for airfare at all. `AddScheduledAnnualVacationService` creates the note on **visa
> renewal** (the "Upload The e-Residency" step), gated only on 6-months-before-expiry (first renewal),
> 16-months-since-last (later ones) and a 5-month duplicate guard. There is **no `cc_months` test, no
> contract-type gate and no modulo** anywhere in that path.
>
> **The 22-month rule is nonetheless real — humans enforce it by hand.** The notes' own free text
> carries *"postponed, didn't accumulate 22 months under CC"* (19 notes) and *"postponed to complete
> 22 months under CC"* (7 notes): reviewers push the note date forward, exactly as they do for
> referral bonuses. So A2/A3 below are **policy tests with no system counterpart** — which makes them
> the most valuable checks in the audit rather than the least, because a manual control is the only
> thing guarding AED 7.77m. Keep them, and label them as policy, not as a restatement of code.
>
> Also corrected: the amount is an **exact per-nationality value** (`Nationality` tag
> `ScheduledAnnualVacationAmount`, else parameter `default_ticket_allowance_amount`), not a cap. The
> observed tiers are **2,000 / 1,500 / 1,000** — **AED 1,350 does not appear in a single note**.

- 🔴 **A2 — CC tenure.** *(business rule, George Abboud via Hassan Ahmed, 2026-09-07 — replaces
  v2's "months ≥ 6".)* `cc_months >= 22`, where `cc_months` is accumulated **CC** service as of the
  **note date**, walked back over her contract-type timeline (N17): an MV interval **shorter than
  one year bridges** — the CC service before it still counts — and an MV interval of **one year or
  longer resets** the clock to her return to CC. MV months themselves do not count toward the 22
  (Q7). Below 22 → **RED (F3)**. BLOCKED when the timeline is unavailable or a needed date
  is epoch-zero (H6).
- 🔴 **A3 — contract type at the note date.** *(same source — replaces v2's `% 24 == 22` cycle
  test.)* She must have been **CC** when the payment was made; an `airfare_ticket` on a maid who was
  MV then → **RED (F3)**. BLOCKED if her type as of that date cannot be established. **Never read
  the profile-current `HOUSEMAID_TYPE`** — it is as wrong here as a current salary is in group D.
- **A4 — duplicate against a purchased ticket.** Cash in lieu paid **and** a `MAIDCC`-bought ticket
  (D19) for the same journey → RED (F2). BLOCKED if D19 is stale.

🔴 **What the ERP does instead, and why this spec does not copy it.**
`HousemaidsVacationAllowanceController` gates on `months % 24 == 22` *(code-verified)* — true one
month in twenty-four, counted from `START_DATE`, contract type never consulted. That agrees with the
business rule only at months 22, 46 and 70 and disagrees at every other month above 22, so a spec
built on the code would have withheld judgement on — or flagged — the majority of legitimate airfare
payments. **The divergence is itself a finding**: either the ERP is denying eligible maids, or
the controller governs a path that manager notes do not take.

⚠️ **Recurrence is unsettled (Q7).** "Minimum 22 months" is a floor for the *first* ticket and says
nothing about the second. This also sets T6's duplicate window for `airfare_ticket`, currently 24
months on the strength of the code's cycle — if recurrence is not 24-monthly, that window is wrong
too.

⚠️ **Termination vs vacation (Q7).** `HOUSEMAIDS_TICKETS.TICKET_TYPE` separates `VACATION` from
`TERMINATION`, `TO_EXIT` and `TO_MANILA`. If `airfare_ticket` cash covers repatriation as well as
vacation, a maid terminated at 14 months would be wrongly red-flagged by a flat 22-month floor.

**Group B — Loyalty.** 🔴 **Rewritten twice. v2 replaced "no test exists" with six tests; v3
replaces four of those six, because the live data closed them off.** This is the largest payment
type in the audit by count (59% of notes) and the one whose checks were hardest to find. What
follows is what survived contact with 9,167 real payments.

**What was tried and does not work — recorded so it is not re-attempted:**

| Candidate check | Why it is not a check |
|---|---|
| A corroborating complaint on the maid | **N_A.** Observed band-1 rate 40.3% against a chance rate of 40.2% — **1.00×, zero signal.** Four other methods agree the payment is not conversation-driven |
| An enrolment record exists (v2's B1) | Passes **1,000 of 1,001** times. A control that always fires is not evidence the thing it guards is sound |
| `AMOUNT = tier` (v2's B4) | **Cannot be written.** 30%+ of notes are prorated, over **two different divisors — both the job's own** |
| "The amount fits no derivable rule" | **Withdrawn.** Detects whole-dirham typing, not error (see changelog item 8) |

**The tests that do work:**

- **B1 — enrolled.** A `MaidManagerActionLog` exists for this maid with
  `ACTION_TYPE = 'Maid Incentive Experiment'` *(picklist name confirmed live: 3,755 records, 2,982
  maids, since 2024-03-23)*, dated on or before the note. No enrolment → **RED**. **(CORR)**
  ⚠️ **Keep it, but do not present it as assurance.** It fires on 1 note in 1,001. Its value is the
  hard RED when it does fire, not the 99.9% it clears.
- **B1b — 🔴 enrolled *before* the payment.** `enrolled_on <= NOTE_DATE`. An enrolment dated **after**
  the payment it justifies → **RED**. **This is new in v3 and it found a case on its first run**
  (note 184233, maid 97470, 2026-07-17, AED 900). v2's B1 tested only that a record existed *ever*,
  which cleared it. **An `EXISTS` control without a temporal predicate is not a control** — "has a
  justifying record" and "had one at the time" are different tests. **(CORR)**
- **B2 — contract type.** `housemaidType <> MAID_VISA` as of the note date. An MV maid → **RED**;
  the job cannot have produced it. **(ELIG)**
- **B3 — active.** Her status is not in `Housemaid.rejectedStatuses` at the note date. **(ELIG)**
- **B4 — the amount recomputes. 🔴 BLOCKED, and the ask is bigger than v2 stated.**
  v2 asked for `INCENTIVE_AMOUNT`. That is **not sufficient**: 30%+ of notes are prorated, so
  the check is `tier × days ÷ divisor`, which needs the **enrolment and exit dates** as well.
  And the divisor is not constant — in 30-day months **890 notes divide by the calendar month and
  250 by a fixed 31**, both created by the job. Until the dates land *and* the divisor rule is
  confirmed from the code, B4 returns **BLOCKED**, never GREEN. **(RECOMP)**
- **B5 — enrolment amount is allowed.** `incentiveAmount ∈ MAID_INCENTIVE_CONFIGS_PARAM.amount_values`.
  🔴 Read the parameter live, never the code default. **Live tiers run to AED 900**, not the 500 a
  small sample suggests, and a ceiling list built from a sample would flag legitimate payments.
  **(CEIL)**
- **B6 — once per contract per month.** The job's own guard. More than one note per
  (contract, month) → **REVIEW**, not RED, until `CONTRACT_ID` lands: without it a double-pay and a
  legitimate two-contract month are indistinguishable. **Rank the review list by a second signal** —
  a maid paid twice in one month where one payment is **off-batch** is a far stronger candidate than
  either signal alone (one such case observed). **(UNIQ, set-level)**
- **B7 — 🔴 the justification, and the only one that exists.** *This is group B's real rule.*
  ⚠️ **&ldquo;AI Agent&rdquo; throughout this spec means an automated LLM step, never a maids.cc
  agent.** Where a person is meant, this document says *auditor*, *reviewer* or *manager*. An
  AI Agent reads `HOUSEMAID_MANAGERACTIONLOGS.NOTES` — the required free-text box on the enrolment
  record — and returns: does it state a retention reason, and in which category (client conflict /
  salary / homesick / family / workload / competing offer / **none stated**)? **RED** where no
  reason is stated. **Because no categorised field exists anywhere in the ERP, the AI Agent creates the
  categorisation, and that is itself a deliverable the business does not have today.**

  **Evidenced viable, and this was not the likely outcome** *(live, 12 months, 2,806 records)*:
  **100% filled · 2,693 distinct values (96%) · 1% on the commonest value · median 43 chars · 20%
  at 60+ chars · 43 records under 10 chars.* A required free-text field usually degenerates into
  boilerplate; this one has not.

  ⚠️ **Calibrate the claim.** 43 characters is one short sentence. The AI Agent can *categorise a
  stated reason*; it cannot *verify* one. B7 reports what the enrolling manager wrote, not whether
  it was true, and the spec must not let a dashboard imply otherwise. The 43 sub-10-character
  records are a junk tail to exclude, not to interpret.

**Phase 1 (needs only the warehouse grant):** B1, **B1b**, B2, B3, B6, **B7**.
**Blocked on ingestion:** B4 (enrolment + exit dates *and* the divisor rule), B5 (`INCENTIVE_AMOUNT`).
Do not report group B as blocked wholesale — **six of its eight tests are Phase 1 work, and the one
that carries the type's real justification (B7) is among them.**

🔴 **A governance finding that no test produces.** Of the 156 hand-added anti-attrition payments in
twelve months, a **single approver signs off 34 of the 35** that reached the sample queue. Whatever
the batch does automatically, the entire manual path for the largest payment type funnels through
one person's approval — on a type whose justification is a free-text box. That is for the group rules, not for a
verdict column.

**Group C — Referral / signing.** 🔴 **Scheme supplied 2026-09-07 (George Abboud via Hassan
Ahmed); v2's "price BLOCKED" is superseded.**

**Referral bonus** (`bonus` + purpose `referral_bonus`). 🔴 **The grain is the referral *event*,
not the note** — one referral produces up to two notes and they are judged together, the same
machinery as a duplicate group.

- **C1 — event total.** `SUM(AMOUNT) over all bonus notes for one referral event = 1,000`.
- **C2 — split.** Referred maid **CC** → `(referrer 1,000, referred 0)`. Referred maid **MV** →
  `(500, 500)`, or `(1,000, 0)` to the referrer as a stated exception (Q8). 🔴 The amount is set by
  the **referred** maid's type, not the referrer's.
- **C3 — the 30-day condition.** The referred maid must have completed **30 days with the client**
  before the bonus is paid. Paid earlier → **RED (F3)**.
- **C4 — the referred maid must not already be with the company.** *(George: **the most common
  reason a bonus is rejected**.)* A prior company record → **RED (F3)**. Q9 settles "never been with
  us" against "not currently with us".
- **C5 — not cancelled.** `HOUSEMAID_REFERRALS.IS_CANCELLED = 1` with the bonus paid anyway →
  **RED (F4)**.
- **C6 — paid against authorised.** `MAIDS_REFERRALS_BONUSES.BONUS_AMOUNT` (paid) vs
  `HOUSEMAID_REFERRALS.AMOUNT` (authorised on the referral record). Disagreement → **RED (F1)**.
  🔴 This is the price source v2 said did not exist.
- 🔴 **AED 1,200 is unexplained and must not be judged.** It is profiled in **both** tables; the
  payment side also shows 250, 1,500 and 2,000, and the referral side shows 0. Until the scheme owner answers,
  an amount outside `{500, 1000}` is **BLOCKED**, never RED. Counts are unknown — `allowed_values`
  carries distinct values only.
- ⚠️ **No referral record exists before 2025-02-20**, while bonus payments run from 2022-04-21.
  C3–C6 are **BLOCKED** for that earlier period — never "no referral found → F4", which would
  red-flag three years of payments for a data-availability reason.
- ⚠️ **The referrer↔referred link is itself partly a heuristic** — `REFERRED_MAID_ID` is
  `COALESCE(h.REFERRED_MAID_ID, <latest by phone>, <latest by WhatsApp>)` — so C2 carries M4's
  confidence-floor treatment (N20).

**Signing bonus** (`bonus`, other or no purpose). *(George: "promised by retractors".)* A retention
payment negotiated case by case when someone talks a maid out of leaving — **no price by
construction**, so the amount is not a blocked test, it is unbounded.
- **C7.** A retraction record must exist behind it and an authoriser must be named; without a
  retraction → **RED (F4)**. The amount is **never** judged against the referral scheme.
- 🔴 **The two are entangled in the data (H15).** `MAIDS_REFERRALS_BONUSES` classifies an MV
  referral by exact-matching the free-text note reason *"Signing bonus for this MV maid because she
  was referred by an MV maid"* — so `PURPOSE_ID` alone does **not** separate referral from signing
  bonus, contrary to N5's assumption.

**Group D — Part-month.** D1 recompute from dates and the salary **in force then** (**BLOCKED**,
N10) · D2 termination mode consistent (D14) · D3 window matches employment dates.

🔴 **`previously_held_salary` is not a recomputation — it is a pairing, and it is checkable now.**
*(Corrected 2026-09-08.)* The question it answers is *"was this money actually held?"*, and the
warehouse carries the withholding event (D9/D10) and the amount (D10b/D10c). It needs no salary
history at all.

```
candidates for a previously_held_salary note =
  (a) earlier payslip rows for that maid with IS_TRANSFERRED = 'NO' (D9)
      AND STATUS = 'ON_VACATION' (D10)               → held amount = that month's NET_SALARY (D10b)
  (b) a final-settlement row carrying
      "Prorated Salary kept on hold (FS Collected)"  → held amount = that value, cast (D10c)

exactly 1 candidate and released == held   → GREEN
exactly 1 candidate and released <> held   → RED (F1), by the difference
no candidate anywhere                      → RED (F4) — money released that was never held
more than 1                                → BLOCKED, "multiple candidate hold records"
```

🔴 **What the code says this reason meant** *(code-verified 2026-09-08, conversation 45927).*
The historical automatic writer summed `HousemaidPayrollLog.totalSalary` where
`transferred = false` **and** `housemaidUnpaidStatus = ON_VACATION`, per housemaid, and wrote the
rounded total to the note. So branch (a) is **specifically the on-vacation hold**, not any exclusion
reason — `housemaidUnpaidStatus` is the source of the warehouse's `STATUS` column, and `ON_VACATION`
is one of its 20 values. The guards also required **`HousemaidType.MAID_VISA`** and that she was no
longer on vacation.

🔴 **And every automatic writer is now switched off.** `_ProratedSalariesTransaction.calculate`,
`ProRatedSalariesService.processProRatedSalaries` and the `AsyncService` reconciliation block are all
**commented out**; `HousemaidPayrollInitializer.preparePreviouslyHeldSalaries` is
`@Deprecated //not used anymore`; `PayrollGenerationHelperService.getPreviouslyHeldSalariesByHousemaid`
is commented out *"due to PAY-2759"*. **Every `previously_held_salary` note created today is typed in
by hand, with the amount typed in rather than derived.** A payment that used to be computed from a
stored held amount and is now free-entry is exactly what this audit exists to check — and it raises
Q16: is the MAID_VISA-only guard still the intent, now that nothing enforces it?

One live consumer still reads these notes and is worth borrowing from:
`PayrollExceptionsReportService.getMaidsWereOnVacation(.)` already joins the note amount as
`heldSalary` against `HousemaidPayrollLog.totalSalary`. **That is this check, already written, on the
ERP side.**

⚠️ **Two mechanisms, two shapes.** (a) is whole-payslip and binary — `IS_TRANSFERRED` is
`IFF(TRANSFERRED=1,'YES','NO')` with no partial-transfer amount anywhere on the table, so at that
level a hold is all-or-nothing. (b) is explicitly partial. A rule written for only one of them
mis-reads the other.
⚠️ **Nothing links the release to a specific held month**, so this carries M4's confidence-floor
treatment like every other keyless match in the design.
⚠️ **Two further ways money is withheld** that are *not* holds and may also be what a release
reverses: `DEDUCTIONS` (D10b, 0–2,800) reduces the net without a hold, and `ADDITIONS` can be
negative (D8). Whether `previously_held_salary` ever reverses either is **Q15**.

> 🟢 **Amended 2026-09-08 from a worked case (note 174632).** `salary_dispute` is UNRULED *in the
> system* — but not always in the note. Reviewers frequently write the full itemised calculation into
> the free text, carrying their own rates and day counts (e.g. AED 3,200/month with a client, AED
> 1,200/month available, prorated over 31). Note 174632's text re-adds to AED 4,554.84 **exactly**.
> So group E gains a subset test: **E3 — where the note shows its working, recompute it and confirm
> the total.** An AI Agent parsing the itemised text can do this; where the working is absent the note
> stays BLOCKED, which makes *"the reviewer did not show their work"* a reportable category.
>
> **E4 — cross-type consistency.** A day excluded from a salary-dispute calculation as *"forgiven"*
> must appear as a `forgive_deduction` note for that maid on that date. Present in one but not the
> other is a double payment or an under-payment. Runnable today.
**Group E — Salary correction.** 🔴 **Conjunctive, not disjunctive.** E1 the expense record proves
the amount **AND** E2 the stated reason (D5) justifies the payment. v1 wrote "E1 **or** E2", which
the verdict algebra cannot express and which let a matched correction go green while the test that
actually asks whether it was *justified* never ran. If E2 is deferred for v1, **E2 returns BLOCKED
and group E is amber** — the honest result.

**Group F — Raffle.** Specified 2026-09-08 from the ERP subsystem (N12). Four tests, at the grain
of one note per winning participant row:

- **F1 — she won.** A `RaffleDrawParticipant` row exists for this housemaid with `isWinner = true`,
  on a `RaffleDraw` whose `status = 'FINISHED'` and whose `winOn` falls in the note's payroll month.
  No such row → **RED**: a raffle payment to somebody who did not win.
- **F2 — the amount is the prize.** `AMOUNT = participant.prize.worth`. This is a **CEIL** with an
  exact value, not a range — the amount is written by the job from a parameter, so any divergence is
  either a hand-entered note or a changed parameter. Divergence → **RED**, by the difference.
- **F3 — paid once.** Exactly one `raffle_prize` note per winning participant row. More than one →
  **RED** (**UNIQ**, set-level).
- **F4 — not double-counted at exit.** A `raffle_prize` note must not appear in a final settlement's
  additions; the ERP excludes it deliberately
  (`calculateAdditionsWithoutRaffleAndReferral`). Present → **RED**.

**All four are BLOCKED today on ingestion only** (O3b) — the rule is known and the source is named.
Do not confuse this with the genuinely unruled types: nothing here needs a business owner.

**Group G — Reimbursement.** G1 amount agrees with the expense record · G2 beneficiary is that maid
(`BENEFICIARY_TYPE = 'MAID'` and the id matches) · G3 an approver is recorded, written as
`NULLIF(TRIM(APPROVED_BY),'') IS NOT NULL` — 🔴 the expense view returns `''`, not NULL (H9), so
`IS NOT NULL` alone clears a reimbursement that nobody approved.

🔴 **Group L — Loan-paired advances.** *(New 2026-09-07.)* **These payment types are absent from
the 24 recovered from code is no longer theoretical.** They were found in
`BI_PAYROLL_MAID_SALARY_ADDITIONS_AS_LOAN_IMPACT_BY_CATEGORY.ADDITION_CATEGORY`, whose profiled
value list is itself **truncated**, so more exist.

- **L1 — Accommodation Relocation.** *(George.)* The maid must be **CC live-out** (N19), and the
  amount must be booked as an **addition and a matching loan at the same time**:
  `addition_amount = loan_amount`. An addition with **no loan** is money given away that should have
  been recoverable → **RED (F4)**. Amounts unequal → **RED (F1)**. Not CC live-out → **RED (F3)**.
- **L2 — Sim card Loan · WPS Compliance Loan · PCR Test & medical assistance Loan.** Same
  addition-equals-loan pairing; no eligibility rule recovered, so that half is **BLOCKED**.
- 🔴 **L3 — Live-out Transportation Assistance is not an ERP addition reason — 🔴 **but it IS a real expense category, corrected again 2026-09-08.** It is booked under the `taxi_reimbursement` addition reason and accounts for **340 notes / AED 70,450 in 12 months — 69% of all taxi reimbursement money**. The 8 September claim that it 'does not exist' was the raffle error repeated: searched as an addition reason, missed one level down as an expense category.**
  *(code-verified 2026-09-08, conversation 45930.)* There is no such picklist item, no parameter and
  no constant. The only "live-out transportation" concept in the ERP is
  `TAG_LIVE_OUT_TRANSPORTATION_CHECK_IN`, a complaint/check-in tag raised after a mediator visit,
  which pays nothing. Transportation money to a maid is a hand-entered `taxi_reimbursement` note.
  (`EXPAT_TRANSPORTATION_PERCENTAGE` is office-staff salary structure, and
  `TRANSPORTATION_ALLOWANCE_LOAN` is a loan type — neither is this.)

  🔴 **This forces a correction to the whole of group L.** `ADDITION_CATEGORY` in
  `BI_PAYROLL_MAID_SALARY_ADDITIONS_AS_LOAN_IMPACT_BY_CATEGORY` is a **warehouse-side grouping, not
  the ERP's addition-reason list** — at least one of its values maps to no ERP reason at all. Before
  treating the other unlisted categories (Sim card Loan, WPS Compliance Loan, PCR & medical Loan,
  NOL Card) as payment types, **each must be traced back to the reason or reasons it actually
  groups**. Some may be genuine missing reasons; some may be labels over reasons the list already
  has. **an outstanding ask — reading the picklist — is what settles this**, and it is now the single most important
  open item in the group rules.
- **L4 — Part-Time Cleaners Expenses** (NOL Card, Accommodation Relocation, Other Purpose Cash
  Advance). A **different population** from housemaids — scope decision **Q11** before any test runs.

🔴 **This rule is already being broken, visible before a single row is read.** That view profiles
`ADDITION_LOAN_AMOUNT` from **0** and `LOAN_PERCENTAGE_OF_ADDITIONS` up to **114.75** — loans both
missing and exceeding their additions. Three limits on the view: it is **aggregated** (month × maid
type × payment method × category), so it scopes and ties out but cannot produce case rows;
`SUBJECT_MONTH` starts **2026-01-01**; and its `MAID_TYPE` is only CC/MV with **no live-out split**,
so it cannot test L1's first condition. It is a sibling of the view carrying the X1 join defect —
verify it does not inherit it before trusting its totals.

🔴 **Group J — Google review (`recommendation_from_client`) is now fully specified.**
*(code-verified 2026-09-08, conversation 45928 — v2 had this as "no rule found".)*
- **J1 — amount.** `AMOUNT = PARAMETERS['GOOGLE_REVIEW_GIFT_VALUE']`, **default 50**, read live and
  never typed in: the note-creation hook parses the parameter into `amount`. Same TEXT-cast and
  no-effective-dating cautions as N8's airfare caps. A deviation is **RED (F1)**.
- **J2 — the review exists.** A `ClientGoogleReview` row must exist for that client × housemaid with
  the screenshot uploaded. The note is created on that record's after-update hook **only when**
  `(spouseScreenShotUploaded && !spouseManagerNoteAdded)` or
  `(clientScreenShotUploaded && !clientManagerNoteAdded)`. No row, or no screenshot → **RED (F4)**.
- **J3 — not duplicated.** The `managerNoteAdded` / `spouseManagerNoteAdded` flags are the ERP's own
  duplicate guard. Two notes against one review → **RED (F2)**.
- ⚠️ **`ClientGoogleReview` is in Client Management and is not yet in this spec's data points** —
  it needs a warehouse view before J2 and J3 can run. That is a new ingestion ask (**N21**), and it
  is small.
- ⚠️ **Interaction with G9.** The payment gate is auditor approval within the payroll window, and a
  **rejected note is deleted**. So surviving notes were approved — which means this population is
  pre-filtered by exactly the flag G9 forbids us from reading. We do not read it; we simply cannot
  see what was deleted. State that limit on the face of the report.

**Groups H–K.** No rule found in code or business. BLOCKED → amber, reason named.

**Group I — system-generated.** `forgive_deduction`, `cover_deduction_limit`,
`cover_negative_salary` are written by automation, not by a manager, and the ERP's own
repeated-additions rule excludes the latter two *(code-verified)*. Whether a discretionary-payment
audit should judge them is **Q3**. Until answered: in scope, BLOCKED, amber.


#### 🔴 Tiering — added 2026-09-08, and it is a scope decision, not an optimisation

**Not every payment type earns a bespoke rule.** The live census found 25 types in use over 12
months; thirteen of them carry **99.7% of the money**. The rest are three to eighty notes a year.

| Tier | Types | Treatment |
|---|---|---|
| **1 — full battery** | `anti_attrition_incentive`, `airfare_ticket`, `bonus` (both halves), `salary_dispute`, `forgive_deduction`, `mv_prorated_salary`, `prorated_salary`, `raffle_prize`, `taxi_reimbursement`, `Maids_at_other_expenses`, `last_day_cc_switch_adjustment`, `medical_assistant`, `Accommodation Relocation` | Its own group rule, plus the cross-cutting tests |
| **2 — baseline + review** | everything else, **and every type that appears in future** | The cross-cutting tests only (T1–T7 / S1). **No group rule, no reference list, no ingestion ask.** |

**A tier-2 note is never counted as cleared.** If the cross-cutting tests all pass it does **not**
join M9. It lands on a `RARE_TYPE_REVIEW` list carrying the reason *"no rule exists for this payment
type — human review"*, and its money sits in M8, not M9. This is check #1 applied to a scope
decision: **a payment type nobody wrote a rule for has not been cleared by anything**, and letting it
green because the generic tests passed is exactly the clearance defect wearing a different hat.

**Why this is worth stating rather than just doing.** Writing bespoke logic for a type with three
notes a year costs more than it can ever catch, and each such rule brings a reference list somebody
has to maintain forever. Tier 2 also means the audit **degrades safely**: `Abu Dhabi Incentive`
appeared on 2026-08-31 and needs no code change to be handled — it is picked up, checked generically,
and put in front of a person.

**Promotion is a data question, not a judgement.** Re-run the type census each quarter; any tier-2
type that crosses ~1% of notes or ~1% of money moves to tier 1. `Last Day CC Switch Adjustment` is
the live example — 213 notes in three months, from nothing.

### M7 — Findings (red)

`M7.count = COUNT(*) WHERE AUDIT_VERDICT='RED'` · `M7.amount = SUM(AMOUNT)` likewise.
Broken out by `FAILURE_TYPE` — the one chart on the page.

### M8 — Unverifiable (amber)

`M8.count`, `M8.amount` over `AUDIT_VERDICT='AMBER'`. **Always displayed with the
`BLOCKING_REASON` breakdown** — an amber count without its reasons is not a result.

### M9 — Cleared (green)

`M9.count`, `M9.amount` over `AUDIT_VERDICT='GREEN'`. Guaranteed by A3: a green note's
`TEST_TRACE` contains no `BLOCKED` and no unrun applicable test.

### M10 — Coverage

- `M10.cases = (M7.count + M9.count) / M1` — display `—` when `M1 = 0`.
- `M10.money = (M7.amount_positive + M9.amount_positive) / M2.positive` — **the denominator is the
  positive subtotal, named explicitly**, so a month of clawbacks cannot flatter the ratio.
- **M10 leads the KPI strip, ahead of the finding count**, so no reader mistakes "few findings"
  for "few problems".

### M11 — Amount at risk

- Quantifiable excess on red cases only: F1 → `\|note − authorised\|` · F2 → the representative
  row's amount (M12) · F3, F4 → the full note amount.
- **Every red case is quantifiable** whenever `AMOUNT` is present, and a NULL amount is amber
  (M3 T3), so `M11.unquantifiable_count` is **0 by construction**. If the build produces a
  non-zero value it is a defect and the report says so.
- **Outlier guard (H8).** Any single contribution above a stated threshold is listed separately,
  never absorbed into the headline.

### M12 — Duplicate groups

- `DUPLICATE_GROUP_ID` groups notes for the same maid, same `(ADDITION_REASON_ID, PURPOSE_ID)`,
  same amount, inside the same entitlement window. **Groups, not pairs** — three mutually
  duplicate notes are one group of three, not three pairs.
- Every member is a RED (F2) case. Exactly one member carries `IS_RISK_REPRESENTATIVE = true` —
  **the latest by `NOTE_DATE`** — and **M11 sums only representative rows**, so a group of three
  contributes its amount once.
- `M12 = COUNT(DISTINCT DUPLICATE_GROUP_ID)`.
- 🔴 **The scan population is not the audit month.** It is every note for that maid across the
  **longest entitlement window of any payment type** (for `airfare_ticket` that is the 24-month
  cycle). Scanning one month at a time makes two identical additions astride a month boundary
  invisible and greens both. A window extending outside loaded history returns **BLOCKED**.

### M13 — Expense-record match rate

`matched notes / notes whose reason is in N16`, **per payment type per month**. It is the health
of the heuristic several tests depend on, so it is on the face of the report, and it drives M4's
floor mechanically rather than by anyone's judgement. **The KPI tile shows the aggregate plus
"n payment types below floor"; every row's message uses that row's own payment-type rate.**
Starting floor **80 %** — Q1.

### M14 — Completeness exceptions

`M14.count`, `M14.amount` — the maid-months where the scoped notes do not reconcile to the
payslip's own additions total (G1). These are **findings in their own right**, reported as their
own metric with their own tile, because they are the only thing in the design that can see a
record that does not exist. They are **not** folded into M1/M2/M7, and the spec says so rather
than leaving them, as v1's mockup did, visible as a warning and countable nowhere.

### Tie-out rules and run guards

**G1 — Payslip tie-out (the completeness backbone).** For every maid × `AUDIT_MONTH`:

```
SUM(AMOUNT) over ALL that payslip's ADDITION notes, unfiltered
    ==  HOUSEMAID_PAYROLL_HISTORY.ADDITIONS
```

🔴 **Both sides unfiltered.** v1 compared the *scoped* population against the payslip's *total*,
so every maid-month containing a refund showed a residual that was definitional rather than a
finding — and a tie-out that fails structurally every month is noise an operator learns to ignore.
The scope exclusions are then reconciled as **named, quantified lines** beneath it
(*"of which refunds: n, AED x"*, *"of which office-work: n, AED x"*), never left as residual.
Whatever remains is M14.

**G2 — Note grain.** `COUNT(*) = COUNT(DISTINCT ID)` on `HOUSEMAID_MANAGER_NOTES` (H1).
**Blocks publication.** This — not A1 — is the assertion that catches a fanned-out view: if one
note becomes two rows, both get verdicts and A1's identity still holds perfectly on the inflated
population.

**G3 — Verdict completeness.** `M7.count + M8.count + M9.count = M1`, and
`M7.amount + M8.amount + M9.amount = M2`. **Blocks publication.**

**G4 — Amber integrity.** `M8.count = COUNT(notes with a non-null BLOCKING_REASON)`, **and** the
reason buckets sum to `M8` in both count and money. 🔴 This replaces v1's A2
(*"displayed as blocked = counted as amber"*), which was a **tautology**: under one shared verdict
column the displayed count is a re-read of the same column, so it could not fail — including in
the failure mode it was written to catch.

**G5 — No green skipped a test.** For every `AUDIT_VERDICT='GREEN'`, `TEST_TRACE` contains no
`BLOCKED` and no unrun applicable test. **Blocks publication.**

**G6 — Verdict vocabulary.** Every verdict word rendered anywhere on the page maps to one of
`RED / AMBER / GREEN`. Catches a fourth state re-entering by the back door, as `REPORTED` did.

**G7 — Reference lists present.** N14, N15 and N16 are loaded and cover every payment type seen
this month. A gap does not fail the run; it forces those tests to BLOCKED and is displayed.

**G8 — Parameter freshness.** N8's parameter rows were read this run, cast cleanly from TEXT, and
their values are displayed on the provenance line. Because they are not effective-dated (H11), a
value that changed since the audit month is raised as an exception rather than applied silently.

**G9 — Auditor independence.** No query in the build filters on `CONFIRMED_AMOUNT_BY_AUDITOR` or
`CONFIRMED_REPEATED_BY_AUDITOR`, and no test reads either as evidence. 🔴 The ERP's own detection
filters on `CONFIRMED_* = false` *(code-verified)*, so inheriting that filter blinds this report to
exactly the payments a human already waved through — the population it exists to see. **Blocks
publication.**

**G10 — Note-type integrity.** `COUNT(*) WHERE NOTE_TYPE IN ('EXTRA_SHIFT','BONUS','SALARY_RAISE','REDUCTION')`
in the audit window is **0**. *(code-verified: those four are legacy or office-staff remnants and
`MANAGER_ADDITIONS` counts only `ADDITION`.)* A non-zero count means money is moving through a type
this scope excludes — a population defect, raised rather than assumed away.

**G11 — Run snapshot.** Each published run is written to a results table with a run id and an
as-of timestamp. A re-run of a closed month is compared against the prior snapshot and **any
changed verdict becomes its own exception row**. Without this, two runs of one month differ
silently and neither is marked — and `LAST_PAYROLL_LOCK_DATE` is entirely NULL, so the build
cannot otherwise even detect a closed month.

**G12 — Type-trap sweep.** Every TEXT-pretending-boolean filter in the build is written as a
string comparison (H4), and every free-text equality from the expense view is `NULLIF(TRIM(x),'')`
(H9). Verified by review, listed on the integrity panel.

> **Publication rule.** G2, G3, G5, G9 block publication: the report renders the failed guard
> **instead of** the numbers. G1's residual becomes M14 and is displayed. G4, G6–G8, G10–G12 are
> displayed pass/fail on the integrity panel with their numbers.

---

## 4. Finalised UI Report

**Mockup:** https://claude.ai/code/artifact/75d6c4b8-ee4e-431a-aa8a-b19daa19e051

**Layout.** One screen, top to bottom: filters → KPI strip → tie-out and integrity strip → case
table → the one chart → provenance line.

**KPI strip**, in this order deliberately:

1. **Coverage — cases (M10.cases)** and **Coverage — money (M10.money)**.
2. **Cases in scope (M1)** · **money in scope (M2)**, with the positive and negative subtotals
   shown on the tile, never netted into one figure.
3. **Findings (M7)** · **amount at risk (M11)**, with `M11.unquantifiable_count` beside it
   (0 by construction — a non-zero value is a defect and says so).
4. **Unverifiable (M8)** with its top blocking reason inline.
5. **Cleared (M9)** — the third verdict count gets its own tile; it is M10's numerator and
   hiding it hides the denominator of the only honest headline on the page.
6. **Completeness exceptions (M14)** — the payslip residual, as its own count and amount.
7. **Match rate (M13)** — the aggregate **plus "n payment types below floor"**, with the floor
   stated. The aggregate alone is a blanket claim that is wrong if any single type is above it.

Every tile carries its metric id.

**Tie-out and integrity strip.** G1's residual (→ M14), G2, G3, G4, G5, G9 pass/fail with their
numbers, and the remaining guards on the expandable integrity panel. **A failed G2, G3, G5 or G9
renders in place of the KPI strip**, not beside it.

**Case table.** One row per note. **Default sort: amount at risk descending, then paid month
descending.**

| Column | Source | Format |
| --- | --- | --- |
| Verdict | `AUDIT_VERDICT` | pill: colour **and** the word |
| Verdict label | `VERDICT_LABEL` | text (M5 table) |
| Failure type | `FAILURE_TYPE` | `F1`–`F4` with its plain-English label, or `—` |
| Rule breached / blocked because | rule text, or `BLOCKING_REASON` | the rule **in its own words** |
| Note id | D1 `ID` | numeric |
| Maid id | D1 `HOUSEMAID_ID` | numeric — **id only** |
| Contract | D11 `HOUSEMAID_TYPE` | CC / MV / other |
| Payment type | D21 code, D4 name | code shown, name on hover |
| Paid month | M0 `AUDIT_MONTH` | `YYYY-MM`, with `recorded` / `derived` |
| Amount | D3 | `AED #,##0.00`, right-aligned |
| Authorised | D16 `AMOUNT` + `REQUEST_STATUS` | `AED #,##0.00` or `—` |
| Gap | derived | `AED #,##0.00`, signed |
| Approver | D16 `APPROVED_BY` | 🔴 **user id or role reference, not a name** |
| Internal sign-off | N9 | **context only — never clears** |
| Status | auditor workflow | New / Under review / Cleared / Escalated |

**Sensitivity, as drawn.** *(revised — v1's blanket claim was false against its own group D.)*

- Maids appear as an **internal id** only. No name, phone, contact detail, passport, EID or address.
- 🔴 **For `prorated_salary`, `mv_prorated_salary`, `previously_held_salary` and
  `mv_extra_salary`, the note amount *is* a salary figure for that period.** v1 claimed no salary
  appears anywhere while displaying exactly that. Default: those rows show the **gap and a band**,
  with the exact amount revealed only in the reviewed drill-down. **Q5** asks P&C to confirm or
  override.
- 🔴 **Staff names are personal data too.** `APPROVED_BY` and `REQUESTED_BY` are stored as **names,
  not ids** (D16), and this report attaches them to cases framed as money paid above what was
  allowed, then exports them row-level. Display an **id or role reference**; resolve to a name only
  in the reviewed drill-down.
- The provenance line names `HOUSEMAIDS_INFO` **and states that only its non-salary columns are
  read** — the view also holds `BASIC_SALARY` and `PRIMARY_SALARY`, which this report never reads.
- The addition amount is the subject of the audit and is otherwise shown.

**Filters.** Audit month (default: last completed paid month) · verdict · failure type ·
**payment type** · contract type · blocking reason · reviewed/unreviewed. Defaults shown on screen.

**Drill-down.** The full `TEST_TRACE`: every applicable test, whether it ran, and what it returned
— which is what makes an amber verdict actionable and a green verdict auditable. Plus the note's
candidate expense records with their `REQUEST_STATUS`, the parameter values used (N8), the maid's
other notes inside the entitlement window (M12), and the internal auditor state (N9), labelled
*context — does not clear this case*.

**The one chart.** Amber cases by blocking reason, horizontal bars, values direct-labelled. The
buckets are mutually exclusive by the M3 precedence rule and sum to M8 in both count and money
(G4).

**Maker–checker.** The status column is a **write-back**, which turns a dashboard into a small
application. Decide before build — **Q6**. If write-back is out of v1, the column is read-only and
P&C tracks review outside the tool; the spec must say which.

**Provenance line.** Sources and ids, the audit month and how it was derived, the N8 parameter
values read this run, the M13 floor, the run id and as-of timestamp (G11), and the note that
recurring refresh is deliberately absent.

**Export.** Row-level CSV of the case table, under the same sensitivity rules as the screen —
approver ids not names, salary-bearing rows banded.

---

## 5. Worked Examples

Illustrative. Ids and amounts are synthetic and internally consistent; nothing has been read from
the warehouse. The month is **2026-08**: M1 = 1,300 · M2 = 512,400 (positive 519,880, negative
−7,480) · M7 = 41 / 28,900 · M8 = 852 / 469,120 · M9 = 407 / 14,380 · M10.cases = 34.5 % ·
M10.money = 8.3 % · M11 = 21,640 · M12 = 6 · M13 = 71 % (3 types below floor) · M14 = 3 / 1,240.

### Example A — Cleared (Green)

| Input | Value |
| --- | --- |
| Note | 118198, maid 44711, `HOUSEMAID_TYPE = Normal` |
| Payment type | `taxi_reimbursement` — Transportation Fare Reimbursement |
| Amount | AED 380.00 |
| Paid month | 2026-08, **recorded** (`PAID_ON_PAYROLL_MONTH`) |
| Matched request | 151204, `REQUEST_STATUS = PAID`, `REFUNDED = false`, AED 380.00, currency AED |
| Beneficiary | `BENEFICIARY_TYPE = MAID`, id matches |
| Approver | user 4471 (name resolved only in the drill-down) |

**Arithmetic.** T1 green · T2 green · T3 N_A (amount > 0) · T4 matched, authorised, 380.00 − 380.00
= **0.00** within the AED 0.01 tolerance → green · T5 head in N14 → green · T6 no group → green ·
T7 `taxi_reimbursement` allowed for `Normal` → green · Group G: G1 ✓ G2 ✓ G3 `NULLIF(TRIM(APPROVED_BY),'')`
is not null ✓.

Every applicable test **ran** and returned green → **GREEN**. Gap AED 0.00. M11 contribution 0.00.

### Example B — Finding (Red, F1) — and the reason G9 exists

| Input | Value |
| --- | --- |
| Note | 118420, maid 38820, `NATIONALITY` picklist code `philippines` |
| Payment type | `airfare_ticket` |
| Amount | AED 2,400.00 |
| Cap | `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` = `"2000"` → 2000.00 |
| Service | 29 months since `START_DATE` |
| Internal sign-off | `CONFIRMED_AMOUNT_BY_AUDITOR = true` — **already signed off in the ERP** |

**Arithmetic.** Group A test A1: 2,400.00 **>** 2,000.00 → **RED (F1)**, over by **AED 400.00**.
A2: 29 ≥ 6 → green. A3: 29 % 24 = 5, not 22 → the cycle test **blocks**, reason *"outside the
entitlement cycle"* — but one red already decides the verdict.

**Verdict RED.** M11 contribution **AED 400.00** (the gap, not the amount).

**Why this example carries the spec.** The ERP's own detection queries notes where
`CONFIRMED_AMOUNT_BY_AUDITOR = false` *(code-verified)*. This note has been confirmed, so it has
**left the ERP's exception list** while remaining AED 400 over the limit. If this report inherited
that filter it would show nothing here. **G9 forbids it**, and the sign-off is rendered in the
drill-down labelled *context — does not clear this case*. This is the whole argument for an
independent second check, in one row.

### Example C — Unverifiable (Amber), and the most valuable row on the page

| Input | Value |
| --- | --- |
| Note | 118655, maid 51002, `HOUSEMAID_TYPE = Normal` |
| Payment type | `anti_attrition_incentive` — the loyalty payment |
| Amount | AED 1,000.00 |

**Arithmetic. 🔴 Rewritten in v3 — this example previously said "no rule to run".** Group B now has
eight tests. T1–T7 green or N_A. B1 green (an enrolment record exists), **B1b green** (it predates
the payment), B2/B3 green, B6 green. **B4 returns `BLOCKED("recompute needs enrolment and exit
dates, and the divisor rule")` and B5 returns `BLOCKED("INCENTIVE_AMOUNT not exposed")`.**

Under M5, one blocked applicable test makes the note **AMBER**, though eleven tests returned green.
**M8 += 1 case, AED 1,000.00. M9 += 0.** It is not a pass — and the amber reason is now a *named,
costed ingestion ask* rather than "nobody wrote a rule".

**What changed and why it matters to the reader.** v2's amber said *the company has no rule for this
payment*. That was true of the **amount**, and it is still true — but it was wrong about the
**justification**, which does exist, in a free-text box on the enrolment record, 100% filled and 96%
distinct. B7 reads it. So the loyalty bucket splits in two: cases blocked on an ingestion ask (B4/B5)
and cases where B7 found **no retention reason stated at all** — and only the second is a finding
about the business rather than about the warehouse.

⚠️ **This example is a single note; do not read the group from it.** Group B covers **9,167 notes a
year, 59% of the population by count and AED 1.83m** — see §1.

### Example D — Negative addition (Amber, reported)

| Input | Value |
| --- | --- |
| Note | 118290, maid 47120 |
| Payment type | `salary_dispute` |
| Amount | **−AED 450.00** |

T3 blocks with *"negative addition — money taken back"* → **AMBER**, label **NEGATIVE — REPORTED**.

It contributes **−450.00 to `M2.negative`**, **0 to M11**, and one case to M8's negative bucket
(22 cases, −AED 7,480). It is never netted against a positive finding, and it is never a fourth
verdict: v1's `REPORTED` state belonged to no metric, so these notes rendered amber on screen and
counted nowhere — G6 now forbids that.

### Example E — The confidence floor, and why it is per payment type

| Input | Value |
| --- | --- |
| Note | 118501, maid 40155, `HOUSEMAID_TYPE = MAID_VISA` |
| Payment type | `salary_dispute` — salary correction |
| Amount | AED 700.00 |
| Candidate expense records | none |
| M13 for `salary_dispute`, 2026-08 | **62 %** (aggregate across all types: 71 %) |

T4 does **not** return RED "no basis". 62 % is below the 80 % floor, so it returns
`BLOCKED("expense-record match unreliable for this payment type — 62 %")` → **AMBER**.

Had `salary_dispute` matched at 94 %, the identical note would have been **RED (F4)**.

**The row's message uses 62 %, the type's own rate — not the 71 % aggregate.** v1's mockup showed
the aggregate on the row, which is a different number about a different population, and would have
had an auditor arguing a case on a statistic that did not apply to it.

### Example F — Two candidates, and why first-match is forbidden

| Input | Value |
| --- | --- |
| Note | 118377, maid 39004 |
| Payment type | `medical_assistant` |
| Amount | AED 1,150.00 |
| Candidates | request 149210 (AED 1,150.00, `PAID`) **and** request 149655 (AED 640.00, `CANCELED`) |

Two candidate requests share the maid and the expense category. M4 returns
`BLOCKED("multiple candidate expense records")` → **AMBER**.

Taking the first match manufactures the answer: sorted one way it matches 1,150.00 and the note
goes **GREEN**; sorted the other it matches a cancelled 640.00 request and the note goes **RED**.
Same data, opposite conclusions, no error either way.

**The guard that catches the underlying cause is G2, not G3.** If the view's own join fans one note
into two rows, both rows receive verdicts and both are in the population, so G3's identity holds
perfectly on the inflated total. Only `COUNT(*) = COUNT(DISTINCT ID)` sees it.

### August 2026 expectation

1,300 cases · 41 findings (F1 17, F2 12 in 6 duplicate groups, F3 5, F4 7) · AED 21,640 at risk ·
852 unverifiable across 12 blocking reasons · 407 cleared · coverage 34.5 % of cases and 8.3 % of
money · 3 completeness exceptions worth AED 1,240 · G2, G3, G4, G5, G9 pass; G1 leaves the M14
residual; G7 reports N14–N16 absent.
