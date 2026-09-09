# Manager Notes Audit — Snowflake source tables

**Start here.** Every data point mapped to its object, the two link routes, the ERP rules and what
creates them, the trap table, the data asks, and the adjacent production work.

Read 2026-09-05.

---

## 0. What is verified, and how

Three provenance levels are used throughout. Every claim below carries one.

| Tag | Means |
| --- | --- |
| `catalog` | From the Snowflake catalog — `SHOW COLUMNS`, `GET_DDL`, and the `ba_views` column comments, which carry dbt-generated `source_expression`, `allowed_values` and the model's extracted `WHERE` clause. Profiled at build time from real data |
| `code` | From the ERP source via Ask the Code, conversations 45815–45818 |
| `DNA-9464` | Measured on production by the Data team in that ticket |
| `unverified` | Stated for completeness, not confirmed |

🔴 **No row-level query was run.** An access limitation on our side (DNA-9437, To Do) meant
aggregate statements could not execute, so **population, freshness and cardinality are unverified
everywhere**. What exists is known; how much of it there is, is not. Section 8 lists the three
checks that close this out.

---

## 1. D1 — the note · `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES`

Ten columns. `catalog`

| Column | Type | Profiled values | Source expression |
| --- | --- | --- | --- |
| `ID` | `FIXED(38,0)` | 5 – 183,975 | `p.ID` |
| `HOUSEMAID_ID` | `FIXED(38,0)` | 1 – 138,006 | `p.HOUSEMAID_ID` |
| `NOTE_TYPE` | `TEXT` | `DEDUCTION, ADDITION, PENALTY_DEDUCTION` | `p.NOTE_TYPE` |
| `AMOUNT` | `REAL` | −3,032 – 44,230.26 | `p.AMOUNT` |
| `NOTE_REASON` | `TEXT` | free text | `p.NOTE_REASONE` *(typo is in the source)* |
| `REASON` | `TEXT` | free text | `COALESCE(a.NAME, d.NAME)` from `mmdb.picklists_items` |
| `NOTE_DATE` | `TIMESTAMP_NTZ` | min 2016-11-21 | `p.NOTE_DATE` |
| `MANAGER` | `FIXED(38,0)` | **no non-null values** | `p.EMPLOYEE_MANAGER_ID` |
| `REQUESTED_BY` | `TEXT` | free text | `ep.REQUESTED_BY` |
| `APPROVED_BY` | `TEXT` | free text | `ep.APPROVED_BY` |

**The model's own SQL**, extracted into the table comment: `catalog`

```sql
FROM payrollmanagernotes p
LEFT JOIN mmdb.picklists_items a ON a.ID = p.ADDITION_REASON_ID
LEFT JOIN mmdb.picklists_items d ON d.ID = p.DEDUCTION_REASON_ID
LEFT JOIN EXPENSE_P ep ON ep.HOUSEMAID_ID = p.HOUSEMAID_ID
                      AND ep.EXPENSE_ID   = p.EXPENSE_ID
WHERE p.HOUSEMAID_ID IS NOT NULL      -- and, in the expense_p CTE: RELATED_TO_TYPE = 'MAID'
```

Sources: `mmdb_transformed.payrollmanagernotes`, `mmdb.expensepayments`, `mmdb.picklists_items`.

Four things follow, three of which are defects:

1. **`REASON` is the payment type** — the resolved picklist name. A note with none surfaces as NULL.
2. **`MANAGER` is dead.** `code`: `EMPLOYEE_MANAGER_ID` is not mapped in the current JPA entity.
   `FROM_MANAGER_ID` is a **picklist item, not a user**. The real column is `CREATOR`.
3. **The `ep` join can fan out.** `HOUSEMAID_ID + EXPENSE_ID` with no visible dedup, and
   `EXPENSE_ID` is a **catalogue** id, so one maid with two payments in one category matches both.
   Grain is therefore unproven — check 1 in §8.
4. **`EXPENSE_ID` is used in the join but never selected**, so the link cannot be re-checked
   downstream. It is ask N4.

**Not to be confused with** `HOUSEMAID_MANAGERACTIONLOGS`, which the warehouse's own table comment
describes as the ERP maid-notes screen — profile notes, no money. Out of scope. `catalog`

---

## 2. D2 — the payslip · `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY`

From `mmdb.housemaidpayrolllogs`. One row per maid × payroll month. `catalog`

| Column | Type | Profiled values | Source |
| --- | --- | --- | --- |
| `HOUSEMAID_ID` | `FIXED(38,0)` | 2 – 136,828 | `hp.HOUSEMAID_ID` |
| `PAYROLL_MONTH` | `DATE` | min 2020-07-01 | `hp.PAYROLL_MONTH` |
| `ADDITIONS` | `REAL` | −1,516 – 8,800 | `hp.MANAGER_ADDITIONS` |
| `DEDUCTIONS` | `REAL` | 0 – 2,800 | `hp.TOTAL_DEDUCTION` |
| `NET_SALARY` | `REAL` | 0 – 13,200 | `hp.TOTAL_SALARY` |
| `PAID_ON_DATE` | **`TEXT`** | free text | `hp.PAID_ON_DATE` |
| `PAID_ON_DATE_FORMATTED` | `DATE` | min 2020-08-04 | 3-format `TRY_TO_DATE` chain |
| `IS_TRANSFERRED` | **`TEXT`** | `YES`, `NO` | `IFF(hp.TRANSFERRED=1,'YES','NO')` |
| `AUTOMATIC_EXCLUSION_REASONS` | `TEXT` | long free-text list | `hp.AUTOMATIC_EXCLUSION_REASONS` |
| `STATUS` | `TEXT` | 20 maid-status values | `hp.STATUS` |

**`ADDITIONS` is the tie-out anchor.** `code`: `MANAGER_ADDITIONS` counts only
`NOTE_TYPE = 'ADDITION'`, so the scoped notes must reconcile to it per maid × month. It is the only
expected-population source in the design — a report built on rows that exist cannot otherwise see a
row that does not.

---

## 3. D3 — the maid · `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO`

114 columns; these are the ones read. `catalog`

| Column | Type | Profiled values | Use |
| --- | --- | --- | --- |
| `ID` | `FIXED(38,0)` | 1 – 138,554 | join key |
| `HOUSEMAID_TYPE` | `TEXT` | `Normal, MAID_VISA, FREEDOM_OPERATOR, WALKIN` | contract type — **four values** |
| `NATIONALITY` | `TEXT` | free text | airfare cap lookup |
| `NATIONALITY_CATEGORY` | `TEXT` | `Filipina, African, Ethiopian, Other` | ⚠️ **not** the partition the ERP rule uses |
| `START_DATE` | `TIMESTAMP_NTZ` | min 1970-01-01 | service length |
| `SALARY_STARTING_DATE` | `TIMESTAMP_NTZ` | min 1970-01-01 | `COALESCE(REPLACEMENT_SALARY_START_DATE, START_DATE)` |
| `DATE_OF_TERMINATION` | `TIMESTAMP_NTZ` | min 2015-09-05 | final-salary window |
| `MODE_OF_TERMINATION` | `TEXT` | `QUIT, FIRED, NON_RENEWAL, RESIGNATION, CONVERTED_TO_MAIDSAE` | group D |
| `IS_DELETED` | **`TEXT`** | `00`, `01`, nullable | hygiene |
| `EXCLUDED_FROM_PAYROLL` | **`TEXT`** | `00`, `01` | hygiene |
| `LAST_PAYROLL_LOCK_DATE` | `TIMESTAMP_NTZ` | **no non-null values** | dead — the lock window must come from N7 |

**Not read:** `BASIC_SALARY`, `PRIMARY_SALARY`, `PHONE_NUMBER`, `NORMALIZED_PHONE_NUMBER`,
`PASSPORT_NUMBER`, `ADDRESS`. The provenance line must say non-salary columns only.

---

## 4. D4–D7 — the rest

| Ref | Object | Columns read | Notes |
| --- | --- | --- | --- |
| **D4** | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | `ID`, `EXPENSE_TYPE`, `RELATED_TO_TYPE`, `RELATED_TO_ID`, `REQUEST_STATUS`, `REFUNDED`, `AMOUNT`, `CURRENCY_NAME`, `BENEFICIARY_TYPE`, `BENEFICIARY_NAME`, `APPROVED_BY`, `REQUESTED_BY`, `PAYMENT_METHOD`, `EXPENSE_PAYMENT_ID`, `CREATION_DATE` | `REQUEST_STATUS ∈ {PAID, REJECTED, DISMISSED, PENDING_PAYMENT, CANCELED, PENDING}` · `BENEFICIARY_TYPE ∈ {SUPPLIER, MAID, OFFICE_STAFF, TAXI_DRIVER, NOT_DETERMINED}` · `CURRENCY_NAME` spans **10** currencies · `STATUS_CHANGE_DATE` starts only **2025-12-16**, so it cannot date an approval for an earlier month — use `CREATION_DATE` (min 2021-10-21) `catalog` |
| **D5** | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS` | `HOUSEMAID_ID`, `TICKET_TYPE`, `BUYER`, `ORIGINAL_FARE`, `FARE_IN_REF_CURRENCY`, `CURRENCY_ID`, `EXCHANGE_RATE`, `PURCHASE_DATE`, `REFUNDED`, `IS_DELETED`, `IS_LATEST_HM_TICKET` | `TICKET_TYPE ∈ {TO_DUBAI, TO_EXIT, TO_MANILA, TERMINATION, PREWORK_VACATION, VACATION, OFFICE_STAFF, OFFICE_TICKET}` · `BUYER ∈ {PRIVATE, MAIDCC}` · `ID` tops at **14,564** — small enough to suspect a dead source; check 4 in §8 `catalog` |
| **D6** | `…MAIDS_REFERRALS_BONUSES`, `…HOUSEMAID_REFERRALS` | referral, referred maid, bonus-requested date, cancelled date, **`HOUSEMAID_REFERRALS.AMOUNT`** | 🔴 `MAIDS_REFERRALS_BONUSES` is built from the **same** `payrollmanagernotes` source, filtered `NOTE_TYPE='ADDITION' AND pi3.NAME='Referral bonus' AND AMOUNT != 0` — **circular as a price source**, and that filter deletes exactly the notes T3 flags. Use it for the **paid** amount only. **`HOUSEMAID_REFERRALS.AMOUNT` is the authorised amount** — paid-vs-authorised is the conformance test. Profiled values: paid `250, 500, 1000, 1200, 1500, 2000`; authorised `0, 500, 1000, 1200` — **AED 1,200 is in both and is not in the stated scheme**. Referral records start **2025-02-20**, payments **2022-04-21** → the earlier period must BLOCK, never red. `REFERRED_MAID_ID` is `COALESCE(direct, latest-by-phone, latest-by-WhatsApp)` — partly heuristic. ⚠️ carries the referred maid's **name and phone**, and `CREATOR`/`LAST_MODIFIER` are staff **full names** — none may reach the model output `catalog` |
| **D7** | `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` | picklist item id, code, name | Resolves `ADDITION_REASON_ID` / `PURPOSE_ID`. Its own columns have never been profiled — check 2 in §8 `catalog` |

⚠️ **`BA_VIEWS.HOUSEMAID_MANAGEMENT_GOLD.BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` is not a
source for this model** until **DNA-9464** deploys. See §6.

---

## 5. The two link routes

### Route 1 — note → payslip. Solved, and it is the tie-out.

`HOUSEMAID_ID` + the audit month → `HOUSEMAID_PAYROLL_HISTORY.HOUSEMAID_ID` + `PAYROLL_MONTH`. Both
`FIXED(38,0)` / `DATE`. **Many notes to one payslip row**, so it must not be joined before the
note-level tests finish or the grain fans.

The audit month itself resolves in three branches, because the ERP populates the paid-month columns
for only some notes. `code`

| Branch | Condition | Month |
| --- | --- | --- |
| 1 | `PAID_ON_PAYROLL_MONTH IS NOT NULL` | that value — authoritative |
| 2 | otherwise | the payroll month whose **lock window** contains `NOTE_DATE`, and the note must reconcile into that month's `MANAGER_ADDITIONS` |
| 3 | neither resolves | the note stays in the population, verdict AMBER, *"paid month cannot be established"* |

🔴 **`PAID = true` is not "was paid".** `code`: for most routine additions the ERP writes neither
`PAID` nor `PAID_ON_PAYROLL_MONTH`. Those are written only for carried-forward *must-be-paid*
reasons — `salary_dispute`, `taxi_reimbursement`, `forgive_deduction`, `airfare_ticket`, `AR-1`,
`anti_attrition_incentive`, `Maids_at_other_expenses`, `medical_assistant`, `mv_prorated_salary`.
`HousemaidPayrollController`'s manual "mark as paid" sets `PAID` **without**
`PAID_ON_PAYROLL_MONTH`. Filtering the population on `PAID = true` drops the majority of notes and
the month reports clean.

`PAYROLL_MONTH` on the note is written on **one** path only — retroactive MV prorated salary — where
it equals `PAID_ON_PAYROLL_MONTH`. It is not the general "which payslip paid this" field.

### Route 2 — note → authorising expense request. A heuristic, by construction.

🔴 **No key exists.** `code`: `payrollmanagernotes.EXPENSE_ID` is a FK to **`EXPENSES.ID`**, the
expense *catalogue* row. There is **no FK** to `EXPENSEREQUESTTODOS` or `EXPENSEPAYMENTS` — the ERP
copies fields across rather than storing the relationship.

```
candidates = EXPENSES_REQUESTS
  where RELATED_TO_TYPE = 'MAID'
    and RELATED_TO_ID   = note.HOUSEMAID_ID          -- the key DNA-9464 adopted
    and EXPENSE_TYPE resolves from note.EXPENSE_ID   -- ask N4
    and CREATION_DATE within the note's entitlement window

exactly 1  -> matched
>1         -> unverifiable, "multiple candidate expense records"   -- never take the first
0          -> unmatched; red or unverifiable, decided by N16 and the match-rate floor
```

**Measured, `DNA-9464`:** the previous GOLD model keyed on the **note id** and matched **1 of 8,632**
addition notes in a six-month window; keyed on `HOUSEMAID_ID` it matches **7,878**. That is the route
above, so it is production-validated rather than inferred.

🔴 **Multiple candidates is the normal case.** `DNA-9464`: **7,020 of 7,878 matched notes (89%)**
belong to maids holding more than one expense request, and **3,473 of those (1,352 maids)** used two
different payment methods. That ticket's upstream step took the maid's *most recent* request and the
notes inherited the wrong payment method. Resolving to the first candidate is wrong for the majority
of rows.

**Blind spot.** `catalog`: `EXPENSES_REQUESTS` excludes expense categories marked `is_secure = 1`
**entirely** — the `EXPENSE_TYPE` name is resolved by INNER JOIN to `mmdb.expenses`. So a note backed
by a secure category is indistinguishable from a note backed by nothing. This is why the match rate
is published per payment type and carries a floor, rather than each row being judged alone.

---

## 6. The ERP rules, and what creates them

### The airfare cap exists — as parameters, not a table `code`

| `PARAMETERS.CODE` | Seeded `VALUE` | Applies to |
| --- | --- | --- |
| `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` | `"2000"` | `HOUSEMAIDS.NATIONALITY` = picklist code `philippines` |
| `PARAMETER_HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT` | `"1350"` | every other nationality |
| `PARAMETER_HOUSEMAID_REPETITIVE_ADDITION_LIMIT` | `"3"` | months in the ERP's repeated-additions window |

🔴 **Do not implement the code's tenure test.** `HousemaidsVacationAllowanceController` hard-codes
`months >= 6` and `months % 24 == 22` — one month in twenty-four, from `START_DATE`, contract type
never consulted. **Payroll's rule is different and governs**: at least **22 months as a CC maid**, an
MV break **under a year bridges**, a year **or longer resets** to her return to CC. The two agree only
at months 22/46/70, so building on the code would flag or block most legitimate airfare payments. The
divergence is a finding for P&C, not a spec choice.
This needs a **contract-type timeline** (§ below), not a start date.

🔴 `VALUE` is **TEXT**, these are **seeded defaults not necessarily today's values**, and they are
**not effective-dated** — a cap changed mid-year retroactively re-judges settled months. Read the
row, snapshot it per run, and raise a changed value as an exception.
⚠️ Aside for the ERP team: the notification email hard-codes the literal `2000` instead of reading
the parameter, so changing the parameter makes the email lie.

### The ERP's own auditor — and why this report must not inherit its filter `code`

`HousemaidsExceptions.generateHousemaidExceptions` raises three exception types:
`HOUSEMAID_FILIPINO_AIRFARE_TICKET` and `HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET`
(`AMOUNT >` the limit, reason code `airfare_ticket`), and `HOUSEMAID_REPETITIVE_ADDED_PAYMENTS`
(`> 1` addition in 3 months, excluding `cover_deduction_limit` and `cover_negative_salary`).

**Both queries filter `CONFIRMED_*_BY_AUDITOR = false`.** `approveHousemaidException` sets the flag
true, at which point the case leaves the ERP's list **while the payment stays over the limit**. That
population is precisely what an independent second check exists to see, so no query in this model may
filter on `CONFIRMED_AMOUNT_BY_AUDITOR` or `CONFIRMED_REPEATED_BY_AUDITOR`. They are display columns.

### The addition reasons `code`

Recovered from code references. 🔴 **This list is incomplete and we do not know by how much.** The
warehouse's own `ADDITION_CATEGORY` profile
(`BI_PAYROLL_MAID_SALARY_ADDITIONS_AS_LOAN_IMPACT_BY_CATEGORY`) carries live categories that appear
nowhere below — **Accommodation Relocation, Sim card Loan, WPS Compliance Loan, PCR Test & medical
assistance Loan, Live-out Transportation Assistance, NOL Card**, and several **Part-Time Cleaners
Expenses** categories — and that profile is itself **truncated**. Reading the picklist is check 2 in
§8 and it is what closes this. **Do not code a fixed list of reasons.**

| Code | Name | Group |
| --- | --- | --- |
| `airfare_ticket` | Airfare Ticket | A — flight home |
| `anti_attrition_incentive` | Anti Attrition Incentive | B — loyalty |
| `bonus` | Bonus | C — referral **or** signing, split by `PURPOSE_ID` |
| `renewal_bonus` | Renewal Bonus | H — unmapped |
| `prorated_salary` | Prorated Salary | D |
| `mv_prorated_salary` | MV Prorated Salary | D |
| `previously_held_salary` | Previously Held Salary | D |
| `mv_extra_salary` | MV Extra Salary | D |
| `last_day_cc_switch_adjustment` | Last-day CC Switch Adjustment | D |
| `salary_dispute` | Salary correction | E |
| `raffle_prize` | Raffle Winner | F |
| `taxi_reimbursement` | Transportation Fare Reimbursement | G |
| `medical_assistant` | Medical Assistant | G |
| `Maids_at_other_expenses` | Maids at Other Expenses | G |
| `lost_luggage_compensation` | Lost Luggage Compensation | G |
| `forgive_deduction` | Forgive Deduction | I — system-generated |
| `cover_deduction_limit` | Cover Deduction Limit | I |
| `cover_negative_salary` | Cover Negative Salary | I |
| `recommendation_from_client` | Google Review | J |
| `pay_vacation_days` | Pay Vacation Days | K |
| `low_exchange_rate_compensation` | Low Exchange Rate Compensation | H |
| `AR-1` | AR-1 | H |
| `office_work_addition` | Office Work Addition | **out of scope** |
| `refund` | Refund | **out of scope** |

🔴 **Referral and signing bonus share `bonus`** and are separated only by `PURPOSE_ID`
(`referral_bonus`, on picklist `HousemaidPurposesForBonusAdditionalDescription` — **not seeded in the
repo**, so its items cannot be recovered from code). Routing on the resolved *name* is worse still: a
rename silently re-routes every note.

**"Final salary" is not a payment type** — no dedicated reason exists; it is computed in
`PayrollHousemaidFinalSettlementController.calculateProrated`.

**The loyalty payment is `anti_attrition_incentive`**, and its only reference anywhere in the ERP is
`HousemaidPayrollPaymentServiceV2.getMustBePaidManagerNotes` — a payment-routing list, not an
eligibility or amount rule. There is nothing to test against.

### Edits, refunds and the note lifecycle `code`

- **Edits update in place.** `PayrollManagerNoteController` does not override `updateEntity`;
  `OLD_NOTE_ID` is dead code. A normal edit does **not** leave a duplicate-looking pair.
- **Refunds create a new row** via `/ManagerNotes/bulkrefund`, linked by `REFUNDED_NOTE_ID`, leaving
  the original untouched.
- `ADDITION_PAYROLL_MANAGER_NOTE_DEDUCTION_SOURCE_ID` is read for `forgive_deduction` display but
  **not populated** by current automation.

---

## 7. Trap table

Each of these returns a wrong answer rather than an error.

| # | Trap | Consequence if ignored |
| --- | --- | --- |
| H1 | D1's `ep` join can emit more rows than notes (§1) | Every count and total is wrong, and the totals still balance. Check 1 |
| H2 | `PAID = true` is not "was paid" (§5) | Most of the population is dropped; the month reports clean |
| H3 | `EXPENSES_REQUESTS` excludes secure categories entirely | "No record" and "record withheld" are indistinguishable |
| H4 | TEXT flags that look boolean: `IS_DELETED`, `EXCLUDED_FROM_PAYROLL` (`'00'/'01'`, nullable), `IS_TRANSFERRED` (`'YES'/'NO'`) | `= TRUE` matches nothing; zero rows reads as "no findings" |
| H5 | `HOUSEMAID_TYPE` has **four** values | `IF MV … ELSE CC` clears freedom-operator and walk-in against the wrong rule |
| H6 | `START_DATE` / `SALARY_STARTING_DATE` bottom out at `1970-01-01`; `LAST_PAYROLL_LOCK_DATE`, `EID` and `MANAGER` are entirely NULL | Epoch-zero is "unknown" wearing a date; service arithmetic returns a confident wrong answer |
| H7 | Ten currencies on `EXPENSES_REQUESTS`; tickets carry their own `CURRENCY_ID` and `EXCHANGE_RATE` | Comparing AED to PHP without FX is wrong, not approximately right |
| H8 | `EXPENSES_REQUESTS.AMOUNT` reaches 2.2 × 10¹¹; `STATUS_CHANGE_DATE` starts 2025-12-16 | One outlier dominates any money headline; truncated history cannot date an earlier approval |
| H9 | `BENEFICIARY_NAME`, `RELATED_TO_NAME`, `APPROVED_BY`, `REQUESTED_BY` return `''`, not NULL | `IS NOT NULL` clears a reimbursement nobody approved. Use `NULLIF(TRIM(x),'')` |
| H10 | `PAID_ON_DATE` is TEXT parsed by a 3-format `TRY_TO_DATE` chain | A 4th format yields NULL silently — the note drops out of its month |
| H11 | `PARAMETERS.VALUE` is TEXT and not effective-dated | A string/number comparison matches nothing; a changed cap re-judges settled months |
| H12 | `NOTE_DATE` is `TIMESTAMP_NTZ`, timezone unstated | A note near midnight crosses a month boundary |
| H13 | Referral and signing bonus share reason `bonus` | Each is judged by the other's rule |
| H14 | The ERP auditor filters `CONFIRMED_* = false` | Inheriting it blinds the report to the payments a human already waved through |
| H15 | 89% of matched notes have more than one candidate expense request (`DNA-9464`) | First-match attribution is wrong for the majority of rows |

---

## 8. What has not been verified — the checks that close it

| # | Check | Why it matters |
| --- | --- | --- |
| 1 | `SELECT COUNT(*), COUNT(DISTINCT ID) FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | The grain of the whole report (H1). Difference must be **0** |
| 2 | Read `PICKLISTS_INFO` — its own column names and types, and the full addition-reason list | The §6 list is code-referenced, so a picklist-only reason is missing from it |
| 3 | `SELECT NOTE_TYPE, COUNT(*) … GROUP BY 1` over the audit window | The four legacy types must return **0**; a non-zero count means money is moving through an excluded type |
| 4 | `SELECT MAX(PURCHASE_DATE) FROM …HOUSEMAIDS_TICKETS` | `ID` tops at 14,564 — if the source is dead, the airfare duplicate test silently disables |
| 5 | `SELECT * FROM BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER LIMIT 50` | Whether an approved definition already exists for any of the ten metrics |
| 6 | Monthly volume of scoped notes | Expect **1,300–1,500/month**; `DNA-9464` measured 8,632 across six months on the same source |
## 10. Adjacent production work

| Key | What | Status | Relationship |
| --- | --- | --- | --- |
| **DNA-9464** | Join-key fix on `BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` | Pending Deployment | This model uses the corrected key. Do not source from that GOLD model until it deploys |
| **DNA-9465** | Additions-as-loans charts querying the wrong table | Pending Deployment | Same dashboard section, unrelated defect |
| **DNA-7074** | The "most recent expense request" filter | Done | The upstream cause of the payment-method mis-attribution DNA-9464 hit. **This model must not inherit it** |
| **DNA-9133** | Anomaly detection on Additions by Category | Ongoing | Same measure, different purpose — detects a spike, does not test a rule |
| **DNA-9446 / DNA-9449** | Payroll audit — ingest two archived monthly files | To Do | Sibling P&C payroll check; whole-payroll arithmetic, not per-note justification |
| **DNA-9454 / DNA-9455** | Applicant ticketing audit, eleven P&C metrics | To Do / On-Hold | Sibling P&C audit; recruitment flights, different population |
| **DNA-9437** | Warehouse USAGE for `PAYROLL_AND_MONEY_CONTROL_ROLE` | To Do | Why §8's checks are outstanding |

**The existing Payroll Dashboard section *"Additions to the maid's salaries"* is not replaced by
this.** That reports additions by category; this audits whether each one was justified.


---

## 11. Added 2026-09-07 — business rules from payroll, and two access facts

**Source:** George Abboud (Housemaid Payroll) via Hassan Ahmed, 2026-09-07. These are business
rules, not code findings, and where they conflict with the ERP they govern.

### Airfare — `airfare_ticket`
At least **22 months as a CC maid** as of the note date. Contract-type timeline walked backwards: an
**MV interval under one year bridges** (the CC service before it still counts); **one year or longer
resets** the clock to her return to CC. MV months themselves do not count. She must also **have been
CC when the payment was made** — never judged on the profile-current type.
*Open:* whether MV months count at all, the exactly-12-month boundary, multiple switches, what
governs the second ticket, and whether the floor applies to termination repatriation as well as
vacation flights.

### Referral bonus — `bonus` + purpose `referral_bonus`
**AED 1,000 per referral event**, paid once the referred maid completes **30 days with the client**.
Referred maid **CC** → 1,000 to the referrer, nothing to the referred. Referred maid **MV** → **500
each**, or 1,000 to the referrer as a stated exception. **The referred maid must not already be with
the company** — payroll's *most common reason a bonus is rejected*.
The **grain is the referral event, not the note**: one referral produces up to two notes and they are
judged together, with the event total tied to 1,000.
*Open:* what the **AED 1,200** is; what governs the MV exception; "never been with us" vs "not
currently with us"; whether the amounts ever changed.

### Signing bonus — `bonus`, other or no purpose
*"Promised by retractors"* — a retention payment negotiated per case when someone talks a maid out of
leaving. **No price by construction.** Test that a retraction exists and an authoriser is named; never
judge the amount against the referral scheme.
🔴 Referral and signing bonus are **entangled in free text** — the warehouse classifies an MV referral
by exact-matching the note reason *"Signing bonus for this MV maid because she was referred by an MV
maid"*, so `PURPOSE_ID` alone does not separate them.

### Accommodation Relocation — not in the code-recovered list
The maid must be **CC live-out**, and the amount must be booked as an **addition and a matching loan
at the same time**: `addition_amount = loan_amount`. An addition with no loan is money given rather
than advanced.
⚠️ **Already breaking:** `BI_PAYROLL_MAID_SALARY_ADDITIONS_AS_LOAN_IMPACT_BY_CATEGORY` profiles
`ADDITION_LOAN_AMOUNT` from **0** and `LOAN_PERCENTAGE_OF_ADDITIONS` up to **114.75** — loans both
missing and exceeding their additions.

### Three data requirements these rules create

| # | What | Where it is |
|---|---|---|
| ✅ **N17 — RESOLVED 2026-09-09** | Contract-type timeline per maid | **`HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS`** — `HOUSEMAID_ID, FROM_TYPE, TO_TYPE, CHANGE_DATE, PREV_CHANGE_DATE, NEXT_CHANGE_DATE`. Closed intervals. Carries `CC Live In`/`CC Live Out`/`MV`, so **N19 is resolved in the same column**. Verified by query, not inferred |
| **N18** | **Row-level loans** paired to additions | No raw or silver loans table exists — only three gold views, all aggregated. ⚠️ repayment is unverifiable: it runs through deductions, which are out of scope |
| **N19** | **`live_out` flag**, effective-dated | Not on `HOUSEMAID_TYPE`; the gold layer derives `CC Live In / CC Live Out / MV` from a separate `live_out` flag |

### Two access facts, verified

- `SHOW WAREHOUSES` returns **zero rows** for `PAYROLL_AND_MONEY_CONTROL_ROLE`.
  `SHOW GRANTS TO ROLE` returns **668 grants — 426 view SELECTs, USAGE on 5 databases and 40 schemas,
  zero warehouses.**
- 🔴 **`BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` is not granted.** The schema has USAGE; only
  `TRANSACTIONS` is SELECT-able there. **A warehouse grant alone will not unblock T4, T5, group G,
  group E or the match rate.**
- The payroll **lock window is not obtainable from Snowflake by any route**: no `%PAYMENT_RULE%`
  object exists account-wide, and `LAST_PAYROLL_LOCK_DATE`, `LOCK_DATE` and their `_MODIFIED` twins
  all profile as `"no non-null values"`. It has to come from the ERP.


---

## 12. The nine check archetypes — the shape to build in

~25 payment types, but only **nine mechanisms**. Build the nine as functions, drive them from a
config table, and a new payment type is a row rather than new code. Each obeys the same contract as
every test in the spec: `RED(type)` · `GREEN` · `BLOCKED(reason)` · `N_A`.

| Key | Archetype | Asks | Tier | Characteristic silent failure |
| --- | --- | --- | --- | --- |
| **CEIL** | Ceiling | is it more than the rule allows? | row | a TEXT threshold compared to a number matches nothing; a threshold with no effective dating re-judges closed months |
| **ELIG** | Eligibility | did this person qualify at all? | row | reading a **profile-current** attribute to judge a historical payment |
| **CORR** | Corroboration | is there a record authorising this? | row | taking the first of several candidates; accepting a matched record without checking its **status** — a `CANCELED` request with the right amount otherwise passes |
| **RECOMP** | Recomputation | does the arithmetic reproduce the amount? | row | a confident wrong figure from a current rate — worse than none, because it looks like evidence |
| **PAIR** | Pairing | is the counter-entry there, and equal? | row | proving the counterpart was *created* and calling that recovery |
| **ROSTER** | Roster | is this person on the list? | row | defaulting — an empty list reds everything, a permissive default greens everything, both silently |
| **UNIQ** | Uniqueness | has this already been paid? | **set** | scanning one month when the entitlement window is longer |
| **RECON** | Reconciliation | does the set sum to an independently known figure? | **set** | comparing a *filtered* set against an *unfiltered* total, so the tie-out fails definitionally every period |
| **UNRULED** | No rule exists | — | null | being mistaken for a data gap and put in a backlog, where it waits forever |

🔴 **The row/set split is load-bearing.** UNIQ and RECON cannot be evaluated in a scalar expression
per note — they need the note's siblings, and their verdicts attach to a **group**: a duplicate group,
a referral event, a maid × payroll month. They run in a second pass.

### The check plan per payment type

This table is the configuration. Nothing below it knows what a payment type is.

| Payment type | Plan |
| --- | --- |
| `airfare_ticket` | ELIG · CEIL · UNIQ |
| `bonus` + purpose `referral_bonus` | ELIG · CORR · RECON · UNIQ |
| `bonus` + other purpose | CORR |
| `anti_attrition_incentive` | UNRULED |
| `prorated_salary`, `mv_prorated_salary`, `previously_held_salary`, `mv_extra_salary`, `last_day_cc_switch_adjustment` | RECOMP · ELIG |
| `salary_dispute` | CORR · UNRULED *(the justification half has no field)* |
| `raffle_prize` | ROSTER · CEIL · UNIQ |
| `taxi_reimbursement`, `medical_assistant`, `Maids_at_other_expenses`, `lost_luggage_compensation` | CORR · ROSTER |
| `forgive_deduction` | PAIR |
| `cover_deduction_limit`, `cover_negative_salary` | RECOMP |
| Accommodation Relocation | ELIG · PAIR |
| Sim card Loan, WPS Compliance Loan, PCR & medical Loan | PAIR · UNRULED |
| Live-out Transportation Assistance | ELIG · CEIL |
| `recommendation_from_client` | ROSTER · CEIL |
| `pay_vacation_days` | RECOMP |
| `renewal_bonus`, `low_exchange_rate_compensation`, `AR-1` | UNRULED |
| Part-Time Cleaners Expenses | — out of population pending the scope decision |
| `office_work_addition`, `refund` | RECON only — named lines in the payslip tie-out |

**Two archetypes run on every note regardless of type**, being properties of the population rather
than the payment: the payslip RECON at maid × audit month (the tie-out → M14), and the duplicate UNIQ
scan (→ M12).

### The two passes

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

verdict — unchanged: RED if any RED · AMBER if any BLOCKED · GREEN only if every applicable ran GREEN
```

🔴 **The safety property.** A payment type with no plan yields an **empty archetype set**, and an
empty set cannot satisfy *"every applicable check ran and returned GREEN"*. An unmapped type is
therefore **BLOCKED by construction**, not by anyone remembering to handle it. Since the payment-type
list is incomplete and the warehouse's category profile is truncated, new types **will** appear —
this property is what keeps them arriving as amber-with-a-reason instead of silent greens. **Do not
add a default branch.**


---

## Verified schema, 2026-09-09 — read by query, not inferred

Added after the first full live run. Everything here came back from `INFORMATION_SCHEMA` or a query
that ran. It supersedes any column list in this document that was written as an *ask* rather than an
*observation* — a distinction that cost this audit a wrong finding when a wish list was read as a
schema.

### `HOUSEMAID_MANAGER_NOTES` — eleven columns, entire

`ID · HOUSEMAID_ID · NOTE_TYPE · AMOUNT · NOTE_REASON · REASON · NOTE_DATE · MANAGER · EXPENSE_ID ·
REQUESTED_BY · APPROVED_BY`

**One timestamp only** (`NOTE_DATE`, and it is the payroll *due* date). `MANAGER` is NULL on every
bonus note. No `PURPOSE_ID`, `ADDITION_REASON_ID`, `CREATION_DATE`, `CREATOR`, `APPLIED`, `PAID`,
`PAYROLL_MONTH` or `IS_REFUND` — **none of N1–N6 landed.**

### The point-in-time tables — interval, not event

| Table | Columns | Use for |
|---|---|---|
| `HOUSEMAID_STATUS_LOGS` | `HOUSEMAID_ID, FROM_STATUS, TO_STATUS, CHANGE_DATE, NEXT_CHANGE_DATE, PREVIOUS_CHANGE_DATE, DESCRIPTION, ERP_USER` | status as of any date |
| `HOUSEMAID_TYPE_LOGS` | `HOUSEMAID_ID, FROM_TYPE, TO_TYPE, CHANGE_DATE, PREV_CHANGE_DATE, NEXT_CHANGE_DATE` | **N17 + N19** |
| `BI_HOUSEMAID_STATUS_LOGS` | above + `ERP_USER_NAME, HOUSEMAID_TYPE, MAID_NATIONALITY, EXCLUDED_NOSHOW_IN_ACCOMMODATION` | status with type attached |
| `FACT_MAID_TERMINATIONS` | `HOUSEMAID_ID, TERMINATION_DATE, TERMINATION_CATEGORY, LIVING_TYPE` | left-the-company date |

Status vocabulary is 34 values from 2018-02 to today, `WITH_CLIENT` among them — so **"was she placed
with a client on the day?" is one join**, not a model built from tagging events.

### `EXPENSES_CONFIGURATION` — the reference list, self-declared

31 heads with `SALARY_ADDITION_TYPE`, `CODE`, `CAPTION`, `EXPENSE_TYPE`, `CATEGORY`,
`TOP_PARENT_CATEGORY`, `STATUS`, `APPROVAL_METHOD`, `LIMIT_FOR_APPROVAL`, `LIMIT_FOR_CEO_APPROVAL`,
`REQUIRE_INVOICE`, `REQUIRE_ATTACHMENT`, `ALLOW_TO_ADD_LOAN`.

Join key to `EXPENSES_REQUESTS` is **`EXPENSE_TYPE`**, established by profiling.
⚠️ `EXPENSE_REQUEST_TASK_NAME` is a **workflow state** (`PAYMENT_OBJECT_CREATED` on 100% of rows), not
a category — joining on it matched nothing across 944 notes and read as a clean pass.

### Columns that exist and must not be used for a past date

`DATE_OF_TERMINATION` (not cleared on re-hire) · `ASSIGNED_OFFICE_WORK_REASON_ID` (never cleared —
57.4% of holders terminated, 0.8% in office-work status) · `HOUSEMAID_TYPE` · `LIVE_OUT`.
