-- =====================================================================================
-- PHASE 1 VERIFICATION PACK
-- Four checks that produce REAL findings on granted columns, no new ingestion.
-- Written 2026-09-08 from the code + data work. Ordered by value.
-- =====================================================================================


-- =====================================================================================
-- 1. S1 — SEGREGATION OF DUTIES. The cheapest real finding in the audit.
--    Catches the AED 8,800 salary dispute that was requested and approved by one person.
--    ⚠️ Only meaningful where a HUMAN is the requester. Machine types (airfare, raffle,
--       prorated, forgive, office work, last-day CC) have a null/service requester by
--       design and must be EXCLUDED, or this manufactures thousands of false findings.
-- =====================================================================================
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT,
           COALESCE(REASON,'(none)')      AS payment_type,
           NULLIF(TRIM(REQUESTED_BY),'')  AS requester,
           NULLIF(TRIM(APPROVED_BY),'')   AS approver
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), human AS (        -- types the code says are human-entered
    SELECT * FROM n WHERE payment_type IN (
      'Salary Dispute','Bonus','Taxi Reimbursement','Medical Assistance',
      'Maids.at other expenses','Accommodation Relocation','VIP Bonus',
      'Passport Assistance','Lost Luggage Compensation','MOHRE requirement additions')
)
SELECT payment_type,
       COUNT(*)                                                      AS notes,
       ROUND(SUM(AMOUNT))                                            AS aed,
       COUNT_IF(LOWER(requester) = LOWER(approver))                  AS self_approved,
       ROUND(SUM(IFF(LOWER(requester)=LOWER(approver), AMOUNT, 0)))  AS aed_self_approved,
       COUNT_IF(requester IS NULL AND approver IS NULL)              AS neither_recorded,
       ROUND(SUM(IFF(requester IS NULL AND approver IS NULL, AMOUNT, 0))) AS aed_neither,
       COUNT_IF(approver IS NULL AND requester IS NOT NULL)          AS raised_never_approved,
       ROUND(SUM(IFF(approver IS NULL AND requester IS NOT NULL, AMOUNT,0))) AS aed_unapproved
FROM human GROUP BY 1 ORDER BY aed_self_approved DESC;

-- 1b. The row list — every self-approved or unattributed human-entered payment, worst first.
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT, COALESCE(REASON,'(none)') AS payment_type,
           NULLIF(TRIM(REQUESTED_BY),'') AS requester, NULLIF(TRIM(APPROVED_BY),'') AS approver
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION' AND AMOUNT > 0
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
)
SELECT ID AS note_id, payment_type, HOUSEMAID_ID AS maid_id, NOTE_DATE::DATE AS d, AMOUNT,
       requester, approver,
       CASE WHEN LOWER(requester)=LOWER(approver)          THEN 'SELF-APPROVED'
            WHEN requester IS NULL AND approver IS NULL     THEN 'NEITHER RECORDED'
            ELSE 'RAISED, NEVER APPROVED' END AS finding
FROM n
WHERE payment_type IN ('Salary Dispute','Bonus','Taxi Reimbursement','Medical Assistance',
      'Maids.at other expenses','Accommodation Relocation','VIP Bonus','Passport Assistance',
      'Lost Luggage Compensation','MOHRE requirement additions')
  AND (LOWER(requester)=LOWER(approver) OR approver IS NULL)
ORDER BY AMOUNT DESC LIMIT 300;


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
