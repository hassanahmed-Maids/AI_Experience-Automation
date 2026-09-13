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


-- Q6c · CORRECTED positive control for F3. Q6 measured date population against ALL
--       requests created in the window, which includes every request that never
--       reached the entry-visa step -- so 34% read as a failed control when it is
--       really the wrong denominator. The right denominator is requests that
--       actually PAID for an entry visa. Same 50% bar. F3 stays VOID until this runs.
WITH paid AS (
  SELECT DISTINCT VISA_REQUEST_ID
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added'
    AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
    AND VISA_REQUEST_ID IS NOT NULL
)
SELECT COUNT(*)                                            AS paying_requests,
       COUNT_IF(r.ENTRY_VISA_ISSUANCE_DATE IS NOT NULL)    AS have_issuance_date,
       COUNT_IF(r.ENTRY_VISA_EXPIRY_DATE   IS NOT NULL)    AS have_expiry_date,
       ROUND(100.0*COUNT_IF(r.ENTRY_VISA_ISSUANCE_DATE IS NOT NULL)/NULLIF(COUNT(*),0),1) AS pct_issuance,
       ROUND(100.0*COUNT_IF(r.ENTRY_VISA_EXPIRY_DATE   IS NOT NULL)/NULLIF(COUNT(*),0),1) AS pct_expiry,
       COUNT_IF(r.ENTRY_VISA_EXPIRY_DATE < CURRENT_DATE()
            AND r.ENTRY_VISA_ISSUANCE_DATE IS NOT NULL)    AS expired_window,
       COUNT_IF(r.RVISA_ISSUANCE_DATE IS NOT NULL)         AS reached_residence_visa
FROM paid p
JOIN BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS r ON r.REQUEST_ID = p.VISA_REQUEST_ID;


-- Q9c · F4's sharpest test, per request: MORE PAID CHARGES THAN STEP VISITS.
--       A genuine re-application re-enters 'Apply for entry Visa'. A second charge
--       booked against a single step visit is a duplicate with no application behind
--       it -- and unlike the v1 test it does not depend on the rejection history,
--       which is exactly where the false negatives are.
--       Aggregates say ~1,248 multi-charge requests vs 889 that ever re-applied;
--       this resolves that gap per request instead of by subtraction.
WITH charges AS (
  SELECT VISA_REQUEST_ID, COUNT(*) AS charges_added,
         ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2))),2) AS charged_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
  GROUP BY 1
), visits AS (
  SELECT VISA_REQUEST_ID, MAX(ITERATION) AS step_visits
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME = 'Apply for entry Visa'
  GROUP BY 1
), refunds AS (
  SELECT VISA_REQUEST_ID, COUNT(*) AS refunds_added
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE = 'REFUND_FOR_ENTRY_VISA' AND STATUS = 'Added'
  GROUP BY 1
)
SELECT c.charges_added,
       COALESCE(v.step_visits,0)                                   AS step_visits,
       COALESCE(rf.refunds_added,0)                                AS refunds_added,
       c.charges_added - COALESCE(v.step_visits,0)                 AS excess_charges,
       COUNT(*)                                                    AS requests,
       ROUND(SUM(c.charged_aed))                                   AS charged_aed
FROM charges c
LEFT JOIN visits  v  ON v.VISA_REQUEST_ID  = c.VISA_REQUEST_ID
LEFT JOIN refunds rf ON rf.VISA_REQUEST_ID = c.VISA_REQUEST_ID
WHERE c.charges_added > COALESCE(v.step_visits,0)
GROUP BY 1,2,3,4 ORDER BY excess_charges DESC, requests DESC;


-- Q9d · Confirm the guard in Q9c is an ingestion boundary, not a business event.
--       Hypothesis: requests with charges but NO 'Apply for entry Visa' step row are
--       simply older than the workflow task history, which begins 2019-04-02 --
--       the same day the revision history's legacy rejection codes stop. If the
--       counts collapse after 2019, the boundary is a system cutover and those
--       requests are BLOCKED, not duplicates.
WITH charges AS (
  SELECT VISA_REQUEST_ID, MIN(CREATION_DATE) AS first_charge, COUNT(*) AS charges_added,
         ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2))),2) AS charged_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
  GROUP BY 1
), visits AS (
  SELECT VISA_REQUEST_ID, MAX(ITERATION) AS step_visits
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME = 'Apply for entry Visa' GROUP BY 1
)
SELECT YEAR(c.first_charge)                                AS charge_year,
       COUNT(*)                                            AS requests,
       COUNT_IF(COALESCE(v.step_visits,0) = 0)             AS no_step_history,
       ROUND(100.0*COUNT_IF(COALESCE(v.step_visits,0) = 0)/NULLIF(COUNT(*),0),1) AS pct_no_step,
       ROUND(SUM(IFF(COALESCE(v.step_visits,0) = 0, c.charged_aed, 0))) AS aed_no_step
FROM charges c LEFT JOIN visits v ON v.VISA_REQUEST_ID = c.VISA_REQUEST_ID
GROUP BY 1 ORDER BY 1;


-- =====================================================================
-- R-SERIES · Answering the open business questions from the data instead of
-- from a person. Seven of the twelve turned out to be measurable.
--
-- The key distinction that makes R1 legitimate where M6 is blocked: a REFUND is
-- the GOVERNMENT's decision, not ours. Observing what they actually returned is
-- external evidence of their tariff. Observing what WE typed as a charge would
-- only be the population auditing itself.
-- =====================================================================

-- R1 · "How much do we get back when they reject?"  (question 1)
--      Pair each charge amount with the refund amount that followed it on the
--      same request, either leg. If the mapping is tight, that IS the tariff.
WITH ch AS (
  SELECT VISA_REQUEST_ID, CAST(AMOUNT AS NUMBER(18,2)) AS charge_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT VISA_REQUEST_ID, CAST(ABS(AMOUNT) AS NUMBER(18,2)) AS refund_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE = 'REFUND_FOR_ENTRY_VISA' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
)
SELECT ch.charge_aed, rf.refund_aed,
       ROUND(100.0*rf.refund_aed/NULLIF(ch.charge_aed,0),1) AS pct_returned,
       ROUND(ch.charge_aed - rf.refund_aed,2)               AS kept_by_government,
       COUNT(*)                                             AS pairs
FROM ch JOIN rf ON rf.VISA_REQUEST_ID = ch.VISA_REQUEST_ID
GROUP BY 1,2 ORDER BY pairs DESC;

-- R2 · "Is there really a claim deadline?"  (question 2)
--      If refunds simply stop happening past a certain age, the deadline is real
--      and the data will show the cliff. No cliff = no deadline.
WITH rej AS (
  SELECT REQUEST_ID, MIN(LAST_MODIFICATION_DATE) AS rejected_at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
  GROUP BY 1
), rf AS (
  SELECT VISA_REQUEST_ID, MIN(CREATION_DATE) AS refunded_at
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE = 'REFUND_FOR_ENTRY_VISA' AND STATUS = 'Added'
  GROUP BY 1
)
SELECT CASE WHEN d < 0   THEN 'refund BEFORE the rejection (check)'
            WHEN d <= 7  THEN 'a · 0-7 days'    WHEN d <= 30 THEN 'b · 8-30 days'
            WHEN d <= 60 THEN 'c · 31-60 days'  WHEN d <= 90 THEN 'd · 61-90 days'
            WHEN d <= 180 THEN 'e · 91-180 days' ELSE 'f · over 180 days' END AS age_band,
       COUNT(*) AS refunds, MIN(d) AS min_days, MAX(d) AS max_days
FROM (SELECT DATEDIFF('day', rej.rejected_at, rf.refunded_at) AS d
      FROM rej JOIN rf ON rf.VISA_REQUEST_ID = rej.REQUEST_ID)
GROUP BY 1 ORDER BY age_band;

-- R3 · "Is approved-then-cancelled money ever recoverable?"  (question 3)
--      AED 3.45m sits here. If even a minority of these cases got a refund, it
--      is claimable and the rest is a finding. If literally none did, it is a cost.
WITH cancelled AS (
  SELECT DISTINCT REQUEST_ID FROM BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES
  WHERE CATEGORY = 'ENTRY VISA' AND EXPENSES_TYPE = 'Approved and Canceled Entry Visas'
), rf AS (
  SELECT DISTINCT VISA_REQUEST_ID FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE = 'REFUND_FOR_ENTRY_VISA' AND STATUS = 'Added'
)
SELECT IFF(rf.VISA_REQUEST_ID IS NULL,'no refund ever recorded','a refund WAS recorded') AS outcome,
       COUNT(*) AS requests
FROM cancelled c LEFT JOIN rf ON rf.VISA_REQUEST_ID = c.REQUEST_ID
GROUP BY 1 ORDER BY requests DESC;

-- R4 · "Does the price vary by who the maid is?"  (question 5)
--      Nationality is the only population attribute actually stored; location is
--      computed and never persisted. Aggregates only, no individuals.
SELECT h.NATIONALITY,
       COUNT(*) AS charges,
       MODE(CAST(e.AMOUNT AS NUMBER(18,2))) AS most_common_amount,
       COUNT(DISTINCT CAST(e.AMOUNT AS NUMBER(18,2))) AS distinct_amounts,
       ROUND(MIN(e.AMOUNT),2) AS min_aed, ROUND(MAX(e.AMOUNT),2) AS max_aed,
       ROUND(AVG(e.AMOUNT),2) AS avg_aed
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h
  ON h.ID = e.OWNER_ID AND e.OWNER_TYPE = 'HOUSEMAID'
WHERE e.PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND e.REQUEST_TYPE = 'NewRequest' AND e.STATUS = 'Added'
  AND e.CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1 HAVING COUNT(*) >= 20 ORDER BY charges DESC;

-- R5 · "Would someone recognise these as mistakes?"  (question 7)
--      Characterise the three oddities so a human gets a shaped question rather
--      than a list. Creator is reported as a COUNT of distinct users, never a name.
SELECT CASE WHEN CAST(AMOUNT AS NUMBER(18,2)) = 0        THEN 'zero-value charge'
            WHEN CAST(AMOUNT AS NUMBER(18,2)) = 89.50    THEN 'charge at the small refund value'
            WHEN CAST(AMOUNT AS NUMBER(18,2)) = 739.50   THEN 'charge at the large refund value'
            WHEN VISA_REQUEST_ID IS NULL                 THEN 'charge with no request'
            ELSE 'ordinary' END                          AS oddity,
       YEAR(CREATION_DATE)                               AS yr,
       COUNT(*)                                          AS n,
       COUNT(DISTINCT CREATOR)                           AS distinct_creators,
       COUNT(DISTINCT DATE_TRUNC('day',CREATION_DATE))   AS distinct_days,
       COUNT_IF(TRANSACTION_ID IS NULL)                  AS no_transaction,
       ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2))))          AS total_aed
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added'
  AND (CAST(AMOUNT AS NUMBER(18,2)) IN (0, 89.50, 739.50) OR VISA_REQUEST_ID IS NULL)
GROUP BY 1,2 ORDER BY oddity, yr;


-- R1b · The 1:1 pairing R1 could not do. R1 joined charges to refunds on the
--       request alone, so a request with two charges and one refund produced two
--       pairs and the totals fan out (~2,226 pairs against fewer refund lines).
--       R1 proved the MAPPING; this produces the COUNTS. Pair each refund with the
--       nearest charge at or before it on the same request, then score against the
--       tariff: expected refund = paid - 283.00 - (paid - base price of its band).
WITH ch AS (
  SELECT VISA_REQUEST_ID, CREATION_DATE AS charged_at,
         CAST(AMOUNT AS NUMBER(18,2))   AS charge_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT VISA_REQUEST_ID, CREATION_DATE AS refunded_at,
         CAST(ABS(AMOUNT) AS NUMBER(18,2)) AS refund_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE = 'REFUND_FOR_ENTRY_VISA' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
), paired AS (
  SELECT rf.VISA_REQUEST_ID, rf.refunded_at, rf.refund_aed, ch.charge_aed, ch.charged_at
  FROM rf JOIN ch
    ON ch.VISA_REQUEST_ID = rf.VISA_REQUEST_ID AND ch.charged_at <= rf.refunded_at
  QUALIFY ROW_NUMBER() OVER (PARTITION BY rf.VISA_REQUEST_ID, rf.refunded_at, rf.refund_aed
                             ORDER BY ch.charged_at DESC) = 1
), scored AS (
  SELECT *,
         IFF(charge_aed >= 700, 1022.50, 372.50)                  AS base_price,
         ROUND(charge_aed - 283.00 - (charge_aed - IFF(charge_aed >= 700, 1022.50, 372.50)), 2)
                                                                  AS expected_refund,
         ROUND(refund_aed - (charge_aed - 283.00
               - (charge_aed - IFF(charge_aed >= 700, 1022.50, 372.50))), 2) AS variance
  FROM paired
)
SELECT CASE WHEN ABS(variance) <= 0.50 THEN 'a · matches the tariff'
            WHEN variance < -0.50      THEN 'b · SHORT refund'
            ELSE                            'c · OVER refund' END AS outcome,
       COUNT(*)                     AS refunds,
       COUNT(DISTINCT VISA_REQUEST_ID) AS requests,
       ROUND(SUM(variance))         AS total_variance_aed,
       ROUND(MIN(variance),2)       AS worst_short,
       ROUND(MAX(variance),2)       AS largest_over
FROM scored GROUP BY 1 ORDER BY outcome;

-- R1c · The unclaimed side, priced with the tariff: charges on requests we know
--       were rejected, where no refund was ever recorded on either leg.
--       This is M1's headline population.
WITH rej AS (
  SELECT DISTINCT REQUEST_ID FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
  UNION
  SELECT REQUEST_ID FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
), ch AS (
  SELECT VISA_REQUEST_ID, CAST(AMOUNT AS NUMBER(18,2)) AS charge_aed, CREATION_DATE
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT DISTINCT VISA_REQUEST_ID FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE = 'REFUND_FOR_ENTRY_VISA' AND STATUS = 'Added'
)
SELECT YEAR(ch.CREATION_DATE)                                     AS charge_year,
       COUNT(*)                                                   AS unrefunded_charges,
       ROUND(SUM(ch.charge_aed))                                  AS gross_aed,
       ROUND(SUM(ch.charge_aed - 283.00
             - (ch.charge_aed - IFF(ch.charge_aed >= 700, 1022.50, 372.50)))) AS recoverable_aed
FROM ch
JOIN rej ON rej.REQUEST_ID = ch.VISA_REQUEST_ID
LEFT JOIN rf ON rf.VISA_REQUEST_ID = ch.VISA_REQUEST_ID
WHERE rf.VISA_REQUEST_ID IS NULL
GROUP BY 1 ORDER BY 1 DESC;


-- R1d · Orphan refunds: the population R1b's inner join hides.
--       R1b joins refunds TO charges, so a refund with no charge at or before it
--       on the same request vanishes without trace. Same inner-join trap this
--       battery warns about elsewhere. Count them before quoting F11's denominator.
WITH rf AS (
  SELECT VISA_REQUEST_ID, REQUEST_TYPE, CREATION_DATE AS refunded_at,
         CAST(ABS(AMOUNT) AS NUMBER(18,2)) AS refund_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE = 'REFUND_FOR_ENTRY_VISA' AND STATUS = 'Added'
), ch AS (
  SELECT VISA_REQUEST_ID, CREATION_DATE AS charged_at
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added'
)
SELECT CASE WHEN rf.VISA_REQUEST_ID IS NULL              THEN 'refund with no request id at all'
            WHEN c.VISA_REQUEST_ID IS NULL               THEN 'no entry-visa charge on the request'
            WHEN c.charged_at IS NULL                    THEN 'charges exist but all AFTER the refund'
            ELSE 'paired in R1b' END                     AS coverage,
       rf.REQUEST_TYPE, COUNT(*) AS refunds,
       ROUND(SUM(rf.refund_aed)) AS refund_aed,
       MIN(rf.refunded_at)::DATE AS earliest, MAX(rf.refunded_at)::DATE AS latest
FROM rf
LEFT JOIN (SELECT VISA_REQUEST_ID, MIN(charged_at) AS charged_at FROM ch GROUP BY 1) c
  ON c.VISA_REQUEST_ID = rf.VISA_REQUEST_ID
LEFT JOIN (SELECT DISTINCT VISA_REQUEST_ID FROM ch) any_ch
  ON any_ch.VISA_REQUEST_ID = rf.VISA_REQUEST_ID
GROUP BY 1,2 ORDER BY refunds DESC;


-- =====================================================================
-- V-SERIES · Confirmation tests. Several are self-checks on figures this
-- battery has already produced. V1 is the one that could retract a finding.
-- =====================================================================

-- V1 · SELF-CHECK ON F11. R1b pairs each refund with the NEAREST PRECEDING charge.
--      If a request has a large charge, then a small charge, then one refund of
--      739.50, that rule pairs the refund with the SMALL charge and scores it as a
--      +650 "over-refund" -- when it is an ordinary refund of the large one.
--      The mirror applies to the -650 "short refunds".
--      DECISIVE TEST: if short/over requests mostly carry ONE charge, the findings
--      are real. If they mostly carry TWO OR MORE, they are my pairing artefact and
--      F11 must be retracted and re-cut on band matching, not on proximity.
WITH ch AS (
  SELECT VISA_REQUEST_ID, CREATION_DATE AS charged_at, CAST(AMOUNT AS NUMBER(18,2)) AS charge_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT VISA_REQUEST_ID, CREATION_DATE AS refunded_at, CAST(ABS(AMOUNT) AS NUMBER(18,2)) AS refund_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE = 'REFUND_FOR_ENTRY_VISA' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
), paired AS (
  SELECT rf.VISA_REQUEST_ID, rf.refund_aed, ch.charge_aed,
         ROUND(rf.refund_aed - (IFF(ch.charge_aed >= 700, 1022.50, 372.50) - 283.00),2) AS variance
  FROM rf JOIN ch ON ch.VISA_REQUEST_ID = rf.VISA_REQUEST_ID AND ch.charged_at <= rf.refunded_at
  QUALIFY ROW_NUMBER() OVER (PARTITION BY rf.VISA_REQUEST_ID, rf.refunded_at, rf.refund_aed
                             ORDER BY ch.charged_at DESC) = 1
), shape AS (
  SELECT VISA_REQUEST_ID,
         COUNT(*) AS charges_on_request,
         COUNT_IF(charge_aed >= 700) AS large_band_charges,
         COUNT_IF(charge_aed <  700) AS small_band_charges
  FROM ch GROUP BY 1
)
SELECT CASE WHEN ABS(p.variance) <= 0.50 THEN 'a · matches the tariff'
            WHEN p.variance < -0.50      THEN 'b · SHORT refund'
            ELSE                              'c · OVER refund' END AS outcome,
       s.charges_on_request,
       s.large_band_charges, s.small_band_charges,
       COUNT(*) AS refunds, COUNT(DISTINCT p.VISA_REQUEST_ID) AS requests
FROM paired p JOIN shape s ON s.VISA_REQUEST_ID = p.VISA_REQUEST_ID
GROUP BY 1,2,3,4 ORDER BY outcome, s.charges_on_request;

-- V2 · Has the tariff ever been a different number? A real government schedule
--      changes on a date and holds; a coincidence drifts. If the retention has
--      always been exactly 283.00, or stepped once on a clean date, that is the
--      schedule. If it wanders, the "flat 283" claim is too strong.
--      FIXED: QUALIFY cannot precede GROUP BY in one SELECT. The pairing dedup
--      gets its own CTE, exactly as R1b does, and the aggregate runs over that.
WITH ch AS (
  SELECT VISA_REQUEST_ID, CREATION_DATE AS charged_at, CAST(AMOUNT AS NUMBER(18,2)) AS charge_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT VISA_REQUEST_ID, CREATION_DATE AS refunded_at, CAST(ABS(AMOUNT) AS NUMBER(18,2)) AS refund_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE = 'REFUND_FOR_ENTRY_VISA' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
), paired AS (
  SELECT rf.refunded_at, rf.refund_aed, ch.charge_aed
  FROM rf JOIN ch ON ch.VISA_REQUEST_ID = rf.VISA_REQUEST_ID AND ch.charged_at <= rf.refunded_at
  QUALIFY ROW_NUMBER() OVER (PARTITION BY rf.VISA_REQUEST_ID, rf.refunded_at, rf.refund_aed
                             ORDER BY ch.charged_at DESC) = 1
)
SELECT YEAR(refunded_at)                          AS refund_year,
       IFF(charge_aed >= 700,'large band','small band') AS band,
       charge_aed, refund_aed,
       ROUND(charge_aed - refund_aed,2)           AS kept_by_government,
       COUNT(*)                                   AS pairs
FROM paired
GROUP BY 1,2,3,4,5 HAVING COUNT(*) >= 3 ORDER BY refund_year, band, pairs DESC;


-- V3 · Reconcile MY unclaimed population against the COMPANY'S. R1c found 164
--      unrefunded charges keyed on REJECTION. LOST_VISA_EXPENSES reports 444
--      cases of "Expired & Pending Approval (Should Have Been Refunded)" keyed on
--      EXPIRY. If those 444 barely overlap my 164, my headline is understating by
--      a whole family and F3 needs pricing alongside F1.
WITH mine AS (
  SELECT DISTINCT e.VISA_REQUEST_ID AS request_id
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  WHERE e.PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND e.REQUEST_TYPE = 'NewRequest' AND e.STATUS = 'Added' AND e.VISA_REQUEST_ID IS NOT NULL
    AND EXISTS (SELECT 1 FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS r
                WHERE r.REQUEST_ID = e.VISA_REQUEST_ID AND r.ENTRY_VISA_IMMIGRATION_APPROVED='Rejected')
    AND NOT EXISTS (SELECT 1 FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES x
                    WHERE x.VISA_REQUEST_ID = e.VISA_REQUEST_ID
                      AND x.PURPOSE='REFUND_FOR_ENTRY_VISA' AND x.STATUS='Added')
), theirs AS (
  SELECT DISTINCT REQUEST_ID AS request_id FROM BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES
  WHERE CATEGORY='ENTRY VISA' AND EXPENSES_TYPE='Expired & Pending Approval (Should Have Been Refunded)'
)
SELECT CASE WHEN m.request_id IS NOT NULL AND t.request_id IS NOT NULL THEN 'in BOTH populations'
            WHEN m.request_id IS NOT NULL                              THEN 'only in mine (rejection-keyed)'
            ELSE                                                            'only in theirs (expiry-keyed)' END AS overlap,
       COUNT(*) AS requests
FROM mine m FULL OUTER JOIN theirs t ON t.request_id = m.request_id
GROUP BY 1 ORDER BY requests DESC;

-- V4 · What did the 26 do differently? R3 found 26 of 5,747 cancelled-after-
--      approval cases DID get money back. They are the proof recovery is possible,
--      so the question is what distinguishes them -- year, cancellation route, or
--      simply that someone opened the refund step.
WITH cancelled AS (
  SELECT DISTINCT REQUEST_ID FROM BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES
  WHERE CATEGORY='ENTRY VISA' AND EXPENSES_TYPE='Approved and Canceled Entry Visas'
), rf AS (
  SELECT DISTINCT VISA_REQUEST_ID FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added'
), step AS (
  SELECT DISTINCT VISA_REQUEST_ID FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME='Refund Entry Visa Application'
)
SELECT IFF(rf.VISA_REQUEST_ID IS NULL,'no refund','REFUNDED')            AS outcome,
       IFF(st.VISA_REQUEST_ID IS NULL,'refund step never opened',
           'refund step WAS opened')                                     AS refund_step,
       YEAR(r.CREATION_DATE)                                             AS request_year,
       COUNT(*)                                                          AS requests
FROM cancelled c
JOIN BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS r ON r.REQUEST_ID = c.REQUEST_ID
LEFT JOIN rf   ON rf.VISA_REQUEST_ID = c.REQUEST_ID
LEFT JOIN step st ON st.VISA_REQUEST_ID = c.REQUEST_ID
GROUP BY 1,2,3 ORDER BY outcome DESC, requests DESC;

-- V5 · Price the pre-2019 population honestly. 4,565 requests have no step history
--      and are excluded from F4. Are they excluded from EVERYTHING? If two years of
--      charges can be reached by no family at all, that is a coverage slice that
--      must be named and priced, not left to look clean.
SELECT YEAR(e.CREATION_DATE)                                       AS charge_year,
       COUNT(*)                                                    AS charges,
       ROUND(SUM(CAST(e.AMOUNT AS NUMBER(18,2))))                  AS aed,
       COUNT_IF(r.ENTRY_VISA_ISSUANCE_DATE IS NOT NULL)            AS has_issuance_date,
       COUNT_IF(r.ENTRY_VISA_IMMIGRATION_APPROVED IS NOT NULL)     AS has_approval_state,
       COUNT_IF(EXISTS (SELECT 1 FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS t
                        WHERE t.VISA_REQUEST_ID = e.VISA_REQUEST_ID
                          AND t.TASK_NAME='Apply for entry Visa'))  AS has_step_history
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
LEFT JOIN BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS r ON r.REQUEST_ID = e.VISA_REQUEST_ID
WHERE e.PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND e.REQUEST_TYPE = 'NewRequest' AND e.STATUS = 'Added'
GROUP BY 1 ORDER BY 1;


-- V4b · Close V4's gap -- CORRECTED. My first draft joined
--       CANCEL_VISA_REQUESTS_TASKS.VISA_REQUEST_ID straight to a NewRequest id.
--       That is a CANCEL-request id (mmdb.cancelrequests.ID, range 2,161-94,464)
--       and it OVERLAPS the new-request id range, so the join would have matched
--       silently and wrongly -- the exact per-leg namespace trap this spec warns
--       about. The real bridge is CANCEL_VISA_REQUESTS.NEW_REQUEST_ID, a stored FK
--       from the cancellation back to the initial request.
WITH cancelled AS (
  SELECT DISTINCT REQUEST_ID FROM BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES
  WHERE CATEGORY='ENTRY VISA' AND EXPENSES_TYPE='Approved and Canceled Entry Visas'
), bridge AS (                       -- new request  <->  its cancellation request
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS
  WHERE NEW_REQUEST_ID IS NOT NULL
), rf AS (                           -- refunds on EITHER leg, each on its own id
  SELECT DISTINCT b.NEW_REQUEST_ID AS request_id
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
  UNION
  SELECT DISTINCT VISA_REQUEST_ID FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
), new_step AS (
  SELECT DISTINCT VISA_REQUEST_ID AS request_id
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME ILIKE '%Refund Entry Visa%'
), cancel_step AS (
  SELECT DISTINCT b.NEW_REQUEST_ID AS request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS_TASKS t
  JOIN bridge b ON b.cancel_request_id = t.VISA_REQUEST_ID
  WHERE t.TASK_NAME ILIKE '%Refund Entry Visa%'
)
SELECT IFF(rf.request_id IS NULL,'no refund','REFUNDED')      AS outcome,
       IFF(ns.request_id IS NOT NULL,'yes','no')              AS new_request_step,
       IFF(cs.request_id IS NOT NULL,'yes','no')              AS cancel_request_step,
       COUNT(*)                                               AS requests
FROM cancelled c
LEFT JOIN rf          ON rf.request_id = c.REQUEST_ID
LEFT JOIN new_step ns ON ns.request_id = c.REQUEST_ID
LEFT JOIN cancel_step cs ON cs.request_id = c.REQUEST_ID
GROUP BY 1,2,3 ORDER BY outcome DESC, requests DESC;


-- =====================================================================
-- S-SERIES · Hand-adjudication sample for F4 (duplicate payments).
-- F4 is the largest avoidable number in the audit (415 requests, AED 760,338)
-- and the least examined -- two independent signals agree on it but no single
-- case has been read. Nothing from F4 gets published before ~20 are adjudicated.
--
-- The sample is DETERMINISTIC (ordered by HASH of the request id), so the same
-- 20 come back on every run and can be discussed by id. It is STRATIFIED by
-- excess-charge count, because the population is ~92% excess=1 and a plain
-- random 20 would almost never show the rarer, more serious shapes.
-- Ids only. No names anywhere.
-- =====================================================================

-- S1 · The sample: 20 requests, one row each, with the shape of the case.
WITH ch AS (
  SELECT VISA_REQUEST_ID, COUNT(*) AS charges_added,
         ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2))),2) AS charged_aed,
         MIN(CREATION_DATE)::DATE AS first_charge, MAX(CREATION_DATE)::DATE AS last_charge,
         COUNT_IF(CAST(AMOUNT AS NUMBER(18,2)) >= 700) AS large_band_charges,
         COUNT(DISTINCT CAST(AMOUNT AS NUMBER(18,2)))  AS distinct_amounts,
         COUNT(DISTINCT DATE_TRUNC('day',CREATION_DATE)) AS distinct_charge_days
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE = 'NewRequest' AND STATUS = 'Added' AND VISA_REQUEST_ID IS NOT NULL
  GROUP BY 1
), visits AS (
  SELECT VISA_REQUEST_ID, MAX(ITERATION) AS step_visits
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME = 'Apply for entry Visa' GROUP BY 1
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS WHERE NEW_REQUEST_ID IS NOT NULL
), rf AS (                                  -- refunds on EITHER leg, bridged properly
  SELECT DISTINCT VISA_REQUEST_ID AS request_id FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
  UNION
  SELECT DISTINCT b.NEW_REQUEST_ID FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
), pool AS (                                -- F4's RED population, guard enforced
  SELECT ch.*, v.step_visits, ch.charges_added - v.step_visits AS excess_charges
  FROM ch JOIN visits v ON v.VISA_REQUEST_ID = ch.VISA_REQUEST_ID
  LEFT JOIN rf ON rf.request_id = ch.VISA_REQUEST_ID
  WHERE v.step_visits >= 1                  -- excludes the pre-2019 no-step-history block
    AND ch.charges_added > v.step_visits
    AND rf.request_id IS NULL               -- no refund on either leg
), stratified AS (
  SELECT p.*,
         CASE WHEN excess_charges = 1 THEN '1 · excess 1' 
              WHEN excess_charges = 2 THEN '2 · excess 2'
              ELSE                         '3 · excess 3+' END AS stratum,
         ROW_NUMBER() OVER (PARTITION BY CASE WHEN excess_charges=1 THEN 1
                                              WHEN excess_charges=2 THEN 2 ELSE 3 END
                            ORDER BY HASH(p.VISA_REQUEST_ID)) AS pick
  FROM pool p
)
SELECT s.stratum, s.VISA_REQUEST_ID AS request_id,
       r.OWNER_ID, r.OWNER_TYPE, TRIM(e.CONTRACT_TYPE) AS contract_type,
       s.charges_added, s.step_visits, s.excess_charges,
       s.charged_aed, s.large_band_charges, s.distinct_amounts,
       s.distinct_charge_days, s.first_charge, s.last_charge,
       DATEDIFF('day', s.first_charge, s.last_charge) AS days_between,
       r.REQUEST_STATUS, r.ENTRY_VISA_IMMIGRATION_APPROVED AS approval_now
FROM stratified s
JOIN BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS r ON r.REQUEST_ID = s.VISA_REQUEST_ID
LEFT JOIN (SELECT VISA_REQUEST_ID, MAX(CONTRACT_TYPE) AS CONTRACT_TYPE
           FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES GROUP BY 1) e
       ON e.VISA_REQUEST_ID = s.VISA_REQUEST_ID
WHERE (s.stratum = '1 · excess 1'  AND s.pick <= 10)
   OR (s.stratum = '2 · excess 2'  AND s.pick <= 6)
   OR (s.stratum = '3 · excess 3+' AND s.pick <= 4)
ORDER BY s.stratum, s.excess_charges DESC, s.charged_aed DESC;


-- S2 · The timeline for those same 20 requests -- what you actually read.
--      One row per event. A genuine duplicate looks like: two charges, one step
--      visit, no rejection between them, no refund. An ordinary re-application
--      looks like: charge, rejection, refund, charge -- and should NOT be in here
--      at all, so any that appear are a rule defect worth knowing about.
WITH ch AS (
  SELECT VISA_REQUEST_ID, COUNT(*) AS charges_added
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added' AND VISA_REQUEST_ID IS NOT NULL
  GROUP BY 1
), visits AS (
  SELECT VISA_REQUEST_ID, MAX(ITERATION) AS step_visits
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME='Apply for entry Visa' GROUP BY 1
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS WHERE NEW_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT DISTINCT VISA_REQUEST_ID AS request_id FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
  UNION
  SELECT DISTINCT b.NEW_REQUEST_ID FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
), pool AS (
  SELECT ch.VISA_REQUEST_ID, ch.charges_added - v.step_visits AS excess_charges
  FROM ch JOIN visits v ON v.VISA_REQUEST_ID = ch.VISA_REQUEST_ID
  LEFT JOIN rf ON rf.request_id = ch.VISA_REQUEST_ID
  WHERE v.step_visits >= 1 AND ch.charges_added > v.step_visits AND rf.request_id IS NULL
), sample AS (
  SELECT VISA_REQUEST_ID, excess_charges FROM (
    SELECT p.*, ROW_NUMBER() OVER (PARTITION BY CASE WHEN excess_charges=1 THEN 1
                                                     WHEN excess_charges=2 THEN 2 ELSE 3 END
                                   ORDER BY HASH(p.VISA_REQUEST_ID)) AS pick
    FROM pool p)
  WHERE (excess_charges = 1 AND pick <= 10)
     OR (excess_charges = 2 AND pick <= 6)
     OR (excess_charges > 2 AND pick <= 4)
), events AS (
  SELECT s.VISA_REQUEST_ID, e.CREATION_DATE AS event_at,
         IFF(e.PURPOSE='REFUND_FOR_ENTRY_VISA','REFUND','CHARGE') AS event_type,
         CAST(e.AMOUNT AS NUMBER(18,2)) AS amount_aed, e.STATUS AS status,
         e.PURPOSE || ' · ' || COALESCE(e.PAYMENT_TYPE,'') AS detail
  FROM sample s JOIN BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
    ON e.VISA_REQUEST_ID = s.VISA_REQUEST_ID
  WHERE e.PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000','REFUND_FOR_ENTRY_VISA')
  UNION ALL
  SELECT s.VISA_REQUEST_ID, t.STARTED_AT, 'STEP_ENTERED', NULL, t.STEP_STATUS,
         t.TASK_NAME || ' · visit ' || t.ITERATION::VARCHAR
  FROM sample s JOIN BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS t
    ON t.VISA_REQUEST_ID = s.VISA_REQUEST_ID
  WHERE t.TASK_NAME ILIKE '%entry%visa%'
  UNION ALL
  SELECT s.VISA_REQUEST_ID, h.LAST_MODIFICATION_DATE, 'IMMIGRATION', NULL, NULL,
         'approval set to ' || h.ENTRY_VISA_IMMIGRATION_APPROVED
  FROM sample s JOIN BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY h
    ON h.REQUEST_ID = s.VISA_REQUEST_ID
  WHERE h.ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND NULLIF(TRIM(h.ENTRY_VISA_IMMIGRATION_APPROVED),'') IS NOT NULL
)
SELECT VISA_REQUEST_ID AS request_id, event_at::DATE AS on_date, event_type,
       amount_aed, status, detail
FROM events ORDER BY request_id, event_at;


-- S3 · TEST A LIKELY DEFECT IN F4'S RULE, found by the S1 sample.
--      F4 counts re-applications as visits to 'Apply for entry Visa' only. But QG
--      showed FOUR entry-visa steps exist:
--          Apply for entry Visa            62,076
--          Check Entry Visa Immigration Approval 60,307
--          Fix the problem of entry visa    2,064
--          Pending to fix issues of Entry Visa  464
--          Approve Entry Visa Fix Document     10
--      A case that goes to a FIX step and re-pays may never re-enter 'Apply', so it
--      would show charges > visits and be scored a duplicate when it is an ordinary
--      re-application. 6 of the 19 sampled cases currently read Need_Fix, which is
--      exactly that path.
--      This recounts F4 three ways. If the population collapses under the wider
--      definitions, F4's AED 760,338 is substantially overstated and must be re-cut.
WITH ch AS (
  SELECT VISA_REQUEST_ID, COUNT(*) AS charges_added,
         ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2))),2) AS charged_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added' AND VISA_REQUEST_ID IS NOT NULL
  GROUP BY 1
), v_apply AS (
  SELECT VISA_REQUEST_ID, MAX(ITERATION) AS visits
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME = 'Apply for entry Visa' GROUP BY 1
), v_apply_fix AS (            -- apply + the fix sub-workflow
  SELECT VISA_REQUEST_ID, COUNT(*) AS visits
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME IN ('Apply for entry Visa','Fix the problem of entry visa',
                      'Pending to fix issues of Entry Visa') GROUP BY 1
), v_all AS (                  -- every entry-visa step, including the approval check
  SELECT VISA_REQUEST_ID, COUNT(*) AS visits
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME ILIKE '%entry%visa%' GROUP BY 1
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS WHERE NEW_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT DISTINCT VISA_REQUEST_ID AS request_id FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
  UNION
  SELECT DISTINCT b.NEW_REQUEST_ID FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
)
SELECT 'a · apply step only (F4 as specified)' AS visit_definition,
       COUNT(*) AS requests, ROUND(SUM(ch.charged_aed)) AS charged_aed
FROM ch JOIN v_apply v ON v.VISA_REQUEST_ID = ch.VISA_REQUEST_ID
LEFT JOIN rf ON rf.request_id = ch.VISA_REQUEST_ID
WHERE v.visits >= 1 AND ch.charges_added > v.visits AND rf.request_id IS NULL
UNION ALL
SELECT 'b · apply + fix sub-workflow', COUNT(*), ROUND(SUM(ch.charged_aed))
FROM ch JOIN v_apply_fix v ON v.VISA_REQUEST_ID = ch.VISA_REQUEST_ID
LEFT JOIN rf ON rf.request_id = ch.VISA_REQUEST_ID
WHERE v.visits >= 1 AND ch.charges_added > v.visits AND rf.request_id IS NULL
UNION ALL
SELECT 'c · every entry-visa step', COUNT(*), ROUND(SUM(ch.charged_aed))
FROM ch JOIN v_all v ON v.VISA_REQUEST_ID = ch.VISA_REQUEST_ID
LEFT JOIN rf ON rf.request_id = ch.VISA_REQUEST_ID
WHERE v.visits >= 1 AND ch.charges_added > v.visits AND rf.request_id IS NULL
ORDER BY visit_definition;


-- =====================================================================
-- W-SERIES · Derive the entry-visa workflow from the DATA.
-- The code says what CAN happen. These say what DOES, and how often. Written
-- after F4's rule broke on a legitimate path nobody had mapped -- the third time
-- this audit over-counted because the ERP had more routes than the obvious one.
-- =====================================================================

-- W1 · The observed step graph. Pairs each entry-visa step visit with whatever
--      step the request entered next, so the real transitions and their volumes
--      fall out without trusting any assumption about the workflow's shape.
WITH steps AS (
  SELECT VISA_REQUEST_ID, TASK_NAME, STARTED_AT, STEP_STATUS,
         LEAD(TASK_NAME)  OVER (PARTITION BY VISA_REQUEST_ID ORDER BY STARTED_AT) AS next_task,
         LEAD(STARTED_AT) OVER (PARTITION BY VISA_REQUEST_ID ORDER BY STARTED_AT) AS next_at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
)
SELECT TASK_NAME AS from_step, COALESCE(next_task,'⟨end / still open⟩') AS to_step,
       COUNT(*) AS transitions,
       COUNT(DISTINCT VISA_REQUEST_ID) AS requests,
       ROUND(MEDIAN(DATEDIFF('day', STARTED_AT, next_at)),1) AS median_days
FROM steps
WHERE TASK_NAME ILIKE '%entry%visa%'
GROUP BY 1,2 HAVING COUNT(*) >= 20
ORDER BY from_step, transitions DESC;

-- W2 · WHICH STEPS ARE PAYMENT POINTS -- the question F4's rule actually turns on.
--      For every step, how often is an entry-visa charge booked while that step is
--      the most recent one entered. A step that regularly carries a charge is a
--      payment opportunity and MUST count as a "visit" in F4; a step that never
--      does must not. This replaces the guesswork that produced the 35% over-count.
WITH steps AS (
  SELECT VISA_REQUEST_ID, TASK_NAME, STARTED_AT,
         LEAD(STARTED_AT) OVER (PARTITION BY VISA_REQUEST_ID ORDER BY STARTED_AT) AS next_at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
), ch AS (
  SELECT VISA_REQUEST_ID, CREATION_DATE, CAST(AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added' AND VISA_REQUEST_ID IS NOT NULL
)
SELECT s.TASK_NAME AS step,
       COUNT(*)                                   AS step_visits,
       COUNT(ch.CREATION_DATE)                    AS charges_booked_during_step,
       ROUND(100.0*COUNT(ch.CREATION_DATE)/NULLIF(COUNT(*),0),1) AS pct_visits_with_a_charge,
       ROUND(SUM(ch.amount_aed))                  AS aed_booked
FROM steps s
LEFT JOIN ch ON ch.VISA_REQUEST_ID = s.VISA_REQUEST_ID
            AND ch.CREATION_DATE >= s.STARTED_AT
            AND (s.next_at IS NULL OR ch.CREATION_DATE < s.next_at)
GROUP BY 1
HAVING COUNT(*) >= 50
ORDER BY charges_booked_during_step DESC;
