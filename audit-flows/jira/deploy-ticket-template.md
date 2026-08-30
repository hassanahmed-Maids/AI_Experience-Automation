# Prod-deployment ticket template — audit flows (n8n)

Derived from `VPMGOV-1633` (Travel Assist), which established the eight sections. Content is the
same; the formatting here is Markdown so it actually renders — see `README.md` for why that matters.

**Submit with `contentFormat: "markdown"`, then read back with `responseContentFormat: "adf"` and
confirm you got a `doc` object.** Not optional.

## Ticket fields

| Field | Value |
|---|---|
| Summary | `Deploy to prod: <Check Name> (n8n, <trigger shape>)` |
| Issue type | `n8n Flow` (VPMGOV precedent) — **open decision**, see README |
| Labels | `audit`, `n8n`, `prod-deployment`, `<check-slug>`, `<team-agenda-label>` |
| Assignee | the receiving dev |

`⚙` marks a section derivable from the workflow JSON — `/draft-deploy` fills these; a human writes
the rest.

---

## Business context / goal

What money question this check answers, in two or three sentences a reader outside the team can
follow. Then, explicitly:

**Expected outcome:** what is surfaced, how quickly, and what happens today instead.

Then the scoring basis — where amounts are compared net vs gross, what caps apply, and what any AI
reviewer is and is not allowed to do. State plainly that an advisory verdict never changes a case's
state and only a human closes a case.

## Trigger & schedule

**Scheduled** or **Webhook**, the cadence, the timezone, and which window each run audits.
Say why any lag is deliberate.

Where it is true, say so outright: *No webhook, no manual trigger, no inbound endpoint of any kind.*
Where it is **not** true, say what the endpoint is and what authenticates it — a live inbound webhook
is exactly what a deployment reviewer needs to know about. ⚙ *(trigger node type + cron)*

## Inputs & data sources ⚙

Name the environment (`erpbackendpro.maids.cc`) and state read-only if it is:
**Read-only — the flow writes nothing back to ERP.**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/path/one` | what it is for, and what it defines |
| GET | `/path/two/{id}` | … |

Then say what is *not* used — "No databases, no files, no Snowflake" — and describe any
carry-forward state the flow keeps (n8n static data, a data table), including how entries expire.

**Known route exceptions.** If any endpoint is on the 2026-08-25 dead-end route ban, list it here
with why no alternative exists and what the ERP-team ask is. Do not omit it — `VPMGOV-1633` shipped
listing `/clientmgmt/contract/search/page` with no note, and the ban and the ticket have disagreed
silently ever since.

## Outputs & recipients

- **Google Sheet** — name, row shape, tab retention, and which Drive folder scopes access.
- **Notification e-mail per run** — to whom, and exactly what it carries. The house pattern is check
  name, period and sheet link only: *no counts, amounts, names or case keys*, so findings stay behind
  Google permissions rather than travelling by e-mail.
- **Failure / degraded alert** — to whom, and on what condition.

Close with what is *not* written: nothing back to ERP, no client-facing messages, no third-party
systems updated.

## Expected number of executions per day ⚙

The rate, stated per day even when it is monthly, with the yearly count in brackets.

Per-run load, **measured on a real run** (name the window and cohort size):

- ~N ERP requests
- N Google Sheets API calls
- N Gmail sends
- N Anthropic calls
- N seconds wall clock

Then the throttle and the ceiling: concurrency, interval, execution timeout.

## Attachments ⚙

- n8n flow export: `<Name>.json` (N nodes) — attached
- n8n workflow link: `https://sami-team.app.n8n.cloud/workflow/<id>`

## Credentials used ⚙

Names as they appear in the n8n credential dropdown. **No secrets in this ticket or in the export.**

| Credential name | Type | Used by |
| --- | --- | --- |
| … | HTTP Custom Auth | N ERP nodes |

State whether environment variables are used.

## APIs used ⚙

The ERP endpoints from Inputs, and whether any are new. Say explicitly if no new API work is
required. Then the third-party APIs reached through their n8n nodes.
