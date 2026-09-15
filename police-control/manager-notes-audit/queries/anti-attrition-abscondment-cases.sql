-- =====================================================================================
-- ANTI-ATTRITION PAID AFTER SHE ABSCONDED — case file + earned/unearned decomposition.
--
-- PURPOSE: decompose ledger row 1 ("Anti-attrition paid to a maid in a NO-SHOW or
-- terminated state", AED 13,257 / 110 notes, S4) into the part the maid had already
-- EARNED before she left and the part paid for days she was gone. B3b is open with
-- management; reporting the gross would overstate the claim if the ruling is
-- "she keeps what she worked for".
--
-- ⚠️ TIES OUT: Query 2 returned 105 + 5 = 110 notes, 11,857 + 1,400 = 13,257 — the
--    ledger row exactly. Same population, different question.
--
-- ⚠️ enrolment_amount_PROXY IS A PROXY, NOT THE ENROLMENT AMOUNT.
--    INCENTIVE_AMOUNT is not exposed on HOUSEMAID_MANAGERACTIONLOGS (its AMOUNT maps
--    to DEDUCTION_AMOUNT) — ingestion ask N13/A5. F12's basis is used instead: the
--    largest WHOLE-entitlement note (100..500) the maid received across the window.
--    NULL where she was never paid a whole month, so the derived columns go NULL
--    rather than guessing. 42 of 110 notes / AED 2,566 have no proxy at all.
--
-- ⚠️ CONTAINS NAMES AND NARRATIVES. Keep Query 1's output in the warehouse or a file.
-- =====================================================================================

-- =====================================================================================
-- RESULTS AS RUN, 2026-09-15 — and what survived the read
--
-- Query 2 returned:
--   A. went AFTER the previous cycle (select-once flaw)  105 notes  99 maids  11,857
--        no proxy 2,566 | for days after she left 1,647 | she had earned 10,210 | worst 24d
--   B. already gone 36-120 days - selected while absent     5 notes   2 maids   1,400
--        no proxy     0 | for days after she left 1,400 | she had earned      0 | worst 98d
--   C. gone 120+ days                                       no rows
--
-- 🔴 THE 1,647 IN BAND A DOES NOT SURVIVE. Three artefacts account for all but ~213 of it:
--
--   1. THE PAY-PERIOD BUG — AED 1,250.66 of it, 14 notes.
--      `period_start` below is DATE_TRUNC('month', note_day). 96 of the 110 notes fall on
--      the 28th/30th/31st, where that is right. 14 do not (12 on the 1st, one 05, one 07),
--      and for those DATE_TRUNC = note_day, so days_eligible is FORCED to 0 and 100% of the
--      note scores as "after she left". Those notes are arrears for the PRIOR month — one
--      narrative says so outright ("incentive for the maid from 25 september" on a 05-Nov
--      note). Eleven of the fourteen show status_one_cycle_earlier = WITH_CLIENT: she
--      worked the month she was paid for. Query 3 flags and excludes them.
--
--   2. THE PROXY FAILING — AED 280 of it, 1 note (maid 104680).
--      Paid 280 against a 200 proxy = 42 implied days in a 30-day month. Either the proxy
--      is wrong for her or the note is arrears. Not measurable; not averaged away.
--
--   3. LAST-DAY ROUNDING — ~AED 183, 12 notes.
--      She absconded on the last day of the month and was paid the full month: 6-13 AED of
--      "overpayment" each. 65 of the 105 band-A notes have days_gone = 0 and 77 of the 91
--      band-A month-end notes score ZERO exposure — the proration is working.
--
--   WHAT SURVIVES: AED 1,612.90 across THREE maids.
--     maid  73378   600.00   3 notes (Oct/Nov/Dec 2025, full 200 each)
--     maid 110872   851.61   3 notes (Dec 2025 prorated 51.61 + full 400 Jan + full 400 Feb)
--     maid 103699   161.29   1 note  (2026-03-31, full 200, absent since 2026-03-07)
--
-- 🔴 THE STRUCTURAL DEFECT IS WORTH MORE THAN THE MONEY. Both band-B maids were ENROLLED
--    WHILE ALREADY ABSENT OR DAYS BEFORE LEAVING, and then paid a FULL, UNPRORATED month
--    every cycle after:
--      maid  73378 absconded 2025-09-24, ENROLLED 2025-10-07 — thirteen days AFTER.
--      maid 110872 enrolled 2025-12-17, absconded 2025-12-23 — six days later.
--    So there are two distinct holes, not one: no status check AT ENROLMENT, and no
--    re-check BETWEEN CYCLES. The select-once flaw (band A) is the smaller of the two.
--
-- ⚠️ maid 110872's status_today is WITH_CLIENT — she came back. Recovery posture for her
--    is a management call, not an audit call. That leaves 73378 (terminated, AED 600) and
--    103699 (WITH_CLIENT_NOT_PICKED, AED 161) as the clean recovery cases.
-- =====================================================================================


-- =====================================================================================
-- QUERY 1 — the case file, one row per note. Run as-is 2026-09-15.
-- =====================================================================================
WITH aa AS (
    SELECT n.ID              AS note_id,
           n.HOUSEMAID_ID,
           n.NOTE_DATE::DATE AS note_day,
           n.AMOUNT,
           COALESCE(NULLIF(TRIM(n.NOTE_REASON), ''), '(blank)') AS narrative
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.REASON    = 'Anti-attrition Incentive'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), slog AS (
    SELECT HOUSEMAID_ID, TO_STATUS,
           CHANGE_DATE::DATE      AS from_day,
           NEXT_CHANGE_DATE::DATE AS to_day,
           LAG(TO_STATUS) OVER (PARTITION BY HOUSEMAID_ID ORDER BY CHANGE_DATE) AS status_before
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS
), at_payment AS (
    SELECT a.*, s.TO_STATUS AS status_when_paid, s.status_before, s.from_day AS status_began
    FROM aa a
    JOIN slog s ON s.HOUSEMAID_ID = a.HOUSEMAID_ID
               AND a.note_day >= s.from_day
               AND (s.to_day IS NULL OR a.note_day < s.to_day)
    WHERE s.TO_STATUS IN ('NO_SHOW','NO_SHOW_WENT_OUT_DID_NOT_RETURN','NO_SHOW_LEFT_CLIENT_HOME',
                          'NO_SHOW_FOR_TERMINATION','EMPLOYEMENT_TERMINATED')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY a.note_id ORDER BY s.from_day DESC) = 1
), at_prev_cycle AS (
    SELECT p.note_id, s.TO_STATUS AS status_30d_before
    FROM at_payment p
    JOIN slog s ON s.HOUSEMAID_ID = p.HOUSEMAID_ID
               AND DATEADD('day', -30, p.note_day) >= s.from_day
               AND (s.to_day IS NULL OR DATEADD('day', -30, p.note_day) < s.to_day)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY p.note_id ORDER BY s.from_day DESC) = 1
), today_status AS (
    SELECT HOUSEMAID_ID, TO_STATUS AS status_today
    FROM slog WHERE to_day IS NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY HOUSEMAID_ID ORDER BY from_day DESC) = 1
), ty AS (
    SELECT p.note_id, t.TO_TYPE AS type_when_paid
    FROM at_payment p
    JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
           ON t.HOUSEMAID_ID = p.HOUSEMAID_ID
          AND p.note_day >= t.CHANGE_DATE::DATE
          AND (t.NEXT_CHANGE_DATE IS NULL OR p.note_day < t.NEXT_CHANGE_DATE::DATE)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY p.note_id ORDER BY t.CHANGE_DATE DESC) = 1
), enr AS (
    SELECT HOUSEMAID_ID, MIN(CREATION_DATE)::DATE AS enrolled_on
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%' GROUP BY 1
), ent AS (
    -- ⚠️ PROXY. See header. NULL where she was never paid a whole month.
    SELECT HOUSEMAID_ID, MAX(AMOUNT) AS entitlement_proxy
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND AMOUNT IN (100,150,200,250,300,350,400,450,500)
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
    GROUP BY 1
), base AS (
    SELECT p.*,
           e.enrolled_on,
           x.entitlement_proxy,
           DAY(LAST_DAY(p.note_day))                                        AS days_in_month,
           GREATEST(DATE_TRUNC('month', p.note_day)::DATE,
                    COALESCE(e.enrolled_on, DATE_TRUNC('month', p.note_day)::DATE)) AS period_start
    FROM at_payment p
    LEFT JOIN enr e ON e.HOUSEMAID_ID = p.HOUSEMAID_ID
    LEFT JOIN ent x ON x.HOUSEMAID_ID = p.HOUSEMAID_ID
), calc AS (
    SELECT b.*,
           ROUND(b.AMOUNT / NULLIF(b.entitlement_proxy, 0) * b.days_in_month, 1) AS implied_days_paid_for,
           GREATEST(DATEDIFF('day', b.period_start, b.status_began), 0)          AS days_eligible_before_she_left
    FROM base b
)
SELECT CASE
         WHEN DATEDIFF('day', c.status_began, c.note_day) <= 35
              THEN 'A. went AFTER the previous cycle - the select-once flaw'
         WHEN DATEDIFF('day', c.status_began, c.note_day) <= 120
              THEN 'B. already gone 36-120 days - selected while absent'
         ELSE 'C. already gone 120+ days - selected long after she left'
       END                                                   AS verdict,
       DATEDIFF('day', c.status_began, c.note_day)           AS days_gone_when_paid,
       c.note_day,
       h.NAME                                                AS maid_name,
       c.HOUSEMAID_ID, c.note_id,

       -- what she was paid, and what it implies she was paid FOR
       c.AMOUNT                                              AS paid_aed,
       c.entitlement_proxy                                   AS enrolment_amount_PROXY,
       c.days_in_month,
       c.implied_days_paid_for,
       c.days_eligible_before_she_left,
       GREATEST(c.implied_days_paid_for - c.days_eligible_before_she_left, 0)
                                                             AS days_paid_AFTER_she_left,
       ROUND(GREATEST(c.implied_days_paid_for - c.days_eligible_before_she_left, 0)
             * c.entitlement_proxy / c.days_in_month, 2)     AS aed_for_days_after_she_left,

       -- the status story
       c.status_before                                       AS status_she_held_before,
       c.status_when_paid,
       c.status_began                                        AS absence_began,
       pc.status_30d_before                                  AS status_one_cycle_earlier,
       t.status_today,
       ty.type_when_paid,
       c.enrolled_on,
       DATEDIFF('day', c.enrolled_on, c.note_day)            AS days_since_enrolment,
       h.START_DATE::DATE                                    AS start_date,
       h.DATE_OF_TERMINATION::DATE                           AS termination_on_record,
       c.narrative
FROM calc c
LEFT JOIN at_prev_cycle pc ON pc.note_id = c.note_id
LEFT JOIN ty               ON ty.note_id = c.note_id
LEFT JOIN today_status t   ON t.HOUSEMAID_ID = c.HOUSEMAID_ID
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = c.HOUSEMAID_ID
ORDER BY verdict, aed_for_days_after_she_left DESC NULLS LAST, days_gone_when_paid DESC;


-- =====================================================================================
-- QUERY 2 — the summary. Run as-is 2026-09-15. ⚠️ Its 1,647 band-A figure is SUPERSEDED
-- by Query 3: it carries the pay-period bug described in the header.
-- =====================================================================================
WITH aa AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.REASON    = 'Anti-attrition Incentive'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), slog AS (
    SELECT HOUSEMAID_ID, TO_STATUS,
           CHANGE_DATE::DATE AS from_day, NEXT_CHANGE_DATE::DATE AS to_day
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS
), at_payment AS (
    SELECT a.*, s.TO_STATUS AS status_when_paid, s.from_day AS status_began
    FROM aa a
    JOIN slog s ON s.HOUSEMAID_ID = a.HOUSEMAID_ID
               AND a.note_day >= s.from_day
               AND (s.to_day IS NULL OR a.note_day < s.to_day)
    WHERE s.TO_STATUS IN ('NO_SHOW','NO_SHOW_WENT_OUT_DID_NOT_RETURN','NO_SHOW_LEFT_CLIENT_HOME',
                          'NO_SHOW_FOR_TERMINATION','EMPLOYEMENT_TERMINATED')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY a.note_id ORDER BY s.from_day DESC) = 1
), enr AS (
    SELECT HOUSEMAID_ID, MIN(CREATION_DATE)::DATE AS enrolled_on
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%' GROUP BY 1
), ent AS (
    SELECT HOUSEMAID_ID, MAX(AMOUNT) AS entitlement_proxy
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND AMOUNT IN (100,150,200,250,300,350,400,450,500)
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
    GROUP BY 1
), calc AS (
    SELECT p.note_id, p.HOUSEMAID_ID, p.AMOUNT, p.note_day, p.status_began,
           x.entitlement_proxy,
           DAY(LAST_DAY(p.note_day))                                      AS days_in_month,
           ROUND(p.AMOUNT / NULLIF(x.entitlement_proxy, 0)
                 * DAY(LAST_DAY(p.note_day)), 1)                          AS implied_days_paid_for,
           GREATEST(DATEDIFF('day',
                    GREATEST(DATE_TRUNC('month', p.note_day)::DATE,
                             COALESCE(e.enrolled_on, DATE_TRUNC('month', p.note_day)::DATE)),
                    p.status_began), 0)                                   AS days_eligible
    FROM at_payment p
    LEFT JOIN enr e ON e.HOUSEMAID_ID = p.HOUSEMAID_ID
    LEFT JOIN ent x ON x.HOUSEMAID_ID = p.HOUSEMAID_ID
)
SELECT CASE
         WHEN DATEDIFF('day', status_began, note_day) <= 35
              THEN 'A. went AFTER the previous cycle - the select-once flaw'
         WHEN DATEDIFF('day', status_began, note_day) <= 120
              THEN 'B. already gone 36-120 days - selected while absent'
         ELSE 'C. already gone 120+ days - selected long after she left'
       END                                                   AS verdict,
       COUNT(*)                                              AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                          AS maids,
       ROUND(SUM(AMOUNT))                                    AS total_paid_aed,
       ROUND(SUM(IFF(entitlement_proxy IS NULL, AMOUNT, 0))) AS aed_NOT_ESTIMABLE_no_proxy,
       ROUND(SUM(GREATEST(implied_days_paid_for - days_eligible, 0)
                 * entitlement_proxy / days_in_month))       AS aed_for_days_AFTER_she_left,
       ROUND(SUM(AMOUNT)
             - SUM(GREATEST(implied_days_paid_for - days_eligible, 0)
                   * entitlement_proxy / days_in_month))     AS aed_she_had_earned,
       MAX(DATEDIFF('day', status_began, note_day))          AS worst_days_gone
FROM calc
GROUP BY verdict
ORDER BY verdict;


-- =====================================================================================
-- QUERY 3 — TRIAGED. Supersedes Query 2's band-A figure.
--
-- Fixes what Query 2 got wrong and refuses to estimate what cannot be estimated:
--   • pay_period_certain — only notes in the last 3 days of the month have a period the
--     DATE_TRUNC assumption gets right. Everything else is arrears for an unknown prior
--     period and is EXCLUDED from the recoverable figure rather than scored at 100%.
--   • proxy_sane — implied_days must not exceed the days in the month. One note fails.
--   • materiality — an abscondment on the last day or two of the month produces a
--     6-13 AED artefact, not a finding. Only days_gone >= 5 is carried.
-- Every exclusion is REPORTED as its own row, so nothing is silently dropped.
-- =====================================================================================
WITH aa AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.REASON    = 'Anti-attrition Incentive'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), slog AS (
    SELECT HOUSEMAID_ID, TO_STATUS,
           CHANGE_DATE::DATE AS from_day, NEXT_CHANGE_DATE::DATE AS to_day
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS
), at_payment AS (
    SELECT a.*, s.TO_STATUS AS status_when_paid, s.from_day AS status_began
    FROM aa a
    JOIN slog s ON s.HOUSEMAID_ID = a.HOUSEMAID_ID
               AND a.note_day >= s.from_day
               AND (s.to_day IS NULL OR a.note_day < s.to_day)
    WHERE s.TO_STATUS IN ('NO_SHOW','NO_SHOW_WENT_OUT_DID_NOT_RETURN','NO_SHOW_LEFT_CLIENT_HOME',
                          'NO_SHOW_FOR_TERMINATION','EMPLOYEMENT_TERMINATED')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY a.note_id ORDER BY s.from_day DESC) = 1
), enr AS (
    SELECT HOUSEMAID_ID, MIN(CREATION_DATE)::DATE AS enrolled_on
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%' GROUP BY 1
), ent AS (
    SELECT HOUSEMAID_ID, MAX(AMOUNT) AS entitlement_proxy
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND AMOUNT IN (100,150,200,250,300,350,400,450,500)
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
    GROUP BY 1
), calc AS (
    SELECT p.note_id, p.HOUSEMAID_ID, p.AMOUNT, p.note_day, p.status_began,
           e.enrolled_on,
           x.entitlement_proxy,
           DAY(LAST_DAY(p.note_day))                                     AS days_in_month,
           DATEDIFF('day', p.status_began, p.note_day)                   AS days_gone,
           DAY(LAST_DAY(p.note_day)) - DAY(p.note_day)                   AS days_before_month_end,
           ROUND(p.AMOUNT / NULLIF(x.entitlement_proxy, 0)
                 * DAY(LAST_DAY(p.note_day)), 1)                         AS implied_days_paid_for,
           GREATEST(DATEDIFF('day',
                    GREATEST(DATE_TRUNC('month', p.note_day)::DATE,
                             COALESCE(e.enrolled_on, DATE_TRUNC('month', p.note_day)::DATE)),
                    p.status_began), 0)                                  AS days_eligible
    FROM at_payment p
    LEFT JOIN enr e ON e.HOUSEMAID_ID = p.HOUSEMAID_ID
    LEFT JOIN ent x ON x.HOUSEMAID_ID = p.HOUSEMAID_ID
), triaged AS (
    SELECT c.*,
           ROUND(GREATEST(c.implied_days_paid_for - c.days_eligible, 0)
                 * c.entitlement_proxy / c.days_in_month, 2)             AS raw_after_aed,
           CASE
             WHEN c.entitlement_proxy IS NULL
                  THEN '4. NOT ESTIMABLE - no whole-month note, entitlement unknowable'
             WHEN c.implied_days_paid_for > c.days_in_month
                  THEN '3. PROXY FAILS - implied days exceed the month'
             WHEN c.days_before_month_end > 2
                  THEN '2. PAY PERIOD UNCERTAIN - arrears for an unknown prior period'
             WHEN c.days_gone < 5
                  THEN '1. IMMATERIAL - left on/near the last day, proration edge only'
             ELSE '0. RECOVERABLE - gone >= 5 days, paid for days after she left'
           END                                                           AS triage
    FROM calc c
)
SELECT triage,
       COUNT(*)                                              AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                          AS maids,
       ROUND(SUM(AMOUNT), 2)                                 AS total_paid_aed,
       ROUND(SUM(IFF(triage LIKE '0.%', raw_after_aed, 0)), 2)
                                                             AS aed_CARRIED_as_recoverable,
       ROUND(SUM(IFF(triage LIKE '0.%', 0, COALESCE(raw_after_aed, AMOUNT))), 2)
                                                             AS aed_set_aside_not_claimed,
       MAX(days_gone)                                        AS worst_days_gone,
       -- the structural signal: was she enrolled AFTER she was already gone?
       COUNT_IF(enrolled_on > status_began)                  AS notes_enrolled_while_absent
FROM triaged
GROUP BY triage
ORDER BY triage;
