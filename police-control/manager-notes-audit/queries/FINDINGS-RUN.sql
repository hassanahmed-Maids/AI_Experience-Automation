-- =====================================================================================
-- FINDINGS-RUN.sql — RE-MEASURE EVERY LEDGER ROW. One statement, 13 rows, one paste.
--
-- WHY THIS EXISTS: O12b proved that a ledger row drifts on its own. The same test returned
-- 15 maids / AED 10,500 on 2026-09-08 and 16 / AED 11,500 seven days later, because the
-- 12-month window ROLLS. Every other row has the same property and none had been
-- re-measured since it was written. A ledger of fixed amounts is a ledger of snapshots
-- that do not say so.
--
-- Shape:  FINDING_ID | FINDING | MEASURED_AED | LEDGER_AED | DRIFT | NOTES | MAIDS | STATUS
-- LEDGER_AED is the recorded figure, hard-coded, so DRIFT needs no arithmetic from the reader.
--
-- ⚠️ TWO ROWS ARE RECONSTRUCTIONS, NOT THE ORIGINAL TEST — marked RECONSTRUCTED in STATUS:
--     L11 same-day excess — the original entitlement basis is not recorded; this uses
--         SUM(day) - MAX(note on that day) over groups whose largest note is a valid tier.
--     L13 live-out transport — TF13 additionally restricted to the live-out transport HEAD,
--         a string this file will not guess. This is the superset and will read HIGH.
-- ⚠️ ONE ROW CANNOT BE MEASURED AT ALL — L7, selection-lag (AED 3,050). There is no query
--     on record for it anywhere in queries/. It is emitted as a literal so its absence is
--     visible in the result rather than silent.
-- =====================================================================================

WITH n AS (
    SELECT ID AS note_id, HOUSEMAID_ID, EXPENSE_ID, AMOUNT,
           NOTE_DATE::DATE AS note_day, COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
), ty AS (
    SELECT n.note_id, t.TO_TYPE AS type_when_paid
    FROM n LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
           ON t.HOUSEMAID_ID = n.HOUSEMAID_ID
          AND n.note_day >= t.CHANGE_DATE::DATE
          AND (t.NEXT_CHANGE_DATE IS NULL OR n.note_day < t.NEXT_CHANGE_DATE::DATE)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY n.note_id ORDER BY t.CHANGE_DATE DESC) = 1
), st AS (
    SELECT n.note_id, l.TO_STATUS AS status_when_paid
    FROM n LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS l
           ON l.HOUSEMAID_ID = n.HOUSEMAID_ID
          AND n.note_day >= l.CHANGE_DATE::DATE
          AND (l.NEXT_CHANGE_DATE IS NULL OR n.note_day < l.NEXT_CHANGE_DATE::DATE)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY n.note_id ORDER BY l.CHANGE_DATE DESC) = 1
), j AS (
    SELECT n.*, x.AMOUNT AS req_amount, x.CURRENCY_NAME
    FROM n LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
), enrol AS (
    SELECT HOUSEMAID_ID, MIN(CREATION_DATE)::DATE AS first_created
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%' GROUP BY 1
), refent AS (
    SELECT HOUSEMAID_ID AS referrer_id,
           SUM(IFF(COALESCE(IS_CANCELLED,0)=0 AND COALESCE(IS_REQUESTED_BONUS,0)=1, AMOUNT, 0)) AS entitled
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_REFERRALS
    WHERE HOUSEMAID_ID IS NOT NULL GROUP BY 1
), bonuspaid AS (
    SELECT HOUSEMAID_ID, SUM(AMOUNT) AS bonus_paid
    FROM n WHERE payment_type = 'Bonus' GROUP BY 1
), psrev AS (
    SELECT p.note_id, p.AMOUNT, p.HOUSEMAID_ID, p.note_day, r.salary_start
    FROM (SELECT * FROM n WHERE payment_type = 'Prorated salary') p
    LEFT JOIN (SELECT ID AS maid_id,
                      COALESCE(REPLACEMENT_SALARY_START_DATE, START_DATE)::DATE AS salary_start,
                      LAST_MODIFICATION_DATE::DATE AS changed_on
               FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION
               WHERE LAST_MODIFICATION_DATE IS NOT NULL
                 AND COALESCE(REPLACEMENT_SALARY_START_DATE, START_DATE) IS NOT NULL) r
           ON r.maid_id = p.HOUSEMAID_ID AND r.changed_on <= p.note_day
    QUALIFY ROW_NUMBER() OVER (PARTITION BY p.note_id ORDER BY r.changed_on DESC) = 1
), fdmm AS (
    SELECT f.HOUSEMAID_ID, DATE_TRUNC('month', f.note_day)::DATE AS mth,
           COUNT(*) AS days_forgiven, SUM(f.AMOUNT) AS forgiven_aed,
           MAX(COALESCE(h.PRIMARY_SALARY, h.BASIC_SALARY, 0) + COALESCE(h.ACCOMMODATION_SALARY,0)) AS monthly_salary,
           MAX(DAY(LAST_DAY(f.note_day))) AS days_in_month
    FROM (SELECT * FROM n WHERE payment_type = 'Forgive Deduction') f
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = f.HOUSEMAID_ID
    GROUP BY 1, 2
), air AS (
    SELECT a.note_id, a.HOUSEMAID_ID, a.AMOUNT, a.note_day,
           COALESCE(h.NATIONALITY,'(unknown)') AS nationality
    FROM (SELECT * FROM n WHERE payment_type = 'Airfare Ticket') a
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = a.HOUSEMAID_ID
), airtier AS (
    SELECT nationality, MODE(AMOUNT) AS tier FROM air GROUP BY 1
), afwin AS (
    SELECT a.note_id, a.AMOUNT, a.HOUSEMAID_ID,
           COUNT(t.TO_TYPE)                AS intervals_in_window,
           COUNT_IF(t.TO_TYPE ILIKE 'CC%') AS cc_in_window
    FROM air a
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
           ON t.HOUSEMAID_ID = a.HOUSEMAID_ID
          AND t.CHANGE_DATE::DATE <= a.note_day
          AND (t.NEXT_CHANGE_DATE IS NULL
               OR t.NEXT_CHANGE_DATE::DATE >= DATEADD('day', -730, a.note_day))
    GROUP BY 1, 2, 3
), sday AS (
    SELECT HOUSEMAID_ID, note_day, COUNT(*) AS notes,
           SUM(AMOUNT) AS day_total, MAX(AMOUNT) AS largest
    FROM n WHERE payment_type = 'Anti-attrition Incentive'
    GROUP BY 1, 2 HAVING COUNT(*) > 1
)

SELECT 'L1' AS finding_id, 'Anti-attrition in a NO-SHOW or terminated state' AS finding,
       ROUND(SUM(n.AMOUNT)) AS measured_aed, 13257 AS ledger_aed,
       ROUND(SUM(n.AMOUNT)) - 13257 AS drift,
       COUNT(*) AS notes, COUNT(DISTINCT n.HOUSEMAID_ID) AS maids, 'measured' AS status
FROM n JOIN st ON st.note_id = n.note_id
WHERE n.payment_type = 'Anti-attrition Incentive'
  AND st.status_when_paid IN ('NO_SHOW','NO_SHOW_WENT_OUT_DID_NOT_RETURN','NO_SHOW_LEFT_CLIENT_HOME',
                              'NO_SHOW_FOR_TERMINATION','EMPLOYEMENT_TERMINATED')
UNION ALL
SELECT 'L2', 'Bonus over the referral entitlement',
       ROUND(SUM(bp.bonus_paid - e.entitled)), 11500,
       ROUND(SUM(bp.bonus_paid - e.entitled)) - 11500,
       NULL, COUNT(*), 'measured'
FROM bonuspaid bp JOIN refent e ON e.referrer_id = bp.HOUSEMAID_ID
WHERE e.entitled > 0 AND bp.bonus_paid > e.entitled + 0.01
UNION ALL
-- 🔴 CORRECTED 2026-09-15. The first version read `first_created IS NULL OR note_day <
--    first_created`, which folded maids with NO enrolment record in with maids paid BEFORE
--    enrolment. It returned 11,145/51 against F5's 9,019/42 and I reported the AED 2,126
--    difference as a LIVE, ACCELERATING defect. It was a definition I changed, not drift:
--    the monthly split is 42 paid-before + 9 no-enrolment, and pct_failing is FALLING
--    (2.05% Oct-2025 -> 0.22% Sep-2026). Same failure mode as the retracted AED 49,500.
--    A re-measurement must reproduce the original's DEFINITION, not merely its subject.
--    The 9 no-enrolment notes are a separate CANDIDATE, tested as L3b below.
SELECT 'L3', 'Anti-attrition paid before any enrolment existed',
       ROUND(SUM(n.AMOUNT)), 9019, ROUND(SUM(n.AMOUNT)) - 9019,
       COUNT(*), COUNT(DISTINCT n.HOUSEMAID_ID), 'measured'
FROM n JOIN enrol e ON e.HOUSEMAID_ID = n.HOUSEMAID_ID
WHERE n.payment_type = 'Anti-attrition Incentive'
  AND n.note_day < e.first_created
UNION ALL
-- L3b · CANDIDATE, not a ledger row: no enrolment record AT ALL. Split out of L3 above.
SELECT 'L3b', 'CANDIDATE - anti-attrition with NO enrolment record at all',
       ROUND(SUM(n.AMOUNT)), NULL, NULL,
       COUNT(*), COUNT(DISTINCT n.HOUSEMAID_ID), 'candidate - not on the ledger'
FROM n LEFT JOIN enrol e ON e.HOUSEMAID_ID = n.HOUSEMAID_ID
WHERE n.payment_type = 'Anti-attrition Incentive' AND e.first_created IS NULL
UNION ALL
SELECT 'L4', 'Anti-attrition to MV maids against a CC-only rule',
       ROUND(SUM(n.AMOUNT)), 5726, ROUND(SUM(n.AMOUNT)) - 5726,
       COUNT(*), COUNT(DISTINCT n.HOUSEMAID_ID), 'measured'
FROM n JOIN ty ON ty.note_id = n.note_id
WHERE n.payment_type = 'Anti-attrition Incentive' AND ty.type_when_paid = 'MV'
UNION ALL
SELECT 'L5', 'Airfare to MV maids (24m entitlement window)',
       ROUND(SUM(AMOUNT)), 4500, ROUND(SUM(AMOUNT)) - 4500,
       COUNT(*), COUNT(DISTINCT HOUSEMAID_ID), 'measured'
FROM afwin WHERE intervals_in_window > 0 AND cc_in_window = 0
UNION ALL
SELECT 'L6', 'Accommodation Relocation paid to a live-in maid',
       ROUND(SUM(n.AMOUNT)), 3900, ROUND(SUM(n.AMOUNT)) - 3900,
       COUNT(*), COUNT(DISTINCT n.HOUSEMAID_ID), 'measured'
FROM n JOIN ty ON ty.note_id = n.note_id
WHERE n.payment_type = 'Accommodation Relocation' AND ty.type_when_paid = 'CC Live In'
UNION ALL
SELECT 'L7', 'Selection-lag payments to already-ineligible maids',
       NULL, 3050, NULL, NULL, NULL, 'NO QUERY ON RECORD - cannot be re-measured'
UNION ALL
SELECT 'L8', 'Prorated salary paid outside the eligibility window',
       ROUND(SUM(AMOUNT)), 2976, ROUND(SUM(AMOUNT)) - 2976,
       COUNT(*), COUNT(DISTINCT HOUSEMAID_ID), 'measured'
FROM psrev
WHERE salary_start IS NOT NULL AND salary_start >= '1971-01-01'
  AND (DATEDIFF('day', salary_start, note_day) < 0 OR DATEDIFF('day', salary_start, note_day) > 40)
UNION ALL
SELECT 'L9', 'Forgive Deduction: 15+ days forgiven in a single month',
       ROUND(SUM(forgiven_aed)), 2492, ROUND(SUM(forgiven_aed)) - 2492,
       SUM(days_forgiven), COUNT(DISTINCT HOUSEMAID_ID), 'measured'
FROM fdmm WHERE monthly_salary > 0 AND days_forgiven >= 15
UNION ALL
SELECT 'L10', 'Note exceeds its approved expense request',
       ROUND(SUM(AMOUNT - req_amount)), 1304, ROUND(SUM(AMOUNT - req_amount)) - 1304,
       COUNT(*), COUNT(DISTINCT HOUSEMAID_ID), 'measured'
FROM j WHERE CURRENCY_NAME = 'AED' AND AMOUNT > req_amount + 0.01
UNION ALL
SELECT 'L11', 'Anti-attrition same-day excess over entitlement',
       ROUND(SUM(day_total - largest)), 838, ROUND(SUM(day_total - largest)) - 838,
       SUM(notes), COUNT(DISTINCT HOUSEMAID_ID), 'RECONSTRUCTED - entitlement basis not on record'
FROM sday WHERE largest IN (100,150,200,250,300,350,400,450,500)
UNION ALL
SELECT 'L12', 'Airfare paid above its nationality tier',
       ROUND(SUM(a.AMOUNT - t.tier)), 500, ROUND(SUM(a.AMOUNT - t.tier)) - 500,
       COUNT(*), COUNT(DISTINCT a.HOUSEMAID_ID), 'measured'
FROM air a JOIN airtier t ON t.nationality = a.nationality
WHERE a.AMOUNT > t.tier
UNION ALL
SELECT 'L13', 'Live-out transport allowance paid to a live-in maid',
       ROUND(SUM(n.AMOUNT)), 392, ROUND(SUM(n.AMOUNT)) - 392,
       COUNT(*), COUNT(DISTINCT n.HOUSEMAID_ID), 'RECONSTRUCTED - head filter not reproduced, reads HIGH'
FROM n JOIN ty ON ty.note_id = n.note_id
WHERE n.payment_type = 'Taxi Reimbursement' AND ty.type_when_paid = 'CC Live In'

ORDER BY ledger_aed DESC;

-- RESULT 2026-09-15 — 9 rows drift ZERO, 1 row drift -200 (L4, one note aged off the window).
--   L7 unmeasurable (no query exists). L11 and L13 are reconstructions that DISAGREE with the
--   originals (463 vs 838; 4,237 vs 392) — their definitions were never recorded.
--   L3 corrected above after its first reading produced a false +2,126.
--   LEDGER AFTER THIS RUN: AED 59,254 money lost.
