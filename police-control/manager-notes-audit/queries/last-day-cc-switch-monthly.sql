-- =====================================================================================
-- LAST DAY CC SWITCH ADJUSTMENT — monthly, twelve months.
--
-- The type settles the final part-day when a maid switches out of a CC contract, so the
-- MEDIAN is the number that describes it, not the average: a part-day settlement should be
-- small and tightly clustered. A month where the median jumps is more interesting than one
-- where the total does, because the total moves with headcount.
--
-- ⚠️ NO UPPER DATE BOUND, deliberately. Every other query in this audit carries
--    `NOTE_DATE <= CURRENT_DATE()`, and on airfare that standing filter turned out to hide
--    216 notes / AED 385,000 that nothing had ever examined. Future-dated notes here will
--    simply appear as their own months — visible rather than silently dropped.
-- =====================================================================================

SELECT DATE_TRUNC('month', NOTE_DATE)::DATE      AS month,
       COUNT(*)                                  AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)              AS maids,
       ROUND(SUM(AMOUNT))                        AS total_aed,
       ROUND(AVG(AMOUNT), 2)                     AS avg_per_note,
       ROUND(MEDIAN(AMOUNT), 2)                  AS median_per_note,
       ROUND(MIN(AMOUNT), 2)                     AS smallest,
       ROUND(MAX(AMOUNT), 2)                     AS largest,
       ROUND(SUM(AMOUNT) / NULLIF(COUNT(DISTINCT HOUSEMAID_ID), 0), 2) AS aed_per_maid,
       ROUND(100.0 * SUM(AMOUNT)
             / SUM(SUM(AMOUNT)) OVER (), 1)      AS pct_of_year
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION'
  AND REASON    = 'Last Day CC Switch Adjustment'
  AND AMOUNT    > 0
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
ORDER BY 1;
