-- =====================================================================
-- Entry Visa Audit — discovery battery v2 (ad hoc, run once, NEVER schedule)
-- Read-only. All outputs are aggregates: no names, no contact details, no salaries.
--
-- v2 rewrite after a spec audit found defects that would have produced wrong
-- numbers rather than errors. Changes that matter:
--   * IS_DELETED = '0' removed everywhere — matched 0 of 625,941 rows (v1 bug).
--   * The rejection test no longer hardcodes 'Rejected'. The history column holds
--     NINE values including LEGACY NUMERIC CODES '0' and '1'. Verified via
--     SHOW COLUMNS. QG and Q5 profile them; Q5b reports strict and wide side by side.
--   * *_MODIFIED IS NOT NULL was a NO-OP: the flag is 0/1 and never null, so v1 read
--     carried-forward state rows as if they were change events. Now TRY_TO_NUMBER(..)=1,
--     = 1. (v2 used TRY_TO_NUMBER because the column's own comment claims VARCHAR
--     '1.00000'; SHOW COLUMNS says NUMBER(18,5) and the comment is wrong again --
--     TRY_TO_NUMBER on a NUMBER errors. Trust SHOW COLUMNS over the comment.)
--   * AMOUNT is FLOAT. Cast to NUMBER(18,2) before grouping, banding or summing —
--     GROUP BY on a float splits 1022.50 from 1022.4999999999.
--   * The ±50,000 guard moved OUT of WHERE in the coverage query: v1 dropped the
--     rows from the query written to price dropped rows.
--   * REQUEST_TYPE='NewRequest' added to every CHARGE query (the audit's scope);
--     deliberately NOT added to refund lookups — a refund for a NewRequest charge
--     can be booked on a CancelRequest.
--   * Q1 HAVING COUNT(*)>=3 removed: it deleted exactly the one-off amounts a
--     unit-price control exists to find.
--   * Q9's 12-month filter removed: it truncated the ITERATION window function's
--     own partition, so iteration 1 vanished and the re-application rate was wrong.
--
-- Standing guards (each earned from metadata, each now justified by a GROUP BY):
--   TRIM(CONTRACT_TYPE)                 -- values are 'CC ' / 'MV ' with a trailing space
--   CAST(AMOUNT AS NUMBER(18,2))        -- FLOAT money; max is 19,711,606,003,430
--   PAYMENT_DATE > '1900-01-01'         -- sentinel '0025-11-06' in source
--
-- MEASURED 2026-09-13 (PAYROLL_AND_MONEY_CONTROL_ROLE):
--   625,941 expense lines total · 62,466 entry-visa charge lines
--   (ENTRY_VSIA 57,396 + ENTRY_VISA_LESS_THAN_1000 5,070 — the sub-threshold
--   code is only 8.1%) · 1,598 REFUND_FOR_ENTRY_VISA lines all time ·
--   49 distinct PURPOSE values present vs 52 in the ERP enum, plus 1 empty string ·
--   6 rows outside ±50,000, NONE of them entry-visa.
-- =====================================================================


-- QG · RUN GUARD. Every population-defining literal in this battery, profiled.
--      A wrong literal returns zero rows in silence, which reads as "clean".
--      If any block below comes back empty, STOP: the literal is wrong, not the world.
SELECT 'purpose'        AS literal_set, PURPOSE AS value, COUNT(*) AS n
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
 WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000','REFUND_FOR_ENTRY_VISA')
 GROUP BY 1,2
UNION ALL
SELECT 'expense_status', STATUS, COUNT(*) FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES GROUP BY 1,2
UNION ALL
SELECT 'request_type',   REQUEST_TYPE, COUNT(*) FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES GROUP BY 1,2
UNION ALL
SELECT 'lost_category',  CATEGORY, COUNT(*) FROM BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES GROUP BY 1,2
UNION ALL
SELECT 'missing_expense_name', MISSING_EXPENSE_NAME, COUNT(*) FROM BA_VIEWS.VISA_SILVER.MISSING_EXPENSES GROUP BY 1,2
UNION ALL
SELECT 'entry_visa_task', TASK_NAME, COUNT(*) FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
 WHERE LOWER(TASK_NAME) LIKE '%entry%visa%' GROUP BY 1,2
ORDER BY literal_set, n DESC;


-- Q0 · Is the entry visa a CC thing, an MV thing, or both? Office staff in or out?
SELECT TRIM(CONTRACT_TYPE) AS contract_type, OWNER_TYPE, EMPLOYEE_TYPE,
       COUNT(*)                                  AS charge_lines,
       COUNT(DISTINCT VISA_REQUEST_ID)           AS requests,
       COUNT(DISTINCT OWNER_ID)                  AS people,
       ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2))))  AS total_aed,
       MIN(CREATION_DATE)::DATE                  AS earliest,
       MAX(CREATION_DATE)::DATE                  AS latest
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND REQUEST_TYPE = 'NewRequest'
GROUP BY 1,2,3
ORDER BY charge_lines DESC;


-- Q1 · The real price points. NO HAVING filter: a single AED 5,000 entry visa is
--      the finding; three identical ones are a price.
SELECT PURPOSE, TRIM(CONTRACT_TYPE) AS contract_type,
       CAST(AMOUNT AS NUMBER(18,2)) AS amt, COUNT(*) AS n,
       ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (PARTITION BY PURPOSE),2) AS pct_of_purpose
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND REQUEST_TYPE = 'NewRequest'
  AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1,2,3 ORDER BY PURPOSE, n DESC;


-- Q1b · Dating check on the July-2025 reclassification (VPM-8872/8874).
--       ⚠ The 1000 below is the SEEDED threshold. Its value history is NOT in the
--       warehouse, so a disagreement here is a DATING artefact, never a finding.
SELECT IFF(CREATION_DATE < '2025-07-01','pre-VPM-8872','post-VPM-8872') AS era, PURPOSE,
       CASE WHEN PURPOSE='ENTRY_VSIA'                AND CAST(AMOUNT AS NUMBER(18,2)) <= 1000
              THEN 'over-purpose, under-amount'
            WHEN PURPOSE='ENTRY_VISA_LESS_THAN_1000' AND CAST(AMOUNT AS NUMBER(18,2)) >  1000
              THEN 'under-purpose, over-amount'
            ELSE 'consistent with a seeded 1000 threshold' END AS band_agreement,
       COUNT(*) AS n, MIN(CREATION_DATE)::DATE AS earliest, MAX(CREATION_DATE)::DATE AS latest,
       ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2)))) AS total_aed
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND REQUEST_TYPE = 'NewRequest'
GROUP BY 1,2,3 ORDER BY era, n DESC;


-- Q1c · Distance from the only live reference the company has: accounting's
--       getDefaultEntryVisaExpenses() fallback, 1073 inside / 403 outside.
--       A DEFAULT, not a tariff. Bands are half-open and disjoint (v1 overlapped
--       at exactly 1000 — the threshold value itself).
SELECT CASE WHEN amt <  350                  THEN 'a · below both defaults'
            WHEN amt <  460                  THEN 'b · near the 403 outside-country default'
            WHEN amt < 1000                  THEN 'c · between the two defaults'
            WHEN amt <= 1150                 THEN 'd · near the 1073 inside-country default'
            ELSE                                  'e · above the inside-country default' END AS band,
       COUNT(*) AS n, ROUND(SUM(amt)) AS total_aed, MIN(amt) AS min_aed, MAX(amt) AS max_aed
FROM (SELECT CAST(AMOUNT AS NUMBER(18,2)) AS amt
      FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
      WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
        AND REQUEST_TYPE = 'NewRequest'
        AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE()))
GROUP BY 1 ORDER BY band;


-- Q2 · Line status and payment evidence. STATUS is the EXPENSE-ROW lifecycle, not
--      the request workflow. A charge stranded at Pending is invisible to any
--      population filtered on Added — a coverage hole, not a clean.
SELECT PURPOSE, REQUEST_TYPE, STATUS, COUNT(*) AS n,
       ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2))))            AS total_aed,
       COUNT_IF(TRANSACTION_ID IS NULL)                    AS no_transaction,
       COUNT_IF(NULLIF(TRIM(REFERENCE_NUMBER),'') IS NULL) AS no_reference,
       COUNT_IF(PAYMENT_DATE IS NULL
             OR PAYMENT_DATE <= '1900-01-01')              AS no_usable_payment_date
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000','REFUND_FOR_ENTRY_VISA')
  AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1,2,3 ORDER BY 1,2,3;


-- Q3 · How the money leaves. No LIMIT: an anomalous channel sits in the tail.
SELECT PAYMENT_TYPE, BUCKET, COUNT(*) AS n,
       ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2)))) AS total_aed
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND REQUEST_TYPE = 'NewRequest'
  AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1,2 ORDER BY n DESC;


-- Q4 · Charges vs refunds per request. Sizes the duplicate family and settles the
--      grain. v1 filtered REQUEST_TYPE='NewRequest' across the WHOLE query, so it
--      could not see cancel-leg refunds — the exact under-count the spec flagged.
--      Here charges are NewRequest-only; refunds are counted on ANY leg.
WITH charges AS (
  SELECT VISA_REQUEST_ID,
         COUNT_IF(STATUS='Added')                                        AS charges_added,
         COUNT_IF(STATUS='Pending')                                      AS charges_pending,
         SUM(IFF(STATUS='Added', CAST(AMOUNT AS NUMBER(18,2)), 0))       AS charged_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest'
  GROUP BY 1 HAVING COUNT_IF(STATUS='Added') > 0
), refunds AS (
  SELECT VISA_REQUEST_ID, REQUEST_TYPE,
         COUNT_IF(STATUS='Added')                                        AS refunds_added,
         SUM(IFF(STATUS='Added', CAST(AMOUNT AS NUMBER(18,2)), 0))       AS refunded_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE = 'REFUND_FOR_ENTRY_VISA'
  GROUP BY 1,2
)
SELECT c.charges_added, c.charges_pending,
       COALESCE(rn.refunds_added,0) AS refunds_on_new_leg,
       COALESCE(rc.refunds_added,0) AS refunds_on_cancel_leg,
       COUNT(*)                     AS requests,
       ROUND(SUM(c.charged_aed))    AS charged_aed,
       ROUND(SUM(COALESCE(rn.refunded_aed,0) + COALESCE(rc.refunded_aed,0))) AS refunded_aed
FROM charges c
LEFT JOIN refunds rn ON rn.VISA_REQUEST_ID = c.VISA_REQUEST_ID AND rn.REQUEST_TYPE = 'NewRequest'
LEFT JOIN refunds rc ON rc.VISA_REQUEST_ID = c.VISA_REQUEST_ID AND rc.REQUEST_TYPE = 'CancelRequest'
GROUP BY 1,2,3,4 ORDER BY 1,2,3,4;


-- Q5 · THE REJECTION VOCABULARY. Nine values, including legacy numeric codes.
--      Ordered ASCENDING so the earliest month is visible — this sets the real
--      floor on every rejection-keyed test. v1 ordered DESC LIMIT 60 and
--      structurally could not show it.
SELECT ENTRY_VISA_IMMIGRATION_APPROVED       AS value_written,
       COUNT(*)                              AS change_events,
       COUNT(DISTINCT REQUEST_ID)            AS requests,
       MIN(LAST_MODIFICATION_DATE)::DATE     AS first_seen,
       MAX(LAST_MODIFICATION_DATE)::DATE     AS last_seen
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
GROUP BY 1 ORDER BY first_seen;


-- Q5b · Point-read vs history, and STRICT vs WIDE rejection set side by side.
--       Do not commit to a set until Q5 shows when '0'/'1' stopped being written.
WITH changes AS (
  SELECT REQUEST_ID, ENTRY_VISA_IMMIGRATION_APPROVED AS v
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
), strict_hist AS (SELECT DISTINCT REQUEST_ID FROM changes WHERE v = 'Rejected'),
   wide_hist   AS (SELECT DISTINCT REQUEST_ID FROM changes WHERE v IN ('Rejected','0')),
   now_rej     AS (SELECT REQUEST_ID FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
                   WHERE ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected')
SELECT (SELECT COUNT(*) FROM strict_hist)                                       AS ever_rejected_strict,
       (SELECT COUNT(*) FROM wide_hist)                                         AS ever_rejected_incl_legacy_0,
       (SELECT COUNT(*) FROM wide_hist) - (SELECT COUNT(*) FROM strict_hist)     AS legacy_only_requests,
       (SELECT COUNT(*) FROM now_rej)                                           AS still_reads_rejected_today,
       (SELECT COUNT(*) FROM strict_hist s
         WHERE NOT EXISTS (SELECT 1 FROM now_rej n WHERE n.REQUEST_ID=s.REQUEST_ID)) AS lost_by_a_point_read,
       (SELECT COUNT(*) FROM now_rej n
         WHERE NOT EXISTS (SELECT 1 FROM wide_hist w WHERE w.REQUEST_ID=n.REQUEST_ID)) AS history_false_negatives;


-- Q6 · POSITIVE CONTROL for the expiry family, now covering the ARRIVAL source too
--      (v1 checked the date columns and not the outcome source F3 equally needs).
--      If these come back thin, F3 is VOID, not zero.
SELECT COUNT(*)                                           AS requests,
       COUNT_IF(ENTRY_VISA_ISSUANCE_DATE IS NOT NULL)     AS have_issuance_date,
       COUNT_IF(ENTRY_VISA_EXPIRY_DATE   IS NOT NULL)     AS have_expiry_date,
       COUNT_IF(ENTRY_VISA_EXPIRY_DATE < CURRENT_DATE()
            AND ENTRY_VISA_ISSUANCE_DATE IS NOT NULL)     AS expired_window,
       COUNT_IF(RVISA_ISSUANCE_DATE IS NOT NULL)          AS reached_residence_visa
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
WHERE CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE());

-- Q6b · Does the arrival signal exist at all? F3 cannot run for anyone this misses,
--       and OFFICE_STAFF have no row here by construction.
SELECT TO_STATUS, COUNT(*) AS n, COUNT(DISTINCT HOUSEMAID_ID) AS maids,
       MIN(CHANGE_DATE)::DATE AS first_seen, MAX(CHANGE_DATE)::DATE AS last_seen
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS
WHERE TO_STATUS IN ('LANDED_IN_DUBAI','VISA_UNSUCCESSFUL','NO_SHOW')
GROUP BY 1 ORDER BY n DESC;


-- Q7 · What the company already calls a lost entry-visa expense.
--      RECONCILIATION TARGET, NOT A POPULATION: this view's entry-visa branch
--      excludes Pakistani nationals, and the excluded rows are NOT IN THE VIEW,
--      so this query cannot price its own exclusion. Q7b prices it from the ledger.
SELECT CATEGORY, SUB_CATEGORY, EXPENSES_TYPE, VISA_STAGE,
       COUNT(*) AS rows_out, COUNT(DISTINCT REQUEST_ID) AS requests,
       ROUND(SUM(EXPENSES_AMOUNT)) AS amount_aed,
       MIN(REQUEST_CREATION_DATE)::DATE AS earliest,
       MAX(REQUEST_CREATION_DATE)::DATE AS latest
FROM BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES
WHERE CATEGORY = 'ENTRY VISA'
GROUP BY 1,2,3,4 ORDER BY amount_aed DESC;

-- Q7b · Price the Pakistani-national population FROM THE LEDGER, which is the only
--       place it still exists. This is the coverage slice Q7 structurally cannot see.
SELECT IFF(h.NATIONALITY = 'Pakistani','Pakistani (excluded by LOST_VISA_EXPENSES)',
           'all other nationalities')                          AS cohort,
       COUNT(*)                                                AS charge_lines,
       COUNT(DISTINCT e.VISA_REQUEST_ID)                       AS requests,
       ROUND(SUM(CAST(e.AMOUNT AS NUMBER(18,2))))              AS total_aed
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h
  ON h.ID = e.OWNER_ID AND e.OWNER_TYPE = 'HOUSEMAID'
WHERE e.PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND e.REQUEST_TYPE = 'NewRequest'
GROUP BY 1 ORDER BY charge_lines DESC;


-- Q8 · Entry-visa payments the ERP itself believes were never booked.
SELECT HOUSEMAID_TYPE, REQUEST_TYPE, TASK_NAME,
       COUNT(*) AS cases, COUNT(DISTINCT REQUEST_ID) AS requests,
       MIN(MOVE_OUT_FROM_MISSING_EXPENSES_STEP)::DATE AS earliest,
       MAX(MOVE_OUT_FROM_MISSING_EXPENSES_STEP)::DATE AS latest
FROM BA_VIEWS.VISA_SILVER.MISSING_EXPENSES
WHERE MISSING_EXPENSE_NAME = 'ENTRY_VSIA_OR_ENTRY_VISA_LESS_THAN_1000'
GROUP BY 1,2,3 ORDER BY cases DESC;


-- Q9 · Re-applications. NO date filter: ITERATION is a ROW_NUMBER computed INSIDE
--      the view, so filtering on STARTED_AT truncates its own partition and makes
--      iteration 1 disappear. Window the report, never the partition.
SELECT ITERATION, COUNT(*) AS steps, COUNT(DISTINCT VISA_REQUEST_ID) AS requests
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
WHERE TASK_NAME = 'Apply for entry Visa'
GROUP BY 1 ORDER BY 1;

-- Q9b · Refund-step ageing, the anchor for M5. Guarded: TIME_SPENT profiles as
--       -910..2653 and GROWS DAILY while a step is open, so completed and ongoing
--       steps must be reported separately and negatives excluded.
SELECT TASK_NAME, STEP_STATUS, COUNT(*) AS steps,
       COUNT_IF(TIME_SPENT < 0)                            AS negative_durations_excluded,
       ROUND(AVG(IFF(TIME_SPENT >= 0, TIME_SPENT, NULL)),1) AS avg_days,
       MAX(IFF(TIME_SPENT >= 0, TIME_SPENT, NULL))          AS max_days
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
WHERE LOWER(TASK_NAME) LIKE '%entry%visa%'
GROUP BY 1,2 ORDER BY steps DESC;


-- Q10 · COVERAGE. The amount guard is in the CASE, NOT the WHERE — v1 dropped the
--       out-of-range rows from the query written to price dropped rows.
--       v3: CREATION_DATE::DATE > CURRENT_DATE(). v2 compared a TIMESTAMP to
--       CURRENT_DATE(), so every row created TODAY read as FUTURE-dated (20 rows,
--       AED 15,250 on the 2026-09-13 run). A cast, not a real future-dating problem.
SELECT CASE WHEN CAST(AMOUNT AS NUMBER(18,2)) NOT BETWEEN -50000 AND 50000
                                                                  THEN 'VOID · outside the amount guard'
            WHEN AMOUNT IS NULL                                   THEN 'VOID · null amount'
            WHEN CREATION_DATE::DATE > CURRENT_DATE()             THEN 'FUTURE-dated'
            WHEN CREATION_DATE < DATEADD('month',-12,CURRENT_DATE())
                                                                  THEN 'older than the window'
            ELSE 'inside the window' END AS dating,
       COUNT(*) AS n, ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2)))) AS total_aed,
       MIN(CREATION_DATE)::DATE AS earliest, MAX(CREATION_DATE)::DATE AS latest
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND REQUEST_TYPE = 'NewRequest'
GROUP BY 1 ORDER BY n DESC;
