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


-- =====================================================================================
-- ROUND 2 — what the first round actually returned.
--
-- TF1  GREEN, all five. 944 notes / AED 219,143, 100% linked to a PAID expense request,
--      zero killed, zero refunded after the note. The approval trail holds.
--
-- TF2  🔴 VOID — MY QUERY WAS WRONG, NOT THE DATA. EXPENSE_REQUEST_TASK_NAME returned
--      'PAYMENT_OBJECT_CREATED' for 100% of all five types. That is a WORKFLOW STATE,
--      not a category. The census produced nothing and George's Part 2A ask stays open.
--      New trap, same family as "EXPENSE_ID is not a category": a column named for a TASK
--      holds where the request GOT TO, not what it was FOR.
--
-- TF4  🔴 VOID FOR THE SAME REASON, and this one is dangerous. It matched no config head
--      on any of the 944 notes -- because it joined on that same task-name column. Zero
--      matches is NO EVIDENCE, not clean evidence. TF4 must not be reported as green.
--
-- TF5  RESOLVED. N19 is HOUSEMAIDS_INFO_REVISION.LIVE_OUT (NUMBER), with a LIVE_OUT_MODIFIED
--      flag beside it. Blocking since the spec was written; unblocks TF7 below.
--
-- TF6  GREEN. 66/66 relocations were CC as of the note date. The MV half of the rule holds.
-- =====================================================================================


-- TF7. 🔴 THE FULL RELOCATION RULE, FINALLY TESTABLE. "CC live-out only" -- TF6 cleared the
--      CC half, TF5 just handed us the other half. AED 51,600 across 66 notes, and a
--      relocation allowance paid to a live-IN maid is money for a move she did not make.
--      LIVE_OUT read AS OF the note date, same machinery as TF6.
--      The last two columns are a SELF-DIAGNOSTIC: if every note resolves to the same
--      revision the maid carries today, the as-of join is not actually doing any work and
--      the result is a point read wearing a costume.
WITH paid AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Accommodation Relocation'
      AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), rev AS (
    SELECT ID AS maid_id, LIVE_OUT, LAST_MODIFICATION_DATE::DATE AS changed_on
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION
    WHERE LIVE_OUT IS NOT NULL AND LAST_MODIFICATION_DATE IS NOT NULL
), resolved AS (
    SELECT p.note_id, p.HOUSEMAID_ID, p.AMOUNT, r.LIVE_OUT AS live_out_when_paid
    FROM paid p
    LEFT JOIN rev r ON r.maid_id = p.HOUSEMAID_ID AND r.changed_on <= p.note_day
    QUALIFY ROW_NUMBER() OVER (PARTITION BY p.note_id ORDER BY r.changed_on DESC) = 1
)
SELECT CASE
         WHEN a.live_out_when_paid IS NULL THEN 'BLOCKED - no revision before the note'
         WHEN a.live_out_when_paid = 1     THEN 'GREEN - was live-out when paid'
         ELSE                                   'RED - relocation paid to a LIVE-IN maid'
       END                                        AS verdict,
       COUNT(*)                                   AS notes,
       COUNT(DISTINCT a.HOUSEMAID_ID)             AS maids,
       ROUND(SUM(a.AMOUNT))                       AS aed,
       COUNT_IF(a.live_out_when_paid <> h.LIVE_OUT) AS differs_from_today,
       COUNT_IF(a.live_out_when_paid =  h.LIVE_OUT) AS same_as_today
FROM resolved a
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = a.HOUSEMAID_ID
GROUP BY 1
ORDER BY aed DESC;


-- TF8. 🔴 THE ONE THAT DECIDES WHETHER TF3 IS A FINDING. TF3 showed Medical Assistance at
--      46.6% self-approved and Taxi at 25.5%, against a human-expense-path norm of 2-4%
--      (Salary Dispute 2.7, Maids.at 2.2, MOHRE 4.3, Relocation 4.5). That reads as 12x and
--      7x the norm -- AED 27,203 approved by whoever asked for it.
--
--      IT IS NOT PUBLISHABLE YET. The same table shows Anti-attrition at 88.4% / AED 1.58m,
--      and anti-attrition is a BATCH JOB: it stamps one identity into both fields because
--      no human is in the loop. `MedicalAssistantJob` creates medical notes off the medical
--      and EID steps, so Medical's 46.6% may be that same signature wearing a person's name.
--      This session has already retracted one finding built on exactly this mistake
--      (REQUESTED_BY names a RUN, not a ROUTE).
--
--      The discriminator is CONCENTRATION: a job is one identity on hundreds of notes; real
--      self-approval is many managers each clearing their own. Names are counted, never selected.
--      MIDNIGHT_PCT is guarded -- the ALL-TYPES column beside it exposes the trap where
--      NOTE_DATE carries no time at all, in which case that signal is void, not unanimous.
WITH n AS (
    SELECT ID, AMOUNT, COALESCE(REASON,'(none)') AS payment_type, NOTE_DATE,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(REQUESTED_BY),''), '\\s+', ' '))) AS requester,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(APPROVED_BY),''),  '\\s+', ' '))) AS approver
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
), tagged AS (
    SELECT *, IFF(requester IS NOT NULL AND approver IS NOT NULL
                  AND requester = approver, 'SELF-APPROVED', 'separate or absent') AS lane
    FROM n
    WHERE payment_type IN ('Medical Assistance','Taxi Reimbursement','Anti-attrition Incentive',
                           'Salary Dispute','Maids.at other expenses')
), per_person AS (
    SELECT payment_type, lane, requester, COUNT(*) AS notes_by_this_person
    FROM tagged WHERE requester IS NOT NULL
    GROUP BY 1, 2, 3
), concentration AS (
    SELECT payment_type, lane,
           COUNT(*)                        AS distinct_requesters,
           MAX(notes_by_this_person)       AS biggest_single_requester,
           SUM(notes_by_this_person)       AS notes_with_a_requester
    FROM per_person GROUP BY 1, 2
)
SELECT t.payment_type, t.lane,
       COUNT(*)                                                   AS notes,
       ROUND(SUM(t.AMOUNT))                                       AS aed,
       c.distinct_requesters,
       c.biggest_single_requester,
       ROUND(100.0 * c.biggest_single_requester
             / NULLIF(c.notes_with_a_requester, 0), 1)            AS pct_held_by_one_identity,
       ROUND(100.0 * COUNT_IF(HOUR(t.NOTE_DATE) = 0
                              AND MINUTE(t.NOTE_DATE) = 0) / COUNT(*), 1) AS midnight_pct,
       (SELECT ROUND(100.0 * COUNT_IF(HOUR(NOTE_DATE) = 0 AND MINUTE(NOTE_DATE) = 0)
                     / COUNT(*), 1)
        FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
        WHERE NOTE_TYPE = 'ADDITION'
          AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()))  AS midnight_pct_ALL_TYPES_guard
FROM tagged t
LEFT JOIN concentration c ON c.payment_type = t.payment_type AND c.lane = t.lane
GROUP BY 1, 2, 5, 6, 7
ORDER BY t.payment_type, t.lane;


-- TF9. 🟡 TF2's REPLACEMENT — find the column that actually holds the expense CATEGORY.
--      Without it, George's Part 2A ask cannot be closed, TF4 cannot be re-run, and the
--      taxi half of the live-out test stays blocked (Live-out Transportation Assistance is
--      69% of taxi money and can only be isolated by category).
--      Two parts, both small. First: what columns exist on the two expense views at all.
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'MONEY_CONTROL_SILVER'
  AND TABLE_NAME IN ('EXPENSES_REQUESTS','EXPENSES_CONFIGURATION')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
