# Spec — Manager Notes Audit

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Spec version** | v2 |
| **Date** | 2026-09-05 |
| **UI mockup** | https://claude.ai/code/artifact/75d6c4b8-ee4e-431a-aa8a-b19daa19e051 |
| **Delivered on** | MaidsInsights. Snowflake is the warehouse underneath — not interchangeable |
| **Evidence log** | `snowflake-discovery.md` (catalog claims) · Ask the Code conversations 45815–45818 (code claims) |
| **Status** | Draft — blocked on the warehouse grant (O1). 4 requestor decisions open (§7 Q1–Q4) |

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
ERP. `HousemaidsExceptions.generateHousemaidExceptions()` raises
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
amount **is** the subject of the audit and is shown. Access statement needed — O9.

---

## 2. Data Points Needed

> **Verification note.** Two independent verification paths, and a third that is empty.
> **(a) Snowflake catalog** — the P&C role (`PAYROLL_AND_MONEY_CONTROL_ROLE`) has **no warehouse
> grant**: `SHOW WAREHOUSES` returns 0 rows and `CURRENT_WAREHOUSE()` is empty. `SHOW`, `GET_DDL`
> and column-comment reads succeed; every row-level scan fails. Table, column, type,
> `source_expression`, extracted `WHERE` clause and profiled `allowed_values` claims below come
> from that catalog. **(b) ERP source code** — claims about ERP behaviour, native column names,
> enums and business rules are verified via Ask the Code (conversations 45815–45818) and marked
> *(code-verified)*. **(c) Rows** — row counts, freshness, cardinality and population are
> verified **nowhere**. Every such claim is marked `NEEDS COMPUTE` and is O1.

### 2.1 Verified — already in Snowflake

| # | Data point | Database.Schema.Table | Column | Notes / verification |
| --- | --- | --- | --- | --- |
| **D1** | **The manager note** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | `ID` `FIXED(38,0)`, `HOUSEMAID_ID` `FIXED(38,0)` | From `mmdb_transformed.payrollmanagernotes`. Model filters `RELATED_TO_TYPE = 'MAID'` and `HOUSEMAID_ID IS NOT NULL`. 🔴 **Grain unproven — see H1** |
| D2 | Note type | same | `NOTE_TYPE` `TEXT` | Catalog profiles **3** values (`DEDUCTION, ADDITION, PENALTY_DEDUCTION`); the ERP enum has **7** *(code-verified)*. See G10 |
| D3 | Amount | same | `AMOUNT` `REAL` | Catalog range `−3032 – 44230.26`. Negatives are real and in scope |
| **D4** | **Payment type** | same | `REASON` `TEXT` | `COALESCE(a.NAME, d.NAME)` from `mmdb.picklists_items` on `ADDITION_REASON_ID` / `DEDUCTION_REASON_ID`. 🔴 **This is the resolved NAME, not the code.** Routing on it is fragile — see N5 |
| D5 | Free-text reason | same | `NOTE_REASON` `TEXT` | ← `p.NOTE_REASONE` (the typo is in the source). Input to the E2 judgement field |
| D6 | Note date | same | `NOTE_DATE` `TIMESTAMP_NTZ` | Catalog min `2016-11-21`. 🔴 **Timezone unstated — O6.** Load-bearing: for most notes this *is* the paid-month anchor (M0) |
| D7 | Requester / approver carried from the expense side | same | `REQUESTED_BY`, `APPROVED_BY` `TEXT` | ← `ep.REQUESTED_BY`, `ep.APPROVED_BY`. 🔴 **Arrives through the heuristic join, so it inherits H1's fan-out** |
| — | ~~Note author~~ | same | `MANAGER` `FIXED(38,0)` | ⚠️ **Profiled "no non-null values" — dead.** *(code-verified why: `EMPLOYEE_MANAGER_ID` is not mapped in the current JPA entity.)* The real column is `CREATOR` — N6 |
| **D8** | **Payslip month, and the payslip's own additions total** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | `HOUSEMAID_ID`, `PAYROLL_MONTH` `DATE`, `ADDITIONS` `REAL` | From `mmdb.housemaidpayrolllogs`; `ADDITIONS` ← `MANAGER_ADDITIONS`, which counts **only `NOTE_TYPE='ADDITION'`** *(code-verified)*. **This is the tie-out anchor (G1) and the only expected-population source in the design** |
| D9 | Payslip payment state | same | `PAID_ON_DATE` `TEXT`, `PAID_ON_DATE_FORMATTED` `DATE`, `IS_TRANSFERRED` `TEXT` | 🔴 `PAID_ON_DATE` is **TEXT** parsed by a 3-format `TRY_TO_DATE` chain — a 4th format yields NULL silently. `IS_TRANSFERRED` is **TEXT** `'YES'/'NO'`; `= TRUE` matches nothing |
| D10 | Payslip exclusions | same | `AUTOMATIC_EXCLUSION_REASONS`, `MANUAL_EXCLUSION_REASON`, `STATUS` `TEXT` | Rendered in the drill-down; explains a maid with notes but no payslip |
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
| D19 | Tickets purchased | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS` | `HOUSEMAID_ID`, `TICKET_TYPE`, `BUYER`, `ORIGINAL_FARE`, `FARE_IN_REF_CURRENCY`, `CURRENCY_ID`, `EXCHANGE_RATE`, `PURCHASE_DATE`, `REFUNDED`, `IS_DELETED`, `IS_LATEST_HM_TICKET` | `TICKET_TYPE ∈ {TO_DUBAI, TO_EXIT, TO_MANILA, TERMINATION, PREWORK_VACATION, VACATION, OFFICE_STAFF, OFFICE_TICKET}`; `BUYER ∈ {PRIVATE, MAIDCC}`. `ID` tops at 14,564 — small. `NEEDS COMPUTE`: still written to? (O4). `IS_DELETED` TEXT `'00'/'01'` |
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
| — | `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` | **Check not performed.** The container **exists** (`SHOW OBJECTS LIKE '%INSIGHTS%' IN ACCOUNT`) but cannot be read without a warehouse (O1) |

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
only `setOldNote(...)` is in commented-out logic — so a normal edit does **not** leave a
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
list cannot be recovered from code — O2.

#### N6 — Note author · `CREATOR` `BIGINT` (FK → `USERS.ID`), `CREATION_DATE` `DATETIME`, `LAST_MODIFIER`, `LAST_MODIFICATION_DATE`
Answers "who made this addition", which is unanswerable today. ⚠️ Two decoys: `EMPLOYEE_MANAGER_ID`
is **unmapped in the JPA entity** (which is why the warehouse's `MANAGER` column is entirely
NULL), and `FROM_MANAGER_ID` is a **picklist item, not a user**.

#### N7 — Payroll lock window · `MONTHLYPAYMENTRULES` (lock date per payroll month)
M0's branch 2 and the ERP's own auditor window both depend on the lock dates bounding a payroll
month. `HOUSEMAIDS_INFO.LAST_PAYROLL_LOCK_DATE` is entirely NULL, so it cannot serve. Exact
column name `UNVERIFIED` — one Ask the Code follow-up closes it (O3).

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

#### N11 — Referral and signing bonus scheme prices
What a referral and a signing bonus were **worth** on a given date, and the conditions attached
(nationality, contract type, live-in/live-out). Not in the warehouse; not found in the ERP as a
priced scheme. Needed effective-dated. **Owner to name** — the referral scheme owner.

#### N12 — Raffle winners
*(code-verified)* A `RafflePerformerJob` exists and writes `raffle_prize` additions, so the draw
is executed in the ERP and a winners record plausibly exists there. `SHOW OBJECTS LIKE '%RAFFLE%'
IN ACCOUNT` returns **zero rows**, so nothing has been brought across. One Ask the Code follow-up
on `RafflePerformerJob` would name the table — O3.

#### N13 — The loyalty rule
The loyalty payment maps to addition reason **`anti_attrition_incentive`**. *(code-verified)* its
**only** reference anywhere in the ERP is `HousemaidPayrollPaymentServiceV2.getMustBePaidManagerNotes`
— a payment-routing list, **not an eligibility or amount rule**. So the v1 finding survives the
code check with evidence: **no rule exists to test against, anywhere.** This is not a data gap
ingestion fixes. Until a rule is written, every such note is permanently amber, reason *"no rule
exists"*. **Writing the rule is the fix** — R10 / Q4.

#### N14 — Payment type → allowed expense heads
Which `EXPENSES_REQUESTS.EXPENSE_TYPE` values are legitimate behind each addition reason. Test T5
fires RED (F3) on a mismatch, so **without this list T5 has two silent failure modes**: an empty
list reds every note, a permissive default greens every note. **A payment type absent from the
list makes T5 BLOCKED — never a pass, never a red.** Effective-dated. **Owner to name.**

#### N15 — Contract type → allowed payment types
Which addition reasons each `HOUSEMAID_TYPE` may receive. Same two silent failure modes as N14,
and the same rule: absent → **BLOCKED**. Note H5 — the mapping must cover all four contract
types, not two. Effective-dated. **Owner to name.**

#### N16 — Payment types that always carry an expense record
The list T4 needs to distinguish "no expense record found, and there should be one" (a finding)
from "no expense record expected" (not a finding). Absent → T4 **BLOCKED**. **Owner to name.**

> N14–N16 are business rules, not warehouse data. They do not exist in either system today and
> were the unstated assumption underneath v1's T5, T7 and T4. Until they exist, those three tests
> return BLOCKED and their notes are amber — which is the correct reading of the current state,
> not a gap in the build.

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
| **H12** | **Timezone unstated** on `NOTE_DATE` and the payslip dates (`TIMESTAMP_NTZ`) | A note near midnight on the 1st or 31st crosses a month boundary — O6 |
| **H13** | **Referral and signing bonus share reason `bonus`** (N5) | Each is judged by the other's rule |
| **H14** | The ERP's own auditor filters on `CONFIRMED_* = false` (N9) | Inheriting that filter blinds this report to exactly the payments a human waved through — G9 |

---

## 3. Metric Calculations

All amounts in **AED**, 2 dp, rounded at row level and summed after — never rounded on a total.
⚠️ **The note's currency is an assumption.** `HOUSEMAID_MANAGER_NOTES` has no currency column
(D1–D7), so every note `AMOUNT` is taken as AED. Confirm — O12. Every metric below is a **new
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
  in the zone O6 settles, and list every note within 3 hours of a lock-window edge as a data defect.

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
| **T4** | Authorised expense record, and does the amount agree? | matched, authorised, currencies equal, and `\|note − request\|` > tolerance → **F1** · matched but not authorised (see below) → **F4** · unmatched, reason ∈ N16, and that reason's M13 ≥ floor → **F4** | unmatched and M13 < floor · unmatched and reason ∉ N16 or N16 absent · multiple candidates (H1) · currencies differ and no FX (H7) · N4/O3 unresolved | reason ∉ N16 and N16 present |
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

### M6 — The group rules

**Routing is on `(ADDITION_REASON_ID, PURPOSE_ID)` (N5), never on the resolved name (D4).** A rename
would otherwise silently re-route every note. A reason mapped to no group is **BLOCKED** →
verdict 9, never green.

The 24 addition reasons, recovered from the ERP code *(code-verified; the picklist itself has not
been read — O2)*:

| Addition reason `CODE` | Name | Group | Buildable today? |
| --- | --- | --- | --- |
| `airfare_ticket` | Airfare Ticket | **A — Flight home** | **Yes** (N8 lands the cap) |
| `anti_attrition_incentive` | Anti Attrition Incentive | **B — Loyalty** | **No — no rule exists** (N13) |
| `bonus` + purpose `referral_bonus` | Referral bonus | **C — Referral** | Partly — event yes (D18), price no (N11) |
| `bonus` + other/no purpose | Signing bonus | **C — Signing** | Partly — price no (N11) |
| `renewal_bonus` | Renewal Bonus | **H — unmapped** | No |
| `prorated_salary` | Prorated Salary | **D — Part-month** | Partly — needs N10 |
| `mv_prorated_salary` | MV Prorated Salary | **D — Part-month (MV)** | Partly — needs N10 |
| `previously_held_salary` | Previously Held Salary | **D** | Partly — needs N10 |
| `mv_extra_salary` | MV Extra Salary | **D (MV only)** | Partly |
| `last_day_cc_switch_adjustment` | Last-day CC Switch Adjustment | **D** | Partly |
| `salary_dispute` | Salary correction | **E — Correction** | Partly — E1 yes, E2 needs the judgement field |
| `raffle_prize` | Raffle Winner | **F — Raffle** | **No — winners list absent** (N12) |
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
- **A2 — service.** Months since `START_DATE` ≥ 6 *(code-verified)*. BLOCKED on epoch-zero (H6).
- **A3 — cycle.** `months % 24 == 22` *(code-verified, `HousemaidsVacationAllowanceController`)*.
  BLOCKED on epoch-zero.
- **A4 — duplicate against a purchased ticket.** Cash in lieu paid **and** a `MAIDCC`-bought ticket
  (D19) for the same journey → RED (F2). BLOCKED if D19 is stale (O4).

**Group B — Loyalty.** No test exists. *(code-verified: `anti_attrition_incentive`'s only
reference anywhere in the ERP is a payment-routing list, not an eligibility or amount rule.)*
Returns BLOCKED, *"no rule exists"*. Permanently amber until a rule is written — Q4.

**Group C — Referral / signing.** C1 amount = scheme price at the note date (**BLOCKED**, N11) ·
C2 the referral event exists and qualifies (D18) · C3 not already paid for the same event.

**Group D — Part-month.** D1 recompute from dates and the salary **in force then** (**BLOCKED**,
N10) · D2 termination mode consistent (D14) · D3 window matches employment dates.

**Group E — Salary correction.** 🔴 **Conjunctive, not disjunctive.** E1 the expense record proves
the amount **AND** E2 the stated reason (D5) justifies the payment. v1 wrote "E1 **or** E2", which
the verdict algebra cannot express and which let a matched correction go green while the test that
actually asks whether it was *justified* never ran. If E2 is deferred for v1, **E2 returns BLOCKED
and group E is amber** — the honest result.

**Group F — Raffle.** F1 the maid is on the winners list for that draw, and nothing else.
**BLOCKED** — N12.

**Group G — Reimbursement.** G1 amount agrees with the expense record · G2 beneficiary is that maid
(`BENEFICIARY_TYPE = 'MAID'` and the id matches) · G3 an approver is recorded, written as
`NULLIF(TRIM(APPROVED_BY),'') IS NOT NULL` — 🔴 the expense view returns `''`, not NULL (H9), so
`IS NOT NULL` alone clears a reimbursement that nobody approved.

**Groups H–K.** No rule found in code or business. BLOCKED → amber, reason named.

**Group I — system-generated.** `forgive_deduction`, `cover_deduction_limit`,
`cover_negative_salary` are written by automation, not by a manager, and the ERP's own
repeated-additions rule excludes the latter two *(code-verified)*. Whether a discretionary-payment
audit should judge them is **Q3**. Until answered: in scope, BLOCKED, amber.

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
| Internal sign-off | `CONFIRMED_AMOUNT_BY_AUDITOR = **true**` |

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

**Arithmetic.** T1–T7 all green or N_A. Group B runs — and there is **no rule to run**:
*(code-verified)* the reason's only reference in the entire ERP is a payment-routing list, not an
eligibility or amount rule. Group B returns `BLOCKED("no rule exists")`.

Under M5, one blocked applicable test makes the note **AMBER**, though seven tests returned green.
**M8 += 1 case, AED 1,000.00. M9 += 0.** It is not a pass.

On this month's figures the loyalty bucket is **206 cases, AED 164,900** — the largest single
category of amber, and the dashboard's most valuable output: a payment type worth real money with
no written rule anywhere in the company, with a number attached.

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

---

## 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| O1 | **Row-level verification of §2.1 is outstanding.** Names, types, source expressions and profiled ranges are verified from the catalog; **row counts, freshness, cardinality and population are verified nowhere** — the P&C role has no warehouse. First three queries once granted: (a) `COUNT(*)` vs `COUNT(DISTINCT ID)` on `HOUSEMAID_MANAGER_NOTES` (G2 — the grain of the whole report); (b) `SELECT NOTE_TYPE, COUNT(*) … GROUP BY 1` (G10); (c) read `INSIGHTS_DASHBOARD_CONTAINER` (§2.2). **Also: grant P&C a warehouse, so specs ship with rows as evidence** | Snowflake team / Data platform | **Yes** |
| O2 | **Enumerate the addition-reason picklist and `HousemaidPurposesForBonusAdditionalDescription` from the database.** The §3 M6 table is recovered from **code references**, so a reason that exists in the picklist but is referenced nowhere in code is missing from it — and an unmapped reason is amber by construction, which is safe but understates coverage. Also needs `PICKLISTS_INFO`'s own column names and types, never profiled | Snowflake team, after O1 | **Yes** |
| O3 | **Three Ask the Code follow-ups**, each one question: (a) N7 — the payroll lock-window table and column; (b) N12 — what `RafflePerformerJob` reads to pick winners; (c) whether `HOUSEMAID_MANAGER_NOTES.AMOUNT` is always AED (O12) | P&C, with a fresh token | **Yes** |
| O4 | Is `HOUSEMAIDS_TICKETS` still written to? `MAX(PURCHASE_DATE)`. `ID` tops at 14,564 — small enough to suspect a dead source, which would silently disable group A4 | Snowflake team, after O1 | Yes for A4 |
| O5 | **Resolve X1** before any use of `EXPENSES_REQUESTS.RELATED_TO_ID` | Data team | **Yes** for the expense link |
| O6 | **Timezone** of `NOTE_DATE` and the payslip dates. `TIMESTAMP_NTZ` carries none; if the ERP writes UTC, a note at 02:00 Dubai truncates to the previous day and can cross a lock-window edge | ERP team | **Yes** |
| O7 | **N14, N15, N16 do not exist.** Someone must own and write payment-type→allowed-heads, contract-type→allowed-payment-types, and which types always carry an expense record. Until then T4, T5 and T7 are BLOCKED and their notes amber | P&C + Payroll | **Yes** for T5/T7 |
| O8 | Confirm `Normal` = company contract and `MAID_VISA` = MaidVisa, and rule on `FREEDOM_OPERATOR` / `WALKIN` (currently amber, H5) | P&C + Payroll | Yes for T1/T7 |
| O9 | **N10** — effective-dated salary history for group D. Candidate: `HOUSEMAIDS_INFO_REVISION` | Data team | Yes for group D |
| O10 | **N11** — referral and signing bonus scheme prices, effective-dated | Referral scheme owner | Yes for group C |
| O11 | **N8's parameters are not effective-dated.** A cap changed mid-year retroactively re-judges settled months (H11, G8). Decide whether to snapshot the value per run or source a dated history | Payroll + Data team | Yes for group A |
| O12 | **Confirm the note's currency.** `HOUSEMAID_MANAGER_NOTES` has no currency column, so the whole spec assumes AED. If wrong, every amount comparison, M2, M11 and both tie-outs are wrong in an unknown direction | ERP team (O3c) | **Yes** |
| O13 | **Columns listed but consumed by nothing** — decide "required" or "context only" for each: D9 `IS_TRANSFERRED`, D10 exclusion reasons, D13 `NET_HIRED_DATE`, D15 `EXCLUDED_FROM_PAYROLL`, D16 `PAYMENT_METHOD` / `EXPENSE_PAYMENT_ID` / `REQUESTED_BY`, D7, and N6's author columns (the repeat-offender view N6 justifies is specified nowhere). `EXCLUDED_FROM_PAYROLL` deserves a real decision — a paid addition on a payroll-excluded maid looks like a finding worth testing | P&C | No |
| O14 | Agree the first audit month and the backfill window (N-items are specified from 2024-01-01) | P&C | No |
| O15 | **Access statement** for the dashboard and the CSV export, given §1's sensitivity class and the staff-name exposure in §4 | P&C / Data platform | No |
| O16 | Report **X1** and **X2** to the Data team independently of this audit | P&C | No |

**X1.** `BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` joins `EXPENSES_REQUESTS.RELATED_TO_ID` to a
**manager-note id** while that column is documented as a **housemaid id**; ranges overlap, so a
wrong reading matches rows and raises no error, and every column of the view profiles as all-NULL.
**X2.** `HOUSEMAID_MANAGER_NOTES` may emit more rows than there are notes (H1), and its `MANAGER`
column is entirely NULL because the underlying `EMPLOYEE_MANAGER_ID` is unmapped in the JPA entity
*(code-verified)*.

---

## 7. Requestor decisions still open

These are Police & Control's to make, not the Snowflake team's.

**Q1 — the M13 confidence floor.** Blocking, because it decides whether an unmatched note is a red
"no basis" or an amber "unverifiable". v2's interim value is **80 %**, per payment type per month.
Below it, T4 cannot return red for that type. Needs a calibration pass over history once O1 lands,
then your sign-off. Setting it lower surfaces more money and risks accusing someone on a bad match;
setting it higher is safer and reports less.

**Q2 — the T4 amount tolerance.** v2 uses **AED 0.01**, which is a float-artefact guard, not a
materiality threshold. If P&C wants a materiality band — "a gap under AED X is not worth a case" —
say so and it becomes a stated filter with its business justification, rather than an
undocumented rounding behaviour.

**Q3 — system-generated additions.** `forgive_deduction`, `cover_deduction_limit` and
`cover_negative_salary` are written by automation, not by a manager. The ERP's own
repeated-additions rule excludes the latter two *(code-verified)*, which suggests the business
treats them as non-discretionary. They are still money on a payslip. **In scope (currently amber,
62 cases / AED 26,900 on the illustrative month), or out?** Excluding them is defensible; doing it
silently is not.

**Q4 — the loyalty rule.** This is not a data request. `anti_attrition_incentive` has **no
eligibility or amount rule anywhere in the ERP** *(code-verified)*, and on the illustrative month
it is 206 cases and AED 164,900 of permanently unverifiable money — the largest single block of
amber. Either a rule gets written, or the report states each month that the largest category of
manager additions cannot be audited. **Both are legitimate; neither should be accidental.**

**Q5 — salary-bearing rows.** For `prorated_salary`, `mv_prorated_salary`,
`previously_held_salary` and `mv_extra_salary`, the note amount **is** a salary figure. v2's
default shows a band on screen and the exact figure only in the reviewed drill-down. Confirm, or
override and accept salary figures in the case table and the CSV export.

**Q6 — write-back.** The maker–checker status column is a write, which makes this a small
application rather than a dashboard. In v1 or out? The build shape depends on the answer.
