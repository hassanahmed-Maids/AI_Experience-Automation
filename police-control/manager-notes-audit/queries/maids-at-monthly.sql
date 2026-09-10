-- =====================================================================================
-- MAIDS.AT OTHER EXPENSES — monthly, twelve months.
--
-- Same shape as the Last Day CC Switch rollup, plus the columns this type actually needs.
-- Head `OEX`: APPROVAL_REQUIRED_ON_LIMIT with a limit of AED 200, no invoice required, loan
-- permitted. **Below 200 there is no check of any kind on the money.**
--
-- The year's average note is AED 188 against that 200 threshold. Amounts bunching just under
-- an approval limit is a standard control-avoidance signature — but a mean sitting near a
-- limit is equally consistent with that simply being the natural size of the expense.
-- `pct_under_200` and `pct_at_180_199` split those two readings month by month: a stable
-- share is the natural size; a share that climbs is worth explaining.
--
-- ⚠️ HYPOTHESIS, NOT A FINDING. Stated here so a reader does not mistake the column for a
--    verdict. The decisive test is the shape of the distribution either side of 200, not the
--    monthly trend — see the band query in the audit notes.
-- ⚠️ NO UPPER DATE BOUND, deliberately. The standing `NOTE_DATE <= CURRENT_DATE()` filter
--    every other query carries hid 216 airfare notes / AED 385,000 from every test in the
--    audit. Future-dated notes here appear as their own months instead.
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
             / SUM(SUM(AMOUNT)) OVER (), 1)      AS pct_of_year,
       -- the approval threshold on head OEX is 200; below it, nothing is checked
       COUNT_IF(AMOUNT < 200)                    AS under_200,
       ROUND(100.0 * COUNT_IF(AMOUNT < 200) / COUNT(*), 1)            AS pct_under_200,
       ROUND(100.0 * COUNT_IF(AMOUNT BETWEEN 180 AND 199.99) / COUNT(*), 1) AS pct_at_180_199
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION'
  AND REASON    = 'Maids.at other expenses'
  AND AMOUNT    > 0
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
ORDER BY 1;
