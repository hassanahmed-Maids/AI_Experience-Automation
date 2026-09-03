# Snowflake verification queries — payroll critical checks spec

Ten queries that close open items in `SPEC_housemaid_payroll_critical_checks_v2.md`. They exist
because the spec's role (`PAYROLL_AND_MONEY_CONTROL_ROLE`) has no warehouse grant, so its claims
about freshness, grain and value distributions are asserted from metadata rather than measured —
open item **O1**, and the subject of **DNA-9437**.

**For whoever runs these.**

- **Every query returns aggregates only** — counts, distinct counts, min/max dates, value
  distributions. None returns a name, a bank account, a MOHRE ID or an individual's salary.
- **Please send back the result sets as they come out.** If any query is edited in a way that
  makes it return row-level personal data, don't run it and tell us instead — the whole point is
  that these answers can be shared without handling PII.
- Run against `BA_VIEWS`. Read-only throughout. Q4 is the heaviest and still trivial.
- They are independent; partial answers are useful.

---

## Q1 — Grain and freshness of the payroll table *(O1)*

Is `HOUSEMAID_PAYROLL_HISTORY` really one row per maid per payroll month, and how current is it?
The whole spec assumes this grain and it is currently unverified — the dbt model declares no
`table_grain`.

```sql
SELECT COUNT(*)                                                              AS rows_total,
       COUNT(DISTINCT HOUSEMAID_ID::VARCHAR || '|' || PAYROLL_MONTH::VARCHAR) AS distinct_maid_months,
       COUNT(*) - COUNT(DISTINCT HOUSEMAID_ID::VARCHAR || '|' || PAYROLL_MONTH::VARCHAR) AS duplicate_rows,
       MIN(PAYROLL_MONTH)                                                     AS first_month,
       MAX(PAYROLL_MONTH)                                                     AS latest_month
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY;
```

**Tells us:** whether the grain holds (`duplicate_rows = 0`), and whether the table is current
enough for a monthly audit.

---

## Q2 — Deletion-flag polarity *(O15, blocking)*

`IS_DELETED` and `EXCLUDED_FROM_PAYROLL` are `VARCHAR '00'`/`'01'` with no documented meaning.
Guessing wrong empties the population — which the run aborts on above 100 rows, or passes silently
below. The `WITH_CLIENT` column is the tell: live maids are the side that has them.

```sql
SELECT IS_DELETED,
       COUNT(*)                              AS maids,
       COUNT_IF(STATUS = 'WITH_CLIENT')      AS with_client
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO
GROUP BY 1 ORDER BY 2 DESC;

SELECT EXCLUDED_FROM_PAYROLL,
       COUNT(*)                              AS maids,
       COUNT_IF(STATUS = 'WITH_CLIENT')      AS with_client
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO
GROUP BY 1 ORDER BY 2 DESC;

SELECT TRASHED, COUNT(*) AS wps_rows
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.WPS_RECORDS
GROUP BY 1 ORDER BY 2 DESC;
```

**Tells us:** which literal means "keep this row" for each of the three flags.

---

## Q3 — Does the account classifier ever emit its rarer values? *(O24)*

The ERP's Java classifier has seven outcomes. The Snowflake column is a **dbt re-implementation**
of it, and its profiled metadata lists only five — `PAYROLL_CARD` and `OVER_THE_COUNTER` are
absent. If the dbt CASE drops those branches, those accounts collapse to `''` and become invisible
to the diversion check.

```sql
SELECT ANSARI_PAYMENT_METHOD,
       COUNT(*)                    AS payroll_rows,
       COUNT(DISTINCT HOUSEMAID_ID) AS maids
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY
WHERE PAYROLL_MONTH >= DATEADD(month, -6, DATE_TRUNC(month, CURRENT_DATE))
GROUP BY 1 ORDER BY 2 DESC;
```

**Tells us:** whether those two values occur, and how large the unclassified `''` bucket is — a
large one means the classifier is losing accounts.

**Also, and easier than any query:** please paste the `ANSARI_PAYMENT_METHOD` CASE expression from
the `SILVER.HOUSEMAID_MANAGEMENT.HOUSEMAID_PAYROLL_HISTORY` dbt model. We need to compare it
against the ERP's `Housemaid.getAnsariPaymentMethod()`, and the `BA_VIEWS` view is only a
passthrough so the expression isn't visible to us.

---

## Q4 — Check 9 back-test and base rate *(O24 — the acceptance test)*

The ERP records no fraud or diversion case anywhere, so there is no labelled example to test the
diversion check against. The monthly snapshots imply the change events instead. This replays the
check over 12 months.

It also answers the question that decides whether the check is usable at all: **how many red-flag
transitions occur in a normal month?** If it is thousands, "Red at ≥ 1" buries P&C and the
threshold needs rethinking before go-live.

```sql
WITH m AS (
  SELECT EMPLOYEE_UNIQUE_ID,
         PAYROLL_MONTH,
         UPPER(TRIM(EMPLOYEE_ACCOUNT_WITH_AGENT)) AS acct,
         ANSARI_PAYMENT_METHOD                    AS method
  FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY
  WHERE PAYROLL_MONTH >= DATEADD(month, -13, DATE_TRUNC(month, CURRENT_DATE))
    AND EMPLOYEE_UNIQUE_ID IS NOT NULL
),
p AS (
  SELECT *,
         LAG(acct)   OVER (PARTITION BY EMPLOYEE_UNIQUE_ID ORDER BY PAYROLL_MONTH) AS prev_acct,
         LAG(method) OVER (PARTITION BY EMPLOYEE_UNIQUE_ID ORDER BY PAYROLL_MONTH) AS prev_method
  FROM m
)
SELECT PAYROLL_MONTH,
       COUNT(*)                                                                          AS compared,
       COUNT_IF(acct <> prev_acct)                                                       AS accounts_changed,
       COUNT_IF(prev_method = 'BANK_TRANSFER'    AND method = 'DU_PAY_CARD')              AS rf1_bank_to_dupay,
       COUNT_IF(prev_method = 'BANK_TRANSFER'    AND method = 'ANSARI_VISA_CARD')         AS rf2_bank_to_ansari,
       COUNT_IF(prev_method = 'DU_PAY_CARD'      AND method = 'DU_PAY_CARD'
                AND acct <> prev_acct)                                                    AS rf3_dupay_to_dupay,
       COUNT_IF(prev_method = 'DU_PAY_CARD'      AND method = 'ANSARI_VISA_CARD')         AS rf4_dupay_to_ansari,
       COUNT_IF(prev_method = 'ANSARI_VISA_CARD' AND method = 'ANSARI_VISA_CARD'
                AND acct <> prev_acct)                                                    AS rf5_ansari_to_ansari
FROM p
WHERE prev_acct IS NOT NULL AND prev_acct <> ''
  AND acct      IS NOT NULL AND acct      <> ''
GROUP BY 1 ORDER BY 1;
```

**Tells us:** the monthly base rate of each red-flag transition, and whether the detector fires at
all. Counts only — no accounts leave the warehouse.

---

## Q5 — Is the monthly client payment really absent? *(validates N2)*

The spec says `CLIENT_MANAGEMENT_PAYMENTS` admits only six payment types and the recurring monthly
payment is not among them, which is what blocks checks 6 and 10. This confirms it from data rather
than from column metadata.

```sql
SELECT PAYMENT_TYPE,
       COUNT(*)               AS payments,
       MIN(DATE_OF_PAYMENT)   AS first_payment,
       MAX(DATE_OF_PAYMENT)   AS last_payment
FROM BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGEMENT_PAYMENTS
GROUP BY 1 ORDER BY 2 DESC;
```

**Tells us:** whether the ingestion request N2 is real, or whether the monthly payment is already
there under a name we did not recognise.

---

## Q6 — Contract link coverage *(D7, O13)*

The contract data was found late and its join to payroll is unverified. Replace the date with a
recent closed payroll month.

```sql
SELECT c.CONTRACT_TYPE,
       c.CONTRACT_STATUS,
       COUNT(DISTINCT c.ID) AS contracts
FROM BA_VIEWS.SALES_SILVER.CONTRACTS c
WHERE c.FAKE = FALSE AND c.IGNORE_IN_REPORTING = 0
GROUP BY 1, 2 ORDER BY 3 DESC;

SELECT COUNT(DISTINCT p.HOUSEMAID_ID)                                AS maids_on_payroll,
       COUNT(DISTINCT CASE WHEN c.ID IS NOT NULL THEN p.HOUSEMAID_ID END) AS maids_with_a_contract,
       COUNT(DISTINCT c.ID)                                          AS contracts_matched
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY p
LEFT JOIN BA_VIEWS.SALES_SILVER.CONTRACTS c
       ON c.HOUSEMAID_ID = p.HOUSEMAID_ID
      AND c.FAKE = FALSE
      AND c.IGNORE_IN_REPORTING = 0
WHERE p.PAYROLL_MONTH = '2026-07-01';        -- ← set to a recent closed month
```

**Tells us:** the CC/MV split, and what share of maids on payroll can be tied to a contract at all.
A poor match rate means check 10's denominator is wrong before any threshold is applied.

---

## Q7 — Is there a payroll-lock signal? *(O17, blocking)*

The run must read after payroll lock, because the loan figures move at lock. The only candidate
column profiles as empty.

```sql
SELECT COUNT(*)                       AS maids,
       COUNT(LAST_PAYROLL_LOCK_DATE)  AS with_lock_date,
       MAX(LAST_PAYROLL_LOCK_DATE)    AS latest_lock
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO;
```

**Tells us:** whether `LAST_PAYROLL_LOCK_DATE` is genuinely unpopulated. If `with_lock_date = 0`,
we need to know **which column or table does record payroll lock** — that question matters more
than the query.

---

## Q8 — Is any of this already an approved KPI? *(O19)*

The spec declares six metrics "new Police & Control definitions". That claim rests on a survey of
the gold models only — the approved-definition register itself was never searched, because reading
`TOOLTIP_INFO` needs compute. If an approved definition exists, policy says reuse it verbatim.

```sql
SELECT SEMANTIC_ID,
       DASHBOARD_DOCS_ID,
       TO_VARCHAR(TOOLTIP_INFO) AS tooltip
FROM BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER
WHERE LOWER(TO_VARCHAR(TOOLTIP_INFO)) LIKE ANY (
        '%payroll%', '%salary%', '%loan%', '%unpaid%', '%arrear%',
        '%without client%', '%accommodation%', '%du pay%', '%ansari%')
LIMIT 200;
```

**Tells us:** whether any of checks 1, 2, 5, 6, 9 or 10 already has a governed definition.

---

## Q9 — WPS grain, for the tie-out *(O26)*

Tie-out 3 reconciles the payroll wage bill against WPS as an independent second source. `WPS_RECORDS`
is one row per maid per **report**, not per month, so a resubmission double-counts and makes the
payroll side look understated.

```sql
SELECT COUNT(*)                                                                    AS rows_total,
       COUNT(DISTINCT EMPLOYEE_UNIQUE_ID || '|' || TO_VARCHAR(DATE_TRUNC(month, PAYROLL_DATE))) AS maid_months,
       COUNT(DISTINCT EMPLOYEE_UNIQUE_ID)                                          AS maids
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.WPS_RECORDS
WHERE PAYROLL_DATE >= DATEADD(month, -12, CURRENT_DATE);

SELECT COUNT(*) AS rows_where_the_three_dates_disagree
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.WPS_RECORDS
WHERE PAYROLL_DATE >= DATEADD(month, -12, CURRENT_DATE)
  AND (DATE_TRUNC(month, PAYROLL_DATE) <> DATE_TRUNC(month, REPORT_DATE)
    OR DATE_TRUNC(month, PAYROLL_DATE) <> DATE_TRUNC(month, UPLOADED_DATE));
```

**Tells us:** how much de-duplication the tie-out needs, and whether `PAYROLL_DATE` is the right
column to define a WPS month.

---

## Q10 — Are CC arrears measured at all? *(O12, blocking)*

The ERP computes `PREVIOUSLY_UNPAID_SALARIES` for maid-visa maids only. If that holds, check 7's
CC arm has always summed to zero and always passed. This is a proxy: does the approved
unpaid-salary model show CC exclusions at all?

```sql
SELECT MAID_TYPE,
       EXCLUSION_REASON,
       SUM(EXCLUSION_COUNT) AS occurrences
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_GOLD.BI_PAYROLL_UNPAID_SALARY_MONITORING
WHERE ROW_TYPE = 'Reason'
GROUP BY 1, 2 ORDER BY 1, 3 DESC;
```

**Tells us:** whether CC arrears exist and are simply unmeasured by the legacy check, or genuinely
do not occur.

---

## Bonus — is the revision log actually populated?

`HOUSEMAIDS_INFO_REVISION` reports 5,510,443 rows, yet every one of its 126 columns profiles as
"no non-null values". Those cannot both be true; the profiling is probably stale. It matters
because it is the nearest thing to an audit trail on maid records — though it does **not** carry
the payment account, which is the finding logged as O30.

```sql
SELECT COUNT(*)               AS rows_total,
       COUNT(REVISION)        AS with_revision,
       COUNT(LAST_MODIFIER)   AS with_modifier,
       COUNT(STATUS)          AS with_status
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION;
```
