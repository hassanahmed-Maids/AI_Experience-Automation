-- =====================================================================================
-- OFFICE WORK ADDITION. 96 notes · AED 29,684 · 12 months · 100% payroll-internal.
-- ⚠️ THE ONLY TYPE WITH NO CODE RULE IN THE REPO. All that is known: created by
-- `PayrollGroupService` ~L704-714, amount accumulated from 0 and Math.round'ed, and it can
-- be 0 when no days were worked (conv. 46017). The ask-the-code question that would supply
-- the rule is drafted at asks/askcode-office-work-addition.md and could not be submitted —
-- the ERP token has expired.
--
-- 🔴 So everything below is a CEILING or SANITY test, not an entitlement test. They can show
-- a payment is the wrong SIZE or the wrong SHAPE. None of them can show it had no basis,
-- because nothing here says what the basis is. Stated up front so no result from this file
-- gets reported as "unjustified".
-- =====================================================================================

-- OW1. Discovery. Is there an office-work assignment surface? HOUSEMAIDS_INFO_REVISION was
--   seen to carry ASSIGNED_OFFICE_WORK_REASON_ID, so the concept exists — this finds where it
--   lives now and whether any day-count or attendance source sits beside it.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME ILIKE ANY ('%OFFICE_WORK%','%OFFICEWORK%')
   OR TABLE_NAME  ILIKE ANY ('%OFFICE_WORK%','%OFFICEWORK%','%PAYROLL_GROUP%','%MONTHLY_GROUP%')
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;

-- OW2. The ceiling. Whatever the rule is, an addition for working in the office cannot
--   plausibly exceed the maid's pay for that month. Measured against the salary of the note's
--   OWN payroll month — the fourth type where the as-of salary is the right denominator.
WITH ow AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT,
           DATE_TRUNC('month', n.NOTE_DATE)::DATE AS mth,
           DAY(LAST_DAY(n.NOTE_DATE::DATE))       AS days_in_month
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Office Work Addition' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
), sal AS (
    SELECT HOUSEMAID_ID, DATE_TRUNC('month', PAYROLL_MONTH)::DATE AS mth,
           MAX(TOTAL_SALARY) AS total_salary
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY
    WHERE TOTAL_SALARY > 0 GROUP BY 1, 2
), j AS (
    SELECT ow.*, s.total_salary,
           s.total_salary / NULLIF(ow.days_in_month, 0) AS one_day
    FROM ow LEFT JOIN sal s ON s.HOUSEMAID_ID = ow.HOUSEMAID_ID AND s.mth = ow.mth
)
SELECT CASE
         WHEN total_salary IS NULL          THEN 'BLOCKED — no payroll row for that month'
         WHEN AMOUNT > total_salary         THEN '🔴 MORE THAN A WHOLE MONTH OF PAY'
         WHEN AMOUNT > total_salary * 0.5   THEN '🔴 over half a month of pay'
         WHEN AMOUNT > one_day * 10         THEN '⚠️ more than ten days of pay'
         ELSE                                    '🟢 within ten days of pay'
       END                                       AS verdict,
       COUNT(*)                                  AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)              AS maids,
       ROUND(SUM(AMOUNT))                        AS aed,
       ROUND(MEDIAN(AMOUNT))                     AS median_paid,
       ROUND(MEDIAN(total_salary))               AS median_monthly_salary,
       ROUND(MEDIAN(AMOUNT / NULLIF(one_day,0)), 1) AS median_days_of_pay
FROM j
GROUP BY 1
ORDER BY aed DESC;

-- OW3. Count-based, so it survives any salary model — the lesson Forgive Deduction taught.
--   How many office-work additions can one maid collect in a month, and in a year?
WITH ow AS (
    SELECT HOUSEMAID_ID, DATE_TRUNC('month', NOTE_DATE)::DATE AS mth, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Office Work Addition' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), per_month AS (
    SELECT HOUSEMAID_ID, mth, COUNT(*) AS notes, SUM(AMOUNT) AS aed FROM ow GROUP BY 1, 2
), per_maid AS (
    SELECT HOUSEMAID_ID, COUNT(*) AS months_with_a_note, SUM(notes) AS notes, SUM(aed) AS aed
    FROM per_month GROUP BY 1
)
SELECT CASE WHEN months_with_a_note = 1  THEN 'one month only'
            WHEN months_with_a_note <= 3 THEN '2-3 months'
            WHEN months_with_a_note <= 6 THEN '4-6 months'
            ELSE                              '🔴 7+ months of the year' END AS pattern,
       COUNT(*)                     AS maids,
       SUM(notes)                   AS notes,
       ROUND(SUM(aed))              AS aed,
       MAX(months_with_a_note)      AS most_months,
       ROUND(MAX(aed))              AS largest_year_total
FROM per_maid
GROUP BY 1
ORDER BY aed DESC;

-- OW4. The terminated-maid test — it has now run on four types and found something on one
--   (15 raffle prizes). Cheap, count-based, and independent of every model above.
SELECT CASE
         WHEN h.DATE_OF_TERMINATION IS NULL                    THEN 'not terminated — fine'
         WHEN h.DATE_OF_TERMINATION::DATE >= n.NOTE_DATE::DATE  THEN 'terminated on/after — fine'
         WHEN DATEDIFF('day', h.DATE_OF_TERMINATION, n.NOTE_DATE) <= 60
                                                                THEN '⚠️ within 60 days of leaving'
         ELSE                                                        '🔴 paid long after she left'
       END                                     AS verdict,
       COUNT(*)                                AS notes,
       COUNT(DISTINCT n.HOUSEMAID_ID)          AS maids,
       ROUND(SUM(n.AMOUNT))                    AS aed,
       ROUND(MEDIAN(DATEDIFF('day', h.DATE_OF_TERMINATION, n.NOTE_DATE))) AS median_days_after_termination
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Office Work Addition' AND n.AMOUNT > 0
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY 1
ORDER BY aed DESC;
