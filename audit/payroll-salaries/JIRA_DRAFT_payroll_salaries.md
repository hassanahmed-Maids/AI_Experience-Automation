# Jira draft — Housemaid Payroll and Salaries

## Fields

| Field | Value |
| --- | --- |
| **Project** | DNA |
| **Issue type** | **New Request** — file it as Abdullah filed DNA-9829; the DNA Intake Bot re-types it (Analytic Engineer Task) and splits the AI-Analyst and BI workstreams itself |
| **Summary** | Housemaid Payroll and Salaries - six payroll-money audits on one Sub Dashboard - full build spec |
| **Reporter** | Abdullah Mahdi, Police & Control |
| **Priority** | Not Urgent *(same as DNA-9829)* |
| **Links** | **Relates to** DNA-9829 — sibling page, same house template, two live scope cross-references |
| **Attachments** | `SPEC_housemaid_payroll_salaries_v2.md` — the merged spec, which carries all six child specs in full. *(Matches DNA-9829, which attached only its merged `SPEC_housemaid_visa_process_v3.md`, not the seven children separately.)* |
| **FYI comment** | @Malaz Allool, as on DNA-9829 |

---

## Description

We pay every housemaid by rule, not by negotiation, and at six points in her pay there is money that
can leave wrongly or fail to come back. Police & Control audits all six by hand today. This builds
them as one **Sub Dashboard**.

The spec is written. It carries, for every check: the population, the rules, the metric formulas, the
tie-out identities, the worked examples, and the traps that produce wrong numbers if they are missed.
**Read the gate note below before planning — unlike DNA-9829, parts of this one still need answers,
and they are listed. One of the six is ready to build today.**

Spec: attached below
Report mockup: [Housemaid Payroll Checks](https://claude.ai/artifact/Y3NbLkqBagbjeVpqagTvpp)

WHAT WE ARE REQUESTING

**A Sub Dashboard**, not a standalone report. One scrolling page, six sections, sitting under the
Police & Control dashboard family alongside the Housemaid Visa Process page from DNA-9829. It uses
the same stylesheet and the same tile / switch / table anatomy as that page, so the two read as one
system. *(Confirm the parent it should hang under — we have assumed the same parent as DNA-9829.)*

The six checks, in the order money moves through her pay:

1. Salary Components - the MOHRE wage and the accommodation amount are fixed by her nationality and
  whether she lives in. This finds the maids whose numbers do not match the rule.
  Measured: AED 15,342 a month paid above the rule across 39 maids, and AED 375,856 a month paid
  below it across 1,365. Only the first is a company loss.
2. Salary Raises and MV Margin - a CC maid's salary may only rise by a route the company defined; an
  MV maid's pay must match the worker salary her client agreed.
  Measured: AED 2,150 a month of CC raises with nothing authorising them, rising to AED 5,400 if the
  seven unread raises survive the read; AED 500 a month of MV margin we fund ourselves; and AED
  202,019 a month paid above the group standard, which is visible but not recoverable.
3. Expense - Loan Charged - money the company spends on a maid should land on her balance as a loan.
  Measured: AED 137,510.33 over 564 cases where no loan was raised and none is on her ledger, plus
  AED 4,694.24 over 11 where a loan was typed on the expense and never posted.
4. Loan Repayment - the debt should come back out of her salary. Measured for August 2026: 1,214
  maid-months where we paid her, she still owed, and nothing was taken - AED 215,390 owed, AED
  142,414 collectable after both caps. MV is the larger half and no check has ever looked at it.
5. With Client, No Contract - she is in a client's home, we are paying her, and nothing is billing
  him. Measured: 2 cases, AED 3,500. See the scope question below - this one is contested.
6. Manager Notes - every line added to her payslip outside her salary should trace to a rule that
  entitled her to that amount on that day. 24 payment types, AED 6,851,419 in a rolling twelve
  months. Measured: AED 30,441 of additions nothing entitled her to, across eleven rules, plus AED
  16,626 where a control was bypassed on money that was probably owed. Grain is one row per NOTE,
  not per maid. **This is the only one of the six with no blocking open item.**

All figures above are measured in Snowflake, not estimated, and the spec shows the query behind each
one.

WHAT TO BUILD

1. The six data models in Snowflake, one per check, at the grain the spec states for each - and note
  that check 6's grain is a note, not a maid, while the others are maids, maid-months or expense
  items. Everything reads BA_VIEWS with two exceptions that are NOT ingestion requests and must not
  be filed as such: Salary Components compares against a rate table hand-transcribed from the ERP
  salary-rule screen, which goes stale silently and needs re-transcribing quarterly; and With Client,
  No Contract needs a new daily snapshot table that this build creates and writes, one row per maid
  per day, because its central question - how long has she been this way - cannot be answered by any
  table that exists today.
2. The tie-out identities as build-time assertions. Every check has one, and a failed identity blocks
  that check's section rather than printing a number nobody can trust. Build the residue control with
  them: measure every bucket with its own positive predicate AND count the rows matching no bucket
  and require zero. Two identities bind across checks - no check may count a subset of another, and
  no figure may be a sum of tests. Both have already caught real errors in this family.
3. Four AI verifiers, on checks 2, 3, 4 and 6. Each reads the written record around a case and
  returns one of six fixed verdicts with a redacted quote. The prompts are in the spec, verbatim,
  ready to send. Check 2 runs a second agent that marks the first one's answer against six checks and
  never overwrites it. Checks 1 and 5 have no verifier by design: their questions are arithmetic and
  a clock, and no note changes either.
4. The Sub Dashboard itself: one scrolling page, six sections, four metric tiles and one exception
  table per check, rows red, yellow or grey only. Green rows are not displayed; cleared cases live in
  the counts. Checks 1 to 5 navigate by outcome - five tabs (Paid too much / Not collected / Nobody
  billed / Control bypassed / Needs review), each check showing only the ones that apply to it.
5. Check 6 navigates differently and the mockup shows it working. It audits 24 payment types under
  eleven rules, and an officer works it by payment type, because that is the unit a rule and an owner
  attach to. So it carries a tab per payment type with a red-case count on each, plus ONE filter bar
  - outcome, route, transferred, department - shared by every tab, whose state persists when the
  officer moves between tabs. Four things about it are requirements rather than styling:
  - Types with money but no red still get a tab showing a zero. Their money is untested, not clean,
    and a type that disappears from the tab row reads as a type that passed.
  - The cross-type check gets its own tab. "Note exceeds its approved request" fires on any type
    carrying an expense request, so filing it under one type would be a guess printed as a fact.
  - The tab counts respond to route, transferred and department, but NOT to the outcome filter. A
    badge answers "how much red is in this type". If it moved with the outcome view, every badge
    would read zero while the officer was looking at Control bypassed - the signal would vanish
    exactly when it is needed to decide where to go next.
  - An empty table says so in words: "an empty result is not a clean result". A filter combination
    with no rows looks identical to a type with nothing wrong in it.

THE ONE THING WE MOST NEED YOU NOT TO GET WRONG

**Grey is not green.** Check 6 leaves roughly AED 962,000 across four payment types completely
untested - not because they passed, but because no entitlement rule exists to test them against. The
largest is the Bonus head, which carries at least seven different purposes and has an authorised
amount for only two of them. Those rows must render grey and say "no rule exists to test this". A
type with no rule is not a clean type, and a page that shows it as clean is worse than no page.

ONE THING IN CHECK 6 WE HAVE NOT RECONCILED, AND DO NOT WANT RECONCILED QUIETLY

Its own check table counts notes on most rules, maids on two of them and groups on a third, against a
stated grain of one row per note. So the case counts are not all counts of the same thing. The mockup
prints the spec's numbers as they stand and names the mismatch on the page. Please do the same rather
than picking a unit and making the columns agree - if it needs settling, it is a spec decision and
Police & Control will make it.

WHAT WE ARE NOT ASKING FOR

No scheduled run against the ERP. This is a monthly on-demand report, handed to DNA precisely because
a standing data process belongs with the data team and not in an analyst's ad hoc queries. Check 6 is
the exception in one direction only: it reads live data in whatever window the user picks, which is
why its rules may never be expressed as a share of the displayed window.

No total for the page. The money here is five different kinds - company loss, money never collected,
entitlement owed to staff, pay with nobody billing for it, and a control broken on money that was
probably correct. A single at-risk figure would add AED 375,856 of staff underpayment to AED 15,342
of overpayment and AED 16,626 of process failures and call the sum exposure. The spec refuses it on
purpose; please do not add one back.

No reviewed/unreviewed filter and no status write-back. Nothing stores a review state and no check
writes anything back, so a case already actioned reappears until the underlying fact changes. A
status column would turn the deliverable from a dashboard into an application.

No trending or backfilling of Loan Repayment. Its ledger records how much of a loan was repaid but
not when, so every past month looks better than it was and how much better depends only on how long
ago it was.

GATE STATE - READ BEFORE ESTIMATING

This is where this ticket differs from DNA-9829, and we would rather say it than have it found.

Of the six child specs, one was put through the adversarial spec-auditor gate and had all eight of
its findings fixed; one was gated in part; four were never gated. One of those four published two
wrong headline numbers before anyone caught it - 116 cases, then 5, then 2 - and the error was found
from a single ERP screenshot, not from the data. The merged document has not been gated at all.

**Check 6 is nevertheless ready to build, and it is the sensible first delivery.** It has no blocking
open item, it is the largest by money examined, it carries eleven rules rather than one, and over its
life it has withdrawn AED 222,228 across twelve retractions against AED 30,441 standing - seven
dirhams retracted for every one that survived, every one found before publication rather than after.

The figures in this ticket are the measured ones and we stand behind them. The rules around some of
them still have open questions, and sixteen of those exist only because the six checks were put on
one page. The ones that affect the build:

- Four checks depend on whether a maid was actually paid, and there are three incompatible readings
  of what "paid" means in the warehouse. Check 6 measured the transfer flag across all 24 payment
  types and found it tracks termination, not payment - which contradicts how two other checks use it.
  One answer settles four checks.
- Two checks read the same manager-action rows for the same incentive and key on different date
  columns, one of which check 6 states is caller-supplied and never re-stamped.
- The three checks that read the loan ledger dedupe it three different ways, and the date column is
  identical across the duplicate rows, so any date-based tie-break picks at random.
- Checks 3 and 4 are two halves of one pipeline and the same defect breaks both: a waiver granted in
  a complaint thread never reaches the ledger. Already with the dev team as PAY-4416, closed Not a
  Defect.
- Terminated maids are excluded by three checks and deliberately kept by the fourth, both on P&C's
  own ruling - and check 6 shows the termination date is never cleared on re-hire, so "terminated" is
  not even a stable fact.
- Check 1's audited MOHRE wage is check 4's wage-floor input, and check 1 says that input is wrong on
  21% of the CC population.
- Nothing on this page audits whether a deduction was correct. Additions are audited eleven ways;
  deductions only in one direction, and the amount never.
- The report shows an individual maid's name, pay, balance, deduction limit and every extra payment
  she received, so it is restricted to Police & Control and Payroll. The name column is ruled in by
  Police & Control; three child specs carry an older rule against it and need a one-line amendment
  each. What is still unsettled is narrower - whether a per-maid loan BALANCE may be shown as an
  amount rather than a status word. The spec applies the stricter reading meanwhile.

One of these is already closed by the merge rather than opened by it: check 6 establishes that
HOUSEMAID_MANAGER_NOTES.EXPENSE_ID points at the expense-request id space, which answers an open item
the GCC Payment Checker spec has been carrying.

None of these stops the models being built. All of them change what a number means, so we would
rather they were on the table at estimate time.

WHAT WE NEED BACK

An estimate, and a view on whether the six models are one ticket or six. If they are six, we would
take Manager Notes first - it is the only one with nothing blocking it.

Three decisions we are asking for rather than assuming:

1. With Client, No Contract - its own author recommends NOT building it as a dashboard. Two findings,
  AED 3,500, in a population of 5,558, where the median untagged maid is re-tagged within a day, and
  a weekly one-line alert would deliver the same value. Build it as a section, or drop it to an
  alert?
2. The biggest number in this family has no check and no owner: 828 maids paid long after their
  contract ended - AED 33,733,598 to date and AED 1,063,646 a month still running. Found while
  answering a scope question inside check 2 and recorded there as needing an owner outside that spec.
  It is two orders of magnitude above everything on this page. Does it become a seventh check here,
  or go somewhere else?
3. Two codes in check 3 are excluded because other checks own them, and one of those checks is Change
  of Status - part 3 of DNA-9829. A scope change on either page silently opens or closes a gap in the
  other. Who holds that boundary?

Police & Control will answer any question on the rules; every one of them has a named owner and a
measured figure behind it.
