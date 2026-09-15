# Jira draft — Housemaid Payroll and Salaries

## Fields

| Field | Value |
| --- | --- |
| **Project** | DNA |
| **Issue type** | **New Request** — file it as Abdullah filed DNA-9829; the DNA Intake Bot re-types it (Analytic Engineer Task) and splits the AI-Analyst and BI workstreams itself |
| **Summary** | Housemaid Payroll and Salaries - five payroll-money audits on one report - full build spec |
| **Reporter** | Abdullah Mahdi, Police & Control |
| **Priority** | Not Urgent *(same as DNA-9829)* |
| **Links** | **Relates to** DNA-9829 — sibling page, same house template, two live scope cross-references |
| **Attachments** | `SPEC_housemaid_payroll_salaries_v1.md` |
| **FYI comment** | @Malaz Allool, as on DNA-9829 |

---

## Description

We pay every housemaid by rule, not by negotiation, and at five points in her pay there is money
that can leave wrongly or fail to come back. Police & Control audits all five by hand today. This
builds them as one report.

The spec is written. It carries, for every check: the population, the rules, the metric formulas,
the tie-out identities, the worked examples, and the traps that produce wrong numbers if they are
missed. **Read the gate note below before planning — unlike DNA-9829, parts of this one still need
answers, and they are listed.**

Spec: attached below
Report mockup: [Artifact](https://claude.ai/artifact/Y3NbLkqBagbjeVpqagTvpp)

The five checks, in the order money moves through her pay:

1. Salary Components - the MOHRE wage and the accommodation amount are fixed by her nationality
  and whether she lives in. This finds the maids whose numbers do not match the rule.
  Measured: AED 15,342 a month paid above the rule across 39 maids, and AED 375,856 a month paid
  below it across 1,365. Only the first is a company loss.
2. Salary Raises and MV Margin - a CC maid's salary may only rise by a route the company defined;
  an MV maid's pay must match the worker salary her client agreed.
  Measured: AED 2,150 a month of CC raises with nothing authorising them, rising to AED 5,400 if
  the seven unread raises survive the read; AED 500 a month of MV margin we fund ourselves; and
  AED 202,019 a month paid above the group standard, which is visible but not recoverable.
3. Expense - Loan Charged - money the company spends on a maid should land on her balance as a
  loan. Measured: AED 137,510.33 over 564 cases where no loan was raised and none is on her
  ledger, plus AED 4,694.24 over 11 where a loan was typed on the expense and never posted.
4. Loan Repayment - the debt should come back out of her salary. Measured for August 2026:
  1,214 maid-months where we paid her, she still owed, and nothing was taken - AED 215,390 owed,
  AED 142,414 collectable after both caps. MV is the larger half and no check has ever looked at it.
5. With Client, No Contract - she is in a client's home, we are paying her, and nothing is billing
  him. Measured: 2 cases, AED 3,500. See the scope question below - this one is contested.

A sixth section, Manager Notes, is reserved in the spec. Its child spec has not been written yet.

All figures above are measured in Snowflake, not estimated, and the spec shows the query behind
each one.

WHAT TO BUILD

1. The five data models in Snowflake, one per check, at the grain the spec states for each.
  Everything reads BA_VIEWS with two exceptions that are NOT ingestion requests and must not be
  filed as such: Salary Components compares against a rate table hand-transcribed from the ERP
  salary-rule screen, which goes stale silently and needs re-transcribing quarterly; and With
  Client, No Contract needs a new daily snapshot table that this build creates and writes, one
  row per maid per day, because its central question - how long has she been this way - cannot be
  answered by any table that exists today.
2. The tie-out identities as build-time assertions. Every check has one, and a failed identity
  blocks that check's section rather than printing a number nobody can trust. Build the residue
  control with them: measure every bucket with its own positive predicate AND count the rows
  matching no bucket and require zero. Salary Components carries this scar twice - a balancing
  identity once hid 106 maids in the wrong bucket, and a later draft left 27 maids in no bucket at
  all while both identities still summed correctly.
3. Three AI verifiers, on checks 2, 3 and 4. Each reads the complaint threads and staff notes
  around a case and returns one of six fixed verdicts with a redacted quote. The prompts are in
  the spec, verbatim, ready to send. Check 2 runs a second agent that marks the first one's answer
  against six checks and never overwrites it - disagreements go to the officer. Checks 3 and 4 run
  a single reader. Checks 1 and 5 have no verifier, by design: their questions are arithmetic and a
  clock, and no note changes either.
4. The report itself: one scrolling page, five sections and a reserved sixth, four metric tiles and
  one exception table per check, four tabs per table (Not recovered is split here into Paid too
  much / Not collected / Nobody billed, plus Needs review), rows red or yellow only. The mockup is
  built on the DNA-9829 template with the stylesheet unchanged.

WHAT WE ARE NOT ASKING FOR

No scheduled run against the ERP. This is a monthly on-demand report, handed to DNA precisely
because a standing data process belongs with the data team and not in an analyst's ad hoc queries.

No total for the page. The money here is four different kinds - company loss, money never
collected, entitlement owed to staff, and pay with nobody billing for it. A single at-risk figure
would add AED 375,856 of staff underpayment to AED 15,342 of overpayment and call the sum exposure.
The spec refuses it on purpose; please do not add one back.

No reviewed/unreviewed filter and no status write-back. Nothing stores a review state and no check
writes anything back, so a case already actioned reappears until the underlying fact changes. That
is intended. A status column would turn the deliverable from a dashboard into an application.

No trending or backfilling of Loan Repayment. Its ledger records how much of a loan was repaid but
not when, so every past month looks better than it was and how much better depends only on how long
ago it was. Run the latest closed month and stop.

GATE STATE - READ BEFORE ESTIMATING

This is where this ticket differs from DNA-9829, and we would rather say it than have it found.

Of the five child specs, one was put through the adversarial spec-auditor gate and had all eight of
its findings fixed; one was gated in part; three were never gated. One of those three published two
wrong headline numbers before anyone caught it - 116 cases, then 5, then 2 - and the error was found
from a single ERP screenshot, not from the data. The merged document has not been gated at all.

The figures in this ticket are the measured ones and we stand behind them. The rules around some of
them still have open questions, and twelve of those exist only because the five checks were put on
one page. The ones that affect the build:

- IS_TRANSFERRED decides who is in scope for three of the five checks, and one verifier run found a
  case where the flag says we paid her and staff wrote that we had not. One answer settles all three.
- The three checks that read the loan ledger dedupe it three different ways, and the date column is
  identical across the duplicate rows, so any date-based tie-break picks at random. The spec states
  one rule; it needs confirming before first run.
- Checks 3 and 4 are two halves of one pipeline and the same defect breaks both: a waiver granted in
  a complaint thread never reaches the ledger. Check 3 reports a loan that was deliberately not
  raised; Check 4 chases a debt that no longer exists. How many of its 1,214 findings are already
  waived is unmeasured. Already with the dev team as PAY-4416, closed Not a Defect.
- Terminated maids are excluded by three checks and deliberately kept by the fourth, both on P&C's
  own ruling. One of them has to give.
- Check 1's audited MOHRE wage is Check 4's wage-floor input, and Check 1 says that input is wrong
  on 21% of the CC population.
- The report shows an individual maid's pay, balance and deduction limit, so it is restricted to
  Police & Control and Payroll. Two of the child specs hold opposite rulings on whether per-maid
  amounts may be shown at all, and neither carries the named approval company policy asks for. The
  spec applies the stricter rule meanwhile.

None of these stops the models being built. All of them change what a number means, so we would
rather they were on the table at estimate time.

WHAT WE NEED BACK

An estimate, and a view on whether the five models are one ticket or five.

Three decisions we are asking for rather than assuming:

1. With Client, No Contract - its own author recommends NOT building it as a dashboard. Two
  findings, AED 3,500, in a population of 5,558, where the median untagged maid is re-tagged within
  a day, and a weekly one-line alert would deliver the same value. It is in the spec because it is
  in the family. Build it as a section, or drop it to an alert?
2. The biggest number in this family has no check and no owner: 828 maids paid long after their
  contract ended - AED 33,733,598 to date and AED 1,063,646 a month still running. Found while
  answering a scope question inside check 2 and recorded there as needing an owner outside that
  spec. It is two orders of magnitude above everything on this page. Does it become a sixth check
  here, or go somewhere else?
3. Two codes in check 3 are excluded because other checks own them, and one of those checks is
  Change of Status - part 3 of DNA-9829. A scope change on either page silently opens or closes a
  gap in the other. Who holds that boundary?

Police & Control will answer any question on the rules; every one of them has a named owner and a
measured figure behind it.
