-- =====================================================================================
-- MAIDS.AT OTHER EXPENSES — a stratified sample for reading.
--
-- PURPOSE: answer K1, the largest single unknown in the audit — **what is this payment
-- actually for?** AED 51,260 across 273 notes is clean on authorisation and completely
-- untested on entitlement, because no rule exists to test against. The narrative on the
-- note and the description on the expense request are the only evidence of intent.
--
-- ⚠️ WHY STRATIFIED, NOT RANDOM. A random 20 rows from this population would be almost
--    entirely modal cases and would teach you the average, which is already known (AED 188).
--    What is NOT known is the RANGE — what the biggest ones are for, what the smallest ones
--    are for, and whether the notes clustered just under the AED 200 approval gate look
--    different in kind from the ones just above it. The strata below are chosen so each row
--    earns its place; ~5 per band, ~25 rows, enough to read in one sitting.
--
-- ⚠️ Contains names and free text. Keep the output in the warehouse or a file — same handling
--    as the retraction cases. The narrative is the evidence for intent, so it has to be read;
--    it does not have to be forwarded.
-- =====================================================================================

WITH mx AS (
    SELECT n.ID AS note_id, n.HOUSEMAID_ID, n.NOTE_DATE::DATE AS note_day, n.AMOUNT,
           n.NOTE_REASON, n.REQUESTED_BY AS note_requested_by, n.APPROVED_BY AS note_approved_by,
           x.EXPENSE_TYPE, x.REQUEST_STATUS, x.DESCRIPTION AS request_description,
           x.AMOUNT AS request_aed, x.LOAN_AMOUNT, x.INVOICE_UPLOAD_DATE,
           x.REQUESTED_BY AS req_raised_by, x.APPROVED_BY AS req_approved_by,
           COALESCE(x.BENEFICIARY_NAME, h.NAME)            AS maid_name,
           h.START_DATE::DATE                              AS start_date,
           DATEDIFF('day', h.START_DATE::DATE, n.NOTE_DATE::DATE) AS days_into_service
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x   ON x.ID = n.EXPENSE_ID
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Maids.at other expenses' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
), banded AS (
    SELECT m.*,
           -- one band per note, priority order: extremes first, then the gate, then the bulk
           CASE WHEN AMOUNT >= 500                  THEN 'a. 500+          the large ones'
                WHEN AMOUNT >= 200                  THEN 'b. 200-499       above the approval gate'
                WHEN AMOUNT >= 180                  THEN 'c. 180-199       JUST under the gate'
                WHEN AMOUNT >= 100                  THEN 'd. 100-179       the bulk'
                WHEN AMOUNT >= 25                   THEN 'e. 25-99         small'
                ELSE                                     'f. under 25      very small'
           END AS band
    FROM mx m
), ctx AS (
    SELECT b.*,
           COALESCE(l.TO_STATUS, '(none)') AS status_when_paid,
           COALESCE(t.TO_TYPE,   '(none)') AS type_when_paid
    FROM banded b
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS l
           ON l.HOUSEMAID_ID = b.HOUSEMAID_ID
          AND b.note_day >= l.CHANGE_DATE::DATE
          AND (l.NEXT_CHANGE_DATE IS NULL OR b.note_day < l.NEXT_CHANGE_DATE::DATE)
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS t
           ON t.HOUSEMAID_ID = b.HOUSEMAID_ID
          AND b.note_day >= t.CHANGE_DATE::DATE
          AND (t.NEXT_CHANGE_DATE IS NULL OR b.note_day < t.NEXT_CHANGE_DATE::DATE)
    QUALIFY ROW_NUMBER() OVER (
              PARTITION BY b.note_id ORDER BY l.CHANGE_DATE DESC, t.CHANGE_DATE DESC) = 1
)
SELECT band,
       note_day, maid_name, HOUSEMAID_ID, AMOUNT,
       NOTE_REASON               AS narrative,           -- the evidence for intent
       request_description,                              -- the other half of it
       EXPENSE_TYPE              AS expense_head,
       REQUEST_STATUS,
       request_aed, LOAN_AMOUNT,
       IFF(INVOICE_UPLOAD_DATE IS NULL, 'no invoice', 'invoice uploaded') AS invoice,
       IFF(req_approved_by IS NULL, 'NOT approved', 'approved')           AS approval,
       status_when_paid, type_when_paid,
       days_into_service
FROM ctx
QUALIFY ROW_NUMBER() OVER (PARTITION BY band ORDER BY AMOUNT DESC, note_day DESC) <= 5
ORDER BY band, AMOUNT DESC;
