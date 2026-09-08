-- =====================================================================================
-- THE OVERPAYMENT BATTERY — the audit's actual purpose.
-- Every test here asks: DID MONEY LEAVE THAT SHOULD NOT HAVE?
-- Four archetypes, per the audit's own framing:
--   O-A  not deserved       — no entitlement record behind the payment
--   O-B  not corroborated   — nothing (complaint / request / event) explains it
--   O-C  paid twice         — one entitlement, two payments
--   O-D  off-rule           — the amount or recipient does not match the note's own logic
-- Underpayment findings are byproducts and belong in a remediation list, never the headline.
-- =====================================================================================

-- O1. 🔴 O-D — THE SINGLE BIGGEST UNRUN TEST. 11,819 notes carry an exact FK to their expense
--   request, and processExpenseRequestTodo copies getAmount() verbatim with no guard. So any
--   disagreement between the note and the request it came from is money that moved without
--   matching what was approved. Never run. One query.
--   7 currencies exist — non-AED is BLOCKED, never an approximate match.
SELECT COALESCE(n.REASON, '(none)')                                          AS payment_type,
       COUNT(*)                                                              AS linked_notes,
       COUNT_IF(x.CURRENCY_NAME <> 'AED')                                    AS non_aed_blocked,
       COUNT_IF(x.CURRENCY_NAME = 'AED' AND n.AMOUNT > x.AMOUNT + 0.01)      AS note_EXCEEDS_request,
       ROUND(SUM(IFF(x.CURRENCY_NAME = 'AED' AND n.AMOUNT > x.AMOUNT + 0.01,
                     n.AMOUNT - x.AMOUNT, 0)))                               AS aed_OVERPAID,
       COUNT_IF(x.CURRENCY_NAME = 'AED' AND n.AMOUNT < x.AMOUNT - 0.01)      AS note_under_request,
       ROUND(MAX(IFF(x.CURRENCY_NAME = 'AED', n.AMOUNT - x.AMOUNT, 0)))      AS largest_overpayment
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
WHERE n.NOTE_TYPE = 'ADDITION'
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY 1
ORDER BY aed_OVERPAID DESC;

-- O2. 🔴 O-C — PAID TWICE, ACROSS ALL 25 PAYMENT TYPES, not just the two examined so far.
--   Self-calibrating: each type's own median gap between repeat payments to the same maid
--   defines its normal cadence, and anything under a quarter of that is a duplicate candidate.
--   Same-day repeats are called out separately — they cannot be a cycle.
WITH n AS (
    SELECT ID AS note_id, HOUSEMAID_ID, COALESCE(REASON,'(none)') AS payment_type,
           NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
), gapped AS (
    SELECT n.*,
           DATEDIFF('day',
             LAG(note_day) OVER (PARTITION BY payment_type, HOUSEMAID_ID ORDER BY note_day, note_id),
             note_day) AS days_since_prev,
           LAG(AMOUNT) OVER (PARTITION BY payment_type, HOUSEMAID_ID ORDER BY note_day, note_id) AS prev_amount
    FROM n
), cadence AS (
    SELECT payment_type, MEDIAN(days_since_prev) AS normal_gap, COUNT(*) AS repeat_notes
    FROM gapped WHERE days_since_prev IS NOT NULL GROUP BY 1
)
SELECT g.payment_type,
       ROUND(c.normal_gap)                                                AS normal_gap_days,
       c.repeat_notes,
       COUNT_IF(g.days_since_prev = 0)                                    AS same_day_repeats,
       ROUND(SUM(IFF(g.days_since_prev = 0, g.AMOUNT, 0)))                AS aed_same_day,
       COUNT_IF(g.days_since_prev > 0 AND g.days_since_prev < c.normal_gap/4) AS well_inside_cadence,
       ROUND(SUM(IFF(g.days_since_prev > 0 AND g.days_since_prev < c.normal_gap/4,
                     g.AMOUNT, 0)))                                       AS aed_inside_cadence,
       COUNT_IF(g.days_since_prev <= 31 AND g.AMOUNT = g.prev_amount)     AS same_amount_within_31d,
       ROUND(SUM(IFF(g.days_since_prev <= 31 AND g.AMOUNT = g.prev_amount,
                     g.AMOUNT, 0)))                                       AS aed_same_amount
FROM gapped g JOIN cadence c ON c.payment_type = g.payment_type
WHERE g.days_since_prev IS NOT NULL
GROUP BY 1, 2, 3
HAVING same_day_repeats > 0 OR well_inside_cadence > 0 OR same_amount_within_31d > 0
ORDER BY aed_same_day + aed_inside_cadence DESC;

-- O3. 🔴 O-A — REFERRAL BONUS WITH NO REFERRAL. AED 852,316 of bonus over 12 months and the
--   referral half is now testable: HOUSEMAID_REFERRALS / MAIDS_REFERRALS_JOINERS_INFO carry
--   the referrer link and REFERRAL_BONUS_COST (N20/N11, resolved by block D).
--   A referral bonus paid to a maid who referred nobody is money with no entitlement behind it.
WITH bonus AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Bonus' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), refs AS (
    SELECT REFERRING_MAID_ID AS maid_id, COUNT(*) AS referrals_ever,
           MIN(REFERRED_MAID_JOINING_DATE::DATE) AS first_joiner,
           MAX(REFERRED_MAID_JOINING_DATE::DATE) AS last_joiner
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_JOINERS_INFO
    WHERE REFERRING_MAID_ID IS NOT NULL
    GROUP BY 1
)
SELECT CASE
         WHEN r.maid_id IS NULL                              THEN 'no referral on record at all'
         WHEN b.note_day < r.first_joiner                    THEN 'paid BEFORE any referred maid joined'
         ELSE                                                     'a referral exists before the bonus'
       END                              AS reading,
       COUNT(*)                         AS bonus_notes,
       COUNT(DISTINCT b.HOUSEMAID_ID)   AS maids,
       ROUND(SUM(b.AMOUNT))             AS aed
FROM bonus b LEFT JOIN refs r ON r.maid_id = b.HOUSEMAID_ID
GROUP BY 1
ORDER BY aed DESC;

-- O4. 🔴 O-B — SALARY DISPUTE WITH NOTHING BEHIND IT. AED 385,984, 1,084 notes, 99% linked to
--   an expense request — but an expense request is a payment instrument, not a justification.
--   A salary correction should have a complaint or a dispute behind it.
--   COMPLAINTS lives at BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS (used by the
--   corroboration work). ⚠️ Taxonomy and dates only — complaint free text is never exported.
--   Reports the CHANCE RATE beside the observed rate: a wide window corroborates by geometry
--   alone, and this project has already published one test that scored exactly chance.
WITH disp AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Salary Dispute' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), c AS (
    SELECT HOUSEMAID_ID, CREATION_DATE::DATE AS complaint_day
    FROM BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS
    WHERE HOUSEMAID_ID IS NOT NULL
)
SELECT COUNT(*)                                                        AS dispute_notes,
       ROUND(SUM(d.AMOUNT))                                            AS aed,
       COUNT_IF(EXISTS (SELECT 1 FROM c
                         WHERE c.HOUSEMAID_ID = d.HOUSEMAID_ID
                           AND c.complaint_day BETWEEN DATEADD('day',-30,d.note_day)
                                                   AND DATEADD('day', 7,d.note_day)))
                                                                       AS with_complaint_30d_before,
       ROUND(SUM(IFF(NOT EXISTS (SELECT 1 FROM c
                         WHERE c.HOUSEMAID_ID = d.HOUSEMAID_ID
                           AND c.complaint_day BETWEEN DATEADD('day',-30,d.note_day)
                                                   AND DATEADD('day', 7,d.note_day)),
                     d.AMOUNT, 0)))                                    AS aed_with_NO_complaint,
       COUNT_IF(EXISTS (SELECT 1 FROM c WHERE c.HOUSEMAID_ID = d.HOUSEMAID_ID))
                                                                       AS maid_has_any_complaint_ever
FROM disp d;

-- O1 RESULT 2026-09-08 — 🟢 ESSENTIALLY CLEAN. Across 11,819 linked notes:
--   Salary Dispute ........... 3 notes exceed their request · AED 1,213 · largest 1,000
--   Maids.at other expenses .. 1 note                       · AED    91
--   every other payment type . 0
--   Total overpayment on the note-vs-request test: AED 1,304. The verbatim copy is faithful.
--   🔴 STRATEGIC CONSEQUENCE: the overpayment risk is NOT in the expense-backed population.
--   It is in the 60.6% with no expense request at all (M3d) — raffle, prorated, forgive
--   deduction, 95% of airfare, 71% of bonus. No request means no approval and no amount to
--   check against. That is where the rest of this battery belongs.
--   (341 notes are UNDER their request. That is underpayment or a part-paid request — a
--    byproduct, not an overpayment finding, except for Abu Dhabi below.)

-- O5. 🔴 ABU DHABI, REPRICED. O1 shows all 18 notes sit BELOW their request, by up to 200.
--   So the requests carried real amounts and the notes came out zero: the money was lost
--   BETWEEN accounting approval and the payroll note, not before it. That contradicts
--   "the job refuses to post a zero" as the explanation for the 18, and it prices the
--   entitlement exactly instead of by estimate.
SELECT COUNT(*)                          AS notes,
       COUNT(DISTINCT n.HOUSEMAID_ID)    AS maids,
       ROUND(SUM(n.AMOUNT))              AS aed_paid,
       ROUND(SUM(x.AMOUNT))              AS aed_APPROVED,
       ROUND(SUM(x.AMOUNT - n.AMOUNT))   AS aed_LOST_BETWEEN_APPROVAL_AND_NOTE,
       MIN(x.AMOUNT)                     AS smallest_approved,
       MAX(x.AMOUNT)                     AS largest_approved,
       MIN(x.REQUEST_STATUS)             AS status_min,
       MAX(x.REQUEST_STATUS)             AS status_max
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Abu Dhabi Incentive'
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE());

-- O3a. Columns of the three referral tables. O3's first version used REFERRING_MAID_ID on
--   MAIDS_REFERRALS_JOINERS_INFO, which does not have it — that table carries
--   REFERRING_MAID_TYPE. The referrer id lives on HOUSEMAID_REFERRALS_ENRICHED.
--   Fifth guessed column of the day; check before writing, not after.
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'HOUSEMAID_MANAGEMENT_SILVER'
  AND TABLE_NAME IN ('HOUSEMAID_REFERRALS','HOUSEMAID_REFERRALS_ENRICHED',
                     'MAIDS_REFERRALS_JOINERS_INFO','MAIDS_REFERRALS_BONUSES')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- O3b. 🔴 O-A — REFERRAL BONUS WITH NO REFERRAL, rewritten against the right table.
--   HOUSEMAID_REFERRALS_ENRICHED carries REFERRING_MAID_ID -> REFERRED_MAID_ID; the joining
--   date comes from MAIDS_REFERRALS_JOINERS_INFO on REFERRED_MAID_ID.
--   ⚠️ `Bonus` covers BOTH referral and signing bonuses and only PURPOSE_ID separates them
--   (D4/N5), which the warehouse does not expose. So a bonus with no referral is a CANDIDATE,
--   not a finding: it may be a legitimate signing bonus. Reported as such.
WITH bonus AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Bonus' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), refs AS (
    SELECT e.REFERRING_MAID_ID           AS maid_id,
           COUNT(*)                      AS referrals,
           MIN(j.REFERRED_MAID_JOINING_DATE::DATE) AS first_joiner,
           MAX(j.REFERRED_MAID_JOINING_DATE::DATE) AS last_joiner
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_REFERRALS_ENRICHED e
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_JOINERS_INFO j
           ON j.REFERRED_MAID_ID = e.REFERRED_MAID_ID
    WHERE e.REFERRING_MAID_ID IS NOT NULL
    GROUP BY 1
)
SELECT CASE
         WHEN r.maid_id IS NULL                       THEN 'no referral on record — signing bonus or unjustified'
         WHEN r.first_joiner IS NULL                  THEN 'referral exists, no joining date'
         WHEN b.note_day < r.first_joiner             THEN '🔴 paid BEFORE any referred maid joined'
         ELSE                                              'a referral joined before the bonus'
       END                              AS reading,
       COUNT(*)                         AS bonus_notes,
       COUNT(DISTINCT b.HOUSEMAID_ID)   AS maids,
       ROUND(SUM(b.AMOUNT))             AS aed,
       ROUND(AVG(b.AMOUNT))             AS avg_bonus
FROM bonus b LEFT JOIN refs r ON r.maid_id = b.HOUSEMAID_ID
GROUP BY 1
ORDER BY aed DESC;
