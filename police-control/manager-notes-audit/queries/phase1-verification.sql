-- =====================================================================================
-- PHASE 1 VERIFICATION PACK
-- Four checks that produce REAL findings on granted columns, no new ingestion.
-- Written 2026-09-08 from the code + data work. Ordered by value.
-- =====================================================================================


-- =====================================================================================
-- 1. S1 — SEGREGATION OF DUTIES.  ⚠️ REWRITTEN 2026-09-08 (O51). The previous version
--    compared LOWER(requester) = LOWER(approver) and UNDER-REPORTED SILENTLY.
--
--    ROOT CAUSE — the two columns do not come from the same place:
--      REQUESTED_BY  = mmdb.users.FULL_NAME   (canonical, "Niveen Bouhassan")
--      APPROVED_BY   = free text, a NAME not a user id ("Manale", "Jed")
--    There is no identity key: MANAGER (EMPLOYEE_MANAGER_ID) has no non-null values and
--    is unmapped in the JPA entity. So a string equality compares a canonical value
--    against an uncontrolled one and matches only by luck. Observed: 34 of 35 hand-added
--    anti-attrition approvals carry a SINGLE-TOKEN approver, and a single token is not
--    an identity. The old check called every one of those GREEN.
--
--    THE RULE (plugin check #1): a test that could not run is not a test that passed.
--    S1's self-approval count is a FLOOR, and this version says by how much.
--
--    ⚠️ BLOCK NARROWLY. A first draft of this fix blocked every single-token approver —
--    ~7,800 notes, 43% of all approvals — which is wrong in the opposite direction. If
--    the bare name does NOT match the requester's first name, they are different people
--    under every reading of it, however ambiguous the name is: "Manale" approving a
--    request by "Gurmu Ejeta" is segregated whichever Manale it is. Ambiguity only bites
--    where the names DO match, so that is the only place it blocks. Over-blocking is not
--    the safe direction — it buries the findings and inflates the same denominator.
--
--    ⚠️ Only meaningful where a HUMAN is the requester. Machine types (airfare, raffle,
--       prorated, forgive, office work, last-day CC) have a null/service requester by
--       design and must be EXCLUDED, or this manufactures thousands of false findings.
--
--    ⚠️ TWO KNOWN GAPS, both open (O54, O55), both of which move the numbers:
--    1. NO DATE FILTER. This spans the whole table; every other figure in the audit is a
--       12-month window. Do not put them on one dashboard. To match, add to n:
--         AND NOTE_DATE >= DATEADD('month',-12,CURRENT_DATE())
--    2. The type list below is an ASSUMPTION, not a measurement. `Bonus` is partly
--       machine-generated (the retraction half, via DelighterService), so some of its
--       58% B_neither_recorded is null attribution BY DESIGN rather than a finding.
--       Batch days are observable — see 6g in complaints-corroboration-discovery.sql —
--       so the machine/human split should be measured per type, not hardcoded.
--
--    RESULT 2026-09-08: R_self_approved_name_form = 0 on every type. The name-form class
--    this rewrite was built to catch does not exist; the old string test was not missing
--    it. What the run DID show is that 45% of notes in scope (AED 2.86m) name NOBODY at
--    all — you cannot ask who approved what when the record is empty.
-- =====================================================================================

-- 1c. RUN THIS FIRST — how resolvable are the approver names at all?
--     If single_token_approvals is large, most of S1's old GREENs were unverified.
WITH n AS (
    SELECT ID,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(REQUESTED_BY),''), '\\s+', ' '))) AS requester,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(APPROVED_BY),''),  '\\s+', ' '))) AS approver
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
)
SELECT COUNT(*)                                                          AS notes,
       COUNT(DISTINCT requester)                                         AS distinct_requesters,
       COUNT(DISTINCT approver)                                          AS distinct_approvers,
       COUNT_IF(approver IS NOT NULL
                AND ARRAY_SIZE(SPLIT(approver,' ')) = 1)                 AS single_token_approvals,
       COUNT(DISTINCT IFF(ARRAY_SIZE(SPLIT(approver,' ')) = 1, approver, NULL))
                                                                         AS distinct_single_tokens,
       COUNT_IF(approver IS NULL)                                        AS no_approver,
       COUNT_IF(requester IS NULL)                                       AS no_requester
FROM n;


-- 1. S1 proper — four verdicts, and BLOCKED is not a pass.
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT,
           COALESCE(REASON,'(none)') AS payment_type,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(REQUESTED_BY),''), '\\s+', ' '))) AS requester,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(APPROVED_BY),''),  '\\s+', ' '))) AS approver
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), people AS (        -- the canonical staff population, from the FULL_NAME column
    SELECT DISTINCT requester AS full_name, SPLIT_PART(requester,' ',1) AS first_token
    FROM n WHERE requester IS NOT NULL
), token_map AS (     -- can a bare first name identify exactly one person?
    SELECT first_token, COUNT(DISTINCT full_name) AS people_sharing_it
    FROM people GROUP BY 1
), human AS (
    SELECT * FROM n WHERE payment_type IN (
      'Salary Dispute','Bonus','Taxi Reimbursement','Medical Assistance',
      'Maids.at other expenses','Accommodation Relocation','VIP Bonus',
      'Passport Assistance','Lost Luggage Compensation','MOHRE requirement additions')
), judged AS (
    SELECT h.*,
           ARRAY_SIZE(SPLIT(h.approver,' ')) AS approver_tokens,
           t.people_sharing_it,
           CASE
             WHEN h.requester IS NULL AND h.approver IS NULL THEN 'B_neither_recorded'
             WHEN h.approver  IS NULL                        THEN 'R_raised_never_approved'
             WHEN h.requester IS NULL                        THEN 'B_no_requester'
             -- same person, same string
             WHEN h.requester = h.approver                   THEN 'R_self_approved_exact'
             -- same person, different name FORM: "manale" vs "manale hamasny"
             WHEN h.requester LIKE h.approver || ' %'
               OR h.approver  LIKE h.requester || ' %'
               OR h.approver  = SPLIT_PART(h.requester,' ',1)
                  THEN IFF(COALESCE(t.people_sharing_it,1) > 1,
                           'B_same_first_name_unresolvable',   -- may be a DIFFERENT person
                           'R_self_approved_name_form')
             -- a bare first name that does NOT match the requester's first name is a
             -- different person under every reading, however ambiguous the name is
             ELSE 'G_segregated'
           END AS verdict
    FROM human h
    -- the question is whether the REQUESTER's first name is unique, not the approver's
    LEFT JOIN token_map t ON t.first_token = SPLIT_PART(h.requester,' ',1)
)
SELECT payment_type, verdict,
       COUNT(*)                                                       AS notes,
       ROUND(SUM(AMOUNT))                                             AS aed,
       ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (PARTITION BY payment_type)) AS pct_of_type
FROM judged GROUP BY 1,2 ORDER BY payment_type, verdict;

-- Reading it (plugin check #1 — a clearance is not a finding's opposite):
--   R_*  = findings. R_self_approved_name_form is the class the old S1 missed entirely.
--   B_same_first_name_unresolvable = the approver's name matches the requester's, but
--          several staff share that first name, so it cannot be called either way.
--          NOT clean; must not be counted as segregated in any tile, filter or denominator.
--   G_   = segregated: the names do not match, so it is a different person.


-- 1b. The row list — every finding AND every blocked row, worst first.
--     ⚠️ Blocked rows are included deliberately. Dropping them is how the old version
--        made an unresolvable approver look like a clean one.
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT, COALESCE(REASON,'(none)') AS payment_type,
           NULLIF(TRIM(REQUESTED_BY),'') AS requester_raw,
           NULLIF(TRIM(APPROVED_BY),'')  AS approver_raw,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(REQUESTED_BY),''), '\\s+', ' '))) AS requester,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(APPROVED_BY),''),  '\\s+', ' '))) AS approver
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION' AND AMOUNT > 0
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
), people AS (
    SELECT DISTINCT requester AS full_name, SPLIT_PART(requester,' ',1) AS first_token
    FROM n WHERE requester IS NOT NULL
), token_map AS (
    SELECT first_token, COUNT(DISTINCT full_name) AS people_sharing_it
    FROM people GROUP BY 1
), judged AS (
SELECT n.ID AS note_id, n.payment_type, n.HOUSEMAID_ID AS maid_id,
       n.NOTE_DATE::DATE AS d, n.AMOUNT, n.requester_raw, n.approver_raw,
       t.people_sharing_it AS staff_sharing_that_first_name,
       CASE
         WHEN n.requester IS NULL AND n.approver IS NULL THEN 'B_neither_recorded'
         WHEN n.approver  IS NULL                        THEN 'R_raised_never_approved'
         WHEN n.requester IS NULL                        THEN 'B_no_requester'
         WHEN n.requester = n.approver                   THEN 'R_self_approved_exact'
         WHEN n.requester LIKE n.approver || ' %'
           OR n.approver  LIKE n.requester || ' %'
           OR n.approver  = SPLIT_PART(n.requester,' ',1)
              THEN IFF(COALESCE(t.people_sharing_it,1) > 1,
                       'B_same_first_name_unresolvable',
                       'R_self_approved_name_form')
         ELSE 'G_segregated'
       END AS verdict
FROM n LEFT JOIN token_map t ON t.first_token = SPLIT_PART(n.requester,' ',1)
WHERE n.payment_type IN ('Salary Dispute','Bonus','Taxi Reimbursement','Medical Assistance',
      'Maids.at other expenses','Accommodation Relocation','VIP Bonus','Passport Assistance',
      'Lost Luggage Compensation','MOHRE requirement additions')
)
SELECT * FROM judged
WHERE verdict <> 'G_segregated'          -- QUALIFY needs a window function; this does not
ORDER BY LEFT(verdict,1), AMOUNT DESC
LIMIT 300;


-- =====================================================================================
-- 2. B1 — ANTI-ATTRITION PAID WITH NO ENROLMENT RECORD.
--    The code requires a MaidManagerActionLog with actionType Maid_Incentive_Experiment
--    and incentiveAmount NOT NULL before the job pays. A payment without one did not come
--    from the job. This is a hard RED, not a heuristic. AED 1.83m type.
--    STEP 0: confirm the exact picklist NAME first --
--      SELECT ACTION_TYPE, COUNT(*) FROM ..HOUSEMAID_MANAGERACTIONLOGS
--      WHERE ACTION_TYPE ILIKE '%incentive%' OR ACTION_TYPE ILIKE '%experiment%' GROUP BY 1;
-- =====================================================================================
WITH paid AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND NOTE_DATE >= DATEADD('month',-12,CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
), enrol AS (
    SELECT HOUSEMAID_ID, MIN(ACTION_DATE) AS first_enrolled, COUNT(*) AS enrolment_rows
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%'
    GROUP BY 1
)
SELECT
    COUNT(*)                                                   AS notes,
    ROUND(SUM(p.AMOUNT))                                       AS aed,
    COUNT_IF(e.HOUSEMAID_ID IS NULL)                           AS no_enrolment_at_all,
    ROUND(SUM(IFF(e.HOUSEMAID_ID IS NULL, p.AMOUNT, 0)))       AS aed_no_enrolment,
    COUNT_IF(e.first_enrolled > p.NOTE_DATE)                   AS paid_before_enrolled,
    ROUND(SUM(IFF(e.first_enrolled > p.NOTE_DATE, p.AMOUNT,0))) AS aed_paid_before_enrolled
FROM paid p LEFT JOIN enrol e ON e.HOUSEMAID_ID = p.HOUSEMAID_ID;

-- 2b. The row list, plus the enrolment NOTES text — the only justification that exists.
--     ⚠️ NOTES is free text about a named person. Goes to the agent, not to an export.
WITH paid AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION' AND REASON='Anti-attrition Incentive'
      AND NOTE_DATE >= DATEADD('month',-12,CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
)
SELECT p.ID AS note_id, p.HOUSEMAID_ID AS maid_id, p.NOTE_DATE::DATE AS d, p.AMOUNT,
       a.ACTION_DATE::DATE AS enrolled_on, a.USER_WHO_CREATED_NOTE AS enrolled_by,
       a.NOTES AS enrolment_reason
FROM paid p
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS a
       ON a.HOUSEMAID_ID = p.HOUSEMAID_ID AND a.ACTION_TYPE ILIKE '%Incentive%Experiment%'
WHERE a.HOUSEMAID_ID IS NULL
ORDER BY p.AMOUNT DESC LIMIT 200;


-- =====================================================================================
-- 3. A1 — AIRFARE AMOUNT vs THE NATIONALITY TIER.
--    Code: amount = Nationality tag ScheduledAnnualVacationAmount, else the
--    default_ticket_allowance_amount parameter. Observed tiers 2000 / 1500 / 1000.
--    Grouping amount BY nationality recovers the tier table from data, and any maid
--    paid off her nationality's modal amount is a finding.
--    Needs a nationality column on the maid dimension — adjust the join to whatever
--    HOUSEMAIDS_INFO exposes (check: SHOW COLUMNS ... LIKE '%NATION%').
-- =====================================================================================
WITH a AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION' AND REASON='Airfare Ticket'
      AND NOTE_DATE >= DATEADD('month',-24,CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
), joined AS (
    SELECT a.*, h.NATIONALITY
    FROM a JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h
           ON h.ID = a.HOUSEMAID_ID
), modal AS (
    SELECT NATIONALITY, AMOUNT, COUNT(*) AS n,
           ROW_NUMBER() OVER (PARTITION BY NATIONALITY ORDER BY COUNT(*) DESC) AS rk
    FROM joined WHERE AMOUNT > 0 GROUP BY 1,2
)
SELECT j.NATIONALITY,
       COUNT(*)                                   AS notes,
       m.AMOUNT                                   AS tier_implied_by_data,
       COUNT_IF(j.AMOUNT = m.AMOUNT)              AS on_tier,
       COUNT_IF(j.AMOUNT <> m.AMOUNT AND j.AMOUNT > 0) AS OFF_TIER,
       ROUND(SUM(IFF(j.AMOUNT <> m.AMOUNT AND j.AMOUNT > 0, j.AMOUNT, 0))) AS aed_off_tier,
       COUNT_IF(j.AMOUNT = 0)                     AS zero_amount
FROM joined j JOIN modal m ON m.NATIONALITY = j.NATIONALITY AND m.rk = 1
GROUP BY 1,3 ORDER BY notes DESC;


-- =====================================================================================
-- 4. E4 — CROSS-TYPE CONSISTENCY: forgiven days must appear as Forgive Deduction.
--    From note 174632: "January 27 - I forgave this in the forgiveness page hence not
--    included in the computation." A day excluded from a salary-dispute calculation must
--    exist as a forgive_deduction note for that maid. In one or neither, never both.
-- =====================================================================================
WITH sd AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT, NOTE_REASON
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION' AND REASON='Salary Dispute'
      AND NOTE_REASON ILIKE '%forgiv%'
      AND NOTE_DATE >= DATEADD('month',-18,CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
)
SELECT sd.ID AS salary_dispute_note, sd.HOUSEMAID_ID AS maid_id,
       sd.NOTE_DATE::DATE AS dispute_date, sd.AMOUNT,
       COUNT(f.ID)                                   AS forgive_notes_within_90d,
       ROUND(SUM(f.AMOUNT))                          AS forgive_aed,
       IFF(COUNT(f.ID)=0,'RED - claims a forgiveness that does not exist','ok') AS e4,
       sd.NOTE_REASON
FROM sd
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES f
       ON f.HOUSEMAID_ID = sd.HOUSEMAID_ID AND f.REASON = 'Forgive Deduction'
      AND f.NOTE_DATE BETWEEN DATEADD('day',-90,sd.NOTE_DATE) AND DATEADD('day',30,sd.NOTE_DATE)
GROUP BY 1,2,3,4,8
ORDER BY forgive_notes_within_90d, sd.AMOUNT DESC;


-- =====================================================================================
-- 1d. O53 — IS THE UNATTRIBUTED MONEY MACHINE-BY-DESIGN, OR HUMAN WITH NO ATTRIBUTION?
--     SELF-CONTAINED. ~20 rows (10 types x 2 classes).
--
--     S1 found 7,147 notes / AED 2.86m with neither a requester nor an approver. That is
--     only a finding if a HUMAN made those payments. Machine-created notes carry null
--     attribution by design, and the "human types" list is an assumption (O55).
--
--     NO THRESHOLD TUNING. §3m's batch-day rule used COUNT(*) > 100, which was calibrated
--     on anti-attrition's ~750-note batches and would misfire on a type with 149 notes in
--     total. Instead each type carries its OWN control group: the ATTRIBUTED notes of the
--     same type are known-human, so compare the unattributed notes against them.
--
--     READING IT — concentration is the signal, the attributed row is the baseline:
--       unattributed far MORE concentrated than attributed  -> a batch job. By design.
--       unattributed spread like the attributed notes       -> human work with the
--                                                              attribution missing. 🔴
--     pct_on_top12_days is the sharpest column: twelve days is one per month, the
--     signature of a monthly job. Human work cannot concentrate that way.
--
--     12-month window applied here (O54), so these totals ARE comparable with §3.
-- =====================================================================================
WITH n AS (
    SELECT ID, NOTE_DATE::DATE AS d, AMOUNT,
           COALESCE(REASON,'(none)')     AS payment_type,
           NULLIF(TRIM(REQUESTED_BY),'') AS requester,
           NULLIF(TRIM(APPROVED_BY),'')  AS approver
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION'
      AND NOTE_DATE >= DATEADD('month',-12,CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), c AS (
    SELECT *, IFF(requester IS NULL AND approver IS NULL,
                  'unattributed','attributed') AS cls
    FROM n
    WHERE payment_type IN (
      'Salary Dispute','Bonus','Taxi Reimbursement','Medical Assistance',
      'Maids.at other expenses','Accommodation Relocation','VIP Bonus',
      'Passport Assistance','Lost Luggage Compensation','MOHRE requirement additions')
), byday AS (
    SELECT payment_type, cls, d, COUNT(*) AS notes, SUM(AMOUNT) AS aed
    FROM c GROUP BY 1,2,3
), ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY payment_type, cls ORDER BY notes DESC) AS rn
    FROM byday
)
SELECT payment_type, cls,
       SUM(notes)                                          AS notes,
       ROUND(SUM(aed))                                     AS aed,
       COUNT(*)                                            AS active_days,
       MAX(notes)                                          AS busiest_day_notes,
       ROUND(100.0*MAX(notes)/SUM(notes))                  AS pct_on_busiest_day,
       ROUND(100.0*SUM(IFF(rn <= 12, notes, 0))/SUM(notes)) AS pct_on_top12_days,
       ROUND(AVG(notes),1)                                 AS avg_notes_per_active_day
FROM ranked GROUP BY 1,2 ORDER BY payment_type, cls;


-- =====================================================================================
-- 1e. O56 — WHEN DID ATTRIBUTION START BEING ENFORCED? SELF-CONTAINED. ~36 rows.
--     1d showed 8 of 10 types now carry attribution on every note, and that 79% of the
--     unattributed money predates the last 12 months. So something changed. Dating it
--     decides whether the AED 2.25m legacy backlog is a closed item or open remediation.
--     36 months, the three types with real unattributed history.
-- =====================================================================================
WITH n AS (
    SELECT ID, DATE_TRUNC('month', NOTE_DATE)::DATE AS mth, AMOUNT,
           COALESCE(REASON,'(none)')     AS payment_type,
           NULLIF(TRIM(REQUESTED_BY),'') AS requester,
           NULLIF(TRIM(APPROVED_BY),'')  AS approver
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION'
      AND REASON IN ('Salary Dispute','Bonus','Taxi Reimbursement')
      AND NOTE_DATE >= DATEADD('month',-36,CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
)
SELECT payment_type, mth,
       COUNT(*)                                                          AS notes,
       COUNT_IF(requester IS NULL AND approver IS NULL)                  AS unattributed,
       ROUND(100.0*COUNT_IF(requester IS NULL AND approver IS NULL)/COUNT(*)) AS pct_unattributed,
       ROUND(SUM(IFF(requester IS NULL AND approver IS NULL, AMOUNT, 0))) AS aed_unattributed
FROM n GROUP BY 1,2 ORDER BY payment_type, mth;


-- =====================================================================================
-- 1f. O36 — IS THE ENROLMENT `NOTES` BOX USABLE? SELF-CONTAINED. Part A ~5 rows, B 1 row.
--
--     WHY THIS GATES THE LARGEST PAYMENT TYPE IN THE AUDIT. For anti-attrition the
--     complaint test is N_A (1.00x chance, §3g), the enrolment-exists test passes 999
--     times in 1,000 (§3h), and the recompute is blocked on ingestion (O44). So Job 1 —
--     an agent reading this free-text box and judging whether it states a retention
--     reason — IS the anti-attrition check. If the column is sparse or boilerplate, the
--     type has no working check at all and the spec must say so rather than describe one.
--
--     ⚠️ NOTES is free text about a named individual. This query returns ONLY lengths,
--        counts and ratios — never the text. The boilerplate ratio is computed from value
--        frequencies without selecting any value. Do not "just look at a few" to check.
-- =====================================================================================
-- A. Confirm the picklist name first — every downstream filter depends on it.
SELECT ACTION_TYPE,
       COUNT(*)                                   AS records,
       COUNT(DISTINCT HOUSEMAID_ID)               AS maids,
       MIN(ACTION_DATE)::DATE                     AS first_seen,
       MAX(ACTION_DATE)::DATE                     AS last_seen
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
WHERE ACTION_TYPE ILIKE '%incentive%' OR ACTION_TYPE ILIKE '%experiment%'
   OR ACTION_TYPE ILIKE '%attrition%' OR ACTION_TYPE ILIKE '%retention%'
GROUP BY 1 ORDER BY records DESC;

-- B. Is the box filled, and does it carry anything? Adjust ACTION_TYPE from part A.
WITH e AS (
    SELECT HOUSEMAID_ID, ACTION_DATE,
           NULLIF(TRIM(NOTES),'') AS note_text
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%'      -- <<< set from part A
      AND ACTION_DATE >= DATEADD('month',-12,CURRENT_DATE())
), freq AS (        -- value frequencies, so boilerplate is measurable without display
    SELECT note_text, COUNT(*) AS uses FROM e WHERE note_text IS NOT NULL GROUP BY 1
)
SELECT
    (SELECT COUNT(*) FROM e)                                          AS enrolment_records,
    (SELECT COUNT_IF(note_text IS NULL) FROM e)                       AS notes_EMPTY,
    (SELECT ROUND(100.0*COUNT_IF(note_text IS NOT NULL)/COUNT(*)) FROM e) AS pct_filled,
    (SELECT COUNT(*) FROM freq)                                       AS distinct_values,
    (SELECT ROUND(100.0*COUNT(*)/NULLIF((SELECT SUM(uses) FROM freq),0)) FROM freq)
                                                                      AS pct_distinct,
    -- share sitting on the single most-repeated value: high = boilerplate, not a reason
    (SELECT ROUND(100.0*MAX(uses)/NULLIF((SELECT SUM(uses) FROM freq),0)) FROM freq)
                                                                      AS pct_on_commonest_value,
    (SELECT ROUND(AVG(LENGTH(note_text))) FROM e)                     AS avg_chars,
    (SELECT MEDIAN(LENGTH(note_text)) FROM e)                         AS median_chars,
    (SELECT COUNT_IF(LENGTH(note_text) <= 10) FROM e)                 AS under_10_chars,
    (SELECT COUNT_IF(LENGTH(note_text) >= 60) FROM e)                 AS at_least_60_chars;


-- =====================================================================================
-- B1b-F — FOLLOW-UPS AFTER ask-the-code SESSION 46015 (2026-09-08).
--   The code answer says ACTION_DATE (= MaidManagerActionLog.actionDate) is stamped only
--   on CREATE and is caller-supplied on every UPDATE — it is a business date, not a
--   system timestamp, and the selection query never reads it. B1b's 53 cases were
--   measured against the wrong column. It also names two routes that pay with no
--   enrolment row at all: the Abu Dhabi job, and any manual AAI - 01 expense request.
--   Each block below is self-contained. Run in order; F1 first.
-- =====================================================================================

-- F1a. RESOLVED 2026-09-08. The view exposes both:
--        ID, ACTION_TYPE_ID, ACTION_TYPE, HOUSEMAID_ID, CREATION_DATE (TIMESTAMP_NTZ),
--        ACTION_DATE (TIMESTAMP_NTZ), USER_WHO_CREATED_NOTE, USER_WHO_LAST_MODIFIED,
--        NOTES, AMOUNT.
--      CREATION_DATE is the column the paying code orders enrolments by; ACTION_DATE is the
--      user-editable business date. USER_WHO_LAST_MODIFIED exists too, so an edited row is
--      identifiable. No INCENTIVE_AMOUNT — B4/B5 stay blocked on that one column.

-- F1b. B1b re-run against CREATION_DATE, side by side with the ACTION_DATE version, so the
--      two are directly comparable. This is the number that decides whether the 53 survive.
WITH paid AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), enrol AS (
    SELECT HOUSEMAID_ID,
           MIN(ACTION_DATE)::DATE   AS first_action_date,
           MIN(CREATION_DATE)::DATE AS first_created
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%'
    GROUP BY 1
)
SELECT COUNT(*)                                                        AS notes,
       COUNT_IF(e.HOUSEMAID_ID IS NULL)                                AS b1_no_enrolment_row,
       COUNT_IF(e.first_action_date > p.note_day)                      AS b1b_by_action_date,
       ROUND(SUM(IFF(e.first_action_date > p.note_day, p.AMOUNT, 0)))  AS aed_action_date,
       COUNT_IF(e.first_created > p.note_day)                          AS b1b_by_creation_date,
       ROUND(SUM(IFF(e.first_created > p.note_day, p.AMOUNT, 0)))      AS aed_creation_date,
       COUNT_IF(e.first_action_date > p.note_day
                AND e.first_created <= p.note_day)                     AS cleared_by_the_fix
FROM paid p
LEFT JOIN enrol e ON e.HOUSEMAID_ID = p.HOUSEMAID_ID;

-- F1c. How often the business date and the system date disagree on incentive enrolment rows,
--      and whether a modifier is recorded. Measures the editability the code answer described.
--      Buckets only, no identifiers.
SELECT CASE
         WHEN ACTION_DATE::DATE  = CREATION_DATE::DATE                     THEN 'same day'
         WHEN ACTION_DATE::DATE  < CREATION_DATE::DATE                     THEN 'action date back-dated'
         ELSE 'action date ahead of creation'
       END                                                     AS relation,
       COUNT(*)                                                AS rows_,
       COUNT_IF(NULLIF(TRIM(USER_WHO_LAST_MODIFIED),'') IS NOT NULL) AS with_a_modifier,
       MEDIAN(ABS(DATEDIFF('day', CREATION_DATE, ACTION_DATE))) AS median_gap_days,
       MAX(ABS(DATEDIFF('day', CREATION_DATE, ACTION_DATE)))    AS max_gap_days
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%'
GROUP BY 1
ORDER BY rows_ DESC;

-- F2pre. Which column on the NOTES view names a person? USER_WHO_CREATED_NOTE lives on the
--        action-logs view, not here — F2 as first written referenced the wrong table.
SELECT COLUMN_NAME, DATA_TYPE
FROM BA_VIEWS.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'HOUSEMAID_MANAGEMENT_SILVER'
  AND TABLE_NAME   = 'HOUSEMAID_MANAGER_NOTES'
ORDER BY ORDINAL_POSITION;

-- F3. BLOCKED 2026-09-08 — SHOW TERSE OBJECTS LIKE '%EXTRA_FIELD%' IN ACCOUNT returns zero
--     rows. HousemaidExtraFields (abuDhabiIncentiveType / abuDhabiIncentiveOffered /
--     lastAbuDhabiIncentiveProcessedDate) is not in the warehouse, so the Abu Dhabi route
--     cannot be confirmed or excluded from data. Same shape as the raffle tables in group F:
--     BLOCKED on a named ingestion, not on a business owner.

-- F1b/F1c RESULTS 2026-09-08 (12 months, 9,167 anti-attrition notes):
--   B1  no enrolment row at all ............ 11
--   B1b by ACTION_DATE ..................... 53   AED 11,419
--   B1b by CREATION_DATE ................... 42   AED  9,019   <- the real number
--   cleared by using the right column ...... 11
--   The 42 are a strict subset of the 53 — the fix clears cases, it creates none.
--   F1c: of 3,757 incentive enrolment rows, 3,632 (96.7%) have ACTION_DATE = CREATION_DATE,
--   121 back-dated (median 18d, max 102), 4 ahead (median 91d, max 204).
--   🔴 USER_WHO_LAST_MODIFIED is populated on 100% of rows in EVERY bucket, same-day included.
--   It is stamped on create, not only on edit — it cannot identify an edited row. Do not
--   build a mutation check on it.

-- F2. Did the 42 come through the batch, or through the manual AAI - 01 expense route?
--     The notes view exposes REQUESTED_BY / APPROVED_BY (TEXT, empty-string sentinels) —
--     USER_WHO_CREATED_NOTE is on the action-logs view, not here.
--     Returns counts against the modal requester without naming anyone: the batch stamps one
--     configured service account on every note, so "modal" IS the batch.
WITH paid AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT, REQUESTED_BY
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), enrol AS (
    SELECT HOUSEMAID_ID, MIN(CREATION_DATE)::DATE AS first_created
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%'
    GROUP BY 1
), flagged AS (
    SELECT p.*, IFF(e.first_created > p.note_day, 1, 0) AS is_b1b,
           NULLIF(TRIM(p.REQUESTED_BY), '') AS req
    FROM paid p LEFT JOIN enrol e ON e.HOUSEMAID_ID = p.HOUSEMAID_ID
), modal AS (
    SELECT req FROM flagged WHERE req IS NOT NULL
    GROUP BY req ORDER BY COUNT(*) DESC LIMIT 1
)
SELECT COUNT(*)                                                       AS all_notes,
       COUNT_IF(f.req = m.req)                                        AS all_from_modal_requester,
       COUNT_IF(f.req IS NULL)                                        AS all_no_requester,
       COUNT(DISTINCT IFF(f.req <> m.req, f.req, NULL))               AS other_requesters_distinct,
       SUM(f.is_b1b)                                                  AS b1b_notes,
       COUNT_IF(f.is_b1b = 1 AND f.req = m.req)                       AS b1b_from_modal_requester,
       COUNT_IF(f.is_b1b = 1 AND f.req IS NOT NULL AND f.req <> m.req) AS b1b_from_other_requester,
       COUNT_IF(f.is_b1b = 1 AND f.req IS NULL)                       AS b1b_no_requester
FROM flagged f CROSS JOIN modal m;

-- F5. The 42 re-characterised against CREATION_DATE. Aggregates only, no identifiers —
--     this replaces the gap profile in the run report, which was measured on ACTION_DATE.
WITH paid AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), enrol AS (
    SELECT HOUSEMAID_ID, MIN(CREATION_DATE)::DATE AS first_created
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%'
    GROUP BY 1
), b1b AS (
    SELECT p.HOUSEMAID_ID, p.AMOUNT,
           DATEDIFF('day', p.note_day, e.first_created) AS gap_days
    FROM paid p JOIN enrol e ON e.HOUSEMAID_ID = p.HOUSEMAID_ID
    WHERE e.first_created > p.note_day
)
SELECT COUNT(*)                        AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)    AS maids,
       ROUND(SUM(AMOUNT))              AS aed,
       MEDIAN(gap_days)                AS median_gap_days,
       MAX(gap_days)                   AS max_gap_days,
       COUNT_IF(gap_days <= 3)         AS within_3_days,
       COUNT_IF(gap_days >= 30)        AS at_least_30_days,
       COUNT_IF(gap_days >= 90)        AS at_least_90_days,
       (SELECT COUNT(*) FROM (SELECT HOUSEMAID_ID FROM b1b GROUP BY 1 HAVING COUNT(*) > 1))
                                       AS maids_paid_more_than_once
FROM b1b;

-- F2/F5 RESULTS 2026-09-08:
--   F2: 9,167 notes — 7,697 from the modal (batch) requester, 2 with none, and 1,468 from
--       28 OTHER distinct requesters. 16% of this "unattended job" type is not the job.
--       Of the 42 B1b notes: 32 from the batch requester, 10 from others, 0 unattributed.
--       Base rate 16.0% other vs 23.8% among B1b — the manual route is ~1.5x enriched but
--       does NOT explain the bulk. The batch made 32 of them itself.
--   F5: 42 notes · 18 maids · AED 9,019 · median gap 41d · max 157d · 2 within 3 days ·
--       28 at >=30 days · 8 at >=90 days · 10 maids paid more than once.
--       Supersedes the ACTION_DATE profile (53 notes / 21 maids / median 49 / max 176).
--
--   🔴 What the 32 mean. Code answer 46015 says the eligibility EXISTS is evaluated once at
--   selection and the note is written two async hops later. That explains paying a maid whose
--   enrolment was removed AFTER selection — and a removal followed by a later re-enrolment is
--   exactly what MIN(CREATION_DATE) > note_day looks like. So the 32 are either
--     (a) the enrolment row was deleted and recreated later  -> the trail IS mutable, or
--     (b) the job paid with no row that ever existed          -> the guard is bypassable.
--   Neither is excludable from the warehouse: deleted rows are gone and
--   USER_WHO_LAST_MODIFIED is always populated. This is the ask-the-code follow-up.

-- F6. Is a SECOND producer visible in the data? Every route reaching one expense code carries
--     one addition reason, so distinct EXPENSE_IDs under this reason = distinct producers.
--     This is the one angle on the Abu Dhabi question that survives F3 being blocked.
WITH paid AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT, REQUESTED_BY, EXPENSE_ID
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), enrol AS (
    SELECT HOUSEMAID_ID, MIN(CREATION_DATE)::DATE AS first_created
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%'
    GROUP BY 1
), flagged AS (
    SELECT p.*, IFF(e.first_created > p.note_day, 1, 0) AS is_b1b,
           NULLIF(TRIM(p.REQUESTED_BY), '') AS req
    FROM paid p LEFT JOIN enrol e ON e.HOUSEMAID_ID = p.HOUSEMAID_ID
), modal AS (
    SELECT req FROM flagged WHERE req IS NOT NULL
    GROUP BY req ORDER BY COUNT(*) DESC LIMIT 1
)
SELECT f.EXPENSE_ID,
       COUNT(*)                                          AS notes,
       ROUND(SUM(f.AMOUNT))                              AS aed,
       COUNT_IF(f.req = m.req)                           AS from_batch_requester,
       COUNT(DISTINCT IFF(f.req <> m.req, f.req, NULL))  AS other_requesters_distinct,
       SUM(f.is_b1b)                                     AS b1b_notes,
       MIN(f.note_day)                                   AS first_note,
       MAX(f.note_day)                                   AS last_note
FROM flagged f CROSS JOIN modal m
GROUP BY f.EXPENSE_ID
ORDER BY notes DESC;

-- F7. Shape of the 1,468 non-batch notes: is it 28 people making one-offs, or a handful of
--     standing alternate routes? Ranked, never named — one row per requester, rank only.
WITH paid AS (
    SELECT ID, NOTE_DATE::DATE AS note_day, AMOUNT, REQUESTED_BY
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), flagged AS (
    SELECT p.*, NULLIF(TRIM(p.REQUESTED_BY), '') AS req FROM paid p
), modal AS (
    SELECT req FROM flagged WHERE req IS NOT NULL
    GROUP BY req ORDER BY COUNT(*) DESC LIMIT 1
)
SELECT ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS requester_rank,
       COUNT(*)                                   AS notes,
       ROUND(SUM(f.AMOUNT))                       AS aed,
       COUNT(DISTINCT DATE_TRUNC('month', f.note_day)) AS months_active,
       MIN(f.note_day)                            AS first_note,
       MAX(f.note_day)                            AS last_note
FROM flagged f CROSS JOIN modal m
WHERE f.req IS NOT NULL AND f.req <> m.req
GROUP BY f.req
ORDER BY notes DESC;

-- F6 VOID / F7 RESULTS 2026-09-08:
--   🔴 F6 was built on a false premise. EXPENSE_ID is the per-expense-request id, ONE PER NOTE:
--   9,166 distinct values across 9,167 notes, 9,165 used exactly once. Grouping by it returns
--   the input. It is NOT an expense category — the dev-spec trap table said otherwise and is
--   corrected. (The run did confirm the type total independently: AED 1,829,743 / 12 months.)
--   F7: the 1,468 non-batch notes are TWO batch-shaped streams plus a tail —
--     #1  931 notes  AED 210,302  4 months  2026-06-27 -> 2026-09-04  (started 10 weeks ago)
--     #2  409 notes  AED  65,862  ONE DAY   2025-09-30 (a month-end)
--     26 others  128 notes  AED 31,295
--   AED 307,459 = 16.8% of the type's money did not come from the job the spec describes.
--   Abu Dhabi is a poor fit for #1: only 11 of 9,167 notes belong to a maid with no
--   Maid_Incentive_Experiment row, so the non-batch notes pay ENROLLED maids.

-- F8. 🔴 Are the 516 duplicate candidates just batch + second-producer in the same month?
--     A maid paid once by the batch and once by another requester inside one month is exactly
--     that shape. Aggregates only.
WITH paid AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT, REQUESTED_BY
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), flagged AS (
    SELECT p.*, NULLIF(TRIM(p.REQUESTED_BY), '') AS req FROM paid p
), modal AS (
    SELECT req FROM flagged WHERE req IS NOT NULL
    GROUP BY req ORDER BY COUNT(*) DESC LIMIT 1
), mm AS (
    SELECT f.HOUSEMAID_ID,
           DATE_TRUNC('month', f.note_day)                          AS mth,
           COUNT_IF(f.req = m.req)                                  AS batch_notes,
           COUNT_IF(f.req IS NOT NULL AND f.req <> m.req)           AS other_notes,
           SUM(f.AMOUNT)                                            AS aed
    FROM flagged f CROSS JOIN modal m
    GROUP BY 1, 2
)
SELECT COUNT(*)                                                          AS maid_months,
       COUNT_IF(batch_notes > 0 AND other_notes > 0)                     AS both_producers_same_month,
       ROUND(SUM(IFF(batch_notes > 0 AND other_notes > 0, aed, 0)))      AS aed_in_those,
       COUNT_IF(batch_notes > 1)                                         AS batch_paid_twice,
       COUNT_IF(other_notes > 1)                                         AS other_paid_twice,
       COUNT_IF(batch_notes + other_notes > 1)                           AS any_multiple
FROM mm;

-- F9. Is producer #1 a job or hand entry? A job lands many notes on few days. Only days
--     carrying 10+ of its notes are returned, so a manual pattern returns almost nothing.
WITH paid AS (
    SELECT ID, NOTE_DATE::DATE AS note_day, AMOUNT, REQUESTED_BY
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), flagged AS (
    SELECT p.*, NULLIF(TRIM(p.REQUESTED_BY), '') AS req FROM paid p
), modal AS (
    SELECT req FROM flagged WHERE req IS NOT NULL
    GROUP BY req ORDER BY COUNT(*) DESC LIMIT 1
), top1 AS (
    SELECT f.req FROM flagged f CROSS JOIN modal m
    WHERE f.req IS NOT NULL AND f.req <> m.req
    GROUP BY f.req ORDER BY COUNT(*) DESC LIMIT 1
)
SELECT f.note_day,
       COUNT(*)              AS notes,
       ROUND(SUM(f.AMOUNT))  AS aed,
       COUNT(DISTINCT f.AMOUNT) AS distinct_amounts
FROM flagged f JOIN top1 t ON f.req = t.req
GROUP BY f.note_day
HAVING COUNT(*) >= 10
ORDER BY f.note_day;

-- F8/F9 RESULTS 2026-09-08 — 🔴 F9 RETRACTS THE "THREE PRODUCERS" READING.
--   F9: 918 of producer #1's 931 notes fell on ONE day, 2026-09-01, AED 206,831, 82 distinct
--   amounts. 2026-09-01 with 918 notes is August's known batch day. Producer #2's 409 notes
--   all fell on 2025-09-30, a month-end. BOTH "producers" are the monthly job running under a
--   different configured requester. REQUESTED_BY identifies a RUN, not a ROUTE.
--   => F2 is void as a batch-vs-manual test; the manual AAI - 01 explanation for the 42 has no
--      evidence behind it, which leaves "the job paid them itself" as the reading.
--   F8: 8,895 maid-months · 81 with two requesters (AED 42,196) · 161 batch-paid-twice ·
--       20 other-paid-twice · 255 carrying more than one note.
--       The 81 are the month-boundary artefact: August's run (2026-09-01) and September's run
--       share calendar September. 255 maid-months at ~2 notes each reconciles the 516 notes
--       reported earlier — the discrepancy was grain, as suspected.

-- F10. The duplicate rule rebuilt on the batch cycle instead of the calendar month.
--      Gap histogram between consecutive payments to the same maid. The true cycle is 28-32
--      days; <=1 day is one run counted twice, and anything under ~20 days is a real duplicate.
WITH paid AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE::DATE AS note_day, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Anti-attrition Incentive'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), seq AS (
    SELECT HOUSEMAID_ID, note_day, AMOUNT,
           DATEDIFF('day',
                    LAG(note_day) OVER (PARTITION BY HOUSEMAID_ID ORDER BY note_day, ID),
                    note_day) AS gap_days
    FROM paid
)
SELECT CASE
         WHEN gap_days IS NULL  THEN 'first payment to this maid'
         WHEN gap_days = 0      THEN 'same day  - one run counted twice'
         WHEN gap_days <= 7     THEN '1-7 days  - duplicate'
         WHEN gap_days <= 20    THEN '8-20 days - duplicate'
         WHEN gap_days <= 27    THEN '21-27 days - short cycle'
         WHEN gap_days <= 34    THEN '28-34 days - the normal cycle'
         ELSE                        '35+ days  - a gap in payments'
       END                   AS bucket,
       COUNT(*)              AS notes,
       COUNT(DISTINCT HOUSEMAID_ID) AS maids,
       ROUND(SUM(AMOUNT))    AS aed
FROM seq
GROUP BY 1
ORDER BY notes DESC;
