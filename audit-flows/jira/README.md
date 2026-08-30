# Jira deployment tickets — formatting, and the trap that bit VPMGOV-1633

## What went wrong

`VPMGOV-1633` (Travel Assist) was submitted with **Jira Server wiki markup** in the description:

```
h2. Business context / goal
|| Method || Endpoint || Purpose ||
| POST | /clientmgmt/contract/search/page | ... |
_Expected outcome:_ ...
```

**Jira Cloud does not interpret wiki markup.** It stores descriptions as **ADF** (Atlassian
Document Format). A wiki-markup string posted into that field is stored *verbatim as plain text*,
so the reader sees the literal characters `h2.` at the top of a paragraph and the tables render as
pipe soup on one long line.

### How to prove it in ten seconds

Read the issue back asking for ADF:

```
getJiraIssue(..., responseContentFormat: "adf")
```

- If `description` comes back as a **JSON object** `{"type":"doc","content":[…]}` → it is real
  structured content and will render.
- If it comes back as a **plain string** → it is unparsed text. Whatever markup is in it is
  decoration the reader will see literally.

`VPMGOV-1633` returns a plain string. Two other tells in its stored text: the `||…||` table rows
end in trailing double-spaces, and `~0.03` was escaped to `\~0.03` — both artefacts of markup that
was never converted.

## The rule

**Write the description as Markdown and pass `contentFormat: "markdown"`.** The Atlassian MCP
converts it to ADF on the way in. Never `h2.`, never `||`, never `{code}` — those are Server syntax.

| Want | Wiki markup (WRONG on Cloud) | Markdown (correct) |
|---|---|---|
| Heading | `h2. Title` | `## Title` |
| Bold | `*text*` | `**text**` |
| Italic | `_text_` | `*text*` |
| Table header | `\|\| A \|\| B \|\|` | `\| A \| B \|` then `\| --- \| --- \|` |
| Bullet | `* item` | `- item` |
| Code | `{code}…{code}` | ```` ```…``` ```` |

Then **read it back as ADF and confirm you got a `doc` object.** A ticket is not submitted until
that check passes — this is the one verification that would have caught it the first time.

## Where these tickets go — resolved 2026-08-30

**Project `SD` (Service Desk), issue type `n8n Flow` (id 11166).** Confirmed creatable by this
account, and its create screen carries `description`. This is the same issue type the Travel Assist
precedent uses.

The precedent ticket itself currently lives in `VPMGOV` (Visa Gov) — its Notion link `MC-1982`
redirects to `VPMGOV-1633`, so it has been moved at least once. That does not change where new ones
go, but it explains why the API reports a different project than you would expect.

Two limits apply to `VPMGOV` specifically, and both are why the precedent cannot be fixed by API:

1. **`description` is not on the edit screen** for `n8n Flow` in `VPMGOV` — `editJiraIssue` returns
   *"Field 'description' cannot be set. It is not on the appropriate screen, or unknown."* So
   `VPMGOV-1633` must be reformatted by pasting into the Jira UI editor.
2. **This account cannot create issues in `VPMGOV`** — *"You cannot create issues in this project."*
   Irrelevant now that `SD` is the target, but worth knowing if anyone tries to add to the old
   project.

There is also a project literally called **N8N Flows** (`NF`), but its issue types are
`New Workflow Request` / `Bug` / `Enhancement` — no `n8n Flow`. **It is not the target.** Recorded so
nobody re-derives it from the name.

## Files here

| File | What it is |
|---|---|
| `deploy-ticket-template.md` | The canonical 8-section template, in Markdown, with the auto-derivable sections marked |
| `VPMGOV-1633-corrected.md` | The Travel Assist body, same content, correctly formatted — paste into the Jira UI editor |
