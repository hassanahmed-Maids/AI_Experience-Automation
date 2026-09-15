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

## ⬜ ONE THING LEFT, AND IT MATTERS

**Attach `SPEC_housemaid_payroll_salaries_v2.md` to DNA-9879 by hand.** The Jira API available here
cannot upload files. The ticket body is a summary; **every formula, tie-out identity, trap and
verifier prompt lives in the 344 KB spec**, and the take should not start without it. The comment on
the ticket says so in those words.

**Also worth doing before anyone picks it up:** confirm the mockup link opens for someone other than
you. On DNA-9829 the assignee could not open it and had to ask Abdullah, who had already shared it
with everyone at maids.cc.

---

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

## The three questions the ticket asks

1. **Check 5 — section or alert?** Its own author recommends against a dashboard: 2 findings,
   AED 3,500, in a population of 5,558 where the median untagged maid is re-tagged within a day.
2. **Who owns the AED 1,063,646 a month?** 828 maids paid past their contract end, AED 33.7m to date.
   Found inside Check 2, owned by nobody, two orders of magnitude above everything on the page.
3. **Who holds the scope boundary with DNA-9829?** Check 3 excludes two codes because Change of
   Status and the GCC checker own them.

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
