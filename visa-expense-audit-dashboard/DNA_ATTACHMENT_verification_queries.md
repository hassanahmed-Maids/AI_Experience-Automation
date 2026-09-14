# Verification queries — every measured figure, and the query that produces it

Attachment to the DNA ticket pack for the **consolidated visa expense audit dashboard**.
Companion to `DESIGN.md` (start there) and `DNA_ATTACHMENT_source_tables.md`.

Owner: Hassan Ahmed, Police & Control · Drafted 2026-09-14

---

## ⚠️ Read this before running anything

**None of the queries below has been executed.** They were written from the seven specs, which each
measured their own figures in their own discovery runs. Every table and column name in them came
from a spec that measured it; none was invented. But the queries themselves are **reconstructions
of how a figure was produced, not a re-run of it.**

That is deliberate, and it is the point of this attachment: the acceptance criteria in the tickets
name figures, and a figure without the query that made it is a number nobody can argue with.

**So: treat the first run as the measurement, and the spec figure as the control.** A gap between
them is information — §4 says what to do with it, and *"the spec was wrong"* is one of the permitted
answers.

**Two rules for everything here:**

1. 🔴 **Aggregate only.** Every query below returns counts and sums. None returns a row-level list,
   and none selects a column from the sensitivity register in `DNA_ATTACHMENT_source_tables.md`.
   Where a figure needs a case list to investigate, that list belongs in the dashboard behind the
   P&C role — not in a verification script, not in a chat reply, not in an email.
2. 🔴 **Controls first.** §1 runs before §2 and §3. If a control fails, every figure downstream of
   it is unsafe and must not be quoted, reconciled, or argued about until the control passes. Three
   of the specs published wrong numbers precisely because a figure was trusted before its guard was.

**Refresh is manual and on demand.** Nothing here is scheduled, and nothing here becomes a task, a
stream, or a standing unattended run. A recurring Snowflake process goes to the ERP/Data team.

---

## §0 · How to run

```sql
-- Read scope. Substitute the real target schema at deploy.
USE ROLE      <the P&C analytics role>;
USE WAREHOUSE <the ad-hoc warehouse>;
USE SCHEMA    POLICE_CONTROL.VISA_AUDIT;
```

`§1` and `§2` run against the shared layer (`V_TXN`, `V_LOAN_LATEST`, `V_VISA_EXPENSE_LINE`,
`DIM_MAID`, `DIM_PRICE_ERA`) once `10_shared.sql` is deployed. Controls **C1–C5** are written against
raw `BA_VIEWS` on purpose — they check the warehouse itself, so they must not read through a view
that already fixes what they are testing for.

---
---

# §1 · Controls — these run first, and a failure stops everything downstream

| Id | Guards | Expected | If it fails |
|---|---|---|---|
| C1 | the loan snapshot | dedupe is real | every money figure in ILOE, COS and E-ID is unsafe |
| C2 | `CONTRACT_TYPE` trailing space | `TRIM` is applied | CC or MV reads as empty |
| C3 | the two clocks | the right one is used per audit | 28% of entry-visa charges vanish |
| C4 | `REMAINING_AMOUNT` | it is inert | every loan reads as settled |
| C5 | `IS_DELETED` | it is inert | a whole measurement set is void |
| C6 | the float residue on the COS fine | the cents guard exists | `COS.R3` fires 7× too often, **and both tie-outs still read 0.00** |
| C7 | visa-request id collision | ids are scoped by request type | medical overstates by 42% |
| C8 | renewal task re-fire | tasks aggregated per request | a population overstates by 158× |
| C9 | `D2 → D1` nullability | unmatched lines kept | 1,772 lines silently dropped |
| C10 | `D9` contract fan-out | aggregated before join | COS collected inflates |
| C11 | the LAWP replacement join | it resolves to `CANCEL_VISA_REQUESTS` | wrong every time, silently |
| C12 | `HOUSEMAIDS_VISA_INFORMATION` grain | deduplicated per maid | E-ID fans out 5–20× |

---

### C1 · The loan table is snapshot history, not one row per loan

🔴 **The most expensive guard in the build.** ILOE overstated subscriptions by **AED 241,161
(+21.7%)** and fines by **AED 97,089 (+15.0%)**; E-ID's replacement figure **moved AED 5,041.82
between two runs of the same query**; COS shipped a **false AED 250 over-loan finding twice.**

```sql
-- C1a — the raw table is NOT one row per loan.
SELECT COUNT(*)                       AS RAW_ROWS,
       COUNT(DISTINCT ID)             AS DISTINCT_LOANS,
       COUNT(*) - COUNT(DISTINCT ID)  AS SNAPSHOT_EXCESS   -- expect > 0
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS;

-- C1b — the shared view IS. This must be exactly 0.
SELECT COUNT(*) - COUNT(DISTINCT LOAN_ID) AS MUST_BE_ZERO
FROM V_LOAN_LATEST;

-- C1c — the two named dedupe reductions the tickets accept on.
SELECT TYPE                     AS LOAN_TYPE,
       COUNT(*)                 AS RAW_ROWS,
       COUNT(DISTINCT ID)       AS DISTINCT_LOANS
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS
WHERE TYPE IN ('OVERSTAY_FINES_FEES','REPEAT_EID')
GROUP BY 1;
-- Expect  OVERSTAY_FINES_FEES  415 -> 405
--         REPEAT_EID           257 -> 169

-- C1d — the tie-break must be EXPLICIT. ILOE measured 5 loans that tie, one four ways.
-- A non-zero count here is fine; it is why QUALIFY ROW_NUMBER() is used and MAX() is not.
SELECT COUNT(*) AS TIED_LOANS
FROM (
    SELECT ID
    FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS
    GROUP BY ID
    HAVING COUNT(*) > 1
       AND COUNT(DISTINCT COALESCE(REPAID_AMOUNT,0) + COALESCE(WAIVED_AMOUNT,0)) = 1
);
-- Expect ~5. Non-deterministic between runs if MAX() was used instead.
```

---

### C2 · `CONTRACT_TYPE` carries a trailing space

🔴 `= 'CC'` matches **zero rows and raises no error** — it reads exactly like *"no findings for CC"*.

```sql
SELECT CONTRACT_TYPE                              AS RAW_VALUE,
       LENGTH(CONTRACT_TYPE)                      AS RAW_LEN,
       UPPER(TRIM(CONTRACT_TYPE))                 AS TRIMMED,
       COUNT(*)                                   AS ROWS
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
GROUP BY 1,2,3
ORDER BY ROWS DESC;
-- Expect 'CC ' and 'MV ' at LENGTH 3. ~622,448 rows measured untrimmed on this column.

-- The failure, made visible:
SELECT COUNT_IF(CONTRACT_TYPE = 'CC')             AS EXACT_MATCH,   -- expect 0
       COUNT_IF(TRIM(CONTRACT_TYPE) = 'CC')       AS TRIMMED_MATCH  -- expect >> 0
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES;
```

---

### C3 · Two clocks, and they are not interchangeable

🔴 The posting clock **loses 257 of 913 entry-visa turn-down charges — 28%** — and scrambles the
order of events so a clean case reads unexplained.

```sql
SELECT DATEDIFF('day', CAST(e.CREATION_DATE AS DATE), t.TRANSACTION_DATE) AS LAG_DAYS,
       COUNT(*)                                                          AS LINES
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t ON t.ID = e.TRANSACTION_ID
GROUP BY 1
ORDER BY 1;
-- Expect a median of 1 day and a tail to 16.

-- C3b — the same population on each clock. The difference IS the trap.
SELECT COUNT_IF(CAST(e.CREATION_DATE AS DATE) >= DATE'2025-09-05') AS ON_APPLICATION_CLOCK,
       COUNT_IF(t.TRANSACTION_DATE            >= DATE'2025-09-05') AS ON_POSTING_CLOCK
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
JOIN BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t ON t.ID = e.TRANSACTION_ID
WHERE e.PURPOSE = 'ENTRY_VSIA';   -- 🔴 misspelled in the live system, and it stays misspelled
```

---

### C4 · `REMAINING_AMOUNT` is inert

```sql
SELECT COUNT(*)                                        AS ROWS,
       COUNT_IF(REMAINING_AMOUNT = 0)                  AS ZERO_ROWS,      -- expect = ROWS
       COUNT_IF(REMAINING_AMOUNT <> 0)                 AS NONZERO_ROWS,   -- expect 0
       COUNT_IF(STATUS = 'NOT_YET_PAID'
                AND REMAINING_AMOUNT = 0)              AS UNPAID_BUT_ZERO -- expect > 0
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS;
-- Outstanding is ALWAYS  AMOUNT - REPAID_AMOUNT - WAIVED_AMOUNT.
```

---

### C5 · `IS_DELETED` is TEXT and inert

🔴 R-visa v6 **withdrew an entire measurement set** taken through it.

```sql
SELECT IS_DELETED, COUNT(*) AS ROWS
FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS
GROUP BY 1;
-- Expect only '0' and '00'. A boolean test matches nothing and reads as "none deleted".
```

---

### C6 · The float residue on the COS fine

🔴 The worst guard in the set, because **both COS tie-outs still read variance 0.00 while it is
broken.** `COS.R3` fires **35 times in July instead of 5** — thirty fully-recovered cases showing
AED 0.00 at risk — and the identities are algebraically incapable of catching it.

```sql
-- Derive FINE_CENTS ONCE, in integers, and build every test on it.
SELECT COUNT_IF(ROUND(TRANSACTION_AMOUNT*100) - 57565 = 0)      AS EXACT_GATE_INT,
       COUNT_IF(TRANSACTION_AMOUNT - 575.65      = 0)           AS EXACT_GATE_FLOAT,
       COUNT_IF(ABS(TRANSACTION_AMOUNT - 575.65) < 0.000000001
                AND TRANSACTION_AMOUNT - 575.65 <> 0)           AS RESIDUE_ROWS  -- the trap
FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS
WHERE EXPENSE_ID = <the COS head>
  AND TRANSACTION_DATE >= DATE'2025-12-19';
-- RESIDUE_ROWS > 0 and EXACT_GATE_FLOAT < EXACT_GATE_INT is the defect. Residue ~1.14e-13.
```

---

### C7 · Visa-request ids collide across request types

🔴 Reading "either table by id" inflated medical's eligible population **1,153 → 1,211** and
never-claimed **132 → 188** — a **42% overstatement that looks like a bigger finding rather than a
bug.**

```sql
SELECT COUNT(*) AS COLLIDING_IDS
FROM      BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS i
JOIN      BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS   r ON r.REQUEST_ID = i.REQUEST_ID;
-- Expect ~19,997. Every request-keyed read must carry its request TYPE.
```

---

### C8 · The renewal task table re-fires

🔴 **335,583 `ONGOING` rows sit on 2,120 distinct requests** — counting rows overstates by **158×**.

```sql
SELECT COUNT(*)                            AS TASK_ROWS,
       COUNT(DISTINCT VISA_REQUEST_ID)     AS DISTINCT_REQUESTS,
       MAX(ITERATIONS)                     AS MAX_PER_REQUEST
FROM (
    SELECT VISA_REQUEST_ID, COUNT(*) AS ITERATIONS
    FROM BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS_TASKS
    WHERE STATUS = 'ONGOING'
    GROUP BY 1
);
-- Expect ~335,583 / ~2,120 / up to 1,909. Aggregate to one row per request before ANY join.
```

---

### C9 · `VISAREQUESTEXPENSES.TRANSACTION_ID` is nullable

```sql
SELECT COUNT(*)                                       AS LINES,
       COUNT_IF(e.TRANSACTION_ID IS NULL)             AS NO_TXN_ID,
       COUNT_IF(e.TRANSACTION_ID IS NOT NULL
                AND t.ID IS NULL)                     AS UNMATCHED
FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES e
LEFT JOIN BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS t ON t.ID = e.TRANSACTION_ID;
-- 1,770 R-visa lines and 2 COS transactions have no counterpart.
-- 🔴 LEFT JOIN and KEEP them. An INNER JOIN drops findings silently.
```

---

### C10 · `CONTRACTS` fans out

```sql
SELECT CONTRACTS_PER_MAID, COUNT(*) AS MAIDS
FROM (
    SELECT HOUSEMAID_ID, COUNT(*) AS CONTRACTS_PER_MAID
    FROM BA_VIEWS.SALES_SILVER.CONTRACTS
    WHERE FAKE = FALSE
    GROUP BY 1
)
GROUP BY 1 ORDER BY 1;
-- Of 704 July maids: 645 one · 38 two · 3 three · 1 four · 17 none.
-- Aggregate per transaction in a subquery BEFORE joining back, or COS.M8 inflates.
```

---

### C11 · `LINKED_REPLACEMENT_ID` resolves against two tables — LAWP

🔴 **The wrong join silently succeeds and is wrong every time.**

```sql
SELECT COUNT(*)                                  AS LINKED_ROWS,
       COUNT_IF(c.REQUEST_ID IS NOT NULL)        AS MATCHES_CANCEL,    -- expect 22,862 / 22,862
       COUNT_IF(i.REQUEST_ID IS NOT NULL)        AS MATCHES_INITIAL    -- expect ~97.6%
FROM      BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS      s
LEFT JOIN BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS       c ON c.REQUEST_ID = s.LINKED_REPLACEMENT_ID
LEFT JOIN BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS      i ON i.REQUEST_ID = s.LINKED_REPLACEMENT_ID
WHERE s.LINKED_REPLACEMENT_ID IS NOT NULL;
-- Join to CANCEL_VISA_REQUESTS.

-- C11b — one hop up the chain is not enough.
-- Expect 599 of 6,085 REPLACEMENT bundles (9.8%) landing on a request that is ITSELF REPLACEMENT.
```

---

### C12 · `HOUSEMAIDS_VISA_INFORMATION` is one row per request — E-ID

```sql
SELECT COUNT(*)                            AS ROWS,
       COUNT(DISTINCT HOUSEMAID_ID)        AS DISTINCT_MAIDS,
       ROUND(COUNT(*) / NULLIF(COUNT(DISTINCT HOUSEMAID_ID),0), 1) AS FANOUT
FROM BA_VIEWS.VISA_SILVER.HOUSEMAIDS_VISA_INFORMATION;
-- Expect a fan-out of 5–20×. The same E-ID query returned 1,682 charges for 82 maids
-- before the dedupe and 95 after.
```

---
---

# §2 · Tie-outs — each one is displayed on its audit tab, and a non-zero variance is a finding

🔴 **A tie-out computed from one side is decoration.** A prior entry-visa version used
`LEAST(a,b) + GREATEST(a−b,0) ≡ a`, which is **algebraically incapable of failing**, and fed a
deliberately dead refund join it reported **variance 0 while finding nothing.** Every identity below
is stated with its terms named so it can be read for that defect before it is run.

---

### T-COS-1 · Change of status, identity 1

`(charges × 575.65) + SUM(fines) + SUM(unclassified overage) = COS.M1`

```sql
SELECT DATE_TRUNC('month', TRANSACTION_DATE)                      AS MONTH,
       COUNT(*)                                                   AS CHARGES,
       ROUND(COUNT_IF(ROUND(TRANSACTION_AMOUNT*100) = 57565) * 575.65, 2) AS GATE_TERM,
       ROUND(SUM(CASE WHEN ROUND(TRANSACTION_AMOUNT*100) > 57565
                      THEN TRANSACTION_AMOUNT - 575.65 END), 2)   AS FINE_TERM,
       ROUND(SUM(CASE WHEN <unclassified test> THEN TRANSACTION_AMOUNT END), 2) AS OVERAGE_TERM,
       ROUND(SUM(TRANSACTION_AMOUNT), 2)                          AS COS_M1,
       ROUND(SUM(TRANSACTION_AMOUNT)
             - (COUNT_IF(ROUND(TRANSACTION_AMOUNT*100) = 57565) * 575.65)
             - SUM(CASE WHEN ROUND(TRANSACTION_AMOUNT*100) > 57565
                        THEN TRANSACTION_AMOUNT - 575.65 END), 2) AS VARIANCE
FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS
WHERE EXPENSE_ID = <the COS head>
  AND TRANSACTION_DATE >= DATE'2025-12-19'
GROUP BY 1 ORDER BY 1;
```

| Expected, July 2026 | |
|---|---|
| `405,257.60 + 77,250.00 + 0.00` | `= 482,507.60` |
| Variance | **AED 0.00 in all ten live months** |

🔴 **The overage term is not optional.** Without it the identity fails in **five of the ten months**,
by **AED 40,967.35 in January 2026 alone.**

---

### T-COS-2 · Change of status, identity 2 — the fine decomposition

`55,025 + 8,775 + 2,325 + 1,300 + 500 + 9,325 + 0 = 77,250`, variance **0.00**.

🔴 **The seventh term is zero in all ten months and must still exist**, or a grey case silently
vanishes. A term that is always zero is exactly the term a developer deletes.

---

### T-ILOE · ILOE

`AED 1,163,242.82 = 587,351.55 + 575,891.27`, variance **AED 0.00**.

```sql
SELECT ROUND(SUM(LOAN_AMOUNT), 2)                                   AS TOTAL,
       ROUND(SUM(CASE WHEN LOAN_CLASS = 'SUBSCRIPTION'
                      THEN LOAN_AMOUNT END), 2)                     AS SUBSCRIPTION_TERM,
       ROUND(SUM(CASE WHEN LOAN_CLASS = 'FINE'
                      THEN LOAN_AMOUNT END), 2)                     AS FINE_TERM,
       ROUND(SUM(LOAN_AMOUNT)
             - SUM(CASE WHEN LOAN_CLASS IN ('SUBSCRIPTION','FINE')
                        THEN LOAN_AMOUNT END), 2)                   AS VARIANCE
FROM V_CASES_ILOE;   -- reads V_LOAN_LATEST, so C1 must pass first
```

**And the classification must be exhaustive:** `3,018 + 31,629 + 47 = 34,694` — the whole
maid-linked population. Nothing falls out of the bottom unclassified.

---

### T-MED · Medical — both sides

Cases: `132 + 41 + 9 + 971 = 1,153`. Money: `29,490 + 10,420 + 2,430 + 230,670 = 273,010`.

⚠️ Depends on **C7** (id collision). Without it this reads `1,211` and `188`, and looks like a
bigger finding.

---

### T-EV · Entry visa — 🔴 both sides, counted independently

| Side | Identity |
|---|---|
| Charge | `913 = 697 + 216` |
| Refund | `892 = 701 + 119 + 70 + 2` |
| **Cross-check** | **701 vs 697** |

**The 4-row excess is listed case by case and never absorbed.** An identity that reconciles by
construction proves nothing — see the warning at the top of §2.

⚠️ Depends on **C3**: on the posting clock the charge side reads 656, not 913.

---

### T-LAWP · LAWP reservoir — both grains

```
payments  6,767 +   296 +     3 +     45 +     202  =  7,313          variance 0
money     9,749,141.90 + 424,004.80 + 1,781.31
                       +  63,897.92 + 271,171.06    = 10,509,996.99
```

🔴 **Grain control, both displayed: 202 payments behind 232 bundles.** A money figure computed per
bundle rather than per payment **overstates by the 41% that broke the prior dashboard.**

---

### T-EID · E-ID — the class tie-out

`19,033 + 57 + 256 + 789 + 5 + 2 = 20,142` rows, **AED 7,007,545.03**, variance **AED 0.00**.
Publish the variance every run; a non-zero value blocks the report.

⚠️ **The honest limit of a same-table tie-out:** AED 442.11 is a **bundle** (382.10 application +
60.01 typing), not a price. `TYPING_SERVICE` must be tested **before** `APPLICATION`, and the class
split then understates typing by **~AED 27,485** — **while this tie-out still balances.** The
identity cannot see it; only the ordering of the tests prevents it.

---

### T-RVISA · R-visa — the population waterfall

`71,791 − 802 − 1,770 − 1 = 69,218`, residual **0**.

```sql
SELECT COUNT(*)                                          AS GROSS,          -- 71,791
       COUNT_IF(NOT IS_USABLE_INPUT)                     AS FAILED_GUARD,   --    802
       COUNT_IF(TRANSACTION_ID IS NULL)                  AS NO_TXN,         --  1,770
       COUNT_IF(LINES_ON_TXN > 1)                        AS SHARED_TXN,     --      1
       COUNT(*) - COUNT_IF(NOT IS_USABLE_INPUT)
                - COUNT_IF(TRANSACTION_ID IS NULL)
                - COUNT_IF(LINES_ON_TXN > 1)             AS NET             -- 69,218
FROM V_VISA_EXPENSE_LINE
WHERE EXPENSE_ID IN (<R-VISA-HEADS, including 149 — cleaners are IN scope>);
```

🔴 **The sanity test, published every run:** bucket B **median renewal gap 716 days** against a
**730-day term**. *If that median ever drifts far from the term, the term rule is broken and every
bucket below it is unsafe.* This is the one control that checks the model's assumption rather than
its arithmetic.

---
---

# §3 · The measured figures

Each is the number the ticket accepts on. Where a figure has a **named tripwire** — a specific wrong
answer that identifies a specific missing guard — it is given, because a wrong number that is
recognisable is worth more than one that is merely wrong.

## Change of status

| Metric | Expected | Tripwire |
|---|---|---|
| `COS.M12` money at risk | **AED 9,325** · 6 red · 34 amber · 0 grey · **5.8% of 104 fines** (July 2026) | |
| `COS.M1` | **AED 482,507.60** over **704** charges | |
| `COS.M7` charged above the gate | **AED 68,300** | |
| `COS.M8` collected | **AED 50,750** (**74.3%**) | inflated ⇒ **C10** missing |
| `COS.R6` over-loan | **exactly 0 in July** | **a result of 1 ⇒ C1 missing.** This finding shipped false twice |
| `COS.R3` | **exactly 5 in July** | **a result near 35 ⇒ C6 missing.** Both tie-outs still read 0.00 |

⚠️ **Only July has been worked case by case.** `R10` was found in August and `R5` has never fired —
two of the ten rules rest on aggregates. Acknowledged on the tab.
`R1` has fired **twice in nine months**, and the prior-month lookback has never added a case; over
ten years the same maid was charged twice inside 90 days **26 times**, so the rule is real but rare.

## ILOE

| Metric | Expected |
|---|---|
| `ILOE.R2` / `R3` / `R4` cases | **1,530 / 364 / 6** |
| `ILOE.R2` / `R3` / `R4` money | **AED 575,891.27 / 82,138.25 / 864.58** |
| Classification exhaustive | `3,018 + 31,629 + 47 = 34,694` |

🔴 **`ILOE.R1` is the case where the *maid* paid twice and is owed AED 124.** `WHO_IS_OUT_OF_POCKET`
is not always `COMPANY`, and a dashboard that assumes it is will route the row to the wrong person.

## Medical

| Metric | Expected | Note |
|---|---|---|
| `MED.M1` | **AED 39,910** | Jan 2025 onward **only** — the headline stays collectable |
| `MED.M2` | **173** cases | |
| `MED.M3` | **11.6%** latest quarter | |
| No-fee-charged class | **119** cases, carrying **no AED** | 🔴 `AMOUNT_AED` is **NULL, never 0** |
| Pre-2025 findings | reported **separately**, labelled *historical leak, not recoverable* | the portal window for a 2024 claim has almost certainly closed |

🔴 Depends on the **maid-id join**, not the request-id join: only **2.3%** of fee/refund pairs share
a visa request id. The request-id join reports **~98% of cases as unrefunded.**

## Entry visa

| Metric | Expected | Tripwire |
|---|---|---|
| `EV.M0` population | **14,597** charges · **13,995** maids · **AED 12,413,890.03**, on the **application** clock | **AED 12,487,712.56 across 14,693 charges ⇒ the posting clock was used** |
| `EV.M2` red | **188** cases · **AED 90,276.00** (116 never filed · 72 cancelled by us) | |
| `EV.M3` paid twice | **105** charges over **99** maids · **AED 74,580.90** | |
| Total measured exposure | **AED 137,043** over 12.3 months | |

🔴 **The roadmap's AED 12,929,222 is NOT recoverable** — it is about **94× larger** than measured
exposure, and must never be quoted as recoverable. The roadmap row is being corrected.

🔴 **The 72 `Dismissed` claims are RED, not amber** — a dismissed entry-visa claim is *ours*, not
immigration's.

⚠️ **19 claims are dated before their turn-down stamp**, up to 74 days. **Display as `0` and flag the
row**, never as a negative age.

## LAWP reservoir

| Metric | Expected |
|---|---|
| Payment tie-out | `6,767 + 296 + 3 + 45 + 202 = 7,313`, variance **0** |
| Money tie-out | **AED 10,509,996.99** |
| Recoverable | **AED 63,897.92** over **45** payments |
| Lost | **AED 271,171.06** over **202** payments — **behind 232 bundles** |
| `M7` vs `M12 + M13` | 🔴 **two headline figures, side by side, never added** |

🔴 **`M7` prices paperwork nobody took; `M12`/`M13` price money paid twice. One payment can sit in
both.** The card carries the second (**AED 485,246.97**) below a rule with the reason printed.

🔴 **`R18` keys a duplicate on AMOUNT EQUALITY within AED 0.01.** **7,049 of the 7,171**
different-amount pairs are one fee booked under two purposes — a rule that merely counted rows would
red **AED 5.24M of correctly-paid money.**

⚠️ **`R13` / `M10` compare against Alert 945 / 944 (`DNA-4395`, `DNA-4396`). Do not rebuild the
alerts.**

## E-ID

| Metric | Expected | Tripwire |
|---|---|---|
| Class tie-out | `19,033 + 57 + 256 + 789 + 5 + 2 = 20,142` rows · **AED 7,007,545.03** · variance **0.00** | |
| `EID.M7` | **AED 57,390.34** over **149** red cases | 🔴 **never** with the MV amber AED 58,649.84 added — that asserts a AED 116,100 loss nobody has proven |
| `EID.M3` | **56** of 57 fines unrecovered · **AED 21,774.37** | **57 / AED 21,834.80 ⇒ the one recovered fine (maid 41504, txn 1640533) was missed.** **Near 0 ⇒ "any loan at all" was accepted instead of the two named loan types** |
| Amber duplicate band (121–599 days) | **47 pairs · AED 16,633.77** — kept, routed to the verifier | |
| `UNCLASSIFIED` | **5 rows · AED 3,295.85**, parked as pending | 🔴 **a rising unclassified count is the signal that the expense names changed again** — which is why the class exists |
| `MAID_SERVICES` completeness | **52** repeat-E-ID requests with no matching charge, published on the tab | the only independent completeness check audit 3 has |
| Counted, not valued | **63** cases | `AMOUNT_AED` is NULL |

⚠️ **MV replacements (131 cases, AED 58,649.84)** can be neither cleared nor condemned until
ingestion ask **N1** lands. Four independent tests confirm the recharge route is genuinely absent
from the warehouse, not merely unfound.

## R-visa

| Metric | Expected |
|---|---|
| Population waterfall | `71,791 − 802 − 1,770 − 1 = 69,218`, residual **0** |
| `RV.M3` duplicated, per request | **AED 16,853.50** over **45** cases |
| Bucket A, per maid | **AED 29,905** gross over **68** pairs |
| 🔴 `RV.M3` and bucket A | **different grains, different questions — do not add the two AED totals together** |
| `RV.M12` modification fines | heads **`1622` / `1649` / `1735`** only, **never** 50-step residue |
| S1 re-payer defect | **AED 8,870**, filed as **ONE process defect**, not twenty findings |
| Term-mismatch class | **25** cases |
| Bucket B sanity | **median 716 days** against a 730-day term |
| Head `149` (cleaners) | **present** · 211 transactions, zero negatives |
| Refund-before-duplicate | **3 cases return `BLOCKED`, not `CONFIRMED`** |
| `R1` rejected-refund leg | **a named out-of-coverage line with its size — never an absent rule** |

🔴 **Duplicates are treated as loss.** Recovery is **partial by design** — ~**239.50** against a
**443.50** fee, and **never full in 15 of 15 observed cases.** The ~**204** residue per case is
unrecoverable, so a refunded duplicate is still a loss.

🔴 **The 221 single-payment unexplained-amount cases are OUT of scope.** They belong to a
price-accuracy audit that does not yet exist. Do not widen this build to absorb them.

⚠️ **The fee schedule is not signed off.** The 50-dirham step, `293.50` and the refund amounts are
with Finance. `293.50` is marked in `DIM_PRICE_ERA` as **inference, not a source**. Every R-visa
money figure is provisional until that returns — and it does not block the build.

---
---

# §4 · When a figure does not match

**A gap is information, not a failure.** Work it in this order:

1. **Did a control in §1 fail?** Then the figure is unsafe and there is nothing to reconcile yet.
   Fix the guard and re-run. This accounts for most gaps, and three specs published wrong numbers by
   skipping this step.
2. **Is the gap the tripwire?** Several figures above have a named wrong answer that identifies a
   named missing guard — `COS.R3` near 35, `EID.M3` at 57, `EV.M0` at 12,487,712.56. If the result
   matches a tripwire, the diagnosis is already written.
3. **Is it the window?** Each audit is on its own clock and its own window — the spec figure is
   valid **only at the `Spec window` preset**. Comparing at any other preset is comparing two
   different questions.
4. **Is it time?** Several figures were measured weeks before the build runs. A figure that has
   grown by new cases in the interval is the check working, not the check failing. **Reconcile to
   named lines, not to a delta** — say which cases arrived, not just how much the number moved.
5. **Only then: the spec may be wrong.** That is a permitted answer and a useful one. Say so in the
   ticket with the query and the figure, and P&C re-rules. `DNA-9529` was withdrawn for exactly this
   reason, and withdrawing it was correct.

🔴 **What is never the answer:** adjusting a threshold, a date bound or a class test until the figure
matches. A tie-out that reconciles by construction is worse than no tie-out, because it reports
variance 0 while finding nothing.

---

## What these queries deliberately do not do

| | Why |
|---|---|
| Return a row-level case list | Aggregate only. Case lists live in the dashboard behind the P&C role |
| Select any column in the sensitivity register | Enforced by column name, not by intent — see `DNA_ATTACHMENT_source_tables.md` |
| Render a maid's name | **`Maid #<id>`**, everywhere. Name-keying measured **4% precise** |
| Produce a total across audits | Money sums **only within an `EXPOSURE_CLASS`**. Three specs independently forbid a combined figure |
| Run on a schedule | Manual, on demand. A recurring Snowflake process goes to the ERP/Data team |
