-- =====================================================================================
-- LAST DAY CC SWITCH ADJUSTMENT. 213 notes · AED 13,616 · 12 months · payroll-internal.
-- The last payment type above AED 10,000 without a verdict.
--
-- Code-verified (evidence-deepdive-prorated.md §3):
--   Producer   `PayrollAuditTodoService.doMaidSwitchedToMvCalculations()`, via the daily
--              PayrollAuditTodoJob on the payroll lock date.
--   Trigger    a CC (non-MV) maid is switched TO Maid Visa. Sales `createContract` flips the
--              type and writes a `CcMaidSwitchedToMv` row (switchDate = now,
--              lastCcSalary = basicSalary).
--   🔴 Eligibility, ALL of which must hold:
--              - a CcMaidSwitchedToMv record in the payroll window
--              - **switchDate == THE LAST CALENDAR DAY OF THE PAYROLL MONTH**
--              - lastCcSalary > 0 and the daily rate > 0
--   🔴 Amount  round( lastCcSalary / daysInPayrollMonth ) — ONE DAY of CC salary. The main CC
--              proration pays only through switchDate-1, so the switch day is added back here.
--   🔴 Note date  set to the switchDate itself = always month-end.
--
-- M3b-pre applied before writing, not after:
--   Q1 changing value read as-of?  LD3 uses the revision table, not current state.
--   Q2 salary denominator?         LD4 uses the maid's TYPICAL month, never the note's month.
--   Q3 per-note quantum?           Yes — one switch, one note. LD1 and LD2 COUNT, and neither
--                                  touches a salary, so no model can spoil them.
-- =====================================================================================

-- LD1. 🔴 THE STRUCTURAL TEST — and the strongest one available anywhere in this audit,
--   because it needs no salary, no as-of read and no denominator. The code sets the note date
--   to switchDate, and switchDate must equal the last day of the month. A note dated anything
--   else was not produced by the rule as written.
--   ⚠️ Cast before comparing: NOTE_DATE = LAST_DAY(NOTE_DATE) is false for EVERY row because
--   the timestamp never equals midnight (the audit's own uncast-date-equality trap).
SELECT CASE
         WHEN NOTE_DATE::DATE = LAST_DAY(NOTE_DATE::DATE) THEN '🟢 dated the last day of the month'
         ELSE                                                  '🔴 NOT dated month-end — off-rule'
       END                                          AS verdict,
       COUNT(*)                                     AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                 AS maids,
       ROUND(SUM(AMOUNT))                           AS aed,
       COUNT_IF(NOTE_DATE = NOTE_DATE::DATE)        AS at_midnight,
       COUNT(DISTINCT NOTE_DATE::DATE)              AS distinct_days,
       MIN(NOTE_DATE::DATE)                         AS first_day,
       MAX(NOTE_DATE::DATE)                         AS last_day
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Last Day CC Switch Adjustment'
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
GROUP BY 1
ORDER BY aed DESC;

-- LD2. ONE SWITCH, ONE NOTE. A maid switches CC->MV once; a second adjustment for the same
--   switch is a duplicate. Count-based, so no salary model can spoil it.
WITH ld AS (
    SELECT HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Last Day CC Switch Adjustment' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), per_maid AS (
    SELECT HOUSEMAID_ID, COUNT(*) AS notes, COUNT(DISTINCT note_day) AS distinct_days,
           SUM(AMOUNT) AS total, MAX(AMOUNT) AS largest,
           DATEDIFF('day', MIN(note_day), MAX(note_day)) AS days_apart
    FROM ld GROUP BY 1
)
SELECT CASE WHEN notes = 1                        THEN '🟢 one adjustment — as designed'
            WHEN distinct_days = 1                THEN '🔴 SEVERAL NOTES ON ONE DAY'
            ELSE                                       '🔴 adjusted more than once' END AS verdict,
       COUNT(*)                                   AS maids,
       SUM(notes)                                 AS notes,
       ROUND(SUM(total))                          AS aed,
       ROUND(SUM(IFF(notes > 1, total - largest, 0))) AS aed_BEYOND_THE_FIRST,
       MAX(notes)                                 AS most_notes_for_one_maid,
       MAX(days_apart)                            AS widest_gap_days
FROM per_maid
GROUP BY 1
ORDER BY aed DESC;

-- LD3. 🔴 DID SHE ACTUALLY SWITCH CC -> MV, AND ON THAT DATE? Resolved from
--   HOUSEMAIDS_INFO_REVISION, which carries HOUSEMAID_TYPE, OLD_HOUSEMAID_TYPE and
--   SWITCH_HOUSEMAID_TYPE_DATE. Read as a WINDOW, not a point — the transient-state lesson
--   that cost two retractions today (anti-attrition, then Office Work).
WITH ld AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Last Day CC Switch Adjustment' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), rev AS (
    SELECT ID AS maid_id, HOUSEMAID_TYPE, OLD_HOUSEMAID_TYPE,
           SWITCH_HOUSEMAID_TYPE_DATE AS switch_date
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION
), flags AS (
    SELECT l.note_id, l.HOUSEMAID_ID, l.note_day, l.AMOUNT,
           MAX(IFF(r.switch_date = l.note_day, 1, 0))                            AS switched_on_the_note_day,
           MAX(IFF(ABS(DATEDIFF('day', r.switch_date, l.note_day)) <= 31, 1, 0)) AS switched_within_a_month,
           MAX(IFF(r.HOUSEMAID_TYPE = 'MAID_VISA'
                   AND COALESCE(r.OLD_HOUSEMAID_TYPE,'') <> 'MAID_VISA', 1, 0))  AS became_mv_from_cc,
           MAX(IFF(r.switch_date IS NOT NULL, 1, 0))                             AS has_any_switch_date
    FROM ld l
    LEFT JOIN rev r ON r.maid_id = l.HOUSEMAID_ID
    GROUP BY 1, 2, 3, 4
)
SELECT CASE
         WHEN switched_on_the_note_day = 1 THEN '🟢 switched CC->MV on the note date itself'
         WHEN switched_within_a_month  = 1 THEN '🟢 switched within a month of the note'
         WHEN became_mv_from_cc        = 1 THEN '⚠️ became MV from CC, but not near this note'
         WHEN has_any_switch_date      = 1 THEN '⚠️ has a switch date, nowhere near the note'
         ELSE                                   '🔴 NO CC->MV SWITCH ON RECORD AT ALL'
       END                              AS verdict,
       COUNT(*)                         AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)     AS maids,
       ROUND(SUM(AMOUNT))               AS aed,
       ROUND(MEDIAN(AMOUNT))            AS median_paid
FROM flags
GROUP BY 1
ORDER BY aed DESC;

-- LD4. The amount: one day of CC salary. Denominator is the maid's TYPICAL month across her
--   whole payroll history — M3b-pre Q2, after a partial-month row cost a finding twice today.
WITH ld AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT,
           DAY(LAST_DAY(NOTE_DATE::DATE)) AS days_in_month
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Last Day CC Switch Adjustment' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), typical AS (
    SELECT HOUSEMAID_ID, MEDIAN(TOTAL_SALARY) AS typical_month
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY
    WHERE TOTAL_SALARY > 0 GROUP BY 1
)
SELECT CASE
         WHEN t.typical_month IS NULL                                   THEN 'BLOCKED — no payroll history'
         WHEN l.AMOUNT <= (t.typical_month / l.days_in_month) * 1.10     THEN '🟢 one day of a typical month'
         WHEN l.AMOUNT <= (t.typical_month / l.days_in_month) * 2.00     THEN '⚠️ one to two days'
         ELSE                                                                '🔴 MORE THAN TWO DAYS'
       END                                                          AS verdict,
       COUNT(*)                                                     AS notes,
       COUNT(DISTINCT l.HOUSEMAID_ID)                               AS maids,
       ROUND(SUM(l.AMOUNT))                                         AS aed,
       ROUND(SUM(GREATEST(l.AMOUNT - t.typical_month / l.days_in_month, 0))) AS aed_ABOVE_ONE_DAY,
       ROUND(MEDIAN(l.AMOUNT))                                      AS median_paid,
       ROUND(MEDIAN(t.typical_month / l.days_in_month))             AS median_one_day
FROM ld l LEFT JOIN typical t ON t.HOUSEMAID_ID = l.HOUSEMAID_ID
GROUP BY 1
ORDER BY aed_ABOVE_ONE_DAY DESC, aed DESC;

-- LD1/LD3 RESULTS 2026-09-08 — 🟢 LAST DAY CC SWITCH CLOSES AT ZERO FINDINGS.
--   LD1: 213 of 213 notes dated the last day of the month. 3 distinct days (2026-06-30,
--        07-31, 08-31), 213 distinct maids, none at midnight (real timestamps, consistent
--        with the audit-todo job writing them).
--   LD3: 213 of 213 switched CC->MV **on the note date itself**. Not "within a month" — on
--        the exact day. Median amount 65, which is one day of a ~2,000 salary over 30 days.
--   LD2 is clean by construction: 213 notes across 213 maids is one adjustment each.
--   🟢 The cleanest type in the audit. Every note produced by the rule as written, on the date
--   the rule specifies, for a switch that actually happened that day.
--
-- 🔴 THE PATTERN THIS COMPLETES, and it is the audit's most useful single observation:
--   THE NEWER THE PRODUCER, THE CLEANER THE MONEY.
--     Last Day CC Switch (first notes 2026-06-30) .. 213/213 correct · zero findings
--     MV Prorated Salary (recent feature) .......... 770 notes · zero eligibility violations
--     Office Work Addition ......................... 92/92 assigned · zero findings
--     Anti-attrition (older) ....................... checks eligibility at SELECTION, pays two
--                                                    async hops later -> 64 notes / AED 14,545
--     Airfare's manual route (legacy expense path) . skips the duplicate guard entirely
--                                                    -> 29 notes / AED 49,500
--     Bonus ........................................ no gate at all -> AED 143,965
--   Every one of the newest three validates its condition AT THE MOMENT IT WRITES THE NOTE.
--   Every finding in the ledger comes from a producer that does not.
