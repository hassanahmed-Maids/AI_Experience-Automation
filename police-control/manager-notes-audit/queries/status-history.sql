-- =====================================================================================
-- MAID STATUS HISTORY — the as-of source the audit has been missing.
-- Pointed out by Hassan 2026-09-09. **It was already in `docs/snowflake.md` line 44** and
-- the audit never used it: every as-of join so far was built on HOUSEMAIDS_INFO_REVISION,
-- an Envers audit table, when a purpose-built status log existed the whole time.
--
-- WHAT IT UNLOCKS — four things, and the second is the largest blocked item in the audit:
--
--  1. 🔴 A CROSS-CUTTING TEST THAT HAS NEVER EXISTED: **was she still employed when we paid
--     her?** Applies to EVERY payment type. The audit has an archetype for "not deserved"
--     and no general test for the plainest case of it. The only place it was ever asked was
--     one bespoke raffle query.
--
--  2. 🔴 N17 — THE CONTRACT-TYPE TIMELINE, which has blocked GROUP A (airfare, AED 2.3m)
--     since the spec was written. `HOUSEMAIDS_INFO_REVISION` carries OLD_HOUSEMAID_TYPE,
--     HOUSEMAID_TYPE and SWITCH_HOUSEMAID_TYPE_DATE and **all three are empty**; the DEV
--     spec names `BI_HOUSEMAID_STATUS_LOGS.to_type` as one of two working routes. If that
--     column is real, airfare's CC-tenure rule becomes testable.
--
--  3. Re-resolve the raffle terminated-winners finding (AED 3,000, 15 wins, median 558 days
--     after leaving) against real status-at-draw rather than current status.
--
--  4. B3 — anti-attrition "status not in rejectedStatuses", never tested as-of.
--
--  5. 🔴🔴 WITH A CLIENT, OR NOT — and this is the sharpest of the five. Employment is a
--     weak test; DEPLOYMENT is the one several rules actually turn on:
--       * Live-out Transportation Assistance, AED 71,850 / 320 notes. I cleared this on
--         LIVE_OUT as-of, which is the flag THE RULE NAMES — but live-out is a contract MODE
--         and a maid not placed with a client is not commuting to one. **The clear may be
--         partial.** Stated as a candidate, not a retraction, until measured.
--       * Taxi reimbursement generally — a reimbursed commute implies somewhere to commute to.
--       * Anti-attrition, AED 1.83m — a retention incentive to a maid sitting in accommodation
--         rather than placed is a different proposition from one to a maid on a job.
--       * Accommodation Relocation — a relocation between placements vs. one that never happened.
--       * The raffle itself: `ONE_MONTH_WITH_SAME_CLIENT` MINTS TICKET POINTS, so with-client
--         history is upstream of the entrant pool and the point weighting both.
--
-- ⚠️ P1 FIRST. S1 establishes the shape before anything joins to it. This audit has already
-- paid for skipping that twice in one battery (a workflow state read as a category, and the
-- routing test that then matched nothing and read as clean).
-- =====================================================================================


-- S1. WHAT ARE THESE TABLES? Columns for every status/type-log candidate, silver and gold,
--     in one small result. Nothing joins until this comes back.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('HOUSEMAID_STATUS_LOGS',
                     'HOUSEMAID_TYPE_LOGS',
                     'BI_HOUSEMAID_STATUS_LOGS',
                     'BI_HISTORICAL_STATUS_LOGS',
                     'FACT_MAID_TERMINATIONS')
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;


-- S1b. THE WITH-CLIENT DIMENSION — where does deployment live, and is it dated?
--      "With a client" may be a VALUE inside the status log, or a separate placement /
--      assignment / contract table with its own start and end dates. Both shapes are swept
--      here so the next round knows which it is rather than assuming.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA IN ('HOUSEMAID_MANAGEMENT_SILVER','CLIENT_MANAGEMENT_SILVER',
                       'HOUSEMAID_MANAGEMENT_GOLD')
  AND (COLUMN_NAME ILIKE '%WITH_CLIENT%'
    OR COLUMN_NAME ILIKE '%PLACEMENT%'
    OR COLUMN_NAME ILIKE '%DEPLOY%'
    OR COLUMN_NAME ILIKE '%ASSIGN%'
    OR (COLUMN_NAME ILIKE '%CLIENT_ID%' AND TABLE_NAME ILIKE '%HOUSEMAID%')
    OR TABLE_NAME ILIKE '%PLACEMENT%'
    OR TABLE_NAME ILIKE '%ASSIGNMENT%')
ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME;


-- S2 (NEXT ROUND, once S1 names the columns) — the test to write:
--   for every ADDITION in the last 12 months, resolve the maid's status AS OF the note date
--   from the status log (latest change on or before the note day, QUALIFY ROW_NUMBER), then
--   group by payment type x status-when-paid.
--   Verdict: paid while in a terminated/inactive status = money to someone who had left.
--   THEN the sharper cut: status-when-paid x WITH-CLIENT-when-paid, per payment type. The
--   first catches money to someone gone; the second catches money for a situation she was
--   not in. Report them separately - they are different findings and adding them
--   double-counts every note that is both.
--   ⚠️ Carry the E10 self-diagnostic: count how many notes resolve to a DIFFERENT status
--   than the maid holds today. If none do, the join is decorative and the answer is a point
--   read wearing a costume.
--   ⚠️ Check the log's date coverage first — H8 records that EXPENSES_REQUESTS.STATUS_CHANGE_DATE
--   only starts 2025-12-16. A status log that starts mid-window silently turns "no change
--   found before the note" into "she was never anything but her current status".


-- =====================================================================================
-- S1/S1b RESULTS 2026-09-09 — two findings, one of them large.
--
-- 🟢 THE LOGS ARE INTERVAL TABLES, NOT EVENT TABLES. All three carry CHANGE_DATE **and
--    NEXT_CHANGE_DATE**. So the as-of read needs no LAG/QUALIFY window at all — it is a
--    plain interval containment:
--        note_day >= CHANGE_DATE AND (NEXT_CHANGE_DATE IS NULL OR note_day < NEXT_CHANGE_DATE)
--    Simpler and exact, where the QUALIFY pattern this audit has been using is an
--    approximation that silently picks the latest row when intervals overlap.
--
-- 🔴 N17 IS RESOLVED, AND IT UNBLOCKS GROUP A. `HOUSEMAID_TYPE_LOGS` is a purpose-built
--    contract-type timeline: HOUSEMAID_ID, FROM_TYPE, TO_TYPE, CHANGE_DATE, PREV_CHANGE_DATE,
--    NEXT_CHANGE_DATE. That is exactly the CC/MV interval history the spec has been asking a
--    person for. **Group A — airfare, AED 2.3m — has been blocked on it since v1.**
--    ⚠️ AND IT MEANS TWO PUBLISHED VERDICTS USED THE WRONG SOURCE. The anti-attrition
--    "paid while MV" finding (AED 2,476) and the relocation CC check (66/66 GREEN) both
--    resolved type from HOUSEMAIDS_INFO_REVISION — an Envers audit table — when a dedicated
--    type log existed. Both must be re-run against HOUSEMAID_TYPE_LOGS before either stands.
--
-- 🟡 WITH-CLIENT DID NOT APPEAR AS A COLUMN. No placement/deployment table surfaced. Two
--    candidate routes instead:
--      (a) it is a VALUE in the status vocabulary (TO_STATUS) — S3 settles this in one query;
--      (b) CLIENT_MANAGEMENT_SILVER.REPLACEMENTS carries HOUSEMAID_ID + CLIENT_ID +
--          TAGGING_DATE + UNTAGGING_DATE, which is a placement interval in all but name;
--          BED_ASSIGNMENTS (HOUSEMAID_ID, ASSIGNMENT_DATE, EXPIRY_DATE) is its complement —
--          a maid in a bed is in accommodation, not with a client.
--    Do NOT build on (b) until S3 rules out (a). A status value is one join; reconstructing
--    placement from tag/untag events is a model, and a model can be wrong.
-- =====================================================================================


-- S3. 🟢 THE STATUS VOCABULARY AND ITS DATE COVERAGE — one small query that decides
--     everything downstream. It answers "is 'with a client' a status?" directly, and it
--     checks the trap H8 already recorded once: EXPENSES_REQUESTS.STATUS_CHANGE_DATE only
--     begins 2025-12-16, and **a log that starts mid-window silently converts "no interval
--     covers this note" into "she was never anything but what she is now."**
SELECT TO_STATUS,
       COUNT(*)                                  AS transitions,
       COUNT(DISTINCT HOUSEMAID_ID)              AS maids,
       MIN(CHANGE_DATE)::DATE                    AS first_seen,
       MAX(CHANGE_DATE)::DATE                    AS last_seen,
       COUNT_IF(NEXT_CHANGE_DATE IS NULL)        AS still_open_intervals
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS
GROUP BY 1
ORDER BY transitions DESC;


-- S4. 🔴 THE CROSS-CUTTING TEST THE AUDIT NEVER HAD: what was her status when we paid her?
--     Applies to every payment type at once. Interval join, not a window function.
--     ⚠️ THE SELF-DIAGNOSTIC IS THE LAST COLUMN AND IT IS NOT OPTIONAL. If every note
--     resolves to the maid's still-open interval, the join is decorative and this is a
--     current-state read wearing a costume — the E10 failure, which on one column flagged
--     5 notes of which 2 were wrong while missing 3 of the 6 real ones.
WITH n AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT,
           COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
), resolved AS (
    SELECT n.note_id, n.HOUSEMAID_ID, n.payment_type, n.AMOUNT,
           l.TO_STATUS      AS status_when_paid,
           l.NEXT_CHANGE_DATE
    FROM n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS l
           ON l.HOUSEMAID_ID = n.HOUSEMAID_ID
          AND n.note_day >= l.CHANGE_DATE::DATE
          AND (l.NEXT_CHANGE_DATE IS NULL OR n.note_day < l.NEXT_CHANGE_DATE::DATE)
    -- intervals can overlap in practice; keep one row per note, the latest that contains it
    QUALIFY ROW_NUMBER() OVER (PARTITION BY n.note_id ORDER BY l.CHANGE_DATE DESC) = 1
)
SELECT payment_type,
       COALESCE(status_when_paid, 'BLOCKED - no interval covers the note') AS status_when_paid,
       COUNT(*)                                        AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                    AS maids,
       ROUND(SUM(AMOUNT))                              AS aed,
       COUNT_IF(NEXT_CHANGE_DATE IS NOT NULL)          AS resolved_to_a_PAST_interval,
       COUNT_IF(NEXT_CHANGE_DATE IS NULL)              AS resolved_to_the_CURRENT_one
FROM resolved
GROUP BY 1, 2
ORDER BY payment_type, aed DESC;


-- S5. 🔴 N17 AT LAST — the contract-type timeline, and the two verdicts that depend on it.
--     Coverage first (does the log actually span the audit window, and for how many maids?),
--     then the type-when-paid read that replaces the HOUSEMAIDS_INFO_REVISION one.
--     Anti-attrition is CC-only by code (N13). Relocation is CC live-out only. Both were
--     resolved from the Envers table; this is the purpose-built source.
WITH n AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT,
           COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND AMOUNT > 0
      AND REASON IN ('Anti-attrition Incentive','Accommodation Relocation','Airfare Ticket')
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
), resolved AS (
    SELECT n.note_id, n.HOUSEMAID_ID, n.payment_type, n.AMOUNT,
           t.TO_TYPE AS type_when_paid, t.NEXT_CHANGE_DATE
    FROM n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
           ON t.HOUSEMAID_ID = n.HOUSEMAID_ID
          AND n.note_day >= t.CHANGE_DATE::DATE
          AND (t.NEXT_CHANGE_DATE IS NULL OR n.note_day < t.NEXT_CHANGE_DATE::DATE)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY n.note_id ORDER BY t.CHANGE_DATE DESC) = 1
)
SELECT payment_type,
       COALESCE(type_when_paid, 'BLOCKED - no type interval covers the note') AS type_when_paid,
       COUNT(*)                                 AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)             AS maids,
       ROUND(SUM(AMOUNT))                       AS aed,
       COUNT_IF(NEXT_CHANGE_DATE IS NOT NULL)   AS resolved_to_a_PAST_interval
FROM resolved
GROUP BY 1, 2
ORDER BY payment_type, aed DESC;
