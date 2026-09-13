-- =====================================================================
-- Entry Visa Audit — discovery battery (ad hoc, run once, do NOT schedule)
-- Run as a user WITH a warehouse grant. Read-only. All outputs are
-- aggregates: no names, no contact details, no salaries.
--
-- Standing guards applied everywhere (each earned from the view metadata):
--   TRIM(CONTRACT_TYPE)            -- values are 'CC ' / 'MV ' with a trailing space
--   AMOUNT BETWEEN -50000 AND 50000-- view max is ~19.7e12, a known anomaly
--   PAYMENT_DATE > '1900-01-01'    -- sentinel '0025-11-06' in source
--
-- ROLLED BACK 2026-09-13: an IS_DELETED = '0' guard was in every query below and
-- matched 0 of 625,941 rows, silently emptying the whole battery. It was added on
-- the strength of the view's profiled column comment ("contains only '0' ...
-- safe but redundant"); the comment is wrong about the value. Whatever the column
-- holds, it is not the string '0'. The predicate is removed, not corrected --
-- the same comment states deleted rows are already filtered upstream, so there is
-- nothing for it to do. Never re-add it without a GROUP BY proving the value.
-- Entry-visa purposes are ENTRY_VSIA (>threshold) and ENTRY_VISA_LESS_THAN_1000
-- (<=threshold). ENTRY_VSIA is a misspelling that IS the live enum value:
-- spelling it ENTRY_VISA returns zero rows and reads as a scoping decision.
-- =====================================================================

-- =====================================================================
-- MEASURED 2026-09-13 (run by Hassan, PAYROLL_AND_MONEY_CONTROL_ROLE).
-- These are real counts, not estimates -- they set the denominators below.
--   625,941  expense lines in the view, all purposes, all request types
--    62,466  entry-visa charge lines  = ENTRY_VSIA 57,396 + <1000 5,070
--                                       (the <1000 code is only 8.1% of them)
--     1,598  REFUND_FOR_ENTRY_VISA lines, all time
--        49  distinct PURPOSE values present, vs 52 in the ERP enum
--         1  row with an EMPTY-STRING purpose -- use exact equality, and
--            NULLIF(TRIM(PURPOSE),'') anywhere purpose is read as free text
--         6  rows fall outside the +/-50,000 amount guard, and NONE of them are
--            entry-visa lines (purpose_and_amount == purpose_only). So the
--            ~19.7tn anomaly sits outside this audit's population: the VOID
--            amount bucket is empty here and the coverage bar must say so
--            rather than reserve a slice for it.
-- =====================================================================

-- Q0 · Orientation: is the entry visa a CC thing, an MV thing, or both?
--      Also settles whether OFFICE_STAFF belong in the population.
SELECT TRIM(CONTRACT_TYPE)                    AS contract_type,
       OWNER_TYPE,
       EMPLOYEE_TYPE,
       REQUEST_TYPE,
       COUNT(*)                               AS charge_lines,
       COUNT(DISTINCT VISA_REQUEST_ID)        AS requests,
       COUNT(DISTINCT OWNER_ID)               AS people,
       ROUND(SUM(AMOUNT))                     AS total_aed,
       MIN(CREATION_DATE)::DATE               AS earliest,
       MAX(CREATION_DATE)::DATE               AS latest
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND AMOUNT BETWEEN -50000 AND 50000
GROUP BY 1,2,3,4
ORDER BY charge_lines DESC;

-- Q1 · The price question. There is NO tariff table in the ERP: the amount is
--      free-typed by an agent and the PURPOSE is then derived from it
--      (amount <= PARAM_ENTRY_VISA_EXPENSE_AMOUNT_THRESHOLD, default 1000
--      => purpose rewritten to ENTRY_VISA_LESS_THAN_1000).
--      So the "authorised amount" must be built from the empirical modes.
SELECT PURPOSE,
       TRIM(CONTRACT_TYPE)  AS contract_type,
       AMOUNT,
       COUNT(*)             AS n,
       ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (PARTITION BY PURPOSE),1) AS pct_of_purpose
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND AMOUNT BETWEEN -50000 AND 50000
  AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1,2,3
HAVING COUNT(*) >= 3
ORDER BY PURPOSE, n DESC;

-- Q1b · Threshold integrity, split on the July-2025 boundary.
--       The amount-to-purpose reclassification shipped in July 2025 (VPM-8872/8874).
--       BEFORE it, the purpose was whatever the agent typed, so
--       ENTRY_VISA_LESS_THAN_1000 should be RARE. AFTER it, the purpose is a pure
--       function of the amount, so a disagreement can only mean the threshold
--       parameter held a different value at the time.
--       Either way it is a DATING artefact, never a finding.
--       If pre-July-2025 rows carry ENTRY_VISA_LESS_THAN_1000 in quantity, the
--       reclassification was backfilled and the guard needs re-cutting.
SELECT IFF(CREATION_DATE < '2025-07-01', 'pre-VPM-8872', 'post-VPM-8872') AS era,
       PURPOSE,
       CASE WHEN PURPOSE = 'ENTRY_VSIA'                AND AMOUNT <= 1000 THEN 'over-purpose, under-amount'
            WHEN PURPOSE = 'ENTRY_VISA_LESS_THAN_1000' AND AMOUNT >  1000 THEN 'under-purpose, over-amount'
            ELSE 'consistent with a 1000 threshold' END AS band_agreement,
       COUNT(*)                 AS n,
       MIN(CREATION_DATE)::DATE AS earliest,
       MAX(CREATION_DATE)::DATE AS latest,
       ROUND(SUM(AMOUNT))       AS total_aed
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000') AND AMOUNT BETWEEN -50000 AND 50000
GROUP BY 1,2,3 ORDER BY era, n DESC;

-- Q1c · Distance from the only live reference price the company has:
--       accounting's getDefaultEntryVisaExpenses() fallback default,
--       1073 inside UAE / 403 outside. NOT an authorised tariff — a default.
--       Location is NOT stored on the request, so this bands on amount alone
--       until the location picklist is ingested (spec ingestion request N3).
SELECT CASE WHEN AMOUNT BETWEEN  350 AND  460 THEN 'near the 403 outside-country default'
            WHEN AMOUNT BETWEEN 1000 AND 1150 THEN 'near the 1073 inside-country default'
            WHEN AMOUNT <  350                THEN 'below both defaults'
            WHEN AMOUNT BETWEEN  460 AND 1000 THEN 'between the two defaults'
            ELSE 'above the inside-country default' END AS band,
       COUNT(*) AS n, ROUND(SUM(AMOUNT)) AS total_aed,
       ROUND(MIN(AMOUNT),2) AS min_aed, ROUND(MAX(AMOUNT),2) AS max_aed
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
  AND STATUS = 'Added' AND AMOUNT BETWEEN 0 AND 50000
  AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1 ORDER BY n DESC;

-- Q2 · Line status and payment evidence. STATUS is the expense-row lifecycle,
--      NOT the request workflow. A charge stranded at Pending is invisible to
--      any population filtered on Added — that is a coverage hole, not a clean.
SELECT PURPOSE,
       STATUS,
       COUNT(*)                                            AS n,
       ROUND(SUM(AMOUNT))                                  AS total_aed,
       COUNT_IF(TRANSACTION_ID IS NULL)                    AS no_transaction,
       COUNT_IF(NULLIF(TRIM(REFERENCE_NUMBER),'') IS NULL) AS no_reference,
       COUNT_IF(PAYMENT_DATE IS NULL
             OR PAYMENT_DATE <= '1900-01-01')              AS no_usable_payment_date
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000','REFUND_FOR_ENTRY_VISA') AND AMOUNT BETWEEN -50000 AND 50000
  AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1,2 ORDER BY 1,2;

-- Q3 · How the money leaves: channel and funding bucket.
SELECT PAYMENT_TYPE, BUCKET, COUNT(*) AS n, ROUND(SUM(AMOUNT)) AS total_aed
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000') AND AMOUNT BETWEEN -50000 AND 50000
  AND CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1,2 ORDER BY n DESC LIMIT 40;

-- Q4 · Per-request shape: how many entry-visa charges and refunds does one
--      request carry? This sizes the duplicate/re-application family and tells
--      us whether "one row per charge" or "one row per request" is the grain.
WITH per_request AS (
  SELECT VISA_REQUEST_ID,
         COUNT_IF(PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
                  AND STATUS = 'Added')                    AS charges_added,
         COUNT_IF(PURPOSE = 'REFUND_FOR_ENTRY_VISA'
                  AND STATUS = 'Added')                    AS refunds_added,
         ROUND(SUM(IFF(PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')
                       AND STATUS='Added', AMOUNT, 0)))    AS charged_aed,
         ROUND(SUM(IFF(PURPOSE = 'REFUND_FOR_ENTRY_VISA'
                       AND STATUS='Added', AMOUNT, 0)))    AS refunded_aed
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE REQUEST_TYPE = 'NewRequest' AND AMOUNT BETWEEN -50000 AND 50000
  GROUP BY 1
  HAVING charges_added > 0
)
SELECT charges_added, refunds_added, COUNT(*) AS requests,
       ROUND(SUM(charged_aed)) AS charged_aed, ROUND(SUM(refunded_aed)) AS refunded_aed
FROM per_request GROUP BY 1,2 ORDER BY 1,2;

-- Q5 · The rejection signal, read from HISTORY not from today's status.
--      ENTRY_VISA_IMMIGRATION_APPROVED on the live row is overwritten on
--      re-application, so a point read loses exactly the re-applied cases.
--      This query establishes when the history starts carrying dated values,
--      which is the real floor on any rejection-keyed test.
SELECT ENTRY_VISA_IMMIGRATION_APPROVED AS value_written,
       DATE_TRUNC('month', LAST_MODIFICATION_DATE) AS month,
       COUNT(*) AS revisions,
       COUNT(DISTINCT REQUEST_ID) AS requests
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
WHERE ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED IS NOT NULL
  AND NULLIF(TRIM(ENTRY_VISA_IMMIGRATION_APPROVED),'') IS NOT NULL
GROUP BY 1,2 ORDER BY 2 DESC, revisions DESC LIMIT 60;

-- Q5b · Point-read vs history divergence — the 30% trap, measured on our data.
WITH ever_rejected AS (
  SELECT DISTINCT REQUEST_ID FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
    AND ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED IS NOT NULL
), now_rejected AS (
  SELECT REQUEST_ID FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
  WHERE ENTRY_VISA_IMMIGRATION_APPROVED = 'Rejected'
)
SELECT (SELECT COUNT(*) FROM ever_rejected)                                     AS ever_rejected_in_history,
       (SELECT COUNT(*) FROM now_rejected)                                      AS still_reads_rejected_today,
       (SELECT COUNT(*) FROM ever_rejected e
         WHERE NOT EXISTS (SELECT 1 FROM now_rejected n WHERE n.REQUEST_ID=e.REQUEST_ID))
                                                                                AS lost_by_a_point_read,
       (SELECT COUNT(*) FROM now_rejected n
         WHERE NOT EXISTS (SELECT 1 FROM ever_rejected e WHERE e.REQUEST_ID=n.REQUEST_ID))
                                                                                AS history_false_negatives;

-- Q6 · POSITIVE CONTROL for the expiry family. Before believing any count of
--      "approved then expired unused", prove the columns are populated at all.
--      If both come back near zero the test is VOID, not negative.
SELECT COUNT(*)                                        AS requests,
       COUNT_IF(ENTRY_VISA_ISSUANCE_DATE IS NOT NULL)  AS have_issuance_date,
       COUNT_IF(ENTRY_VISA_EXPIRY_DATE   IS NOT NULL)  AS have_expiry_date,
       COUNT_IF(ENTRY_VISA_EXPIRY_DATE < CURRENT_DATE()
            AND ENTRY_VISA_ISSUANCE_DATE IS NOT NULL)  AS expired_window,
       COUNT_IF(RVISA_ISSUANCE_DATE IS NOT NULL)       AS reached_residence_visa
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
WHERE CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE());

-- Q7 · What the company already calls a lost entry-visa expense.
--      NOTE the standing exclusion inside this view: the entry-visa and
--      work-permit branches exclude Pakistani nationals. Price that exclusion
--      before reusing the view as an audit population.
SELECT CATEGORY, SUB_CATEGORY, EXPENSES_TYPE, VISA_STAGE,
       COUNT(*) AS rows_out, COUNT(DISTINCT REQUEST_ID) AS requests,
       ROUND(SUM(EXPENSES_AMOUNT)) AS amount_aed,
       MIN(REQUEST_CREATION_DATE)::DATE AS earliest,
       MAX(REQUEST_CREATION_DATE)::DATE AS latest
FROM BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES
WHERE CATEGORY = 'ENTRY VISA'
GROUP BY 1,2,3,4 ORDER BY amount_aed DESC;

-- Q8 · Entry-visa payments the ERP itself believes were never booked:
--      the "Apply for entry Visa" step completed with no expense row behind it.
SELECT HOUSEMAID_TYPE, REQUEST_TYPE, TASK_NAME,
       COUNT(*) AS cases, COUNT(DISTINCT REQUEST_ID) AS requests,
       MIN(MOVE_OUT_FROM_MISSING_EXPENSES_STEP)::DATE AS earliest,
       MAX(MOVE_OUT_FROM_MISSING_EXPENSES_STEP)::DATE AS latest
FROM BA_VIEWS.VISA_SILVER.MISSING_EXPENSES
WHERE MISSING_EXPENSE_NAME = 'ENTRY_VSIA_OR_ENTRY_VISA_LESS_THAN_1000'
GROUP BY 1,2,3 ORDER BY cases DESC;

-- Q9 · Re-application count at step grain. ITERATION is the ERP's own count of
--      how many times a request re-entered the same step, so ITERATION > 1 on
--      "Apply for entry Visa" is a re-application without needing the expense table.
SELECT ITERATION, COUNT(*) AS steps, COUNT(DISTINCT VISA_REQUEST_ID) AS requests
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
WHERE TASK_NAME = 'Apply for entry Visa'
  AND STARTED_AT >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1 ORDER BY 1;

-- Q9b · Is there a refund step, and how long does it stay open?
SELECT TASK_NAME, STEP_STATUS, COUNT(*) AS steps,
       ROUND(AVG(TIME_SPENT),1) AS avg_days, MAX(TIME_SPENT) AS max_days
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
WHERE LOWER(TASK_NAME) LIKE '%entry%visa%'
  AND STARTED_AT >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1,2 ORDER BY steps DESC;

-- Q10 · COVERAGE: price what a 12-month window excludes, per the rule that a
--       standing filter defines a population nobody looks at.
SELECT CASE WHEN CREATION_DATE > CURRENT_DATE() THEN 'FUTURE-dated'
            WHEN CREATION_DATE < DATEADD('month',-12,CURRENT_DATE()) THEN 'older than the window'
            ELSE 'inside the window' END AS dating,
       COUNT(*) AS n, ROUND(SUM(AMOUNT)) AS total_aed,
       MIN(CREATION_DATE)::DATE AS earliest, MAX(CREATION_DATE)::DATE AS latest
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000') AND AMOUNT BETWEEN -50000 AND 50000
GROUP BY 1 ORDER BY n DESC;
