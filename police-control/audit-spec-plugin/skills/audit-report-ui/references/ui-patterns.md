# Audit Report Archetypes

Pick the archetype that matches the control before designing the layout. Most P&C requests
are one of these five. Naming the archetype early settles the grain, the columns, and the
tie-out rule in one move.

## 1. Two-sided reconciliation

**Control:** two systems that must agree, disagree.
**Examples:** ERP invoiced vs bank received; payroll computed vs payroll paid; contract
price vs amount actually charged.

- **Grain:** one row per matched pair, plus a row for every unmatched record on either side.
- **Columns:** key · side-A amount · side-B amount · variance · variance % · flag · status.
- **Non-negotiable:** unmatched records from **both** sides appear as rows. A reconciliation
  that shows only matched pairs hides the worst findings — the missing charge and the
  unexplained receipt.
- **Tie-out:** side-A total − side-B total = sum of variances + sum of unmatched. Display it.
- **Default sort:** absolute variance, descending.

## 2. Authorised-vs-actual (leakage)

**Control:** an amount was charged, paid, or discounted beyond what was authorised.
**Examples:** discount exceeding the approved band; salary paid above contract; a fee waived
without approval; expense above policy.

- **Grain:** one row per transaction or per entity-period.
- **Columns:** entity · authorised value · actual value · gap · gap % · who approved ·
  approval reference · flag.
- **Non-negotiable:** show the **source of authority** (contract, price list, approval
  record) and, where the approval is missing entirely, mark it distinctly from a
  present-but-exceeded approval. Those are different findings with different owners.
- **Tie-out:** total leakage = sum of positive gaps; state it as money.
- **Default sort:** gap amount, descending.

## 3. Completeness / missing-record audit

**Control:** something that should exist does not.
**Examples:** an active contract with no invoice this month; a maid on payroll with no
contract; a visa charge never billed to the client.

- **Grain:** one row per expected-but-absent item.
- **Columns:** entity · why it was expected · expected amount · period · days outstanding ·
  flag.
- **Non-negotiable:** this archetype needs an **expected-population source** separate from
  the transaction table. A report built only on rows that exist can never see a missing row.
  Name that source explicitly in the spec — this is the single most common reason a
  completeness spec fails at build time.
- **Tie-out:** expected count − present count = exception count.
- **Default sort:** expected amount or days outstanding, descending.

## 4. Exception / rule-breach list

**Control:** a policy rule was broken.
**Examples:** payments made after the payroll lock date; a refund issued without a
complaint record; two active contracts for one maid; a transaction posted to a closed period.

- **Grain:** one row per breach.
- **Columns:** entity · rule breached · detail · amount involved · detected on · owner ·
  status.
- **Non-negotiable:** each row states **which rule** it breached, in the rule's own words.
  A list of suspicious rows without the rule named cannot be actioned or disputed.
- **Tie-out:** breach count by rule must sum to the total; show the by-rule breakdown as the
  one chart.
- **Default sort:** amount involved, descending; secondary by detected date.

## 5. Trend / drift monitor

**Control:** a ratio that should be stable is moving.
**Examples:** discount rate by month; write-off ratio by branch; average deduction per maid.

- **Grain:** one row per period × dimension.
- **Columns:** period · dimension · numerator · **denominator** · ratio · prior ratio ·
  change · flag.
- **Non-negotiable:** display the **denominator** as its own column. A ratio trend without a
  visible denominator cannot be distinguished from a coverage change, and that mistake has
  produced false findings before.
- **Tie-out:** numerator total across dimensions = the period total.
- **Default sort:** chronological, with the largest movers highlighted.

## Choosing between them

| The requestor says | Archetype |
| --- | --- |
| "These two numbers should match" | 1 — Reconciliation |
| "Someone charged/paid more than they should have" | 2 — Authorised vs actual |
| "We think we're not billing for everything" | 3 — Completeness |
| "This shouldn't be allowed to happen" | 4 — Exception list |
| "This number is creeping up" | 5 — Trend monitor |

If a request spans two archetypes, build the primary one and put the second in the spec's
open items as a follow-up report. One report per control keeps the tie-out meaningful.

## Reusable elements

- **Status column** for the auditor's workflow (`New`, `Under review`, `Cleared`,
  `Escalated`). If the requestor needs to *write* status back, flag it early — a write-back
  changes the spec from a dashboard to an application, and the Snowflake team must know.
- **Days-outstanding column** whenever a finding ages. It drives prioritisation better than
  a date does.
- **Amount at risk** as a single headline figure. Executives read that number and nothing
  else; make sure it is the correct one to be read alone.
- **Drill-down** from any aggregate to the underlying rows. Specify which columns the detail
  view shows.
- **"As of" provenance line** on every report, always.
