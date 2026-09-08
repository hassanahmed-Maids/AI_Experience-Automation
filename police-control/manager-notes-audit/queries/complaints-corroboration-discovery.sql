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
-- 6. THE AGENT'S WORK QUEUE. One row per note, bundled with the conversation an
--    AI agent must read to judge it. Start with the two types where the rule is a
--    human judgement rather than arithmetic: anti-attrition and salary dispute.
--    ⚠️ contains personal text — this output goes to the agent, never to a person's inbox.
-- =====================================================================================
WITH n AS (
    SELECT ID, HOUSEMAID_ID, NOTE_DATE, AMOUNT, NOTE_REASON,
           COALESCE(REASON,'(none)') AS payment_type
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE='ADDITION'
      AND REASON IN ('Anti-attrition Incentive','Salary Dispute')
      AND NOTE_DATE BETWEEN DATEADD('month',-3,CURRENT_DATE()) AND CURRENT_DATE()
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ID ORDER BY NOTE_DATE)=1
)
SELECT
    n.ID                AS note_id,
    n.payment_type,
    n.HOUSEMAID_ID      AS maid_id,
    n.NOTE_DATE::DATE   AS note_date,
    n.AMOUNT,
    c.ID                AS complaint_id,
    c.COMPLAINT_TYPE,
    c.STATUS            AS complaint_status,
    c.CREATION_DATE::DATE AS complaint_opened,
    DATEDIFF('day', c.CREATION_DATE, n.NOTE_DATE) AS days_before_note,
    c.ASSIGNED_TEAM,
    c.GPT_SUMMARY,                       -- already-summarised; cheapest input for the agent
    c.COMPLAINT_DESCRIPTION,
    (SELECT LISTAGG(cc.TEXT, E'\n---\n') WITHIN GROUP (ORDER BY cc.ITERATION)
     FROM BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINT_COMMENTS cc
     WHERE cc.COMPLAINT_ID = c.ID AND cc.ITERATION <= 20) AS conversation
FROM n
LEFT JOIN BA_VIEWS.CLIENT_MANAGEMENT_SILVER.COMPLAINTS c
       ON c.HOUSEMAID_ID = n.HOUSEMAID_ID
      AND c.CREATION_DATE BETWEEN DATEADD('day',-90,n.NOTE_DATE) AND DATEADD('day',14,n.NOTE_DATE)
ORDER BY n.payment_type, n.AMOUNT DESC, days_before_note;
