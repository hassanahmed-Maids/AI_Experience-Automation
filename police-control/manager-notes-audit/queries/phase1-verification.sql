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
