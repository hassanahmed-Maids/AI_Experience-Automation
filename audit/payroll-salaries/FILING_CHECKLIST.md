# Filing record — Housemaid Payroll and Salaries

## ✅ FILED — [DNA-9879](https://jira-maids-cc.atlassian.net/browse/DNA-9879)

**Filed 2026-09-15 by Hassan Okasha.** Status To Do, auto-assigned to DNA Bot for intake.

| Field | As filed |
| --- | --- |
| Project · type | DNA · ` New Request` (leading space is the real type name), matching DNA-9829 |
| Summary | Housemaid Payroll and Salaries - six payroll-money audits on one Sub Dashboard - full build spec |
| Domain/Department | **Payroll** — required field, and the list has **no Police & Control option**. Stated in the body and the comment so nobody reads it as a Payroll-owned request |
| Link | **Relates to** [DNA-9829](https://jira-maids-cc.atlassian.net/browse/DNA-9829) ✅ |
| Comment | @Abdullah Mahdi mentioned, Malaz named for visibility ✅ |

---

## Traceability — every spec now points back at the ticket

All six child specs carry a **Jira** row and an **`ON JIRA`** status in their front matter, and so does
the merged spec. A builder who opens a child spec on its own now learns three things without asking:
it has been filed, it is a **Part of one request rather than a ticket of its own**, and which of its
open items is the blocking one. Check 5 additionally carries the warning that its section is contested.

## ✅ COMPLETE — attachments landed 2026-09-15

| Attachment | Size | State |
| --- | --- | --- |
| `Housemaid Payroll Checks (5).html` | 92,860 b | ✅ current |
| `Housemaid Payroll Salaries v2 (3).md` | 343,860 b | ⚠️ **one revision behind** — see below |

⚠️ **The attached spec predates the ON JIRA stamps.** The current file is 346,099 b; the attached copy
is the version from just before the six child specs were stamped with this ticket's key and an
`ON JIRA` status. **The build content is identical** — every rule, formula, tie-out, trap and prompt is
the same. What the attached copy lacks is the traceability metadata in each child spec's front matter.
Re-attach only if that matters; nothing in the build depends on it.

Also worth knowing: the attachment filenames carry the browser's download suffixes rather than the
canonical `SPEC_housemaid_payroll_salaries_v2.md`. Rename on the ticket if that bothers anyone.

## Two things that did not go as drafted

1. **Reporter could not be set to Abdullah Mahdi.** The field is not on the DNA create screen, so the
   ticket reports as Hassan Okasha. The first line of the description names Abdullah as the requester
   and Hassan as the filer, so the record is accurate either way.
2. **Priority could not be set** to Not Urgent for the same reason. DNA-9829 carries it, so it was
   presumably set after creation — set it by hand if it matters.

---

## What to expect next, based on DNA-9829

Within roughly half an hour of filing, that ticket had been routed to Analytics Engineering under
Belal, split into an AI-Analyst workstream to run first and a BI workstream to follow, given two
blocking team questions, and put **On Hold behind another ticket**.

**Expect the same shape, and expect the hold.** DNA-9829's BI split is On Hold behind it. A second
seven-figure P&C page will likely stack the same way — worth a word with Belal directly rather than
finding out from the board.

**Do not pre-split it into six tickets.** The body asks the data team whether the six models are one
ticket or six, and says Manager Notes should go first if six. Let the intake answer it.

---

## The ticket carries NO blocking questions — deliberately

The draft ended by asking the data team three things. **All three are Police & Control rulings, not
data-team decisions**, and a question put to DNA inside a DNA ticket is precisely what the intake bot
logs as *blocking* and holds the ticket for. They were removed before the bot picked it up and are
tracked in the spec's §5 instead:

| Question | Now tracked as | Owner |
| --- | --- | --- |
| Check 5 — dashboard section, or a weekly alert? | **OX8** | Abdullah Mahdi |
| Who owns the AED 1,063,646 a month — 828 maids paid past contract end? | **OX7** | Abdullah Mahdi |
| Who holds the scope boundary with DNA-9829? | **OX10** | Abdullah Mahdi |

The open items that remain in the ticket are reframed as **context that changes what a number means**,
stated as owned by P&C and answered on our side. The ticket asks for **one** thing back: an estimate,
and a view on one ticket or six.

---

## Still open, not blocking

Whether a per-maid **loan balance** shows as an amount or a status word. Check 1 says status word,
Check 2 says ship it open. The ticket states the stricter reading applies meanwhile.

The maid's **name** is ruled in (2026-09-15) and the three child specs that carried the older rule
have been amended at source.

---

## One line to have ready

If anyone asks why there is no single "total at risk": **the money on this page is five different
kinds** — company loss, money never collected, entitlement owed to staff, pay with nobody billing for
it, and a control broken on money that was probably correct. Adding them produces a number that means
nothing, and the spec refuses it on purpose.
