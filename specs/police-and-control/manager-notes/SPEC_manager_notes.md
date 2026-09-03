# Spec — Manager Notes

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Business owner / reviewer** | Jacky (maker–checker; money-out payroll check) |
| **Spec version** | v7 |
| **Date** | 2026-09-03 |
| **UI mockup** | https://claude.ai/code/artifact/a08a0bea-96cf-4ea3-af21-ccced5c94a5d |
| **Delivered on** | **MaidsInsights** — the dashboard the auditor opens. **Snowflake** is the warehouse underneath: tables, role, grants, SQL. Not interchangeable |
| **Status** | Draft. **Four audit gates run** — v1: 10 critical / 15 major · v2: 3 critical / 9 major · v4: 5 critical / 13 major · v5: 7 critical / 13 major. Each gate's findings are accounted for in the changelogs below. **11 of the 20 source rules are still `Pending Business` or `Pending Technical`**, so the build cannot start regardless of this document |

> **Numbering.** The template's `M<n>` and `O<n>` are prefixed **`MN`** here. The payroll-checks
> spec sits in the same folder with its own M1–M10 and O1–O32, and the two are cited across each
> other; unprefixed numbers would collide.

### What changed from v6

Fifth gate: 7 critical, 13 major — *"the class is not dead, but meaningfully closer to dead than at
any previous gate."* Two of the criticals were introduced **by v6's own fixes**.

1. 🔴 **MN8's quantifier was written backwards, in the very paragraph meant to make MN8 and T4
   agree.** *"DISTINCT notes **all** of whose applicable arms are unavailable"* excludes G1's 112
   pending notes (their cap arm is available), giving MN8 = 288,399 / 601 against the published
   470,857 / 713 — **T4 fails by AED 182,458**. v6 closed v5's AED 2,500 gap and opened one
   seventy times larger, one paragraph away. Now *"**at least one** applicable arm unavailable"*.
2. 🔴 **Vacuous truth: `every applicable arm is available` is TRUE over an EMPTY arm set.** A note
   whose payment type no arm selects satisfies the rung-0 / verifier guard trivially, takes
   `cleared_by_rule`, and enters coverage — **and T4 cannot see it, because the note has no
   unavailable arm to appear on either side.** This is the class moved one more level up: from
   *"no rule exists"* to *"no arm claims it."* `cleared_by_rule` now requires a **non-empty** arm set.
3. 🔴 **Rung 0's exception list named ❷, ❺a, ❺b but not ❸, ❹ or ❻b.** First-match-wins, so an
   adjudicated note with no payment type skipped ❹ — the rung whose count must be zero — and one
   with no matched expense record skipped ❻b, dropping out of MG2's numerator.
4. 🔴 **❼b's duplicate key omitted the maid.** `N2 + N7 + N1 + NOTE_DATE::date` groups **across all
   maids**, so every maid receiving the same payment type on the same day is a duplicate of every
   other — the rule would have flagged most of the month red with `expected = 0`.
5. 🔴 **G5: I logged the defect and changed no number.** MN-O28 (added in v6, `Blocking: Yes`) says
   three of G5's five payment types have no expected side — and G5 still rendered 341 clean, zero
   pending. **The clearest instance yet of the pattern: naming the problem is not applying it.**
6. 🔴 **`cannot tell` from the verifier had no verdict, no colour and no bucket**, so those notes
   fell into no metric and **T1 could not close**.
7. **G1's cap arm** was treated as available while N11 said its expected side is not ingested.
   Resolved by declaring the caps code constants rather than an ingestion item — with the honest
   caveat that the code gives *defaults*.

### What changed from v5

The fourth gate said the arm registry *"is the right idea and the first one that moved a number"*
but **is not yet a closed system** — 7 critical, 13 major. Four of the criticals are the class
finding a new door; one is an error of my own that is worse than the class.

1. 🔴 **Rung 0 and rung ❼ were two doors into MN6 that the registry did not guard.** The ladder is
   first-match-wins and both sit **above** the group line, so an ERP sign-off or a `justified`
   verifier return set `cleared_by_rule` **without the blocked arms ever running**. And the ERP's
   sign-off answers a *different question* — round 2 says it covers airfare-over-limit and
   repetition only, which is precisely not what G3's scheme arm tests.
2. 🔴 **`available` had no value for an arm with no expected source at all.** G2 has no ingestion
   item because no rule exists anywhere — so `available = NOT EXISTS(blocking ingestion item)`
   returns **TRUE** and 268 notes become evaluable against nothing. **That is the class with the
   judgement moved one level up**, which is exactly what the registry was meant to prevent.
3. 🔴 **`note_selector` was unconstrained**, so T4 was still satisfiable by construction: write
   G3's selector as *"…notes with no ERP sign-off"* and both sides shrink together.
4. 🔴 **T4 did not close on v5's own month** — 714 notes / AED 473,357 from the registry against
   MN8's 713 / 470,857. The Δ is the G1 cap-breach note, which has one concluded arm and two
   blocked ones, and the verdict space had no cell for *finding **and** partly unevaluable*.
5. 🔴 **I asserted an un-run check as fact, and it blocked most of the dashboard.**
   `00-discovery-log.md` flagged `EXPENSES_CONFIGURATION` as *"the likely home of the price
   lists … not yet assessed"* — and v5 promoted that to *"N11 is not in the warehouse"*, which
   blocks G1's entitlement arm, both G3 arms and G6: the bulk of the 89% headline. **The mirror of
   the class: blocking what could be judged, with no guard that re-tests it.** See D5.
6. **MN5 and MN8 used un-clamped `SUM`**, netting negative additions off the very figures that
   exist to size unevaluable money.
7. **The duplicate rule had no rung, no arm and no metric** — §1 names it as one of four failures,
   §3 gives it a key, example D protects it, and it could not fire.

### What changed from v4

The third audit gate returned **5 critical, 13 major** against v4's content. The root-cause claim
did **not** hold as written, and the class of error survived in two more groups:

1. 🔴 **G3 cleared 95 notes with no expected source.** Its scheme price list is N11 (not in the
   warehouse) and its referral arm needs N6 (not ingested) — yet it rendered 2 findings and 95
   clean. The same defect as G6 in v2 and G4 in v3, a third time.
2. 🔴 **G4's "three arms evaluable" was wrong.** MN-O18 was closed on *the formulas being known*,
   which is not the same as *their inputs being available*: `basicSalary`-at-payroll-time,
   `startDate`, `lastCcSalary`, `switchDate` and `mvExtraAmount` are in no data point and no
   ingestion item. All four arms are blocked.
3. 🔴 **The one G1 finding applied the price list this spec itself declares wrong.** AED 1,000 is
   *under* both caps and is not an exception at all. Worse, it taught `above = amount − 0` when a
   cap rule gives `above = amount − cap` — a builder following it would report a 2,500 Filipino
   airfare as 2,500 over instead of 500.
4. **MN8 spoke in groups while the doctrine speaks in arms**, producing three defensible values
   from one dataset. Restated per-arm.
5. **T4 was not independent.** Both sides derived from the same verdict column, so it closed clean
   while 95 unevaluable notes sat in MN6 — exactly how T1 failed. It now checks against an **arm
   registry** (§3), which is a declared object rather than a consequence of the verdicts.

**The register's numbers move a long way, and that is the finding.** Coverage falls from 66.39% to
**46.56%**, and the money that cannot be judged rises to **89%**. Nothing about the month changed;
what changed is that three groups stopped claiming to have judged it.

### What changed from v3

v3 was structured ad hoc. v4 is the same content on the standard template, plus four things the
template's discipline forced out:

1. **The verdict ladder is now a first-match-wins table with a `Red flag?` column.** In v3 it was
   prose, which let *"route to verifier"* sit in it for two versions as an outcome no metric
   consumed.
2. **Per-metric null / legitimate-zero / negative rules**, rather than one shared block. MN2's
   negative-netting defect existed because the shared block could not say *"this is about MN2"*.
3. **Open items now carry a `Blocking?` column**, and the requestor's decisions moved to their own
   section (§7). Six of the twelve things I had been calling blockers are Jacky's or P&C's, not
   the data team's, and the single list hid that.
4. **`UNVERIFIED` applied consistently** — five column types asserted from a partial answer are
   now marked as such.

No metric logic changed in v4. The v3 corrections (arm-level blocking, `cleared_by_rule`, tie-out
T4) stand as written.

---

## 1. Business Logic

**The control.** Managers add money to maids' payslips every month. Every addition must be
justified by the rule governing its payment type. Money added beyond that rule is leakage.

**The failure it catches.** Overpayment; the same payment made twice; a payment against a rule that
never applied to this maid; and a payment with no basis at all. About **1,347 notes and AED 529,000
a month** — 16,159 payments and AED 6,348,968 over Sep 2025 – Aug 2026 *(requestor's figures,
measured 2026-08-28, re-verifiable by nobody until MN-O1 lands)*.

⚠️ **Part of this is already controlled inside the ERP, and the spec must say so.** *(code-verified,
round 2)* A `payroll_auditor` position works a monthly `PayrollAuditTodo`, generated at lock date,
that already detects **airfare additions over the nationality limit** and **repetitive additions in
a configurable window**, and records sign-off in `CONFIRMED_AMOUNT_BY_AUDITOR` /
`CONFIRMED_REPEATED_BY_AUDITOR`. **G1's amount arm and the duplicate rule are not new.** The honest
case for this dashboard is *independence from that internal role, plus the 22 payment types the ERP
checks nothing about* — that choice is **§7 Q2**, and it changes what coverage should count.

**Reader and action.** A P&C auditor works the month's findings case by case. Jacky reviews before
anything is acted on (maker–checker). **Red** = money added above what the rule allowed, or with no
basis. **Amber/pending** = could not be judged, and why. **Green** = a rule ran and cleared it.

**Population in scope.**
- Every **`ADDITION`** manager note, windowed on **`PAID_ON_PAYROLL_MONTH`** (§2.2b), that was
  applied, paid, and is not a refund.
- **Both contract types.** A **Company Contract** maid was hired by us; a **MaidVisa** maid is our
  employee on paper only. The type decides which payments she can receive at all — flight-home
  money and the loyalty payment are CC-only, the part-month final salary is MV-only.
- **Negative additions.** `AMOUNT` reaches **−3,032** on the live view. An addition that takes money
  back is not an overpayment and must not be clamped to zero — it is `pending`, and it is reported.
- **Notes already signed off by the internal payroll auditor.** In scope, but they must render as
  adjudicated, not re-raised — see the ladder's rung 0.

**Explicitly out of scope.**
- **Deductions** (`DEDUCTION`, `PENALTY_DEDUCTION`). The warehouse stopped recording deduction
  amounts in Oct 2025 and the rows entirely after 24 Dec 2025, so any test built on them reports
  clean forever. Out until the feed is fixed — **MN-O5**.
- **Office-work payments** (G8). A separate check owns them.
- **Client manager notes.** Different records, opposite direction, owned by Client Refunds.
- **Free-text maid-profile notes.** No money attached.

**Restatement policy.** A note that was `pending` because its arm was blocked becomes judgeable the
moment the blocking item lands. Every run recomputes all published months in scope: a row that was
pending and is now cleared moves to **CLEARED — LATE** and stops counting against coverage, and the
original run's figures are retained so the trend is not rewritten. **A pending row means *not yet
judgeable as at this run*, never *was wrong*.**

**Grain.** **One case = one note.** Never one maid, one month or one payment type — a maid with four
additions in a month is four cases. A note is not split by the arm that judges it.

**Refresh expectation.** Monthly, **manual, never scheduled** — consistent with the standing rule
that recurring warehouse processes go to the ERP team. The audit month defaults to the most recent
**closed** payroll month (`MONTHLYPAYMENTRULES.AUDITING_FINISHED`), not simply the previous calendar
month: a month still moving is not auditable.

**Sensitivity class.** **Payroll data** — per-maid salary additions, the manager's free text, and the
maid's identity. No phone number, EID, passport, address or contact detail appears anywhere. Whether
the maid's **name and per-note amount** appear on screen is **not settled** — see **§7 Q1**. Until it
is, the default is the requestor's own written rule: *counts and totals only*.

---

## 2. Data Points Needed

> **Verification note.** The Snowflake role `PAYROLL_AND_MONEY_CONTROL_ROLE` has **no warehouse
> grant**: `SHOW` and `DESC VIEW` succeed from the catalog, anything needing compute fails. So
> **table, column, type and enum claims below are verified**; **row counts, freshness, populations
> and every figure attributed to the requestor are verified nowhere** — that is **MN-O1**. Claims
> about ERP behaviour are verified against the source via Ask the Code and marked *(code-verified)*.

### 2.1 Verified — already in Snowflake

| # | Data point | Database.Schema.Table | Column | Notes / verification |
| --- | --- | --- | --- | --- |
| D1.1 | The note | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | `ID` `NUMBER(38,0)` | **The case grain.** Range 5–183,975 |
| D1.2 | Maid | same | `HOUSEMAID_ID` `NUMBER(38,0)` | Join key. Rule ❶ binds every join to this and forbids name or MOL |
| D1.3 | Note type | same | `NOTE_TYPE` `VARCHAR` | Profiles `ADDITION`, `DEDUCTION`, `PENALTY_DEDUCTION`. *(code-verified: the enum has **seven** values — `EXTRA_SHIFT`, `BONUS`, `REDUCTION`, `SALARY_RAISE` are remnants of the disabled office-staff flow with no active production path)* |
| **D1.4** | **The actual** | same | `AMOUNT` `FLOAT` | 🔴 **Range −3,032 – 44,230.26, and it is `FLOAT`.** Negatives are real (§1); cast to `NUMBER(12,2)` before any equality or difference test, or a stored 1,349.9999999999998 fails an entitlement match |
| D1.5 | What the manager typed | same | `NOTE_REASON` `VARCHAR` | Free text. The verifier's input, and **already in the warehouse** — the 22% of notes needing a reader are a column operation, not an agent walk |
| D1.6 | Payment type | same | `REASON` `VARCHAR` | `COALESCE(a.NAME, d.NAME)` over `mmdb.picklists_items` — the **label**. The 24 types and 9 groups key on it; the **id** behind it is N2 |
| D1.7 | Event date | same | `NOTE_DATE` `TIMESTAMP_NTZ` | From 2016-11-21. **Not the paid month** — §2.2b. Displayed, never the window |
| D1.8 | ~~Manager~~ | same | `MANAGER` `NUMBER(38,0)` | 🔴 **Dead permanently. Do not use.** *(code-verified: `EMPLOYEE_MANAGER_ID` unmapped since PAY-3484.)* Not a sync gap — the source stopped writing it. Per-manager attribution needs N8. **The column should be dropped from the view** |
| D1.9 | Requester | same | `REQUESTED_BY` `VARCHAR` | From `USERS_INFO.NAME`, via the expense-payment join — so **populated only where an expense payment exists** |
| D1.10 | Approver | same | `APPROVED_BY` `VARCHAR` | Same caveat |
| D2.1 | The expense payment | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_PAYMENTS` | `EXPENSE_PAYMENT_ID`, `EXPENSE_ID` `NUMBER(38,0)` | 34 columns. The **expected** side for most of the population |
| **D2.2** | **The comparison amount** | same | `LOCAL_CURRENCY_AMOUNT` `FLOAT` | 🔴 **The only column that is always AED.** *(code-verified, round 2)* `AMOUNT` and `AMOUNT_TO_PAY` follow `CURRENCY_ID`, which has **ten values**. `LOCAL_CURRENCY_AMOUNT` equals `AMOUNT` when the currency is AED and is FX-converted otherwise, and it is what the ERP itself uses for transactions and reporting. **Every comparison reads this column, never `AMOUNT`** |
| D2.3 | Currency | same | `CURRENCY_ID` `NUMBER(38,0)` | AED is `PICKLISTS_ITEMS.ID` where `CODE = 'AED'` under `PICKLISTS.CODE = 'EXPENSE_CURRENCY'`; local currency is also the module parameter `EXPENSE_LOCAL_CURRENCY`, default `AED`. Displayed, not compared |
| D2.4 | Payment state | same | `STATUS` `VARCHAR` | `PAID`, `PAID_PENDING_INVOICE`, `DISMISSED`, `PENDING`. ⚠️ **Which of these authorise a note is not settled — §7 Q3.** Using `PAID` alone silently excludes `PAID_PENDING_INVOICE` |
| D2.5 | Maid scoping | same | `RELATED_TO_TYPE`, `RELATED_TO_ID` `NUMBER(38,0)`; `BENEFICIARY_TYPE` | 🔴 `RELATED_TO_TYPE` is **polymorphic** (`MAID, APPLICANT, OFFICE_STAFF, TEAM`) — the `= 'MAID'` filter is **mandatory**. `RELATED_TO_ID` is type-compatible with D1.2 |
| D2.6 | Actors | same | `APPROVED_BY`, `PAID_BY`, `PAYMENT_REQUESTED_BY` `VARCHAR` | Drill-down |
| **D2.7** | **Receipt evidence** | same | `REQUIRES_INVOICE` `BOOLEAN`; `INVOICE_ATTACHED`, `ATTACHED_VALID_VAT_INVOICE` `VARCHAR`; `INVOICE_NUMBER` | 🔴 **`REQUIRES_INVOICE` is a real `BOOLEAN` but `INVOICE_ATTACHED` is `VARCHAR '00'/'01'`.** G7's receipt test compared to `TRUE` or `1` matches **zero rows** and reports "no findings" |
| D2.8 | Hygiene flags | same | `TYPE` (`PAY`, `PAY_TO_BUCKET`), `STOPPED`, `IS_COMPLETED` (`'00'/'01'`), `CONFIRMED` (`0/1`), `PAYMENT_METHOD` (includes `SALARY`) | State the exact filter set before any join |
| **D3** | **The expense-request pivot** | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | `ID` (= `ert.id`), `EXPENSE_PAYMENT_ID`, `RELATED_TO_TYPE`/`RELATED_TO_ID`, `AMOUNT`, `DESCRIPTION`, **`EXPENSE_TYPE`**, `CURRENCY_ID`, **`CURRENCY_NAME`** | **This is the `EXPENSEREQUESTTODOS` projection, and v2 wrongly said it was absent** — pricing the largest ask in the spec against a view that already exists. `EXPENSE_TYPE` is the **expense head** gate ❼ compares. ⚠️ **Rows whose expense category is `is_secure = 1` are excluded from this view entirely** — MN-O24 |
| D4.1 | Maid name | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | `NAME`, `FIRST_NAME`, `MIDDLE_NAME`, `LAST_NAME` `VARCHAR` | The case subject. Display is **§7 Q1** |
| **D4.2** | **Contract type** | same | `HOUSEMAID_TYPE` `VARCHAR` | 🔴 **Four values, not two: `Normal`, `MAID_VISA`, `FREEDOM_OPERATOR`, `WALKIN`.** Only `MAID_VISA` is MV; the ERP treats the other three as CC. **A two-way CC/MV mapping manufactures ❽ findings against real people.** ⚠️ This is her *current* type — see MN-O14 |
| D4.3 | Nationality | same | `NATIONALITY`, `NATIONALITY_CATEGORY` `VARCHAR` | G1's price split. Filipino = picklist code `philippines` *(code-verified)* |
| D4.4 | Employment state | same | `STATUS`, `DATE_OF_TERMINATION`, `MODE_OF_TERMINATION` | G4's final-salary context |
| D4.5 | Live-out | same | `LIVE_OUT` `NUMBER 0/1` | Separates the transport allowance from genuine taxi trips (G7) |
| **D5.1** | **Per-payment-type configuration** | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` | `SALARY_ADDITION_TYPE` `VARCHAR` — 21 values incl. Airfare Ticket, Bonus, VIP Bonus, Anti-attrition Incentive, Taxi Reimbursement, MOHRE requirement additions | 🔴 **v6: this view was flagged in the discovery log as *"not yet assessed"* and then treated as absent for three versions.** It is the ERP's own per-type configuration and it keys on exactly the axis the groups key on |
| **D5.2** | **G7's expected side** | same | **`REQUIRE_INVOICE`**, **`REQUIRE_ATTACHMENT`** `BOOLEAN` *(verified)* | 🔴 **A real boolean expected value, per payment type.** v5 gave G7's receipt test an *actual* (D2.7) and **no expected at all**. `REQUIRE_ATTACHMENT_VALUE` is the `'00'/'01'` twin — use the BOOLEAN |
| **D5.3** | **Gate ❼'s mapping** | same | `SALARY_ADDITION_TYPE` ↔ D3 `EXPENSE_TYPE` | ⚠️ **One row holds both**, so ❼'s "expense head ≠ payment type" may be a deterministic join, not a question for the text verifier. **Assess before routing it to a classifier — MN-O26** |
| — | ~~`LIMIT_FOR_APPROVAL` as the entitlement~~ | same | `LIMIT_FOR_APPROVAL` `FLOAT` (10–3,700) | ⚠️ **It is not the entitlement.** The sibling `LIMIT_FOR_CEO_APPROVAL`'s own metadata reads *"Approval-amount threshold … above this amount require CEO-level approval"*. **An approval threshold, not a price list** — the G1 caps remain module parameters. Recorded because the fourth gate proposed it as a candidate and the negative is worth stating once |

⚠️ **`HOUSEMAID_MANAGER_NOTES` is 10 columns of a 37-column entity.** Everything in §2.3 is a
column on the table that already feeds this view — a projection, not a pipeline.

### 2.2 Approved KPI definitions reused

| Metric | Source of definition | Reused verbatim? |
| --- | --- | --- |
| MN1, MN2 | `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` | **`UNVERIFIED`.** The view exists (`SHOW TERSE VIEWS`) but **cannot be read without a warehouse** (MN-O1). The Snowflake team must check it before treating MN1/MN2 as new |
| MN1, MN2, per-group split | `BA_VIEWS.HOUSEMAID_MANAGEMENT_GOLD.BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` | 🔴 **A GOLD model already computes this.** `SUBJECT_MONTH`, `MAID_TYPE`, `ADDITION_CATEGORY`, `ADDITION_COUNT`, `ADDITION_AMOUNT`, `TOTAL_ADDITION_COUNT`, `TOTAL_ADDITION_AMOUNT` — MN1 and MN2 by month and category, plus a sibling `…_AS_LOAN_IMPACT_BY_CATEGORY`. **Reconcile against it or record why they diverge.** ⚠️ Every column profiles as *"no non-null values"* — empty, or merely unprofiled? **MN-O25** |
| MN3–MN8 | — | New P&C definitions. No approved model computes a per-note verdict. Add to the Data Catalog once built |

### 2.2b Which date windows the run — settled

*(code-verified, round 1)*

| Field | What the code does with it |
| --- | --- |
| **`PAID_ON_PAYROLL_MONTH`** | **The month the note was actually paid.** Set at transfer in `AsyncService.processCurrentMonthHousemaidsBatchBT` from `accountantTodo.getPayrollMonth()`. The ERP's own paid/deferred queries key on it |
| `NOTE_DATE` | Creation date. Payroll generation windows **unpaid** notes into a run on it |
| `PAYROLL_MONTH` | 🔴 Populated in one narrow MV-prorated branch only, **not used in standard note-selection queries** |

🔴 **The source material calls `PAYROLL_MONTH` "the month it actually pays". The code does not.** A
spec windowed on it would audit almost nothing. Windowing on `PAID_ON_PAYROLL_MONTH` also dissolves
the open question about 216 postponed flight-home notes: an unpaid note has a null there and leaves
the population by construction — no exclusion rule, no cut-off to tune.

### 2.2c How a note points at its expense payment — there is no key

*(code-verified, rounds 1 and 2)*

> **No FK** from `PAYROLLMANAGERNOTES` to `EXPENSEPAYMENTS`, `EXPENSEREQUESTTODOS`, or `EXPENSES`.

`ManagerNoteService.processExpenseRequestTodo` **copies** fields at creation. The ERP's own reverse
lookup — the best available authority — is:

```
HOUSEMAID_ID + ADDITION_REASON_ID + NOTE_REASONE LIKE '%…%'
   → EXPENSES_REQUESTS → EXPENSE_PAYMENT_ID → EXPENSES_PAYMENTS
```

**Which notes should have one** *(round 2)*. There is no origin field, but the reason id partitions
the population:

- **Definitely not** — `cover_deduction_limit`, `cover_negative_salary`, `prorated_salary`,
  `office_work_addition`, `mv_extra_salary`, `mv_prorated_salary`,
  `last_day_cc_switch_adjustment`, `refund`, **or `SCHEDULED_ANNUAL_VACATION_ID` is set**.
- **Ambiguous** — `salary_dispute`, `taxi_reimbursement`, `forgive_deduction`, `airfare_ticket`,
  `bonus`: each can come from the expense path *or* a system path.

**MG2's denominator is the population minus the "definitely not" list — and ❻b uses the same
predicate.** 🔴 **Stated once, here, v7:** *expected to match ≡ not in the "definitely not" list.*
⚠️ **11 of the 24 payment types are in neither list**, so for those the predicate is undefined and
their arms are `blocked_no_rule_exists` — which is what C6 found in G5 and M1 in G7.

🔴 **The false-positive mode is the duplicate rule's own population.** Two notes, one maid, one
month, same amount and reason are indistinguishable to this lookup — exactly what G3 judges. **The
match runs *after* grouping**, never before.

⚠️ **And the reverse gap: an `EXPENSEREQUESTTODO` can exist without a note** (non-SALARY payment, or
`amountAlreadyPaid = true`). An authorised expense that never reached a payslip is invisible to a
check that starts from notes — **MN-O22**.

---


### 2.3 New data ingestion request — NOT yet in Snowflake

Every field is a confirmed column on `PAYROLLMANAGERNOTES`, which already feeds D1.

| # | Column | Type | Why | Without it |
| --- | --- | --- | --- | --- |
| **N1** | `PAID_ON_PAYROLL_MONTH` | `DATE` | **The population window** (§2.2b) | No correct month filter exists at all |
| **N2** | `ADDITION_REASON_ID` | `BIGINT` | The structured half of the expense match, and the group key behind D1.6's label | Match falls back to text + amount |
| **N3** | `APPLIED`, `PAID` | `TINYINT(1)` | MN1's own filter | Unapplied notes counted as money out |
| **N4** | `IS_REFUND`, `REFUNDED_NOTE_ID` | `TINYINT(1)`, `BIGINT` `UNVERIFIED` | The **refund** chain | A refund reads as a duplicate |
| **N5** | `OLD_NOTE_ID` | `BIGINT` | The **supersession** chain — *a different chain from N4* | A corrected note counted as a duplicate of the note it replaced |
| **N6** | `REFERRED_MAID_ID` | `BIGINT` | G3's referral arm | That arm is permanently blocked |
| **N7** | `PURPOSE_ID` | `BIGINT` | Structured purpose; part of the duplicate key | Text fallback |
| **N8** | `FROM_MANAGER_ID`, `CREATOR`, `LAST_MODIFIER` | `BIGINT` `UNVERIFIED` | Actor attribution, replacing dead D1.8 | No per-manager view |
| **N9** | `PAYROLL_ACCOUNTANT_TODO_ID` | `BIGINT` `UNVERIFIED` | Ties the note to the payroll run — **the same `PayrollAccountantTodo` the payroll-checks spec is built on**. Tie-outs T2 and T3 rest on it | The two P&C payroll dashboards cannot be reconciled |
| **N10** | `CONFIRMED_AMOUNT_BY_AUDITOR`, `CONFIRMED_REPEATED_BY_AUDITOR` | `TINYINT(1)` | 🔴 **Required, not optional.** The ERP's internal auditor signs off here (§1). Without them the dashboard re-raises closed cases | Every finding list restates adjudicated cases |
| **N11** | The **G6 winners list** and the **G3 scheme prices** | — | The **expected** side for those two arms. 🔴 **v7: the G1 caps come out of N11.** They are module parameters read via `Setup.getParameter()`, so the build carries them as **code constants in the SQL**, and `G1.cap` gets `expected_source = §3 constant (code-verified)` — that is what makes the cap arm legitimately `available`. ⚠️ **`UNVERIFIED — production parameter values not readable`**: round 2 gave the code *defaults* (2,000 / 1,350); the `Parameter` table is not in the warehouse, so a changed production value would silently move every G1 verdict. **Re-scoped in v6:** D5 supplies G7's expected side and possibly ❼'s mapping, so N11 is narrower than v5 claimed — but `EXPENSES_CONFIGURATION` holds **approval thresholds, not entitlements**, so it does **not** unblock G1, G3 or G6 | Those arms have nothing to compare against |
| **N12** | On **D3**, add `SALARY_ADDITION_TYPE_ID`, `REFERRED_MAID_ID`, `PURPOSE_ADDITIONAL_DESCRIPTION_ID` `BIGINT` `UNVERIFIED`, **and `LOCAL_CURRENCY_AMOUNT`** | — | The three columns the pivot lacks — plus a fourth: 🔴 **`LOCAL_CURRENCY_AMOUNT` exists on `EXPENSES_PAYMENTS` but NOT on `EXPENSES_REQUESTS`**, which is where the match lands. "The AED fix is one column" does not reach the request side, and a note matched to a USD request would compare AED to USD silently. Until it is added, filter `CURRENCY_NAME = 'AED'` on D3 and count the rest separately | The match runs in mixed currencies |
| **N13** | `SCHEDULED_ANNUAL_VACATION_ID`, `NUMBER_OF_DAYS_WORKED_AT_OFFICE` | `BIGINT`, `INT` `UNVERIFIED` | The structural signals that make §2.2c's partition — and so MG2's denominator — computable | ❻b has no basis |
| **N14** | **G4's recalculation inputs**: the salary **as at payroll time**, `startDate`, `CcMaidSwitchedToMv.lastCcSalary` + `switchDate`, and `BaseAdditionalInfo.infoValue` where `infoKey = 'mvExtraAmount'` | — | 🔴 All four G4 arms need them. ⚠️ `HOUSEMAIDS_INFO.BASIC_SALARY` exists but is her **current** salary — the same snapshot problem as MN-O14 | G4 is entirely unevaluable, AED 815,001/yr |
| **N13** | Structural origin signals: `SCHEDULED_ANNUAL_VACATION_ID`, `NUMBER_OF_DAYS_WORKED_AT_OFFICE` | `BIGINT`, `INT` `UNVERIFIED` | Identify notes that **should not** have an expense record (§2.2c) | ❻b and MG2's denominator have no basis |

## 3. Metric Calculations

Currency **AED**; the expected side is multi-currency and every comparison reads **D2.2**, never
`AMOUNT`. Money rounded 2 dp for display; comparisons cast to `NUMBER(12,2)` first. Percentages
2 dp. Audit month = the most recent **closed** payroll month.

### MN1 — Notes in scope

- **Business definition.** The additions this month's audit is responsible for.
- **Formula.** `COUNT(D1.1)` where `D1.3 = 'ADDITION'` **and** `N1` falls in the audit month **and**
  `APPLIED = 1` **and** `PAID = 1` **and** `IS_REFUND = 0`, with superseded (`OLD_NOTE_ID`) and
  refunded (`REFUNDED_NOTE_ID`) chains collapsed to their surviving row.
- **Nulls.** A null `N1` is **out of population**, not zero — and T3 is what distinguishes that from
  a broken sync.
- **Legitimate zero.** None. MN1 = 0 is guard MG5: a finding about the run.
- **Negatives.** n/a. ~1,347/month expected *(requestor)*.

### MN2 — Money added

- **Formula.** `SUM(GREATEST(D1.4, 0))` over MN1, with **negative additions reported separately** as
  a count and an amount.
- 🔴 **Why `GREATEST`.** A plain `SUM` nets the negatives (D1.4 reaches −3,032) against the
  positives, so "money added" understates money added — **and T1 still closes, because both sides
  are netted**, so no tie-out can see it.
- **Rounding.** 2 dp at note level; the total is the sum of rounded notes.

### MN3 — Above expected *(the headline)*

- **Business definition.** What we paid above what the payment type's rule allowed.
- **Formula.** `SUM(GREATEST(actual − expected, 0))` over notes whose verdict is *finding*, where
  `actual` = D1.4 and `expected` comes from the arm that judged it. Where no rule was met at all,
  `expected = 0` and the whole amount is the finding.
- 🔴 **`expected = 0` and `expected IS NULL` are different events and v4 did not distinguish them.**
  **`expected = 0` only when an arm ran and concluded that no entitlement applies.** An arm that
  could not run leaves `expected` **NULL** and the note **pending**. A `COALESCE(expected, 0)`
  turns every unevaluable note into a finding for its full amount; the opposite reading turns every
  ❽ finding into pending.
- 🔴 **Nulls.** `GREATEST` returns **NULL** in Snowflake when either argument is NULL, so an unknown
  expected value contributes **0** and — under any remainder-based clean rule — reads as clean.
  **`expected IS NULL` ⇒ the note is `pending`**, never a zero contribution.
- **Legitimate zero.** A finding with `actual = expected` cannot exist; MN3 = 0 across a month means
  no findings, which is a real answer.
- **Negatives.** Clamped by `GREATEST`, which is why the negative-amount gate must fire **before**
  the group rules — otherwise a negative addition reads as clean.
- **Duplicates.** For a duplicate finding, `expected = 0`: the whole second payment is the excess.

### MN4 — Findings · MN5 — Pending · MN6 — Clean

| | Formula | Notes |
| --- | --- | --- |
| **MN4** | `COUNT` of notes with verdict *finding* | The red count |
| **MN5** | `COUNT` and **`SUM(GREATEST(D1.4, 0))`** where verdict is *pending*, with the negative count and amount reported alongside | **Amber. Never folded into clean.** Includes every blocked arm and every ❾ note. 🔴 **v6: clamped.** §1 puts negative additions in `pending`, so v5's plain `SUM` netted them off the very figures that size unevaluable money — the defect `GREATEST` was added to MN2 to kill, reintroduced two metrics later |
| **MN6a** | `COUNT` of notes cleared by a **deterministic rule** | 🔴 **A rule sets `cleared_by_rule`; nothing else does. Never a remainder, never computed by subtraction.** As a remainder it swept blocked notes into clean in three successive versions |
| **MN6b** | `COUNT` of notes cleared by the **text verifier** returning `justified` | **Shown separately, v5.** A model's opinion and an arithmetic rule are not the same evidence, and folding them into one "clean" figure hides how much of it is a classifier. Carries a **sampled human review rate** |
| **MN6c** | `COUNT` of notes cleared at **rung 0** by an ERP payroll-auditor sign-off | **v7.** Not a deterministic rule and not a classifier — a third kind of evidence, and §7 Q2's decision has no number without it |
| **MN6** | `MN6a + MN6b + MN6c` | Displayed as the total, **always with the three-way split beneath**. ⚠️ Whether MN6c counts toward MN7 is **§7 Q2**: if the dashboard's purpose is independence from the internal auditor, it should not |

### MN7 — Coverage

- **Definition.** The share of the month that actually reached a verdict.
- **Formula.** `(MN4 + MN6) / MN1`.
- 🔴 **The identity `MN7 ≡ 1 − MN5/MN1` is unavoidable given T1, and always was.** The defect in
  earlier versions was **MN5's population**, not the algebra: with MN6 a remainder, blocked and
  unmatched notes never reached MN5, so the ratio could not move. MG4 and ❻b fix what lands in MN5.
  **A builder who "fixes the algebra" instead will reintroduce the defect.**
- **Division by zero.** MN1 = 0 → render `—`, never 0%. Guard MG5.

### MN8 — Unevaluable money

- **Formula.** `SUM(GREATEST(D1.4, 0))` over **DISTINCT notes with at least one applicable arm
  unavailable, less any note carrying a concluded red arm**, with the negative count and amount
  reported alongside. No group clause — v4 carried one, and *"every note in a BLOCKED group"* plus *"a group's status is the
  worst of its arms"* produced **three defensible values from one dataset** (348,130 / 349,130 /
  402,947), so T4 passed or failed on the builder's reading.
- **A subset of MN5, and the tile says so** — otherwise a reader adds the two together.

### MN — Verdict

Evaluated in order; **first match wins**.

| # | Condition | Verdict | Colour | Red flag? |
| --- | --- | --- | --- | --- |
| ❷…❺b | *(the scope and sanity gates run first — see below)* | | | |
| 0 | already signed off by the internal payroll auditor (**N10**) | **ADJUDICATED — ERP** — sets `cleared_by_rule` **only if every applicable arm is `available`**; otherwise `PENDING — ADJUDICATED, ARM BLOCKED` | ⚪ Grey | No — shown with the sign-off, never re-raised |
| ❶ | *(binding, not a verdict)* every join is on `HOUSEMAID_ID`, never name or MOL | — | — | — |
| ❷ | `PAID_ON_PAYROLL_MONTH` ≠ audit month | **OUT OF SCOPE** | — | No |
| ❸ | housemaid profile unreachable | **PENDING** | ⚪ Grey | No — an outage, not a finding |
| ❹ | no payment type recorded | **PENDING** | ⚪ Grey | No — **and this count must be zero** |
| ❺a | `AMOUNT < 0` | **PENDING — NEGATIVE ADDITION** | ⚪ Grey | No |
| ❺b | `AMOUNT = 0` | **PENDING — ZERO PAYMENT** | ⚪ Grey | No |
| ❻a | matched to an expense record, **`LOCAL_CURRENCY_AMOUNT`** disagrees | **AMOUNT DISAGREES** | 🔴 Red | **Yes** |
| ❻b | expected to match (§2.2c), no expense record found | **PENDING — UNMATCHED** | ⚪ Grey | No — into MG2's numerator |
| ❼ | expense head (D3 `EXPENSE_TYPE`) ≠ payment type | **VERIFIER** → `justified` → clean (MN6b) · `unjustified` → finding · **`cannot tell` → `PENDING — VERIFIER COULD NOT TELL`**, into MN5 **and MN8** (no arm concluded) | ⚪ / 🔴 | Only if `unjustified` |
| ❼b | **duplicate within the group** — more than one addition on the group's key — 🔴 **`D1.2 HOUSEMAID_ID`** + N2 + N7 + N1 + `NOTE_DATE::date`, excluding `cover_deduction_limit` and `cover_negative_salary` | **DUPLICATE** — `expected = 0`, the whole second payment is the excess | 🔴 Red | **Yes** |
| ❽ | her contract type (D4.2) cannot receive this payment | **NOT HER ENTITLEMENT** — ⚠️ **renders `PENDING` until MN-O14 lands** (guard MG7): D4.2 is her *current* type, so a maid who switched after payment would take a fabricated finding | 🔴 Red / ⚪ Grey | **Yes**, once the snapshot exists |
| — | **exactly one group rule, judged by the applicable arm** — G1…G7 | per arm | | |
| ❾ | nothing settled it | **PENDING — NO RULE CONCLUDED** | ⚪ Grey | No |

**The red shapes are exactly ❻a, ❼b, ❽ and an `unjustified` verifier return.** 🔴 **v6 added ❼b.**
§1 names *"the same payment made twice"* as one of four failures the check exists to catch, §3 gives
it a key and example D protects it — and through v5 it had **no rung, no arm and no metric**, so it
could not fire, could not be blocked, and could not appear in MN4. Notes were cleared with the test
never having run: a fourth door into MN6. Everything else is
reported in its own section and never mixed into the headline.

🔴 **Blocking is per ARM, not per group.** A group rule has several arms (G1: amount · entitlement ·
periodicity; G4: one formula per payment type; G3: scheme price · referral). A note is judged by the
arm that applies to it. So: **a note whose arm is blocked is `pending` and into MN8, even inside an
otherwise evaluable group; a note whose arm concluded may still be a finding, even inside an
otherwise blocked group.** Earlier versions said *"a note in a blocked group is pending whatever
else is true"*, which read literally converts a concluded finding into pending — and the register
did the opposite of what the text said, twice.

🔴 **`cleared_by_rule` requires a NON-EMPTY applicable-arm set.** A note whose payment type no arm
selects has an empty set, and *"every applicable arm is available"* is **TRUE over the empty set** —
so v6's guard cleared it vacuously, and **T4 could not see it**, because a note with no unavailable
arm appears on neither side of the identity. **An empty arm set falls to ❾:
`PENDING — NO RULE APPLIES TO THIS PAYMENT TYPE`.** This is the class one level further up than v6
caught it: from *"no rule exists for this group"* to *"no arm claims this note"*.

🔴 **Rung 0 and a `justified` ❼ return set `cleared_by_rule` ONLY when the applicable-arm set is
non-empty AND every arm in it has `available = TRUE`.** Otherwise the note is `pending`, reason
`ADJUDICATED — ARM BLOCKED` or `VERIFIER-CLEARED — ARM BLOCKED`, and it stays in MN5 and MN8.
**v5 left these as two unguarded doors into MN6**: the ladder is first-match-wins and both rungs sit
above the group line, so either could clear a note without its blocked arms ever running. And the
ERP sign-off answers a *different question* — round 2 confirms it covers airfare-over-limit and
repetition only, which is not what G3's scheme arm tests. **A sign-off about an amount is not a
sign-off about an entitlement.**

🔴 **Rung 0 runs after ❷, ❸, ❹, ❺a, ❺b **and ❻b** — every gate whose verdict is pending for a
structural reason.** v6 named only ❷/❺a/❺b, so an adjudicated note with **no payment type** skipped
❹ (the rung whose count must be zero, and MG6's trigger) and one with **no matched expense record**
skipped ❻b, dropping silently out of MG2's numerator.

### Groups

| Group | Payment types | AED/yr *(requestor)* | Expected comes from | Evaluable? |
| --- | --- | --- | --- | --- |
| **G1** Flight home | Airfare Ticket | 2,219,500 | 🔴 **The source material is wrong twice, and the ERP settles both** *(round 2)*. Limits are module parameters — `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` = **2,000**, `PARAMETER_HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT` = **1,350** — and they are **caps, not prices**, so paying less is not an exception. **1,500 appears nowhere in housemaid airfare code.** Eligibility is `numOfMnths % 24 == 22` with `>= 6`: **22 months, periodic — not 24, not once-only** | **Amount arm only, and it must be rewritten first — MN-O21** |
| **G2** Loyalty | Anti-attrition Incentive | 1,620,868 | 🔴 **Nothing. No payment scale exists anywhere** — 307 distinct amounts, 0–900 | **No.** Declared gap → MN8 |
| **G3** Referral / signing | Bonus, VIP Bonus | 844,916 | Each scheme's price and conditions | **No — both arms blocked.** The scheme price list is N11, not in the warehouse; the referral arm needs N6. v4 cleared 95 of these |
| **G4** Part-month / final salary | MV Prorated Salary, Prorated salary, Last Day CC Switch Adjustment, MV Extra Salary | 815,001 | **One formula per type** *(round 2)*: `prorated_salary` = `round(basicSalary ÷ calendar days in the **previous** payroll month × days from startDate to the 1st)`, firing only when `startDate` ≥ the **27th of the previous month**; `last_day_cc_switch_adjustment` = `round(lastCcSalary ÷ days in **this** month)`, only when `switchDate` is the month's last day; `mv_extra_salary` = a config literal (`BaseAdditionalInfo.infoValue`, `infoKey = 'mvExtraAmount'`) | 🔴 **No — all four arms blocked.** Knowing a formula is not having its inputs: `basicSalary`-at-payroll-time, `startDate`, `lastCcSalary`, `switchDate` and `mvExtraAmount` are in no data point and no ingestion item (**N14**). ⚠️ **Two divisors, in two different months** — using one for both inverts the group. A note outside its type's trigger window is itself a finding |
| **G5** Salary corrections | Salary Dispute, Forgive Deduction, MOHRE requirement additions, Medical Assistance, Lost Luggage Compensation | 479,025 | D2.2 for the two types §2.2c covers; what it cannot settle routes to ❼ | 🔴 **Partly — three of five arms blocked.** `MOHRE requirement additions`, `Medical Assistance` and `Lost Luggage Compensation` appear in **neither** list in §2.2c, so ❻b cannot fire and their expected side is undefined: `blocked_no_rule_exists` until §2.2c is extended (**MN-O28**). v6 logged this as blocking and still rendered 341 clean / 0 pending — **naming a defect is not applying it** |
| **G6** Raffle | Raffle Prize | 180,000 | The draw's winners list — **identity only** | **No** — N11 |
| **G7** Reimbursements | Taxi Reimbursement, Maids.at other expenses, Accommodation Relocation, Passport Assistance, Flight ticket, Sim card, Cash advance, Transport fare | 159,652 | D2.2 — amount, beneficiary and approver must agree. 🔴 **Receipt test now has an expected side — `D5.2 REQUIRE_INVOICE` / `REQUIRE_ATTACHMENT`, per payment type.** v5 gave it an actual and nothing to compare against. Reads D2.7 as **`VARCHAR '00'/'01'`**, never as a boolean. ⚠️ **`Cash advance` and `Transport fare` have no row in `EXPENSES_CONFIGURATION`** *(verified — the nearest labels are `Cash Advance for Cleaner's NOL Card` and `Transportation Allowance Loan`, which are different)*, so the receipt arm is `blocked_no_rule_exists` for them until the label mapping is settled — **MN-O29** | Partly, once N12 lands |
| **G8** Office work | Office Work Addition | 29,856 | — excluded from the population | n/a |
| **G9** No type | the one blank | 150 | — gate ❹ catches it | Yes |

*All 24 payment types are in a group; the nine annual figures sum to AED 6,348,968 exactly
(requestor's reconciliation, independently re-added).*

**Three design constraints, each with a reason:**

- **Do not build three obvious raffle gates.** Prize amounts, winner counts and paid-twice-in-a-month
  each fire **zero times in six years and 3,408 payments**. G6 tests **identity only**. A gate that
  cannot fire makes a check look thorough while testing nothing.
- **The duplicate key — take the ERP's own, because the ERP already runs this test.**
  `HOUSEMAID_REPETITIVE_ADDED_PAYMENTS` fires on **more than one addition in a configurable window**
  (`PARAMETER_HOUSEMAID_REPETITIVE_ADDITION_LIMIT`), **excluding `cover_deduction_limit` and
  `cover_negative_salary`**. ⚠️ **And add `NOTE_DATE::date`** — without it, worked example D's six
  deduction-cancellations are identical on maid, reason, purpose and month, so the key flags all six:
  the 694 false alarms the example exists to prevent.
- **Two payment types are mislabelled and the expense record proves it.** 322 of 474 "Taxi
  Reimbursement" are a monthly transport allowance for live-out maids (D4.5); all 82 "MOHRE
  requirement additions" are payroll error corrections. ❼ catches both mechanically. **Consequence
  for G7: the receipt test applies only to the 152 genuine taxi trips** (474 − 322) — an allowance
  has no receipt.

### Tie-outs and run guards

| # | Identity | Catches |
| --- | --- | --- |
| **T1** | `MN1 = MN4 + MN5 + MN6` and `MN2 = Σ group AED` | A note in no bucket, or a group total adrift from the population |
| **T2** | `MN2` = the manager-note additions on the payroll run reached through **N9** | The window column failing |
| **T3** | Notes with a `PAYROLL_ACCOUNTANT_TODO_ID` but a **null `PAID_ON_PAYROLL_MONTH`** = 0 | ⚠️ §2.2b treats a null window as "not yet paid, leaves by construction". **That is also what a broken sync looks like.** T3 tells them apart |
| **T4** | 🔴 **`MN8` and its note count = the totals derived from the arm registry**, not from the verdict column | **The identity that matters, and v4's version did not work.** It compared MN8 to *"notes whose arm is blocked"* — both sides read from the same verdict assignment, so it closed clean at 348,130 = 348,130 while 95 unevaluable G3 notes sat in MN6. It must be an **equality on both AED and note count**, with the right-hand side computed from the registry below and the ingestion status, never from a verdict |

**The arm registry — a declared object, v5.** v4 said *"each group carries an arm table"* and then
defined no such thing, which is why T4 had nothing independent to check against. The registry is a
table the build maintains:

| Column | Meaning |
| --- | --- |
| `group_id`, `arm_id` | e.g. `G1.cap`, `G1.entitlement`, `G1.periodicity`, `G4.prorated_salary` |
| `expected_source` | the D-point or N-item the arm's expected value comes from. 🔴 **May not be NULL when `available = 'available'`** |
| `available` | 🔴 **Three-state, v6: `available` · `blocked_not_ingested` · `blocked_no_rule_exists`.** Derived from ingestion status and the existence of a rule — **never** from whether any note cleared, a group badge, or a human toggle. **v5's two-state version returned TRUE for G2**, whose arm has no ingestion item because *no rule exists anywhere*, making 268 notes evaluable against nothing — the class with the judgement moved one level up |
| **`rule_evidence`** | 🔴 **v7.** What makes this arm's rule real: a §2 D-point, a code-verified module parameter named with its `Setup.getParameter()` key, or a dated §7 decision. **An arm may not be `available` with an uncitable `rule_evidence`, and T4 fails if one is.** Without this, `blocked_no_rule_exists` is a human judgement wearing a data column's clothes — someone writes *"the loyalty scale is 500 flat"* and 268 notes turn evaluable. **Arms default to blocked** |
| `note_selector` | which notes this arm applies to. 🔴 **Expressible over the population filter and `D1.3` / `D1.6` / `N2` / `D4.2` / `D4.3` / `D4.5` only** — stable profile attributes, none of them a verdict. *(v7 added D4.3 and D4.5: the cap arm splits on nationality and G7's receipt test on live-out — the 322 allowance rows vs the 152 genuine taxi trips — and v6's vocabulary could express neither.)* It may **not** reference a verdict, `cleared_by_rule`, any MN metric, a ladder rung, or an ERP sign-off field. **v5 left this unconstrained**, so a selector written as *"…notes with no ERP sign-off"* shrinks T4's right side to match its left and the identity closes on a lie |

⚠️ **`available` cannot be TRUE for a column nobody has confirmed exists.** Several
`expected_source` values (N4's `REFUNDED_NOTE_ID`, N8, N9, N12's D3 columns, N13) are marked
`UNVERIFIED` — *ingested* is not *exists*, and the registry must treat an unverified source as
`blocked_not_ingested` until Ask the Code or the data team confirms it.

🔴 **The three rules that make MN8 and T4 agree — v6.** v5 had *"whose applicable arm could not
conclude"* (singular) against a registry saying *"every arm applicable to it"*, and the two
disagreed by AED 2,500 on the spec's own month:

1. **A note with any concluded red arm is a finding and leaves MN8**, whatever its other arms say.
2. **MN8 and T4's right side both count DISTINCT notes with *at least one* applicable arm
   unavailable**, less those removed by rule 1. 🔴 **v6 wrote "all of whose arms are unavailable"
   and that is wrong**: G1's 112 pending notes have an available cap arm, so they dropped out and
   T4 failed by AED 182,458 on this spec's own month. DISTINCT still matters — G1's two blocked
   arms select the same 113 notes, and a per-arm sum would double-count them.
3. **A note with a concluded green arm and a blocked arm is `pending`**, not clean — rule 1 is
   asymmetric on purpose: a finding is evidence, a clearance is only the absence of one.

**A note is clean only when *every* arm applicable to it concluded satisfied.** v4 said *"the arm
that applies to it"*, singular — which for G1's conjunctive arms (amount ∧ entitlement ∧
periodicity) lets a note pass the cap arm, take `cleared_by_rule`, and land in MN6 with its
entitlement unknown. The prose in worked example B said the right thing; the rule did not.

| Guard | Condition | Behaviour |
| --- | --- | --- |
| **MG1** | N1 not ingested | **Whole dashboard `BLOCKED`.** No correct month filter exists; do not render a partial month as a result |
| **MG2** | Expense-match rate below floor | Denominator per §2.2c. Below the floor MN3 and MN7 render `BLOCKED`, not low. **Provisional floor: 10 points below the first month's observed rate**, so the guard works from day one — replaced by a measured floor at MN-O10 |
| **MG3** | Verifier unavailable | ❼-routed notes stay `pending`; MN7 falls and says why |
| **MG4** | An arm's expected source missing | That arm renders `BLOCKED`; **every note it would have judged goes to MN5 and MN8, never MN6**. Each carries an expected-by date, **watched by the auditor at the monthly run — not by a scheduled process** |
| **MG5** | MN1 = 0 | **`SKIPPED`, and that is a finding about the run.** ~1,347/month is the norm; zero means the feed broke |
| **MG8** | A payment type in the month maps to no group | **Run-level exception, v7.** §3's *"all 24 payment types are in a group"* is true of the requestor's export as at 2026-08-28, **not of the ERP**: `EXPENSES_CONFIGURATION` holds labels the 24 do not (`Bingo Activity winner`, `Google Review`, `MV Maid Affiliation Program`…). An unmapped type is the live route into the vacuous-clean hole |
| **MG7** | MN-O14 unresolved | ❽ renders `pending`, never a finding. D4.2 is the maid's current type; a post-payment switch would manufacture a finding against a real person |
| **MG6** | G9 count > 0 | A blank payment type is a run-level exception. **Without this it had no consequence and a month containing one could still read Pass** |

**Month verdict.** The denominator is **7** — G8 is out of the population and G9 is a gate:

```
any group has findings   → Fail
else MG6 or MG5 fired    → Fail (incomplete)
else any arm BLOCKED     → Partial — <n> of 7 group rules evaluated
else                     → Pass
```

---

## 4. Finalised UI Report

**Mockup:** https://claude.ai/code/artifact/a08a0bea-96cf-4ea3-af21-ccced5c94a5d

**Layout.** One screen: run header → KPI strip → **coverage bar** → group register → cases to work →
verdict ladder + guards → provenance line.

**KPI strip.** MN1 · MN2 · **MN3 above expected** · MN4 findings · MN5 pending (count **and** AED) ·
**MN7 coverage** · MN8 unevaluable, labelled *within pending, not extra*. **MN3 and MN7 lead** — a
month reporting few findings on low coverage is reporting nothing, and the two must be read together.

**Coverage bar.** The month's money split four ways — cleared · finding · **cannot be judged**
(hatched, because it is not a result) · pending-other. This is the page's thesis: it is currently
normal for **two thirds of the money to be unjudgeable**, and a bar that rendered it green would lie.

**Columns (cases table and export).**

| Column | Source | Format |
| --- | --- | --- |
| Note | D1.1 | integer, links to the ERP note |
| Maid | D4.1 + D1.2 | **pending §7 Q1** |
| Payment type | D1.6 | text |
| Group · arm | §3 | chip |
| Amount | D1.4 | `AED #,##0.00` |
| Expected | the arm | `AED #,##0.00`, `—` when the arm is blocked |
| **Above** | MN3 | `AED #,##0.00` — **default sort, desc** |
| Rule that fired | the ladder | text |
| Verdict | §3 | badge |
| Matched expense | D3 | id or *unmatched* |
| Paid on / note date | N1, D1.7 | `YYYY-MM` / `YYYY-MM-DD` — **the gap between them is worth seeing** |
| Requested / approved by | D1.9, D1.10 | text |

**No case-status column in v1 of the build.** A reviewed/open state is auditor workflow and needs a
write-back target — which is **MN-O7**, and the ERP already has the flags. Ship without it or
resolve MN-O7 first.

**Sections**, each with its own subtotal, none in the headline: findings · pending by reason ·
adjudicated in the ERP (rung 0) · cleared — kept visible, because hiding them hides MN7's
denominator.

**Filters.** Audit month (default: most recent closed) · group · arm status · verdict · maid type
(D4.2) · minimum amount.

**Drill-down.** The note text in full; the expense record it matched **and which predicates hit**;
the arm that fired with its condition; the arithmetic; and the ERP sign-off where one exists.

**Conditional formatting.** Verdict drives colour, and **colour is never the only carrier** — every
row states its verdict in words.

**Provenance line.** Sources and ids · audit month and its lock timestamp · data-as-of · spec
version · **which arms were blocked on this run** · refresh: manual, never scheduled.

**Run integrity panel.** T1–T4 and MG1–MG6, pass/fail, **with the numbers**. A failed tie-out
**blocks publication and says so on the page**.

**Export.** CSV of the case grain — the same columns the screen shows, no privileged wider extract,
logged like a view.

---

## 5. Worked Examples

*Synthetic values throughout; no real record is reproduced. Every arithmetic identity below is
reproduced in the mockup and closes to the dirham.*

**A — cleared.** Taxi reimbursement, AED 120. Matched on maid + addition reason + text; D2.4
`= PAID`; **`LOCAL_CURRENCY_AMOUNT` = 120**. G7's arm concludes and satisfies.
→ **cleared**, `cleared_by_rule = G7.amount`. Contributes 0 to MN3.

**B — a cap breach, inside a group whose other arms are blocked.** Airfare Ticket, AED **2,500**,
nationality Filipino (D4.3), cap **2,000**. The cap arm concludes.
→ **finding**, `expected = 2,000`, **above expected 500**.
🔴 **v4's version of this example was wrong twice and taught the error.** It used AED 1,000 against
*"a price list of 2,000 and 1,500"* — but the limits are **caps of 2,000 / 1,350**, so 1,000 is
under both and is **not an exception at all**; and it computed `above = amount − 0`, when a cap rule
gives `above = amount − cap`. A builder following it would have reported this 2,500 airfare as
**2,500** over instead of 500.
🔴 **And the rest of G1 does not follow.** The entitlement and periodicity arms are blocked, so
every *other* G1 note is `pending`. **One arm concluding does not make the group evaluated** — and
a note is clean only when *every* arm applicable to it concluded.

**C — the ordering case.** Airfare Ticket, AED 0. Gate **❺b** fires before any group rule.
→ **pending**, not a finding and not clean. It moves no money so MN3 is unaffected, but it appears
in MN5 and in the case list. *(125 of these exist in twelve months.)* **Why this example exists:** if
G1 ran first it would report an AED 0 overpayment instead of an exception to investigate.

**D — cleared, and the case the duplicate key must not trip.** Six identical
deduction-cancellation additions for one maid in one month, each forgiving a separate day. They are
**identical on maid, reason, purpose and paid month** — so the key must include `NOTE_DATE::date`.
→ **six cleared cases.** **Why this example exists:** a key without the day flags all six — the 694
false alarms a year this rule was written to prevent. *(Earlier versions said the point was "not on
amount"; amount was never the problem.)*

**E — the honest gap.** Anti-attrition Incentive, AED 700. G2 has no scale anywhere.
→ **pending**, reason *no rule exists for this payment type*, into MN8. Not clean. **❾ is what stops
this reading as a pass.**

**F — the defect three versions shipped, in three different groups.** A raffle prize, AED 500, to a maid on no winners list the
warehouse holds — because the list is not in the warehouse (N11). G6's only arm is blocked.
→ **pending**, into MN5 and MN8. It was clean in v1 (G6, 24 notes), clean again in v3 (G4, 212
notes), and clean again in v4 (G3, 95 notes) — each time because a guard blocked a group *on screen*
while changing no number. **v4's T4 could not catch it either**, because both its sides read from
the verdict column. T4 now checks against the **arm registry**, which is derived from ingestion
status and cannot be moved by how a note was scored.

**Full month expectation** *(the mockup's month, assuming N1–N10 and N12 have landed and N11 has
not)*. 1,336 notes · AED 526,592 · MN4 **6** · MN5 **851** (AED 486,907) · MN6 **479**
(AED 34,005) · MN3 **AED 2,020** · MN7 **36.30%** · MN8 **AED 486,895** · month verdict **Fail**
(G1's cap arm and G7 hold findings) · **1 of 7 group rules fully evaluated, 13 arms blocked** *(G1 entitlement + periodicity, G2, G3 scheme + referral, G4 × 4, G6 — v5 said 8 and omitted G1's two, the very arms example B insists are blocked)*. T1 closes;
T2–T4 are not yet computable.

⚠️ **Coverage across the five gates: 79.06% → 66.39% → 46.56% → 36.30%.** **Nothing about the month
has changed at any point.** Each fall is a group that stopped claiming to have judged it — G6, then
G4, then G3, now G5. **A falling coverage number across spec versions is the metric working**, and
the honest reading of 36.30% is that this check currently cannot judge most of the money it audits.
That is the finding to take to P&C, not a defect in the dashboard.

---

## 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| MN-O1 | **Row-level verification of §2.1 is outstanding.** Names, columns, types and enums are verified; **row counts, freshness, population and every requestor figure are not** — the P&C role has no warehouse. **Grant it**, so specs ship with rows as evidence | Data platform (DNA-9437) | **Yes** |
| MN-O5 | Does the deduction feed still stop? If the view carries rows past 24 Dec 2025, the reason for excluding deductions has changed | P&C + Data | No |
| MN-O10 | MG2's measured floor, replacing the provisional one | P&C + Data | No |
| MN-O12 | **11 of the 20 source rules are `Pending Business` or `Pending Technical`; only 3 are `Live`.** The dashboard cannot be built past them | Police & Control | **Yes** |
| MN-O14 | Gate ❽ should read the maid type **snapshotted at payroll time**, not D4.2's current value. The payroll spec's `SALARY_TYPE` is the snapshot and is not yet in Snowflake; `HOUSEMAID_TYPE_LOGS` is the interim source | Data team | No |
| MN-O16 | **Does MaidsInsights read through the viewer's own role or a shared service account?** §7 Q1's unmasked option rests entirely on the former | Data platform | **Yes** *(if Q1 = unmasked)* |
| MN-O21 | 🔴 **G1's rule is wrong in the source material.** Caps of 2,000 / 1,350, not prices of 2,000 / 1,500; periodic at 22 months, not once-only at 24. **Every G1 count needs re-deriving** — a payment at 1,350 was counted as a failure and is correct | Police & Control | **Yes** |
| MN-O22 | An expense request that never became a note is invisible to a check that starts from notes | P&C | No |
| MN-O24 | `EXPENSES_REQUESTS` excludes `is_secure` categories entirely. If any salary-addition head is secure, those notes are permanently unmatchable and look like match failures | Data team | **Yes** |
| MN-O25 | Is `BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` populated? Every column profiles as "no non-null values" — empty, or unprofiled? If live, reuse it rather than rebuild MN1/MN2 | Data team | **Yes** |
| MN-O2 | ~~How a note points at its expense payment~~ **CLOSED.** No FK; the ERP's own heuristic, §2.2c | — | Closed |
| MN-O3 | ~~Which date windows the run~~ **CLOSED.** `PAID_ON_PAYROLL_MONTH`, §2.2b | — | Closed |
| MN-O4 | ~~`NOTE_TYPE` values~~ **CLOSED.** Seven; only `ADDITION`/`DEDUCTION` live for housemaids | — | Closed |
| MN-O7 | ~~Do the ERP's auditor flags duplicate this check~~ **CLOSED — and the answer is yes, partly.** §1. N10 becomes required and rung 0 is added | — | Closed |
| MN-O11 | ~~22 vs 24 months~~ **CLOSED.** The code says **22** (`% 24 == 22`); the 24 is the recurrence cycle. Reopens as MN-O21, because the amounts behind it are also wrong | — | Closed |
| MN-O13 | ~~The AED basis~~ **CLOSED.** `LOCAL_CURRENCY_AMOUNT` is always AED. One column, no FX table | — | Closed |
| MN-O17 | ~~Which notes should have an expense record~~ **CLOSED enough to build.** §2.2c's partition | — | Closed |
| MN-O18 | ~~G4's recalculation inputs~~ **CLOSED.** Three formulas, two divisors, §3 G4. The `mv_prorated_salary` arm remains unknown | — | Closed |
| MN-O29 | **Label mapping D1.6 → `SALARY_ADDITION_TYPE`.** `Cash advance`, `Transport fare` and possibly `Raffle Prize` have no matching row; `REASON` profiles as **free text**, so the join is a label join with no declared FK — a silent-zero-rows hazard | Data team | **Yes** |
| MN-O30 | **Extend §2.2c to all 24 payment types.** 11 are in neither list, so ❻b and MG2's denominator are undefined for them — the defect found in G5 and G7 | P&C + Data | **Yes** |
| MN-O26 | **Is gate ❼ a deterministic join?** `EXPENSES_CONFIGURATION` holds `SALARY_ADDITION_TYPE` and D3 holds `EXPENSE_TYPE` on one row. If they map, ❼ is SQL and not a question for a text classifier — which would shrink MN6b materially | Data team | No |
| MN-O27 | **Per-manager attribution was silently dropped.** A check named *Manager Notes* has no manager column, filter or metric; N8 is an ingestion ask no metric consumes. Keep it and wire it, or drop N8 and say so | Police & Control | No |
| MN-O28 | **G5's expected side is undefined for three of its five payment types.** `MOHRE requirement additions`, `Medical Assistance` and `Lost Luggage Compensation` appear in neither list in §2.2c, so ❻b and MG2's denominator have no basis for them — the G3 shape, one group over | P&C + Data | **Yes** |
| MN-O8 | **Not a data request.** `PENALTY_DEDUCTION` is API-settable only, bypasses the payroll lock, is excluded from the payroll queries that catch `DEDUCTION`, and has no refund path | Payroll integrity | No |

---

## 7. Requestor decisions still open

These are the business owner's, not the data team's.

**Q1 — masked or unmasked, and this one blocks.** The payroll-checks dashboard was ruled *no
masking: the auditor needs to see everything*, and the same argument applies here — an allegation
that a specific worker was overpaid cannot be worked against `Maid #4471`. But **the Notion page for
this check says the opposite in writing**: *"individual amounts never appear in chat, a run summary
or an email. Counts and totals only."* v4 defaults to **the written rule (masked)** rather than
assume the payroll ruling carries across, and the mockup renders the unmasked proposal so you can
see what you would be approving. If unmasked: the control becomes a named-auditor Snowflake role
plus a readable access log, and **MN-O16 must be answered first** — if MaidsInsights reads through a
shared service account, the grant sits on the tool, not the person, and the control does not hold.
**Your call — Jacky's, as business owner.**

**Q2 — what is this dashboard *for*, given the ERP already does part of it?** The ERP detects
airfare-over-limit and repetitive additions today and routes them to a `payroll_auditor` (§1). So
G1's amount arm and the duplicate rule duplicate an existing control. Three readings, and they
produce different dashboards: **independence** from the internal role (keep both, expect overlap);
**coverage** of the 22 payment types nobody checks (drop the two overlapping arms, and the flag count
falls); or **both**, stated. **Your call.**

**Q3 — which expense-payment statuses authorise a note?** D2.4 has four. A worked example using
`PAID` alone silently excludes `PAID_PENDING_INVOICE`, which is a real state, not an error. Needs
one answer before ❻a can be built.

**Q4 — G2, at AED 1.62M a year, cannot be tested at all.** 307 distinct amounts, 0–900, nothing
written down. It renders as a permanently blocked row and a quarter of the money in MN8. Is that the
answer you want the dashboard to give, or does someone need to write the scale?

**Q5 — the duplicate window.** Adopt the ERP's (*more than one addition in a configurable window,
excluding `cover_deduction_limit` and `cover_negative_salary`*), or state why P&C's differs?

**Q6 — is an expense request that never became a note in scope?** (MN-O22.) A payment authorised and
paid by a non-SALARY route never reaches a payslip and is invisible here.
