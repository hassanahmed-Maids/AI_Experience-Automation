-- =====================================================================================
-- BONUS TAXONOMY — from ask-the-code 46023 (2026-09-09).
--
-- THE QUESTION WAS "is there a third kind of bonus?" THE ANSWER IS YES, AND MORE:
--   1. Referral bonus      -> HousemaidReferralService / ReferralBonusesManagerJob.
--                             Sets purpose = referral_bonus EXPLICITLY.
--   2. Signing bonus       -> AddSigningBonusAction -> syncSigningBonus().
--                             Sets noteReasone = "Singing Bonus" but NO purpose picklist item.
--   3. Retracting-resignation one-time bonus  <- THE THIRD KIND.
--                             DelighterService -> expense request -> processExpenseRequestTodo().
--                             purpose = resignation_retraction. Deprecated and gated on a
--                             DISABLED expense code, but the controller case is still live.
--   4. ...and the set is OPEN-ENDED: any Bonus-typed expense head paid via SALARY becomes a
--      'bonus' note, with purpose taken from the HousemaidPurposesForBonusAdditionalDescription
--      picklist. The CLASSIFICATION is picklist-controlled; only the narrative is free text.
--
-- WHY THIS MATTERS MORE THAN ANY OTHER OPEN QUERY: four bonus candidates totalling
-- **AED 274,260** have been sitting unresolved because the audit could not tell one kind of
-- bonus from another and was inferring it from AMOUNT and TENURE.
--   AED 143,965  bonus at referral rates, no referral, >1yr into service
--   AED  70,895  referral exists but no bonus request
--   AED  42,900  6-12 months into service, no referral - "genuinely ambiguous"
--   AED  16,500  referrer has bonuses but none on that date
-- PURPOSE_ID answers directly what those four were triangulating at.
--
-- 🔴🔴 BN1/BN2 FAILED 2026-09-09: `invalid identifier 'N.PURPOSE_ID'`. THE COLUMN DOES NOT
--    EXIST ON THIS VIEW, AND THE HEADER THAT USED TO SIT HERE SAID "PURPOSE_ID is not a guess".
--    It was a guess. The citation was `full-audit-block-a-discovery.sql`, whose line 16 reads:
--        "A3. The raw payroll manager-notes table -- carries N1-N6 (... PURPOSE_ID ...).
--         If this is now visible, six outstanding ingestion asks collapse at once."
--    That is a list of columns on the RAW ERP TABLE, written as an INGESTION ASK -- a wish list,
--    checking whether the table had become visible. It is not a schema for
--    HOUSEMAID_MANAGER_NOTES and never claimed to be. I read my own open request as settled
--    evidence, then wrote "not a guess" on top of it.
--
--    ⚠️ CONSEQUENCE FOR GROUP C: **the bonus taxonomy cannot be resolved by query at all.**
--    Ask-the-code 46023 established that purpose is the ONLY thing separating referral, signing
--    and retracting-resignation bonuses (signing sets no purpose; the classification is
--    picklist-controlled). If PURPOSE_ID is not in the warehouse then AED 274,260 of bonus
--    candidates are blocked on an INGESTION, not on a better query -- and every amount-and-
--    tenure proxy the audit built for them is a workaround for a missing column, not a test.
--
--    🟡 BN0 DID RUN, and it found the time window matters more here than anywhere yet:
--        older than the 12m window ... 3,333 notes · AED 1,992,552 · from 2018-02-25
--        inside the window .......... 1,131 notes · AED   849,316
--        future-dated ...............     3 notes · AED     2,000
--    **70% of every bonus dirham ever paid sits outside the audit window** -- 2.3x what has been
--    examined. Unlike airfare's future-dated hole this one is known in principle, but it had
--    never been priced for a single payment type until now.
-- =====================================================================================


-- BN-FIX. THE QUERY THAT SHOULD HAVE OPENED THIS FILE. Every column on the notes view, so the
--         next person reads the schema instead of inferring it. Small, and it settles which of
--         N1-N6 actually landed.
SELECT COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'HOUSEMAID_MANAGEMENT_SILVER'
  AND TABLE_NAME   = 'HOUSEMAID_MANAGER_NOTES'
ORDER BY ORDINAL_POSITION;


-- BN-FIX2. IS THE RAW TABLE VISIBLE ANYWHERE? If `payrollmanagernotes`, or any view carrying a
--          purpose / addition-reason id, has been ingested since block A ran, group C unblocks
--          with no new request. Sweeps by COLUMN as well as by table name, since the raw table
--          may have been exposed under a different one.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME ILIKE '%PURPOSE%'
   OR COLUMN_NAME ILIKE '%ADDITION_REASON%'
   OR TABLE_NAME  ILIKE '%MANAGER_NOTE%'
   OR TABLE_NAME  ILIKE '%MANAGERNOTE%'
ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME;
-- =====================================================================================


-- ⚠️ REVISED 2026-09-09, AFTER THE AIRFARE ROUND. Three things learned since these were
--    drafted apply here and are folded in below:
--    (a) E10c — every test in this audit carries `NOTE_DATE <= CURRENT_DATE()`, and on airfare
--        that filter turned out to hide 216 notes / AED 385,000 that nothing had ever examined.
--        BN0 counts what it hides for Bonus BEFORE BN1/BN2 apply it.
--    (b) E10 — `HOUSEMAIDS_INFO.START_DATE` is CURRENT state. If it is overwritten when a maid
--        starts a new contract, "days into service" is measured from the wrong anchor, and that
--        is the proxy the AED 143,965 finding rests on. BN2 now carries a SECOND tenure measure
--        from the status log beside it, so the two can disagree visibly instead of silently.
--    (c) The notes view has exactly ONE timestamp (`NOTE_DATE`, AF1), so there is no note
--        creation date to fall back on. The two tenure anchors below are all there is.


-- BN0. WHAT DOES THE STANDING FILTER HIDE? One small query, run first. On airfare the same
--      question found AED 385,000 nobody had looked at.
SELECT CASE WHEN NOTE_DATE > CURRENT_DATE()                              THEN 'FUTURE-dated'
            WHEN NOTE_DATE < DATEADD('month', -12, CURRENT_DATE())       THEN 'older than the window'
            ELSE                                                              'inside the 12m window'
       END                              AS dating,
       COUNT(*)                         AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)     AS maids,
       ROUND(SUM(AMOUNT))               AS aed,
       MIN(NOTE_DATE)::DATE             AS earliest,
       MAX(NOTE_DATE)::DATE             AS latest
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Bonus' AND AMOUNT > 0
GROUP BY 1
ORDER BY notes DESC;


-- BN1. 🔴 THE TAXONOMY, AT LAST. One row per purpose value, with the two signals the audit
--      has been using as PROXIES for purpose sitting beside it - so their agreement (or
--      disagreement) with the real classification is visible in the same result.
--      Expect: referral_bonus with a high referral rate and avg ~866; an unset-purpose group
--      splitting into signing (near joining, avg ~500) and something else; and possibly
--      purpose values nobody has seen, because the set is open-ended.
WITH b AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.AMOUNT,
           COALESCE(n.PURPOSE_ID::STRING, '(no purpose set)') AS purpose,
           DATEDIFF('day', h.START_DATE::DATE, n.NOTE_DATE::DATE) AS days_into_service
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Bonus' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), refs AS (
    SELECT REFERRING_MAID_ID AS maid_id, COUNT(*) AS referrals
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_JOINERS_INFO
    WHERE REFERRING_MAID_ID IS NOT NULL
    GROUP BY 1
)
SELECT b.purpose,
       COUNT(*)                                            AS notes,
       COUNT(DISTINCT b.HOUSEMAID_ID)                      AS maids,
       ROUND(SUM(b.AMOUNT))                                AS aed,
       ROUND(AVG(b.AMOUNT))                                AS avg_amount,
       ROUND(MEDIAN(b.days_into_service))                  AS median_days_into_service,
       COUNT_IF(r.maid_id IS NOT NULL)                     AS maid_has_a_referral,
       ROUND(100.0 * COUNT_IF(r.maid_id IS NOT NULL) / COUNT(*), 1) AS pct_with_referral,
       COUNT_IF(b.days_into_service <= 60)                 AS within_60d_of_joining
FROM b LEFT JOIN refs r ON r.maid_id = b.HOUSEMAID_ID
GROUP BY 1
ORDER BY aed DESC;


-- BN2. 🔴 THE AED 143,965 FINDING, RE-ASKED THE RIGHT WAY. It was built on two proxies -
--      "no referral on record" and "median 765 days into service" - because purpose was
--      unavailable. Now it can be asked directly: of the bonus notes with NO purpose set
--      (which the code says is the signing-bonus signature), how many went to a maid who was
--      NOT newly joined and had NO referral? That population is the finding, stated on the
--      classification the code actually uses instead of on its shadow.
--      A signing bonus paid 765 days into service is not a signing bonus.
WITH b AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.AMOUNT, n.NOTE_DATE::DATE AS note_day,
           COALESCE(n.PURPOSE_ID::STRING, '(no purpose set)') AS purpose,
           DATEDIFF('day', h.START_DATE::DATE, n.NOTE_DATE::DATE) AS days_into_service
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Bonus' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), refs AS (
    SELECT REFERRING_MAID_ID AS maid_id, COUNT(*) AS referrals
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_JOINERS_INFO
    WHERE REFERRING_MAID_ID IS NOT NULL
    GROUP BY 1
), first_seen AS (
    -- second, independent tenure anchor: the maid's earliest status transition. START_DATE is
    -- current state and may be overwritten on a new contract; this cannot be.
    SELECT HOUSEMAID_ID, MIN(CHANGE_DATE)::DATE AS first_status_day
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS
    GROUP BY 1
)
SELECT b.purpose,
       CASE WHEN b.days_into_service IS NULL THEN 'BLOCKED - no start date'
            WHEN b.days_into_service <=  60  THEN 'newly joined (0-60d)'
            WHEN b.days_into_service <= 365  THEN '2-12 months in'
            ELSE                                  'over a year in'
       END                                                  AS tenure_band,
       IFF(r.maid_id IS NOT NULL, 'has a referral', 'NO referral') AS referral_side,
       COUNT(*)                                             AS notes,
       COUNT(DISTINCT b.HOUSEMAID_ID)                       AS maids,
       ROUND(SUM(b.AMOUNT))                                 AS aed,
       ROUND(AVG(b.AMOUNT))                                 AS avg_amount,
       -- THE SELF-DIAGNOSTIC: the same tenure measured from the status log. If these two
       -- disagree materially the START_DATE anchor is unsound and the band above is fiction.
       ROUND(MEDIAN(DATEDIFF('day', f.first_status_day, b.note_day))) AS median_days_by_status_log,
       COUNT_IF(ABS(b.days_into_service
                    - DATEDIFF('day', f.first_status_day, b.note_day)) > 90) AS anchors_disagree_over_90d
FROM b
LEFT JOIN refs r ON r.maid_id = b.HOUSEMAID_ID
LEFT JOIN first_seen f ON f.HOUSEMAID_ID = b.HOUSEMAID_ID
GROUP BY 1, 2, 3
ORDER BY aed DESC;
