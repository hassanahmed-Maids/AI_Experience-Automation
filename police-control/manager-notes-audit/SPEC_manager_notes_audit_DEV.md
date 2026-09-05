# Manager Notes Audit — developer spec

**Owner** Police & Control · **Rev** 2026-09-05 · **Target** MaidsInsights on Snowflake
**Mockup** https://claude.ai/code/artifact/75d6c4b8-ee4e-431a-aa8a-b19daa19e051

---

## 1. The business case

Every month, managers at maids.cc add money to housemaids' payslips. Flight-home money, loyalty
payments, referral and signing bonuses, part-month salaries, salary corrections, raffle prizes,
reimbursing a maid for money she spent herself. Roughly **1,300 additions a month, worth about
AED 0.5m** — some **AED 6.3m a year across ~16,000 payments**.

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
strip and why amber always carries its reason. §12 lists what is missing and who owns it.

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
re-derives eligibility (§7).

**Refresh: monthly, manual. Never scheduled** — recurring warehouse jobs go through the ERP team.

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
> run §12's three checks before publishing a number.

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
| N11 | referral and signing bonus scheme prices, effective-dated, with their conditions | group C | the referral scheme owner. `MAIDS_REFERRALS_BONUSES` records what was **paid**, never what was **due** — auditing paid against paid proves nothing |
| N12 | raffle winners per draw | group F | `RafflePerformerJob` runs the draw and writes `raffle_prize` notes; start there to find what it reads |
| N13 | the loyalty rule | group B | nowhere. `anti_attrition_incentive` has no eligibility or amount rule anywhere in the ERP — its only reference is a payment-routing list. Someone has to write one (Q4) |
| N14 | payment type → allowed expense heads | T5 | P&C + Payroll |
| N15 | contract type → allowed payment types (all **four** types, see §6) | T7 | P&C + Payroll |
| N16 | payment types that always carry an expense record | T4 | P&C + Payroll — **but two are already answered**, see below |

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

## 6. Traps that return a wrong answer instead of an error

| | |
|---|---|
| **Grain** | D1 LEFT JOINs `expensepayments` on `HOUSEMAID_ID + EXPENSE_ID` with no dedup, and `EXPENSE_ID` is a category. It can emit more rows than notes. **Assert `COUNT(*) = COUNT(DISTINCT ID)` first (G2)** |
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

## 8. Group rules — the 24 payment types

Exactly one group runs per note. Unmapped → BLOCKED → amber.

| `ADDITION_REASON_ID` code | Group | Buildable |
|---|---|---|
| `airfare_ticket` | **A** Flight home | ✅ |
| `anti_attrition_incentive` | **B** Loyalty | ❌ needs N13 |
| `bonus` + purpose `referral_bonus` | **C** Referral | partial — event ✅, price needs N11 |
| `bonus` + other purpose | **C** Signing | partial — price needs N11 |
| `prorated_salary`, `mv_prorated_salary`, `previously_held_salary`, `mv_extra_salary`, `last_day_cc_switch_adjustment` | **D** Part-month | partial — needs N10 |
| `salary_dispute` | **E** Correction | partial — E1 ✅, E2 needs the judgement field |
| `raffle_prize` | **F** Raffle | ❌ needs N12 |
| `taxi_reimbursement`, `medical_assistant`, `Maids_at_other_expenses`, `lost_luggage_compensation` | **G** Reimbursement | ✅ |
| `forgive_deduction`, `cover_deduction_limit`, `cover_negative_salary` | **I** System-generated | pending Q3 |
| `recommendation_from_client` | **J** Google review | ❌ no rule found |
| `pay_vacation_days` | **K** Vacation | ❌ no rule found |
| `renewal_bonus`, `AR-1`, `low_exchange_rate_compensation` | **H** Unmapped | ❌ |
| `office_work_addition`, `refund` | — | out of scope |

**A — Flight home** (all conjunctive)
- A1 `AMOUNT > limit` → RED F1. limit = `PARAMETERS.VALUE` (N8) cast to number,
  Filipina when `HOUSEMAIDS.NATIONALITY` = picklist code `philippines`, else the other-nationality
  parameter. **Strictly greater**, matching the ERP. Use the raw nationality code, **not**
  `NATIONALITY_CATEGORY` — different partitions.
- A2 months since `START_DATE` ≥ 6. A3 `months % 24 == 22`. Both BLOCKED on epoch dates.
- A4 cash in lieu **and** a `MAIDCC` ticket (D5) for the same journey → RED F2.

**C** C1 amount = scheme price at note date (N11) · C2 referral event exists · C3 not already paid.
**D** D1 recompute from dates + salary in force (N10) · D2 termination mode · D3 window.
**E** E1 expense record proves the amount **AND** E2 the stated reason justifies it. Conjunctive —
if E2 is deferred, E2 is BLOCKED and group E is amber.
**F** F1 maid on the winners list for that draw, nothing else.
**G** G1 amount agrees · G2 `BENEFICIARY_TYPE='MAID'` and id matches · G3
`NULLIF(TRIM(APPROVED_BY),'') IS NOT NULL`.

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

**Why G9 matters.** The ERP's own auditor (`HousemaidsExceptions.generateHousemaidExceptions()`)
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

## 12. Before you can finish

Everything in §5's first two tables is available now. These are the pieces that are not, and
none of them is a query away:

| | What | Who |
|---|---|---|
| 1 | **N14, N15, N16** — the three reference mappings. Without them T4, T5 and T7 stay BLOCKED and their notes amber | P&C + Payroll |
| 2 | **N10–N12** — salary history, scheme prices, raffle winners. Each one gates a group rule | respective owners |
| 3 | **N13** — a written loyalty rule. It does not exist anywhere in the company (Q4) | the business |
| 4 | **Timezone of `NOTE_DATE`** and the payslip dates. `TIMESTAMP_NTZ` carries none; if the ERP writes UTC, a note at 02:00 Dubai truncates to the previous day and crosses a lock-window edge | ERP team |
| 5 | **Confirm the note amount is AED.** The note table has no currency column, so the whole spec assumes it. If that is wrong, every comparison, M2, M11 and both tie-outs are wrong in an unknown direction | ERP team |
| 6 | **The `MONTHLYPAYMENTRULES` lock column** (N7) | ERP team |

**Three checks worth running first**, which also close out §5's verification note:

```sql
-- 1. the grain the whole report rests on (G2)
SELECT COUNT(*), COUNT(DISTINCT ID)
FROM BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES;

-- 2. is money moving through a note type this scope excludes? (G10)
SELECT NOTE_TYPE, COUNT(*) FROM ... GROUP BY 1;

-- 3. does an approved definition already exist for any metric in §9?
SELECT * FROM BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER LIMIT 50;
```

## 13. Open decisions (P&C)

**Q1** M13 confidence floor — start 80%, per payment type. Decides red vs amber on unmatched notes.
**Q2** T4 tolerance — AED 0.01 is a float guard, not materiality. Want a materiality band?
**Q3** System-generated additions (group I) in scope or out?
**Q4** The loyalty rule. `anti_attrition_incentive` has no eligibility or amount rule anywhere in
the ERP. Either one gets written, or the report states every month that the largest category of
manager additions cannot be audited.
**Q5** Salary-bearing rows — band on screen, or full amount?
**Q6** Write-back in the first release, or read-only status tracked outside the tool?
