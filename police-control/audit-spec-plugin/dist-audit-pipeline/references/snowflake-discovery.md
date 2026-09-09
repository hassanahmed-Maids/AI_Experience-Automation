
# Snowflake Discovery

> **Part of the P&C audit pipeline.** `audit-pipeline` carries the whole arc — discover → specify → execute → hand over — and the five rules that hold at every stage. Read it if you are not certain which stage this request belongs to; starting in the wrong one wastes the session.


Establish, with evidence, which of a report's data points are already queryable in Snowflake
and which must be ingested. Produce a per-data-point verdict, never a general impression.

Use the standard **Snowflake** connector (not "Snowflake MCP") unless told otherwise.

## Hard rules

These come from company policy and override any convenience:

- **Ad hoc only.** Snowflake here is for exploratory querying, analysis, and reporting.
  Never schedule a query, never set up a recurring or standing unattended run (cron,
  daily/weekly/monthly, n8n/Zapier/Make repeats). If asked, decline that part, explain that
  recurring data processes must go through the ERP team because ad hoc Snowflake is not a
  governed system of record — shadow ops, lineage, and reconciliation risk — and route them
  there. The spec is the correct handoff for anything recurring.
- **Approved KPI definitions are reused verbatim.** For any KPI value, definition, or
  calculation, check `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` (and the wider
  `BA_VIEWS.CORE_SILVER.` schema) for an approved definition and use its exact query logic
  with **all** its filters, including flags such as `FAKE = false`. Never reconstruct an
  approved KPI. If no approved definition exists, say so explicitly, label the metric an
  unverified ad hoc definition rather than an approved KPI, and recommend the Data team add
  it to the Data Catalog.
- **No sensitive personal or financial data in output.** Never surface phone numbers,
  contact details, salaries, or other personal financial details in chat, in a spec, or in
  an artifact — read access does not authorise display. Do not even name the table holding
  them. Decline and point to the system of record. An audit *metric* over amounts is fine;
  a list of individuals' salaries is not. Use masked or synthetic values in examples.

## Discovery procedure

Run these in order. Read `references/snowflake-discovery--discovery-queries.md` for the full query set.

1. **Confirm the connection.** `SELECT CURRENT_ACCOUNT(), CURRENT_ROLE(), CURRENT_WAREHOUSE()`.
   If this fails with an invalidated connection, stop and ask the user to reconnect the
   Snowflake connector. Never substitute guesswork for a query.
2. **Check for an approved definition** of each metric in `BA_VIEWS.CORE_SILVER` before
   hunting for raw tables. An approved definition short-circuits the whole search.
3. **Find candidate tables** by searching table and column names across the account.
4. **Confirm the candidate is real and populated** — row count, and the latest timestamp.
5. **Confirm the grain** — is one row really one transaction, or does a join fan it out?
6. **Confirm the types** of every join key and filter column.
7. **Confirm coverage over the audit period**, not just overall.
8. **Assign a verdict** per data point and record the query that produced it.

## Verdicts

Give every data point in the report exactly one:

| Verdict | Meaning | Goes into spec section |
| --- | --- | --- |
| **EXISTS** | Named table + column found, populated, right grain, fresh enough, covers the period | Verified data points |
| **PARTIAL** | Present but wrong grain, stale, history truncated, or a needed field absent | Verified (what exists) **and** ingestion request (the gap) |
| **MISSING** | Not in Snowflake | Ingestion request |

State the evidence inline: table name, row count, latest row date, and the query used. A
verdict without a query behind it is an assumption.

## When row-level queries are unavailable

Metadata statements (`SHOW …`, `DESC`, `GET_DDL`) need no compute, and in this warehouse the
`ba_views` layer stores **profiled metadata in the column and table COMMENTs** — `allowed_values`
(real ranges and enum values, generated from data at build time), `source_expression`, the model's
extracted `WHERE` clause, its join list and its downstream models. That is enough to establish what
exists, its types, its enum membership and its lineage, without reading a row.

State plainly what that does and does not prove. It proves **structure**; it never proves
population, freshness or cardinality. Mark every content claim so a reader can tell the difference,
and list the specific queries that would close each one.

⚠️ **`SHOW OBJECTS IN SCHEMA` can return a truncated list.** A schema listing stopped
alphabetically part-way and omitted objects that `SHOW OBJECTS LIKE '%…%' IN ACCOUNT` then found in
that same schema. Enumerate with `LIKE` or `STARTS WITH`, never a bare schema listing, or you will
conclude a table does not exist when it does.

## Traps that produce a wrong verdict

- **Zero rows is a symptom, not a finding.** In this warehouse, zero rows usually means a
  type mismatch or a stale source rather than an empty population. Investigate before
  concluding "no such data".
- **Type mismatches match nothing and raise no error.** Comparing a TEXT column to a boolean
  or a number silently returns zero rows. Check `DATA_TYPE` for every column you filter or
  join on. A known example: `IS_LIVE_OUT` is TEXT, so `WHERE IS_LIVE_OUT = TRUE` matches
  nothing.
- **A dead source looks identical to a real zero.** Some tables stopped being written to on
  a date. Always check the maximum timestamp, not just the row count — a table with two
  million rows whose newest row is from January is useless for a current-month audit.
- **A moving denominator fakes a trend.** If coverage of a category swings between periods,
  a count comparison shows movement that is coverage, not behaviour. For any
  period-over-period audit metric, measure the denominator on both sides.
- **Aggregating a per-event table to entity level distorts totals.** Collapsing a contract
  event with `MIN()` once overstated a cohort by 46%. Decide the grain deliberately and
  verify the row count after any collapse.
- **Test and fake rows inflate audit findings.** Find the flag that marks them and exclude
  it; state the exclusion in the spec.
- **A curated view may exclude source rows silently.** One view dropped an entire category via an
  INNER JOIN on a secure-flag, so "no matching row" and "row withheld" were indistinguishable. Read
  the view's own filter before treating an absence as evidence.
- **Empty-string sentinels.** Derived columns often return `''` rather than NULL when a CASE finds
  no branch, so `IS NOT NULL` passes on a blank. Use `NULLIF(TRIM(x),'')` on every free-text
  equality read from a view.
- **The warehouse enum may be shorter than the source enum.** A type column profiled three values
  where the application had seven. Confirm enum membership against the code and make the surplus a
  run guard.

## What to do with the gaps

Everything not EXISTS becomes an ingestion request. Write it using
`references/snowflake-discovery--ingestion-request.md`. Where the source is the ERP, get the native table and
column names from the **`references/ask-the-code.md`** skill first — an ingestion request naming a real
ERP table is actionable; one saying "maid salary data from the ERP" is not.

## Assume Snowflake can do anything

When scoping feasibility, assume the Snowflake team can implement anything the business
needs: fuzzy and approximate name matching, LLM-generated columns produced by running a
prompt on their side, cross-database joins, semi-structured parsing, derived flags, and
whatever refresh cadence they choose to build. Never trim, simplify, or drop a business
requirement because it looks hard to compute. State the requirement precisely — including
the match tolerance or the judgement rule for an AI-generated field — and let them pick the
implementation.
