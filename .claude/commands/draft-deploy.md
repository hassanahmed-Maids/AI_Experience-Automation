Draft the prod-deployment Jira ticket for a built audit check: **$ARGUMENTS**

Produces a ticket body on disk. **It never posts.** Posting is a human act — the operator reviews
the draft, then says to create it.

## Preconditions — refuse and say which one failed

1. The check's Notion row is at `Status = Built on n8n — Staging`.
2. `Test cases verified = YES`. The Factory's rule is *"Flow cannot go live without this."* No
   test cases → no ticket, and say so rather than drafting one that cannot ship.
3. An `n8n Staging Link` exists. A flow nobody can open is not at staging.

## Steps

1. **Read the Notion row** for `Module`, `Check type`, `Red flag means`, `Finding measure`,
   `Handles sensitive data`, `AI verifier`, `Spec Version`, `Google Sheet link`, `n8n Staging Link`.
2. **Fetch every workflow** the check uses via `get_workflow_details` with `detailLevel: "full"`.
   The payload is large and will be saved to a file — that is what you want; do not read it into
   context. A multi-stage check (MV Monthly Payment is five workflows) needs all of them.
3. **Run the extractor** over the saved file(s):
   `node audit-flows/jira/extract-flow-facts.mjs <file> [...]`
   It derives Trigger & schedule, Inputs & data sources, the route-ban check, Outputs (callback
   destinations), Attachments, Credentials, and the load skeleton. It marks everything it cannot
   know as `TODO` — never fill a TODO with a guess.
4. **Write the human sections** — Business context / goal, and the recipient half of Outputs. Take
   the business framing from `Red flag means`; it is already written in money terms.
5. **Measure the load**, or say you have not. Section 5 requires figures from a REAL run. Use
   `search_workflow_executions` for the run history. If no run exists, write
   `TODO — no measured run` rather than an estimate.
6. **Save to** `audit-flows/jira/drafts/<check-slug>.md`, using the field block and the eight
   sections from `audit-flows/jira/deploy-ticket-template.md`.
7. **Report** the draft path, and anything the extractor flagged: banned routes, a published
   workflow, a missing or stale credential, an inbound webhook.

## Field values

Project `SD` (Service Desk), issue type `n8n Flow` (11166). **Never set an assignee** — the project
auto-assigns. Full spec, including the
`Module → Company Department` mapping and the `Accountable PIL` value, is in
`audit-flows/jira/deploy-ticket-template.md`. Do not guess a required field — the mapping is
there because it is derivable, and anything not derivable is asked, not invented.

## Formatting — the thing that already went wrong once

Write the description as **Markdown**. Never Jira Server wiki markup (`h2.`, `||…||`) — Jira Cloud
stores it as unparsed plain text and the reader sees the literal characters. When the ticket is
eventually created, pass `contentFormat: "markdown"` and then read it back with
`responseContentFormat: "adf"`: a plain string means it did not convert, a `doc` object means it
did. Details in `audit-flows/jira/README.md`.

## Never

- **Never post the ticket.** Draft only, until the operator says otherwise.
- **Never put a secret in the ticket or the export** — credential *names* only.
- **Never treat a missing ERP credential as a defect.** A staging flow holds none by design; the
  deploying team creates one with a **production token**. Write it as an action. Conversely, a
  staging ERP token that *is* wired (a dated one like `ERP Token 12th Aug 2026`) is the finding —
  it must never travel to production inside an export. Where a flow writes a results workbook and
  has no Sheets credential, the credential is **Hassan Maids Account**.
- **Never omit a banned route** from Known route exceptions. Disclosure is the whole point of that
  section; `VPMGOV-1633` shipped without it and the ban and the ticket have disagreed silently since.
- **Never invent a load figure.** An unmeasured run is a TODO.
