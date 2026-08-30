<!-- POSTED 2026-08-30 as https://jira-maids-cc.atlassian.net/browse/SD-67696. Notion status moved to "On Jira pending production". -->

# Jira fields

| Field | Value |
|---|---|
| Project | `SD` — Service Desk |
| Issue Type | `n8n Flow` |
| Summary | Deploy to prod: Dummy Tickets Submitted for Refund — Housemaids |
| Company Department (`customfield_10822`) | Money Control |
| Accountable PIL (`customfield_10825`) | Amin Aljebbeh |
| N8N Link (`customfield_12033`) | https://sami-team.app.n8n.cloud/workflow/aTmGMAlYLwsJQ7js |

---

## Business Context / Goal

When an applicant's travel is booked speculatively, the company pays for a *dummy* ticket that is refundable by policy. If the refund is never requested or never lands, the company has paid for a flight nobody took and nobody chased.

The flow audits the dummy tickets charged in the month, follows each one to its outcome, and opens a case where the money did not come back.

**Expected outcome:** a dummy ticket the company paid for and never got back is surfaced per applicant, at its ticket amount in AED, in the results workbook.

An AI verifier reads the ERP record behind each red flag and returns an advisory verdict. The verdict never changes a case's state; only a human closes a case.

## Trigger & Schedule

**Scheduled.** Monthly, on the 15th at 06:00 Asia/Dubai. Each run audits the previous full calendar month.

No webhook. No manual trigger.

## Inputs & Data Sources

ERP production (`erpbackendpro.maids.cc`), read-only. No databases, no files, no Snowflake.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /accounting/transactions/page/advancesearchNew | The dummy-ticket expense population, and the all-time refund lookup (2 nodes) |
| GET | /recruitment/maid-at-common/get-main-data/{applicantId}?tab=FLIGHT_TICKTE | The applicant's flight-ticket record |

The second endpoint is called from a sub-workflow, **Dummy Tickets Housemaids · 0-Fetch Tickets** (`YQlNlxrnhbQpBbdl`), which the main flow calls once per chunk of 25 applicants. Both workflows are part of this deployment.

## Outputs & Recipients

- **Google Sheet** — results workbook: https://docs.google.com/spreadsheets/d/172R3JzxXm1nf6Vc3qTesin7eys-jT0ng3SOxUsf3LD8/edit?gid=1358016816#gid=1358016816
  Written by three nodes: `Cases -> Sheet`, `Run Summary -> Sheet`, `Verdicts -> Sheet`.
- No e-mail. No callbacks.
- Nothing is written back to ERP. No client-facing messages.

## Expected Number of Executions per Day

**~0.03 per day** — one scheduled execution per month, 12 per year. One execution on the 15th, none on any other day. The sub-workflow runs once per chunk of 25 applicants within that same execution.

## Attachments

- n8n flow export (.json) — main flow, 53 nodes
- n8n flow export (.json) — sub-workflow `YQlNlxrnhbQpBbdl`, 5 nodes
- n8n workflow links:
  - https://sami-team.app.n8n.cloud/workflow/aTmGMAlYLwsJQ7js
  - https://sami-team.app.n8n.cloud/workflow/YQlNlxrnhbQpBbdl
- Credentials used (names as they appear in the n8n dropdown, no secrets):

| Credential name | Type | Used by |
|---|---|---|
| *(to be created by the deploying team, with a production token)* | HTTP Bearer Auth | ERP nodes |
| Hassan Maids Account | Google Sheets OAuth2 | 3 nodes |
| Hassan LangCC | Anthropic API | 1 node |

## APIs Used

- The 2 ERP endpoints listed under Inputs & Data Sources — all pre-existing and read-only, no new API work required.
- Google Sheets API v4 (via the n8n Google Sheets node)
- Anthropic API (via the n8n Anthropic node)
