-- =====================================================================================
-- BLOCK E — T4, T5 and the eligibility contradiction. Written against measured schema.
-- J1 result: HOUSEMAID_MANAGER_NOTES.EXPENSE_ID -> EXPENSES_REQUESTS.ID matches
-- 11,819 of 11,819 = 100.0%. It is an exact foreign key, not a fuzzy match. The spec's
-- confidence-floor machinery (M4) is not needed for the two thirds of notes that carry one.
-- 🔴 But 17,576 ADDITION notes exist and only 11,819 carry an EXPENSE_ID, so ~5,757 (33%)
-- have no expense request at all — a different verdict, not a failed match.
-- =====================================================================================

-- E1. T4 — the note<->expense match, exactly. Splits the population three ways and prices
--     each: no expense link at all / linked to an authorised request / linked to one that
--     was REJECTED, DISMISSED or CANCELED. That last group is the V9 test, now runnable.
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT,
           COALESCE(REASON, '(none)') AS payment_type, EXPENSE_ID
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
)
SELECT n.payment_type,
       COUNT(*)                                                       AS notes,
       ROUND(SUM(n.AMOUNT))                                           AS aed,
       COUNT_IF(n.EXPENSE_ID IS NULL)                                 AS no_expense_link,
       ROUND(SUM(IFF(n.EXPENSE_ID IS NULL, n.AMOUNT, 0)))             AS aed_no_link,
       COUNT_IF(x.REQUEST_STATUS = 'PAID')                            AS linked_paid,
       COUNT_IF(x.REQUEST_STATUS IN ('REJECTED','DISMISSED','CANCELED')) AS linked_not_authorised,
       ROUND(SUM(IFF(x.REQUEST_STATUS IN ('REJECTED','DISMISSED','CANCELED'), n.AMOUNT, 0)))
                                                                      AS aed_not_authorised,
       COUNT_IF(x.REQUEST_STATUS IN ('PENDING','PENDING_PAYMENT'))    AS linked_still_pending
FROM n LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
GROUP BY 1
ORDER BY aed DESC;

-- E2. 🔴 THE V9 TEST. Conv. 46017: nothing voids a manager note when its expense request is
--     rejected, dismissed or cancelled, and no FK exists to link back. Now measurable — and
--     the note is what payroll pays from. Row-level, capped, no free text, no maid names.
SELECT n.ID                                   AS note_id,
       COALESCE(n.REASON, '(none)')           AS payment_type,
       n.NOTE_DATE::DATE                      AS note_day,
       n.AMOUNT                               AS note_aed,
       x.REQUEST_STATUS,
       x.STATUS_CHANGE_DATE::DATE             AS status_changed,
       x.AMOUNT                               AS request_aed,
       DATEDIFF('day', n.NOTE_DATE, x.STATUS_CHANGE_DATE) AS days_note_to_status
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
WHERE n.NOTE_TYPE = 'ADDITION'
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
  AND x.REQUEST_STATUS IN ('REJECTED','DISMISSED','CANCELED')
ORDER BY n.AMOUNT DESC
LIMIT 200;

-- E3. T4 amount agreement. The note copies expenseRequestTodo.getAmount() verbatim, so a
--     mismatch is either a later edit to one side or a currency the audit cannot compare.
--     Multi-currency is BLOCKED, never an approximate match (trap: 7 currencies exist).
WITH m AS (
    SELECT COALESCE(n.REASON, '(none)') AS payment_type, n.AMOUNT AS note_aed,
           x.AMOUNT AS request_aed, x.CURRENCY_NAME
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
)
SELECT payment_type,
       COUNT(*)                                                      AS linked_notes,
       COUNT_IF(CURRENCY_NAME <> 'AED')                              AS non_aed_blocked,
       COUNT_IF(CURRENCY_NAME = 'AED' AND ABS(note_aed - request_aed) < 0.01) AS amounts_agree,
       COUNT_IF(CURRENCY_NAME = 'AED' AND ABS(note_aed - request_aed) >= 0.01) AS amounts_differ,
       ROUND(SUM(IFF(CURRENCY_NAME = 'AED' AND ABS(note_aed - request_aed) >= 0.01,
                     ABS(note_aed - request_aed), 0)))               AS aed_of_difference,
       ROUND(MAX(IFF(CURRENCY_NAME = 'AED', ABS(note_aed - request_aed), 0))) AS largest_gap
FROM m
GROUP BY 1
ORDER BY amounts_differ DESC, linked_notes DESC;

-- E4. T5 — the expense head. J2 resolved N14 from data: EXPENSES_CONFIGURATION.CODE ->
--     SALARY_ADDITION_TYPE is the allowed-head list, e.g. anti_attrition -> 'AAI - 01' and
--     Abu Dhabi -> 'cc_auh_incentive' (a DIFFERENT code, settling that question from data).
--     A note whose expense head maps to a different addition type than the note carries is
--     a routing defect.
--     NOTE: J2's ACTIVE_HEADS returned 0 for every row — STATUS does not use 'ACTIVE'.
--     Run  SELECT STATUS, COUNT(*) FROM ...EXPENSES_CONFIGURATION GROUP BY 1;  before
--     filtering on it anywhere.
SELECT COALESCE(n.REASON, '(none)')            AS note_says,
       COALESCE(c.SALARY_ADDITION_TYPE, '(none)') AS expense_head_says,
       c.CODE                                  AS expense_code,
       COUNT(*)                                AS notes,
       ROUND(SUM(n.AMOUNT))                    AS aed
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION c
     ON c.CODE = x.EXPENSE_REQUEST_TASK_NAME OR c.CAPTION = x.EXPENSE_REQUEST_TASK_NAME
WHERE n.NOTE_TYPE = 'ADDITION'
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1, 2, 3
ORDER BY notes DESC;

-- E5. 🔴 THE ELIGIBILITY CONTRADICTION, resolved point-in-time.
--     N13, code-verified: the anti-attrition job filters h.housemaidType <> MAID_VISA — CC
--     only. D3 shows 941 notes, AED 172,967, 331 maids currently typed MAID_VISA.
--     HOUSEMAID_TYPE is CURRENT, so a maid paid as CC who later switched looks identical.
--     HOUSEMAIDS_INFO_REVISION is an Envers revision table (ID + REVISION + *_MODIFIED
--     flags), so the as-of-payment type is recoverable. Its key is ID, not HOUSEMAID_ID —
--     the first version of this query guessed otherwise and failed to compile.
WITH paid AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Anti-attrition Incentive'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), rev AS (
    SELECT ID AS maid_id, HOUSEMAID_TYPE, LAST_MODIFICATION_DATE::DATE AS as_of
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION
    WHERE HOUSEMAID_TYPE IS NOT NULL AND LAST_MODIFICATION_DATE IS NOT NULL
), asof AS (
    SELECT p.note_id, p.HOUSEMAID_ID, p.note_day, p.AMOUNT,
           r.HOUSEMAID_TYPE AS type_when_paid
    FROM paid p
    LEFT JOIN rev r ON r.maid_id = p.HOUSEMAID_ID AND r.as_of <= p.note_day
    QUALIFY ROW_NUMBER() OVER (PARTITION BY p.note_id ORDER BY r.as_of DESC) = 1
)
SELECT COALESCE(a.type_when_paid, '(no revision before the note)') AS type_when_paid,
       COALESCE(h.HOUSEMAID_TYPE, '(unknown)')                     AS type_now,
       COUNT(*)                                                    AS notes,
       COUNT(DISTINCT a.HOUSEMAID_ID)                              AS maids,
       ROUND(SUM(a.AMOUNT))                                        AS aed
FROM asof a
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = a.HOUSEMAID_ID
GROUP BY 1, 2
ORDER BY notes DESC;

-- E5b. The same as-of machinery, stated as the verdict the audit needs. Anything landing in
--      'PAID WHILE MV' contradicts a code-verified eligibility rule on AED 1.83m/year.
--      🟢 This as-of pattern is also N17: the contract-type timeline group A needs for the
--      airfare service rule. Once it works here, group A stops being blocked on a business ask.
WITH paid AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Anti-attrition Incentive'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), rev AS (
    SELECT ID AS maid_id, HOUSEMAID_TYPE, LAST_MODIFICATION_DATE::DATE AS as_of
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION
    WHERE HOUSEMAID_TYPE IS NOT NULL AND LAST_MODIFICATION_DATE IS NOT NULL
), asof AS (
    SELECT p.note_id, p.HOUSEMAID_ID, p.note_day, p.AMOUNT, r.HOUSEMAID_TYPE AS type_when_paid
    FROM paid p
    LEFT JOIN rev r ON r.maid_id = p.HOUSEMAID_ID AND r.as_of <= p.note_day
    QUALIFY ROW_NUMBER() OVER (PARTITION BY p.note_id ORDER BY r.as_of DESC) = 1
)
SELECT CASE
         WHEN type_when_paid IS NULL          THEN 'BLOCKED - no revision before the note'
         WHEN type_when_paid = 'MAID_VISA'    THEN 'RED - PAID WHILE MV, contradicts N13'
         ELSE                                      'GREEN - was CC when paid'
       END                            AS verdict,
       COUNT(*)                       AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)   AS maids,
       ROUND(SUM(AMOUNT))             AS aed
FROM asof
GROUP BY 1
ORDER BY notes DESC;

-- E6. Size the Abu Dhabi underpayment. N24 is RESOLVED: ABU_DHABI_INCENTIVE_OFFERED and
--     ABU_DHABI_INCENTIVE_TYPE are on HOUSEMAIDS_INFO, not a separate extra-fields table.
--     Aggregates only.
SELECT COALESCE(h.ABU_DHABI_INCENTIVE_TYPE, '(none)') AS ad_type,
       COUNT(*)                                       AS notes,
       COUNT(DISTINCT n.HOUSEMAID_ID)                 AS maids,
       ROUND(SUM(n.AMOUNT))                           AS aed_actually_paid,
       ROUND(SUM(h.ABU_DHABI_INCENTIVE_OFFERED))      AS aed_offered_full_month,
       ROUND(AVG(h.ABU_DHABI_INCENTIVE_OFFERED))      AS avg_offered
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Abu Dhabi Incentive'
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
ORDER BY notes DESC;
