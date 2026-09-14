-- =====================================================================================
-- Visa Expense Audit — 23 · Medical fitness test refunds
-- Source spec: SPEC_medical_from_visa_expenses_v1 (v4, Abdullah Mahdi, 2026-09-12)
--
-- We pay ~AED 270–323 for a maid's medical fitness test application. If she never
-- attends, the application expires and AED 220 (pre-2026) / AED 270 (2026 on) can be
-- claimed back. This finds what we paid and never got back.
--
-- ROOT CAUSE, WHICH BELONGS ON THE TAB: the refund is not filed by a person. It is filed
-- by a ROBOT. Where the refund step exists the money usually returns (81.2% of clean
-- cases, 92.9% of failed ones show the step); where it does not, nothing happens — only
-- 2.3% of never-claimed cases have it. THE ABSENCE OF THE STEP IS THE FAILURE.
-- But VPMGOV-1211 (outside-country cancellation) explains only 11 of 132 — 8.3%.
-- Fixing that ticket will not close this audit.
--
-- 🔴 AND THE LEAK IS RE-OPENING. Share of eligible cases ending with no refund, by
--    quarter of the fee: 3.5% (2025 Q2 low) -> 4.7 -> 7.1 -> 7.8 -> 11.6% (2026 Q2).
--    Five consecutive rises, 3.3x the low. This is a regression to escalate, not a
--    sealed leak to monitor. The quarter trend is a REQUIRED chart on this tab.
-- =====================================================================================

USE SCHEMA POLICE_CONTROL.VISA_AUDIT;


CREATE OR REPLACE VIEW REF_MEDICAL (KEY, VALUE, NOTE) AS
SELECT * FROM VALUES
    ('PURPOSE_FEE_NEW',   'MEDICAL',                          'initial visa journey — reads INITIAL_VISA_REQUESTS(_TASKS)'),
    ('PURPOSE_FEE_RENEW', 'MEDICAL_RENEW',                    'renewal journey — reads RENEW_VISA_REQUESTS(_TASKS)'),
    ('PURPOSE_REFUND',    'REFUND_MEDICAL_APPLICATION_FEES',  'the refund line'),
    ('WAIT_TASK',         'Waiting for the maid to go to medical test and EID fingerprinting',
                          'the 90-day clock, and the POPULATION ANCHOR'),
    ('REFUND_STEP_TASK',  'Refund Medical Application',       'on the cancellation request — the root-cause tag'),
    ('CLOCK_DAYS',        '90',
     'MEASURED, not chosen: 98.8% of 1,416 received refunds arrive within 90 days (median 26, p75 46). 60 is the house window for other visa refunds; medical is a deliberate exception.')
AS t(KEY, VALUE, NOTE);


-- -------------------------------------------------------------------------------------
-- The medical fee. Scope gate is EMPLOYEE_TYPE = 'maid' — office staff are 824 rows in
-- this table and that filter alone removes them.
--
-- ⚠️ EXCLUDE, do not clamp, the two out-of-band amounts: AED 720,000,701,943 (2025-02-03)
--    and AED -220 (2025-04-10, a refund booked under the fee purpose). Clamping the first
--    to a ceiling keeps it in and counts it as a finding.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_MED_FEE AS
SELECT
    e.VISA_REQUEST_ID,
    e.PURPOSE,
    CASE WHEN e.PURPOSE = (SELECT VALUE FROM REF_MEDICAL WHERE KEY='PURPOSE_FEE_RENEW')
         THEN 'RENEWAL' ELSE 'NEW' END      AS VISA_STAGE,
    -- 🔴 TRAP 8: visa-request ids COLLIDE across the three request types — 19,997 renewal
    --    ids are also initial ids. Every request-keyed join needs the TYPE as well.
    --    Reading "either table by id" inflated the eligible population from 1,153 to 1,211
    --    and never-claimed from 132 to 188 — a 42% overstatement that looks like a bigger
    --    finding rather than a bug.
    CASE WHEN e.PURPOSE = (SELECT VALUE FROM REF_MEDICAL WHERE KEY='PURPOSE_FEE_RENEW')
         THEN 1 ELSE 0 END                  AS REQUEST_TYPE_ID,      -- 0 initial · 1 renewal · 2 cancellation
    e.OWNER_ID                              AS MAID_ID,
    UPPER(TRIM(e.CONTRACT_TYPE))            AS CONTRACT_TYPE,        -- 🔴 trailing space
    e.STATUS                                AS FEE_STATUS,
    e.AMOUNT                                AS FEE_AED,
    e.CREATION_DATE                         AS FEE_TS,               -- TIMESTAMP_NTZ, Gulf Standard Time
    CAST(e.CREATION_DATE AS DATE)           AS FEE_DATE,
    -- The rate boundary is the TIMESTAMP: a fee at 2025-12-31 23:30 is a 220 case.
    FN_PRICE_AT('MEDICAL','REFUND_RATE', CAST(e.CREATION_DATE AS DATE)) AS REFUNDABLE_AED
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
WHERE e.PURPOSE IN (SELECT VALUE FROM REF_MEDICAL WHERE KEY LIKE 'PURPOSE_FEE_%')
  AND e.EMPLOYEE_TYPE = 'maid'
  AND e.AMOUNT BETWEEN 1 AND 5000;          -- excludes the two out-of-band rows


-- -------------------------------------------------------------------------------------
-- TEST 1 — the population anchor. She is still waiting.
--
-- 🔴 Without this the eligible population is 13,971 instead of 1,153, because every
--    historical medical fee ever paid qualifies on the other four tests.
-- 🔴 TRAP 7: the renewal task table RE-FIRES up to 1,909 iterations per request —
--    335,583 ONGOING rows sit on just 2,120 distinct requests. Counting rows overstates
--    that population by 158x. Always aggregate to one row per VISA_REQUEST_ID first.
-- 🔴 The task row must EXIST, not merely lack a completion date: "never completed" is
--    silently true when there is no task at all, and that reading adds 126 cases.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_MED_WAIT_TASK AS
SELECT VISA_REQUEST_ID, 0 AS REQUEST_TYPE_ID,
       MIN(CAST(STARTED_AT AS DATE))        AS WAIT_STARTED,
       MAX(CAST(COMPLETED_AT AS DATE))      AS WAIT_COMPLETED,   -- NULL on ANY iteration => never completed
       COUNT(*)                             AS TASK_ITERATIONS
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS
WHERE TASK_NAME = (SELECT VALUE FROM REF_MEDICAL WHERE KEY='WAIT_TASK')
GROUP BY VISA_REQUEST_ID
UNION ALL
SELECT VISA_REQUEST_ID, 1,
       MIN(CAST(STARTED_AT AS DATE)),
       MAX(CAST(COMPLETED_AT AS DATE)),
       COUNT(*)
FROM BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS_TASKS
WHERE TASK_NAME = (SELECT VALUE FROM REF_MEDICAL WHERE KEY='WAIT_TASK')
GROUP BY VISA_REQUEST_ID;


-- -------------------------------------------------------------------------------------
-- TEST 3 — attendance. MEDICAL_RESULT is the ONLY field that decides it, on both halves.
--
-- Three fields that look usable and are not:
--   MEDICAL_DOCUMENT_ISSUE_DATE  populated for 100.0% who attended AND 98.8% who did not.
--                                It is the APPLICATION date, not the result.
--   FIRST_SAMPLE_DATE            NULL on 100% of renewal rows (0 of 20,597); 1.3% of initial.
--   MAID_PRESENT_IN_MEDICAL      exists only on RENEW_VISA_REQUESTS, is NUMBER 0/1 and
--                                never NULL — `IS NOT NULL` clears nothing and `= false`
--                                will not compile.
-- MEDICAL_RESULT is genuinely NULL (111,389 of 123,276 initial rows), never an empty
-- string. Test IS NULL; `<> ''` clears nothing.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_MED_ATTENDANCE AS
SELECT REQUEST_ID AS VISA_REQUEST_ID, 0 AS REQUEST_TYPE_ID, MEDICAL_RESULT
FROM BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS
UNION ALL
SELECT REQUEST_ID, 1, MEDICAL_RESULT
FROM BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS;


-- -------------------------------------------------------------------------------------
-- TEST 5 — the refund.
--
-- 🔴 TRAP 1: THE REFUND DOES NOT SHARE A VISA REQUEST ID WITH THE FEE. Only 2.3% of pairs
--    do. The fee sits on the initial/renewal request; the refund on the CANCELLATION
--    request. Join fee to refund on the MAID ID, never on VISA_REQUEST_ID. Getting this
--    wrong reports ~98% of cases as unrefunded.
-- 🔴 TRAP 2: STATUS is load-bearing. A Dismissed refund is money that never came back and
--    does NOT clear a case (149 rows); a Pending one is in flight (120 rows). And NO
--    `Added` refund is ever AED 0 — all 75 zero-amount refunds are Dismissed, which is why
--    the test needs the amount clause as well as the status clause.
-- 🔴 Sign convention: refund amounts are negative on 1,164 of 1,424 Added rows and
--    POSITIVE on the other 260. Always ABS() — summing raw cancels them against each other.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_MED_REFUND AS
SELECT
    e.OWNER_ID                              AS MAID_ID,
    e.VISA_REQUEST_ID                       AS REFUND_ON_REQUEST_ID,
    e.STATUS                                AS REFUND_STATUS,
    ABS(e.AMOUNT)                           AS REFUND_AED,
    CAST(e.CREATION_DATE AS DATE)           AS REFUND_DATE,
    e.CREATION_DATE                         AS REFUND_TS,
    (e.STATUS = 'Added' AND ABS(e.AMOUNT) > 0) AS MONEY_CAME_BACK
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
WHERE e.PURPOSE = (SELECT VALUE FROM REF_MEDICAL WHERE KEY='PURPOSE_REFUND')
  AND e.EMPLOYEE_TYPE = 'maid';


-- -------------------------------------------------------------------------------------
-- Root cause, deduped. 🔴 TRAP 6: a maid can have SEVERAL cancellation requests, so a
-- naive join fans out — 132 findings become 185 rows, and ranking causes on the fanned-out
-- rows makes the small buckets look big. Take the maid's LATEST cancellation only.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_MED_ROOT_CAUSE AS
SELECT
    c.MAID_ID,
    c.REQUEST_ID                            AS CANCEL_REQUEST_ID,
    c.VISA_CANCELLATION_TYPE                AS CANCELLATION_TYPE,
    BOOLOR_AGG(tk.TASK_NAME IS NOT NULL)    AS HAS_REFUND_STEP
FROM BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS c
LEFT JOIN BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS_TASKS tk
       ON tk.VISA_REQUEST_ID = c.REQUEST_ID
      AND tk.TASK_NAME = (SELECT VALUE FROM REF_MEDICAL WHERE KEY='REFUND_STEP_TASK')
GROUP BY c.MAID_ID, c.REQUEST_ID, c.VISA_CANCELLATION_TYPE
QUALIFY ROW_NUMBER() OVER (PARTITION BY c.MAID_ID
                           ORDER BY c.REQUEST_ID DESC) = 1;      -- the LATEST cancellation


-- -------------------------------------------------------------------------------------
-- V_CASES_MEDICAL — audit 1. One case = one medical fee, one maid, one visa request.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_CASES_MEDICAL AS
WITH eligible AS (
    SELECT
        f.*,
        w.WAIT_STARTED,
        w.WAIT_COMPLETED,
        w.TASK_ITERATIONS,
        a.MEDICAL_RESULT,
        DATEDIFF('day', f.FEE_DATE, CURRENT_DATE())  AS AGE_DAYS
    FROM V_MED_FEE f
    JOIN V_MED_WAIT_TASK w                                    -- test 1: the task must EXIST
      ON w.VISA_REQUEST_ID = f.VISA_REQUEST_ID
     AND w.REQUEST_TYPE_ID = f.REQUEST_TYPE_ID                -- 🔴 trap 8
    LEFT JOIN V_MED_ATTENDANCE a
      ON a.VISA_REQUEST_ID = f.VISA_REQUEST_ID
     AND a.REQUEST_TYPE_ID = f.REQUEST_TYPE_ID
    WHERE w.WAIT_COMPLETED IS NULL                            -- test 1: never completed
      AND f.FEE_STATUS = 'Added'                              -- test 2: we paid
      AND a.MEDICAL_RESULT IS NULL                            -- test 3: she did not attend
      AND DATEDIFF('day', f.FEE_DATE, CURRENT_DATE())
          >= (SELECT TO_NUMBER(VALUE) FROM REF_MEDICAL WHERE KEY='CLOCK_DAYS')   -- test 4
), matched AS (
    SELECT
        e.*,
        -- "Which refund clears which fee": match a refund to the NEAREST PRECEDING fee for
        -- that maid. A refund NEVER clears a fee dated after it. 146 maids hold more than
        -- one medical fee since Jan 2025 (143 with two, 2 with three, 1 with four).
        r.REFUND_STATUS,
        r.REFUND_AED,
        r.REFUND_DATE,
        r.MONEY_CAME_BACK
    FROM eligible e
    LEFT JOIN V_MED_REFUND r
           ON r.MAID_ID = e.MAID_ID                           -- 🔴 trap 1: on the MAID
          AND r.REFUND_TS >= e.FEE_TS
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY e.VISA_REQUEST_ID, e.REQUEST_TYPE_ID, e.FEE_TS
        ORDER BY r.MONEY_CAME_BACK DESC NULLS LAST, r.REFUND_TS ASC
    ) = 1
)
SELECT
    'MEDICAL'                               AS AUDIT_CODE,
    TO_VARCHAR(m.VISA_REQUEST_ID) || '.' || TO_VARCHAR(m.REQUEST_TYPE_ID)
        || ':' || TO_VARCHAR(m.FEE_TS)      AS CASE_ID,
    'fee'                                   AS CASE_GRAIN,
    m.VISA_REQUEST_ID,
    m.REQUEST_TYPE_ID,
    m.MAID_ID,
    COALESCE(m.CONTRACT_TYPE,'UNKNOWN')     AS CONTRACT_TYPE,
    m.VISA_STAGE,
    m.PURPOSE,
    m.FEE_DATE,
    m.FEE_AED,
    m.REFUNDABLE_AED,
    m.AGE_DAYS,
    m.TASK_ITERATIONS,
    m.WAIT_STARTED,
    m.REFUND_STATUS,
    m.REFUND_AED,
    m.REFUND_DATE,
    rc.CANCELLATION_TYPE,
    rc.HAS_REFUND_STEP,
    (rc.MAID_ID IS NULL)                    AS NO_CANCELLATION_AT_ALL,   -- 14 findings, 11%
    DATE_TRUNC('quarter', m.FEE_DATE)       AS FEE_QUARTER,
    v.VERIFIER_VERDICT, v.VERIFIER_CATEGORY, v.REDACTED_QUOTE,

    CASE WHEN m.MONEY_CAME_BACK                         THEN 'CLEAN'
         WHEN m.REFUND_STATUS = 'Pending'               THEN 'REFUND_PENDING'
         WHEN m.REFUND_STATUS = 'Dismissed'
              OR (m.REFUND_STATUS = 'Added' AND COALESCE(m.REFUND_AED,0) = 0)
                                                        THEN 'REFUND_FAILED'
         ELSE                                                'REFUND_NEVER_CLAIMED'
    END                                     AS VERDICT,
    CASE WHEN m.MONEY_CAME_BACK                         THEN 'CLEAN'
         WHEN m.REFUND_STATUS = 'Pending'               THEN 'M1_PENDING'
         WHEN m.REFUND_STATUS = 'Dismissed'
              OR (m.REFUND_STATUS = 'Added' AND COALESCE(m.REFUND_AED,0) = 0)
                                                        THEN 'M1_FAILED'
         ELSE                                                'M1_NEVER'
    END                                     AS RULE_ID,
    CASE WHEN m.MONEY_CAME_BACK                         THEN 'Clean — refund received'
         WHEN m.REFUND_STATUS = 'Pending'               THEN 'Refund pending — hold, do not action'
         WHEN m.REFUND_STATUS = 'Dismissed'
              OR (m.REFUND_STATUS = 'Added' AND COALESCE(m.REFUND_AED,0) = 0)
                                                        THEN 'Refund failed — raised then dismissed, or booked at AED 0'
         ELSE                                                'Refund never claimed — nothing was ever filed'
    END                                     AS RULE_NAME,
    CASE WHEN m.MONEY_CAME_BACK                         THEN 'GREEN'
         WHEN m.REFUND_STATUS = 'Pending'               THEN 'AMBER'
         WHEN v.VERIFIER_VERDICT = 'NOT_READ'           THEN 'GREY'
         ELSE                                                'RED' END  AS FLAG,
    CASE WHEN m.MONEY_CAME_BACK                         THEN 'CLEAN'
         WHEN m.REFUND_STATUS = 'Pending'               THEN 'HOLD'
         WHEN v.VERIFIER_VERDICT = 'NOT_READ'           THEN 'UNREADABLE'
         ELSE                                                'ACTION' END AS FLAG_LABEL,
    CASE WHEN m.MONEY_CAME_BACK                         THEN 'NOT_A_FINDING'
         WHEN m.REFUND_STATUS = 'Pending'               THEN 'UNDECIDED'
         ELSE                                                'RECOVERABLE' END AS EXPOSURE_CLASS,
    -- The row's action is engineering as often as it is a claim: the robot is the cause.
    CASE WHEN m.MONEY_CAME_BACK OR m.REFUND_STATUS = 'Pending' THEN NULL
         WHEN NOT COALESCE(rc.HAS_REFUND_STEP, FALSE)   THEN 'Engineering'
         ELSE                                                'Visa team' END AS ACTION_OWNER,
    CASE WHEN m.MONEY_CAME_BACK                         THEN NULL
         WHEN m.REFUND_STATUS = 'Pending'               THEN 'In flight — hold, do not action'
         WHEN NOT COALESCE(rc.HAS_REFUND_STEP, FALSE)
              THEN 'The refund step was never created. Send to the Visa team to claim if the portal still allows it, AND log the failure against the robot'
         ELSE 'Send to the Visa team to claim the refund if the portal still allows it'
    END                                     AS ACTION_TEXT,
    -- M1 counts never-claimed + refund-failed, each at its era rate. PENDING IS EXCLUDED —
    -- that money is not lost yet.
    CASE WHEN m.MONEY_CAME_BACK OR m.REFUND_STATUS = 'Pending' THEN NULL
         ELSE m.REFUNDABLE_AED END          AS AMOUNT_AED,
    TRUE                                    AS AMOUNT_IS_VALUED,
    'COMPANY'                               AS WHO_IS_OUT_OF_POCKET,
    m.FEE_DATE                              AS ANCHOR_DATE,
    'medical fee CREATION_DATE (Gulf Standard Time — it also carries the rate boundary)' AS ANCHOR_DATE_MEANING,
    DATEADD('day', 90, m.FEE_DATE)          AS DEADLINE_DATE
FROM matched m
LEFT JOIN V_MED_ROOT_CAUSE  rc ON rc.MAID_ID = m.MAID_ID
LEFT JOIN V_VERIFIER_LATEST v
       ON v.AUDIT_CODE = 'MEDICAL'
      AND v.CASE_ID = TO_VARCHAR(m.VISA_REQUEST_ID) || '.' || TO_VARCHAR(m.REQUEST_TYPE_ID)
                      || ':' || TO_VARCHAR(m.FEE_TS);


-- -------------------------------------------------------------------------------------
-- V_CASES_MEDICAL_NO_FEE — the fourth verdict, counted but NOT valued.
--
-- 1,288 visa requests have waited past 90 days since January 2025 and 119 of them carry NO
-- medical fee at all. Either she is waiting for a test nobody paid for, or the charge was
-- never booked. It has no refund to lose, so it carries no AED — but it is a real red flag,
-- it is the shape the process owner's own daily runs flag by hand, and a report anchored
-- on the expense table CANNOT SEE IT BY CONSTRUCTION. That is why it is its own view.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_CASES_MEDICAL_NO_FEE AS
SELECT
    'MEDICAL'                               AS AUDIT_CODE,
    'NOFEE:' || TO_VARCHAR(w.VISA_REQUEST_ID) || '.' || TO_VARCHAR(w.REQUEST_TYPE_ID) AS CASE_ID,
    'visa request'                          AS CASE_GRAIN,
    w.VISA_REQUEST_ID,
    w.REQUEST_TYPE_ID,
    CASE w.REQUEST_TYPE_ID WHEN 1 THEN 'RENEWAL' ELSE 'NEW' END AS VISA_STAGE,
    w.WAIT_STARTED,
    DATEDIFF('day', w.WAIT_STARTED, CURRENT_DATE())  AS AGE_DAYS,
    'M1_NO_FEE'                             AS RULE_ID,
    'No medical fee charged — she is waiting for a test nobody paid for' AS RULE_NAME,
    'RED'                                   AS FLAG,
    'ACTION'                                AS FLAG_LABEL,
    'UNVALUED'                              AS EXPOSURE_CLASS,
    'P&C'                                   AS ACTION_OWNER,
    'Find out whether the test was never bought or the charge was never booked' AS ACTION_TEXT,
    CAST(NULL AS FLOAT)                     AS AMOUNT_AED,   -- no refund to lose. NULL, never 0.
    FALSE                                   AS AMOUNT_IS_VALUED,
    w.WAIT_STARTED                          AS ANCHOR_DATE
FROM V_MED_WAIT_TASK w
LEFT JOIN V_MED_FEE f
       ON f.VISA_REQUEST_ID = w.VISA_REQUEST_ID
      AND f.REQUEST_TYPE_ID = w.REQUEST_TYPE_ID
WHERE w.WAIT_COMPLETED IS NULL
  AND DATEDIFF('day', w.WAIT_STARTED, CURRENT_DATE()) >= 90
  AND f.VISA_REQUEST_ID IS NULL             -- no fee at ANY status
  AND w.WAIT_STARTED >= DATE'2025-01-01';


-- -------------------------------------------------------------------------------------
-- V_CASES_MEDICAL_DUP — audit 2. Two medical fees, both Added, same maid, SAME visa
-- request, within 90 days of each other.
--
-- Ship this half as a LOW-VOLUME MONITOR, not a money-recovery audit: 6 pairs in twenty
-- months is a control that is working. (261 pairs sit before 2025 and are out of scope.)
-- AED at risk = the era refund rate for the date of the SECOND fee.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_CASES_MEDICAL_DUP AS
WITH pairs AS (
    SELECT
        a.MAID_ID, a.VISA_REQUEST_ID, a.CONTRACT_TYPE,
        a.FEE_TS AS FIRST_FEE_TS, b.FEE_TS AS SECOND_FEE_TS,
        a.FEE_AED AS FIRST_FEE_AED, b.FEE_AED AS SECOND_FEE_AED,
        DATEDIFF('day', a.FEE_DATE, b.FEE_DATE) AS GAP_DAYS,
        b.REFUNDABLE_AED
    FROM V_MED_FEE a
    JOIN V_MED_FEE b
      ON b.MAID_ID = a.MAID_ID
     AND b.VISA_REQUEST_ID = a.VISA_REQUEST_ID
     AND b.REQUEST_TYPE_ID = a.REQUEST_TYPE_ID
     AND b.FEE_TS > a.FEE_TS
     AND DATEDIFF('day', a.FEE_DATE, b.FEE_DATE) <= 90
    WHERE a.FEE_STATUS = 'Added' AND b.FEE_STATUS = 'Added'
)
SELECT
    'MEDICAL'                               AS AUDIT_CODE,
    'DUP:' || TO_VARCHAR(p.VISA_REQUEST_ID) || ':' || TO_VARCHAR(p.SECOND_FEE_TS) AS CASE_ID,
    'pair'                                  AS CASE_GRAIN,
    p.MAID_ID, p.VISA_REQUEST_ID, p.CONTRACT_TYPE,
    p.FIRST_FEE_TS, p.SECOND_FEE_TS, p.FIRST_FEE_AED, p.SECOND_FEE_AED, p.GAP_DAYS,
    (r.MAID_ID IS NULL)                     AS UNREFUNDED,
    'M4_DUP'                                AS RULE_ID,
    'Duplicate medical payment — same maid, same visa request, within 90 days' AS RULE_NAME,
    CASE WHEN r.MAID_ID IS NULL THEN 'RED' ELSE 'GREEN' END   AS FLAG,
    CASE WHEN r.MAID_ID IS NULL THEN 'ACTION' ELSE 'CLEAN' END AS FLAG_LABEL,
    CASE WHEN r.MAID_ID IS NULL THEN 'LOST' ELSE 'NOT_A_FINDING' END AS EXPOSURE_CLASS,
    'P&C'                                   AS ACTION_OWNER,
    'One application, two fees. No refund route — find out how it happened' AS ACTION_TEXT,
    CASE WHEN r.MAID_ID IS NULL THEN p.REFUNDABLE_AED END     AS AMOUNT_AED,
    TRUE                                    AS AMOUNT_IS_VALUED,
    CAST(p.SECOND_FEE_TS AS DATE)           AS ANCHOR_DATE
FROM pairs p
LEFT JOIN (SELECT DISTINCT MAID_ID FROM V_MED_REFUND WHERE MONEY_CAME_BACK) r
       ON r.MAID_ID = p.MAID_ID;
