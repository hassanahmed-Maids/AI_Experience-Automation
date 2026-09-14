-- =====================================================================================
-- Visa Expense Audit — 24 · ILOE checker
-- Source spec: SPEC_iloe_checker_v2 (Abdullah Mahdi, 2026-09-12)
--
-- ILOE is Involuntary Loss of Employment insurance, paid to the UAE government. Two things
-- get paid: a SUBSCRIPTION (AED 126) and, when we register her late, a FINE. We pay the
-- government, then charge the maid by putting a loan on her payroll profile. The loan is
-- created by the system, not typed by a person — SO THE LOAN IS THE RECORD OF WHO BEARS
-- THE COST. There is nothing here to interpret and no free text for an AI to read.
--
-- 🔴 `UNEMPLOYMENT_INSURANCE_PREMIUM` IS NOT A SUBSCRIPTION-ONLY TYPE. It carried fine
--    recovery too, holding 161 loans at exactly 402.86 between April and December 2024.
--    Treating it as dead wrongly reports 145 ALREADY-RECOVERED fines as findings. v1 of
--    this spec made exactly that mistake, in the spec written to correct the older
--    version of it.
--
-- 🔴 AED 126 WAS A REAL FINE PRICE IN 2024. The loan table holds 988 fine loans at exactly
--    126, 987 of them April–December 2024. But the 126 test needs the TIGHT `ILOE FINE`
--    match: a bare `FINE` also matches maid names — Elfinesh, Josepfine, Serafines.
-- =====================================================================================

USE SCHEMA POLICE_CONTROL.VISA_AUDIT;


CREATE OR REPLACE VIEW REF_ILOE (KEY, VALUE, NOTE) AS
SELECT * FROM VALUES
    ('LOAN_FINES',   'UNEMPLOYMENT_INSURANCE_FINES',   'the post-rename fine type'),
    ('LOAN_PREMIUM', 'UNEMPLOYMENT_INSURANCE_PREMIUM', '🔴 carried BOTH subscription and fine recovery. Stopped 2025-03-02'),
    ('LOAN_PLAN',    'UNEMPLOYMENT_INSURANCE_PLAN',    'took over from _PREMIUM on 2025-03-02'),
    ('RENAME_DATE',  '2025-03-02',                     'the loan-type rename'),
    ('R3_DAYS',      '60',
     'MEASURED: as a proportion still open the decay runs 100% -> 95% -> 44% -> 8% -> 1% across successive 30-day bands. 60 days is the inflection where normal instalment repayment ends.'),
    ('R2_WINDOW_BEFORE','45', 'pre-rename _PREMIUM match window, days before the payment'),
    ('R2_WINDOW_AFTER', '15', 'pre-rename _PREMIUM match window, days after the payment'),
    ('AMOUNT_TOL',   '0.50', 'fine/loan amount match tolerance, and the R3 outstanding floor')
AS t(KEY, VALUE, NOTE);
-- Expense names changed in Dec 2025 and AGAIN on 2026-08-30 (`RENEW - CC Housemaids -
-- ILOE Fines`). NEVER hardcode the list of expense names — match on the words
-- `ILOE Subscription` and `ILOE Fines`.


-- -------------------------------------------------------------------------------------
-- The payment population. TRANSACTION_TYPE labels this exactly: every Expense row is
-- positive, every Refund negative, and every BLANK-type row is zero — 271 of them, which
-- would otherwise inflate a duplicate count.
--
-- Scope is MAIDS ONLY. Office staff ILOE is excluded: 90 payments, AED 13,600, none
-- carrying a maid link. The two filters below exclude them two independent ways, and the
-- two agree.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_ILOE_PAYMENT AS
SELECT
    t.ID                                    AS TRANSACTION_ID,
    t.HOUSEMAID_ID                          AS MAID_ID,
    t.TRANSACTION_DATE,
    t.TRANSACTION_AMOUNT                    AS PAID_AED,
    t.EXPENSE                               AS EXPENSE_NAME,
    t.CREATION_DATE                         AS TXN_CREATION_TS,
    -- Telling a subscription from a fine. The classification is EXHAUSTIVE:
    -- 3,018 fines + 31,629 subscriptions + 47 unclassified = 34,694, the whole
    -- maid-linked population. A future naming change shows up as a RISING UNCLASSIFIED
    -- COUNT instead of vanishing.
    -- DESCRIPTION is a PREDICATE here and is never projected.
    CASE
        WHEN t.EXPENSE ILIKE '%ILOE Fines%'                                       THEN 'FINE'
        WHEN t.TRANSACTION_AMOUNT IN (402.86, 403, 402, 201.43)
             AND UPPER(t.DESCRIPTION) LIKE '%FINE%'                               THEN 'FINE'
        WHEN t.TRANSACTION_AMOUNT = 126
             AND UPPER(t.DESCRIPTION) LIKE '%ILOE FINE%'                          THEN 'FINE'
        WHEN t.EXPENSE ILIKE '%ILOE Subscription%'
             OR t.TRANSACTION_AMOUNT = 126                                        THEN 'SUBSCRIPTION'
        ELSE                                                                           'UNCLASSIFIED'
    END                                     AS CHARGE_CLASS,
    (t.TRANSACTION_DATE < (SELECT TO_DATE(VALUE) FROM REF_ILOE WHERE KEY='RENAME_DATE'))
                                            AS IS_PRE_RENAME,
    -- The accounting adjustment, excluded AND NAMED: one "OLD DIFFERENCE" row, AED 50,985.53.
    (UPPER(t.DESCRIPTION) LIKE '%OLD DIFFERENCE%') AS IS_ACCOUNTING_ADJUSTMENT
FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t
WHERE t.EXPENSE ILIKE '%ILOE%'
  AND t.RELATED_TO       = 'HOUSEMAID'
  AND t.TRANSACTION_TYPE = 'Expense'
  AND t.HOUSEMAID_ID IS NOT NULL;


-- -------------------------------------------------------------------------------------
-- Reversals. Only 4 of the 58 refunds carry a maid id, and only ONE names its original
-- transaction (`TR# ...`). Net the 4 maid-linked refunds against their payment. The other
-- 54 CANNOT be matched mechanically — they name a staff member and a date, not a
-- transaction — so they are reported as an UNMATCHED REVERSALS bucket (-AED 23,779),
-- never silently dropped.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_ILOE_REVERSAL AS
SELECT
    t.ID                                    AS TRANSACTION_ID,
    t.HOUSEMAID_ID                          AS MAID_ID,
    t.TRANSACTION_DATE,
    t.TRANSACTION_AMOUNT                    AS REFUND_AED,
    (t.HOUSEMAID_ID IS NOT NULL)            AS IS_MATCHABLE
FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t
WHERE t.EXPENSE ILIKE '%ILOE%'
  AND t.TRANSACTION_TYPE = 'Refund';


-- -------------------------------------------------------------------------------------
-- The loans, from the shared collapsed view. V_LOAN_LATEST already applies the
-- ILOE-discovered dedupe: ID repeats 1.21x per subscription loan and 1.10x per fine loan,
-- and summing AMOUNT raw overstates subscriptions by AED 241,161 (+21.7%) and fines by
-- AED 97,089 (+15.0%).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_ILOE_LOAN AS
SELECT
    l.*,
    CASE l.LOAN_TYPE
         WHEN (SELECT VALUE FROM REF_ILOE WHERE KEY='LOAN_FINES')   THEN 'FINES'
         WHEN (SELECT VALUE FROM REF_ILOE WHERE KEY='LOAN_PREMIUM') THEN 'PREMIUM'
         WHEN (SELECT VALUE FROM REF_ILOE WHERE KEY='LOAN_PLAN')    THEN 'PLAN'
    END                                     AS LOAN_CLASS
FROM V_LOAN_LATEST l
WHERE l.LOAN_TYPE IN (SELECT VALUE FROM REF_ILOE WHERE KEY LIKE 'LOAN_%');


-- =====================================================================================
-- V_CASES_ILOE — the four rules, one row per finding.
-- R2 and R3 are MUTUALLY EXCLUSIVE by construction: R2 is "no loan", R3 is "loan not
-- settled". Nothing is counted twice.
-- =====================================================================================
CREATE OR REPLACE VIEW V_CASES_ILOE AS

-- ---- R2 · We paid a fine and nobody was charged --------------------------------------
-- ⚠️ A maid holding *a* fine loan that does not match this payment's amount and date is
--    CLEARED. The check reports the CERTAIN FLOOR, not the strict figure.
SELECT
    'ILOE'                                  AS AUDIT_CODE,
    'R2:' || TO_VARCHAR(p.TRANSACTION_ID)   AS CASE_ID,
    'payment'                               AS CASE_GRAIN,
    'R2'                                    AS RULE_ID,
    'We paid a fine and nobody was charged' AS RULE_NAME,
    p.MAID_ID,
    m.CONTRACT_TYPE,
    p.TRANSACTION_ID,
    p.TRANSACTION_DATE                      AS PAID_DATE,
    p.PAID_AED,
    p.EXPENSE_NAME,
    p.CHARGE_CLASS,
    p.IS_PRE_RENAME,
    CAST(NULL AS NUMBER(38,0))              AS LOAN_ID,
    CAST(NULL AS VARCHAR)                   AS LOAN_CLASS,
    CAST(NULL AS DATE)                      AS LOAN_DATE,
    CAST(NULL AS FLOAT)                     AS LOAN_AMOUNT,
    CAST(NULL AS FLOAT)                     AS REPAID_AMOUNT,
    CAST(NULL AS FLOAT)                     AS WAIVED_AMOUNT,
    CAST(NULL AS FLOAT)                     AS OUTSTANDING_AMOUNT,
    CAST(NULL AS VARCHAR)                   AS LOAN_STATUS,
    CAST(NULL AS VARCHAR)                   AS WAIVE_TODO_REF,
    CAST(NULL AS NUMBER)                    AS LOAN_AGE_DAYS,
    'RED'                                   AS FLAG,
    'ACTION'                                AS FLAG_LABEL,
    'RECOVERABLE'                           AS EXPOSURE_CLASS,
    'Payroll — charge the maid'             AS ACTION_OWNER,
    'Raise the missing charge on her payroll profile' AS ACTION_TEXT,
    p.PAID_AED                              AS AMOUNT_AED,
    TRUE                                    AS AMOUNT_IS_VALUED,
    'COMPANY'                               AS WHO_IS_OUT_OF_POCKET,
    p.TRANSACTION_DATE                      AS ANCHOR_DATE
FROM V_ILOE_PAYMENT p
LEFT JOIN DIM_MAID m ON m.MAID_ID = p.MAID_ID
WHERE p.CHARGE_CLASS = 'FINE'
  AND NOT p.IS_ACCOUNTING_ADJUSTMENT
  -- no fine loan of the post-rename type exists for this maid, at any date or amount
  AND NOT EXISTS (
        SELECT 1 FROM V_ILOE_LOAN l
        WHERE l.MAID_ID = p.MAID_ID AND l.LOAN_CLASS = 'FINES')
  -- and, for payments BEFORE the rename, no _PREMIUM loan matching the amount within
  -- AED 0.50 and dated 45 days before to 15 days after
  AND NOT EXISTS (
        SELECT 1 FROM V_ILOE_LOAN l
        WHERE l.MAID_ID = p.MAID_ID
          AND l.LOAN_CLASS = 'PREMIUM'
          AND p.IS_PRE_RENAME
          AND ABS(l.LOAN_AMOUNT - p.PAID_AED)
              <= (SELECT TO_NUMBER(VALUE) FROM REF_ILOE WHERE KEY='AMOUNT_TOL')
          AND DATEDIFF('day', p.TRANSACTION_DATE, l.BALANCE_DATE)
              BETWEEN -(SELECT TO_NUMBER(VALUE) FROM REF_ILOE WHERE KEY='R2_WINDOW_BEFORE')
                  AND  (SELECT TO_NUMBER(VALUE) FROM REF_ILOE WHERE KEY='R2_WINDOW_AFTER'))
  -- net the 4 maid-linked reversals against their payment
  AND NOT EXISTS (
        SELECT 1 FROM V_ILOE_REVERSAL r
        WHERE r.IS_MATCHABLE AND r.MAID_ID = p.MAID_ID
          AND ABS(ABS(r.REFUND_AED) - p.PAID_AED) <= 0.50)

UNION ALL

-- ---- R3 · She was charged but the money never came back ------------------------------
-- 🔴 STATUS = 'PAID' does NOT mean the money came back — it includes loans written off in
--    full. Trust the amounts. And REMAINING_AMOUNT is zero on every row in the warehouse.
SELECT
    'ILOE',
    'R3:' || TO_VARCHAR(l.LOAN_ID),
    'loan',
    'R3',
    'She was charged but the money never came back',
    l.MAID_ID,
    m.CONTRACT_TYPE,
    NULL, NULL, NULL, NULL, NULL, NULL,
    l.LOAN_ID, l.LOAN_CLASS, l.BALANCE_DATE, l.LOAN_AMOUNT,
    l.REPAID_AMOUNT, l.WAIVED_AMOUNT, l.OUTSTANDING_AMOUNT, l.LOAN_STATUS, l.WAIVE_TODO_REF,
    DATEDIFF('day', l.BALANCE_DATE, CURRENT_DATE()),
    'RED', 'ACTION', 'RECOVERABLE',
    'Payroll — charge the maid',
    'Chase the stalled charge — it is more than 60 days old and still open',
    l.OUTSTANDING_AMOUNT,
    TRUE,
    'COMPANY',
    l.BALANCE_DATE
FROM V_ILOE_LOAN l
LEFT JOIN DIM_MAID m ON m.MAID_ID = l.MAID_ID
WHERE l.LOAN_CLASS = 'FINES'
  AND l.OUTSTANDING_AMOUNT > (SELECT TO_NUMBER(VALUE) FROM REF_ILOE WHERE KEY='AMOUNT_TOL')
  AND DATEDIFF('day', l.BALANCE_DATE, CURRENT_DATE())
      > (SELECT TO_NUMBER(VALUE) FROM REF_ILOE WHERE KEY='R3_DAYS')

UNION ALL

-- ---- R4 · Waiver with no ERP to-do reference ----------------------------------------
-- WAIVE_NOTES is template-generated and ALWAYS names an approver and a reason, so
-- "no approver recorded" has zero cases by construction — THE MISSING TO-DO IS THE RULE.
-- The note carries real staff names: the to-do id is extracted in V_LOAN_LATEST and the
-- rest of the text is discarded there. It is never projected here.
SELECT
    'ILOE',
    'R4:' || TO_VARCHAR(l.LOAN_ID),
    'loan',
    'R4',
    'Waiver with no ERP to-do reference',
    l.MAID_ID,
    m.CONTRACT_TYPE,
    NULL, NULL, NULL, NULL, NULL, NULL,
    l.LOAN_ID, l.LOAN_CLASS, l.BALANCE_DATE, l.LOAN_AMOUNT,
    l.REPAID_AMOUNT, l.WAIVED_AMOUNT, l.OUTSTANDING_AMOUNT, l.LOAN_STATUS, l.WAIVE_TODO_REF,
    DATEDIFF('day', l.BALANCE_DATE, CURRENT_DATE()),
    'RED', 'ACTION', 'LOST',
    'P&C',
    'A charge was cancelled with no traceable approval. Obtain it retrospectively, or reverse the waiver',
    l.WAIVED_AMOUNT,
    TRUE,
    'COMPANY',
    l.BALANCE_DATE
FROM V_ILOE_LOAN l
LEFT JOIN DIM_MAID m ON m.MAID_ID = l.MAID_ID
WHERE l.HAS_WAIVER
  AND l.WAIVE_TODO_REF IS NULL

UNION ALL

-- ---- R1 · Subscription paid twice — INFORMATIONAL, flags nothing red -----------------
-- A same-day double payment is a DOUBLE-CLICK: every pair was created within 0–72 seconds,
-- most in the same second. It is a process defect for the process owner, not a money
-- finding, and it does NOT enter the exposure total.
--
-- 🔴 AND THE MAID IS THE ONE OUT OF POCKET, not the company. All four verified duplicates
--    carry two loans against two payments and she repaid both — the company is square.
--    Where an amount is shown it is WHAT SHE REPAID MINUS ONE SUBSCRIPTION PRICE:
--    AED 502 across the four, not 504, because AED 2 was already waived on one.
SELECT
    'ILOE',
    'R1:' || TO_VARCHAR(p.MAID_ID) || ':' || TO_VARCHAR(p.TRANSACTION_DATE),
    'maid-day',
    'R1',
    'Subscription paid twice on one day',
    p.MAID_ID,
    m.CONTRACT_TYPE,
    NULL,
    p.TRANSACTION_DATE,
    SUM(p.PAID_AED),
    MAX(p.EXPENSE_NAME),
    'SUBSCRIPTION',
    BOOLOR_AGG(p.IS_PRE_RENAME),
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'GREY', 'UNREADABLE', 'UNVALUED',
    'P&C',
    'Informational — a double-click, not a money finding. THE MAID was charged twice; check what she is owed',
    CAST(NULL AS FLOAT),                    -- never enters the exposure total
    FALSE,
    'MAID',
    p.TRANSACTION_DATE
FROM V_ILOE_PAYMENT p
LEFT JOIN DIM_MAID m ON m.MAID_ID = p.MAID_ID
WHERE p.CHARGE_CLASS = 'SUBSCRIPTION'
  -- a refund against the same maid nets the pair out — measured on maid 134727,
  -- two payments of 126 and a refund of -126: NOTHING REPORTED.
  AND NOT EXISTS (
        SELECT 1 FROM V_ILOE_REVERSAL r
        WHERE r.MAID_ID = p.MAID_ID AND r.TRANSACTION_DATE = p.TRANSACTION_DATE)
GROUP BY p.MAID_ID, m.CONTRACT_TYPE, p.TRANSACTION_DATE
HAVING COUNT(*) >= 2;


-- -------------------------------------------------------------------------------------
-- V_ILOE_BUCKET — everything reported ALONGSIDE the total, never inside it.
-- Each of these is listed and counted. None is silently dropped.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_ILOE_BUCKET AS
SELECT 'Unclassified payments' AS BUCKET, COUNT(*) AS CASES, SUM(PAID_AED) AS AED,
       'Reported, never dropped. A rising count IS the signal that a naming change happened.' AS NOTE
FROM V_ILOE_PAYMENT WHERE CHARGE_CLASS = 'UNCLASSIFIED' AND NOT IS_ACCOUNTING_ADJUSTMENT
UNION ALL
SELECT 'Unmatched reversals', COUNT(*), SUM(REFUND_AED),
       'Name a staff member and a date, not a transaction — cannot be matched mechanically'
FROM V_ILOE_REVERSAL WHERE NOT IS_MATCHABLE
UNION ALL
SELECT 'Excluded and named: accounting adjustment', COUNT(*), SUM(PAID_AED),
       'One OLD DIFFERENCE row'
FROM V_ILOE_PAYMENT WHERE IS_ACCOUNTING_ADJUSTMENT
UNION ALL
SELECT 'Bulk payments with no maid attached', COUNT(*), SUM(t.TRANSACTION_AMOUNT),
       'ILOE money on a HOUSEMAID head with no maid id — outside every rule by construction'
FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t
WHERE t.EXPENSE ILIKE '%ILOE%' AND t.TRANSACTION_TYPE = 'Expense' AND t.HOUSEMAID_ID IS NULL
UNION ALL
SELECT 'Excluded and named: office staff', COUNT(*), SUM(t.TRANSACTION_AMOUNT),
       'Standing decision 2026-09-12 — out of scope, and excluded two independent ways that agree'
FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t
WHERE t.EXPENSE ILIKE '%ILOE%' AND t.TRANSACTION_TYPE = 'Expense'
  AND COALESCE(t.RELATED_TO,'') <> 'HOUSEMAID';


-- -------------------------------------------------------------------------------------
-- THE TIE-OUT. This identity MUST appear on the report:
--
--   total paid in fines = charged to a maid + charged to nobody
--   AED 1,163,242.82    = AED 587,351.55   + AED 575,891.27      variance AED 0.00
--
-- "If it does not close, the gap is itself an exception row."
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_ILOE_TIEOUT AS
SELECT
    (SELECT SUM(PAID_AED) FROM V_ILOE_PAYMENT
      WHERE CHARGE_CLASS='FINE' AND NOT IS_ACCOUNTING_ADJUSTMENT)         AS TOTAL_FINES_PAID,
    (SELECT SUM(LOAN_AMOUNT) FROM V_ILOE_LOAN WHERE LOAN_CLASS='FINES')   AS CHARGED_TO_A_MAID,
    (SELECT SUM(AMOUNT_AED) FROM V_CASES_ILOE WHERE RULE_ID='R2')         AS CHARGED_TO_NOBODY,
    (SELECT SUM(PAID_AED) FROM V_ILOE_PAYMENT
      WHERE CHARGE_CLASS='FINE' AND NOT IS_ACCOUNTING_ADJUSTMENT)
      - COALESCE((SELECT SUM(LOAN_AMOUNT) FROM V_ILOE_LOAN WHERE LOAN_CLASS='FINES'),0)
      - COALESCE((SELECT SUM(AMOUNT_AED) FROM V_CASES_ILOE WHERE RULE_ID='R2'),0)
                                                                          AS VARIANCE_AED;
