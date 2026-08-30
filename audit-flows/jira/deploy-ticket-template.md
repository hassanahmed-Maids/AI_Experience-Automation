# Prod-deployment ticket template — audit flows (n8n)

Derived from `VPMGOV-1633` (Travel Assist), which established the eight sections. Content is the
same; the formatting here is Markdown so it actually renders — see `README.md` for why that matters.

**Submit with `contentFormat: "markdown"`, then read back with `responseContentFormat: "adf"` and
confirm you got a `doc` object.** Not optional.

## Ticket fields

**Target confirmed 2026-08-30:** project **Service Desk (`SD`, id 10019)**, issue type
**`n8n Flow` (id 11166)** — the same issue type the Travel Assist precedent uses, and the create
screen here **does** carry `description`. Verified creatable by this account.

| Field | Key | Req | Value |
|---|---|:--:|---|
| Project | `project` | ✔ | `SD` |
| Issue Type | `issuetype` | ✔ | `n8n Flow` (11166) |
| Summary | `summary` | ✔ | `Deploy to prod: <Check Name> (n8n, <trigger shape>)` |
| **Company Department** | `customfield_10822` | ✔ | from the check's Notion `Module` — see mapping below |
| **Accountable PIL** | `customfield_10825` | ✔ | precedent: `Amin Aljebbeh` (11099) |
| Description | `description` | | the eight sections below, **as Markdown** |
| **N8N Link** | `customfield_12033` | | the staging workflow URL — a first-class field, use it |
| Urgency | `customfield_10043` | | precedent: `Necessary and NOT urgent` (10048) |
| Show Demo | `customfield_11902` | | precedent: `No` (11908) — also the field default |
| Labels | `labels` | | `audit`, `n8n`, `prod-deployment`, `<check-slug>`, `<team-agenda-label>` |
| Priority | `priority` | | precedent left it **unset** (field default is `Not Urgent`) |

**Do not set an assignee.** The project auto-assigns; setting one fights the routing.

Left null on the precedent, so leave null unless there is a reason: `Speccer` (11769),
`Analyst` (10033), `Pending BA` (10062), `Accountable PIL Updated` (10841), all story-point fields.

### `Company Department` ← Notion `Module`

The Notion `Module` select maps 1:1 onto the required Jira field, so it is derivable, not a judgement:

| Notion `Module` | `Company Department` | id |
|---|---|---|
| Money Collection | Money Collection | 11058 |
| Money Control | Money Control | 12011 |
| Payroll | Payroll | 12012 |
| Visa | Visa Gov | 11978 |

Travel Assist is visa work but was filed **Money Control** — the department follows the *money
question*, not the subject matter. `Visa → Visa Gov` is the one row without a precedent behind it;
confirm it the first time a Visa-module check is filed.

### The label to watch

`visa_ba_aganda` on the precedent is a team-agenda label specific to that BA's board, not part of the
template. Use the agenda label for whoever receives the check; the first four labels are the constant.

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

**Scheduled, monthly** — that is the only shape that deploys (ruling, 2026-08-30). State the cadence,
the timezone, and which window each run audits, and say why the lag is deliberate. House default:
the 15th at 06:00 `Asia/Dubai`, auditing the previous full calendar month.

Then say it outright: *No webhook, no manual trigger, no inbound endpoint of any kind.*

If the flow still has a webhook trigger or an outbound callback, it is **not deployable yet** — say
what the conversion is and link the record, rather than describing the webhook as though it ships.
⚙ *(trigger node type + cron)*

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

- **Google Sheet** — the delivery mechanism. Name, row shape, tab retention, and which Drive folder
  scopes access. Credential `Hassan Maids Account` unless the check already has one wired.
- **Notification e-mail per run** — to whom, and exactly what it carries. The house pattern is check
  name, period and sheet link only: *no counts, amounts, names or case keys*, so findings stay behind
  Google permissions rather than travelling by e-mail.
- **Failure / degraded alert** — to whom, and on what condition.

**No callbacks.** A scheduled flow delivers to the workbook, not to a caller-supplied URL. If
callback nodes still exist, say they are deleted as part of the conversion.

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

Repeat the link here even though it is also in the `N8N Link` field — the field is what tooling
reads, the line is what a reader scanning the description sees.

## Credentials used ⚙

Names as they appear in the n8n credential dropdown. **No secrets in this ticket or in the export.**

| Credential name | Type | Used by |
| --- | --- | --- |
| **TO BE CREATED BY THE DEPLOYING TEAM** | HTTP Bearer / Custom Auth | N ERP nodes |
| Hassan Maids Account | Google Sheets OAuth2 | N nodes |

**The ERP credential is deliberately absent, and that is the ask.** A staging flow holds no ERP
credential; the deploying team creates one with a **production token** at deployment. Write it as an
action, never as a gap.

If a staging ERP credential *is* wired (a dated token like `ERP Token 12th Aug 2026`), say so and
ask for it to be removed or replaced — **a staging token must never travel to production inside an
export.**

Where a flow writes a results workbook, the Google Sheets credential is **Hassan Maids Account**.

State whether environment variables are used.

## APIs used ⚙

The ERP endpoints from Inputs, and whether any are new. Say explicitly if no new API work is
required. Then the third-party APIs reached through their n8n nodes.
