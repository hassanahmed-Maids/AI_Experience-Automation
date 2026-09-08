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

-- OW1/OW2 RESULTS 2026-09-08.
--   🟢 OW1 UNLOCKS THE ENTITLEMENT TEST: ASSIGNED_OFFICE_WORK_REASON_ID exists on
--   HOUSEMAIDS_INFO **and on HOUSEMAIDS_INFO_REVISION with a MODIFIED flag**, so "was she
--   assigned to office work when she was paid?" is answerable AS OF the note date — and it is
--   existence-based, not amount-based, which is the kind that has worked every time.
--   OW2 (92 notes with a payroll row):
--     🔴 more than a whole month of pay ...  6 notes · AED 6,539 · median 46.4 DAYS of pay
--     🔴 over half a month ............... 13 notes · AED 9,417 · median 21.1 days
--     ⚠️ more than ten days .............. 10 notes · AED 3,241 · median 12.2 days
--     🟢 within ten days ................. 54 notes · AED 7,510 · median  4.1 days
--     BLOCKED — no payroll row ...........  9 notes · AED 2,977
--   ⚠️ The flagged groups have systematically LOWER recorded salaries — 654 and 525 against
--   969 for the clean group. That is the partial-month payroll signature that already cost
--   FD1b's 43 notes. OW2b removes it before any of this is called a finding.

-- OW2b. The ceiling on the maid's OWN TYPICAL month, not the note's month. A partial-month
--   payroll row understates the rate and manufactures a large multiple; the median across all
--   her months does not. This also retro-fixes FD1b's 43 notes if applied there.
WITH ow AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT,
           DATE_TRUNC('month', n.NOTE_DATE)::DATE AS mth
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Office Work Addition' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
), typical AS (
    SELECT HOUSEMAID_ID,
           MEDIAN(TOTAL_SALARY) AS typical_month,
           MAX(TOTAL_SALARY)    AS best_month,
           COUNT(*)             AS payroll_months
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY
    WHERE TOTAL_SALARY > 0
    GROUP BY 1
), thismonth AS (
    SELECT HOUSEMAID_ID, DATE_TRUNC('month', PAYROLL_MONTH)::DATE AS mth,
           MAX(TOTAL_SALARY) AS this_month
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY
    WHERE TOTAL_SALARY > 0 GROUP BY 1, 2
)
SELECT CASE
         WHEN t.typical_month IS NULL                     THEN 'BLOCKED — no payroll history at all'
         WHEN o.AMOUNT > t.typical_month                  THEN '🔴 MORE THAN A TYPICAL MONTH OF PAY'
         WHEN o.AMOUNT > t.typical_month * 0.5            THEN '🔴 over half a typical month'
         WHEN o.AMOUNT > t.typical_month / 3              THEN '⚠️ over ten days of a typical month'
         ELSE                                                  '🟢 within ten days of a typical month'
       END                                          AS verdict,
       COUNT(*)                                     AS notes,
       COUNT(DISTINCT o.HOUSEMAID_ID)               AS maids,
       ROUND(SUM(o.AMOUNT))                         AS aed,
       ROUND(MEDIAN(o.AMOUNT))                      AS median_paid,
       ROUND(MEDIAN(t.typical_month))               AS median_typical_month,
       ROUND(MEDIAN(m.this_month))                  AS median_that_month,
       ROUND(MEDIAN(m.this_month / NULLIF(t.typical_month,0)), 2) AS that_month_vs_typical
FROM ow o
LEFT JOIN typical   t ON t.HOUSEMAID_ID = o.HOUSEMAID_ID
LEFT JOIN thismonth m ON m.HOUSEMAID_ID = o.HOUSEMAID_ID AND m.mth = o.mth
GROUP BY 1
ORDER BY aed DESC;

-- OW5. 🔴 THE ENTITLEMENT TEST, now that OW1 has found the column. Was the maid assigned to
--   office work AS OF the note date? Existence-based, so no salary model can spoil it — and
--   as-of, because a current-state read has been wrong in both directions four times today.
WITH ow AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Office Work Addition' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
), rev AS (
    SELECT ID AS maid_id, ASSIGNED_OFFICE_WORK_REASON_ID AS assigned,
           LAST_MODIFICATION_DATE::DATE AS changed_on
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION
    WHERE LAST_MODIFICATION_DATE IS NOT NULL
), resolved AS (
    SELECT o.note_id, o.HOUSEMAID_ID, o.note_day, o.AMOUNT, r.assigned
    FROM ow o
    LEFT JOIN rev r ON r.maid_id = o.HOUSEMAID_ID AND r.changed_on <= o.note_day
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o.note_id ORDER BY r.changed_on DESC) = 1
)
SELECT CASE
         WHEN assigned IS NULL      THEN '🔴 NOT assigned to office work when paid'
         WHEN assigned = 0          THEN '🔴 assignment reason is zero when paid'
         ELSE                            '🟢 assigned to office work'
       END                              AS verdict,
       COUNT(*)                         AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)     AS maids,
       ROUND(SUM(AMOUNT))               AS aed,
       ROUND(MEDIAN(AMOUNT))            AS median_paid,
       COUNT(DISTINCT assigned)         AS distinct_reasons
FROM resolved
GROUP BY 1
ORDER BY aed DESC;

-- OW2b/OW5 RESULTS 2026-09-08.
--   🟢 OW2b CONFIRMS THE ARTEFACT AND WITHDRAWS OW2's FINDING. that_month_vs_typical comes
--   back 0.52 / 0.87 / 0.50 — the flagged notes' payroll months really are about HALF the
--   maid's typical month. Against her typical month:
--     within ten days of a typical month .. 70 notes · AED 11,628 · ratio 0.52
--     over half a typical month ........... 11 notes · AED 10,919 · ratio 0.87 · median 0.71 of a month
--     over ten days of a typical month ....  7 notes · AED  4,933 · ratio 0.50
--     BLOCKED — no payroll history ........  4 notes · AED  2,204
--     🟢 MORE THAN A WHOLE MONTH: ZERO (was 6 on the note's own month).
--   The amount test does not convict, and it retroactively vindicates leaving FD1b's 43 notes
--   alone — same signature, same cause.
--   🔴 OW5: NOT assigned when paid .. 66 notes · 66 maids · AED 24,291 (82% of the type)
--            assigned ............... 26 notes · 26 maids · AED  5,393 · 5 distinct reasons
--   ⚠️ NOT YET A FINDING, for the reason anti-attrition taught. The note is written at
--   month-end by PayrollGroupService for work done DURING the month. If the assignment was
--   cleared before payroll ran, the maid reads unassigned at the note date and the payment is
--   perfectly legitimate. A point-in-time read is the wrong instrument for a transient state.

-- OW5b. The assignment as a WINDOW, not a point. Was she assigned at any time in the two
--   months up to the note? "Never assigned at all" is the only unambiguous bucket, and it is
--   the one that would be a finding.
WITH ow AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Office Work Addition' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
), rev AS (
    SELECT ID AS maid_id, ASSIGNED_OFFICE_WORK_REASON_ID AS assigned,
           LAST_MODIFICATION_DATE::DATE AS changed_on
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION
    WHERE LAST_MODIFICATION_DATE IS NOT NULL
), flags AS (
    SELECT o.note_id, o.HOUSEMAID_ID, o.note_day, o.AMOUNT,
           MAX(IFF(r.assigned IS NOT NULL
                   AND r.changed_on <= o.note_day
                   AND r.changed_on >= DATEADD('month', -2, o.note_day), 1, 0)) AS assigned_recently,
           MAX(IFF(r.assigned IS NOT NULL AND r.changed_on <= o.note_day, 1, 0)) AS assigned_ever_before,
           MAX(IFF(r.assigned IS NOT NULL, 1, 0))                                AS assigned_ever
    FROM ow o
    LEFT JOIN rev r ON r.maid_id = o.HOUSEMAID_ID
    GROUP BY 1, 2, 3, 4
)
SELECT CASE
         WHEN assigned_recently    = 1 THEN '🟢 assigned within the two months before the note'
         WHEN assigned_ever_before = 1 THEN '⚠️ assigned earlier, but not recently'
         WHEN assigned_ever        = 1 THEN '🔴 assigned only AFTER the note'
         ELSE                               '🔴 NEVER assigned to office work at all'
       END                              AS verdict,
       COUNT(*)                         AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)     AS maids,
       ROUND(SUM(AMOUNT))               AS aed,
       ROUND(MEDIAN(AMOUNT))            AS median_paid
FROM flags
GROUP BY 1
ORDER BY aed DESC;

-- OW5b RESULT 2026-09-08 — 🟢 OFFICE WORK ADDITION CLOSES AT ZERO FINDINGS.
--   assigned within the two months before the note .. 92 notes · 92 maids · AED 29,684 · 100%
--   No other bucket returned a single row. Every note went to a maid who held an office-work
--   assignment in the window. OW5's 66 "not assigned" were entirely the point-in-time artefact.
--
-- 🔴 THIS TYPE PRODUCED TWO FINDINGS AND WITHDREW BOTH:
--     OW2  AED  6,539 "more than a whole month of pay"  -> partial-month denominator
--     OW5  AED 24,291 "not assigned when paid"          -> point read of a transient state
--   Both failure modes were already documented earlier the same day — the partial-month
--   artefact in Forgive Deduction, the transient-state problem in anti-attrition. Neither was
--   NEW; both were re-discovered by publishing first and checking after.
