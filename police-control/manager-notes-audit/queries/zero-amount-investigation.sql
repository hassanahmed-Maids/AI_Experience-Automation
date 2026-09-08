-- =====================================================================================
-- ZERO-AMOUNT MANAGER NOTES — investigation. Design: ZERO-AMOUNT-INVESTIGATION.md
-- Opened 2026-09-08. Every query returns COUNTS AND SUMS ONLY. NOTE_REASON is free text
-- about a named person: the AI Agent reads it, the audit never republishes it. Where a
-- query tests whether text CONTAINS a number, that is an INDICATOR, not a value — digits
-- in prose can be dates, contract numbers or MOHRE references.
-- Each block is self-contained.
-- =====================================================================================

-- Z1. Census. Which payment types carry zeros, at what rate, over how many distinct days,
--     in what window, and how many of those zeros carry a number in their free text.
--     A high rate on few days is a spike; a moderate rate on many days is a process.
SELECT COALESCE(REASON, '(none)')                                        AS payment_type,
       COUNT(*)                                                          AS notes,
       COUNT_IF(AMOUNT = 0)                                              AS zero_notes,
       ROUND(100.0 * COUNT_IF(AMOUNT = 0) / COUNT(*), 1)                 AS pct_zero,
       COUNT(DISTINCT IFF(AMOUNT = 0, NOTE_DATE::DATE, NULL))            AS distinct_zero_days,
       MIN(IFF(AMOUNT = 0, NOTE_DATE::DATE, NULL))                       AS first_zero,
       MAX(IFF(AMOUNT = 0, NOTE_DATE::DATE, NULL))                       AS last_zero,
       COUNT_IF(AMOUNT = 0 AND REGEXP_LIKE(NOTE_REASON, '.*[0-9]{2,}.*')) AS zero_with_number_in_text,
       COUNT_IF(AMOUNT = 0 AND NULLIF(TRIM(NOTE_REASON), '') IS NULL)    AS zero_with_no_text
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION'
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
HAVING COUNT_IF(AMOUNT = 0) > 0
ORDER BY zero_notes DESC;

-- Z2. Time shape. One bad month across many types is an incident; a steady band is a process.
SELECT DATE_TRUNC('month', NOTE_DATE)::DATE                    AS mth,
       COUNT(*)                                                AS notes,
       COUNT_IF(AMOUNT = 0)                                    AS zeros,
       ROUND(100.0 * COUNT_IF(AMOUNT = 0) / COUNT(*), 1)       AS pct_zero,
       COUNT(DISTINCT IFF(AMOUNT = 0, REASON, NULL))           AS types_with_zeros,
       COUNT(DISTINCT IFF(AMOUNT = 0, NOTE_DATE::DATE, NULL))  AS days_with_zeros
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION'
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
ORDER BY 1;

-- Z3. Companion notes. A zero sitting beside a non-zero note for the same maid on the same
--     day is an annotation, not a lost payment — hypothesis 2. Counts only.
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT, REASON
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), day_shape AS (
    SELECT HOUSEMAID_ID, note_day,
           COUNT_IF(AMOUNT = 0)                                  AS zeros,
           COUNT_IF(AMOUNT > 0)                                  AS non_zeros,
           SUM(IFF(AMOUNT > 0, AMOUNT, 0))                       AS non_zero_aed,
           COUNT(DISTINCT IFF(AMOUNT = 0, REASON, NULL))         AS zero_types,
           COUNT(DISTINCT IFF(AMOUNT > 0, REASON, NULL))         AS non_zero_types
    FROM n GROUP BY 1, 2
)
SELECT CASE
         WHEN zeros = 0                        THEN 'no zero that day'
         WHEN non_zeros = 0                    THEN 'zero(s) ALONE - nothing else paid that day'
         WHEN zero_types = non_zero_types      THEN 'zero beside a paid note of the SAME type'
         ELSE                                       'zero beside a paid note of a DIFFERENT type'
       END                          AS shape,
       COUNT(*)                     AS maid_days,
       SUM(zeros)                   AS zero_notes,
       ROUND(SUM(non_zero_aed))     AS aed_paid_those_days
FROM day_shape
GROUP BY 1
ORDER BY zero_notes DESC;

-- Z1-Z3 RESULTS 2026-09-08 — 510 zero notes / 15 payment types (supersedes 500 / 14).
--   Z3: 474 of 510 (93%) stand ALONE - no payment to that maid that day. The "zero is an
--       annotation beside a real payment" hypothesis is dead for the bulk.
--   Z1: 508 of 510 carry free text (2 blank). 319 (62.5%) carry a NUMBER in that text.
--       Forgive Deduction 32/32, Abu Dhabi 18/18, Maids.at other expenses 65/69.
--   🔴 Abu Dhabi Incentive: 18 of 18 notes, 100% zero, ONE day (2026-08-31), all with a
--       number in the text. An entire payment type worth nothing, from a single run.
--   🟢 MOHRE requirement additions: 43.9% zero, but the window CLOSED 2026-01-10. The rate
--       this report led with is a closed incident. (Trap 23: a rate without its window.)
--   Z2: a persistent 0.8-3.5% floor every month, spiking to 13.3% in Aug 2026 (120 notes,
--       8 types, 23 days) - 96 of those are airfare (78) + Abu Dhabi (18).

-- Z4. What do the 474 standalone zeros SAY? Keyword classes, counts only — no text is
--     returned. Separates money-moved-elsewhere from cancelled from never-filled.
--     ⚠️ Keyword classes are an INDICATOR. A note matching 'manual' is a candidate for
--     off-payroll payment, not proof of one.
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT, REASON,
           LOWER(COALESCE(NOTE_REASON, '')) AS txt
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), day_shape AS (
    SELECT HOUSEMAID_ID, note_day, COUNT_IF(AMOUNT > 0) AS non_zeros
    FROM n GROUP BY 1, 2
), standalone AS (
    SELECT n.* FROM n
    JOIN day_shape d ON d.HOUSEMAID_ID = n.HOUSEMAID_ID AND d.note_day = n.note_day
    WHERE n.AMOUNT = 0 AND d.non_zeros = 0
)
SELECT CASE
         WHEN txt RLIKE '.*(manual|cash|already paid|paid by|paid outside|hand).*'
                                                        THEN '1 money moved elsewhere'
         WHEN txt RLIKE '.*(cancel|void|mistake|wrong|error|duplicate|ignore|not valid).*'
                                                        THEN '2 cancelled or superseded'
         WHEN txt RLIKE '.*(pending|to be|tbd|awaiting|will be|follow up|confirm).*'
                                                        THEN '3 raised, never filled'
         WHEN txt RLIKE '.*(deduct|adjust|correct|reverse|settle).*'
                                                        THEN '4 an adjustment'
         WHEN NULLIF(TRIM(txt), '') IS NULL             THEN '5 no text at all'
         ELSE                                                '6 none of the above'
       END                                              AS class,
       COUNT(*)                                         AS zero_notes,
       COUNT(DISTINCT REASON)                           AS payment_types,
       COUNT(DISTINCT HOUSEMAID_ID)                     AS maids,
       COUNT_IF(txt RLIKE '.*[0-9]{2,}.*')              AS carry_a_number,
       MIN(note_day)                                    AS first_seen,
       MAX(note_day)                                    AS last_seen
FROM standalone
GROUP BY 1
ORDER BY zero_notes DESC;

-- Z5. Abu Dhabi Incentive, the one broken run. Did those 18 maids get paid anything else
--     around 2026-08-31 — i.e. did the money land under another reason, or not at all?
--     Counts only.
WITH ad AS (
    SELECT DISTINCT HOUSEMAID_ID
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Abu Dhabi Incentive'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), other AS (
    SELECT n.HOUSEMAID_ID, n.REASON, n.AMOUNT, n.NOTE_DATE::DATE AS note_day
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    JOIN ad ON ad.HOUSEMAID_ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION'
      AND n.NOTE_DATE::DATE BETWEEN '2026-08-01' AND '2026-09-30'
      AND n.REASON <> 'Abu Dhabi Incentive'
)
SELECT COALESCE(REASON, '(none)')      AS other_payment_type,
       COUNT(*)                        AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)    AS maids_of_the_18,
       ROUND(SUM(AMOUNT))              AS aed,
       COUNT_IF(AMOUNT = 0)            AS also_zero
FROM other
GROUP BY 1
ORDER BY notes DESC;

-- Z4/Z5 RESULTS 2026-09-08:
--   Z4 (474 standalone zeros): 289 unclassified · 90 "money moved elsewhere" (84 with a
--      figure, 11 types, 79 maids, running 2025-09-08 -> 2026-09-04) · 43 cancelled ·
--      28 adjustment · 22 never-filled · 2 no text. The classifier explains 39%.
--   Z5: across Aug-Sep the 18 Abu Dhabi maids carry 5 other notes between them (4 anti-
--      attrition AED 794 / 2 maids; 1 accommodation relocation AED 800 / 1 maid). At least
--      15 of 18 received NOTHING. The money did not move elsewhere - it did not move.

-- Z6. 🔴 THE AI AGENT'S READ. Free text is about named people: the Agent reads it, the audit
--     never republishes it. So do not export rows — export SHAPES. Digits become '#' and
--     whitespace collapses, so templated notes collapse to one line each. This both reduces
--     474 notes to a readable set of phrasings AND strips the figures out of the export.
--     Returns the shape, how many notes carry it, how many payment types and maids, and the
--     window. Shapes seen once are bucketed as '(a one-off phrasing)' rather than printed.
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT, REASON,
           TRIM(REGEXP_REPLACE(
             REGEXP_REPLACE(LOWER(COALESCE(NOTE_REASON, '')), '[0-9]+', '#'),
             '\\s+', ' ')) AS shape
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), day_shape AS (
    SELECT HOUSEMAID_ID, note_day, COUNT_IF(AMOUNT > 0) AS non_zeros
    FROM n GROUP BY 1, 2
), standalone AS (
    SELECT n.* FROM n
    JOIN day_shape d ON d.HOUSEMAID_ID = n.HOUSEMAID_ID AND d.note_day = n.note_day
    WHERE n.AMOUNT = 0 AND d.non_zeros = 0
), counted AS (
    SELECT shape, COUNT(*) AS notes, COUNT(DISTINCT REASON) AS types,
           COUNT(DISTINCT HOUSEMAID_ID) AS maids,
           MIN(note_day) AS first_seen, MAX(note_day) AS last_seen
    FROM standalone GROUP BY shape
)
SELECT IFF(notes > 1, shape, '(a one-off phrasing)') AS text_shape,
       SUM(notes)                                    AS notes,
       MAX(types)                                    AS payment_types,
       SUM(maids)                                    AS maids,
       MIN(first_seen)                               AS first_seen,
       MAX(last_seen)                                AS last_seen
FROM counted
GROUP BY 1
ORDER BY notes DESC;
