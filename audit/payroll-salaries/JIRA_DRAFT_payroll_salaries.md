# Jira record — Housemaid Payroll and Salaries

> ✅ **FILED as [DNA-9879](https://jira-maids-cc.atlassian.net/browse/DNA-9879)**, 2026-09-15.
> The description below is the text as it now stands on the ticket.

## Fields

| Field | Value |
| --- | --- |
| **Project** | DNA |
| **Issue type** | **New Request** — file it as Abdullah filed DNA-9829; the DNA Intake Bot re-types it (Analytic Engineer Task) and splits the AI-Analyst and BI workstreams itself |
| **Summary** | Housemaid Payroll and Salaries - payroll-money audits on one Sub Dashboard - full build spec |
| **Sub Dashboard for** | Police & Control department. No parent dashboard |
| **Reporter** | Hassan Okasha (filed). Abdullah Mahdi named as requester in the body — the Reporter field is not on the DNA create screen |
| **Priority** | Not Urgent ✅ |
| **Links** | **Relates to** DNA-9829 ✅ |
| **Attachments** | `SPEC_housemaid_payroll_salaries_v2.md` — the merged spec, which carries all six child specs in full. *(Matches DNA-9829, which attached only its merged `SPEC_housemaid_visa_process_v3.md`, not the seven children separately.)* |
| **FYI comment** | Abdullah mentioned ✅, Malaz named for visibility |
| **Domain/Department** | **Payroll** — required, and the list has no Police & Control option. Stated in the body |
| **Attachment** | ⬜ **Outstanding — attach `SPEC_housemaid_payroll_salaries_v2.md` by hand** |

---

## Description — as filed

The live text is on [DNA-9879](https://jira-maids-cc.atlassian.net/browse/DNA-9879). Two structural
changes were made to the draft before and after filing:

**1. No blocking questions.** The draft ended with *"three decisions we are asking for"* — Check 5
section-or-alert, who owns the AED 1,063,646 a month, and who holds the scope boundary with DNA-9829.
**Those are Police & Control's rulings, not the data team's**, and a question addressed to DNA in a
DNA ticket is exactly what the intake bot logs as *blocking* and puts the ticket On Hold for. They are
removed from the ticket and tracked where they belong — the spec's §5, as **OX8**, **OX7** and
**OX10**.

**2. The open items are reframed as context, not questions.** The section is now headed *"Context that
changes what a number means — none of it blocks the build"* and states plainly that every open ruling
is owned by P&C, is being answered on our side, and is listed only so a number is read correctly. The
gate-state paragraph is marked *"for your planning only"*.

**The ticket now asks for exactly one thing back:** an estimate, and a view on whether the six models
are one ticket or six.

**3. All measured figures removed from the ticket.** Ruled 2026-09-15. Every population, amount, rate
and case count is out of the description, the summary and the comment; each now lives only in the
attached spec, beside the rule that produced it. The ticket says so in a standing line — *"a number
quoted away from its rule is how a wrong figure gets repeated"* — and tells the data team to size the
work from the spec rather than the page.

**What was kept, and why.** Design counts that specify the deliverable — four metric tiles per check,
the five outcome positions, six fixed verdicts, one row per maid per day, one row per case — are not
measurements and removing them would leave the build ambiguous. If the intent was to strip those too,
say so and they go.
