-- =====================================================================================
-- BLOCK B — RUNNABLE NOW. No discovery dependency, no reference list, no business answer.
-- G2/G10 guard the audit's own correctness. P1/P2/P3 are the population-level battery
-- (spec M3c) that no per-note test can replace. P3 is the one that would have caught the
-- Bonus/Abu Dhabi relabelling four months ago.
-- =====================================================================================

-- G2. GRAIN. Must return equal numbers and zero duplicates. If it does not, every metric
--     downstream is inflated and nothing else in this file means anything.
SELECT COUNT(*)                                   AS rows_,
       COUNT(DISTINCT ID)                         AS distinct_ids,
       COUNT(*) - COUNT(DISTINCT ID)              AS duplicate_rows,
       COUNT_IF(ID IS NULL)                       AS null_ids,
       COUNT_IF(HOUSEMAID_ID IS NULL)             AS null_maids,
       COUNT_IF(NOTE_DATE IS NULL)                AS null_dates,
       COUNT_IF(AMOUNT IS NULL)                   AS null_amounts,
       COUNT_IF(REASON IS NULL)                   AS null_payment_types
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE());

-- G10. NOTE TYPES PRESENT. The ERP enum has 7 values; the audit counts only ADDITION.
--      Any other type carrying money means money is moving through an excluded path.
SELECT COALESCE(NOTE_TYPE, '(null)')  AS note_type,
       COUNT(*)                       AS notes,
       ROUND(SUM(AMOUNT))             AS aed,
       COUNT_IF(AMOUNT = 0)           AS zeros,
       COUNT_IF(AMOUNT < 0)           AS negatives,
       MIN(NOTE_DATE::DATE)           AS first_seen,
       MAX(NOTE_DATE::DATE)           AS last_seen
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
ORDER BY notes DESC;

-- P1. WHOLE-RUN ZERO (M3c). A run = a note_day carrying >= 5 notes of one payment type.
--     RED when 100% of them are zero. This is the test that would have caught the Abu
--     Dhabi run on the day, instead of eight days later via a bespoke investigation.
--     Returns only flagged runs, so a clean year returns nothing.
SELECT COALESCE(REASON, '(none)')                          AS payment_type,
       NOTE_DATE::DATE                                     AS run_day,
       COUNT(*)                                            AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                        AS maids,
       ROUND(SUM(AMOUNT))                                  AS aed,
       ROUND(100.0 * COUNT_IF(AMOUNT = 0) / COUNT(*), 1)   AS pct_zero
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION'
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1, 2
HAVING COUNT(*) >= 5
   AND COUNT_IF(AMOUNT = 0) = COUNT(*)
ORDER BY notes DESC;

-- P2. CENSUS DRIFT (M3c). A payment type's monthly volume against its own trailing
--     3-month average. Flags a type that appears, vanishes, or moves by more than 60%.
--     Excludes future-dated months, which decay by construction and are not drift.
WITH m AS (
    SELECT COALESCE(REASON, '(none)')            AS payment_type,
           DATE_TRUNC('month', NOTE_DATE)::DATE  AS mth,
           COUNT(*)                              AS notes,
           ROUND(SUM(AMOUNT))                    AS aed
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE < DATE_TRUNC('month', CURRENT_DATE())
    GROUP BY 1, 2
), w AS (
    SELECT m.*,
           AVG(notes) OVER (PARTITION BY payment_type ORDER BY mth
                            ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS trailing_avg
    FROM m
)
SELECT payment_type, mth, notes, aed, ROUND(trailing_avg, 1) AS trailing_avg,
       ROUND(100.0 * (notes - trailing_avg) / NULLIF(trailing_avg, 0), 0) AS pct_change
FROM w
WHERE trailing_avg IS NOT NULL
  AND (notes > trailing_avg * 1.6 OR notes < trailing_avg * 0.4)
ORDER BY ABS(notes - trailing_avg) DESC;

-- P3. 🔴 RELABELLING (M3c) — the one to build first. A requester's cohort moves from one
--     payment type to another between consecutive runs while its size holds. That is the
--     Bonus -> Abu Dhabi Incentive switch of 2026-08-31, and no per-note test can see it.
--     Requesters are numbered, never named.
WITH n AS (
    SELECT NULLIF(TRIM(REQUESTED_BY), '') AS req, NOTE_DATE::DATE AS run_day,
           COALESCE(REASON, '(none)') AS payment_type, HOUSEMAID_ID, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), runs AS (
    SELECT req, run_day, payment_type,
           COUNT(*) AS notes, COUNT(DISTINCT HOUSEMAID_ID) AS maids, SUM(AMOUNT) AS aed
    FROM n WHERE req IS NOT NULL
    GROUP BY 1, 2, 3
), dominant AS (
    SELECT * FROM runs
    QUALIFY ROW_NUMBER() OVER (PARTITION BY req, run_day ORDER BY notes DESC) = 1
), seq AS (
    SELECT d.*,
           DENSE_RANK() OVER (ORDER BY req)                                   AS requester_key,
           LAG(payment_type) OVER (PARTITION BY req ORDER BY run_day)         AS prev_type,
           LAG(maids)        OVER (PARTITION BY req ORDER BY run_day)         AS prev_maids,
           LAG(aed)          OVER (PARTITION BY req ORDER BY run_day)         AS prev_aed,
           LAG(run_day)      OVER (PARTITION BY req ORDER BY run_day)         AS prev_run
    FROM dominant d
)
SELECT requester_key, prev_run, run_day,
       prev_type, payment_type AS new_type,
       prev_maids, maids,
       ROUND(prev_aed) AS prev_aed, ROUND(aed) AS aed
FROM seq
WHERE prev_type IS NOT NULL
  AND payment_type <> prev_type
  AND maids BETWEEN prev_maids * 0.6 AND prev_maids * 1.4   -- the cohort held
  AND prev_maids >= 5
ORDER BY prev_run;

-- P4. RUN DOUBLED (M3c). Two runs of one payment type inside 20 days — shorter than any
--     monthly cycle. Derives run days from the data rather than assuming month-end.
WITH runs AS (
    SELECT COALESCE(REASON, '(none)') AS payment_type, NOTE_DATE::DATE AS run_day,
           COUNT(*) AS notes, ROUND(SUM(AMOUNT)) AS aed
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    GROUP BY 1, 2
    HAVING COUNT(*) >= 20
)
SELECT payment_type, run_day, notes, aed,
       LAG(run_day) OVER (PARTITION BY payment_type ORDER BY run_day) AS prev_run,
       DATEDIFF('day', LAG(run_day) OVER (PARTITION BY payment_type ORDER BY run_day),
                run_day)                                              AS days_since
FROM runs
QUALIFY days_since IS NOT NULL AND days_since <= 20
ORDER BY payment_type, run_day;

-- P5. AMOUNT DISTRIBUTION SHIFT (M3c). The modal amount of a type changing between runs
--     is legitimate when announced and a finding when not. Reports the modal amount per
--     type per month so a change is visible rather than inferred.
SELECT COALESCE(REASON, '(none)')                        AS payment_type,
       DATE_TRUNC('month', NOTE_DATE)::DATE              AS mth,
       COUNT(*)                                          AS notes,
       MODE(AMOUNT)                                      AS modal_amount,
       ROUND(MEDIAN(AMOUNT))                             AS median_amount,
       COUNT(DISTINCT AMOUNT)                            AS distinct_amounts
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION' AND AMOUNT > 0
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
  AND NOTE_DATE < DATE_TRUNC('month', CURRENT_DATE())
GROUP BY 1, 2
HAVING COUNT(*) >= 10
ORDER BY payment_type, mth;
