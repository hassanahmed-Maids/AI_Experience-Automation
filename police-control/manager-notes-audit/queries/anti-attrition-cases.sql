-- Anti-attrition incentive (group B) — case extraction and the checks the code enables.
-- Rule source: MaidIncentiveExperimentJob, erp/magnamedia-housemaid-management (N13, conv 45934).
-- Verified against 9,167 real notes, 2025-09-10 .. 2026-09-07.

-- 1. The case list. QUALIFY is required: the view LEFT JOINs expenses on
--    HOUSEMAID_ID + EXPENSE_ID, and EXPENSE_ID is a CATEGORY, so one note can fan out (H1).
SELECT
    n.ID                                      AS note_id,
    n.HOUSEMAID_ID                            AS maid_id,
    n.NOTE_DATE::DATE                         AS note_date,
    n.AMOUNT,
    n.REQUESTED_BY,
    n.APPROVED_BY
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
WHERE n.NOTE_TYPE = 'ADDITION'
  AND n.REASON ILIKE '%ATTRITION%'
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
QUALIFY ROW_NUMBER() OVER (PARTITION BY n.ID ORDER BY n.NOTE_DATE) = 1
ORDER BY n.NOTE_DATE DESC, n.AMOUNT DESC;

-- 2. B1 — enrolled? The enrolment record is ALREADY in the warehouse.
--    A note with no Maid_Incentive_Experiment action log is RED.
--    NOTE: HOUSEMAID_MANAGERACTIONLOGS.AMOUNT maps to DEDUCTION_AMOUNT, NOT incentiveAmount,
--    so B4/B5 (recompute, allowed-amount) cannot run until INCENTIVE_AMOUNT is exposed (O23).
WITH notes AS (
    SELECT n.ID, n.HOUSEMAID_ID, n.NOTE_DATE, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON ILIKE '%ATTRITION%'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY n.ID ORDER BY n.NOTE_DATE) = 1
)
SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_date, n.AMOUNT,
       MAX(a.ACTION_DATE)         AS enrolled_on,
       COUNT(a.ID)                AS enrolment_rows,
       IFF(COUNT(a.ID) = 0, 'RED - never enrolled', 'ok') AS b1
FROM notes n
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS a
       ON a.HOUSEMAID_ID = n.HOUSEMAID_ID
      AND a.ACTION_TYPE ILIKE '%Incentive%Experiment%'   -- confirm the exact picklist NAME first
      AND a.ACTION_DATE <= n.NOTE_DATE
GROUP BY 1,2,3,4
HAVING COUNT(a.ID) = 0
ORDER BY n.NOTE_DATE DESC;

-- 3. B6 — the job guards once per CONTRACT per month. Without CONTRACT_ID (O23) this
--    cannot separate a double-pay from a legitimate two-contract month, so it is a
--    review list, not a verdict. 167 such cases in the last 12 months.
WITH notes AS (
    SELECT n.ID, n.HOUSEMAID_ID, n.NOTE_DATE, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON ILIKE '%ATTRITION%'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY n.ID ORDER BY n.NOTE_DATE) = 1
)
SELECT HOUSEMAID_ID, NOTE_DATE::DATE AS batch_date,
       COUNT(*) AS notes_same_day, SUM(AMOUNT) AS total,
       ARRAY_AGG(ID) WITHIN GROUP (ORDER BY ID) AS note_ids
FROM notes
GROUP BY 1,2 HAVING COUNT(*) > 1
ORDER BY total DESC;

-- 4. Hand-added notes: anything NOT on a month-end batch date bypassed the job entirely.
--    156 in the last 12 months (AED 37,576); 43 of them at amounts matching no standard value.
WITH notes AS (
    SELECT n.ID, n.HOUSEMAID_ID, n.NOTE_DATE, n.AMOUNT, n.REQUESTED_BY
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON ILIKE '%ATTRITION%'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY n.ID ORDER BY n.NOTE_DATE) = 1
), batch_days AS (
    SELECT NOTE_DATE::DATE AS d FROM notes GROUP BY 1 HAVING COUNT(*) > 100
)
SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_date, n.AMOUNT, n.REQUESTED_BY
FROM notes n
WHERE n.NOTE_DATE::DATE NOT IN (SELECT d FROM batch_days)
ORDER BY n.AMOUNT DESC;
