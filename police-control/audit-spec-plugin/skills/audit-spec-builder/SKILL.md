---
name: audit-spec-builder
description: >
  This skill should be used when a Police & Control (P&C) team member at maids.cc wants to
  produce an auditing dashboard specification for the Snowflake team. Triggers on "build an
  audit spec", "new auditing dashboard", "spec for the Snowflake team", "P&C report",
  "Police and Control report", "audit dashboard requirements", "I need a dashboard that
  audits X", "we need to control/verify X financially", "turn this into a spec", or any
  request to design, scope, or finalise a financial-audit report, reconciliation, variance
  check, or exception report. Also use when the user hands over screens, sheets, transaction
  examples, or a draft report structure and expects a deliverable spec. Orchestrates the
  other skills in this plugin (snowflake-discovery, ask-the-code, audit-report-ui).
metadata:
  version: "0.1.0"
  owner: "Police & Control"
---

# Audit Spec Builder

Run the Police & Control spec pipeline. Every session that triggers this skill has exactly
two mandatory deliverables — never end without both:

1. **A finalised spec document** (markdown file) the Snowflake team can build from unaided.
2. **A UI artifact** showing the finished report with realistic worked data.

A session that produced discussion, tables, or SQL but not those two files is incomplete.

**Read `references/spec-traps.md` before writing any verdict logic.** It carries eighteen defects
that each cost real rework, ordered by expense. The first is the one that recurs: *something is
marked as blocked on the screen while the underlying numbers still count those records as clean.*
Every audit spec must be read against that list before it is called finished.

## Where this skill ends, and what picks it up

This skill ends at a spec and a handoff. **It does not run the audit.** When the work moves to writing
or running SQL, adjudicating what came back, or deciding whether a number is publishable, that is the
`audit-execution` skill in this plugin — and switching to it matters, because the failure modes are
different in kind.

Spec defects are errors of *design*: a clearance that lets a record skip a test. Execution defects are
errors of *measurement*: a column whose meaning was assumed. In one full run, **fourteen candidate
findings were raised and withdrawn**, none of them a SQL error, two of which would have been published
above AED 1.5m each. A perfect spec does not protect against any of that.

## Operating principles

- **P&C audits money.** Every report exists to detect a discrepancy, leakage, unauthorised
  amount, missing charge, or broken control. Always establish *what wrong thing this report
  is designed to catch* before designing anything. If the user has not said it, ask.
- **Never invent a table, column, or field name.** A name enters the spec only when it came
  from a Snowflake query result, from Ask the Code, or from the user. Label anything else
  `UNVERIFIED — Snowflake team to confirm`.
- **Assume Snowflake can do anything.** Fuzzy/approximate name matching, LLM-generated
  columns produced by a prompt on their side, cross-database joins, scheduled refreshes,
  semi-structured parsing — all in scope. Never drop or water down a business requirement
  for feasibility reasons. State the requirement; let the Snowflake team choose the method.
- **Do not design the pipeline for them.** The spec says *what* must be true of the data and
  the numbers, not which DAG or dbt model to write.
- **The requestor approves point by point.** Do not batch-approve a spec at the end.
- **Verdicts are six values, not two.** GREEN · RED · CANDIDATE · VOID · BLOCKED · REPORTED. A spec
  that offers only *finding* and *clean* forces every non-finding into "clean", and a test that could
  not run then reads as a pass. **VOID and BLOCKED must be expressible in the metric layer**, or the
  dashboard built from this spec will overstate coverage. See `audit-execution`.
- **Price what the spec excludes.** Any filter that appears in every test defines a population nobody
  will look at. One standing `NOTE_DATE <= CURRENT_DATE()` hid AED 385,000 that was never failed,
  passed, or examined. State each standing exclusion and its size in the coverage metric itself, not
  in a footnote.
- **Point-in-time predicates read from a log, never from a current-state column.** Six findings in one
  audit moved when a log replaced the column — four shrank, one grew, one inverted. If no log exists
  for that attribute, the test is BLOCKED, not approximate.
- **A clearance is not a finding's opposite.** A record is clean only when every applicable test
  *ran* and passed; if one could not run, the record is amber. One red test outweighs any number of
  greens, and one blocked test does too. The asymmetry is the whole design — see
  `references/spec-traps.md` §1.
- **Never take a column's meaning from its name.** A boolean called `PAID` meant "carried forward",
  not "was paid", and scoping on it would have dropped most of a population while reporting the
  month clean. Ask the code which write paths set a field before any filter depends on it.

## Step 0 — Preflight

Check both dependencies before doing any work, and report status in one line each:

- **Snowflake connector** — run a trivial probe (`SELECT CURRENT_ACCOUNT(), CURRENT_ROLE()`).
  If it errors with an invalidated/expired connection, tell the user to reconnect the
  **Snowflake** connector (the standard one, not "Snowflake MCP") and continue with intake
  meanwhile — but never guess at data existence in place of querying.
- **Ask the Code token** — required only if ERP table discovery becomes necessary. Ask the
  user for a fresh bearer token when Step 2 shows gaps. See the `ask-the-code` skill; tokens
  expire within hours, so request it at the moment of use rather than up front.

## Step 1 — Intake and business spec

Collect these three inputs. They map to what the user is expected to bring:

| Input | What to get | If missing |
| --- | --- | --- |
| **Data sources** | ERP screens, Google Sheets, existing Snowflake tables, exports, third-party systems the user already knows hold this data | Ask which screen or sheet they read today to do this check manually |
| **Examples** | "For transaction ID X the report should show Y" — at least 2, ideally one clean case and one exception case | Ask for one real ID they have already verified by hand. Do not proceed on zero examples |
| **Final report structure** | The metrics, the grain (one row per what?), the filters, the drill-downs | Offer a first-draft structure for them to correct |

Then write the **business spec** — plain business language, no table names, no SQL:

- The control being enforced and the failure it catches.
- Who reads the report, how often, and what action they take on a red row.
- The population in scope and explicitly out of scope.
- The grain: one row per transaction / per contract / per maid / per invoice / per month.
- Each metric as a sentence a finance person would accept as the definition.

Play this back and get confirmation before touching data. A misunderstood control produces
a technically perfect spec for the wrong report.

## Step 2 — Does the data already exist in Snowflake?

Invoke the **`snowflake-discovery`** skill. Classify **every single data point** the report
needs into one of three buckets, and show the evidence (query + result) for each:

- **EXISTS** — named table and column found, populated, at usable grain and freshness.
- **PARTIAL** — present but wrong grain, stale, truncated history, or missing a needed field.
- **MISSING** — not in Snowflake at all.

If any KPI or metric already has an approved definition in
`BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER`, reuse that logic verbatim with all its
filters. Never rebuild an approved KPI by hand. If none exists, say so explicitly and mark
the metric as a new P&C definition.

If everything is EXISTS, skip Step 3 and go to Step 4.

## Step 3 — ERP table discovery via Ask the Code

For every PARTIAL and MISSING data point that plausibly originates in the ERP, invoke the
**`ask-the-code`** skill and ask the low-code platform the pipeline's standard question:

> For these specific data points in the following requested report, what are the native
> data table names in our database? — followed by the data point list and the business
> definition of each.

Select the ERP module(s) the user's subject belongs to, and always use an intelligent model.
Bring back native table names, column names, join keys, and any status/enum semantics, then
fold them into the ingestion request section of the spec.

Data that is neither in Snowflake nor in the ERP (a manual sheet, a bank portal, a WhatsApp
export) becomes an ingestion request naming the actual source artefact and its owner.

## Step 4 — Feedback questioning loop

This is a loop, not a single pass. Read `references/feedback-loop.md` for the question banks.

1. Ask every question needed to sharpen the spec: ambiguities, missing examples, edge cases.
2. Get the requestor's approval on each point individually.
3. Then ask: **do the new answers and newly discovered data raise further questions?**
   - **Yes** → loop back to 1.
   - **No** → proceed to Step 5.

Discovering a real table almost always raises new questions (an unexpected status value, a
soft-delete flag, multi-currency, a second table holding adjustments). Expect at least two
passes. Announce which pass you are on.

Never exit the loop silently — state that the loop is closed and why.

## Step 5 — Build the UI example

Invoke the **`audit-report-ui`** skill. Produce a published artifact of the finished report
using the user's worked examples as real visible rows, so they can see and correct the
layout before the Snowflake team builds it.

## Step 6 — Build the finalised spec

Write the spec to a markdown file using `references/spec-template.md`. Every spec contains,
in this order:

1. **Business logic** — the control, the failure it catches, the reader, the action.
2. **All data points needed** — existing Snowflake tables (verified) *plus* the new data
   ingestion request for anything absent, with ERP native table names where known.
3. **Metric calculations** — each with an ID, formula, inputs, filters, rounding, currency,
   null handling, and division-by-zero behaviour.
4. **Finalised UI report** — layout, columns, grain, filters, drill-downs, flag thresholds,
   plus a link to the artifact.
5. **Worked examples** — a few concrete cases showing exactly what the output would be,
   arithmetic included, at least one exception case.

Before delivering, run the **`spec-auditor`** agent over the draft. Fix what it finds.
Then hand the user the spec file and the artifact link together.

## Step 7 — Hand it to DNA

A spec that stays in a file changes nothing. It becomes one or two tickets in the **DNA** Jira
project, and DNA has a house shape with an intake bot that grades every ticket before a human sees
it. Read `references/dna-handoff.md` and produce:

- An `Analytic Engineer Task` for the model and, where a dashboard is needed, a
  `BI Visualization Task` blocked on it. The model always blocks the visual build.
- **Numeric acceptance criteria.** A correct fix was once bounced for saying counts should rise
  "materially" without a target.
- **The layout restated in the description** — a Claude artifact link is not readable by the intake
  bot, which logs it `UNVERIFIED` and falls back to the description.
- A **Not a duplicate** table naming every adjacent ticket by key.

**Search the DNA project for the tables you intend to read before writing the spec, not after.**
On one occasion a defect found independently had already been filed and fixed there, with
production measurements that corrected two rules in the draft.

## Guardrails

- **No recurring queries.** Snowflake access here is ad hoc and exploratory only. If asked
  to schedule a query, refresh a report daily, or wire up a standing unattended run,
  decline that part and route it to the ERP team — the spec is the handoff mechanism, and
  ad hoc Snowflake is not a governed system of record.
- **No sensitive personal or financial data in output.** Never surface phone numbers,
  contact details, or salaries in chat, in the artifact, or in the spec, and do not name the
  table holding them. For audit reports that legitimately concern amounts, specify the
  metric and use masked or synthetic values in examples and mockups.
- **Approved KPI definitions win** over anything reconstructed here.
- **Show the evidence.** Any existence claim about a table carries the query that proved it.
