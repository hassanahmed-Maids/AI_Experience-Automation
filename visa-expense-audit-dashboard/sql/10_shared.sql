-- =====================================================================================
-- Visa Expense Audit — 10 · shared layer
--
-- The traps below were each discovered INDEPENDENTLY by two or more of the six specs,
-- and in every case at least one spec had already published a wrong number because of
-- it. They are fixed once here so a correction cannot land in one audit and be
-- forgotten in another.
--
--   1. HOUSEMAID_OUTSTANDING_BALANCE_DETAILS is a status HISTORY, not one row per loan.
--      ILOE §3 measured the raw sum overstating subscriptions by AED 241,161 (+21.7%)
--      and fines by AED 97,089 (+15.0%). E-ID §3.4 measured a per-transaction join
--      moving AED 5,041.82 between two runs of the same query.  -> V_LOAN_LATEST
--   2. CONTRACT_TYPE is 'CC ' / 'MV ' WITH A TRAILING SPACE. `= 'CC'` matches zero rows
--      and raises no error, which reads exactly like "no findings for CC".
--      (entry visa §2.4 D4 · medical trap 5 · R-visa §2.5)      -> TRIM everywhere
--   3. Two clocks. VISAREQUESTEXPENSES.CREATION_DATE is when we applied;
--      TRANSACTIONS.TRANSACTION_DATE is when Accounting posted it — median one day
--      later, up to sixteen. Entry visa §2.4.1 measured the posting clock LOSING 257 of
--      913 turn-down charges (28%). R-visa §2.5 measured every dated list missing by a
--      day. Both clocks are carried, named, and each audit picks its own.
--   4. REMAINING_AMOUNT is 0 on every row in the warehouse, in both tables that have it.
--      Outstanding is always AMOUNT - REPAID_AMOUNT - WAIVED_AMOUNT.
--   5. IS_DELETED is TEXT and inert ('0' / '00' only). A boolean test matches nothing
--      and reads as "none deleted". Use STATUS. (LAWP §2 · R-visa §0.5 withdrew a whole
--      set of measurements taken through it.)
--
-- NOTHING in this file selects a personal-data column. DESCRIPTION, CREATOR,
-- LAST_MODIFIER, EMPLOYEE_NAME, *_NAME and note text are permitted as PREDICATES and
-- are never projected. See DESIGN.md §3.8.
-- =====================================================================================

USE SCHEMA POLICE_CONTROL.VISA_AUDIT;


-- -------------------------------------------------------------------------------------
-- DIM_MAID — the maid dimension every tab displays.
-- Source: LAWP D6. Read scope and nationality from the HOLDER (LAWP R14).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW DIM_MAID AS
SELECT
    hi.ID                                   AS MAID_ID,
    hi.NATIONALITY                          AS NATIONALITY,
    hi.HOUSEMAID_TYPE                       AS HOUSEMAID_TYPE,
    -- LAWP §1 scope: HOUSEMAID_TYPE 'Normal' is CC, 'MAID_VISA' is MV.
    -- A value we do not recognise is reported as UNKNOWN, never silently dropped.
    CASE UPPER(TRIM(hi.HOUSEMAID_TYPE))
         WHEN 'NORMAL'    THEN 'CC'
         WHEN 'MAID_VISA' THEN 'MV'
         ELSE 'UNKNOWN'
    END                                     AS CONTRACT_TYPE,
    hi.STATUS                               AS MAID_STATUS
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO hi;


-- -------------------------------------------------------------------------------------
-- V_LOAN_LATEST — one row per loan ID, collapsed from the snapshot history.
--
-- ILOE §3 trap 1 and e-ID §3.4 both specify the SAME collapse, arrived at separately:
-- keep the row with the largest REPAID_AMOUNT + WAIVED_AMOUNT.
--
-- 🔴 Implement with QUALIFY ROW_NUMBER(), NOT with MAX(): ILOE measured 5 loans that TIE
--    (one of them four ways). The tied rows are identical so any of them will do, but the
--    tie-break must be EXPLICIT or the view is non-deterministic between runs.
--
-- E-ID §3.5 additionally needs the note text of EVERY snapshot row, not the collapsed
-- one (52 loans carry different notes per snapshot). This view is for ARITHMETIC ONLY.
-- The verifier reads the raw table, and only the model's redacted quote is ever stored.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_LOAN_LATEST AS
SELECT
    l.ID                                    AS LOAN_ID,
    l.HOUSEMAID_ID                          AS MAID_ID,
    l.TYPE                                  AS LOAN_TYPE,
    l.BALANCE_DATE                          AS BALANCE_TS,          -- TIMESTAMP_NTZ
    CAST(l.BALANCE_DATE AS DATE)            AS BALANCE_DATE,        -- compare with DATEDIFF, never BETWEEN
    l.AMOUNT                                AS LOAN_AMOUNT,
    l.REPAID_AMOUNT                         AS REPAID_AMOUNT,
    l.WAIVED_AMOUNT                         AS WAIVED_AMOUNT,
    -- REMAINING_AMOUNT is zero on every row in the warehouse and cannot be used.
    l.AMOUNT - l.REPAID_AMOUNT - l.WAIVED_AMOUNT AS OUTSTANDING_AMOUNT,
    -- 🔴 STATUS = 'PAID' does NOT mean the money came back — it includes loans written
    --    off in full. Trust the amounts. (ILOE §3 trap 3.) STATUS is carried for display
    --    and for the e-ID loan-status filter, and is never used to decide recovery.
    l.STATUS                                AS LOAN_STATUS,
    -- R4 needs the ERP to-do reference out of the waiver note and NOTHING else from it.
    -- Three forms appear: `todo;551534`, `open-todo/730554`, and a full ERP URL.
    -- The note is template-generated and names a real staff member; the id is extracted
    -- and the rest of the text is discarded here, never projected.
    REGEXP_SUBSTR(l.WAIVE_NOTES, 'todo[;/]([0-9]+)', 1, 1, 'i', 1) AS WAIVE_TODO_REF,
    (l.WAIVED_AMOUNT > 0)                   AS HAS_WAIVER
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS l
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY l.ID
    ORDER BY (COALESCE(l.REPAID_AMOUNT,0) + COALESCE(l.WAIVED_AMOUNT,0)) DESC,
             l.BALANCE_DATE DESC,
             l.STATUS                        -- explicit, deterministic tie-break
) = 1;


-- -------------------------------------------------------------------------------------
-- DIM_PRICE_ERA — every price in the programme is era-bound. There are no constants.
--
-- Four specs hit this independently:
--   ILOE §2   "Never hardcode a fine price as a single number."
--   e-ID §3.0 "Prices changed on 2025-08-11 … a single constant bands an entire earlier
--              month as wrong."
--   R-visa    R-FEE-SCHEDULE, thirteen entries, plus a TERM axis.
--   LAWP R7   The loss is the sum of the fees ACTUALLY ON RECORD, never the flat
--             AED 1,447.93 — so LAWP deliberately has NO rows here.
--
-- VALID_TO is exclusive. A NULL VALID_TO means "to present".
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW DIM_PRICE_ERA (
    AUDIT_CODE, PRICE_KIND, AMOUNT, VALID_FROM, VALID_TO, TERM_DAYS, NOTE
) AS
SELECT * FROM VALUES
    -- ---- E-ID (e-ID §3.0) -----------------------------------------------------------
    ('EID','APPLICATION',   354.55,      DATE'2000-01-01', DATE'2025-08-11', NULL, '19,288 rows'),
    ('EID','APPLICATION',   353.91,      DATE'2025-08-11', NULL,             NULL, '19,824 rows'),
    ('EID','APPLICATION',   382.10,      DATE'2026-05-14', DATE'2026-05-28', NULL, 'valid price, 564 rows — NOT a fine'),
    ('EID','APPLICATION',   442.11,      DATE'2026-05-27', DATE'2026-06-18', NULL, 'BUNDLE 382.10 app + 60.01 typing; understates typing ~AED 27,485'),
    ('EID','REPLACEMENT',   454.55,      DATE'2000-01-01', DATE'2025-08-11', NULL, '407 rows'),
    ('EID','REPLACEMENT',   454.62,      DATE'2025-08-11', NULL,             NULL, '195 rows'),
    ('EID','FINE_STEP',      20.00,      DATE'2000-01-01', DATE'2025-08-11', NULL, 'per day late; cap 50 days = 1,000.00'),
    ('EID','FINE_STEP',      20.142857,  DATE'2025-08-11', NULL,             NULL, 'per day late; cap 50 days = 1,007.14'),
    -- AED 350.76 does NOT exist — zero rows in the whole 2.07M-row table. Never reference it.

    -- ---- R-visa (R-FEE-SCHEDULE) ----------------------------------------------------
    -- Windows are disjoint within a residue family, because amounts 50 apart are
    -- indistinguishable from a fee plus one overstay day.
    ('RVISA','FEE',         555.00, DATE'2018-08-15', DATE'2018-11-26',  730, 'Noqoodi, 52 payments'),
    ('RVISA','FEE',         556.00, DATE'2018-10-04', DATE'2018-11-26',  730, 'Noqoodi, 52 payments'),
    ('RVISA','FEE',         476.00, DATE'2018-07-31', DATE'2020-03-26',  730, 'Noqoodi, 447 payments'),
    ('RVISA','FEE',         477.00, DATE'2018-07-31', DATE'2018-11-27',  730, 'Noqoodi, 414 payments'),
    ('RVISA','FEE',         496.00, DATE'2018-11-26', DATE'2019-11-28',  730, 'Noqoodi, 1,696 payments'),
    ('RVISA','FEE',         497.00, DATE'2018-11-27', DATE'2019-11-27',  730, 'Noqoodi, 1,498 payments'),
    ('RVISA','FEE',         396.00, DATE'2019-12-03', DATE'2020-06-24',  730, 'Noqoodi, 780 payments'),
    ('RVISA','FEE',         397.00, DATE'2019-12-03', DATE'2020-06-24',  730, 'Noqoodi, 695 payments'),
    ('RVISA','FEE',         393.50, DATE'2020-06-27', DATE'2023-05-17',  730, 'Noqoodi, 13,515 payments'),
    ('RVISA','FEE',         443.50, DATE'2023-05-17', NULL,              730, 'Noqoodi, 44,100 payments — MOHRE 2-year'),
    ('RVISA','FEE',         457.46, DATE'2025-07-07', NULL,              730, 'Credit_Card, 5,354 payments — AIO 2-year'),
    ('RVISA','FEE',         343.50, DATE'2023-05-17', NULL,              365, '1-YEAR TIER, 90 payments. NOT a partial payment — two company sources'),
    ('RVISA','FEE',         293.50, DATE'2020-06-27', DATE'2023-05-17',  365, '1-year tier of the 393.50 era. 🟡 INFERENCE, not a source — R-visa §6.13'),
    -- Rejected as era fees, deliberately: 472.50 (110 payments) and 418.50 (10) are
    -- partial payments, not prices. A payment matching no entry is T3 BLOCKED.
    ('RVISA','FINE_STEP',    50.00, DATE'2000-01-01', NULL,             NULL, '⚠️ ASSUMED from the residue pattern, never read from an overstay tariff — Finance sign-off outstanding (R-visa THRESHOLDS)'),
    ('RVISA','CHANNEL_FEE',   3.15, DATE'2000-01-01', NULL,             NULL, 'Noqoodi 3.00 + 0.15 VAT. The .65 ending is a channel fee, not a government fee'),
    ('RVISA','MODIFICATION', 143.50, DATE'2000-01-01', NULL,            NULL, 'R-visa Modification — heads 1622/1649/1735. Document-error cost, NOT the residence fee'),
    ('RVISA','MODIFICATION', 243.50, DATE'2000-01-01', NULL,            NULL, 'the rarer variant'),

    -- ---- Entry visa (entry visa §1) -------------------------------------------------
    -- 🔴 The FEE is classified by the transaction description wording, NEVER by price —
    --    the price changes every few months, the wording does not. Only the REFUNDABLE
    --    part is a constant, and it is the only thing this table carries for entry visa.
    ('ENTRY_VISA','REFUNDABLE_INSIDE',  739.50, DATE'2000-01-01', NULL, NULL, 'refundable on an inside-country turn-down'),
    ('ENTRY_VISA','REFUNDABLE_OUTSIDE',  89.50, DATE'2000-01-01', NULL, NULL, 'refundable on an outside-country turn-down'),

    -- ---- Medical (medical §5) -------------------------------------------------------
    ('MEDICAL','REFUND_RATE', 220.00, DATE'2000-01-01', DATE'2026-01-01', NULL, '665 of 669 refunds paid in 2025, mean 220.06'),
    ('MEDICAL','REFUND_RATE', 270.00, DATE'2026-01-01', NULL,             NULL, '398 of 473 refunds paid in 2026 — 84.1%'),
    -- Pre-2023 rates of AED 50–53.15 exist and are OUT OF SCOPE. Blending them drags the
    -- pre-2026 mean to AED 182 and understates the loss.

    -- ---- ILOE (ILOE §2) -------------------------------------------------------------
    ('ILOE','SUBSCRIPTION', 126.00, DATE'2000-01-01', NULL, NULL, 'the subscription price throughout'),
    ('ILOE','FINE',         402.86, DATE'2000-01-01', NULL, NULL, 'current fine price'),
    ('ILOE','FINE',         403.00, DATE'2000-01-01', NULL, NULL, 'variant'),
    ('ILOE','FINE',         402.00, DATE'2000-01-01', NULL, NULL, 'variant'),
    ('ILOE','FINE',         201.43, DATE'2000-01-01', NULL, NULL, 'variant'),
    ('ILOE','FINE',         126.00, DATE'2000-01-01', DATE'2025-01-01', NULL, '🔴 126 WAS a 2024 fine price — needs the tight DESCRIPTION LIKE ''%ILOE FINE%'' test; 988 fine loans sit at exactly 126')

    -- LAWP carries NO price rows, by rule R7. Its loss is always the sum of the fees on
    -- record for that payment — measured partial bundles include AED 1,397.57 (no work
    -- permit), 1,258.93 (no MOHRE) and 239.36 (no labour card). A flat AED 1,447.93
    -- would charge every one of them wrongly.
AS t(AUDIT_CODE, PRICE_KIND, AMOUNT, VALID_FROM, VALID_TO, TERM_DAYS, NOTE);


-- -------------------------------------------------------------------------------------
-- V_TXN — the money ledger, with the guards every audit needs and no personal columns.
--
-- TRANSACTION_TYPE is the row DECLARING its nature ('Expense' / 'Refund'). Match on it,
-- not on the sign of the amount — R-visa §3.4: "TRANSACTION_AMOUNT < 0 is an inference
-- about what a row means; TRANSACTION_TYPE is the row saying so." The disagreement
-- between the two is a booking defect worth surfacing, so it is carried as a flag.
--
-- ILOE §3 measured 271 blank-type rows sitting at zero, which would otherwise inflate a
-- duplicate count. They are typed here as 'BLANK' and never counted as a payment.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_TXN AS
SELECT
    t.ID                                    AS TRANSACTION_ID,
    t.HOUSEMAID_ID                          AS MAID_ID,
    t.TRANSACTION_DATE                      AS TRANSACTION_DATE,     -- DATE. The payment clock.
    t.TRANSACTION_AMOUNT                    AS TRANSACTION_AMOUNT,
    COALESCE(NULLIF(TRIM(t.TRANSACTION_TYPE),''),'BLANK') AS TRANSACTION_TYPE,
    t.RELATED_TO                            AS RELATED_TO,
    t.EXPENSE                               AS EXPENSE_NAME,
    t.EXPENSE_ROOT                          AS EXPENSE_ROOT,
    t.EXPENSE_ID                            AS EXPENSE_ID,
    t.CREATION_DATE                         AS TXN_CREATION_DATE,
    -- Booking defect flag: the declared type and the sign disagree. Surfaced, not resolved.
    (   (UPPER(TRIM(t.TRANSACTION_TYPE)) = 'REFUND'  AND t.TRANSACTION_AMOUNT > 0)
     OR (UPPER(TRIM(t.TRANSACTION_TYPE)) = 'EXPENSE' AND t.TRANSACTION_AMOUNT < 0)
    )                                       AS TYPE_SIGN_DISAGREES,
    -- T0-style input guard (R-visa §3.3). A row failing it is BLOCKED, never filtered out:
    -- the profiled max AMOUNT in this table is ~19.7 trillion, and a filter would let a
    -- single-payment case holding that row be counted CLEAN.
    (        t.TRANSACTION_AMOUNT IS NOT NULL
         AND ABS(t.TRANSACTION_AMOUNT) <= 100000
         AND t.TRANSACTION_DATE IS NOT NULL
         AND t.TRANSACTION_DATE BETWEEN DATE'2016-01-01' AND CURRENT_DATE()
    )                                       AS IS_USABLE_INPUT
FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t;
-- NOT SELECTED, EVER: t.DESCRIPTION (maid names; passport numbers from 2026-01),
-- t.CREATOR, t.LAST_MODIFIER, t.SUPPLIER_NAME. Available as predicates in the audit
-- views that need them, and only as predicates.


-- -------------------------------------------------------------------------------------
-- V_VISA_EXPENSE_LINE — the visa ledger at LINE grain, joined to its payment.
--
-- Deliberately at LINE grain, not payment grain: two lines can share one TRANSACTION_ID
-- (R-visa D4 — exactly once in 69,218 payments, request 12822), and that IS the T5
-- finding. Collapsing here would delete the defect the check exists to find. Each audit
-- collapses with LINES_ON_TXN in hand.
--
-- Population filters NOT applied here, on purpose — they differ per audit:
--   * STATUS: entry visa needs 'Added' only; medical needs Dismissed and Pending too
--     (a Dismissed refund is money that never came back and must not clear a case);
--     R-visa §3.1 forbids STATUS as a population filter entirely and tests it at T7.
--   * PURPOSE and AMOUNT bounds: per audit.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_VISA_EXPENSE_LINE AS
SELECT
    e.VISA_REQUEST_ID                       AS VISA_REQUEST_ID,
    e.PURPOSE                               AS PURPOSE,
    e.STATUS                                AS LINE_STATUS,
    e.TRANSACTION_ID                        AS TRANSACTION_ID,
    e.OWNER_ID                              AS OWNER_MAID_ID,        -- authoritative maid id
    e.OWNER_TYPE                            AS OWNER_TYPE,
    e.REQUEST_TYPE                          AS REQUEST_TYPE,
    UPPER(TRIM(e.CONTRACT_TYPE))            AS CONTRACT_TYPE,        -- 🔴 'CC ' / 'MV ' — TRIM
    e.EMPLOYEE_TYPE                         AS EMPLOYEE_TYPE,
    e.AMOUNT                                AS LINE_AMOUNT,          -- net of VAT; NOT the fee. See below.
    e.CHARGE                                AS CHANNEL_CHARGE,
    e.VAT_CHARGE                            AS CHANNEL_VAT,
    e.PAYMENT_TYPE                          AS PAYMENT_CHANNEL,
    CAST(e.CREATION_DATE AS DATE)           AS APPLICATION_DATE,     -- clock A: when we applied
    e.CREATION_DATE                         AS APPLICATION_TS,
    x.TRANSACTION_DATE                      AS POSTING_DATE,         -- clock B: when Accounting posted
    x.TRANSACTION_AMOUNT                    AS PAID_AMOUNT,          -- 🔴 read amounts from HERE
    x.TRANSACTION_TYPE                      AS TRANSACTION_TYPE,
    x.EXPENSE_ID                            AS EXPENSE_ID,
    x.EXPENSE_NAME                          AS EXPENSE_NAME,
    x.MAID_ID                               AS TXN_MAID_ID,          -- the SECOND maid id — they disagree
    x.IS_USABLE_INPUT                       AS IS_USABLE_INPUT,
    x.TYPE_SIGN_DISAGREES                   AS TYPE_SIGN_DISAGREES,
    -- 🔴 The two maid ids occasionally name different people (entry visa §2.4.4: 5 charges).
    --    Use OWNER_ID; show the disagreement as a GREY row rather than picking one.
    (e.OWNER_ID IS NOT NULL AND x.MAID_ID IS NOT NULL AND e.OWNER_ID <> x.MAID_ID)
                                            AS MAID_ID_DISAGREES,
    COUNT(*) OVER (PARTITION BY e.TRANSACTION_ID) AS LINES_ON_TXN    -- >1 is the T5 defect
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
LEFT JOIN V_TXN x
       ON x.TRANSACTION_ID = e.TRANSACTION_ID    -- NUMBER(38,0) both sides, no cast
;
-- 🔴 Read the AMOUNT from TRANSACTIONS, never from VISAREQUESTEXPENSES.AMOUNT. The
--    expense ledger is net of VAT, carries −739.57 rows, and holds two with the SIGN
--    REVERSED. Entry visa §M2 measured classifying off the expense amount moving the
--    unclaimed count from 216 to 511.
-- 🔴 IS_DELETED is not referenced. It is TEXT, holds only '0'/'00', and matches nothing.
-- NOT SELECTED, EVER: e.DESCRIPTION, e.EMPLOYEE_NAME, e.CREATOR_NAME, e.LAST_MODIFIER_NAME.


-- -------------------------------------------------------------------------------------
-- FN_PRICE_AT — the era price of a kind on a date. One place, so no audit inlines one.
-- Returns the LARGEST matching amount where windows overlap (R-visa fee-matching rule:
-- it attributes the least to fines, and the windows are built so this is never contested).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION FN_PRICE_AT(P_AUDIT VARCHAR, P_KIND VARCHAR, P_ON DATE)
RETURNS FLOAT
AS
$$
    SELECT MAX(AMOUNT)
    FROM POLICE_CONTROL.VISA_AUDIT.DIM_PRICE_ERA
    WHERE AUDIT_CODE = P_AUDIT
      AND PRICE_KIND = P_KIND
      AND P_ON >= VALID_FROM
      AND (VALID_TO IS NULL OR P_ON < VALID_TO)
$$;
