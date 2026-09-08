-- =====================================================================================
-- DEEP PROFILE — the 14 LIVE payment types (AED 6.76m / 12 months)
-- Run all nine. Each answers a different question the audit needs and cannot infer.
-- Every block dedups with QUALIFY: the view fans out on HOUSEMAID_ID + EXPENSE_ID (H1).
-- =====================================================================================

-- Reusable base. Paste this CTE at the top of each block.
--   WITH n AS (
--     SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT, NOTE_TYPE, NOTE_REASON,
--            COALESCE(REASON,'(none)') AS payment_type,
--            NULLIF(TRIM(REQUESTED_BY),'') AS requester,
--            NULLIF(TRIM(APPROVED_BY),'')  AS approver
--     FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
--     QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
--   )

-- Every block below filters to the live set:
--   AND payment_type IN ('Airfare Ticket','Anti-attrition Incentive','Bonus',
--     'MV Prorated Salary','Salary Dispute','Raffle Prize','Prorated salary',
--     'Taxi Reimbursement','Forgive Deduction','Maids.at other expenses',
--     'Accommodation Relocation','Office Work Addition','Medical Assistance',
--     'Last Day CC Switch Adjustment')

-- =====================================================================================
-- 1. THE AMOUNT SPECTRUM — is it a scheme, a recompute, or discretion?
--    The single most diagnostic query. A type whose top 10 amounts cover most of the
--    money has a recoverable rule (CEIL). One that doesn't is discretion (UNRULED) or
--    a computation (RECOMP). This is what cracked anti-attrition and the raffle.
-- =====================================================================================
WITH n AS (
  SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT,
         COALESCE(REASON,'(none)') AS payment_type
  FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
  WHERE NOTE_TYPE = 'ADDITION'
    AND NOTE_DATE BETWEEN DATEADD('month',-12,CURRENT_DATE()) AND CURRENT_DATE()
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), ranked AS (
  SELECT payment_type, AMOUNT, COUNT(*) AS notes, SUM(AMOUNT) AS aed,
         ROW_NUMBER() OVER (PARTITION BY payment_type ORDER BY COUNT(*) DESC) AS rn
  FROM n GROUP BY 1,2
)
SELECT payment_type, rn AS rank, AMOUNT, notes, ROUND(aed) AS aed,
       ROUND(100.0 * notes / SUM(notes) OVER (PARTITION BY payment_type),1) AS pct_of_notes,
       ROUND(100.0 * SUM(notes) OVER (PARTITION BY payment_type ORDER BY rn
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
           / SUM(notes) OVER (PARTITION BY payment_type),1)                 AS cumulative_pct
FROM ranked
WHERE rn <= 10
ORDER BY payment_type, rn;

-- =====================================================================================
-- 2. ROUNDNESS — separates typed-in figures from computed ones.
--    A type that is ~100% round is a tier table. One that is mostly non-round is a
--    recompute (proration, a rate x days). A MIX inside one type means two different
--    mechanisms are sharing one payment reason, which is a finding in itself.
-- =====================================================================================
WITH n AS (
  SELECT ID, AMOUNT, COALESCE(REASON,'(none)') AS payment_type
  FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
  WHERE NOTE_TYPE = 'ADDITION'
    AND NOTE_DATE BETWEEN DATEADD('month',-12,CURRENT_DATE()) AND CURRENT_DATE()
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
)
SELECT payment_type, COUNT(*) AS notes,
       ROUND(100.0*COUNT_IF(AMOUNT = ROUND(AMOUNT))            / COUNT(*)) AS pct_whole_aed,
       ROUND(100.0*COUNT_IF(AMOUNT % 50  = 0 AND AMOUNT <> 0)  / COUNT(*)) AS pct_multiple_of_50,
       ROUND(100.0*COUNT_IF(AMOUNT % 100 = 0 AND AMOUNT <> 0)  / COUNT(*)) AS pct_multiple_of_100,
       ROUND(100.0*COUNT_IF(AMOUNT <> ROUND(AMOUNT))           / COUNT(*)) AS pct_has_fils,
       COUNT_IF(AMOUNT = 0)                                                AS zero_amount,
       COUNT_IF(AMOUNT < 0)                                                AS negative_amount,
       ROUND(MIN(AMOUNT),2) AS min_amt, ROUND(MAX(AMOUNT),2) AS max_amt,
       ROUND(AVG(AMOUNT),2) AS avg_amt, ROUND(MEDIAN(AMOUNT),2) AS median_amt,
       ROUND(STDDEV(AMOUNT),2) AS stdev
FROM n GROUP BY 1 ORDER BY notes DESC;

-- =====================================================================================
-- 3. CADENCE — batch job or human trickle?
--    A type concentrated on one day a month is machine-run; one spread evenly is
--    hand-entered. Month-end concentration + no requester = an unattended batch.
-- =====================================================================================
WITH n AS (
  SELECT ID, NOTE_DATE, AMOUNT, COALESCE(REASON,'(none)') AS payment_type,
         NULLIF(TRIM(REQUESTED_BY),'') AS requester
  FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
  WHERE NOTE_TYPE = 'ADDITION'
    AND NOTE_DATE BETWEEN DATEADD('month',-12,CURRENT_DATE()) AND CURRENT_DATE()
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), byday AS (
  SELECT payment_type, NOTE_DATE::DATE AS d, COUNT(*) AS notes FROM n GROUP BY 1,2
)
SELECT b.payment_type,
       COUNT(*)                                        AS active_days,
       MAX(b.notes)                                    AS busiest_day_notes,
       ROUND(100.0*MAX(b.notes)/SUM(b.notes))          AS pct_on_busiest_day,
       COUNT_IF(b.d = LAST_DAY(b.d))                   AS days_that_were_month_end,
       ROUND(100.0*SUM(IFF(b.d = LAST_DAY(b.d), b.notes, 0))/SUM(b.notes)) AS pct_notes_month_end,
       ROUND(AVG(b.notes),1)                           AS avg_notes_per_active_day
FROM byday b GROUP BY 1 ORDER BY SUM(b.notes) DESC;

-- =====================================================================================
-- 4. PROVENANCE + CONTROL — who touches it, and is anyone checking?
--    pct_self_approved here is a REAL segregation question only where a human is the
--    requester. Where no requester exists it is a service account (see anti-attrition).
-- =====================================================================================
WITH n AS (
  SELECT ID, AMOUNT, COALESCE(REASON,'(none)') AS payment_type,
         NULLIF(TRIM(REQUESTED_BY),'') AS requester,
         NULLIF(TRIM(APPROVED_BY),'')  AS approver,
         TIME(NOTE_DATE) = '00:00:00'  AS midnight
  FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
  WHERE NOTE_TYPE = 'ADDITION'
    AND NOTE_DATE BETWEEN DATEADD('month',-12,CURRENT_DATE()) AND CURRENT_DATE()
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
)
SELECT payment_type, COUNT(*) AS notes, ROUND(SUM(AMOUNT)) AS aed,
       COUNT(DISTINCT requester)                                   AS distinct_requesters,
       COUNT(DISTINCT approver)                                    AS distinct_approvers,
       ROUND(100.0*COUNT_IF(requester IS NULL)/COUNT(*))           AS pct_no_requester,
       ROUND(100.0*COUNT_IF(approver  IS NULL)/COUNT(*))           AS pct_no_approver,
       ROUND(100.0*COUNT_IF(midnight)/COUNT(*))                    AS pct_midnight,
       ROUND(100.0*COUNT_IF(requester IS NOT NULL AND approver IS NOT NULL
                            AND LOWER(requester) = LOWER(approver))/COUNT(*)) AS pct_self_approved,
       -- concentration: how much of the money does the single busiest requester move?
       ROUND(100.0*MAX(req_aed)/SUM(AMOUNT))                       AS pct_money_top_requester
FROM (
  SELECT n.*, SUM(AMOUNT) OVER (PARTITION BY payment_type, requester) AS req_aed FROM n
) GROUP BY 1 ORDER BY aed DESC;

-- =====================================================================================
-- 5. REPEAT EXPOSURE — how often does the same maid receive the same payment?
--    Distinguishes a one-off entitlement (airfare) from a recurring one (anti-attrition),
--    and surfaces types where repetition is NOT expected.
-- =====================================================================================
WITH n AS (
  SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT, COALESCE(REASON,'(none)') AS payment_type
  FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
  WHERE NOTE_TYPE = 'ADDITION'
    AND NOTE_DATE BETWEEN DATEADD('month',-12,CURRENT_DATE()) AND CURRENT_DATE()
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), per_maid AS (
  SELECT payment_type, HOUSEMAID_ID, COUNT(*) AS times, SUM(AMOUNT) AS aed,
         COUNT(DISTINCT DATE_TRUNC('month',NOTE_DATE)) AS months
  FROM n GROUP BY 1,2
)
SELECT payment_type,
       COUNT(*)                                  AS maids,
       ROUND(AVG(times),2)                       AS avg_times_per_maid,
       MAX(times)                                AS max_times_one_maid,
       COUNT_IF(times = 1)                       AS paid_once,
       COUNT_IF(times > 1)                       AS paid_more_than_once,
       COUNT_IF(times > months)                  AS maids_paid_twice_in_a_month,
       ROUND(100.0*SUM(IFF(times>1,aed,0))/SUM(aed)) AS pct_money_to_repeat_maids,
       ROUND(MAX(aed))                           AS most_to_one_maid
FROM per_maid GROUP BY 1 ORDER BY maids DESC;

-- =====================================================================================
-- 6. SAME MAID, SAME TYPE, SAME DAY — the duplicate-payment list.
--    Legitimate for two contracts; a finding otherwise. Review, not verdict.
-- =====================================================================================
WITH n AS (
  SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT, COALESCE(REASON,'(none)') AS payment_type,
         NULLIF(TRIM(REQUESTED_BY),'') AS requester
  FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
  WHERE NOTE_TYPE = 'ADDITION'
    AND NOTE_DATE BETWEEN DATEADD('month',-12,CURRENT_DATE()) AND CURRENT_DATE()
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
)
SELECT payment_type, HOUSEMAID_ID, NOTE_DATE::DATE AS d,
       COUNT(*) AS notes_same_day, ROUND(SUM(AMOUNT)) AS aed,
       COUNT(DISTINCT AMOUNT) AS distinct_amounts,
       ARRAY_AGG(ID) WITHIN GROUP (ORDER BY ID) AS note_ids,
       ARRAY_AGG(DISTINCT requester)            AS requesters
FROM n GROUP BY 1,2,3 HAVING COUNT(*) > 1
ORDER BY aed DESC;

-- =====================================================================================
-- 7. TREND — which of the 14 are growing, and how fast?
--    Growth in an unruled payment is the thing that turns a small problem into a big one.
-- =====================================================================================
WITH n AS (
  SELECT ID, NOTE_DATE, AMOUNT, HOUSEMAID_ID, COALESCE(REASON,'(none)') AS payment_type
  FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
  WHERE NOTE_TYPE = 'ADDITION'
    AND NOTE_DATE BETWEEN DATEADD('month',-18,CURRENT_DATE()) AND CURRENT_DATE()
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
)
SELECT payment_type, DATE_TRUNC('month',NOTE_DATE)::DATE AS month,
       COUNT(*) AS notes, COUNT(DISTINCT HOUSEMAID_ID) AS maids,
       ROUND(SUM(AMOUNT)) AS aed, ROUND(MEDIAN(AMOUNT),2) AS median_amt
FROM n GROUP BY 1,2 ORDER BY payment_type, month;

-- =====================================================================================
-- 8. THE FREE TEXT — the templated expense string is the richest field in the view.
--    Segment 2 is the EXPENSE CATEGORY. This is the payment-type -> expense-head mapping
--    the spec has been asking a business owner for (N14), recoverable from data.
-- =====================================================================================
WITH n AS (
  SELECT ID, AMOUNT, NOTE_REASON, COALESCE(REASON,'(none)') AS payment_type
  FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
  WHERE NOTE_TYPE = 'ADDITION'
    AND NOTE_DATE BETWEEN DATEADD('month',-12,CURRENT_DATE()) AND CURRENT_DATE()
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
)
SELECT payment_type,
       SPLIT_PART(NOTE_REASON,'/',2)                    AS expense_category,
       COUNT(*) AS notes, ROUND(SUM(AMOUNT)) AS aed,
       COUNT_IF(NOTE_REASON ILIKE 'Ex%')                AS templated,
       COUNT_IF(NOTE_REASON IS NULL OR TRIM(NOTE_REASON)='') AS no_text
FROM n GROUP BY 1,2 ORDER BY payment_type, notes DESC;

-- =====================================================================================
-- 9. THE OUTLIER LIST — top 25 by amount within each type, plus anything beyond 3 sigma.
--    Not a verdict. The rows a human should look at first, whatever the rules turn out to be.
-- =====================================================================================
WITH n AS (
  SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT, COALESCE(REASON,'(none)') AS payment_type,
         NULLIF(TRIM(REQUESTED_BY),'') AS requester, NULLIF(TRIM(APPROVED_BY),'') AS approver
  FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
  WHERE NOTE_TYPE = 'ADDITION'
    AND NOTE_DATE BETWEEN DATEADD('month',-12,CURRENT_DATE()) AND CURRENT_DATE()
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), s AS (
  SELECT n.*, AVG(AMOUNT) OVER (PARTITION BY payment_type) AS mu,
              STDDEV(AMOUNT) OVER (PARTITION BY payment_type) AS sd,
              ROW_NUMBER() OVER (PARTITION BY payment_type ORDER BY AMOUNT DESC) AS rn
  FROM n
)
SELECT payment_type, ID AS note_id, HOUSEMAID_ID AS maid_id, NOTE_DATE::DATE AS d,
       AMOUNT, ROUND(mu,2) AS type_avg,
       ROUND(IFF(sd > 0, (AMOUNT-mu)/sd, 0),2) AS sigmas_above_mean,
       requester, approver
FROM s
WHERE rn <= 25 OR (sd > 0 AND (AMOUNT-mu)/sd > 3)
ORDER BY payment_type, AMOUNT DESC;
