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
