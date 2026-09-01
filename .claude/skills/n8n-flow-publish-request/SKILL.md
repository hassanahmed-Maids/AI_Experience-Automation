---
name: n8n-flow-publish-request
description: >-
  Draft and file the mandated maids.cc SD (Service Desk) Jira request to publish an
  n8n non-chatbot flow to production, using Maya Ali's required template, then post it
  to Jira with the Atlassian MCP after the user has read and confirmed the draft. Use
  this skill whenever the user wants an n8n flow deployed, published, released, moved to
  production, or reviewed by Ali Hachem / the NF project — and whenever they say "draft
  the jira task", "draft a jira ticket", "raise an SD ticket", "request production
  deploy", "file this with the service desk", or ask for an enhancement or bug ticket
  against a flow that is already live. Trigger it even if they do not name Jira, the SD
  project, or the template: any request to get an n8n flow into production goes through
  this process, and a ticket missing the mandated artifacts is rejected outright. Also
  use it when asked what a flow publish request needs, or to check a draft for
  completeness before filing.
---

# n8n flow production-publish request (SD)

Every n8n non-chatbot flow reaches production through one route: an SD ticket in the
mandated template, routed SD → Technical Analyst → Project Manager → NF (Ali Hachem),
who stress-tests it and deploys. **Tickets missing artifacts are rejected**, so the
value you add here is refusing to file an incomplete one, not producing something that
looks tidy.

Two rules shape everything below:

- **The draft goes in the conversation, never in a file.** Moe reads and edits it in
  chat, then tells you to post. Writing it to a `.md` means it gets edited in the wrong
  place and pasted stale. Supporting evidence (gate checks, probe results, test output)
  does belong on disk — the *ticket body* does not.
- **Nothing is posted to Jira until the user explicitly confirms.** Filing a ticket is
  outward-facing and routes work to other people. Draft, wait, then post.

## Step 1 — Collect the artifacts before drafting

The template has required fields that cannot be invented. Get them from the flow itself
rather than asking the user to recite what the export already knows.

Ask the user to export the flow from n8n (**⋯ → Download**) — they need the `.json` for
the attachment regardless — then run:

```bash
python3 scripts/inspect_flow_export.py <path-to-export.json>
```

It reports the trigger type and schedule, credential names exactly as n8n shows them,
every outbound HTTP host and path, the sub-workflows called, the write targets, and a
starting estimate of executions per day. It also scans for anything token-shaped in the
export and refuses quietly to print it — see *Secrets* below.

If no export is available, read the flow through the n8n MCP
(`get_workflow_details`, `detailLevel: "full"`) and derive the same facts. The export is
still required as an attachment, so this is a stopgap for drafting, not a substitute.

What the script cannot know, and you must ask for:

- **Business context / goal** — the problem the flow solves and the expected outcome, in
  business terms. Not "runs a monthly audit"; what is at stake if it does not run.
- **Executions per day** — confirm or correct the script's estimate.
- **Company Department** and **Accountable PIL** — both are *required Jira fields* with
  fixed dropdowns (see *Jira field reference*). Ask if you cannot infer them; a wrong
  value routes the ticket to the wrong analyst.
- **API Requests Tasks** — if the flow calls APIs that have their own Jira tasks, link
  them; otherwise list the endpoints.

## Step 1b — The flow must stand on its own

NF deploys *a workflow*, not a workflow plus dependencies living in someone else's
project. A shared sub-workflow — an ERP lease, a common gate, a helper another team
owns — cannot travel with the export, so it either fails on the NF side or silently
couples production to a flow nobody reviewed. **Strip shared sub-workflow calls out
before drafting**, and rewire around them.

The ERP lease (`9gVijqvtLVEhQZXz`, *ERP Lease · one audit at a time*) is the usual
one. Removing it is three edits: connect the node that fed *Acquire* straight to the
node *Acquire* fed, do the same at each *Release*, drop the crash-path release, then
delete the three nodes.

Be honest with the user about what that costs. The lease exists because two audits
hitting ERP at once caused a load incident; without it, concurrency is bounded only
by the flow's own pacing and its budget gate, and nothing stops a second flow running
alongside. That is a real trade and worth one sentence — but it is the user's call,
and a self-contained flow is what the process requires.

After stripping, re-run the flow's offline tests. A rewire that silently drops a
delivery branch is the kind of thing that only shows up in production.

## Step 2 — Draft in the mandated template

The authority for this template is Maya Ali's email, reproduced verbatim in
`references/mandate-email.md`. Read it if anything below looks ambiguous — where
the two disagree, the email wins.

Use these headings and this order, with the email's own wording. Reviewers scan
for them, and a renamed or reordered section reads as a missing artifact.

```
**Summary:** Publish n8n flow: <flow name>

**Project:** SD (Service Desk) · **Issue type:** n8n Flow
**Company Department:** <dropdown value> · **Accountable PIL:** <dropdown value>

### Business Context/Goal
<What problem the flow solves and the expected outcome.>

### Trigger & Schedule
<manual / webhook / scheduled, and when it runs.>

### Inputs & Data Sources
<DBs, files, etc...>

### Outputs & Recipients
<systems updated, notifications sent, actions taken.>

### Expected Number of Executions per day
<estimate, with the reasoning behind it>

### Attachments
- n8n flow export (.json) — <filename, and whether it is attached yet>
- n8n workflow link — <url>
- List of environment variables / credentials used — <credential NAMES only, exactly
  as they appear in the dropdown menu in n8n>

### APIs Used
<link the API Requests Tasks, or list them>
```

Guidance per section — the point of each, so you can judge what belongs:

- **Business Context/Goal** — business terms, not mechanics. Not "runs a monthly
  audit"; what is at stake if it does not run.
- **Trigger & Schedule** — if the flow ships with its trigger disabled, say so and
  say why. NF needs to know whether deploying it starts anything.
- **Inputs & Data Sources** — name systems, not node names.
- **Outputs & Recipients** — be precise about whether a message is *sent* or left
  as a *draft*, and who receives it. This is the section a reviewer uses to size
  blast radius.
- **Expected Number of Executions per day** — a number with reasoning. For a
  monthly flow, say so and give the per-day equivalent rather than leaving it blank.
- **Attachments** — the three bullets are the email's own list; keep all three even
  when one is outstanding, and mark which. **The Atlassian MCP cannot upload
  files**, so the `.json` has to be attached by hand after the issue exists. Say
  that plainly rather than letting the user assume it happened.
- **APIs Used** — link the API Requests Tasks where they exist; otherwise list
  method + path per endpoint, and the read/write character of each. Reviewers weigh
  a write far more heavily than a read.

### Keep run details out of the ticket

The ticket describes **what the flow is and does** — the template's fields, nothing
more. It is not a test report. Leave out execution IDs, run counts, findings tallies,
per-run figures, sample records, entity identifiers and money amounts observed in
actual runs. Three reasons, and they compound:

- SD tickets are widely readable, and real run output can carry personal or financial
  data about real people. That is a disclosure, not a detail.
- Live figures date immediately. A reviewer reading last month's counts learns
  nothing about the flow they are being asked to deploy.
- It buries the mandated fields under narrative, and a reviewer scanning for
  artifacts is likelier to call one missing.

State capability and design, not results: *"flags duplicate government fees for the
same maid"*, not *"found 1 finding and 105 pending across 704 charges in run 110690"*.
Evidence of testing belongs on disk and in the review conversation; if a reviewer
asks for it, send it to them directly.

### Secrets

The email is explicit: *do NOT paste secrets in JIRA, just write the name of the
credentials you're using as it appears in the dropdown menu in n8n*. Never put a
token, password, key, connection string or bearer value in a Jira field, a draft,
or a filename — a Jira ticket is readable by far more people than the flow is. If
the export contains an embedded secret, tell the user which node holds it so they
can move it into a credential, and do not reproduce the value.

### When artifacts are missing

*Tickets missing artifacts will be rejected* — the email says so, so a rejected
ticket costs a full routing cycle. Draft what you have, list the gaps explicitly
under the section they belong to, say plainly that it will bounce as it stands, and
let the user decide whether to file anyway. An honest gap list is worth more than a
tidy ticket that comes back.

## Step 3 — Confirm, then post

Present the draft and ask for a go-ahead. Treat edits as edits: re-show the changed
sections rather than the whole thing again.

Once the user confirms, create the issue:

```
mcp__Atlassian_Rovo__createJiraIssue
  cloudId: a38da618-d029-4fe6-a151-171c834db5b7
  projectKey: SD
  issueTypeName: n8n Flow
  summary: <the summary line>
  description: <the body, markdown>
  additional_fields: {
    "customfield_10822": { "id": "<Company Department option id>" },
    "customfield_10825": { "id": "<Accountable PIL option id>" }
  }
```

Then report back with:

- the issue key and a clickable URL (`https://jira-maids-cc.atlassian.net/browse/<KEY>`);
- **the attachment reminder** — the `.json` export still has to be attached by hand, and
  the email says missing artifacts get the ticket rejected;
- anything the user still owes the ticket.

If the flow's status lives somewhere else too — a Notion check page, a build log — offer
to update it with the Jira link rather than doing it unasked.

### Enhancements and bugs on a flow already live

Same template, same route: a **new** SD ticket, linked to the original. Do not reopen or
edit the deployed flow's ticket. Say what changed and why in Business Context, and use
`createIssueLink` (`Relates`) to tie it to the original once created. This includes API
failures and technical issues, not only feature changes.

## Jira field reference

Site: `jira-maids-cc.atlassian.net` · cloudId `a38da618-d029-4fe6-a151-171c834db5b7`
Project **SD** (id 10019) · issue type **n8n Flow** (id 11166).

Required fields beyond project/type/summary — both are single-select, and a value not on
the list is rejected by Jira, so read the live list rather than guessing:

| Field | Key | How to get the options |
|---|---|---|
| Company Department | `customfield_10822` | `getJiraIssueTypeMetaWithFields` on SD / 11166 |
| Accountable PIL | `customfield_10825` | same call |

Frequently used **Company Department** values for this team's flows: `Visa Gov`,
`Visa CX`, `Money Control`, `Money Collection`, `Payroll`, `CC HM Management`,
`MV HM Management`, `Journey AI`, `LLM Applications`. Confirm against the live list —
options are added over time, and the ones here are a shortlist, not the whole set.

**Accountable PIL** is a person, and it decides who is answerable for the flow in
production. Ask rather than inferring it from who happens to be running the session.

The routing after filing is not yours to drive: SD → Technical Analyst (business logic
and conflicts) → PM (hands off to NF) → NF / Ali Hachem (stress test, infinite-loop
check, security validation, deploy). NF then adds a read-only production mirror link to
its own ticket. Set that expectation instead of implying the flow goes live on filing.
