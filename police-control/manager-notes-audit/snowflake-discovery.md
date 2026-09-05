# Snowflake discovery evidence — Manager Notes audit

Session date: 2026-09-05. Connector: standard **Snowflake** (not "Snowflake MCP").
Every claim below carries the statement that produced it. Nothing here is assumed.

## 0. Connection and the compute blocker

```sql
SELECT CURRENT_ACCOUNT(), CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_DATABASE();
-- IH42925 | PAYROLL_AND_MONEY_CONTROL_ROLE | (empty) | (empty)

SHOW WAREHOUSES;
-- 0 rows
```

**No warehouse is visible to this role, so no row can be read.** Metadata-only statements
(`SHOW DATABASES / SCHEMAS / OBJECTS / COLUMNS`, `GET_DDL`) run without compute and are the
only evidence available today. Everything below therefore proves **structure**, never
**content**: no row count, no freshness, no distribution, no join-cardinality check has been
run. Each such claim is marked `NEEDS COMPUTE`.

A useful accident: this warehouse's `ba_views` layer stores profiled metadata in the column
and table COMMENTs — `allowed_values`, `source_expression`, the extracted `WHERE` clause of
the dbt model, and the model's join list. That is second-hand evidence about content
(generated at build time from real data), and it is treated here as a strong lead, never as
a verified fact.

## 1. Databases and schemas visible to the role

```sql
SHOW DATABASES;
-- BA_VIEWS, MAIDSCCINSIGHTS, MARKETING, PAYROLL, SILVER, SNOWFLAKE,
-- SNOWFLAKE_INTELLIGENCE, USER$hassan.ahmed@maids.cc
```

`SHOW OBJECTS IN SCHEMA SILVER.PUBLIC` and `... MAIDSCCINSIGHTS.PUBLIC` both return 0 rows —
the role reads the curated **`BA_VIEWS`** layer, not the raw `SILVER`/`GOLD` databases the
views point at.

```sql
SHOW SCHEMAS IN DATABASE BA_VIEWS;   -- 39 schemas
-- relevant: HOUSEMAID_MANAGEMENT_SILVER, HOUSEMAID_MANAGEMENT_GOLD,
--           MONEY_CONTROL_SILVER, CORE_SILVER
SHOW SCHEMAS IN DATABASE PAYROLL;    -- CROSS_DOMAIN, PUBLIC, RAW_DATA
SHOW OBJECTS IN SCHEMA PAYROLL.RAW_DATA;
-- OFFICESTAFFPAYROLLLOGS, OFFICESTAFFS, OFFICESTAFFTODOS, PROFITNLOSS,
-- TRANSACTIONS, TRANSACTIONS_REVISIONS   (office-staff payroll — out of scope)
```

> Caution recorded for whoever runs this next: `SHOW OBJECTS IN SCHEMA <s>` returned a
> **truncated** list for `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER` (15 rows, alphabetically
> stopping at `HOUSEMAIDS_INFO`), yet `SHOW OBJECTS LIKE '%NOTE%' IN ACCOUNT` and
> `... STARTS WITH 'HOUSEMAID_M'` both returned objects from that same schema that the first
> listing omitted. Enumerate with `LIKE` / `STARTS WITH`, not with a bare schema listing, or
> you will conclude a table does not exist when it does.

## 2. The core table — D1

```sql
SHOW OBJECTS LIKE '%NOTE%' IN ACCOUNT;
-- BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES   (VIEW)
-- BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS (VIEW)
-- BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGER_NOTES (VIEW)
```

Table COMMENT on `HOUSEMAID_MANAGER_NOTES`, verbatim:

> "Payroll manager notes (salary additions and deductions). **Not** the ERP maid-notes screen
> — use `HOUSEMAID_MANAGERACTIONLOGS` for profile/manager notes entered at
> `staff-mgmt/v2/housemaid/maid-notes/{maid_id}`."

That settles two of the scope exclusions by name: `HOUSEMAID_MANAGERACTIONLOGS` is the
free-text profile-note screen (out of scope, no money), and `CLIENT_MANAGER_NOTES` is the
client-side record (out of scope, opposite direction).

`SHOW COLUMNS IN VIEW BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES`:

| Column | Type | Profiled `allowed_values` | Source expression |
|---|---|---|---|
| `ID` | NUMBER(38,0) | 5–183975 | `p.ID` |
| `HOUSEMAID_ID` | NUMBER(38,0) | 1–138006 | `p.HOUSEMAID_ID` |
| `NOTE_TYPE` | TEXT | `DEDUCTION, ADDITION, PENALTY_DEDUCTION` | `p.NOTE_TYPE` |
| `AMOUNT` | FLOAT | −3032 – 44230.26 | `p.AMOUNT` |
| `NOTE_REASON` | TEXT | free text | `p.NOTE_REASONE` (sic — typo is in the source) |
| `REASON` | TEXT | free text | `COALESCE(a.NAME, d.NAME)` from `mmdb.picklists_items` |
| `NOTE_DATE` | TIMESTAMP_NTZ | min `2016-11-21` | `p.NOTE_DATE` |
| `MANAGER` | NUMBER(38,0) | **"no non-null values"** | `p.EMPLOYEE_MANAGER_ID` |
| `REQUESTED_BY` | TEXT | free text | `ep.REQUESTED_BY` |
| `APPROVED_BY` | TEXT | free text | `ep.APPROVED_BY` |

`GET_DDL` exposes the model's own SQL, extracted into the table COMMENT:

```
FROM payrollmanagernotes p
LEFT JOIN mmdb.picklists_items a ON a.ID = p.ADDITION_REASON_ID
LEFT JOIN mmdb.picklists_items d ON d.ID = p.DEDUCTION_REASON_ID
LEFT JOIN EXPENSE_P ep ON ep.HOUSEMAID_ID = p.HOUSEMAID_ID
                      AND ep.EXPENSE_ID   = p.EXPENSE_ID
WHERE p.HOUSEMAID_ID IS NOT NULL          -- and, in the expense_p CTE:
                                          -- RELATED_TO_TYPE = 'MAID'
```
Sources: `mmdb_transformed.payrollmanagernotes`, `mmdb.expensepayments`,
`mmdb.picklists_items`. Downstream: `BA_VIEWS.HOUSEMAID_MANAGEMENT_GOLD.`
`BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY`.

Four things follow, and three of them are defects:

1. **`REASON` is the payment type.** It resolves the addition-reason picklist item name. A
   note with no payment type recorded surfaces as `REASON IS NULL`.
2. **`MANAGER` is dead.** Profiled as having no non-null values. The note carries no usable
   author, so "who made this addition" is not answerable from this view. → ingestion item.
3. **The expense link is a heuristic and it can fan out.** The join key is
   `HOUSEMAID_ID + EXPENSE_ID`, and `EXPENSE_ID` is an expense **category**, not a payment.
   One maid with two payments in the same category matches both, so a `LEFT JOIN` with no
   visible `QUALIFY`/dedup can emit **more rows than notes**. The audit's whole grain rests
   on one row = one note. `NEEDS COMPUTE`: assert
   `COUNT(*) = COUNT(DISTINCT ID)` before anything else is built.
4. **`EXPENSE_ID` is used in the join but never selected**, so downstream consumers cannot
   see or re-check the link. → ingestion item.

## 3. The GOLD model that already aggregates additions — and its suspected join bug

`GET_DDL('VIEW','BA_VIEWS.HOUSEMAID_MANAGEMENT_GOLD.BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY')`
records this join and filter:

```
INNER JOIN expense_payment_methods epm
        ON epm.related_to_id_text = to_varchar(n.id)     -- n = HOUSEMAID_MANAGER_NOTES
WHERE upper(trim(er.payment_method)) IN ('CASH','SALARY')
  AND upper(trim(er.related_to_type)) = 'MAID'
  AND er.related_to_id IS NOT NULL
```

But the column COMMENT on `EXPENSES_REQUESTS.RELATED_TO_ID` states the opposite meaning:

> "when `RELATED_TO_TYPE = 'MAID'`, joins to `housemaids.ID`"

So one side is wrong: the GOLD model equates `RELATED_TO_ID` with a **manager-note ID**,
while the documented semantics make it a **housemaid ID**. Both are integers over
overlapping ranges (`RELATED_TO_ID` 0–2076983; note `ID` 5–183975; `HOUSEMAID_ID` 1–138006),
so a wrong reading matches plenty of rows and raises no error — it silently attributes
payments to the wrong entity. Consistent with this, **every column of that GOLD view is
profiled `"no non-null values"`**, i.e. the aggregate looks empty.

`NEEDS COMPUTE` to resolve; until then this join is **not** reused, and the GOLD model is
**not** treated as a source. Recorded as a defect for the Data team either way — one of the
two artefacts is wrong today.

## 4. Payslip anchor and the tie-out — D2

```sql
SHOW OBJECTS LIKE '%PAYROLL%' IN ACCOUNT;
-- BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY   (VIEW)
-- + 8 BI_PAYROLL_* GOLD aggregates, + PAYROLL.RAW_DATA.OFFICESTAFFPAYROLLLOGS
```

`HOUSEMAID_PAYROLL_HISTORY`, from `mmdb.housemaidpayrolllogs` — one row per maid × payroll
month:

| Column | Type | Profiled values | Source |
|---|---|---|---|
| `HOUSEMAID_ID` | NUMBER | 2–136828 | `hp.HOUSEMAID_ID` |
| `PAYROLL_MONTH` | DATE | min `2020-07-01` | `hp.PAYROLL_MONTH` |
| `ADDITIONS` | FLOAT | −1516 – 8800 | `hp.MANAGER_ADDITIONS` |
| `DEDUCTIONS` | FLOAT | 0 – 2800 | `hp.TOTAL_DEDUCTION` |
| `TOTAL_SALARY` | FLOAT | 0 – 13000 | `hp.TOTAL_EARNINGS` |
| `NET_SALARY` | FLOAT | 0 – 13200 | `hp.TOTAL_SALARY` |
| `PAID_ON_DATE` | **TEXT** | free text | `hp.PAID_ON_DATE` |
| `PAID_ON_DATE_FORMATTED` | DATE | min `2020-08-04` | `COALESCE(TRY_TO_DATE(...,'YYYY-MM-DD'), TRY_TO_DATE(...,'DD MONTH, YYYY'), TRY_TO_DATE(...,'DD MON, YYYY'))` |
| `IS_TRANSFERRED` | **TEXT** | `YES, NO` | `IFF(hp.TRANSFERRED=1,'YES','NO')` |
| `AUTOMATIC_EXCLUSION_REASONS` | TEXT | long free-text list | `hp.AUTOMATIC_EXCLUSION_REASONS` |
| `STATUS` | TEXT | 20 maid-status values | `hp.STATUS` |

This is the single most valuable find after the notes table itself:

- `ADDITIONS` (= `MANAGER_ADDITIONS`) is the payslip's own total of manager additions for
  that maid and month, which makes a **real tie-out** possible: the notes we audit must sum
  to it. Any gap is itself an exception row.
- `PAID_ON_DATE_FORMATTED` + `IS_TRANSFERRED` give the **paid-month window** the audit is
  supposed to use — but only at maid × month grain, never per note.
- Type traps to state in the spec: `PAID_ON_DATE` is TEXT parsed by a three-format
  `TRY_TO_DATE` chain (a fourth format silently yields NULL, not an error), and
  `IS_TRANSFERRED` is TEXT `'YES'/'NO'`, so `= TRUE` matches nothing.

## 5. Maid profile — D3

`SHOW COLUMNS IN VIEW BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` (114 columns).
The ones this audit needs:

| Column | Type | Profiled values | Use |
|---|---|---|---|
| `ID` | NUMBER | 1–138554 | join key to the note |
| `HOUSEMAID_TYPE` | TEXT | `Normal, MAID_VISA, FREEDOM_OPERATOR, WALKIN` | contract type (CC vs MV) |
| `NATIONALITY` | TEXT | free text | flight-home cap lookup |
| `NATIONALITY_CATEGORY` | TEXT | `Filipina, African, Ethiopian, Other` | coarse nationality grouping |
| `START_DATE` | TIMESTAMP_NTZ | min `1970-01-01` | length of service |
| `SALARY_STARTING_DATE` | TIMESTAMP_NTZ | min `1970-01-01` | `COALESCE(REPLACEMENT_SALARY_START_DATE, START_DATE)` |
| `NET_HIRED_DATE` | TIMESTAMP_NTZ | min `2018-02-03` | length of service (alternative) |
| `DATE_OF_TERMINATION` | TIMESTAMP_NTZ | min `2015-09-05` | final-salary window |
| `MODE_OF_TERMINATION` | TEXT | `QUIT, FIRED, NON_RENEWAL, RESIGNATION, CONVERTED_TO_MAIDSAE` | final-salary rule |
| `IS_DELETED` | **TEXT** | `00, 01` | hygiene — `= TRUE` matches nothing |
| `EXCLUDED_FROM_PAYROLL` | **TEXT** | `00, 01` | hygiene |
| `BASIC_SALARY` / `PRIMARY_SALARY` | FLOAT | 0–10000 / 0–3510 | salary recalculation — **current value only** |
| `LAST_PAYROLL_LOCK_DATE` | TIMESTAMP_NTZ | **"no non-null values"** | dead column — cannot gate on payroll lock |
| `EID` | TEXT | **"no non-null values"** | dead column |

Four consequences:

- `HOUSEMAID_TYPE` has **four** values, not two. `FREEDOM_OPERATOR` and `WALKIN` are neither
  CC nor MV, so a contract-type eligibility rule written as "if MV then … else CC rule"
  silently treats them as CC. They must route to amber.
- `START_DATE` and `SALARY_STARTING_DATE` both bottom out at `1970-01-01` — an epoch-zero
  sentinel standing in for "unknown". Length-of-service arithmetic on those rows is
  nonsense and must be caught, not computed.
- `BASIC_SALARY` / `PRIMARY_SALARY` are **profile-current**, with no effective-dated history
  in this view. Recomputing a part-month salary for a past month needs the salary in force
  *then*. That is the gap, not the absence of a salary column.
- `LAST_PAYROLL_LOCK_DATE` is empty, so a "was the month locked" gate cannot be built here.

## 6. The expense side — D4

```sql
SHOW OBJECTS IN SCHEMA BA_VIEWS.MONEY_CONTROL_SILVER;
-- BUCKETS_CONFIGURATION, BUCKETS_HISTORICAL_CONFIG, DAILY_BUCKETS_REFILL,
-- DUPLICATE_EXPENSES, EXPENSES_CONFIGURATION, EXPENSES_HIERARCHY, EXPENSES_PAYMENTS,
-- EXPENSES_REFUNDS_HISTORY, EXPENSES_REQUESTS, EXPENSE_REQUEST_TICKETS,
-- EXPENSE_REQ_TRANSACTIONS_LINKING, FAMILY_REFUNDS, FAMILY_REFUNDS_TASKS,
-- FAMILY_REFUND_DETAILS, LOST_TICKETS_EXPENSES_DETAILS, MONEY_CONTROL_DOCUMENTS,
-- PDC_CASES
```

`SHOW COLUMNS IN VIEW BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` (38 columns) — the
audit-relevant ones:

| Column | Type | Profiled values |
|---|---|---|
| `ID` | NUMBER | 1–155903 |
| `EXPENSE_TYPE` | TEXT | free text — name from `mmdb.expenses` (**the expense head**) |
| `RELATED_TO_TYPE` | TEXT | `TEAM, APPLICANT, MAID, OFFICE_STAFF` |
| `RELATED_TO_ID` | NUMBER | 0–2076983 (polymorphic — see §3) |
| `REQUEST_STATUS` | TEXT | `PAID, REJECTED, DISMISSED, PENDING_PAYMENT, CANCELED, PENDING` |
| `AMOUNT` | FLOAT | −2127 – 222033744263 |
| `REFUNDED` / `REFUND_AMOUNT` / `REFUND_DATE` | BOOLEAN / FLOAT / TIMESTAMP | `IFF(ert.is_refunded=1,TRUE,FALSE)` |
| `BENEFICIARY_TYPE` | TEXT | `SUPPLIER, MAID, OFFICE_STAFF, TAXI_DRIVER, NOT_DETERMINED` |
| `BENEFICIARY_NAME` | TEXT | prefixed labels, or `''` sentinel (not NULL) |
| `APPROVED_BY` | TEXT | free text — a **name**, not a user id |
| `REQUESTED_BY` | TEXT | free text — `mmdb.users.FULL_NAME` |
| `PAYMENT_METHOD` | TEXT | `CREDIT_CARD, SALARY, CASH, INVOICED, BANK_TRANSFER, MONEY_TRANSFER` |
| `CURRENCY_NAME` | TEXT | `AED, USD, SAR, PHP, QAR, KWD, HKD, OMR, BHD, EUR` |
| `EXPENSE_PAYMENT_ID` | NUMBER | 1–149606 |
| `STATUS_CHANGE_DATE` | TIMESTAMP_NTZ | **min `2025-12-16`** |
| `CREATION_DATE` | TIMESTAMP_NTZ | min `2021-10-21` |

Three findings that change the design:

1. **A silent blind spot.** The `EXPENSE_TYPE` column doc states: *"Requests whose expense
   category is marked secure (`is_secure = 1`) are **excluded from this table entirely**."*
   So a note backed by a secure category looks identical to a note backed by nothing. Those
   notes must be **amber (evidence unavailable)**, never red ("no basis") and never green.
2. **Multi-currency is real** — ten currencies. An amount-agreement test that compares a note
   in AED against a request in PHP without FX is wrong, not approximately right.
3. `STATUS_CHANGE_DATE` only starts in Dec 2025 — history is truncated, so it cannot date
   approvals for an earlier audit month. `CREATION_DATE` (from Oct 2021) can.
4. `AMOUNT` reaching 2.2 × 10¹¹ is a data-quality outlier that will dominate any
   "amount at risk" total if not handled. `NEEDS COMPUTE` to size.

## 7. Reference data for the group rules

```sql
SHOW OBJECTS LIKE '%RAFFLE%'  IN ACCOUNT;  -- 0 rows
SHOW OBJECTS LIKE '%REFERRAL%' IN ACCOUNT; -- 10 rows
SHOW OBJECTS LIKE '%TICKET%'   IN ACCOUNT; -- 7 rows
SHOW OBJECTS LIKE '%VACATION%' IN ACCOUNT; -- 1 row
SHOW OBJECTS LIKE '%INSIGHTS%' IN ACCOUNT; -- INSIGHTS_DASHBOARD_CONTAINER, ...
SHOW OBJECTS LIKE '%PICKLIST%' IN ACCOUNT; -- CORE_SILVER.PICKLISTS_INFO, ...
```

- **Raffle: nothing exists.** Zero objects account-wide. The winners list is not in the
  warehouse under that name.
- **Referral: real reference data exists.**
  `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_BONUSES` is built from the *same*
  `mmdb_transformed.payrollmanagernotes` source, filtered
  `v.NOTE_TYPE = 'ADDITION' AND pi3.NAME = 'Referral bonus' AND v.AMOUNT != 0 AND v.AMOUNT IS NOT NULL`,
  joined to `HOUSEMAID_REFERRALS` and to picklists on both `ADDITION_REASON_ID` **and**
  `PURPOSE_ID`. Two things follow: the exact picklist name `'Referral bonus'` is confirmed,
  and the source note table carries a `PURPOSE_ID` that `HOUSEMAID_MANAGER_NOTES` does not
  expose. `HOUSEMAID_REFERRALS` adds bonus-requested and cancelled dates.
  What is still missing is the **scheme price** — the amount a referral was worth on a given
  date. No price table found.
- **Flight home:** `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS`
  (`mmdb.tickets`) has `TICKET_TYPE ∈ {TO_DUBAI, TO_EXIT, TO_MANILA, TERMINATION,`
  `PREWORK_VACATION, VACATION, OFFICE_STAFF, OFFICE_TICKET}`, `BUYER ∈ {PRIVATE, MAIDCC}`,
  `ORIGINAL_FARE`, `FARE_IN_REF_CURRENCY`, `EXCHANGE_RATE`, `PURCHASE_DATE`, `REFUNDED`,
  `IS_LATEST_HM_TICKET`, and `IS_DELETED` as TEXT `'00'/'01'`. `ID` tops out at 14,564 — a
  small table; `NEEDS COMPUTE` to check whether it is still being written to.
  This proves *a ticket was bought*, which is what a duplicate test needs (cash in lieu paid
  **and** a ticket purchased). It does **not** carry the **nationality cap** — no such price
  list exists in the warehouse.
- `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_VACATIONS` (`mmdb.housemaidvacations`)
  exists, for the repeating-cycle part of the flight rule.
- `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` is the picklist reference — the source of the
  payment-type names. It is what would enumerate the 24 addition reasons. `NEEDS COMPUTE`.

## 8. Approved KPI check — not performed

`BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` **exists** (confirmed by
`SHOW OBJECTS LIKE '%INSIGHTS%' IN ACCOUNT`), but reading it requires compute. The mandated
check for an approved definition of any metric in this spec is therefore **outstanding, not
negative**. No metric here may be called an approved KPI until that query has run; all are
labelled new Police & Control definitions pending that check.

## 9. Verdict summary

| # | Data point | Verdict | Location |
|---|---|---|---|
| D1 | Manager notes (additions) | **PARTIAL** | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` — missing applied / paid / refund / expense-id / author |
| D2 | Payslip month + additions total | **EXISTS (wrong grain)** | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` — maid × month, not per note |
| D3 | Maid profile, contract type, nationality, service dates | **EXISTS** | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` |
| D4 | Authorising expense record | **PARTIAL** | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` — secure categories excluded; link is heuristic |
| D5 | Expense head | **EXISTS** | `…MONEY_CONTROL_SILVER.EXPENSES_REQUESTS.EXPENSE_TYPE` (+ `EXPENSES_HIERARCHY`) |
| D6 | Referral scheme evidence | **PARTIAL** | `…MAIDS_REFERRALS_BONUSES`, `…HOUSEMAID_REFERRALS` — no scheme price |
| D7 | Flight tickets purchased | **PARTIAL** | `…HOUSEMAIDS_TICKETS` — freshness unverified; no nationality cap |
| D8 | Payment-type picklist | **EXISTS** | `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` |
| N1–N13 | applied/paid/refund flags, note author, internal auditor sign-off, effective-dated salary, flight cap, scheme prices, raffle winners, loyalty rule | **MISSING** | see spec §2.3 |

**No verdict in this table rests on a single row of data.** Each is a structural claim from
metadata. Re-run §0 with a warehouse granted, then confirm every `NEEDS COMPUTE` marker
before the first number is published.
