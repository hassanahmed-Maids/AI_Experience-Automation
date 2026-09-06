# Example — a finished spec

Illustrative reference showing the expected depth and the labelling discipline. The ERP
table names below came from a real Ask the Code query against
`erp/magnamedia-payroll-management`; the Snowflake locations are shown as `UNVERIFIED`
because no Snowflake session confirmed them. Amounts are synthetic.

Note how every unconfirmed name is marked, every metric states its null and
divide-by-zero behaviour, and the tie-out rule is explicit. Reproduce that discipline, not
this report.

---

# Spec — Post-Lock Payroll Payment Audit

| | |
| --- | --- |
| **Requested by** | Police & Control |
| **Spec version** | v1 (example) |
| **Date** | 2026-09-02 |
| **UI mockup** | `<artifact URL>` |
| **Status** | Example — not approved |

---

## 1. Business Logic

**The control.** Once a payroll month is locked, the amounts payable for that month are
fixed. Any payment recorded against a locked payroll month, or any change to a payroll
amount after its lock date, must have been authorised through an exception process.

**The failure it catches.** Salary payments issued or altered after the payroll month was
locked — the mechanism by which an unauthorised or duplicated payment reaches a maid without
appearing in the approved payroll run.

**Reader and action.** P&C auditor, monthly after payroll close. A red row is taken to the
payroll accountant for a documented explanation; unexplained rows escalate to Finance.

**Population in scope.** All payroll months with a `LOCK_DATE` in the audited period, all
payroll types, all branches.

**Explicitly out of scope.** Payroll months never locked (still open — not yet auditable),
and final-settlement payments, which follow a separate approval path and get their own
report.

**Grain.** One row per payment recorded against a locked payroll month.

**Refresh expectation.** Monthly, after the payroll lock date for the month has passed.

**Archetype.** Exception / rule-breach list (see `audit-report-ui/references/ui-patterns.md`).

---

## 2. Data Points Needed

### 2.1 Verified — already in Snowflake

| # | Data point | Location | Column | Grain | Verification |
| --- | --- | --- | --- | --- | --- |
| — | none confirmed yet | — | — | — | Snowflake session was not connected when this example was written |

### 2.2 Approved KPI definitions reused

No approved definition exists for a post-lock payment rate in
`BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER`. This is a new Police & Control
definition and should be added to the Data Catalog.

### 2.3 New data ingestion request

#### N1 — Payroll month lock date

- **Definition.** The date on which a payroll month was closed and became unchangeable.
- **Source.** ERP — Payroll Management
- **Native location.** `MONTHLYPAYMENTRULES.LOCK_DATE` — confirmed via Ask the Code,
  module `erp/magnamedia-payroll-management`
- **Related columns.** `ID`, `PAYROLL_MONTH`, `PAYMENT_DATE`, `PAYROLL_TYPE`,
  `PAYMENT_METHOD`, `FINISHED`, `AUDITING_FINISHED`
- **Grain in source.** One row per payroll month × payroll type
- **History needed.** From 2025-01-01, backfill required
- **Join key.** `MONTHLYPAYMENTRULES.ID` → `PAYROLLACCOUNTANTTODOS.MONTHLY_PAYMENT_RULE_ID`
  (**type of both columns UNVERIFIED — confirm before build; a TEXT/NUMBER mismatch here
  returns zero rows silently and would read as "no findings"**)
- **Hygiene.** `FINISHED` and `AUDITING_FINISHED` distinguish a closed month from an audited
  one — confirm which one governs the lock for audit purposes. Timezone of `LOCK_DATE`
  UNVERIFIED; a payment near midnight could fall on either side of the boundary.

#### N2 — Per-maid payroll amounts

- **Definition.** The salary amount recorded for one maid in one payroll month.
- **Source.** ERP — Payroll Management
- **Native location.** `MONTHLYPAYROLLS` — `ID`, `HOUSEMAID_ID`, `PAYROLL_DATE`,
  `PRIMARY_SALARY`, `TOTAL_SALARY`, `STATUS` (via Ask the Code)
- **Grain in source.** One row per maid × payroll date
- **History needed.** From 2025-01-01
- **Hygiene.** `STATUS` enum values and meanings UNVERIFIED — required, since the audit must
  exclude cancelled or superseded payroll rows. Ask the Code follow-up needed. Also probe
  for an adjustments/corrections table: a second table holding post-hoc amendments would
  change this metric materially and is the most likely omission in this list.
- **Sensitivity.** Individual salary amounts must not be displayed. The report shows
  variances and totals; the mockup uses masked identifiers and synthetic amounts.

#### N3 — Payment records against a payroll month

- **Definition.** An accountant-executed payment tied to a payroll run.
- **Source.** ERP — Payroll Management
- **Native location.** `PAYROLLACCOUNTANTTODOS` — `ID`, `MONTHLY_PAYMENT_RULE_ID`, `AMOUNT`,
  `TOTAL`, `TASK_NAME`, `PAID_BY_MANAGER`, `DUE_ON` (via Ask the Code)
- **Gap.** No payment **execution timestamp** appears in the columns returned. The control
  cannot be built without one. Ask the Code follow-up required: *"Which column records when
  a payroll payment was actually executed, as opposed to when it was due?"* **This is the
  blocking open item.**
- **Grain in source.** One row per accountant payment task

**Approval authority.** `PAYROLLACCOUNTANTTODOS.PAID_BY_MANAGER` may identify who authorised
a payment. Confirm semantics via `erp/magnamedia-admin` — an exception row is only actionable
if it names who approved it.

---

## 3. Metric Calculations

### M1 — Post-lock payment amount

- **Business definition.** The value of a payment executed against a payroll month after
  that month's lock date.
- **Formula.** `N3.AMOUNT` where `payment_executed_at > N1.LOCK_DATE`
- **Inputs.** N1, N3
- **Filters.** `LOCK_DATE IS NOT NULL` (month was locked); exclude payroll rows whose
  `STATUS` is cancelled or superseded (values pending N2 confirmation).
- **Currency & FX.** AED throughout; no conversion expected. Confirm before build.
- **Rounding.** 2 dp, round half up, at row level. Totals sum rounded row values.
- **Nulls.** A null `payment_executed_at` **cannot** be treated as compliant. Such rows
  appear as a distinct grey "Undetermined" flag and are counted as findings requiring
  investigation. Silently excluding them would let the exact failure mode this report
  targets disappear from the report.
- **Division by zero.** Not applicable.

### M2 — Days after lock

- **Formula.** `DATEDIFF('day', N1.LOCK_DATE, payment_executed_at)`
- **Flags.** Green: ≤ 0 (compliant). Amber: 1–3 days (plausible operational lag). Red:
  > 3 days or any amount ≥ AED 5,000 regardless of lag. Grey: timestamp null.
- **Justification.** The 3-day band reflects the documented payment-processing window; the
  amount override exists because a large post-lock payment is material irrespective of lag.
  **Both thresholds require requestor confirmation.**

### M3 — Post-lock exposure

- **Formula.** `SUM(M1)` over all rows flagged Amber or Red in the period
- **Nulls.** Grey rows are excluded from the exposure total but their count and estimated
  amount are displayed beside it, so the headline figure is never read as complete.

### M4 — Post-lock rate

- **Formula.** `COUNT(flagged rows) / COUNT(all payments against locked months)`
- **Division by zero.** If no payments exist against locked months in the period, display
  "—", never 0%.
- **Denominator displayed.** Required. A rate whose denominator is hidden cannot be
  distinguished from a coverage change.

**Tie-out rule.** For each locked payroll month: total paid per `PAYROLLACCOUNTANTTODOS`
must equal the approved payroll total per `MONTHLYPAYROLLS` plus M3 for that month. Any
residual is displayed as its own exception row labelled "Unreconciled — investigate". The
report is not trustworthy without this line and the UI must show it.

---

## 4. Finalised UI Report

**Layout.** KPI strip (M3 exposure · flagged count · M4 rate with denominator) → tie-out
line → exception table → one chart of flagged amount by payroll month.

**Columns.**

| Column | Source | Format | Default |
| --- | --- | --- | --- |
| Payroll month | N1.PAYROLL_MONTH | `YYYY-MM` | group |
| Lock date | N1.LOCK_DATE | `YYYY-MM-DD` | — |
| Maid ref (masked) | N2.HOUSEMAID_ID | `Maid #NNNN` | — |
| Amount (AED) | M1 | `#,##0.00` right | sort desc |
| Days after lock | M2 | integer | — |
| Approved by | N3.PAID_BY_MANAGER | text | — |
| Rule breached | static | text | — |
| Flag | M2 | label + colour | — |
| Status | auditor workflow | `New`/`Under review`/`Cleared`/`Escalated` | `New` |

**Filters.** Payroll month (default: last closed month), payroll type, flag, status.
**Drill-down.** Row opens the payment detail and the payroll row it belongs to.
**Provenance line.** Sources and as-of timestamp, displayed.
**Export.** Row-level CSV.

---

## 5. Worked Examples

### Example A — clean case

Payroll month 2026-07, `LOCK_DATE` 2026-07-25, payment executed 2026-07-24, AED 1,800.
M2 = −1 → **Green**. Excluded from M3.

### Example B — the exception this report exists to catch

Payroll month 2026-07, `LOCK_DATE` 2026-07-25, payment executed 2026-08-04, AED 6,400.
M2 = 10 days → **Red** (over 3 days *and* ≥ AED 5,000). Contributes AED 6,400 to M3.
`PAID_BY_MANAGER` empty → no authorisation on record: the actionable finding.

### Example C — edge case, null timestamp

Payroll month 2026-07 locked; payment row exists, AED 2,100, execution timestamp null.
M2 undetermined → **Grey**. Not in M3, but shown beside it as "1 undetermined, AED 2,100".
This row is a finding, not a gap in the report.

### Example D — tie-out failure

Month 2026-06: paid AED 412,300 vs approved AED 408,000, M3 = AED 1,900. Residual
AED 2,400 → exception row "Unreconciled — investigate". Without the tie-out line this
AED 2,400 would be invisible in a report that otherwise looks complete.

---

## 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| O1 | Payment execution timestamp column — no column found in `PAYROLLACCOUNTANTTODOS`; Ask the Code follow-up required | P&C | **Yes** — control cannot be built |
| O2 | `MONTHLYPAYROLLS.STATUS` enum values and meanings | P&C via Ask the Code | Yes |
| O3 | Existence of a payroll adjustments/corrections table | P&C via Ask the Code | Yes |
| O4 | Join key types on `MONTHLYPAYMENTRULES.ID` ↔ `MONTHLY_PAYMENT_RULE_ID` | Snowflake team | Yes |
| O5 | Whether `FINISHED` or `AUDITING_FINISHED` governs the audit lock | Payroll | Yes |
| O6 | Confirm M2 thresholds (3 days, AED 5,000) | Requestor | No |
| O7 | Timezone of `LOCK_DATE` and the execution timestamp | Snowflake team | No |

All Snowflake locations in this example are `UNVERIFIED` — no Snowflake session confirmed
them. A real spec resolves these before delivery.
