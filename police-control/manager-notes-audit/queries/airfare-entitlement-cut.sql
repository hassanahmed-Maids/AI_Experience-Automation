-- =====================================================================================
-- AIRFARE ENTITLEMENT CUT — settling the AED 137,500 MV candidate.
--
-- THE PROBLEM. S5 found 76 airfare notes / AED 137,500 where the maid's contract type
-- resolved to MV, against a CC-only rule. But the self-diagnostic fired: **only 1 of the 76
-- resolved to a PAST type interval.** An airfare note is dated `payrollDueDate`, and the code
-- copies that verbatim into `noteDate` — so the note is dated when the money is DUE, not when
-- the entitlement was GRANTED. A maid who was CC at renewal and switched to MV before the
-- payroll cycle resolves as MV and gets counted wrongly.
--
-- THE OBVIOUS FIX IS NOT AVAILABLE. Resolving type as of the note's own creation timestamp
-- would be exact — but **`CREATION_DATE` is unverified on this view.** Every use of that column
-- in this repo is on COMPLAINTS, not on HOUSEMAID_MANAGER_NOTES. Building on it would be the
-- P1 failure this audit has already paid for twice in one battery.
--
-- SO AF2 ASKS A WEAKER QUESTION THAT NEEDS NOTHING NEW, AND ANSWERS IT EXACTLY:
-- instead of pinpointing the entitlement date, ask whether the maid was **CC at ANY point in
-- the 24 months before the note**. The airfare cadence makes that the right window — 6 months
-- before labour-card expiry on a first renewal, 16 months since the last ticket after that,
-- a 5-month duplicate guard, and renewals recurring roughly every 2 years. If she was MV
-- continuously across that whole span, **no CC entitlement could have arisen at any date
-- inside it**, and the future-dating confound cannot rescue the note.
--
-- That makes AF2 a CONSERVATIVE FLOOR, not an estimate. It will under-count real violations
-- (a maid CC 23 months ago and MV ever since still passes) and it cannot over-count. A number
-- that can only be too small is publishable; one that might be too large is not.
-- =====================================================================================


-- AF1. P1 FIRST — what date columns does the notes view actually have? If a real creation
--      timestamp exists, AF2's conservative window can later be replaced by the exact cut.
--      Also sweeps for a ScheduledAnnualVacation table, which is where the entitlement is
--      born (AddScheduledAnnualVacationService) and would date it precisely.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE (TABLE_NAME = 'HOUSEMAID_MANAGER_NOTES' AND DATA_TYPE LIKE '%TIMESTAMP%')
   OR TABLE_NAME ILIKE '%SCHEDULED%VACATION%'
   OR TABLE_NAME ILIKE '%ANNUAL%VACATION%'
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;


-- AF2. 🔴 THE CUT. Was she CC at ANY point in the 24 months before the note?
--      An interval [CHANGE_DATE, NEXT_CHANGE_DATE) overlaps the window [due_day-730, due_day]
--      when CHANGE_DATE <= due_day AND (NEXT_CHANGE_DATE IS NULL OR NEXT_CHANGE_DATE >= window start).
--      No QUALIFY here on purpose — this counts ALL overlapping intervals rather than picking one.
WITH af AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS due_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Airfare Ticket' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
), win AS (
    SELECT a.note_id, a.HOUSEMAID_ID, a.AMOUNT, a.due_day,
           COUNT(t.TO_TYPE)                          AS intervals_in_window,
           COUNT_IF(t.TO_TYPE ILIKE 'CC%')           AS cc_intervals_in_window,
           COUNT_IF(t.TO_TYPE = 'MV')                AS mv_intervals_in_window,
           MAX(IFF(t.NEXT_CHANGE_DATE IS NULL AND t.TO_TYPE = 'MV', 1, 0)) AS mv_is_her_open_interval
    FROM af a
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
           ON t.HOUSEMAID_ID = a.HOUSEMAID_ID
          AND t.CHANGE_DATE::DATE <= a.due_day
          AND (t.NEXT_CHANGE_DATE IS NULL
               OR t.NEXT_CHANGE_DATE::DATE >= DATEADD('day', -730, a.due_day))
    GROUP BY 1, 2, 3, 4
)
SELECT CASE
         WHEN intervals_in_window = 0        THEN 'BLOCKED - no type history in the 24m window'
         WHEN cc_intervals_in_window = 0     THEN 'RED - MV for the WHOLE 24m entitlement window'
         WHEN mv_intervals_in_window > 0     THEN 'AMBER - CC and MV both appear in the window'
         ELSE                                     'GREEN - CC throughout'
       END                                   AS verdict,
       COUNT(*)                              AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)          AS maids,
       ROUND(SUM(AMOUNT))                    AS aed,
       ROUND(AVG(intervals_in_window), 1)    AS avg_type_changes_in_window
FROM win
GROUP BY 1
ORDER BY aed DESC;


-- AF3. HOW BIG IS THE CONFOUND, ACTUALLY? The claim that airfare notes are dated to 2028 has
--      been carried since the first deep-dive and never re-measured. If almost nothing is
--      future-dated, the whole worry is small and AF2's conservatism costs more than it buys;
--      if a lot is, the exact cut in AF1 becomes worth chasing.
--      NOTE this deliberately does NOT filter NOTE_DATE <= CURRENT_DATE — the future-dated
--      notes are the population it exists to count, and the 12-month tests above exclude them.
SELECT CASE
         WHEN NOTE_DATE > CURRENT_DATE THEN 'FUTURE-dated'
         ELSE                               'past or today'
       END                                            AS dating,
       COUNT(*)                                       AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                   AS maids,
       ROUND(SUM(AMOUNT))                             AS aed,
       MIN(NOTE_DATE)::DATE                           AS earliest,
       MAX(NOTE_DATE)::DATE                           AS latest,
       ROUND(AVG(DATEDIFF('day', CURRENT_DATE, NOTE_DATE))) AS avg_days_from_today
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Airfare Ticket' AND AMOUNT > 0
GROUP BY 1
ORDER BY notes DESC;
