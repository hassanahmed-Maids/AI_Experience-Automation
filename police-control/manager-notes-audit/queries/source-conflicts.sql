-- =====================================================================================
-- TWO SOURCE CONFLICTS — both between a CURRENT-STATE column and the STATUS LOG.
-- Neither is resolved by preferring one source. The first question in both cases is
-- whether the two columns even measure the same thing; only if they do is one of them wrong.
--
-- Every column used here has appeared in a schema result or a query that ran THIS SESSION
-- (P1a), after three guessed columns in one file earlier today:
--   ASSIGNED_OFFICE_WORK_REASON_ID  — S1b sweep, on INFO and INFO_REVISION
--   LAST_MODIFICATION_DATE          — used by E5, which ran
--   HOUSEMAID_STATUS_LOGS.*         — S1 sweep, S3/S4 ran
--   HOUSEMAIDS_INFO.DATE_OF_TERMINATION — used by R5, which ran
--   FACT_MAID_TERMINATIONS.*        — S1 sweep
-- =====================================================================================


-- ============================ CONFLICT 1 — OFFICE WORK ============================
-- OW5b cleared 92/92 on `ASSIGNED_OFFICE_WORK_REASON_ID` read as-of from the Envers
-- revision table. S4 says only 15 of 92 were `ASSIGNED_OFFICE_WORK` by status when paid;
-- 62 were `WITH_CLIENT`.
--
-- ⚠️ THE LIKELY ANSWER IS THAT NEITHER IS WRONG. A reason-id is a REASON FOR AN ASSIGNMENT;
-- a status is a PLACEMENT STATE. A maid can carry an office-work reason while her status
-- says where she physically is. If so the two never contradicted and OW5b's clear stands —
-- but on a narrower claim than "she was doing office work."

-- OWC1. THE CROSS-TAB. Every one of the 92 notes, both sources side by side.
--       Four cells. The diagonal is agreement; the off-diagonal is what needs explaining.
WITH ow AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Office Work Addition' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
), by_revision AS (
    SELECT o.note_id,
           IFF(r.ASSIGNED_OFFICE_WORK_REASON_ID IS NOT NULL, 'reason set', 'no reason') AS revision_says
    FROM ow o
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION r
           ON r.ID = o.HOUSEMAID_ID
          AND r.LAST_MODIFICATION_DATE::DATE <= o.note_day
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o.note_id ORDER BY r.LAST_MODIFICATION_DATE DESC) = 1
), by_status AS (
    SELECT o.note_id, COALESCE(l.TO_STATUS, '(no interval)') AS status_says
    FROM ow o
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS l
           ON l.HOUSEMAID_ID = o.HOUSEMAID_ID
          AND o.note_day >= l.CHANGE_DATE::DATE
          AND (l.NEXT_CHANGE_DATE IS NULL OR o.note_day < l.NEXT_CHANGE_DATE::DATE)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY o.note_id ORDER BY l.CHANGE_DATE DESC) = 1
)
SELECT v.revision_says,
       IFF(s.status_says = 'ASSIGNED_OFFICE_WORK', 'status = office work', s.status_says) AS status_says,
       COUNT(*)                 AS notes,
       ROUND(SUM(o.AMOUNT))     AS aed
FROM ow o
JOIN by_revision v ON v.note_id = o.note_id
JOIN by_status   s ON s.note_id = o.note_id
GROUP BY 1, 2
ORDER BY notes DESC;


-- OWC2. THE BASE RATE THAT DECIDES IT. Among ALL maids currently carrying an office-work
--       reason id, what status do they hold now? If a large share are WITH_CLIENT, the two
--       columns plainly measure different things and there was never a contradiction.
--       If almost all are ASSIGNED_OFFICE_WORK, they do measure the same thing and OWC1's
--       off-diagonal is a real defect.
WITH assigned AS (
    SELECT ID AS maid_id
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO
    WHERE ASSIGNED_OFFICE_WORK_REASON_ID IS NOT NULL
), now_status AS (
    SELECT HOUSEMAID_ID, TO_STATUS
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS
    WHERE NEXT_CHANGE_DATE IS NULL          -- the maid's open interval = her status now
)
SELECT COALESCE(n.TO_STATUS, '(no open interval)') AS current_status,
       COUNT(*)                                    AS maids,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM assigned a
LEFT JOIN now_status n ON n.HOUSEMAID_ID = a.maid_id
GROUP BY 1
ORDER BY maids DESC;


-- ============================ CONFLICT 2 — THE RAFFLE ============================
-- R5 found 15 wins / 13 maids / AED 3,000 where `HOUSEMAIDS_INFO.DATE_OF_TERMINATION`
-- predates the draw, median 558 days. S4 finds only 2 notes / AED 400 in a no-show status
-- and none in EMPLOYEMENT_TERMINATED.
--
-- ⚠️ THE HYPOTHESIS TO KILL FIRST IS RE-HIRING. `DATE_OF_TERMINATION` is CURRENT STATE on
-- the maid record. If a maid is terminated, re-hired, and the column is not cleared, she
-- reads as "terminated 558 days before winning" while the status log correctly shows her
-- active on the day. **Status activity AFTER the termination date is the decisive evidence**,
-- and it is the last two columns below.

-- RFC1. All three sources per raffle note, with re-hire evidence attached.
WITH rp AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Raffle Prize' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
), with_term AS (
    SELECT r.note_id, r.HOUSEMAID_ID, r.note_day, r.AMOUNT,
           h.DATE_OF_TERMINATION::DATE AS term_current_state,
           f.TERMINATION_DATE          AS term_fact_table
    FROM rp r
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = r.HOUSEMAID_ID
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.FACT_MAID_TERMINATIONS f ON f.HOUSEMAID_ID = r.HOUSEMAID_ID
    QUALIFY ROW_NUMBER() OVER (PARTITION BY r.note_id ORDER BY f.TERMINATION_DATE DESC) = 1
), status_at AS (
    SELECT t.note_id, COALESCE(l.TO_STATUS, '(no interval)') AS status_when_paid
    FROM with_term t
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS l
           ON l.HOUSEMAID_ID = t.HOUSEMAID_ID
          AND t.note_day >= l.CHANGE_DATE::DATE
          AND (l.NEXT_CHANGE_DATE IS NULL OR t.note_day < l.NEXT_CHANGE_DATE::DATE)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY t.note_id ORDER BY l.CHANGE_DATE DESC) = 1
), rehire AS (
    SELECT t.note_id,
           COUNT(l.STATUS_LOG_ID) AS status_changes_after_termination
    FROM with_term t
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS l
           ON l.HOUSEMAID_ID = t.HOUSEMAID_ID
          AND t.term_current_state IS NOT NULL
          AND l.CHANGE_DATE::DATE > t.term_current_state
    GROUP BY 1
)
SELECT CASE
         WHEN t.term_current_state IS NULL                 THEN 'no termination on the maid record'
         WHEN t.term_current_state >= t.note_day           THEN 'terminated on/after the draw'
         ELSE                                                   'terminated BEFORE the draw (R5 flagged these)'
       END                                                  AS termination_reading,
       s.status_when_paid,
       COUNT(*)                                             AS notes,
       COUNT(DISTINCT t.HOUSEMAID_ID)                       AS maids,
       ROUND(SUM(t.AMOUNT))                                 AS aed,
       ROUND(MEDIAN(DATEDIFF('day', t.term_current_state, t.note_day))) AS median_days_since_termination,
       -- THE DECIDING COLUMNS: activity after the termination date means she came back,
       -- and "terminated before the draw" is an artefact of a stale current-state column.
       SUM(rh.status_changes_after_termination)             AS total_status_changes_after_term,
       COUNT_IF(rh.status_changes_after_termination > 0)    AS notes_with_activity_after_term
FROM with_term t
JOIN status_at s ON s.note_id = t.note_id
LEFT JOIN rehire rh ON rh.note_id = t.note_id
GROUP BY 1, 2
ORDER BY notes DESC;
