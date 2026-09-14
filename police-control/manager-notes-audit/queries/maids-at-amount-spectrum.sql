-- =====================================================================================
-- MAIDS.AT OTHER EXPENSES — every distinct amount paid in the last 12 months.
--
-- PURPOSE: shape evidence for K1 (what is this payment FOR?). The audit has no rule to
-- test this type against, so the distribution of amounts is the evidence available.
--   * a REIMBURSEMENT produces scattered, odd amounts - you pay back what a receipt says.
--     Then the only control is the invoice, and `no invoice` in maids-at-sample.sql is the
--     finding, not the amount.
--   * a TARIFF produces a handful of repeated round values. That rate is a testable rule,
--     and it is the outcome that gives this type an entitlement test at last.
--   * a CLUSTER at 180-199 is structuring against the AED 200 approval gate - a control
--     finding on its own, whatever the money is for.
--
-- Runs beside queries/maids-at-sample.sql (the stratified read of individual cases).
-- No names, no free text: this one is safe to read in a chat. The sample query is not.
-- =====================================================================================

SELECT n.AMOUNT                                          AS aed,
       COUNT(*)                                          AS notes,
       COUNT(DISTINCT n.HOUSEMAID_ID)                    AS maids,
       n.AMOUNT * COUNT(*)                               AS total_aed,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_notes,
       MIN(n.NOTE_DATE::DATE)                            AS first_seen,
       MAX(n.NOTE_DATE::DATE)                            AS last_seen,
       -- shape evidence: a tariff repeats on round values, a reimbursement does not
       IFF(n.AMOUNT = ROUND(n.AMOUNT, 0), 'whole', 'has fils')            AS granularity,
       IFF(MOD(n.AMOUNT, 50) = 0, 'multiple of 50', '')                   AS roundness,
       -- where it sits relative to the AED 200 approval gate
       CASE WHEN n.AMOUNT >= 200 THEN 'above gate'
            WHEN n.AMOUNT >= 180 THEN 'JUST under gate'
            ELSE                      'well under gate'
       END                                               AS vs_approval_gate,
       COUNT(DISTINCT n.EXPENSE_ID)                      AS distinct_requests,
       COUNT_IF(n.EXPENSE_ID IS NULL)                    AS notes_with_no_request
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
WHERE n.NOTE_TYPE = 'ADDITION'
  AND n.REASON    = 'Maids.at other expenses'
  AND n.AMOUNT    > 0
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
  AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY n.AMOUNT
ORDER BY notes DESC, aed DESC;

-- RESULT: (paste here when run)
