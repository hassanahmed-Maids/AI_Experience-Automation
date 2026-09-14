-- =====================================================================================
-- Visa Expense Audit — 22 · Entry visa refund control
-- Source spec: SPEC_entry_visa_audit_v1 (Abdullah Mahdi, 2026-09-12)
--
-- TWO FINDINGS, AND THEY ARE NEVER ADDED TOGETHER (M6):
--   M2  a turned-down application whose refund never came back — there IS a route to
--       claim it, so this is the actionable money.
--   M3  the fee paid twice with neither a turn-down nor a refund behind it — nothing was
--       refused, so no refund is owed and there is no route. This one tells you where
--       the process leaks, not where the money is.
--
-- The four things that will silently give the wrong answer, all implemented below:
--   1. Date by the APPLICATION clock. The posting clock loses 257 of 913 turn-down
--      charges — 28% — and scrambles the order of events.
--   2. The history table is a CHANGE LOG. Of 3,277 rows reading `Rejected`, only 713 are
--      the actual decision. Without `_MODIFIED = 1`, 515 of 723 requests look rejected
--      two or more times, one of them fourteen times.
--   3. `Rejected` is NOT the only turn-down and not even the biggest one.
--      `E_Visa_Need_Sponser_Visit` refunds at 77.5% against `Rejected`'s 86.2%, on MORE
--      requests — and 100 of the 116 unclaimed refunds sit in it. Counting `Rejected`
--      alone finds 16 of them. 86% of the collectable money is in the value a first
--      draft ignored.
--   4. Read refund amounts from TRANSACTIONS, never from VISAREQUESTEXPENSES.AMOUNT.
--      The expense ledger is net of VAT and holds two rows with the SIGN REVERSED;
--      classifying off it moved the unclaimed count from 216 to 511.
-- =====================================================================================

USE SCHEMA POLICE_CONTROL.VISA_AUDIT;


CREATE OR REPLACE VIEW REF_ENTRY_VISA (KEY, VALUE, NOTE) AS
SELECT * FROM VALUES
    ('PURPOSE_CHARGE_1', 'ENTRY_VSIA',
     '🔴 SPELLED WRONG IN THE LIVE SYSTEM and must stay wrong here. `ENTRY_VISA` returns nothing.'),
    ('PURPOSE_CHARGE_2', 'ENTRY_VISA_LESS_THAN_1000', 'the second entry visa purpose'),
    ('PURPOSE_REFUND',   'REFUND_FOR_ENTRY_VISA',     'the refund claim line'),
    ('TURNDOWN_1',       'Rejected',                  '661 requests, 86.2% refunded'),
    ('TURNDOWN_2',       'E_Visa_Need_Sponser_Visit', '831 requests, 77.5% refunded — carries most of the money'),
    ('HOLD_DAYS',        '60',
     '⚠️ OPERATIONAL CHOICE, not an observed maximum. 46 claims filed 31–60 days after the turn-down were PAID, and 2 past 60 days, the latest at 210. Open item O2.'),
    ('AUDIT_START',      '2025-09-05',
     'the first day the ERP records a dated immigration rejection. Nothing earlier can be audited (O4).')
AS t(KEY, VALUE, NOTE);
-- ⚠️ OPEN ITEM O7, deliberately NOT applied: `Active_Visa` (169 requests, 30.2% refunded)
--    and `Another_Issue` (499, 18.0%) refund well above the 2.6% approved baseline and
--    are plausibly refusals. They are NOT counted as turn-downs here. The Visa team must
--    rule; including them widens M1 again. Worked example C sits on this open value.


-- -------------------------------------------------------------------------------------
-- M0 — the charges we audit. 14,597 charges / 13,995 maids / AED 12,413,890.03.
-- ⚠️ The AED figure must be summed over the same APPLICATION-dated window as the counts.
--    Over the posting-date window it reads AED 12,487,712.56 across 14,693 charges — the
--    error trap 1 exists to prevent.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_EV_CHARGE AS
SELECT
    l.VISA_REQUEST_ID,
    l.TRANSACTION_ID                        AS CHARGE_TXN_ID,
    l.OWNER_MAID_ID                         AS MAID_ID,
    l.CONTRACT_TYPE,
    l.APPLICATION_DATE,
    l.APPLICATION_TS,
    l.POSTING_DATE,
    l.PAID_AMOUNT,
    l.MAID_ID_DISAGREES,
    -- 🔴 Inside or outside country comes from the WORDING, never from the price. The price
    --    changes every few months; the wording does not. The wording exists from
    --    2025-07-07, before the audit period starts. DESCRIPTION is a PREDICATE here and
    --    is never projected.
    CASE WHEN t.DESCRIPTION ILIKE '%Entry Visa > 1000 AED%' THEN 'INSIDE'
         WHEN t.DESCRIPTION ILIKE '%Entry Visa < 1000 AED%' THEN 'OUTSIDE'
         ELSE 'UNKNOWN' END                 AS VISA_BAND
FROM V_VISA_EXPENSE_LINE l
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t ON t.ID = l.TRANSACTION_ID
WHERE l.PURPOSE IN (SELECT VALUE FROM REF_ENTRY_VISA WHERE KEY LIKE 'PURPOSE_CHARGE_%')
  AND l.LINE_STATUS    = 'Added'
  AND l.TRANSACTION_ID IS NOT NULL          -- money actually moved
  AND l.OWNER_TYPE     = 'HOUSEMAID'        -- office staff are out entirely
  AND l.APPLICATION_DATE >= (SELECT TO_DATE(VALUE) FROM REF_ENTRY_VISA WHERE KEY='AUDIT_START');


-- -------------------------------------------------------------------------------------
-- M1 — the turn-down EVENT. Both conditions are load-bearing.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_EV_TURNDOWN AS
SELECT
    h.REQUEST_ID                            AS VISA_REQUEST_ID,
    h.ENTRY_VISA_IMMIGRATION_APPROVED       AS TURNDOWN_REASON,
    h.LAST_MODIFICATION_DATE                AS TURNDOWN_TS,
    CAST(h.LAST_MODIFICATION_DATE AS DATE)  AS TURNDOWN_DATE
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY h
WHERE h.ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED = 1     -- 🔴 removes 2,564 carry-forward rows
  AND h.ENTRY_VISA_IMMIGRATION_APPROVED IN
      (SELECT VALUE FROM REF_ENTRY_VISA WHERE KEY LIKE 'TURNDOWN_%');
-- ⚠️ NO COLLAPSE RULE. An earlier draft collapsed stamps dated <= 2 days apart; that rule
--    is DELETED — it existed to suppress duplicates the `_MODIFIED` flag removes at source.


-- -------------------------------------------------------------------------------------
-- Which charge a turn-down belongs to: the LAST CHARGE RAISED AT OR BEFORE it, on
-- timestamp. NOT a forward window.
--
-- A turn-down and its replacement application land on the same day in the commonest shape
-- here, so a "before the next application" rule hands the turn-down to the REPLACEMENT
-- instead of the charge that was actually refused — 213 cases, and on 23 of them the two
-- charges are in different price bands, so the refundable amount flips between AED 739.50
-- and AED 89.50.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_EV_TURNDOWN_ATTRIBUTED AS
SELECT
    td.VISA_REQUEST_ID,
    td.TURNDOWN_REASON,
    td.TURNDOWN_TS,
    td.TURNDOWN_DATE,
    c.CHARGE_TXN_ID,
    c.VISA_BAND,
    c.MAID_ID
FROM V_EV_TURNDOWN td
JOIN V_EV_CHARGE   c
  ON c.VISA_REQUEST_ID = td.VISA_REQUEST_ID
 AND c.APPLICATION_TS <= td.TURNDOWN_TS
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY td.VISA_REQUEST_ID, td.TURNDOWN_TS
    ORDER BY c.APPLICATION_TS DESC, c.CHARGE_TXN_ID DESC
) = 1;


-- -------------------------------------------------------------------------------------
-- Refunds — REQUEST-KEYED only, for M2.
--
-- The refund sits on the new request AND on the cancellation request. D9 resolves the
-- cancellation side: join on CANCEL_VISA_REQUESTS.REQUEST_ID (unique across 99,669 rows,
-- so it cannot fan out); NEW_REQUEST_ID is NOT unique — 9,762 values are pointed at by two
-- or more cancellations, so one request can legitimately inherit refunds from several.
--
-- A refund CLEARS a case only when money actually moved: status Added, a transaction, and
-- an amount of exactly -739.50 (inside) or -89.50 (outside). Any other amount clears
-- nothing and goes to the grey bucket — including the measured +125.65 clawback of
-- 2026-07-31, which must NEVER clear a case.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_EV_REFUND_REQUEST_KEYED AS
WITH raw AS (
    SELECT
        e.VISA_REQUEST_ID                   AS REFUND_ON_REQUEST_ID,
        e.STATUS                            AS CLAIM_STATUS,          -- Added | Pending | Dismissed
        e.TRANSACTION_ID,
        x.TRANSACTION_AMOUNT                AS REFUND_AMOUNT,         -- 🔴 from TRANSACTIONS
        CAST(e.CREATION_DATE AS DATE)       AS CLAIM_DATE
    FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
    LEFT JOIN V_TXN x ON x.TRANSACTION_ID = e.TRANSACTION_ID
    WHERE e.PURPOSE = (SELECT VALUE FROM REF_ENTRY_VISA WHERE KEY='PURPOSE_REFUND')
), routed AS (
    -- the refund as it sits on the request itself
    SELECT r.REFUND_ON_REQUEST_ID AS VISA_REQUEST_ID, r.* FROM raw r
    UNION ALL
    -- and the same refund inherited through its cancellation (D9)
    SELECT cv.NEW_REQUEST_ID AS VISA_REQUEST_ID, r.*
    FROM raw r
    JOIN BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS cv
      ON cv.REQUEST_ID = r.REFUND_ON_REQUEST_ID
    WHERE cv.NEW_REQUEST_ID IS NOT NULL
)
SELECT
    VISA_REQUEST_ID,
    REFUND_ON_REQUEST_ID,
    CLAIM_STATUS,
    CLAIM_DATE,
    REFUND_AMOUNT,
    CASE WHEN REFUND_AMOUNT = -739.50 THEN 'INSIDE'
         WHEN REFUND_AMOUNT =  -89.50 THEN 'OUTSIDE'
         ELSE 'UNBANDED' END            AS REFUND_BAND,
    (CLAIM_STATUS = 'Added' AND TRANSACTION_ID IS NOT NULL
       AND REFUND_AMOUNT IN (-739.50, -89.50))  AS MONEY_CAME_BACK
FROM routed;


-- -------------------------------------------------------------------------------------
-- M2 — refund we never got back.
--
-- Per VISA REQUEST and per PRICE BAND:  unclaimed = MAX(turn-downs - refunds, 0),
-- and the unclaimed count is assigned to the MOST RECENT charges in that request and band.
--
-- 🔴 Refunds counted here are REQUEST-KEYED ONLY. The description-only refunds are
--    maid-keyed and are applied in M3, never inside this MAX() — an earlier draft put a
--    maid-level quantity inside a request-level floor, where the order of operations
--    changes the answer by 41%.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_EV_M2 AS
WITH td_by_band AS (
    SELECT VISA_REQUEST_ID, VISA_BAND, COUNT(*) AS TURNDOWNS
    FROM V_EV_TURNDOWN_ATTRIBUTED
    GROUP BY VISA_REQUEST_ID, VISA_BAND
), rf_by_band AS (
    SELECT VISA_REQUEST_ID, REFUND_BAND AS VISA_BAND, COUNT(*) AS REFUNDS
    FROM V_EV_REFUND_REQUEST_KEYED
    WHERE MONEY_CAME_BACK
    GROUP BY VISA_REQUEST_ID, REFUND_BAND
), unclaimed AS (
    SELECT
        t.VISA_REQUEST_ID, t.VISA_BAND, t.TURNDOWNS,
        COALESCE(r.REFUNDS,0)                               AS REFUNDS,
        GREATEST(t.TURNDOWNS - COALESCE(r.REFUNDS,0), 0)    AS UNCLAIMED
    FROM td_by_band t
    LEFT JOIN rf_by_band r
           ON r.VISA_REQUEST_ID = t.VISA_REQUEST_ID AND r.VISA_BAND = t.VISA_BAND
), ranked AS (
    SELECT
        a.*,
        u.UNCLAIMED,
        u.TURNDOWNS,
        u.REFUNDS,
        ROW_NUMBER() OVER (PARTITION BY a.VISA_REQUEST_ID, a.VISA_BAND
                           ORDER BY a.TURNDOWN_TS DESC) AS RECENCY_RANK
    FROM V_EV_TURNDOWN_ATTRIBUTED a
    JOIN unclaimed u
      ON u.VISA_REQUEST_ID = a.VISA_REQUEST_ID AND u.VISA_BAND = a.VISA_BAND
), claim_state AS (
    SELECT
        VISA_REQUEST_ID,
        BOOLOR_AGG(CLAIM_STATUS = 'Dismissed') AS HAS_DISMISSED_CLAIM,
        BOOLOR_AGG(CLAIM_STATUS = 'Pending')   AS HAS_PENDING_CLAIM,
        MIN(CLAIM_DATE)                        AS FIRST_CLAIM_DATE,
        COUNT(*)                               AS CLAIM_LINES
    FROM V_EV_REFUND_REQUEST_KEYED
    GROUP BY VISA_REQUEST_ID
)
SELECT
    r.VISA_REQUEST_ID,
    r.CHARGE_TXN_ID,
    r.MAID_ID,
    r.VISA_BAND,
    r.TURNDOWN_REASON,
    r.TURNDOWN_DATE,
    r.TURNDOWNS,
    r.REFUNDS,
    r.UNCLAIMED,
    DATEDIFF('day', r.TURNDOWN_DATE, CURRENT_DATE())    AS DAYS_UNCLAIMED,
    cs.FIRST_CLAIM_DATE,
    cs.CLAIM_LINES,
    -- The buckets are DISJOINT and evaluated in this order, so they sum to M2 exactly.
    CASE
        WHEN DATEDIFF('day', r.TURNDOWN_DATE, CURRENT_DATE())
             < (SELECT TO_NUMBER(VALUE) FROM REF_ENTRY_VISA WHERE KEY='HOLD_DAYS')
                                            THEN 'TOO_RECENT'
        WHEN cs.HAS_DISMISSED_CLAIM         THEN 'CANCELLED_BY_US'
        WHEN cs.HAS_PENDING_CLAIM           THEN 'CLAIM_PENDING'
        ELSE                                     'NEVER_FILED'
    END                                     AS CLAIM_STATE,
    -- 🔴 `Dismissed` is OUR status, not immigration's — so those 72 are RED, not amber.
    --    Measured on all 87 Dismissed refund lines: NONE has ever carried a transaction,
    --    85 of 87 were raised by one person and closed by a DIFFERENT one, median 1 day,
    --    through 5 creators and 4 closers, and 16 are followed by a paid claim on the same
    --    maid. An immigration authority does not answer in 26 hours through four internal
    --    accounts. The line was voided by US and never re-filed.
    CASE r.VISA_BAND WHEN 'INSIDE'  THEN FN_PRICE_AT('ENTRY_VISA','REFUNDABLE_INSIDE',  r.TURNDOWN_DATE)
                     WHEN 'OUTSIDE' THEN FN_PRICE_AT('ENTRY_VISA','REFUNDABLE_OUTSIDE', r.TURNDOWN_DATE)
                     ELSE NULL END          AS RECOVERABLE_AED
FROM ranked r
LEFT JOIN claim_state cs ON cs.VISA_REQUEST_ID = r.VISA_REQUEST_ID
WHERE r.RECENCY_RANK <= r.UNCLAIMED;        -- the unclaimed count, on the most recent charges


-- -------------------------------------------------------------------------------------
-- M3 — paid twice.
--   extra = MAX(charges - 1 - rejected charges - MAX(refunds - rejected charges, 0), 0)
--
-- She should have been charged once. Every charge beyond the first needs either a
-- rejection behind it or a refund in front of it. What is left over is the finding.
--
-- 🔴 Money is `extra x HER MOST RECENT entry visa fee`. NEVER an average — 36 of these
--    maids carry both price bands, so their mean sits between AED 376 and AED 1,026 and is
--    a price nobody was ever charged. An earlier draft used the mean on maid #106383 and
--    produced AED 1,080.60 against the correct AED 751.30.
-- 🔴 The WHOLE FEE is at risk here, not the refundable part: nothing was turned down, so
--    there is no refund to claim against it.
--
-- This is where the MAID-KEYED refunds belong (the 138 findable only through the
-- transaction description, 20 of which carry no usable maid id and can never be attached).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_EV_M3 AS
WITH per_maid AS (
    SELECT
        c.MAID_ID,
        MAX(c.CONTRACT_TYPE)                                        AS CONTRACT_TYPE,
        COUNT(*)                                                    AS CHARGES,
        COUNT(DISTINCT td.CHARGE_TXN_ID)                            AS REJECTED_CHARGES,
        MAX(c.APPLICATION_DATE)                                     AS LAST_CHARGE_DATE,
        COUNT(DISTINCT c.VISA_BAND)                                 AS BANDS_CARRIED,
        BOOLOR_AGG(c.MAID_ID_DISAGREES)                             AS MAID_ID_DISAGREES
    FROM V_EV_CHARGE c
    LEFT JOIN V_EV_TURNDOWN_ATTRIBUTED td ON td.CHARGE_TXN_ID = c.CHARGE_TXN_ID
    WHERE c.MAID_ID IS NOT NULL
    GROUP BY c.MAID_ID
), last_fee AS (
    SELECT MAID_ID, PAID_AMOUNT AS LAST_FEE_AED, VISA_BAND AS LAST_BAND
    FROM V_EV_CHARGE
    QUALIFY ROW_NUMBER() OVER (PARTITION BY MAID_ID
                               ORDER BY APPLICATION_TS DESC, CHARGE_TXN_ID DESC) = 1
), maid_refunds AS (
    -- Maid-keyed refunds: the request-keyed ones PLUS the 138 that exist only as a
    -- transaction whose description says REFUND FOR ENTRY VISA. DESCRIPTION is a
    -- predicate only. 🔴 Do NOT look for these by expense code — 95% are still booked to
    -- old general immigration codes, so the code tells you nothing.
    SELECT MAID_ID, COUNT(*) AS REFUNDS
    FROM (
        SELECT t.HOUSEMAID_ID AS MAID_ID
        FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t
        WHERE t.DESCRIPTION ILIKE '%REFUND FOR ENTRY VISA%'
          AND t.HOUSEMAID_ID IS NOT NULL
          AND t.HOUSEMAID_ID <> 0           -- the 20 unattachable ones go to GREY, not here
          AND t.TRANSACTION_AMOUNT IN (-739.50, -89.50)
        UNION ALL
        SELECT c.MAID_ID
        FROM V_EV_REFUND_REQUEST_KEYED r
        JOIN V_EV_CHARGE c ON c.VISA_REQUEST_ID = r.VISA_REQUEST_ID
        WHERE r.MONEY_CAME_BACK
    )
    GROUP BY MAID_ID
)
SELECT
    p.MAID_ID,
    p.CONTRACT_TYPE,
    p.CHARGES,
    p.REJECTED_CHARGES,
    COALESCE(mr.REFUNDS,0)                                          AS REFUNDS,
    p.LAST_CHARGE_DATE,
    lf.LAST_FEE_AED,
    lf.LAST_BAND,
    p.BANDS_CARRIED,
    (p.BANDS_CARRIED > 1)                                           AS WRONG_TYPE,   -- M4: a REASON, never its own money line
    p.MAID_ID_DISAGREES,
    GREATEST(p.CHARGES - 1 - p.REJECTED_CHARGES
             - GREATEST(COALESCE(mr.REFUNDS,0) - p.REJECTED_CHARGES, 0), 0)  AS EXTRA_CHARGES,
    GREATEST(p.CHARGES - 1 - p.REJECTED_CHARGES
             - GREATEST(COALESCE(mr.REFUNDS,0) - p.REJECTED_CHARGES, 0), 0)
        * lf.LAST_FEE_AED                                           AS AT_RISK_AED
FROM per_maid p
LEFT JOIN last_fee     lf ON lf.MAID_ID = p.MAID_ID
LEFT JOIN maid_refunds mr ON mr.MAID_ID = p.MAID_ID
WHERE GREATEST(p.CHARGES - 1 - p.REJECTED_CHARGES
               - GREATEST(COALESCE(mr.REFUNDS,0) - p.REJECTED_CHARGES, 0), 0) > 0;


-- -------------------------------------------------------------------------------------
-- V_CASES_ENTRY_VISA — the two case lists, behind the tab's list toggle.
--
-- FLAGS (the spec's table, and nothing that cannot be judged is EVER shown as clean):
--   RED   ACTION      judged, and it is a finding
--   AMBER HOLD        judgeable later, or a person must rule first
--   GREY  UNREADABLE  the check CANNOT judge it at all — counted and listed, never hidden
--   GREEN CLEAN       judged, and there is nothing wrong
--
-- "Green is never reached by silence. A case with no refund and no note is NO_TEXT ->
--  grey, not green. Absence of evidence is the grey bucket's whole job."
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_CASES_ENTRY_VISA AS
SELECT
    'ENTRY_VISA'                            AS AUDIT_CODE,
    'M2:' || TO_VARCHAR(m2.CHARGE_TXN_ID)   AS CASE_ID,
    'charge'                                AS CASE_GRAIN,
    'M2'                                    AS RULE_ID,
    'Refund we can still claim'             AS RULE_NAME,
    'REFUND_NEVER_CLAIMED'                  AS LIST,
    m2.VISA_REQUEST_ID,
    m2.CHARGE_TXN_ID,
    m2.MAID_ID,
    c.CONTRACT_TYPE,
    m2.VISA_BAND,
    m2.TURNDOWN_REASON,
    m2.TURNDOWN_DATE,
    m2.DAYS_UNCLAIMED,
    m2.CLAIM_STATE,
    m2.FIRST_CLAIM_DATE,
    m2.TURNDOWNS, m2.REFUNDS, m2.UNCLAIMED,
    c.APPLICATION_DATE,
    c.POSTING_DATE,
    c.PAID_AMOUNT,
    NULL                                    AS CHARGES,
    NULL                                    AS EXTRA_CHARGES,
    FALSE                                   AS WRONG_TYPE,
    c.MAID_ID_DISAGREES,
    v.VERIFIER_VERDICT, v.VERIFIER_CATEGORY, v.REDACTED_QUOTE,
    -- flag
    CASE WHEN c.MAID_ID_DISAGREES OR m2.VISA_BAND = 'UNKNOWN'
                                              OR c.APPLICATION_DATE IS NULL THEN 'GREY'
         WHEN v.VERIFIER_VERDICT = 'JUSTIFIED'                              THEN 'GREEN'
         WHEN v.VERIFIER_VERDICT IN ('NO_TEXT','NOT_READ')                  THEN 'GREY'
         WHEN m2.CLAIM_STATE IN ('TOO_RECENT','CLAIM_PENDING')              THEN 'AMBER'
         ELSE                                                                   'RED'
    END                                     AS FLAG,
    CASE WHEN c.MAID_ID_DISAGREES OR m2.VISA_BAND = 'UNKNOWN'
                                              OR c.APPLICATION_DATE IS NULL THEN 'UNREADABLE'
         WHEN v.VERIFIER_VERDICT = 'JUSTIFIED'                              THEN 'CLEAN'
         WHEN v.VERIFIER_VERDICT IN ('NO_TEXT','NOT_READ')                  THEN 'UNREADABLE'
         WHEN m2.CLAIM_STATE IN ('TOO_RECENT','CLAIM_PENDING')              THEN 'HOLD'
         ELSE                                                                   'ACTION'
    END                                     AS FLAG_LABEL,
    CASE WHEN c.MAID_ID_DISAGREES OR m2.VISA_BAND = 'UNKNOWN'               THEN 'UNVALUED'
         WHEN v.VERIFIER_VERDICT = 'JUSTIFIED'                              THEN 'NOT_A_FINDING'
         WHEN m2.CLAIM_STATE IN ('TOO_RECENT','CLAIM_PENDING')              THEN 'UNDECIDED'
         ELSE                                                                   'RECOVERABLE'
    END                                     AS EXPOSURE_CLASS,
    'Visa team'                             AS ACTION_OWNER,
    CASE m2.CLAIM_STATE
         WHEN 'NEVER_FILED'     THEN 'No claim was ever filed — the Visa team files one'
         WHEN 'CANCELLED_BY_US' THEN 'We filed a claim and then cancelled it ourselves. The money never came: re-file it'
         WHEN 'CLAIM_PENDING'   THEN 'A claim is filed and still sitting. CHASE IT — do not file a second one'
         WHEN 'TOO_RECENT'      THEN 'Nothing yet — the turn-down is under 60 days old'
    END                                     AS ACTION_TEXT,
    CASE WHEN c.MAID_ID_DISAGREES OR m2.VISA_BAND = 'UNKNOWN' THEN NULL
         ELSE m2.RECOVERABLE_AED END        AS AMOUNT_AED,
    (NOT c.MAID_ID_DISAGREES AND m2.VISA_BAND <> 'UNKNOWN')  AS AMOUNT_IS_VALUED,
    'COMPANY'                               AS WHO_IS_OUT_OF_POCKET,
    c.APPLICATION_DATE                      AS ANCHOR_DATE,
    'application date (VISAREQUESTEXPENSES.CREATION_DATE), never the posting date' AS ANCHOR_DATE_MEANING,
    DATEADD('day', 60, m2.TURNDOWN_DATE)    AS DEADLINE_DATE
FROM V_EV_M2 m2
JOIN V_EV_CHARGE c ON c.CHARGE_TXN_ID = m2.CHARGE_TXN_ID
LEFT JOIN V_VERIFIER_LATEST v
       ON v.AUDIT_CODE = 'ENTRY_VISA' AND v.CASE_ID = 'M2:' || TO_VARCHAR(m2.CHARGE_TXN_ID)

UNION ALL

SELECT
    'ENTRY_VISA',
    'M3:' || TO_VARCHAR(m3.MAID_ID),
    'maid',
    'M3',
    'Paid twice — no refund route',
    'PAID_TWICE',
    NULL, NULL,
    m3.MAID_ID,
    m3.CONTRACT_TYPE,
    m3.LAST_BAND,
    NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL,
    m3.LAST_CHARGE_DATE,
    NULL,
    m3.LAST_FEE_AED,
    m3.CHARGES,
    m3.EXTRA_CHARGES,
    m3.WRONG_TYPE,
    m3.MAID_ID_DISAGREES,
    v.VERIFIER_VERDICT, v.VERIFIER_CATEGORY, v.REDACTED_QUOTE,
    -- 🔴 The verifier may NEVER clear an M3. A fee paid to a government twice happened,
    --    whatever the note says about it — here it only ever attaches a reason.
    CASE WHEN m3.MAID_ID_DISAGREES THEN 'GREY' ELSE 'RED' END,
    CASE WHEN m3.MAID_ID_DISAGREES THEN 'UNREADABLE' ELSE 'ACTION' END,
    CASE WHEN m3.MAID_ID_DISAGREES THEN 'UNVALUED' ELSE 'LOST' END,
    'P&C',
    'Goes back to whoever raised the second payment. There is no refund route — nothing was turned down',
    CASE WHEN m3.MAID_ID_DISAGREES THEN NULL ELSE m3.AT_RISK_AED END,
    (NOT m3.MAID_ID_DISAGREES),
    'COMPANY',
    m3.LAST_CHARGE_DATE,
    'application date of her most recent entry visa charge',
    NULL
FROM V_EV_M3 m3
LEFT JOIN V_VERIFIER_LATEST v
       ON v.AUDIT_CODE = 'ENTRY_VISA' AND v.CASE_ID = 'M3:' || TO_VARCHAR(m3.MAID_ID);
