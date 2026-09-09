# Data Ingestion Request Format

Goes into spec section 2.3. The test of a good ingestion request: **the Snowflake team can
start work without asking a single follow-up question.**

## Required fields per item

| Field | Why it matters |
| --- | --- |
| **ID** | `N1`, `N2` … so metric formulas can reference it |
| **Business name** | What P&C calls it |
| **Definition** | One sentence — what the field means in business terms |
| **Source system** | ERP module / Google Sheet / bank portal / third party |
| **Native table + column** | From Ask the Code where the source is the ERP. Exact case |
| **How to reach it** | The ERP screen, sheet name + tab, or export path |
| **Owner** | The team or role who controls the source and can grant access |
| **History needed** | From which date, and whether backfill is required |
| **Join key** | The exact column that ties it to existing Snowflake data, plus its type |
| **Grain** | One row per what, in the source |
| **Hygiene notes** | Test/fake flags, soft deletes, enums, currency, timezone |
| **Refresh expectation** | How current the audit needs it (state the business cut-off) |

## Template

```markdown
### N1 — <Business name>

- **Definition.** <One sentence in business language.>
- **Source.** ERP — <module name>
- **Native location.** `<TABLE>.<COLUMN>` — confirmed via Ask the Code on <date>,
  module `<project_alias>`
- **Reachable via.** <ERP screen name / navigation path>
- **Owner.** <team>
- **Grain in source.** One row per <thing>
- **History needed.** From <YYYY-MM-DD>; backfill required
- **Join key to existing Snowflake data.** `<TABLE>.<KEY>` → `<DB.SCHEMA.TABLE>.<KEY>`
  (both <type>; **cast needed** if types differ — flag it)
- **Hygiene.** <Test-row flag, soft-delete column, status enum and meanings, currency,
  timestamp timezone.>
- **Refresh needed.** <Daily / after monthly payroll lock / on demand>
- **Notes.** <Anything the team would otherwise discover the hard way — a second table
  holding adjustments, an override field, a known duplicate pattern.>
```

## Non-ERP sources

For a Google Sheet, a bank portal export, or a manual tracker, the request must additionally
name:

- The **exact file/sheet and tab**, and who owns it.
- Whether the sheet is the **system of record** or a copy of something else. If a copy, name
  the origin — ingesting a copy bakes in someone's manual editing.
- The **header row and column layout**, and whether it changes month to month. Sheets whose
  columns shift need an explicit contract with the owner before ingestion is stable.
- Whether historical tabs exist, and whether they share the same layout.
- Any **manual judgement** already embedded in the sheet (a column someone fills in by
  hand). Flag this loudly — an audit built on a hand-filled column is auditing the person
  who fills it, and that must be a deliberate choice.

## Where a requirement needs capability, not just data

Snowflake can implement whatever the audit needs. When a data point requires more than a
plain column, specify the requirement precisely and leave the method to them:

- **Fuzzy / approximate matching** — state the two fields to match, what counts as a match
  ("same person despite spelling variation, transliteration, or reversed name order"), the
  tolerance, and what happens to an ambiguous match (become an exception row, never a silent
  drop).
- **AI-generated fields** — state the judgement to be made, the exact question to put to the
  model, the allowed output values, and whether a low-confidence result should flag for human
  review. Treat the output as a normal column in the metric formulas.
- **Derived flags** — give the rule in full, including precedence when several conditions
  apply at once.
- **Cross-source reconciliation** — name both sides, the key, the tolerance, and the
  treatment of records present on only one side.

Never soften a requirement for feasibility. State it and let the Snowflake team build it.

## What makes a request get bounced back

- "Get the maid salary data from the ERP" — no table, no column, no owner.
- A join key with no type stated, where the two sides differ.
- No history window, so nobody knows whether to backfill three years or three weeks.
- No hygiene notes, so test rows land in a financial audit.
- A metric that silently depends on a field not listed in any ingestion item.
- A requirement quietly narrowed because it looked hard to compute.
