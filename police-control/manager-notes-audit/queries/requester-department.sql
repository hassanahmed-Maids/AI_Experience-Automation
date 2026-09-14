-- =====================================================================================
-- WHO RAISED IT, AND FROM WHICH DEPARTMENT — as of the note date, not as of today.
--
-- Built for Maids.at other expenses; the WHERE clause in `mx` is the only thing to change
-- to point it at another payment type.
--
-- ── WHAT THE DISCOVERY ROUND ESTABLISHED (2026-09-14, all verified in-session) ──────────
--  1. There is no id to join on. `REQUESTED_BY` is a NAME string (mmdb.users.FULL_NAME);
--     the numeric `MANAGER` column that would have been the FK is dead (unmapped in the JPA
--     entity, no non-null values). Everything here is therefore a NAME join.
--  2. CORE_SILVER.OFFICE_STAFF has FIVE columns - EMAIL, MANAGER_EMAIL, WORK_ADDRESS,
--     JOB_TITLE, DEPARTMENT. No name, no id. So the current-directory route MUST go through
--     USERS_INFO (NAME -> EMAIL) first.
--  3. CORE_SILVER.OFFICE_STAFF_CHANGES carries EMPLOYEE_NAME, so the HISTORY route joins by
--     name directly. Prefer it: EMPLOYEE_EMAIL is null on 2,539 termination rows and on
--     1,811 of 1,811 CREATED rows, while EMPLOYEE_NAME is null on 7 rows in the whole table.
--  4. DEPARTMENT_NAME is the POST-change value. On every department-change group it equals
--     NEW_DEPARTMENT_NAME (5969/5969, 1994/1994, 854/854 ...) and PREVIOUS_DEPARTMENT_NAME
--     on 0 rows. So DEPARTMENT_NAME is the state AS OF that revision.
--  5. 🔴 DEPARTMENT HISTORY STARTS 2025-06-15. Every IS_DEPARTMENT_CHANGE=true group begins
--     on or after that date, while name/manager/termination changes run back to 2018.
--     Department tracking was switched on in June 2025. A 12-month window opening ~2025-09
--     is just inside it; ANY OLDER PAYMENT TYPE HITS A WALL and must fall back to tier 3.
--  6. 🔴 OFFICE_STAFF and ORG_CHART are NOT the same view. Identical column lists, both 767
--     rows / 767 emails, but 130 vs 128 distinct departments, 4 emails absent from ORG_CHART,
--     and 69 emails where the two DISAGREE on department. ~9%. Neither is trusted over the
--     other: both are carried and any disagreement is PRINTED, never silently resolved.
--  7. OFFICE_STAFF_CHANGES has CHANGED_AT but NO NEXT_CHANGE_DATE. It is the Envers shape,
--     not the interval shape - the plain containment pattern used on HOUSEMAID_STATUS_LOGS
--     does NOT work here, which is why this reconstructs the interval in three tiers.
--
-- ── THE DIAGNOSTIC ──────────────────────────────────────────────────────────────────────
-- `how_resolved` is this query's equivalent of `resolved_to_a_PAST_interval` - the column
-- that caught the airfare confound before publication. Tier 1 is a real historical read.
-- Tier 3 ASSUMES the person never moved. If most notes land in tier 3, the honest label for
-- the whole column is "department as of today", not "department at the time".
-- `moved_since_the_note` is the payoff: people whose CURRENT department would have
-- misattributed their own notes - i.e. a finding filed against the wrong team.
--
-- ⚠️ Names staff identities and their departments. Organisational, not personal-financial,
--    but still attribution data - do not forward it on.
-- =====================================================================================

WITH mx AS (
    SELECT n.ID              AS note_id,
           n.NOTE_DATE::DATE AS note_day,
           n.AMOUNT,
           n.HOUSEMAID_ID,
           COALESCE(NULLIF(TRIM(n.REQUESTED_BY), ''),
                    NULLIF(TRIM(x.REQUESTED_BY), ''),
                    '(no requester recorded)')  AS added_by
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION'
      AND n.REASON    = 'Maids.at other expenses'
      AND n.AMOUNT    > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), k AS (
    SELECT m.*, LOWER(TRIM(REGEXP_REPLACE(m.added_by, '\\s+', ' '))) AS name_key
    FROM mx m
), chg AS (
    SELECT LOWER(TRIM(REGEXP_REPLACE(EMPLOYEE_NAME, '\\s+', ' '))) AS name_key,
           CHANGED_AT::DATE                                        AS changed_on,
           DEPARTMENT_NAME                                         AS dept_after,
           PREVIOUS_DEPARTMENT_NAME                                AS dept_before
    FROM BA_VIEWS.CORE_SILVER.OFFICE_STAFF_CHANGES
    WHERE TO_VARCHAR(IS_DEPARTMENT_CHANGE) = 'true'
      AND CHANGED_AT    IS NOT NULL
      AND EMPLOYEE_NAME IS NOT NULL AND TRIM(EMPLOYEE_NAME) <> ''
), back AS (                      -- TIER 1: last department change at or before the note
    SELECT k.note_id, c.dept_after AS dept, c.changed_on
    FROM k JOIN chg c ON c.name_key = k.name_key AND c.changed_on <= k.note_day
    WHERE c.dept_after IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY k.note_id ORDER BY c.changed_on DESC) = 1
), fwd AS (                       -- TIER 2: the next change's PREVIOUS value was in force then
    SELECT k.note_id, c.dept_before AS dept, c.changed_on
    FROM k JOIN chg c ON c.name_key = k.name_key AND c.changed_on > k.note_day
    WHERE c.dept_before IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY k.note_id ORDER BY c.changed_on ASC) = 1
), u AS (                         -- name -> email, only for the current-directory fallback
    SELECT LOWER(TRIM(REGEXP_REPLACE(NAME, '\\s+', ' ')))  AS name_key,
           COUNT(DISTINCT LOWER(TRIM(EMAIL)))              AS users_with_this_name,
           MAX(LOWER(TRIM(EMAIL)))                         AS email_key
    FROM BA_VIEWS.CORE_SILVER.USERS_INFO
    WHERE NAME  IS NOT NULL AND TRIM(NAME)  <> ''
      AND EMAIL IS NOT NULL AND TRIM(EMAIL) <> ''
    GROUP BY 1
), os AS (
    SELECT LOWER(TRIM(EMAIL)) AS email_key, MAX(DEPARTMENT) AS department, MAX(JOB_TITLE) AS job_title
    FROM BA_VIEWS.CORE_SILVER.OFFICE_STAFF WHERE EMAIL IS NOT NULL GROUP BY 1
), oc AS (
    SELECT LOWER(TRIM(EMAIL)) AS email_key, MAX(DEPARTMENT) AS department
    FROM BA_VIEWS.CORE_SILVER.ORG_CHART   WHERE EMAIL IS NOT NULL GROUP BY 1
), resolved AS (
    SELECT k.note_id, k.note_day, k.AMOUNT, k.HOUSEMAID_ID, k.added_by,
           COALESCE(b.dept, f.dept, os.department, oc.department, '(UNRESOLVED)') AS department_at_note_time,
           CASE WHEN b.dept IS NOT NULL THEN '1. log - last change before the note'
                WHEN f.dept IS NOT NULL THEN '2. log - PREVIOUS value on the next change'
                WHEN os.department IS NOT NULL
                  OR oc.department IS NOT NULL
                                        THEN '3. current directory - no department change on record'
                ELSE                         '4. UNRESOLVED'
           END                                                                    AS how_resolved,
           COALESCE(os.job_title, '')                                             AS job_title_today,
           CASE WHEN u.name_key IS NULL             THEN 'name not in USERS_INFO'
                WHEN u.users_with_this_name > 1     THEN 'AMBIGUOUS - ' || u.users_with_this_name || ' users share this name'
                ELSE '' END                                                       AS identity_caveat,
           IFF(NVL(os.department, '~') <> NVL(oc.department, '~'),
               'OFFICE_STAFF=' || NVL(os.department, '(null)') ||
               '  vs  ORG_CHART=' || NVL(oc.department, '(null)'), '')            AS directory_conflict,
           IFF(b.dept IS NOT NULL AND os.department IS NOT NULL
               AND b.dept IS DISTINCT FROM os.department, 'moved since', '')      AS moved_since_the_note
    FROM k
    LEFT JOIN back b ON b.note_id    = k.note_id
    LEFT JOIN fwd  f ON f.note_id    = k.note_id
    LEFT JOIN u      ON u.name_key   = k.name_key
    LEFT JOIN os     ON os.email_key = u.email_key AND u.users_with_this_name = 1
    LEFT JOIN oc     ON oc.email_key = u.email_key AND u.users_with_this_name = 1
)
SELECT department_at_note_time,
       how_resolved,
       added_by,
       job_title_today,
       identity_caveat,
       directory_conflict,
       moved_since_the_note,
       COUNT(*)                                           AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)                       AS maids,
       SUM(AMOUNT)                                        AS total_aed,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_notes,
       MIN(note_day)                                      AS first_note,
       MAX(note_day)                                      AS last_note
FROM resolved
GROUP BY department_at_note_time, how_resolved, added_by, job_title_today,
         identity_caveat, directory_conflict, moved_since_the_note
ORDER BY notes DESC, total_aed DESC;

-- RESULT: (paste here when run)

-- ── FAILED ATTEMPTS, KEPT SO THEY ARE NOT REPEATED ─────────────────────────────────────
-- (a) MAX(IFF(IS_ACTIVE, 1, 0)) -> "Invalid argument types for function 'IFF':
--     (NUMBER(38,0), NUMBER(1,0), NUMBER(1,0))". USERS_INFO.IS_ACTIVE is NUMERIC, not
--     boolean, and its encoding is still unverified - do not interpret it, surface it raw.
-- (b) GROUP BY <alias> where the alias shares a name with a source column: "'SYS_VW.NAME_KEY_2'
--     in select clause is neither an aggregate nor in the group by clause". `GROUP BY department`
--     bound to s.DEPARTMENT, NOT to the CASE alias, so the CASE's inputs were never grouped.
--     Fix structurally: derive row-level in a CTE, group only plain columns in the outer query,
--     and never name an output alias after a source column.
