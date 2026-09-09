-- =====================================================================================
-- AUDIT-RUN.sql — THE REPEATABLE ARTEFACT (§D4 of the coverage ledger).
--
-- Until now every finding in this audit came from a bespoke query, hand-driven one at a
-- time. Nothing could be re-run by anyone else, and nothing could be re-run NEXT MONTH.
-- This is the fix: **ONE statement, one paste, one result table.**
--
-- It runs the cross-cutting tests — the ones that apply to every payment type, as opposed
-- to a group's own entitlement rule — and emits a uniform shape:
--
--     TEST_ID | TEST | PAYMENT_TYPE | VERDICT | NOTES | MAIDS | AED
--
-- VERDICT is 'GREEN' when the test found nothing and 'RED'/'AMBER' when it did, so the
-- whole audit reads as one sorted table: every RED row is a population to look at, and a
-- type with no RED rows passed every test that can run without its group rule.
--
-- It is ONE SQL statement. The shared CTEs are defined once at the top and every test
-- reads from them — which is legitimate here in a way "reuse the CTEs above" never is,
-- because there is no assembly step for a human to get wrong.
--
-- TO CHANGE THE WINDOW: edit the two DATEADD lines in the `n` CTE. Nothing else.
-- TO RE-RUN MONTHLY: paste it again. That is the whole procedure.
--
-- WHAT IT DOES NOT DO — stated so its silence is never mistaken for coverage:
--   * ADDITIONS ONLY. Deductions are not tested here, or anywhere in this audit.
--   * No group entitlement rules (airfare tenure, referral price, prorated window,
--     live-out status, raffle roster). Those live in their own files and need as-of joins.
--   * No chance baselines. Every test here is deterministic — a rule broken, not a rate.
--   * A type with zero RED rows is NOT audited. It passed the tests that can run.
-- =====================================================================================

WITH n AS (
    SELECT ID AS note_id, HOUSEMAID_ID, EXPENSE_ID, AMOUNT, NOTE_DATE,
           NOTE_DATE::DATE AS note_day,
           COALESCE(REASON, '(none)') AS payment_type,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(REQUESTED_BY),''), '\\s+',' '))) AS note_req,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(APPROVED_BY),''),  '\\s+',' '))) AS note_apr
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND AMOUNT > 0
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE())
      AND NOTE_DATE <= CURRENT_DATE()
), cfg AS (
    -- one row per expense type: the head list is not unique on this column and an
    -- un-deduplicated join fans out and inflates every sum downstream.
    SELECT EXPENSE_TYPE, CODE, APPROVAL_METHOD, LIMIT_FOR_APPROVAL,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(APPROVE_HOLDER),''),'\\s+',' '))) AS holder
    FROM BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION
    WHERE EXPENSE_TYPE IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY EXPENSE_TYPE ORDER BY CODE) = 1
), j AS (
    SELECT n.*, x.REQUEST_STATUS, x.AMOUNT AS req_amount, x.CURRENCY_NAME,
           x.REFUNDED, x.REFUND_DATE, x.EXPENSE_TYPE,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(x.REQUESTED_BY),''), '\\s+',' '))) AS req,
           LOWER(TRIM(REGEXP_REPLACE(NULLIF(TRIM(x.APPROVED_BY),''),  '\\s+',' '))) AS apr,
           c.APPROVAL_METHOD, c.LIMIT_FOR_APPROVAL, c.holder
    FROM n
    LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS x ON x.ID = n.EXPENSE_ID
    LEFT JOIN cfg c ON c.EXPENSE_TYPE = x.EXPENSE_TYPE
), dup AS (
    SELECT HOUSEMAID_ID, payment_type, note_day,
           COUNT(*) AS same_day_notes, SUM(AMOUNT) AS same_day_aed
    FROM n GROUP BY 1,2,3 HAVING COUNT(*) > 1
)

-- R0 · CENSUS — never a verdict. The denominator every RED row below is read against.
SELECT 'R0' AS test_id, 'census' AS test, payment_type,
       'n/a' AS verdict, COUNT(*) AS notes,
       COUNT(DISTINCT HOUSEMAID_ID) AS maids, ROUND(SUM(AMOUNT)) AS aed
FROM n GROUP BY payment_type

UNION ALL
-- R1 · UNAUTHORISED — no expense request behind the money at all.
--   ⚠️ Absence is only a finding for a type that SHOULD carry one. Airfare and Office Work
--   are booked straight onto salary by design, so they are expected to appear here.
SELECT 'R1', 'no expense request', payment_type,
       IFF(COUNT(*) > 0, 'AMBER - expected for salary-booked types', 'GREEN'),
       COUNT(*), COUNT(DISTINCT HOUSEMAID_ID), ROUND(SUM(AMOUNT))
FROM j WHERE EXPENSE_ID IS NULL GROUP BY payment_type

UNION ALL
-- R2 · PAID ON A DEAD REQUEST — the request was rejected, dismissed or cancelled.
SELECT 'R2', 'request killed', payment_type, 'RED',
       COUNT(*), COUNT(DISTINCT HOUSEMAID_ID), ROUND(SUM(AMOUNT))
FROM j WHERE REQUEST_STATUS IN ('REJECTED','DISMISSED','CANCELED') GROUP BY payment_type

UNION ALL
-- R3 · REFUNDED AFTER THE NOTE — nothing voids a note when its expense reverses (V9).
SELECT 'R3', 'expense refunded after the note', payment_type, 'RED',
       COUNT(*), COUNT(DISTINCT HOUSEMAID_ID), ROUND(SUM(AMOUNT))
FROM j WHERE REFUNDED AND REFUND_DATE > NOTE_DATE GROUP BY payment_type

UNION ALL
-- R4 · NOTE EXCEEDS ITS REQUEST — AED only; other currencies are BLOCKED, never matched.
SELECT 'R4', 'note exceeds approved request', payment_type, 'RED',
       COUNT(*), COUNT(DISTINCT HOUSEMAID_ID), ROUND(SUM(AMOUNT - req_amount))
FROM j WHERE CURRENCY_NAME = 'AED' AND AMOUNT > req_amount + 0.01 GROUP BY payment_type

UNION ALL
-- R5 · APPROVAL OWED AND NOT GIVEN — only where the head requires it on every request.
SELECT 'R5', 'unapproved where approval required', payment_type, 'RED',
       COUNT(*), COUNT(DISTINCT HOUSEMAID_ID), ROUND(SUM(AMOUNT))
FROM j WHERE APPROVAL_METHOD = 'APPROVAL_REQUIRED' AND apr IS NULL GROUP BY payment_type

UNION ALL
-- R6 · PAID OVER THE HEAD'S OWN LIMIT WITHOUT APPROVAL.
--   ⚠️ LIMIT_FOR_APPROVAL is a THRESHOLD ABOVE WHICH approval is needed, not a ceiling.
--   Below it, an unapproved request is CORRECT — reading it the other way turned 217
--   compliant notes into a AED 20,532 finding once already.
SELECT 'R6', 'over approval limit, unapproved', payment_type, 'RED',
       COUNT(*), COUNT(DISTINCT HOUSEMAID_ID), ROUND(SUM(AMOUNT))
FROM j
WHERE APPROVAL_METHOD = 'APPROVAL_REQUIRED_ON_LIMIT'
  AND req_amount > LIMIT_FOR_APPROVAL AND apr IS NULL
GROUP BY payment_type

UNION ALL
-- R7 · SELF-APPROVED BY SOMEONE WHO IS NOT THE DESIGNATED HOLDER.
--   ⚠️ Self-approval BY the holder is the configured path and is excluded here.
--   ⚠️ A batch job stamps one identity into both fields — check concentration before
--   calling any large count here misconduct (8,095 anti-attrition notes, 3 identities).
SELECT 'R7', 'self-approved, not the holder', payment_type, 'AMBER',
       COUNT(*), COUNT(DISTINCT HOUSEMAID_ID), ROUND(SUM(AMOUNT))
FROM j
WHERE req IS NOT NULL AND apr = req AND (holder IS NULL OR holder <> req)
GROUP BY payment_type

UNION ALL
-- R8 · SAME-DAY REPEAT — screening only. A legitimate two-contract split sums to ONE
--   entitlement, so this is a population to adjudicate, never a finding on its own.
SELECT 'R8', 'same-day repeat (screen)', payment_type, 'AMBER',
       SUM(same_day_notes), COUNT(DISTINCT HOUSEMAID_ID), ROUND(SUM(same_day_aed))
FROM dup GROUP BY payment_type

ORDER BY test_id, aed DESC NULLS LAST;
