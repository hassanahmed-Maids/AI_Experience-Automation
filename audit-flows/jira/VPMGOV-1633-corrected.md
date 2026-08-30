<!--
Corrected body for VPMGOV-1633 — Deploy to prod: Travel Assist Payments Audit.
Same content as submitted; formatting converted from Jira Server wiki markup to Markdown.

The API cannot write this: `description` is not on the edit screen for issue type `n8n Flow`
in VPMGOV. Paste everything below the line into the Jira UI editor, which converts Markdown
on paste. Verify afterwards with responseContentFormat:"adf" — you want a `doc` object back.

TWO DELIBERATE DEVIATIONS FROM THE SUBMITTED TEXT — both flagged rather than slipped in:

1. ADDED a "Known route exceptions" paragraph under Inputs & data sources. The submitted ticket
   lists two banned routes with no note, so the ban and the ticket disagree silently. DELETE this
   paragraph if you want a formatting-only change.
2. GENERALISED the notification recipient from a named address to "the check's business owner",
   to keep an individual's address out of this repo. The address is already in the live ticket;
   put it back when pasting if you want the ticket verbatim.

Everything else is the submitted content, unchanged.
-->

## Business context / goal

Travel Assist is a fee MV clients owe on a new contract, alongside a MOHRE deposit and a work-permit fee that maids.cc pays Tadbeer on the client's behalf. There is no systematic check that those amounts come back in.

This flow audits every Travel Assist contract that started in a given month, compares what was owed against what was actually paid, and produces a per-contract finding.

**Expected outcome:** unrecovered Travel Assist and MOHRE money is surfaced within two weeks of month end, with the supporting evidence attached, rather than being found by accident or not at all.

Scoring is per fee basis: Travel Assist is compared *net of VAT* (the nationality tiers are VAT-exclusive prices); MOHRE + work permit are compared *gross* and capped at what was actually paid to Tadbeer for that client, so a cost never incurred is never counted as a loss. An AI reviewer then reads the ERP paper trail behind each red flag and returns an advisory verdict — Justified / Auditor Review Required / Report to PIL. The verdict never changes a case's state; only a human closes a case.

## Trigger & schedule

**Scheduled.** Monthly, on the 15th at 06:00 Asia/Dubai. Each run audits the *previous full calendar month* — payments need time to settle, so the two-week lag is deliberate.

No webhook, no manual trigger, no inbound endpoint of any kind.

## Inputs & data sources

ERP production only (erpbackendpro.maids.cc). **Read-only — the flow writes nothing back to ERP.** 14 endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | /clientmgmt/contract/search/page | Travel Assist contracts starting in the window — defines the cohort |
| POST | /clientmgmt/tadbeertransaction/invoicedetails | MOHRE deposits paid to Tadbeer (serviceId 2) |
| POST | /clientmgmt/tadbeertransaction/invoicedetails | Work-permit fees paid to Tadbeer (serviceId 34) |
| GET | /staffmgmt/housemaid/getHousemaidInfo/{id} | Nationality + initial visa location — sets the price and MOHRE applicability |
| GET | /staffmgmt/housemaidStatusReport/generate/{id} | Maid status history (context only, never scored) |
| POST | /accounting/payments/page/advancesearch | Payments received against the contract |
| POST | /clientmgmt/client/get-client-details/{id} | Contract plan, contract discounts, client notes (3 nodes, differing type param) |
| GET | /complaints/complaint/page/client/{id} | Client complaints |
| GET | /complaints/teamComplaintUpdate/historyOfComplaint/{id} | Complaint threads |
| GET | /clientmgmt/clientMgrNote/byClient/{id} | Manager and credit notes |
| GET | /clientmgmt/client/smsLog/{id} | SMS and WhatsApp logs (2 nodes) |

No databases, no files, no Snowflake.

The flow also reads its own carry-forward state from n8n workflow static data — red and pending cases from prior runs — so an unresolved flag is re-audited rather than dropped once the audit window moves past its contract start. Entries expire after 6 months.

**Known route exceptions.** Two endpoints above are on the 2026-08-25 ERP dead-end route ban: `/clientmgmt/contract/search/page` and `/accounting/payments/page/advancesearch`. Both are paginated routes the ban lists; `/accounting/payments/page/advancesearch` is the endpoint recorded as having taken Accounting ERP down once. They are listed here rather than omitted so the ERP dependency is visible to the team that can resolve it.

## Outputs & recipients

- **Google Sheet** — "Audit — Travel Assist Payments". One row per audited contract on a standard 18-column layout, plus a monthly snapshot tab and an append-only run log recording per-source data completeness. 12 monthly tabs retained, then archived. The sheet lives in a Drive folder scoped to the AI Experience & Automation team.
- **One notification e-mail per run** to the check's business owner — check name, month, and the sheet link only. It deliberately carries no counts, amounts, names or case keys: the findings stay behind Google permissions rather than travelling by e-mail.
- **Failure / degraded alert e-mail** to the same address when a run fails, or completes with a data source missing.

Nothing is written back to ERP. No client-facing messages. No third-party systems updated.

## Expected number of executions per day

**~0.03 per day — one scheduled execution per month (12 per year).** One execution on the 15th; none on any other day.

Per-run load, measured on a real run (window 2026-07, 31 contracts in cohort):

- ~165 ERP requests
- 6 Google Sheets API calls
- 1 Gmail send
- 5 Anthropic calls (one per case routed to the reviewer)
- 116 seconds wall clock

Per-case ERP calls are throttled at 5 concurrent with a 500 ms interval, and the workflow has a 40-minute execution ceiling.

## Attachments

- n8n flow export: "Travel Assist Payments Audit.json" (67 nodes) — attached
- n8n workflow link: https://sami-team.app.n8n.cloud/workflow/LM7ofq89VWXiLRU0

## Credentials used

Names as they appear in the n8n credential dropdown. No secrets in this ticket or in the export.

| Credential name | Type | Used by |
| --- | --- | --- |
| ERP Hassan Prod | HTTP Custom Auth | 14 ERP nodes |
| Hassan Maids Account | Google Sheets OAuth2 | 6 nodes |
| Malaz Gmail | Gmail OAuth2 | 2 nodes |
| Anthropic account 4 | Anthropic API | 1 node |

No environment variables are used.

## APIs used

The 14 ERP endpoints listed under Inputs & data sources. All are pre-existing and read-only — no new API work is required for this deployment.

Also used, via their n8n nodes: Google Sheets API v4, Gmail API, Anthropic API.
