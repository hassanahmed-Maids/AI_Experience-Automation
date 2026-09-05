# Ticket 1 of 2 — Analytic Engineering

**Issue type:** `Analytic Engineer Task` *(file it as this, not "New Request")*
**Project:** DNA · **Routing:** Analytics Engineering — Belal Alsayed
**Summary:** `Manager notes audit — model the ten Police & Control metrics at note grain in silver/gold`

---

### What we need

Police & Control audits every dirham managers add to housemaid payslips — roughly **1,300–1,400
additions a month, about AED 0.5m**, some AED 6.3m a year across ~16,000 payments. Each one is
supposed to be justified by the rule governing that payment type. Nothing checks that today. The
check is being built as a Snowflake dashboard.

Everything it reads is already in `BA_VIEWS`, plus a short list of columns that exist on the ERP
source table but are not projected into the curated note view. So the ask is narrow:

> **Model the ten metrics below at note grain in silver/gold, from the seven objects listed, plus
> nine columns already present on `mmdb_transformed.payrollmanagernotes`.** The business logic is
> attached in full — you do not need to reverse-engineer it.

**The dashboard this feeds** is specified in section 11 of the attached spec and restated in
Ticket 2. Cards, tabs and columns each carry their metric id.

### The ten metrics, by name

These names are fixed — they are what P&C reads in handovers — so anything built or labelled uses
them exactly as written, with the metric id.

| Id | Name |
| --- | --- |
| M1 | `Cases in Scope` |
| M2 | `Money in Scope` |
| M7 | `Findings` |
| M8 | `Unverifiable` |
| M9 | `Cleared` |
| M10 | `Coverage` |
| M11 | `Amount at Risk` |
| M12 | `Duplicate Groups` |
| M13 | `Expense Match Rate` |
| M14 | `Completeness Exceptions` |

M0 and M3–M6 in the spec are the engine — audit-month resolution, the test battery, the expense
match, the verdict algebra and the group rules. They are not display metrics; they produce the one
verdict column everything above aggregates.

### Grain

**One row per manager note.** A maid with four additions in a month is four rows. Exception: **M14
is one row per maid × payroll month.**

### What it reads

| # | Object | What it gives |
| --- | --- | --- |
| D1 | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES` | the note — id, maid, type, amount, reason, date |
| D2 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | the payslip month and its own `MANAGER_ADDITIONS` total — the tie-out anchor |
| D3 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | contract type, nationality, service dates |
| D4 | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REQUESTS` | the authorising expense request, its status, amount, beneficiary and approver |
| D5 | `…HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_TICKETS` | tickets actually purchased, for the flight-home duplicate test |
| D6 | `…HOUSEMAID_MANAGEMENT_SILVER.MAIDS_REFERRALS_BONUSES`, `…HOUSEMAID_REFERRALS` | the referral event behind a referral bonus |
| D7 | `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` | the payment-type picklist |

Plus nine columns that exist on **`mmdb_transformed.payrollmanagernotes`** and are not projected
into D1. All nine are confirmed present in the ERP source; how they reach the warehouse is your
call:

`APPLIED`, `NOT_FINAL`, `PAID`, `PAID_ON_PAYROLL_MONTH`, `IS_REFUND`, `EXPENSE_ID`,
`ADDITION_REASON_ID`, `PURPOSE_ID`, `CREATOR` — plus `PARAMETERS.CODE`/`VALUE` for the airfare
limits and the payroll lock window on `MONTHLYPAYMENTRULES`.

### Verification note

Table, column, type and enum claims come from the Snowflake catalog and the ERP source code. **They
have not been confirmed against rows** — an access limitation on our side meant no row-level query
could run (**DNA-9437**, To Do). What exists is known; exactly where it lands and how populated it
is, is not. The three checks under *Done when* close that out.

### Two things that will silently produce wrong numbers

**1. `PAID = true` is not "was paid".** For most routine additions the ERP writes neither `PAID` nor
`PAID_ON_PAYROLL_MONTH`; those are written only for carried-forward *must-be-paid* reasons.
`HousemaidPayrollController`'s manual "mark as paid" sets `PAID` without `PAID_ON_PAYROLL_MONTH`.
**Scoping the population on `PAID = true` drops the majority of notes and the month reports clean.**
The audit month resolves in three branches instead — spec §4.

**2. There is no key from a note to the expense payment that authorised it.**
`payrollmanagernotes.EXPENSE_ID` points at `EXPENSES.ID`, the expense *catalogue* row; no FK exists
to `EXPENSEREQUESTTODOS` or `EXPENSEPAYMENTS`. The match is a heuristic on
`RELATED_TO_ID = note.HOUSEMAID_ID` — **the same key DNA-9464 adopted**, so the route is
production-validated. It must never resolve to the first candidate: measured in DNA-9464, **7,020 of
7,878 matched notes (89%) belong to maids holding more than one expense request**, and 3,473 of
those used two different payment methods. Multiple candidates → the note is unverifiable, not
matched.

### Three data asks, none of them blocking

| Ref | Ask | What it unlocks |
| --- | --- | --- |
| **N10** | Effective-dated salary history — the salary in force on a past date, not the current profile value | Recomputing a part-month or final salary (group D). Candidate: the `mmdb` revision tables |
| **N11** | Referral and signing bonus scheme prices, effective-dated | Testing the amount (group C). `MAIDS_REFERRALS_BONUSES` records what was **paid**, never what was **due** |
| **N12** | Raffle winners per draw | Group F. `RafflePerformerJob` runs the draw and writes the notes — start there |

Without them those group rules return BLOCKED and their notes are amber. **Amber is a result this
report publishes, not a failure of it** — it is the honest statement that no rule exists to test
against.

### Two things that need a decision, not engineering

**The loyalty payment has no rule anywhere in the company.** `anti_attrition_incentive`'s only
reference in the entire ERP is a payment-routing list, not an eligibility or amount rule. It is the
single largest category of unverifiable money. Either a rule gets written, or the report states
every month that the largest group of manager additions cannot be audited. Both are legitimate;
neither should be accidental.

**Three reference mappings do not exist and are business rules, not data**: payment type → allowed
expense heads, contract type → allowed payment types, and which payment types always carry an
expense record. Until they do, those three tests return BLOCKED. ⚠️ **Two entries of the third are
already settled**: DNA-9464 established that airfare and office-work additions are booked straight
onto salary with no payment behind them — *"Direct adjustment"*, 565 in six months. Without that,
every flight-home payment would be red-flagged "no basis".

### On sensitivity — so it does not stall at intake

The report pairs an internal housemaid id with an amount and a payment reason. **No new read access
is requested; nothing here widens what any role can already see.** No maid name, phone, contact
detail, EID, passport or address is displayed. Maids and approvers appear as internal ids —
`EXPENSES_REQUESTS.APPROVED_BY` stores a *name*, so the model must expose an id or role reference
alongside it. For `prorated_salary`, `mv_prorated_salary`, `previously_held_salary` and
`mv_extra_salary` the note amount **is** a salary figure; the model carries it and the dashboard
bands it, so display is a config flag rather than a schema change. `HOUSEMAIDS_INFO` is read for
non-salary columns only.

### Attached

| File | What it is |
| --- | --- |
| **`DNA_ATTACHMENT_source_tables.md`** | **Start here.** Every data point mapped to its object, the two link routes, the fourteen-row trap table, and the reference data that does not exist |
| **`SPEC_manager_notes_audit_DEV.md`** | The full logic — population, audit-month resolution, the test battery, the verdict algebra, all 24 payment types mapped to groups, ten metrics, twelve run guards |
| **`SPEC_manager_notes_audit_v2.md`** | The long-form specification with the reasoning behind every rule. Not needed to start; attached for the record |

### Not a duplicate

| Key | What | Status | Relationship |
| --- | --- | --- | --- |
| **DNA-9464** | join-key fix on `BI_PAYROLL_MAID_SALARY_ADDITIONS_BY_CATEGORY` | Pending Deployment | We build on the corrected key. This models a different thing — that report categorises additions, this one **audits** them |
| **DNA-9465** | additions-as-loans charts querying the wrong table | Pending Deployment | Same dashboard section, unrelated defect |
| **DNA-9133** | anomaly detection on Additions by Category | Ongoing | Same measure, different purpose — detects a spike, does not test a rule |
| **DNA-9446 / DNA-9449** | payroll audit — ingest two archived monthly files | To Do | Sibling P&C payroll check, different population (whole-payroll arithmetic, not per-note justification) |
| **DNA-9454 / DNA-9455** | applicant ticketing audit, eleven P&C metrics | To Do / On-Hold | Sibling P&C audit, different population (recruitment flights) |
| **DNA-7074** | the "most recent expense request" filter | Done | The upstream cause of the payment-method mis-attribution DNA-9464 hit; this model must not inherit it |
| **DNA-9437** | warehouse USAGE for `PAYROLL_AND_MONEY_CONTROL_ROLE` | To Do | Why the figures above are catalog-derived rather than measured |

**This does not replace the existing Payroll Dashboard "Additions to the maid's salaries" section.**
That section reports what was added, by category. This audits whether each addition was justified.
Both should exist.

### Done when

1. **Grain holds.** `COUNT(*) − COUNT(DISTINCT ID) = 0` on the note-level model. Not "materially
   fewer duplicates" — **zero**.
2. **The population is the right size.** The model returns **1,300–1,500 addition notes per month**
   for a complete month. DNA-9464 measured 8,632 across six months on the same source; a month
   returning under 800 means the audit-month rule or the applied/refund predicates are wrong.
3. **The verdict is one column.** Every note carries exactly one `AUDIT_VERDICT ∈ {RED, AMBER,
   GREEN}`, one `VERDICT_LABEL`, one `FAILURE_TYPE` or null, one `BLOCKING_REASON` or null,
   `DUPLICATE_GROUP_ID`, `IS_RISK_REPRESENTATIVE` and `TEST_TRACE`. **No consumer re-derives
   eligibility.**
4. **The three verdicts account for every note.** `M7 + M8 + M9 = M1` exactly, and their amounts sum
   to `M2` to the cent.
5. **No green skipped a test.** Zero rows where `AUDIT_VERDICT = 'GREEN'` and `TEST_TRACE` contains
   a `BLOCKED` or unrun applicable test.
6. **Amber always carries its reason.** `COUNT(AMBER) = COUNT(non-null BLOCKING_REASON)`, and the
   reason buckets sum to M8 in both count and money.
7. **The auditor's own flags are not used.** Zero occurrences of `CONFIRMED_AMOUNT_BY_AUDITOR` or
   `CONFIRMED_REPEATED_BY_AUDITOR` in any filter or test in the model. They are carried as display
   columns only. *(The ERP's own detection queries `CONFIRMED_* = false`, so a confirmed but still
   over-limit payment leaves its list while remaining over the limit. That population is the reason
   this report exists.)*
8. **Note-type integrity.** `COUNT(*)` where `NOTE_TYPE IN ('EXTRA_SHIFT','BONUS','SALARY_RAISE',
   'REDUCTION')` in the audit window is **0**. A non-zero count means money is moving through a type
   this scope excludes.
9. **The payslip reconciles.** Per maid × audit month, the sum of all that payslip's `ADDITION` notes
   equals `HOUSEMAID_PAYROLL_HISTORY.ADDITIONS`, **both sides unfiltered**, with scope exclusions
   reconciled as named lines. Any residual surfaces as M14, never absorbed.
10. **M13 is per payment type per month**, not a single aggregate, and the 80% floor is applied per
    type.
11. **History reaches back to 2024-01-01.**
