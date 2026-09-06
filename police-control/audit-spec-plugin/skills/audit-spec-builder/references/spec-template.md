# Finalised Spec Template

Copy this structure verbatim into the deliverable markdown file. Keep the section order —
the Snowflake team reads these top to bottom. Delete no section; write "None" where a
section genuinely does not apply.

Filename convention: `SPEC_<short-report-name>_v<n>.md` (e.g. `SPEC_maid_salary_tie_out_v1.md`).

---

```markdown
# Spec — <Report Name>

| | |
| --- | --- |
| **Requested by** | <name>, Police & Control |
| **Spec version** | v1 |
| **Date** | <YYYY-MM-DD> |
| **UI mockup** | <artifact URL> |
| **Status** | Approved by requestor / Draft |

---

## 1. Business Logic

**The control.** <One paragraph: what must always be true about the money, and what this
report proves or disproves.>

**The failure it catches.** <The specific discrepancy, leakage, unauthorised amount, missing
charge, or bypassed approval that this report surfaces.>

**Reader and action.** <Who opens this, how often, and what they do when a row flags red.>

**Population in scope.** <Which entities, contracts, periods, branches, currencies.>

**Explicitly out of scope.** <What must NOT appear, and why — this prevents the Snowflake
team from over-including.>

**Grain.** One row per <transaction | contract | maid | invoice | month × branch>.

**Refresh expectation.** <Daily / on demand / monthly after close. Note the business cut-off,
e.g. "after payroll lock on the 25th".>

---

## 2. Data Points Needed

### 2.1 Verified — already in Snowflake

| # | Data point | Database.Schema.Table | Column | Grain | Notes / verification |
| --- | --- | --- | --- | --- | --- |
| D1 | <business name> | `DB.SCHEMA.TABLE` | `COLUMN` | <one row per…> | Confirmed populated, latest row <date> |

### 2.2 Approved KPI definitions reused

| Metric | Source of definition | Reused verbatim? |
| --- | --- | --- |
| <KPI> | `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` → <entry> | Yes — all filters retained, incl. `FAKE = false` |

State "No approved definition exists for <metric>; this is a new Police & Control definition
and should be added to the Data Catalog" where that is the case.

### 2.3 New data ingestion request — NOT yet in Snowflake

For each item give the Snowflake team enough to ingest without coming back with questions.

| # | Data point | Source system | Native ERP table / column | How to reach it | Owner | History needed |
| --- | --- | --- | --- | --- | --- | --- |
| N1 | <business name> | ERP — <module> | `<table>.<column>` (via Ask the Code) | <screen or module> | <team> | <e.g. from 2024-01-01> |
| N2 | <business name> | Google Sheet | n/a | <sheet name + tab, owner to share> | <person's team> | <full> |

**Join keys.** <How the new data ties to existing Snowflake tables — the exact key columns
and their types. Flag any type mismatch, e.g. TEXT vs NUMBER, that will need casting.>

**Known data hygiene issues.** <Duplicates, soft-delete flags, test/fake rows to exclude,
multi-currency, timezone of timestamps, status enums and their meanings.>

---

## 3. Metric Calculations

One block per metric. Every metric gets an ID that the UI section references.

### M1 — <Metric name>

- **Business definition.** <Sentence a finance person would sign off on.>
- **Formula.** `<explicit arithmetic using D/N data point IDs>`
- **Inputs.** D1, D3, N2
- **Filters.** <Every filter, including exclusions of test/fake rows.>
- **Currency & FX.** <Reporting currency; which rate and as-of date if conversion applies.>
- **Rounding.** <e.g. 2 dp, round half up, applied at row level not on the total.>
- **Nulls.** <Treat as zero / exclude row / flag as exception — state which.>
- **Division by zero.** <Show as "—" / 0 / exclude.>
- **Variance flag thresholds.** <Green ≤ X, Amber X–Y, Red > Y — with the business
  justification for the cut-offs.>

Repeat for M2, M3, …

**Tie-out rule.** <The arithmetic identity that must hold for the report to be trustworthy,
e.g. "sum of M1 across all rows must equal the ledger total in D5 for the same period;
any gap is itself an exception row." Every P&C report needs one.>

---

## 4. Finalised UI Report

**Layout.** <Header KPI strip → exception table → supporting breakdown. One screen.>

**Columns.**

| Column | Source | Format | Sort/default |
| --- | --- | --- | --- |
| <col> | M1 / D2 | <AED #,##0.00> | desc |

**Filters.** <Period, branch, entity, auditor, status. State defaults.>

**Drill-down.** <What clicking a row opens, and which columns the detail view shows.>

**Conditional formatting.** <Which column drives the row colour, using the M-level
thresholds above.>

**Provenance line.** The report must display one line stating its data sources and the
as-of timestamp, so an auditor can cite it.

**Export.** <CSV of the row-level detail — P&C works cases one by one.>

---

## 5. Worked Examples

At least three: one clean pass, one exception, one edge case. Show the arithmetic.

### Example A — clean case

| Input | Value |
| --- | --- |
| <ID field> | <value> |
| <input amounts> | <values> |

**Expected output row:** <exact values per column, with the arithmetic spelled out.>
**Expected flag:** Green — <why>.

### Example B — exception the report must catch

<Same structure. This example is the reason the report exists; make it unambiguous.>

### Example C — edge case

<Refund / reversal / partial month / cancelled mid-cycle / multi-currency / duplicate —
whichever edge cases the feedback loop surfaced.>

---

## 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| O1 | <anything still unverified> | <who> | Yes/No |

Mark every unverified name here as `UNVERIFIED — Snowflake team to confirm`. An empty
Open Items table is a valid and good outcome; a hidden assumption is not.
```
