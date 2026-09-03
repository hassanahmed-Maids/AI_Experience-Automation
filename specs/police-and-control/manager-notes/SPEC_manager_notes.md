# Spec — Manager Notes

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Business owner / reviewer** | Jacky (maker–checker; money-out payroll check) |
| **Spec version** | **v2** — draft, post-audit |
| **Date** | 2026-09-03 |
| **Delivered on** | **MaidsInsights**, over **Snowflake**. The two are not interchangeable: MaidsInsights is the dashboard the auditor opens; Snowflake is the warehouse, role and SQL underneath |
| **Replaces** | Nothing running. The Notion page *Manager Notes* (Audit Flow Factory / Both Maids) specified this as a flow; it was never built. This spec re-expresses it as a dashboard |
| **UI mockup** | https://claude.ai/code/artifact/a08a0bea-96cf-4ea3-af21-ccced5c94a5d |
| **Status** | Draft — Step 1 playback and the feedback loop are still open. **v2 answers the spec-auditor gate (10 critical, 15 major); what it did not close is listed in §6** |

**Source of the business logic.** The Notion page and its 20 linked rule rows are the requestor's
own, already reasoned through, and are **not re-derived here**. This spec adds the layer Notion does
not have: which warehouse object each rule reads, what the metric is, and what happens when a rule
cannot be evaluated. Where a Notion figure is quoted it is attributed and **not re-measured** — see
the compute note in §0.

---

## 0. Why this spec exists, and what it can and cannot claim

Managers add money to maids' payslips every month — **about 1,347 notes and AED 529,000 a month,
16,159 payments and AED 6,348,968 over Sep 2025 – Aug 2026** *(requestor's figures, measured
2026-08-28)*. Nobody checks whether they should have. This is the check that asks.

**A finding is money added above what the payment type's own rule allowed** — the excess where the
rule allows less than we paid, or the whole amount where no rule was met at all.

**What this spec cannot claim.** The Snowflake role `PAYROLL_AND_MONEY_CONTROL_ROLE` has **no
warehouse attached**, so no query needing compute can run (**DNA-9437**). Every count above and
below is the requestor's, carried forward with attribution. Object and column existence *is* proven
— `SHOW` and `DESC VIEW` are served from metadata — and every table and column named in this spec
came from a query result or from Ask the Code. Nothing is invented; nothing is re-measured.

### The move from flow to dashboard changes three things

1. **The blocker in the Notion page disappears.** That page names a bulk ERP route as *"the one
   thing blocking the build"* — every route is one call per maid, ~1,000 maids a month, a 500-call
   budget. **A dashboard has no call budget and makes no per-maid walk.** The population is one
   query. The bulk route stays needed for anything reading the ERP live; it is not needed here.
2. **The text the AI agent reads is already in the warehouse.** 22% of notes (3,511 of 16,159) need
   a person to read what a manager typed. That text is `NOTE_REASON`, present today. Classifying it
   is a column operation, not an agent walking records.
3. **A new limit appears.** A flow can call the ERP for any field. A dashboard reads only what has
   been ingested — and the current view is **10 columns of a 37-column entity**. §2.3 is the
   consequence.

---

## 1. Business logic

- **The control.** Every addition to a maid's payslip must be justified by the rule governing its
  payment type. Money added beyond that rule is leakage.
- **The failure it catches.** Overpayment, double payment, payment against a rule that never applied
  to this maid, and payment with no basis at all.
- **Population.** Every **`ADDITION`** manager note on a housemaid's payroll, in the audit month.
- **Grain.** **One case = one note.** Never one maid, one month or one payment type — a maid with
  four additions in a month is four cases.
- **Reader and action.** A P&C auditor works the month's findings case by case; Jacky reviews before
  anything is acted on (maker–checker, from the Notion page).
- **Both contract types are in scope, and the type decides which payments are even possible.** A
  **Company Contract** maid was hired by us; a **MaidVisa** maid is our employee on paper only.
  Flight-home money and the loyalty payment are Company Contract only; the part-month final salary
  happens only on MaidVisa. Auditing a payment against a rule that never applied to her is itself an
  error — gate ❽ exists for this.
- **Explicitly out of scope.** Deductions (the warehouse feed broke — see MN-O5); office-work
  payments (a separate check owns them); client manager notes (different records, opposite
  direction, owned by Client Refunds); free-text maid-profile notes with no money attached.

---

## 2. Data points

### 2.1 Verified — already in Snowflake

**D1 — the notes.** `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES`
*(evidence: `SHOW TERSE VIEWS LIKE '%MANAGER_NOTE%' IN DATABASE BA_VIEWS`; `DESC VIEW`)*

| ID | Column | Type | Use |
| --- | --- | --- | --- |
| D1.1 | `ID` | `NUMBER` | **The case grain.** 5–183,975 |
| D1.2 | `HOUSEMAID_ID` | `NUMBER` | Join key. Rule ❶ binds every join to this and forbids name or MOL |
| D1.3 | `NOTE_TYPE` | `VARCHAR` | Population filter. Profiles `ADDITION`, `DEDUCTION`, `PENALTY_DEDUCTION` |
| D1.4 | `AMOUNT` | `FLOAT` | **The actual.** −3,032 – 44,230.26 |
| D1.5 | `NOTE_REASON` | `VARCHAR` | **What the manager typed** — the verifier's input |
| D1.6 | `REASON` | `VARCHAR` | **The payment type name**, `COALESCE(a.NAME, d.NAME)` over `mmdb.picklists_items`. The 24 types and 9 groups key on this |
| D1.7 | `NOTE_DATE` | `TIMESTAMP_NTZ` | Event date. **Not the paid month** — §2.2 |
| D1.8 | `MANAGER` | `NUMBER` | ⚠ **Dead. Do not use** — §2.2 |
| D1.9 | `REQUESTED_BY` | `VARCHAR` | Actor, but only where an expense payment exists |
| D1.10 | `APPROVED_BY` | `VARCHAR` | Same |

**D2 — the expense payment behind the note.** `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_PAYMENTS`,
34 columns *(evidence: `DESC VIEW`)*. Carries the **expected** side for most of the population:
`AMOUNT`, `AMOUNT_TO_PAY`, `STATUS` (`PAID`, `PAID_PENDING_INVOICE`, `DISMISSED`, `PENDING`),
`EXPENSE_ID`, `DESCRIPTION`, `NOTES`, `APPROVED_BY`, `PAID_BY`, `PAYMENT_REQUESTED_BY`,
`REQUIRES_INVOICE` / `INVOICE_ATTACHED` / `INVOICE_NUMBER`, `PAYMENT_METHOD` (includes `SALARY`),
and maid scoping via `RELATED_TO_TYPE = 'MAID'` + `RELATED_TO_ID`, and `BENEFICIARY_TYPE = 'MAID'`.

> ⛔ **The expected side is multi-currency and v1 declared it single-currency. Corrected.**
> `EXPENSES_PAYMENTS` carries **`CURRENCY_ID`** with **ten distinct values**
> (`18802, 18803, 18804, 18805, 19751–19755, 43243`), plus **`LOCAL_CURRENCY_AMOUNT`** and
> **`VAT_AMOUNT`**. MN3 subtracts expected from actual, so a note of AED 500 matched to a payment of
> 500 in another currency reads as clean, and one matched to a converted row fabricates a finding —
> on the headline number. **Nothing in this spec may compare `AMOUNT` to `EXPENSES_PAYMENTS.AMOUNT`
> until the AED basis is named: which `CURRENCY_ID` is AED, which column is already in AED, and what
> the FX source and as-of date are for the rest. MN-O13, blocking.** Until then every group whose
> expected value comes from D2 (G5, G7, and ❻/❼) filters to the AED currency id and reports
> non-AED rows as a separate count, never converts them.

**Hygiene on D2 — types that will silently match nothing.** `REQUIRES_INVOICE` is `BOOLEAN`, but
**`INVOICE_ATTACHED` is `VARCHAR '00'/'01'`** — G7's receipt test compared to `TRUE` or `1` matches
zero rows and reports "no findings". Also unstated in v1 and needed before any join: `TYPE`
(`PAY`, `PAY_TO_BUCKET`), `STOPPED` (`'00'/'01'`), `IS_COMPLETED` (`'00'/'01'`), `CONFIRMED` (`0/1`),
and **which of the four `STATUS` values authorise a note** — v1's worked example used `PAID` alone,
silently excluding `PAID_PENDING_INVOICE`. `RELATED_TO_TYPE` is polymorphic
(`MAID, APPLICANT, OFFICE_STAFF, TEAM`), so the `= 'MAID'` filter is mandatory, and `RELATED_TO_ID`
`NUMBER(38,0)` is type-compatible with `HOUSEMAID_ID`.

**D4 — the maid.** `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO`, 136 columns
*(evidence: `DESC VIEW`)*. v1 specified gate ❽ (contract type), G1's nationality price split and a
maid-name column with **no data point behind any of them**. All three are here:

| ID | Column | Type | Use |
| --- | --- | --- | --- |
| D4.1 | `NAME` (also `FIRST_NAME`, `MIDDLE_NAME`, `LAST_NAME`) | `VARCHAR` | The case subject |
| D4.2 | **`HOUSEMAID_TYPE`** | `VARCHAR` | **CC / MV — the input gate ❽ had none.** Values to be profiled (needs compute) |
| D4.3 | **`NATIONALITY`**, `NATIONALITY_CATEGORY` | `VARCHAR` | G1's price split |
| D4.4 | `STATUS`, `DATE_OF_TERMINATION`, `MODE_OF_TERMINATION` | | G4's final-salary context |
| D4.5 | `LIVE_OUT` | `NUMBER 0/1` | Separates the transport allowance from genuine taxi trips (G7) |

⚠ **`HOUSEMAIDS_INFO` is the maid's *current* record.** `HOUSEMAID_TYPE` read today is not
necessarily her type when the note was paid. The payroll-checks spec hit the same problem and solved
it with `HOUSEMAIDPAYROLLLOGS.SALARY_TYPE`, the type **snapshotted at payroll time** — which is not
yet in Snowflake. **MN-O14**: gate ❽ should read the snapshot, not the current record.

**D3 — related, present, not yet assessed.** `MONEY_CONTROL_SILVER`: `EXPENSES_REQUESTS`,
`EXPENSES_CONFIGURATION` *(likely home of the price lists rule G1 compares against)*,
`EXPENSES_HIERARCHY`, `EXPENSE_REQ_TRANSACTIONS_LINKING` *(first place to look for the missing
note→payment link)*, `DUPLICATE_EXPENSES`, `EXPENSES_REFUNDS_HISTORY`.

### 2.2 Three things the ERP settled that change the design

*(Ask the Code, `erp/magnamedia-payroll-management`, 2026-09-03. Full answers in
`01-ask-the-code.md`.)*

**a. There is no note→payment foreign key. The match is a heuristic, and it is the ERP's own.**

`ManagerNoteService.processExpenseRequestTodo` **copies** fields from `EXPENSEREQUESTTODOS` onto the
note — description into `NOTE_REASONE`, amount, referred maid, and `ADDITION_REASON_ID` from
`EXPENSES.SALARY_ADDITION_TYPE_ID`. Nothing points at anything. The ERP's own reverse lookup is:

```
HOUSEMAID_ID  +  ADDITION_REASON_ID  +  NOTE_REASONE LIKE '%…%'
     → EXPENSEREQUESTTODOS → EXPENSE_PAYMENT_ID → EXPENSEPAYMENTS
```

So the Notion page's *"two thirds are matched, not read"* is right in substance and wrong in
mechanism. **Nothing names anything.** Consequences, all of which the design must carry rather than
assume away:

- **`ADDITION_REASON_ID` is the structured half of the match and it is not in the view.** Ingesting
  it upgrades the match from "text and amount" to "reason id, plus text and amount". **It is the
  single highest-value field in §2.3.**
- **The false-positive mode has a name, and it is the duplicate rule's population.** Two notes for
  one maid in one month at the same amount and reason are indistinguishable to this lookup — exactly
  what G3 is about. Rule ❽ already says duplicates are tested *inside a group*; the match must run
  **after** grouping, never before.
- **The match rate is a number the dashboard shows.** If two thirds should match and fewer do, the
  shortfall is not clean — it is unevaluated. **Guard MG2.**

**b. `PAID_ON_PAYROLL_MONTH` is the population date, and it dissolves the open decision.**

| Field | What the code does with it |
| --- | --- |
| **`PAID_ON_PAYROLL_MONTH`** | **The month the note was actually paid.** Set at transfer in `AsyncService.processCurrentMonthHousemaidsBatchBT` from `accountantTodo.getPayrollMonth()`. The ERP's own paid/deferred queries key on it |
| `NOTE_DATE` | Creation/event date. Payroll generation windows **unpaid** notes into a run on it (`noteDate >= start AND noteDate < end`) |
| `PAYROLL_MONTH` | ⚠ Populated in one narrow MV-prorated branch only, **not used in standard note-selection queries** |

**The Notion page calls `PAYROLL_MONTH` "the month it actually pays". The code does not.** A spec
windowed on it would audit almost nothing.

The open decision was: window on `NOTE_DATE` and audit 216 postponed flight-home notes years early;
exclude future dates and risk dropping notes genuinely paid this month. **Window on
`PAID_ON_PAYROLL_MONTH` and neither happens.** This check audits money that *moved*; an unpaid
postponed note has a null there and leaves the population by construction — no exclusion rule, no
cut-off to tune. When it is eventually paid it enters the month that paid it, which is the month
whose payment should be audited. **Rule ❷ ("a payment dated after the month being audited is not yet
in scope", status *Pending Business*) resolves to: the windowing date is `PAID_ON_PAYROLL_MONTH`.**

`NOTE_DATE` stays as a displayed column. The gap between the two is worth seeing.

**c. The manager column is permanently dead.** `EMPLOYEE_MANAGER_ID` is **unmapped since PAY-3484**.
The view's `MANAGER` is not empty from a sync gap — the source stopped writing it and it will never
fill. Per-manager attribution needs **`FROM_MANAGER_ID`** or **`CREATOR`**, neither in the view. The
dead column should be dropped from the view rather than carried.

### 2.2b Approved KPI definitions

`BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` **exists** *(evidence: `SHOW TERSE VIEWS LIKE
'INSIGHTS_DASHBOARD_CONTAINER' IN DATABASE BA_VIEWS`)*. **Its contents could not be read** — listing
rows needs compute, and the role has no warehouse (DNA-9437).

MN1 and MN2 ("notes in scope", "money added") are exactly the shape of metric that may already have
an approved definition. **Before building, the Snowflake team must check the container for MN1 and
MN2 and reuse any approved definition verbatim with all its filters (including `FAKE = false`).** If
none exists, both are new P&C definitions and should be added to the Data Catalog. Every other
metric here is a P&C definition by construction — no approved model computes a per-note verdict.
**MN-O15.**

### 2.3 Ingestion request — all on `PAYROLLMANAGERNOTES`, so a projection, not a pipeline

Every field below is a confirmed column on the table that already feeds the view.

| ID | Column | Type | Why the check needs it | Without it |
| --- | --- | --- | --- | --- |
| **N1** | `PAID_ON_PAYROLL_MONTH` | `DATE` | **The population date** (§2.2b) | The whole check has no correct month filter. **Blocking** |
| **N2** | `ADDITION_REASON_ID` | `BIGINT` | The structured half of the expense match; the group key behind D1.6's label | Match falls back to text + amount alone. **Blocking for MN3/MG2** |
| **N3** | `APPLIED`, `PAID` | `TINYINT(1)` | Lifecycle. A note never applied is not a payment | Unapplied notes counted as money out |
| **N4** | `IS_REFUND`, `REFUNDED_NOTE_ID` | `TINYINT(1)`; `REFUNDED_NOTE_ID` **`BIGINT` — UNVERIFIED** | The **refund** chain | A refund reads as a duplicate |
| **N5** | `OLD_NOTE_ID` | `BIGINT` | The **supersession** chain — *a different chain from N4* | A corrected note counted as a duplicate of the note it replaced |
| **N6** | `REFERRED_MAID_ID` | `BIGINT` | G3 cannot verify a referral without it | The referral bonus rule is unevaluable |
| **N7** | `PURPOSE_ID` | `BIGINT` | Structured purpose, so a rule reads a field not text | Text fallback |
| **N8** | `FROM_MANAGER_ID`, `CREATOR`, `LAST_MODIFIER` | `BIGINT` **— UNVERIFIED, Snowflake team to confirm** | Actor attribution, replacing dead `MANAGER` | No per-manager view (MN-O1) |
| **N9** | `PAYROLL_ACCOUNTANT_TODO_ID` | `BIGINT` **— UNVERIFIED** | Links the note to the payroll run that paid it — **the same `PayrollAccountantTodo` the payroll-checks spec is built on**, so the two checks can be reconciled | The two P&C payroll dashboards cannot be tied together |
| **N10** | `CONFIRMED_AMOUNT_BY_AUDITOR`, `CONFIRMED_REPEATED_BY_AUDITOR` | `TINYINT(1)` | ⚠ See MN-O7 — the ERP **already has auditor-confirmation flags on the note** | Unknown whether this check duplicates an existing control |
| **N11** | The winners list for G6, and the price/entitlement lists for G1 and G3 | — | The **expected** side for three groups. Source not yet identified; `EXPENSES_CONFIGURATION` is the first place to look | G1, G3, G6 have no expected value to compare against |
| **N12** | **The expense-request pivot** — ERP `EXPENSEREQUESTTODOS` (`ID`, `EXPENSE_ID`, `EXPENSE_PAYMENT_ID`, `RELATED_TO_ID`, `RELATED_TO_TYPE`, `AMOUNT`, `DESCRIPTION`, `REFERRED_MAID_ID`, `PURPOSE_ADDITIONAL_DESCRIPTION_ID`) and `EXPENSES.SALARY_ADDITION_TYPE_ID` | — | ⛔ **Without this, N2 unblocks nothing.** The match chain is note → `EXPENSEREQUESTTODOS` → `EXPENSE_PAYMENT_ID` → `EXPENSEPAYMENTS`, and **`EXPENSEREQUESTTODOS` is not in `BA_VIEWS`** (`SHOW TERSE VIEWS LIKE '%EXPENSE%'` returns 15 views; none is it, and there is no plain `EXPENSES` view). `EXPENSES_PAYMENTS` carries **no addition-reason column** at all, so ingesting `ADDITION_REASON_ID` onto the note gives a key with nothing on the other side | The match cannot run at all. **Blocking** |

> **Assess before ingesting.** `MONEY_CONTROL_SILVER.EXPENSE_REQ_TRANSACTIONS_LINKING` and
> `EXPENSES_REQUESTS` both exist and may already serve the pivot's role. Check them before asking
> for a new ingest — this is the data team's call, not ours.

### 2.4 Sensitive-data handling

This check touches salaries and per-maid amounts.

> ⛔ **v2: this is now written conditionally, and it blocks.** v1 stated the unmasked design as
> settled. It is not: the governing document — the requestor's own Notion page — says *"individual
> amounts never appear in chat, a run summary or an email. Counts and totals only."* **Until MN-O9
> is closed by the business owner, the default is the Notion rule: masked.** The design below is
> what P&C asked for on the payroll-checks dashboard and is offered for the same reasons, but it is
> a proposal here, not a decision. **MN-O9 and MN-O16 are both blocking.**

**Proposed, pending MN-O9 — the control is access, not masking.** The reader is an auditor working a
money-out case against a named maid; a masked name and a banded amount cannot be reconciled to the
ERP. On that reading the dashboard shows the maid, the note text and the amount in full, and
instead:

1. reads through a **named-auditor Snowflake role**, membership owned and reviewed;
2. **logs views and exports**;
3. is **delivered as a link — never an emailed report body**;
4. exports no wider than the screen.

⚠ **This differs from the Notion page**, which says *"individual amounts never appear in chat, a run
summary or an email. Counts and totals only."* Those two are reconcilable — nothing goes in an email
either way — but the on-screen rule is genuinely different, and it is **Jacky's call as business
owner**. **MN-O9.**

⛔ **If MaidsInsights reads through a shared service account rather than the viewer's own role,
control 1 does not work as written** — the grant sits on the tool, not the person. The unmasked
design rests on control 1, so **it cannot ship until this is confirmed. MN-O16, blocking.** Same
open question as the payroll spec (O31).

---

## 3. Metric calculations

Currency **AED**, single-currency, no FX. Money rounded to 2dp for display, full precision in
comparisons. Percentages to 2dp. Audit month = the `PAID_ON_PAYROLL_MONTH` month, default previous
calendar month.

### The verdict ladder — one note, one verdict

The 20 rules are already ordered by the requestor. The dashboard evaluates them in that order and
**stops at the first that produces a verdict**:

```
❶ join by maid id            (binding on every join; not a verdict)
❷ window                     → out of scope if PAID_ON_PAYROLL_MONTH ≠ audit month
❸ profile unreachable        → pending          (outage, not a finding)
❹ no payment type            → pending          (count must be zero)
❺ amount = 0                 → pending
❻a matched, amount disagrees → finding
❻b expected to match, no match → pending  (into MG2)   ← v2: v1 made this a finding
❼ expense head ≠ type        → route to verifier → pending until it returns
❽ contract type cannot receive → finding
   duplicates: tested inside the group, never once across all payments
   ── exactly one group rule: G1 … G7 ──
❾ nothing settled it         → pending, with its reason      ← terminal catch-all
```

**The terminal catch-all is the load-bearing rule.** Without ❾ an unevaluable note renders as clean,
which is the failure mode that makes an audit dashboard worse than no dashboard.

**❻ was two rules wearing one number — v2 splits it.** v1 read *"named expense missing or amount
disagrees → finding"*, which turns **every unmatched note into a finding**. Only about two thirds of
notes are expected to have an expense record at all, so under v1 the other third are findings and
MN3 is a number in the millions. It also contradicted §2.2a, which says an unmatched note is
*unevaluated, not clean* — the same event, two answers. ❻a and ❻b resolve it. **What ❻b still needs:
the field or condition that decides a note was *expected* to match** — nothing in D1–D4 or N1–N12
identifies that subset today, which is also why MG2's denominator is undefined. **MN-O17, blocking.**

**❼'s verdict was never defined — v2 closes the loop.** "Route to verifier" is a fourth outcome that
no metric consumed, so under v1's remainder rule those notes became clean. They are the notes most
likely to be wrong: ❼ is the mechanism that catches the two mislabelled payment types. The verifier
returns one of **`justified` → clean**, **`unjustified` → finding**, or **`cannot tell` → pending**,
and the note stays `pending` until it does. MG3 covers only its unavailability.

### Headline metrics

| ID | Metric | Formula | Notes |
| --- | --- | --- | --- |
| **MN1** | Notes in scope | `COUNT(D1.1)` where `NOTE_TYPE = 'ADDITION'` **and** `PAID_ON_PAYROLL_MONTH` in the audit month **and `APPLIED = 1` and `PAID = 1` and `IS_REFUND = 0`**, with superseded notes (`OLD_NOTE_ID` chain) and refunded notes (`REFUNDED_NOTE_ID` chain) collapsed to their surviving row | **v2 — the lifecycle filter was missing.** v1 counted unapplied notes as money out and would have read a refund as a duplicate, which is exactly what N3–N5 were requested to prevent; they were requested and then used by nothing |
| **MN2** | Money added | `SUM(D1.4)` over MN1 | ~AED 529,000/month expected |
| **MN3** | **Findings — AED above expected** | `SUM(GREATEST(actual − expected, 0))` over notes whose verdict is *finding* | **The headline.** Where no rule was met, `expected = 0` and the whole amount is the finding |
| **MN4** | Findings — count | `COUNT` of notes with verdict *finding* | |
| **MN5** | Pending — count and AED | `COUNT` and `SUM(D1.4)` where verdict is *pending* | **Amber, never folded into clean.** Includes every ❾ note |
| **MN6** | Clean — count and AED | **Defined positively: a group rule ran, reached a conclusion, and the payment satisfied it.** Never a remainder | **v2 — this was the worst defect in v1.** As a remainder, every unevaluable note fell into clean: a blocked group, a failed match, an unreturned verifier. See the note below |
| **MN7** | **Coverage** | `(MN4 + MN6) / MN1`, with MN6 as defined above | **v2 — v1's version could not measure coverage.** With MN6 a remainder, `MN7 ≡ 1 − MN5/MN1`: a restatement of the pending share that no blocked group and no failed match could move. It was the metric carrying the argument *"a dashboard reporting few findings on low coverage is reporting nothing"*, and it could not detect the conditions it existed to expose |
| **MN8** | Unevaluable money | `SUM(D1.4)` over every note in a `BLOCKED` group **and** every note whose group rule could not conclude | **v2 — widened.** v1 said "G2 alone" while the same section marked G1's service-months arm and G6 blocked too. A subset of MN5, not a separate bucket — labelled as such on screen so the two tiles are not added together |

**The rule that makes the rest safe — v2.** *A note may only be clean if a rule ran and cleared it.*
Everything else is `pending`, with its reason. Concretely:

- a note in a **`BLOCKED` group** → `pending`, and into MN8 — never clean, **whatever else is true**;
- a note routed to the **verifier** → `pending` until the verifier returns (see ❼ below);
- a note whose **expected value is NULL** → `pending`. `GREATEST(actual − expected, 0)` returns NULL
  in Snowflake when either argument is NULL, so an unknown expected value silently contributes
  **0** to MN3 and, under v1's remainder rule, read as clean;
- a note whose match failed but that was expected to match → `pending`, into MG2's numerator.

**Null, sign and precision rules — v2, absent from v1 entirely.**

| Situation | Rule |
| --- | --- |
| `expected IS NULL` | `pending`. Never a zero contribution to MN3 |
| `AMOUNT < 0` on an addition | ⚠ **The view's `AMOUNT` ranges to −3,032.** A negative addition is not an overpayment and `GREATEST(…,0)` would clamp it to 0 and read clean. **New gate, before ❺: a negative addition is `pending`** |
| `AMOUNT = 0` | gate ❺ — `pending` |
| MN1 = 0 | guard MG5 — `SKIPPED`, a finding about the run |
| Any ratio | denominator 0 → render `—`, never 0% |
| **Comparisons** | `AMOUNT` is **`FLOAT`** on both views. **Cast to `NUMBER(12,2)` before any equality or difference test.** v1 said "full precision in comparisons", which for a float means a stored 1,499.9999999999998 fails G1's entitlement match and becomes a finding |

### Per-group metrics

One row per group, each carrying count · AED · findings · AED above expected · **verdict source**.

| Group | Payment types | AED/yr *(requestor)* | Expected comes from | Evaluable today? |
| --- | --- | --- | --- | --- |
| **G1** Flight home | Airfare Ticket | 2,219,500 | Price list **AED 2,000 / 1,500 split by nationality** (D4.3) — ⚠ *the Filipina/other attribution is the requestor's; the discovery log records only the two amounts*. Service threshold **22 or 24 accumulated CC months — unreconciled, see MN-O11** | **Amount arm only.** The service-months arm renders `BLOCKED` on MN-O11 and N11 — **v2 will not pick a number on an open item worth two months of entitlement across AED 2.2M/yr** |
| **G2** Loyalty | Anti-attrition Incentive | 1,620,868 | 🔴 **Nothing. No payment scale exists anywhere** — 307 distinct amounts, 0–900 | **No.** Declared gap → MN8 |
| **G3** Referral / signing | Bonus, VIP Bonus | 844,916 | Each scheme's own price and conditions | Partly — 21 duplicates, AED 17,500 found. Referral arm needs N6 |
| **G4** Part-month / final salary | MV Prorated Salary, Prorated salary, Last Day CC Switch Adjustment, MV Extra Salary | 815,001 | **Recalculation** — ⚠ *v1 said "from the dates in the note itself" and marked this evaluable. The notes view has **one** date (`NOTE_DATE`): no salary, no contract start/end, no last working day, no divisor.* Needs D4.4 plus a salary and a stated pro-ration basis (calendar days vs 30-day month) | **No — `BLOCKED` until its inputs are named. MN-O18** |
| **G5** Salary corrections | Salary Dispute, Forgive Deduction, MOHRE requirement additions, Medical Assistance, Lost Luggage Compensation | 479,025 | The expense record (D2, **AED rows only until MN-O13**); what it cannot settle **routes to the verifier** | Yes, once the pivot (N12) lands |
| **G6** Raffle | Raffle Prize | 180,000 | The draw's winners list | **Identity only** — see below. Needs N11 |
| **G7** Reimbursements | Taxi Reimbursement, Maids.at other expenses, Accommodation Relocation, Passport Assistance, Flight ticket, Sim card, Cash advance, Transport fare | 159,652 | The expense record that authorised it (D2, **AED rows only**) — amount, beneficiary and approver must all agree. Receipt test reads `INVOICE_ATTACHED` as **`VARCHAR '00'/'01'`**, never as a boolean | Yes, once the pivot (N12) lands |
| **G8** Office work | Office Work Addition | 29,856 | — **excluded from the population** | n/a |
| **G9** No type | the one blank | 150 | — gate ❹ catches it; **count must be zero** | Yes |

*All 24 payment types are in a group; the groups sum to 16,159 payments and AED 6,348,968 exactly
(requestor's reconciliation).*

**Three design constraints the requestor established, carried verbatim because each has a reason:**

- **Do not build three obvious raffle gates.** Prize amounts, winner counts, and paid-twice-in-a-month
  each fire **zero times in six years and 3,408 payments**. G6 tests **identity only** — was this maid
  on that draw's winners list. A gate that cannot fire makes a check look thorough while testing
  nothing.
- **The duplicate test's key, which v1 never stated.** Default key:
  `HOUSEMAID_ID` + `ADDITION_REASON_ID` (N2) + `PURPOSE_ID` (N7) + `PAID_ON_PAYROLL_MONTH` — **never
  amount**. A group may override it; each override is recorded against that group. The match (§2.2a)
  runs **after** grouping, so it cannot collide with this test. **MN-O19: confirm per group.**
- **The duplicate test is per group or it is wrong.** Cancelling a deduction writes one note per day
  forgiven, so a maid correctly receives several identical-looking notes in a month. One shared
  duplicate rule raises **694 false alarms** on that group alone.
- **Two payment types are mislabelled and the expense record proves it.** 322 of 474 "Taxi
  Reimbursement" are a monthly transport allowance for live-out maids; all 82 "MOHRE requirement
  additions" are payroll error corrections. Rule ❼ catches both mechanically — no keyword guessing.
  **Consequence for G7: the receipt test applies only to the 152 genuine taxi trips** (474 − 322), because an
  allowance has no receipt.

### Tie-outs — the arithmetic that proves the month is whole

v1 had none. The population is defined by a heuristic match and a nullable window column, so without
an identity binding MN1 to something independent, **a month that silently loses 200 notes renders as
a clean, complete month.** Three identities, displayed on the report, each failure its own exception
row:

| ID | Identity | Catches |
| --- | --- | --- |
| **T1** | `MN1 = MN4 + MN5 + MN6` and `MN2 = Σ group AED` | A note that reached no bucket, or a group total that drifted from the population |
| **T2** | `MN2` for the month **=** the manager-note additions on the payroll run reached through **N9 `PAYROLL_ACCOUNTANT_TODO_ID`** | The window column failing. N9 was requested precisely so the two P&C payroll dashboards reconcile; v1 requested it and then used it nowhere |
| **T3** | Notes carrying a `PAYROLL_ACCOUNTANT_TODO_ID` but a **null `PAID_ON_PAYROLL_MONTH`** = 0 | ⚠ §2.2b treats a null window as "not yet paid, leaves the population by construction". **That is also exactly what a broken sync looks like.** T3 is what tells them apart |

**Lookback — v1 defined a one-month population and then wrote rules that reach outside it.** G1's
*"once only"* and *"24 accumulated CC months"*, and G3's second-bonus test, all need history. The
**reporting month stays one month**; each rule declares its own lookback, and a rule whose lookback
exceeds the ingested history renders `BLOCKED`, not clean:

| Rule | Lookback |
| --- | --- |
| G1 once-only | **All history** for that maid |
| G1 service months | All CC contract history, in exact days |
| G3 second bonus | Rolling 12 months |
| Duplicate test | The audit month only |
| Everything else | The audit month only |

### Guards — conditions under which a number must not be trusted

| ID | Guard | Behaviour |
| --- | --- | --- |
| **MG1** | `PAID_ON_PAYROLL_MONTH` not yet ingested (N1) | **Whole dashboard `BLOCKED`.** No correct month filter exists; do not render a partial month as a result |
| **MG2** | **Expense-match rate below its floor** | The share of notes expected to match that actually matched (denominator per MN-O17). Below the floor, MN3 and MN7 render `BLOCKED`, not low. **Provisional floor: 10 percentage points below the first month's observed rate**, so the guard is operative from day one rather than after the first measurement — replaced by a measured floor once compute exists (MN-O10) |
| **MG3** | Verifier (text-reading) unavailable | Notes routed to it render `pending`, never clean. MN7 falls accordingly and says why |
| **MG4** | A group's expected source missing (N11/N12) | That group renders `BLOCKED — awaiting <source>`. **Operative, v2: every note in that group goes to MN5 (pending, with reason) and into MN8 — never into MN6.** In v1 this guard changed no number, so a blocked group's notes sat in clean and inflated coverage. Each entry carries an expected-by date past which it escalates; **the date is watched by the P&C auditor at the monthly run, not by a scheduled process** |
| **MG5** | MN1 = 0 for the month | **`SKIPPED`, and that is a finding about the run, not a clean month.** ~1,347 notes/month is the norm; zero means the feed broke |

**Month verdict**, following the payroll-checks ladder so the two P&C dashboards read alike.
**The denominator is 7, not 9** — G8 is excluded from the population and G9 is caught by gate ❹, so
neither is a group rule; the ladder itself says *"exactly one group rule: G1 … G7"*:

```
any group has findings        → Fail
else any SKIPPED              → Fail (incomplete)
else any BLOCKED              → Partial — <n> of 7 group rules evaluated
else                          → Pass
```

---

## 4. Finalised UI report

**Archetype.** Exception / rule-breach list (the month's cases) over a coverage monitor (what the
month could and could not judge). The second is not decoration: this check's honest answer for a
quarter of the money is *"no rule exists"*, and a UI that cannot say so is lying by omission.

**KPI strip.** Notes in scope (MN1) · Money added (MN2) · **Findings AED (MN3)** · Findings count
(MN4) · Pending (MN5, count **and** AED) · **Coverage % (MN7)** · **Unevaluable money (MN8)**.
MN8 is a **subset of MN5** and the tile says so, so the two are never added together.

**Tie-out strip.** T1, T2 and T3 with their residuals — a dashboard whose own arithmetic does not
close says so on its face.

**Group register.** Nine rows, one per group, each: group · payment types · notes · AED ·
findings · AED above expected · verdict source · status badge · **13-month sparkline** ·
vs. last month. G2 renders permanently `BLOCKED — no payment scale exists`, and says so in words.

**Exception table.** One row per note (the case grain): note id · maid (**`HOUSEMAIDS_INFO.NAME`**,
D4.1, + `HOUSEMAID_ID`) ·
payment type · group · amount · expected · **above expected** · rule that fired · verdict ·
`PAID_ON_PAYROLL_MONTH` · `NOTE_DATE` · requested by · approved by · matched expense payment (or
*unmatched*). Sorted by **above expected** descending.

⚠ **No case-status column in v1 of the build.** A reviewed/open state is auditor workflow, which
needs somewhere to write it back to — and where that goes is exactly the unresolved **MN-O7** (the
ERP already has `CONFIRMED_AMOUNT_BY_AUDITOR` and `CONFIRMED_REPEATED_BY_AUDITOR` on the note).
Ship without it, or resolve MN-O7 first.

**Drill-down.** The note text in full, the expense record it matched and how (which predicates hit),
the rule that fired with its condition, and the arithmetic. Nothing withheld — §2.4.

**Trend rules** (carried from the payroll-checks spec so the two dashboards behave alike): the
denominator travels with every ratio; a `BLOCKED` or `SKIPPED` month is a **gap in the line, not a
zero**; restatements show both values; 13-month rolling window.

**Mockup.** https://claude.ai/code/artifact/a08a0bea-96cf-4ea3-af21-ccced5c94a5d — synthetic values throughout.

**Audit month.** Defaults to the most recent **closed** payroll month — not simply the previous
calendar month. A month still moving is not auditable, and the payroll-checks spec's lock signal
(`MONTHLYPAYMENTRULES.AUDITING_FINISHED`) is the same signal here.

**Delivery.** A link. No emailed report body. Manual refresh — **this dashboard is not scheduled**,
consistent with the Notion page and with the standing rule that recurring data processes go through
the ERP team rather than ad hoc warehouse queries.

---

## 5. Worked examples

*Synthetic values throughout; no real record is reproduced.*

**A — clean.** Taxi reimbursement, AED 120. Matched to an expense payment (maid id + addition reason
+ text), `STATUS = PAID`, `AMOUNT = 120`, beneficiary and approver agree. G7 satisfied.
→ **clean**, contributes 0 to MN3.

**B — finding on amount alone.** Airfare Ticket, AED 1,000. Nationality read from **D4.3**; G1's
price list holds only 2,000 and 1,500. The amount matches **no** entitlement, so the rule is not met
and the expected amount is **0**. → **finding**, `above expected = 1,000`. *(One of the 3 the
requestor found at AED 1,000.)*
⚠ **The rest of G1 does not follow from this.** The once-only and service-months arms are `BLOCKED`
(MN-O11, N11), so every *other* G1 note is `pending`, not clean — the amount arm firing does not
make the group evaluated.

**C — finding at zero, which is the counter-intuitive one.** Airfare Ticket, AED 0. Gate ❺ fires
first: a payment of zero dirhams is an exception whatever its type.
→ **pending** by gate ❺ — **not** a finding, and **not** clean. It moves no money, so MN3 is
unaffected, but it appears in MN5 and in the case list. *(125 of these exist in twelve months.)*
**Note the ordering matters**: ❺ precedes G1, so a zero airfare is reported as an exception to
investigate rather than as an AED 0 overpayment.

**D — clean, and the case that must not trip the duplicate rule.** Six identical
deduction-cancellation additions for one maid in one month. Each forgives a separate day. The
duplicate test runs **inside the group**, keyed on the group's own key — not on amount.
→ **six clean cases.** A shared duplicate rule keyed on amount would raise 694 false alarms a year
on this group alone.

**F — the case v1 got wrong, and the reason for v2.** A raffle prize, AED 500, to a maid whose
name is on no winners list the warehouse holds — because **the winners list is not in the warehouse
at all** (N11). G6 is `BLOCKED`.
→ **pending**, into MN5 and MN8. **Under v1 it was clean**: MG4 blocked the group on screen but
changed no number, and MN6-as-remainder swept the note into clean and into coverage's numerator.
That is the exact failure this spec names in §3 — occurring inside the spec itself.

**E — the honest gap.** Anti-attrition Incentive, AED 700. G2 has no payment scale anywhere: 307
distinct amounts between 0 and 900, nothing written down that says what she should get.
→ **pending**, reason *"no rule exists for this payment type"*, contributing to **MN8**. Not clean.
The terminal catch-all ❾ is what stops this reading as a pass.

---

## 6. Open items

| ID | Item | Owner |
| --- | --- | --- |
| MN-O1 | ✅ **Closed.** `EMPLOYEE_MANAGER_ID` unmapped since PAY-3484 — `MANAGER` will never fill. Use `FROM_MANAGER_ID` / `CREATOR` (N8) | — |
| MN-O2 | ✅ **Closed.** No FK; heuristic match, ERP's own. Match rate becomes guard MG2 | — |
| MN-O3 | ✅ **Closed.** `PAID_ON_PAYROLL_MONTH` is the population date; the 216 postponed notes fall out by construction | — |
| MN-O4 | ✅ **Closed.** Seven `NOTE_TYPE` values; only `ADDITION` / `DEDUCTION` live for housemaids | — |
| **MN-O5** | Deduction feed — amounts stopped Oct 2025, rows after 24 Dec 2025. If the view now carries rows past that date, the reason for excluding deductions has changed. **Needs compute (DNA-9437)** | P&C + Data |
| **MN-O6** | **G2 has no payment scale.** AED 1.62M/yr, a quarter of the money, with no possible test. A dashboard makes this *more* visible than a flow would: it renders as a permanently blocked row. Decide what it should say | P&C |
| **MN-O7** | **The ERP already has `CONFIRMED_AMOUNT_BY_AUDITOR` and `CONFIRMED_REPEATED_BY_AUDITOR` on the note.** Does this check duplicate an existing control, or are these its write-back target? Answer before the UI is built | P&C + Payroll |
| **MN-O8** | **Not a data request.** `PENALTY_DEDUCTION` is API-settable only, bypasses the payroll lock, is excluded from the payroll queries that catch `DEDUCTION`, and has no refund path | Payroll integrity |
| **MN-O9** | **§2.4 differs from the Notion page** on showing per-maid amounts on screen. Access-control posture vs counts-and-totals. Business owner's call | Jacky |
| **MN-O10** | **MG2's floor.** What match rate is low enough to distrust MN3? Cannot be set without compute | P&C + Data |
| **MN-O11** | **G1's 22-vs-24 months.** The checklist says 22, the payroll team's 110 postponement notes say 22, the policy behind the automatic payment says 24. Two months of entitlement on AED 2.2M, unreconciled — and *pending legal sign-off* per the rule page | P&C + Legal |
| **MN-O12** | **11 of the 20 rules are `Pending Business` or `Pending Technical`.** Only 3 are `Live`. The dashboard cannot be built past those | P&C |

| **MN-O13** | **The AED basis on `EXPENSES_PAYMENTS`.** Which `CURRENCY_ID` is AED, which column is already AED, and the FX source + as-of date for the rest. MN3 crosses a currency boundary without it | Data team |
| **MN-O14** | **Gate ❽ should read the maid type *snapshotted at payroll time*, not her current record.** `HOUSEMAIDS_INFO.HOUSEMAID_TYPE` is current; the payroll spec's `SALARY_TYPE` is the snapshot and is not yet in Snowflake | Data team |
| **MN-O15** | **Check `INSIGHTS_DASHBOARD_CONTAINER` for approved MN1/MN2 definitions** and reuse verbatim, or record that none exists. Could not be read — no compute | Data team |
| **MN-O16** | **Does MaidsInsights read through the viewer's own role or a shared service account?** The unmasked design in §2.4 rests entirely on the former | Data team |
| **MN-O17** | **Which notes are *expected* to have an expense record?** ❻b and MG2's denominator both need it; nothing in D1–D4 or N1–N12 identifies the subset. The two-thirds figure is a historical assertion, not a per-note field | P&C + Data |
| **MN-O18** | **G4's recalculation inputs.** Which salary, which dates, and calendar days or a 30-day month | P&C + Payroll |
| **MN-O19** | **Confirm the duplicate key per group** (default proposed in §3) | P&C |
| **MN-O20** | **Map the 20 Notion rules to the 9 gates and 7 group rules**, carrying each rule's status. A builder cannot currently reconcile *"only 3 Live"* with three groups marked evaluable | P&C |

**Blocking the build:** N1, N2, **N12**, N11, MN-O9, MN-O11, MN-O12, MN-O13, MN-O16, MN-O17.

---

## 7. What the audit gate changed, and what it did not

The `spec-auditor` gate returned **10 critical and 15 major** findings against v1. What follows is
the honest accounting, because a spec that quietly absorbs an audit is worse than one that shows it.

**Fixed in v2.** MN6 redefined positively and MN7 with it — v1's coverage metric reduced
algebraically to `1 − MN5/MN1`, so no blocked group could move it. MG4 made operative, which was the
same bug seen from the other end: a blocked group's notes sat in *clean*, in the spec's own mockup,
and inflated coverage by 24 cases. ❻ split into matched-disagrees and expected-but-unmatched. ❼'s
verdicts defined. The multi-currency expected side. D4 added, giving gate ❽, G1's price split and the
maid name actual data points instead of none. N12 added — without the pivot, N2 was a blocking
request that unblocked nothing. Tie-outs T1–T3, which v1 lacked entirely. MN1's lifecycle filter.
Null, negative-amount and float-precision rules. G1 and G4 moved to `BLOCKED` rather than asserting
numbers on open items. The approved-KPI check recorded. §2.4 made conditional and blocking.

**Not fixed, and deliberately so.** MN-O17 (which notes should match) and MN-O18 (G4's inputs) are
business answers, not drafting: guessing them would put invented logic in a spec whose entire value
is that it does not invent. MN-O20's rule-to-gate mapping needs the requestor's own numbering.
MN-O13 and MN-O16 are the data team's to answer.

**Two audit findings I did not accept.** The auditor read the mockup's *"6 of 9 groups evaluated"*
as counting an excluded group and a gate — correct, and fixed to 7 — but also proposed folding the
G9 count into the population expectation; G9's *"count must be zero"* is a control in its own right
and stays visible. And it flagged the mockup's audit month as inconsistent with "previous calendar
month"; the mockup deliberately shows a **closed, locked** month rather than one still moving, which
is the right default for an audit and is now stated in §4.

---

## 8. What still has to happen

1. **Step 1 playback** — this document is the playback; the requestor approves point by point.
2. **Feedback loop (Step 4)** — the audit gate did the first pass' work. The 20 open items are the
   question bank; MN-O9, O11, O17, O18 and O20 need the requestor, and until they are answered the
   loop is not closed.
3. **`spec-auditor` gate** — run against v1, 10 critical / 15 major, accounted for in §8. **Re-run
   against v2 before delivery.**
4. **The dashboard cannot be built yet**, and the reason is not this spec: 11 of the 20 rules are
   still `Pending Business` or `Pending Technical` (MN-O12), and four data items are blocking.
