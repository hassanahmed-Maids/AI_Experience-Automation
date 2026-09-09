---
name: audit-report-ui
description: >
  This skill should be used to build the UI mockup artifact for a Police & Control auditing
  dashboard, showing the finalised report layout with realistic worked data so the requestor
  can approve the look before the Snowflake team builds it. Triggers on "build the UI
  example", "show me what the report will look like", "mock up the dashboard", "build the UI
  mockup", "rebuild the UI", "show the report layout", or the UI step of the P&C spec
  pipeline. Also use when a requestor wants to change the layout, columns, or flag colours
  of a report already specced. Produces a published artifact and the UI section of the spec.
metadata:
  version: "0.1.0"
  owner: "Police & Control"
---

# Audit Report UI

> **Part of the P&C audit pipeline.** `audit-pipeline` carries the whole arc — discover → specify → execute → hand over — and the five rules that hold at every stage. Read it if you are not certain which stage this request belongs to; starting in the wrong one wastes the session.


Build the visual half of the deliverable: a published artifact showing the finished report
with the requestor's own worked examples as visible rows. This is what gets approved, so it
must be honest about what the data will actually look like.

## Before writing anything

Load these skills first — they are not optional:

- **`artifact-design`** — calibrates how much design investment the page warrants.
- **`dataviz`** — required before writing any chart, KPI tile, or colour choice.

Then build the page as an HTML file and publish it with the Artifact tool.

## What an audit report UI must contain

P&C reports are worked case by case, not admired. Design for someone who opens this, finds
the bad rows, and acts on them.

1. **KPI strip** — 3 to 5 tiles at the top. Always include: total exposure (the money at
   risk), the exception count, and the exception rate. Each tile shows the metric ID from
   the spec so a reader can trace it.
2. **The exception table** — the core of the report. Default sort: worst first, by amount at
   risk, not by date. This is the part people use.
3. **Tie-out line** — the arithmetic identity that proves the report is complete (e.g.
   "sum of audited amounts = ledger total for period; variance AED 0.00"). If it does not
   tie, that gap is displayed as its own exception row. Every P&C report needs this and most
   draft mockups forget it.
4. **Supporting breakdown** — one chart at most, by branch, category, or month. One chart.
   A wall of charts hides the exceptions.
5. **Filters** — period, entity/branch, status, and reviewed/unreviewed. Show the defaults.
6. **Provenance line** — one line naming the data sources and the as-of timestamp, so a
   finding can be cited in an audit note.
7. **Export affordance** — a visible CSV export control for the row-level detail. Note in
   the spec that the real build needs it; in a mockup the button need not function.

## Data in the mockup

- Use the requestor's **actual worked examples** as real rows. Seeing their own case
  rendered is what makes them spot a wrong column.
- Include at least one **clean row**, one **exception row**, and one **edge case** row
  (refund, pro-rated part-month, multi-currency, orphaned record) so the flag logic is
  visible.
- **Never display real personal or financial detail.** No phone numbers, no contact details,
  no individual salaries. Mask names (`Maid #4471`, `Client A. R.`) and use synthetic
  amounts that still demonstrate the arithmetic. State on the page that values are
  illustrative.
- Make the numbers **arithmetically consistent** — a mockup whose total does not equal its
  rows teaches the requestor to distrust the report.

## Flag conventions

Use the thresholds defined in the spec's metric section, and follow `dataviz` for the actual
colour values rather than inventing them:

| Flag | Meaning |
| --- | --- |
| Green | Within tolerance — no action |
| Amber | Outside tolerance but below the escalation threshold — review |
| Red | Requires action or escalation |
| Grey | Insufficient data to judge — itself a finding, never hide it |

Never encode a flag by colour alone. Pair it with a label or icon so the row is readable
when printed, screenshotted into a report, or viewed by someone with colour vision
deficiency.

## Layout rules

- **One screen.** The KPI strip and the top of the exception table visible without scrolling.
- Right-align all amounts, fixed decimals, thousands separators, currency stated once in the
  column header rather than repeated per cell.
- Wide tables scroll inside their own container; the page body never scrolls sideways.
- Theme-aware light and dark, per the Artifact tool's requirements.
- Every displayed metric carries its spec metric ID (`M1`, `M2` …) in a tooltip or the column
  header, so the artifact and the spec cannot drift apart.

## After publishing

- Put the artifact URL in the spec header and in spec section 4.
- Walk the requestor through it **column by column** and ask what is missing, what is
  unnecessary, and whether the default sort matches how they actually work a case.
- Feed any layout change back into the spec's UI section — the spec and the artifact must
  agree. If the requestor changes the flag thresholds while looking at the mockup, that
  changes the metric section too.

Read `references/ui-patterns.md` for the report archetypes and which one fits the request.
