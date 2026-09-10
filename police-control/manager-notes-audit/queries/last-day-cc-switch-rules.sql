-- =====================================================================================
-- LAST DAY CC SWITCH ADJUSTMENT — the three business rules.
-- Rules given by the requestor 2026-09-10:
--   R1  the maid must be MV
--   R2  no duplication
--   R3  the note must not exceed AED 150
--
-- ⚠️ R1 HAS A TIMING AMBIGUITY AND IT IS NOT RESOLVED HERE ON PURPOSE. The note settles the
--    LAST DAY OF CC, so on the note date the maid may still be CC (that final day) or may
--    already be MV. Reading it one way and reporting a number would repeat the airfare error,
--    where a point read gave AED 137,500 and the truth was 4,500.
--    LD1 therefore reports BOTH: her type as of the note date, and whether an MV switch
--    occurred within 31 days either side. Pick the rule once the shape is visible.
--
-- ⚠️ R2 — "duplication" is defined here as more notes than switches. A maid who genuinely
--    switches twice in the year should have two notes; counting notes alone would flag her.
--    This audit has already overstated a duplicate count 2x by using the wrong denominator.
-- =====================================================================================


-- LD1. R1 — WAS SHE MV? Both readings, side by side. No verdict yet.
WITH ld AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Last Day CC Switch Adjustment' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), at_note AS (
    SELECT l.note_id, t.TO_TYPE AS type_on_note_day
    FROM ld l
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
           ON t.HOUSEMAID_ID = l.HOUSEMAID_ID
          AND l.note_day >= t.CHANGE_DATE::DATE
          AND (t.NEXT_CHANGE_DATE IS NULL OR l.note_day < t.NEXT_CHANGE_DATE::DATE)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY l.note_id ORDER BY t.CHANGE_DATE DESC) = 1
), switched AS (
    SELECT l.note_id,
           COUNT_IF(t.TO_TYPE = 'MV')                                        AS mv_switches_near,
           MIN(ABS(DATEDIFF('day', t.CHANGE_DATE::DATE, l.note_day)))        AS days_to_nearest_mv
    FROM ld l
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
           ON t.HOUSEMAID_ID = l.HOUSEMAID_ID
          AND t.TO_TYPE = 'MV'
          AND t.CHANGE_DATE::DATE BETWEEN DATEADD('day', -31, l.note_day)
                                      AND DATEADD('day',  31, l.note_day)
    GROUP BY 1
)
SELECT COALESCE(a.type_on_note_day, '(no type interval)')  AS type_on_note_day,
       IFF(s.mv_switches_near > 0, 'MV switch within 31d', 'no MV switch nearby') AS switch_evidence,
       COUNT(*)                                            AS notes,
       COUNT(DISTINCT l.HOUSEMAID_ID)                      AS maids,
       ROUND(SUM(l.AMOUNT))                                AS aed,
       ROUND(MEDIAN(s.days_to_nearest_mv))                 AS median_days_to_switch
FROM ld l
JOIN at_note  a ON a.note_id = l.note_id
JOIN switched s ON s.note_id = l.note_id
GROUP BY 1, 2
ORDER BY notes DESC;


-- LD2. R2 — DUPLICATION, measured against switches rather than against nothing.
--      A maid who switched twice should have two notes; flagging on note count alone is the
--      error that inflated an earlier duplicate count from 259 to 516.
WITH ld AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Last Day CC Switch Adjustment' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), per_maid AS (
    SELECT HOUSEMAID_ID, COUNT(*) AS notes, ROUND(SUM(AMOUNT)) AS aed,
           MIN(note_day) AS first_note, MAX(note_day) AS last_note,
           DATEDIFF('day', MIN(note_day), MAX(note_day)) AS span_days
    FROM ld GROUP BY 1
), sw AS (
    SELECT t.HOUSEMAID_ID, COUNT(*) AS mv_switches
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
    JOIN (SELECT DISTINCT HOUSEMAID_ID FROM ld) m ON m.HOUSEMAID_ID = t.HOUSEMAID_ID
    WHERE t.TO_TYPE = 'MV'
      AND t.CHANGE_DATE >= DATEADD('month', -14, CURRENT_DATE())
    GROUP BY 1
)
SELECT CASE
         WHEN p.notes = 1                                   THEN 'one note - fine'
         WHEN p.notes <= COALESCE(s.mv_switches, 0)         THEN 'repeat, but she switched that often'
         WHEN p.span_days = 0                               THEN 'RED - same-day repeat'
         ELSE                                                    'RED - more notes than switches'
       END                              AS verdict,
       COUNT(*)                         AS maids,
       SUM(p.notes)                     AS notes,
       ROUND(SUM(p.aed))                AS aed,
       ROUND(MEDIAN(p.span_days))       AS median_days_apart
FROM per_maid p LEFT JOIN sw s ON s.HOUSEMAID_ID = p.HOUSEMAID_ID
GROUP BY 1
ORDER BY aed DESC;


-- LD3. R3 — THE AED 150 CEILING. Banded, so a near-miss cluster is visible rather than a
--      single count. The year's median is about 64, so anything at or above 150 is far out.
SELECT CASE WHEN AMOUNT <= 100          THEN 'a. up to 100'
            WHEN AMOUNT <= 140          THEN 'b. 101-140'
            WHEN AMOUNT <  150          THEN 'c. 141-149'
            WHEN AMOUNT =  150          THEN 'd. exactly 150 - at the cap'
            WHEN AMOUNT <= 200          THEN 'e. RED 151-200'
            ELSE                             'f. RED over 200'
       END                                      AS band,
       COUNT(*)                                 AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)             AS maids,
       ROUND(SUM(AMOUNT))                       AS aed,
       ROUND(SUM(GREATEST(AMOUNT - 150, 0)))    AS aed_over_the_cap
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Last Day CC Switch Adjustment' AND AMOUNT > 0
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
ORDER BY 1;


-- =====================================================================================
-- RESULTS 2026-09-10 — 213 of 213 on all three rules, and the reason is worth more than
-- the pass.
--
-- LD1 · R1  MV .............. 213/213. Type on the note day is MV, an MV switch sits within
--                             31 days, and **MEDIAN DAYS TO THAT SWITCH IS ZERO.**
--                             The timing ambiguity this file was written to protect against
--                             does not exist: the note is written on the day of the switch,
--                             so "still CC" and "already MV" are the same moment.
-- LD2 · R2  no duplication .. 213 maids, 213 notes. A clean 1:1. No same-day repeats, no
--                             maid with more notes than switches.
-- LD3 · R3  cap 150 ......... 192 notes up to AED 100, 21 at 101-140, **nothing at all in
--                             141-149, at 150, or above.** AED 0 over the cap.
--                             And no bunching under the cap either — the band immediately
--                             below it is empty, which is the opposite of what a gamed
--                             threshold looks like. Compare Maids.at, whose average note is
--                             188 against a 200 gate.
--
-- 🟢 WHY THIS TYPE IS CLEAN, STATED AS A MECHANISM RATHER THAN A SCORE.
--    Median zero days between the event and the note means **the note IS the event**. There
--    is no interval in which a maid's eligibility can change between being checked and being
--    paid — so there is no gap for a finding to live in.
--
--    Every type in this audit that produced findings has a non-zero gap:
--      anti-attrition  checks at selection, pays two hops later
--      airfare         dated `payrollDueDate`, sometimes years after the entitlement
--      office work     may be paid long after the work was done
--      prorated salary eligibility resolved at a date the note does not carry
--
--    This is the measured proof of the audit's closing argument: the fix is not thirteen
--    patches, it is one rule — **validate at write time** — and this type already does.
-- =====================================================================================
