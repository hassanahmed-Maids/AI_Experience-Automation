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
-- ⚠️ P1 DISCIPLINE: PURPOSE_ID is not a guess. `full-audit-block-a-discovery.sql` already
-- selects it, and decisions.md records `referral_bonus` as an observed VALUE of it - so the
-- column exists and appears to carry resolved names rather than raw ids. BN1 profiles it
-- before BN2 leans on it.
-- =====================================================================================


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
       CASE WHEN b.days_into_service IS NULL THEN 'BLOCKED - no start date'
            WHEN b.days_into_service <=  60  THEN 'newly joined (0-60d)'
            WHEN b.days_into_service <= 365  THEN '2-12 months in'
            ELSE                                  'over a year in'
       END                                                  AS tenure_band,
       IFF(r.maid_id IS NOT NULL, 'has a referral', 'NO referral') AS referral_side,
       COUNT(*)                                             AS notes,
       COUNT(DISTINCT b.HOUSEMAID_ID)                       AS maids,
       ROUND(SUM(b.AMOUNT))                                 AS aed,
       ROUND(AVG(b.AMOUNT))                                 AS avg_amount
FROM b LEFT JOIN refs r ON r.maid_id = b.HOUSEMAID_ID
GROUP BY 1, 2, 3
ORDER BY aed DESC;
