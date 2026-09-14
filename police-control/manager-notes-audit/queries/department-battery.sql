-- =====================================================================================
-- DEPARTMENT BATTERY — attribute EVERY manager-note payment type to the department that
-- raised it, as of the note date.
--
-- Generalises queries/requester-department.sql (single type) to all types. All four blocks
-- share one preamble, repeated verbatim in each because every query must be self-contained
-- (CLAUDE.md rule 8): assembling CTEs across blocks loses filters silently and the output
-- still looks plausible.
--
-- ── THE VERIFIED GROUND UNDER THIS (established 2026-09-14) ─────────────────────────────
--  * No id to join on. REQUESTED_BY is a NAME (mmdb.users.FULL_NAME); the numeric MANAGER
--    column is dead. Everything here is a NAME join.
--  * OFFICE_STAFF has 5 columns, no name and no id -> the USERS_INFO bridge is mandatory
--    for the current-directory fallback. OFFICE_STAFF_CHANGES carries EMPLOYEE_NAME, so the
--    HISTORY route joins by name directly - prefer it (EMPLOYEE_EMAIL is null on 2,539
--    termination rows and 1,811/1,811 CREATED rows; EMPLOYEE_NAME is null on 7 in total).
--  * DEPARTMENT_NAME is the POST-change value: equals NEW_DEPARTMENT_NAME on 100% of change
--    rows, PREVIOUS_DEPARTMENT_NAME on 0%.
--  * 🔴 Department history starts 2025-06-15. A 12-month window is just inside it. Widen the
--    window and tier 3 swallows the result - then the column means "department as of today".
--  * 🔴 OFFICE_STAFF vs ORG_CHART disagree on 69 of 767 emails (~9%). Neither is trusted
--    over the other; disagreement is counted, never silently resolved.
--  * OFFICE_STAFF_CHANGES has CHANGED_AT but NO NEXT_CHANGE_DATE - Envers shape, not the
--    interval shape. The containment pattern used on HOUSEMAID_STATUS_LOGS does NOT work
--    here; hence the three-tier reconstruction.
--
-- ── WHAT THE FIRST RUN FOUND (Maids.at other expenses, 277 notes) ───────────────────────
--  * SEVEN departments raise one expense head - PRO Services, Delighters L1, CC Maids
--    Retention, MV L1, MaidMatch, Part Time Cleaner Management, Maid Payroll - with job
--    titles from VBC Agent to Collection Manager to Hustler. No functional owner. That is
--    WHY K1 has no rule: nobody owns the rule.
--  * TWO TARIFFS UNDER ONE NAME. PRO Services 136 notes / AED 12,216 (avg 90, every
--    requester between 75 and 95). Delighters L1 62 notes / AED 26,211 (avg 423). No
--    overlap. Half the volume, twice the money. K1 is not "what is this for" but "which of
--    the two". DEPT-4 is the block that detects this shape on every other type.
--  * The LARGEST requester is unknown to the directory: 53 notes (19.1%), AED 4,542, in
--    neither USERS_INFO nor OFFICE_STAFF_CHANGES - but averaging AED 85.7, inside the PRO
--    Services tariff. Reads as a spelling variant, not a ghost. CANDIDATE, not a finding;
--    DEPT-3 exists to tell the two apart. 22.4% of notes (62, AED 9,191) resolve to nobody.
--  * The historical work changed NOTHING on this type: moved_since_the_note, the ambiguity
--    flag and the directory-conflict flag all came back empty. 44% tier 1, 33% tier 3, 22%
--    tier 4. Worth one query to establish rather than assume; not free on longer-history types.
--
-- ⚠️ Names staff identities and departments. Organisational, not personal-financial, but
--    still attribution data - do not forward it on.
--
-- ── 2026-09-14 · WHY NOTES GO UNRESOLVED (measured across all 24 types, 16,831 notes) ───
-- AED 4.14m of AED 6.85m (60.5%) of manager-note money resolved to NO department. The
-- decomposition (DEPT-6, in the audit transcript) settled why, and it is not a directory gap:
--   * 96% of the unresolved money - AED 3.98m over 5,345 notes - is CLASS A: notes written
--     with NO requester at all. 58% of ALL manager-note money is written by JOBS, not people.
--     Airfare Ticket 1,220 of 1,306 notes / AED 2.19m. Bonus 796 of 1,157 / AED 605k.
--     MV Prorated Salary 782/782. Forgive Deduction 1,038. Raffle Prize 576. Both Airfare and
--     Bonus LOOK human-raised (28 and 41 requesters) and are overwhelmingly machine-written.
--     🔴 NO WAREHOUSE JOIN CAN EVER RESOLVE THESE - there is no name. The owning department
--     comes from the ERP code that runs the job (CLAUDE.md rule 1). Already known: Forgive
--     Deduction = automatic cover-deduction-limit / cover-negative-salary additions;
--     Raffle Prize = RaffleService; Last Day CC Switch = the note IS the event (median 0 days).
--   * CLASS B IS EMPTY. Not one person raising money is unknown to USERS_INFO.
--   * The rest is CLASS E - a real ERP user who is not CURRENT office staff (leaver or
--     service account). 226 notes / AED 86,438 stay unresolved even after the widening below.
--   * 🔴 ONE NAME SPANS TEN UNRELATED PAYMENT TYPES. A person doing their job does not raise
--     Salary Dispute, Airfare, Bonus, Maids.at, MOHRE, Taxi, Accommodation, Passport, Lost
--     Luggage AND Medical. That is a shared/service account wearing a human name - a bot a
--     department owns. CANDIDATE, not a finding; payment_types + notes_per_day is the test.
--
-- ── THE WIDENING APPLIED HERE (2026-09-14) ─────────────────────────────────────────────
-- `chg` no longer filters IS_DEPARTMENT_CHANGE='true'. Envers rows are entity SNAPSHOTS, so
-- DEPARTMENT_NAME is the department as of that revision on ANY change type - the old filter
-- discarded ~9,400 rows carrying a department (2,809 on terminations, 1,806 on manager
-- changes, 1,762 on name changes). MEASURED GAIN: 176 notes / AED 76,366 recovered, every
-- one a leaver or service account now placed in a real department (Rafca Fares -> PRO
-- Services, Abedalilah Hmaidy -> CC Delighters, Mayar Baydoun -> Visa, Nadine Kadi -> MV
-- Resolvers, Anthony Assaf -> Part-Time Cleaners). Free and strictly better, so it is the
-- default. Tier 2 (the PREVIOUS-value path) fired ZERO times on all 24 types and survives
-- only as dead weight - drop it if this is ever rewritten.
--
-- ── A PREDICTION THAT WAS WRONG, KEPT AS A CHECK ON THE NEXT ONE ───────────────────────
-- I predicted the largest Maids.at requester (53 notes, AED 4,542) would be class C, a
-- SPELLING VARIANT. She came back class E: a real USERS_INFO user who is not current office
-- staff. The evidence was already on screen - her identity_caveat was blank, which means she
-- resolved to exactly one user - and I read past it. Classify from the columns, not the story.
-- =====================================================================================



-- ═══ DEPT-0 — SIZING. Run this FIRST. 24 rows, no joins. ══════════════════════════════
-- distinct_amounts is roughly how many rows DEPT-5 returns per department for that type.
-- A type with 6 distinct amounts is a tariff you can read in one screen; a type with 400 is
-- a reimbursement and listing every amount tells you nothing the distribution did not -
-- for those, DEPT-4 is the right tool and DEPT-5 is a wasted screen.

SELECT n.REASON                  AS payment_type,
       COUNT(*)                  AS notes,
       COUNT(DISTINCT n.AMOUNT)  AS distinct_amounts,
       SUM(n.AMOUNT)             AS total_aed,
       MIN(n.AMOUNT)             AS min_aed,
       MAX(n.AMOUNT)             AS max_aed,
       ROUND(100.0 * COUNT(DISTINCT n.AMOUNT) / COUNT(*), 1) AS pct_distinct_amounts
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
WHERE n.NOTE_TYPE = 'ADDITION'
  AND n.AMOUNT    > 0
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
  AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY n.REASON
ORDER BY distinct_amounts DESC;

-- RESULT: (paste here when run)


-- ═══ DEPT-1 — TRIAGE. One row per payment type. ════════════════════════════════════════
-- top_department_pct is the column to scan: near 100 = one team owns the type and there is
-- somebody to ask about its rule; near 20 = a shared head with no owner (the Maids.at shape).
WITH mx AS (
    SELECT n.ID AS note_id, n.NOTE_DATE::DATE AS note_day, n.AMOUNT, n.HOUSEMAID_ID,
           n.REASON AS payment_type,
           COALESCE(NULLIF(TRIM(n.REQUESTED_BY), ''), NULLIF(TRIM(x.REQUESTED_BY), ''),
                    '(no requester recorded)') AS added_by
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), k AS (
    SELECT m.*, LOWER(TRIM(REGEXP_REPLACE(m.added_by, '\\s+', ' '))) AS name_key FROM mx m
), chg AS (
    SELECT LOWER(TRIM(REGEXP_REPLACE(EMPLOYEE_NAME, '\\s+', ' '))) AS name_key,
           CHANGED_AT::DATE AS changed_on, DEPARTMENT_NAME AS dept_after,
           PREVIOUS_DEPARTMENT_NAME AS dept_before
    FROM BA_VIEWS.CORE_SILVER.OFFICE_STAFF_CHANGES
    WHERE CHANGED_AT IS NOT NULL AND DEPARTMENT_NAME IS NOT NULL
      AND EMPLOYEE_NAME IS NOT NULL AND TRIM(EMPLOYEE_NAME) <> ''
), back AS (
    SELECT k.note_id, c.dept_after AS dept FROM k JOIN chg c
      ON c.name_key = k.name_key AND c.changed_on <= k.note_day
    WHERE c.dept_after IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY k.note_id ORDER BY c.changed_on DESC) = 1
), fwd AS (
    SELECT k.note_id, c.dept_before AS dept FROM k JOIN chg c
      ON c.name_key = k.name_key AND c.changed_on > k.note_day
    WHERE c.dept_before IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY k.note_id ORDER BY c.changed_on ASC) = 1
), u AS (
    SELECT LOWER(TRIM(REGEXP_REPLACE(NAME, '\\s+', ' '))) AS name_key,
           COUNT(DISTINCT LOWER(TRIM(EMAIL))) AS users_with_this_name,
           MAX(LOWER(TRIM(EMAIL))) AS email_key
    FROM BA_VIEWS.CORE_SILVER.USERS_INFO
    WHERE NAME IS NOT NULL AND TRIM(NAME) <> '' AND EMAIL IS NOT NULL AND TRIM(EMAIL) <> ''
    GROUP BY 1
), os AS (SELECT LOWER(TRIM(EMAIL)) AS email_key, MAX(DEPARTMENT) AS department
          FROM BA_VIEWS.CORE_SILVER.OFFICE_STAFF WHERE EMAIL IS NOT NULL GROUP BY 1
), oc AS (SELECT LOWER(TRIM(EMAIL)) AS email_key, MAX(DEPARTMENT) AS department
          FROM BA_VIEWS.CORE_SILVER.ORG_CHART   WHERE EMAIL IS NOT NULL GROUP BY 1
), resolved AS (
    SELECT k.payment_type, k.note_id, k.note_day, k.AMOUNT, k.HOUSEMAID_ID, k.added_by, k.name_key,
           COALESCE(b.dept, f.dept, os.department, oc.department, '(UNRESOLVED)') AS dept,
           CASE WHEN b.dept IS NOT NULL THEN 1 WHEN f.dept IS NOT NULL THEN 2
                WHEN os.department IS NOT NULL OR oc.department IS NOT NULL THEN 3
                ELSE 4 END AS tier,
           IFF(b.dept IS NOT NULL AND os.department IS NOT NULL
               AND b.dept IS DISTINCT FROM os.department, 1, 0)   AS moved,
           IFF(u.users_with_this_name > 1, 1, 0)                  AS ambiguous,
           IFF(NVL(os.department,'~') <> NVL(oc.department,'~'), 1, 0) AS dir_conflict
    FROM k
    LEFT JOIN back b ON b.note_id = k.note_id
    LEFT JOIN fwd  f ON f.note_id = k.note_id
    LEFT JOIN u      ON u.name_key = k.name_key
    LEFT JOIN os     ON os.email_key = u.email_key AND u.users_with_this_name = 1
    LEFT JOIN oc     ON oc.email_key = u.email_key AND u.users_with_this_name = 1
), bydept AS (
    SELECT payment_type, dept, COUNT(*) AS n FROM resolved GROUP BY 1, 2
), top AS (
    SELECT payment_type,
           MAX_BY(dept, IFF(dept = '(UNRESOLVED)', -1, n)) AS top_department,
           MAX(IFF(dept = '(UNRESOLVED)', 0, n))           AS top_department_notes
    FROM bydept GROUP BY 1
)
SELECT r.payment_type,
       COUNT(*)                          AS notes,
       SUM(r.AMOUNT)                     AS total_aed,
       COUNT(DISTINCT r.added_by)        AS requesters,
       COUNT(DISTINCT CASE WHEN r.dept <> '(UNRESOLVED)' THEN r.dept END) AS departments,
       t.top_department,
       ROUND(100.0 * t.top_department_notes / COUNT(*), 1) AS top_department_pct,
       COUNT_IF(r.tier = 1)              AS t1_log_before,
       COUNT_IF(r.tier = 2)              AS t2_log_after,
       COUNT_IF(r.tier = 3)              AS t3_current_only,
       COUNT_IF(r.tier = 4)              AS t4_unresolved,
       ROUND(100.0 * COUNT_IF(r.tier = 4) / COUNT(*), 1) AS pct_unresolved,
       SUM(IFF(r.tier = 4, r.AMOUNT, 0)) AS unresolved_aed,
       SUM(r.moved)                      AS notes_by_people_who_moved,
       SUM(r.ambiguous)                  AS notes_ambiguous_name,
       SUM(r.dir_conflict)               AS notes_directory_conflict
FROM resolved r
JOIN top t ON t.payment_type = r.payment_type
GROUP BY r.payment_type, t.top_department, t.top_department_notes
ORDER BY notes DESC;

-- RESULT: (paste here when run)


-- ═══ DEPT-2 — PER-REQUESTER DETAIL for ONE type. ═══════════════════════════════════════
-- The full query is queries/requester-department.sql. Point it at another type by changing
-- the single REASON line in its `mx` CTE:
--       AND n.REASON    = 'Maids.at other expenses'     <- the only line to change
-- Run DEPT-1 first, then DEPT-2 on whichever types DEPT-1 flags.


-- ═══ DEPT-3 — WHO RAISES MONEY THE DIRECTORY DOES NOT RECOGNISE, across all types. ═════
-- Decides whether an unresolved requester is a SPELLING VARIANT or a REAL GAP. Do not call
-- a tier-4 identity a finding until this says no one in USERS_INFO shares even the first name.
WITH mx AS (
    SELECT n.ID AS note_id, n.NOTE_DATE::DATE AS note_day, n.AMOUNT, n.HOUSEMAID_ID,
           n.REASON AS payment_type,
           COALESCE(NULLIF(TRIM(n.REQUESTED_BY), ''), NULLIF(TRIM(x.REQUESTED_BY), ''),
                    '(no requester recorded)') AS added_by
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), k AS (
    SELECT m.*, LOWER(TRIM(REGEXP_REPLACE(m.added_by, '\\s+', ' '))) AS name_key FROM mx m
), chg AS (
    SELECT LOWER(TRIM(REGEXP_REPLACE(EMPLOYEE_NAME, '\\s+', ' '))) AS name_key,
           CHANGED_AT::DATE AS changed_on, DEPARTMENT_NAME AS dept_after,
           PREVIOUS_DEPARTMENT_NAME AS dept_before
    FROM BA_VIEWS.CORE_SILVER.OFFICE_STAFF_CHANGES
    WHERE CHANGED_AT IS NOT NULL AND DEPARTMENT_NAME IS NOT NULL
      AND EMPLOYEE_NAME IS NOT NULL AND TRIM(EMPLOYEE_NAME) <> ''
), back AS (
    SELECT k.note_id, c.dept_after AS dept FROM k JOIN chg c
      ON c.name_key = k.name_key AND c.changed_on <= k.note_day
    WHERE c.dept_after IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY k.note_id ORDER BY c.changed_on DESC) = 1
), fwd AS (
    SELECT k.note_id, c.dept_before AS dept FROM k JOIN chg c
      ON c.name_key = k.name_key AND c.changed_on > k.note_day
    WHERE c.dept_before IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY k.note_id ORDER BY c.changed_on ASC) = 1
), u AS (
    SELECT LOWER(TRIM(REGEXP_REPLACE(NAME, '\\s+', ' '))) AS name_key,
           COUNT(DISTINCT LOWER(TRIM(EMAIL))) AS users_with_this_name,
           MAX(LOWER(TRIM(EMAIL))) AS email_key
    FROM BA_VIEWS.CORE_SILVER.USERS_INFO
    WHERE NAME IS NOT NULL AND TRIM(NAME) <> '' AND EMAIL IS NOT NULL AND TRIM(EMAIL) <> ''
    GROUP BY 1
), os AS (SELECT LOWER(TRIM(EMAIL)) AS email_key, MAX(DEPARTMENT) AS department
          FROM BA_VIEWS.CORE_SILVER.OFFICE_STAFF WHERE EMAIL IS NOT NULL GROUP BY 1
), oc AS (SELECT LOWER(TRIM(EMAIL)) AS email_key, MAX(DEPARTMENT) AS department
          FROM BA_VIEWS.CORE_SILVER.ORG_CHART   WHERE EMAIL IS NOT NULL GROUP BY 1
), resolved AS (
    SELECT k.payment_type, k.note_id, k.note_day, k.AMOUNT, k.HOUSEMAID_ID, k.added_by, k.name_key,
           COALESCE(b.dept, f.dept, os.department, oc.department, '(UNRESOLVED)') AS dept,
           CASE WHEN b.dept IS NOT NULL THEN 1 WHEN f.dept IS NOT NULL THEN 2
                WHEN os.department IS NOT NULL OR oc.department IS NOT NULL THEN 3
                ELSE 4 END AS tier,
           IFF(b.dept IS NOT NULL AND os.department IS NOT NULL
               AND b.dept IS DISTINCT FROM os.department, 1, 0)   AS moved,
           IFF(u.users_with_this_name > 1, 1, 0)                  AS ambiguous,
           IFF(NVL(os.department,'~') <> NVL(oc.department,'~'), 1, 0) AS dir_conflict
    FROM k
    LEFT JOIN back b ON b.note_id = k.note_id
    LEFT JOIN fwd  f ON f.note_id = k.note_id
    LEFT JOIN u      ON u.name_key = k.name_key
    LEFT JOIN os     ON os.email_key = u.email_key AND u.users_with_this_name = 1
    LEFT JOIN oc     ON oc.email_key = u.email_key AND u.users_with_this_name = 1
), tok AS (
    SELECT SPLIT_PART(LOWER(TRIM(NAME)), ' ', 1) AS first_tok,
           COUNT(*)   AS users_with_that_first_name,
           MAX(NAME)  AS one_example_from_users_info
    FROM BA_VIEWS.CORE_SILVER.USERS_INFO
    WHERE NAME IS NOT NULL AND TRIM(NAME) <> ''
    GROUP BY 1
), un AS (
    SELECT added_by, name_key,
           COUNT(*)                        AS notes,
           SUM(AMOUNT)                     AS total_aed,
           ROUND(AVG(AMOUNT), 1)           AS avg_aed,
           COUNT(DISTINCT HOUSEMAID_ID)    AS maids,
           COUNT(DISTINCT payment_type)    AS payment_types,
           LISTAGG(DISTINCT payment_type, '  |  ')
             WITHIN GROUP (ORDER BY payment_type) AS types_raised,
           MIN(note_day) AS first_note, MAX(note_day) AS last_note
    FROM resolved WHERE tier = 4 GROUP BY 1, 2
)
SELECT un.added_by, un.notes, un.maids, un.total_aed, un.avg_aed,
       un.payment_types, un.types_raised, un.first_note, un.last_note,
       COALESCE(tok.users_with_that_first_name, 0)   AS users_sharing_the_first_name,
       COALESCE(tok.one_example_from_users_info, '') AS example_user_with_that_first_name,
       IFF(tok.first_tok IS NULL,
           'NO ONE in USERS_INFO shares even the first name - treat as a real gap',
           'first name exists in USERS_INFO - check spelling before calling this a gap')
                                                     AS reading
FROM un LEFT JOIN tok ON tok.first_tok = SPLIT_PART(un.name_key, ' ', 1)
ORDER BY un.total_aed DESC, un.notes DESC;

-- RESULT: (paste here when run)


-- ═══ DEPT-4 — TARIFF DETECTOR. One row per payment type x department. ══════════════════
-- pct_distinct_amounts is the discriminator: LOW = a tariff (a rule exists and can be
-- tested); NEAR 100 = a reimbursement (only the invoice controls it, so `no invoice` is the
-- finding, not the amount). This is the block that split Maids.at into AED 90 and AED 423.
-- HAVING >= 3 is deliberate: a department with one or two notes has no distribution to read,
-- and including it puts noise beside signal.
WITH mx AS (
    SELECT n.ID AS note_id, n.NOTE_DATE::DATE AS note_day, n.AMOUNT, n.HOUSEMAID_ID,
           n.REASON AS payment_type,
           COALESCE(NULLIF(TRIM(n.REQUESTED_BY), ''), NULLIF(TRIM(x.REQUESTED_BY), ''),
                    '(no requester recorded)') AS added_by
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), k AS (
    SELECT m.*, LOWER(TRIM(REGEXP_REPLACE(m.added_by, '\\s+', ' '))) AS name_key FROM mx m
), chg AS (
    SELECT LOWER(TRIM(REGEXP_REPLACE(EMPLOYEE_NAME, '\\s+', ' '))) AS name_key,
           CHANGED_AT::DATE AS changed_on, DEPARTMENT_NAME AS dept_after,
           PREVIOUS_DEPARTMENT_NAME AS dept_before
    FROM BA_VIEWS.CORE_SILVER.OFFICE_STAFF_CHANGES
    WHERE CHANGED_AT IS NOT NULL AND DEPARTMENT_NAME IS NOT NULL
      AND EMPLOYEE_NAME IS NOT NULL AND TRIM(EMPLOYEE_NAME) <> ''
), back AS (
    SELECT k.note_id, c.dept_after AS dept FROM k JOIN chg c
      ON c.name_key = k.name_key AND c.changed_on <= k.note_day
    WHERE c.dept_after IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY k.note_id ORDER BY c.changed_on DESC) = 1
), fwd AS (
    SELECT k.note_id, c.dept_before AS dept FROM k JOIN chg c
      ON c.name_key = k.name_key AND c.changed_on > k.note_day
    WHERE c.dept_before IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY k.note_id ORDER BY c.changed_on ASC) = 1
), u AS (
    SELECT LOWER(TRIM(REGEXP_REPLACE(NAME, '\\s+', ' '))) AS name_key,
           COUNT(DISTINCT LOWER(TRIM(EMAIL))) AS users_with_this_name,
           MAX(LOWER(TRIM(EMAIL))) AS email_key
    FROM BA_VIEWS.CORE_SILVER.USERS_INFO
    WHERE NAME IS NOT NULL AND TRIM(NAME) <> '' AND EMAIL IS NOT NULL AND TRIM(EMAIL) <> ''
    GROUP BY 1
), os AS (SELECT LOWER(TRIM(EMAIL)) AS email_key, MAX(DEPARTMENT) AS department
          FROM BA_VIEWS.CORE_SILVER.OFFICE_STAFF WHERE EMAIL IS NOT NULL GROUP BY 1
), oc AS (SELECT LOWER(TRIM(EMAIL)) AS email_key, MAX(DEPARTMENT) AS department
          FROM BA_VIEWS.CORE_SILVER.ORG_CHART   WHERE EMAIL IS NOT NULL GROUP BY 1
), resolved AS (
    SELECT k.payment_type, k.note_id, k.note_day, k.AMOUNT, k.HOUSEMAID_ID, k.added_by, k.name_key,
           COALESCE(b.dept, f.dept, os.department, oc.department, '(UNRESOLVED)') AS dept,
           CASE WHEN b.dept IS NOT NULL THEN 1 WHEN f.dept IS NOT NULL THEN 2
                WHEN os.department IS NOT NULL OR oc.department IS NOT NULL THEN 3
                ELSE 4 END AS tier,
           IFF(b.dept IS NOT NULL AND os.department IS NOT NULL
               AND b.dept IS DISTINCT FROM os.department, 1, 0)   AS moved,
           IFF(u.users_with_this_name > 1, 1, 0)                  AS ambiguous,
           IFF(NVL(os.department,'~') <> NVL(oc.department,'~'), 1, 0) AS dir_conflict
    FROM k
    LEFT JOIN back b ON b.note_id = k.note_id
    LEFT JOIN fwd  f ON f.note_id = k.note_id
    LEFT JOIN u      ON u.name_key = k.name_key
    LEFT JOIN os     ON os.email_key = u.email_key AND u.users_with_this_name = 1
    LEFT JOIN oc     ON oc.email_key = u.email_key AND u.users_with_this_name = 1
)
SELECT payment_type,
       dept                                  AS department,
       COUNT(*)                              AS notes,
       COUNT(DISTINCT HOUSEMAID_ID)          AS maids,
       SUM(AMOUNT)                           AS total_aed,
       ROUND(AVG(AMOUNT), 1)                 AS avg_aed,
       MEDIAN(AMOUNT)                        AS median_aed,
       MIN(AMOUNT)                           AS min_aed,
       MAX(AMOUNT)                           AS max_aed,
       COUNT(DISTINCT AMOUNT)                AS distinct_amounts,
       ROUND(100.0 * COUNT(DISTINCT AMOUNT) / COUNT(*), 1) AS pct_distinct_amounts,
       ROUND(STDDEV(AMOUNT), 1)              AS sd_aed
FROM resolved
GROUP BY payment_type, dept
HAVING COUNT(*) >= 3
ORDER BY payment_type, notes DESC;

-- RESULT: (paste here when run)




-- ═══ DEPT-5 — THE EXACT AMOUNTS, by department, with the people who raised them. ═══════
-- ONE PAYMENT TYPE AT A TIME. Fired at all types this grain runs to ~2,000 rows, which by
-- rule 8 means the shape is wrong, not that it needs a LIMIT. Run DEPT-0 first and pick.
--
-- Ordered by department first, so each department's amount list reads as a block - that is
-- what makes a per-department tariff visible. On Maids.at: PRO Services clusters near 90,
-- Delighters L1 near 400.
--
-- best_tier carries attribution confidence into the amount view: tier 4 means the amounts
-- are real but the department half of the row is UNKNOWN, not wrong.

WITH mx AS (
    SELECT n.ID AS note_id, n.NOTE_DATE::DATE AS note_day, n.AMOUNT, n.HOUSEMAID_ID,
           n.REASON AS payment_type,
           COALESCE(NULLIF(TRIM(n.REQUESTED_BY), ''), NULLIF(TRIM(x.REQUESTED_BY), ''),
                    '(no requester recorded)') AS added_by
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.AMOUNT > 0
      AND n.REASON    = 'Maids.at other expenses'     -- <- the only line to change
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND n.NOTE_DATE <= CURRENT_DATE()
), k AS (
    SELECT m.*, LOWER(TRIM(REGEXP_REPLACE(m.added_by, '\\s+', ' '))) AS name_key FROM mx m
), chg AS (
    SELECT LOWER(TRIM(REGEXP_REPLACE(EMPLOYEE_NAME, '\\s+', ' '))) AS name_key,
           CHANGED_AT::DATE AS changed_on, DEPARTMENT_NAME AS dept_after,
           PREVIOUS_DEPARTMENT_NAME AS dept_before
    FROM BA_VIEWS.CORE_SILVER.OFFICE_STAFF_CHANGES
    WHERE CHANGED_AT IS NOT NULL AND DEPARTMENT_NAME IS NOT NULL
      AND EMPLOYEE_NAME IS NOT NULL AND TRIM(EMPLOYEE_NAME) <> ''
), back AS (
    SELECT k.note_id, c.dept_after AS dept FROM k JOIN chg c
      ON c.name_key = k.name_key AND c.changed_on <= k.note_day
    WHERE c.dept_after IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY k.note_id ORDER BY c.changed_on DESC) = 1
), fwd AS (
    SELECT k.note_id, c.dept_before AS dept FROM k JOIN chg c
      ON c.name_key = k.name_key AND c.changed_on > k.note_day
    WHERE c.dept_before IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY k.note_id ORDER BY c.changed_on ASC) = 1
), u AS (
    SELECT LOWER(TRIM(REGEXP_REPLACE(NAME, '\\s+', ' '))) AS name_key,
           COUNT(DISTINCT LOWER(TRIM(EMAIL))) AS users_with_this_name,
           MAX(LOWER(TRIM(EMAIL))) AS email_key
    FROM BA_VIEWS.CORE_SILVER.USERS_INFO
    WHERE NAME IS NOT NULL AND TRIM(NAME) <> '' AND EMAIL IS NOT NULL AND TRIM(EMAIL) <> ''
    GROUP BY 1
), os AS (SELECT LOWER(TRIM(EMAIL)) AS email_key, MAX(DEPARTMENT) AS department
          FROM BA_VIEWS.CORE_SILVER.OFFICE_STAFF WHERE EMAIL IS NOT NULL GROUP BY 1
), oc AS (SELECT LOWER(TRIM(EMAIL)) AS email_key, MAX(DEPARTMENT) AS department
          FROM BA_VIEWS.CORE_SILVER.ORG_CHART   WHERE EMAIL IS NOT NULL GROUP BY 1
), resolved AS (
    SELECT k.note_id, k.note_day, k.AMOUNT, k.HOUSEMAID_ID, k.added_by,
           COALESCE(b.dept, f.dept, os.department, oc.department, '(UNRESOLVED)') AS dept,
           CASE WHEN b.dept IS NOT NULL THEN 1 WHEN f.dept IS NOT NULL THEN 2
                WHEN os.department IS NOT NULL OR oc.department IS NOT NULL THEN 3
                ELSE 4 END AS tier
    FROM k
    LEFT JOIN back b ON b.note_id = k.note_id
    LEFT JOIN fwd  f ON f.note_id = k.note_id
    LEFT JOIN u      ON u.name_key = k.name_key
    LEFT JOIN os     ON os.email_key = u.email_key AND u.users_with_this_name = 1
    LEFT JOIN oc     ON oc.email_key = u.email_key AND u.users_with_this_name = 1
), cell AS (
    SELECT dept, AMOUNT, added_by, COUNT(*) AS n FROM resolved GROUP BY 1, 2, 3
), who AS (
    SELECT dept, AMOUNT,
           COUNT(*) AS requesters,
           LISTAGG(added_by || ' x' || n, '  |  ')
             WITHIN GROUP (ORDER BY n DESC, added_by) AS who_added_them
    FROM cell GROUP BY 1, 2
)
SELECT r.dept                                        AS department,
       r.AMOUNT                                      AS aed_each,
       COUNT(*)                                      AS notes,
       COUNT(DISTINCT r.HOUSEMAID_ID)                AS maids,
       r.AMOUNT * COUNT(*)                           AS total_aed,
       w.requesters,
       w.who_added_them,
       MIN(r.note_day)                               AS first_seen,
       MAX(r.note_day)                               AS last_seen,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_type,
       IFF(r.AMOUNT = ROUND(r.AMOUNT, 0), 'whole', 'has fils') AS granularity,
       MIN(r.tier)                                   AS best_tier
FROM resolved r
JOIN who w ON w.dept = r.dept AND w.AMOUNT = r.AMOUNT
GROUP BY r.dept, r.AMOUNT, w.requesters, w.who_added_them
ORDER BY r.dept, notes DESC, aed_each DESC;

-- RESULT: (paste here when run)


-- ── READING ORDER ──────────────────────────────────────────────────────────────────────
-- DEPT-1 says which types have an owner. DEPT-4 says whether each department's payments
-- follow a rule. DEPT-3 says whose payments cannot be attributed at all. DEPT-2 drills into
-- whichever type the first three make interesting. DEPT-0 sizes the amount lists and
-- DEPT-5 prints the exact amounts per department per type - the grain DEPT-4 only counts.
