-- =====================================================================================
-- BLOCK D — one sweep against every remaining blocker. With the broad grant, most of the
-- outstanding "ingestion asks" and "business asks" may already be data. Find out in two
-- queries rather than eleven SHOW statements.
-- =====================================================================================

-- D0. What databases are actually reachable now? Everything found so far is BA_VIEWS.
SHOW DATABASES;

-- D1. TABLE SWEEP — one row per table, covering every outstanding blocker at once:
--     raffle (N12/O3b), loans (N18), contracts + salary history (N10/N17), picklists (N5),
--     parameters (N8), Envers revision history (N23), HousemaidExtraFields (N24),
--     referrals (N20), manager action logs (A5).
SELECT TABLE_SCHEMA, TABLE_NAME, COUNT(*) AS columns_
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME ILIKE ANY (
        '%RAFFLE%', '%PRIZE%', '%DRAW%',
        '%LOAN%',
        '%CONTRACT%', '%SALARY%',
        '%PICKLIST%', '%PARAMETER%', '%MONTHLYPAYMENT%',
        '%_AUD', '%REVINFO%', '%REVISION%', '%HISTORY%',
        '%EXTRA_FIELD%', '%EXTRAFIELD%',
        '%REFERR%', '%REFERRAL%',
        '%MANAGERACTION%', '%ACTIONLOG%'
      )
GROUP BY 1, 2
ORDER BY 1, 2;

-- D2. COLUMN SWEEP — the specific fields each blocked test needs, wherever they live.
--     INCENTIVE_AMOUNT is A5 (unblocks B4/B5 and the 52 unadjudicable groups);
--     LIVE_OUT is N19; a referrer id is N20; an effective-dated salary is N10.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME ILIKE ANY (
        '%INCENTIVE%',
        '%LIVE_OUT%', '%LIVEOUT%',
        '%REFERR%',
        '%RAFFLE%', '%PRIZE%',
        '%CONTRACT_TYPE%', '%HOUSEMAID_TYPE%',
        '%EFFECTIVE%', '%VALID_FROM%', '%VALID_TO%',
        '%REV%TYPE%'
      )
ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME;

-- D3. N15 EMPIRICALLY — contract type x payment type, observed rather than asked.
--     N15 was a business ask ("which payment types is each contract type allowed?").
--     The data cannot say what is ALLOWED, but it can say what OCCURS, and a cell with
--     one note in a year is a candidate finding rather than a rule.
SELECT COALESCE(h.HOUSEMAID_TYPE, '(unknown)')  AS contract_type,
       COALESCE(n.REASON, '(none)')             AS payment_type,
       COUNT(*)                                 AS notes,
       ROUND(SUM(n.AMOUNT))                     AS aed,
       COUNT(DISTINCT n.HOUSEMAID_ID)           AS maids
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h
       ON h.ID = n.HOUSEMAID_ID
WHERE n.NOTE_TYPE = 'ADDITION'
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1, 2
ORDER BY payment_type, notes DESC;
