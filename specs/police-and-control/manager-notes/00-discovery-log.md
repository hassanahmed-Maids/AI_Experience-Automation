# Manager Notes → MaidsInsights — discovery log

Pipeline: `audit-spec-builder` (Police & Control Audit Spec Builder plugin).
Source of the business logic: the existing Notion spec, **Manager Notes**
(Audit Flow Factory / Both Maids / Checks — Both Maids), last edited 2026-09-01,
status *Under spec'ing*, owner Jacky, module Payroll, check type *Money out*.

This log records Step 0 (preflight) and Step 2 (does the data exist), with the evidence.
It is not the spec — the spec follows once the feedback loop closes.

---

## Step 0 — Preflight

| Dependency | Status |
| --- | --- |
| Snowflake connector | **Connected, no compute.** `SELECT CURRENT_ACCOUNT(), CURRENT_ROLE(), CURRENT_WAREHOUSE()` → `IH42925` · `PAYROLL_AND_MONEY_CONTROL_ROLE` · **empty warehouse**. Metadata (`SHOW`, `DESC VIEW`) works; anything needing compute does not. Same block as the payroll spec — **DNA-9437** |
| Ask the Code token | Not yet needed. Required at Step 3, once the ingestion gaps below are confirmed |

**What the missing warehouse costs this spec.** Every count on the Notion page — 16,159
payments, AED 6,348,968, the 128 airfare failures, the 21 duplicate bonuses, the 694 false
alarms — was measured by someone with compute. None of it can be re-verified here. The figures
are carried forward as **the requestor's**, attributed, not re-derived. Where a rule's design
depends on a distribution nobody has measured, it is marked as such rather than assumed.

---

## The move changes the check's shape — read this first

The Notion spec is written for a **flow**: per-maid ERP calls, a 500-call budget, batching
constraints, an AI agent invoked on a subset. A MaidsInsights dashboard over Snowflake is a
different machine, and three things move.

**1. The single biggest blocker on the Notion page disappears.** That page says a bulk ERP route
is *"the one thing blocking the build"*, because every usable route is one call per maid and
~1,000 maids a month will not fit a 500-call budget. **In the warehouse there is no call budget
and no per-maid walk** — the population is one query. The bulk-route request is not needed for
the dashboard. It stays needed for anything that must read the ERP live.

**2. The AI-agent step gets easier, not harder.** 22% of notes (3,511 of 16,159) need a person to
read what a manager typed. That text is `NOTE_REASON`, and it is **already in the warehouse**
(see D1.5). Classifying it is a column operation over a table rather than an agent walking
records one at a time.

**3. A new constraint appears where the flow had none.** A flow can call the ERP for any field it
needs. A dashboard can only read what has been ingested — and the Manager Notes view is
**10 columns of a much wider ERP entity**. Seven fields the rules depend on are not there. On a
flow those were an API call; here they are an ingestion request, and until they land the rules
that need them cannot be built as designed.

---

## Step 2 — Does the data exist in Snowflake?

### D1 — The notes themselves — **EXISTS**

`BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_MANAGER_NOTES`
*(evidence: `SHOW TERSE VIEWS LIKE '%MANAGER_NOTE%' IN DATABASE BA_VIEWS`, then `DESC VIEW`)*

| # | Column | Type | Notes |
| --- | --- | --- | --- |
| D1.1 | `ID` | `NUMBER` | The note. **One case = one note**, so this is the case grain. Range 5–183,975 |
| D1.2 | `HOUSEMAID_ID` | `NUMBER` | Join key to the maid. Range 1–138,006 |
| D1.3 | `NOTE_TYPE` | `VARCHAR` | **`ADDITION`, `DEDUCTION`, `PENALTY_DEDUCTION`** — the population filter. Note there are **three** values, not two; the Notion page names only additions and deductions |
| D1.4 | `AMOUNT` | `FLOAT` | The actual. Range **−3,032 – 44,230.26** — negatives exist on a view that includes deductions |
| D1.5 | `NOTE_REASON` | `VARCHAR` | **Free text — what the manager typed.** This is the AI-agent input, and it is already here |
| D1.6 | `REASON` | `VARCHAR` | **The payment type.** `COALESCE(a.NAME, d.NAME)` over `mmdb.picklists_items` — the picklist name, which is what the 24 payment types and the nine groups are keyed on |
| D1.7 | `NOTE_DATE` | `TIMESTAMP_NTZ` | The note's own date, from 2016-11-21. **Not the payroll month** — see the open decision below |
| D1.8 | `MANAGER` | `NUMBER` | ⚠ **Profiles to "no non-null values" — the column is empty.** See the finding below |
| D1.9 | `REQUESTED_BY` | `VARCHAR` | From `USERS_INFO.NAME`, via the expense-payment join |
| D1.10 | `APPROVED_BY` | `VARCHAR` | From `mmdb.expensepayments.APPROVED_BY`, same join |

> ⚠ **A check called "Manager Notes" cannot currently group by manager.** `MANAGER`
> (`EMPLOYEE_MANAGER_ID`) is present in the view and **empty for every row**. Any UI that ranks
> managers by findings, or any rule that treats one manager's pattern as a signal, has no column
> to stand on. `REQUESTED_BY` and `APPROVED_BY` are populated and are the usable actor columns —
> but they come from the *expense payment*, so they exist only for notes that have one. **This
> needs a decision (MN-O1) and it is not in the Notion page.**

### D2 — The expense record behind the note — **EXISTS, join unproven**

`BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_PAYMENTS` — 34 columns *(evidence: `DESC VIEW`)*

Two thirds of notes are supposed to be matched to the expense record that authorised them, so
this view carries the **expected** side of the comparison for most of the population. It has what
that needs: `AMOUNT`, `AMOUNT_TO_PAY`, `STATUS` (`PAID`, `PAID_PENDING_INVOICE`, `DISMISSED`,
`PENDING`), `EXPENSE_ID` (the expense type, 3–1,970), `DESCRIPTION`, `NOTES`, `APPROVED_BY`,
`PAID_BY`, `PAYMENT_REQUESTED_BY`, `REQUIRES_INVOICE` / `INVOICE_ATTACHED` / `INVOICE_NUMBER`,
and `PAYMENT_METHOD` — whose values include **`SALARY`**, which is how a maid-facing expense
reaches a payslip.

It is scoped to a maid two ways: `RELATED_TO_TYPE = 'MAID'` with `RELATED_TO_ID`, and
`BENEFICIARY_TYPE = 'MAID'`.

> ⛔ **But there is no note→payment key in either view.** `HOUSEMAID_MANAGER_NOTES` has no
> expense-payment id, and `EXPENSES_PAYMENTS` has no note id. The Notion page says two thirds of
> notes *"name the expense record that authorised them"* — if that naming lives in `NOTE_REASON`
> text rather than a foreign key, the match is a text parse, not a join, and its accuracy becomes
> a stated risk rather than an assumption. **This is the first thing to settle: MN-O2.**
> The related-to and beneficiary columns give a maid-level candidate set; they do not identify
> *which* payment authorised *which* note when a maid has several in a month.

### Related views also present (not yet assessed)

`MONEY_CONTROL_SILVER`: `EXPENSES_REQUESTS`, `EXPENSES_CONFIGURATION`, `EXPENSES_HIERARCHY`,
`EXPENSE_REQ_TRANSACTIONS_LINKING`, `DUPLICATE_EXPENSES`, `EXPENSES_REFUNDS_HISTORY`.
`EXPENSES_CONFIGURATION` is the likely home of the **price lists** the rules compare against
(the airfare 2,000 / 1,500 entitlement, for one). `EXPENSE_REQ_TRANSACTIONS_LINKING` is the
first place to look for the missing note→payment link.

### D3 — MISSING: the seven ERP fields the view does not carry

Named on the Notion page, confirmed absent from `DESC VIEW`:

| Field | What it is for | Consequence while missing |
| --- | --- | --- |
| `PAYROLL_MONTH` | The month the note actually pays in | The population can only be windowed on `NOTE_DATE`, which is the wrong date for 216 postponed notes — see MN-O3 |
| `PAID_ON_PAYROLL_MONTH` | Whether it was paid in that month | Cannot separate "entitled" from "paid" |
| `PURPOSE_ID` | Structured purpose | A rule that should read a field reads text instead |
| `IS_REFUND` | Refund flag | Same |
| `APPLIED`, `PAID` | Lifecycle state | A note that was never applied cannot be excluded |
| `REFERRED_MAID_ID` | Who was referred | The referral-bonus rule cannot verify the referral |
| `OLD_NOTE_ID` | Supersession chain | A corrected note may be counted as a duplicate of the note it replaces |

All seven are on `PAYROLLMANAGERNOTES` (entity `PayrollManagerNote`), which is already the source
of the existing view — **a projection, not a new pipeline**, exactly as with the payroll spec.

---

## Open items — Manager Notes

| ID | Question | Owner |
| --- | --- | --- |
| **MN-O1** | **`MANAGER` is empty.** Does the dashboard need per-manager attribution? If yes this is an ingestion item; if no, say so and drop the column from the design rather than shipping a dead field | P&C |
| **MN-O2** | **How does a note point at its expense payment?** A foreign key, or text in `NOTE_REASON`? This decides whether "matched, not read" is a join or a parse, and it sets the accuracy ceiling for two thirds of the population | Ask the Code, then P&C |
| **MN-O3** | **Which date windows the run** — carried from the Notion page, unchanged and still blocking. `NOTE_DATE` is in the view; `PAYROLL_MONTH` is not, so today only one of the two candidates is even available | P&C |
| **MN-O4** | **`NOTE_TYPE` has three values, not two.** `PENALTY_DEDUCTION` is named nowhere in the Notion spec. In scope, out of scope, or a third thing? | P&C |
| **MN-O5** | **Does the deduction feed still stop?** The Notion page says amounts stopped in Oct 2025 and rows after 24 Dec 2025. If the warehouse view carries deduction rows past that date, the reason for excluding deductions has changed and should be re-examined. Needs compute to check — blocked on DNA-9437 | P&C + Data |
| **MN-O6** | **G2 (Anti-attrition Incentive) has no payment scale** — AED 1.62M/yr, a quarter of the money, with no test that can work. Carried forward as a declared gap. A dashboard makes this *more* visible than a flow did: it will render as a permanently unevaluable tile unless P&C decides what it should say | P&C |

---

## Next

1. Play the business spec back to the requestor (Step 1) — the control, the reader, the action.
2. Ask the Code on MN-O2 and D3, once a token is to hand (Step 3).
3. Feedback loop (Step 4) — at least two passes, announced.
4. UI artifact (Step 5), then the spec (Step 6), then the `spec-auditor` gate.
