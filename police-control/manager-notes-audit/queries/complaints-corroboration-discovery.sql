-- =====================================================================================
-- COMPLAINTS AS THE CORROBORATION LAYER
-- Discovery pack. Run in order; each answers a question the design needs before any
-- check can be written.
--
-- SOURCES (all already granted)
--   BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS
--       ID, CLIENT_ID, HOUSEMAID_ID, CONTRACT_ID, STATUS (Resolved/NotResolved/Closed),
--       COMPLAINT_TYPE, COMPLAINT_TYPE_ID (1-424), CREATION_DATE, RESOLUTION_DATE,
--       COMPLAINT_DESCRIPTION, ASSIGNEE, ASSIGNED_TEAM, CREATOR, CREATOR_TEAM,
--       IS_SNOOZED, GPT_SUMMARY
--   BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINT_COMMENTS
--       COMPLAINT_ID, CREATION_DATE, TEXT (html-stripped), ORIGINAL_TEXT, CREATOR,
--       TEAM, IS_LAST, ITERATION (1-315)
--   BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINT_ACTION_LOGS
--   BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
--
-- ⚠️ COMPLAINT_DESCRIPTION, GPT_SUMMARY and COMMENT TEXT contain personal information
--    about named individuals. Keep them inside the warehouse and inside the agent.
--    Do not export them, paste them into chat, or put them on a dashboard.
--
-- ⚠️ No foreign key from a manager note to a complaint is assumed. Every join below is
--    HOUSEMAID_ID + a time window, which is a HEURISTIC. Query 3 measures how good it is.
-- =====================================================================================


-- =====================================================================================
-- 1. THE TAXONOMY. Which of the 424 complaint types are housemaid-side, and how big?
--    Output: the vocabulary every later check depends on.
-- =====================================================================================
SELECT
    c.COMPLAINT_TYPE_ID,
    c.COMPLAINT_TYPE,
    c.CREATOR_TEAM,
    c.ASSIGNED_TEAM,
    COUNT(*)                                              AS complaints_all_time,
    COUNT_IF(c.CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())) AS complaints_12m,
    COUNT(DISTINCT c.HOUSEMAID_ID)                        AS distinct_maids,
    ROUND(100.0*COUNT_IF(c.HOUSEMAID_ID IS NOT NULL)/COUNT(*))       AS pct_with_maid,
    ROUND(100.0*COUNT_IF(c.CLIENT_ID    IS NOT NULL)/COUNT(*))       AS pct_with_client,
    MIN(c.CREATION_DATE)::DATE                            AS first_seen,
    MAX(c.CREATION_DATE)::DATE                            AS last_seen,
    ROUND(100.0*COUNT_IF(c.STATUS='Resolved')/COUNT(*))   AS pct_resolved
FROM BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
WHERE c.HOUSEMAID_ID IS NOT NULL
GROUP BY 1,2,3,4
HAVING COUNT_IF(c.CREATION_DATE >= DATEADD('month',-12,CURRENT_DATE())) > 0
ORDER BY complaints_12m DESC;

-- 1b. Keyword sweep over type names — find the retention / salary / transport families
--     without knowing the vocabulary in advance.
SELECT COMPLAINT_TYPE_ID, COMPLAINT_TYPE, COUNT(*) AS n,
       COUNT(DISTINCT HOUSEMAID_ID) AS maids, MAX(CREATION_DATE)::DATE AS last_seen,
       CASE
         WHEN COMPLAINT_TYPE ILIKE ANY ('%resign%','%leave%','%quit%','%attrition%',
              '%retention%','%retract%','%terminat%','%exit%','%abscond%') THEN 'LEAVING'
         WHEN COMPLAINT_TYPE ILIKE ANY ('%salary%','%pay%','%wage%','%wps%','%deduct%') THEN 'PAY'
         WHEN COMPLAINT_TYPE ILIKE ANY ('%taxi%','%transport%','%relocat%','%accommodat%') THEN 'TRANSPORT/HOUSING'
         WHEN COMPLAINT_TYPE ILIKE ANY ('%medical%','%health%','%sick%','%doctor%','%hospital%') THEN 'MEDICAL'
         WHEN COMPLAINT_TYPE ILIKE ANY ('%vacation%','%ticket%','%flight%','%airfare%','%travel%') THEN 'VACATION/TRAVEL'
         WHEN COMPLAINT_TYPE ILIKE ANY ('%refer%','%bonus%','%incentive%') THEN 'REFERRAL/BONUS'
         WHEN COMPLAINT_TYPE ILIKE ANY ('%luggage%','%passport%','%document%','%eid%') THEN 'PROPERTY/DOCS'
         ELSE 'other'
       END AS family
FROM BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS
WHERE HOUSEMAID_ID IS NOT NULL
  AND CREATION_DATE >= DATEADD('month',-18,CURRENT_DATE())
GROUP BY 1,2 ORDER BY family, n DESC;


-- =====================================================================================
-- 2. CO-OCCURRENCE. For each payment type, which complaint types appear around it?
--    This is the empirical answer to "what conversation precedes this payment".
--    Window: complaint opened up to 90 days BEFORE the note, or 14 days AFTER.
-- =====================================================================================
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT,
           COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE BETWEEN DATEADD('month',-12,CURRENT_DATE()) AND CURRENT_DATE()
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
)
SELECT n.payment_type,
       c.COMPLAINT_TYPE,
       COUNT(DISTINCT n.ID)                    AS notes_with_this_complaint_type,
       COUNT(DISTINCT c.ID)                    AS complaints,
       ROUND(AVG(DATEDIFF('day', c.CREATION_DATE, n.NOTE_DATE)),1) AS avg_days_complaint_before_note,
       ROUND(SUM(n.AMOUNT))                    AS aed
FROM n
JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
  ON c.HOUSEMAID_ID = n.HOUSEMAID_ID
 AND c.CREATION_DATE BETWEEN DATEADD('day',-90,n.NOTE_DATE) AND DATEADD('day',14,n.NOTE_DATE)
GROUP BY 1,2
QUALIFY ROW_NUMBER() OVER (PARTITION BY n.payment_type
                           ORDER BY notes_with_this_complaint_type DESC) <= 12
ORDER BY n.payment_type, notes_with_this_complaint_type DESC;


-- =====================================================================================
-- 3. COVERAGE. What share of each payment type has ANY complaint in the window?
--    Decides whether a complaint check can ever be a RED, or only ever an AMBER.
--    A type at 5% coverage cannot require a complaint; a type at 90% can.
-- =====================================================================================
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT,
           COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE BETWEEN DATEADD('month',-12,CURRENT_DATE()) AND CURRENT_DATE()
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE) = 1
), j AS (
    SELECT n.payment_type, n.ID, n.AMOUNT,
           COUNT(c.ID)                                       AS complaints_in_window,
           COUNT_IF(c.CREATION_DATE <= n.NOTE_DATE)          AS complaints_before,
           MIN(DATEDIFF('day', c.CREATION_DATE, n.NOTE_DATE)) AS days_nearest
    FROM n
    LEFT JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
      ON c.HOUSEMAID_ID = n.HOUSEMAID_ID
     AND c.CREATION_DATE BETWEEN DATEADD('day',-90,n.NOTE_DATE) AND DATEADD('day',14,n.NOTE_DATE)
    GROUP BY 1,2,3
)
SELECT payment_type,
       COUNT(*)                                          AS notes,
       ROUND(SUM(AMOUNT))                                AS aed,
       COUNT_IF(complaints_in_window > 0)                AS notes_with_a_complaint,
       ROUND(100.0*COUNT_IF(complaints_in_window>0)/COUNT(*))  AS pct_covered,
       ROUND(100.0*COUNT_IF(complaints_before  >0)/COUNT(*))   AS pct_complaint_came_first,
       ROUND(AVG(complaints_in_window),2)                AS avg_complaints_per_note,
       ROUND(SUM(IFF(complaints_in_window=0, AMOUNT, 0))) AS aed_with_no_complaint
FROM j GROUP BY 1 ORDER BY aed DESC;


-- =====================================================================================
-- 4. THE ANTI-ATTRITION TEST CASE.
--    Business logic: a maid enrolled in a retention incentive should have a
--    conversation on record saying she wanted to leave, and WHY. Does she?
--    Enrolment lives in HOUSEMAID_MANAGERACTIONLOGS (ACTION_TYPE ~ incentive experiment).
-- =====================================================================================
WITH enrol AS (
    SELECT HOUSEMAID_ID, MIN(ACTION_DATE) AS enrolled_on, MAX(NOTES) AS enrolment_note
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%'     -- confirm exact picklist NAME from query 1
    GROUP BY 1
), paid AS (
    SELECT HOUSEMAID_ID, MIN(NOTE_DATE) AS first_paid, COUNT(*) AS payments, SUM(AMOUNT) AS aed
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION' AND REASON = 'Anti-attrition Incentive'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
), agg AS (
  SELECT p.HOUSEMAID_ID, e.enrolled_on, p.first_paid, p.payments, p.aed,
         COUNT(c.ID) AS complaints_90d_before_enrolment,
         ARRAY_AGG(DISTINCT c.COMPLAINT_TYPE) AS complaint_types
  FROM paid p
  LEFT JOIN enrol e ON e.HOUSEMAID_ID = p.HOUSEMAID_ID
  LEFT JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
         ON c.HOUSEMAID_ID = p.HOUSEMAID_ID
        AND c.CREATION_DATE BETWEEN DATEADD('day',-90, COALESCE(e.enrolled_on,p.first_paid))
                                AND COALESCE(e.enrolled_on,p.first_paid)
  GROUP BY 1,2,3,4,5
)
SELECT
    COUNT(*)                                        AS maids_paid,
    COUNT_IF(enrolled_on IS NULL)                   AS paid_but_NO_ENROLMENT_RECORD,
    COUNT_IF(complaints_90d_before_enrolment = 0)   AS enrolled_with_NO_CONVERSATION,
    ROUND(100.0*COUNT_IF(complaints_90d_before_enrolment=0)/COUNT(*)) AS pct_no_conversation,
    ROUND(SUM(IFF(complaints_90d_before_enrolment=0, aed, 0)))        AS aed_with_no_conversation
FROM agg;

-- 4b. The row-level list behind it — the agent's work queue for anti-attrition.
--     (Same CTEs; add complaint_types and enrolment_note to eyeball the reasons.)


-- =====================================================================================
-- 5. IS THERE A HARD LINK? Look for a complaint id written into the note free text.
--    The notes carry "todo;NNNNNN" and "comp;NNNNNN" fragments — if "comp" is a
--    complaint id this becomes an exact join instead of a heuristic.
-- =====================================================================================
SELECT
    COALESCE(REASON,'(none)') AS payment_type,
    COUNT(*)                                                          AS notes,
    COUNT_IF(NOTE_REASON ILIKE '%comp;%')                             AS has_comp_ref,
    COUNT_IF(NOTE_REASON ILIKE '%todo;%')                             AS has_todo_ref,
    COUNT_IF(NOTE_REASON ILIKE '%complaint%')                         AS mentions_complaint,
    COUNT_IF(NOTE_REASON ILIKE '%open-complaint/%')                   AS has_open_complaint_url,
    MAX(IFF(NOTE_REASON ILIKE '%comp;%',
        REGEXP_SUBSTR(NOTE_REASON,'comp;[0-9]+'), NULL))              AS sample_comp_ref
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE='ADDITION'
  AND NOTE_DATE >= DATEADD('month',-12,CURRENT_DATE())
GROUP BY 1 HAVING COUNT(*) > 20 ORDER BY has_comp_ref DESC;

-- 5b. If 5 shows "comp;" references, test whether they resolve to real complaint ids.
SELECT COUNT(*) AS notes_with_ref,
       COUNT(c.ID) AS refs_that_matched_a_complaint,
       COUNT_IF(c.HOUSEMAID_ID = n.HOUSEMAID_ID) AS matched_AND_same_maid
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
       ON c.ID = TRY_TO_NUMBER(REGEXP_SUBSTR(n.NOTE_REASON,'comp;([0-9]+)',1,1,'e',1))
WHERE n.NOTE_TYPE='ADDITION' AND n.NOTE_REASON ILIKE '%comp;%'
  AND n.NOTE_DATE >= DATEADD('month',-12,CURRENT_DATE());



-- =====================================================================================
-- 6. THE CORROBORATION SCORE — the executable form of the §3d rule.
--
-- ⚠️ SUPERSEDES the original query 6, which joined note × complaint and returned
--    32,247 rows for a 3-month, 2-type window. That was not a bug in the data: query 3
--    measured 10.32 complaints/note for anti-attrition and 13.29 for salary dispute, so
--    ~2,570 notes fan out to ~32k pairs exactly as predicted. A LIMIT would not fix it —
--    it would truncate a maid's complaint list mid-way and hand the agent a queue that
--    silently drops the evidence it is supposed to weigh.
--
-- The fix is to score inside the warehouse instead of exporting the join. §3d says the
-- test is TYPE-MATCH + TIMING, normalised per maid — all three collapse to one row per
-- note. 6a is the distribution (paste-able), 6b is the ranked queue (no free text),
-- 6c is the single-note detail and is the ONLY place personal text appears.
-- =====================================================================================

-- ---------------------------------------------------------------------------------
-- THE CORROBORATION MAP, as data. §4's table in machine-readable form.
-- Paste this CTE at the top of 6a / 6b / 6c. Extend it to the other 12 types by
-- adding rows — nothing downstream changes.
-- Anti-attrition EXCLUDES 257 MV Retention: CC-only payment, so an MV-retention
-- complaint behind it is a contradiction, not a corroboration (§4).
-- ---------------------------------------------------------------------------------
--   WITH map AS (
--       SELECT * FROM VALUES
--         ('Anti-attrition Incentive', 24),('Anti-attrition Incentive',154),
--         ('Anti-attrition Incentive',137),('Anti-attrition Incentive', 38),
--         ('Anti-attrition Incentive', 88),('Anti-attrition Incentive',426),
--         ('Anti-attrition Incentive',284),
--         ('Salary Dispute',193),('Salary Dispute',320),('Salary Dispute',322),
--         ('Salary Dispute',321),('Salary Dispute',330),('Salary Dispute', 77),
--         ('Salary Dispute',323),('Salary Dispute',156),('Salary Dispute',420)
--       AS t(payment_type, complaint_type_id)
--   )


-- =====================================================================================
-- 6a. THE DISTRIBUTION. ~8 rows. This is the one to run first and paste back — it sets
--     the verdict thresholds and says whether a work queue is even worth building.
--     Bands come straight from §3d: under ~15 days is a real link, ~30+ is the 90-day
--     window talking to itself.
-- =====================================================================================
WITH map AS (
    SELECT * FROM VALUES
      ('Anti-attrition Incentive', 24),('Anti-attrition Incentive',154),
      ('Anti-attrition Incentive',137),('Anti-attrition Incentive', 38),
      ('Anti-attrition Incentive', 88),('Anti-attrition Incentive',426),
      ('Anti-attrition Incentive',284),
      ('Salary Dispute',193),('Salary Dispute',320),('Salary Dispute',322),
      ('Salary Dispute',321),('Salary Dispute',330),('Salary Dispute', 77),
      ('Salary Dispute',323),('Salary Dispute',156),('Salary Dispute',420)
    AS t(payment_type, complaint_type_id)
), n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT,
           COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION'
      AND REASON IN ('Anti-attrition Incentive','Salary Dispute')
      AND NOTE_DATE BETWEEN DATEADD('month',-3,CURRENT_DATE()) AND CURRENT_DATE()
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
-- scored: ONE row per note. The fan-out is collapsed here, by aggregation, not by LIMIT.
), scored AS (
    SELECT n.ID, n.payment_type, n.AMOUNT,
           COUNT(c.ID)                                              AS complaints_any,
           COUNT_IF(m.complaint_type_id IS NOT NULL)                AS complaints_expected,
           MIN(IFF(m.complaint_type_id IS NOT NULL,
                   ABS(DATEDIFF('day', c.CREATION_DATE, n.NOTE_DATE)), NULL)) AS days_apart_nearest
    FROM n
    LEFT JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
           ON c.HOUSEMAID_ID = n.HOUSEMAID_ID
          AND c.CREATION_DATE BETWEEN DATEADD('day',-90,n.NOTE_DATE)
                                  AND DATEADD('day', 14,n.NOTE_DATE)
    LEFT JOIN map m
           ON m.payment_type = n.payment_type
          AND m.complaint_type_id = c.COMPLAINT_TYPE_ID
    GROUP BY 1,2,3
), banded AS (
    SELECT payment_type, AMOUNT,
           -- per-maid normalisation (§3d): a maid with 40 open complaints matches any
           -- type by chance, so the raw match is meaningless without this ratio.
           IFF(complaints_any=0, NULL,
               ROUND(complaints_expected/NULLIF(complaints_any,0),3))  AS specificity,
           CASE
             WHEN complaints_any = 0                       THEN '4_NO_COMPLAINT_AT_ALL'
             WHEN complaints_expected = 0                  THEN '3_NO_TYPE_MATCH'
             WHEN days_apart_nearest <= 15                 THEN '1_CORROBORATED_coupled'
             ELSE                                               '2_TYPE_MATCH_but_window_noise'
           END AS band
    FROM scored
)
SELECT payment_type, band,
       COUNT(*)                                            AS notes,
       ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (PARTITION BY payment_type)) AS pct_of_type,
       ROUND(SUM(AMOUNT))                                  AS aed,
       ROUND(AVG(specificity),3)                           AS avg_specificity
FROM banded
GROUP BY 1,2 ORDER BY payment_type, band;


-- =====================================================================================
-- 6a-iii. THE CHANCE BASELINE — 2 rows, and the decisive one.
--     A note's window spans signed day -14..+90 (105 days); band 1 is the 30 days
--     -14..+15. So ONE complaint lands in band 1 with p = 30/105 = 0.286 by geometry
--     alone, and a note with k expected-type complaints does so at 1-(1-p)^k.
--     Comparing observed band-1 share against that per-note chance rate is the test.
--     §3f estimated k from cohort averages; this measures it per note.
--     Result to date: salary dispute 1.46x chance, anti-attrition 0.89x.
-- =====================================================================================
WITH map AS (
    SELECT * FROM VALUES
      ('Anti-attrition Incentive', 24),('Anti-attrition Incentive',154),
      ('Anti-attrition Incentive',137),('Anti-attrition Incentive', 38),
      ('Anti-attrition Incentive', 88),('Anti-attrition Incentive',426),
      ('Anti-attrition Incentive',284),
      ('Salary Dispute',193),('Salary Dispute',320),('Salary Dispute',322),
      ('Salary Dispute',321),('Salary Dispute',330),('Salary Dispute', 77),
      ('Salary Dispute',323),('Salary Dispute',156),('Salary Dispute',420)
    AS t(payment_type, complaint_type_id)
), n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT,
           COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION'
      AND REASON IN ('Anti-attrition Incentive','Salary Dispute')
      AND NOTE_DATE BETWEEN DATEADD('month',-3,CURRENT_DATE()) AND CURRENT_DATE()
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
), matched AS (      -- INNER joins: only notes that HAVE an expected-type complaint
    SELECT n.ID, n.payment_type,
           COUNT(*)                                                  AS k,
           MIN(ABS(DATEDIFF('day', c.CREATION_DATE, n.NOTE_DATE)))   AS days_apart
    FROM n
    JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
      ON c.HOUSEMAID_ID = n.HOUSEMAID_ID
     AND c.CREATION_DATE BETWEEN DATEADD('day',-90,n.NOTE_DATE)
                             AND DATEADD('day', 14,n.NOTE_DATE)
    JOIN map m
      ON m.payment_type = n.payment_type
     AND m.complaint_type_id = c.COMPLAINT_TYPE_ID
    GROUP BY 1,2
)
SELECT payment_type,
       COUNT(*)                                                   AS notes_type_matched,
       ROUND(AVG(k),2)                                            AS avg_k,
       ROUND(100.0*COUNT_IF(days_apart <= 15)/COUNT(*),1)         AS observed_band1_pct,
       ROUND(100.0*AVG(1 - POWER(1 - 30.0/105.0, k)),1)           AS chance_band1_pct,
       ROUND( (1.0*COUNT_IF(days_apart <= 15)/COUNT(*))
              / NULLIF(AVG(1 - POWER(1 - 30.0/105.0, k)),0), 2)   AS lift_over_chance
FROM matched GROUP BY 1 ORDER BY 1;


-- =====================================================================================
-- 6a-ii. ARRIVAL SHAPE — ~14 rows. Every expected-type complaint (not just the nearest),
--     binned by SIGNED distance so each bin is an equal 15 days. Under a null the bins
--     are FLAT: the complaint stream is uniform and the note date means nothing. A real
--     driver spikes in the 0..14 bin. This is §3c's 30.8-day result at note grain.
-- =====================================================================================
WITH map AS (
    SELECT * FROM VALUES
      ('Anti-attrition Incentive', 24),('Anti-attrition Incentive',154),
      ('Anti-attrition Incentive',137),('Anti-attrition Incentive', 38),
      ('Anti-attrition Incentive', 88),('Anti-attrition Incentive',426),
      ('Anti-attrition Incentive',284),
      ('Salary Dispute',193),('Salary Dispute',320),('Salary Dispute',322),
      ('Salary Dispute',321),('Salary Dispute',330),('Salary Dispute', 77),
      ('Salary Dispute',323),('Salary Dispute',156),('Salary Dispute',420)
    AS t(payment_type, complaint_type_id)
), n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT,
           COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION'
      AND REASON IN ('Anti-attrition Incentive','Salary Dispute')
      AND NOTE_DATE BETWEEN DATEADD('month',-3,CURRENT_DATE()) AND CURRENT_DATE()
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
)
SELECT n.payment_type,
       FLOOR(DATEDIFF('day', c.CREATION_DATE, n.NOTE_DATE)/15.0)*15 AS bin_start_days_before,
       COUNT(*)                                                     AS complaints,
       ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (PARTITION BY n.payment_type),1) AS pct_of_type
FROM n
JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
  ON c.HOUSEMAID_ID = n.HOUSEMAID_ID
 AND c.CREATION_DATE BETWEEN DATEADD('day',-90,n.NOTE_DATE) AND DATEADD('day',14,n.NOTE_DATE)
JOIN map m
  ON m.payment_type = n.payment_type
 AND m.complaint_type_id = c.COMPLAINT_TYPE_ID
GROUP BY 1,2 ORDER BY 1,2;
-- Edge bins (-15 and 90) are partial by construction — read the middle five.


-- =====================================================================================
-- 6b. THE WORK QUEUE — SELF-CONTAINED. Do not assemble this from other blocks; the
--     payment-type filter lives in n and dropping it silently widens the queue to all
--     14 live types (observed 2026-09-08: a queue run this way returned Airfare Ticket,
--     MV Prorated Salary, Raffle Prize and Bonus, none of which are in scope here).
--
--     ⚠️ FIXED 2026-09-08: the previous version joined COMPLAINTS a SECOND time in the
--     final SELECT with no date predicate, so the complaint-type list showed the maid's
--     ENTIRE history rather than the 104-day window. Symptom: notes with
--     complaints_any = 1 listing six complaint types. The LISTAGG now lives in w, beside
--     the windowed join, and cannot drift from the counts again.
--
--     Filtered to band 3 (complaints present, none of the expected type). For
--     ANTI-ATTRITION this is a Job-1 queue, NOT a finding list: §3g measured the
--     complaint test at 1.00x chance there, so absence means nothing and the verdict is
--     N_A. For SALARY DISPUTE (2.33x) an absent expected complaint is a real AMBER.
-- =====================================================================================
WITH map AS (
    SELECT * FROM VALUES
      ('Anti-attrition Incentive', 24),('Anti-attrition Incentive',154),
      ('Anti-attrition Incentive',137),('Anti-attrition Incentive', 38),
      ('Anti-attrition Incentive', 88),('Anti-attrition Incentive',426),
      ('Anti-attrition Incentive',284),
      ('Salary Dispute',193),('Salary Dispute',320),('Salary Dispute',322),
      ('Salary Dispute',321),('Salary Dispute',330),('Salary Dispute', 77),
      ('Salary Dispute',323),('Salary Dispute',156),('Salary Dispute',420)
    AS t(payment_type, complaint_type_id)
), n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT,
           COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION'
      AND REASON IN ('Anti-attrition Incentive','Salary Dispute')   -- <<< do not drop
      AND NOTE_DATE BETWEEN DATEADD('month',-3,CURRENT_DATE()) AND CURRENT_DATE()
      AND NOTE_DATE <= DATEADD('day',-14,CURRENT_DATE())  -- §3f: forward window elapsed
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
), w AS (       -- ONE row per note. Counts AND the type list share the windowed join.
    SELECT n.ID, n.payment_type, n.HOUSEMAID_ID, n.NOTE_DATE, n.AMOUNT,
           COUNT(c.ID)                                            AS complaints_any,
           COUNT_IF(m.complaint_type_id IS NOT NULL)              AS complaints_expected,
           LEFT(LISTAGG(DISTINCT c.COMPLAINT_TYPE, ' | '), 200)   AS types_in_window
    FROM n
    LEFT JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
           ON c.HOUSEMAID_ID = n.HOUSEMAID_ID
          AND c.CREATION_DATE BETWEEN DATEADD('day',-90,n.NOTE_DATE)
                                  AND DATEADD('day', 14,n.NOTE_DATE)
    LEFT JOIN map m
           ON m.payment_type = n.payment_type
          AND m.complaint_type_id = c.COMPLAINT_TYPE_ID
    GROUP BY 1,2,3,4,5
), enrol AS (
    SELECT HOUSEMAID_ID, MIN(ACTION_DATE) AS enrolled_on
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
    WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%'   -- picklist name still UNCONFIRMED
    GROUP BY 1
)
SELECT w.ID                AS note_id,
       w.payment_type,
       w.HOUSEMAID_ID      AS maid_id,
       w.NOTE_DATE::DATE   AS note_date,
       w.AMOUNT,
       w.complaints_any,
       w.types_in_window,                     -- taxonomy names only, no personal text
       -- enrolment is an anti-attrition concept; NULL elsewhere rather than false noise
       IFF(w.payment_type <> 'Anti-attrition Incentive', NULL,
           CASE WHEN e.enrolled_on IS NULL           THEN 'NO_ENROLMENT_RECORD'
                WHEN e.enrolled_on > w.NOTE_DATE     THEN 'ENROLLED_AFTER_PAYMENT'
                ELSE 'enrolled' END)          AS enrolment_check,
       CASE
         WHEN w.payment_type = 'Anti-attrition Incentive' AND e.enrolled_on IS NULL
              THEN 'RED_no_enrolment_record'
         WHEN w.payment_type = 'Anti-attrition Incentive' AND e.enrolled_on > w.NOTE_DATE
              THEN 'RED_enrolled_after_payment'
         WHEN w.payment_type = 'Anti-attrition Incentive'
              THEN 'JOB1_read_enrolment_notes (complaint test is N_A here)'
         ELSE 'AMBER_expected_complaint_absent'
       END AS action
FROM w
LEFT JOIN enrol e ON e.HOUSEMAID_ID = w.HOUSEMAID_ID
WHERE w.complaints_any > 0 AND w.complaints_expected = 0
ORDER BY w.AMOUNT DESC
LIMIT 300;


-- =====================================================================================
-- 6c. THE DETAIL FETCH — one note at a time, by note_id from 6b.
--     ⚠️ THE ONLY QUERY HERE THAT RETURNS PERSONAL TEXT. It goes to the agent inside
--        the warehouse session. Never exported, never pasted into chat, never put on a
--        dashboard, never mailed. §5: the agent reads it, the audit republishes a
--        verdict, a category and a complaint id — nothing else.
--     Per §5, GPT_SUMMARY is gpt-4.1-nano at temperature 0.9 — triage only. Anything
--     that becomes a finding must be read from COMPLAINT_COMMENTS.TEXT / DESCRIPTION.
-- =====================================================================================
SET note_id = 0;   -- <<< set from 6b

WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT, NOTE_REASON,
           COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE ID = $note_id
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
)
SELECT
    n.ID AS note_id, n.payment_type, n.NOTE_DATE::DATE AS note_date, n.AMOUNT,
    n.NOTE_REASON,                       -- the reviewer's own working (Job 2, §5)
    c.ID AS complaint_id, c.COMPLAINT_TYPE, c.STATUS, c.ASSIGNED_TEAM,
    c.CREATION_DATE::DATE AS complaint_opened,
    DATEDIFF('day', c.CREATION_DATE, n.NOTE_DATE) AS days_before_note,
    c.GPT_SUMMARY,                       -- triage only — temperature 0.9, not evidence
    c.COMPLAINT_DESCRIPTION,
    (SELECT LISTAGG(cc.TEXT, E'\n---\n') WITHIN GROUP (ORDER BY cc.ITERATION)
     FROM BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINT_COMMENTS cc
     WHERE cc.COMPLAINT_ID = c.ID AND cc.ITERATION <= 20) AS conversation
FROM n
LEFT JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
       ON c.HOUSEMAID_ID = n.HOUSEMAID_ID
      AND c.CREATION_DATE BETWEEN DATEADD('day',-90,n.NOTE_DATE)
                              AND DATEADD('day', 14,n.NOTE_DATE)
ORDER BY days_before_note;

-- 6c-i. For anti-attrition, the PRIMARY evidence is not a complaint at all (§3): it is
--       the free-text enrolment box. Fetch it alongside 6c. Same privacy rule.
SELECT HOUSEMAID_ID, ACTION_DATE::DATE AS enrolled_on, ACTION_TYPE, NOTES
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGERACTIONLOGS
WHERE ACTION_TYPE ILIKE '%Incentive%Experiment%'
  AND HOUSEMAID_ID = (SELECT HOUSEMAID_ID
                      FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
                      WHERE ID = $note_id LIMIT 1)
ORDER BY ACTION_DATE;


-- =====================================================================================
-- 6d. ANTI-ATTRITION AMOUNT SHAPE — tier, day-prorated, or unexplained (§3i).
--     SELF-CONTAINED. ~4 rows + a small tail.
--
--     The band-3 queue showed 373.33 and 361.29 in the same population: 11,200/30 and
--     11,200/31 — the same monthly figure divided by the actual length of each month.
--     11,200 is salary-scale, not incentive-scale (tiers run 300-500), so a subset of
--     notes filed as Anti-attrition Incentive is a DAY OF SALARY, not an incentive.
--
--     A MIX inside one payment type means two mechanisms share one payment reason. Until
--     this is split, B4/B5 (recompute / allowed-amount) cannot be written as a tier
--     check, even once INCENTIVE_AMOUNT is exposed under O23.
-- =====================================================================================
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION'
      AND REASON = 'Anti-attrition Incentive'        -- <<< do not drop
      AND NOTE_DATE >= DATEADD('month',-12,CURRENT_DATE())
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
), shaped AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT,
           DAY(LAST_DAY(NOTE_DATE))            AS days_in_month,
           AMOUNT * DAY(LAST_DAY(NOTE_DATE))   AS implied_monthly,
           CASE
             WHEN AMOUNT = ROUND(AMOUNT) AND MOD(AMOUNT, 50) = 0
                  THEN '1_TIER_round'
             -- a day of a round monthly figure, divided by THIS month's length
             WHEN ABS(AMOUNT*DAY(LAST_DAY(NOTE_DATE))
                      - ROUND(AMOUNT*DAY(LAST_DAY(NOTE_DATE)))) < 0.5
              AND MOD(ROUND(AMOUNT*DAY(LAST_DAY(NOTE_DATE))), 50) = 0
                  THEN '2_DAY_PRORATED'
             ELSE '3_UNEXPLAINED'
           END AS shape
    FROM n
)
SELECT shape,
       COUNT(*)                          AS notes,
       ROUND(SUM(AMOUNT))                AS aed,
       ROUND(MIN(AMOUNT),2)              AS min_amt,
       ROUND(MAX(AMOUNT),2)              AS max_amt,
       ROUND(MEDIAN(implied_monthly))    AS median_implied_monthly,
       COUNT(DISTINCT HOUSEMAID_ID)      AS maids
FROM shaped GROUP BY 1 ORDER BY 1;

-- 6d-ii. The distinct day-prorated monthly figures — salary-scale confirms the split.
--        Run only if 6d shows a material 2_DAY_PRORATED bucket.
--        Same CTEs; final SELECT:
--   SELECT ROUND(implied_monthly) AS implied_monthly, COUNT(*) AS notes,
--          ROUND(SUM(AMOUNT)) AS aed, COUNT(DISTINCT HOUSEMAID_ID) AS maids
--   FROM shaped WHERE shape='2_DAY_PRORATED'
--   GROUP BY 1 ORDER BY notes DESC LIMIT 25;
