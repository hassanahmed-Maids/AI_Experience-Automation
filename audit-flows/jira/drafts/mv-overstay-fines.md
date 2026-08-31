<!-- DRAFT — NOT POSTED. SD template, required items only. Rewritten 2026-08-30 after the flow was
     made deployable: staging-only nodes removed, cohort route moved to the legacy advancesearch,
     Get Transaction Detail deleted, budget gate corrected.
     Production export: audit-flows/jira/exports/mv-overstay-fines.prod.json (70 nodes). -->

# Jira fields

| Field | Value |
|---|---|
| Project | `SD` — Service Desk |
| Issue Type | `n8n Flow` |
| Summary | Deploy to prod: MV Overstay Fines |
| Company Department (`customfield_10822`) | Money Collection |
| Accountable PIL (`customfield_10825`) | Amin Aljebbeh |
| N8N Link (`customfield_12033`) | https://sami-team.app.n8n.cloud/workflow/LDtsstXDfF99TnYe |

---

## Business Context / Goal

An MV maid's overstay fine is the client's to pay. When a fine of AED 300 or more is never recovered from the client, and nothing on the maid's overstay-fines record or in a complaint explains the waiver, the company has absorbed a cost it was never meant to carry.

The flow reconciles fines against recovery payments and the written record around them.

**Expected outcome:** an unrecovered overstay fine of AED 300 or more with no explaining waiver is surfaced in the results workbook with its evidence, rather than found by accident.

An AI verifier reads the complaint thread and reduction reason behind each red flag and returns an advisory verdict. The verdict never changes a case's state; only a human closes a case.

## Trigger & Schedule

**Scheduled.** Monthly, on the 15th at 06:00 Asia/Dubai. Each run audits the previous full calendar month. No webhook. No manual trigger.

## Inputs & Data Sources

ERP production (`erpbackendpro.maids.cc`), read-only. No databases, no files, no Snowflake.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | /accounting/transactions/page/advancesearch | The change-of-status / overstay transaction population, **and the maid attribution**, which this route carries inline |
| GET | /visa/overstay-fines/housemaid/{housemaidId} | The fine — gross, net, reduction and reason |
| POST | /accounting/payments/page/advancesearch | Payments received against the fine — the recovery side |
| GET | /complaints/complaint/limited/housemaid/{housemaidId} | Complaints that may explain a waiver |
| GET | /complaints/teamComplaintUpdate/historyOfComplaint/{complaintId} | The complaint thread the verifier reads |

A sixth endpoint, `GET /accounting/transactions/{id}`, was removed on 2026-08-30: it cost one ERP call per over-base transaction purely to learn which maid the transaction belonged to, and the population route now carries that link inline.

## Outputs & Recipients

- **Google Sheet** — results workbook: https://docs.google.com/spreadsheets/d/11bffryqcrvoTo6WFh2IUfHAn3cS4L0jVfrN5aAAACrI/edit?gid=1396015918#gid=1396015918
  Three nodes write it: `Cases -> Google Sheet`, `Run -> Google Sheet`, `Verdicts -> Google Sheet`.
- **n8n Data Tables** — the case store, currently disabled. Per-entity amounts and identifiers belong here rather than in the workbook summary.
- No e-mail. No callbacks.
- Nothing is written back to ERP. No client-facing messages.

## Expected Number of Executions per Day

**~0.03 per day** — one scheduled execution per month, 12 per year. One execution on the 15th, none on any other day.

Measured on the June 2026 window (execution `100973`): **705 transactions in the cohort across 4 pages**, of which **13 cleared the AED 575.65 base**. The flow's own pre-flight gate projects the worst case at **147 ERP calls** for that month — 4 cohort pages, plus 2 enrichment calls per over-base transaction, plus up to 9 evidence calls per case if every case turns red. It was 160 before the detail call was removed.

ERP nodes pace at 2 in flight with a 500 ms interval, which is 4 requests/second, the policy ceiling. The pre-flight gate refuses to start the per-entity phase if the projection exceeds the run's budget, rather than trimming the cohort.

## Attachments

- n8n flow export (.json) — 70 nodes
- n8n workflow link: https://sami-team.app.n8n.cloud/workflow/LDtsstXDfF99TnYe
- Credentials used (names as they appear in the n8n dropdown, no secrets):

| Credential name | Type | Used by |
| --- | --- | --- |
| *(to be created by the deploying team, with a production token)* | HTTP Bearer Auth | 5 ERP nodes |
| Malaz | Google Sheets OAuth2 | 3 nodes |
| Anthropic account 4 | Anthropic API | 1 node |

The five ERP nodes ship with an **empty HTTP Bearer Auth slot** — create the credential with a production token and select it on each.

## APIs Used

- The 5 ERP endpoints listed under Inputs & Data Sources — all pre-existing and read-only, no new API work required.
- Google Sheets API v4 (via the n8n Google Sheets node)
- Anthropic API (via the n8n Anthropic node)
