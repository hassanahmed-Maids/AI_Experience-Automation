-- =====================================================================================
-- GROUP A — AIRFARE TICKET. AED 2,735,500 over 12 months, the largest payment type.
-- 95% of it is payroll-internal (no expense request), so T4 never applied to it: M3d.
--
-- Code-verified rules (evidence-deepdive-airfare.md):
--   Creator  AddScheduledAnnualVacationService (visa-processing), fired at the "Upload the
--            e-Residency" step -> HousemaidAirFareTicketBusinessRule -> payroll note.
--            Migration twin: MigrationController.housemaidScheduledAnnualVacations().
--   Amount   Nationality tag `ScheduledAnnualVacationAmount`, else the visa-processing
--            parameter `default_ticket_allowance_amount`. A FLAT PER-NATIONALITY CONSTANT —
--            not salary, not tenure. That is why only ~7 distinct values exist.
--   Cadence  First renewal: labour-card expiry within `param_airfare_ticket_after_expiry_
--            date_months` (default 6). Later renewals: last airfare >= `param_airfare_
--            ticket_last_ticket_months_ago` (default 16) months old.
--   Guard    isThereMultipleAirFareTickets() blocks a second airfare within 5 MONTHS.
--   Dates    noteDate = ScheduledAnnualVacation.payrollDueDate, which is why notes run to
--            2028. Future dating is BY DESIGN, not a defect (retracted criterion 19).
--   🔴 A5   The cash path NEVER checks whether the company already bought a ticket.
--            TicketMatchingLibrary is post-hoc card reconciliation with no link back to the
--            note. So a maid can draw the cash allowance and fly on a company ticket.
-- =====================================================================================

-- A0. Discovery. Three things the tests below need, none of which may be assumed:
--     the nationality column (A1), the ticket tables (A5), the parameter store (caps).
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE (TABLE_NAME = 'HOUSEMAIDS_INFO' AND COLUMN_NAME ILIKE ANY ('%NATION%','%LABOR%','%LABOUR%','%EXPIRY%','ID'))
   OR TABLE_NAME ILIKE ANY ('%TICKET%','%VACATION%','%PARAMETER%')
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;

-- A3. 🔴 THE CADENCE RULE — runnable now, no discovery needed.
--     Two hard thresholds from the code: a second airfare within 5 months is blocked
--     outright by isThereMultipleAirFareTickets(); within 16 months fails the
--     last-ticket-months-ago gate for any maid past her first renewal.
--     ⚠️ CAVEAT, stated up front: the code evaluates these on the note's CREATION date.
--     The warehouse exposes NOTE_DATE, which is payrollDueDate — equal to creation date for
--     the ~94% stamped at midnight by the automatic path, but NOT for future-scheduled ones.
--     Future-dated pairs are therefore reported separately and NOT called violations.
WITH air AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Airfare Ticket'
      AND NOTE_DATE >= DATEADD('month', -24, CURRENT_DATE())
), seq AS (
    SELECT a.*,
           LAG(note_day) OVER (PARTITION BY HOUSEMAID_ID ORDER BY note_day, note_id) AS prev_day,
           DATEDIFF('month',
                    LAG(note_day) OVER (PARTITION BY HOUSEMAID_ID ORDER BY note_day, note_id),
                    note_day) AS months_since_prev
    FROM air a
)
SELECT CASE
         WHEN prev_day IS NULL                     THEN 'first airfare on file'
         WHEN note_day > CURRENT_DATE()
           OR prev_day > CURRENT_DATE()            THEN 'BLOCKED - future-dated, noteDate is payrollDueDate'
         WHEN months_since_prev < 5                THEN 'RED - second airfare within 5 months (duplicate guard)'
         WHEN months_since_prev < 16               THEN 'RED - under the 16-month last-ticket gate'
         WHEN months_since_prev < 22               THEN 'AMBER - early against the ~24-month cycle'
         ELSE                                           'GREEN - normal cadence'
       END                            AS verdict,
       COUNT(*)                       AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)   AS maids,
       ROUND(SUM(AMOUNT))             AS aed,
       MIN(months_since_prev)         AS min_months,
       MAX(months_since_prev)         AS max_months
FROM seq
GROUP BY 1
ORDER BY notes DESC;

-- A3b. The row list for whatever A3 turns red. Capped, no free text.
WITH air AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Airfare Ticket'
      AND NOTE_DATE >= DATEADD('month', -24, CURRENT_DATE())
), seq AS (
    SELECT a.*,
           LAG(note_day) OVER (PARTITION BY HOUSEMAID_ID ORDER BY note_day, note_id) AS prev_day,
           LAG(AMOUNT)   OVER (PARTITION BY HOUSEMAID_ID ORDER BY note_day, note_id) AS prev_amount,
           DATEDIFF('month',
                    LAG(note_day) OVER (PARTITION BY HOUSEMAID_ID ORDER BY note_day, note_id),
                    note_day) AS months_since_prev
    FROM air a
)
SELECT HOUSEMAID_ID AS maid_id, prev_day, note_day, months_since_prev,
       ROUND(prev_amount) AS prev_aed, ROUND(AMOUNT) AS aed
FROM seq
WHERE months_since_prev IS NOT NULL AND months_since_prev < 16
  AND note_day <= CURRENT_DATE() AND prev_day <= CURRENT_DATE()
ORDER BY months_since_prev, aed DESC
LIMIT 200;

-- A7. The August 2026 airfare zeros, in context. P1 already flagged four runs where 100% of
--     that day's airfare notes were zero (17, 19, 23, 24 August — 41 notes). This shows the
--     whole month against the year, so the reader can see it is a window and not a rate.
SELECT NOTE_DATE::DATE                                    AS note_day,
       COUNT(*)                                           AS notes,
       COUNT_IF(AMOUNT = 0)                               AS zeros,
       ROUND(100.0 * COUNT_IF(AMOUNT = 0) / COUNT(*), 0)  AS pct_zero,
       ROUND(SUM(AMOUNT))                                 AS aed
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Airfare Ticket'
  AND NOTE_DATE >= '2026-08-01' AND NOTE_DATE < '2026-09-09'
GROUP BY 1
HAVING COUNT(*) >= 3
ORDER BY 1;

-- A3/A7 RESULTS 2026-09-08:
--   A3 (24-month window, 2,657 airfare notes):
--     first airfare on file .................. 2,589 notes · 2,589 maids · AED 4,323,500
--     🔴 RED second airfare within 5 months ..    38 notes ·    35 maids · AED    51,000
--                                                 min 0 months, max 3
--     BLOCKED future-dated ...................    15 notes · AED 20,000
--     GREEN normal cadence (22-24 months) ....    12 notes · AED 17,500
--     AMBER early (21 months) ................     3 notes · AED  2,000
--   🔴 Only 68 airfare notes in two years are repeats, and 38 of them - 56% - breach the
--   explicit 5-month duplicate guard. When a maid gets a second airfare it is MORE LIKELY
--   THAN NOT to be inside the window the code blocks.
--   A7: the airfare zeros are a BOUNDED INCIDENT, 17-24 August 2026 - 6/6, 11/12, 11/11,
--   3/4, 20/21, 6/6, 18/18 = 75 zero notes in eight days. Before 14 Aug and after 27 Aug the
--   month is zero-free. "Airfare is 7.8% zero" was a rate over an incident.
--   A0: HOUSEMAIDS_INFO carries NATIONALITY / NATIONALITY_CATEGORY (A1 runnable), and
--   HOUSEMAIDS_TICKETS carries HOUSEMAID_ID, PURCHASE_DATE, DEPARTURE_DATE, TICKET_TYPE,
--   ORIGINAL_FARE, BUYER, IS_DELETED, IS_LATEST_HM_TICKET (🔴 A5 runnable).
--   🔴 No ERP PARAMETERS table is in the warehouse — the airfare caps and the 5/16-month
--   parameter values are still unreadable, so the code defaults are assumed, not verified.

-- A3c. 🔴 Did the guard FAIL, or was it BYPASSED? The two producers are distinguishable by
--   the time component. The automatic path sets noteDate = payrollDueDate = currentDate
--   NORMALISED TO MIDNIGHT. The human expense path sets noteDate = new Date() — a real
--   timestamp — and does not run isThereMultipleAirFareTickets() at all.
--   Both notes at midnight  => the automatic guard let a duplicate through.
--   One not at midnight     => a manual airfare stacked on an automatic one, unguarded.
WITH air AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE, NOTE_DATE::DATE AS note_day, AMOUNT,
           IFF(NOTE_DATE = NOTE_DATE::DATE, 'automatic (midnight)', 'manual (timestamped)') AS producer
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Airfare Ticket'
      AND NOTE_DATE >= DATEADD('month', -24, CURRENT_DATE())
), seq AS (
    SELECT a.*,
           LAG(note_day)  OVER (PARTITION BY HOUSEMAID_ID ORDER BY NOTE_DATE) AS prev_day,
           LAG(producer)  OVER (PARTITION BY HOUSEMAID_ID ORDER BY NOTE_DATE) AS prev_producer,
           LAG(AMOUNT)    OVER (PARTITION BY HOUSEMAID_ID ORDER BY NOTE_DATE) AS prev_amount,
           DATEDIFF('month', LAG(note_day) OVER (PARTITION BY HOUSEMAID_ID ORDER BY NOTE_DATE),
                    note_day) AS months_since_prev
    FROM air a
)
SELECT prev_producer || '  ->  ' || producer      AS producer_pair,
       COUNT(*)                                   AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)               AS maids,
       ROUND(SUM(AMOUNT))                         AS aed,
       MIN(months_since_prev)                     AS min_months,
       MAX(months_since_prev)                     AS max_months
FROM seq
WHERE months_since_prev IS NOT NULL AND months_since_prev < 5
  AND note_day <= CURRENT_DATE() AND prev_day <= CURRENT_DATE()
GROUP BY 1
ORDER BY notes DESC;

-- A5. 🔴 THE CONTROL THAT DOES NOT EXIST. Code-verified: the cash airfare path never checks
--   whether the company already bought a ticket, and TicketMatchingLibrary (accounting) has
--   no link back to the note. HOUSEMAIDS_TICKETS is in the warehouse, so the audit can
--   measure what no control covers: a cash allowance AND a company ticket in the same window.
--   Grouped by TICKET_TYPE so the vocabulary and the answer arrive together.
--   Excludes deleted tickets ('01' — TEXT flag, not boolean; `= TRUE` matches nothing).
WITH air AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Airfare Ticket'
      AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
), tick AS (
    SELECT HOUSEMAID_ID, COALESCE(TICKET_TYPE, '(none)') AS ticket_type,
           COALESCE(PURCHASE_DATE, DEPARTURE_DATE::DATE) AS ticket_day,
           COALESCE(FARE_IN_REF_CURRENCY, ORIGINAL_FARE) AS fare
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS
    WHERE COALESCE(IS_DELETED, '00') <> '01'
)
SELECT t.ticket_type,
       COUNT(DISTINCT a.note_id)                       AS cash_notes_with_a_ticket,
       COUNT(DISTINCT a.HOUSEMAID_ID)                  AS maids,
       ROUND(SUM(DISTINCT a.AMOUNT))                   AS cash_aed,
       ROUND(AVG(t.fare))                              AS avg_company_fare,
       MIN(DATEDIFF('day', a.note_day, t.ticket_day))  AS min_days_apart,
       MAX(DATEDIFF('day', a.note_day, t.ticket_day))  AS max_days_apart
FROM air a
JOIN tick t ON t.HOUSEMAID_ID = a.HOUSEMAID_ID
           AND ABS(DATEDIFF('day', a.note_day, t.ticket_day)) <= 90
GROUP BY 1
ORDER BY cash_notes_with_a_ticket DESC;

-- A1. The amount rule: a flat constant per nationality. Recovers the tier table from the data
--   and flags any maid paid off her nationality's modal amount. The parameter store is not in
--   the warehouse, so the tiers CANNOT be read from config — only inferred, and a whole
--   nationality paid the wrong flat rate would look correct here. Stated, not hidden.
WITH air AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.AMOUNT,
           COALESCE(h.NATIONALITY, '(unknown)') AS nationality
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Airfare Ticket' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), tier AS (
    SELECT nationality, MODE(AMOUNT) AS modal_amount, COUNT(*) AS notes
    FROM air GROUP BY 1
)
SELECT t.nationality, t.modal_amount AS nationality_tier, t.notes,
       COUNT_IF(a.AMOUNT <> t.modal_amount)                       AS off_tier_notes,
       ROUND(SUM(IFF(a.AMOUNT <> t.modal_amount, a.AMOUNT, 0)))   AS off_tier_aed,
       COUNT(DISTINCT a.AMOUNT)                                   AS distinct_amounts,
       MIN(a.AMOUNT)                                              AS min_amount,
       MAX(a.AMOUNT)                                              AS max_amount
FROM air a JOIN tier t ON t.nationality = a.nationality
GROUP BY 1, 2, 3
ORDER BY off_tier_notes DESC, t.notes DESC;

-- A3c RESULT 2026-09-08 — the 38 are mostly a BYPASS, not a failure:
--   automatic -> manual ....  29 notes · 29 maids · AED 49,500  (97% of the money)
--   automatic -> automatic ..  7 notes ·  4 maids · AED  3,000
--   manual    -> automatic ..  2 notes ·  2 maids · AED      0
--   🔴 The dominant shape is a MANUAL airfare stacked on an automatic one inside five months.
--   The manual expense path (processExpenseRequestTodo) never calls
--   isThereMultipleAirFareTickets() — so the duplicate guard is not failing, it is ABSENT on
--   that route. Same shape as the amount guard: written on one branch, missing on the other.
--   The 7 automatic->automatic notes are a genuine guard failure, AED 3,000.

-- A5 RESULT 2026-09-08: ZERO ROWS. ⚠️ NOT YET A CLEARANCE. Spec trap H4: zero rows reads
--   exactly like "no findings". Before this is reported as "no maid drew cash and flew on a
--   company ticket", the join has to be shown capable of returning something. A5a and A5b do
--   that, and if they show the table is populated and the ids overlap, then and only then is
--   the empty result a real GREEN.

-- A5a. Is HOUSEMAIDS_TICKETS populated, dated, and joinable at all?
SELECT COUNT(*)                                          AS ticket_rows,
       COUNT(DISTINCT HOUSEMAID_ID)                      AS distinct_maids,
       COUNT_IF(HOUSEMAID_ID IS NULL)                    AS null_maid_id,
       COUNT_IF(PURCHASE_DATE IS NOT NULL)               AS with_purchase_date,
       COUNT_IF(DEPARTURE_DATE IS NOT NULL)              AS with_departure_date,
       MIN(COALESCE(PURCHASE_DATE, DEPARTURE_DATE::DATE)) AS earliest,
       MAX(COALESCE(PURCHASE_DATE, DEPARTURE_DATE::DATE)) AS latest,
       COUNT_IF(COALESCE(IS_DELETED,'00') = '01')        AS deleted_rows,
       COUNT(DISTINCT TICKET_TYPE)                       AS ticket_types
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS;

-- A5b. Do the two populations overlap AT ALL, at any distance? Unbounded window, so a real
--   absence and a broken join become distinguishable. Also returns the ticket-type vocabulary.
WITH air AS (
    SELECT DISTINCT HOUSEMAID_ID, NOTE_DATE::DATE AS note_day
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Airfare Ticket' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), tick AS (
    SELECT HOUSEMAID_ID, COALESCE(TICKET_TYPE,'(none)') AS ticket_type,
           COALESCE(PURCHASE_DATE, DEPARTURE_DATE::DATE) AS ticket_day
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS
    WHERE COALESCE(IS_DELETED,'00') <> '01'
)
SELECT t.ticket_type,
       COUNT(*)                                              AS pairs,
       COUNT(DISTINCT a.HOUSEMAID_ID)                        AS maids_with_both,
       MIN(ABS(DATEDIFF('day', a.note_day, t.ticket_day)))   AS closest_days,
       MEDIAN(ABS(DATEDIFF('day', a.note_day, t.ticket_day))) AS median_days,
       COUNT_IF(ABS(DATEDIFF('day', a.note_day, t.ticket_day)) <= 180) AS within_180_days
FROM air a
JOIN tick t ON t.HOUSEMAID_ID = a.HOUSEMAID_ID
GROUP BY 1
ORDER BY pairs DESC;

-- A5a/A5b RESULTS 2026-09-08 — 🟢 A REAL CLEARANCE, not an empty-result one.
--   A5a: HOUSEMAIDS_TICKETS holds 13,818 rows over 10,270 maids, 2016-09-13 to 2026-09-08,
--        8 ticket types, 1 deleted row. Populated, dated, joinable.
--   A5b: the populations DO overlap — 361 maids hold both a cash airfare note and a company
--        ticket — but every overlap is TO_DUBAI (the arrival ticket), median 764 days apart,
--        closest 262 days. ZERO within 180 days. Plus 2 TO_EXIT and 1 TO_MANILA, all 8+ years
--        apart. No vacation ticket appears against any cash allowance.
--   🟢 So: the code has no control preventing cash-plus-ticket, and in twelve months nothing
--   exploited it. Same shape as V9 — a missing guard with no instances. The clearance is
--   trustworthy precisely BECAUSE the join returned 364 irrelevant pairs rather than nothing.

-- A7b. 🔴 WHAT BROKE ON 17-24 AUGUST? The airfare amount is a flat per-nationality constant
--   (tag `ScheduledAnnualVacationAmount`, else parameter `default_ticket_allowance_amount`).
--   A zero therefore means the tag or the parameter resolved to nothing. The nationality mix
--   of the 75 zero notes separates the two: ONE nationality => its tag broke; MANY => the
--   global default broke. The parameter store is not in the warehouse, so this is the only
--   way to tell from data.
SELECT COALESCE(h.NATIONALITY, '(unknown)')                      AS nationality,
       COUNT(*)                                                  AS notes_in_window,
       COUNT_IF(n.AMOUNT = 0)                                    AS zeros,
       COUNT_IF(n.AMOUNT > 0)                                    AS non_zeros,
       ROUND(AVG(IFF(n.AMOUNT > 0, n.AMOUNT, NULL)))             AS avg_when_paid,
       (SELECT MODE(n2.AMOUNT)
          FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n2
          LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h2 ON h2.ID = n2.HOUSEMAID_ID
         WHERE n2.NOTE_TYPE = 'ADDITION' AND n2.REASON = 'Airfare Ticket' AND n2.AMOUNT > 0
           AND h2.NATIONALITY IS NOT DISTINCT FROM h.NATIONALITY
           AND n2.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())) AS this_nationalitys_tier
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Airfare Ticket'
  AND n.NOTE_DATE >= '2026-08-15' AND n.NOTE_DATE < '2026-08-27'
GROUP BY 1
ORDER BY zeros DESC;

-- A7c. 🔴 WAS ANYONE PAID AFTERWARDS? 75 maids were entitled to an airfare and received AED 0.
--   At the modal 2,000 that is roughly AED 150,000 of unpaid entitlement. This asks whether a
--   correcting note followed — the remediation question, which no other query has asked.
WITH zeroed AS (
    SELECT DISTINCT HOUSEMAID_ID, NOTE_DATE::DATE AS zero_day
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Airfare Ticket' AND AMOUNT = 0
      AND NOTE_DATE >= '2026-08-15' AND NOTE_DATE < '2026-08-27'
), later AS (
    SELECT z.HOUSEMAID_ID, z.zero_day,
           MAX(n.AMOUNT)                                  AS later_amount,
           MIN(n.NOTE_DATE::DATE)                         AS later_day
    FROM zeroed z
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
           ON n.HOUSEMAID_ID = z.HOUSEMAID_ID
          AND n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Airfare Ticket'
          AND n.AMOUNT > 0
          AND n.NOTE_DATE::DATE > z.zero_day
    GROUP BY 1, 2
)
SELECT CASE WHEN later_amount IS NULL THEN '🔴 never paid an airfare since'
            ELSE '🟢 a later airfare exists' END          AS outcome,
       COUNT(*)                                           AS maids,
       ROUND(SUM(COALESCE(later_amount, 0)))              AS aed_paid_later,
       MIN(later_day)                                     AS earliest_correction,
       MAX(later_day)                                     AS latest_correction
FROM later
GROUP BY 1
ORDER BY maids DESC;
