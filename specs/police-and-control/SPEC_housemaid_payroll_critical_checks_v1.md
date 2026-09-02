# Spec — Housemaid Payroll Critical Checks

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Spec version** | v1 |
| **Date** | 2026-09-02 |
| **UI mockup** | https://claude.ai/code/artifact/5ffa76cd-ac5c-4517-a6ed-c3dfdd0e9924 |
| **Status** | Draft — awaiting requestor approval point by point |
| **Replaces** | n8n workflow `zwSxrV00VE4rOSvd` — "Housemaid Payroll Critical Checks On Security Room" (currently `active: false`, blocked at intake; n8n is being deprecated) |

---

## 0. Why this spec exists

The ten checks below run today as a single n8n code node. That flow is deprecated, and it is
already non-runnable: its `Load Inputs` node throws by design because the two spreadsheets it
depended on — the Al Ansari bank payroll file and an ERP payroll export — were uploaded by a
human through the retired Security Room portal, which POSTed them in a request body. One
retained execution held 25,290 unredacted payroll rows alongside four live ERP session
fields.

Moving to Snowflake is therefore not only a platform migration. It removes the file-upload
intake that caused the exposure, because **the content of both spreadsheets already exists
inside Snowflake** as ERP-sourced tables. This spec re-expresses each check against those
tables and names, explicitly, the four data points that are not yet there.

**Scope note.** This spec defines *what must be true of the data and the numbers*. It does not
design the pipeline, the dbt models, or the refresh mechanism — those are the Snowflake
team's to choose.

---

## 1. Business Logic

**The control.** Every month, before the housemaid payroll is released, ten arithmetic and
integrity conditions must hold across the payroll population. Each one is a statement about
money that is either true or false for the month: no maid is paid twice, the CC population is
substantially deployed to clients, the month-over-month CC wage bill has not jumped, loans are
being recovered, accommodation-day pay is being applied, MV wages do not outrun MV client
receipts, arrears are immaterial, everyone's pay period is the correct month, nobody's bank
account moved in a pattern that indicates diversion, and every CC contract that carries a maid
has a matching client payment.

**The failure it catches.** Five distinct failure modes, and the report must keep them
distinguishable rather than collapsing them into one "payroll looks wrong" signal:

| Failure mode | Caught by |
| --- | --- |
| **Payroll fraud / diversion** — a maid's salary redirected to an account controlled by someone else | Check 9 (bank-account transitions), Check 1 (duplicate MOHRE ID = two payments for one person) |
| **Overpayment / wage-bill leakage** — the company pays out more than it should | Check 3 (CC month-over-month jump), Check 6 (MV wages vs MV receipts) |
| **Under-recovery** — money owed to the company is not being collected back | Check 4 (loan repayments), Check 10 (CC contracts with no client payment) |
| **Under-payment / arrears to workers** — a compliance and welfare exposure, not just a financial one | Check 7 (previously unpaid salaries), Check 5 (accommodation-day earnings not applied) |
| **Process / data integrity** — the payroll run itself is malformed | Check 2 (CC without client), Check 8 (wrong pay period), Check 10's data-quality flags |

**Reader and action.** Police & Control opens this monthly, after the payroll month closes and
before release. A red row is worked case by case: P&C pulls the named maid or contract in the
ERP, establishes whether the exception is real, and either clears it with a reason or escalates
to Payroll (arrears, wrong period), to Accounting (missing client payment), or — for Check 9 —
to Finance leadership as a suspected diversion. The report is evidence in that conversation, so
every row must carry enough identity to find the record and enough arithmetic to defend the
finding.

**Population in scope.**

- All housemaids with a payroll row for the audit month, both CC and MV.
- The audit month is the **previous calendar month** relative to the run.
- Client payments considered are those whose `DATE_OF_PAYMENT` falls in the **month after** the
  audit month (maids.cc collects the following month's salary in advance), bounded by
  `RECEIVED_DATE` between the first day of the audit month and the run date.

**Explicitly out of scope.**

- Office staff, drivers, and any non-housemaid payroll.
- Final settlements and end-of-service payments (a different control).
- Maids with no payroll row at all for the month — absent from payroll is a Payroll-team
  question, not a payroll-arithmetic question. (Exception: Check 10 deliberately surfaces CC
  *contracts* with no client payment, which is a completeness test on the payment side, not the
  payroll side.)
- Anything the ERP marks deleted: `HOUSEMAIDS_INFO.IS_DELETED`, `WPS_RECORDS.TRASHED`, and
  payment `STATUS = 'DELETED'` rows are excluded everywhere. Check 10 counts deleted payments
  separately for visibility but never in a ratio.

**Grain.** The dashboard has two grains and needs both:

- **Summary grain** — one row per `audit_month × check`, carrying pass/fail/skipped and the
  metric values. This is the KPI strip and the check list.
- **Exception grain** — one row per offending maid (Checks 1, 7, 8, 9) or per offending
  contract (Check 10). This is what P&C actually works.

**Refresh expectation.** Monthly, available from the **7th of the month at 06:00 Gulf time**
(the cadence the n8n schedule used), covering the previous calendar month. The Snowflake team
chooses the refresh mechanism.

**Timezone.** All month boundaries are Gulf time (Asia/Dubai). `PAYROLL_MONTH` is a DATE and
carries no timezone; `RECEIVED_DATE` and `BALANCE_DATE` are `TIMESTAMP_NTZ` and must be treated
as Gulf time when assigning a payment to a month. A payment received at 23:30 on the last day of
a month belongs to that month.

---

## 2. Data Points Needed

### 2.1 Verified — already in Snowflake

Verification method and its limit are stated honestly: every table, column, type and profiled
value range below was read from Snowflake metadata (`DESC VIEW`) in this session, and the row
counts from `SELECT COUNT(*)`. **Row-level queries could not be run** — the session's role
`PAYROLL_AND_MONEY_CONTROL_ROLE` has no warehouse grant, so anything needing compute
(`MAX(date)`, `GROUP BY`, sampling) is refused with *"You must specify the warehouse to use."*
Consequently **freshness and grain are asserted from metadata, not measured**. See Open Item O1.

| # | Data point | Database.Schema.Table | Column | Grain | Notes / verification |
| --- | --- | --- | --- | --- | --- |
| D1 | Payroll row (the "Ansari file" content, ERP-side) | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | — | one row per maid per payroll month **(grain UNVERIFIED — see O1)** | `COUNT(*) = 1,300,660`. Source `mmdb.housemaidpayrolllogs` |
| D1.1 | MOHRE / employee unique ID | ↑ | `EMPLOYEE_UNIQUE_ID` | — | `VARCHAR`. Checks 1, 7, 8, 9 |
| D1.2 | Payroll month | ↑ | `PAYROLL_MONTH` | — | `DATE`, profiled min `2020-07-01`. First day of month |
| D1.3 | Amount paid (the "Ansari (AED)" figure) | ↑ | `NET_SALARY` | — | `FLOAT`, profiled 0–13,200. Source column `mmdb…TOTAL_SALARY`. Checks 3, 6, 7, 10 |
| D1.4 | Gross earnings | ↑ | `TOTAL_SALARY` | — | `FLOAT`, 0–13,000. Source column `TOTAL_EARNINGS`. **Name inversion — see hygiene note** |
| D1.5 | Additions / deductions | ↑ | `ADDITIONS`, `DEDUCTIONS` | — | Sources `MANAGER_ADDITIONS` (−1,516–8,800), `TOTAL_DEDUCTION` (0–2,800) |
| D1.6 | Maid status on the payroll row | ↑ | `STATUS` | — | 20 values incl. `WITH_CLIENT`, `AVAILABLE`, `ON_VACATION`, `SURPLUS`, `SICK_WITHOUT_CLIENT`, `EMPLOYEMENT_TERMINATED` *(ERP spelling)*. Check 2 |
| D1.7 | Bank / agent account | ↑ | `EMPLOYEE_ACCOUNT_WITH_AGENT` | — | Free text. **Sensitive — see §2.4.** Check 9 |
| D1.8 | Account type, pre-classified | ↑ | `ANSARI_PAYMENT_METHOD` | — | `FAB_MASTER_CARD`, `ANSARI_VISA_CARD`, `DU_PAY_CARD`, `BANK_TRANSFER`, `''`. Derived in-model from `EMPLOYEE_ACCOUNT_WITH_AGENT`. Check 9 |
| D1.9 | Date the salary was paid | ↑ | `PAID_ON_DATE_FORMATTED` | — | `DATE`, min `2020-08-04`. Parsed via `COALESCE(TRY_TO_DATE(…'YYYY-MM-DD'), …'DD MONTH, YYYY', …'DD MON, YYYY')` from the free-text `PAID_ON_DATE`. Check 8 |
| D1.10 | Why a salary was not paid | ↑ | `AUTOMATIC_EXCLUSION_REASONS`, `MANUAL_EXCLUSION_REASON` | — | Check 7 |
| D1.11 | Transferred flag | ↑ | `IS_TRANSFERRED` | — | `'YES'`/`'NO'` from `TRANSFERRED = 1` |
| D2 | Maid master record | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | 136 columns | one row per maid | Join `HOUSEMAIDS_INFO.ID = HOUSEMAID_PAYROLL_HISTORY.HOUSEMAID_ID` (both `NUMBER(38,0)`) |
| D2.1 | CC vs MV classification inputs | ↑ | `HOUSEMAID_TYPE`, `LIVE_OUT` | — | See D3 for the rule |
| D2.2 | Nationality, name | ↑ | `NATIONALITY`, `NAME` | — | Name shown masked in output — §2.4 |
| D2.3 | Loan/deduction master fields | ↑ | `OUTSTANDING_BALANCE`, `MONTHLY_LOAN`, `DEDUCTION_CAP` | — | Point-in-time (current), **not** as-at a past month. Check 4 — see M4 |
| D2.4 | Payroll eligibility flags | ↑ | `EXCLUDED_FROM_PAYROLL`, `WITH_MOL_NUMBER`, `LAST_PAYROLL_LOCK_DATE`, `IS_DELETED` | — | `IS_DELETED` is an exclusion filter everywhere |
| D2.5 | Salary components | ↑ | `BASIC_SALARY`, `PRIMARY_SALARY`, `ACCOMMODATION_SALARY` | — | Candidate inputs for Check 5 — **not yet confirmed as the grp1/grp2/grp5/grp6 source**, see N1 |
| D3 | CC / MV rule | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS` | `TO_TYPE` | — | In-model rule, quoted verbatim: `CASE WHEN h.HOUSEMAID_TYPE = 'MAID_VISA' THEN 'MV' WHEN h.LIVE_OUT = 1 THEN 'CC Live Out' WHEN h.LIVE_OUT = 0 THEN 'CC Live In' END` |
| D4 | WPS / MOL salary record | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.WPS_RECORDS` | `EMPLOYEE_UNIQUE_ID`, `MAID_ID`, `CONTRACT_SALARY`, `PAID_SALARY`, `PAYROLL_DATE`, `REPORT_DATE`, `UPLOADED_DATE`, `WPS_STATUS`, `TRASHED` | one row per maid per WPS report | `COUNT(*) = 701,735`. Independent second side for the Check 3 / Check 7 tie-out |
| D5 | Loans | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` | `HOUSEMAID_ID`, `TYPE`, `BALANCE_DATE`, `AMOUNT`, `REPAID_AMOUNT`, `WAIVED_AMOUNT`, `STATUS` | one row per loan | Source `mmdb_transformed.employeeloans`. `STATUS ∈ {NOT_YET_PAID, PAID, PARTIALLY_PAID}`. **PARTIAL — see §2.3 / N4** |
| D6 | Client payments | `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGEMENT_PAYMENTS` | `ID`, `CONTRACT_ID`, `PAYMENT_TYPE`, `STATUS`, `AMOUNT_OF_PAYMENT`, `DATE_OF_PAYMENT`, `RECEIVED_DATE` | one row per payment | **PARTIAL — the monthly client payment type is absent. See §2.3 / N2** |

**PARTIAL verdicts in detail.**

- **D5 — loans.** Two defects. (a) `REMAINING_AMOUNT` is sourced from
  `employeeloans.MONTHLY_REPAYMENT_AMOUNT` and its profiled allowed-values set is the single
  value `0` — the column exists but carries no data, so it cannot serve as "remaining balance".
  (b) `REPAID_AMOUNT` is cumulative on the loan row, not a per-month transaction, so
  **"current-month loan repayment" is not derivable from this view**. Outstanding balance *is*
  derivable as `AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT`, but only as of now, not as of a past
  month. → N4.
- **D6 — client payments.** The model admits only six payment types: `Same Day Recruitment Fee`,
  `insurance`, `Pre-collected Salary`, `Overstay Fee`, `Pre-collected Salary - No VAT`,
  `MaidVisa Recruitment Fee Refund`. The ERP's **monthly client payment** (`typeOfPayment.id = 1`
  on the Payment Report screen) is not among them, and the view carries no contract prospect
  type, so CC (`1650`) and MV (`1726`) contracts cannot be separated. **Checks 6 and 10 cannot be
  built on this view as it stands.** → N2, N3.
- **D3 — type transitions.** `HOUSEMAID_TYPE_LOGS` is not a transition log despite its name:
  `FROM_TYPE`, `PREV_CHANGE_DATE` and `NEXT_CHANGE_DATE` are `NULL` placeholders and
  `CHANGE_DATE` is sourced from `housemaids.CREATION_DATE`. The n8n check distinguished
  `MV to CC` and `CC to MV` mid-month transitions; **Snowflake cannot express that today**. The
  rule in `TO_TYPE` is a point-in-time classification only. → N5.

### 2.2 Approved KPI definitions reused

Five approved payroll models already exist in `BA_VIEWS.HOUSEMAID_MANAGEMENT_GOLD`, all at
`payroll_month × maid_type` grain with `MAID_TYPE ∈ {CC, MV}`. Company policy is to reuse an
approved definition verbatim with all its filters rather than reconstruct it, so this spec does
so — **and states, for each, where the P&C check means something different.** Where they differ,
the dashboard shows both and labels them; it does not silently pick one.

| P&C check | Approved model to reuse | Reused verbatim? | Where it differs from the n8n check |
| --- | --- | --- | --- |
| Check 4 — loan recovery | `BI_PAYROLL_LOAN_DEDUCTIONS_VS_POSSIBLE_DEDUCTIONS` (`SUBJECT_MONTH`, `MAID_TYPE`, `METRIC_NAME ∈ {Total Loans, Total Loans to Be Deducted, Total Deducted Loans, Undeducted Loans}`, `METRIC_AMOUNT`, `PERCENTAGE`, `TOTAL_LOANS_DENOMINATOR`, `POSSIBLE_DEDUCTION_DENOMINATOR`, `MAIDS_WITH_OUTSTANDING_BALANCE`) | Yes — as **M4a** | **Different denominator.** The approved metric is `Total Deducted / Total Loans to Be Deducted` (what was collectable this month). The n8n check is `repayment / total remaining balance` (the whole outstanding book). Profiled approved percentages run 70–94%; the n8n threshold is 25% against a much larger denominator. **These are not the same number and the 25% threshold cannot be applied to the approved ratio.** Both are shown: M4a (approved) and M4b (P&C book-recovery ratio) |
| Check 7 — arrears | `BI_PAYROLL_UNPAID_SALARY_MONITORING` (`PAYROLL_MONTH`, `MAID_TYPE`, `ROW_TYPE ∈ {Reason, Summary}`, `EXCLUSION_SOURCE ∈ {Automatic, Manual, Both}`, `EXCLUSION_REASON`, `EXCLUSION_COUNT`, `DENOMINATOR_COUNT`, `PERCENTAGE`) | Yes — as **M7a** | **Headcount vs money.** The approved metric counts excluded maids (profiled 0.01–100% by reason). The n8n check is a money ratio: unpaid AED ÷ paid AED ≤ 1%. Both are kept: M7a (approved, headcount, with the reason breakdown P&C needs to work a case) and M7b (P&C money ratio) |
| Check 3 — wage-bill movement | `BI_PAYROLL_SALARY_PAYMENT_PERFORMANCE` (`TOTAL_SALARIES`, `PAID_SALARIES`, `PAID_SALARIES_PCT`, `PENDING_SALARIES`, `EXCLUDED_SALARIES` + pct) | Partly — as the **denominator source** | The approved model counts salaries (headcount), not AED. Check 3 is an AED month-over-month delta. The approved counts are displayed alongside as the denominator, per the trend-monitor rule that a ratio without its denominator is unreadable |
| Check 9 — account diversion | `BI_PAYROLL_DU_PAY_ADOPTION` (`TOTAL_MAIDS`, `ANSARI_VISA_CARD_MAIDS`, `DU_PAY_CARD_MAIDS`, `BANK_ACCOUNT_OTHER_MAIDS`, `TOTAL_MAIDS_EXCLUDING_BANK_ACCOUNT`, `DU_PAY_PCT_*`, `ANSARI_PCT_*`) | As **context only** | **Not a substitute.** The approved model measures month-level *adoption mix*; Check 9 detects a *per-maid switch between months*. A month with unchanged mix percentages can still contain hundreds of individual diversions. The approved model is shown as the supporting chart; the control itself is M9 |
| Check 8 — pay period / compliance | `BI_PAYROLL_COMPLIANCE_WPS_MONITORING` (`SUBJECT_MONTH`, `MAID_TYPE`, `WPS_STATUS_OR_REASON`, `ACTUAL_WPS_STATUS`, `COUNT`, `PERCENTAGE`, `TOTAL_SALARIES`) | As **context** | The approved model reports WPS-condition compliance and its valid-reason breakdown. Check 8 is narrower: the pay period on the row must be the audit month. Complementary |

**No approved definition exists** for Check 1 (duplicate MOHRE IDs), Check 2 (CC-without-client
ratio), Check 5 (accommodation-day earnings ratios), Check 6 (MV wages vs MV receipts), Check 9
(per-maid account transitions) or Check 10 (CC contract payment reconciliation). These are **new
Police & Control definitions** and should be added to the Data Catalog once approved.

**Known column-naming trap in the approved suite.** The payroll month column is named
`SUBJECT_MONTH` in *Compliance & WPS Monitoring*, *CC Salary Raises*, *Loan Deductions* and both
*Additions* models, and `PAYROLL_MONTH` in *Salary Payment Performance*, *Unpaid Salary
Monitoring* and *Du Pay Adoption*. They mean the same thing. The rename is a known open issue
deferred because `datahouse-ui` reads these names directly. Any join across the suite must handle
both names.

**History limit.** Every gold payroll model profiles a minimum month of **2026-01-01**. The
dashboard's month-over-month checks (3, 9) therefore have prior-month comparison available only
from 2026-02 onward using these models. The silver views reach much further back (D1 to
2020-07-01), so P&C's own metrics can be backfilled where the approved ones cannot.

### 2.3 New data ingestion request — NOT yet in Snowflake

#### N1 — Accommodation-day and full-salary-day earnings (grp1, grp2, grp5, grp6)

- **Definition.** For each maid and payroll month, earnings split by day-group. Confirmed from
  the ERP code (§7, answer 1): days are assigned to a `HousemaidSalaryGroup` by
  `PayrollGroupService.createHousemaidPayrollAttendanceLog`, stamped on
  `HousemaidPayrollAttendanceLog.salaryGroup`:

  | Export column | Enum | Meaning |
  | --- | --- | --- |
  | grp1 | `GROUP_1` | With client / assigned office work — **basic (full) salary** days |
  | grp2 | `GROUP_2` | In accommodation — **accommodation salary** days |
  | grp5 | `GROUP_5` | **Live-out** equivalent of grp1 — basic (full) salary days |
  | grp6 | `GROUP_6` | **Live-out** equivalent of grp2 — accommodation salary days |

  grp5/grp6 are remapped from grp1/grp2 when `liveOut = true`.
- **Source.** ERP — Payroll Management.
- **Native location — CONFIRMED via Ask the Code, 2026-09-02, module
  `erp/magnamedia-payroll-management`.** Per-maid per-month earnings live on
  **`HOUSEMAIDPAYROLLLOGS`**:

  | grp | Column |
  | --- | --- |
  | grp1 | `TOTAL_PRO_RATED_SALARY` |
  | grp2 | `MOHRE_PRO_RATED_SALARY` |
  | grp5 | `TOTAL_LIVE_OUT_PRO_RATED_SALARY` |
  | grp6 | `MOHRE_LIVE_OUT_PRO_RATED_SALARY` |

  The export copies them into `HOUSEMAIDPAYROLLBEANS` as `EARNING_IN_GROUP_ONE`,
  `EARNING_IN_GROUP_TWO`, `EARNING_IN_GROUP_FIVE`, `EARNING_IN_GROUP_SIX` (mirrored on
  `HOUSEMAIDBEANINFOS` when bean info is saved).
- **⚠ This is a sync-add, not a new ingestion.** `HOUSEMAIDPAYROLLLOGS` is *already* the source
  table behind `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` (D1). The four
  columns simply are not projected into that view. **The ask is to add four existing columns to
  an existing model** — substantially smaller than a new pipeline, and it inherits D1's history
  back to 2020-07-01 with no backfill.
- **Owner.** Data team (model change); Payroll Management (ERP) for semantics.
- **Grain in source.** One row per maid per payroll month — the same grain as D1.
- **History needed.** Whatever D1 already holds; no separate backfill expected.
- **Join key.** None needed — same row as D1.
- **Hygiene.** The enum as reported carries `GROUP_1`, `GROUP_2`, `GROUP_5`, `GROUP_6` and no
  `GROUP_3` / `GROUP_4`, which **resolves the long-standing "why does the check skip 3 and 4"
  question: there is nothing to skip** (see O9, now closed pending a one-line confirmation).
  Note the naming trap: `TOTAL_PRO_RATED_SALARY` is the **full-salary-day** figure and
  `MOHRE_PRO_RATED_SALARY` the **accommodation-day** figure — neither name says so, and binding
  them the wrong way round inverts the ratio into a permanent pass.
- **Refresh needed.** Monthly, after payroll lock.

#### N2 — Monthly client payments (ERP `typeOfPayment.id = 1`)

- **Definition.** The recurring monthly payment a client makes for their maid — the receipt side
  of both Check 6 (MV wages must not exceed 90% of MV receipts) and Check 10 (every CC contract
  carrying a maid must have a corresponding received payment).
- **Source.** ERP — Accounting, Payment Report screen. Today the n8n flow reads it live from
  `POST /accounting/payments/page/advancesearch` and
  `POST /accounting/payments/calculatePaymentsSumAndVatByFiltered`.
- **Native location — CONFIRMED via Ask the Code, 2026-09-02, module `erp/magnamedia-accounting`.**
  Every Payment Report filter resolves to two tables:

  | Filter property | Table | Column |
  | --- | --- | --- |
  | `contract.contractProspectType.id` | `CONTRACTS` | `CONTRACT_PROSPECT_TYPE_ID` |
  | `typeOfPayment.id` | `PAYMENTS` | `TYPE_OF_PAYMENT_ID` |
  | `dateOfPayment` | `PAYMENTS` | `DATE_OF_PAYMENT` |
  | `dateChangedToReceived` | `PAYMENTS` | `DATE_CHANGED_TO_RECEIVED` |
  | `status` | `PAYMENTS` | `STATUS` |

  `PAYMENTS` is the same table that already backs `CLIENT_MANAGEMENT_PAYMENTS` (D6) — that view
  exposes `DATE_CHANGED_TO_RECEIVED` as `RECEIVED_DATE`. **What is missing is not a table but two
  things: rows of `TYPE_OF_PAYMENT_ID = 1`, and the `CONTRACTS.CONTRACT_PROSPECT_TYPE_ID` column
  to split CC from MV.**
- **Reachable via.** ERP → Payment Report (`pagecode=PaymentReport`).
- **Owner.** Accounting (ERP) / Data team.
- **Grain in source.** One row per payment.
- **History needed.** From 2024-01-01; backfill required.
- **Join key.** `CONTRACT_ID` (`NUMBER(38,0)`) → the contract key in N3.
- **Hygiene.** Status enum is already known from `CLIENT_MANAGEMENT_PAYMENTS`:
  `RECEIVED, DELETED, BOUNCED, PRE_PDP, PDC, RETURNED_TO_CLIENT, TEARED_UP,
  CANCELLED_WAITING_CLIENT_PICKUP`. **`DELETED` rows are excluded from every ratio** but counted
  separately. `AMOUNT_OF_PAYMENT` can be negative (refunds/reversals) — negatives must be netted
  into the contract's total, never dropped. Two date columns behave differently and both are
  needed: `DATE_OF_PAYMENT` (the scheduled/recorded date, used to assign the payment to a month)
  and `RECEIVED_DATE` / `DATE_CHANGED_TO_RECEIVED` (when it actually landed, used to bound the
  window).
- **Refresh needed.** Monthly, with the audit run.
- **Note.** The simplest resolution is to **widen `CLIENT_MANAGEMENT_PAYMENTS` to include payment
  type `1`** rather than build a parallel model. That is the Snowflake team's call.

#### N3 — Contract ↔ maid link, and contract prospect type

- **Definition.** Which client contract a maid was serving in the payroll month, and whether that
  contract is CC (`contractProspectType.id = 1650`) or MV (`1726`). The payroll export shows this
  as `Contract Name = "Contr-<number>"`; the number is the contract ID.
- **Source.** ERP — Client Management.
- **Native location — CONFIRMED via Ask the Code, 2026-09-02.** The number is **`CONTRACTS.ID`**.
  `CONTRACT_NAME` on the export row is a display string only, `'Contr-' || CONTRACTS.ID` — **it is
  not a foreign key**, so nothing should parse it; join on the ID.
  Join path, as the ERP builds it:
  ```
  HOUSEMAIDPAYROLLBEANS.HOUSEMAID_ID → HOUSEMAIDS.ID
  CONTRACTS.HOUSEMAID_ID = HOUSEMAIDS.ID  AND  CONTRACTS.STATUS = 'ACTIVE'
  CONTRACTS.CLIENT_ID → CLIENTS.ID
  ```
  (Alternate route via the log: `HOUSEMAIDPAYROLLLOGS.HOUSEMAID_PAYROLL_BEAN_ID` →
  `HOUSEMAIDPAYROLLBEANS.ID`, then the same chain.)
- **⚠ Audit defect confirmed in the source, and it must not be ported.** That join filters
  `CONTRACTS.STATUS = 'ACTIVE'` — a **current-state** filter with no date bounding. The payroll
  export therefore links each maid to *the contract she is on now*, not *the contract she served
  during the payroll month*. A contract cancelled between the payroll month and the audit run
  vanishes from the link entirely, so Check 10 loses that contract from its denominator and
  never asks whether its client paid. **The Snowflake build must resolve the contract as-at the
  payroll month**, using the contract's own validity dates, rather than reproducing the
  `STATUS = 'ACTIVE'` snapshot. This is an accuracy improvement over the flow being replaced, and
  it needs the contract validity dates ingested (below).
- **Owner.** Client Management (ERP) / Data team.
- **Grain in source.** One row per contract. The maid↔contract association is time-bounded and
  **must be ingested with its validity dates**, not as a current-state snapshot — see the defect
  above.
- **History needed.** From 2024-01-01, with validity dates; backfill required.
- **Join key.** `CONTRACTS.ID` (`NUMBER`) → N2's `CONTRACT_ID` (`NUMBER(38,0)`);
  `CONTRACTS.HOUSEMAID_ID` (`NUMBER`) → `HOUSEMAIDS_INFO.ID` / D1's `HOUSEMAID_ID`
  (`NUMBER(38,0)`). No cast expected.
- **Hygiene.** The n8n code treats a `Contract Name` that is blank or a bare `"Contr-"` with no
  digits as "maid without contract" and reports the count without failing. Preserve that
  distinction: *malformed contract reference* and *no contract at all* are different findings.
- **Prospect-type column — CONFIRMED.** `CONTRACTS.CONTRACT_PROSPECT_TYPE_ID`. The values `1650`
  (CC) and `1726` (MV) are picklist item IDs; the dashboard must resolve them to labels rather
  than hard-code the integers — `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` /
  `PICKLISTS_ITEMS_TAGS` are the likely resolution path (**label mapping UNVERIFIED**, O11).

#### N4 — Per-month loan repayment, and outstanding balance as-at a month

- **Definition.** How much of a maid's loan book was actually recovered *in the audit month*
  (numerator), and what was outstanding *at the start of that month* (denominator). Check 4
  tests the ratio.
- **Source.** ERP — Payroll Management / Accounting. In the payroll export the columns are
  `Current Month Loan Repayment` (previously `Loan Repayment`) and `Outstanding Balance`
  (previously `Remaining Loan Balance`).
- **Native location — CONFIRMED via Ask the Code, 2026-09-02.** The missing object is the
  **`REPAYMENTS`** table — the repayment transaction ledger. What Snowflake already has (D5) is
  only the loan master.

  | | Table.Column | How a month is identified |
  | --- | --- | --- |
  | **Current-month repayment** (the numerator) | `REPAYMENTS.AMOUNT` — export column `HOUSEMAIDPAYROLLBEANS.LOAN_REPAYMENT` | `REPAYMENT_DATE >= payrollStart AND REPAYMENT_DATE < payrollEnd`, plus `PAID_REPAYMENT = true` and `EXCULDED_FROM_PAYROLL = false` |
  | **Lifetime cumulative repaid** (never the numerator) | `EMPLOYEELOANS.REPAID_AMOUNT`, or `SUM(REPAYMENTS.AMOUNT)` where `PAID_REPAYMENT = true` | no month filter |
  | **Export lifetime total** (never the numerator) | `HOUSEMAIDPAYROLLBEANS.TOTAL_LOAN_REPAYMENTS` | no month filter |

  Keys: `REPAYMENTS.HOUSEMAID_ID` → the maid; `REPAYMENTS.EMPLOYEE_LOAN_ID` → the specific loan.
  **`EXCULDED_FROM_PAYROLL` is spelled exactly that way in the ERP** — the typo is in the schema
  and must be reproduced verbatim, not corrected.
- **Outstanding balance — confirmed.** There is **no persisted maid-level balance column**; the
  ERP computes it at runtime as
  `EMPLOYEELOANS.AMOUNT − EMPLOYEELOANS.REPAID_AMOUNT − EMPLOYEELOANS.WAIVED_AMOUNT`, which is
  exactly the derivation already available from D5. The export's snapshot of it is
  `HOUSEMAIDPAYROLLBEANS.REMAINING_LOAN_BALANCE`. So the **denominator is buildable today from
  D5**; only the numerator needs `REPAYMENTS`.
- **⚠ Two boundary traps to settle at build time.** (a) The month window is half-open in the v2
  code (`< payrollEnd`) but the legacy path uses `payrollEnd + 1 day` — **the two disagree by one
  day**, which moves any repayment dated on the last day of the month between months. Pick one,
  state it, and use it consistently. (b) Auto-generated repayment rows are stamped with
  `REPAYMENT_DATE` = the payroll-month date and stay `NOT_FINAL` until payroll is finalised, so a
  run taken before finalisation sees a different figure from one taken after. The audit must read
  after payroll lock.
- **Owner.** Payroll Management (ERP) / Data team.
- **Grain in source.** One row per repayment event.
- **History needed.** From 2024-01-01; backfill required.
- **Join key.** `REPAYMENTS.EMPLOYEE_LOAN_ID` (`NUMBER`) →
  `HOUSEMAID_OUTSTANDING_BALANCE_DETAILS.ID` (`NUMBER(38,0)`); `REPAYMENTS.HOUSEMAID_ID`
  (`NUMBER`) → D1's `HOUSEMAID_ID` (`NUMBER(38,0)`).
- **Hygiene — read this before building.** The n8n code carries a hard-won warning that must
  survive the migration: the payroll export also contains `Total Loan Repayments` (≈ AED 13.7M)
  and `Total loans` (≈ AED 15.2M), which are **lifetime cumulative** figures. Binding the metric
  to those by loose name matching produced a ratio of ~1,082% that reported as a healthy pass.
  Resolve the repayment column by **exact name**, never by "contains loan repayment". Also
  distinguish `WAIVED_AMOUNT` from `REPAID_AMOUNT`: a waiver reduces the balance without
  recovering money and must not count as repayment.
- **Refresh needed.** Monthly.

#### N5 — Mid-month CC↔MV transition

- **Definition.** A maid who changed between CC and MV during the audit month. The n8n check
  read this from the payroll export's `Type Of maid` column, whose five values were `CC`,
  `MV to CC`, `MV`, `CC to MV`, and blank.
- **Source.** ERP — Housemaid Management.
- **Native location.** `UNVERIFIED`. `HOUSEMAID_TYPE_LOGS` looks like the right table but its
  transition columns are unpopulated placeholders (§2.1).
- **Why it matters.** Checks 2, 3, 5, 6, 7 and 10 all partition the population into CC and MV.
  Without a transition record, a maid who switched mid-month lands wholly on one side, and the
  n8n code's own comment concedes this produces small discrepancies. **This is a known,
  quantified inaccuracy, not a defect introduced by the migration** — but the migration is the
  moment to fix it.
- **Requested.** A type-change log with `HOUSEMAID_ID`, `FROM_TYPE`, `TO_TYPE`, `CHANGE_DATE`,
  populated. Until then, the dashboard uses the point-in-time rule (D3) and displays the count of
  maids whose type changed during the month as a data-quality figure.

### 2.4 Sensitive-data handling — binding on the build

Three fields in scope are personal or financial data about identifiable workers:

| Field | Rule |
| --- | --- |
| `HOUSEMAID_PAYROLL_HISTORY.EMPLOYEE_ACCOUNT_WITH_AGENT` | Used **inside** the Check 9 comparison. Never displayed in full. The exception row shows the **classification transition** (e.g. `Normal IBAN → du Pay`) and a masked account (`••••1234`, last 4 only). Full values are retrievable only in the ERP by an authorised investigator |
| `HOUSEMAID_PAYROLL_HISTORY.NET_SALARY` and every per-maid amount | Aggregate metrics over salary are the point of this report and are fine. **A per-maid salary figure is not displayed in the dashboard or exported by default.** Exception rows show the maid identifier, the rule breached, and the amount *only where the amount is the finding itself* (Checks 7 and 10). Checks 1, 8 and 9 show no amount |
| `HOUSEMAIDS_INFO.PHONE_NUMBER`, `NORMALIZED_PHONE_NUMBER`, `NORMALIZED_WHATS_APP_PHONE_NUMBER`, `EID`, `PASSPORT_NUMBER` | **Never selected.** Not in the model, not in the export, not in the mockup |
| `HOUSEMAIDS_INFO.NAME` | Masked in the dashboard (`Maid #4471`). The unmasked name is available only through the ERP record the row points to |

The predecessor system mailed the full report body, including 25k payroll rows, to an inbox.
**This dashboard is not emailed.** Notification is a link to the dashboard; the data stays behind
Snowflake's access controls. That is a requirement of this spec, not a preference.

---

## 3. Metric Calculations

Conventions applying to every metric below: currency is **AED**, single-currency, no FX.
Percentages are computed at full precision and **rounded to 2 dp for display only** — never
rounded before a threshold comparison. Amounts are rounded to 0 dp for display, summed at full
precision. `NULL` amounts are treated as **zero**; `NULL` classification (maid type unresolved)
**excludes the row from ratio denominators and raises it as a data-quality exception** — it is
never silently treated as CC or MV. Division by zero renders as `—` and sets the check to
**SKIPPED**, never to PASS.

**The three-state rule.** Every check is `PASS`, `FAIL` or `SKIPPED`. `SKIPPED` means the check
could not be evaluated (missing column, empty population, absent prior month). **A skipped check
drives the overall month to FAIL.** This is deliberate and carried over from the n8n code, which
learned it the hard way: a fraud check that could not run once rendered green and was
indistinguishable from "we compared both months and found nothing".

---

### M1 — Duplicate MOHRE IDs (Check 1)

- **Business definition.** No two payroll rows in the audit month may share an
  `EMPLOYEE_UNIQUE_ID`. A duplicate means one person is positioned to be paid twice.
- **Formula.** `M1 = COUNT of EMPLOYEE_UNIQUE_ID values appearing more than once within one PAYROLL_MONTH`
- **Inputs.** D1.1, D1.2
- **Filters.** `PAYROLL_MONTH = audit_month`; `EMPLOYEE_UNIQUE_ID` matches `^[0-9]+$`;
  `HOUSEMAIDS_INFO.IS_DELETED` false.
- **Row-identity rule (carried from n8n, do not drop).** The source spreadsheet ended with a
  trailer block whose `Employee Unique ID` cell read the literal `MOL Company Number`, followed by
  a summary row carrying the numeric MOL company number `0000000836318`. That numeric value
  passed the numeric-ID test and inflated every row count by one, creating a phantom red flag.
  In Snowflake the trailer does not exist, **but the company MOL number may still appear as a
  value** — exclude any `EMPLOYEE_UNIQUE_ID` equal to the company MOL number, and state that
  exclusion on the report. Note also that **53 real maids legitimately have leading-zero MOHRE
  IDs**, so the ID must be handled as `VARCHAR` throughout; casting to a number silently merges
  `0001234` and `1234`.
- **Nulls.** Blank or non-numeric ID → excluded from the check and raised as its own
  data-quality exception.
- **Threshold.** Green: 0. Red: ≥ 1. There is no amber — a duplicate is never tolerable.
- **Exception row.** maid identifier, MOHRE ID, number of occurrences. No amount.

### M2 — CC maids without a client (Check 2)

- **Business definition.** The share of CC maids not currently placed with a client. CC maids are
  on the company's own visa and cost money whether or not they are deployed, so a rising
  unplaced share is a direct margin leak.
- **Formula.** `M2 = COUNT(CC maids WHERE STATUS <> 'WITH_CLIENT') / COUNT(CC maids)`
- **Inputs.** D1.6, D3
- **Filters.** `PAYROLL_MONTH = audit_month`; maid type = CC per D3.
- **Rounding.** Ratio at full precision; display 2 dp.
- **Division by zero.** Zero CC maids → `SKIPPED`.
- **Threshold.** Green ≤ 5.00%. Red > 5.00%. *(Carried from n8n `CC_RATIO_MAX = 0.05`.)*
- **Open question for the requestor.** The n8n rule treats every non-`WITH_CLIENT` status as
  "without client", including `ON_VACATION`, `SICK_WITHOUT_CLIENT`, `PENDING_VACATION` and
  `ASSIGNED_OFFICE_WORK`. Those are arguably legitimately-unplaced rather than idle. **Confirm
  whether the denominator should exclude them** — it materially moves the ratio. Recorded as O4.

### M3 — CC wage-bill month-over-month movement (Check 3)

- **Business definition.** The total CC payroll must not jump by more than AED 300,000 against
  the previous month. A fall is normal attrition and never a finding.
- **Formula.**
  `M3_current = SUM(NET_SALARY) WHERE maid type = CC AND PAYROLL_MONTH = audit_month`
  `M3_prior   = SUM(NET_SALARY) WHERE maid type = CC AND PAYROLL_MONTH = audit_month - 1 month`
  `M3 = M3_current − M3_prior`  *(signed)*
- **Inputs.** D1.2, D1.3, D3
- **Prior month.** Read from the same table — this removes the n8n flow's `prev_cc_total`
  input, which had to be supplied by the retired portal and was a required non-zero field with no
  automatic source. **That entire failure mode disappears in Snowflake.**
- **Denominator display.** Show `PAID_SALARIES` / `TOTAL_SALARIES` from
  `BI_PAYROLL_SALARY_PAYMENT_PERFORMANCE` for both months next to the AED figures. A wage-bill
  move driven by headcount is a different finding from the same move at flat headcount, and the
  two are indistinguishable without the denominator.
- **Threshold.** Green: `M3 ≤ +300,000` (including any negative value). Red: `M3 > +300,000`.
- **Nulls.** Prior month absent → `SKIPPED`.

### M4 — Loan recovery (Check 4)

Two metrics, because the approved definition and the P&C check have different denominators.

**M4a — approved (reused verbatim).** From
`BI_PAYROLL_LOAN_DEDUCTIONS_VS_POSSIBLE_DEDUCTIONS`, filtered `SUBJECT_MONTH = audit_month`:
`Total Deducted Loans` as a percentage of `POSSIBLE_DEDUCTION_DENOMINATOR`. All the model's own
filters retained. Displayed with its `MAIDS_WITH_OUTSTANDING_BALANCE` count.

**M4b — P&C book-recovery ratio (new definition).**

- **Business definition.** How much of the total outstanding loan book was recovered this month.
- **Formula.** `M4b = SUM(current-month loan repayment) / SUM(outstanding balance at month start)`
- **Inputs.** Denominator: **D5, available today** — the ERP computes the balance as
  `AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT` (§7 answer 2) and all three columns are in
  `HOUSEMAID_OUTSTANDING_BALANCE_DETAILS`. Numerator: **N4 (`REPAYMENTS`), not yet in Snowflake**.
- **Denominator caveat.** D5 gives the balance *as of now*, not *as at the start of the audit
  month*. Reconstructing the month-start balance means adding back repayments and waivers made
  since — which needs the same `REPAYMENTS` ledger. So N4 unblocks both halves, and until it
  lands the denominator is an approximation that must not be presented as exact.
- **Interim.** Until N4 lands, M4b renders `SKIPPED — awaiting the REPAYMENTS ledger (N4)`,
  which drives the month to FAIL by the three-state rule. If P&C would rather the month not fail
  on a known ingestion gap, that is a deliberate decision to record — see O3. M4a (the approved
  metric) still renders throughout, so the month is not without a loan-recovery signal.
- **Filters.** Exclude `WAIVED_AMOUNT` from the numerator: a waiver reduces the balance without
  recovering cash. Numerator rows require `PAID_REPAYMENT = true` and
  `EXCULDED_FROM_PAYROLL = false`, per §7.
- **Threshold.** Green ≥ 25.00%. Red < 25.00%. *(Carried from n8n `LOAN_RATIO_MIN = 0.25`.)*
- **Guard.** If the denominator sums to zero across a populated month (> 100 maids), the result
  is `SKIPPED — column present but empty`, **not** a 0.00% failure. The n8n code made this
  distinction explicitly and it must survive: an input problem must never render as a business
  finding.

### M5 — Accommodation-day earnings (Check 5)

- **Business definition.** Accommodation-salary-day earnings must be at least 1% of
  full-salary-day earnings. Grp1 and Grp5 are full-salary days; Grp2 and Grp6 are accommodation
  days. If the accommodation share collapses, either the lower rate has stopped being applied or
  day classification has broken — both mean maids are being paid the wrong amount.
- **Formula.** Three sub-ratios, **all** of which must pass:
  `M5a = SUM(grp2) / SUM(grp1)`
  `M5b = SUM(grp6) / SUM(grp5)`
  `M5c = (SUM(grp2) + SUM(grp6)) / (SUM(grp1) + SUM(grp5))`
- **Inputs.** N1 — four columns to be projected into D1's model.
- **Filters — the ERP answer settles the old disagreement.** The n8n comment claimed
  "Grp1/Grp2: CC maids only. Grp5/Grp6: all maid types", while the code applied a CC-only filter
  to all four sums. The ERP code (§7) shows the comment was simply wrong: **grp5/grp6 are the
  live-out remapping of grp1/grp2**, not a different maid population. The split is
  live-in vs live-out *within* CC, so the running code's CC-only filter is correct and should be
  kept. This also means the three sub-ratios read as: **M5a = live-in accommodation share,
  M5b = live-out accommodation share, M5c = combined.** O5 closes.
- **Consequence for M5b.** If the CC population has no live-out maids in a month, `SUM(grp5) = 0`
  and M5b is `SKIPPED` — correctly, and not a fault. `HOUSEMAIDS_INFO.LIVE_OUT` gives the
  live-out headcount; display it next to M5b so a skip is self-explaining.
- **Division by zero.** Any zero denominator → that sub-check `SKIPPED`, and the parent check
  `SKIPPED`.
- **Threshold.** Green ≥ 1.00% on all three. Red if any is below.
  *(Carried from n8n `GRP_RATIO_MIN = 0.01`.)*

### M6 — MV wages vs MV client receipts (Check 6)

- **Business definition.** Total MV salaries paid must not exceed 90% of the monthly client
  payments received for MV contracts. MV maids are on the client's visa and the client's monthly
  payment funds the wage; if wages approach or exceed receipts, the company is subsidising the
  placement.
- **Formula.** `M6 = SUM(NET_SALARY WHERE maid type = MV) / SUM(monthly client payments received on MV contracts)`
- **Inputs.** D1.3, D3 (numerator — available); N2, N3 (denominator — **blocked**).
- **Filters — denominator, carried exactly from the n8n ERP call.**
  contract prospect type = MV (`1726`); payment type = monthly (`1`); `STATUS = 'RECEIVED'`;
  `DATE_OF_PAYMENT` = the **first day of the month after the audit month**;
  `RECEIVED_DATE` between the first day of the audit month and the run date.
- **Plausibility floor — carried from n8n, and it earned its place.** A production run returned a
  denominator of AED 3,431 against ~19,659 MV maids; it was truthy so it passed the zero-check and
  rendered as a threshold *result* rather than a broken fetch. Rule: if the denominator is below
  **10% of MV salaries**, the check is `SKIPPED — implausible receipts total`, never `FAIL`.
  Healthy runs land near AED 33.4M against AED 28.0M of MV salaries (83.87%), so the floor leaves
  roughly 8× headroom before a false trip.
- **Threshold.** Green ≤ 90.00%. Red > 90.00%. *(n8n `MV_RATIO_MAX = 0.90`.)*
- **Note on the date filter asymmetry.** The MV query pins `dateOfPayment` to a **single exact
  date** (the 1st) while the CC query uses a **range across the whole month**. That asymmetry is
  in the running code. It is probably a bug — an MV payment dated the 2nd is invisible to the
  numerator's counterpart — but it is not this spec's place to change a threshold silently.
  Recorded as O6 for the requestor to decide.

### M7 — Previously unpaid salaries (Check 7)

**M7a — approved (reused verbatim).** From `BI_PAYROLL_UNPAID_SALARY_MONITORING`, filtered
`PAYROLL_MONTH = audit_month`, all filters retained. Shows `EXCLUSION_COUNT` /
`DENOMINATOR_COUNT` and `PERCENTAGE` split by `MAID_TYPE`, `EXCLUSION_SOURCE` and
`EXCLUSION_REASON`. The reason breakdown is what lets P&C work a case, so it is shown in full,
not just the summary row.

**M7b — P&C money ratio (new definition).**

- **Business definition.** Arrears carried into this month, as a share of what was paid, computed
  separately for CC and MV. Both must be within tolerance for the check to pass.
- **Formula.** For each of CC and MV: `M7b = SUM(previously unpaid salaries) / SUM(NET_SALARY)`
- **Inputs.** D1.3, D1.10, D3, plus N6 (below).
- **Native source — CONFIRMED via Ask the Code, 2026-09-02.** The export column is
  `HOUSEMAIDPAYROLLBEANS.PREVIOUSLY_UNPAID_SALARIES` (mirrored on `HOUSEMAIDBEANINFOS`). It is
  **not** a stored column on `HOUSEMAIDPAYROLLLOGS`; it is computed at export time as the sum of
  `TOTAL_SALARY` over that maid's prior `HOUSEMAIDPAYROLLLOGS` rows that remain unpaid.
- **⚠ The check may be half-vacuous today, and this is the most consequential finding in the
  spec.** The ERP computes `PREVIOUSLY_UNPAID_SALARIES` **only for maid-visa (MV) maids**. If
  that is right, then the n8n check's **CC arm has always summed to zero and always passed** —
  a green tick that tested nothing, on the arrears control, for the whole life of the flow. It
  would also mean CC arrears are currently unmeasured anywhere. Two consequences for this build:
  1. Do **not** port `PREVIOUSLY_UNPAID_SALARIES` as the CC numerator. For CC, derive arrears
     from D1 directly: prior `PAYROLL_MONTH` rows for the same `HOUSEMAID_ID` that carry an
     exclusion reason (D1.10) and no `PAID_ON_DATE_FORMATTED`. That is a **new P&C definition**
     and is labelled as one — see N6.
  2. Until it is confirmed, M7b's CC arm renders `SKIPPED — CC arrears source unconfirmed`
     rather than `PASS`. A control that cannot be evaluated must not read as clear; that is the
     same failure this spec's three-state rule exists to prevent.
  Recorded as **O12**, blocking.
- **Threshold.** Green ≤ 1.00% for **both** CC and MV. Red if either exceeds.
  *(n8n `UNPAID_RATIO_MAX = 0.01`.)*
- **Division by zero.** A type with zero paid salary → that side `SKIPPED`, parent `SKIPPED`.

#### N6 — CC arrears (new, arising from the finding above)

- **Definition.** Salary owed to a CC maid for a prior payroll month and still unpaid at the
  audit date. The MV equivalent exists in the ERP as `PREVIOUSLY_UNPAID_SALARIES`; the CC
  equivalent appears not to.
- **Requested.** Either (a) extend the ERP computation to CC maids, or (b) confirm that the
  derivation from D1 above (prior months with an exclusion reason and no paid date) is the
  correct CC definition, so it can be built in Snowflake without an ERP change.
- **Owner.** Payroll Management (ERP) + Police & Control.
- **Note.** Option (b) is buildable from data already in Snowflake and needs no ingestion — it
  needs a definition decision, not a pipeline.

### M8 — Pay period correctness (Check 8)

- **Business definition.** Every payroll row in the audit month must carry a pay period starting
  on the **first day of the audit month**. A row on the wrong period is paid against the wrong
  month's budget and breaks every other month-scoped metric.
- **Formula.** `M8 = COUNT(rows WHERE pay period start <> first day of audit month)`
- **Inputs.** D1.2, D1.9
- **Mapping note.** In the spreadsheet this was `Pay Start Date`. In Snowflake `PAYROLL_MONTH` is
  already the first day of the month by construction, so a naive port makes this check
  tautological and it would always pass — a green tick that tests nothing. **The check must
  instead compare `PAID_ON_DATE_FORMATTED` and `WPS_RECORDS.PAYROLL_DATE` against
  `PAYROLL_MONTH`**, which is the real integrity question: was the money moved for the period it
  claims to be for. This is the one check whose meaning genuinely changes in the migration, and
  the change is an improvement — flagged prominently as O2 because it needs P&C's sign-off.
- **Nulls.** Missing pay date → exception with reason `empty`. Unparseable → reason
  `invalid date`. Both are findings, not skips. `PAID_ON_DATE` is free text in the source and
  `PAID_ON_DATE_FORMATTED` parses only three formats — **a fourth format would land as NULL and
  read as "empty"**, so the count of unparseable values is displayed as a data-quality figure.
- **Threshold.** Green: 0 rows. Red: ≥ 1.
- **Exception row.** maid identifier, MOHRE ID, the date found, the expected month, the reason.

### M9 — Bank-account diversion (Check 9)

- **Business definition.** Compare each maid's payment account between the audit month and the
  prior month. Most changes are benign; five specific transitions are the signature of salary
  diversion and are the finding.
- **Formula.** `M9 = COUNT of maids whose account classification transition is in the red-flag set`
- **Inputs.** D1.1, D1.7, D1.8
- **Account classification.** Use `ANSARI_PAYMENT_METHOD` (D1.8), which the model already derives
  from the account string, in preference to re-implementing the regexes. The n8n patterns are
  recorded here so the two can be reconciled during the build, because **the category sets are
  not identical** and the mapping must be agreed before this check goes live:

  | n8n category | n8n pattern | Nearest `ANSARI_PAYMENT_METHOD` value |
  | --- | --- | --- |
  | du Pay | `^AE\d{2}026075123000\d{7}$` | `DU_PAY_CARD` |
  | Ansari | `^00000000001\d+$` | `ANSARI_VISA_CARD` |
  | Normal IBAN | `^AE\d{21}$` (not matching the above) | `BANK_TRANSFER` |
  | *(no equivalent)* | — | `FAB_MASTER_CARD` — **unmapped; P&C must decide its treatment** |
  | empty | blank | `''` |

- **Red-flag transition set** (prior → current), carried verbatim:
  1. Normal bank IBAN → du Pay
  2. Normal bank IBAN → Ansari
  3. du Pay → a *different* du Pay account
  4. du Pay → Ansari
  5. Ansari → a *different* Ansari account

  Every other transition — including normal → different normal IBAN, anything → empty, and
  empty → anything — is **not** a finding.
- **Comparison rules.** Match on `EMPLOYEE_UNIQUE_ID`. Compare only where **both** months have a
  non-empty account. Normalise by trimming and upper-casing before comparing, so ` ae67…` and
  `AE67…` are not reported as a change. A maid absent from the prior month is a new employee and
  is skipped, with the count displayed.
- **Threshold.** Green: 0. Red: ≥ 1. No amber.
- **If the prior month is unavailable:** `SKIPPED`, rendered amber with the words *"No account
  comparison was performed this month — treat as UNVERIFIED, not clear."* Never green.
- **Display.** Masked accounts and the classification transition only (§2.4).

### M10 — CC contract payment reconciliation (Check 10)

- **Business definition.** Every CC contract with a maid on payroll this month should have a
  corresponding monthly client payment. Contracts with no payment, or with a payment stuck in a
  non-received state, are revenue that has not arrived.
- **Formula.** `M10 = COUNT(DISTINCT CC contracts with no received payment) / COUNT(DISTINCT CC contracts on payroll)`
  with supporting figures: CC maid count, CC total salary, received contracts and total,
  not-received contracts and total, contracts with no payment at all.
- **Inputs.** D1.3, D3 (payroll side — available); N2, N3 (payment side — **blocked**).
- **Filters.** Payment `DATE_OF_PAYMENT` between the first and last day of the **month after** the
  audit month; contract prospect type = CC (`1650`); payment type = monthly (`1`).
  `STATUS = 'DELETED'` rows are ignored entirely.
- **Bucket rule (carried from n8n, and it matters).** The three contract buckets are **mutually
  exclusive** and must satisfy
  `received + not_received + no_payment = total CC contracts on payroll`.
  A contract with mixed payments — some received, some not — is classified **received**:
  receiving any payment counts as the contract being collected on. Display that identity on the
  report; if it does not hold, the report is wrong and must say so rather than show the numbers.
- **Threshold.** Green ≤ 5.00% not-received. Red > 5.00%. *(n8n `maxNotReceivedRatio = 0.05`.)*
- **Data-quality failures — these fail the check independently of the ratio.**
  duplicate contract references in payroll; the payment source returning fewer rows than it
  reports as available (truncation); an unrecognised response shape; **zero CC contracts resolved
  from a populated payroll file**. That last one is explicitly a FAIL, not a PASS — the n8n code
  had a defect where an empty population rendered green, and the fix must carry over.
- **Note.** `Maids without contracts` (blank or bare `Contr-` reference) is **reported as a count
  but does not fail the check**. Preserve that.

---

### Global guards — these abort or downgrade the whole month

Carried from the n8n code. They exist because each one has already prevented a false green.

| Guard | Rule | Outcome |
| --- | --- | --- |
| **G1 — classification collapse** | With > 100 payroll rows in the month, `COUNT(CC) = 0` or `COUNT(MV) = 0` | **Abort the run.** Checks 2, 3, 5, 6, 7, 10 all partition on maid type; on an empty partition they report PASS on a zero population |
| **G2 — partial classification** | With > 100 payroll rows, `COUNT(CC) + COUNT(MV) < 50%` of rows | **Abort the run.** The classification columns have changed shape |
| **G3 — implausible MV receipts** | MV client receipts < 10% of MV salaries | `SKIPPED` for M6 with the reason stated. See M6 |
| **G4 — skipped drives fail** | Any check `SKIPPED` | Month result = **FAIL**. Skipped is neither pass nor fail, but an incomplete audit is not a clean audit |

### Tie-out rule

Three identities must hold for the month, and each is displayed on the report. A broken identity
is itself an exception row.

1. **Population.** `CC maids + MV maids + unclassified maids = total payroll rows for the month.`
   The unclassified count must be zero for a clean month; any non-zero value appears as a
   data-quality exception (and, above the G2 threshold, aborts).
2. **Contract buckets (M10).**
   `received contracts + not-received contracts + contracts with no payment = distinct CC contracts on payroll.`
3. **Wage bill against the independent second source.**
   `SUM(HOUSEMAID_PAYROLL_HISTORY.NET_SALARY) for the month` reconciled against
   `SUM(WPS_RECORDS.PAID_SALARY) for the same month`, matched on `EMPLOYEE_UNIQUE_ID`.
   The variance and the count of maids present on only one side are displayed. **This tie-out did
   not exist in the n8n flow** — it had only one view of the payroll. Snowflake has two
   independent ones, and using both is the single biggest control improvement available in this
   migration: it is the difference between checking that the payroll file is internally
   consistent and checking that the money actually moved.

---

## 4. Finalised UI Report

**Archetype.** Primarily **exception / rule-breach list** (archetype 4), with a
**two-sided reconciliation** panel for the tie-out and a **trend monitor** strip for the
month-over-month ratios.

**Layout.** One screen: KPI strip → check status grid → exception table → tie-out line →
one supporting chart.

**KPI tiles (5).**

| Tile | Source | Notes |
| --- | --- | --- |
| Month result | Pass / Fail / Fail (incomplete) | Amber wording when the failure is caused only by skipped checks |
| Checks failed | count | Of 10 |
| Checks skipped | count | Amber — never folded into "passed" |
| Exceptions to work | count | Sum of exception-grain rows across M1, M7, M8, M9, M10 |
| Amount at risk | AED | Not-received CC payments (M10) + arrears (M7b). The only money tile; it is what P&C escalates on |

**Check status grid.** Ten rows, one per check: ID · name · status badge · headline metric ·
threshold · exception count. Each row expands to the metric detail and its exception table.

**Exception table columns.**

| Column | Source | Format | Sort/default |
| --- | --- | --- | --- |
| Check | M1–M10 | `M9` | — |
| Rule breached | metric definition, in the rule's own words | text | — |
| Subject | masked maid (`Maid #4471`) or contract (`Contr-118432`) | text | — |
| MOHRE ID | D1.1 | text, leading zeros preserved | — |
| Maid type | D3 | `CC` / `MV` | — |
| Detail | e.g. `Normal IBAN ••••4417 → du Pay ••••9902` | text | — |
| Amount involved | AED, **only where the amount is the finding** (M7, M10) | `#,##0` right-aligned | **desc — default sort** |
| Detected | run date | date | secondary sort |
| Status | reviewed / open | badge | — |

Default sort is **amount involved descending, then detected date** — P&C works the biggest money
first, not the newest row.

**Filters.** Audit month (default: previous calendar month) · check ID (default: all) ·
maid type (default: all) · status (default: open only) · severity (default: red + amber).

**Drill-down.** Clicking an exception row opens the per-maid or per-contract detail: the metric
inputs for that row, the arithmetic, the prior-month comparison where the check uses one, and a
deep link to the ERP record. **The drill-down does not reveal the full bank account or the
individual salary** — it shows the classification and the ERP link, and the investigator reads
the sensitive value in the ERP under its own access control.

**Conditional formatting.** Row colour is driven by check status, never by colour alone — every
row carries a text badge (`RED` / `AMBER` / `SKIPPED` / `OK`) so it survives printing,
screenshotting into an audit note, and colour-vision deficiency. Grey/`SKIPPED` is displayed as
prominently as red; it is a finding, not an absence of one.

**Provenance line.** One line, always visible:
`Sources: HOUSEMAID_PAYROLL_HISTORY · HOUSEMAIDS_INFO · WPS_RECORDS · HOUSEMAID_OUTSTANDING_BALANCE_DETAILS · CLIENT_MANAGEMENT_PAYMENTS · BI_PAYROLL_* (approved) — audit month YYYY-MM — data as of <timestamp> Gulf`

**Export.** CSV of the exception grain, honouring §2.4 masking. The export contains the same
columns the screen shows — it is not a privileged wider extract.

**Delivery.** A link. **No emailed report body.** See §2.4.

**Mockup.** https://claude.ai/code/artifact/5ffa76cd-ac5c-4517-a6ed-c3dfdd0e9924 — every figure in it is synthetic. It deliberately renders the expected day-one state (four checks `SKIPPED` pending N1/N4/N6) rather than an all-green month, so the layout is approved against how the report will actually read on the first run.

---

## 5. Worked Examples

Values below are **synthetic and illustrative**. They are arithmetically self-consistent so the
formulas can be checked, but no figure is real and no identifier belongs to a real person.
Validating these against two real cases P&C has already worked by hand is Open Item O7.

### Example A — clean case (M3, CC wage-bill movement)

| Input | Value |
| --- | --- |
| Audit month | 2026-07 |
| `SUM(NET_SALARY)`, CC, 2026-07 | AED 12,480,000 |
| `SUM(NET_SALARY)`, CC, 2026-06 | AED 12,310,000 |
| CC headcount 2026-07 / 2026-06 | 5,754 / 5,504 |

**Arithmetic.** `M3 = 12,480,000 − 12,310,000 = +170,000`.
`170,000 ≤ 300,000` → within tolerance.

**Expected output row:** Check 3 · `PASS` · Difference `+AED 170,000` · Threshold
`AED 300,000` · Exceptions 0.
**Expected flag:** Green. The rise tracks a 250-maid headcount increase, which the denominator
column makes visible — the wage bill per maid actually fell.

### Example B — the exception this report exists to catch (M9, diversion)

| Input | Value |
| --- | --- |
| Audit month | 2026-07 |
| Maids compared (account present both months) | 5,431 |
| Accounts unchanged | 5,402 |
| Accounts changed | 29 |
| Of which red-flag transitions | 4 |

**The four rows.**

| Subject | Prior → current | Transition | Red flag |
| --- | --- | --- | --- |
| Maid #4471 | `BANK_TRANSFER ••••4417` → `DU_PAY_CARD ••••9902` | Normal IBAN → du Pay | Yes (rule 1) |
| Maid #5188 | `DU_PAY_CARD ••••1120` → `DU_PAY_CARD ••••7734` | du Pay → different du Pay | Yes (rule 3) |
| Maid #2903 | `ANSARI_VISA_CARD ••••0031` → `ANSARI_VISA_CARD ••••0088` | Ansari → different Ansari | Yes (rule 5) |
| Maid #6742 | `BANK_TRANSFER ••••2210` → `ANSARI_VISA_CARD ••••0177` | Normal IBAN → Ansari | Yes (rule 2) |

The other 25 changes were normal-IBAN → different-normal-IBAN and are **not** reported.

**Arithmetic.** `M9 = 4`. Threshold is 0.
**Expected output row:** Check 9 · `FAIL` · Red flags `4` · Compared `5,431` · Unchanged `5,402`
· New employees skipped `315`.
**Expected flag:** Red. Escalates to Finance leadership. Three of these four accounts are
prepaid-card products that can be opened by someone other than the maid, which is why the
transition — not the account itself — is the signal.

### Example C — edge case (M6 + G3, the implausible-denominator trap)

This example is the reason the plausibility floor exists; it is a real failure mode reproduced
with synthetic numbers.

| Input | Value |
| --- | --- |
| Audit month | 2026-07 |
| MV maids on payroll | 19,659 |
| `SUM(NET_SALARY)`, MV | AED 28,020,000 |
| MV client receipts returned by the query | AED 3,431 |

**Naive arithmetic.** `M6 = 3,431 / 28,020,000 = 0.0122%` → `0.0122% ≤ 90%` → **PASS**.

That is the trap. The check would render a green tick meaning "MV wages are comfortably covered"
when in fact the receipts query returned essentially nothing.

**Correct handling.** Plausibility floor = `10% × 28,020,000 = AED 2,802,000`.
`3,431 < 2,802,000` → G3 fires.

**Expected output row:** Check 6 · `SKIPPED` · *"MV client receipts came back at AED 3,431
against AED 28,020,000 of MV salaries, below the AED 2,802,000 plausibility floor. This is a
broken fetch, not a threshold result. Check 6 was not evaluated."*
**Expected flag:** Amber (skipped), and by rule G4 the **month result is FAIL**.
For contrast, a healthy month returns roughly AED 33.4M of receipts against AED 28.0M of
salaries — 83.87%, a genuine pass with about 8× headroom above the floor.

### Example D — edge case (M10, mixed payments on one contract)

| Input | Value |
| --- | --- |
| Contract | `Contr-118432`, CC, one maid on payroll 2026-07 |
| Payment 1 | AED 2,300 · `DATE_OF_PAYMENT` 2026-08-01 · `STATUS = RECEIVED` |
| Payment 2 | AED 2,300 · `DATE_OF_PAYMENT` 2026-08-15 · `STATUS = BOUNCED` |
| Payment 3 | AED −400 · `DATE_OF_PAYMENT` 2026-08-20 · `STATUS = RECEIVED` (refund) |
| Payment 4 | AED 2,300 · `DATE_OF_PAYMENT` 2026-08-03 · `STATUS = DELETED` |

**Arithmetic.** The `DELETED` row is ignored entirely. The contract has at least one `RECEIVED`
payment, so by the bucket rule it is classified **received**, not not-received, even though a
bounce is present. Its received total is `2,300 + (−400) = AED 1,900` — the refund nets in, it is
not dropped.

**Expected output:** contributes 1 to *Received — contracts* and AED 1,900 to *Received payments
— total*. It contributes **nothing** to the not-received bucket, so it does not inflate the M10
ratio. The bounce is not invisible, though: it appears in the not-received *payment* count, which
is displayed separately from the contract count for exactly this reason.
**Expected flag:** Green at the contract level, with the bounced payment visible in the detail.

---

## 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| O1 | **No warehouse grant.** The role `PAYROLL_AND_MONEY_CONTROL_ROLE` has no warehouse USAGE, so no row-level query could be run: table existence, columns, types, profiled value ranges and row counts are verified from metadata, but **freshness, grain and period coverage are asserted, not measured**. Grant warehouse usage (or set a default) and this spec's §2.1 verdicts can be confirmed properly | Data team / Snowflake admin | **Yes** — for evidence quality, not for build start |
| O2 | **M8 changes meaning.** `PAYROLL_MONTH` is the first of the month by construction, so a literal port of the Pay-Start-Date check would always pass and test nothing. Proposed replacement: compare `PAID_ON_DATE_FORMATTED` and `WPS_RECORDS.PAYROLL_DATE` against `PAYROLL_MONTH`. Needs explicit P&C sign-off | Police & Control | **Yes** |
| O3 | **Skipped-drives-fail with a known gap.** M4b and M5 will be `SKIPPED` until N1 and N4 are ingested, which by rule G4 fails every month until then. Confirm whether that is wanted, or whether an ingestion gap should render as a distinct fourth state (`BLOCKED`) that does not fail the month | Police & Control | **Yes** |
| O4 | **M2 denominator.** Should `ON_VACATION`, `SICK_WITHOUT_CLIENT`, `PENDING_VACATION` and `ASSIGNED_OFFICE_WORK` count as "without client"? The n8n rule says yes. It materially moves the ratio | Police & Control | No |
| O5 | ~~M5 population — comment vs code disagreement~~ **CLOSED 2026-09-02.** The ERP code shows grp5/grp6 are the live-out remapping of grp1/grp2, not a different maid population. The running CC-only filter is correct | — | Closed |
| O12 | **`PREVIOUSLY_UNPAID_SALARIES` is computed for maid-visa maids only.** If confirmed, Check 7's CC arm has always summed to zero and always passed — the arrears control has been half-vacuous, and CC arrears are unmeasured. Confirm, then either extend the ERP computation to CC or approve the D1-derived CC definition (N6) | Payroll Management + Police & Control | **Yes** |
| O13 | **Contract link is current-state.** The ERP joins payroll to contract with `CONTRACTS.STATUS = 'ACTIVE'` and no date bounding, so a contract cancelled after the payroll month drops out of Check 10 entirely. The Snowflake build should resolve the contract as-at the payroll month instead. Needs contract validity dates (N3) and P&C sign-off that the change is wanted | Police & Control + Client Management | **Yes** |
| O14 | **Loan month-boundary disagreement.** The v2 payroll code uses `REPAYMENT_DATE < payrollEnd`; the legacy path uses `payrollEnd + 1 day`. They differ by a day and move last-day repayments between months. Pick one for the dashboard and state it | Payroll Management | No |
| O6 | **M6 date asymmetry.** The MV receipts query pins `dateOfPayment` to a single exact date while the CC query uses a full-month range. Likely a bug in the running flow; not changed here without a decision | Police & Control + Accounting | No |
| O7 | **Worked examples are synthetic.** Supply two real cases already verified by hand — one clean month and one that flagged — so §5 can be re-derived against them | Police & Control | No |
| O8 | `FAB_MASTER_CARD` has no counterpart in the n8n red-flag matrix. Decide how transitions into and out of it are treated | Police & Control | No |
| O9 | ~~grp3 / grp4 omission~~ **LIKELY CLOSED 2026-09-02.** The `HousemaidSalaryGroup` enum as reported carries only `GROUP_1`, `GROUP_2`, `GROUP_5`, `GROUP_6` — there is nothing to skip. One-line confirmation from Payroll still wanted | Payroll | No |
| O10 | ~~Native ERP table/column names for N1–N4~~ **CLOSED 2026-09-02** — all four resolved via Ask the Code, see §7 and each N item | — | Closed |
| O11 | Prospect-type IDs `1650` (CC) and `1726` (MV) should be resolved to labels through the picklist tables rather than hard-coded. The column is confirmed (`CONTRACTS.CONTRACT_PROSPECT_TYPE_ID`); the **label mapping is still UNVERIFIED**. `BA_VIEWS.CORE_SILVER.PICKLISTS_INFO` / `PICKLISTS_ITEMS_TAGS` are the likely path | Data team | No |

---

## 7. Ask the Code — ERP native names

Queried on **2026-09-02** against `erp/magnamedia-payroll-management`,
`erp/magnamedia-accounting` and `erp/magnamedia-client-management` (model `composer-2.5`).
All names below are recorded exactly as returned, including the ERP's own misspelling of
`EXCULDED_FROM_PAYROLL`. Answers describe the **ERP operational database**, not Snowflake — a
table existing here means the Snowflake team has a named source to ingest, not that it is
already in the warehouse.

**Answer 1 — day-group earnings and unpaid salaries** (`erp/magnamedia-payroll-management`)

- Enum `HousemaidSalaryGroup`: `GROUP_1`, `GROUP_2`, `GROUP_5`, `GROUP_6`. Days assigned by
  `PayrollGroupService.createHousemaidPayrollAttendanceLog` via
  `HousemaidPayrollAttendanceLog.salaryGroup`.
- grp1 = with client / assigned office work → **basic (full) salary** days.
  grp2 = in accommodation → **accommodation salary** days.
  grp5 / grp6 = the **live-out** equivalents, remapped from grp1 / grp2 when `liveOut = true`.
- Storage on `HOUSEMAIDPAYROLLLOGS`: `TOTAL_PRO_RATED_SALARY` (grp1),
  `MOHRE_PRO_RATED_SALARY` (grp2), `TOTAL_LIVE_OUT_PRO_RATED_SALARY` (grp5),
  `MOHRE_LIVE_OUT_PRO_RATED_SALARY` (grp6). Copied at export into `HOUSEMAIDPAYROLLBEANS` as
  `EARNING_IN_GROUP_ONE` / `_TWO` / `_FIVE` / `_SIX`, mirrored on `HOUSEMAIDBEANINFOS`.
- `PREVIOUSLY_UNPAID_SALARIES` lives on `HOUSEMAIDPAYROLLBEANS` (and `HOUSEMAIDBEANINFOS`).
  Computed **at export** as the sum of `TOTAL_SALARY` over prior unpaid `HOUSEMAIDPAYROLLLOGS`
  rows **for maid-visa maids** — not a stored column on `HOUSEMAIDPAYROLLLOGS`. → **O12**.

**Answer 2 — contract link and loans**
(`erp/magnamedia-payroll-management`, `erp/magnamedia-client-management`)

- `Contr-<number>` is `CONTRACTS.ID`. `CONTRACT_NAME` is a display string
  `'Contr-' || CONTRACTS.ID` and **not a foreign key**.
- Join: `HOUSEMAIDPAYROLLBEANS.HOUSEMAID_ID → HOUSEMAIDS.ID`;
  `CONTRACTS.HOUSEMAID_ID = HOUSEMAIDS.ID AND CONTRACTS.STATUS = 'ACTIVE'`;
  `CONTRACTS.CLIENT_ID → CLIENTS.ID`. Alternate entry:
  `HOUSEMAIDPAYROLLLOGS.HOUSEMAID_PAYROLL_BEAN_ID → HOUSEMAIDPAYROLLBEANS.ID`. → **O13**.
- No persisted maid-level loan balance; computed as
  `EMPLOYEELOANS.AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT`. Export snapshot:
  `HOUSEMAIDPAYROLLBEANS.REMAINING_LOAN_BALANCE`.
- Current-month repayment: `REPAYMENTS.AMOUNT` (export `HOUSEMAIDPAYROLLBEANS.LOAN_REPAYMENT`),
  filtered `REPAYMENT_DATE >= payrollStart AND REPAYMENT_DATE < payrollEnd` (legacy path uses
  `payrollEnd + 1 day` → **O14**), `PAID_REPAYMENT = true`, `EXCULDED_FROM_PAYROLL = false`.
  Lifetime figures — `EMPLOYEELOANS.REPAID_AMOUNT` and
  `HOUSEMAIDPAYROLLBEANS.TOTAL_LOAN_REPAYMENTS` — must never be used as the numerator.

**Answer 3 — Payment Report filters** (`erp/magnamedia-accounting`)

| Filter property | Table | Column |
| --- | --- | --- |
| `contract.contractProspectType.id` | `CONTRACTS` | `CONTRACT_PROSPECT_TYPE_ID` |
| `typeOfPayment.id` | `PAYMENTS` | `TYPE_OF_PAYMENT_ID` |
| `dateOfPayment` | `PAYMENTS` | `DATE_OF_PAYMENT` |
| `dateChangedToReceived` | `PAYMENTS` | `DATE_CHANGED_TO_RECEIVED` |
| `status` | `PAYMENTS` | `STATUS` |

**Still outstanding.** The picklist labels behind `CONTRACT_PROSPECT_TYPE_ID` values `1650` /
`1726` and `TYPE_OF_PAYMENT_ID` value `1` — carried as **O11**. Everything else these questions
were asked to resolve came back.

**Caveat on all of the above.** Ask the Code answers are generated from code and can miss a
second table holding adjustments, overrides or corrections. Where a number matters — the loan
numerator especially — the Snowflake team should probe for adjustment and reversal tables before
treating the named column as complete.

---

## 8. What the migration removes

Worth stating plainly, because it is most of the value:

| n8n mechanism | Fate in Snowflake |
| --- | --- |
| Two human-uploaded spreadsheets POSTed in a request body | **Gone.** Both are ERP tables already in the warehouse |
| `prev_cc_total` — a required, non-zero, portal-supplied input with no automatic source | **Gone.** Read the prior month from the same table |
| `prev_ansari_data` — prior-month accounts passed in the payload, absent of which the fraud check silently skipped | **Gone.** Prior month is one more row set |
| ERP session token, `isERPAuth`, `deviceIdProduction` concatenated into a Cookie header and retained in plaintext in every execution | **Gone.** No live ERP call |
| A retained execution holding 25,290 unredacted payroll rows | **Gone.** No execution store |
| The full report body, payroll figures included, emailed to an inbox | **Gone.** Link only — §2.4 |
| Column-rename fragility (`Remaining Loan Balance` → `Outstanding Balance` between two monthly exports, silently) | **Reduced.** Typed warehouse columns; a rename becomes a build error rather than a wrong number |
| Single source of truth for the wage bill | **Improved.** Two independent sources, reconciled — tie-out 3 |

The one thing the migration does **not** fix on its own is the mid-month CC↔MV transition (N5):
that needs an ERP change, not a warehouse change.
