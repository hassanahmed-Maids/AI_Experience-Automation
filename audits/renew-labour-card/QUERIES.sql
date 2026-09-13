-- ============================================================================
-- Renew Labour Card — discovery + candidate-finding query pack
-- Snowflake, read-only, AD HOC ONLY. Do not schedule any of these.
-- Written 2026-09-13 against column names verified by DESC VIEW on
--   BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
--   BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS
--   BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS_TASKS
--   BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS
-- Anything marked [UNVERIFIED] was NOT read back from a DESC in this session.
--
-- RUN ORDER: D0 → D6 first. They decide whether F1–F7 mean anything.
-- If a D query contradicts an assumption below, fix the assumption before
-- running the F queries — do not "work around" it.
--
-- PRIVACY: VISAREQUESTEXPENSES.DESCRIPTION and EMPLOYEE_NAME carry personal
-- data (the sibling E-ID audit measured passport numbers inside DESCRIPTION
-- from 2026-01 onward). No query below selects them. Keep it that way:
-- report ids, counts, dates and money only.
--
-- STANDING GUARDS used throughout, each with its reason:
--   AMOUNT BETWEEN 0 AND 100000   -- profiled max is ~19.7 trillion (data bug)
--   PAYMENT_DATE > '1900-01-01'   -- sentinel minimum is 0025-11-06
--   PURPOSE = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'  -- the ERP enum's own typo
--   REQUEST_TYPE = 'RenewRequest'
--   TRIM(CONTRACT_TYPE)           -- values are 'CC ' / 'MV ' with a trailing space
-- NOT used, deliberately:
--   IS_DELETED filters. On VISAREQUESTEXPENSES the column is only ever '0';
--   on RENEW_VISA_REQUESTS it is '00'/'01' and the '01' rows are NOT filtered
--   upstream. Two views, two conventions — D4 prices them instead of assuming.
-- ============================================================================


-- ============================================================================
-- D0 · Does the purpose exist, and is the typo the only spelling?
-- Kills the whole pack if the enum value differs. Also shows every sibling
-- labour-card purpose so nothing is audited under the wrong name.
-- ============================================================================
SELECT PURPOSE,
       REQUEST_TYPE,
       COUNT(*)                                        AS n,
       ROUND(MEDIAN(AMOUNT), 2)                        AS median_amt,
       MIN(CREATION_DATE)::DATE                        AS first_seen,
       MAX(CREATION_DATE)::DATE                        AS last_seen
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE PURPOSE ILIKE '%LABOR%' OR PURPOSE ILIKE '%LABOUR%' OR PURPOSE ILIKE '%TASHEEL%'
GROUP BY 1, 2
ORDER BY n DESC;


-- ============================================================================
-- D1 · Volume and spend by month, split the three ways that matter.
-- Cross-check against the company expense report (Dec-25→Feb-26: MV 907,
-- CC 291, OfficeStaff 15 payments, AED 1,465,995). If this disagrees by more
-- than rounding, one of the two populations is wrong — find out which BEFORE
-- quoting either.
-- ============================================================================
SELECT DATE_TRUNC('month', CREATION_DATE)::DATE        AS month,
       TRIM(CONTRACT_TYPE)                             AS contract_type,
       OWNER_TYPE,
       STATUS,
       COUNT(*)                                        AS n,
       ROUND(SUM(AMOUNT), 2)                           AS total_aed
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE REQUEST_TYPE = 'RenewRequest'
  AND PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
  AND AMOUNT BETWEEN 0 AND 100000
  AND CREATION_DATE >= DATEADD('month', -24, CURRENT_DATE())
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC, 5 DESC;


-- ============================================================================
-- D2 · Amount distribution — is it really one flat tariff?
-- Expected: 1,208.57 dominant, 1,211.72 as the channel variant.
-- Anything else is either a fine riding on the fee, a partial, or a reversal.
-- This is what decides whether an "overspend" rule is worth writing at all.
-- ============================================================================
SELECT ROUND(AMOUNT, 2)                                AS amount,
       COUNT(*)                                        AS n,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct,
       MIN(CREATION_DATE)::DATE                        AS first_seen,
       MAX(CREATION_DATE)::DATE                        AS last_seen
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE REQUEST_TYPE = 'RenewRequest'
  AND PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
GROUP BY 1
ORDER BY n DESC
LIMIT 50;


-- ============================================================================
-- D3 · Grain. One expense row per renewal request, or not?
-- F2 (duplicate payment) is only meaningful once this is known, and a
-- legitimate multi-row shape here would change the whole case definition.
-- ============================================================================
SELECT rows_per_request,
       COUNT(*)                                        AS requests,
       ROUND(SUM(rows_per_request * 1208.57), 2)       AS notional_aed_at_tariff
FROM (
    SELECT VISA_REQUEST_ID, COUNT(*) AS rows_per_request
    FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
    WHERE REQUEST_TYPE = 'RenewRequest'
      AND PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
      AND AMOUNT BETWEEN 0 AND 100000
    GROUP BY 1
)
GROUP BY 1
ORDER BY 1;


-- ============================================================================
-- D4 · Hygiene: statuses, payment channel, missing payment links, sentinels,
-- and the delete-flag vocabulary. Every column here has bitten a sibling check.
-- ============================================================================
SELECT STATUS,
       PAYMENT_TYPE,
       IS_DELETED,
       COUNT(*)                                                    AS n,
       COUNT_IF(TRANSACTION_ID IS NULL)                            AS no_transaction_id,
       COUNT_IF(NULLIF(TRIM(REFERENCE_NUMBER), '') IS NULL)        AS no_reference_number,
       COUNT_IF(PAYMENT_DATE IS NULL)                              AS no_payment_date,
       COUNT_IF(PAYMENT_DATE <= '1900-01-01')                      AS sentinel_payment_date,
       COUNT_IF(AMOUNT NOT BETWEEN 0 AND 100000)                   AS amount_out_of_range,
       COUNT_IF(CARD_DETAIL_ID IS NOT NULL)                        AS card_paid
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE REQUEST_TYPE = 'RenewRequest'
  AND PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
GROUP BY 1, 2, 3
ORDER BY n DESC;


-- ============================================================================
-- D5 · Join viability. Zero joined rows means a type mismatch, not a business
-- fact — check before believing any absence in F1–F5.
--   (a) expense → renewal request header
--   (b) expense → money-control transaction
-- ============================================================================
-- (a)
SELECT COUNT(*)                                        AS expense_rows,
       COUNT(r.REQUEST_ID)                             AS matched_to_request,
       COUNT(*) - COUNT(r.REQUEST_ID)                  AS orphan_expenses
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
LEFT JOIN BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS r
       ON r.REQUEST_ID = e.VISA_REQUEST_ID
WHERE e.REQUEST_TYPE = 'RenewRequest'
  AND e.PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION';

-- (b)
SELECT COUNT(*)                                        AS expense_rows,
       COUNT_IF(e.TRANSACTION_ID IS NOT NULL)          AS with_txn_id,
       COUNT(t.ID)                                     AS matched_to_transaction,
       COUNT_IF(e.TRANSACTION_ID IS NOT NULL) - COUNT(t.ID) AS txn_id_set_but_unmatched,
       COUNT_IF(t.HOUSEMAID_ID IS NULL AND t.ID IS NOT NULL) AS matched_but_no_maid_on_txn
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t
       ON t.ID = e.TRANSACTION_ID
WHERE e.REQUEST_TYPE = 'RenewRequest'
  AND e.PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION';


-- ============================================================================
-- D6 · Price what any window would exclude (pattern P-6).
-- Run this before choosing a reporting window, and keep the answer in the
-- coverage statement — an excluded slice that nobody ever examined is not
-- "clean", it is unexamined.
-- ============================================================================
SELECT CASE WHEN CREATION_DATE > CURRENT_DATE()                              THEN 'FUTURE-dated'
            WHEN CREATION_DATE < DATEADD('month', -12, CURRENT_DATE())       THEN 'older than 12 months'
            ELSE 'inside the last 12 months' END       AS dating,
       COUNT(*)                                        AS n,
       ROUND(SUM(AMOUNT), 2)                           AS total_aed,
       MIN(CREATION_DATE)::DATE                        AS earliest,
       MAX(CREATION_DATE)::DATE                        AS latest
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE REQUEST_TYPE = 'RenewRequest'
  AND PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
  AND AMOUNT BETWEEN 0 AND 100000
GROUP BY 1
ORDER BY n DESC;


-- ============================================================================
-- F1 · Paid, and the renewal never produced a renewed labour card.
-- The headline candidate. Outcome classes are deliberately more than two:
-- a case still legitimately in flight is PENDING, never clean and never red.
--
-- POSITIVE CONTROL (pattern P-5) is built in: `completed_with_new_card` must
-- come back large. If it is ~0, RENEWED_LABOR_CARD_EXPIRY_DATE is not the
-- field that records success and the whole test is VOID, not negative.
-- ============================================================================
WITH lc AS (
    SELECT e.VISA_REQUEST_ID,
           MIN(e.CREATION_DATE)                        AS first_paid_at,
           SUM(e.AMOUNT)                               AS paid_aed,
           COUNT(*)                                    AS payments
    FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
    WHERE e.REQUEST_TYPE = 'RenewRequest'
      AND e.PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
      AND e.STATUS       = 'Added'          -- Dismissed/Pending priced separately in D4
      AND e.AMOUNT BETWEEN 0 AND 100000
    GROUP BY 1
),
final_step AS (                              -- did the case reach the step that records the new card?
    SELECT VISA_REQUEST_ID,
           MAX(IFF(TASK_NAME = 'Insert Renewed Labour Card Expiry Date'
                   AND COMPLETED_AT IS NOT NULL, 1, 0)) AS insert_step_completed
    FROM BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS_TASKS
    GROUP BY 1
)
SELECT r.REQUEST_STATUS,
       CASE WHEN r.RENEWED_LABOR_CARD_EXPIRY_DATE IS NOT NULL THEN 'new card recorded'
            WHEN COALESCE(f.insert_step_completed, 0) = 1     THEN 'step done, no card date'
            ELSE 'no new card' END                     AS card_outcome,
       COUNT(*)                                        AS cases,
       ROUND(SUM(lc.paid_aed), 2)                      AS paid_aed,
       ROUND(MEDIAN(DATEDIFF('day', lc.first_paid_at, COALESCE(r.STOPPED_COMPLETED_DATE, CURRENT_DATE()))), 0)
                                                       AS median_days_paid_to_close,
       COUNT_IF(r.IS_DELETED = '01')                   AS soft_deleted_requests
FROM lc
JOIN BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS r ON r.REQUEST_ID = lc.VISA_REQUEST_ID
LEFT JOIN final_step f                                ON f.VISA_REQUEST_ID = lc.VISA_REQUEST_ID
GROUP BY 1, 2
ORDER BY paid_aed DESC;

-- F1b · the red candidates themselves, one row per case, ids only.
-- STOPPED + money paid + no renewed card = the cleanest loss shape.
-- ONGOING cases are excluded here on purpose: age them in F1c instead.
WITH lc AS (
    SELECT VISA_REQUEST_ID,
           MIN(CREATION_DATE)                          AS first_paid_at,
           SUM(AMOUNT)                                 AS paid_aed
    FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
    WHERE REQUEST_TYPE = 'RenewRequest'
      AND PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
      AND STATUS       = 'Added'
      AND AMOUNT BETWEEN 0 AND 100000
    GROUP BY 1
)
SELECT r.REQUEST_ID,
       r.OWNER_ID,
       r.OWNER_TYPE,
       lc.first_paid_at::DATE                          AS paid_on,
       ROUND(lc.paid_aed, 2)                           AS paid_aed,
       r.REQUEST_STATUS,
       r.STOPPED_COMPLETED_DATE::DATE                  AS closed_on,
       r.LABOR_CARD_EXPIRY_DATE,
       r.RENEWED_LABOR_CARD_EXPIRY_DATE,
       r.CURRENT_TASKS,
       r.PAUSE_REASON,
       DATEDIFF('day', lc.first_paid_at, COALESCE(r.STOPPED_COMPLETED_DATE, CURRENT_DATE())) AS days_open_after_payment
FROM lc
JOIN BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS r ON r.REQUEST_ID = lc.VISA_REQUEST_ID
WHERE r.REQUEST_STATUS = 'STOPPED'
  AND r.RENEWED_LABOR_CARD_EXPIRY_DATE IS NULL
ORDER BY paid_aed DESC, paid_on DESC;

-- F1c · ONGOING but long past the card's own grace period (30 days after expiry).
-- Reported as PENDING with an age, never as a finding — the money may still buy
-- a card tomorrow. The point is to size how much is sitting in limbo.
WITH lc AS (
    SELECT VISA_REQUEST_ID, MIN(CREATION_DATE) AS first_paid_at, SUM(AMOUNT) AS paid_aed
    FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
    WHERE REQUEST_TYPE = 'RenewRequest'
      AND PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
      AND STATUS       = 'Added'
      AND AMOUNT BETWEEN 0 AND 100000
    GROUP BY 1
)
SELECT CASE WHEN DATEDIFF('day', r.LABOR_CARD_EXPIRY_DATE, CURRENT_DATE()) <= 30  THEN 'within grace'
            WHEN DATEDIFF('day', r.LABOR_CARD_EXPIRY_DATE, CURRENT_DATE()) <= 90  THEN '31-90 days past'
            WHEN DATEDIFF('day', r.LABOR_CARD_EXPIRY_DATE, CURRENT_DATE()) <= 365 THEN '91-365 days past'
            ELSE 'over a year past' END                AS age_band,
       COUNT(*)                                        AS cases,
       ROUND(SUM(lc.paid_aed), 2)                      AS paid_aed
FROM lc
JOIN BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS r ON r.REQUEST_ID = lc.VISA_REQUEST_ID
WHERE r.REQUEST_STATUS = 'ONGOING'
  AND r.RENEWED_LABOR_CARD_EXPIRY_DATE IS NULL
  AND r.LABOR_CARD_EXPIRY_DATE IS NOT NULL
GROUP BY 1
ORDER BY 1;


-- ============================================================================
-- F2 · Paid more than once for one renewal cycle.
--   (a) two paid rows on the SAME request
--   (b) two renewal requests for the same person inside one card validity
-- Netting matters: a payment plus its reversal is not a duplicate. If D2/D4
-- show no negative amounts and no 'Dismissed' reversal convention, say so —
-- an unreversed-looking duplicate is a candidate, not a finding, until the
-- refund route is known (that is an ask-the-code question, not a SQL one).
-- ============================================================================
-- (a)
SELECT e.VISA_REQUEST_ID,
       COUNT(*)                                        AS paid_rows,
       ROUND(SUM(e.AMOUNT), 2)                         AS total_aed,
       MIN(e.CREATION_DATE)::DATE                      AS first_paid,
       MAX(e.CREATION_DATE)::DATE                      AS last_paid,
       DATEDIFF('day', MIN(e.CREATION_DATE), MAX(e.CREATION_DATE)) AS gap_days,
       COUNT(DISTINCT e.CREATOR)                       AS distinct_creators,
       COUNT(DISTINCT e.REFERENCE_NUMBER)              AS distinct_references
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
WHERE e.REQUEST_TYPE = 'RenewRequest'
  AND e.PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
  AND e.STATUS       = 'Added'
  AND e.AMOUNT BETWEEN 0 AND 100000
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY paid_rows DESC, total_aed DESC;

-- (b) same person, two paid renewals inside 730 days (the 2-year card term).
-- 730 is the term; a legitimate early renewal starts 30–60 days before expiry,
-- so anything under ~670 days apart deserves an explanation.
WITH paid AS (
    SELECT r.OWNER_ID,
           r.OWNER_TYPE,
           e.VISA_REQUEST_ID,
           MIN(e.CREATION_DATE)                        AS paid_at,
           SUM(e.AMOUNT)                               AS paid_aed
    FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
    JOIN BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS r ON r.REQUEST_ID = e.VISA_REQUEST_ID
    WHERE e.REQUEST_TYPE = 'RenewRequest'
      AND e.PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
      AND e.STATUS       = 'Added'
      AND e.AMOUNT BETWEEN 0 AND 100000
    GROUP BY 1, 2, 3
),
seq AS (
    SELECT paid.*,
           LAG(paid_at)          OVER (PARTITION BY OWNER_ID, OWNER_TYPE ORDER BY paid_at) AS prev_paid_at,
           LAG(VISA_REQUEST_ID)  OVER (PARTITION BY OWNER_ID, OWNER_TYPE ORDER BY paid_at) AS prev_request_id
    FROM paid
)
SELECT OWNER_ID,
       OWNER_TYPE,
       prev_request_id,
       VISA_REQUEST_ID                                 AS request_id,
       prev_paid_at::DATE                              AS prev_paid,
       paid_at::DATE                                   AS paid,
       DATEDIFF('day', prev_paid_at, paid_at)          AS gap_days,
       ROUND(paid_aed, 2)                              AS paid_aed
FROM seq
WHERE prev_paid_at IS NOT NULL
  AND DATEDIFF('day', prev_paid_at, paid_at) < 670
ORDER BY gap_days ASC;


-- ============================================================================
-- F3 · The pairing test. Labour card and MOHRE insurance are one portal
-- payment (VPMGOV-1701), so a request with one and not the other is either a
-- booking gap or a real unpaired payment. Expect some legitimate asymmetry —
-- this query exists to size it, not to red it on sight.
-- ============================================================================
SELECT CASE WHEN lc_rows > 0 AND ins_rows > 0 THEN 'both'
            WHEN lc_rows > 0                  THEN 'labour card only'
            ELSE 'insurance only' END          AS pairing,
       COUNT(*)                                AS requests,
       SUM(lc_rows)                            AS lc_rows,
       SUM(ins_rows)                           AS ins_rows,
       ROUND(SUM(lc_aed), 2)                   AS lc_aed,
       ROUND(SUM(ins_aed), 2)                  AS ins_aed
FROM (
    SELECT VISA_REQUEST_ID,
           COUNT_IF(PURPOSE = 'SUBMIT_RENEW_LABOR_CARD_APPICATION')                AS lc_rows,
           COUNT_IF(PURPOSE = 'MOHRE_INSURANCE')                                   AS ins_rows,
           SUM(IFF(PURPOSE = 'SUBMIT_RENEW_LABOR_CARD_APPICATION', AMOUNT, 0))     AS lc_aed,
           SUM(IFF(PURPOSE = 'MOHRE_INSURANCE', AMOUNT, 0))                        AS ins_aed
    FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
    WHERE REQUEST_TYPE = 'RenewRequest'
      AND PURPOSE IN ('SUBMIT_RENEW_LABOR_CARD_APPICATION', 'MOHRE_INSURANCE')
      AND STATUS = 'Added'
      AND AMOUNT BETWEEN 0 AND 100000
    GROUP BY 1
)
GROUP BY 1
ORDER BY requests DESC;


-- ============================================================================
-- F5 · Paid while a cancellation was already running (Alert 936's overlap,
-- priced). Two routes; run both, they disagree for different reasons.
--   (a) the renewal header's own CANCEL_REQUEST_ID link
--   (b) date overlap against CANCEL_VISA_REQUESTS  [UNVERIFIED columns —
--       DESC VIEW BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS first and fix the
--       column names before running (b)]
-- ============================================================================
-- (a)
WITH lc AS (
    SELECT VISA_REQUEST_ID, MIN(CREATION_DATE) AS paid_at, SUM(AMOUNT) AS paid_aed
    FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
    WHERE REQUEST_TYPE = 'RenewRequest'
      AND PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
      AND STATUS       = 'Added'
      AND AMOUNT BETWEEN 0 AND 100000
    GROUP BY 1
)
SELECT COUNT(*)                                        AS paid_renewals,
       COUNT_IF(r.CANCEL_REQUEST_ID IS NOT NULL)       AS with_cancel_link,
       ROUND(SUM(IFF(r.CANCEL_REQUEST_ID IS NOT NULL, lc.paid_aed, 0)), 2) AS aed_on_cancel_linked
FROM lc
JOIN BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS r ON r.REQUEST_ID = lc.VISA_REQUEST_ID;


-- ============================================================================
-- F6 · Control violation, not loss: payments recorded with no transaction id
-- and/or no payment reference, by month and by creator class.
-- The RPA is the expected creator; a spike in human-created rows, or a rise in
-- missing references, is a control signal on its own.
-- ============================================================================
SELECT DATE_TRUNC('month', CREATION_DATE)::DATE        AS month,
       IFF(LOWER(CREATOR_NAME) LIKE '%rpa%', 'rpa', 'human') AS creator_class,
       COUNT(*)                                        AS n,
       COUNT_IF(TRANSACTION_ID IS NULL)                AS no_txn_id,
       COUNT_IF(NULLIF(TRIM(REFERENCE_NUMBER), '') IS NULL) AS no_reference,
       ROUND(100.0 * COUNT_IF(TRANSACTION_ID IS NULL) / COUNT(*), 1) AS pct_no_txn_id
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE REQUEST_TYPE = 'RenewRequest'
  AND PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
  AND STATUS       = 'Added'
  AND CREATION_DATE >= DATEADD('month', -18, CURRENT_DATE())
GROUP BY 1, 2
ORDER BY 1 DESC, 2;


-- ============================================================================
-- F7 · Office staff: the ERP expense configuration has NO office-staff row for
-- this purpose, yet `RENEW - OfficeStaff - Contract Submission` has spend.
-- Size it before deciding scope; a config/reality mismatch is itself a finding
-- shape, and it is cheap to settle.
-- ============================================================================
SELECT OWNER_TYPE,
       TRIM(CONTRACT_TYPE)                             AS contract_type,
       EMPLOYEE_TYPE,
       COUNT(*)                                        AS n,
       ROUND(SUM(AMOUNT), 2)                           AS total_aed,
       MIN(CREATION_DATE)::DATE                        AS first_seen,
       MAX(CREATION_DATE)::DATE                        AS last_seen
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
WHERE REQUEST_TYPE = 'RenewRequest'
  AND PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
  AND AMOUNT BETWEEN 0 AND 100000
GROUP BY 1, 2, 3
ORDER BY total_aed DESC;


-- ============================================================================
-- P1 · How much of F1 does Alert 933 already catch?
-- Alert 933 fires only when the person turns Employment Terminated / Terminated
-- inside the same request AND has not moved out of the medical-waiting step.
-- Anything outside that is new coverage — which is the case for building this
-- audit at all. Uses the interval-containment read (pattern P-1), never a
-- current-state column, and carries its own diagnostic.
--
-- [UNVERIFIED in this session] HOUSEMAID_STATUS_LOGS columns are taken from the
-- pipeline's warehouse-facts reference: HOUSEMAID_ID, FROM_STATUS, TO_STATUS,
-- CHANGE_DATE, NEXT_CHANGE_DATE. DESC the view before trusting the result.
-- ============================================================================
WITH lc AS (
    SELECT e.VISA_REQUEST_ID,
           MIN(e.CREATION_DATE)                        AS paid_at,
           SUM(e.AMOUNT)                               AS paid_aed
    FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
    WHERE e.REQUEST_TYPE = 'RenewRequest'
      AND e.PURPOSE      = 'SUBMIT_RENEW_LABOR_CARD_APPICATION'
      AND e.STATUS       = 'Added'
      AND e.AMOUNT BETWEEN 0 AND 100000
    GROUP BY 1
),
cases AS (
    SELECT r.REQUEST_ID, r.OWNER_ID, r.OWNER_TYPE, r.REQUEST_STATUS,
           lc.paid_at, lc.paid_aed,
           COALESCE(r.STOPPED_COMPLETED_DATE, CURRENT_TIMESTAMP()) AS closed_at
    FROM lc
    JOIN BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS r ON r.REQUEST_ID = lc.VISA_REQUEST_ID
    WHERE r.RENEWED_LABOR_CARD_EXPIRY_DATE IS NULL
      AND r.OWNER_TYPE = 'HOUSEMAID'
),
med AS (
    SELECT VISA_REQUEST_ID,
           MAX(IFF(TASK_NAME = 'Waiting for the maid to go to medical test and EID fingerprinting'
                   AND COMPLETED_AT IS NOT NULL, 1, 0)) AS left_medical_step
    FROM BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS_TASKS
    GROUP BY 1
),
term AS (
    SELECT c.REQUEST_ID,
           MAX(IFF(s.TO_STATUS IN ('EMPLOYEMENT_TERMINATED', 'TERMINATED'), 1, 0)) AS terminated_in_window,
           COUNT_IF(s.NEXT_CHANGE_DATE IS NOT NULL)    AS resolved_to_a_PAST_interval
    FROM cases c
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS s
           ON s.HOUSEMAID_ID = c.OWNER_ID
          AND s.CHANGE_DATE >= c.paid_at
          AND s.CHANGE_DATE <= c.closed_at
    GROUP BY 1
)
SELECT CASE WHEN t.terminated_in_window = 1 AND COALESCE(m.left_medical_step, 0) = 0
                 THEN 'already covered by Alert 933'
            WHEN t.terminated_in_window = 1
                 THEN 'terminated, but left the medical step (933 misses)'
            ELSE 'not a termination at all (933 misses)' END AS coverage,
       COUNT(*)                                        AS cases,
       ROUND(SUM(c.paid_aed), 2)                       AS paid_aed,
       SUM(t.resolved_to_a_PAST_interval)              AS resolved_to_a_PAST_interval
FROM cases c
LEFT JOIN med m  ON m.VISA_REQUEST_ID = c.REQUEST_ID
LEFT JOIN term t ON t.REQUEST_ID      = c.REQUEST_ID
GROUP BY 1
ORDER BY paid_aed DESC;


-- ============================================================================
-- X1 · Where the recovery question has to be answered (F4) — NOT a finding
-- query. There is no verified loan/recovery view for this fee yet, so start by
-- listing candidates rather than guessing a column name.
-- Run these, then DESC whatever looks right, then write the recovery test.
-- ============================================================================
SHOW TERSE VIEWS LIKE '%LOAN%' IN DATABASE BA_VIEWS;
SHOW TERSE VIEWS LIKE '%REFUND%' IN DATABASE BA_VIEWS;
DESC VIEW BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REFUNDS_HISTORY;
DESC VIEW BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_PAYMENTS;
DESC VIEW BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS;
