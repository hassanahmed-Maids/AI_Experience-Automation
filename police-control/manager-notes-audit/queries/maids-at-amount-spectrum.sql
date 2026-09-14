-- =====================================================================================
-- MAIDS.AT OTHER EXPENSES — every distinct amount paid in the last 12 months,
-- with the identities that raised each one.
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
-- WHO ADDED THEM is aggregated PER AMOUNT, not listed per note, because the question the
-- requester answers here is concentration: is an amount one person's habit or the team's
-- practice? That is the same test that separated a real finding from a producer signature
-- on anti-attrition (8,095 notes, THREE identities, one holding 94.9%).
--   ⚠️ An amount with distinct_requesters = 1 and a high note count is the strongest signal
--      in this query. Maids.at is an EXPENSE-ROUTE type - by config a person raises every
--      request - so a single identity owning a whole amount band is the finding, not the norm.
--   ⚠️ self_approved_notes is a CONTROL column, not a finding. Self-approval was ruled out of
--      scope for this audit (2026-09); it stays visible only so a non-zero count is recognised
--      and discounted rather than rediscovered a fourth time.
--
-- ⚠️ Names STAFF identities. The financials are aggregate and safe to read; the identity
--    column makes the result attribution data - do not forward it on.
--
-- Runs beside queries/maids-at-sample.sql (the stratified read of individual cases).
-- =====================================================================================

WITH mx AS (
    SELECT n.ID                                          AS note_id,
           n.HOUSEMAID_ID,
           n.AMOUNT,
           n.NOTE_DATE,
           n.EXPENSE_ID,
           COALESCE(NULLIF(TRIM(n.REQUESTED_BY), ''),
                    NULLIF(TRIM(x.REQUESTED_BY), ''),
                    '(no requester recorded)')           AS added_by,
           COALESCE(NULLIF(TRIM(n.APPROVED_BY), ''),
                    NULLIF(TRIM(x.APPROVED_BY), ''),
                    '(not approved)')                    AS approved_by
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION'
      AND n.REASON    = 'Maids.at other expenses'
      AND n.AMOUNT    > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), per_amt_req AS (
    SELECT AMOUNT, added_by, COUNT(*) AS n_notes
    FROM mx
    GROUP BY 1, 2
), roster AS (
    SELECT AMOUNT,
           COUNT(DISTINCT added_by)                              AS distinct_requesters,
           MAX_BY(added_by, n_notes)                             AS top_requester,
           MAX(n_notes)                                          AS top_requester_notes,
           ROUND(100.0 * MAX(n_notes) / SUM(n_notes), 1)         AS top_requester_pct,
           LISTAGG(added_by || ' x' || n_notes, '  |  ')
             WITHIN GROUP (ORDER BY n_notes DESC, added_by)      AS added_by_breakdown
    FROM per_amt_req
    GROUP BY AMOUNT
)
SELECT m.AMOUNT                                          AS aed,
       COUNT(*)                                          AS notes,
       COUNT(DISTINCT m.HOUSEMAID_ID)                    AS maids,
       m.AMOUNT * COUNT(*)                               AS total_aed,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_notes,
       MIN(m.NOTE_DATE::DATE)                            AS first_seen,
       MAX(m.NOTE_DATE::DATE)                            AS last_seen,

       -- who added them
       r.distinct_requesters,
       r.top_requester,
       r.top_requester_notes,
       r.top_requester_pct,
       r.added_by_breakdown,
       COUNT(DISTINCT m.approved_by)                     AS distinct_approvers,
       COUNT_IF(m.approved_by = '(not approved)')        AS notes_not_approved,
       COUNT_IF(m.added_by = m.approved_by)              AS self_approved_notes,

       -- shape evidence: a tariff repeats on round values, a reimbursement does not
       IFF(m.AMOUNT = ROUND(m.AMOUNT, 0), 'whole', 'has fils')            AS granularity,
       IFF(MOD(m.AMOUNT, 50) = 0, 'multiple of 50', '')                   AS roundness,
       CASE WHEN m.AMOUNT >= 200 THEN 'above gate'
            WHEN m.AMOUNT >= 180 THEN 'JUST under gate'
            ELSE                      'well under gate'
       END                                               AS vs_approval_gate,
       COUNT(DISTINCT m.EXPENSE_ID)                      AS distinct_requests,
       COUNT_IF(m.EXPENSE_ID IS NULL)                    AS notes_with_no_request
FROM mx m
JOIN roster r ON r.AMOUNT = m.AMOUNT
GROUP BY m.AMOUNT, r.distinct_requesters, r.top_requester, r.top_requester_notes,
         r.top_requester_pct, r.added_by_breakdown
ORDER BY notes DESC, aed DESC;

-- RESULT: (paste here when run)
