-- =====================================================================================
-- GROUP F — RAFFLE PRIZE. AED 180,000 · 576 notes · 12 months · 100% payroll-internal.
-- The entitlement source (N12: RaffleDrawParticipant, RaffleDraw, RaffleDrawPrizeGrand,
-- RaffleTicketLog, RaffleDrawLog) is NOT in the warehouse, so "was this maid a winner?"
-- cannot be asked. Three things can be, and none of them need the ingestion.
-- =====================================================================================

-- R1. The shape. P5 showed EXACTLY 48 notes a month for 12 straight months at a modal 200 —
--   consistent with a fixed prize pool, not suspicious on its own. This pins down the amounts,
--   the draw days, and whether 48 is genuinely invariant.
SELECT DATE_TRUNC('month', NOTE_DATE)::DATE   AS mth,
       COUNT(*)                               AS wins,
       COUNT(DISTINCT HOUSEMAID_ID)           AS distinct_winners,
       COUNT(DISTINCT NOTE_DATE::DATE)        AS draw_days,
       MIN(NOTE_DATE::DATE)                   AS first_day,
       MAX(NOTE_DATE::DATE)                   AS last_day,
       COUNT(DISTINCT AMOUNT)                 AS distinct_amounts,
       MIN(AMOUNT)                            AS min_amount,
       MAX(AMOUNT)                            AS max_amount,
       ROUND(SUM(AMOUNT))                     AS aed
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Raffle Prize'
  AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
GROUP BY 1
ORDER BY 1;

-- R2. 🔴 DOES IT BEHAVE LIKE A RANDOM DRAW? 576 wins over 12 months. The number of maids
--   winning twice or more is fixed by the size of the eligible pool, so the observed count
--   means NOTHING until the chance rate is computed. This project has already published one
--   corroboration test that scored exactly chance and read as a finding (trap 17).
--   For a pool of N, 48 winners a month, p = 48/N per month:
--     expected maids with >= 2 wins = N x [ 1 - (1-p)^12 - 12p(1-p)^11 ]
--   The pool is estimated TWO WAYS and both are reported, because the answer depends on it:
--     (a) maids who received any addition in the window — active and paid
--     (b) maids on the roster with no termination date
WITH wins AS (
    SELECT HOUSEMAID_ID, COUNT(*) AS n_wins
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION' AND REASON = 'Raffle Prize'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
    GROUP BY 1
), pool_a AS (
    SELECT COUNT(DISTINCT HOUSEMAID_ID) AS n
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES
    WHERE NOTE_TYPE = 'ADDITION'
      AND NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND NOTE_DATE <= CURRENT_DATE()
), pool_b AS (
    SELECT COUNT(*) AS n
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO
    WHERE DATE_OF_TERMINATION IS NULL
), obs AS (
    SELECT COUNT(*) AS distinct_winners, SUM(n_wins) AS total_wins,
           COUNT_IF(n_wins >= 2) AS won_twice_or_more,
           COUNT_IF(n_wins >= 3) AS won_three_or_more,
           MAX(n_wins) AS most_wins_by_one_maid
    FROM wins
)
SELECT o.distinct_winners, o.total_wins, o.won_twice_or_more, o.won_three_or_more,
       o.most_wins_by_one_maid,
       a.n AS pool_a_paid_maids,
       ROUND(a.n * (1 - POWER(1 - 48.0/a.n, 12) - 12*(48.0/a.n)*POWER(1 - 48.0/a.n, 11)), 1)
                                                        AS chance_repeats_pool_a,
       ROUND(o.won_twice_or_more / NULLIF(
             a.n * (1 - POWER(1 - 48.0/a.n, 12) - 12*(48.0/a.n)*POWER(1 - 48.0/a.n, 11)), 0), 2)
                                                        AS times_chance_pool_a,
       b.n AS pool_b_active_roster,
       ROUND(b.n * (1 - POWER(1 - 48.0/b.n, 12) - 12*(48.0/b.n)*POWER(1 - 48.0/b.n, 11)), 1)
                                                        AS chance_repeats_pool_b,
       ROUND(o.won_twice_or_more / NULLIF(
             b.n * (1 - POWER(1 - 48.0/b.n, 12) - 12*(48.0/b.n)*POWER(1 - 48.0/b.n, 11)), 0), 2)
                                                        AS times_chance_pool_b
FROM obs o CROSS JOIN pool_a a CROSS JOIN pool_b b;

-- R3. 🔴 IS THE DRAW BIASED BY CONTRACT TYPE? Wins split Normal 257 / FREEDOM_OPERATOR 231 /
--   MAID_VISA 58 / WALKIN 30 — FOs take 40% of the prizes. A fair draw mirrors its pool, so
--   this compares win share against the share of maids receiving ANY addition in the window.
--   ⚠️ That denominator is a PROXY for the eligible pool — the real one is
--   RaffleDrawParticipant, not ingested. A large gap is a question, not a verdict.
WITH pool AS (
    SELECT COALESCE(h.HOUSEMAID_TYPE, '(unknown)') AS contract_type,
           COUNT(DISTINCT n.HOUSEMAID_ID)          AS maids_in_pool
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
    GROUP BY 1
), winners AS (
    SELECT COALESCE(h.HOUSEMAID_TYPE, '(unknown)') AS contract_type,
           COUNT(*) AS wins, COUNT(DISTINCT n.HOUSEMAID_ID) AS winning_maids,
           ROUND(SUM(n.AMOUNT)) AS aed
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Raffle Prize'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
    GROUP BY 1
)
SELECT p.contract_type, p.maids_in_pool,
       ROUND(100.0 * p.maids_in_pool / SUM(p.maids_in_pool) OVER (), 1)       AS pct_of_pool,
       COALESCE(w.wins, 0)                                                    AS wins,
       ROUND(100.0 * COALESCE(w.wins,0) / SUM(COALESCE(w.wins,0)) OVER (), 1) AS pct_of_wins,
       ROUND( (100.0 * COALESCE(w.wins,0) / NULLIF(SUM(COALESCE(w.wins,0)) OVER (),0))
            / NULLIF(100.0 * p.maids_in_pool / SUM(p.maids_in_pool) OVER (), 0), 2) AS times_expected,
       COALESCE(w.aed, 0)                                                     AS aed
FROM pool p LEFT JOIN winners w ON w.contract_type = p.contract_type
ORDER BY times_expected DESC NULLS LAST;

-- R5. 🔴 DID A TERMINATED MAID WIN? The one clean entitlement test available without the
--   raffle tables — the same shape that cleared MV Prorated Salary (MV1).
SELECT CASE
         WHEN h.DATE_OF_TERMINATION IS NULL                     THEN 'not terminated — fine'
         WHEN h.DATE_OF_TERMINATION::DATE >= n.NOTE_DATE::DATE   THEN 'terminated on/after the draw — fine'
         WHEN DATEDIFF('day', h.DATE_OF_TERMINATION, n.NOTE_DATE) <= 31
                                                                 THEN '⚠️ terminated within a month before'
         ELSE                                                         '🔴 TERMINATED BEFORE THE DRAW'
       END                                     AS verdict,
       COUNT(*)                                AS wins,
       COUNT(DISTINCT n.HOUSEMAID_ID)          AS maids,
       ROUND(SUM(n.AMOUNT))                    AS aed,
       ROUND(MEDIAN(DATEDIFF('day', h.DATE_OF_TERMINATION, n.NOTE_DATE))) AS median_days_after_termination
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Raffle Prize'
  AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
GROUP BY 1
ORDER BY aed DESC;

-- R2/R5 RESULTS 2026-09-08.
--   R2 — 🔴 THE DRAW IS NOT UNIFORM, AND THE RESULT IS ROBUST TO THE POOL CHOICE.
--     465 distinct winners took 576 prizes.
--     won twice or more ..... 88 observed · 21.5 expected on pool A (6,738 paid maids) · 4.09x
--     won three or more ..... 18 observed · ~0.7 expected                              · ~26x
--     most wins by one maid .. 5
--     On the full roster (83,533) it is 48x. Even the SMALLEST, most conservative pool gives
--     4x, which is why the conclusion does not depend on which pool is right.
--     ⚠️ NOT EVIDENCE OF A RIGGED DRAW. RaffleDrawParticipant carries a `points` field, so a
--     WEIGHTED draw is plausible, and under weighting repeat winners are the DESIGNED
--     behaviour. The audit can show the draw is not uniform; it cannot tell designed weighting
--     from bias without N12. That is what the ingestion actually buys, on AED 180,000 a year.
--   R5 — 🔴 15 PRIZES TO MAIDS WHO HAD ALREADY LEFT.
--     not terminated ................ 503 wins · 404 maids · AED 163,600
--     terminated on/after the draw ... 58 wins ·  49 maids · AED  13,400 (median -124 days)
--     🔴 TERMINATED BEFORE THE DRAW ... 15 wins ·  13 maids · AED   3,000 · median 558 DAYS
--     Eighteen months gone, and still drawn. Unlike R2 this needs no interpretation: a prize
--     paid to someone who left is money out with nobody entitled to it.

-- R3b. The same bias test on NATIONALITY. Added after R2 showed the draw is not uniform:
--   once weighting is established, the useful question is WHAT it is weighted toward, and
--   contract type is only one axis. Same proxy pool, same caveat — a gap is a question.
WITH pool AS (
    SELECT COALESCE(h.NATIONALITY, '(unknown)') AS nationality,
           COUNT(DISTINCT n.HOUSEMAID_ID)       AS maids_in_pool
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
    GROUP BY 1
), winners AS (
    SELECT COALESCE(h.NATIONALITY, '(unknown)') AS nationality,
           COUNT(*) AS wins, ROUND(SUM(n.AMOUNT)) AS aed
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES n
    LEFT JOIN BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO h ON h.ID = n.HOUSEMAID_ID
    WHERE n.NOTE_TYPE = 'ADDITION' AND n.REASON = 'Raffle Prize'
      AND n.NOTE_DATE >= DATEADD('month', -12, CURRENT_DATE()) AND n.NOTE_DATE <= CURRENT_DATE()
    GROUP BY 1
)
SELECT p.nationality, p.maids_in_pool,
       ROUND(100.0 * p.maids_in_pool / SUM(p.maids_in_pool) OVER (), 1)       AS pct_of_pool,
       COALESCE(w.wins, 0)                                                    AS wins,
       ROUND(100.0 * COALESCE(w.wins,0) / SUM(COALESCE(w.wins,0)) OVER (), 1) AS pct_of_wins,
       ROUND( (100.0 * COALESCE(w.wins,0) / NULLIF(SUM(COALESCE(w.wins,0)) OVER (),0))
            / NULLIF(100.0 * p.maids_in_pool / SUM(p.maids_in_pool) OVER (), 0), 2) AS times_expected,
       COALESCE(w.aed, 0)                                                     AS aed
FROM pool p LEFT JOIN winners w ON w.nationality = p.nationality
WHERE p.maids_in_pool >= 20
ORDER BY times_expected DESC NULLS LAST;
