<!-- POSTED 2026-08-30 by API as SD-67698, immediately routed to MC-1997.
     Notion status: "On Jira pending production".
     Production export: audit-flows/jira/exports/applicant-real-ticket.prod.json (64 nodes). -->

# Jira fields

| Field | Value |
|---|---|
| Project | `SD` — Service Desk |
| Issue Type | `n8n Flow` |
| Summary | Deploy to prod: Applicant Real Ticket |
| Company Department (`customfield_10822`) | Money Control |
| Accountable PIL (`customfield_10825`) | Amin Aljebbeh |
| N8N Link (`customfield_12033`) | https://sami-team.app.n8n.cloud/workflow/YXRZdtk2Geeeqaal |

---

## Business Context / Goal

The company buys real travel tickets for applicants. When an applicant never flies and the ticket is never refunded, that is a direct loss, and it stays invisible unless someone reconciles the ticket outcome against the money.

The flow audits real-ticket spend in the month, ties each ticket to its transaction, nets off reversals, and opens a case where the money never came back.

**Expected outcome:** a real ticket the company paid for, where the applicant never flew and the money never returned, is surfaced per applicant at its ticket amount in AED, in the results workbook.

An AI verifier reads the ERP record behind each red flag and returns an advisory verdict. The verdict never changes a case's state; only a human closes a case.

## Trigger & Schedule

**Scheduled.** Monthly, on the 15th at 06:00 Asia/Dubai. Each run audits the previous full calendar month. No webhook. No manual trigger.

## Inputs & Data Sources

ERP production (`erpbackendpro.maids.cc`), read-only. No files, no Snowflake. The flow also keeps its own case store in two n8n Data Tables.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | /accounting/transactions/page/advancesearchNew | Population count, population pages, and the all-time reversal lookup (3 nodes) |
| GET | /accounting/transactions/{id} | Per-transaction detail, called only where the applicant id cannot be parsed from the description |
| GET | /recruitment/maid-at-common/get-main-data/{applicantId}?tab=FLIGHT_TICKTE | The applicant's flight-ticket record |

A ticket charged inside the window is frequently refunded in a later month, so the reversal lookup is deliberately all-time rather than windowed. That is why the first endpoint appears three times with different scopes.

## Outputs & Recipients

- **Google Sheet** — results workbook: https://docs.google.com/spreadsheets/d/1DeVSbOADEWwDx3wR3qURNKcwINxUwvMzRigErR0qE0o/edit?gid=813136346#gid=813136346
  Four nodes write it: `Cases -> Sheet` (Cases tab), `Verdicts -> Sheet` (Verifier verdicts tab), `Run -> Sheet` and `Run (error) -> Sheet` (Runs tab).
- **n8n Data Tables** — the case store. Per-applicant amounts and identifiers stay here; the workbook and the runs log carry the case rows a human works through.
- No e-mail. No callbacks.
- Nothing is written back to ERP. No client-facing messages.

## Expected Number of Executions per Day

**~0.03 per day** — one scheduled execution per month, 12 per year. One execution on the 15th, none on any other day.

Per-run load, measured on execution `93601` (2026-08-19): 273 seconds wall clock. ERP nodes pace at 2 in flight with a 500–750 ms interval, which is 4 requests/second or below.

## Attachments

- n8n flow export (.json) — 64 nodes
- n8n workflow link: https://sami-team.app.n8n.cloud/workflow/YXRZdtk2Geeeqaal
- Credentials used (names as they appear in the n8n dropdown, no secrets):

| Credential name | Type | Used by |
| --- | --- | --- |
| *(to be created by the deploying team, with a production token)* | HTTP Bearer Auth | 5 ERP nodes |
| Hassan Maids Account | Google Sheets OAuth2 | 4 nodes |
| Hassan LangCC | Anthropic API | 1 node |

The five ERP nodes ship with an **empty HTTP Bearer Auth slot** — create the credential with a production token and select it on each.

## APIs Used

- The 3 ERP endpoints listed under Inputs & Data Sources — all pre-existing and read-only, no new API work required.
- Google Sheets API v4 (via the n8n Google Sheets node)
- Anthropic API (via the n8n Anthropic node)
