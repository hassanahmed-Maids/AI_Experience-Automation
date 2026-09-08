-- =====================================================================================
-- ZERO-AMOUNT MANAGER NOTES — investigation. Design: ZERO-AMOUNT-INVESTIGATION.md
-- Opened 2026-09-08. Every query returns COUNTS AND SUMS ONLY. NOTE_REASON is free text
-- about a named person: the AI Agent reads it, the audit never republishes it. Where a
-- query tests whether text CONTAINS a number, that is an INDICATOR, not a value — digits
-- in prose can be dates, contract numbers or MOHRE references.
-- Each block is self-contained.
-- =====================================================================================

-- Z1. Census. Which payment types carry zeros, at what rate, over how many distinct days,
--     in what window, and how many of those zeros carry a number in their free text.
--     A high rate on few days is a spike; a moderate rate on many days is a process.
SELECT COALESCE(REASON, '(none)')                                        AS payment_type,
       COUNT(*)                                                          AS notes,
       COUNT_IF(AMOUNT = 0)                                              AS zero_notes,
       ROUND(100.0 * COUNT_IF(AMOUNT = 0) / COUNT(*), 1)                 AS pct_zero,
       COUNT(DISTINCT IFF(AMOUNT = 0, NOTE_DATE::DATE, NULL))            AS distinct_zero_days,
       MIN(IFF(AMOUNT = 0, NOTE_DATE::DATE, NULL))                       AS first_zero,
       MAX(IFF(AMOUNT = 0, NOTE_DATE::DATE, NULL))                       AS last_zero,
       COUNT_IF(AMOUNT = 0 AND REGEXP_LIKE(NOTE_REASON, '.*[0-9]{2,}.*')) AS zero_with_number_in_text,
       COUNT_IF(AMOUNT = 0 AND NULLIF(TRIM(NOTE_REASON), '') IS NULL)    AS zero_with_no_text
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION'
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
HAVING COUNT_IF(AMOUNT = 0) > 0
ORDER BY zero_notes DESC;

-- Z2. Time shape. One bad month across many types is an incident; a steady band is a process.
SELECT DATE_TRUNC('month', NOTE_DATE)::DATE                    AS mth,
       COUNT(*)                                                AS notes,
       COUNT_IF(AMOUNT = 0)                                    AS zeros,
       ROUND(100.0 * COUNT_IF(AMOUNT = 0) / COUNT(*), 1)       AS pct_zero,
       COUNT(DISTINCT IFF(AMOUNT = 0, REASON, NULL))           AS types_with_zeros,
       COUNT(DISTINCT IFF(AMOUNT = 0, NOTE_DATE::DATE, NULL))  AS days_with_zeros
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION'
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
ORDER BY 1;

-- Z3. Companion notes. A zero sitting beside a non-zero note for the same maid on the same
--     day is an annotation, not a lost payment — hypothesis 2. Counts only.
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT, REASON
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), day_shape AS (
    SELECT HOUSEMAID_ID, note_day,
           COUNT_IF(AMOUNT = 0)                                  AS zeros,
           COUNT_IF(AMOUNT > 0)                                  AS non_zeros,
           SUM(IFF(AMOUNT > 0, AMOUNT, 0))                       AS non_zero_aed,
           COUNT(DISTINCT IFF(AMOUNT = 0, REASON, NULL))         AS zero_types,
           COUNT(DISTINCT IFF(AMOUNT > 0, REASON, NULL))         AS non_zero_types
    FROM n GROUP BY 1, 2
)
SELECT CASE
         WHEN zeros = 0                        THEN 'no zero that day'
         WHEN non_zeros = 0                    THEN 'zero(s) ALONE - nothing else paid that day'
         WHEN zero_types = non_zero_types      THEN 'zero beside a paid note of the SAME type'
         ELSE                                       'zero beside a paid note of a DIFFERENT type'
       END                          AS shape,
       COUNT(*)                     AS maid_days,
       SUM(zeros)                   AS zero_notes,
       ROUND(SUM(non_zero_aed))     AS aed_paid_those_days
FROM day_shape
GROUP BY 1
ORDER BY zero_notes DESC;
