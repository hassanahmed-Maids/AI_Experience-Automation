<!-- POSTED 2026-08-30 as SD-67695, since routed to MC-1994 (status: Pending PO).
     Notion status: "On Jira pending production".
     2026-08-30: recipients corrected to the spec's money@ + anthony.assaf@. The posted
     description still lists the three earlier addresses - description is not editable on
     MC-1994's screen via the API, so it needs a manual edit. -->

# Jira fields

| Field | Value |
|---|---|
| Project | `SD` — Service Desk |
| Issue Type | `n8n Flow` |
| Summary | Deploy to prod: Wellcare Advanced Clinic — Medical Loan Check |
| Company Department (`customfield_10822`) | Money Control |
| Accountable PIL (`customfield_10825`) | Amin Aljebbeh |
| N8N Link (`customfield_12033`) | https://sami-team.app.n8n.cloud/workflow/7HYpRKJQnH5C7jkj |

---

## Business Context / Goal

When the company pays Wellcare Advanced Clinic for a maid's treatment, that cost is meant to be added to her outstanding balance as a loan and recovered. If the loan is never raised, the company has paid for the treatment and absorbed it without anyone deciding to.

The flow reconciles each clinic payment in the month against the maid's loan record and opens a case where the cost was never added.

**Expected outcome:** money paid to the clinic for a maid's treatment and never added to her balance as a loan is surfaced in the results workbook.

## Trigger & Schedule

**Scheduled.** Monthly, on the 15th at 06:00 Asia/Dubai. Each run audits the previous full calendar month.

No webhook. No manual trigger.

## Inputs & Data Sources

ERP production (`erpbackendpro.maids.cc`), read-only. No databases, no Snowflake. One file is downloaded from ERP — the data file attached to the clinic payment transaction.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /accounting/transactions/page/advancesearchNew | Find the clinic payment population |
| GET | /accounting/transactions/{id} | Per-transaction detail |
| GET | /accounting/transactions/file/{id} | Download the data file attached to the transaction |
| POST | /payroll/HousemaidPayroll/filterHousemaids | Resolve the maid from the payment |
| GET | /payroll/loans/getHousemaidLoans/{housemaidId} | The maid's loan record |

## Outputs & Recipients

- **Google Sheet** — results workbook: https://docs.google.com/spreadsheets/d/11mkXopBVZcXDCJF1uNLkmvXEjqm1Ze9xyBQE8YnT0wI/edit?gid=0#gid=0
  Written by three nodes: `Runs Log (no input)`, `Cases -> Workbook`, `Runs Log (scored)`.
- **E-mail** — money@maids.cc, anthony.assaf@maids.cc
  - `Email: no workbook` sends an alert when no clinic data file is found for the month.
  - `Draft: findings email` creates a pre-addressed Gmail draft of the findings; a person sends it.
- Nothing is written back to ERP. No client-facing messages.

## Expected Number of Executions per Day

**~0.03 per day** — one scheduled execution per month, 12 per year. One execution on the 15th, none on any other day.

## Attachments

- n8n flow export (.json) — 37 nodes
- n8n workflow link: https://sami-team.app.n8n.cloud/workflow/7HYpRKJQnH5C7jkj
- Credentials used (names as they appear in the n8n dropdown, no secrets):

| Credential name | Type | Used by |
|---|---|---|
| *(to be created by the deploying team, with a production token)* | HTTP Bearer Auth | 5 ERP nodes |
| Malaz | Google Sheets OAuth2 | 3 nodes |
| Malaz Gmail | Gmail OAuth2 | 2 nodes |

## APIs Used

- The 5 ERP endpoints listed under Inputs & Data Sources — all pre-existing and read-only, no new API work required.
- Google Sheets API v4 (via the n8n Google Sheets node)
- Gmail API (via the n8n Gmail node)
