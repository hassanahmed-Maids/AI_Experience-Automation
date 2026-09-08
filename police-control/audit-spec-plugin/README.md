# Police & Control — Audit Spec Builder

Turns a Police & Control business request into a finalised, Snowflake-ready auditing
dashboard specification plus a UI mockup artifact.

P&C audits financials across every part of maids.cc. The department's output is not a
dashboard — it is a **spec** the Snowflake team can build a dashboard from without asking a
follow-up question. This plugin encodes that pipeline.

## What a session produces

Every session ends with three deliverables. A session that produced only discussion is
incomplete.

1. **A finalised spec** — markdown, containing business logic, all data points (verified
   Snowflake tables plus ingestion requests), metric calculations, the finalised UI report,
   and worked examples.
2. **A UI artifact** — a published mockup of the finished report with the requestor's own
   examples as visible rows.
3. **The DNA handoff** — two Jira tickets (model, then dashboard) plus a source-tables
   attachment, written to the shape DNA actually builds from. A spec that never becomes a
   ticket never becomes a dashboard.

## The pipeline

```
Business spec  ──►  Does the data exist in Snowflake?
                          │
                    No ───┴──► Ask the Code: native ERP table names
                          │                        │
                          └──────────┬─────────────┘
                                     ▼
                        Feedback questioning loop  ◄──┐
                                     │               │
                        New questions raised? ── Yes ─┘
                                     │ No
                                     ▼
                            Build UI example
                                     ▼
                          Build finalised spec
                                     ▼
                        spec-auditor (trap catalogue)
                                     ▼
                          DNA handoff — Jira tickets
```

## Components

| Component | Purpose |
| --- | --- |
| **`audit-spec-builder`** (skill) | The orchestrator. Runs the pipeline end to end and assembles the spec. Start here. |
| **`snowflake-discovery`** (skill) | Decides, with evidence, whether each data point already exists in Snowflake; writes the ingestion request for what does not. |
| **`ask-the-code`** (skill) | Queries the ERP codebase through the Low-Code Platform API to get native table and column names. Includes a tested client script. |
| **`audit-report-ui`** (skill) | Builds the UI mockup artifact. Includes the five P&C report archetypes. |
| **`spec-auditor`** (agent) | Gate before delivery. Tries to break the spec against 20 checks — the clearance defect, assertions that cannot fail, scope filters that delete the evidence, invented table names, examples that don't reconcile, policy breaches. |

No hooks and no bundled MCP servers — the connectors below are used directly.

## Setup

### 1. Snowflake connector (required)

Connect the standard **Snowflake** connector (not "Snowflake MCP"). Without it, data
existence cannot be verified and the spec will be built on assumptions.

If a query returns an invalidated-connection error, reconnect it before continuing.

If the connector is present but no warehouse grant is: metadata-only discovery still works.
`SHOW`, `DESCRIBE` and `GET_DDL` need no warehouse, and in `BA_VIEWS` the column COMMENTs carry
dbt-generated `allowed_values`, `source_expression` and extracted `WHERE` clauses — enough to
build a spec on. See `skills/snowflake-discovery/SKILL.md`.

### 2. Ask the Code token (required when ERP discovery is needed)

The ERP Low-Code Platform API needs a bearer JWT copied from an active LCP session.
**Tokens expire within hours**, so the skill asks for one at the moment of use.

```bash
export ASK_THE_CODE_TOKEN="<paste jwt>"
```

Optional, only if a call ever returns 401 with a valid token:

```bash
export ASK_THE_CODE_PLATFORM="<secc-ch-ua-platform session value>"
```

Never commit a token or write it into a spec or artifact.

### 3. Requirements

Python 3 (standard library only) for the Ask the Code client. No packages to install.

## Usage

Start a session by describing the audit you need:

> "I need a dashboard that catches salary payments made after the payroll month was locked."

The orchestrator then asks for the three inputs it needs — **data sources** (screens, sheets,
tables you already know about), **examples** (for this transaction ID the report should show
this), and **final report structure** (metrics and UI) — and asks for anything missing.

Direct invocations:

| Say | Runs |
| --- | --- |
| "build an audit spec for X" | `audit-spec-builder` |
| "does this data exist in Snowflake?" | `snowflake-discovery` |
| "what are the native table names for X?" | `ask-the-code` |
| "show me what the report will look like" | `audit-report-ui` |
| "is this spec ready to send?" | `spec-auditor` |

Ask the Code directly:

```bash
python3 skills/ask-the-code/scripts/ask_the_code.py \
  -q "What are the native table names storing client invoice adjustments? Tables and key columns only." \
  -m erp/magnamedia-accounting
```

Answers take 30 seconds to 2 minutes. See
`skills/ask-the-code/references/module-registry.md` for the 34 available modules.

## Built-in guardrails

- **No recurring queries.** Snowflake here is ad hoc and exploratory. Anything recurring is
  routed to the ERP team — the spec is the handoff mechanism.
- **No sensitive personal or financial data** in chat, specs, or mockups. Audit metrics over
  amounts are fine; individuals' salaries, phone numbers, and contact details are not.
- **Approved KPI definitions are reused verbatim** from
  `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER`, never reconstructed.
- **No invented table names.** A name enters a spec only from a query result, an Ask the Code
  answer, or the user — otherwise it is marked `UNVERIFIED`.
- **Snowflake is assumed capable of anything** — fuzzy matching, AI-generated columns,
  cross-database joins. Requirements are never trimmed for feasibility.
- **A clearance is not a finding's opposite.** Every test returns RED, GREEN, BLOCKED or
  NOT-APPLICABLE; a record is GREEN only when every applicable test actually ran. Blocking is
  scoped to the single test, never the group.
- **No column's meaning comes from its name.** A flag, status or enum that gates a verdict
  carries its verified meaning, or the spec says it is unverified.

## Reference material

- `skills/audit-spec-builder/references/spec-template.md` — the spec structure to fill in
- `skills/audit-spec-builder/references/spec-traps.md` — the 16 defects that have actually
  cost rework, ordered by what they cost. Read before writing any spec.
- `skills/audit-spec-builder/references/dna-handoff.md` — how DNA intake works, the ticket
  shape that grades Ready, and the four rules with teeth
- `skills/audit-spec-builder/references/feedback-loop.md` — six question banks and the edge
  cases to probe unprompted
- `skills/audit-spec-builder/examples/example-spec-payroll-lock.md` — a worked spec showing
  the expected depth
- `skills/snowflake-discovery/references/discovery-queries.md` — the discovery query set
- `skills/snowflake-discovery/references/ingestion-request.md` — ingestion request format
- `skills/ask-the-code/references/api-reference.md` — raw API, verified behaviour, gotchas
- `skills/audit-report-ui/references/ui-patterns.md` — the five audit report archetypes

## Source

Pipeline per the P&C process chart:
<https://whimsical.com/maids-cc/police-and-control-JHTkZKt1Cz5i8yuRF6sERa>

Version 0.2.0.
