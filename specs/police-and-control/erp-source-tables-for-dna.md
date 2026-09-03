# ERP source tables needed in Snowflake — housemaid payroll critical checks

For the DNA / Data Engineering team. Every ERP table and column below was confirmed against the
ERP codebase via the Low-Code Platform ("Ask the Code") on 2026-09-02/03 — none is guessed. The
**Snowflake status** column says what already exists, so the ask is only the gaps.

Companion documents: `SPEC_housemaid_payroll_critical_checks_v2.md` (what the data is for) and
`snowflake-verification-queries.md` (aggregate queries to confirm the "already there" rows).

**Summary of the ask:** four ERP tables are absent from the warehouse entirely, one existing model
is missing seven columns it already has in its source, and one existing model needs one extra
payment type. Nothing else is needed.

---

## A. Already in Snowflake — no action

| ERP table | Snowflake object | Used for |
| --- | --- | --- |
| `HOUSEMAIDS` | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | Maid master, CC/MV type, status, deletion flags |
| `EMPLOYEELOANS` | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` | Loan balance = `AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT` |
| `CONTRACTS` | `BA_VIEWS.SALES_SILVER.CONTRACTS` | Contract ↔ maid, CC/MV label, validity dates |
| `WPSRECORDS` | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.WPS_RECORDS` | Independent second source for the wage-bill tie-out |

---

## B. Existing model, missing columns — **the cheapest and highest-value ask**

`BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` is built from
**`mmdb.housemaidpayrolllogs`** and already carries most of what we need. These seven columns
exist on that same source table and are simply not projected into the model. **No new pipeline,
no backfill — the history back to 2020-07-01 comes with them.**

| ERP column on `HOUSEMAIDPAYROLLLOGS` | Needed for |
| --- | --- |
| `TOTAL_PRO_RATED_SALARY` | Check 5 — full-salary-day earnings, live-in (export calls it "grp1") |
| `MOHRE_PRO_RATED_SALARY` | Check 5 — accommodation-day earnings, live-in ("grp2") |
| `TOTAL_LIVE_OUT_PRO_RATED_SALARY` | Check 5 — full-salary-day earnings, live-out ("grp5") |
| `MOHRE_LIVE_OUT_PRO_RATED_SALARY` | Check 5 — accommodation-day earnings, live-out ("grp6") |
| `UNPAID_DEDUCTION` | Check 7 — arrears / carried deductions |
| `UNPAID_DEDUCTION_REPAYMENT` | Check 7 — recovery of the above |
| `HOUSEMAID_PAYROLL_BEAN_ID` | Join key to `HOUSEMAIDPAYROLLBEANS` (section C) |

**Naming trap worth passing on:** `TOTAL_PRO_RATED_SALARY` is the **full-salary-day** figure and
`MOHRE_PRO_RATED_SALARY` the **accommodation-day** figure. Neither name says so, and binding them
the wrong way round inverts the check into a permanent pass.

**Pro-ration, confirmed:** divisor is **calendar days in the payroll month** (28–31), not a fixed
30 and not working days.
`TOTAL_PRO_RATED_SALARY = round(basicSalary × group1Days / monthDays)`;
`MOHRE_PRO_RATED_SALARY = round(accommodationSalary × group2Days / monthDays)`.
**Exception:** `MAID_VISA` maids use divisor **30.4** for group 1, and their
`MOHRE_PRO_RATED_SALARY` is **0 by construction** — which is why the accommodation-day check is
CC-only.

---

## C. Not in Snowflake at all — new ingestion

### C1 · `HOUSEMAIDPAYROLLBEANS` — the payroll export bean

One row per maid per payroll run; the object the monthly payroll export is generated from. Joined
from `HOUSEMAIDPAYROLLLOGS.HOUSEMAID_PAYROLL_BEAN_ID`.

| Column | Needed for |
| --- | --- |
| `ID`, `HOUSEMAID_ID` | Keys |
| `LOAN_REPAYMENT` | Check 4 — **current-month** loan repayment |
| `REMAINING_LOAN_BALANCE` | Check 4 — outstanding balance snapshot |
| `TOTAL_LOAN_REPAYMENTS` | ⚠ **lifetime cumulative — never use as the current-month numerator** |
| `PREVIOUSLY_UNPAID_SALARIES` | Check 7, MV arm only (see the note below) |
| `UNPAID_DEDUCTION`, `UNPAID_DEDUCTION_REPAYMENT` | Check 7 |
| `REMAINING_UNPAID_DEDUCTION_BALANCE` | ⚠ **stored as a string, defaults to the literal `"N/A"`** — needs casting, and a plain `SUM` will fail |
| `EARNING_IN_GROUP_ONE` / `_TWO` / `_FIVE` / `_SIX` | Check 5 — export copies of the four columns in section B; ingesting section B instead makes these optional |
| `CONTRACT_NAME` | ⚠ display string `'Contr-' || CONTRACTS.ID` — **not a foreign key**, do not parse it; join on `CONTRACTS.ID` |

### C2 · `MONTHLYPAYMENTRULES` — the payroll calendar

Small table, and it unblocks two separate problems: knowing when a payroll month is locked, and
knowing when salaries were *due* to be paid.

| Column | Needed for |
| --- | --- |
| `PAYROLL_MONTH` | First day of the month the run covers |
| `PAYMENT_DATE` | Scheduled salary payment date — set from a configured day-of-month, then adjusted for Sundays and public holidays |
| `LOCK_DATE` | End of the editable window. `= PAYMENT_DATE − DAYS_BEFORE_LOCK`. Audit to-dos are generated on this date |
| `DAYS_BEFORE_LOCK` | The offset above |
| `AUDITING_FINISHED` | Audit phase complete |
| `FINISHED` | Payment/accountant phase complete |

**Note:** a payroll month can have **several rules** (primary/secondary, payment method, employee
type), each with its own `PAYMENT_DATE` — so this is not one row per month.

### C3 · `REPAYMENTS` — the loan repayment ledger

The single thing blocking the loan-recovery check. `EMPLOYEELOANS` (already in Snowflake) carries
only a *cumulative* `REPAID_AMOUNT`; there is no per-month figure without this table.

| Column | Notes |
| --- | --- |
| `AMOUNT` | The repayment |
| `REPAYMENT_DATE` | Month assignment |
| `PAID_REPAYMENT` | Filter to `true` |
| `EXCULDED_FROM_PAYROLL` | Filter to `false`. **The misspelling is in the ERP schema — reproduce it exactly** |
| `HOUSEMAID_ID`, `EMPLOYEE_LOAN_ID` | Keys |

⚠ **Month-boundary ambiguity to settle at ingestion:** the current payroll code uses
`REPAYMENT_DATE >= payrollStart AND < payrollEnd`, while a legacy path uses `payrollEnd + 1 day`.
They differ by one day and move last-day repayments between months.

### C4 · `UNPAIDDEDUCTIONS` and `UNPAIDDEDUCTIONREPAYMENTS`

The ledgers behind the unpaid-deduction balance. **Confirmed to apply to CC maids as well as MV** —
there is no maid-type filter on either table; the deduction cap is nationality-based.

| Table | Columns |
| --- | --- |
| `UNPAIDDEDUCTIONS` | `AMOUNT`, `UNPAID_DEDUCTION_DATE`, `NOTES`, `NOT_FINAL`, `HOUSEMAID_ID` |
| `UNPAIDDEDUCTIONREPAYMENTS` | `AMOUNT`, `REPAYMENT_DATE`, `PAID_REPAYMENT`, `DESCRIPTION`, `HOUSEMAID_ID` |

Optional companion: `HOUSEMAIDBALANCESHISTORIES.PREVIOUS_UNPAID_DEDUCTION_BALANCE`.

---

## D. Existing model, one missing row type

`BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGEMENT_PAYMENTS` is built from **`PAYMENTS`**, but
admits only six payment types: `Same Day Recruitment Fee`, `insurance`, `Pre-collected Salary`,
`Overstay Fee`, `Pre-collected Salary - No VAT`, `MaidVisa Recruitment Fee Refund`.

**The recurring monthly client payment — `PAYMENTS.TYPE_OF_PAYMENT_ID = 1` — is not among them.**
That single omission blocks two of the ten checks (MV wages vs client receipts, and the CC contract
payment reconciliation).

Suggested fix, but the call is yours: **widen the existing model to admit payment type 1** rather
than build a parallel one — one filter change, and payment hygiene stays in one place.

The Payment Report filters map as follows, confirmed from the ERP:

| ERP screen filter | Table | Column |
| --- | --- | --- |
| `contract.contractProspectType.id` | `CONTRACTS` | `CONTRACT_PROSPECT_TYPE_ID` (`1650` = CC, `1726` = MV) |
| `typeOfPayment.id` | `PAYMENTS` | `TYPE_OF_PAYMENT_ID` |
| `dateOfPayment` | `PAYMENTS` | `DATE_OF_PAYMENT` |
| `dateChangedToReceived` | `PAYMENTS` | `DATE_CHANGED_TO_RECEIVED` (exposed as `RECEIVED_DATE`) |
| `status` | `PAYMENTS` | `STATUS` |

⚠ `RECEIVED_DATE` is **NULL for every non-received status**, so any window filter on it silently
drops bounced, PDC and returned payments. That is a property of the data, not a request — flagging
it because it will bite whoever builds the model.

---

## E. Questions for DNA that no ingestion answers

1. **Which warehouse should `PAYROLL_AND_MONEY_CONTROL_ROLE` be granted USAGE on?** Filed
   separately as **DNA-9437**. Without it, none of the "already in Snowflake" rows above can be
   verified beyond their column metadata.
2. **Please paste the `ANSARI_PAYMENT_METHOD` CASE expression** from the
   `SILVER.HOUSEMAID_MANAGEMENT.HOUSEMAID_PAYROLL_HISTORY` dbt model. `BA_VIEWS` is only a
   passthrough (`SELECT * FROM SILVER…`) and that schema is not readable to us. We need to compare
   it against the ERP's own classifier, which has **seven** outcomes where the dbt model's profiled
   values show only five — if the model drops the `PAYROLL_CARD` and `OVER_THE_COUNTER` branches,
   those accounts fall into `''` and become invisible to the bank-account diversion check.
3. **Do `IS_DELETED` / `EXCLUDED_FROM_PAYROLL` (`VARCHAR '00'/'01'`) use `'00'` for false?** The
   ERP question timed out twice; a one-line answer or the `GROUP BY` in
   `snowflake-verification-queries.md` Q2 settles it. Guessing wrong empties the whole population.

---

## F. Two ERP findings worth passing to whoever owns payroll

Neither is a data request; both surfaced while tracing the above.

1. **The maid's payment account has no audit trail.** `NEWREQUESTS` is Hibernate Envers–audited
   (`NEWREQUESTS_REVISIONS`, with `REVISION_TYPE`, per-field `_MODIFIED` flags, and
   `HISTORY_REVISIONS` carrying `TIMESTAMP` and `CREATOR`) — but `EMPLOYEE_ACCOUNT_WITH_AGENT` is
   **not in the audited field set**. There is also no approval step, no permission check, and no
   validation on it (unconstrained `@Column String`; payroll only tests non-empty). Nobody can say
   who changed a maid's payment account, when, or from what.
2. **The MOL company number is a hardcoded literal.** `"720610101"`, written into the WPS transfer
   file's SCR summary row by `TransferFilesService.generateWPSTransferFile()` and **duplicated** in
   `PaymentWorkOrderController` for the Ansari PWO file. Not a table, not a config constant.
