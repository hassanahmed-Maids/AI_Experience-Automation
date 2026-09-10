-- ============================================================
-- W1 — M9 coverage waterfall, the four unmeasured lines
-- One row. l0 - l1 - l2 - l3 must equal l4 by construction.
-- NOTE: STATUS is deliberately NOT a step. P-ALL is not filtered
-- on it (see §3.1); it is sized as a memo line and tested at T7.
-- ============================================================
WITH r AS (
  SELECT OWNER_TYPE, STATUS, TRANSACTION_ID
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('APPLY_FOR_RVISA','RENEW_RESIDENCE')
),
s1 AS (SELECT * FROM r  WHERE OWNER_TYPE = 'HOUSEMAID'),
s2 AS (SELECT * FROM s1 WHERE TRANSACTION_ID IS NOT NULL)
SELECT
  (SELECT COUNT(*) FROM r)                                             AS l0_rvisa_lines,
  (SELECT COUNT(*) FROM r) - (SELECT COUNT(*) FROM s1)                 AS l1_less_office_staff,
  (SELECT COUNT(*) FROM s1) - (SELECT COUNT(*) FROM s2)                AS l2_less_null_txn,
  (SELECT COUNT(*) FROM s2) - (SELECT COUNT(DISTINCT TRANSACTION_ID) FROM s2)
                                                                       AS l3_less_shared_txn,
  (SELECT COUNT(DISTINCT TRANSACTION_ID) FROM s2)                      AS l4_payments_in_pall,
  (SELECT COUNT(DISTINCT TRANSACTION_ID) FROM s2 WHERE STATUS <> 'Added')
                                                                       AS memo_payments_non_added,
  (SELECT LISTAGG(DISTINCT STATUS, ' | ') FROM s2)                     AS memo_statuses_present
;


-- ============================================================
-- W2 — every multi-payment case (P-CASE) priced on the DATED
-- fee schedule, with the facts each test T1-T7 needs.
-- Expect ~90 rows.
-- fee_match_count MUST be 0 or 1 on every payment: if any case
-- shows max_match_count = 2 the schedule is ambiguous on that
-- date and the whole pricing is unsafe.
-- ============================================================
WITH sched(fee, dfrom, dto) AS (
  SELECT * FROM VALUES
    (373.00, '2017-01-01', '2017-12-31'),
    (473.00, '2017-08-01', '2018-01-31'),
    (476.00, '2018-02-01', '2020-03-31'),
    (477.00, '2018-02-01', '2020-03-31'),
    (496.00, '2018-11-01', '2019-11-30'),
    (497.00, '2018-11-01', '2019-11-30'),
    (395.00, '2019-11-01', '2020-06-30'),
    (396.00, '2019-11-01', '2020-06-30'),
    (397.00, '2019-11-01', '2020-06-30'),
    (393.50, '2020-06-01', '2023-05-31'),
    (443.50, '2022-10-01', '2099-12-31'),
    (457.46, '2025-07-01', '2099-12-31'),
    (343.50, '2017-01-01', '2099-12-31'),
    (472.50, '2017-01-01', '2099-12-31'),
    (293.50, '2017-01-01', '2099-12-31'),
    (418.50, '2017-01-01', '2099-12-31')
),
line AS (
  SELECT VISA_REQUEST_ID, PURPOSE, TRANSACTION_ID,
         AMOUNT, PAYMENT_TYPE, STATUS, CREATION_DATE
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('APPLY_FOR_RVISA','RENEW_RESIDENCE')
    AND OWNER_TYPE = 'HOUSEMAID'
    AND TRANSACTION_ID IS NOT NULL
),
pay AS (                       -- collapse line grain -> payment grain
  SELECT VISA_REQUEST_ID, PURPOSE, TRANSACTION_ID,
         COUNT(*)                  AS lines_on_txn,
         MAX(AMOUNT)               AS amt,
         MIN(CREATION_DATE)::DATE  AS line_date,
         MAX(PAYMENT_TYPE)         AS chan,
         MAX(CASE WHEN STATUS <> 'Added' THEN 1 ELSE 0 END) AS has_non_added
  FROM line
  GROUP BY 1,2,3
),
payd AS (                      -- prefer the real transaction date
  SELECT p.*,
         COALESCE(
           (SELECT MAX(t.TRANSACTION_DATE)
              FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t
             WHERE t.ID = p.TRANSACTION_ID),
           p.line_date) AS pay_date
  FROM pay p
),
matched AS (
  SELECT d.*,
         (SELECT MAX(s.fee) FROM sched s
           WHERE d.pay_date BETWEEN s.dfrom::DATE AND s.dto::DATE
             AND d.amt >= s.fee
             AND MOD(ROUND((d.amt - s.fee) * 100), 5000) = 0)   AS fee_matched,
         (SELECT COUNT(*) FROM sched s
           WHERE d.pay_date BETWEEN s.dfrom::DATE AND s.dto::DATE
             AND d.amt >= s.fee
             AND MOD(ROUND((d.amt - s.fee) * 100), 5000) = 0)   AS fee_match_count
  FROM payd d
),
cases AS (
  SELECT VISA_REQUEST_ID                                        AS req,
         PURPOSE                                                AS purp,
         COUNT(*)                                               AS payments,
         COUNT_IF(fee_matched IS NOT NULL)                      AS fee_payments,
         COUNT_IF(fee_matched IS NULL)                          AS unmatched_payments,
         MAX(fee_match_count)                                   AS max_match_count,
         MIN(fee_matched)                                       AS era_fee,
         COUNT(DISTINCT fee_matched)                            AS distinct_fees,
         MIN(pay_date)                                          AS first_pay,
         MAX(pay_date)                                          AS last_pay,
         DATEDIFF('day', MIN(pay_date), MAX(pay_date))          AS span_days,
         COUNT(DISTINCT chan)                                   AS channels,
         MAX(lines_on_txn)                                      AS max_lines_on_txn,
         SUM(has_non_added)                                     AS non_added_payments,
         COUNT_IF(pay_date IN ('2020-02-23','2020-03-17'))      AS on_batch_date,
         MIN(amt)                                               AS min_amt,
         MAX(amt)                                               AS max_amt
  FROM matched
  GROUP BY 1,2
)
SELECT req, purp, payments, fee_payments, unmatched_payments, max_match_count,
       era_fee, distinct_fees, first_pay, last_pay, span_days, channels,
       max_lines_on_txn, non_added_payments, on_batch_date, min_amt, max_amt,
       ROUND((payments - 1) * era_fee, 2)                       AS gross_on_schedule
FROM cases
WHERE payments > 1
ORDER BY req;
