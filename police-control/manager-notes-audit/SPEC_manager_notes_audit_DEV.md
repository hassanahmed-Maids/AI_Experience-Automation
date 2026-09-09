# Manager Notes Audit — developer spec

**Owner** Police & Control · **Rev** 2026-09-08 (v3) · **Target** MaidsInsights on Snowflake
**Mockup** https://claude.ai/code/artifact/75d6c4b8-ee4e-431a-aa8a-b19daa19e051

---

> ⚠️ **&ldquo;AI Agent&rdquo; in this spec means an automated LLM step, never a maids.cc agent.**
> Where a person is meant, this document says *auditor*, *reviewer* or *manager*.
>
> 🔴 **Scope: this audit tests whether each payment follows the rule for its payment type.**
> Segregation of duties, self-approval and attribution are **out of scope** — who approved a payment
> is a separate control question, not part of whether the payment was correct. `REQUESTED_BY` and
> `APPROVED_BY` are carried for drill-down context only and **must not gate any verdict**.

## 0. What changed on 2026-09-08 — read this if you saw the earlier revision

This is the first revision written against **live query results** rather than catalog metadata and
ERP source. Eleven queries changed the logic in eight places. The five that change what you build:

1. 🔴 **Never reject a future-dated note.** The earlier revision said to. `Airfare Ticket` runs to
   **2028-06-02** and is **38.1% of all addition money** — the rule would delete the largest type in
   the audit. Its date is very likely the *travel* date (§4).
2. 🔴 **`NOTE_DATE` carries a time.** `NOTE_DATE = LAST_DAY(NOTE_DATE)` is false for **every** row and
   returns a clean, plausible, meaningless result. Always `NOTE_DATE::DATE` (the group rules).
3. 🔴 **A job's run days are observed, never assumed.** August's monthly batch ran on **2026-09-01**,
   not 08-31 — 918 notes, the largest in the series (the group rules).
4. 🔴 **Never RED a note for missing attribution off a hardcoded type list.** 850 of the 862
   unattributed notes are `Bonus`, machine-created by design. Measure origin per type (the group rules, S1).
4. 🔴 **`anti_attrition_incentive` has a rule now** — eight tests, six runnable on the grant. Four
   earlier candidates were tried and closed off by data; they are listed so they are not
   re-attempted (§8).

Two claims the earlier revision made confidently are **withdrawn**: that anti-attrition amounts hide
a second payment type (they are prorated, one mechanism), and that hand-typed amounts fitting no rule
is a usable check (it detects whole-dirham typing, not error).

---

## 1. The business case

Every month, managers at maids.cc add money to housemaids' payslips. Flight-home money, loyalty
payments, referral and signing bonuses, part-month salaries, salary corrections, raffle prizes,
reimbursing a maid for money she spent herself. **Measured 2026-09-08 over 12 months: 25 payment types, 17,566 notes, AED 7,179,262.**

Two types dominate, and **they are different types**: `anti_attrition_incentive` is **9,167 notes —
52% by count** but AED 1.83m, 25% of the money; `Airfare Ticket` is **AED 2.73m — 38% of the money**
on 1,654 notes. A count-ranked tile and a money-ranked tile name different types at the top, and both
are right.

Every one of them is supposed to be justified by whatever rule governs that type of payment.
**Nobody currently checks.** Police & Control wants a dashboard that does.

**Four things it looks for**

| | |
|---|---|
| **F1 Over-limit** | More money paid than the rule allowed |
| **F2 Duplicate** | The same payment made twice |
| **F3 Not entitled** | Paid against a rule that never applied to that maid |
| **F4 No basis** | Nothing behind it explaining why it was paid |

**Who uses it.** A P&C auditor opens it once a month and works that month's cases one at a time.
A second person reviews before anything is acted on — maker–checker. Red means money went out
above what was allowed, or with nothing behind it. Amber means the check could not reach a
conclusion, and it always says why. Green means a rule actually ran and cleared the payment.

**Why a new check when the ERP already has one.** The ERP has an internal payroll-auditor role
that already detects over-limit airfare payments and repeated additions. But it only queries
notes where `CONFIRMED_*_BY_AUDITOR = false` — so the moment someone confirms a case it leaves
that list, **while the payment stays over the limit**. This dashboard is the independent second
check. The internal sign-off is shown as context and never clears a case here. That is what
guard G9 enforces, and it is the single clearest reason this project exists.

**What it can honestly deliver today: a verdict on about a third of the cases and under a tenth
of the money.** The rest cannot be judged — not because those payments are wrong, but because the
rule or the reference data needed to judge them has never been written down, and in one case
(the loyalty payment) does not exist anywhere in the company. **That is the most valuable thing
this reports**, and the design must not let it read as a pass. It is why coverage leads the KPI
strip and why amber always carries its reason. the group rules lists what is missing and who owns it.

**The one engineering risk worth naming up front.** The failure mode this design exists to
prevent is: *something is marked as blocked on the screen while the underlying numbers still
count those notes as clean.* A guard that changes no number. Or a clearance that lets a note skip
a test that could not run. Every section below that looks over-engineered — the single verdict
column, the no-early-exit test battery, the blocking guards — is there for that reason. Treat it
as the primary risk, not a footnote.

---

## 2. What you're building

**Grain: one row per manager note.** Four additions to one maid in one month = four cases,
judged separately.

**Output: one note-level table**, computed once, carrying exactly one verdict per note. Every
tile, chart, filter, row colour and export column aggregates that table. Nothing anywhere
re-derives eligibility (the group rules).

**Refresh: monthly, manual. Never scheduled** — recurring warehouse jobs go through the ERP team.

🔴 **Two grants are needed before any of this runs, not one.** `SHOW WAREHOUSES` returns **zero rows**
for `PAYROLL_AND_MONEY_CONTROL_ROLE`, which holds 426 view SELECTs and no compute. And
**`BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` is not granted** — the schema has USAGE but only
`TRANSACTIONS` is readable there, so a warehouse alone leaves T4, T5, group G, group E and the match
rate blocked.

**Delivered on MaidsInsights**, with Snowflake as the warehouse underneath. Not interchangeable.

The rest of this document is the build.

---

## 3. Population

```sql
NOTE_TYPE = 'ADDITION'
AND HOUSEMAID_ID IS NOT NULL
AND APPLIED = true AND NOT_FINAL = false          -- N1
AND IS_REFUND = false AND addition_reason <> 'refund'   -- N3
AND addition_reason <> 'office_work_addition'     -- separate check owns it
AND audit_month = <selected month>                -- see §4
```

Out of scope: `DEDUCTION` / `PENALTY_DEDUCTION` (feed is dead), office staff, client notes
(`CLIENT_MANAGER_NOTES`), profile notes (`HOUSEMAID_MANAGERACTIONLOGS`).

In scope and easy to get wrong: **negative amounts** (clawbacks — reported, never netted against
a finding), **both contract types**, **system-generated additions** (`forgive_deduction`,
`cover_deduction_limit`, `cover_negative_salary` — pending Q3).

🔴 **No future-date predicate either.** Notes dated after the audit month are **normal** for at
least one payment type — `Airfare Ticket` spans 34 active months inside a 12-month window. Filtering
them out deletes 38% of the money. They resolve through §4's third branch to AMBER, never dropped.

**No profile predicate in the population.** An unreadable or deleted profile is a *verdict*
(amber), not an exclusion. Join notes → `HOUSEMAIDS_INFO` as a **LEFT JOIN**. Filtering
`IS_DELETED <> '01'` drops rows silently — the column is TEXT and nullable, so the comparison
yields UNKNOWN for missing profiles and they vanish from every count and every tie-out while the
totals still balance on the survivors.

## 4. `audit_month` — read this before writing any filter

```
if PAID_ON_PAYROLL_MONTH is not null:  audit_month = PAID_ON_PAYROLL_MONTH     -- authoritative
else:                                  audit_month = payroll month whose LOCK WINDOW contains
                                                     NOTE_DATE, and the note must reconcile into
                                                     that month's MANAGER_ADDITIONS
else:                                  verdict = AMBER "paid month cannot be established"
```

🔴 **`PAID = true` is not "was paid".** For most routine additions the ERP writes neither `PAID`
nor `PAID_ON_PAYROLL_MONTH`. Those are written only for carried-forward *must-be-paid* reasons
(`salary_dispute`, `taxi_reimbursement`, `forgive_deduction`, `airfare_ticket`, `AR-1`,
`anti_attrition_incentive`, `Maids_at_other_expenses`, `medical_assistant`, `mv_prorated_salary`).
`HousemaidPayrollController`'s manual "mark as paid" sets `PAID` **without**
`PAID_ON_PAYROLL_MONTH`. **Filtering on `PAID = true` drops most of the population and the month
reports clean.**

🔴 **Cast before any date comparison.** `NOTE_DATE` is a timestamp; `LAST_DAY` returns midnight,
so `NOTE_DATE = LAST_DAY(NOTE_DATE)` is false for every row and yields a well-formed, plausible,
entirely meaningless split — one written this way put **3,728 of 3,728 notes on one side** and looked
correct. Use `NOTE_DATE::DATE`.

🔴 **Airfare breaks this section and it is not yours to fix.** `Airfare Ticket` carries notes
dated up to **2028-06-02**, 21 months ahead, and is the largest type by money. If `NOTE_DATE` is the
travel date rather than the payment date, every one of those notes resolves to a payroll month no
auditor will ever open. **Resolve `audit_month` per payment type**, and until payroll answers, airfare
notes whose date exceeds the audit month land AMBER with the reason stated.

`audit_month` is a payroll month as its first day (`DATE`) — same domain as
`HOUSEMAID_PAYROLL_HISTORY.PAYROLL_MONTH`, so G1 joins on equal keys.
`PAID_ON_DATE_FORMATTED` is a settlement date: display it, never window on it.

## 5. Sources

> **Verification note.** Every table, column, type and enum below comes from the Snowflake
> catalog and from the ERP source code. **None of it has been confirmed against actual rows** —
> an access limitation on our side meant no row-level query could be run, so while we are
> confident *what* exists, we could not verify *exactly where* it lands, nor its population,
> freshness or cardinality. You have the access we didn't. Confirm each source as you wire it
> up, treat anything marked *confirm* as a genuine open question rather than a formality, and
> run the group rules's three checks before publishing a number.

### In Snowflake

| Ref | Table | Columns you need |
|---|---|---|
| D1 | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | `ID`, `HOUSEMAID_ID`, `NOTE_TYPE`, `AMOUNT`, `REASON`, `NOTE_REASON`, `NOTE_DATE`, `REQUESTED_BY`, `APPROVED_BY` |
| D2 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | `HOUSEMAID_ID`, `PAYROLL_MONTH`, `ADDITIONS`, `PAID_ON_DATE_FORMATTED`, `IS_TRANSFERRED` |
| D3 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | `ID`, `HOUSEMAID_TYPE`, `NATIONALITY`, `START_DATE`, `SALARY_STARTING_DATE`, `DATE_OF_TERMINATION`, `MODE_OF_TERMINATION`, `IS_DELETED` |
| D4 | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | `ID`, `EXPENSE_TYPE`, `RELATED_TO_TYPE`, `RELATED_TO_ID`, `REQUEST_STATUS`, `REFUNDED`, `AMOUNT`, `CURRENCY_NAME`, `BENEFICIARY_TYPE`, `BENEFICIARY_NAME`, `APPROVED_BY`, `CREATION_DATE` |
| D5 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS` | `HOUSEMAID_ID`, `TICKET_TYPE`, `BUYER`, `PURCHASE_DATE`, `REFUNDED`, `IS_DELETED`, `IS_LATEST_HM_TICKET` |
| D6 | `…HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_BONUSES`, `…HOUSEMAID_REFERRALS` | referral, referred maid, bonus-requested date, cancelled date |
| D7 | `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` | picklist item id, code, name |

🔴 **Do not source from `BA_VIEWS.HOUSEMAID_MANAGEMENT_GOLD.BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY`
until DNA-9464 deploys.** It joined `EXPENSES_REQUESTS.RELATED_TO_ID` to a **note id** when that
column holds a **housemaid id**; ranges overlap, so it matched rows and raised no error.
**DNA-9464 fixed it** to `epm.related_to_id_text = to_varchar(n.housemaid_id)` — measured on
production, the old join matched **1 of 8,632** addition notes in a six-month window, the corrected
join matches **7,878**. Status: Pending Deployment.
✅ **Our M4 heuristic keys on the same column the fix adopts**, so that route is production-validated
rather than inferred.

### In the ERP database

The curated note view exposes ten columns; the source table has everything else this check needs.
Read these from **`mmdb_transformed.payrollmanagernotes`** unless noted. Scope history to
**2024-01-01 onward**.

| Ref | Columns | Why |
|---|---|---|
| N1 | `APPLIED`, `NOT_FINAL` `BOOLEAN` | population predicate |
| N2 | `PAID`, `PAID_ON_PAYROLL_MONTH` `DATE`, `PAYROLL_MONTH` `DATE`, `PAYROLL_ACCOUNTANT_TODO_ID` | §4 |
| N3 | `IS_REFUND` `BOOLEAN`, `REFUNDED_NOTE_ID` | refunds out of scope |
| N4 | `EXPENSE_ID` `BIGINT` | the expense link — used inside D1's own join but not selected by it, so take it from the source |
| N5 | `ADDITION_REASON_ID`, `PURPOSE_ID` `BIGINT` → `PICKLISTS_ITEMS.ID` | group routing |
| N6 | `CREATOR` `BIGINT` → `USERS.ID`, `CREATION_DATE` | who made the addition |
| N7 | payroll lock window per month — `MONTHLYPAYMENTRULES` (confirm the column) | §4 branch 2 |
| N8 | `PARAMETERS.CODE` / `.VALUE` for `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` (`"2000"`), `PARAMETER_HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT` (`"1350"`) | airfare cap |
| N9 | `CONFIRMED_AMOUNT_BY_AUDITOR`, `CONFIRMED_REPEATED_BY_AUDITOR` `BOOLEAN`; `PAYROLLAUDITHOUSEMAIDEXCEPTIONS`; `AUDITORACTIONS` | **display only** — see G9 |

### Reference data these rules need, which does not exist yet

| Ref | What | Feeds | Where it has to come from |
|---|---|---|---|
| N10 | effective-dated salary history — the salary in force on a past date, not the current profile value | group D | `mmdb` revision tables are the likely home; confirm the shape |
| N11 | ~~referral and signing bonus scheme prices~~ — 🔴 **largely resolved.** The referral scheme is stated (§8 C); a signing bonus has **no price by construction**. And an authorised-amount source exists: **`HOUSEMAID_REFERRALS.AMOUNT`** is what the referral record authorised, against which `MAIDS_REFERRALS_BONUSES.BONUS_AMOUNT` (paid) can be compared — C6 | group C | still open: what the **AED 1,200** is, and whether the amounts ever changed. ⚠️ `MAIDS_REFERRALS_BONUSES` is built **from `payrollmanagernotes` itself**, filtered `AMOUNT != 0 AND AMOUNT IS NOT NULL` — circular as a price source, and that filter deletes exactly the notes T3 flags. Use it for the paid amount only |
| N12 | ~~raffle winners per draw~~ — 🟢 **resolved 2026-09-08 (conversation 45932, all modules).** The whole subsystem exists in **`erp/magnamedia-housemaid-management`**, not payroll: `RafflePerformerJob` draws winners weighted by ticket points and `addPrizesToPayroll` writes the note with `amount = prize.worth`. Winners are `RaffleDrawParticipant` rows with `isWinner = true`; prize amounts come from parameters `raffle_first_prize` (2,000) and `raffle_second_prize` (200) | group F | **No longer a knowledge gap — an ingestion.** None of the five `raffledraw` tables is in the warehouse (verified: zero objects matching `%RAFFLE%`/`%PRIZE%`/`%DRAW%` account-wide). Group F is fully specified against them |
| N13 | ~~the loyalty rule~~ — 🟢 **resolved 2026-09-08 (conversation 45934, all modules).** The rule is in **`erp/magnamedia-housemaid-management`**: `MaidIncentiveExperimentJob` pays every enrolled, active, non-MV maid on the last day of the month, amount = `MaidManagerActionLog.incentiveAmount × daysBetween ÷ totalMonthDaysTillNow`. It reaches payroll indirectly via expense code `AAI - 01`, which is why a payroll-module search found only the routing list | group B | **Not a business ask any more.** `HOUSEMAID_MANAGERACTIONLOGS` is already granted (gives B1/B2/B3/B6); B4/B5 need `INCENTIVE_AMOUNT` exposed on it — one column |
| N14 | payment type → allowed expense heads | T5 | P&C + Payroll |
| N15 | contract type → allowed payment types (all **four** types, see the group rules) | T7 | P&C + Payroll |
| N16 | payment types that always carry an expense record | T4 | P&C + Payroll — **but two are already answered**, see below |
| **N17** | 🔴 **contract-type timeline per maid** — every CC/MV interval with start and end dates | group A (A2, A3) | `HOUSEMAIDS_INFO_REVISION` has the right columns (`OLD_HOUSEMAID_TYPE`, `HOUSEMAID_TYPE`, `SWITCH_HOUSEMAID_TYPE_DATE`) and **all of them are empty**. Two working routes: `mmdb.housemaids_revisions` (which the VISA models already read for `FIRST_HOUSEMAID_TYPE`), or the `to_type` column behind `BI_HOUSEMAID_STATUS_LOGS` |
| **N18** | 🔴 **row-level loans** paired to additions | group L | no raw or silver loans table exists — only three gold views. ⚠️ loan **repayment** cannot be verified at all: it runs through deductions, which are out of scope because that feed stopped recording. L1 proves the loan was *created*, never *recovered* |
| **N19** | 🔴 **`live_out` flag**, effective-dated | L1, L3 | `HOUSEMAID_TYPE` does not carry it; the gold layer derives `CC Live In / CC Live Out / MV` from a separate `live_out` flag |

🔴 **Two payment types are already known to carry no expense record, and both must be excluded from
N16 before T4 is built.** DNA-9464 established that additions booked straight onto the salary with
no payment behind them — *"mainly Airfare Ticket and Office Work Addition"* — now render as a third
payment method, **Direct adjustment**, 565 of them across six months. So `airfare_ticket` legitimately
has no expense request. **Without this, T4 would red-flag every flight-home payment as "no basis"** —
a fabricated finding on the largest group in the audit.

**A payment type missing from N14/N15/N16 makes that test BLOCKED — never a pass, never a red.**
An empty list reds everything; a permissive default greens everything. Both are silent.
Same rule for N10–N13: the group rule returns BLOCKED and its notes are amber. **Amber is a
result this check reports, not a failure of it.**

### The note → expense link

🔴 **There is no key.** `payrollmanagernotes.EXPENSE_ID` → `EXPENSES.ID` is the expense
**catalogue** row. No FK exists to `EXPENSEREQUESTTODOS` or `EXPENSEPAYMENTS`; the ERP copies
fields across. The match is a heuristic:

```
candidates = EXPENSES_REQUESTS
  where RELATED_TO_TYPE = 'MAID'
    and RELATED_TO_ID   = note.HOUSEMAID_ID
    and EXPENSE_TYPE resolves from note.EXPENSE_ID          -- N4
    and CREATION_DATE within the note's entitlement window

exactly 1  -> matched
>1         -> BLOCKED "multiple candidate expense records"   -- never take the first
0          -> unmatched; T4 decides red vs blocked by N16 and the floor
```

Publish the match rate (M13) **per payment type per month**. Below the floor (start at 80%), T4
cannot return red for that type. **A low match rate means unverified, never clean.**

## 5b. 🔴 CURRENT STATE IS NOT HISTORY — the audit's main structural finding

**The ERP's maid record carries state that is never reconciled backwards.** Six findings in this
audit rested on a current-state column standing in for a historical fact. **Every one moved when a log
replaced the column** — four shrank, one grew, one inverted:

| Finding | On the current-state column | On the log | Column at fault |
|---|---:|---:|---|
| Airfare to MV maids | 137,500 | **4,500** | `HOUSEMAID_TYPE` |
| Bonus at referral rates, no referral | 143,965 | **candidates** | `START_DATE`, referral link |
| Raffle prizes to terminated maids | 3,000 | **0** | `DATE_OF_TERMINATION` |
| Relocation to a live-in maid | 4,700 | **3,900** | `LIVE_OUT` |
| Anti-attrition to MV maids | 2,476 | **5,726** | `HOUSEMAID_TYPE` |
| Office work "92/92 assigned, cleared" | *a clear* | **void** | `ASSIGNED_OFFICE_WORK_REASON_ID` |

### Two distinct failure modes, and they need different tests

**Mode 1 — stale on change.** The column was right once and was never updated.
`DATE_OF_TERMINATION` is not cleared when a maid is re-hired, so 13 maids read as *"terminated 558 days
ago"* while showing **1,039 status changes since** and sitting in `WITH_CLIENT` on the day they won.
`HOUSEMAID_TYPE` and `LIVE_OUT` are simply overwritten on switch. **Mode 1 mis-dates: it reports a
different set, not a smaller one** — on 66 relocation notes a point read flagged 5 of which 2 were
false, while missing 3 of the 6 real ones.

**Mode 2 — never cleared.** The column accumulates and never resets, so its *base rate* is
uninformative. Of every maid carrying `ASSIGNED_OFFICE_WORK_REASON_ID`, **57.4% are
`EMPLOYEMENT_TERMINATED` and 0.8% are actually in office-work status.** **Mode 2 mis-means:** the value
is not stale, it simply never implied what the test assumed. No log fixes this one — only a base rate
exposes it.

### The rule

1. **Any predicate about a maid at a past date reads from a log, never from `HOUSEMAIDS_INFO`.**
   `HOUSEMAID_STATUS_LOGS` and `HOUSEMAID_TYPE_LOGS` are **interval tables** — `CHANGE_DATE` *and*
   `NEXT_CHANGE_DATE` — so the read is plain containment and needs no window function:
   `note_day >= CHANGE_DATE AND (NEXT_CHANGE_DATE IS NULL OR note_day < NEXT_CHANGE_DATE)`.
2. **If no log exists for that attribute, the test is BLOCKED, not approximate.** An approximation of an
   entitlement is a finding-shaped object with no evidence behind it.
3. **Before using any flag or marker as evidence, measure its base rate across the whole population.**
   If holders are mostly people the flag should not describe, it is a marker, not a state.
4. **Carry the diagnostic in the same result:** count how many rows resolve to a *past* interval. If
   none do, the join is decorative and the answer is a point read wearing a costume. That one column
   caught the airfare error before publication.

`HOUSEMAIDS_INFO_REVISION` (Envers) is the **fallback, not the first choice**: it records *that a row
changed*, where a log records *what the value became*, with the interval already closed.

---

## 6. Traps that return a wrong answer instead of an error

| | |
|---|---|
| **Grain** | D1 LEFT JOINs `expensepayments` on `HOUSEMAID_ID + EXPENSE_ID` with no dedup. It can emit more rows than notes. **Assert `COUNT(*) = COUNT(DISTINCT ID)` first (G2)** |
| 🔴 **`EXPENSE_ID` is not a category** | Measured 2026-09-08: across 9,167 anti-attrition notes there are **9,166 distinct `EXPENSE_ID` values, 9,165 of them used exactly once**. It is the per-expense-request id, one per note. **Grouping by it returns the input**, and any check that treats it as an expense head or category is testing nothing. (An earlier version of this table asserted the opposite — the claim was never measured) |
| **TEXT booleans** | `HOUSEMAIDS_INFO.IS_DELETED` / `EXCLUDED_FROM_PAYROLL` = `'00'`/`'01'` nullable · `HOUSEMAID_PAYROLL_HISTORY.IS_TRANSFERRED` = `'YES'`/`'NO'` · `HOUSEMAIDS_TICKETS.IS_DELETED` = `'00'`/`'01'`. `= TRUE` matches nothing |
| **Empty-string sentinels** | `BENEFICIARY_NAME`, `RELATED_TO_NAME`, `APPROVED_BY`, `REQUESTED_BY` return `''`, not NULL. Use `NULLIF(TRIM(x),'')` |
| **Secure expenses** | `EXPENSES_REQUESTS` excludes `is_secure = 1` categories **entirely**. "No expense record" and "record withheld" are indistinguishable → amber, never red |
| **Contract types** | `HOUSEMAID_TYPE ∈ {Normal, MAID_VISA, FREEDOM_OPERATOR, WALKIN}` — **four**. `IF MV … ELSE CC` clears the last two against the wrong rule |
| **Epoch dates** | `START_DATE` / `SALARY_STARTING_DATE` bottom out at `1970-01-01` = unknown. Service arithmetic on them returns a confident wrong answer |
| **Dead columns** | `HOUSEMAID_MANAGER_NOTES.MANAGER`, `HOUSEMAIDS_INFO.LAST_PAYROLL_LOCK_DATE`, `.EID` are entirely NULL |
| **Multi-currency** | `EXPENSES_REQUESTS.CURRENCY_NAME` spans 10 currencies. No FX → BLOCKED, not an approximate match |
| **Bonus ambiguity** | Referral and signing bonus share reason `bonus`; only `PURPOSE_ID` (`referral_bonus`) separates them. **Route on `(ADDITION_REASON_ID, PURPOSE_ID)`, never on the resolved name** |
| **Note types** | The ERP enum has 7 values; `MANAGER_ADDITIONS` counts only `ADDITION`. Assert the other four are absent (G10) |
| **Parameters** | `PARAMETERS.VALUE` is TEXT and **not effective-dated**. Cast it; snapshot it per run |
| **Timezone** | `NOTE_DATE` is `TIMESTAMP_NTZ`, zone unstated. Truncate once, centrally; flag notes within 3h of a window edge |
| **Currency of the note** | D1 has no currency column. AED is an **assumption** — confirm |
| **A rate is meaningless across a population containing a category the numerator cannot apply to** | Medical assistance is *Loan* or *Paid by Company*. Loan-mode books a loan 100% of the time; company-paid can never show one. A single "% booked" over both is not a low compliance rate, it is a mix of two payment models. **Split by mode before computing any rate; check whether a zero is structurally impossible to be anything else** |
| **A positive control validates the plumbing, not the field choice** | TF14's control (Accommodation Relocation) PASSED — 98.5% hand-built vs 94.8–100% approved — on the one head where the request-side and addition-side loan fields coincide. That pass bought confidence in a measure wrong everywhere else by an order of magnitude. **One control that fails to fire is not evidence.** Use two, on populations chosen to differ |
| **The loan on the REQUEST is not the loan on the ADDITION** | `EXPENSES_REQUESTS.LOAN_AMOUNT` is largely empty; the sanctioned `ADDITION_LOAN_AMOUNT` is where payroll books it. Reading the first gave 3.4% where the approved KPI gives 85–100% |
| **Sweep the gold layer BEFORE hand-building a metric** | `BI_PAYROLL_MAID_SALARY_ADDITIONS_AS_LOAN_IMPACT_BY_CATEGORY` already publishes `LOAN_PERCENTAGE_OF_ADDITIONS`, and `BI_PAYROLL_LOAN_DEDUCTIONS_VS_POSSIBLE_DEDUCTIONS` already publishes recovery. Two rounds of hand-built work reconstructed approved KPIs. **A reconstruction of an approved KPI is not the KPI** and must not be published as one — read the view, whose own logic is the sanctioned definition |
| **A void test and a negative test look identical in the output** | TF16's control row (65 booked loans) showed zero recovery, proving deduction notes are the wrong table. Without the control, "AED 30,220 never recovered" reads as a finding. **Every absence test carries a population known to show the presence, or it cannot be scored** |
| **No figure is a sum of tests** | Overlapping tests measure one population twice. O6/O7 would have overstated by **58%**; O12 found the two bonus findings overlap by 3 notes. De-duplicate to one verdict per note before totalling, and say so in the ledger |
| **A scoped code question that finds nothing is evidence about the SCOPE** | Two spec claims of *"X does not exist in the ERP"* came from interrogations scoped to one module; both were wrong and both cost a rewrite (raffle, anti-attrition). Re-ask across all modules or write it as *"not in module Y"* |
| **Current state is not history** | See §5b. Six findings moved when a log replaced the column. Any past-date predicate reads from `HOUSEMAID_STATUS_LOGS` / `HOUSEMAID_TYPE_LOGS`; no log means BLOCKED, not approximate |
| **A never-cleared marker mis-MEANS, it is not merely stale** | 57.4% of `ASSIGNED_OFFICE_WORK_REASON_ID` holders are terminated and 0.8% are in office-work status. A log cannot fix this; only a base rate exposes it |
| **A permission flag is not an obligation** | `ALLOW_TO_ADD_LOAN` reads *may*, not *must*. An unbooked loan on a loan-enabled head is not a finding by itself — and on a head where the flag is FALSE, "no loan booked" is 100% of rows and means nothing at all. **Filter by the flag before aggregating, or the column reports grants as unrecovered debt** (this cost AED 2.2m of false finding, caught pre-publication) |
| **Name the output column after what it PROVES, not what it counts** | A column called `aed_never_recoverable` counted "no loan row exists". On grant heads that is every row. The name, not the logic, is what would have been published |
| **Carry a positive control inside the query** | A test for an absence needs a population known to show the presence. Accommodation Relocation books 65 of 66 loans, so it proves the mechanism works and the low rates elsewhere are real. Without it, "no loans booked" cannot be distinguished from "loans are not recorded here" |
| **`LIMIT_FOR_APPROVAL` inverts if read without `APPROVAL_METHOD`** | It is populated ONLY on `APPROVAL_REQUIRED_ON_LIMIT` heads, where it is the threshold **above which** approval is needed — below it, an unapproved request is CORRECT. Plain `APPROVAL_REQUIRED` heads leave it null and need approval always. Read as a ceiling it turns every small legitimate payment into a finding |
| **Self-approval may be the DESIGN — check `APPROVE_HOLDER` first** | If the requester is the head's designated approver, requester = approver is the configured path, not a breach. A self-approval rate is not a finding until the holder is known |
| **A control can be real and simply not on the money's path** | Three heads require an invoice; all three carry zero notes while their no-invoice twins carry 100% of the money. Test whether the gate is ON THE ROUTE before testing compliance with it — otherwise a fully-routed-around control scores as perfect compliance |
| **A column named for a task holds a STATE, not a taxonomy** | `EXPENSES_REQUESTS.EXPENSE_REQUEST_TASK_NAME` returns `PAYMENT_OBJECT_CREATED` on 100% of rows — where the request *got to*, not what it was *for*. The category lives on `EXPENSES_CONFIGURATION.CATEGORY` / `TOP_PARENT_CATEGORY`. Same family as "`EXPENSE_ID` is not a category" |
| **Zero join matches is NO evidence, not clean evidence** | A routing test that matched no config head on any of 944 notes read as "no defects". It had joined on the state column above. **Any test whose finding is an absence must report its match rate beside it, or it cannot be scored** |
| **Establish a join key by profiling, never by its name** | The two failures above were one mistake made twice in one battery. Profile the candidate columns with no join first; choose the key from what comes back |
| **Requester = approver is a PRODUCER SIGNATURE before it is a control failure** | 8,095 anti-attrition notes are self-approved, AED 1.58m — and carry **three** identities, one holding 94.9%. A job stamps itself into both fields. **Discriminate by concentration** (identities per note volume), never by the rate alone |
| **Timestamp does not identify a machine path — concentration does** | 18.1% of all additions are midnight-stamped, so the column carries real time, yet the *known* batch job sits at 0.0%. Midnight was a valid signal for the airfare producer and is worthless here. Re-establish a signature per producer; never port one |
| **A current-state read on a changing flag is worse than useless, not merely weaker** | On 66 relocation notes, `LIVE_OUT` today differs from `LIVE_OUT` when paid on 5. A point read would have flagged 5 notes — **2 of them false — while missing 3 of the 6 genuine ones.** It does not under-report; it reports a *different set* |
| 🔴 **Uncast date equality** | `NOTE_DATE = LAST_DAY(NOTE_DATE)` is false for **every** row — the timestamp never equals midnight. It returns a clean, plausible split of nothing. Always `NOTE_DATE::DATE` |
| 🔴 **Assumed batch days** | The monthly job does **not** always run on the last calendar day — August's ran 2026-09-01, 918 notes. Derive run days from the data (`GROUP BY NOTE_DATE::DATE HAVING COUNT(*) > n`), never from the calendar |
| 🔴 **A date column that is not a timestamp** | `HOUSEMAID_MANAGERACTIONLOGS.ACTION_DATE` looks like an enrolment timestamp. It is not. *(code-verified, conversation 46015)* `actionDate` is stamped only in `createEntity`; `updateEntity` never re-stamps it and accepts whatever the caller sends — **user-editable business data**, and the selection query never reads it. The code orders enrolments by `creationDate`. **Before any point-in-time test, confirm the writer of the column, not its name** |
| 🔴 **One reason, several producers** | An addition reason comes from `Expense.salaryAdditionType`, so **every** route reaching that expense code carries it. `anti_attrition_incentive` has three: the experiment job (needs an enrolment row), the Abu Dhabi job (needs none), and any manual `AAI - 01` expense request (needs none). **A rule derived from one producer clears or fails notes that never went through it** |
| 🔴 **Checked at selection, not at payment** | `MaidIncentiveExperimentJob` evaluates its eligibility `EXISTS` once, then POSTs an expense request; the note is written two async hops later and **nothing re-checks**. When mapping a control, record *when* it is evaluated — "the job requires X" and "X holds when the money moves" are different claims |
| 🔴 **`REQUESTED_BY` does not identify the batch** | The anti-attrition job's configured requester changed **at least twice in twelve months** — the 2025-09-30 run and the 2026-09-01 run each carry a different account from the modal one, and 918 notes on 2026-09-01 match the known August batch day exactly. **A note from a non-modal requester is not a manual entry.** Identify a batch run by its **day concentration**, never by who is stamped on it |
| 🔴 **Monthly windows vs the batch calendar** | August's run landed on **2026-09-01**, so August's and September's payments share a calendar month. Any per-month duplicate or entitlement rule pairs them and reports a duplicate that is not one — 81 maid-months here. **Window on the observed batch cycle (28-32 days), not on `DATE_TRUNC('month')`** |
| 🔴 **A rate quoted without its window** | *MOHRE requirement additions is 44% zero* was this audit's loudest zero-amount number. Its zeros run **2025-11-05 to 2026-01-10 and stop** — a closed incident, reported as an ongoing rate. **Every rate in a finding carries its first and last date**, or a reader will act on something that ended eight months ago |
| 🔴 **A scoped search's "does not exist"** | Ask-the-code 46016 reported `ManagerNoteService.processExpenseRequestTodo` *"does not exist in either repository in scope"* — because the payroll module was not in the alias list. Conversation 45934 quotes it directly. **A negative result from a scoped search is not a negative result.** Pass every module the answer could depend on, and never record an absence as a finding without re-asking unscoped |
| 🔴 **A formula transcribed into a note, then reasoned from** | The Abu Dhabi proration was recorded in an evidence file as `offered * (eligibleDays / totalDaysInMonth)`. The source is `Math.round(offered * ((double) eligibleDays / totalDaysInMonth) * 100.0) / 100.0`. A dropped cast in a transcription produced a confident integer-division hypothesis that the code denied outright. **Re-read the source line before building on a formula you copied** |
| 🔴 **Per-note tests cannot see run-level defects** | 18 notes, 100% zero, one run — every one individually and correctly AMBER, and no per-note verdict could see the pattern. **Population-level tests (M3c) are a separate battery**, run once per payment type per run |
| 🔴 **A payment type can be relabelled mid-year** | One batch posted `Bonus` April–July and `Abu Dhabi Incentive` on 31 August, same cohort. **~77 notes sit in the wrong type and every `Bonus` figure includes them.** Group by `(requester, run day, payment type)` and watch for a cohort that moves |
| 🔴 **A monthly window on a job that crosses month-end** | The anti-attrition run for August landed on 2026-09-01, so August and September share a calendar month and the duplicate rule paired them: **516 candidates became 259 on the batch cycle.** Window on the observed cycle, never on `DATE_TRUNC('month')`. Applies to every monthly entitlement type |
| 🔴 **Proportionality** | 369 zero-amount notes are unique hand-written text about 369 named people, carrying **AED 0**. Reading them was declined and the refusal recorded. **When the exposure of a read exceeds what the finding can change, stop and write down that you stopped** — shapes before rows, counts before text |
| 🔴 **`ASOF` is a reserved word in Snowflake** | A CTE named `asof` compiles as *"syntax error … unexpected 'a'"* on the line that references it, because Snowflake parses it as the `ASOF JOIN` keyword. The error points at the alias, not the name. Same hazard for any CTE named after a join keyword — prefer `resolved`, `type_at_payment` |
| 🔴 **The current-state trap has a second face: a FUTURE value** | The MV question failed because a maid's type had changed *since* the note. Prorated salary failed the other way: `REPLACEMENT_SALARY_START_DATE` was set *after* the note, so the current value is four months in the note's future (median **-122 days**) and the code never saw it. **Reading the current value can be wrong in either direction** — the only correct read is the revision as of the note date |
| 🔴 **A current-state dimension joined to a dated fact** | Joining `HOUSEMAIDS_INFO.HOUSEMAID_TYPE` to twelve months of notes reported **941 notes / AED 172,967** as contradicting a code-verified eligibility rule. Resolved as-of-payment against `HOUSEMAIDS_INFO_REVISION`, the real figure is **22 notes / AED 5,526** — a **97% overstatement**, because 915 maids switched type *after* being paid. **Never join a current-state dimension to a dated fact.** Any attribute that can change — type, salary, status, live-out — must be read as of the note date |
| 🔴 **Snowflake correlated subqueries take equality only** | A correlated `EXISTS` carrying `ABS(DATEDIFF(...)) <= 1` fails with *"Unsupported subquery type cannot be evaluated"* — and the error names a line number, not the cause. **Correlate on equality, then do tolerance work in an aggregate** (`MAX(IFF(...))` grouped back to the note). The naive fix — a `LEFT JOIN` with the tolerance in the `ON` — reintroduces fan-out and double-counts |
| 🟢 **Prefer counting to measuring where a per-note quantum exists** | Forgive Deduction: one note = one day of salary. The **count** test (how many days forgiven in a month) produced a clean finding — 3 maid-months at 15-21 days. The **amount** tests produced nothing usable through two attempts, because both depend on a salary model, and the residue always had an innocent explanation (a partial-month payroll row understating the daily rate). **A count-based test survives a bad salary model; an amount-based test does not.** Where the rule defines a per-note quantum, count the notes |
| 🔴 **A per-maid maximum is not an entitlement** | The same-day duplicate test uses each maid's largest single note as her entitlement. That holds where the entitlement really is a per-maid constant (anti-attrition), roughly holds where amounts cluster (Bonus), and **fails where amounts are genuinely variable** (Taxi, Salary Dispute) — a maid can legitimately claim two taxis in a day. **State which types the proxy is valid for, per test** |
| 🔴 **An audit column that is always populated** | `HOUSEMAID_MANAGERACTIONLOGS.USER_WHO_LAST_MODIFIED` is non-empty on **100%** of rows, including the 96.7% never edited — it is stamped on create. A "last modified by" that is always set carries **zero** information about editing. **Before using any provenance column as evidence, check its fill rate on rows you know were not touched** |
| 🔴 **A near-ubiquitous corroborator cannot corroborate** | Salary Dispute: 90.8% of notes have a complaint within 30 days — against a chance rate of **83.8%**. The test scores **1.08×** and has no power, because these maids complain often enough that a hit is near-certain. **Both** framings mislead: the 90.8% reads as validation, and the 9.2% without reads as a finding when chance predicts 16.2% without. **Measure the corroborator's base rate before building the test. If chance already exceeds ~70%, abandon it rather than tune the window** |
| 🔴 **A chance baseline computed on the wrong denominator** | The raffle repeat-winner test *did* carry a chance rate — and still reported 4.09× chance, because the pool used was all 6,738 paid maids. A second test showed MAID_VISA wins at 0.29× its share and three nationalities never win, so the real entrant list is ~1,400, at which the same 88 repeats are **1.02× chance**. **Having a baseline is not enough; the baseline's population must be the one the process actually draws from.** Test the denominator before trusting the ratio |
| 🔴 **A window test with no chance rate** | *"Is there a related record within N days"* has a hit rate from geometry alone: a 105-day window with a 30-day band gives p=0.286, so at 1.7 records per subject chance produces **40%**. One real test scored 40.3% — **1.00× chance, zero signal** — and would have read "40% corroborated". Publish the chance rate beside the observed one, computed **per subject** |

## 7. Verdict model

Every applicable test is evaluated and written to `TEST_TRACE`. **No early exit.** Each returns
`RED(failure_type)` · `GREEN` · `BLOCKED(reason)` · `N_A`.

```
RED    <= any applicable test returned RED           (one is enough)
AMBER  <= not RED, and any applicable test BLOCKED
GREEN  <=> every applicable test RAN and returned GREEN
```

A finding is evidence; a clearance is only the absence of one.

| Test | RED when | BLOCKED when |
|---|---|---|
| T1 profile readable | — | no profile row · `IS_DELETED='01'` · `HOUSEMAID_TYPE ∉ {Normal, MAID_VISA}` · epoch date |
| T2 payment type recorded | `ADDITION_REASON_ID IS NULL` → **F4** | id set but resolves to no picklist row |
| T3 amount usable | — | `AMOUNT IS NULL` · `= 0` · `< 0` (each its own reason) |
| T4 authorised + amount agrees | matched & authorised & \|gap\| > 0.01 → **F1** · matched & not authorised → **F4** · unmatched & reason ∈ N16 & rate ≥ floor → **F4** | unmatched & rate < floor · N16 absent · multiple candidates · currency mismatch |
| T5 expense head consistent | head ∉ N14 → **F3** | N14 absent · T4 didn't match |
| T6 duplicate | duplicate group exists → **F2** on every member | window unknown · window extends outside loaded history |
| T7 contract type may receive | reason ∉ N15 for that type → **F3** | N15 absent · T1 blocked |
| G  group rule | per rule | per rule; **always** when no group is mapped |

**T4 authorisation:** authorised ⟺ `REQUEST_STATUS = 'PAID' AND REFUNDED = FALSE`.
`PENDING_PAYMENT` → BLOCKED. `REJECTED` / `DISMISSED` / `CANCELED` / `PENDING` → **RED (F4)**.
Without this a note matched to a cancelled request with an equal amount reaches green.

**T6 scan population is not the audit month** — it is every note for that maid across the longest
entitlement window of any payment type (24 months for `airfare_ticket`). Scanning one month makes
two identical additions astride a month boundary invisible and greens both.

**Duplicates are groups, not pairs.** `DUPLICATE_GROUP_ID` + one `IS_RISK_REPRESENTATIVE = true`
(latest by `NOTE_DATE`). Every member is a case; only the representative contributes to M11.

**Blocking-reason precedence:** first blocked test in order T1→T7→G. All blocked tests stay in
`TEST_TRACE`. Without a fixed precedence the reason buckets are assignment-order dependent.

**Output table — one row per note, computed once:**
`AUDIT_VERDICT ∈ {RED, AMBER, GREEN}` · `VERDICT_LABEL` · `FAILURE_TYPE ∈ {F1,F2,F3,F4}|null` ·
`BLOCKING_REASON|null` · `DUPLICATE_GROUP_ID` · `IS_RISK_REPRESENTATIVE` · `TEST_TRACE`.
**Every tile, chart, filter, row colour and export column aggregates this table. Nothing
re-derives eligibility.** There is no fourth verdict — negatives and zeros are AMBER with their
own blocking reason.

Failure types: **F1** over-limit · **F2** duplicate · **F3** not entitled · **F4** no basis.

## 8. Group rules — the payment types

Exactly one group runs per note. Unmapped → BLOCKED → amber.

🔴 **This list is incomplete and we do not know by how much.** It was recovered from ERP source. The
warehouse's own `ADDITION_CATEGORY` profile carries live categories absent from it — **Accommodation
Relocation, Sim card Loan, WPS Compliance Loan, PCR Test & medical assistance Loan, Live-out
Transportation Assistance, NOL Card**, plus several Part-Time Cleaners categories — and that profile
is itself truncated. They are group **L** below. Reading the picklist (check 2 in the group rules) is what closes
this. Do not code a fixed list of reasons.

| `ADDITION_REASON_ID` code | Group | Buildable |
|---|---|---|
| `airfare_ticket` | **A** Flight home | ✅ |
| `anti_attrition_incentive` | **B** Loyalty | ✅ **re-specified 2026-09-08 — 8 tests, 6 need only the grant.** Runnable: B1 enrolled · **B1b enrolled *before* the payment** (new; found a case on its first run) · B2 contract type · B3 active · B6 once per month (review list, not RED, until `CONTRACT_ID`) · **B7 the AI Agent reads the enrolment reason box** — 100% filled, 96% distinct, median 43 chars. Blocked: B4 recompute (needs enrolment **and exit** dates *plus* the divisor rule — 30% of notes are prorated over two divisors, both the job's own), B5 ceiling (`INCENTIVE_AMOUNT`). ⚠️ **Do not re-attempt**: the complaint check scores **1.00× chance — zero signal**; enrolment-exists passes 1,000 in 1,001; `AMOUNT = tier` cannot be written; "the amount fits no rule" detects whole-dirham typing, not error |
| `bonus` + purpose `referral_bonus` | **C** Referral | partial — event ✅, price needs N11 |
| `bonus` + other purpose | **C** Signing | partial — price needs N11 |
| `prorated_salary`, `mv_prorated_salary`, `previously_held_salary`, `mv_extra_salary`, `last_day_cc_switch_adjustment` | **D** Part-month | partial — needs N10 |
| `salary_dispute` | **E** Correction | partial — E1 ✅, E2 needs the judgement field |
| `raffle_prize` | **F** Raffle | ✅ **specified** (ROSTER · CEIL · UNIQ) — blocked only on ingesting the `raffledraw` tables |
| `taxi_reimbursement`, `medical_assistant`, `Maids_at_other_expenses`, `lost_luggage_compensation` | **G** Reimbursement | ✅ |
| `forgive_deduction`, `cover_deduction_limit`, `cover_negative_salary` | **I** System-generated | pending Q3 |
| `recommendation_from_client` | **J** Google review | ❌ no rule found |
| `pay_vacation_days` | **K** Vacation | ❌ no rule found |
| `renewal_bonus`, `AR-1`, `low_exchange_rate_compensation` | **H** Unmapped | ❌ |
| Accommodation Relocation, Sim card Loan, WPS Compliance Loan, PCR & medical Loan, Live-out Transportation Assistance | **L** Loan-paired advances | partial — needs N18, N19 |
| Part-Time Cleaners Expenses (NOL Card, relocation, cash advance) | **L** | scope decision first |
| `office_work_addition`, `refund` | — | out of scope |

**A — Flight home** (all conjunctive)
- A1 `AMOUNT > limit` → RED F1. limit = `PARAMETERS.VALUE` (N8) cast to number,
  Filipina when `HOUSEMAIDS.NATIONALITY` = picklist code `philippines`, else the other-nationality
  parameter. **Strictly greater**, matching the ERP. Use the raw nationality code, **not**
  `NATIONALITY_CATEGORY` — different partitions.
- 🔴 A2 **CC tenure ≥ 22 months** as of the note date, walked over her contract-type timeline
  (N17): an MV interval **< 1 year bridges** (earlier CC service still counts), **≥ 1 year resets**
  to her return to CC. MV months do not count. Below 22 → RED F3. BLOCKED without the timeline or on
  an epoch date.
- 🔴 A3 **she must have been CC at the note date.** MV then → RED F3. **Never read the
  profile-current `HOUSEMAID_TYPE`** — it is as wrong here as a current salary is in group D.
- A4 cash in lieu **and** a `MAIDCC` ticket (D5) for the same journey → RED F2.

🔴 **A2/A3 come from payroll (George Abboud, 2026-09-07) and replace what the code does.** The ERP
gates on `months % 24 == 22` — one month in twenty-four, from `START_DATE`, contract type never
consulted. It agrees with the business only at months 22/46/70. Building on the code would have
flagged or blocked most legitimate airfare payments. **Do not implement the modulo.** The divergence
is a finding for P&C, not a spec choice.

**C — Referral / signing.** 🔴 **Scheme supplied by payroll 2026-09-07. Grain is the referral EVENT,
not the note** — one referral produces up to two notes, judged together.
- C1 `SUM(AMOUNT) over one referral event = 1,000`.
- C2 split: referred maid **CC** → `(referrer 1000, referred 0)`; **MV** → `(500, 500)`, or
  `(1000, 0)` as a stated exception (Q8). The amount is set by the **referred** maid's type.
- C3 the referred maid completed **30 days with the client** before payment. Earlier → RED F3.
- C4 🔴 the referred maid **must not already be with the company** — payroll's *most common reason a
  bonus is rejected*. Prior company record → RED F3.
- C5 `HOUSEMAID_REFERRALS.IS_CANCELLED = 1` and paid anyway → RED F4.
- C6 paid (`MAIDS_REFERRALS_BONUSES.BONUS_AMOUNT`) vs authorised
  (`HOUSEMAID_REFERRALS.AMOUNT`) → disagreement RED F1.
- 🔴 **AED 1,200 is unexplained** — profiled in *both* tables, absent from the scheme; 250/1,500/2,000
  also appear on the payment side and 0 on the referral side. Until it is explained, an amount
  outside `{500, 1000}` is **BLOCKED**, never RED. No counts exist yet.
- ⚠️ **No referral record before 2025-02-20**; payments run from 2022-04-21. C3–C6 **BLOCKED** for the
  earlier period — never "no referral found → F4".
- ⚠️ `REFERRED_MAID_ID` is `COALESCE(direct, latest-by-phone, latest-by-WhatsApp)` — the pairing is
  partly heuristic, so C2 gets the same confidence floor as the expense match.
- **Signing bonus** is *"promised by retractors"* — a per-case retention promise with **no price by
  construction**. C7: a retraction must exist and an authoriser be named, else RED F4; the amount is
  never judged against the referral scheme. 🔴 The two are entangled in free text — the warehouse
  classifies an MV referral by exact-matching the note reason *"Signing bonus for this MV maid
  because she was referred by an MV maid"*, so `PURPOSE_ID` alone does **not** separate them.

**L — Loan-paired advances.** 🔴 L1 Accommodation Relocation: the maid must be **CC live-out** (N19)
and the amount booked as an **addition and a matching loan at the same time** —
`addition_amount = loan_amount`. Addition with no loan → RED F4 (money given, not advanced). Unequal
→ RED F1. Not CC live-out → RED F3. L2 the other advances: same pairing, eligibility BLOCKED. L3
Live-out Transportation Assistance: live-out testable, no rate → BLOCKED. L4 Part-Time Cleaners:
different population, scope decision first.
⚠️ **Already breaking:** `BI_PAYROLL_MAID_SALARY_ADDITIONS_AS_LOAN_IMPACT_BY_CATEGORY` profiles
`ADDITION_LOAN_AMOUNT` from **0** and `LOAN_PERCENTAGE_OF_ADDITIONS` up to **114.75**. That view is
aggregated, starts 2026-01-01, and has no live-out split — it scopes and ties out, it cannot produce
case rows.
**D** D1 recompute from dates + salary in force (N10) · D2 termination mode · D3 window.
**E** E1 expense record proves the amount **AND** E2 the stated reason justifies it. Conjunctive —
if E2 is deferred, E2 is BLOCKED and group E is amber.
**F** F1 maid on the winners list for that draw, nothing else.
**G** G1 amount agrees · G2 `BENEFICIARY_TYPE='MAID'` and id matches · G3
`NULLIF(TRIM(APPROVED_BY),'') IS NOT NULL`.


### 🔴 Tiering — added 2026-09-08, and it is a scope decision, not an optimisation

**Not every payment type earns a bespoke rule.** The live census found 25 types in use over 12
months; thirteen of them carry **99.7% of the money**. The rest are three to eighty notes a year.

| Tier | Types | Treatment |
|---|---|---|
| **1 — full battery** | `anti_attrition_incentive`, `airfare_ticket`, `bonus` (both halves), `salary_dispute`, `forgive_deduction`, `mv_prorated_salary`, `prorated_salary`, `raffle_prize`, `taxi_reimbursement`, `Maids_at_other_expenses`, `last_day_cc_switch_adjustment`, `medical_assistant`, `Accommodation Relocation` | Its own group rule, plus the cross-cutting tests |
| **2 — baseline + review** | everything else, **and every type that appears in future** | The cross-cutting tests only (T1–T7 / S1). **No group rule, no reference list, no ingestion ask.** |

**A tier-2 note is never counted as cleared.** If the cross-cutting tests all pass it does **not**
join M9. It lands on a `RARE_TYPE_REVIEW` list carrying the reason *"no rule exists for this payment
type — human review"*, and its money sits in M8, not M9. This is check #1 applied to a scope
decision: **a payment type nobody wrote a rule for has not been cleared by anything**, and letting it
green because the generic tests passed is exactly the clearance defect wearing a different hat.

**Why this is worth stating rather than just doing.** Writing bespoke logic for a type with three
notes a year costs more than it can ever catch, and each such rule brings a reference list somebody
has to maintain forever. Tier 2 also means the audit **degrades safely**: `Abu Dhabi Incentive`
appeared on 2026-08-31 and needs no code change to be handled — it is picked up, checked generically,
and put in front of a person.

**Promotion is a data question, not a judgement.** Re-run the type census each quarter; any tier-2
type that crosses ~1% of notes or ~1% of money moves to tier 1. `Last Day CC Switch Adjustment` is
the live example — 213 notes in three months, from nothing.

## 9. Metrics

All AED, 2dp, rounded per row then summed.

| | |
|---|---|
| M1 cases in scope | `COUNT(DISTINCT note_id)` over §3 |
| M2 money in scope | `SUM(AMOUNT)`; publish `positive` and `negative` subtotals separately, never netted |
| M7 findings | count + amount where `AUDIT_VERDICT='RED'`, split by `FAILURE_TYPE` |
| M8 unverifiable | count + amount where `AMBER`, **always with the `BLOCKING_REASON` breakdown** |
| M9 cleared | count + amount where `GREEN` |
| M10 coverage | cases `(M7+M9)/M1` · money `(M7.pos+M9.pos)/M2.positive`. `M1=0` → `—`. **Leads the KPI strip** |
| M11 amount at risk | F1 → gap · F2 → representative row only · F3/F4 → full amount. Unquantifiable = 0 by construction |
| M12 duplicate groups | `COUNT(DISTINCT DUPLICATE_GROUP_ID)` |
| M13 match rate | matched / (reason ∈ N16), **per payment type per month**; tile shows aggregate + "n types below floor" |
| M14 completeness exceptions | maid-months failing G1; own count and amount, **not folded into M1/M2/M7** |

Before treating any of these as a new definition, check
`BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` for an approved one. If it holds a definition
for a metric here, that definition wins verbatim, with all of its filters.

## 10. Run guards

| | | Blocks publish |
|---|---|---|
| G1 | Per maid × `audit_month`: `SUM(all that payslip's ADDITION notes, unfiltered) = HOUSEMAID_PAYROLL_HISTORY.ADDITIONS`. **Both sides unfiltered**; reconcile scope exclusions as named lines (`of which refunds: n, AED x`). Residual → M14 | residual → M14 |
| G2 | `COUNT(*) = COUNT(DISTINCT ID)` on D1 | **yes** |
| G3 | `M7+M8+M9 = M1` in count and `= M2` in money | **yes** |
| G4 | `M8.count = COUNT(non-null BLOCKING_REASON)`, and reason buckets sum to M8 in count **and** money | no |
| G5 | No `GREEN` row has a `BLOCKED` or unrun applicable test in `TEST_TRACE` | **yes** |
| G6 | Every verdict word rendered maps to `RED`/`AMBER`/`GREEN` | no |
| G7 | N14/N15/N16 loaded and cover every payment type seen | no — forces BLOCKED |
| G8 | N8 parameters read this run, cast cleanly, displayed on the provenance line | no |
| G9 | **No query filters on `CONFIRMED_*_BY_AUDITOR`; no test reads them as evidence** | **yes** |
| G10 | `COUNT(*) WHERE NOTE_TYPE IN ('EXTRA_SHIFT','BONUS','SALARY_RAISE','REDUCTION') = 0` | no |
| G11 | Each run snapshotted with run id + as-of; re-run of a closed month diffs against the prior snapshot, changed verdicts become exception rows | no |
| G12 | Every TEXT-boolean filter is a string compare; every free-text equality is `NULLIF(TRIM(x),'')` | no |

A blocking guard renders **in place of** the KPI strip, not beside it.

**Why G9 matters.** The ERP's own auditor (`HousemaidsExceptions.generateHousemaidExceptions`)
detects over-limit airfare and repeated additions, but queries only notes where
`CONFIRMED_*_BY_AUDITOR = false`. Once someone confirms one, it leaves the ERP's list **while the
payment stays over the limit**. Inheriting that filter blinds this report to exactly the
population it exists to see. Display the sign-off as context; never let it clear a case.

## 11. UI

One screen: filters → KPI strip → guard strip → case table → one chart → provenance.

KPI order: **coverage (cases, money) first**, then M1/M2, M7/M11, M8, M9, M14, M13. Every tile
carries its metric id.

Case table, default sort **amount at risk desc, then paid month desc**:
verdict pill (colour **and** word) · label · failure type · rule breached or blocking reason ·
note id · maid id · contract · payment type · paid month (`recorded`/`derived`) · amount ·
authorised · at risk · approver · internal sign-off (context) · status.

Filters: audit month (default last completed) · verdict · failure type · payment type · contract ·
blocking reason · reviewed. Drill-down shows the full `TEST_TRACE` — which is what makes an amber
actionable and a green auditable. One chart: amber cases by blocking reason. CSV export of the
row-level detail.

**Sensitivity.** Maids and approvers appear as **internal ids** — no names, phone, contact, EID,
passport, address. `APPROVED_BY` stores a *name*, so map it to an id before display and resolve
only in the reviewed drill-down. For `prorated_salary` / `mv_prorated_salary` /
`previously_held_salary` / `mv_extra_salary` the note amount **is** a salary figure: show a band
on screen, exact value in the reviewed drill-down (Q5). Provenance line names `HOUSEMAIDS_INFO`
and states only non-salary columns are read.

**Maker–checker.** The status column is a write-back — that makes this an application, not a
dashboard. Decide before building (Q6).
