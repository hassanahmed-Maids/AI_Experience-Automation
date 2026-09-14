-- =====================================================================================
-- Visa Expense Audit — 21 · LAWP reservoir
-- Source spec: SPEC_non_used_lawp_reservoir_v3 (Abdullah Mahdi, 2026-09-12)
--
-- THE CHECK, IN ONE LINE: paperwork bought for a maid who never started goes into a pool.
-- One clock runs from the day the money left and NEVER RESETS. Day 60 closes reuse;
-- day 120 closes the refund window; past 120 it is a loss.
--
-- 🔴 THE TWO GRAINS. Money is counted per PAYMENT, cases per BUNDLE. 232 lost bundles
--    trace to only 202 payments — one maid held FIVE bundles against a single 2023
--    payment. Counting money per bundle is the exact mechanism that made the prior
--    dashboard overstate by 41%. Both numbers are published, side by side, always.
-- =====================================================================================

USE SCHEMA POLICE_CONTROL.VISA_AUDIT;


-- -------------------------------------------------------------------------------------
-- REF_LAWP — the named reference values this check depends on.
-- Each one decides an outcome, so each is a data point with an owner, per the spec's own
-- treatment of reference lists.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW REF_LAWP (KEY, VALUE, VERIFIED, NOTE) AS
SELECT * FROM VALUES
    ('RESERVOIR_TASK', 'Pending Approval on Replacement of Old Employee', TRUE,
     'VERIFIED — 25,751 task rows over 25,668 requests, 2019-04-13 to 2026-09-12'),
    ('FEE_PURPOSE_WORK_PERMIT', 'WORK_PERMIT', TRUE,
     'Named in spec R4: "the CREATION_DATE of the WORK_PERMIT fee"'),
    ('FEE_PURPOSE_MOHRE', 'MOHRE_INSURANCE', FALSE,
     '🔴 UNVERIFIED — to confirm. The spec names the FEE ("MOHRE insurance, AED 189.00") but never quotes the PURPOSE enum value. Run 90_validate.sql check L1 and replace.'),
    ('FEE_PURPOSE_LABOUR_CARD', 'LABOUR_CARD', FALSE,
     '🔴 UNVERIFIED — to confirm. Same as above ("labour card, AED 1,208.57"). 90_validate.sql check L1.'),
    ('MAX_REPLACEMENT_COUNT', '2', FALSE,
     '⚠️ D9 MISSING from the warehouse — @MAX_REPLACEMENT_COUNT@ is an ERP parameter (VPMGOV-985, Frozen). Value 2 today. R10: read it, never hardcode it. Ingestion request outstanding.'),
    ('EXCLUDED_NATIONALITY', '', FALSE,
     '⚠️ D10 MISSING — ERP parameter under SD-58457 (To Do). Alert 945 hardcodes "not Pakistani", which is a LIVE BLIND SPOT in production. This check applies NO nationality exclusion, deliberately.')
AS t(KEY, VALUE, VERIFIED, NOTE);


-- -------------------------------------------------------------------------------------
-- V_LAWP_BUNDLE — R1. A bundle is a reservoir entry: a cancel request carrying the task.
-- R16: one row per reservoir EPISODE; period membership on the LATEST entry.
-- 68 bundles carry multiple task rows and 31 re-entered in a different month.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_LAWP_BUNDLE AS
SELECT
    c.REQUEST_ID                            AS BUNDLE_ID,
    c.MAID_ID                               AS HOLDER_MAID_ID,
    c.RELATED_MAID_ID                       AS RELATED_MAID_ID,
    c.NEW_REQUEST_ID                        AS NEW_REQUEST_ID,
    MAX(CAST(tk.STARTED_AT AS DATE))        AS ENTERED_POOL_DATE,    -- R16: the LATEST entry
    MIN(CAST(tk.STARTED_AT AS DATE))        AS FIRST_ENTERED_DATE,
    MAX(CAST(tk.COMPLETED_AT AS DATE))      AS LEFT_POOL_DATE,
    COUNT(*)                                AS RESERVOIR_TASK_ROWS   -- >1 = re-entry episode
FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS_TASKS tk
JOIN BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS c
  ON c.REQUEST_ID = tk.VISA_REQUEST_ID
WHERE tk.TASK_NAME = (SELECT VALUE FROM REF_LAWP WHERE KEY = 'RESERVOIR_TASK')
GROUP BY c.REQUEST_ID, c.MAID_ID, c.RELATED_MAID_ID, c.NEW_REQUEST_ID;


-- -------------------------------------------------------------------------------------
-- V_LAWP_PAYING_REQUEST — R3. The money belongs to whoever PAID.
--
--   WORK_PERMIT_TYPE = 'QUOTA'       -> the holder's own request is the payer.
--   WORK_PERMIT_TYPE = 'REPLACEMENT' -> walk LINKED_REPLACEMENT_ID UPWARD, recursively,
--                                       to the first QUOTA request.
--
-- ⚠️ ONE HOP IS NOT ENOUGH: 599 of 6,085 REPLACEMENT bundles (9.8%) land on a request
--    that is ITSELF a REPLACEMENT. Reading the holder of an inherited bundle returns zero.
--
-- 🔴 LINKED_REPLACEMENT_ID RESOLVES AGAINST TWO TABLES and the wrong join silently
--    succeeds every time. It points at CANCEL_VISA_REQUESTS.REQUEST_ID (22,862/22,862 =
--    100%) and ALSO matches INITIAL_VISA_REQUESTS.REQUEST_ID on 97.6%. Join to
--    CANCEL_VISA_REQUESTS, matching the ERP source (NewRequest.linkedReplacement ->
--    CancelRequest).
--
-- 🔴 THE ONE INFERRED HOP IN THIS FILE. Going upward needs cancel-request -> prior
--    holder's initial request, and the spec names no column for it. It is resolved here
--    through CANCEL_VISA_REQUESTS.MAID_ID. VALIDATION: the spec measured that 9.8% of
--    REPLACEMENT bundles land on another REPLACEMENT. If this implementation does not
--    reproduce ~9.8% (90_validate.sql check L2), the hop is wrong — do not ship it.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_LAWP_PAYING_REQUEST AS
WITH RECURSIVE holder AS (
    SELECT
        b.BUNDLE_ID,
        b.HOLDER_MAID_ID,
        ivr.REQUEST_ID                      AS CURRENT_REQUEST_ID,
        ivr.WORK_PERMIT_TYPE                AS CURRENT_WP_TYPE,
        ivr.LINKED_REPLACEMENT_ID           AS NEXT_BUNDLE_ID,
        0                                   AS HOPS
    FROM V_LAWP_BUNDLE b
    JOIN BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS ivr
      ON ivr.REQUEST_ID = b.NEW_REQUEST_ID          -- the request that took this bundle
    UNION ALL
    SELECT
        h.BUNDLE_ID,
        h.HOLDER_MAID_ID,
        up.REQUEST_ID,
        up.WORK_PERMIT_TYPE,
        up.LINKED_REPLACEMENT_ID,
        h.HOPS + 1
    FROM holder h
    JOIN BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS cprev
      ON cprev.REQUEST_ID = h.NEXT_BUNDLE_ID        -- 🔴 to CANCEL, never to INITIAL
    JOIN BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS up
      ON up.REQUEST_ID = cprev.NEW_REQUEST_ID       -- ⚠️ the inferred hop — see header
    WHERE UPPER(TRIM(h.CURRENT_WP_TYPE)) = 'REPLACEMENT'
      AND h.HOPS < TRY_TO_NUMBER((SELECT VALUE FROM REF_LAWP WHERE KEY='MAX_REPLACEMENT_COUNT'))
)
SELECT
    BUNDLE_ID,
    HOLDER_MAID_ID,
    CURRENT_REQUEST_ID                      AS PAYING_REQUEST_ID,
    CURRENT_WP_TYPE                         AS PAYING_WORK_PERMIT_TYPE,
    HOPS                                    AS REPLACEMENT_HOPS,
    -- Bounded out before reaching a QUOTA request: reported, never silently attributed.
    (UPPER(TRIM(CURRENT_WP_TYPE)) = 'REPLACEMENT') AS WALK_INCOMPLETE
FROM holder
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY BUNDLE_ID
    ORDER BY CASE WHEN UPPER(TRIM(CURRENT_WP_TYPE)) = 'QUOTA' THEN 0 ELSE 1 END,
             HOPS DESC
) = 1;


-- -------------------------------------------------------------------------------------
-- V_LAWP_PAYMENT_FEES — R7. The loss is the sum of the fees ACTUALLY ON RECORD.
--
-- R9: STATUS = 'Added' AND REQUEST_TYPE = 'NewRequest'; exclude OFFICE_STAFF and blank
--     owner (1,691 and 33 rows respectively on this slice).
--     14,670 of 183,555 paid three-fee rows fail the REQUEST_TYPE test.
-- ⚠️ Fees MUST be scoped to the REQUEST. Summing a maid's fee rows picks up every visa
--    cycle she ever had — measured AED 3,188 per bundle, more than double a real one.
-- ⚠️ AMOUNT guard 0.01–5000: the table holds trillion-dirham corruption on other
--    purposes (RESIDENCE_CANCELLATION sums to AED 1.59 trillion). Costs exactly one row here.
-- ⚠️ PAYMENT_DATE is unusable (NULL on 99.1% of work-permit rows). CREATION_DATE is NULL
--    on zero. Anchor the clock on CREATION_DATE.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_LAWP_PAYMENT_FEES AS
SELECT
    e.VISA_REQUEST_ID                       AS PAYING_REQUEST_ID,
    SUM(e.AMOUNT)                           AS FEES_ON_RECORD_AED,
    COUNT(*)                                AS FEE_LINES,
    MAX(CASE WHEN e.PURPOSE = (SELECT VALUE FROM REF_LAWP WHERE KEY='FEE_PURPOSE_WORK_PERMIT')
             THEN CAST(e.CREATION_DATE AS DATE) END)            AS WORK_PERMIT_PAID_DATE,
    BOOLOR_AGG(e.PURPOSE = (SELECT VALUE FROM REF_LAWP WHERE KEY='FEE_PURPOSE_WORK_PERMIT'))   AS HAS_WORK_PERMIT,
    BOOLOR_AGG(e.PURPOSE = (SELECT VALUE FROM REF_LAWP WHERE KEY='FEE_PURPOSE_MOHRE'))         AS HAS_MOHRE,
    BOOLOR_AGG(e.PURPOSE = (SELECT VALUE FROM REF_LAWP WHERE KEY='FEE_PURPOSE_LABOUR_CARD'))   AS HAS_LABOUR_CARD
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
WHERE e.PURPOSE IN (SELECT VALUE FROM REF_LAWP WHERE KEY LIKE 'FEE_PURPOSE_%')
  AND e.STATUS       = 'Added'              -- R9. Dismissed (1,226 rows) routes to M8, never netted.
  AND e.REQUEST_TYPE = 'NewRequest'         -- R9
  AND e.OWNER_TYPE   = 'HOUSEMAID'          -- excludes 1,691 OFFICE_STAFF and 33 blank-owner rows
  AND e.AMOUNT BETWEEN 0.01 AND 5000        -- the corruption guard
GROUP BY e.VISA_REQUEST_ID;


-- -------------------------------------------------------------------------------------
-- V_LAWP_REUSE — R2 and R17.
--   R2  ANY reuse clears the payment PERMANENTLY, whether the new maid arrived or not.
--       ("if reused clear anyway, even if cancelled later" — Abdullah Mahdi, 2026-09-12.)
--       This deliberately excludes reused-then-cancelled, AED 424,005 in the measured
--       window. The exclusion is reported as its own line so its size stays visible.
--   R17 A permit CONSUMED by a maid who arrived (entry visa issued AND used) is terminal.
--       D7: ENTRY_VISA_ISSUANCE_DATE is populated on 17,248 of 22,805 reuse events (75.6%)
--       and HOUSEMAIDS_INFO.STATUS on 100% — both are read.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_LAWP_REUSE AS
SELECT
    ivr.LINKED_REPLACEMENT_ID               AS BUNDLE_ID,
    MAX(CAST(ivr.ENTRY_VISA_ISSUANCE_DATE AS DATE)) AS TAKER_ENTRY_VISA_DATE,
    BOOLOR_AGG(ivr.ENTRY_VISA_ISSUANCE_DATE IS NOT NULL) AS TAKER_ARRIVED,
    COUNT(*)                                AS REUSE_LINKS          -- 91 bundles carry 188 links
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS ivr
WHERE ivr.LINKED_REPLACEMENT_ID IS NOT NULL
GROUP BY ivr.LINKED_REPLACEMENT_ID;


-- -------------------------------------------------------------------------------------
-- V_CASES_LAWP — the case table the tab renders. One row per BUNDLE (the worklist grain).
-- Money is attributed to the PAYMENT and is carried on ONE bundle per payment only, so a
-- naive SUM over this view cannot double-count. (R8.)
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_CASES_LAWP AS
WITH base AS (
    SELECT
        b.BUNDLE_ID,
        b.HOLDER_MAID_ID,
        b.RELATED_MAID_ID,
        b.ENTERED_POOL_DATE,
        b.RESERVOIR_TASK_ROWS,
        p.PAYING_REQUEST_ID,
        p.PAYING_WORK_PERMIT_TYPE,
        p.REPLACEMENT_HOPS,
        p.WALK_INCOMPLETE,
        f.FEES_ON_RECORD_AED,
        f.FEE_LINES,
        f.HAS_WORK_PERMIT,
        f.HAS_MOHRE,
        f.HAS_LABOUR_CARD,
        -- R4: the clock starts at the WORK_PERMIT fee's CREATION_DATE on the PAYING
        -- request and NEVER resets. Where no work-permit fee exists, the earliest
        -- reservoir entry for that payment.
        COALESCE(f.WORK_PERMIT_PAID_DATE, b.FIRST_ENTERED_DATE) AS CLOCK_START_DATE,
        (f.WORK_PERMIT_PAID_DATE IS NULL)   AS CLOCK_IS_FALLBACK,
        r.TAKER_ARRIVED,
        r.REUSE_LINKS,
        (r.BUNDLE_ID IS NOT NULL)           AS WAS_REUSED,
        m.CONTRACT_TYPE,
        m.NATIONALITY,
        m.HOUSEMAID_TYPE,
        m.MAID_STATUS
    FROM V_LAWP_BUNDLE b
    LEFT JOIN V_LAWP_PAYING_REQUEST p ON p.BUNDLE_ID = b.BUNDLE_ID
    LEFT JOIN V_LAWP_PAYMENT_FEES   f ON f.PAYING_REQUEST_ID = p.PAYING_REQUEST_ID
    LEFT JOIN V_LAWP_REUSE          r ON r.BUNDLE_ID = b.BUNDLE_ID
    LEFT JOIN DIM_MAID              m ON m.MAID_ID = b.HOLDER_MAID_ID   -- R14: from the HOLDER
), scored AS (
    SELECT
        base.*,
        DATEDIFF('day', CLOCK_START_DATE, CURRENT_DATE())   AS AGE_DAYS,
        DATEADD('day', 120, CLOCK_START_DATE)               AS LOST_ON_DATE,
        DATEADD('day',  60, CLOCK_START_DATE)               AS REUSE_CLOSES_DATE,
        -- R13: RELATED_MAID_ID and the reuse link disagree. Report it as its own class;
        -- do NOT pick a winner. 60 bundles all-time, one-directional.
        (RELATED_MAID_ID IS NULL AND WAS_REUSED)            AS ALERT_DISAGREEMENT,
        -- R8: money is carried on ONE bundle per payment, so SUM over this view is safe.
        (ROW_NUMBER() OVER (PARTITION BY PAYING_REQUEST_ID
                            ORDER BY ENTERED_POOL_DATE, BUNDLE_ID) = 1) AS IS_MONEY_BEARING_BUNDLE
    FROM base
)
SELECT
    'LAWP'                                  AS AUDIT_CODE,
    TO_VARCHAR(BUNDLE_ID)                   AS CASE_ID,
    'bundle'                                AS CASE_GRAIN,
    BUNDLE_ID,
    PAYING_REQUEST_ID,
    HOLDER_MAID_ID                          AS MAID_ID,
    COALESCE(CONTRACT_TYPE,'UNKNOWN')       AS CONTRACT_TYPE,
    NATIONALITY,
    HOUSEMAID_TYPE,
    MAID_STATUS,
    PAYING_WORK_PERMIT_TYPE,
    REPLACEMENT_HOPS,
    CLOCK_START_DATE,
    CLOCK_IS_FALLBACK,
    ENTERED_POOL_DATE,
    REUSE_CLOSES_DATE,
    LOST_ON_DATE,
    AGE_DAYS,
    RESERVOIR_TASK_ROWS,
    REUSE_LINKS,
    FEE_LINES,
    HAS_WORK_PERMIT, HAS_MOHRE, HAS_LABOUR_CARD,
    (NOT COALESCE(HAS_WORK_PERMIT,FALSE)
     OR NOT COALESCE(HAS_MOHRE,FALSE)
     OR NOT COALESCE(HAS_LABOUR_CARD,FALSE)) AS IS_PARTIAL_BUNDLE,
    ALERT_DISAGREEMENT,
    WALK_INCOMPLETE,
    IS_MONEY_BEARING_BUNDLE,

    -- ---- outcome: the five classes of §4, in the order the spec evaluates them --------
    CASE
        WHEN FEES_ON_RECORD_AED IS NULL          THEN 'NO_FEE_ON_RECORD'   -- R12/M8
        WHEN WAS_REUSED AND TAKER_ARRIVED        THEN 'CONSUMED'           -- M2 / R17
        WHEN WAS_REUSED                          THEN 'CLEARED_BY_REUSE'   -- M3 / R2
        WHEN AGE_DAYS <  60                      THEN 'UNDER_60_DAYS'      -- M4
        WHEN AGE_DAYS < 120                      THEN 'RECOVERABLE'        -- M5 / R5
        ELSE                                          'LOST'               -- M6 / R6
    END                                     AS OUTCOME,

    CASE
        WHEN FEES_ON_RECORD_AED IS NULL          THEN 'M8'
        WHEN WAS_REUSED AND TAKER_ARRIVED        THEN 'M2'
        WHEN WAS_REUSED                          THEN 'M3'
        WHEN AGE_DAYS <  60                      THEN 'M4'
        WHEN AGE_DAYS < 120                      THEN 'M5'
        ELSE                                          'M6'
    END                                     AS RULE_ID,

    CASE
        WHEN FEES_ON_RECORD_AED IS NULL          THEN 'No fee on record — never written off, never cleared'
        WHEN WAS_REUSED AND TAKER_ARRIVED        THEN 'Consumed — reused and the new maid arrived'
        WHEN WAS_REUSED                          THEN 'Cleared by reuse — the taker never arrived'
        WHEN AGE_DAYS <  60                      THEN 'Under 60 days — can still be given to another maid'
        WHEN AGE_DAYS < 120                      THEN 'Recoverable — too late to reuse, claim the refund now'
        ELSE                                          'Lost — never reused, past 120 days'
    END                                     AS RULE_NAME,

    -- ---- flag. Grey is a finding about ourselves, never folded into clean. ------------
    CASE
        WHEN FEES_ON_RECORD_AED IS NULL OR WALK_INCOMPLETE THEN 'GREY'
        WHEN WAS_REUSED                                    THEN 'GREEN'
        WHEN AGE_DAYS >= 120                               THEN 'RED'
        WHEN AGE_DAYS >=  60                               THEN 'AMBER'
        ELSE                                                    'GREEN'
    END                                     AS FLAG,

    CASE
        WHEN FEES_ON_RECORD_AED IS NULL OR WALK_INCOMPLETE THEN 'UNREADABLE'
        WHEN WAS_REUSED                                    THEN 'CLEAN'
        WHEN AGE_DAYS >= 120                               THEN 'ACTION'
        WHEN AGE_DAYS >=  60                               THEN 'HOLD'
        ELSE                                                    'CLEAN'
    END                                     AS FLAG_LABEL,

    CASE
        WHEN FEES_ON_RECORD_AED IS NULL OR WALK_INCOMPLETE THEN 'UNVALUED'
        WHEN WAS_REUSED                                    THEN 'NOT_A_FINDING'
        WHEN AGE_DAYS >= 120                               THEN 'LOST'
        WHEN AGE_DAYS >=  60                               THEN 'RECOVERABLE'
        ELSE                                                    'NOT_A_FINDING'
    END                                     AS EXPOSURE_CLASS,

    CASE
        WHEN AGE_DAYS BETWEEN 60 AND 119 AND NOT WAS_REUSED THEN 'Visa team'
        WHEN AGE_DAYS >= 120 AND NOT WAS_REUSED             THEN 'P&C'
        WHEN FEES_ON_RECORD_AED IS NULL                     THEN 'P&C'
        ELSE NULL
    END                                     AS ACTION_OWNER,

    CASE
        WHEN AGE_DAYS BETWEEN 60 AND 119 AND NOT WAS_REUSED
             THEN 'Claim the refund now — the window closes on ' || TO_VARCHAR(LOST_ON_DATE)
        WHEN AGE_DAYS >= 120 AND NOT WAS_REUSED
             THEN 'Count the loss and ask why it was missed'
        WHEN FEES_ON_RECORD_AED IS NULL
             THEN 'Either genuinely never bought, or a missing record. Both need a person.'
        ELSE NULL
    END                                     AS ACTION_TEXT,

    -- ---- money. R7 + R8: actual fees, carried on one bundle per payment only. ---------
    CASE WHEN IS_MONEY_BEARING_BUNDLE
              AND FEES_ON_RECORD_AED IS NOT NULL
              AND NOT WAS_REUSED
              AND AGE_DAYS >= 60
         THEN FEES_ON_RECORD_AED END        AS AMOUNT_AED,
    (FEES_ON_RECORD_AED IS NOT NULL)        AS AMOUNT_IS_VALUED,
    FEES_ON_RECORD_AED                      AS FEES_ON_RECORD_AED,
    'COMPANY'                               AS WHO_IS_OUT_OF_POCKET,
    CLOCK_START_DATE                        AS ANCHOR_DATE,
    'work-permit fee CREATION_DATE on the paying request (never resets)' AS ANCHOR_DATE_MEANING,
    LOST_ON_DATE                            AS DEADLINE_DATE
FROM scored;
