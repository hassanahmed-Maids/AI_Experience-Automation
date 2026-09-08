-- =====================================================================================
-- BLOCK B2 — P2, P3 and P4 corrected after their first run. P1 and P5 stand as written.
-- Two of the three misfires are traps this project already documented and the tests still
-- inherited: the month-boundary trap, and reading a rate without its population floor.
-- =====================================================================================

-- P2-fixed. CENSUS DRIFT on the AUDIT MONTH, not the calendar month.
--   First run flagged "Anti-attrition Incentive 2026-08: -98%" — a false positive. August's
--   run landed on 2026-09-01, so DATE_TRUNC('month') put it in September and August looked
--   empty. The audit-month shift (-5 days) assigns an early-month run to the month it pays
--   for. A volume floor also stops a type going 1 -> 52 from reporting +5100%.
WITH m AS (
    SELECT COALESCE(REASON, '(none)')                                  AS payment_type,
           DATE_TRUNC('month', DATEADD('day', -5, NOTE_DATE))::DATE    AS audit_month,
           COUNT(*)                                                    AS notes,
           ROUND(SUM(AMOUNT))                                          AS aed
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <  DATEADD('day', -5, DATE_TRUNC('month', CURRENT_DATE()))
    GROUP BY 1, 2
), w AS (
    SELECT m.*,
           AVG(notes) OVER (PARTITION BY payment_type ORDER BY audit_month
                            ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS trailing_avg
    FROM m
)
SELECT payment_type, audit_month, notes, aed, ROUND(trailing_avg, 1) AS trailing_avg,
       ROUND(100.0 * (notes - trailing_avg) / NULLIF(trailing_avg, 0), 0) AS pct_change
FROM w
WHERE trailing_avg >= 20                       -- a floor: below this, swings are noise
  AND (notes > trailing_avg * 1.6 OR notes < trailing_avg * 0.4)
ORDER BY ABS(notes - trailing_avg) DESC;

-- P3-fixed. RELABELLING, with a real cycle between the two runs.
--   First run returned the true Bonus -> Abu Dhabi case AND a false one: a 5-maid requester
--   posting Salary Dispute on 2026-07-03 and Anti-attrition on 2026-07-04. Consecutive days
--   is a person doing two jobs, not a cohort being relabelled. Requires >= 20 days between
--   runs and >= 10 maids in the prior run.
WITH n AS (
    SELECT NULLIF(TRIM(REQUESTED_BY), '') AS req, NOTE_DATE::DATE AS run_day,
           COALESCE(REASON, '(none)') AS payment_type, HOUSEMAID_ID, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), runs AS (
    SELECT req, run_day, payment_type,
           COUNT(*) AS notes, COUNT(DISTINCT HOUSEMAID_ID) AS maids, SUM(AMOUNT) AS aed
    FROM n WHERE req IS NOT NULL GROUP BY 1, 2, 3
), dominant AS (
    SELECT * FROM runs
    QUALIFY ROW_NUMBER() OVER (PARTITION BY req, run_day ORDER BY notes DESC) = 1
), seq AS (
    SELECT d.*,
           DENSE_RANK() OVER (ORDER BY req)                           AS requester_key,
           LAG(payment_type) OVER (PARTITION BY req ORDER BY run_day) AS prev_type,
           LAG(maids)        OVER (PARTITION BY req ORDER BY run_day) AS prev_maids,
           LAG(aed)          OVER (PARTITION BY req ORDER BY run_day) AS prev_aed,
           LAG(run_day)      OVER (PARTITION BY req ORDER BY run_day) AS prev_run
    FROM dominant d
)
SELECT requester_key, prev_run, run_day,
       DATEDIFF('day', prev_run, run_day)  AS days_between,
       prev_type, payment_type AS new_type, prev_maids, maids,
       ROUND(prev_aed) AS prev_aed, ROUND(aed) AS aed
FROM seq
WHERE prev_type IS NOT NULL
  AND payment_type <> prev_type
  AND maids BETWEEN prev_maids * 0.6 AND prev_maids * 1.4
  AND prev_maids >= 10
  AND DATEDIFF('day', prev_run, run_day) >= 20
ORDER BY prev_run;

-- P4-fixed. RUN DOUBLED — but only for types that actually have a cycle.
--   First run flagged Forgive Deduction and Salary Dispute repeatedly at 1-3 day gaps.
--   Those types are processed continuously; "two runs close together" is their normal
--   shape, not a doubled batch. Self-calibrating: a type qualifies only if its own MEDIAN
--   inter-run gap is >= 20 days, and then a gap under half its median is the finding.
WITH runs AS (
    SELECT COALESCE(REASON, '(none)') AS payment_type, NOTE_DATE::DATE AS run_day,
           COUNT(*) AS notes, ROUND(SUM(AMOUNT)) AS aed
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    GROUP BY 1, 2
    HAVING COUNT(*) >= 20
), gapped AS (
    SELECT r.*,
           LAG(run_day) OVER (PARTITION BY payment_type ORDER BY run_day) AS prev_run,
           DATEDIFF('day',
                    LAG(run_day) OVER (PARTITION BY payment_type ORDER BY run_day),
                    run_day) AS days_since
    FROM runs r
), cadence AS (
    SELECT payment_type, MEDIAN(days_since) AS median_gap
    FROM gapped WHERE days_since IS NOT NULL
    GROUP BY 1
)
SELECT g.payment_type, g.prev_run, g.run_day, g.days_since,
       ROUND(c.median_gap) AS this_types_normal_gap, g.notes, g.aed
FROM gapped g JOIN cadence c ON c.payment_type = g.payment_type
WHERE g.days_since IS NOT NULL
  AND c.median_gap >= 20                       -- it is a batch type at all
  AND g.days_since < c.median_gap / 2          -- and this run came far too soon
ORDER BY g.payment_type, g.run_day;
