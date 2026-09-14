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


-- W3 · EVERY route INTO 'Apply for entry Visa'. W1 only showed transitions OUT of
--      entry-visa steps. The code says the ONLY legitimate second entry-visa
--      payment comes from Rejected -> Refund -> re-Apply, and that path re-enters
--      this step. If W3 shows other steps feeding into it in volume, there are
--      re-payment routes the code answer did not cover and F4 needs them counted.
WITH steps AS (
  SELECT VISA_REQUEST_ID, TASK_NAME, STARTED_AT,
         LAG(TASK_NAME) OVER (PARTITION BY VISA_REQUEST_ID ORDER BY STARTED_AT) AS prev_task
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
)
SELECT COALESCE(prev_task,'⟨first step of the request⟩') AS arrived_from,
       COUNT(*) AS transitions, COUNT(DISTINCT VISA_REQUEST_ID) AS requests
FROM steps WHERE TASK_NAME = 'Apply for entry Visa'
GROUP BY 1 ORDER BY transitions DESC;


-- W4 · F4, RE-CUT ON THE RULE THE CODE JUSTIFIES. Supersedes every step-count
--      version (S3's a/b/c and the ITERATION comparison in Q9c).
--
--      Why abandon step counting entirely: W1 and W3 derive "transitions" with
--      LEAD/LAG over STARTED_AT, but visa tasks run in PARALLEL and step medians
--      are 0.0 days, so those queries measure temporal ADJACENCY, not causation.
--      W3 shows ~20k arrivals into 'Apply for entry Visa' from mid-flow steps while
--      ITERATION -- which counts entries to that task directly -- says only 889
--      requests ever re-enter it. The 20k is parallel-task noise. Any rule built on
--      step counts inherits it.
--
--      The code gives a rule that needs no step counts at all: the ONLY legitimate
--      second entry-visa payment is Rejected -> Refund -> re-Apply. So a charge pair
--      is a duplicate exactly when NOTHING that could justify re-paying happened
--      between the two charges. Adding more justifying events can only REMOVE
--      findings, so this can only under-count -- the correct direction.
WITH ch AS (
  SELECT VISA_REQUEST_ID, CREATION_DATE AS charged_at,
         CAST(AMOUNT AS NUMBER(18,2)) AS amount_aed,
         LAG(CREATION_DATE) OVER (PARTITION BY VISA_REQUEST_ID ORDER BY CREATION_DATE) AS prev_charged_at,
         LAG(CAST(AMOUNT AS NUMBER(18,2))) OVER (PARTITION BY VISA_REQUEST_ID ORDER BY CREATION_DATE) AS prev_amount
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added' AND VISA_REQUEST_ID IS NOT NULL
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS WHERE NEW_REQUEST_ID IS NOT NULL
), refunds AS (                       -- justifying event 1: a refund, either leg
  SELECT VISA_REQUEST_ID AS request_id, CREATION_DATE AS at
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
  UNION ALL
  SELECT b.NEW_REQUEST_ID, e.CREATION_DATE
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
), rejections AS (                    -- justifying event 2: a dated rejection
  SELECT REQUEST_ID AS request_id, LAST_MODIFICATION_DATE AS at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
), refund_step AS (                   -- justifying event 3: someone opened the refund step
  SELECT VISA_REQUEST_ID AS request_id, STARTED_AT AS at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME = 'Refund Entry Visa Application'
), pairs AS (
  SELECT c.VISA_REQUEST_ID, c.prev_charged_at, c.charged_at, c.prev_amount, c.amount_aed,
         EXISTS (SELECT 1 FROM refunds r WHERE r.request_id=c.VISA_REQUEST_ID
                  AND r.at > c.prev_charged_at AND r.at < c.charged_at)      AS refund_between,
         EXISTS (SELECT 1 FROM rejections j WHERE j.request_id=c.VISA_REQUEST_ID
                  AND j.at > c.prev_charged_at AND j.at < c.charged_at)      AS rejection_between,
         EXISTS (SELECT 1 FROM refund_step s WHERE s.request_id=c.VISA_REQUEST_ID
                  AND s.at > c.prev_charged_at AND s.at < c.charged_at)      AS refund_step_between
  FROM ch c WHERE c.prev_charged_at IS NOT NULL
)
SELECT CASE WHEN refund_between OR rejection_between OR refund_step_between
              THEN 'a · justified re-payment'
            ELSE  'b · DUPLICATE — nothing happened between the two charges' END AS verdict,
       COUNT(*)                                   AS charge_pairs,
       COUNT(DISTINCT VISA_REQUEST_ID)            AS requests,
       ROUND(SUM(amount_aed))                     AS second_charge_aed,
       ROUND(MEDIAN(DATEDIFF('day',prev_charged_at,charged_at)),1) AS median_days_apart
FROM pairs GROUP BY 1 ORDER BY verdict;


-- =====================================================================
-- A-SERIES · CHECK A re-cut to MAID grain, as the business defined it.
-- "No duplicate payments for the same maid" -- not for the same request. A maid
-- can hold more than one visa request (a stopped case then a fresh one), so
-- paying twice ACROSS requests is a duplicate the request-grain rule cannot see.
--
-- Keeps W4's justifying-event logic and adds the one that only exists at maid
-- grain: a genuinely NEW visa journey after an earlier one ended. Without it,
-- every maid who failed once and was re-tried would read as a duplicate.
-- =====================================================================

-- A1 · Duplicate entry-visa payments for the same maid.
WITH req AS (                            -- maid <-> her initial visa requests
  SELECT REQUEST_ID, OWNER_ID AS maid_id, REQUEST_STATUS, STOPPED_COMPLETED_DATE
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE = 'HOUSEMAID' AND OWNER_ID IS NOT NULL
), ch AS (
  SELECT r.maid_id, e.VISA_REQUEST_ID, e.CREATION_DATE AS charged_at,
         CAST(e.AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN req r ON r.REQUEST_ID = e.VISA_REQUEST_ID
  WHERE e.PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND e.REQUEST_TYPE = 'NewRequest' AND e.STATUS = 'Added'
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS WHERE NEW_REQUEST_ID IS NOT NULL
), refunds AS (                          -- refunds, either leg, resolved TO THE MAID
  SELECT r.maid_id, e.CREATION_DATE AS at
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e JOIN req r ON r.REQUEST_ID = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='NewRequest'
  UNION ALL
  SELECT r.maid_id, e.CREATION_DATE
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  JOIN req r    ON r.REQUEST_ID = b.NEW_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
), rejections AS (
  SELECT r.maid_id, h.LAST_MODIFICATION_DATE AS at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY h JOIN req r ON r.REQUEST_ID = h.REQUEST_ID
  WHERE h.ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND h.ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
), refund_step AS (
  SELECT r.maid_id, t.STARTED_AT AS at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS t JOIN req r ON r.REQUEST_ID = t.VISA_REQUEST_ID
  WHERE t.TASK_NAME = 'Refund Entry Visa Application'
), journey_end AS (                      -- justifying event that ONLY exists at maid grain:
  SELECT maid_id, STOPPED_COMPLETED_DATE AS at   -- an earlier visa journey actually ended
  FROM req WHERE STOPPED_COMPLETED_DATE IS NOT NULL
), seq AS (
  SELECT ch.*,
         LAG(charged_at)      OVER (PARTITION BY maid_id ORDER BY charged_at) AS prev_at,
         LAG(VISA_REQUEST_ID) OVER (PARTITION BY maid_id ORDER BY charged_at) AS prev_request
  FROM ch
), pairs AS (
  SELECT s.*,
         s.VISA_REQUEST_ID <> s.prev_request AS crosses_requests,
         EXISTS (SELECT 1 FROM refunds     x WHERE x.maid_id=s.maid_id AND x.at>s.prev_at AND x.at<s.charged_at) AS refund_between,
         EXISTS (SELECT 1 FROM rejections  x WHERE x.maid_id=s.maid_id AND x.at>s.prev_at AND x.at<s.charged_at) AS rejection_between,
         EXISTS (SELECT 1 FROM refund_step x WHERE x.maid_id=s.maid_id AND x.at>s.prev_at AND x.at<s.charged_at) AS refund_step_between,
         EXISTS (SELECT 1 FROM journey_end x WHERE x.maid_id=s.maid_id AND x.at>s.prev_at AND x.at<s.charged_at) AS prior_journey_ended
  FROM seq s WHERE s.prev_at IS NOT NULL
)
SELECT CASE WHEN refund_between OR rejection_between OR refund_step_between
              THEN 'a · justified — refund / rejection / refund step'
            WHEN prior_journey_ended AND crosses_requests
              THEN 'b · justified — a new visa journey after the last one ended'
            WHEN crosses_requests
              THEN 'c · DUPLICATE across requests — nothing ended, nothing refunded'
            ELSE  'd · DUPLICATE on one request — nothing happened between' END AS verdict,
       COUNT(*) AS charge_pairs, COUNT(DISTINCT maid_id) AS maids,
       ROUND(SUM(amount_aed)) AS second_charge_aed,
       ROUND(MEDIAN(DATEDIFF('day',prev_at,charged_at)),1) AS median_days_apart
FROM pairs GROUP BY 1 ORDER BY verdict;

-- A2 · How much of the duplicate population is only visible at MAID grain --
--      i.e. what the request-grain rule was structurally missing.
WITH req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), ch AS (
  SELECT r.maid_id, e.VISA_REQUEST_ID, CAST(e.AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e JOIN req r ON r.REQUEST_ID = e.VISA_REQUEST_ID
  WHERE e.PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND e.REQUEST_TYPE='NewRequest' AND e.STATUS='Added'
)
SELECT COUNT(DISTINCT maid_id)                                   AS maids_with_any_charge,
       COUNT(*)                                                  AS charges,
       COUNT(DISTINCT VISA_REQUEST_ID)                           AS requests,
       ROUND(1.0*COUNT(DISTINCT VISA_REQUEST_ID)/NULLIF(COUNT(DISTINCT maid_id),0),3) AS requests_per_maid
FROM ch;


-- =====================================================================
-- D-SERIES · CHECK D, change of status. Inside-country branch only, per the chart
-- and per CheckEntryVisaImmigrationApprovalStep.onDone. Stated cost 572, against
-- three other figures circulating in the company (590.54, 575.65, 572.50) -- so
-- establish what the ledger actually holds before adopting any of them.
-- =====================================================================

-- D1 · What change of status costs, and who pays it.
SELECT TRIM(CONTRACT_TYPE) AS contract_type, OWNER_TYPE,
       CAST(AMOUNT AS NUMBER(18,2)) AS amount_aed,
       COUNT(*) AS n,
       ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (),2) AS pct,
       MIN(CREATION_DATE)::DATE AS earliest, MAX(CREATION_DATE)::DATE AS latest
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE = 'CHANGE_OF_STATUS' AND STATUS = 'Added'
  AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1,2,3 HAVING COUNT(*) >= 5 ORDER BY n DESC;

-- D2 · Duplicate change-of-status payments for the same maid. Same shape as A1,
--      minus the refund logic -- change of status has no refund purpose at all,
--      so the only justifying event is a new visa journey.
WITH req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id, STOPPED_COMPLETED_DATE
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), ch AS (
  SELECT r.maid_id, e.VISA_REQUEST_ID, e.CREATION_DATE AS charged_at,
         CAST(e.AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e JOIN req r ON r.REQUEST_ID = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='CHANGE_OF_STATUS' AND e.REQUEST_TYPE='NewRequest' AND e.STATUS='Added'
), journey_end AS (
  SELECT maid_id, STOPPED_COMPLETED_DATE AS at FROM req WHERE STOPPED_COMPLETED_DATE IS NOT NULL
), seq AS (
  SELECT ch.*, LAG(charged_at) OVER (PARTITION BY maid_id ORDER BY charged_at) AS prev_at,
         LAG(VISA_REQUEST_ID) OVER (PARTITION BY maid_id ORDER BY charged_at) AS prev_request
  FROM ch
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM journey_end x
                         WHERE x.maid_id=s.maid_id AND x.at>s.prev_at AND x.at<s.charged_at)
             AND s.VISA_REQUEST_ID <> s.prev_request
              THEN 'a · justified — a new visa journey after the last one ended'
            ELSE  'b · DUPLICATE change-of-status payment' END AS verdict,
       COUNT(*) AS charge_pairs, COUNT(DISTINCT s.maid_id) AS maids,
       ROUND(SUM(s.amount_aed)) AS second_charge_aed,
       ROUND(MEDIAN(DATEDIFF('day',s.prev_at,s.charged_at)),1) AS median_days_apart
FROM seq s WHERE s.prev_at IS NOT NULL GROUP BY 1 ORDER BY verdict;

-- D3 · The fines question: "if fines apply, check who is responsible for repayment".
--      FINES_PAID_TO_US is literally that field. Four overstay money columns exist
--      and the spec already records that they are NOT reconciled to each other --
--      so read them side by side before building any rule on one of them.
SELECT FINES_PAID_TO_US,
       COUNT(*)                                              AS requests,
       COUNT_IF(OVERSTAY_FINE > 0)                           AS have_overstay_fine,
       ROUND(SUM(IFF(OVERSTAY_FINE > 0, OVERSTAY_FINE, 0)))  AS overstay_fine_aed,
       COUNT_IF(OVERSTAY_FEE  > 0)                           AS have_overstay_fee,
       ROUND(SUM(IFF(OVERSTAY_FEE  > 0, OVERSTAY_FEE,  0)))  AS overstay_fee_aed,
       COUNT_IF(OVERSTAY_FINES_BEFORE_CHALLENGING > 0)       AS have_before_challenge,
       COUNT_IF(OVERSTAY_FINES_AFTER_CHALLENGING  > 0)       AS have_after_challenge,
       ROUND(SUM(GREATEST(COALESCE(OVERSTAY_FINES_BEFORE_CHALLENGING,0)
                        - COALESCE(OVERSTAY_FINES_AFTER_CHALLENGING,0),0)))  AS reduced_by_challenge_aed
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
WHERE CREATION_DATE >= DATEADD('month',-24,CURRENT_DATE())
GROUP BY 1 ORDER BY requests DESC;


-- D4 · DECOMPOSE the change-of-status amount into base fee + embedded overstay fine.
--      D1 revealed the structure. Two coexisting schedules, and the "three
--      competing tariffs" turn out to be one tariff on three payment channels:
--        572.50            base
--        575.65 = 572.50 + 3.15          flat channel surcharge
--        590.54 = 572.50 x 1.0315        proportional channel surcharge (3.15%)
--      and the long tail is an arithmetic progression on top of each base:
--        572.50 + 50.00n   (n = overstay days)
--        590.54 + 51.57n   (the same 50/day carrying the same 3.15%)
--      So the overstay fine is NOT a separate line -- it is bundled INSIDE the
--      change-of-status fee. That is why "who repays the fine" cannot be answered
--      from the expense ledger alone: the fine has no line of its own.
WITH cos AS (
  SELECT VISA_REQUEST_ID, OWNER_ID, TRIM(CONTRACT_TYPE) AS contract_type,
         CREATION_DATE, CAST(AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='CHANGE_OF_STATUS' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
    AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
), split AS (
  SELECT c.*,
         CASE WHEN ABS(MOD(ROUND((amount_aed - 572.50)*100), 5000)) < 2 THEN 'plain 572.50 + 50/day'
              WHEN ABS(MOD(ROUND((amount_aed - 575.65)*100), 5000)) < 2 THEN 'flat +3.15 channel'
              WHEN ABS(ROUND((amount_aed - 590.54)/51.575) * 51.575 - (amount_aed - 590.54)) < 0.05
                                                                        THEN 'proportional +3.15% channel'
              ELSE 'unexplained' END AS schedule,
         CASE WHEN ABS(MOD(ROUND((amount_aed - 572.50)*100), 5000)) < 2 THEN ROUND((amount_aed-572.50)/50.0)
              WHEN ABS(MOD(ROUND((amount_aed - 575.65)*100), 5000)) < 2 THEN ROUND((amount_aed-575.65)/50.0)
              WHEN ABS(ROUND((amount_aed - 590.54)/51.575) * 51.575 - (amount_aed - 590.54)) < 0.05
                                                                        THEN ROUND((amount_aed-590.54)/51.575)
              ELSE NULL END AS implied_overstay_days
  FROM cos c
)
SELECT schedule,
       IFF(COALESCE(implied_overstay_days,0) = 0,'no fine','fine embedded') AS has_fine,
       COUNT(*)                                  AS lines,
       COUNT(DISTINCT OWNER_ID)                  AS maids,
       ROUND(SUM(amount_aed))                    AS total_aed,
       ROUND(SUM(IFF(COALESCE(implied_overstay_days,0) > 0,
                     amount_aed - IFF(schedule='proportional +3.15% channel',590.54,
                                 IFF(schedule='flat +3.15 channel',575.65,572.50)), 0)))
                                                 AS embedded_fine_aed,
       MAX(implied_overstay_days)                AS max_implied_days
FROM split GROUP BY 1,2 ORDER BY lines DESC;


-- D5 · RECONCILE the two fines figures. D4 says AED 970,081/yr of overstay fine is
--      embedded in the change-of-status fee. D3 says the request's own OVERSTAY_FINE
--      column holds ~2.97m/yr. A 3x gap. Either they are different populations, or
--      one is the fine DECLARED and the other the part SETTLED, or the same fine is
--      double-counted. Join them at request grain -- the only place the question is
--      decidable. No fines figure is publishable until this runs.
WITH cos AS (
  SELECT VISA_REQUEST_ID, CAST(AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='CHANGE_OF_STATUS' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
    AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
), split AS (
  SELECT VISA_REQUEST_ID,
         CASE WHEN ABS(MOD(ROUND((amount_aed - 572.50)*100), 5000)) < 2
                   THEN GREATEST(amount_aed - 572.50, 0)
              WHEN ABS(MOD(ROUND((amount_aed - 575.65)*100), 5000)) < 2
                   THEN GREATEST(amount_aed - 575.65, 0)
              WHEN ABS(ROUND((amount_aed - 590.54)/51.575) * 51.575 - (amount_aed - 590.54)) < 0.05
                   THEN GREATEST(amount_aed - 590.54, 0)
              ELSE 0 END AS embedded_fine_aed
  FROM cos
), agg AS (
  SELECT VISA_REQUEST_ID, SUM(embedded_fine_aed) AS embedded_fine_aed
  FROM split GROUP BY 1
)
SELECT CASE WHEN a.embedded_fine_aed = 0 AND COALESCE(r.OVERSTAY_FINE,0) = 0
                 THEN 'a · no fine on either side'
            WHEN a.embedded_fine_aed > 0 AND COALESCE(r.OVERSTAY_FINE,0) = 0
                 THEN 'b · fine embedded in the fee, NOTHING in OVERSTAY_FINE'
            WHEN a.embedded_fine_aed = 0 AND COALESCE(r.OVERSTAY_FINE,0) > 0
                 THEN 'c · OVERSTAY_FINE recorded, NOTHING embedded in the fee'
            WHEN ABS(a.embedded_fine_aed - r.OVERSTAY_FINE) < 1
                 THEN 'd · both, and they agree'
            ELSE 'e · both, and they DISAGREE' END                       AS reconciliation,
       COUNT(*)                                          AS requests,
       ROUND(SUM(a.embedded_fine_aed))                   AS embedded_aed,
       ROUND(SUM(COALESCE(r.OVERSTAY_FINE,0)))           AS overstay_fine_col_aed,
       ROUND(SUM(COALESCE(r.OVERSTAY_FEE,0)))            AS overstay_fee_col_aed,
       COUNT_IF(r.FINES_PAID_TO_US = '01')               AS flagged_repaid_to_us
FROM agg a
JOIN BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS r ON r.REQUEST_ID = a.VISA_REQUEST_ID
GROUP BY 1 ORDER BY requests DESC;


-- D6 · The seven lines the tariff model does not explain, at AED 8,563 average --
--      15x the base fee, against a ledger whose next-largest line is 2,272.50.
--      Aggregate only: no names, no ids that identify a person.
WITH cos AS (
  SELECT VISA_REQUEST_ID, TRIM(CONTRACT_TYPE) AS contract_type, OWNER_TYPE,
         CREATION_DATE, CAST(AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='CHANGE_OF_STATUS' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
    AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
)
SELECT amount_aed, contract_type, OWNER_TYPE,
       COUNT(*) AS lines, MIN(CREATION_DATE)::DATE AS earliest, MAX(CREATION_DATE)::DATE AS latest
FROM cos
WHERE NOT (ABS(MOD(ROUND((amount_aed - 572.50)*100), 5000)) < 2
        OR ABS(MOD(ROUND((amount_aed - 575.65)*100), 5000)) < 2
        OR ABS(ROUND((amount_aed - 590.54)/51.575) * 51.575 - (amount_aed - 590.54)) < 0.05)
GROUP BY 1,2,3 ORDER BY amount_aed DESC;


-- D7 · Is the AED 50/day ladder real, or is the modulo matcher inventing it?
--      D4's max implied 515 days is not credible. If the ladder is real the implied
--      day counts cluster at small integers; if the matcher is over-permissive they
--      spread uniformly. This is the control on D4's headline figure.
WITH cos AS (
  SELECT CAST(AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='CHANGE_OF_STATUS' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
    AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
), d AS (
  SELECT CASE WHEN ABS(MOD(ROUND((amount_aed - 572.50)*100), 5000)) < 2
                   THEN ROUND((amount_aed - 572.50)/50.0)
              WHEN ABS(MOD(ROUND((amount_aed - 575.65)*100), 5000)) < 2
                   THEN ROUND((amount_aed - 575.65)/50.0)
              WHEN ABS(ROUND((amount_aed - 590.54)/51.575) * 51.575 - (amount_aed - 590.54)) < 0.05
                   THEN ROUND((amount_aed - 590.54)/51.575)
              ELSE NULL END AS implied_days
  FROM cos
)
SELECT CASE WHEN implied_days IS NULL THEN 'z · unexplained'
            WHEN implied_days = 0     THEN '0 days'
            WHEN implied_days <= 7    THEN '1-7 days'
            WHEN implied_days <= 30   THEN '8-30 days'
            WHEN implied_days <= 90   THEN '31-90 days'
            WHEN implied_days <= 180  THEN '91-180 days'
            ELSE '181+ days (suspect)' END              AS band,
       COUNT(*)                                         AS lines,
       ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (),2)    AS pct_of_lines,
       MIN(implied_days) AS min_days, MAX(implied_days) AS max_days
FROM d GROUP BY 1 ORDER BY band;


-- D8 · How much of the AED 970,081 sits in the long tail? D7 showed the ladder is
--      real (a clean monotonic decay, no tail bulge), but 15 lines imply 182-515
--      days and I estimated their weight instead of measuring it -- wrongly, by an
--      order of magnitude. Measure it. If the 181+ band carries a large share, the
--      headline needs a stated-with-and-without figure.
WITH cos AS (
  SELECT CAST(AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='CHANGE_OF_STATUS' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
    AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
), d AS (
  SELECT amount_aed,
         CASE WHEN ABS(MOD(ROUND((amount_aed - 572.50)*100), 5000)) < 2
                   THEN ROUND((amount_aed - 572.50)/50.0)
              WHEN ABS(MOD(ROUND((amount_aed - 575.65)*100), 5000)) < 2
                   THEN ROUND((amount_aed - 575.65)/50.0)
              WHEN ABS(ROUND((amount_aed - 590.54)/51.575) * 51.575 - (amount_aed - 590.54)) < 0.05
                   THEN ROUND((amount_aed - 590.54)/51.575)
              ELSE NULL END AS implied_days,
         CASE WHEN ABS(MOD(ROUND((amount_aed - 572.50)*100), 5000)) < 2
                   THEN GREATEST(amount_aed - 572.50, 0)
              WHEN ABS(MOD(ROUND((amount_aed - 575.65)*100), 5000)) < 2
                   THEN GREATEST(amount_aed - 575.65, 0)
              WHEN ABS(ROUND((amount_aed - 590.54)/51.575) * 51.575 - (amount_aed - 590.54)) < 0.05
                   THEN GREATEST(amount_aed - 590.54, 0)
              ELSE 0 END AS embedded_fine_aed
  FROM cos
)
SELECT CASE WHEN implied_days IS NULL THEN 'z · unexplained'
            WHEN implied_days = 0     THEN '0 days'
            WHEN implied_days <= 7    THEN '1-7 days'
            WHEN implied_days <= 30   THEN '8-30 days'
            WHEN implied_days <= 90   THEN '31-90 days'
            WHEN implied_days <= 180  THEN '91-180 days'
            ELSE '181+ days (suspect)' END              AS band,
       COUNT(*)                                         AS lines,
       ROUND(SUM(embedded_fine_aed))                    AS embedded_fine_aed,
       ROUND(100.0*SUM(embedded_fine_aed)
             / NULLIF(SUM(SUM(embedded_fine_aed)) OVER (),0),2) AS pct_of_fine_total
FROM d GROUP BY 1 ORDER BY embedded_fine_aed DESC;


-- =====================================================================
-- B-SERIES · CHECK B, as the business defines it: "rejected -> partial refund
-- claimed within 60 days, else record a loss". Both branches.
--
-- STRUCTURAL CONSTRAINT FOUND BEFORE WRITING THE CHECK: a 60-day test needs a
-- rejection DATE, and only history-sourced rejections have one. SHOW COLUMNS on
-- INITIAL_VISA_REQUESTS confirms there is no LAST_MODIFICATION_DATE and no
-- rejection-date column on the live row -- 118 columns, none of them a date for
-- this event. So the ~22.6% of rejections that exist only as a live point-read
-- CANNOT BE CLOCKED AT ALL. B1 runs on the dated subset; B2 prices what B1
-- cannot see; B0 looks for a task-based date that would rescue it.
-- =====================================================================

-- B0 · Is there a task whose end date dates the immigration decision? If a step
--      like 'Check Entry Visa Immigration Approval' exists, its ENDED_AT dates
--      live-only rejections and B1's population roughly doubles. This is the
--      cheapest possible unblock, so ask before accepting the constraint.
SELECT TASK_NAME,
       COUNT(*)                       AS task_rows,
       COUNT(DISTINCT VISA_REQUEST_ID) AS requests,
       MIN(STARTED_AT)::DATE          AS first_seen,
       MAX(STARTED_AT)::DATE          AS last_seen
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
WHERE TASK_NAME ILIKE '%immigration%' OR TASK_NAME ILIKE '%approv%'
   OR TASK_NAME ILIKE '%refund%'      OR TASK_NAME ILIKE '%reject%'
   OR TASK_NAME ILIKE '%entry visa%'
GROUP BY 1 ORDER BY task_rows DESC;


-- B1 · THE CHECK B LEDGER. One row per dated rejection: was the refund claimed,
--      was it inside 60 days, and what is the loss when it never came.
--      Discipline carried in from the A/R series:
--        * refunds resolved to the MAID, not the request (A's lesson) -- and the
--          query reports how often that mattered, so the re-cut is not asserted;
--        * both refund legs, bridged through CANCEL_VISA_REQUESTS.NEW_REQUEST_ID
--          (the cross-leg id namespaces do not overlap safely);
--        * 1:1 pairing bounded by the maid's NEXT rejection (R1b's lesson -- an
--          unbounded "any later refund" fans out and inflates);
--        * rejections inside the last 60 days are NOT called a loss; they are
--          still in window, and calling them lost would manufacture a finding.
--      Recoverable is priced with the PROVEN tariff: the government keeps a flat
--      AED 283.00 and never returns a surcharge (1,148 refunds, variances sum to
--      zero). So recoverable = charged - 283.00, not the whole charge.
WITH req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS
  WHERE NEW_REQUEST_ID IS NOT NULL
), rej_raw AS (
  SELECT r.maid_id, h.REQUEST_ID, MIN(h.LAST_MODIFICATION_DATE) AS rejected_at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY h
  JOIN req r ON r.REQUEST_ID = h.REQUEST_ID
  WHERE h.ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND h.ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
  GROUP BY 1,2
), rej AS (
  SELECT maid_id, REQUEST_ID, rejected_at,
         LEAD(rejected_at) OVER (PARTITION BY maid_id ORDER BY rejected_at) AS next_rejected_at
  FROM rej_raw
), chg AS (
  SELECT VISA_REQUEST_ID, SUM(CAST(AMOUNT AS NUMBER(18,2))) AS charged_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added'
  GROUP BY 1
), rf AS (
  SELECT r.maid_id, e.VISA_REQUEST_ID AS refund_request_id, e.CREATION_DATE AS refunded_at
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN req r ON r.REQUEST_ID = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='NewRequest'
  UNION ALL
  SELECT r.maid_id, b.NEW_REQUEST_ID, e.CREATION_DATE
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  JOIN req r    ON r.REQUEST_ID = b.NEW_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
), matched AS (
  SELECT j.maid_id, j.REQUEST_ID, j.rejected_at, c.charged_aed,
         (SELECT MIN(f.refunded_at) FROM rf f
           WHERE f.maid_id = j.maid_id AND f.refunded_at >= j.rejected_at
             AND (j.next_rejected_at IS NULL OR f.refunded_at < j.next_rejected_at)) AS refunded_at,
         (SELECT MIN(f.refunded_at) FROM rf f
           WHERE f.maid_id = j.maid_id AND f.refund_request_id = j.REQUEST_ID
             AND f.refunded_at >= j.rejected_at
             AND (j.next_rejected_at IS NULL OR f.refunded_at < j.next_rejected_at)) AS refunded_same_request_at
  FROM rej j LEFT JOIN chg c ON c.VISA_REQUEST_ID = j.REQUEST_ID
)
SELECT CASE WHEN charged_aed IS NULL
                 THEN 'x · rejected, but no entry-visa charge — nothing to claim'
            WHEN refunded_at IS NULL AND rejected_at > DATEADD('day',-60,CURRENT_DATE())
                 THEN 'w · still inside the 60-day window — not yet a loss'
            WHEN refunded_at IS NULL
                 THEN 'd · NEVER REFUNDED — loss'
            WHEN DATEDIFF('day', rejected_at, refunded_at) <= 60
                 THEN 'a · refunded within 60 days'
            ELSE 'c · refunded LATE (> 60 days)' END                      AS verdict,
       COUNT(*)                                                   AS rejections,
       COUNT(DISTINCT maid_id)                                    AS maids,
       ROUND(SUM(COALESCE(charged_aed,0)))                        AS charged_aed,
       ROUND(SUM(GREATEST(COALESCE(charged_aed,0) - 283.00, 0)))  AS recoverable_aed,
       COUNT_IF(refunded_at IS NOT NULL
            AND refunded_same_request_at IS NULL)                  AS refund_only_on_a_sibling_request,
       ROUND(MEDIAN(DATEDIFF('day', rejected_at, refunded_at)),1)  AS median_days_to_claim,
       MAX(DATEDIFF('day', rejected_at, refunded_at))              AS max_days_to_claim,
       MIN(rejected_at)::DATE AS earliest, MAX(rejected_at)::DATE AS latest
FROM matched GROUP BY 1 ORDER BY verdict;


-- B2 · WHAT B1 CANNOT SEE, PRICED. The rejection set is a union of the revision
--      history and the live point-read, and each misses part of the other (measured:
--      history misses 22.6%, live misses 41.5%). Only the history side carries a
--      date. So this splits the union three ways and prices each -- if the
--      undateable slice is large, check B cannot be built as a 60-day test at all
--      and the 60 days has to become "was it ever claimed".
WITH req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), hist AS (
  SELECT DISTINCT REQUEST_ID
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
), live AS (
  SELECT REQUEST_ID
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
), u AS (
  SELECT COALESCE(h.REQUEST_ID, l.REQUEST_ID) AS REQUEST_ID,
         CASE WHEN h.REQUEST_ID IS NOT NULL AND l.REQUEST_ID IS NOT NULL
                   THEN 'a · in both — dateable'
              WHEN h.REQUEST_ID IS NOT NULL
                   THEN 'b · history only — dateable'
              ELSE 'c · LIVE ONLY — no date exists, cannot be clocked' END AS source
  FROM hist h FULL OUTER JOIN live l ON l.REQUEST_ID = h.REQUEST_ID
), chg AS (
  SELECT VISA_REQUEST_ID, SUM(CAST(AMOUNT AS NUMBER(18,2))) AS charged_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added'
  GROUP BY 1
)
SELECT u.source,
       COUNT(*)                                                   AS requests,
       COUNT(DISTINCT r.maid_id)                                  AS maids,
       COUNT_IF(c.charged_aed IS NOT NULL)                        AS with_a_charge,
       ROUND(SUM(COALESCE(c.charged_aed,0)))                      AS charged_aed,
       ROUND(SUM(GREATEST(COALESCE(c.charged_aed,0) - 283.00, 0))) AS recoverable_aed
FROM u
LEFT JOIN req r ON r.REQUEST_ID = u.REQUEST_ID
LEFT JOIN chg c ON c.VISA_REQUEST_ID = u.REQUEST_ID
GROUP BY 1 ORDER BY u.source;


-- B3 · COMPLETENESS CONTROL ON THE REJECTION SET, from the refund side.
--      GDRFA scopes the refund entitlement to REJECTION; cancellation is a separate
--      non-refundable service. So every refund should trace to a rejection. One that
--      does not is either a rejection we failed to detect -- which makes B1's
--      denominator too small -- or a refund claimed where no entitlement existed.
--      Run it before quoting B1's loss: a large orphan count invalidates the ratio.
WITH req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS
  WHERE NEW_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT r.maid_id, e.VISA_REQUEST_ID AS req_id, 'NewRequest' AS leg,
         e.CREATION_DATE AS refunded_at, CAST(ABS(e.AMOUNT) AS NUMBER(18,2)) AS refund_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN req r ON r.REQUEST_ID = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='NewRequest'
  UNION ALL
  SELECT r.maid_id, b.NEW_REQUEST_ID, 'CancelRequest',
         e.CREATION_DATE, CAST(ABS(e.AMOUNT) AS NUMBER(18,2))
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  JOIN req r    ON r.REQUEST_ID = b.NEW_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
), hist AS (
  SELECT DISTINCT REQUEST_ID
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
), live AS (
  SELECT REQUEST_ID
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
), rej_maid AS (
  SELECT DISTINCT r.maid_id
  FROM req r
  WHERE r.REQUEST_ID IN (SELECT REQUEST_ID FROM hist)
     OR r.REQUEST_ID IN (SELECT REQUEST_ID FROM live)
)
SELECT CASE WHEN rj.maid_id IS NOT NULL THEN 'a · refund traces to a rejection'
            ELSE 'b · ORPHAN — refund with no rejection anywhere for this maid' END AS coverage,
       rf.leg,
       COUNT(*)                        AS refunds,
       COUNT(DISTINCT rf.maid_id)      AS maids,
       ROUND(SUM(rf.refund_aed))       AS refund_aed,
       MIN(rf.refunded_at)::DATE       AS earliest,
       MAX(rf.refunded_at)::DATE       AS latest
FROM rf LEFT JOIN rej_maid rj ON rj.maid_id = rf.maid_id
GROUP BY 1,2 ORDER BY refunds DESC;


-- B1-fixed · B1 failed: "Unsupported subquery type cannot be evaluated". Snowflake
--      will not run a correlated scalar subquery whose predicate is an inequality
--      plus an OR. Same pairing, expressed as a non-equi LEFT JOIN + MIN, which it
--      does support. Logic is unchanged: first refund at or after this rejection
--      and strictly before the maid's NEXT rejection (1:1, no fan-out).
WITH req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS
  WHERE NEW_REQUEST_ID IS NOT NULL
), rej_raw AS (
  SELECT r.maid_id, h.REQUEST_ID, MIN(h.LAST_MODIFICATION_DATE) AS rejected_at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY h
  JOIN req r ON r.REQUEST_ID = h.REQUEST_ID
  WHERE h.ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND h.ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
  GROUP BY 1,2
), rej AS (
  SELECT maid_id, REQUEST_ID, rejected_at,
         LEAD(rejected_at) OVER (PARTITION BY maid_id ORDER BY rejected_at) AS next_rejected_at
  FROM rej_raw
), chg AS (
  SELECT VISA_REQUEST_ID, SUM(CAST(AMOUNT AS NUMBER(18,2))) AS charged_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added'
  GROUP BY 1
), rf AS (
  SELECT r.maid_id, e.VISA_REQUEST_ID AS refund_request_id, e.CREATION_DATE AS refunded_at
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN req r ON r.REQUEST_ID = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='NewRequest'
  UNION ALL
  SELECT r.maid_id, b.NEW_REQUEST_ID, e.CREATION_DATE
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  JOIN req r    ON r.REQUEST_ID = b.NEW_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
), matched AS (
  SELECT j.maid_id, j.REQUEST_ID, j.rejected_at, c.charged_aed,
         MIN(f.refunded_at)                                                     AS refunded_at,
         MIN(CASE WHEN f.refund_request_id = j.REQUEST_ID THEN f.refunded_at END) AS refunded_same_request_at
  FROM rej j
  LEFT JOIN chg c ON c.VISA_REQUEST_ID = j.REQUEST_ID
  LEFT JOIN rf  f ON f.maid_id = j.maid_id
                 AND f.refunded_at >= j.rejected_at
                 AND (j.next_rejected_at IS NULL OR f.refunded_at < j.next_rejected_at)
  GROUP BY j.maid_id, j.REQUEST_ID, j.rejected_at, c.charged_aed
)
SELECT CASE WHEN charged_aed IS NULL
                 THEN 'x · rejected, but no entry-visa charge — nothing to claim'
            WHEN refunded_at IS NULL AND rejected_at > DATEADD('day',-60,CURRENT_DATE())
                 THEN 'w · still inside the 60-day window — not yet a loss'
            WHEN refunded_at IS NULL
                 THEN 'd · NEVER REFUNDED — loss'
            WHEN DATEDIFF('day', rejected_at, refunded_at) <= 60
                 THEN 'a · refunded within 60 days'
            ELSE 'c · refunded LATE (> 60 days)' END                      AS verdict,
       COUNT(*)                                                   AS rejections,
       COUNT(DISTINCT maid_id)                                    AS maids,
       ROUND(SUM(COALESCE(charged_aed,0)))                        AS charged_aed,
       ROUND(SUM(GREATEST(COALESCE(charged_aed,0) - 283.00, 0)))  AS recoverable_aed,
       COUNT_IF(refunded_at IS NOT NULL
            AND refunded_same_request_at IS NULL)                  AS refund_only_on_a_sibling_request,
       ROUND(MEDIAN(DATEDIFF('day', rejected_at, refunded_at)),1)  AS median_days_to_claim,
       MAX(DATEDIFF('day', rejected_at, refunded_at))              AS max_days_to_claim,
       MIN(rejected_at)::DATE AS earliest, MAX(rejected_at)::DATE AS latest
FROM matched GROUP BY 1 ORDER BY verdict;


-- B4 · WHY 45% OF REFUNDS HAVE NO REJECTION. B3 found 656 orphan refunds worth
--      AED 411,981 -- half the refund book -- with no rejection anywhere for the
--      maid. The obvious suspect is the rejection-history FLOOR: the orphan
--      NewRequest refunds start 2024-04-02, and rejection change-events do not go
--      back that far. If the orphans sit mostly BEFORE the floor, the rejection
--      set is sound and check B simply has to be scoped to the post-floor window.
--      If they persist AFTER it, rejection detection is broken and check B cannot
--      be built on this signal at all. That is the whole question, so measure it
--      rather than assume the flattering answer.
WITH fl AS (
  SELECT MIN(LAST_MODIFICATION_DATE) AS rej_floor
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
), req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS
  WHERE NEW_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT r.maid_id, 'NewRequest' AS leg, e.CREATION_DATE AS refunded_at,
         CAST(ABS(e.AMOUNT) AS NUMBER(18,2)) AS refund_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN req r ON r.REQUEST_ID = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='NewRequest'
  UNION ALL
  SELECT r.maid_id, 'CancelRequest', e.CREATION_DATE, CAST(ABS(e.AMOUNT) AS NUMBER(18,2))
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  JOIN req r    ON r.REQUEST_ID = b.NEW_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
), rej_maid AS (
  SELECT DISTINCT r.maid_id FROM req r
  WHERE r.REQUEST_ID IN (SELECT DISTINCT REQUEST_ID
                         FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
                         WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
                           AND ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected')
     OR r.REQUEST_ID IN (SELECT REQUEST_ID FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
                         WHERE ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected')
)
SELECT IFF(rf.refunded_at < fl.rej_floor,
           'BEFORE the rejection-history floor', 'after the floor')          AS period,
       IFF(rj.maid_id IS NOT NULL, 'traces to a rejection', 'ORPHAN')        AS coverage,
       rf.leg,
       COUNT(*)                    AS refunds,
       COUNT(DISTINCT rf.maid_id)  AS maids,
       ROUND(SUM(rf.refund_aed))   AS refund_aed,
       MIN(fl.rej_floor)::DATE     AS floor_is,
       MIN(rf.refunded_at)::DATE   AS earliest,
       MAX(rf.refunded_at)::DATE   AS latest
FROM rf CROSS JOIN fl
LEFT JOIN rej_maid rj ON rj.maid_id = rf.maid_id
GROUP BY 1,2,3 ORDER BY period, coverage, refunds DESC;


-- B5 · THE TASK-BASED RESCUE. B0 confirmed 'Check Entry Visa Immigration Approval'
--      runs on 56,634 requests back to 2019-04-03 -- and the tasks view carries
--      ITERATION, the number of times a request cycled back through a step. A
--      request that RE-ENTERS immigration approval was sent back, which is a
--      rejection signal owing nothing to the approval field or its history floor.
--      'Fix the problem of entry visa' (1,851 requests) is the same story.
--      So: how many of the orphan refunds do these tasks explain? Whatever they
--      explain, check B can key on -- and it is dateable via COMPLETED_AT, which
--      also rescues the 196 live-only rejections B2 could not clock.
WITH req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS
  WHERE NEW_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT r.maid_id, e.CREATION_DATE AS refunded_at,
         CAST(ABS(e.AMOUNT) AS NUMBER(18,2)) AS refund_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN req r ON r.REQUEST_ID = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='NewRequest'
  UNION ALL
  SELECT r.maid_id, e.CREATION_DATE, CAST(ABS(e.AMOUNT) AS NUMBER(18,2))
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  JOIN req r    ON r.REQUEST_ID = b.NEW_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
), sig AS (
  SELECT VISA_REQUEST_ID,
         MAX(IFF(TASK_NAME='Check Entry Visa Immigration Approval' AND ITERATION > 1,1,0)) AS immigration_revisit,
         MAX(IFF(TASK_NAME IN ('Fix the problem of entry visa',
                               'Pending to fix issues of Entry Visa'),1,0))                AS fix_step,
         MAX(IFF(TASK_NAME='Refund Entry Visa Application',1,0))                           AS refund_task
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
  GROUP BY 1
), maid_sig AS (
  SELECT r.maid_id,
         MAX(s.immigration_revisit) AS immigration_revisit,
         MAX(s.fix_step)            AS fix_step,
         MAX(s.refund_task)         AS refund_task
  FROM sig s JOIN req r ON r.REQUEST_ID = s.VISA_REQUEST_ID
  GROUP BY 1
), rej_maid AS (
  SELECT DISTINCT r.maid_id FROM req r
  WHERE r.REQUEST_ID IN (SELECT DISTINCT REQUEST_ID
                         FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
                         WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
                           AND ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected')
     OR r.REQUEST_ID IN (SELECT REQUEST_ID FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
                         WHERE ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected')
)
SELECT CASE WHEN rj.maid_id IS NOT NULL     THEN 'a · approval field says rejected'
            WHEN m.immigration_revisit = 1  THEN 'b · no field rejection, but RE-ENTERED immigration approval'
            WHEN m.fix_step = 1             THEN 'c · no field rejection, but went through an entry-visa fix step'
            WHEN m.refund_task = 1          THEN 'd · no field rejection, only a refund task'
            ELSE                                 'e · NO SIGNAL AT ALL — unexplained refund' END AS explains_the_refund,
       COUNT(*)                        AS refunds,
       COUNT(DISTINCT rf.maid_id)      AS maids,
       ROUND(SUM(rf.refund_aed))       AS refund_aed,
       MIN(rf.refunded_at)::DATE       AS earliest,
       MAX(rf.refunded_at)::DATE       AS latest
FROM rf
LEFT JOIN rej_maid rj ON rj.maid_id = rf.maid_id
LEFT JOIN maid_sig m  ON m.maid_id  = rf.maid_id
GROUP BY 1 ORDER BY refunds DESC;


-- B6 · THE DECISIVE TEST, and the one with AED 3.45m riding on it.
--      B4 showed the orphan rate falls 70.8% -> 24.7% across the rejection-history
--      floor, so the floor explains much of B3 -- but the residue INVERTS by leg:
--      after the floor, orphans are mostly CANCEL-leg (151 vs 50), and 88.8% of
--      post-floor cancel-leg refunds are orphans. B5 then showed the immigration
--      RE-ENTRY signal explains 447 of 656 orphans overall. The question B5 cannot
--      answer, because it does not split by leg, is WHICH orphans it explains.
--        * If the cancel-leg orphans carry a re-entry signal, those cancellations
--          DID follow a rejection we simply could not see, and F0c stands.
--        * If they carry no signal at all, cancellations are being refunded with no
--          rejection anywhere -- and the AED 3.45m we moved from "recoverable" to
--          "cost" on the GDRFA reading was moved wrongly.
--      Two tightenings over B5, both of which can only REDUCE the coverage it
--      claimed, which is the honest direction: the signal must sit on the maid's
--      timeline BEFORE the refund, and a signal that only appears AFTER the refund
--      is called out rather than counted.
WITH fl AS (
  SELECT MIN(LAST_MODIFICATION_DATE) AS rej_floor
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
), req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), bridge AS (
  SELECT NEW_REQUEST_ID, REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS
  WHERE NEW_REQUEST_ID IS NOT NULL
), rf AS (
  SELECT r.maid_id, 'NewRequest' AS leg, e.CREATION_DATE AS refunded_at,
         CAST(ABS(e.AMOUNT) AS NUMBER(18,2)) AS refund_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN req r ON r.REQUEST_ID = e.VISA_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='NewRequest'
  UNION ALL
  SELECT r.maid_id, 'CancelRequest', e.CREATION_DATE, CAST(ABS(e.AMOUNT) AS NUMBER(18,2))
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
  JOIN bridge b ON b.cancel_request_id = e.VISA_REQUEST_ID
  JOIN req r    ON r.REQUEST_ID = b.NEW_REQUEST_ID
  WHERE e.PURPOSE='REFUND_FOR_ENTRY_VISA' AND e.STATUS='Added' AND e.REQUEST_TYPE='CancelRequest'
), rej_dated AS (          -- signal 1: the approval field, dated from its history
  SELECT r.maid_id, MIN(h.LAST_MODIFICATION_DATE) AS at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY h
  JOIN req r ON r.REQUEST_ID = h.REQUEST_ID
  WHERE h.ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1
    AND h.ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
  GROUP BY 1
), revisit AS (            -- signal 2: sent back into immigration approval. STARTED_AT
  SELECT r.maid_id, MIN(t.STARTED_AT) AS at   -- is the moment of the send-back itself
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS t
  JOIN req r ON r.REQUEST_ID = t.VISA_REQUEST_ID
  WHERE t.TASK_NAME = 'Check Entry Visa Immigration Approval' AND t.ITERATION > 1
  GROUP BY 1
), fixstep AS (            -- signal 3: an explicit entry-visa fix step
  SELECT r.maid_id, MIN(t.STARTED_AT) AS at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS t
  JOIN req r ON r.REQUEST_ID = t.VISA_REQUEST_ID
  WHERE t.TASK_NAME IN ('Fix the problem of entry visa','Pending to fix issues of Entry Visa')
  GROUP BY 1
)
SELECT IFF(rf.refunded_at < fl.rej_floor,'before the floor','after the floor')  AS period,
       rf.leg,
       CASE WHEN j.at  IS NOT NULL AND j.at  <= rf.refunded_at THEN 'a · field rejection, before the refund'
            WHEN rv.at IS NOT NULL AND rv.at <= rf.refunded_at THEN 'b · sent back into immigration approval'
            WHEN fx.at IS NOT NULL AND fx.at <= rf.refunded_at THEN 'c · entry-visa fix step'
            WHEN COALESCE(j.at, rv.at, fx.at) IS NOT NULL      THEN 'd · signal exists but only AFTER the refund'
            ELSE                                                    'e · NO SIGNAL AT ALL' END AS signal,
       COUNT(*)                       AS refunds,
       COUNT(DISTINCT rf.maid_id)     AS maids,
       ROUND(SUM(rf.refund_aed))      AS refund_aed,
       MIN(rf.refunded_at)::DATE      AS earliest,
       MAX(rf.refunded_at)::DATE      AS latest
FROM rf CROSS JOIN fl
LEFT JOIN rej_dated j  ON j.maid_id  = rf.maid_id
LEFT JOIN revisit   rv ON rv.maid_id = rf.maid_id
LEFT JOIN fixstep   fx ON fx.maid_id = rf.maid_id
GROUP BY 1,2,3 ORDER BY period, leg, signal;


-- B7 · CLOSE B6'S BLIND SPOT BEFORE OVERTURNING F0c. B6 hunted for rejection
--      signals in INITIAL_VISA_REQUESTS* -- the NEW-request tables -- and then
--      judged the CANCEL leg with them. But CANCEL_VISA_REQUESTS_TASKS exists:
--      the cancel leg runs its own workflow. A rejection recorded there would be
--      invisible to every signal B6 tested, and B6's 75.3% "no signal" on the
--      cancel leg would be an artifact of looking in the wrong table.
--      CANCEL_VISA_REQUESTS has no rejection column (checked), so the task
--      vocabulary is the place to look. Enumerate it before concluding anything.
SELECT TASK_NAME,
       COUNT(*)                        AS task_rows,
       COUNT(DISTINCT VISA_REQUEST_ID) AS cancel_requests,
       MIN(STARTED_AT)::DATE           AS first_seen,
       MAX(STARTED_AT)::DATE           AS last_seen
FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS_TASKS
GROUP BY 1 ORDER BY task_rows DESC;


-- B8 · THE FINDING B7 OPENS. B7 closed the blind spot the wrong way for F0c:
--      the cancel workflow has NO rejection concept at all (44 task names, none of
--      them a rejection or immigration-approval step), so B6's 75.3% "no signal"
--      was not an artifact of looking in the wrong table -- there was nothing to
--      find. And the cancel workflow has a FIRST-CLASS refund step,
--      'Refund Entry Visa Application', 237 rows on 236 cancel requests since
--      2024-10-19, firing with no rejection anywhere.
--      So the refund is NOT scoped to rejection, and F0c's mechanism is wrong.
--      But 236 of 99,748 cancel requests is the step barely being used -- which
--      turns the AED 3.45m from "cost, by policy" into "a refund route exists and
--      we take it on a fraction of cases". This query measures that gap.
--
--      TWO HONESTY CONSTRAINTS BUILT IN, because without them this over-claims:
--        * The step only exists from 2024-10-19. Judging earlier cancellations
--          against it is anachronistic, so period is a dimension, not a filter.
--        * An entry visa that was CONSUMED cannot be refunded. A maid who reached
--          a residence visa used it. So "reached RVISA" splits the population --
--          only the unconsumed side is recoverable, and conflating them would
--          inflate the finding exactly the way F0c was inflated in the first place.
WITH req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id, RVISA_ISSUANCE_DATE, ENTRY_VISA_ISSUANCE_DATE
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), cvr AS (
  SELECT REQUEST_ID AS cancel_request_id, NEW_REQUEST_ID, CREATION_DATE AS cancel_created_at
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS
  WHERE NEW_REQUEST_ID IS NOT NULL
), chg AS (
  SELECT VISA_REQUEST_ID, SUM(CAST(AMOUNT AS NUMBER(18,2))) AS charged_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added'
  GROUP BY 1
), refund_task AS (
  SELECT DISTINCT VISA_REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS_TASKS
  WHERE TASK_NAME = 'Refund Entry Visa Application'
), refund_exp AS (
  SELECT DISTINCT VISA_REQUEST_ID AS cancel_request_id
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added' AND REQUEST_TYPE='CancelRequest'
), refund_exp_new AS (
  SELECT DISTINCT VISA_REQUEST_ID AS new_request_id
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
)
SELECT IFF(c.cancel_created_at >= '2024-10-19',
           'after the refund step existed','before it existed')              AS period,
       IFF(r.RVISA_ISSUANCE_DATE IS NOT NULL,
           'visa CONSUMED (reached residence visa)','visa never consumed')   AS consumed,
       CASE WHEN rt.cancel_request_id IS NOT NULL THEN 'a · ran the refund step'
            WHEN re.cancel_request_id IS NOT NULL
              OR rn.new_request_id    IS NOT NULL THEN 'b · no step, but a refund was booked'
            ELSE                                       'c · NO REFUND CLAIMED' END AS outcome,
       COUNT(*)                                              AS cancellations,
       COUNT(DISTINCT r.maid_id)                             AS maids,
       ROUND(SUM(g.charged_aed))                             AS charged_aed,
       ROUND(SUM(GREATEST(g.charged_aed - 283.00, 0)))       AS recoverable_aed,
       MIN(c.cancel_created_at)::DATE AS earliest, MAX(c.cancel_created_at)::DATE AS latest
FROM cvr c
JOIN req r ON r.REQUEST_ID = c.NEW_REQUEST_ID
JOIN chg g ON g.VISA_REQUEST_ID = c.NEW_REQUEST_ID      -- only cancellations that PAID
LEFT JOIN refund_task    rt ON rt.cancel_request_id = c.cancel_request_id
LEFT JOIN refund_exp     re ON re.cancel_request_id = c.cancel_request_id
LEFT JOIN refund_exp_new rn ON rn.new_request_id    = c.NEW_REQUEST_ID
GROUP BY 1,2,3 ORDER BY period, consumed, outcome;


-- B9 · THE ONE CELL THAT COULD EMBARRASS F12. B8 found 179 refunds booked on
--      visas the data records as CONSUMED (reached a residence visa) -- 172 with no
--      workflow step, 7 with. G7, the guard the whole AED 974,448 rests on, says a
--      consumed visa is NOT_APPLICABLE because there is nothing left to refund.
--      These 179 contradict that. Two readings, opposite consequences:
--        * RVISA_ISSUANCE_DATE is not a reliable consumption marker -- perhaps the
--          maid reached a residence visa on a LATER journey, and this request's
--          entry visa really was unused. Then G7 is under-inclusive, it is
--          wrongly parking cases as NOT_APPLICABLE, and F12 is UNDERSTATED.
--        * The visa really was consumed and a refund was claimed anyway. Then it is
--          a separate finding -- refunds claimed without entitlement -- and G7 holds.
--      Shape the evidence so a human can adjudicate a sample by eye. Aggregate
--      only; no names, no identifying ids.
WITH req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id, RVISA_ISSUANCE_DATE, ENTRY_VISA_ISSUANCE_DATE,
         ENTRY_VISA_EXPIRY_DATE, CREATION_DATE AS request_created_at
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), cvr AS (
  SELECT REQUEST_ID AS cancel_request_id, NEW_REQUEST_ID, CREATION_DATE AS cancel_created_at
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS
  WHERE NEW_REQUEST_ID IS NOT NULL
), refunds AS (
  SELECT VISA_REQUEST_ID, REQUEST_TYPE, MIN(CREATION_DATE) AS refunded_at
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added'
  GROUP BY 1,2
), hit AS (
  SELECT c.cancel_request_id, c.NEW_REQUEST_ID, c.cancel_created_at,
         r.maid_id, r.RVISA_ISSUANCE_DATE, r.ENTRY_VISA_ISSUANCE_DATE, r.request_created_at,
         COALESCE(rn.refunded_at, rc.refunded_at) AS refunded_at,
         -- does this maid hold MORE THAN ONE visa request? If so the residence visa
         -- may belong to a different journey and this one's entry visa was unused.
         COUNT(*) OVER (PARTITION BY r.maid_id) AS maid_request_rows
  FROM cvr c
  JOIN req r ON r.REQUEST_ID = c.NEW_REQUEST_ID
  LEFT JOIN refunds rn ON rn.VISA_REQUEST_ID = c.NEW_REQUEST_ID   AND rn.REQUEST_TYPE='NewRequest'
  LEFT JOIN refunds rc ON rc.VISA_REQUEST_ID = c.cancel_request_id AND rc.REQUEST_TYPE='CancelRequest'
  WHERE r.RVISA_ISSUANCE_DATE IS NOT NULL
    AND c.cancel_created_at >= '2024-10-19'
    AND COALESCE(rn.refunded_at, rc.refunded_at) IS NOT NULL
)
SELECT CASE WHEN RVISA_ISSUANCE_DATE > refunded_at
                 THEN 'a · residence visa issued AFTER the refund — refund was of an unused visa'
            WHEN maid_request_rows > 1
                 THEN 'b · maid holds several requests — the RVISA may be a different journey'
            WHEN RVISA_ISSUANCE_DATE < ENTRY_VISA_ISSUANCE_DATE
                 THEN 'c · residence visa predates the entry visa — marker is unreliable'
            ELSE 'd · visa genuinely consumed, refund claimed anyway — NO ENTITLEMENT' END AS reading,
       COUNT(*)                                                      AS refunds,
       COUNT(DISTINCT maid_id)                                       AS maids,
       ROUND(MEDIAN(DATEDIFF('day', RVISA_ISSUANCE_DATE, refunded_at)),1) AS median_days_rvisa_to_refund,
       ROUND(MEDIAN(DATEDIFF('day', request_created_at, cancel_created_at)),1) AS median_days_request_to_cancel,
       MIN(refunded_at)::DATE AS earliest, MAX(refunded_at)::DATE AS latest
FROM hit GROUP BY 1 ORDER BY refunds DESC;


-- B10 · CORRECT F12's CLAIMED SIDE. B9 settled the 179: only ONE is a refund
--      without entitlement. 169 of 178 are cases where the residence visa was
--      issued AFTER the refund (median -7 days) and the cancellation came 206 days
--      after the request. Read as a sequence that is: entry visa paid -> refunded
--      mid-journey (the rejection cycle) -> new entry visa -> residence visa ->
--      much later, an end-of-contract cancellation.
--      So the refund in those rows is a REJECTION-CYCLE refund, not a cancellation
--      refund, and B8 credited it as though the cancellation had been claimed.
--      That is a classification error in B8, and it runs the wrong way for the
--      headline: in the UNCONSUMED branch, some of the 441 "refund booked" rows
--      will be the same mid-journey refunds. Each one that is means a cancellation
--      that was NOT claimed. So F12 is understated and this measures by how much.
--      The fix: a refund only counts as a CANCELLATION refund if it postdates the
--      cancellation.
WITH req AS (
  SELECT REQUEST_ID, OWNER_ID AS maid_id, RVISA_ISSUANCE_DATE
  FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE OWNER_TYPE='HOUSEMAID' AND OWNER_ID IS NOT NULL
), cvr AS (
  SELECT REQUEST_ID AS cancel_request_id, NEW_REQUEST_ID, CREATION_DATE AS cancel_created_at
  FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS
  WHERE NEW_REQUEST_ID IS NOT NULL
), chg AS (
  SELECT VISA_REQUEST_ID, SUM(CAST(AMOUNT AS NUMBER(18,2))) AS charged_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added'
  GROUP BY 1
), rf_new AS (
  SELECT VISA_REQUEST_ID, MIN(CREATION_DATE) AS first_at, MAX(CREATION_DATE) AS last_at
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added' AND REQUEST_TYPE='NewRequest'
  GROUP BY 1
), rf_can AS (
  SELECT VISA_REQUEST_ID, MIN(CREATION_DATE) AS first_at, MAX(CREATION_DATE) AS last_at
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='REFUND_FOR_ENTRY_VISA' AND STATUS='Added' AND REQUEST_TYPE='CancelRequest'
  GROUP BY 1
), base AS (
  SELECT c.cancel_request_id, c.cancel_created_at, r.maid_id, g.charged_aed,
         r.RVISA_ISSUANCE_DATE,
         GREATEST(COALESCE(n.last_at,'1900-01-01'::TIMESTAMP_NTZ),
                  COALESCE(k.last_at,'1900-01-01'::TIMESTAMP_NTZ))  AS latest_refund_at,
         LEAST(COALESCE(n.first_at,'2999-01-01'::TIMESTAMP_NTZ),
               COALESCE(k.first_at,'2999-01-01'::TIMESTAMP_NTZ))    AS first_refund_at
  FROM cvr c
  JOIN req r ON r.REQUEST_ID = c.NEW_REQUEST_ID
  JOIN chg g ON g.VISA_REQUEST_ID = c.NEW_REQUEST_ID
  LEFT JOIN rf_new n ON n.VISA_REQUEST_ID = c.NEW_REQUEST_ID
  LEFT JOIN rf_can k ON k.VISA_REQUEST_ID = c.cancel_request_id
  WHERE c.cancel_created_at >= '2024-10-19'
    AND r.RVISA_ISSUANCE_DATE IS NULL          -- G7, the unconsumed branch only
)
SELECT CASE WHEN latest_refund_at >= cancel_created_at
                 THEN 'a · CLAIMED — a refund postdates the cancellation'
            WHEN first_refund_at <= cancel_created_at
                 THEN 'b · refund exists but PREDATES the cancellation — mid-journey, not a claim'
            ELSE 'c · NO REFUND AT ALL' END                       AS outcome,
       COUNT(*)                                                   AS cancellations,
       COUNT(DISTINCT maid_id)                                    AS maids,
       ROUND(SUM(charged_aed))                                    AS charged_aed,
       ROUND(SUM(GREATEST(charged_aed - 283.00, 0)))              AS recoverable_aed,
       MIN(cancel_created_at)::DATE AS earliest, MAX(cancel_created_at)::DATE AS latest
FROM base GROUP BY 1 ORDER BY outcome;


-- D9 · IS CHANGE OF STATUS THE IN-COUNTRY ROUTE'S SECOND HALF?
--      The code says CheckEntryVisaImmigrationApprovalStep.onDone routes inside-UAE
--      cases to ChangeOfStatusStep and outside-UAE cases straight to medical/flight.
--      If that is right, change of status should pair almost exclusively with the
--      CHEAP entry-visa band (372.50 family) and almost never with the expensive one
--      (1,022.50 family) -- because a maid recruited abroad is arriving anyway and
--      has no status to convert.
--      This is a POSITIVE CONTROL on the code reading, not a finding: a clean split
--      confirms the branch; a muddy one means the purpose-vs-band mapping is not
--      what the audit has assumed, and check C's circularity problem is worse than
--      recorded.
--      Compares on the change-of-status BASE, not the paid amount -- the embedded
--      overstay fine is not part of the price of the route.
WITH ev AS (
  SELECT VISA_REQUEST_ID,
         SUM(CAST(AMOUNT AS NUMBER(18,2))) AS entry_visa_aed,
         MIN(CAST(AMOUNT AS NUMBER(18,2))) AS first_amt
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added'
    AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
  GROUP BY 1
), cos_raw AS (
  SELECT VISA_REQUEST_ID, CAST(AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='CHANGE_OF_STATUS' AND REQUEST_TYPE='NewRequest' AND STATUS='Added'
), cos AS (
  SELECT VISA_REQUEST_ID,
         SUM(amount_aed) AS cos_paid_aed,
         SUM(CASE WHEN ABS(MOD(ROUND((amount_aed - 572.50)*100), 5000)) < 2 THEN 572.50
                  WHEN ABS(MOD(ROUND((amount_aed - 575.65)*100), 5000)) < 2 THEN 575.65
                  WHEN ABS(ROUND((amount_aed - 590.54)/51.575)*51.575 - (amount_aed - 590.54)) < 0.05
                                                                          THEN 590.54
                  ELSE amount_aed END)                    AS cos_base_aed
  FROM cos_raw GROUP BY 1
)
SELECT CASE WHEN ev.first_amt BETWEEN 370 AND 390   THEN 'a · inside-country band (372.50 family)'
            WHEN ev.first_amt BETWEEN 1020 AND 1060 THEN 'b · outside-country band (1,022.50 family)'
            ELSE 'c · some other amount' END                              AS entry_visa_band,
       IFF(c.VISA_REQUEST_ID IS NOT NULL,
           'ALSO paid change of status','no change of status')            AS route,
       COUNT(*)                                                           AS requests,
       ROUND(100.0*COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY
            CASE WHEN ev.first_amt BETWEEN 370 AND 390   THEN 'a'
                 WHEN ev.first_amt BETWEEN 1020 AND 1060 THEN 'b'
                 ELSE 'c' END),1)                                         AS pct_of_band,
       ROUND(AVG(ev.entry_visa_aed),2)                                    AS avg_entry_visa,
       ROUND(AVG(COALESCE(c.cos_base_aed,0)),2)                           AS avg_cos_base,
       ROUND(AVG(ev.entry_visa_aed + COALESCE(c.cos_base_aed,0)),2)       AS avg_govt_cost_per_maid,
       ROUND(AVG(COALESCE(c.cos_paid_aed,0) - COALESCE(c.cos_base_aed,0)),2) AS avg_embedded_fine
FROM ev LEFT JOIN cos c ON c.VISA_REQUEST_ID = ev.VISA_REQUEST_ID
GROUP BY 1,2 ORDER BY entry_visa_band, route;


-- D10 · WHAT A VISA JOURNEY ACTUALLY COSTS, BY PURPOSE. The flight-substitute
--       hypothesis is only testable if a flight/ticket purpose exists in this ledger,
--       and the audit has never enumerated the purposes -- it went straight to the
--       two entry-visa values. Census the whole enum.
--       Worth running whatever D9 shows: it is the denominator for every "entry visa
--       is X% of what we spend per maid" statement this audit might want to make,
--       and it will expose any other fee with the same bundling problem the overstay
--       fine turned out to have.
SELECT PURPOSE, REQUEST_TYPE,
       COUNT(*)                                              AS lines,
       COUNT(DISTINCT VISA_REQUEST_ID)                       AS requests,
       ROUND(MEDIAN(CAST(AMOUNT AS NUMBER(18,2))),2)         AS median_aed,
       ROUND(MIN(CAST(AMOUNT AS NUMBER(18,2))),2)            AS min_aed,
       ROUND(MAX(CAST(AMOUNT AS NUMBER(18,2))),2)            AS max_aed,
       ROUND(SUM(CAST(AMOUNT AS NUMBER(18,2))))              AS total_aed,
       MIN(CREATION_DATE)::DATE AS first_seen, MAX(CREATION_DATE)::DATE AS last_seen
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE STATUS='Added' AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1,2 ORDER BY total_aed DESC;


-- D9-fixed · D9 failed: "CASE_FLATTENED(...) is not a valid group by expression".
--      Snowflake will not accept a CASE inside a window PARTITION BY when the same
--      expression is the GROUP BY key. Classify once in a CTE and group on the column.
WITH ev AS (
  SELECT VISA_REQUEST_ID,
         SUM(CAST(AMOUNT AS NUMBER(18,2))) AS entry_visa_aed,
         MIN(CAST(AMOUNT AS NUMBER(18,2))) AS first_amt
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
    AND REQUEST_TYPE='NewRequest' AND STATUS='Added'
    AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
  GROUP BY 1
), cos_raw AS (
  SELECT VISA_REQUEST_ID, CAST(AMOUNT AS NUMBER(18,2)) AS amount_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE='CHANGE_OF_STATUS' AND REQUEST_TYPE='NewRequest' AND STATUS='Added'
), cos AS (
  SELECT VISA_REQUEST_ID,
         SUM(amount_aed) AS cos_paid_aed,
         SUM(CASE WHEN ABS(MOD(ROUND((amount_aed - 572.50)*100), 5000)) < 2 THEN 572.50
                  WHEN ABS(MOD(ROUND((amount_aed - 575.65)*100), 5000)) < 2 THEN 575.65
                  WHEN ABS(ROUND((amount_aed - 590.54)/51.575)*51.575 - (amount_aed - 590.54)) < 0.05
                                                                          THEN 590.54
                  ELSE amount_aed END)                    AS cos_base_aed
  FROM cos_raw GROUP BY 1
), tagged AS (
  SELECT CASE WHEN ev.first_amt BETWEEN 370 AND 390   THEN 'a · lower band (372.50 family)'
              WHEN ev.first_amt BETWEEN 1020 AND 1060 THEN 'b · higher band (1,022.50 family)'
              ELSE 'c · some other amount' END                          AS entry_visa_band,
         IFF(c.VISA_REQUEST_ID IS NOT NULL,
             'ALSO paid change of status','no change of status')        AS route,
         ev.entry_visa_aed,
         COALESCE(c.cos_base_aed,0)                                     AS cos_base_aed,
         COALESCE(c.cos_paid_aed,0) - COALESCE(c.cos_base_aed,0)        AS embedded_fine_aed
  FROM ev LEFT JOIN cos c ON c.VISA_REQUEST_ID = ev.VISA_REQUEST_ID
)
SELECT entry_visa_band, route,
       COUNT(*)                                                             AS requests,
       ROUND(100.0*COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY entry_visa_band),1) AS pct_of_band,
       ROUND(AVG(entry_visa_aed),2)                                         AS avg_entry_visa,
       ROUND(AVG(cos_base_aed),2)                                           AS avg_cos_base,
       ROUND(AVG(entry_visa_aed + cos_base_aed),2)                          AS avg_govt_cost_per_maid,
       ROUND(AVG(embedded_fine_aed),2)                                      AS avg_embedded_fine
FROM tagged GROUP BY 1,2 ORDER BY entry_visa_band, route;


-- D11 · SIGN-FLIPPED MONEY, and it is live. D10 exposed it in the min/max columns:
--         REFUND_FOR_ENTRY_VISA  NewRequest    min -739.50  MAX +739.50
--         REFUND_MEDICAL_...     CancelRequest min -270.00  MAX +270.00
--         ENTRY_VSIA             NewRequest    MIN  739.50  (= 1,022.50 - 283.00)
--         ENTRY_VISA_LESS_...    NewRequest    MIN   89.50  (=   372.50 - 283.00)
--         IMMIGRATION_CANCELLATION             MIN -739.50
--       A refund booked positive is a refund recorded as a COST; a charge booked at a
--       refund value is the mirror. Both are F9, and both are inside the rolling year.
--       THIS BITES THIS AUDIT DIRECTLY: the B-series refund CTEs use ABS(AMOUNT), so a
--       sign-flipped row counts as a refund that may never have been received. If so,
--       claimed is overstated and UNCLAIMED IS HIGHER THAN F12 REPORTS -- the same
--       direction as every other correction in this audit, which is its own warning.
SELECT PURPOSE, REQUEST_TYPE,
       CASE WHEN PURPOSE LIKE 'REFUND%' AND CAST(AMOUNT AS NUMBER(18,2)) > 0
                 THEN 'a · REFUND booked POSITIVE — recorded as a cost'
            WHEN PURPOSE NOT LIKE 'REFUND%' AND CAST(AMOUNT AS NUMBER(18,2)) < 0
                 THEN 'b · CHARGE booked NEGATIVE — recorded as a refund'
            ELSE 'c · sign is correct' END                    AS sign_check,
       COUNT(*)                                               AS lines,
       COUNT(DISTINCT VISA_REQUEST_ID)                        AS requests,
       ROUND(SUM(ABS(CAST(AMOUNT AS NUMBER(18,2)))))          AS abs_aed,
       MIN(CREATION_DATE)::DATE AS earliest, MAX(CREATION_DATE)::DATE AS latest
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE STATUS='Added' AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1,2,3 HAVING sign_check <> 'c · sign is correct'
ORDER BY lines DESC;


-- D12 · WHAT ELSE IS BUNDLED? The overstay fine hid inside CHANGE_OF_STATUS and was
--       only found because the max was 46x the median. D10 shows the same shape on
--       several other purposes, and one of them is not a bundle at all:
--         MOHRE_INSURANCE   median   189.00   min 144.38   MAX 14,438.00  = 144.38 x 100
--         APPLY_FOR_RVISA   median   443.50                MAX  8,943.50
--         RENEW_RESIDENCE   median   457.46                MAX  4,593.50
--         EID               median   350.76                MAX  1,361.05
--       An exact 100x is a units error, not a bundled fee. Separate the two readings
--       before anyone reconciles a total: a bundle has a ladder, an error does not.
WITH x AS (
  SELECT PURPOSE, REQUEST_TYPE, VISA_REQUEST_ID, CAST(AMOUNT AS NUMBER(18,2)) AS amt
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE STATUS='Added' AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
    AND CAST(AMOUNT AS NUMBER(18,2)) > 0
), m AS (
  SELECT PURPOSE, REQUEST_TYPE, MEDIAN(amt) AS med FROM x GROUP BY 1,2
)
SELECT x.PURPOSE, x.REQUEST_TYPE,
       ROUND(m.med,2)                                        AS median_aed,
       CASE WHEN ABS(x.amt - m.med*100) < 0.02 THEN 'a · EXACTLY 100x the median — units error'
            WHEN x.amt >= m.med*10             THEN 'b · 10x or more — bundle or error'
            WHEN x.amt >= m.med*2              THEN 'c · 2x to 10x — likely a bundled extra'
            ELSE                                    'd · ordinary' END AS shape,
       COUNT(*)                                              AS lines,
       COUNT(DISTINCT x.VISA_REQUEST_ID)                     AS requests,
       ROUND(SUM(x.amt))                                     AS total_aed,
       ROUND(MAX(x.amt),2)                                   AS max_aed
FROM x JOIN m ON m.PURPOSE = x.PURPOSE AND m.REQUEST_TYPE = x.REQUEST_TYPE
GROUP BY 1,2,3,4
HAVING shape <> 'd · ordinary'
ORDER BY total_aed DESC;
