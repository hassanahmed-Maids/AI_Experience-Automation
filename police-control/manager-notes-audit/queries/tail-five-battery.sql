-- =====================================================================================
-- THE TAIL FIVE — the last types cleared on AMOUNT but never on ENTITLEMENT.
--   Taxi Reimbursement            AED 84,594
--   Accommodation Relocation      AED 51,600
--   Maids.at other expenses       AED 51,260
--   Medical Assistance            AED 21,882
--   MOHRE requirement additions   AED 10,239
--   -------------------------------------------
--   combined                      AED 219,575  = 3.0% of the year's AED 7,197,642
--
-- PROPORTIONALITY: six queries, not thirty. At this size a 10% finding is ~AED 22k.
-- All five share ONE mechanism — they are expense-backed reimbursements — so the battery
-- is written ACROSS the five, not five times over. Only the last query is type-specific,
-- and only because Accommodation Relocation is the one type here with a confirmed rule.
--
-- TWO TESTS ARE DELIBERATELY ABSENT (stops, not omissions):
--   * note-vs-request AMOUNT      -> O1 already groups by payment type; these five rows
--                                    are in its output. Re-running it here is duplicate work.
--   * PAID TWICE                  -> O2 is self-calibrating across all 25 types and is
--                                    still unrun. Run O2; do not write a fifth-type copy.
--
-- DISCIPLINE CARRIED IN FROM THIS SESSION:
--   - no correlated subquery carrying an inequality (Snowflake rejects it)
--   - no CTE named `asof` (reserved: ASOF JOIN)
--   - a changing dimension is read AS OF the note date, never as current state
--   - an OR-join to EXPENSES_CONFIGURATION fans out; collapse to one row per note first
--   - names are never selected, only compared -- no staff or maid identity leaves the query
-- =====================================================================================


-- TF1. 🔴 O-A — THE AUTHORISATION SPINE. The one question that applies to all five:
--      is there an approved expense request behind the money, and did it stay approved?
--      A note with no request, or one linked to a REJECTED/CANCELED request, or one whose
--      request was refunded AFTER the note was written, is money that moved without
--      authorisation. V9 established nothing voids a note when its expense reverses.
SELECT n.REASON                                                        AS payment_type,
       COUNT(*)                                                        AS notes,
       ROUND(SUM(n.AMOUNT))                                            AS aed,
       COUNT_IF(n.EXPENSE_ID IS NULL)                                  AS no_request_at_all,
       ROUND(SUM(IFF(n.EXPENSE_ID IS NULL, n.AMOUNT, 0)))              AS aed_unauthorised,
       COUNT_IF(x.REQUEST_STATUS = 'PAID')                             AS request_paid,
       COUNT_IF(x.REQUEST_STATUS IN ('REJECTED','DISMISSED','CANCELED')) AS request_KILLED,
       ROUND(SUM(IFF(x.REQUEST_STATUS IN ('REJECTED','DISMISSED','CANCELED'),
                     n.AMOUNT, 0)))                                    AS aed_on_killed,
       COUNT_IF(x.REFUNDED AND x.REFUND_DATE > n.NOTE_DATE)            AS refunded_after_note,
       ROUND(SUM(IFF(x.REFUNDED AND x.REFUND_DATE > n.NOTE_DATE,
                     n.AMOUNT, 0)))                                    AS aed_refunded_after
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
  AND n.REASON IN ('Taxi Reimbursement','Accommodation Relocation',
                   'Maids.at other expenses','Medical Assistance',
                   'MOHRE requirement additions')
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
  AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY 1
ORDER BY aed DESC;


-- TF2. 🟢 THE HIGHEST-VALUE QUERY HERE, and it is not a test — it is a census that
--      CLOSES A BLOCKING BUSINESS ASK. BUSINESS-RULES-REQUEST Part 2A asks George for
--      "a table: payment type on the left, allowed expense categories on the right."
--      That ask has been open because we could not tell him what to fill in. This
--      enumerates the categories ACTUALLY in use behind each of the five, with the money
--      on each, so the ask becomes a tick-box instead of an essay.
--      Uses EXPENSE_REQUEST_TASK_NAME straight off the request -- NO config join, so no
--      fan-out is possible.
SELECT n.REASON                                          AS payment_type,
       COALESCE(x.EXPENSE_REQUEST_TASK_NAME, '(none)')   AS expense_category,
       COUNT(*)                                          AS notes,
       ROUND(SUM(n.AMOUNT))                              AS aed,
       ROUND(100.0 * SUM(n.AMOUNT)
             / SUM(SUM(n.AMOUNT)) OVER (PARTITION BY n.REASON), 1) AS pct_of_type
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
  AND n.REASON IN ('Taxi Reimbursement','Accommodation Relocation',
                   'Maids.at other expenses','Medical Assistance',
                   'MOHRE requirement additions')
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
  AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY 1, 2
ORDER BY payment_type, aed DESC;


-- TF3. 🔴 SELF-APPROVAL, WITH A BASE RATE BESIDE IT. Medical Assistance was reported at
--      "47% self-approved" on a 36-month window. That number was published without a
--      comparator, and this session's rule is that a rate without its base rate is not a
--      finding. This reports EVERY payment type with >= 20 notes so the five are judged
--      against the house norm rather than against nothing.
--      Names are compared, never selected.
WITH n AS (
    SELECT ID, HOUSEMAID_ID, AMOUNT, COALESCE(REASON,'(none)') AS payment_type,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(REQUESTED_BY),''), '\\s+', ' '))) AS requester,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(APPROVED_BY),''),  '\\s+', ' '))) AS approver
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
)
SELECT payment_type,
       IFF(payment_type IN ('Taxi Reimbursement','Accommodation Relocation',
                            'Maids.at other expenses','Medical Assistance',
                            'MOHRE requirement additions'), 'TAIL FIVE', '') AS in_scope,
       COUNT(*)                                                       AS notes,
       ROUND(SUM(AMOUNT))                                             AS aed,
       COUNT_IF(requester IS NOT NULL AND approver IS NOT NULL
                AND requester = approver)                             AS self_approved,
       ROUND(100.0 * COUNT_IF(requester IS NOT NULL AND approver IS NOT NULL
                              AND requester = approver) / COUNT(*), 1) AS pct_self,
       ROUND(SUM(IFF(requester IS NOT NULL AND approver IS NOT NULL
                     AND requester = approver, AMOUNT, 0)))           AS aed_self_approved,
       COUNT_IF(approver IS NULL)                                     AS never_approved,
       ROUND(SUM(IFF(approver IS NULL, AMOUNT, 0)))                   AS aed_never_approved
FROM n
GROUP BY 1, 2
HAVING COUNT(*) >= 20
ORDER BY pct_self DESC;


-- TF4. 🔴 O-D — ROUTING. Does the expense head the money came out of agree with the
--      heading the payslip shows? A relocation paid out of a medical head is money booked
--      under one name and justified under another. This is E4, which is still unrun, cut
--      to the five. The config join matches on CODE *or* CAPTION and can fan out, so each
--      note is collapsed to ONE config row before anything is counted.
WITH linked AS (
    SELECT n.ID AS note_id, n.REASON AS note_says, n.AMOUNT,
           x.EXPENSE_REQUEST_TASK_NAME AS task_name
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.REASON IN ('Taxi Reimbursement','Accommodation Relocation',
                       'Maids.at other expenses','Medical Assistance',
                       'MOHRE requirement additions')
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), headed AS (
    SELECT l.note_id, l.note_says, l.AMOUNT,
           c.SALARY_ADDITION_TYPE AS head_says, c.CODE AS expense_code
    FROM linked l
    LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION c
           ON c.CODE = l.task_name OR c.CAPTION = l.task_name
    QUALIFY ROW_NUMBER() OVER (PARTITION BY l.note_id ORDER BY c.CODE) = 1
)
SELECT note_says,
       COALESCE(head_says, '(head carries no salary_addition_type)') AS head_says,
       COALESCE(expense_code, '(no head matched)')                   AS expense_code,
       COUNT(*)                                                      AS notes,
       ROUND(SUM(AMOUNT))                                            AS aed
FROM headed
GROUP BY 1, 2, 3
ORDER BY note_says, notes DESC;


-- TF5. 🟡 N19 — FIND THE LIVE-OUT FLAG. This one column unblocks TWO tests worth
--      AED 110,000: Accommodation Relocation is CC LIVE-OUT ONLY (confirmed by payroll),
--      and Live-out Transportation Assistance is 69% of all taxi money -- paid to a
--      live-IN maid it is money with no entitlement behind it at all.
--      HOUSEMAID_TYPE does not carry it; the gold layer derives "CC Live In / CC Live Out"
--      from a separate flag whose name we have never confirmed. Narrow sweep, small result.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE (COLUMN_NAME ILIKE '%LIVE%OUT%'
    OR COLUMN_NAME ILIKE '%LIVEOUT%'
    OR COLUMN_NAME ILIKE '%LIVE%IN%'
    OR COLUMN_NAME ILIKE '%ACCOMMODATION%TYPE%'
    OR COLUMN_NAME ILIKE '%RESIDENCE%TYPE%')
  AND TABLE_SCHEMA IN ('HOUSEMAID_MANAGEMENT_SILVER','CLIENT_MANAGEMENT_SILVER')
ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME;


-- TF6. 🔴 O-A — ACCOMMODATION RELOCATION PAID TO AN MV MAID. The rule is "CC live-out
--      only". The live-out half waits on TF5; the CC half is testable RIGHT NOW, and it
--      is the half that catches money going to a population the rule never covered.
--      Read AS OF the note date. This is the correction that rewrote three findings this
--      session: current HOUSEMAID_TYPE on a dated payment reads a maid who switched
--      contract afterwards as though she had always been that type.
WITH paid AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Accommodation Relocation'
      AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), rev AS (
    SELECT ID AS maid_id, HOUSEMAID_TYPE, LAST_MODIFICATION_DATE::DATE AS changed_on
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION
    WHERE HOUSEMAID_TYPE IS NOT NULL AND LAST_MODIFICATION_DATE IS NOT NULL
), resolved AS (
    SELECT p.note_id, p.HOUSEMAID_ID, p.note_day, p.AMOUNT,
           r.HOUSEMAID_TYPE AS type_when_paid
    FROM paid p
    LEFT JOIN rev r ON r.maid_id = p.HOUSEMAID_ID AND r.changed_on <= p.note_day
    QUALIFY ROW_NUMBER() OVER (PARTITION BY p.note_id ORDER BY r.changed_on DESC) = 1
)
SELECT CASE
         WHEN type_when_paid IS NULL       THEN 'BLOCKED - no revision before the note'
         WHEN type_when_paid = 'MAID_VISA' THEN 'RED - relocation paid to an MV maid'
         ELSE                                   'GREEN - was CC when paid'
       END                            AS verdict,
       COUNT(*)                       AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)   AS maids,
       ROUND(SUM(AMOUNT))             AS aed
FROM resolved
GROUP BY 1
ORDER BY aed DESC;
