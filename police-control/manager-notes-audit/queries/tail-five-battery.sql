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


-- =====================================================================================
-- ROUND 3 — TF7 is the tail's first RED, TF8 killed a AED 1.58m false finding, and
-- TF9 opened four tests that reach far past these five types.
--
-- TF7  🔴 RED. 6 notes / 6 maids / AED 4,700 -- relocation paid to a maid who was LIVE-IN
--      on the day. The rule is CC live-out only; the CC half held, this half did not.
--      🟢 THE SELF-DIAGNOSTIC PAID FOR ITSELF. 5 of 66 notes resolve to a different
--      live_out than the maid carries today -- 3 REDs and 2 GREENs. So a current-state read
--      would have flagged 5 notes: 2 of them wrong, while MISSING 3 of the 6 real ones.
--      Half the true findings invisible and 40% of the flags false, on one column.
--
-- TF8  🔴 CONFIRMED THE HOLD WAS RIGHT. Anti-attrition's 8,095 self-approved notes carry
--      THREE distinct requesters and one identity holds 94.9% of them. That is a batch job
--      stamping itself into both fields. **AED 1,585,600 is a producer signature, not
--      misconduct** -- had TF3 been published on its face it would have been this session's
--      seventh retraction, and by far its largest.
--      Medical: 41 notes across 2 identities (61/39) -- a small team, looks HUMAN.
--      Taxi:    120 notes, ONE identity, 100% -- shape is identical to the job. UNRESOLVED.
--      ⚠️ MIDNIGHT IS DEAD AS A SIGNAL HERE. The guard did its job: 18.1% of all additions
--      are midnight-stamped, so the column carries real time -- but the KNOWN job
--      (anti-attrition) sits at 0.0%. Concentration discriminates; timestamp does not.
--
-- TF9  🟢 THE BIGGEST UNLOCK OF THE WHOLE BATTERY, and it was meant to be a fix-up query.
--      EXPENSES_CONFIGURATION carries CATEGORY, TOP_PARENT_CATEGORY, LIMIT_FOR_APPROVAL,
--      LIMIT_FOR_CEO_APPROVAL, REQUIRE_INVOICE, REQUIRE_ATTACHMENT, APPROVAL_METHOD,
--      APPROVE_HOLDER, ALLOW_TO_ADD_LOAN. EXPENSES_REQUESTS carries REQUESTED_BY,
--      APPROVED_BY, INVOICE_UPLOAD_DATE, LOAN_AMOUNT, DESCRIPTION.
--      Four tests that were never possible now are, and NONE of them are tail-five-specific:
--        (a) paid ABOVE the head's own configured approval limit
--        (b) paid with NO invoice where the head REQUIRES one
--        (c) self-approval AT SOURCE, on the request rather than the note's copy
--        (d) the loan-pairing rule (ALLOW_TO_ADD_LOAN vs LOAN_AMOUNT) -- the L-group's
--            "0% to 115%" problem, testable at last
-- =====================================================================================


-- TF10. 🟢 CLOSES GEORGE'S PART 2A ASK FROM THE DATABASE. The business ask was "a table:
--       payment type on the left, allowed expense categories on the right." CONFIG DECLARES
--       IT. Every head that produces a salary addition already names its category, its
--       approval limit, and whether it demands an invoice. This is the reference list,
--       authoritative, and it needs nobody's time to produce.
--       No join, no fan-out. Small result.
SELECT SALARY_ADDITION_TYPE,
       CODE,
       CAPTION,
       EXPENSE_TYPE,
       CATEGORY,
       TOP_PARENT_CATEGORY,
       STATUS,
       APPROVAL_METHOD,
       LIMIT_FOR_APPROVAL,
       LIMIT_FOR_CEO_APPROVAL,
       REQUIRE_INVOICE,
       REQUIRE_ATTACHMENT,
       ALLOW_TO_ADD_LOAN
FROM BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION
WHERE SALARY_ADDITION_TYPE IS NOT NULL
ORDER BY SALARY_ADDITION_TYPE, CODE;


-- TF11. 🟡 ESTABLISH THE JOIN KEY BEFORE USING IT -- the discipline TF2 failed to apply.
--       TF2 assumed a column's meaning from its name and got a workflow state. This one
--       PROFILES the three candidate keys on the requests actually behind the five types,
--       with no join at all, so the next round's join is chosen from evidence.
--       TASK_NAME and EXPENSE_REQUEST_TASK_NAME are DIFFERENT columns; only one is a head.
SELECT n.REASON                                        AS payment_type,
       COALESCE(x.EXPENSE_TYPE, '(null)')              AS expense_type,
       COALESCE(x.TASK_NAME, '(null)')                 AS task_name,
       COALESCE(x.EXPENSE_REQUEST_TASK_NAME, '(null)') AS request_task_name,
       COUNT(*)                                        AS notes,
       ROUND(SUM(n.AMOUNT))                            AS aed
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
  AND n.REASON IN ('Taxi Reimbursement','Accommodation Relocation',
                   'Maids.at other expenses','Medical Assistance',
                   'MOHRE requirement additions')
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
  AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY 1, 2, 3, 4
ORDER BY payment_type, aed DESC;


-- TF12. 🔴 SELF-APPROVAL AT SOURCE — settles the Taxi question TF8 left open, and needs
--       no config join. The note carries a COPY of who asked and who approved; the expense
--       request is the ORIGINAL, and the approval gate lives there. If taxi's single
--       identity is a service account it will look the same on both. If it is a person
--       clearing their own reimbursements, the request will say so in its own fields.
--       Run across every payment type so the five are read against the house, not alone.
--       Names are compared and counted, never selected.
WITH linked AS (
    SELECT n.ID AS note_id, COALESCE(n.REASON,'(none)') AS payment_type, n.AMOUNT,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(x.REQUESTED_BY),''), '\\s+', ' '))) AS req,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(x.APPROVED_BY),''),  '\\s+', ' '))) AS apr,
           x.REQUEST_STATUS
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), people AS (
    SELECT payment_type, req, COUNT(*) AS n_by_person
    FROM linked
    WHERE req IS NOT NULL AND apr IS NOT NULL AND req = apr
    GROUP BY 1, 2
), conc AS (
    SELECT payment_type, COUNT(*) AS self_identities,
           MAX(n_by_person) AS biggest_one, SUM(n_by_person) AS self_notes
    FROM people GROUP BY 1
)
SELECT l.payment_type,
       IFF(l.payment_type IN ('Taxi Reimbursement','Accommodation Relocation',
                              'Maids.at other expenses','Medical Assistance',
                              'MOHRE requirement additions'), 'TAIL FIVE', '') AS in_scope,
       COUNT(*)                                                     AS linked_notes,
       ROUND(SUM(l.AMOUNT))                                         AS aed,
       COUNT_IF(l.req IS NOT NULL AND l.apr IS NOT NULL AND l.req = l.apr) AS self_at_source,
       ROUND(100.0 * COUNT_IF(l.req IS NOT NULL AND l.apr IS NOT NULL
                              AND l.req = l.apr) / COUNT(*), 1)     AS pct_self,
       ROUND(SUM(IFF(l.req IS NOT NULL AND l.apr IS NOT NULL AND l.req = l.apr,
                     l.AMOUNT, 0)))                                 AS aed_self,
       COUNT_IF(l.apr IS NULL)                                      AS request_never_approved,
       c.self_identities,
       ROUND(100.0 * c.biggest_one / NULLIF(c.self_notes, 0), 1)    AS pct_held_by_one
FROM linked l
LEFT JOIN conc c ON c.payment_type = l.payment_type
GROUP BY 1, 2, 9, 10
HAVING COUNT(*) >= 20
ORDER BY pct_self DESC;


-- =====================================================================================
-- ROUND 4 — config did not just close the reference-list ask. It named a control that is
-- being ROUTED AROUND, and it turned the whole tail into loan money.
--
-- TF10 🟢 PART 2A IS CLOSED FROM THE DATABASE. 31 heads declare their own salary addition
--      type, category, approval method, limit, invoice requirement and loan flag. George
--      never needed to write the table -- config already had it.
--
--      🔴 (a) THE INVOICE CONTROL IS ROUTED AROUND. Exactly three heads set
--          REQUIRE_INVOICE = TRUE: FT 26 (Medical assistance for housemaids), FT 229 (Taxi
--          rides - maids), FT 281 (Taxi rides for applicants). TF11 shows ALL THREE carry
--          ZERO of the 944 tail-five notes. Every dirham of the AED 219,143 flows through a
--          head with REQUIRE_INVOICE = FALSE. The finding is not "invoices are missing" --
--          it is that the heads demanding one are unused while their no-invoice twins carry
--          100% of the money.
--
--      🔴 (b) THE TAIL IS LOAN MONEY. ALLOW_TO_ADD_LOAN = TRUE on every head behind all
--          five types. Medical runs through "PCR Test & medical assistance Loan" and MOHRE
--          through "WPS Compliance Loan" -- these are ADVANCES, booked to be recovered. If
--          the loan side was never written, the company gave away money it meant to reclaim.
--          Up to AED 219,143 is exposed to that question. TF14 answers it.
--
--      ⚠️ (c) LIMIT_FOR_APPROVAL IS NOT A CEILING -- read it with APPROVAL_METHOD or it
--          inverts. It is populated only on APPROVAL_REQUIRED_ON_LIMIT heads, where it is
--          the threshold ABOVE WHICH approval is needed. Below it, an unapproved request is
--          CORRECT. Plain APPROVAL_REQUIRED heads leave it null and always need approval.
--          Taxi's 114 unapproved requests are probably TR 200 (limit 101, avg note 81.5) and
--          therefore legitimate; Maids.at's 217 sit on OEX (limit 200) and may not be.
--
--      🟡 (d) "MOHRE requirement additions" is CODE `WCL`, caption "Salary Mistake", type
--          "WPS Compliance Loan". The payslip names a regulator; the head names a payroll
--          error and a loan. Config declares it, so it is not a routing defect -- but the
--          maid's payslip does not say what the money is.
--
-- TF11 🟢 JOIN KEY ESTABLISHED BY EVIDENCE: EXPENSES_REQUESTS.EXPENSE_TYPE matches
--      EXPENSES_CONFIGURATION.EXPENSE_TYPE on all six observed values. TASK_NAME is empty
--      throughout and is not a key at all.
--      🔴 AND IT ISOLATED THE BIGGEST UNTESTED POPULATION IN THE TAIL: 320 notes /
--      AED 71,850 are "Live-out Transportation Assistance" -- 85% of taxi money by value.
--      Paid to a maid who was LIVE-IN that day, it is an allowance for a commute she was
--      not making. TF13 runs it.
--
-- TF12 🟡 SELF-APPROVAL AT SOURCE MATCHES THE NOTE'S COPY EXACTLY -- Medical 46.6% / 2
--      identities, Taxi 25.5% / 1 identity / 100%. So the note is a faithful copy and the
--      question was never a data-quality one. But it STILL cannot be called: TF10 revealed
--      APPROVE_HOLDER, and if the requester IS the designated approver for that head, then
--      self-approval is the design, not a breach. TF15 fetches it before anything is called.
--      (Airfare's expense route shows 83 notes / AED 147,500 -- the MANUAL path, the one
--      already carrying the AED 49,500 duplicate finding. 16.9% self-approved on it.)
-- =====================================================================================


-- TF13. 🔴 THE LARGEST UNTESTED MONEY IN THE TAIL — AED 71,850. Live-out Transportation
--       Assistance paid to a maid who was LIVE-IN on the day. TF5 found the flag, TF11 gave
--       the isolation key. This is the taxi half of the live-out rule that has been blocked
--       since the spec was written.
--       Same as-of machinery as TF7, and the same self-diagnostic: if nothing differs from
--       today, the join is decorative and the answer is a point read.
WITH lota AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.REASON = 'Taxi Reimbursement'
      AND x.EXPENSE_TYPE = 'Live-out Transportation Assistance'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), rev AS (
    SELECT ID AS maid_id, LIVE_OUT, LAST_MODIFICATION_DATE::DATE AS changed_on
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION
    WHERE LIVE_OUT IS NOT NULL AND LAST_MODIFICATION_DATE IS NOT NULL
), resolved AS (
    SELECT l.note_id, l.HOUSEMAID_ID, l.AMOUNT, r.LIVE_OUT AS live_out_when_paid
    FROM lota l
    LEFT JOIN rev r ON r.maid_id = l.HOUSEMAID_ID AND r.changed_on <= l.note_day
    QUALIFY ROW_NUMBER() OVER (PARTITION BY l.note_id ORDER BY r.changed_on DESC) = 1
)
SELECT CASE
         WHEN a.live_out_when_paid IS NULL THEN 'BLOCKED - no revision before the note'
         WHEN a.live_out_when_paid = 1     THEN 'GREEN - was live-out when paid'
         ELSE                                   'RED - live-out transport paid to a LIVE-IN maid'
       END                                          AS verdict,
       COUNT(*)                                     AS notes,
       COUNT(DISTINCT a.HOUSEMAID_ID)               AS maids,
       ROUND(SUM(a.AMOUNT))                         AS aed,
       COUNT_IF(a.live_out_when_paid <> h.LIVE_OUT) AS differs_from_today,
       COUNT_IF(a.live_out_when_paid =  h.LIVE_OUT) AS same_as_today
FROM resolved a
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = a.HOUSEMAID_ID
GROUP BY 1
ORDER BY aed DESC;


-- TF14. 🔴 THE LOAN THAT WAS NEVER BOOKED. Every head behind the tail five sets
--       ALLOW_TO_ADD_LOAN = TRUE, and two of them are named "Loan" outright. An advance
--       paid as an ADDITION with no loan written against it is money the company intended
--       to recover and then did not. This is the L-group's "0% to 115%" problem, which has
--       sat unmeasurable since the business-rules request was written.
--       Run across every linked type so the five are read against the house.
--       Config is de-duplicated to one row per expense type BEFORE the join -- a head list
--       is not guaranteed unique on that column and a fan-out would inflate every sum here.
WITH cfg AS (
    SELECT EXPENSE_TYPE, ALLOW_TO_ADD_LOAN, LOAN_TYPE, CODE
    FROM BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION
    WHERE EXPENSE_TYPE IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY EXPENSE_TYPE ORDER BY CODE) = 1
)
SELECT COALESCE(n.REASON,'(none)')                              AS payment_type,
       x.EXPENSE_TYPE                                           AS expense_head,
       c.ALLOW_TO_ADD_LOAN                                      AS head_allows_loan,
       COUNT(*)                                                 AS notes,
       ROUND(SUM(n.AMOUNT))                                     AS aed,
       COUNT_IF(x.LOAN_AMOUNT IS NULL OR x.LOAN_AMOUNT = 0)     AS NO_LOAN_BOOKED,
       ROUND(SUM(IFF(x.LOAN_AMOUNT IS NULL OR x.LOAN_AMOUNT = 0,
                     n.AMOUNT, 0)))                             AS aed_never_recoverable,
       COUNT_IF(x.LOAN_AMOUNT > 0)                              AS loan_booked,
       ROUND(SUM(IFF(x.LOAN_AMOUNT > 0, x.LOAN_AMOUNT, 0)))     AS aed_loan_booked,
       COUNT_IF(x.LOAN_AMOUNT > x.AMOUNT + 0.01)                AS loan_EXCEEDS_advance
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
LEFT JOIN cfg c ON c.EXPENSE_TYPE = x.EXPENSE_TYPE
WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
  AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY 1, 2, 3
HAVING COUNT(*) >= 10
ORDER BY aed_never_recoverable DESC;


-- TF15. 🔴 THE APPROVAL GATE, READ THE WAY CONFIG DEFINES IT — and the query that decides
--       whether Medical's 46.6% is a finding or a design.
--       Three verdicts, per head, because one rule does not fit three approval methods:
--         AUTO_APPROVED               -> no approver expected, absence is CORRECT
--         APPROVAL_REQUIRED_ON_LIMIT  -> approval needed only ABOVE limit_for_approval
--         APPROVAL_REQUIRED           -> approval needed on every request, always
--       APPROVE_HOLDER is carried through: if the requester IS the designated approver for
--       that head, self-approval is the DESIGN and must not be reported as a breach.
--       Names are compared and counted, never selected.
WITH cfg AS (
    SELECT EXPENSE_TYPE, CODE, APPROVAL_METHOD, LIMIT_FOR_APPROVAL,
           APPROVE_HOLDER, MANAGER_NAME, REQUESTED_FROM
    FROM BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION
    WHERE EXPENSE_TYPE IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY EXPENSE_TYPE ORDER BY CODE) = 1
), j AS (
    SELECT COALESCE(n.REASON,'(none)') AS payment_type, x.EXPENSE_TYPE AS head,
           n.AMOUNT, x.AMOUNT AS req_amount,
           c.APPROVAL_METHOD, c.LIMIT_FOR_APPROVAL, c.APPROVE_HOLDER,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(x.REQUESTED_BY),''), '\\s+',' '))) AS req,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(x.APPROVED_BY),''),  '\\s+',' '))) AS apr,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(c.APPROVE_HOLDER),''),'\\s+',' '))) AS holder
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    LEFT JOIN cfg c ON c.EXPENSE_TYPE = x.EXPENSE_TYPE
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
)
SELECT payment_type, head,
       COALESCE(APPROVAL_METHOD,'(no head matched)') AS approval_method,
       LIMIT_FOR_APPROVAL                            AS approval_limit,
       COUNT(*)                                      AS notes,
       ROUND(SUM(AMOUNT))                            AS aed,
       COUNT_IF(APPROVAL_METHOD = 'APPROVAL_REQUIRED' AND apr IS NULL)     AS REQUIRED_but_unapproved,
       ROUND(SUM(IFF(APPROVAL_METHOD = 'APPROVAL_REQUIRED' AND apr IS NULL,
                     AMOUNT, 0)))                                          AS aed_required_unapproved,
       COUNT_IF(APPROVAL_METHOD = 'APPROVAL_REQUIRED_ON_LIMIT'
                AND req_amount > LIMIT_FOR_APPROVAL AND apr IS NULL)       AS OVER_LIMIT_unapproved,
       ROUND(SUM(IFF(APPROVAL_METHOD = 'APPROVAL_REQUIRED_ON_LIMIT'
                     AND req_amount > LIMIT_FOR_APPROVAL AND apr IS NULL,
                     AMOUNT, 0)))                                          AS aed_over_limit,
       COUNT_IF(req IS NOT NULL AND apr = req AND holder IS NOT NULL AND holder = req)
                                                                           AS self_BY_DESIGN,
       COUNT_IF(req IS NOT NULL AND apr = req AND (holder IS NULL OR holder <> req))
                                                                           AS self_NOT_the_holder,
       ROUND(SUM(IFF(req IS NOT NULL AND apr = req AND (holder IS NULL OR holder <> req),
                     AMOUNT, 0)))                                          AS aed_self_not_holder
FROM j
GROUP BY 1, 2, 3, 4
HAVING COUNT(*) >= 10
ORDER BY aed_required_unapproved + aed_over_limit + aed_self_not_holder DESC;


-- =====================================================================================
-- ROUND 5 — three tests, three findings REMOVED. Including one this file created itself.
--
-- TF13 🟢 AED 71,850 CLEARS. 317 of 320 live-out transport notes went to a maid who was
--      live-out that day; 3 notes / AED 392 did not. 36 GREENs resolve to a different flag
--      than the maid carries today, so the as-of join was doing real work -- the clear is
--      earned, not an artifact. The largest untested population in the tail is clean.
--
-- TF14 🔴🔴 READ THIS BEFORE READING THE RESULT. My own column is misnamed and would have
--      produced the biggest false finding of the session. `aed_never_recoverable` is
--      meaningless on any row where HEAD_ALLOWS_LOAN = FALSE: anti-attrition (AED 1,829,536),
--      Bonus (225,791), Airfare (137,500) and Abu Dhabi (18,250) are GRANTS. No loan is
--      booked because no loan may be booked. Summing the column reports AED 2.2m of
--      "unrecovered" money that was never lent. **The filter is the finding; the column is not.**
--
--      On the TRUE rows the picture is real, and it has its own control built in:
--        Accommodation Relocation  65 of 66 loans booked  = 98.5%  <- THE MECHANISM WORKS
--        Live-out Transportation  122 of 320             = 38%
--        Maids.at other expenses   77 of 273             = 28%
--        Salary Dispute            41 of 970             =  4.2%
--        MOHRE / WPS Compliance Loan  2 of 46            =  4.3%   AED 9,385 unbooked
--        Medical / PCR Test & medical assistance Loan  3 of 88 = 3.4%  AED 20,835 unbooked
--      ⚠️ ALLOW_TO_ADD_LOAN reads "may", not "must" -- an unbooked loan is not automatically
--      a finding. But TWO heads are named "Loan" outright, so their money is an ADVANCE by
--      definition. AED 30,220 on those two, against a 98.5% benchmark. TF16 tests recovery.
--
-- TF15 🟢🟢 THE APPROVAL GATE IS CLEAN, AND IT RETRACTS MY OWN CONCERN FROM TWO ROUNDS AGO.
--      REQUIRED_but_unapproved = 0 and OVER_LIMIT_unapproved = 0 on ALL ELEVEN head/type
--      combinations, AED 2.8m. I had flagged "Maids.at: 217 of 273 notes with no approver,
--      40% of the type -- a gate that exists and is being skipped." IT IS NOT. Maids.at is
--      APPROVAL_REQUIRED_ON_LIMIT with a limit of 200; below it an unapproved request is
--      CORRECT. Same for taxi's 114. Reading the note's APPROVED_BY without the head's
--      approval method invented a AED 20,532 finding out of a compliant control.
--
--      🟢 AND APPROVE_HOLDER COLLAPSES THE SELF-APPROVAL FINDING:
--        Taxi   120 self-approvals -> 120 BY DESIGN, 0 breaches. The single identity holding
--               100% was the head's DESIGNATED APPROVER. Taxi goes to ZERO.
--        Medical 41 -> 25 by design, 16 real. AED 12,266 -> AED 3,995, a 67% cut.
--      Real self-approval breaches, job excluded: Airfare 8,500 + Medical 3,995 + Bonus 2,000
--      + Salary Dispute 1,726 + MOHRE 610 = **AED 16,831 across 31 notes.**
--      Anti-attrition's 8,093 are excluded as the batch job TF8 identified -- APPROVE_HOLDER
--      does not excuse them, concentration explains them.
-- =====================================================================================


-- TF16. 🔴 WAS THE ADVANCE EVER RECOVERED? The only test that can settle TF14 without a
--       business answer. Two heads are named "Loan"; AED 30,220 of their money was paid as
--       an addition with no loan booked. If nothing was ever deducted back, it was a gift.
--
--       🟢 THE QUERY VALIDATES ITSELF. Accommodation Relocation is carried as a POSITIVE
--       CONTROL: 65 of its 66 notes DO book a loan, so if deduction notes are the recovery
--       mechanism, that row must light up. If the control shows no deductions either, then
--       deductions are not how loans are recovered and THIS TEST IS VOID, not negative --
--       exactly the failure TF4 made when zero join matches read as clean.
--
--       Note types are grouped rather than assumed: the recovery vocabulary is learned here.
WITH advances AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT,
           x.EXPENSE_TYPE AS head,
           IFF(x.LOAN_AMOUNT > 0, 'loan booked', 'NO loan booked') AS loan_side
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND x.EXPENSE_TYPE IN ('PCR Test & medical assistance Loan',
                             'WPS Compliance Loan',
                             'Accommodation Relocation')
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), later AS (
    SELECT HOUSEMAID_ID, NOTE_DATE::DATE AS d, NOTE_TYPE, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE <> 'ADDITION'
), per_note AS (
    SELECT a.note_id, a.head, a.loan_side, a.AMOUNT,
           COUNT(l.d)                                   AS later_non_additions,
           COALESCE(SUM(l.AMOUNT), 0)                   AS aed_taken_back,
           LISTAGG(DISTINCT l.NOTE_TYPE, ' | ')
             WITHIN GROUP (ORDER BY l.NOTE_TYPE)        AS note_types_seen
    FROM advances a
    LEFT JOIN later l
           ON l.HOUSEMAID_ID = a.HOUSEMAID_ID
          AND l.d >= a.note_day
          AND l.d <= DATEADD('month', 12, a.note_day)
    GROUP BY 1, 2, 3, 4
)
SELECT head, loan_side,
       COUNT(*)                                            AS notes,
       ROUND(SUM(AMOUNT))                                  AS aed_advanced,
       COUNT_IF(later_non_additions = 0)                   AS NOTHING_EVER_TAKEN_BACK,
       ROUND(SUM(IFF(later_non_additions = 0, AMOUNT, 0))) AS aed_never_recovered,
       COUNT_IF(later_non_additions > 0)                   AS something_deducted_later,
       ROUND(SUM(aed_taken_back))                          AS aed_deducted_total,
       MAX(note_types_seen)                                AS recovery_vocabulary
FROM per_note
GROUP BY 1, 2
ORDER BY head, loan_side;


-- TF17. 🟡 THE FALLBACK, and it costs one small result. If TF16's control row shows no
--       deductions, loans are recovered somewhere other than the notes table and TF16 is
--       void. This names where to look, so that outcome costs a query rather than a round.
SELECT TABLE_SCHEMA, TABLE_NAME, COUNT(*) AS columns,
       LISTAGG(COLUMN_NAME, ' | ') WITHIN GROUP (ORDER BY ORDINAL_POSITION) AS cols
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE (TABLE_NAME ILIKE '%LOAN%' OR TABLE_NAME ILIKE '%DEDUCT%'
    OR TABLE_NAME ILIKE '%INSTALL%' OR TABLE_NAME ILIKE '%REPAY%')
GROUP BY 1, 2
ORDER BY 1, 2;
