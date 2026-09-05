# Filing these two tickets

Four files. File Ticket 1 first, then Ticket 2 with the AE key filled in.

| File | Goes where |
| --- | --- |
| `TICKET-1-AE-manager-notes-audit.md` | New DNA ticket, type **`Analytic Engineer Task`** |
| `DNA_ATTACHMENT_source_tables.md` | Attachment on Ticket 1 |
| `SPEC_manager_notes_audit_DEV.md` | Attachment on Ticket 1 |
| `SPEC_manager_notes_audit_v2.md` | Attachment on Ticket 1, for the record |
| `TICKET-2-BI-manager-notes-audit-dashboard.md` | New DNA ticket, type **`BI Visualization Task`** |

Everything below the `---` in each ticket file is the Jira description. The block above it is
issue type and routing — set those in the fields, don't paste them.

## Set the issue type yourself

Jira automation re-types new tickets to " New Request" on creation — it happened twice to DNA-9454
within a second of filing. The intake bot then recommends the correct type and re-types it. Setting
it correctly up front saves a round trip and gets the right playbook applied first time.

- Ticket 1 → `Analytic Engineer Task` ("Snowflake data model creation (silver/gold layers)")
- Ticket 2 → `BI Visualization Task`

## Link them

Ticket 1 **blocks** Ticket 2. The bot does this automatically when it splits a combo ticket, but
filing them pre-split with the link set is cleaner and keeps the AE work visibly first.

## Priority is the thing that actually matters

Every P&C ticket currently in DNA sits at **Not Urgent**, and none has moved:

| Key | Filed | Status now |
| --- | --- | --- |
| DNA-9437 | 2026-09-03 | To Do — **no activity since creation** |
| DNA-9446 | 2026-09-03 | To Do |
| DNA-9449 | 2026-09-03 | To Do |
| DNA-9454 | 2026-09-03 | To Do (triaged, assigned, parented to epic DNA-288) |
| DNA-9455 | 2026-09-03 | On-Hold, correctly blocked by DNA-9454 |

None is blocked on missing information — all were graded *Ready to start* by the intake bot. They
are simply queued at the lowest priority in the scheme. **A fifth Not Urgent ticket from the same
requester will queue behind the other four.** If this audit is wanted this quarter, the conversation
to have is with Belal Alsayed (AE) and Walid Al Kassar (DE) about priority, not about the ticket.

## Escalate DNA-9437 separately, and first

It is two SQL statements, it has had zero activity since it was created, and it gates the
verification behind *Done when* 1, 2 and 8 on Ticket 1 — the grain check, the population size and
the note-type check. Without it those criteria cannot be evidenced by either side.

## Two things to decide before filing

**Write-back.** Ticket 2's status column is a write, which makes the dashboard a small application.
In or out for the first release? The intake bot will raise it as a manager gap and answer it with an
assumption if you leave it blank.

**Where the page lives.** A new route under a Police & Control parent, or its own top-level route.
Ticket 2 says it is deliberately *not* a section on the existing Payroll Dashboard, and asks BI to
name the placement — but if you already know, say it and remove the question.

## What the intake bot will do

Within ~10 minutes of filing it will attach a filled playbook, recommend a type, route to a manager,
and post any `[MISSING → manager: …]` gaps with an assumption stated on your behalf. Expect it to
flag the mockup link: **a Claude artifact URL is not readable by the bot** — on DNA-9454 it recorded
*"[UNVERIFIED — link not readable by the bot]"* and fell back to the description. That is why
Ticket 2 restates the whole layout in the description rather than relying on the link.
