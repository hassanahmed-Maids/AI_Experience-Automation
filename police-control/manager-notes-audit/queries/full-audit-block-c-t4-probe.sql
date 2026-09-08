-- =====================================================================================
-- BLOCK C — the expense grant landed. MONEY_CONTROL_SILVER now exposes EXPENSES_REQUESTS,
-- EXPENSES_PAYMENTS, EXPENSES_CONFIGURATION, EXPENSES_REFUNDS_HISTORY and more.
-- Before T4 is written, two things must be established, not assumed: the JOIN KEY and
-- what REQUEST_STATUS actually contains. J1-J4 are small.
-- =====================================================================================

-- J1. 🔴 THE JOIN KEY. HOUSEMAID_MANAGER_NOTES.EXPENSE_ID is one value per note (9,166
--     distinct over 9,167). It is therefore a REQUEST-level id, not a category — but
--     which one? Four candidates, measured, not guessed. The winner is T4's join.
WITH n AS (
    SELECT EXPENSE_ID
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND EXPENSE_ID IS NOT NULL
)
SELECT 'EXPENSES_REQUESTS.ID'                AS candidate,
       COUNT(*)                              AS notes,
       COUNT_IF(x.ID IS NOT NULL)            AS matched,
       ROUND(100.0*COUNT_IF(x.ID IS NOT NULL)/COUNT(*), 1) AS pct
FROM n LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
UNION ALL
SELECT 'EXPENSES_PAYMENTS.EXPENSE_PAYMENT_ID', COUNT(*), COUNT_IF(p.EXPENSE_PAYMENT_ID IS NOT NULL),
       ROUND(100.0*COUNT_IF(p.EXPENSE_PAYMENT_ID IS NOT NULL)/COUNT(*), 1)
FROM n LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_PAYMENTS p ON p.EXPENSE_PAYMENT_ID = n.EXPENSE_ID
UNION ALL
SELECT 'EXPENSES_PAYMENTS.EXPENSE_ID', COUNT(*), COUNT_IF(q.EXPENSE_ID IS NOT NULL),
       ROUND(100.0*COUNT_IF(q.EXPENSE_ID IS NOT NULL)/COUNT(*), 1)
FROM n LEFT JOIN (SELECT DISTINCT EXPENSE_ID FROM BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_PAYMENTS) q
       ON q.EXPENSE_ID = n.EXPENSE_ID
UNION ALL
SELECT 'EXPENSES_CONFIGURATION.ID', COUNT(*), COUNT_IF(c.ID IS NOT NULL),
       ROUND(100.0*COUNT_IF(c.ID IS NOT NULL)/COUNT(*), 1)
FROM n LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION c ON c.ID = n.EXPENSE_ID
ORDER BY pct DESC;

-- J2. 🟢 N14 STOPS BEING A BUSINESS ASK. EXPENSES_CONFIGURATION carries CODE and
--     SALARY_ADDITION_TYPE — the payment type -> expense head mapping, as data.
--     This also settles which expense code carries anti_attrition_incentive and which
--     carries the Abu Dhabi reason, which source could only report as DB config.
SELECT COALESCE(SALARY_ADDITION_TYPE, '(none)') AS salary_addition_type,
       COUNT(*)                                 AS expense_heads,
       COUNT_IF(STATUS = 'ACTIVE')              AS active_heads,
       LISTAGG(DISTINCT CODE, ' | ')
         WITHIN GROUP (ORDER BY CODE)           AS codes,
       LISTAGG(DISTINCT TOP_PARENT_CATEGORY, ' | ')
         WITHIN GROUP (ORDER BY TOP_PARENT_CATEGORY) AS top_categories
FROM BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION
GROUP BY 1
ORDER BY expense_heads DESC;

-- J3. What REQUEST_STATUS values exist, and how much money sits in each? T4 cannot call
--     a note authorised until "authorised" is a known value rather than a guess.
SELECT COALESCE(REQUEST_STATUS, '(null)')  AS request_status,
       COUNT(*)                            AS requests,
       ROUND(SUM(AMOUNT))                  AS aed,
       COUNT_IF(REFUNDED)                  AS refunded,
       COUNT(DISTINCT CURRENCY_NAME)       AS currencies,
       MIN(CREATION_DATE::DATE)            AS first_seen,
       MAX(CREATION_DATE::DATE)            AS last_seen
FROM BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS
WHERE CREATION_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
ORDER BY requests DESC;

-- J4. 🔴 THE V9 TEST BECOMES RUNNABLE. Conv. 46017: nothing voids a manager note when its
--     expense request is cancelled, rejected or reversed. EXPENSES_REFUNDS_HISTORY and
--     EXPENSES_REQUESTS.REFUNDED now make that measurable. How much money sits on notes
--     whose expense was refunded or reversed AFTER the note existed?
--     Uses the join key J1 selects — swap the ON clause if J1 names a different one.
SELECT COALESCE(n.REASON, '(none)')                       AS payment_type,
       COUNT(*)                                           AS notes,
       ROUND(SUM(n.AMOUNT))                               AS note_aed,
       COUNT_IF(x.REFUNDED)                               AS expense_refunded,
       ROUND(SUM(IFF(x.REFUNDED, n.AMOUNT, 0)))           AS aed_on_refunded_expenses,
       COUNT_IF(x.REFUND_DATE > n.NOTE_DATE)              AS refunded_after_the_note,
       ROUND(SUM(IFF(x.REFUND_DATE > n.NOTE_DATE, n.AMOUNT, 0))) AS aed_refunded_after
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
WHERE n.NOTE_TYPE = 'ADDITION'
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
HAVING COUNT_IF(x.REFUNDED) > 0
ORDER BY aed_on_refunded_expenses DESC;
