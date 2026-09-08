-- =====================================================================================
-- GROUP D — PRORATED SALARY. AED 886,905 over 12 months, 100% payroll-internal (M3d):
--   Prorated salary ....... 619 notes · AED  98,836
--   MV Prorated Salary .... 770 notes · AED 788,069
-- No expense request, no approval gate, no amount to check against. Never tested.
--
-- Code-verified rules (evidence-deepdive-prorated.md):
--  `prorated_salary`  — `_ProratedSalariesTransaction.calculate()`, during monthly payroll
--    generation. ELIGIBILITY: salary start (replacementSalaryStartDate else startDate) is
--    ON/AFTER THE 27th OF THE PREVIOUS PAYROLL MONTH and BEFORE THE 1st of the current one —
--    maids missed by last month's file. Amount = salary/daysInPrevMonth x days worked.
--    Note date = the 1st of the payroll month, at MIDNIGHT.
--    => the window is at most ~5 days, so the amount is at most ~1/6 of a monthly salary.
--  `mv_prorated_salary` — `AsyncService.processCurrentMonthHousemaidsBatchBT()`, event-driven
--    off WPS transfer completion. ELIGIBILITY: pre-collected MV contract being cancelled, and
--    🔴 AT TRANSFER TIME THE MAID MUST **NOT** BE TERMINATED — "Terminated maids get a plain
--    WPS payment with no such note." Amount = salary/daysInTerminationMonth x day-of-month.
--    One termination = one payment. Note date = processing timestamp, NOT midnight.
-- =====================================================================================

-- D0. Discovery: the salary and date columns the amount tests need. Sixth guessed column of
--     the day would be the fifth too many.
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'HOUSEMAID_MANAGEMENT_SILVER'
  AND (TABLE_NAME = 'HOUSEMAID_PAYROLL_HISTORY'
       OR (TABLE_NAME = 'HOUSEMAIDS_INFO'
           AND COLUMN_NAME ILIKE ANY ('%SALARY%','%START%','%TERMINAT%','%STATUS%','ID')))
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- MV1. 🔴 THE BIGGEST UNTESTED RULE IN THE AUDIT. The code is explicit: a maid who is already
--   terminated at transfer time gets a plain WPS payment and NO mv_prorated_salary note.
--   AED 788,069 has never been checked against it. HOUSEMAIDS_INFO.DATE_OF_TERMINATION is
--   confirmed present, so this runs today.
--   ⚠️ DATE_OF_TERMINATION is current state; a maid terminated AFTER her note is not a finding.
--   Only a termination date strictly BEFORE the note date contradicts the rule.
SELECT CASE
         WHEN h.DATE_OF_TERMINATION IS NULL                         THEN 'not terminated — fine'
         WHEN h.DATE_OF_TERMINATION::DATE > n.NOTE_DATE::DATE       THEN 'terminated later — fine'
         WHEN h.DATE_OF_TERMINATION::DATE = n.NOTE_DATE::DATE       THEN '⚠️ terminated the same day'
         WHEN DATEDIFF('day', h.DATE_OF_TERMINATION, n.NOTE_DATE) <= 7
                                                                     THEN '⚠️ terminated up to a week before'
         ELSE                                                            '🔴 ALREADY TERMINATED — the code says no note'
       END                                     AS verdict,
       COUNT(*)                                AS notes,
       COUNT(DISTINCT n.HOUSEMAID_ID)          AS maids,
       ROUND(SUM(n.AMOUNT))                    AS aed,
       ROUND(MEDIAN(DATEDIFF('day', h.DATE_OF_TERMINATION, n.NOTE_DATE))) AS median_days_after_termination
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'MV Prorated Salary' AND n.AMOUNT > 0
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY 1
ORDER BY aed DESC;

-- MV2. 🔴 ONE TERMINATION = ONE PAYMENT. mv_prorated_salary fires off a single contract
--   cancellation, so a maid holding two of these has been paid twice for one event — unless
--   she genuinely had two pre-collected MV contracts terminate. O2 did not flag this type
--   because its repeats are far apart, which is exactly why a cadence test misses it: there
--   IS no cadence, and any repeat at all is the finding.
WITH mv AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'MV Prorated Salary' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), per_maid AS (
    SELECT HOUSEMAID_ID, COUNT(*) AS notes, SUM(AMOUNT) AS total,
           MAX(AMOUNT) AS largest, MIN(note_day) AS first_day, MAX(note_day) AS last_day
    FROM mv GROUP BY 1
)
SELECT CASE WHEN notes = 1 THEN 'one payment — as designed'
            WHEN notes = 2 THEN '🔴 TWO MV prorated payments'
            ELSE                '🔴 THREE OR MORE' END        AS verdict,
       COUNT(*)                                               AS maids,
       SUM(notes)                                             AS notes,
       ROUND(SUM(total))                                      AS aed,
       ROUND(SUM(IFF(notes > 1, total - largest, 0)))         AS aed_BEYOND_THE_FIRST,
       ROUND(MEDIAN(DATEDIFF('day', first_day, last_day)))    AS median_days_apart
FROM per_maid
GROUP BY 1
ORDER BY aed DESC;

-- PS1. 🔴 THE ELIGIBILITY WINDOW. prorated_salary exists to catch maids who started in the
--   last few days of the previous month. The salary start must be ON/AFTER THE 27th of the
--   previous payroll month. A maid who started mid-month, or a year ago, is not eligible.
--   ⚠️ H6: START_DATE bottoms out at 1970-01-01 for unknown — BLOCKED, never treated as real.
--   ⚠️ Uses START_DATE alone; the code prefers REPLACEMENT_SALARY_START_DATE when set. If D0
--   shows that column on HOUSEMAIDS_INFO, swap in COALESCE(REPLACEMENT_SALARY_START_DATE,
--   START_DATE) — until then this over-reports maids whose salary start was replaced.
SELECT CASE
         WHEN h.START_DATE IS NULL OR h.START_DATE < '1971-01-01' THEN 'BLOCKED — epoch-zero start (H6)'
         WHEN DAY(h.START_DATE) >= 27
              AND DATEDIFF('day', h.START_DATE, n.NOTE_DATE) BETWEEN 0 AND 40
                                                                  THEN '🟢 started 27th+ of the prior month — eligible'
         WHEN DATEDIFF('day', h.START_DATE, n.NOTE_DATE) BETWEEN 0 AND 40
                                                                  THEN '⚠️ started that month, but before the 27th'
         ELSE                                                          '🔴 start date nowhere near the note — not eligible'
       END                                  AS verdict,
       COUNT(*)                             AS notes,
       COUNT(DISTINCT n.HOUSEMAID_ID)       AS maids,
       ROUND(SUM(n.AMOUNT))                 AS aed,
       ROUND(MEDIAN(DATEDIFF('day', h.START_DATE, n.NOTE_DATE))) AS median_days_start_to_note
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Prorated salary' AND n.AMOUNT > 0
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY 1
ORDER BY aed DESC;

-- PS2. The producer signature. prorated_salary is written by the payroll engine with
--   noteDate = the 1st of the payroll month at midnight; mv_prorated_salary is written with a
--   real processing timestamp. A note that does not match its type's signature came from
--   somewhere else — the same discriminator that split the airfare duplicates (A3c).
SELECT COALESCE(REASON,'(none)')                                     AS payment_type,
       COUNT(*)                                                      AS notes,
       COUNT_IF(NOTE_DATE = NOTE_DATE::DATE)                         AS at_midnight,
       COUNT_IF(DAY(NOTE_DATE) = 1)                                  AS dated_the_1st,
       COUNT_IF(NOTE_DATE = NOTE_DATE::DATE AND DAY(NOTE_DATE) = 1)  AS midnight_AND_the_1st,
       ROUND(SUM(IFF(NOT (NOTE_DATE = NOTE_DATE::DATE AND DAY(NOTE_DATE) = 1), AMOUNT, 0)))
                                                                     AS aed_off_signature
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION' AND REASON IN ('Prorated salary','MV Prorated Salary')
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
GROUP BY 1
ORDER BY notes DESC;

-- MV1/MV2 RESULTS 2026-09-08 — 🟢 MV PRORATED SALARY CLEARS. AED 788,069, both code rules.
--   MV1, against "terminated maids get no note":
--     terminated later — fine ....... 424 notes · 423 maids · AED 411,754 (median -10 days)
--     not terminated — fine ......... 326 notes · 324 maids · AED 354,547
--     terminated the same day ........ 19 notes ·  19 maids · AED  21,768
--     🔴 ALREADY TERMINATED .......... 0 notes · 0 maids · AED 0
--   NOT ONE note went to a maid terminated before it. The 19 same-day cases are the code
--   working as written — LastMvSalaryMaidServiceJob flips the service to READY_TO_BE_PAID
--   ON the termination day, so same-day is the designed path, not a boundary risk.
--   MV2, against "one termination = one payment":
--     one payment ............... 763 maids · 763 notes · AED 783,791
--     ⚠️ two payments ...........   3 maids ·   6 notes · AED   4,277 · beyond the first 1,245
--     178 days apart at the median — plausibly two pre-collected contracts terminating six
--     months apart. A CANDIDATE, not a finding.
--   🟢 The 210 MV prorated notes to CC maids that D3 flagged need no query: the code's
--   eligibility is "MAID_VISA **or MV switched to CC**", so a CC maid holding one is correct.
--   AED 788,069 — the largest body of money no test had ever touched — comes back clean.

-- PS1/D0 RESULTS 2026-09-08:
--   started 27th+ of the prior month — eligible .. 539 notes · 510 maids · AED 87,051 · median 3 days
--   🔴 start date nowhere near the note ..........  78 notes ·  68 maids · AED 10,856 · median 682 days
--   started that month, before the 27th ..........   2 notes ·   2 maids · AED    929 · median 16 days
--   The eligible group is textbook: median THREE DAYS from salary start to the note.
--   ⚠️ THE 78 ARE PROVISIONAL. D0 confirms REPLACEMENT_SALARY_START_DATE exists on
--   HOUSEMAIDS_INFO, and the code prefers it over START_DATE. A maid with a recent
--   replacement start looks 682 days stale on START_DATE alone and is perfectly eligible.
--   PS1b re-runs on the right column. Nothing from PS1's 78 is a finding until it does.
--   D0 also unlocks the amount test: BASIC_SALARY, PRIMARY_SALARY and ACCOMMODATION_SALARY
--   are all on HOUSEMAIDS_INFO, and HOUSEMAID_PAYROLL_HISTORY carries monthly TOTAL_SALARY.

-- PS1b. The eligibility window, on the column the code actually reads.
WITH ps AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT,
           COALESCE(h.REPLACEMENT_SALARY_START_DATE, h.START_DATE)::DATE AS salary_start,
           h.START_DATE::DATE                                            AS raw_start,
           h.REPLACEMENT_SALARY_START_DATE::DATE                         AS replacement_start
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Prorated salary' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
)
SELECT CASE
         WHEN salary_start IS NULL OR salary_start < '1971-01-01'      THEN 'BLOCKED — epoch-zero salary start (H6)'
         WHEN DAY(salary_start) >= 27
              AND DATEDIFF('day', salary_start, note_day) BETWEEN 0 AND 40
                                                                        THEN '🟢 eligible — started 27th+ of the prior month'
         WHEN DATEDIFF('day', salary_start, note_day) BETWEEN 0 AND 40  THEN '⚠️ started that month, before the 27th'
         ELSE                                                                '🔴 salary start nowhere near the note — not eligible'
       END                                              AS verdict,
       COUNT(*)                                         AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                     AS maids,
       ROUND(SUM(AMOUNT))                               AS aed,
       COUNT_IF(replacement_start IS NOT NULL)          AS had_a_replacement_start,
       ROUND(MEDIAN(DATEDIFF('day', salary_start, note_day))) AS median_days_start_to_note
FROM ps
GROUP BY 1
ORDER BY aed DESC;

-- PS3. 🔴 THE AMOUNT. Code: round( salary / daysInPreviousMonth x daysWorked ), where
--   daysWorked = salary start -> the 1st of the payroll month. The window is at most ~5 days,
--   so the note can never approach a full month's salary.
--   CC maids prorate over several salary groups (basic, accommodation, live-out), so the
--   ceiling uses basic + accommodation and a 25% cap — deliberately GENEROUS, meaning anything
--   flagged is a real outlier rather than a modelling artefact.
WITH ps AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT,
           COALESCE(h.REPLACEMENT_SALARY_START_DATE, h.START_DATE)::DATE AS salary_start,
           COALESCE(h.PRIMARY_SALARY, h.BASIC_SALARY, 0)
             + COALESCE(h.ACCOMMODATION_SALARY, 0)                       AS monthly_salary
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Prorated salary' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
), calc AS (
    SELECT ps.*,
           DAY(LAST_DAY(DATEADD('month', -1, note_day)))            AS days_in_prev_month,
           GREATEST(DATEDIFF('day', salary_start, note_day), 0)     AS days_worked,
           monthly_salary / NULLIF(DAY(LAST_DAY(DATEADD('month',-1,note_day))), 0)
             * GREATEST(DATEDIFF('day', salary_start, note_day), 0) AS expected
    FROM ps
)
SELECT CASE
         WHEN monthly_salary <= 0                          THEN 'BLOCKED — no salary on file'
         WHEN days_worked > 40                             THEN 'BLOCKED — start date not in the window (PS1b)'
         WHEN AMOUNT > monthly_salary * 0.25               THEN '🔴 OVER a quarter of a monthly salary — impossible under the formula'
         WHEN expected > 0 AND AMOUNT > expected * 1.10    THEN '🔴 above the formula by more than 10%'
         WHEN expected > 0 AND AMOUNT < expected * 0.90    THEN 'below the formula by more than 10%'
         ELSE                                                   '🟢 matches the formula within 10%'
       END                                          AS verdict,
       COUNT(*)                                     AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                 AS maids,
       ROUND(SUM(AMOUNT))                           AS aed,
       ROUND(SUM(GREATEST(AMOUNT - expected, 0)))   AS aed_ABOVE_THE_FORMULA,
       ROUND(MEDIAN(AMOUNT))                        AS median_paid,
       ROUND(MEDIAN(expected))                      AS median_expected
FROM calc
GROUP BY 1
ORDER BY aed_ABOVE_THE_FORMULA DESC, aed DESC;
