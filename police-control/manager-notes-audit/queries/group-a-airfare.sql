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
