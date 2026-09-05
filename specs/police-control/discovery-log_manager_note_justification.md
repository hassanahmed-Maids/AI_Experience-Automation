# Discovery log — Manager Note Justification audit

Session 2026-09-05. Snowflake account `IH42925`, role `PAYROLL_AND_MONEY_CONTROL_ROLE`.

## Preflight

| Dependency | Status |
| --- | --- |
| Snowflake connector | Connected. **No warehouse granted to the role** — see blocker B1. |
| Ask the Code token | Not yet requested; needed once gaps are confirmed. |

### B1 — BLOCKER: no compute warehouse

`SHOW WAREHOUSES` returns 0 rows. `SHOW GRANTS TO ROLE PAYROLL_AND_MONEY_CONTROL_ROLE`
contains no `WAREHOUSE` grant. `SHOW GRANTS TO USER` confirms the user holds exactly one
role and no warehouse.

Consequence: metadata queries (`SHOW ...`) work, and `SELECT COUNT(*)` works because
Snowflake answers it from table metadata without compute. **Any `GROUP BY`, filter, join or
aggregate fails** with:

> Unable to run the command. You must specify the warehouse to use...

So row counts by category, freshness, grain checks, null rates, and coverage over the audit
period are all currently unverifiable. Needs `GRANT USAGE ON WAREHOUSE <wh> TO ROLE
PAYROLL_AND_MONEY_CONTROL_ROLE`.

## Access map

| Database | Visible to this role? | Usable? |
| --- | --- | --- |
| `BA_VIEWS` | Yes — 39 schemas | **Yes, this is the working set** |
| `PAYROLL` | Yes — `RAW_DATA`, `CROSS_DOMAIN` | **No.** Its 6 views select from `PC_FIVETRAN_DB.MMDB_TRANSFORMED.*`, which this role is not authorised for. Every view raises `Object 'PC_FIVETRAN_DB...' does not exist or not authorized`. Dead end. |
| `SILVER`, `MAIDSCCINSIGHTS` | Database visible; only `PUBLIC` + `INFORMATION_SCHEMA` schemas exposed | No |
| `SNOWFLAKE.ACCOUNT_USAGE` | Not authorised | No |

`INFORMATION_SCHEMA.TABLES/COLUMNS` also requires a warehouse, so schema exploration is via
`SHOW` commands only.

## The core table — VERIFIED EXISTS

`BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES`

- **134,834 rows** (`SELECT COUNT(*)`, metadata-served).
- Built over an mmdb CTE named `payrollmanagernotes`.
- Grain: appears to be one row per note — matches "one case is one note". **Uniqueness of `ID`
  not yet verified** (needs warehouse).

| Column | Type | Notes from column metadata |
| --- | --- | --- |
| `ID` | NUMBER | Range 5–183975. `p.ID` |
| `HOUSEMAID_ID` | NUMBER | Range 1–138006. Join key to the maid |
| `NOTE_TYPE` | TEXT | **Allowed values: `DEDUCTION`, `ADDITION`, `PENALTY_DEDUCTION`** — the scope filter is `NOTE_TYPE = 'ADDITION'`, and it cleanly excludes both out-of-scope deduction kinds |
| `AMOUNT` | REAL (FLOAT) | **Range −3032 to 44230.26** — negatives confirmed present, as the scope expects |
| `NOTE_REASON` | TEXT | Free text, from `p.NOTE_REASONE` (sic). The stated reason |
| `REASON` | TEXT | `COALESCE(a.NAME, d.NAME)` from `mmdb.picklists_items` — **this is the payment-type picklist**, the field the group rules branch on |
| `NOTE_DATE` | TIMESTAMP_NTZ | Min 2016-11-21 |
| `MANAGER` | NUMBER | From `p.EMPLOYEE_MANAGER_ID`. Metadata says **"no non-null values"** — the column is entirely empty |
| `REQUESTED_BY` | TEXT | From `USERS_INFO.NAME` via `ep.REQUESTED_BY` |
| `APPROVED_BY` | TEXT | From **`mmdb.expensepayments.APPROVED_BY`** via `ep.` |

## The expense side — VERIFIED EXISTS

`BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` (38 columns), over
`mmdb_transformed.expenserequesttodos`. Carries everything the ladder's expense tests need:

- `ID` (1–155903), `EXPENSE_PAYMENT_ID`, `TRANSACTION_ID`, `LOAN_TRANSACTION_ID`
- `EXPENSE_TYPE` — the expense head, from `mmdb.expenses.name`
- `RELATED_TO_TYPE` (`TEAM`/`APPLICANT`/`MAID`/`OFFICE_STAFF`) + `RELATED_TO_ID` — polymorphic;
  **must filter `RELATED_TO_TYPE='MAID'` before joining `RELATED_TO_ID` to a maid**
- `BENEFICIARY_TYPE` (`SUPPLIER`/`MAID`/`OFFICE_STAFF`/`TAXI_DRIVER`/`NOT_DETERMINED`) + `BENEFICIARY_NAME`
- `REQUEST_STATUS` — `PAID`, `REJECTED`, `DISMISSED`, `PENDING_PAYMENT`, `CANCELED`, `PENDING`
- `APPROVED_BY`, `REQUESTED_BY`, `PENDING_FOR_APPROVAL`
- `AMOUNT`, `VAT_AMOUNT`, `LOAN_AMOUNT`, `REFUNDED` (bool), `REFUND_AMOUNT`, `REFUND_DATE`
- `CURRENCY_NAME`, `PAYMENT_METHOD` (incl. `SALARY`), `BUCKET_NAME`

Sibling views also present in `MONEY_CONTROL_SILVER`: `EXPENSES_PAYMENTS`,
`EXPENSES_CONFIGURATION`, `EXPENSES_HIERARCHY`, `DUPLICATE_EXPENSES`,
`EXPENSE_REQ_TRANSACTIONS_LINKING`, `EXPENSES_REFUNDS_HISTORY`, `UNMATCHED_EXPENSES_REFUNDS`.

## Other views likely needed (existence confirmed, columns not yet read)

`HOUSEMAID_MANAGEMENT_SILVER`: `HOUSEMAIDS_INFO`, `HOUSEMAID_PAYROLL_HISTORY`,
`HOUSEMAID_REFERRALS` / `_ENRICHED`, `MAIDS_REFERRALS_BONUSES`, `MAIDS_REFERRALS_JOINERS_INFO`,
`HOUSEMAID_VACATIONS`, `HOUSEMAID_FINAL_SETTLEMENT_DETAILS_SHEET`, `FACT_MAID_TERMINATIONS`,
`HOUSEMAID_STATUS_LOGS`, `HOUSEMAID_TYPE_LOGS`, `WPS_RECORDS`,
`HOUSEMAID_OUTSTANDING_BALANCE_DETAILS`, `HOUSEMAID_MANAGERACTIONLOGS`.

## Gaps found so far

| # | Gap | Why it matters |
| --- | --- | --- |
| G1 | **No expense-record foreign key on the note.** `HOUSEMAID_MANAGER_NOTES` exposes `REQUESTED_BY`/`APPROVED_BY` sourced from `mmdb.expensepayments`, so the underlying model *does* reach a payment — but no `EXPENSE_REQUEST_ID` / `EXPENSE_PAYMENT_ID` column is exposed. The ladder's "does it point at an authorised expense record" test has no join key. | Blocks tests 5, 6 and the reimbursement group rule |
| G2 | **`EXPENSES_REQUESTS` silently drops secure expense heads.** Column metadata: *"Requests whose expense category is marked secure (`is_secure = 1`) are excluded from this table entirely."* | An audit built on this view cannot see notes backed by a secure expense head. They would fall to amber at best, or be miscalled. Completeness hole |
| G3 | **No applied / paid / refund flags on the note.** Scope is "applied, actually paid, and isn't a refund". None of those three predicates has a column in the notes view. | The in-scope population cannot be constructed as specified |
| G4 | **Payroll month ≠ `NOTE_DATE`.** Scope says "taken by the month it was paid in". `NOTE_DATE` is the note's own date; the payslip month it landed in is not exposed. | Period assignment is undefined; a note near a month boundary lands in the wrong audit month |
| G5 | **`MANAGER` is entirely NULL.** | Cannot attribute a note to the manager who raised it; no repeat-offender view by manager. `REQUESTED_BY` may substitute but is sourced from the payment, not the note |
| G6 | **Contract type (CC vs MV) is not on the note.** Needed by the "payment this contract type can receive" test. Presumably in `HOUSEMAIDS_INFO`; must be the type **as at the payment month**, not current — `HOUSEMAID_TYPE_LOGS` may be required | Test 8 and several group rules |
| G7 | **Multi-currency.** `EXPENSES_REQUESTS.CURRENCY_NAME` spans AED, USD, SAR, PHP, QAR, KWD, HKD, OMR, BHD, EUR. The note `AMOUNT` currency is unstated. | "Amount agrees with the expense record" is undefined across currencies without an FX basis |
| G8 | **Outlier/junk amounts.** `EXPENSES_REQUESTS.AMOUNT` max is 222,033,744,263 and `LOAN_AMOUNT` matches it. | A max like that is a data-quality artefact; any "amount above what was allowed" test will rank it first unless handled |
| G9 | **`STATUS_CHANGE_DATE` min is 2025-12-16.** | The column looks recently introduced. Historical status timing is unavailable before that date |
| G10 | **No rule-source data located yet** for: nationality flight-home caps, length-of-service and cycle, referral/signing scheme prices, raffle winners list, loyalty (user states no written rule exists anywhere). | These are the authorised values the audit compares against. Without them the group rules cannot run — and per the blocking rule, every affected note goes amber, not green |
