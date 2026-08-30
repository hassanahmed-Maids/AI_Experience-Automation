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

## Two access limits found on 2026-08-30

Both are real and both need someone with Jira admin rights:

1. **`description` is not on the edit screen for issue type `n8n Flow` in `VPMGOV`.**
   `editJiraIssue` returns *"Field 'description' cannot be set. It is not on the appropriate
   screen, or unknown."* So `VPMGOV-1633` **cannot be reformatted through the API** — it has to be
   fixed by pasting into the Jira UI editor, or by an admin adding the field to that screen.
2. **This account cannot create issues in `VPMGOV`** — *"You cannot create issues in this
   project."* 27 projects are creatable; `VPMGOV` is not one of them.

There **is** a project called **N8N Flows** (`NF`, id 10678) that is creatable, but its issue types
are `New Workflow Request` / `Bug` / `Enhancement` / `Sub-task` — no `n8n Flow` type, so it is a
different taxonomy from the VPMGOV precedent. **Which project the audit deployment tickets belong in
is an open decision**, not something to settle by picking whichever one the API allows.

## Files here

| File | What it is |
|---|---|
| `deploy-ticket-template.md` | The canonical 8-section template, in Markdown, with the auto-derivable sections marked |
| `VPMGOV-1633-corrected.md` | The Travel Assist body, same content, correctly formatted — paste into the Jira UI editor |
