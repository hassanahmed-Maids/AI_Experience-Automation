# Filing pack — Manager Notes Audit

Everything that has to reach somebody else before this audit can run. Grouped by **who receives
it**, so each conversation is one list.

Compiled 2026-09-07 from `SPEC_manager_notes_audit_v2` §6 (O1–O21) and §7 (Q1–Q12).

---

## Do these three first

They unblock more than everything else combined, and none of them is engineering work.

| # | What | To | Unblocks |
| --- | --- | --- | --- |
| 1 | **Two Snowflake grants** — a warehouse, and SELECT on the expense view | Data platform | Every query. Nothing has ever run |
| 2 | **Escalate DNA-9437** | Belal Alsayed | Two SQL statements, zero activity since 3 Sep, gates three of Ticket 1's acceptance criteria |
| 3 | **Priority conversation, not a ticket** | Belal Alsayed (AE), Walid Al Kassar (DE) | Five P&C tickets sit at *Not Urgent* with no movement. A sixth queues behind them |

---

## 1 · Data platform — access

**Two grants, not one.** Verified 2026-09-07: `SHOW WAREHOUSES` returns **zero rows** for
`PAYROLL_AND_MONEY_CONTROL_ROLE`; `SHOW GRANTS TO ROLE` returns 668 grants — 426 view SELECTs,
USAGE on 5 databases and 40 schemas, and **no warehouse**.

```sql
-- O1 · without this no query runs at all
GRANT USAGE  ON WAREHOUSE <name>
  TO ROLE PAYROLL_AND_MONEY_CONTROL_ROLE;

-- O20 · without this a warehouse still leaves 7 payment types unauditable
GRANT SELECT ON VIEW BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS
  TO ROLE PAYROLL_AND_MONEY_CONTROL_ROLE;
```

The second is the one people miss. The schema already has USAGE, but the only view SELECT-able in it
is `TRANSACTIONS` — so the whole CORR archetype (reimbursements, salary corrections, the expense
match rate) stays blocked on permissions rather than on data.

**Also worth saying in the same message:** P&C having no warehouse is why this spec ships with
catalogue metadata as evidence instead of rows. It is a standing condition, not a one-off.

---

## 2 · DNA — Jira

### The two tickets

| File | Type | Notes |
| --- | --- | --- |
| `TICKET-1-AE-manager-notes-audit.md` | **`Analytic Engineer Task`** | File first |
| `TICKET-2-BI-manager-notes-audit-dashboard.md` | **`BI Visualization Task`** | File second, with Ticket 1's key in the blocker link |

Attachments, all on Ticket 1:

- `DNA_ATTACHMENT_source_tables.md` — **the one that matters.** Ticket 1 references §11 (payroll's
  business rules) and §12 (the nine check archetypes) in several places
- `SPEC_manager_notes_audit_DEV.md`
- `SPEC_manager_notes_audit_v2.md` — for the record

Everything below the `---` in each ticket file is the description. The block above it is issue type
and routing — set those as fields, don't paste them.

### Three mechanics that save a round trip

**Set the issue type yourself.** Jira automation re-types new tickets to "New Request" on creation —
it happened twice to DNA-9454 within a second of filing. Setting it correctly up front gets the right
playbook applied first time.

**Link them.** Ticket 1 **blocks** Ticket 2.

**The bot cannot read a Claude artifact link.** On DNA-9454 it recorded *"[UNVERIFIED — link not
readable by the bot]"* and fell back to the description. That is why Ticket 2 restates the whole
layout in prose rather than relying on the mockup link.

### Escalate DNA-9437 separately, and first

Two SQL statements. Zero activity since it was created on 2026-09-03. It gates *Done when* 1, 2 and 8
on Ticket 1 — the grain check, the population size and the note-type check — so without it neither
side can evidence those criteria.

### Decide before filing

- **Write-back (Q6).** Ticket 2's status column is a write, which makes the dashboard a small
  application. In or out for the first release? Left blank, the intake bot will answer it with an
  assumption on your behalf.
- **Where the page lives.** Ticket 2 says it is deliberately *not* a section on the existing Payroll
  Dashboard and asks BI to name the placement. If you already know, say it and delete the question.

---

## 3 · Data team — ingestion and two defect reports

| # | Ask | Blocks |
| --- | --- | --- |
| **O3b / N12** | **The five raffle tables** — `RaffleDrawParticipant` (`draw`, `housemaid`, `isWinner`, `winOn`, `prize`, `points`), `RaffleDraw` (`drawDate`, `status`), `RaffleDrawPrizeGrand` (`worth`, `isGrand`), plus `RaffleTicketLog` and `RaffleDrawLog`. ERP module `magnamedia-housemaid-management`, package `com.magnamedia.entity.raffledraw`. **Zero** objects matching `%RAFFLE%`, `%PRIZE%` or `%DRAW%` exist account-wide. Newly found 2026-09-08 — this single ingestion takes `raffle_prize` from unverifiable to fully checked, with no business decision needed | **all of group F** — the only thing blocking it |
| **O21 / N17** | **Contract-type timeline per maid** — every CC/MV interval with dates. `HOUSEMAIDS_INFO_REVISION` has exactly the right columns (`OLD_HOUSEMAID_TYPE`, `HOUSEMAID_TYPE`, `SWITCH_HOUSEMAID_TYPE_DATE`) and **all of them are empty**. Two working routes exist: `mmdb.housemaids_revisions` (the VISA models already read it for `FIRST_HOUSEMAID_TYPE`), or the `to_type` column behind `BI_HOUSEMAID_STATUS_LOGS` | the ELIG archetype — 9 payment types |
| **O21 / N19** | **`live_out` flag, effective-dated.** `HOUSEMAID_TYPE` does not carry it; the gold layer derives `CC Live In / CC Live Out / MV` from a separate flag | Accommodation Relocation, Live-out Transportation Assistance |
| **O21 / N18** | **A row-level loan source.** No raw or silver loans table exists — only three aggregated gold views | the PAIR archetype — 5 payment types |
| **O9 / N10** | **Effective-dated salary history.** Candidate: the `mmdb` revision tables | the RECOMP archetype — 8 payment types |
| **O2** | **Read the addition-reason picklist**, and `HousemaidPurposesForBonusAdditionalDescription`. The payment-type list is incomplete and the warehouse's own category profile is truncated — this is what closes it | knowing what we are auditing |
| **N4 / R5** | **Expose `EXPENSE_ID` downstream.** It is used inside `HOUSEMAID_MANAGER_NOTES`' own join but never selected | the CORR archetype, alongside the grant above |

**Two defects to report independently of this audit (O16).** Neither is ours to fix and both affect
other consumers:

- **X1** — `BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` joins `EXPENSES_REQUESTS.RELATED_TO_ID` to a
  **manager-note id** while that column is documented as a **housemaid id**. Ranges overlap, so a
  wrong reading matches rows and raises no error. (DNA-9464 fixed this instance: 1 of 8,632 matched
  before, 7,878 after.)
- **X2** — `HOUSEMAID_MANAGER_NOTES` may emit more rows than there are notes, and its `MANAGER`
  column is entirely NULL because `EMPLOYEE_MANAGER_ID` is unmapped in the JPA entity.

---

## 4 · ERP team — questions only the code can answer

Four Ask the Code interrogations, one question each. **Needs a fresh JWT** from an active Low-Code
Platform session — they expire within hours.

| # | Question |
| --- | --- |
| **O3a** | Which table and column hold the **payroll month lock date**, and what rule assigns a manager note to a payroll month? *(Confirmed not obtainable from Snowflake by any route — no `%PAYMENT_RULE%` object exists and every lock-date column profiles as "no non-null values".)* |
| ~~**O3b**~~ | ~~What does `RafflePerformerJob` read to pick winners?~~ **ANSWERED 2026-09-08** (conversation 45932, all modules). It reads `RaffleDrawParticipant` rows flagged `isWinner`, on the current month's `RaffleDraw`, with the amount from `RaffleDrawPrizeGrand.worth`. **This item moves to the data team as an ingestion request** — see below. |
| **new** | Is there a **priced referral or signing bonus scheme** anywhere in the ERP? N11 claimed "not found in the ERP" but no interrogation ever asked — the warehouse was searched, the code was not. |
| **O12** | Is `HOUSEMAID_MANAGER_NOTES.AMOUNT` **always AED**? There is no currency column, so the entire spec assumes it. |

Separately, for the ERP team rather than the code:

- **O6** — the **timezone** of `NOTE_DATE` and the payslip dates. `TIMESTAMP_NTZ` carries none; if the
  ERP writes UTC, a note at 02:00 Dubai truncates to the previous day and can cross a lock-window edge.
- **O11 / N8** — the airfare cap parameters are **not effective-dated**, so a cap changed mid-year
  retroactively re-judges settled months. And the notification email hard-codes the literal `2000`
  instead of reading the parameter, so changing the parameter makes the email lie.

---

## 5 · George Abboud / Payroll — the business questions

He has already given four rules. These are what is still open on them.

| # | Question | Why it matters |
| --- | --- | --- |
| **O19** | **The full list of reasons a bonus gets rejected.** You have the top one. | The rejection reasons *are* group C's rule set. The audit's target is payments that met a rejection condition and were paid anyway |
| **O18** | **What is the AED 1,200?** It is profiled in *both* the payment table and the referral record and is not in the scheme he described. 250, 1,500 and 2,000 also appear on the payment side; 0 on the referral side | Until it is explained, any amount outside {500, 1000} must block rather than red |
| **Q8** | **What governs the MV exception** — "in some cases one maid could get the 1k"? And is the event total **always** 1,000? | With no condition the exception swallows the rule. The per-event tie-out rests entirely on the second half |
| **Q9** | **"Must not already be with the company"** — never been with us, or not currently with us? | A maid who left two years ago and is referred back gets opposite verdicts |
| **Q7** | **The airfare rule's edges** — do MV months count toward the 22, or only summed CC time? Is exactly 12 months a bridge or a reset? With multiple switches, is each gap judged independently? What governs the *second* ticket? Does the 22-month floor apply to **termination repatriation** as well as vacation flights? | Five different answers, five different populations |
| **O17** | **The ERP gates airfare on `months % 24 == 22`, which contradicts his rule.** Is the ERP denying eligible maids, or does that controller govern a path manager notes never take? | This is a finding either way |

---

## 6 · Owners still to be named

Nobody owns these today, and no engineering unblocks them. Together they cover **fourteen payment
types** — more than any data problem on this page. *(The raffle is no longer among them: as of 2026-09-08 it has a code-verified rule and needs only an ingestion — see §3.)*

| # | What has to exist | Suggested owner |
| --- | --- | --- |
| **O7 / N14** | Payment type → allowed expense heads | P&C + Payroll |
| **O7 / N15** | Contract type → allowed payment types *(two rows already confirmed: airfare is CC-only, Accommodation Relocation is CC live-out only)* | P&C + Payroll |
| **O7 / N16** | Which payment types always carry an expense record *(airfare and office-work are already known **not** to — they are booked as "Direct adjustment")* | P&C + Payroll |
| **Q4 / N13** | **The loyalty rule.** `anti_attrition_incentive` has no eligibility or amount rule anywhere in the ERP — its only reference is a payment-routing list. It is the largest single category of unverifiable money | P&C + whoever owns retention |
| **O10 / N11** | Referral and signing scheme prices, effective-dated, if they ever changed | the referral scheme owner |
| **Q10** | Do `FREEDOM_OPERATOR` and `WALKIN` months count as **CC months**? The warehouse convention says they are CC. P&C may diverge, but it must be a written choice | P&C |
| **Q11** | Are **part-time cleaners** in scope? They receive additions; the audit is defined over housemaids | P&C |

---

## 7 · Your own calls — nothing is blocked on anyone else

| # | Decision | Interim value in the spec |
| --- | --- | --- |
| **Q1** | The M13 confidence floor — decides whether an unmatched note is a red "no basis" or an amber "unverifiable" | 80%, per payment type per month |
| **Q12** | A **minimum denominator** for that floor. Without one a low-volume type flips its whole verdict rule on one note: 5 of 6 is 83% and passes, 4 of 6 is 67% and blocks | none set — this is a gap |
| **Q2** | The T4 amount tolerance. AED 0.01 is a float guard, not a materiality band. Does P&C want one? | AED 0.01 |
| **Q3** | Are system-generated additions in scope? The ERP's own repeated-additions rule excludes two of the three, which is evidence the business treats them as mechanical | in scope, amber |
| **Q5** | Salary-bearing rows — for the prorated types the note amount **is** a salary figure. Gap-and-band on screen, exact figure only in the reviewed drill-down? | band by default |
| **Q6** | Write-back for the maker–checker status column | undecided — **decide before filing Ticket 2** |
| **O14** | The first audit month and the backfill window | N-items specified from 2024-01-01 |
| **O15** | The **access statement** for the dashboard and the CSV export, given the sensitivity class and the staff-name exposure | outstanding |
| **O13** | Columns listed but consumed by nothing — mark each "required" or "context only" | outstanding |
| **O4** | Is `HOUSEMAIDS_TICKETS` still written to? `ID` tops at 14,564 — small enough to suspect a dead source, which would silently disable the airfare duplicate test | one query once O1 lands |

---

## What is not blocked

Worth leading with in any of these conversations, because it changes the shape of the ask.

**The first version needs no new data.** Three of the nine check archetypes — **UNIQ** (duplicates),
**RECON** (the payslip and referral-event tie-outs) and the airfare **CEIL** — are unblocked by
everything already granted. Duplicate detection, the payslip tie-out, the referral-event tie-out and
the airfare cap are buildable **the day the warehouse grant lands**, with nothing waiting on the data
team, payroll or a rule-writer.

Everything in sections 3 through 6 above is blocking the *other six* archetypes.
