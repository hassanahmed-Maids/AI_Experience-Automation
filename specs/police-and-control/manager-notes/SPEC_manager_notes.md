# Spec — Manager Notes

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Business owner / reviewer** | Jacky (maker–checker; money-out payroll check) |
| **Spec version** | v1 — draft |
| **Date** | 2026-09-03 |
| **Delivered on** | **MaidsInsights**, over **Snowflake**. The two are not interchangeable: MaidsInsights is the dashboard the auditor opens; Snowflake is the warehouse, role and SQL underneath |
| **Replaces** | Nothing running. The Notion page *Manager Notes* (Audit Flow Factory / Both Maids) specified this as a flow; it was never built. This spec re-expresses it as a dashboard |
| **UI mockup** | https://claude.ai/code/artifact/a08a0bea-96cf-4ea3-af21-ccced5c94a5d |
| **Status** | Draft — Step 1 playback and the feedback loop are still open |

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
  error — rule ❺ exists for this.
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

### 2.3 Ingestion request — all on `PAYROLLMANAGERNOTES`, so a projection, not a pipeline

Every field below is a confirmed column on the table that already feeds the view.

| ID | Column | Type | Why the check needs it | Without it |
| --- | --- | --- | --- | --- |
| **N1** | `PAID_ON_PAYROLL_MONTH` | `DATE` | **The population date** (§2.2b) | The whole check has no correct month filter. **Blocking** |
| **N2** | `ADDITION_REASON_ID` | `BIGINT` | The structured half of the expense match; the group key behind D1.6's label | Match falls back to text + amount alone. **Blocking for MN3/MG2** |
| **N3** | `APPLIED`, `PAID` | `TINYINT(1)` | Lifecycle. A note never applied is not a payment | Unapplied notes counted as money out |
| **N4** | `IS_REFUND`, `REFUNDED_NOTE_ID` | `TINYINT(1)`, `BIGINT` | The **refund** chain | A refund reads as a duplicate |
| **N5** | `OLD_NOTE_ID` | `BIGINT` | The **supersession** chain — *a different chain from N4* | A corrected note counted as a duplicate of the note it replaced |
| **N6** | `REFERRED_MAID_ID` | `BIGINT` | G3 cannot verify a referral without it | The referral bonus rule is unevaluable |
| **N7** | `PURPOSE_ID` | `BIGINT` | Structured purpose, so a rule reads a field not text | Text fallback |
| **N8** | `FROM_MANAGER_ID`, `CREATOR`, `LAST_MODIFIER` | `BIGINT` | Actor attribution, replacing dead `MANAGER` | No per-manager view (MN-O1) |
| **N9** | `PAYROLL_ACCOUNTANT_TODO_ID` | `BIGINT` | Links the note to the payroll run that paid it — **the same `PayrollAccountantTodo` the payroll-checks spec is built on**, so the two checks can be reconciled | The two P&C payroll dashboards cannot be tied together |
| **N10** | `CONFIRMED_AMOUNT_BY_AUDITOR`, `CONFIRMED_REPEATED_BY_AUDITOR` | `TINYINT(1)` | ⚠ See MN-O7 — the ERP **already has auditor-confirmation flags on the note** | Unknown whether this check duplicates an existing control |
| **N11** | The winners list for G6, and the price/entitlement lists for G1 and G3 | — | The **expected** side for three groups. Source not yet identified; `EXPENSES_CONFIGURATION` is the first place to look | G1, G3, G6 have no expected value to compare against |

### 2.4 Sensitive-data handling

This check touches salaries and per-maid amounts. Following the posture agreed for the payroll-checks
dashboard: **the control is access, not masking.** The reader is an auditor working a money-out case
against a named maid; a masked name and a banded amount cannot be reconciled to the ERP. So the
dashboard shows the maid, the note text and the amount in full, and instead:

1. reads through a **named-auditor Snowflake role**, membership owned and reviewed;
2. **logs views and exports**;
3. is **delivered as a link — never an emailed report body**;
4. exports no wider than the screen.

⚠ **This differs from the Notion page**, which says *"individual amounts never appear in chat, a run
summary or an email. Counts and totals only."* Those two are reconcilable — nothing goes in an email
either way — but the on-screen rule is genuinely different, and it is **Jacky's call as business
owner**. **MN-O9.**

⚠ If MaidsInsights reads through a **shared service account** rather than the viewer's own role,
control 1 does not work as written. Same open question as the payroll spec (O31).

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
❻ named expense missing/≠    → finding
❼ expense head ≠ type        → route to verifier
❽ contract type cannot receive → finding
   duplicates: tested inside the group, never once across all payments
   ── exactly one group rule: G1 … G7 ──
❾ nothing settled it         → pending, with its reason      ← terminal catch-all
```

**The terminal catch-all is the load-bearing rule.** Without ❾ an unevaluable note renders as clean,
which is the failure mode that makes an audit dashboard worse than no dashboard.

### Headline metrics

| ID | Metric | Formula | Notes |
| --- | --- | --- | --- |
| **MN1** | Notes in scope | `COUNT(D1.1)` where `NOTE_TYPE = 'ADDITION'` and `PAID_ON_PAYROLL_MONTH` in the audit month | The denominator for everything below. ~1,347/month expected |
| **MN2** | Money added | `SUM(D1.4)` over MN1 | ~AED 529,000/month expected |
| **MN3** | **Findings — AED above expected** | `SUM(GREATEST(actual − expected, 0))` over notes whose verdict is *finding* | **The headline.** Where no rule was met, `expected = 0` and the whole amount is the finding |
| **MN4** | Findings — count | `COUNT` of notes with verdict *finding* | |
| **MN5** | Pending — count and AED | `COUNT` and `SUM(D1.4)` where verdict is *pending* | **Amber, never folded into clean.** Includes every ❾ note |
| **MN6** | Clean — count and AED | remainder | |
| **MN7** | **Coverage** | `(MN4 + MN6) / MN1` | The share of the month that actually reached a verdict. **A dashboard reporting few findings on low coverage is reporting nothing** |
| **MN8** | Unevaluable money | `SUM(D1.4)` over groups with no working rule — today **G2 alone** | ~AED 135,000/month (AED 1.62M/yr). Rendered as its own tile, not hidden inside pending |

### Per-group metrics

One row per group, each carrying count · AED · findings · AED above expected · **verdict source**.

| Group | Payment types | AED/yr *(requestor)* | Expected comes from | Evaluable today? |
| --- | --- | --- | --- | --- |
| **G1** Flight home | Airfare Ticket | 2,219,500 | Price list: **AED 2,000 Filipina / 1,500 other**, plus 24 accumulated CC months in exact days, once only | **Partly — 128 of 1,358 fail on amount alone** (125 at zero, 3 at 1,000). Service-months arm needs N11 |
| **G2** Loyalty | Anti-attrition Incentive | 1,620,868 | 🔴 **Nothing. No payment scale exists anywhere** — 307 distinct amounts, 0–900 | **No.** Declared gap → MN8 |
| **G3** Referral / signing | Bonus, VIP Bonus | 844,916 | Each scheme's own price and conditions | Partly — 21 duplicates, AED 17,500 found. Referral arm needs N6 |
| **G4** Part-month / final salary | MV Prorated Salary, Prorated salary, Last Day CC Switch Adjustment, MV Extra Salary | 815,001 | **Recalculation from the dates in the note itself** | Yes |
| **G5** Salary corrections | Salary Dispute, Forgive Deduction, MOHRE requirement additions, Medical Assistance, Lost Luggage Compensation | 479,025 | The expense record; what it cannot settle **routes to the verifier** | Yes |
| **G6** Raffle | Raffle Prize | 180,000 | The draw's winners list | **Identity only** — see below. Needs N11 |
| **G7** Reimbursements | Taxi Reimbursement, Maids.at other expenses, Accommodation Relocation, Passport Assistance, Flight ticket, Sim card, Cash advance, Transport fare | 159,652 | The expense record that authorised it — amount, beneficiary and approver must all agree | Yes |
| **G8** Office work | Office Work Addition | 29,856 | — **excluded from the population** | n/a |
| **G9** No type | the one blank | 150 | — gate ❹ catches it; **count must be zero** | Yes |

*All 24 payment types are in a group; the groups sum to 16,159 payments and AED 6,348,968 exactly
(requestor's reconciliation).*

**Three design constraints the requestor established, carried verbatim because each has a reason:**

- **Do not build three obvious raffle gates.** Prize amounts, winner counts, and paid-twice-in-a-month
  each fire **zero times in six years and 3,408 payments**. G6 tests **identity only** — was this maid
  on that draw's winners list. A gate that cannot fire makes a check look thorough while testing
  nothing.
- **The duplicate test is per group or it is wrong.** Cancelling a deduction writes one note per day
  forgiven, so a maid correctly receives several identical-looking notes in a month. One shared
  duplicate rule raises **694 false alarms** on that group alone.
- **Two payment types are mislabelled and the expense record proves it.** 322 of 474 "Taxi
  Reimbursement" are a monthly transport allowance for live-out maids; all 82 "MOHRE requirement
  additions" are payroll error corrections. Rule ❼ catches both mechanically — no keyword guessing.
  **Consequence for G7: the receipt test applies only to the 151 genuine taxi trips**, because an
  allowance has no receipt.

### Guards — conditions under which a number must not be trusted

| ID | Guard | Behaviour |
| --- | --- | --- |
| **MG1** | `PAID_ON_PAYROLL_MONTH` not yet ingested (N1) | **Whole dashboard `BLOCKED`.** No correct month filter exists; do not render a partial month as a result |
| **MG2** | **Expense-match rate below its floor** | The share of notes expected to match that actually matched. Below the floor, MN3 and MN7 render `BLOCKED`, not low. **Floor to be set once measurable — MN-O10** |
| **MG3** | Verifier (text-reading) unavailable | Notes routed to it render `pending`, never clean. MN7 falls accordingly and says why |
| **MG4** | A group's expected source missing (N11) | That group renders `BLOCKED — awaiting <source>`, with an expected-by date past which it escalates |
| **MG5** | MN1 = 0 for the month | **`SKIPPED`, and that is a finding about the run, not a clean month.** ~1,347 notes/month is the norm; zero means the feed broke |

**Month verdict**, following the payroll-checks ladder so the two P&C dashboards read alike:

```
any group FAIL                → Fail
else any SKIPPED              → Fail (incomplete)
else any BLOCKED              → Partial — <n> of 9 groups evaluated
else                          → Pass
```

---

## 4. Finalised UI report

**Archetype.** Exception / rule-breach list (the month's cases) over a coverage monitor (what the
month could and could not judge). The second is not decoration: this check's honest answer for a
quarter of the money is *"no rule exists"*, and a UI that cannot say so is lying by omission.

**KPI strip.** Notes in scope (MN1) · Money added (MN2) · **Findings AED (MN3)** · Findings count
(MN4) · Pending (MN5) · **Coverage % (MN7)** · **Unevaluable money (MN8)**.

**Group register.** Nine rows, one per group, each: group · payment types · notes · AED ·
findings · AED above expected · verdict source · status badge · **13-month sparkline** ·
vs. last month. G2 renders permanently `BLOCKED — no payment scale exists`, and says so in words.

**Exception table.** One row per note (the case grain): note id · maid (name + `HOUSEMAID_ID`) ·
payment type · group · amount · expected · **above expected** · rule that fired · verdict ·
`PAID_ON_PAYROLL_MONTH` · `NOTE_DATE` · requested by · approved by · matched expense payment (or
*unmatched*) · status. Sorted by **above expected** descending.

**Drill-down.** The note text in full, the expense record it matched and how (which predicates hit),
the rule that fired with its condition, and the arithmetic. Nothing withheld — §2.4.

**Trend rules** (carried from the payroll-checks spec so the two dashboards behave alike): the
denominator travels with every ratio; a `BLOCKED` or `SKIPPED` month is a **gap in the line, not a
zero**; restatements show both values; 13-month rolling window.

**Mockup.** https://claude.ai/code/artifact/a08a0bea-96cf-4ea3-af21-ccced5c94a5d — synthetic values throughout.

**Delivery.** A link. No emailed report body. Manual refresh — **this dashboard is not scheduled**,
consistent with the Notion page and with the standing rule that recurring data processes go through
the ERP team rather than ad hoc warehouse queries.

---

## 5. Worked examples

*Synthetic values throughout; no real record is reproduced.*

**A — clean.** Taxi reimbursement, AED 120. Matched to an expense payment (maid id + addition reason
+ text), `STATUS = PAID`, `AMOUNT = 120`, beneficiary and approver agree. G7 satisfied.
→ **clean**, contributes 0 to MN3.

**B — finding on amount alone.** Airfare Ticket, AED 1,000. G1's price list holds only 2,000 and
1,500. Expected for a non-Filipina maid = 1,500; actual 1,000. The amount matches **no** entitlement,
so the rule is not met and the expected amount is **0**.
→ **finding**, `above expected = 1,000`. *(This is one of the 3 the requestor found at AED 1,000.)*

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

**Blocking the build: N1, N2, N11, and MN-O12.**

---

## 7. What still has to happen

1. **Step 1 playback** — this document is the playback; the requestor approves point by point.
2. **Feedback loop (Step 4)** — not yet run. Expect at least two passes.
3. **UI artifact (Step 5)** — after the loop, with the requestor's own examples as visible rows.
4. **`spec-auditor` gate (Step 6)** — before delivery.
