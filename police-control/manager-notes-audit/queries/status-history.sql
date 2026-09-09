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
