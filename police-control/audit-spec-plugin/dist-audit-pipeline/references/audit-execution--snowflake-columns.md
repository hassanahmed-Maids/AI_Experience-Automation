# Verified warehouse facts — maids.cc `BA_VIEWS`

Everything here came back from `INFORMATION_SCHEMA` or a query that ran. **Nothing in this file was
inferred from a name or copied from a spec** — that distinction cost the reference audit a wrong
finding when an ingestion *ask* was read as a *schema*.

Re-verify before relying on it. Schemas move; this is a starting point and a warning list, not a
contract.

## Columns that lie about the past

The audit's largest structural finding: **the ERP maid record carries state that is never reconciled
backwards.** Six findings rested on a current-state column standing in for a historical fact, and every
one moved when a log replaced it — four shrank, one grew, one inverted.

| Column | Failure mode | Evidence |
|---|---|---|
| `HOUSEMAIDS_INFO.DATE_OF_TERMINATION` | **stale on change** — not cleared on re-hire | 13 maids read as terminated a median 558 days earlier while showing **1,039 status changes since**, and sitting in `WITH_CLIENT` on the day |
| `HOUSEMAIDS_INFO.ASSIGNED_OFFICE_WORK_REASON_ID` | **never cleared** | **57.4%** of holders are `EMPLOYEMENT_TERMINATED`; **0.8%** are actually in office-work status |
| `HOUSEMAIDS_INFO.HOUSEMAID_TYPE` | overwritten on CC/MV switch | a point read reported **AED 137,500**; the truth was **4,500** |
| `HOUSEMAIDS_INFO.LIVE_OUT` | overwritten | on 66 notes a point read flagged 5, of which **2 were false, while missing 3 of the 6 real ones** |

**Two failure modes, needing different defences.** *Stale on change* **mis-dates** — a log fixes it.
*Never cleared* **mis-means** — no log fixes it; only a base rate over the whole population exposes it.

## The point-in-time tables — interval, not event

Each row carries `CHANGE_DATE` **and `NEXT_CHANGE_DATE`**, so an as-of read is plain containment and
needs no window function:

```sql
ON  l.HOUSEMAID_ID = n.HOUSEMAID_ID
AND n.note_day >= l.CHANGE_DATE::DATE
AND (l.NEXT_CHANGE_DATE IS NULL OR n.note_day < l.NEXT_CHANGE_DATE::DATE)
```

| Table | Columns | Use for |
|---|---|---|
| `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS` | `HOUSEMAID_ID, FROM_STATUS, TO_STATUS, CHANGE_DATE, NEXT_CHANGE_DATE, PREVIOUS_CHANGE_DATE, DESCRIPTION, ERP_USER` | status as of any date |
| `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS` | `HOUSEMAID_ID, FROM_TYPE, TO_TYPE, CHANGE_DATE, PREV_CHANGE_DATE, NEXT_CHANGE_DATE` | CC/MV timeline; also carries `CC Live In` / `CC Live Out` / `MV` **directly** |
| `HOUSEMAID_MANAGEMENT_GOLD.BI_HOUSEMAID_STATUS_LOGS` | above + `ERP_USER_NAME, HOUSEMAID_TYPE, MAID_NATIONALITY` | status with type attached |
| `HOUSEMAID_MANAGEMENT_SILVER.FACT_MAID_TERMINATIONS` | `HOUSEMAID_ID, TERMINATION_DATE, TERMINATION_CATEGORY, LIVING_TYPE` | left-the-company date |

Status vocabulary is 34 values from 2018-02 onward, `WITH_CLIENT` among them — so **"was she placed
with a client that day?" is one join**, not a model built from tagging events.

🔴 `HOUSEMAIDS_INFO_REVISION` (Hibernate Envers) is the **fallback, not the first choice**. It records
*that a row changed*; a log records *what the value became*, with the interval already closed.

## Manager notes — eleven columns, entire

`ID · HOUSEMAID_ID · NOTE_TYPE · AMOUNT · NOTE_REASON · REASON · NOTE_DATE · MANAGER · EXPENSE_ID ·
REQUESTED_BY · APPROVED_BY`

- **One timestamp only** (`NOTE_DATE`) — and it is the payroll *due* date, not when the note was
  written. On airfare it runs to 2028. **There is no note creation date**, so no point-in-time
  question about a note itself is answerable.
- No `PURPOSE_ID`, `ADDITION_REASON_ID`, `CREATION_DATE`, `CREATOR`, `APPLIED`, `PAID`,
  `PAYROLL_MONTH` or `IS_REFUND`.
- `MANAGER` exists and is **NULL on every bonus note** — present in the schema, empty in practice.

## Expenses — the reference list is self-declared

`MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` carries, for 31 salary-addition heads:
`SALARY_ADDITION_TYPE, CODE, CAPTION, EXPENSE_TYPE, CATEGORY, TOP_PARENT_CATEGORY, STATUS,
APPROVAL_METHOD, LIMIT_FOR_APPROVAL, LIMIT_FOR_CEO_APPROVAL, REQUIRE_INVOICE, REQUIRE_ATTACHMENT,
ALLOW_TO_ADD_LOAN`.

**Three open business asks were answered by reading this table.** Sweep config before asking a person
for a reference list.

- Join key to `EXPENSES_REQUESTS` is **`EXPENSE_TYPE`**, established by profiling.
- ⚠️ `EXPENSE_REQUEST_TASK_NAME` is a **workflow state** (`PAYMENT_OBJECT_CREATED` on 100% of rows),
  not a category. Joining on it matched nothing across 944 notes and read as a clean pass.
- ⚠️ `LIMIT_FOR_APPROVAL` is a **threshold above which approval is needed**, not a ceiling. It is
  populated only on `APPROVAL_REQUIRED_ON_LIMIT` heads.
- ⚠️ `ALLOW_TO_ADD_LOAN` means *may*, not *must*.
- ⚠️ The loan on the **request** (`EXPENSES_REQUESTS.LOAN_AMOUNT`) is not the loan on the **addition**
  (`ADDITION_LOAN_AMOUNT`, the sanctioned field). The first is largely empty; reading it gave 3.4%
  where the approved KPI gives 85–100%.

## Approved KPIs — read them, don't rebuild them

`CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` stores definitions in `SEMANTIC_ID` + `TOOLTIP_INFO`
(a VARIANT), not flat columns. Query it before hand-building any metric.

Gold views that already answer common questions:
`BI_PAYROLL_MAID_SALARY_ADDITIONS_AS_LOAN_IMPACT_BY_CATEGORY` (loan % of additions) ·
`BI_PAYROLL_LOAN_DEDUCTIONS_VS_POSSIBLE_DEDUCTIONS` (recovery) · `BI_MEDICAL_LOANS`.

**A reconstruction of an approved KPI is not the KPI.** Two rounds of hand-built work rebuilt metrics
that already existed, and got one of them wrong by an order of magnitude.

## Snowflake dialect notes

- `ASOF` is **reserved** (ASOF JOIN) — a CTE named `asof` fails to parse.
- Correlated subqueries take **equality only**; a correlated `EXISTS` carrying `BETWEEN` is rejected.
  Rewrite as an equality join plus `MAX(IFF(...))` aggregation.
- `*` is not allowed as a function argument outside the SELECT list.
