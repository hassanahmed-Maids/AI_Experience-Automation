# Ticket 2 of 2 — BI / Visualization

**Issue type:** `BI Visualization Task` *(file it as this, not "New Request")*
**Project:** DNA · **Routing:** BI / Visualization — Eddy Elrahi
**Summary:** `Manager Notes Audit dashboard on MaidsInsights`
**Blocked by:** the Analytic Engineering ticket above — the model must merge first.

---

### What we need

The dashboard Police & Control works the monthly manager-notes audit in. **All of the logic lives
in the AE model**; this ticket is the surface. One row per manager note, worked one case at a time,
with a second reviewer before anything is acted on.

> **Build one page on MaidsInsights that renders the ten metrics from the AE model, at note grain,
> with every element carrying its metric id.** No metric is computed here — every tile, chart,
> filter, colour and export column aggregates the single `AUDIT_VERDICT` column the model produces.

A mockup exists and is linked at the bottom, but ⚠️ **it is a Claude artifact URL and the intake bot
cannot read it** — so the layout is restated in full below and **this description is the working
spec**.

### Where it goes

A new page. **Not** a section on the existing Payroll Dashboard (`housemaid-payroll`), which already
has *"Additions to the maid's salaries"* — that reports what was added, by category; this audits
whether each addition was justified. Placement under a Police & Control parent, or as its own route,
is yours to choose — say which and we will use that name in handovers.

### Layout — one screen, top to bottom

**1. Filter bar.** Audit month *(default: last completed paid month)* · verdict · failure type ·
payment type · contract type · blocking reason · reviewed/unreviewed. Defaults visible on screen.

**2. KPI strip, in this order.** The order is deliberate — coverage leads so no reader mistakes
"few findings" for "few problems".

| Position | Tile | Metric |
| --- | --- | --- |
| 1–2 | Coverage — cases · Coverage — money | `M10` |
| 3–4 | Cases in scope · Money in scope *(positive and negative subtotals shown separately, never netted)* | `M1`, `M2` |
| 5–6 | Findings · Amount at risk *(with the unquantifiable count beside it — 0 by construction)* | `M7`, `M11` |
| 7 | Unverifiable, with its top blocking reason inline | `M8` |
| 8 | Cleared | `M9` |
| 9 | Completeness exceptions | `M14` |
| 10 | Expense match rate — **the aggregate plus "n payment types below floor"** | `M13` |

**3. Guard strip.** Six pass/fail chips with their numbers: grain, verdict completeness, amber
integrity, no-green-skipped-a-test, auditor-flags-unused, and the payslip residual. **A failed
grain, verdict-completeness, no-green or auditor-flags guard renders in place of the KPI strip, not
beside it.**

**4. Case table.** Default sort: **amount at risk descending, then paid month descending.**

| Column | Notes |
| --- | --- |
| Verdict | pill carrying **colour and the word** — never colour alone |
| Label | e.g. `OVER LIMIT`, `NO RULE EXISTS`, `DUPLICATE` |
| Failure type | `F1`–`F4` with its plain-English label, or `—` |
| Rule breached / blocked because | the rule **in its own words**, or the blocking reason |
| Note id · Maid id · Contract | ids only |
| Payment type | code, with the display name on hover |
| Paid month | `YYYY-MM`, tagged `recorded` or `derived` |
| Amount · Authorised · At risk | `AED #,##0.00`, right-aligned, tabular figures |
| Approver | **user id or role reference, not a name** |
| Internal sign-off | context only — never clears a case |
| Status | New / Under review / Cleared / Escalated |

**5. One chart.** Amber cases by blocking reason, horizontal bars, values direct-labelled. Buckets
are mutually exclusive and sum to `M8` in both count and money.

**6. Drill-down.** Clicking a case opens its full `TEST_TRACE` — every applicable test, whether it
ran, and what it returned — plus the candidate expense records with their statuses, the airfare
parameter values used, the maid's other notes inside the entitlement window, and the ERP auditor
state labelled *context — does not clear this case*.

**7. Provenance line.** Sources, audit month and how it was derived, the airfare parameter values
read this run, the match-rate floor, run id and as-of timestamp.

**8. Export.** Row-level CSV of the case table, under the same rules as the screen — approver ids
not names, salary-bearing rows banded.

### Two behaviours that are not cosmetic

**Colour is never the only carrier.** Every verdict pill states its word, and the failure type is
its own column. The report is printed and screenshotted into audit notes.

**Nothing on this page recomputes eligibility.** If a number and a pill can disagree, the build is
wrong. This is the defect the whole design exists to prevent: something marked blocked on screen
while the underlying numbers still count it clean.

### One thing that needs a decision, not engineering

**The status column is a write-back**, which makes this a small application rather than a dashboard.
In or out for the first release? If out, the column is read-only and P&C tracks review outside the
tool. The build shape depends on the answer.

### A known frontend constraint

DNA-9464 flagged that the payroll service *"queries additions without the payment-method column and
without aggregating, so each category already renders once per payment method"* — a third value
renders three times. If this page reuses any of that service, the same trap applies to the
blocking-reason chart.

### Attached

| File | What it is |
| --- | --- |
| **`SPEC_manager_notes_audit_DEV.md`** | §11 is this layout in full, with the metric definitions behind every tile |
| **Mockup** | https://claude.ai/code/artifact/75d6c4b8-ee4e-431a-aa8a-b19daa19e051 — ⚠️ not bot-readable; the layout above is the spec |

### Not a duplicate

`housemaid-payroll` → *"Additions to the maid's salaries"* reports additions by category
(DNA-9464, DNA-9465, DNA-9133). This page audits them against their rules. Different question,
different grain, both should exist.

### Done when

1. **Every tile, column and chart carries its metric id**, and each reads the AE model's verdict
   column — no metric is recomputed in the UI.
2. **The three verdict counts on screen equal the model's**: `M7 + M8 + M9 = M1`, money to the cent.
3. **The blocking-reason chart sums to `M8`** in both count and money, and the reason buckets are
   mutually exclusive.
4. **A failed blocking guard replaces the KPI strip**, and the page says which guard failed and with
   what number.
5. **No verdict word appears on screen that is not `RED`, `AMBER` or `GREEN`.**
6. **Coverage tiles sit first**, before the finding count.
7. **`M13` renders the aggregate and the count of payment types below the floor**; a case row's
   message uses that row's own payment-type rate, never the aggregate.
8. **No name, phone, EID, passport or address renders anywhere** — screen, drill-down or CSV — and
   approvers render as ids.
9. **Default sort is amount at risk descending**, and the export matches the on-screen column set.
