# Manager Notes — Ask the Code answers (2026-09-03)

Module `erp/magnamedia-payroll-management`. Four questions, four answers, verbatim findings below.
These close MN-O1 through MN-O4 and open three things nobody had asked about.

---

## 1. How a note points at its expense payment — **there is no foreign key**

> **No FK** from `PAYROLLMANAGERNOTES` to `EXPENSEPAYMENTS`, `EXPENSEREQUESTTODOS`, or `EXPENSES`.

The association is made by **field copy** at creation time, in
`ManagerNoteService.processExpenseRequestTodo`:

| Note column | Copied from |
| --- | --- |
| `NOTE_REASONE` | `EXPENSEREQUESTTODOS.DESCRIPTION` (text copy) |
| `AMOUNT` | `EXPENSEREQUESTTODOS.AMOUNT` |
| `REFERRED_MAID_ID` | `EXPENSEREQUESTTODOS.REFERRED_MAID_ID` |
| `HOUSEMAID_ID` | `EXPENSEREQUESTTODOS.RELATED_TO_ID` (where `RELATED_TO_TYPE = MAID`) |
| `ADDITION_REASON_ID` | `EXPENSES.SALARY_ADDITION_TYPE_ID`, via `EXPENSEREQUESTTODOS.EXPENSE_ID` |
| `PURPOSE_ID` | `EXPENSEREQUESTTODOS.PURPOSE_ADDITIONAL_DESCRIPTION_ID` |

**The ERP's own reverse lookup** — what its repository does when it needs to get back:

```
HOUSEMAID_ID + ADDITION_REASON_ID + NOTE_REASONE LIKE '%…%'
```

**The chain to the payment**, none of it on the note row:

```
PAYROLLMANAGERNOTES  --(heuristic: maid + addition reason + text)-->  EXPENSEREQUESTTODOS
EXPENSEREQUESTTODOS.EXPENSE_PAYMENT_ID  -->  EXPENSEPAYMENTS
EXPENSEREQUESTTODOS.EXPENSE_ID          -->  EXPENSES
```

### What this means for the check — **MN-O2 closes, and the answer costs something**

The Notion page says two thirds of notes *"name the expense record that authorised them, so they are
matched, not read."* That is true in substance and misleading in mechanism. **Nothing names
anything.** The note carries a *copy* of the expense request's description and amount, and matching
back is a heuristic — the ERP's own, which is the best available authority, but still three
predicates and a `LIKE`.

Three consequences the spec has to state rather than assume away:

1. **`ADDITION_REASON_ID` is the strong part of the match and it is structured.** It is not in the
   Snowflake view. Ingesting it turns the match from "text and amount" into "reason id, plus text
   and amount" — a materially better join. **This is the single highest-value field in the
   ingestion request.**
2. **The match has a false-positive mode with a name.** A maid with two notes in one month at the
   same amount and the same addition reason cannot be told apart by this lookup. That is precisely
   the population the duplicate rule (G3) is about, so the duplicate rule and the match rule
   interact — the spec must say which runs first.
3. **A match rate is a number the dashboard should show, not hide.** If 2 of 3 notes are supposed to
   match and only, say, half do, the missing third are not clean — they are unevaluated. This
   becomes a guard, in the payroll spec's sense.

---

## 2. The full note table — **all seven "missing" fields exist, plus six nobody mentioned**

`PAYROLLMANAGERNOTES`, 37 mapped columns. Every field the Notion page listed as absent from the
warehouse view **is present on the source table** — so, as with the payroll spec, this is a
projection rather than a new pipeline.

Confirmed present: `PAYROLL_MONTH` `DATE` · `PAID_ON_PAYROLL_MONTH` `DATE` · `PURPOSE_ID` `BIGINT` ·
`IS_REFUND` `TINYINT(1)` · `APPLIED` `TINYINT(1)` · `PAID` `TINYINT(1)` · `REFERRED_MAID_ID` `BIGINT` ·
`OLD_NOTE_ID` `BIGINT` · `ADDITION_REASON_ID` `BIGINT` · `NOTE_TYPE` `VARCHAR(255)`.

### Six columns the Notion spec never mentions, and they matter

| Column | Why it matters |
| --- | --- |
| **`CONFIRMED_AMOUNT_BY_AUDITOR`** `TINYINT(1)` | ⚠ **The ERP already has an auditor-confirmation flag on the note.** Either this check duplicates a control that exists, or these flags are where its verdicts should be written back. Nobody has asked which. **MN-O7** |
| **`CONFIRMED_REPEATED_BY_AUDITOR`** `TINYINT(1)` | And a second one, specifically about repetition — which is the duplicate rule (G3). Same question, sharper |
| **`ADDITION_REASON_ID`** / `DEDUCTION_REASON_ID` | The structured payment type. The view's `REASON` is the *picklist name* resolved from these — so the view carries the label but not the id |
| **`REFUNDED_NOTE_ID`** + `IS_REFUND` | A refund chain distinct from `OLD_NOTE_ID`'s supersession chain. **Two different chains**, and a rule that treats a refund as a duplicate will be wrong |
| **`PAYROLL_ACCOUNTANT_TODO_ID`** | Links the note to the payroll run that paid it — the same `PayrollAccountantTodo` the payroll-checks spec is built on. The two checks can be reconciled against each other |
| **`NOT_FINAL`**, `FROM_MANAGER_ID`, `CREATOR`, `LAST_MODIFIER` | Lifecycle and actor fields. See below |

### **MN-O1 closes: the manager column is dead, permanently**

> `EMPLOYEE_MANAGER_ID` — **ABSENT (unmapped since PAY-3484)**, legacy.

The Snowflake view's `MANAGER` column maps a field **the ERP stopped mapping**. It is not empty
because of a sync gap; it is empty because the source no longer writes it, and it will never fill.
Any design that ranks managers by findings must use **`FROM_MANAGER_ID`** or **`CREATOR`** instead —
both present, neither in the view. The dead column should be dropped from the view, not carried.

---

## 3. Which date decides the month — **MN-O3 closes, and the Notion page has it wrong**

| Field | What it actually is |
| --- | --- |
| **`PAID_ON_PAYROLL_MONTH`** | **The month the note was actually paid in.** Set at transfer time in `AsyncService.processCurrentMonthHousemaidsBatchBT`, from `accountantTodo.getPayrollMonth()`. The ERP's own paid/deferred repository queries key off this field |
| **`NOTE_DATE`** | The business/event date, set at creation. Payroll generation filters notes into a **lock-date window** on it (`noteDate >= start AND noteDate < end`) — so for *unpaid* notes this is what decides which run picks them up |
| **`PAYROLL_MONTH`** | ⚠ **Populated in one narrow MV-prorated branch only, and not used in standard note-selection queries at all** |

**The Notion page describes `PAYROLL_MONTH` as "the month it actually pays".** That is not what the
code does. `PAID_ON_PAYROLL_MONTH` is the paid month; `PAYROLL_MONTH` is near-vestigial and mostly
null. A spec that windowed on `PAYROLL_MONTH` would silently audit almost nothing.

### The 216 future-dated notes resolve themselves

The open decision was: window on `NOTE_DATE` and you audit 216 postponed flight-home notes years
early; exclude future dates and you may drop notes genuinely paid this month.

**Window on `PAID_ON_PAYROLL_MONTH` and neither happens.** This check audits money that *moved*. A
postponed note that has not been paid has a null `PAID_ON_PAYROLL_MONTH` and falls out of the
population by construction — no exclusion rule, no cut-off date, nothing to tune. When it is
eventually paid, it enters the month it was paid in, which is the month whose payment should be
audited.

**Recommendation: `PAID_ON_PAYROLL_MONTH` is the population date.** `NOTE_DATE` stays as a
displayed column — the gap between the two is itself worth seeing.

---

## 4. `NOTE_TYPE` — **seven values, not three; MN-O4 closes with a control finding**

`ManagerNoteType` on `AbstractPayrollManagerNote`:
`ADDITION`, `DEDUCTION`, `PENALTY_DEDUCTION`, `EXTRA_SHIFT`, `BONUS`, `REDUCTION`, `SALARY_RAISE`.

Only **`ADDITION`** and **`DEDUCTION`** are actively created by backend code for housemaids.
`EXTRA_SHIFT`, `BONUS`, `REDUCTION` and `SALARY_RAISE` are remnants of the disabled office-staff
flow with no active production path. The Snowflake view profiles three values, so the other four are
absent from the data as well as from the code — consistent.

### ⚠ `PENALTY_DEDUCTION` is worth a paragraph of its own

> No backend code sets it; it only arrives via API `POST /ManagerNotes` with `noteType` in the
> request body. Both it and `DEDUCTION` **bypass the payroll lock** in
> `PayrollManagerNoteController.createEntity`. It is **not** included in housemaid payroll queries
> that look for `DEDUCTION`, and `bulkrefund` does not handle it.

So there is a note type that: is settable only from outside, bypasses the payroll lock, is skipped
by the payroll aggregation queries that catch normal deductions, and has no refund path. It is a
deduction, so it is out of this check's scope as scoped today — but **the reason deductions are out
of scope is a broken warehouse feed, and this one is a different problem entirely**. Flagged as
**MN-O8**, for whoever owns payroll integrity, independent of this dashboard.

---

## Open items after this round

| ID | Status |
| --- | --- |
| MN-O1 | ✅ **Closed.** `EMPLOYEE_MANAGER_ID` unmapped since PAY-3484 — the view's `MANAGER` will never populate. Use `FROM_MANAGER_ID` / `CREATOR`, both needing ingestion |
| MN-O2 | ✅ **Closed.** No FK. Heuristic match on maid + `ADDITION_REASON_ID` + `NOTE_REASONE` text, pivoting through `EXPENSEREQUESTTODOS` to `EXPENSEPAYMENTS`. Match rate becomes a displayed guard |
| MN-O3 | ✅ **Closed.** `PAID_ON_PAYROLL_MONTH` is the population date. The 216 postponed notes fall out by construction |
| MN-O4 | ✅ **Closed.** Seven enum values; only `ADDITION` / `DEDUCTION` live for housemaids |
| MN-O5 | Open — deduction feed. Needs compute (DNA-9437) |
| MN-O6 | Open — G2 anti-attrition has no payment scale. Unchanged |
| **MN-O7** | **New.** `CONFIRMED_AMOUNT_BY_AUDITOR` and `CONFIRMED_REPEATED_BY_AUDITOR` already exist on the note. Does this check duplicate an existing control, or are these its write-back target? | 
| **MN-O8** | **New, not a data request.** `PENALTY_DEDUCTION`: API-settable only, bypasses the payroll lock, excluded from the payroll queries that catch `DEDUCTION`, no refund path. For payroll integrity, not this dashboard |
