# Spec — Manager Notes

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Business owner / reviewer** | Jacky (maker–checker; money-out payroll check) |
| **Spec version** | v4 |
| **Date** | 2026-09-03 |
| **UI mockup** | https://claude.ai/code/artifact/a08a0bea-96cf-4ea3-af21-ccced5c94a5d |
| **Delivered on** | **MaidsInsights** — the dashboard the auditor opens. **Snowflake** is the warehouse underneath: tables, role, grants, SQL. Not interchangeable |
| **Status** | Draft — restructured onto the P&C template. Two audit gates passed (v1: 10 critical / 15 major; v2: 3 critical / 9 major), a third is running against v3. **11 of the 20 source rules are still `Pending Business` or `Pending Technical`**, so the build cannot start regardless of this document |

> **Numbering.** The template's `M<n>` and `O<n>` are prefixed **`MN`** here. The payroll-checks
> spec sits in the same folder with its own M1–M10 and O1–O32, and the two are cited across each
> other; unprefixed numbers would collide.

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
checks nothing about* — see **MN-O23**.

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

**MG2's denominator is the population minus the "definitely not" list.**

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
| **N11** | The G6 winners list; the G1/G3 entitlement lists | — | The **expected** side for three arms. G1's are module parameters in the `Parameter` config table, read via `Setup.getParameter()` *(code-verified)* | Those arms have nothing to compare against |
| **N12** | On **D3**, add `SALARY_ADDITION_TYPE_ID`, `REFERRED_MAID_ID`, `PURPOSE_ADDITIONAL_DESCRIPTION_ID` | — | The three columns the pivot genuinely lacks | The structured half of the match is missing |
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
| **MN5** | `COUNT` and `SUM(D1.4)` where verdict is *pending* | **Amber. Never folded into clean.** Includes every blocked arm and every ❾ note |
| **MN6** | `COUNT` of notes carrying a **non-null `cleared_by_rule`** — the id of the rule that concluded and was satisfied | 🔴 **A rule sets it; nothing else does. Never a remainder, never computed by subtraction.** As a remainder it swept blocked notes into clean twice, in two successive versions |

### MN7 — Coverage

- **Definition.** The share of the month that actually reached a verdict.
- **Formula.** `(MN4 + MN6) / MN1`.
- 🔴 **The identity `MN7 ≡ 1 − MN5/MN1` is unavoidable given T1, and always was.** The defect in
  earlier versions was **MN5's population**, not the algebra: with MN6 a remainder, blocked and
  unmatched notes never reached MN5, so the ratio could not move. MG4 and ❻b fix what lands in MN5.
  **A builder who "fixes the algebra" instead will reintroduce the defect.**
- **Division by zero.** MN1 = 0 → render `—`, never 0%. Guard MG5.

### MN8 — Unevaluable money

- **Formula.** `SUM(D1.4)` over every note whose **applicable arm** is blocked, or whose group rule
  could not conclude.
- **A subset of MN5, and the tile says so** — otherwise a reader adds the two together.

### MN — Verdict

Evaluated in order; **first match wins**.

| # | Condition | Verdict | Colour | Red flag? |
| --- | --- | --- | --- | --- |
| 0 | already signed off by the internal payroll auditor (N10) | **ADJUDICATED — ERP** | ⚪ Grey | No — shown with the sign-off, not re-raised |
| ❶ | *(binding, not a verdict)* every join is on `HOUSEMAID_ID`, never name or MOL | — | — | — |
| ❷ | `PAID_ON_PAYROLL_MONTH` ≠ audit month | **OUT OF SCOPE** | — | No |
| ❸ | housemaid profile unreachable | **PENDING** | ⚪ Grey | No — an outage, not a finding |
| ❹ | no payment type recorded | **PENDING** | ⚪ Grey | No — **and this count must be zero** |
| ❺a | `AMOUNT < 0` | **PENDING — NEGATIVE ADDITION** | ⚪ Grey | No |
| ❺b | `AMOUNT = 0` | **PENDING — ZERO PAYMENT** | ⚪ Grey | No |
| ❻a | matched to an expense record, **`LOCAL_CURRENCY_AMOUNT`** disagrees | **AMOUNT DISAGREES** | 🔴 Red | **Yes** |
| ❻b | expected to match (§2.2c), no expense record found | **PENDING — UNMATCHED** | ⚪ Grey | No — into MG2's numerator |
| ❼ | expense head (D3 `EXPENSE_TYPE`) ≠ payment type | **VERIFIER** → `justified` / `unjustified` / `cannot tell` | ⚪→ | Only if `unjustified` |
| ❽ | her contract type (D4.2) cannot receive this payment | **NOT HER ENTITLEMENT** | 🔴 Red | **Yes** |
| — | **exactly one group rule, judged by the applicable arm** — G1…G7 | per arm | | |
| ❾ | nothing settled it | **PENDING — NO RULE CONCLUDED** | ⚪ Grey | No |

**The red shapes are exactly ❻a, ❽ and an `unjustified` verifier return.** Everything else is
reported in its own section and never mixed into the headline.

🔴 **Blocking is per ARM, not per group.** A group rule has several arms (G1: amount · entitlement ·
periodicity; G4: one formula per payment type; G3: scheme price · referral). A note is judged by the
arm that applies to it. So: **a note whose arm is blocked is `pending` and into MN8, even inside an
otherwise evaluable group; a note whose arm concluded may still be a finding, even inside an
otherwise blocked group.** Earlier versions said *"a note in a blocked group is pending whatever
else is true"*, which read literally converts a concluded finding into pending — and the register
did the opposite of what the text said, twice.

🔴 **`justified` from the verifier sets `cleared_by_rule`.** Without that, MN6's definition would
leave verifier-cleared notes pending forever and MG3 would never lift.

### Groups

| Group | Payment types | AED/yr *(requestor)* | Expected comes from | Evaluable? |
| --- | --- | --- | --- | --- |
| **G1** Flight home | Airfare Ticket | 2,219,500 | 🔴 **The source material is wrong twice, and the ERP settles both** *(round 2)*. Limits are module parameters — `PARAMETER_HOUSEMAID_FILIPINO_AIRFARE_TICKET_LIMIT` = **2,000**, `PARAMETER_HOUSEMAID_OTHER_NATIONALITY_AIRFARE_TICKET_LIMIT` = **1,350** — and they are **caps, not prices**, so paying less is not an exception. **1,500 appears nowhere in housemaid airfare code.** Eligibility is `numOfMnths % 24 == 22` with `>= 6`: **22 months, periodic — not 24, not once-only** | **Amount arm only, and it must be rewritten first — MN-O21** |
| **G2** Loyalty | Anti-attrition Incentive | 1,620,868 | 🔴 **Nothing. No payment scale exists anywhere** — 307 distinct amounts, 0–900 | **No.** Declared gap → MN8 |
| **G3** Referral / signing | Bonus, VIP Bonus | 844,916 | Each scheme's price and conditions | Scheme arm yes; **referral arm blocked on N6** |
| **G4** Part-month / final salary | MV Prorated Salary, Prorated salary, Last Day CC Switch Adjustment, MV Extra Salary | 815,001 | **One formula per type** *(round 2)*: `prorated_salary` = `round(basicSalary ÷ calendar days in the **previous** payroll month × days from startDate to the 1st)`, firing only when `startDate` ≥ the **27th of the previous month**; `last_day_cc_switch_adjustment` = `round(lastCcSalary ÷ days in **this** month)`, only when `switchDate` is the month's last day; `mv_extra_salary` = a config literal (`BaseAdditionalInfo.infoValue`, `infoKey = 'mvExtraAmount'`) | **Three arms yes, one no.** 🔴 **Two divisors, in two different months** — using one for both inverts the group. `mv_prorated_salary` arm blocked. A note outside its type's trigger window is itself a finding |
| **G5** Salary corrections | Salary Dispute, Forgive Deduction, MOHRE requirement additions, Medical Assistance, Lost Luggage Compensation | 479,025 | D2.2; what it cannot settle routes to ❼ | Yes, once N12 lands |
| **G6** Raffle | Raffle Prize | 180,000 | The draw's winners list — **identity only** | **No** — N11 |
| **G7** Reimbursements | Taxi Reimbursement, Maids.at other expenses, Accommodation Relocation, Passport Assistance, Flight ticket, Sim card, Cash advance, Transport fare | 159,652 | D2.2 — amount, beneficiary and approver must agree. Receipt test reads **D2.7 as `VARCHAR '00'/'01'`** | Yes, once N12 lands |
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
| **T4** | 🔴 **`MN8` ≥ Σ AED of every note whose arm is blocked** | **The identity that matters.** T1 closes automatically whenever MN6 is a remainder, so it cannot see a blocked note swept into clean — which happened twice. **T4 cannot be satisfied by subtraction** |

| Guard | Condition | Behaviour |
| --- | --- | --- |
| **MG1** | N1 not ingested | **Whole dashboard `BLOCKED`.** No correct month filter exists; do not render a partial month as a result |
| **MG2** | Expense-match rate below floor | Denominator per §2.2c. Below the floor MN3 and MN7 render `BLOCKED`, not low. **Provisional floor: 10 points below the first month's observed rate**, so the guard works from day one — replaced by a measured floor at MN-O10 |
| **MG3** | Verifier unavailable | ❼-routed notes stay `pending`; MN7 falls and says why |
| **MG4** | An arm's expected source missing | That arm renders `BLOCKED`; **every note it would have judged goes to MN5 and MN8, never MN6**. Each carries an expected-by date, **watched by the auditor at the monthly run — not by a scheduled process** |
| **MG5** | MN1 = 0 | **`SKIPPED`, and that is a finding about the run.** ~1,347/month is the norm; zero means the feed broke |
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

**B — finding on the amount arm, inside a blocked group.** Airfare Ticket, AED 1,000, nationality
from D4.3. The cap arm concludes: 1,000 matches no entitlement, so `expected = 0`.
→ **finding**, above expected 1,000. 🔴 **And the rest of G1 does not follow.** The entitlement and
periodicity arms are blocked, so every *other* G1 note is `pending`. **One arm firing does not make
the group evaluated** — that conflation put 212 notes in the wrong bucket in a previous version.

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

**F — the defect two versions shipped.** A raffle prize, AED 500, to a maid on no winners list the
warehouse holds — because the list is not in the warehouse (N11). G6's only arm is blocked.
→ **pending**, into MN5 and MN8. **Under the earlier rule it was clean**: MG4 blocked the group on
screen but changed no number, and MN6-as-remainder swept it into clean *and* into coverage's
numerator. **T4 is the identity that catches this.**

**Full month expectation** *(the mockup's month)*. 1,336 notes · AED 526,592 · MN4 **9** ·
MN5 **449** (AED 348,142) · MN6 **878** (AED 159,170) · MN3 **AED 14,280** · MN7 **66.39%** ·
MN8 **AED 348,130** · month verdict **Fail** (G3, G4 and G7 hold findings) · 4 of 7 group rules
evaluated, 3 arms blocked. T1 closes; T2–T4 are not yet computable.

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
