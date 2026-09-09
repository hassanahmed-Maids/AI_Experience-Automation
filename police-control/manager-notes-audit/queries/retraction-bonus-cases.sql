-- =====================================================================================
-- RETRACTING-RESIGNATION BONUS — the ten cases, attributed.
--
-- Finding under investigation: 10 notes / AED 7,126 in 12 months on a path that is
-- @Deprecated in code, filtered out of RetractingResignationJob, commented out of the UI,
-- and whose config head RRB-01 is DISABLED. Four shut-offs, and the money still moves.
--
-- ⚠️ OUTPUT IS PER-MAID. Keep the result in the warehouse or a file for payroll; it does not
--    belong in a chat transcript. Same handling as the 58-maid remediation list.
-- ⚠️ NAMES ARE DELIBERATELY NOT SELECTED. EXPENSES_REQUESTS carries BENEFICIARY_NAME and
--    REQUESTER_CLEAN_NAME; HOUSEMAID_ID is sufficient to action a case and does not put a
--    person's name in an export that will be forwarded.
-- ⚠️ NOTE_REASON is free text and is included ONLY because it is the evidence for the
--    classification — these ten were identified by narrative, not by a structured field
--    (PURPOSE_ID is not in the warehouse). Read it; do not republish it.
--
-- WHAT TO CHECK IN THE RESULT, before treating this as ten cases:
--   1. expense_head — if it is not a retraction head, or is '(no request linked)', these are
--      NOT coming through DelighterService and the attribution is wrong. Retract, don't reword.
--   2. status_when_paid — a retraction bonus to a maid already EMPLOYEMENT_TERMINATED or
--      NO_SHOW on the day retracted nothing. That turns a control finding into a money finding.
--   3. days_since_termination — populated means the maid has a termination on record; combined
--      with a later status it may be the re-hire artefact that killed the raffle finding.
-- =====================================================================================

SELECT n.ID                                              AS note_id,
       n.HOUSEMAID_ID,
       n.NOTE_DATE::DATE                                 AS note_day,
       n.AMOUNT                                          AS aed,
       n.NOTE_REASON                                     AS narrative,          -- the classifier
       n.REQUESTED_BY                                    AS note_requested_by,
       n.APPROVED_BY                                     AS note_approved_by,

       -- the expense side: is this really the retraction path?
       COALESCE(x.EXPENSE_TYPE,  '(no request linked)')  AS expense_head,
       COALESCE(x.REQUEST_STATUS,'(none)')               AS request_status,
       x.CREATION_DATE::DATE                             AS request_raised_on,
       x.STATUS_CHANGE_DATE::DATE                        AS request_status_on,
       x.AMOUNT                                          AS request_aed,
       x.LOAN_AMOUNT                                     AS request_loan_aed,
       x.DESCRIPTION                                     AS request_description,

       -- point-in-time context, read from the logs rather than the maid record
       COALESCE(l.TO_STATUS, '(no interval)')            AS status_when_paid,
       COALESCE(t.TO_TYPE,   '(no interval)')            AS type_when_paid,

       -- tenure and exit context
       h.START_DATE::DATE                                AS start_date,
       DATEDIFF('day', h.START_DATE::DATE, n.NOTE_DATE::DATE)          AS days_into_service,
       h.DATE_OF_TERMINATION::DATE                       AS termination_on_record,
       DATEDIFF('day', h.DATE_OF_TERMINATION::DATE, n.NOTE_DATE::DATE) AS days_since_termination

FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x
       ON x.ID = n.EXPENSE_ID
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h
       ON h.ID = n.HOUSEMAID_ID
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS l
       ON l.HOUSEMAID_ID = n.HOUSEMAID_ID
      AND n.NOTE_DATE::DATE >= l.CHANGE_DATE::DATE
      AND (l.NEXT_CHANGE_DATE IS NULL OR n.NOTE_DATE::DATE < l.NEXT_CHANGE_DATE::DATE)
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
       ON t.HOUSEMAID_ID = n.HOUSEMAID_ID
      AND n.NOTE_DATE::DATE >= t.CHANGE_DATE::DATE
      AND (t.NEXT_CHANGE_DATE IS NULL OR n.NOTE_DATE::DATE < t.NEXT_CHANGE_DATE::DATE)
WHERE n.NOTE_TYPE = 'ADDITION'
  AND n.REASON    = 'Bonus'
  AND n.AMOUNT    > 0
  AND n.NOTE_REASON ILIKE '%retract%'
QUALIFY ROW_NUMBER() OVER (
          PARTITION BY n.ID ORDER BY l.CHANGE_DATE DESC, t.CHANGE_DATE DESC) = 1
ORDER BY note_day DESC;
