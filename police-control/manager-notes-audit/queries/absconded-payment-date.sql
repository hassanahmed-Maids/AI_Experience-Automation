-- =====================================================================================
-- ANTI-ATTRITION "PAID WHILE ABSCONDED" — re-measured on the PAYMENT date.
--
-- WHY THIS EXISTS: every earlier cut of this finding resolved status AS OF THE NOTE DATE.
-- The note is written at month-end; payroll pays 1-3 days later. Those are different days,
-- and the column I had been calling `status_when_paid` was really `status_when_the_note
-- was_written`. This query resolves BOTH, and the gap between them is the whole finding.
--
-- ⚠️ PAYMENT DATE IS DERIVED, NOT READ. `anti_attrition_incentive` IS one of the
--    must-be-paid reasons, so the ERP writes PAID_ON_PAYROLL_MONTH - but that column is
--    not in the warehouse (HOUSEMAID_MANAGER_NOTES is ten columns), and the documented
--    fallback needs the payroll lock window, whose column LAST_PAYROLL_LOCK_DATE has no
--    non-null values. So the payslip is found by month and BOTH candidates are surfaced.
--    Route 1 and its three branches: jira/DNA_ATTACHMENT_source_tables.md §5.
--
-- ⚠️ Contains names. Keep the output in the warehouse or a file.
-- =====================================================================================

-- =====================================================================================
-- RESULTS AS RUN, 2026-09-15 — 110 notes, AED 13,257. Ties out to ledger row 1 exactly.
--
-- 🔴 THE FINDING WAS MEASURED ON THE WRONG DAY. 84 of 110 notes CHANGED status between
--    the note and the payment, and almost all of them changed in the direction of RECOVERY:
--    NO_SHOW_* -> WITH_CLIENT / AVAILABLE / ON_VACATION / SICK_WITHOUT_CLIENT / SURPLUS.
--
--    | bucket                                            | notes |       AED |
--    |---------------------------------------------------|------:|----------:|
--    | A. BACK / ACTIVE by the day the money moved        |    63 |  7,843.97 |
--    | B. still absent at payment                         |    22 |  3,386.27 |
--    | C. fallback invalid (payslip predates the note)    |     5 |     77.94 |
--    | D. payslip NEVER TRANSFERRED - no money moved      |    13 |  1,097.21 |
--    | E. payment date not establishable                  |     7 |    851.61 |
--
--    A 63-note majority went to maids who were back at work when payroll ran. A NO_SHOW
--    flag on the 31st that resolves to WITH_CLIENT by the 3rd is a TRANSIENT MONTH-END
--    OPERATIONAL STATE, not abscondment. Those are not a finding in any form.
--    Bucket D is money that never left the company at all - IS_TRANSFERRED = 'NO'.
--
-- ✅ THE HARD CORE, durably absent AND the payslip actually transferred (>= 10 days gone
--    at payment): 8 notes, 5 maids, AED 1,970.96 gross.
--      maid  73378  600.00  (101, 71, 40 days gone at payment)
--      maid 110872  941.93  (70, 42, 11, 11)
--      maid 103699  200.00  (27)
--      maid  83131  129.03  (11)
--      maid 105728  100.00  (10, EMPLOYEMENT_TERMINATED at payment)
--
-- ✅ NET OF WHAT SHE HAD EARNED (B3b limb (i): the ERP's proration is correct) this comes
--    to **AED 1,612.90** - which is the ledger row to the dirham, derived a SECOND time by
--    a completely independent method: payment date + transfer confirmation, no entitlement
--    proxy anywhere. Two methods, same number. The row does not move; its BASIS is now
--    much stronger, and 63 notes are positively CLEARED rather than merely netted off.
--
-- ⚠️ DEFECT IN QUERY 1 BELOW, kept as run for reproducibility and fixed in Query 2:
--    the prior-month fallback fires whenever the note-month payslip has no paid-on date,
--    including when that prior payslip PREDATES the note - 5 rows came back with negative
--    days_note_to_payment. A payslip cannot pay a note that did not yet exist.
--
-- ⚠️ HYGIENE: HOUSEMAID_PAYROLL_HISTORY.STATUS disagrees with the status log on many rows
--    (payslip says WITH_CLIENT where the log says NO_SHOW_LEFT_CLIENT_HOME). Treat the
--    payslip's own STATUS as a snapshot of unknown timing; do not test against it.
-- =====================================================================================

-- =====================================================================================
-- QUERY 2 — CORRECTED. The fallback may only point FORWARD from the note.
-- =====================================================================================
WITH aa AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.REASON    = 'Anti-attrition Incentive'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
    QUALIFY ROW_NUMBER() OVER (PARTITION BY n.ID ORDER BY n.NOTE_DATE) = 1
), slog AS (
    SELECT HOUSEMAID_ID, TO_STATUS,
           CHANGE_DATE::DATE AS from_day, NEXT_CHANGE_DATE::DATE AS to_day
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS
), at_note AS (
    SELECT a.*, s.TO_STATUS AS status_at_note_date, s.from_day AS absence_began
    FROM aa a
    JOIN slog s ON s.HOUSEMAID_ID = a.HOUSEMAID_ID
               AND a.note_day >= s.from_day
               AND (s.to_day IS NULL OR a.note_day < s.to_day)
    WHERE s.TO_STATUS IN ('NO_SHOW','NO_SHOW_WENT_OUT_DID_NOT_RETURN','NO_SHOW_LEFT_CLIENT_HOME',
                          'NO_SHOW_FOR_TERMINATION','EMPLOYEMENT_TERMINATED')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY a.note_id ORDER BY s.from_day DESC) = 1
), pay AS (
    SELECT HOUSEMAID_ID, PAYROLL_MONTH, PAID_ON_DATE_FORMATTED, ADDITIONS, IS_TRANSFERRED
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY
    QUALIFY ROW_NUMBER() OVER (PARTITION BY HOUSEMAID_ID, PAYROLL_MONTH
                               ORDER BY PAID_ON_DATE_FORMATTED DESC NULLS LAST) = 1
), cand AS (
    SELECT n.*,
           pm.PAID_ON_DATE_FORMATTED AS paid_on_note_month,
           pm.IS_TRANSFERRED         AS transferred_note_month,
           pm.ADDITIONS              AS additions_note_month,
           -- ⚠️ THE FIX: a payslip that paid BEFORE the note cannot have paid that note.
           IFF(pp.PAID_ON_DATE_FORMATTED >= n.note_day, pp.PAID_ON_DATE_FORMATTED, NULL)
                                     AS paid_on_prior_month_FORWARD_ONLY,
           pp.IS_TRANSFERRED         AS transferred_prior_month
    FROM at_note n
    LEFT JOIN pay pm ON pm.HOUSEMAID_ID = n.HOUSEMAID_ID
                    AND pm.PAYROLL_MONTH = DATE_TRUNC('month', n.note_day)::DATE
    LEFT JOIN pay pp ON pp.HOUSEMAID_ID = n.HOUSEMAID_ID
                    AND pp.PAYROLL_MONTH = DATEADD('month', -1, DATE_TRUNC('month', n.note_day))::DATE
), resolved AS (
    SELECT c.*,
           COALESCE(c.paid_on_note_month, c.paid_on_prior_month_FORWARD_ONLY) AS payment_date,
           COALESCE(c.transferred_note_month, c.transferred_prior_month)      AS money_transferred
    FROM cand c
), verdict AS (
    SELECT r.*, sp.TO_STATUS AS status_at_payment_date
    FROM resolved r
    LEFT JOIN slog sp ON sp.HOUSEMAID_ID = r.HOUSEMAID_ID
                     AND r.payment_date >= sp.from_day
                     AND (sp.to_day IS NULL OR r.payment_date < sp.to_day)
    QUALIFY ROW_NUMBER() OVER (PARTITION BY r.note_id ORDER BY sp.from_day DESC) = 1
)
SELECT CASE
         WHEN money_transferred = 'NO'
              THEN 'D. payslip NEVER transferred - no money moved'
         WHEN payment_date IS NULL
              THEN 'E. payment date not establishable'
         WHEN status_at_payment_date NOT IN ('NO_SHOW','NO_SHOW_WENT_OUT_DID_NOT_RETURN',
                'NO_SHOW_LEFT_CLIENT_HOME','NO_SHOW_FOR_TERMINATION','EMPLOYEMENT_TERMINATED')
              THEN 'A. BACK / ACTIVE by the day the money moved - NOT a finding'
         WHEN DATEDIFF('day', absence_began, payment_date) < 10
              THEN 'B1. absent at payment but < 10 days - month-end transient'
         ELSE 'B2. DURABLY absent when the money moved - the finding'
       END                                                  AS verdict,
       COUNT(*)                                             AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                         AS maids,
       ROUND(SUM(AMOUNT), 2)                                AS aed,
       MIN(DATEDIFF('day', note_day, payment_date))         AS min_days_note_to_payment,
       MAX(DATEDIFF('day', note_day, payment_date))         AS max_days_note_to_payment,
       MAX(DATEDIFF('day', absence_began, payment_date))    AS worst_days_gone_at_payment,
       LISTAGG(DISTINCT HOUSEMAID_ID::STRING, ', ')
         WITHIN GROUP (ORDER BY HOUSEMAID_ID::STRING)       AS maid_ids
FROM verdict
GROUP BY verdict
ORDER BY verdict;
