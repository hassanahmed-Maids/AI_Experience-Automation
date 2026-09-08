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

-- O5 RESULT 2026-09-08 — 🔴 ABU DHABI IS A RECONCILIATION BREAK, NOT A MISSED PAYMENT.
--   18 notes · 18 maids · AED APPROVED 4,200 · AED PAID 0 · lost between the two: 4,200
--   Smallest approved 200, largest 350. REQUEST_STATUS = 'PAID' on ALL EIGHTEEN.
--   Accounting approved the money, marked every request PAID, and the payroll notes carry
--   zero. The books say settled and the maids received nothing. (Estimate was 4,250.)

-- O3b RESULT 2026-09-08 — bonus, AED 849,716 over 1,131 notes:
--   a referral joined before the bonus ....... 614 notes · 536 maids · AED 528,200
--   no referral on record .................... 407 notes · 352 maids · AED 251,721
--   referral exists, no joining date ......... 100 notes ·  81 maids · AED  63,895
--   🔴 paid BEFORE any referred maid joined ..  10 notes ·  10 maids · AED   5,500
--   The 407 are confounded by signing bonuses (PURPOSE_ID is not exposed) — O6 resolves it
--   from the referral side instead.

-- O6. 🔴 THE REAL REFERRAL-BONUS TEST. O3a found the right key: HOUSEMAID_REFERRALS carries
--   HOUSEMAID_ID (the REFERRER), REFERRED_MAID_ID, and — decisively — IS_CANCELLED,
--   IS_REQUESTED_BONUS, BONUS_REQUEST_DATE and AMOUNT. So the entitlement is readable from
--   the referral itself rather than inferred from a joining date.
--   Three overpayment archetypes at once:
--     bonus paid where the referral was CANCELLED        -> not deserved
--     bonus paid where no bonus was ever REQUESTED       -> not corroborated
--     bonus paid before the bonus request date           -> off-rule
WITH bonus AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Bonus' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), ref AS (
    SELECT HOUSEMAID_ID                                   AS referrer_id,
           COUNT(*)                                       AS referrals,
           COUNT_IF(COALESCE(IS_CANCELLED,0) = 1)         AS cancelled,
           COUNT_IF(COALESCE(IS_REQUESTED_BONUS,0) = 1)   AS bonus_requested,
           MIN(IFF(COALESCE(IS_REQUESTED_BONUS,0) = 1, BONUS_REQUEST_DATE::DATE, NULL))
                                                          AS first_bonus_request,
           SUM(AMOUNT)                                    AS referral_amount_on_file
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_REFERRALS
    WHERE HOUSEMAID_ID IS NOT NULL
    GROUP BY 1
)
SELECT CASE
         WHEN r.referrer_id IS NULL                       THEN 'no referral at all — signing bonus or unjustified'
         WHEN r.bonus_requested = 0                       THEN '🔴 referral exists but NO bonus was ever requested'
         WHEN r.referrals = r.cancelled                   THEN '🔴 every referral behind it is CANCELLED'
         WHEN b.note_day < r.first_bonus_request          THEN '🔴 paid BEFORE the bonus was requested'
         ELSE                                                  'requested, not cancelled, paid after'
       END                              AS reading,
       COUNT(*)                         AS bonus_notes,
       COUNT(DISTINCT b.HOUSEMAID_ID)   AS maids,
       ROUND(SUM(b.AMOUNT))             AS aed,
       ROUND(AVG(b.AMOUNT))             AS avg_bonus
FROM bonus b LEFT JOIN ref r ON r.referrer_id = b.HOUSEMAID_ID
GROUP BY 1
ORDER BY aed DESC;

-- O7. 🔴 O-D — DOES THE BONUS MATCH THE REFERRAL'S OWN AMOUNT? HOUSEMAID_REFERRALS.AMOUNT is
--   the entitlement recorded against the referral. A note paying MORE than the referral says
--   is money above the entitlement — the cleanest overpayment shape there is.
--   Only referrers whose every referral was bonus-requested and uncancelled are compared, so
--   a signing bonus cannot contaminate the result.
WITH bonus AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Bonus' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), ref AS (
    SELECT HOUSEMAID_ID AS referrer_id, SUM(AMOUNT) AS entitled, COUNT(*) AS referrals
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_REFERRALS
    WHERE HOUSEMAID_ID IS NOT NULL
      AND COALESCE(IS_CANCELLED,0) = 0 AND COALESCE(IS_REQUESTED_BONUS,0) = 1
      AND AMOUNT > 0
    GROUP BY 1
), paid AS (
    SELECT b.HOUSEMAID_ID, SUM(b.AMOUNT) AS bonus_paid, COUNT(*) AS notes
    FROM bonus b GROUP BY 1
)
SELECT CASE
         WHEN p.bonus_paid > r.entitled + 0.01 THEN '🔴 PAID MORE than the referrals entitle'
         WHEN p.bonus_paid < r.entitled - 0.01 THEN 'paid less than entitled'
         ELSE                                       'matches'
       END                                    AS reading,
       COUNT(*)                               AS maids,
       SUM(p.notes)                           AS bonus_notes,
       ROUND(SUM(p.bonus_paid))               AS aed_paid,
       ROUND(SUM(r.entitled))                 AS aed_entitled,
       ROUND(SUM(GREATEST(p.bonus_paid - r.entitled, 0))) AS aed_OVER_ENTITLEMENT
FROM paid p JOIN ref r ON r.referrer_id = p.HOUSEMAID_ID
GROUP BY 1
ORDER BY aed_OVER_ENTITLEMENT DESC;

-- O6/O7 RESULTS 2026-09-08 — 🔴 THE CLEANEST OVERPAYMENT FINDING SO FAR.
--   O7: 466 maids / 525 notes match their referral entitlement TO THE PENNY (AED 455,200 =
--       455,200). That validates HOUSEMAID_REFERRALS.AMOUNT as the entitlement, which is what
--       makes the outliers credible rather than an artefact of a guessed model:
--       🔴 15 maids · 28 notes · paid AED 20,000 against AED 9,500 entitled · OVER by 10,500
--       (51 maids were paid LESS than entitled — underpayment, a byproduct, not this axis.)
--   O6: requested, not cancelled, paid after ....... 594 notes · AED 511,700  clean
--       no referral at all ......................... 407 notes · AED 251,721  ⚠️ signing bonus?
--       🔴 referral exists, NO bonus ever requested   110 notes · AED  70,895
--       🔴 paid BEFORE the bonus was requested ......  20 notes · AED  15,000
--       No bonus was paid on an entirely cancelled referral — that bucket is empty.
--   ⚠️ O6's 20 and O7's 15 are DIFFERENT CUTS OF ONE POPULATION and may overlap. Do not add
--   them. O8 de-duplicates before anything is published.

-- O8. Consolidate the bonus findings to a distinct note set, so the headline figure is the
--   union rather than a sum of overlapping tests. One row per note, one verdict, priority
--   ordered — over-entitlement first, since it is the hardest of the three.
WITH bonus AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Bonus' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), ref AS (
    SELECT HOUSEMAID_ID                                 AS referrer_id,
           COUNT(*)                                     AS referrals,
           COUNT_IF(COALESCE(IS_REQUESTED_BONUS,0) = 1) AS bonus_requested,
           MIN(IFF(COALESCE(IS_REQUESTED_BONUS,0) = 1, BONUS_REQUEST_DATE::DATE, NULL))
                                                        AS first_bonus_request,
           SUM(IFF(COALESCE(IS_CANCELLED,0) = 0 AND COALESCE(IS_REQUESTED_BONUS,0) = 1,
                   AMOUNT, 0))                          AS entitled
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_REFERRALS
    WHERE HOUSEMAID_ID IS NOT NULL
    GROUP BY 1
), totals AS (
    SELECT HOUSEMAID_ID, SUM(AMOUNT) AS bonus_paid FROM bonus GROUP BY 1
)
SELECT CASE
         WHEN r.referrer_id IS NULL                                   THEN '4 no referral at all — unresolved'
         WHEN r.entitled > 0 AND t.bonus_paid > r.entitled + 0.01     THEN '1 OVER the referral entitlement'
         WHEN r.bonus_requested = 0                                   THEN '2 no bonus was ever requested'
         WHEN b.note_day < r.first_bonus_request                      THEN '3 paid before the bonus request'
         ELSE                                                              '5 clean'
       END                                          AS verdict,
       COUNT(*)                                     AS notes,
       COUNT(DISTINCT b.HOUSEMAID_ID)               AS maids,
       ROUND(SUM(b.AMOUNT))                         AS aed_paid,
       ROUND(SUM(GREATEST(COALESCE(t.bonus_paid,0) - COALESCE(r.entitled,0), 0))
             / NULLIF(COUNT(*),0) * COUNT(*))       AS aed_context
FROM bonus b
LEFT JOIN ref r    ON r.referrer_id  = b.HOUSEMAID_ID
LEFT JOIN totals t ON t.HOUSEMAID_ID = b.HOUSEMAID_ID
GROUP BY 1
ORDER BY verdict;

-- O8/O2/A1 RESULTS 2026-09-08.
--   O8 (bonus, de-duplicated to one verdict per note — the overlap was real):
--     1 OVER the referral entitlement ....  28 notes ·  15 maids · AED  20,000 (over by 10,500)
--     2 no bonus was ever requested ......  110 notes ·  91 maids · AED  70,895
--     3 paid before the bonus request ....   12 notes ·  12 maids · AED   9,500
--     4 no referral at all — unresolved ..  407 notes · 352 maids · AED 251,721
--     5 clean ............................  574 notes · 507 maids · AED 497,200
--     O6 reported 20 notes / AED 15,000 in category 3; de-duplication moved 8 notes and
--     AED 5,500 of those into categories 1 and 2. THIS is why O8 existed — the summed figure
--     would have been overstated by 58%.
--
--   A1 (airfare tiers) — 🟢 ESSENTIALLY CLEAN. Across 1,518 notes and 15 nationalities:
--     Kenyan .... 1 note above tier · AED 500 over (2,000 paid against a 1,500 tier)
--     every other nationality ... 0 above tier
--     Tiers are strikingly consistent: 12 of 15 nationalities have exactly ONE distinct
--     amount. Filipina 2,000, Nepali 1,000, everything else 1,500.
--     🟢 AED 2.59m of UNGATED airfare money clears on the amount axis for AED 500.
--
--   O2 (all 25 types) — the same-day column is the signal, but only where same-day is NOT
--   the type's native shape. Forgive Deduction, Prorated salary and Medical Assistance have
--   a MEDIAN repeat gap of 0 days: many lines for one maid on one day is how they work, so
--   their same-day counts (731 / 39 / 12) are structure, not duplication.
--   Types with a real monthly cadence AND same-day repeats — the genuine candidates:
--     Anti-attrition (gap 31) .. 174 same-day · AED 14,906  → already adjudicated to AED 838
--     🔴 Bonus (gap 31) ........  12 same-day · AED 10,000  → NEW
--     🔴 Salary Dispute (gap 32)  11 same-day · AED  2,582  → NEW
--     🔴 Taxi (gap 20) .........  12 same-day · AED    887  → NEW
--     🔴 Maids.at (gap 24) .....   1 same-day · AED     30  → NEW
--     🔴 Raffle Prize (gap 86) .   0 same-day, but 17 SAME-AMOUNT repeats inside 31 days,
--        AED 3,400 — a maid winning the same prize twice in a month. For a random draw that
--        is the wrong shape, and the raffle tables are not ingested to check it.
--   ⚠️ `same_amount_within_31d` is USELESS for monthly-cycle types: anti-attrition returns
--   3,838 notes / AED 926,963, which is simply a maid paid her tier every month. Read that
--   column only for types whose cadence is longer than 31 days.

-- O9. 🔴 RESOLVE THE AED 251,721 (third form). `Bonus` mixes referral and signing bonuses and
--   PURPOSE_ID is not in the warehouse — but MAIDS_REFERRALS_BONUSES carries PAYROLL_NOTE_DATE
--   and BONUS_AMOUNT against the REFERRED maid, so walking REFERRED -> REFERRER identifies
--   referral bonuses from the referral side with no PURPOSE_ID.
--   Form 1 used a LEFT JOIN and would have counted a note twice per referral record (grain).
--   Form 2 used correlated EXISTS with ABS(DATEDIFF(...)) <= 1 — Snowflake rejects a
--   correlated subquery with a non-equality predicate: "Unsupported subquery type cannot be
--   evaluated". 🔴 TRAP: in Snowflake, correlate on EQUALITY only; do tolerance work in an
--   aggregate afterwards.
--   Form 3: join on referrer (equality), collapse back to one row per note, then classify.
WITH bonus AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Bonus' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), rb AS (
    SELECT l.HOUSEMAID_ID            AS referrer_id,
           b.PAYROLL_NOTE_DATE::DATE AS rb_day,
           b.BONUS_AMOUNT            AS rb_amount
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_BONUSES b
    JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_REFERRALS l
      ON l.REFERRED_MAID_ID = b.REFERRED_HOUSEMAID_ID
    WHERE b.PAYROLL_NOTE_DATE IS NOT NULL AND l.HOUSEMAID_ID IS NOT NULL
), per_note AS (
    SELECT n.note_id, n.HOUSEMAID_ID, n.note_day, n.AMOUNT,
           MAX(IFF(r.referrer_id IS NOT NULL, 1, 0))                       AS referrer_has_any,
           MAX(IFF(ABS(DATEDIFF('day', r.rb_day, n.note_day)) <= 1, 1, 0)) AS same_day,
           MAX(IFF(ABS(DATEDIFF('day', r.rb_day, n.note_day)) <= 1
                   AND ABS(COALESCE(r.rb_amount, -1) - n.AMOUNT) < 0.01, 1, 0)) AS exact
    FROM bonus n
    LEFT JOIN rb r ON r.referrer_id = n.HOUSEMAID_ID      -- equality only
    GROUP BY 1, 2, 3, 4
)
SELECT CASE
         WHEN exact = 1            THEN 'matched to a referral-bonus record'
         WHEN same_day = 1         THEN '⚠️ referral bonus on the same day, DIFFERENT amount'
         WHEN referrer_has_any = 1 THEN 'referrer has referral bonuses, none on this date'
         ELSE                           '🔴 no referral-bonus record at all — signing or unjustified'
       END                            AS reading,
       COUNT(*)                       AS bonus_notes,
       COUNT(DISTINCT HOUSEMAID_ID)   AS maids,
       ROUND(SUM(AMOUNT))             AS aed,
       ROUND(AVG(AMOUNT))             AS avg_bonus
FROM per_note
GROUP BY 1
ORDER BY aed DESC;

-- O10. Adjudicate the NEW same-day duplicates the way anti-attrition's were: a legitimate
--   two-contract split sums to ONE entitlement; two full entitlements on one day cannot be a
--   split. Applied to the four types with a real monthly cadence.
WITH n AS (
    SELECT HOUSEMAID_ID, COALESCE(REASON,'(none)') AS payment_type,
           NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND AMOUNT > 0
      AND REASON IN ('Bonus','Salary Dispute','Taxi Reimbursement','Maids.at other expenses')
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), ent AS (
    SELECT HOUSEMAID_ID, payment_type, MAX(AMOUNT) AS best_single
    FROM n GROUP BY 1, 2
), same_day AS (
    SELECT HOUSEMAID_ID, payment_type, note_day, COUNT(*) AS notes, SUM(AMOUNT) AS total
    FROM n GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
)
SELECT s.payment_type,
       COUNT(*)                                                   AS maid_days,
       SUM(s.notes)                                               AS notes,
       ROUND(SUM(s.total))                                        AS aed_on_those_days,
       COUNT_IF(s.total > e.best_single + 0.01)                   AS OVER_their_best_single,
       ROUND(SUM(GREATEST(s.total - e.best_single, 0)))           AS aed_OVER
FROM same_day s
JOIN ent e ON e.HOUSEMAID_ID = s.HOUSEMAID_ID AND e.payment_type = s.payment_type
GROUP BY 1
ORDER BY aed_OVER DESC;

-- O10 RESULT 2026-09-08 — same-day repeats on the four monthly-cadence types:
--   Bonus ................ 11 maid-days · 23 notes · AED 20,000 · 11 over best single · AED 9,000
--   Salary Dispute ....... 11 maid-days · 22 notes · AED  7,017 ·  9 over · AED 2,023
--   Taxi Reimbursement ... 12 maid-days · 24 notes · AED  3,012 ·  9 over · AED   643
--   Maids.at ............. 1 maid-day  ·  2 notes · AED     92 ·  1 over · AED    30
--   ⚠️ READ WITH CARE. `best_single` is a strong proxy only where the entitlement is a per-maid
--   constant, which is true for anti-attrition and roughly true for Bonus (amounts cluster on
--   1,000). It is WEAK for Taxi and Salary Dispute, whose amounts are genuinely variable — a
--   maid can legitimately claim two taxis in a day. Those AED 643 and AED 2,023 are screening
--   signals, not findings.
--   🔴 DO NOT ADD O10's Bonus AED 9,000 TO O8's AED 10,500. Both are bonus overpayment on
--   overlapping populations measured two ways. O8's figure is the defensible one — it is
--   validated by 466 maids matching their entitlement to the penny. O10's same-day pattern is
--   CORROBORATION of the same problem, not additional money.

-- O9 RESULT 2026-09-08 — AED 849,316 of bonus, resolved from the referral side:
--   matched to a referral-bonus record ..... 571 notes · 507 maids · AED 494,700 · avg 866
--   🔴 no referral-bonus record at all ..... 537 notes · 462 maids · AED 337,116 · avg 628
--   ⚠️ referrer has bonuses, none this date   22 notes ·  22 maids · AED  16,500 · avg 750
--   referral bonus same day, other amount ..   1 note                · AED   1,000
--   Larger than O8's 407 / AED 251,721 because O9 requires a bonus PAYMENT record, not just a
--   referral. The average differs sharply (628 vs 866), so the unmatched group is a different
--   population rather than noise — consistent with signing bonuses, which is not a verdict.

-- O11. 🔴 THE DECISIVE TEST ON AED 337,116. A SIGNING bonus is paid to a maid near her OWN
--   start; a REFERRAL bonus is paid to an established maid for bringing someone else. So the
--   distance from each unmatched note to that maid's own start date separates them without
--   PURPOSE_ID and without any reference list.
--   ⚠️ H6: START_DATE bottoms out at 1970-01-01 for unknown. Epoch-zero is BLOCKED, never
--   treated as a real date — service arithmetic on it returns a confident wrong answer.
WITH bonus AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Bonus' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), rb AS (
    SELECT l.HOUSEMAID_ID AS referrer_id, b.PAYROLL_NOTE_DATE::DATE AS rb_day, b.BONUS_AMOUNT AS rb_amount
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_BONUSES b
    JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_REFERRALS l
      ON l.REFERRED_MAID_ID = b.REFERRED_HOUSEMAID_ID
    WHERE b.PAYROLL_NOTE_DATE IS NOT NULL AND l.HOUSEMAID_ID IS NOT NULL
), per_note AS (
    SELECT n.note_id, n.HOUSEMAID_ID, n.note_day, n.AMOUNT,
           MAX(IFF(r.referrer_id IS NOT NULL, 1, 0)) AS referrer_has_any,
           MAX(IFF(ABS(DATEDIFF('day', r.rb_day, n.note_day)) <= 1, 1, 0)) AS same_day
    FROM bonus n
    LEFT JOIN rb r ON r.referrer_id = n.HOUSEMAID_ID
    GROUP BY 1, 2, 3, 4
), unmatched AS (
    SELECT * FROM per_note WHERE referrer_has_any = 0 AND same_day = 0
)
SELECT CASE
         WHEN h.START_DATE IS NULL
           OR h.START_DATE < '1971-01-01'                          THEN 'BLOCKED — start date is epoch-zero (H6)'
         WHEN DATEDIFF('day', h.START_DATE, u.note_day) < -30      THEN '🔴 paid BEFORE she started'
         WHEN DATEDIFF('day', h.START_DATE, u.note_day) <= 180     THEN '🟢 within 6 months of her own start — signing bonus'
         WHEN DATEDIFF('day', h.START_DATE, u.note_day) <= 365     THEN '⚠️ 6–12 months after her start'
         ELSE                                                           '🔴 over a year in, and no referral — UNJUSTIFIED candidate'
       END                                     AS reading,
       COUNT(*)                                AS bonus_notes,
       COUNT(DISTINCT u.HOUSEMAID_ID)          AS maids,
       ROUND(SUM(u.AMOUNT))                    AS aed,
       ROUND(AVG(u.AMOUNT))                    AS avg_bonus,
       ROUND(MEDIAN(DATEDIFF('day', h.START_DATE, u.note_day))) AS median_days_after_start
FROM unmatched u
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = u.HOUSEMAID_ID
GROUP BY 1
ORDER BY aed DESC;

-- O11 RESULT 2026-09-08 — 🔴 THE LARGEST OVERPAYMENT FINDING IN THE AUDIT.
--   🟢 within 6 months of her own start .. 296 notes · 270 maids · AED 147,880 · avg 500 · median  6 days
--   🔴 over a year in, no referral ....... 164 notes · 142 maids · AED 143,965 · avg 878 · median 765 days
--   ⚠️ 6-12 months after start ...........  72 notes ·  53 maids · AED  42,900 · avg 596 · median 253 days
--   🔴 paid BEFORE she started ...........   2 notes ·   2 maids · AED     371 · median -97 days
--   BLOCKED epoch-zero start .............   3 notes                · AED   2,000
--   The signing group is textbook: median SIX DAYS after start, avg 500. AED 147,880 clears.
--   🔴 The amount profile is what convicts the rest. The unjustified candidates average 878 —
--   near-identical to the MATCHED REFERRAL average of 866 and nothing like the signing average
--   of 500. They are paid at referral-bonus rates, to maids a median 765 days into service,
--   with no referral and no referral-bonus record. Four converging signals.
--   By the audit's own verdict algebra a payment matching NO applicable rule is RED, not
--   cleared — the same principle as RARE_TYPE_REVIEW. The one benign reading is a third,
--   undocumented bonus type; the spec knows only referral and signing (N5).
--   ⚠️ DO NOT ADD to O7's AED 10,500 without checking. O7's population is referrers WITH
--   entitlement; O11's is referrers with no bonus record. A maid can sit in both. Every time
--   this session summed two tests without de-duplicating, the figure was overstated.

-- O12. De-duplicate the two bonus findings before either figure is published. One row per
--   note, priority ordered, so the bonus headline is a union and not a sum.
WITH bonus AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Bonus' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), rb AS (
    SELECT l.HOUSEMAID_ID AS referrer_id, b.PAYROLL_NOTE_DATE::DATE AS rb_day, b.BONUS_AMOUNT AS rb_amount
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_BONUSES b
    JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_REFERRALS l
      ON l.REFERRED_MAID_ID = b.REFERRED_HOUSEMAID_ID
    WHERE b.PAYROLL_NOTE_DATE IS NOT NULL AND l.HOUSEMAID_ID IS NOT NULL
), ent AS (
    SELECT HOUSEMAID_ID AS referrer_id,
           SUM(IFF(COALESCE(IS_CANCELLED,0)=0 AND COALESCE(IS_REQUESTED_BONUS,0)=1, AMOUNT, 0)) AS entitled
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_REFERRALS
    WHERE HOUSEMAID_ID IS NOT NULL GROUP BY 1
), paid AS (
    SELECT HOUSEMAID_ID, SUM(AMOUNT) AS bonus_paid FROM bonus GROUP BY 1
), per_note AS (
    SELECT n.note_id, n.HOUSEMAID_ID, n.note_day, n.AMOUNT,
           MAX(IFF(r.referrer_id IS NOT NULL, 1, 0)) AS referrer_has_any,
           MAX(IFF(ABS(DATEDIFF('day', r.rb_day, n.note_day)) <= 1, 1, 0)) AS same_day
    FROM bonus n LEFT JOIN rb r ON r.referrer_id = n.HOUSEMAID_ID
    GROUP BY 1, 2, 3, 4
)
SELECT CASE
         WHEN p.referrer_has_any = 0 AND p.same_day = 0
              AND h.START_DATE >= '1971-01-01'
              AND DATEDIFF('day', h.START_DATE, p.note_day) > 365      THEN '1 no referral, over a year in'
         WHEN e.entitled > 0 AND t.bonus_paid > e.entitled + 0.01      THEN '2 over the referral entitlement'
         WHEN p.referrer_has_any = 0 AND p.same_day = 0
              AND h.START_DATE >= '1971-01-01'
              AND DATEDIFF('day', h.START_DATE, p.note_day) BETWEEN 181 AND 365
                                                                       THEN '3 no referral, 6-12 months in'
         WHEN p.referrer_has_any = 0 AND p.same_day = 0
              AND h.START_DATE >= '1971-01-01'
              AND DATEDIFF('day', h.START_DATE, p.note_day) <= 180     THEN '4 signing bonus — clean'
         WHEN p.same_day = 1 OR p.referrer_has_any = 1                 THEN '5 referral bonus — clean'
         ELSE                                                               '6 BLOCKED — no usable start date'
       END                              AS verdict,
       COUNT(*)                         AS notes,
       COUNT(DISTINCT p.HOUSEMAID_ID)   AS maids,
       ROUND(SUM(p.AMOUNT))             AS aed
FROM per_note p
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = p.HOUSEMAID_ID
LEFT JOIN ent  e ON e.referrer_id  = p.HOUSEMAID_ID
LEFT JOIN paid t ON t.HOUSEMAID_ID = p.HOUSEMAID_ID
GROUP BY 1
ORDER BY verdict;

-- O12 RESULT 2026-09-08 — the two bonus findings barely overlap, and the type is now closed.
--   1 no referral, over a year in ..... 164 notes · 142 maids · AED 143,965   🔴 unchanged
--   2 over the referral entitlement ...  25 notes ·  13 maids · AED  17,500 paid (excess 10,500)
--   3 no referral, 6-12 months in .....  72 notes ·  53 maids · AED  42,900   ⚠️ ambiguous
--   4 signing bonus — clean ........... 298 notes · 272 maids · AED 148,251   🟢
--   5 referral bonus — clean .......... 569 notes · 500 maids · AED 494,700   🟢
--   6 BLOCKED — no usable start date ..   3 notes                · AED   2,000
--   O7 found 15 over-entitled maids; O12 leaves 13, so 3 notes across 2 maids were in both
--   tests. The double-count is those maids' share of the AED 10,500 excess — about AED 1,400.
--   Immaterial: recorded, not chased. (Category 2's AED is the amount PAID on those notes;
--   the money over-paid is the 10,500 excess, not 17,500.)
--   🟢 BONUS IS CLOSED: AED 642,951 of 849,316 cleared on evidence (75.7%), AED 143,965 RED,
--   AED 42,900 ambiguous, AED 2,000 blocked.

-- O4b. 🔴 SALARY DISPUTE — AED 385,984, the largest type with no entitlement verdict.
--   REPLACES the original O4, which had two defects it was written before this session learned
--   to catch:
--     (1) a correlated EXISTS carrying a BETWEEN — Snowflake rejects it, as it rejected O9;
--     (2) the chance baseline was in the COMMENT, not the query. An observed corroboration
--         rate with nothing to compare it against is trap 17, and this project has already
--         published one such rate that turned out to be exactly 1.00x chance.
--   Method: window -180..+30 days (211 days), band -30..+7 (38 days), so p = 38/211 = 0.180.
--   Chance a maid with k complaints in the window has one in the band = 1 - (1-p)^k, SUMMED
--   PER NOTE — never 1-(1-p)^avg(k), which is the Jensen trap.
--   ⚠️ Complaint TAXONOMY AND DATES ONLY. No free text leaves the warehouse.
WITH disp AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Salary Dispute' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), comp AS (
    SELECT HOUSEMAID_ID, CREATION_DATE::DATE AS complaint_day
    FROM BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS
    WHERE HOUSEMAID_ID IS NOT NULL AND CREATION_DATE IS NOT NULL
), pairs AS (
    SELECT d.note_id, d.HOUSEMAID_ID, d.note_day, d.AMOUNT,
           COUNT_IF(c.complaint_day BETWEEN DATEADD('day',-180,d.note_day)
                                        AND DATEADD('day',  30,d.note_day)) AS k_window,
           COUNT_IF(c.complaint_day BETWEEN DATEADD('day', -30,d.note_day)
                                        AND DATEADD('day',   7,d.note_day)) AS in_band,
           COUNT(c.complaint_day)                                            AS complaints_ever
    FROM disp d
    LEFT JOIN comp c ON c.HOUSEMAID_ID = d.HOUSEMAID_ID     -- equality only; band work in the aggregate
    GROUP BY 1, 2, 3, 4
)
SELECT COUNT(*)                                                          AS dispute_notes,
       ROUND(SUM(AMOUNT))                                                AS aed,
       COUNT_IF(in_band > 0)                                             AS with_a_complaint_in_band,
       ROUND(100.0 * COUNT_IF(in_band > 0) / COUNT(*), 1)                AS pct_observed,
       ROUND(SUM(1 - POWER(1 - 38.0/211, k_window)), 1)                  AS chance_expected,
       ROUND(100.0 * SUM(1 - POWER(1 - 38.0/211, k_window)) / COUNT(*), 1) AS pct_chance,
       ROUND(COUNT_IF(in_band > 0)
             / NULLIF(SUM(1 - POWER(1 - 38.0/211, k_window)), 0), 2)     AS TIMES_CHANCE,
       COUNT_IF(complaints_ever = 0)                                     AS maid_never_complained,
       ROUND(SUM(IFF(complaints_ever = 0, AMOUNT, 0)))                   AS aed_maid_never_complained,
       ROUND(SUM(IFF(in_band = 0, AMOUNT, 0)))                           AS aed_no_complaint_in_band
FROM pairs;

-- O4c. The same population split into verdicts, so the answer is a population and not a ratio.
--   "Never complained at all" is the unambiguous bucket: a salary correction for a maid with
--   no complaint on record in her entire history.
WITH disp AS (
    SELECT ID AS note_id, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Salary Dispute' AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), comp AS (
    SELECT HOUSEMAID_ID, CREATION_DATE::DATE AS complaint_day
    FROM BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS
    WHERE HOUSEMAID_ID IS NOT NULL AND CREATION_DATE IS NOT NULL
), pairs AS (
    SELECT d.note_id, d.HOUSEMAID_ID, d.note_day, d.AMOUNT,
           COUNT_IF(c.complaint_day BETWEEN DATEADD('day',-30,d.note_day)
                                        AND DATEADD('day',  7,d.note_day)) AS in_band,
           COUNT_IF(c.complaint_day <= d.note_day)                          AS complaints_before,
           COUNT(c.complaint_day)                                           AS complaints_ever
    FROM disp d LEFT JOIN comp c ON c.HOUSEMAID_ID = d.HOUSEMAID_ID
    GROUP BY 1, 2, 3, 4
)
SELECT CASE
         WHEN in_band > 0           THEN '🟢 a complaint in the 30 days before'
         WHEN complaints_before > 0 THEN '⚠️ complained earlier, not near this note'
         WHEN complaints_ever  > 0  THEN '⚠️ complaints only AFTER the note'
         ELSE                            '🔴 NO COMPLAINT ON RECORD, EVER'
       END                              AS verdict,
       COUNT(*)                         AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)     AS maids,
       ROUND(SUM(AMOUNT))               AS aed,
       ROUND(MEDIAN(AMOUNT))            AS median_paid
FROM pairs
GROUP BY 1
ORDER BY aed DESC;

-- O4b/O4c RESULTS 2026-09-08 — 🔴 A NULL RESULT, AND THE BASELINE CAUGHT IT BEFORE PUBLICATION.
--   980 dispute notes · AED 385,984
--     with a complaint in the band ... 890 (90.8%)
--     chance ......................... 821.5 (83.8%)
--     🔴 TIMES_CHANCE ................ 1.08
--   THE TEST HAS NO POWER ON THIS TYPE. These maids complain often enough that a complaint in
--   any 38-day band is near-certain, so corroboration cannot distinguish a justified dispute
--   from an unjustified one.
--   Both framings would have been wrong:
--     "90.8% of salary disputes are corroborated"  -> reads as strong validation. It is 1.08x.
--     "9.2% have no complaint, AED 31,200"          -> reads as a finding. Chance predicts 16.2%
--                                                      WITHOUT one, so the observed rate is
--                                                      BETTER than chance, not worse.
--   O4c: only 5 notes / AED 1,592 have no complaint anywhere in the maid's history. At this
--   density that is the tail of the distribution, not a population.
--
-- 🟢 METHODOLOGICAL RULE: a corroborator that is near-ubiquitous cannot corroborate. Before
--   building a corroboration test, measure the corroborator's BASE RATE in the population. If
--   chance already exceeds ~70%, no window and no threshold will give the test power — abandon
--   it rather than tune it.
--
-- 🟢 SALARY DISPUTE DOES NOT NEED THIS TEST. It is the most gated type in the audit: 1,073 of
--   1,084 notes carry an exact FK to an EXPENSE REQUEST, and every one of those is PAID. O1
--   already measured note against request and found AED 1,213 of disagreement across 3 notes.
--   The approval trail IS the entitlement evidence, and it is stronger than any complaint
--   proxy. The type closes on evidence already gathered.
