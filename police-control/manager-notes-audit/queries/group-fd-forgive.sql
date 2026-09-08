-- =====================================================================================
-- FORGIVE DEDUCTION. 1,060 notes · AED 53,325 · 100% payroll-internal, no approval gate.
--
-- Code-verified (evidence-deepdive-forgive.md):
--   Producer   `HousemaidUnpaidDayService.takeAction()` — fires when an unpaid attendance day
--              is FORGIVEN (HousemaidUnpaidDay.forgiven = true). No requester, ever.
--   Trigger    a note is written ONLY if that month's payroll is ALREADY CLOSED (transferred
--              or FINAL). If the month is still open the day is re-grouped and NO note is
--              made. So every note is a "we already paid you short, here is the catch-up".
--   🔴 Amount  ONE DAY OF SALARY: rate / daysInMonth, rounded to whole AED.
--                full-day forgiveness  -> working rate   (gr5 if live-out else gr1;
--                                                          fallback basicSalary)
--                otherwise             -> accommodation rate (gr6 if live-out else gr2;
--                                                          fallback accommodationSalary)
--   No cap is needed in code because one day's salary is inherently bounded — which is
--   exactly what makes it testable here.
--   => O2's 731 same-day repeats are CORRECT BEHAVIOUR: several forgiven days land together,
--      one note each. The type's median repeat gap of 0 days is its native shape.
-- =====================================================================================

-- FD0. Is the unpaid-day / attendance source in the warehouse? If it is, "was there a day to
--   forgive?" becomes answerable; if not, that question joins N18 as blocked and the amount
--   and volume tests below are the whole of what this type can be given.
SELECT TABLE_SCHEMA, TABLE_NAME, COUNT(*) AS columns_
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME ILIKE ANY ('%UNPAID%','%ATTENDANCE%','%FORGIV%','%ABSEN%')
GROUP BY 1, 2
ORDER BY 1, 2;

-- FD1. 🔴 THE AMOUNT — one note, one day. The ceiling uses basic + accommodation summed, which
--   is deliberately GENEROUS: the code uses one rate or the other, never both, so anything
--   over the sum of the two is off-rule by a wide margin and cannot be a modelling artefact.
WITH fd AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT,
           COALESCE(h.PRIMARY_SALARY, h.BASIC_SALARY)          AS working_salary,
           COALESCE(h.ACCOMMODATION_SALARY, 0)                 AS accom_salary,
           DAY(LAST_DAY(n.NOTE_DATE::DATE))                    AS days_in_month
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Forgive Deduction' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
), calc AS (
    SELECT fd.*,
           working_salary / NULLIF(days_in_month, 0)                     AS one_working_day,
           accom_salary   / NULLIF(days_in_month, 0)                     AS one_accom_day,
           (COALESCE(working_salary,0) + accom_salary) / NULLIF(days_in_month,0) AS generous_ceiling
    FROM fd
)
SELECT CASE
         WHEN COALESCE(working_salary,0) + accom_salary <= 0 THEN 'BLOCKED — no salary on file'
         WHEN AMOUNT <= one_accom_day * 1.10                 THEN '🟢 one accommodation day'
         WHEN AMOUNT <= one_working_day * 1.10               THEN '🟢 one working day'
         WHEN AMOUNT <= generous_ceiling * 1.10              THEN '⚠️ between the two rates'
         WHEN AMOUNT <= generous_ceiling * 2                 THEN '🔴 up to two days in one note'
         ELSE                                                     '🔴 MORE THAN TWO DAYS OF SALARY IN ONE NOTE'
       END                                                   AS verdict,
       COUNT(*)                                              AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                          AS maids,
       ROUND(SUM(AMOUNT))                                    AS aed,
       ROUND(SUM(GREATEST(AMOUNT - generous_ceiling, 0)))    AS aed_ABOVE_ONE_DAY,
       ROUND(MEDIAN(AMOUNT))                                 AS median_paid,
       ROUND(MEDIAN(generous_ceiling))                       AS median_ceiling
FROM calc
GROUP BY 1
ORDER BY aed_ABOVE_ONE_DAY DESC, aed DESC;

-- FD2. 🔴 HOW MANY DAYS CAN BE FORGIVEN IN A MONTH? Each note is one day, so the notes a maid
--   receives in a month are the days forgiven. A maid cannot be forgiven more days than the
--   month holds, and forgiving a whole month of salary through a catch-up mechanism would be
--   a different thing entirely. Compares the month's forgiven total against her monthly salary.
WITH fd AS (
    SELECT n.HOUSEMAID_ID, DATE_TRUNC('month', n.NOTE_DATE)::DATE AS mth, n.AMOUNT,
           COALESCE(h.PRIMARY_SALARY, h.BASIC_SALARY, 0) + COALESCE(h.ACCOMMODATION_SALARY, 0)
                                                                    AS monthly_salary,
           DAY(LAST_DAY(n.NOTE_DATE::DATE))                         AS days_in_month
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Forgive Deduction' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
), per_maid_month AS (
    SELECT HOUSEMAID_ID, mth, COUNT(*) AS days_forgiven, SUM(AMOUNT) AS forgiven_aed,
           MAX(monthly_salary) AS monthly_salary, MAX(days_in_month) AS days_in_month
    FROM fd GROUP BY 1, 2
)
SELECT CASE
         WHEN monthly_salary <= 0                        THEN 'BLOCKED — no salary on file'
         WHEN days_forgiven > days_in_month              THEN '🔴 MORE NOTES THAN DAYS IN THE MONTH'
         WHEN forgiven_aed > monthly_salary              THEN '🔴 forgave more than a month of salary'
         WHEN days_forgiven >= 15                        THEN '⚠️ half the month or more forgiven'
         WHEN days_forgiven >= 5                         THEN '5-14 days forgiven'
         ELSE                                                 '🟢 1-4 days forgiven'
       END                                  AS verdict,
       COUNT(*)                             AS maid_months,
       SUM(days_forgiven)                   AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)         AS maids,
       ROUND(SUM(forgiven_aed))             AS aed,
       MAX(days_forgiven)                   AS most_days_in_one_month,
       ROUND(MAX(forgiven_aed / NULLIF(monthly_salary,0)), 2) AS largest_share_of_a_month
FROM per_maid_month
GROUP BY 1
ORDER BY aed DESC;

-- FD3. Did a terminated maid get a forgiveness? The same test that cleared MV Prorated and
--   found 15 raffle prizes. A catch-up for an unpaid day is plausible shortly after leaving,
--   so only a long gap is a finding.
SELECT CASE
         WHEN h.DATE_OF_TERMINATION IS NULL                    THEN 'not terminated — fine'
         WHEN h.DATE_OF_TERMINATION::DATE >= n.NOTE_DATE::DATE  THEN 'terminated on/after — fine'
         WHEN DATEDIFF('day', h.DATE_OF_TERMINATION, n.NOTE_DATE) <= 90
                                                                THEN '⚠️ within 90 days of leaving — plausible catch-up'
         ELSE                                                        '🔴 forgiven long after she left'
       END                                     AS verdict,
       COUNT(*)                                AS notes,
       COUNT(DISTINCT n.HOUSEMAID_ID)          AS maids,
       ROUND(SUM(n.AMOUNT))                    AS aed,
       ROUND(MEDIAN(DATEDIFF('day', h.DATE_OF_TERMINATION, n.NOTE_DATE))) AS median_days_after_termination
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Forgive Deduction' AND n.AMOUNT > 0
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY 1
ORDER BY aed DESC;
