# Filing checklist — Housemaid Payroll and Salaries

**Status: ready to file, pending one answer.** Everything below is prepared; the only thing missing is
the parent the Sub Dashboard hangs under.

---

## Before you press create

| # | Item | State |
| --- | --- | --- |
| 1 | **Which dashboard is the parent?** The ticket asks for a **Sub Dashboard** and currently assumes the same parent as DNA-9829 (the Police & Control family). If that is wrong the request lands in the wrong place | ⬜ **Needed from you** |
| 2 | Spec attached — `SPEC_housemaid_payroll_salaries_v2.md`, carrying all six child specs in full | ✅ Ready |
| 3 | Mockup linked — [Housemaid Payroll Checks](https://claude.ai/artifact/Y3NbLkqBagbjeVpqagTvpp) | ✅ Live |
| 4 | Mockup shared with maids.cc, as Abdullah did on DNA-9829 after Ammar could not open it | ⬜ **Check the share setting before filing** |
| 5 | Name-column ruling written into the three child specs that contradicted it | ✅ Done |
| 6 | Per-maid **loan balance** — amount or status word? Check 1 says status word, Check 2 says ship it open | ⬜ Open, **does not block filing** — the ticket states the stricter reading applies meanwhile |

---

## How to file

**File as Abdullah filed DNA-9829** — as a **New Request** in DNA, reporter Abdullah Mahdi, priority
Not Urgent. The DNA Intake Bot re-types it to *Analytic Engineer Task* and splits the AI-Analyst and
BI workstreams itself; do not pre-split it.

1. Create the New Request in **DNA** with the summary and description from `JIRA_DRAFT_payroll_salaries.md`.
2. Attach `SPEC_housemaid_payroll_salaries_v2.md`.
3. Link **Relates to → DNA-9829**.
4. Comment `@Malaz Allool FYI`, matching DNA-9829.
5. Confirm the artifact link opens for someone other than you.

**Do not open separate tickets per check.** The ticket asks the data team whether the six models are
one ticket or six, and DNA-9829's own intake answered that question itself. Let it.

---

## What to expect back, based on DNA-9829

That ticket was filed 2026-09-14 and within an hour the intake bot had: routed it to Analytics
Engineering under Belal, split off an AI-Analyst workstream to run first and a BI workstream to follow,
raised two blocking team questions, and put the whole thing **On Hold behind DNA-9830**.

**Expect the same shape, and expect the hold.** Its BI split (DNA-9831) is On Hold behind it. If this
lands as a second seven-figure P&C page in the same queue it will likely stack the same way — which is
worth raising with Belal directly rather than discovering from the board.

---

## The three questions the ticket asks, so you are not surprised by them

1. **Check 5 — section or alert?** Its own author recommends against a dashboard: 2 findings, AED 3,500,
   in a population of 5,558 where the median untagged maid is re-tagged within a day.
2. **Who owns the AED 1,063,646 a month?** 828 maids paid past their contract end, AED 33.7m to date.
   Found inside Check 2, owned by nobody, two orders of magnitude above everything on the page.
3. **Who holds the scope boundary with DNA-9829?** Check 3 excludes two codes because Change of Status
   and the GCC checker own them.

---

## One line to have ready

If anyone asks why there is no single "total at risk" figure: **the money on this page is five
different kinds** — company loss, money never collected, entitlement owed to staff, pay with nobody
billing for it, and a control broken on money that was probably correct. Adding them produces a number
that means nothing, and the spec refuses it on purpose.
