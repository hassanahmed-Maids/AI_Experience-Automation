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

-- FD1/FD2 RESULTS 2026-09-08.
--   FD1 (1,027 notes with an amount):
--     one accommodation day .............. 235 notes · AED  7,620 · above one day AED     0
--     one working day ....................  31 notes · AED  1,179 · above one day AED     8
--     between the two rates .............. 585 notes · AED 32,806 · above one day AED   235
--     up to two days in one note ......... 163 notes · AED 10,946 · above one day AED 2,623
--     MORE THAN TWO DAYS .................   7 notes · AED    335 · above one day AED   201
--     BLOCKED — no salary on file ........   6 notes · AED    402
--   ⚠️ NOT A FINDING. 57% landing "between the two rates" is the PROXY being systematically
--   low, not 57% of notes being wrong. The code uses the payroll month's GROUP salaries
--   (gr1/gr2/gr5/gr6); this used current PRIMARY/BASIC/ACCOMMODATION from HOUSEMAIDS_INFO.
--   Same as-of defect that already bit the MV type check, the prorated start date and PS3.
--   The AED 2,824 above the ceiling is inside the noise of that substitution.
--   FD2 (293 maid-months) — 🟢 BOTH HARD CEILINGS HOLD:
--     more notes than days in the month .... 0
--     forgave more than a month of salary .. 0
--     1-4 days forgiven ................... 215 maid-months · 435 notes · AED 23,586
--     5-14 days forgiven ..................  74 maid-months · 531 notes · AED 26,808
--     🔴 half the month or more ...........   3 maid-months ·  55 notes · AED  2,492
--        most days in one month: 21 · largest share of a month's salary: 0.58
--   Twenty-one unpaid days forgiven in one month means two thirds of the month was unpaid and
--   then written back. Small money, specific population, and a real question.

-- FD1b. 🔴 THE AMOUNT, ON THE SALARY THAT APPLIED THAT MONTH. HOUSEMAID_PAYROLL_HISTORY
--   carries PAYROLL_MONTH and TOTAL_SALARY, so the note can be measured against the salary of
--   its own payroll month instead of today's. This is the fourth appearance of the same
--   lesson: a current-state value joined to a dated fact.
--   ⚠️ TOTAL_SALARY is the whole month's pay, so one day = TOTAL_SALARY / daysInMonth. That is
--   an upper bound on either group rate, making this ceiling generous in the same direction.
WITH fd AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT,
           DATE_TRUNC('month', n.NOTE_DATE)::DATE AS mth,
           DAY(LAST_DAY(n.NOTE_DATE::DATE))       AS days_in_month
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Forgive Deduction' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
), sal AS (
    SELECT HOUSEMAID_ID, DATE_TRUNC('month', PAYROLL_MONTH)::DATE AS mth,
           MAX(TOTAL_SALARY) AS total_salary
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY
    WHERE TOTAL_SALARY > 0
    GROUP BY 1, 2
), j AS (
    SELECT fd.*, s.total_salary,
           s.total_salary / NULLIF(fd.days_in_month, 0) AS one_day
    FROM fd LEFT JOIN sal s
           ON s.HOUSEMAID_ID = fd.HOUSEMAID_ID AND s.mth = fd.mth
)
SELECT CASE
         WHEN total_salary IS NULL           THEN 'BLOCKED — no payroll row for that month'
         WHEN AMOUNT <= one_day * 1.10       THEN '🟢 within one day of that month''s salary'
         WHEN AMOUNT <= one_day * 2.00       THEN '⚠️ one to two days'
         ELSE                                     '🔴 MORE THAN TWO DAYS OF THAT MONTH''S SALARY'
       END                                       AS verdict,
       COUNT(*)                                  AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)              AS maids,
       ROUND(SUM(AMOUNT))                        AS aed,
       ROUND(SUM(GREATEST(AMOUNT - one_day, 0))) AS aed_ABOVE_ONE_DAY,
       ROUND(MEDIAN(AMOUNT))                     AS median_paid,
       ROUND(MEDIAN(one_day))                    AS median_one_day
FROM j
GROUP BY 1
ORDER BY aed_ABOVE_ONE_DAY DESC, aed DESC;

-- FD1b RESULT 2026-09-08 — the as-of salary transforms the picture, then stops short.
--   🟢 within one day of that month's salary .. 672 notes · 189 maids · AED 32,462 · above 581
--   ⚠️ one to two days ....................... 195 notes ·  55 maids · AED 12,364 · above 2,897
--   🔴 more than two days ....................  43 notes ·  12 maids · AED  2,736 · above 1,756
--   BLOCKED — no payroll row for that month ... 117 notes ·  37 maids · AED  5,726
--   Using the payroll month's own salary moved 406 notes into "clean" — 672 within one day
--   against FD1's 266. The as-of fix is worth more than any threshold tuning.
--   ⚠️ THE 43 ARE NOT A FINDING. Their median one-day figure is 18, implying a monthly salary
--   near AED 540 — far below a normal maid salary and the signature of a PARTIAL-MONTH payroll
--   row, which understates the daily rate and manufactures the ratio. Maximum plausible
--   overpayment across the whole amount test is AED 1,756, on a type where 65% of notes are
--   demonstrably correct.
--
-- ⛔ FORGIVE DEDUCTION CLOSES HERE. The amount test is recorded as inconclusive at
--   <= AED 1,756, not as a finding. Same call as PS3 and the 369 hand-written zero notes.
--
-- 🟢 THE LESSON WORTH KEEPING: FD2 found a real finding (3 maid-months, 15-21 days forgiven,
--   AED 2,492) and FD1/FD1b did not — because FD2 COUNTS NOTES and the amount tests MEASURE
--   AGAINST A SALARY MODEL. A count-based test survives a bad salary model; an amount-based
--   one does not. Where a per-note quantum exists (one note = one day), prefer counting.
