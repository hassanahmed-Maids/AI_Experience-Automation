# Spec — Housemaid Payroll Critical Checks

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Spec version** | v2 |
| **Date** | 2026-09-02 |
| **UI mockup** | https://claude.ai/code/artifact/5ffa76cd-ac5c-4517-a6ed-c3dfdd0e9924 |
| **Status** | Draft — awaiting requestor approval point by point |
| **Replaces** | n8n workflow `zwSxrV00VE4rOSvd` — "Housemaid Payroll Critical Checks On Security Room" (`active: false`, blocked at intake; n8n is being deprecated) |

**Changes from v1** (all from the spec-auditor gate, 2026-09-02 — v1 was never issued):
contract data was found to exist in `BA_VIEWS.SALES_SILVER` and moved from an ingestion
request to a verified data point (D7), unblocking half of Checks 6 and 10; Example C's M6
arithmetic was inverted and is corrected; M10's numerator and threshold measured different
quantities; the §1 `RECEIVED_DATE` bound silently deleted M10's not-received bucket;
`IS_DELETED` is TEXT `'00'/'01'`, not a boolean; M7b divided gross by net; tie-out 3 had no
de-duplication rule, month column or tolerance; the recurring schedule now names an owner;
§2.4 contradicted itself on displaying per-maid amounts. Details at each site.

---

## 0. Why this spec exists

The ten checks below run today as a single n8n code node. That flow is deprecated, and it is
already non-runnable: its `Load Inputs` node throws by design because the two spreadsheets it
depended on — the Al Ansari bank payroll file and an ERP payroll export — were uploaded by a
human through the retired Security Room portal, which POSTed them in a request body. One
retained execution held 25,290 unredacted payroll rows alongside four live ERP session fields.

Moving to Snowflake is therefore not only a platform migration. It removes the file-upload
intake that caused the exposure, because **the content of both spreadsheets already exists
inside Snowflake** as ERP-sourced tables. This spec re-expresses each check against those
tables and names, explicitly, what is not yet there.

**Scope note.** This spec defines *what must be true of the data and the numbers*. It does not
design the pipeline, the dbt models, or the refresh mechanism.

---

## 1. Business Logic

**The control.** Every month, before the housemaid payroll is released, ten arithmetic and
integrity conditions must hold across the payroll population. Each is a statement about money
that is either true or false for the month: no maid is paid twice, the CC population is
substantially deployed to clients, the month-over-month CC wage bill has not jumped, loans are
being recovered, accommodation-day pay is being applied, MV wages do not outrun MV client
receipts, arrears are immaterial, everyone's pay period is the correct month, nobody's bank
account moved in a pattern that indicates diversion, and every CC contract carrying a maid has
a matching client payment.

**The failure it catches.** Five distinct failure modes, kept distinguishable rather than
collapsed into one "payroll looks wrong" signal:

| Failure mode | Caught by |
| --- | --- |
| **Payroll fraud / diversion** — a maid's salary redirected to an account controlled by someone else | Check 9 (bank-account transitions), Check 1 (duplicate MOHRE ID = two payments for one person) |
| **Overpayment / wage-bill leakage** | Check 3 (CC month-over-month jump), Check 6 (MV wages vs MV receipts) |
| **Under-recovery** — money owed to the company not collected back | Check 4 (loan repayments), Check 10 (CC contracts with no client payment) |
| **Under-payment / arrears to workers** — a compliance and welfare exposure, not just a financial one | Check 7 (previously unpaid salaries), Check 5 (accommodation-day earnings not applied) |
| **Process / data integrity** — the payroll run itself is malformed | Check 2 (CC without client), Check 8 (wrong pay period), Check 10's data-quality flags |

**Reader and action.** Police & Control opens this monthly, after the payroll month closes and
before release. A red row is worked case by case: P&C pulls the named maid or contract in the
ERP, establishes whether the exception is real, and either clears it with a reason or escalates
to Payroll (arrears, wrong period), to Accounting (missing client payment), or — for Check 9 —
to Finance leadership as a suspected diversion.

**Population in scope.**

- All housemaids with a payroll row for the audit month, both CC and MV.
- The audit month is the **previous calendar month** relative to the run.
- **Client payments in scope are those whose `DATE_OF_PAYMENT` falls in the month after the
  audit month** (maids.cc collects the following month's salary in advance).
  **`DATE_OF_PAYMENT` is the only date that bounds the payment population.**

  > **v2 correction — this bullet previously also bounded the population by `RECEIVED_DATE`
  > between the first day of the audit month and the run date, and that would have broken
  > Check 10 silently.** `RECEIVED_DATE` is documented in Snowflake as *"Null if not yet
  > received"*, and `BETWEEN` on NULL is UNKNOWN — so every `BOUNCED`, `PDC`, `PRE_PDP` and
  > `RETURNED_TO_CLIENT` row would have been dropped before M10 could bucket it. The
  > not-received bucket would collapse to zero, M10 would read 0.00% and pass green every
  > month, and tie-out 2 would silently re-balance. The `RECEIVED_DATE` window belongs to
  > **M6 alone**, where `STATUS = 'RECEIVED'` is a deliberate filter. Non-received statuses
  > must reach M10 **with `RECEIVED_DATE IS NULL`**.

**Explicitly out of scope.**

- Office staff, drivers, any non-housemaid payroll.
- Final settlements and end-of-service payments.
- Maids with no payroll row for the month. (Check 10 deliberately surfaces CC *contracts* with
  no client payment — a completeness test on the payment side, not the payroll side.)
- **Excluded rows, with the exact predicate and polarity** (v2 — v1 said "`IS_DELETED` false",
  which does not compile: these are TEXT, not booleans, and a guessed polarity yields an empty
  population that G1/G2 would abort on, or that would pass silently below 100 rows):

  | Flag | Type & values | Predicate to keep a row | Confidence |
  | --- | --- | --- | --- |
  | `HOUSEMAIDS_INFO.IS_DELETED` | `VARCHAR`, `'00'` / `'01'` | `IS_DELETED = '00'` | **UNVERIFIED polarity — O15** |
  | `HOUSEMAIDS_INFO.EXCLUDED_FROM_PAYROLL` | `VARCHAR`, `'00'` / `'01'` | `EXCLUDED_FROM_PAYROLL = '00'` | **UNVERIFIED polarity — O15** |
  | `WPS_RECORDS.TRASHED` | `VARCHAR`, values not profiled | not statable | **UNVERIFIED — O15** |
  | `SALES_SILVER.CONTRACTS.FAKE` | `BOOLEAN` | `FAKE = false` | Verified |
  | `SALES_SILVER.CONTRACTS.IGNORE_IN_REPORTING` | `NUMBER`, `0` / `1` | `IGNORE_IN_REPORTING = 0` | Verified type; polarity conventional |

  `HOUSEMAID_PAYROLL_HISTORY` has **no deletion flag of its own**, so these exclusions require
  joining `HOUSEMAIDS_INFO` on every check. (The view filters `_SNOWFLAKE_DELETED = FALSE`
  upstream — that is warehouse-level tombstoning, a different thing.)

**Grain.** Two grains, both needed:

- **Summary grain** — one row per `audit_month × check`, carrying pass/fail/skipped and metric
  values. This is the KPI strip and the check register.
- **Exception grain** — one row per offending maid (Checks 1, 7, 8, 9) or contract (Check 10).

**Refresh expectation.** Monthly, available from the **7th of the month at 06:00 Gulf time**,
covering the previous calendar month.

> **Policy — the recurring pipeline is not P&C's to run** (v2). A standing monthly process
> feeding a release decision must be owned and scheduled by the **ERP / data-governance team**,
> not built on ad-hoc Snowflake access: ad-hoc Snowflake is not a governed system of record and
> a standing unattended job on it carries shadow-ops, lineage and reconciliation risk. P&C's own
> Snowflake use here is limited to one-off validation of this spec. This spec is the handoff.

**Timezone.** All month boundaries are Gulf time (Asia/Dubai). `PAYROLL_MONTH` is a `DATE` and
carries no timezone.

> **v2 correction.** v1 asserted that `RECEIVED_DATE` and `BALANCE_DATE`, being `TIMESTAMP_NTZ`,
> "must be treated as Gulf time". A type cannot tell you that — `TIMESTAMP_NTZ` carries no zone,
> and the claim is about how mmdb wrote the value. If mmdb writes UTC, a payment received at
> 02:00 Dubai on the 1st is stored at 22:00 on the previous day and is misassigned. **The
> storage zone must be confirmed with the data team and an explicit conversion applied** — O16.
> This bites M6's `RECEIVED_DATE` bound. `BALANCE_DATE` is separately dropped from this rule:
> it is sourced from `employeeloans.LOAN_DATE`, a loan-**origination** date, and its only
> legitimate use is excluding loans originated after month start from M4b's denominator.

---

## 2. Data Points Needed

### 2.1 Verified — already in Snowflake

Verification method and its limit: every table, column, type and profiled value range below was
read from Snowflake metadata (`DESC VIEW` / `SHOW COLUMNS`) in this session, and row counts from
`SELECT COUNT(*)`. **Row-level queries could not be run** — the role
`PAYROLL_AND_MONEY_CONTROL_ROLE` has no warehouse grant, so anything needing compute (`MAX(date)`,
`GROUP BY`, sampling) is refused. **Freshness and grain are asserted from metadata, not
measured.** See O1.

| # | Data point | Database.Schema.Table | Column | Grain | Notes / verification |
| --- | --- | --- | --- | --- | --- |
| D1 | Payroll row (the "Ansari file" content, ERP-side) | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` | — | one row per maid per payroll month **(UNVERIFIED — O1)** | `COUNT(*) = 1,300,660`. Source `mmdb.housemaidpayrolllogs`. The model declares no `table_grain` |
| D1.1 | MOHRE / employee unique ID | ↑ | `EMPLOYEE_UNIQUE_ID` | — | `VARCHAR`. Checks 1, 7, 8, 9 |
| D1.2 | Payroll month | ↑ | `PAYROLL_MONTH` | — | `DATE`, min `2020-07-01`, first day of month |
| D1.3 | **Net** amount paid (the "Ansari (AED)" figure) | ↑ | `NET_SALARY` | — | `FLOAT`, 0–13,200. Source column `mmdb…TOTAL_SALARY` |
| D1.4 | **Gross** earnings | ↑ | `TOTAL_SALARY` | — | `FLOAT`, 0–13,000. Source column `mmdb…TOTAL_EARNINGS`. ⚠ **The two names are inverted relative to their meaning** — see the warning below |
| D1.5 | Additions / deductions | ↑ | `ADDITIONS`, `DEDUCTIONS` | — | `MANAGER_ADDITIONS` (−1,516–8,800), `TOTAL_DEDUCTION` (0–2,800). *Used by: M7b's gross↔net reconciliation only; otherwise context* |
| D1.6 | Maid status on the payroll row | ↑ | `STATUS` | — | 20 values incl. `WITH_CLIENT`, `AVAILABLE`, `ON_VACATION`, `SURPLUS`, `SICK_WITHOUT_CLIENT`, `EMPLOYEMENT_TERMINATED` *(ERP spelling)*. M2 |
| D1.7 | Bank / agent account | ↑ | `EMPLOYEE_ACCOUNT_WITH_AGENT` | — | Free text. **Sensitive — §2.4.** M9 |
| D1.8 | Account type, pre-classified | ↑ | `ANSARI_PAYMENT_METHOD` | — | `FAB_MASTER_CARD`, `ANSARI_VISA_CARD`, `DU_PAY_CARD`, `BANK_TRANSFER`, `''`. Derived in-model. M9 |
| D1.9 | Date the salary was paid | ↑ | `PAID_ON_DATE_FORMATTED` | — | `DATE`, min `2020-08-04`. `COALESCE(TRY_TO_DATE(…'YYYY-MM-DD'), …'DD MONTH, YYYY', …'DD MON, YYYY')` over free-text `PAID_ON_DATE`. M8 |
| D1.10 | Why a salary was not paid | ↑ | `AUTOMATIC_EXCLUSION_REASONS`, `MANUAL_EXCLUSION_REASON` | — | M7 |
| D1.11 | Transferred flag | ↑ | `IS_TRANSFERRED` | — | `'YES'`/`'NO'`. **Context only** — no metric uses it |
| D2 | Maid master | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | 136 columns | one row per maid | Join `HOUSEMAIDS_INFO.ID = HOUSEMAID_PAYROLL_HISTORY.HOUSEMAID_ID`, both `NUMBER(38,0)` — **types match, no cast** |
| D2.1 | CC vs MV inputs | ↑ | `HOUSEMAID_TYPE`, `LIVE_OUT` | — | `HOUSEMAID_TYPE ∈ {Normal, MAID_VISA, FREEDOM_OPERATOR, WALKIN}`; `LIVE_OUT` `NUMBER`, `0`/`1`. See D3 |
| D2.2 | Nationality, name | ↑ | `NATIONALITY`, `NAME` | — | Name masked in output (§2.4). `NATIONALITY` is **context only** |
| D2.3 | Loan master fields | ↑ | `OUTSTANDING_BALANCE` (−2,500–26,900), `MONTHLY_LOAN`, `DEDUCTION_CAP` | — | Point-in-time, not as-at a past month. **Context** — M4b uses D5, which is per-loan and reconstructable |
| D2.4 | Payroll eligibility flags | ↑ | `IS_DELETED`, `EXCLUDED_FROM_PAYROLL`, `WITH_MOL_NUMBER`, `LAST_PAYROLL_LOCK_DATE` | — | First two are `VARCHAR` `'00'/'01'` — see §1. `WITH_MOL_NUMBER` is `NUMBER` `0/1`. ⚠ **`LAST_PAYROLL_LOCK_DATE` profiles to "no non-null values" — it is empty and cannot serve as the payroll-lock signal.** O17 |
| D2.5 | Salary rates | ↑ | `BASIC_SALARY`, `PRIMARY_SALARY`, `ACCOMMODATION_SALARY` (0–1,500) | — | **Context** — rates, not per-month day-group earnings. M5 uses N1 |
| D3 | CC / MV rule | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS` | `TO_TYPE` | one row per maid; join `HOUSEMAID_ID` `NUMBER(38,0)` | In-model rule verbatim: `CASE WHEN h.HOUSEMAID_TYPE = 'MAID_VISA' THEN 'MV' WHEN h.LIVE_OUT = 1 THEN 'CC Live Out' WHEN h.LIVE_OUT = 0 THEN 'CC Live In' END`. ⚠ **Emits no value `'CC'`** — see below |
| D4 | WPS / MOL salary record | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.WPS_RECORDS` | `EMPLOYEE_UNIQUE_ID` (`VARCHAR`), `MAID_ID` (`NUMBER(38,0)`), `PAID_SALARY`, `PAYROLL_DATE`, `REPORT_DATE`, `UPLOADED_DATE`, `WPS_STATUS`, `TRASHED` | **one row per maid per WPS report — not per maid-month** | `COUNT(*) = 701,735`. Second independent side for tie-out 3. `CONTRACT_SALARY`, `EN_NAME`, `AR_NAME` are **context** |
| D5 | Loans | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` | `ID`, `HOUSEMAID_ID`, `AMOUNT` (−2,400–13,600), `REPAID_AMOUNT`, `WAIVED_AMOUNT` | one row per loan | Source `mmdb_transformed.employeeloans`. `TYPE`, `BALANCE_DATE`, `STATUS ∈ {NOT_YET_PAID, PAID, PARTIALLY_PAID}` are **context**. **PARTIAL — see below** |
| D6 | Client payments | `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGEMENT_PAYMENTS` | `ID`, `CONTRACT_ID` (`NUMBER(38,0)`), `PAYMENT_TYPE`, `STATUS`, `AMOUNT_OF_PAYMENT` (−3,229–26,000), `DATE_OF_PAYMENT` (`DATE`), `RECEIVED_DATE` (`TIMESTAMP_NTZ`, **null if not yet received**) | one row per payment | **PARTIAL — the monthly payment type is absent. See below / N2** |
| **D7** | **Contract (v2 — was N3)** | `BA_VIEWS.SALES_SILVER.CONTRACTS` | see below | one row per contract | **127 columns. This is the object v1 wrongly declared missing.** |
| D7.1 | Contract ID (`Contr-<n>`) | ↑ | `ID` | — | `NUMBER(38,0)`, 0–1,100,640 → joins `D6.CONTRACT_ID` `NUMBER(38,0)`. **Types match** |
| D7.2 | Maid and client | ↑ | `HOUSEMAID_ID`, `CLIENT_ID`, `FIRST_MAID_ID`, `LAST_MAID_ID` | — | All `NUMBER(38,0)`; `HOUSEMAID_ID` 2–138,551 → `D1.HOUSEMAID_ID` `NUMBER(38,0)`. **Types match**. `FIRST_MAID_ID`/`LAST_MAID_ID` come from `mmdb.contracts_revisions` — the historical assignment O13 needed |
| D7.3 | **CC / MV label, ready-made** | ↑ | `CONTRACT_TYPE` | — | `VARCHAR(2)`, allowed values exactly `CC, MV`. **Use this rather than deriving from the ID** |
| D7.4 | Prospect type ID | ↑ | `CONTRACT_PROSPECT_TYPE_ID` | — | `NUMBER(38,0)`, allowed values exactly `1650, 1726`. Documented as *"CC when 1650; otherwise MV"* — **this closes O11; no picklist lookup is needed** |
| D7.5 | Validity dates | ↑ | `CONTRACT_CREATION_DATE`, `START_OF_CONTRACT`, `END_OF_CONTRACT`, `DATE_OF_TERMINATION`, `SCHEDULED_DATE_OF_TERMINATION`, `ADJUSTED_END_DATE` | — | All `TIMESTAMP_NTZ`. **These make as-at-month contract resolution possible** — see O13 |
| D7.6 | Status | ↑ | `CONTRACT_STATUS`, `CON_CURR_STATUS` | — | `CONTRACT_STATUS ∈ {ACTIVE, CANCELLED, POSTPONED}`; `CON_CURR_STATUS ∈ {cancelled, net sale, pre-confirm, postponed}` |
| D7.7 | Hygiene flags | ↑ | `FAKE` (`BOOLEAN`), `IGNORE_IN_REPORTING` (`NUMBER` `0/1`) | — | **Both must be filtered** — §1 |
| D7.8 | Live-out flag | ↑ | `IS_LIVE_OUT` | — | ⚠ **`VARCHAR`, values `'00'`/`'01'` — not a boolean.** `WHERE IS_LIVE_OUT = TRUE` matches nothing and raises no error |
| D8 | Contract history | `BA_VIEWS.SALES_SILVER.CONTRACTS_HISTORY` | — | — | Alternative as-at source for D7.5. **Columns not yet inspected — O13** |

**The D1.3 / D1.4 name inversion — read before writing any salary metric.** In this view
`NET_SALARY` is the **net** figure (sourced from `mmdb…TOTAL_SALARY`) and `TOTAL_SALARY` is the
**gross** figure (sourced from `mmdb…TOTAL_EARNINGS`). The names say the opposite of what they
hold. They differ by `ADDITIONS` and `DEDUCTIONS`. Every metric below states which basis it
uses; do not substitute one for the other.

**The D3 problem (v2).** `TO_TYPE` emits `CC Live In`, `CC Live Out`, `MV` — **never `CC`** — so
a metric written as `maid type = 'CC'` matches nothing. Two decisions are required, both P&C's:

1. **Collapse.** `CC Live In` and `CC Live Out` → `CC`. Adopted throughout this spec.
2. **`FREEDOM_OPERATOR` and `WALKIN`.** `HOUSEMAID_TYPE` has four values, and the rule above
   classifies both of these as CC purely on `LIVE_OUT`. Whether they belong in the CC wage bill
   (M3's AED 300,000 threshold), the CC-without-client ratio (M2) and the CC contract
   reconciliation (M10) has never been asked. **O18, blocking.**

Also note: the approved gold models carry their own independently-built `MAID_TYPE ∈ {CC, MV}`.
Until O18 is settled, the approved and P&C numbers displayed side by side **may not tie**, and
the report must label them as differently scoped rather than inviting the comparison.

**PARTIAL verdicts.**

- **D5 — loans.** `REMAINING_AMOUNT` is sourced from `employeeloans.MONTHLY_REPAYMENT_AMOUNT`
  and profiles to the single value `0` — present but empty. `REPAID_AMOUNT` is cumulative per
  loan, not a per-month transaction, so **current-month repayment is not derivable here**.
  Outstanding balance *is* derivable as `AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT` (confirmed as
  the ERP's own runtime formula, §7), but only as of now. → N4.
- **D6 — client payments.** The model admits six payment types only: `Same Day Recruitment Fee`,
  `insurance`, `Pre-collected Salary`, `Overstay Fee`, `Pre-collected Salary - No VAT`,
  `MaidVisa Recruitment Fee Refund`. The **monthly client payment** (`TYPE_OF_PAYMENT_ID = 1`)
  is not among them. → N2. **This is now the only thing blocking M6 and M10** — the contract
  side is D7.
- **D3 — type transitions.** Not a transition log: `FROM_TYPE`, `PREV_CHANGE_DATE` and
  `NEXT_CHANGE_DATE` are `NULL` placeholders and `CHANGE_DATE` is `housemaids.CREATION_DATE`.
  Mid-month CC↔MV transitions cannot be expressed. → N5. (`SALES_SILVER.CONTRACTS.IS_CCTOMV`,
  a `BOOLEAN`, may partially cover this — unverified, folded into N5.)

### 2.2 Approved KPI definitions reused

Eight `BI_PAYROLL*` models exist in `BA_VIEWS.HOUSEMAID_MANAGEMENT_GOLD`; five are reused here.
Company policy is to reuse an approved definition verbatim with all its filters, so this spec
does — and states where the P&C check means something different.

> **⚠ Grain — v2 correction.** v1 said these are "all at `payroll_month × maid_type` grain".
> They are not, and a join at that grain **fans rows out and inflates any sum**:
>
> | Model | Actual grain | Row filter needed before joining |
> | --- | --- | --- |
> | `BI_PAYROLL_LOAN_DEDUCTIONS_VS_POSSIBLE_DEDUCTIONS` | month × maid_type × `METRIC_NAME` (**4 rows** per month per type) | `METRIC_NAME = 'Total Deducted Loans'` |
> | `BI_PAYROLL_UNPAID_SALARY_MONITORING` | month × maid_type × `ROW_TYPE` × `EXCLUSION_SOURCE` × `EXCLUSION_REASON` | `ROW_TYPE = 'Summary'` for the headline; the `Reason` rows are the breakdown |
> | `BI_PAYROLL_COMPLIANCE_WPS_MONITORING` | month × maid_type × `ROW_TYPE` × `WPS_STATUS_OR_REASON` | `ROW_TYPE = 'Main'` |
> | `BI_PAYROLL_SALARY_PAYMENT_PERFORMANCE` | month × maid_type | none |
> | `BI_PAYROLL_DU_PAY_ADOPTION` | month × maid_type | none |

| P&C check | Approved model | Reused verbatim? | Where it differs from the n8n check |
| --- | --- | --- | --- |
| Check 4 | `BI_PAYROLL_LOAN_DEDUCTIONS_VS_POSSIBLE_DEDUCTIONS` | Yes — **M4a** | **Different denominator.** Approved = deducted ÷ *collectable this month*; n8n = repayment ÷ *whole outstanding book*. Profiled approved percentages 70–94%; the n8n 25% threshold is against a far larger denominator. **Not the same number; the 25% cannot be applied to the approved ratio.** Both shown |
| Check 7 | `BI_PAYROLL_UNPAID_SALARY_MONITORING` | Yes — **M7a** | **Headcount vs money.** Approved counts excluded maids; n8n is unpaid AED ÷ paid AED ≤ 1%. Both kept |
| Check 3 | `BI_PAYROLL_SALARY_PAYMENT_PERFORMANCE` | As **denominator source** | Approved counts salaries (headcount); M3 is an AED delta. Shown alongside so a ratio is never read without its denominator |
| Check 9 | `BI_PAYROLL_DU_PAY_ADOPTION` | **Context only** | **Not a substitute.** Approved = month-level *adoption mix*; M9 = *per-maid switch between months*. A month with unchanged mix can contain hundreds of diversions |
| Check 8 | `BI_PAYROLL_COMPLIANCE_WPS_MONITORING` | **Context** | Approved = WPS-condition compliance; M8 is narrower |

**No approved definition exists** for Checks 1, 2, 5, 6, 9 or 10 — these are **new Police &
Control definitions** and should be added to the Data Catalog once approved.

> **⚠ The approved-KPI register itself was not searched (v2).** Policy points at
> `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` (with `INSIGHTS_DASHBOARD_DOCS`). Both
> views exist and their structure was read — the definitions live in a `TOOLTIP_INFO` `VARIANT`
> keyed by `SEMANTIC_ID` — but **their contents could not be searched**: a keyword scan needs a
> warehouse (O1). So the "no approved definition exists" claim above rests on the
> `HOUSEMAID_MANAGEMENT_GOLD` survey only. **Run the register search before treating M2, M5, M6,
> M9 or M10 as new definitions** — O19.

**Column-naming trap in the approved suite.** The payroll-month column is `SUBJECT_MONTH` in
*Compliance & WPS Monitoring*, *CC Salary Raises*, *Loan Deductions* and both *Additions* models,
and `PAYROLL_MONTH` in *Salary Payment Performance*, *Unpaid Salary Monitoring* and *Du Pay
Adoption*. Same meaning; the rename is deferred because `datahouse-ui` reads these names.

**History limit.** Every gold payroll model profiles a minimum month of **2026-01-01**, so
month-over-month comparison using them starts at 2026-02. The silver views reach to 2020-07-01,
so P&C's own metrics can be backfilled where the approved ones cannot.

### 2.3 New data ingestion request

Four items. **v2 removed the fifth (the contract link) — it exists, as D7.**

#### N1 — Accommodation-day and full-salary-day earnings (grp1, grp2, grp5, grp6)

- **Definition.** Confirmed from ERP code (§7): days are assigned to a `HousemaidSalaryGroup` by
  `PayrollGroupService.createHousemaidPayrollAttendanceLog` via
  `HousemaidPayrollAttendanceLog.salaryGroup`.

  | Export column | Enum | Meaning |
  | --- | --- | --- |
  | grp1 | `GROUP_1` | With client / assigned office work — **basic (full) salary** days |
  | grp2 | `GROUP_2` | In accommodation — **accommodation salary** days |
  | grp5 | `GROUP_5` | **Live-out** equivalent of grp1 |
  | grp6 | `GROUP_6` | **Live-out** equivalent of grp2 |

- **Native location — CONFIRMED via Ask the Code, 2026-09-02.** On **`HOUSEMAIDPAYROLLLOGS`**:
  `TOTAL_PRO_RATED_SALARY` (grp1), `MOHRE_PRO_RATED_SALARY` (grp2),
  `TOTAL_LIVE_OUT_PRO_RATED_SALARY` (grp5), `MOHRE_LIVE_OUT_PRO_RATED_SALARY` (grp6). Copied at
  export into `HOUSEMAIDPAYROLLBEANS` as `EARNING_IN_GROUP_ONE` / `_TWO` / `_FIVE` / `_SIX`.
- **⚠ This is a sync-add, not a new ingestion.** `HOUSEMAIDPAYROLLLOGS` is *already* the source
  behind D1; the four columns simply are not projected. **Four existing columns into an existing
  model**, inheriting D1's history to 2020-07-01 with no backfill.
- **Naming trap.** `TOTAL_PRO_RATED_SALARY` is the **full-salary-day** figure and
  `MOHRE_PRO_RATED_SALARY` the **accommodation-day** figure. Binding them the wrong way round
  inverts the ratio into a permanent pass.
- **Open.** The pro-ration divisor is never stated anywhere — calendar days, 30-day month, or
  working days. **O20.**
- **Owner.** Data team (model change); Payroll Management (ERP) for semantics.
- **Grain / join / history.** Same row as D1 — no join key needed, no separate backfill.

#### N2 — Monthly client payments (`TYPE_OF_PAYMENT_ID = 1`)

**This is now the only genuine gap on the payment side.**

- **Definition.** The recurring monthly payment a client makes for their maid — the receipt side
  of M6 and M10.
- **Native location — CONFIRMED via Ask the Code, 2026-09-02.**

  | Filter property | Table | Column |
  | --- | --- | --- |
  | `typeOfPayment.id` | `PAYMENTS` | `TYPE_OF_PAYMENT_ID` |
  | `dateOfPayment` | `PAYMENTS` | `DATE_OF_PAYMENT` |
  | `dateChangedToReceived` | `PAYMENTS` | `DATE_CHANGED_TO_RECEIVED` |
  | `status` | `PAYMENTS` | `STATUS` |
  | `contract.contractProspectType.id` | `CONTRACTS` | `CONTRACT_PROSPECT_TYPE_ID` |

  `PAYMENTS` already backs D6 (which exposes `DATE_CHANGED_TO_RECEIVED` as `RECEIVED_DATE`), and
  `CONTRACTS.CONTRACT_PROSPECT_TYPE_ID` is already in Snowflake as D7.4. **What is missing is
  only the rows of `TYPE_OF_PAYMENT_ID = 1`.**
- **The decision this spec makes** (v1 left it as "the Snowflake team's call", which is not a
  spec's job): **widen `CLIENT_MANAGEMENT_PAYMENTS` to admit payment type `1`** rather than build
  a parallel model. One filter change, one model, one place for payment hygiene to live. If the
  data team disagrees, that is theirs to overrule with a reason.
- **Owner.** Data team; Accounting (ERP) for semantics.
- **History needed.** From 2024-01-01; backfill required.
- **Join key.** `CONTRACT_ID` `NUMBER(38,0)` → `D7.1` `NUMBER(38,0)`. **Types match.**
- **Hygiene.** Status enum known from D6: `RECEIVED, DELETED, BOUNCED, PRE_PDP, PDC,
  RETURNED_TO_CLIENT, TEARED_UP, CANCELLED_WAITING_CLIENT_PICKUP`. `DELETED` excluded from every
  ratio but counted. `AMOUNT_OF_PAYMENT` can be negative (refunds/reversals) — negatives net into
  the contract total, never dropped. `RECEIVED_DATE` **is NULL for every non-received status** —
  see §1.
- **Refresh needed.** Monthly, with the audit run.

#### N4 — Per-month loan repayment

- **Definition.** How much of a maid's loan book was recovered *in the audit month*.
- **Native location — CONFIRMED via Ask the Code, 2026-09-02.** The missing object is the
  **`REPAYMENTS`** ledger.

  | | Table.Column | Month identification |
  | --- | --- | --- |
  | **Current-month repayment** (the numerator) | `REPAYMENTS.AMOUNT` — export `HOUSEMAIDPAYROLLBEANS.LOAN_REPAYMENT` | `REPAYMENT_DATE >= payrollStart AND REPAYMENT_DATE < payrollEnd`, plus `PAID_REPAYMENT = true`, `EXCULDED_FROM_PAYROLL = false` |
  | **Lifetime cumulative** (never the numerator) | `EMPLOYEELOANS.REPAID_AMOUNT`, or `SUM(REPAYMENTS.AMOUNT)` where `PAID_REPAYMENT = true` | no month filter |
  | **Export lifetime total** (never the numerator) | `HOUSEMAIDPAYROLLBEANS.TOTAL_LOAN_REPAYMENTS` | no month filter |

  Keys: `REPAYMENTS.HOUSEMAID_ID` → the maid; `REPAYMENTS.EMPLOYEE_LOAN_ID` → the loan.
  **`EXCULDED_FROM_PAYROLL` is spelled exactly that way in the ERP** — reproduce the typo.
- **Outstanding balance — confirmed, and already available.** No persisted maid-level balance
  column; the ERP computes `EMPLOYEELOANS.AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT`, which is
  exactly D5. **The denominator is buildable today; only the numerator needs `REPAYMENTS`.**
- **⚠ Two boundary traps.** (a) The v2 ERP code uses `< payrollEnd`; the legacy path uses
  `payrollEnd + 1 day` — **they disagree by one day** and move last-day repayments between
  months. Pick one and state it (**O14**). (b) Auto-generated repayment rows carry
  `REPAYMENT_DATE` = the payroll-month date and stay `NOT_FINAL` until payroll is finalised, so a
  pre-lock run differs from a post-lock one (**O17**).
- **Owner / grain / history.** Payroll Management + Data team; one row per repayment event;
  from 2024-01-01, backfill required.
- **Join key.** `REPAYMENTS.EMPLOYEE_LOAN_ID` `NUMBER` → `D5.ID` `NUMBER(38,0)`;
  `REPAYMENTS.HOUSEMAID_ID` `NUMBER` → `D1.HOUSEMAID_ID` `NUMBER(38,0)`. **Types match.**

#### N5 — Mid-month CC↔MV transition

- **Definition.** A maid who changed between CC and MV during the audit month. The n8n check read
  this from the payroll export's `Type Of maid` (`CC`, `MV to CC`, `MV`, `CC to MV`, blank).
- **Why it matters.** M2, M3, M5, M6, M7 and M10 all partition on maid type. Without a transition
  record a switcher lands wholly on one side — a known, quantified inaccuracy inherited from the
  n8n flow, not introduced here, but this is the moment to fix it.
- **Requested.** A populated type-change log: `HOUSEMAID_ID`, `FROM_TYPE`, `TO_TYPE`,
  `CHANGE_DATE`. Check first whether `SALES_SILVER.CONTRACTS.IS_CCTOMV` (`BOOLEAN`) and
  `IS_LIVING_SWITCH` already cover part of this — **unverified**.
- **Interim.** Use the point-in-time rule (D3) and display the count of maids whose type changed
  during the month as a data-quality figure.

#### N6 — CC arrears

- **Definition.** Salary owed to a **CC** maid for a prior payroll month, still unpaid at the
  audit date. The MV equivalent exists in the ERP as `PREVIOUSLY_UNPAID_SALARIES`; the CC
  equivalent appears not to. See the M7b finding.
- **Requested.** Either (a) extend the ERP computation to CC maids, or (b) approve the
  D1-derived CC definition in M7b — **which requires naming the amount column**; M7b does.
- **Note.** Option (b) needs no ingestion, only a definition decision.

### 2.4 Sensitive-data handling — binding on the build

> **v2 — v1 contradicted itself here.** It stated that per-maid salary figures are not displayed,
> then permitted exception rows to show the amount "where the amount is the finding itself
> (Checks 7 and 10)". A Check 7 exception row **is** a per-maid salary figure. v1 also displayed
> the full **MOHRE ID** beside a masked name, which re-identifies the maid and defeats the
> masking. Resolved below.

| Field | Rule |
| --- | --- |
| `EMPLOYEE_ACCOUNT_WITH_AGENT` | Used **inside** the M9 comparison. Never displayed in full. The row shows the **classification transition** (`Normal IBAN → du Pay`) and a masked account, last 4 only |
| **Per-maid salary and arrears amounts** | **Not displayed and not exported.** M7's exception rows show an **arrears band** (`< 1k` / `1–5k` / `> 5k`), not the figure. The figure is read in the ERP via the drill-down link, under the ERP's own access control. M10 is a **contract-level** receivable, not a worker's pay, and its amount **is** displayed |
| **MOHRE ID** | **Not displayed by default.** A government worker identifier next to a masked name defeats the mask. The exception row carries an opaque case reference and a deep link; the investigator resolves identity in the ERP. Displaying it requires a named pre-approval recorded here — **O21** |
| `PHONE_NUMBER`, `NORMALIZED_PHONE_NUMBER`, `NORMALIZED_WHATS_APP_PHONE_NUMBER`, `EID`, `PASSPORT_NUMBER` | **Never selected.** Not in the model, the export, or the mockup |
| `HOUSEMAIDS_INFO.NAME` | Masked (`Maid #4471`). Unmasked only in the ERP |
| `SALES_SILVER.CONTRACTS` client fields — `CLIENT_HASHED_PHONE_NUMBER`, `CLIENT_HASHED_WA_PHONE_NUMBER`, `SPOUSE_HASHED_*`, `THIERED_PHONE_NUMBER`, `CLIENT_EMAIL_ADDRESS`, `CLIENT_ADDRESS` | **Never selected.** D7 is joined for contract identity and type only |

The predecessor system mailed the full report body, 25k payroll rows included, to an inbox.
**This dashboard is not emailed.** Notification is a link; the data stays behind Snowflake's
access controls. That is a requirement, not a preference.

---

## 3. Metric Calculations

Conventions for every metric: currency **AED**, single-currency, **no FX**. Percentages computed
at full precision and **rounded to 2 dp for display only** — never before a threshold comparison.
Amounts rounded to 0 dp for display, summed at full precision. `NULL` amounts → **zero**. `NULL`
classification (maid type unresolved) **excludes the row from ratio denominators and raises a
data-quality exception** — never silently CC or MV. Division by zero renders `—` and sets the
check **SKIPPED**, never PASS.

**The three-state rule.** Every check is `PASS`, `FAIL` or `SKIPPED`. `SKIPPED` means it could
not be evaluated. **A skipped check drives the month to FAIL** — carried from the n8n code, which
learned it the hard way: a fraud check that could not run once rendered green, indistinguishable
from "we compared both months and found nothing".

---

### M1 — Duplicate MOHRE IDs (Check 1)

- **Business definition.** No two payroll rows in the audit month may share an
  `EMPLOYEE_UNIQUE_ID`. A duplicate positions one person to be paid twice.
- **Formula.** Two figures, both displayed (v2 — v1 was ambiguous about which the KPI shows):
  `M1_ids = COUNT(DISTINCT EMPLOYEE_UNIQUE_ID appearing more than once in the month)`
  `M1_rows = COUNT(rows whose EMPLOYEE_UNIQUE_ID appears more than once)` — the exception grain.
  **The KPI shows `M1_ids`**; the table shows `M1_rows`, one per offending row with an occurrence
  count. They differ when an ID appears three or more times.
- **Inputs.** D1.1, D1.2, D2.4 (deletion filter), D2 (join).
- **Filters.** `PAYROLL_MONTH = audit_month`; `EMPLOYEE_UNIQUE_ID` matches `^[0-9]+$`; §1's
  exclusion predicates.
- **Row-identity rule (carried from n8n).** The source spreadsheet's trailer carried the company
  MOL number `0000000836318` in the ID column, passing the numeric test and creating a phantom
  flag. In Snowflake the trailer does not exist, **but the company MOL number may still appear as
  a value** — exclude it and state the exclusion on the report. **Where that number is read from
  is unresolved: hard-coding it in the model is a maintenance trap — O22.** Note also that **53
  real maids have leading-zero MOHRE IDs**, so the ID stays `VARCHAR` throughout; casting to a
  number silently merges `0001234` and `1234`.
- **Nulls.** Blank or non-numeric ID → excluded and raised as its own data-quality exception.
- **Threshold.** Green 0; Red ≥ 1. No amber — a duplicate is never tolerable.

### M2 — CC maids without a client (Check 2)

- **Business definition.** The share of CC maids not placed with a client. CC maids are on the
  company's visa and cost money whether or not deployed.
- **Formula.** `M2 = COUNT(CC maids WHERE STATUS <> 'WITH_CLIENT') / COUNT(CC maids)`
- **Inputs.** D1.6, D3 (with the D3 collapse), D2.1, D2.4.
- **Filters.** `PAYROLL_MONTH = audit_month`; maid type = CC; §1 exclusions.
- **Division by zero.** Zero CC maids → `SKIPPED`.
- **Threshold.** Green ≤ 5.00%; Red > 5.00%. *(n8n `CC_RATIO_MAX = 0.05`.)*
- **Open — O4.** The n8n rule treats every non-`WITH_CLIENT` status as "without client",
  including `ON_VACATION`, `SICK_WITHOUT_CLIENT`, `PENDING_VACATION`, `ASSIGNED_OFFICE_WORK`.
  Those are arguably legitimately unplaced. Confirm the denominator.

### M3 — CC wage-bill month-over-month movement (Check 3)

- **Business definition.** Total CC payroll must not jump by more than AED 300,000 against the
  previous month. A fall is normal attrition and never a finding.
- **Formula.** *(net basis)*
  `M3_current = SUM(NET_SALARY) WHERE maid type = CC AND PAYROLL_MONTH = audit_month`
  `M3_prior   = SUM(NET_SALARY) WHERE maid type = CC AND PAYROLL_MONTH = audit_month − 1 month`
  `M3 = M3_current − M3_prior`  *(signed)*
- **Inputs.** D1.2, D1.3, D3, D2.4; plus `BI_PAYROLL_SALARY_PAYMENT_PERFORMANCE` (§2.2) for the
  displayed denominator.
- **Prior month.** Read from the same table — this removes the n8n `prev_cc_total` input entirely.
- **Denominator display.** Show `TOTAL_SALARIES` / `PAID_SALARIES` for both months beside the AED
  figures. A wage-bill move driven by headcount is a different finding from the same move at flat
  headcount.
- **Threshold.** Green `M3 ≤ +300,000` (any negative included); Red `> +300,000`.
- **Nulls.** Prior month absent → `SKIPPED`.
- **Restatement (v2, O23).** M3 reads the prior month live, so a retroactive correction to a
  closed period silently changes an already-published delta. **Freeze each audit month's figures
  at its first clean run** and display any later movement as a separate restatement line rather
  than overwriting.

### M4 — Loan recovery (Check 4)

**M4a — approved, reused verbatim.** From `BI_PAYROLL_LOAN_DEDUCTIONS_VS_POSSIBLE_DEDUCTIONS`
where `SUBJECT_MONTH = audit_month` **and `METRIC_NAME = 'Total Deducted Loans'`**: read the
model's own **`PERCENTAGE`** column, displayed with `METRIC_AMOUNT` and
`MAIDS_WITH_OUTSTANDING_BALANCE`. **No arithmetic.**

> **v2 correction.** v1 specified this as `Total Deducted Loans` *divided by*
> `POSSIBLE_DEDUCTION_DENOMINATOR` — a hand-division of a KPI the model already publishes, which
> is exactly what the reuse rule forbids and invites divergence from what `datahouse-ui` shows.

**M4b — P&C book-recovery ratio (new definition).**

- **Business definition.** How much of the total outstanding loan book was recovered this month.
- **Formula.** `M4b = SUM(current-month loan repayment) / SUM(outstanding balance at month start)`
- **Inputs.** Denominator D5 (available); numerator N4 (`REPAYMENTS`, not yet in Snowflake).
- **Denominator caveat.** D5 gives the balance *as of now*. Reconstructing month-start means
  adding back repayments and waivers since — which needs the same ledger. N4 unblocks both halves.
- **Filters.** Exclude `WAIVED_AMOUNT` from the numerator — a waiver reduces the balance without
  recovering cash. Numerator rows require `PAID_REPAYMENT = true` and
  `EXCULDED_FROM_PAYROLL = false`. Exclude loans originated after month start using D5's
  `BALANCE_DATE` (`= employeeloans.LOAN_DATE`).
- **Guard (v2 — widened).** `AMOUNT` profiles to `−2,400–13,600`, so per-loan remaining can be
  zero **or negative**, and the denominator can net toward or below zero across a populated
  month. If the denominator is **`<= 0`** across a month with > 100 maids, the result is
  `SKIPPED — denominator not positive`, **not** a threshold failure. v1's guard only covered
  exactly zero.
- **Threshold.** Green ≥ 25.00%; Red < 25.00%. *(n8n `LOAN_RATIO_MIN = 0.25`.)*
- **Interim.** Until N4 lands, M4b renders `SKIPPED — awaiting the REPAYMENTS ledger (N4)`. M4a
  still renders, so the month is not without a loan-recovery signal.

### M5 — Accommodation-day earnings (Check 5)

- **Business definition.** Accommodation-salary-day earnings must be at least 1% of
  full-salary-day earnings. If the accommodation share collapses, either the lower rate has
  stopped being applied or day classification has broken — either way maids are paid wrongly.
- **Formula.** Three sub-ratios, **all** of which must pass:
  `M5a = SUM(grp2) / SUM(grp1)` — live-in accommodation share
  `M5b = SUM(grp6) / SUM(grp5)` — live-out accommodation share
  `M5c = (SUM(grp2)+SUM(grp6)) / (SUM(grp1)+SUM(grp5))` — combined
- **Inputs.** N1; D3 and D2.1 for the CC filter.
- **Filters — the ERP answer settles an old disagreement.** The n8n comment claimed
  "Grp1/Grp2: CC only. Grp5/Grp6: all maid types", while the code applied a CC-only filter to all
  four sums. The ERP code (§7) shows the comment was wrong: **grp5/grp6 are the live-out
  remapping of grp1/grp2**, not a different maid population. The split is live-in vs live-out
  *within* CC, so the running code's CC-only filter is correct. **O5 closes.**
- **M5b and zero live-out.** If CC has no live-out maids in a month, `SUM(grp5) = 0` and M5b is
  `SKIPPED` — correctly. Display the live-out headcount beside it so the skip explains itself.
  ⚠ Read live-out from `HOUSEMAIDS_INFO.LIVE_OUT` (`NUMBER` `0`/`1`), **not**
  `CONTRACTS.IS_LIVE_OUT`, which is `VARCHAR` `'00'`/`'01'`.
- **Division by zero.** Any zero denominator → that sub-check `SKIPPED`, parent `SKIPPED`.
- **Threshold.** Green ≥ 1.00% on all three. *(n8n `GRP_RATIO_MIN = 0.01`.)*

### M6 — MV wages vs MV client receipts (Check 6)

> **Orientation, stated once and explicitly** (v2 — v1's worked example computed this upside
> down): **wages are the numerator, receipts the denominator.** A *higher* percentage is *worse*.
> A healthy month runs near 84%; a month where wages exceed receipts exceeds 100%.

- **Business definition.** Total MV salaries paid must not exceed 90% of the monthly client
  payments received for MV contracts. MV maids are on the client's visa and the client's payment
  funds the wage; if wages approach receipts, the company is subsidising the placement.
- **Formula.** `M6 = SUM(NET_SALARY WHERE maid type = MV) / SUM(monthly client payments received on MV contracts)`
- **Inputs.** D1.3, D3 (numerator — available); N2 with D7.3/D7.4 (denominator — **blocked on N2
  only**, the contract side is D7).
- **Filters — denominator.** `CONTRACT_TYPE = 'MV'` (D7.3, equivalently
  `CONTRACT_PROSPECT_TYPE_ID = 1726`); payment type `1`; `STATUS = 'RECEIVED'`;
  `DATE_OF_PAYMENT` in the month after the audit month; `RECEIVED_DATE` between the first day of
  the audit month and the run date; `FAKE = false`; `IGNORE_IN_REPORTING = 0`.
  **The `RECEIVED_DATE` bound applies to M6 only** — see §1.
- **Plausibility floor — carried from n8n, and it earned its place.** A production run returned a
  denominator of AED 3,431 against ~19,659 MV maids; it was truthy, so it passed the zero-check
  and rendered as a threshold *result* rather than a broken fetch. Rule: if the denominator is
  below **10% of MV salaries**, the check is `SKIPPED — implausible receipts total`, never a
  threshold verdict. Healthy runs land near AED 33.4M against AED 28.0M of MV salaries (**83.89%**),
  so the floor sits about **11.9×** below a healthy denominator — ample headroom.
- **Threshold.** Green ≤ 90.00%; Red > 90.00%. *(n8n `MV_RATIO_MAX = 0.90`.)*
- **Date asymmetry — O6.** The n8n MV query pins `dateOfPayment` to a **single exact date** (the
  1st) while the CC query uses a **full-month range**; §1 states the range version as the rule.
  An MV payment dated the 2nd is invisible under the n8n behaviour. Probably a bug in the running
  flow; not changed silently.

### M7 — Previously unpaid salaries (Check 7)

**M7a — approved, reused verbatim.** From `BI_PAYROLL_UNPAID_SALARY_MONITORING` where
`PAYROLL_MONTH = audit_month`, all model filters retained. Headline from `ROW_TYPE = 'Summary'`;
the `ROW_TYPE = 'Reason'` rows are displayed in full as the breakdown — the reason detail is what
lets P&C work a case.

**M7b — P&C money ratio (new definition).**

- **Business definition.** Arrears carried into this month as a share of what was paid, computed
  separately for CC and MV. Both must be within tolerance.
- **Formula, on a single stated basis** (v2 — v1 divided a **gross** numerator by a **net**
  denominator, which the D1.3/D1.4 name inversion makes easy to do by accident):
  `M7b = SUM(prior-month unpaid amount, NET basis) / SUM(NET_SALARY)`, for each of CC and MV.
  **Both sides are net.** If P&C prefers gross, change both sides together — never one.
- **Inputs.** D1.3, D1.10, D1.5 (for the gross↔net reconciliation), D3, plus N6 for CC.
- **MV numerator — native source confirmed (§7).** `HOUSEMAIDPAYROLLBEANS.PREVIOUSLY_UNPAID_SALARIES`,
  computed at export as the sum of `TOTAL_SALARY` over prior unpaid `HOUSEMAIDPAYROLLLOGS` rows.
  ⚠ That ERP `TOTAL_SALARY` is **gross**; it must be converted to net (or the whole metric moved
  to gross) before it meets this denominator.
- **⚠ The check is half-vacuous today — the most consequential finding in this spec.** The ERP
  computes `PREVIOUSLY_UNPAID_SALARIES` **only for maid-visa (MV) maids**. If that holds, the
  n8n check's **CC arm has always summed to zero and always passed** — a green tick on the
  arrears control, for the life of the flow — and CC arrears are currently unmeasured anywhere.
  1. Do **not** port `PREVIOUSLY_UNPAID_SALARIES` as the CC numerator. Derive CC arrears from D1:
     prior `PAYROLL_MONTH` rows for the same `HOUSEMAID_ID` carrying an exclusion reason (D1.10)
     and no `PAID_ON_DATE_FORMATTED`, **summing `NET_SALARY` (D1.3)** — naming the column matters,
     or CC and MV are not the same metric.
  2. Until confirmed, M7b's CC arm renders `SKIPPED — CC arrears source unconfirmed`, never PASS.
  **O12, blocking.**
- **Threshold.** Green ≤ 1.00% for **both** CC and MV. *(n8n `UNPAID_RATIO_MAX = 0.01`.)*
- **Division by zero.** `NET_SALARY` includes zero rows; a type whose denominator sums to zero →
  that side `SKIPPED`, parent `SKIPPED`.

### M8 — Pay period correctness (Check 8)

- **Business definition.** Money must move for the period it claims to be for. A row paid against
  the wrong month hits the wrong budget and breaks every other month-scoped metric.
- **Formula.** `M8 = COUNT(maid-months where the paid date falls outside the payroll month)`
- **Inputs.** D1.2, D1.9, D4 (`PAYROLL_DATE`), D2.4.
- **Mapping note — this check's meaning changes, and the change is an improvement.** In the
  spreadsheet this was `Pay Start Date`. In Snowflake `PAYROLL_MONTH` is the first day of the
  month by construction, so a literal port is tautological and would always pass — a green tick
  testing nothing. Instead compare **`PAID_ON_DATE_FORMATTED` and `WPS_RECORDS.PAYROLL_DATE`
  against `PAYROLL_MONTH`**. **O2 — needs P&C sign-off.**
- **De-duplication (v2).** D4 is one row per maid per **WPS report**, not per maid-month. Apply
  the same selection rule as tie-out 3 (latest report per maid per month) before comparing, or
  the check emits duplicate exception rows for a single resubmission.
- **Nulls.** Missing pay date → exception, reason `empty`. Unparseable → reason `invalid date`.
  Both are findings, not skips. `PAID_ON_DATE` is free text and `PAID_ON_DATE_FORMATTED` parses
  only three formats — **a fourth format lands as NULL and reads as "empty"**, so display the
  count of unparseable values as a data-quality figure.
- **Threshold.** Green 0 rows; Red ≥ 1.

### M9 — Bank-account diversion (Check 9)

- **Business definition.** Compare each maid's payment account between the audit month and the
  prior month. Most changes are benign; five transitions are the signature of salary diversion.
- **Formula.** `M9 = COUNT(maids whose account classification transition is in the red-flag set)`
- **Inputs.** D1.1, D1.7, D1.8, D1.2, D2.4.
- **Filters and population (v2 — v1 stated none, the only metric without them).**
  `PAYROLL_MONTH IN (audit_month, audit_month − 1 month)`; §1 exclusions; **all maids, CC and MV**
  — a diversion control that silently covered only CC would miss ~19,600 MV maids with nothing on
  the report to say so. State the compared population on the report.
- **Account classification — resolved via Ask the Code, 2026-09-02 (O24 largely closed).** Use
  `ANSARI_PAYMENT_METHOD` (D1.8) rather than re-implementing the n8n regexes. The authoritative
  rule is `Housemaid.getAnsariPaymentMethod()`, enum `com.magnamedia.extra.AnsariPaymentMethod`.
  It is **computed at read time, never stored**. Decision order, on the trimmed account value:

  | # | Test | Value |
  | --- | --- | --- |
  | 1 | null / empty | `''` |
  | 2 | starts `AE`, digits after `AE` length ≥ 14, **and `digits.substring(6,14) = '75123000'`** | `DU_PAY_CARD` |
  | 3 | starts `AE`, fails the du Pay marker — **no length check at all** | `BANK_TRANSFER` |
  | 4 | starts `9` | `PAYROLL_CARD` |
  | 5 | strip `^0+`, then starts `5` | `FAB_MASTER_CARD` |
  | 6 | strip `^0+`, then starts `10` | `ANSARI_VISA_CARD` |
  | 7 | strip `^0+`, then starts `19` | `OVER_THE_COUNTER` |
  | 8 | no match | `''` |

  **The auditor's concern does not hold, and the reason matters.** The worry was that the n8n
  Ansari pattern has no `AE` prefix and so could never reach the classifier's `AE` branch, leaving
  red-flag rules 2, 4 and 5 permanently silent. There is a **separate non-`AE` branch** (rows
  4–7) and `ANSARI_VISA_CARD` is reachable through it. The truncated view metadata showed only the
  `AE` half, which is what made the inference look sound.

  **Three corrections to the n8n patterns — the ERP rule is authoritative and should replace them:**

  | n8n pattern | ERP rule | Difference |
  | --- | --- | --- |
  | du Pay `^AE\d{2}026075123000\d{7}$` | marker at fixed offset only | n8n is **narrower** — it also pins `0260` before the marker and exactly 7 trailing digits. A du Pay account issued on a different BIC would be missed |
  | Ansari `^00000000001\d+$` | strip all leading zeros, then `10` | n8n **over-matches** (`11…`, `12…` also pass) and **under-matches** (a different count of leading zeros is missed). The two agree only on genuine `…10…` accounts |
  | Normal IBAN `^AE\d{21}$` | any `AE…` that is not du Pay, **no length check** | n8n leaves a short `AE…` value unclassified and skips it; the ERP calls it `BANK_TRANSFER`. Verified against the ERP's own test value `"AE123456751"` |

  **Two account types the n8n check never knew existed:** `PAYROLL_CARD` (`9…`) and
  `OVER_THE_COUNTER` (strip zeros → `19`), alongside `FAB_MASTER_CARD`. All three are
  prepaid or cash instruments — the same risk shape as du Pay — so transitions into them
  almost certainly belong in the red-flag set. **O8, widened.**

  **⚠ Two residual issues, both narrower than O24 was.**
  1. **The Snowflake column is a dbt re-implementation of the Java getter, not the same code.**
     `BA_VIEWS…HOUSEMAID_PAYROLL_HISTORY` is a passthrough
     (`SELECT * FROM SILVER.HOUSEMAID_MANAGEMENT.HOUSEMAID_PAYROLL_HISTORY`), and that SILVER
     schema is not readable under this role, so the CASE could not be compared line by line
     against the getter. Its profiled `allowed_values` lists only `FAB_MASTER_CARD`,
     `ANSARI_VISA_CARD`, `''`, `DU_PAY_CARD`, `BANK_TRANSFER` — **`PAYROLL_CARD` and
     `OVER_THE_COUNTER` are absent.** Either they do not occur in payroll-log data, or the dbt
     CASE omits those branches and such accounts collapse into `''`, invisible to this check.
     A single `COUNT(*) GROUP BY ANSARI_PAYMENT_METHOD` settles it once a warehouse exists (O1).
     **O24 — reduced to this.**
  2. **Three different columns hold "employee account with agent", and they are not the same
     value.** The ERP getter reads **`NEWREQUESTS.EMPLOYEE_ACCOUNT_WITH_AGENT`** via
     `HOUSEMAIDS.VISA_NEW_REQUEST_ID`; `HOUSEMAIDS.EMPLOYEE_ACCOUNT_WITH_AGENT` exists but the
     getter does **not** use it; and D1.7 is
     `HOUSEMAIDPAYROLLLOGS.EMPLOYEE_ACCOUNT_WITH_AGENT`. **For this check D1.7 is the correct
     one** — it is per-month and records the account the salary was actually paid to, which is
     exactly what a month-over-month comparison needs; the other two are current-state. But it
     means `HOUSEMAIDS_INFO.ANSARI_PAYMENT_METHOD` (D2) and
     `HOUSEMAID_PAYROLL_HISTORY.ANSARI_PAYMENT_METHOD` (D1.8) **can disagree for the same maid**,
     and only D1.8 may be used here. **O29.**

- **Acceptance test — there is no labelled ground truth, and that is itself a finding
  (Ask the Code, 2026-09-02).** The intended test was "a known historical diversion the build must
  re-detect". It cannot be built that way, for two independent reasons:

  1. **The ERP records no fraud, diversion or investigation case of any kind.** There is no case,
     investigation or dispute-flag entity in the payroll or complaints modules. The nearest
     things are all something else: `EMPLOYEELOANS.LOAN_TYPE = 'SALARY_DISPUTE'` is a *recoverable
     loan bucket* (created by migration, an approved `EXPENSES` request, or a manual
     `createHousemaidLoan` POST), not an investigation record; a `PAYROLLMANAGERNOTES` addition
     with reason `salary_dispute` is a *salary correction* ("salary received was wrong");
     `PAYROLLAUDITHOUSEMAIDEXCEPTIONS` covers arithmetic exceptions
     (`HOUSEMAID_NEGATIVE_SALARY`, `HOUSEMAID_DEDUCTION_OVER_CAP`, …), never account changes;
     `COMPLAINTS` has a "Money Disputes" type with no payroll linkage in code.
  2. **The payment account has no audit trail.** `NEWREQUESTS` *is* Hibernate Envers–audited —
     `NEWREQUESTS_REVISIONS` exists, with `REVISION`, `REVISION_TYPE` (0 insert / 1 update /
     2 delete), a `{COLUMN}_MODIFIED` flag per field, and `HISTORY_REVISIONS` carrying `TIMESTAMP`
     and `CREATOR`. But **`EMPLOYEE_ACCOUNT_WITH_AGENT` is not in the audited field set**
     (`@NotAudited` fields are excluded; the audited list runs `WORKER_TYPE_ID`,
     `LABOR_CARD_EXPIRY_DATE`, `EMPLOYEE_UNIQUE_ID`, the visa/medical dates, `MEDICAL_STATUS`,
     `BIO_STATUS` …). The Snowflake `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION` view
     (5,510,443 rows) carries 126 columns and **none of them is the payment account** either.
     No approval step or permission check on the field was found; it is an unconstrained
     `@Column String` with no `@Pattern`, `@Size` or length limit, and payroll only checks
     non-empty.

  **So: the field most attractive to a fraudster is the one field with no audit trail, no
  approval step and no validation.** That is a control gap in the ERP, independent of this
  dashboard, and it belongs to whoever owns payroll integrity — **O30**.

- **The acceptance test that can be built instead — back-test, then label.** D1.7 retains
  `EMPLOYEE_ACCOUNT_WITH_AGENT` **per maid per payroll month back to 2020-07-01**. The monthly
  snapshots imply the change events the ERP never recorded, so:
  1. Replay M9 over several historical month pairs and produce the transitions it would have
     flagged. This is a reconstruction of ground truth, not a substitute for it — say so.
  2. P&C reviews the flagged set for a month they know well and marks each genuine or benign.
     **That review creates the labelled set that does not exist today**, and it is the acceptance
     test from then on.
  3. Treat the same run as **threshold calibration**. It yields the base rate of red-flag
     transitions per month — which decides whether `Red at ≥ 1` is workable or will bury P&C in
     benign account changes. A detector nobody can keep up with fails the same way as one that
     never fires.
  Needs a warehouse (O1) to run. **O24 now covers this**, and it is a first-month task rather
  than a go-live blocker: the check can ship reporting counts while the labelled set is built.
- **Red-flag transition set** (prior → current), carried verbatim:
  1. Normal bank IBAN → du Pay
  2. Normal bank IBAN → Ansari
  3. du Pay → a *different* du Pay account
  4. du Pay → Ansari
  5. Ansari → a *different* Ansari account

  Every other transition — normal → different normal IBAN, anything → empty, empty → anything —
  is **not** a finding.
- **Comparison rules.** Match on `EMPLOYEE_UNIQUE_ID`. Compare only where **both** months have a
  non-empty account. Trim and upper-case before comparing. A maid absent from the prior month is
  a new employee, skipped, with the count displayed.
- **Threshold.** Green 0; Red ≥ 1. No amber.
- **Prior month unavailable:** `SKIPPED`, amber, worded *"No account comparison was performed this
  month — treat as UNVERIFIED, not clear."* Never green.

### M10 — CC contract payment reconciliation (Check 10)

- **Business definition.** Every CC contract with a maid on payroll this month should have a
  received monthly client payment. Contracts with none, or with payment stuck in a non-received
  state, are revenue that has not arrived.
- **Buckets.** Three, **mutually exclusive**, over distinct CC contracts on payroll:
  `received` (at least one `RECEIVED` payment — receiving any payment counts as collected on),
  `not_received` (payments exist, none received), `no_payment` (no payment row at all).
- **Formula — v2 correction.** v1's formula numerator was "contracts with **no received
  payment**" while its threshold and n8n provenance spoke only of `not_received`; those differ by
  the whole `no_payment` bucket, which is exactly what this check exists to surface. Resolved by
  making the headline the union and keeping the n8n figure visible beside it:
  `M10_uncollected = (not_received + no_payment) / total CC contracts on payroll`  ← **the threshold metric**
  `M10_notreceived = not_received / total CC contracts on payroll`  ← displayed, the n8n-comparable figure
- **Inputs.** D1.3, D3, D7 (contract, type, validity — available); N2 (payment rows — **the only
  blocker**).
- **Filters.** `CONTRACT_TYPE = 'CC'` (D7.3, equivalently `CONTRACT_PROSPECT_TYPE_ID = 1650`);
  payment type `1`; payment `DATE_OF_PAYMENT` between the first and last day of the month after
  the audit month; `FAKE = false`; `IGNORE_IN_REPORTING = 0`; payment `STATUS = 'DELETED'` rows
  ignored entirely (counted separately for visibility, never in a ratio).
  **Non-received statuses must survive with `RECEIVED_DATE IS NULL`** — §1.
- **Contract resolution — as at the payroll month, not now (O13).** The ERP's own join uses
  `CONTRACTS.STATUS = 'ACTIVE'` with no date bounding, so a contract cancelled after the payroll
  month drops out of the denominator entirely and nobody ever asks whether its client paid. Use
  D7.5's validity dates to resolve the contract **as at the audit month** instead. The exact
  predicate (overlap with the month, vs `START_OF_CONTRACT <= month_end AND
  COALESCE(DATE_OF_TERMINATION, END_OF_CONTRACT) >= month_start`) is **O13**.
- **Threshold.** Green `M10_uncollected ≤ 5.00%`; Red above. *(n8n `maxNotReceivedRatio = 0.05`,
  which was measured against the narrower bucket — the threshold may need re-calibrating against
  the union. **O25.**)*
- **Data-quality failures — these fail the check independently of the ratio.** Duplicate contract
  references in payroll; the payment source returning fewer rows than it reports available
  (truncation); an unrecognised response shape; **zero CC contracts resolved from a populated
  payroll file** (explicitly a FAIL — the n8n code had a defect where an empty population rendered
  green).
- **Orphan payments (v2).** Payments on CC contracts with **no matching payroll row** — the
  reverse direction — are counted and displayed. A reconciliation that looks only one way hides
  the unexplained receipt.
- **Note.** `Maids without contracts` (blank or bare `Contr-` reference) is **reported as a count
  but does not fail the check**. Preserve that.

---

### Global guards

| Guard | Rule | Outcome |
| --- | --- | --- |
| **G1 — classification collapse** | > 100 payroll rows and `COUNT(CC) = 0` or `COUNT(MV) = 0` | **Abort.** M2, M3, M5, M6, M7, M10 partition on maid type; on an empty partition they report PASS on a zero population |
| **G2 — partial classification** | > 100 payroll rows and `COUNT(CC) + COUNT(MV) < 50%` of rows | **Abort.** The classification columns changed shape |
| **G3 — implausible MV receipts** | MV receipts < 10% of MV salaries | M6 `SKIPPED`, reason stated |
| **G4 — skipped drives fail** | Any check `SKIPPED` | Month = **FAIL**. An incomplete audit is not a clean audit |
| **G5 — payroll not locked** *(v2, new)* | The audit month's payroll is not finalised | **Whole run `SKIPPED`, not FAIL** — figures move after lock (N4 trap b), so a pre-lock run is not a finding about the business. Needs a lock signal the warehouse actually carries: **`LAST_PAYROLL_LOCK_DATE` is empty and cannot serve. O17, blocking.** Show the lock timestamp on the provenance line |

### Tie-out rule

Three identities must hold, each displayed. A broken identity is itself an exception row.

**1 — Population.** Stated in matching units (v2 — v1 equated a maid count with a row count,
which breaks in exactly the months Check 1 fires, double-reporting the same event):

```
COUNT(DISTINCT maid) : CC + MV + unclassified
COUNT(*)             : total payroll rows for the month
difference           : = M1_rows − M1_ids  (the duplicate rows Check 1 reports)
```

Unclassified must be zero for a clean month; any non-zero value is a data-quality exception and,
above the G2 threshold, aborts.

**2 — Contract buckets (M10).**
`received + not_received + no_payment = distinct CC contracts on payroll.`

**3 — Wage bill against the independent second source.** `SUM(D1.NET_SALARY)` for the month
reconciled against `SUM(WPS_RECORDS.PAID_SALARY)` for the same month, matched on
`EMPLOYEE_UNIQUE_ID`. **This tie-out did not exist in the n8n flow** — it had one view of the
payroll; Snowflake has two, and using both is the largest control improvement available in this
migration. Precisely because of that, v1's version was under-specified. It requires four things
v1 omitted:

| Requirement | Rule | Status |
| --- | --- | --- |
| **WPS row selection** | D4 is one row per maid per **report**; a resubmission or correction double-counts and makes the payroll side look understated. Take the **latest report per maid per month** | **O26 — confirm this is the right rule** |
| **Which date defines the month** | `PAYROLL_DATE`, `REPORT_DATE` and `UPLOADED_DATE` are all `DATE` and will not agree. `PAYROLL_DATE` is proposed | **O26** |
| **Materiality tolerance** | Without one, every rounding difference is an exception. Proposed: variance is a finding above **AED 5,000 or 0.05% of the month**, whichever is lower | **O27 — P&C to set** |
| **Key normalisation** | Join on `EMPLOYEE_UNIQUE_ID`, both `VARCHAR` — **types match**. M9 specifies trim/upper-case; this join must too, or a formatting difference reports as "present on only one side". `WPS_RECORDS.MAID_ID` (`NUMBER(38,0)`) is a type-safer alternative and should be evaluated | **O26** |

Display the variance and the count of maids present on only one side.

---

## 4. Finalised UI Report

**Archetype.** Primarily **exception / rule-breach list** (archetype 4), with a **two-sided
reconciliation** panel for the tie-out and a **trend** strip for the month-over-month ratios.

**Layout.** One screen: KPI strip → check register → exception table → tie-out → one chart.

**KPI tiles (5).**

| Tile | Source | Notes |
| --- | --- | --- |
| Month result | Pass / Fail / Fail (incomplete) | Amber wording when the failure is caused only by skipped checks |
| Checks failed | count | Of 10 |
| Checks skipped | count | Amber — never folded into "passed" |
| Exceptions to work | count | Exception-grain rows across M1, M7, M8, M9, M10 |
| **Uncollected receivable — M10** | AED | **v2: split.** v1 had one "Amount at risk" tile summing M10 (money owed *to* the company) with M7b arrears (money owed *by* the company to workers). Those move in opposite directions and netting them is not interpretable — and per §2.4 arrears are no longer displayed as a figure at all. This tile is `SUM(not_received + no_payment payment amounts)`, renders `—` when M10 is `SKIPPED`, and is defined here rather than appearing only in the UI |

**Check register.** Ten rows: ID · name · status badge · headline metric · threshold · exception
count. Each expands to metric detail and its exception table.

**Exception table columns.**

| Column | Source | Format | Sort/default |
| --- | --- | --- | --- |
| Check | M1–M10 | `M9` | — |
| Rule breached | metric definition, in the rule's own words | text | — |
| Subject | masked maid (`Maid #4471`) or contract (`Contr-118432`) | text | — |
| Case ref | opaque per-row reference | text | — |
| Maid type | D3 | `CC` / `MV` | — |
| Detail | e.g. `Normal IBAN ••••4417 → du Pay ••••9902` | text | — |
| Amount / band | **M10 only:** AED. **M7:** an arrears **band**, never the figure. Others blank | `#,##0` right-aligned | **desc — default sort** |
| Detected | run date | date | secondary sort |
| Status | reviewed / open | badge | — |

**No MOHRE ID column** — §2.4. Default sort is amount descending, then detected date.

**Filters.** Audit month (default: previous calendar month) · check ID (all) · maid type (all) ·
status (open only) · severity (red + amber).

**Drill-down.** Opens the per-maid or per-contract detail: metric inputs for that row, the
arithmetic, the prior-month comparison where used, and a deep link to the ERP record. **It does
not reveal the full bank account, the MOHRE ID, or the individual salary** — those are read in
the ERP under its own access control.

**Conditional formatting.** Row colour follows check status, never colour alone — every row
carries a text badge (`RED` / `AMBER` / `SKIPPED` / `OK`) so it survives printing, screenshotting
into an audit note, and colour-vision deficiency. Grey/`SKIPPED` is as prominent as red.

**Provenance line.** Always visible:
`Sources: HOUSEMAID_PAYROLL_HISTORY · HOUSEMAIDS_INFO · WPS_RECORDS · HOUSEMAID_OUTSTANDING_BALANCE_DETAILS · SALES_SILVER.CONTRACTS · CLIENT_MANAGEMENT_PAYMENTS · BI_PAYROLL_* (approved) — audit month YYYY-MM — payroll locked <timestamp> — data as of <timestamp> Gulf`

**Export.** CSV of the exception grain, honouring §2.4 masking — the same columns the screen
shows, not a privileged wider extract.

**Delivery.** A link. **No emailed report body.** See §2.4.

**Mockup.** https://claude.ai/code/artifact/5ffa76cd-ac5c-4517-a6ed-c3dfdd0e9924 — synthetic
throughout. It renders the expected day-one state (several checks `SKIPPED` pending N1/N2/N4/N6)
rather than an all-green month. Republished against v2: the MOHRE ID column is replaced by an
opaque case reference, and the combined "Amount at risk" tile is now "Uncollected receivable"
(M10 only).

---

## 5. Worked Examples

Values are **synthetic and illustrative**, arithmetically self-consistent so the formulas can be
checked. No figure is a real person's. *(Note: the headcounts below are of a realistic order of
magnitude for this population; they are not drawn from a query result.)* Validating these against
two real cases P&C has worked by hand is **O7**.

### Example A — clean case (M3, CC wage-bill movement)

| Input | Value |
| --- | --- |
| Audit month | 2026-07 |
| `SUM(NET_SALARY)`, CC, 2026-07 | AED 12,480,000 |
| `SUM(NET_SALARY)`, CC, 2026-06 | AED 12,310,000 |
| CC headcount 2026-07 / 2026-06 | 5,760 / 5,510 |

**Arithmetic.** `M3 = 12,480,000 − 12,310,000 = +170,000`; `170,000 ≤ 300,000` → within tolerance.

**Expected output row:** Check 3 · `PASS` · Difference `+AED 170,000` · Threshold `AED 300,000` ·
Exceptions 0.
**Expected flag:** Green. The rise tracks a 250-maid headcount increase, which the denominator
column makes visible — wage bill per maid actually fell.

### Example B — the exception this report exists to catch (M9, diversion)

Population: **all maids, CC and MV** (per M9's filters).

| Input | Value |
| --- | --- |
| Audit month | 2026-07 |
| Maids with an account in both months | 24,180 |
| Accounts unchanged | 24,151 |
| Accounts changed | 29 |
| Of which red-flag transitions | 4 |
| New employees (no prior month), skipped | 1,233 |

**The four rows.**

| Subject | Prior → current | Transition | Red flag |
| --- | --- | --- | --- |
| Maid #4471 | `BANK_TRANSFER ••••4417` → `DU_PAY_CARD ••••9902` | Normal IBAN → du Pay | Yes (rule 1) |
| Maid #5188 | `DU_PAY_CARD ••••1120` → `DU_PAY_CARD ••••7734` | du Pay → different du Pay | Yes (rule 3) |
| Maid #2903 | `ANSARI_VISA_CARD ••••0031` → `ANSARI_VISA_CARD ••••0088` | Ansari → different Ansari | Yes (rule 5) |
| Maid #6742 | `BANK_TRANSFER ••••2210` → `ANSARI_VISA_CARD ••••0177` | Normal IBAN → Ansari | Yes (rule 2) |

The other 25 changes were normal-IBAN → different-normal-IBAN and are **not** reported.

**Arithmetic.** `M9 = 4`; threshold 0.
**Expected flag:** Red. Escalates to Finance leadership. Three of these four accounts are prepaid
card products that can be opened by someone other than the maid — which is why the *transition*,
not the account, is the signal.

> Rows 3 and 4 depend on Ansari accounts actually classifying as `ANSARI_VISA_CARD`. **Under
> O24 that is unconfirmed** — if they classify as `''` or `BANK_TRANSFER`, these two rows never
> appear and the check reports 2, not 4, while looking healthy.

### Example C — edge case (M6 + G3, the implausible-denominator trap)

> **v2 — v1 computed this example upside down** and built its whole narrative on the inversion.
> Corrected below. A builder who implemented v1's orientation would have inverted the check
> permanently: real overspend would render as a tiny percentage and always pass.

| Input | Value |
| --- | --- |
| Audit month | 2026-07 |
| MV maids on payroll | ~19,700 |
| `SUM(NET_SALARY)`, MV | AED 28,020,000 |
| MV client receipts returned by the query | AED 3,431 |

**Naive arithmetic, from the stated formula.**
`M6 = 28,020,000 / 3,431 = 816,671%` → far above 90% → **FAIL (red)**.

That is the trap, and it is not the one v1 described. A broken receipts fetch does not produce a
false green here — it produces a **false red with a completely wrong diagnosis**. The report would
say "MV wages are 816,671% of client receipts", P&C would escalate an apparent catastrophic
subsidy, and the actual fault is a query returning nothing.

**Correct handling.** The plausibility floor is evaluated **before any threshold comparison**:
floor = `10% × 28,020,000 = AED 2,802,000`; `3,431 < 2,802,000` → G3 fires.

**Expected output row:** Check 6 · `SKIPPED` · *"MV client receipts came back at AED 3,431 against
AED 28,020,000 of MV salaries, below the AED 2,802,000 plausibility floor. This is a broken fetch,
not a threshold result. Check 6 was not evaluated."*
**Expected flag:** Amber (skipped); by G4 the **month result is FAIL**.
For contrast, a healthy month returns roughly AED 33.4M of receipts against AED 28.0M of salaries
— **83.89%**, a genuine pass, with the floor sitting about **11.9×** below that denominator.

### Example D — edge case (M10, mixed payments on one contract)

| Input | Value |
| --- | --- |
| Contract | `Contr-118432`, `CONTRACT_TYPE = 'CC'`, one maid on payroll 2026-07 |
| Payment 1 | `DATE_OF_PAYMENT` 2026-08-01 · `STATUS = RECEIVED` · `RECEIVED_DATE` populated |
| Payment 2 | `DATE_OF_PAYMENT` 2026-08-15 · `STATUS = BOUNCED` · `RECEIVED_DATE` **NULL** |
| Payment 3 | `DATE_OF_PAYMENT` 2026-08-20 · `STATUS = RECEIVED` · negative amount (refund) |
| Payment 4 | `DATE_OF_PAYMENT` 2026-08-03 · `STATUS = DELETED` |

**Arithmetic.** The `DELETED` row is ignored entirely. Payment 2 has `RECEIVED_DATE IS NULL` and
**must still reach M10** — under v1's population filter it would have been dropped before
bucketing, which is the defect §1 now fixes. The contract has at least one `RECEIVED` payment, so
by the bucket rule it is classified **received**, not not-received, despite the bounce. The refund
**nets into** the contract's received total rather than being dropped.

**Expected output:** contributes 1 to *received contracts* and its net amount to *received total*.
It contributes **nothing** to `not_received` or `no_payment`, so it does not move
`M10_uncollected`. The bounce is not invisible: it appears in the not-received **payment** count,
displayed separately from the contract count for exactly this reason.
**Expected flag:** Green at contract level, with the bounced payment visible in the detail.

---

## 6. Open Items

**Blocking (6).**

| # | Item | Owner |
| --- | --- | --- |
| O1 | **No warehouse grant — the single access blocker.** See §9 for the exact request. `PAYROLL_AND_MONEY_CONTROL_ROLE` has no USAGE on any warehouse (`SHOW WAREHOUSES` returns 0 rows; `CURRENT_WAREHOUSE()` is empty), so only metadata-served statements run. Columns, types, profiled ranges and row counts are verified; **freshness, grain and period coverage are asserted, not measured**. Also blocks O19 (approved-KPI register search) and O24 (the `ANSARI_PAYMENT_METHOD` distribution) | Data team / Snowflake admin |
| O2 | **M8 changes meaning.** `PAYROLL_MONTH` is the first of the month by construction, so a literal port always passes and tests nothing. Proposed: compare `PAID_ON_DATE_FORMATTED` and `WPS_RECORDS.PAYROLL_DATE` against `PAYROLL_MONTH` | Police & Control |
| O3 | **Skipped-drives-fail with a known gap.** M4b, M5, M6, M7b(CC) and M10 are `SKIPPED` until N1/N2/N4/N6 land, so G4 fails every month meanwhile. Confirm that is wanted, or add a fourth state (`BLOCKED`) that does not fail the month | Police & Control |
| O12 | **`PREVIOUSLY_UNPAID_SALARIES` is MV-only.** If confirmed, Check 7's CC arm has always summed to zero and always passed, and CC arrears are unmeasured. Confirm, then extend the ERP computation or approve the D1-derived CC definition (N6) | Payroll Mgmt + P&C |
| O15 | **Deletion-flag polarity.** `IS_DELETED` and `EXCLUDED_FROM_PAYROLL` are `VARCHAR` `'00'/'01'` with no documented polarity; `WPS_RECORDS.TRASHED` has no profiled values. A guess the wrong way empties the population — which G1/G2 abort on above 100 rows, or which passes silently below | Data team |
| O17 | **No payroll-lock signal.** G5 requires one and `LAST_PAYROLL_LOCK_DATE` profiles to "no non-null values". N4's figures move at lock, so a pre-lock run silently reports different numbers | Data team + Payroll Mgmt |
| O18 | **`FREEDOM_OPERATOR` and `WALKIN`.** D3's rule classifies both as CC on `LIVE_OUT` alone. Whether they belong in the CC wage bill (M3's threshold), M2 and M10 has never been asked | Police & Control |
| O24 | **Narrowed 2026-09-02 — no longer the original concern.** The ERP classifier is fully resolved (M9); Ansari accounts *are* reachable via a separate non-`AE` branch. What remains: the Snowflake column is a **dbt re-implementation** of the Java getter and its profiled values omit `PAYROLL_CARD` and `OVER_THE_COUNTER`. If the dbt CASE drops those branches, such accounts collapse to `''` and are invisible to Check 9. One `COUNT(*) GROUP BY ANSARI_PAYMENT_METHOD` settles it — needs O1. **The acceptance test is redefined** — no labelled diversion exists in the ERP, so it becomes a back-test over historical month pairs that P&C then labels, plus threshold calibration from the base rate (M9). Needs O1; a first-month task, not a go-live blocker | Data team + P&C |

**Non-blocking.**

| # | Item | Owner |
| --- | --- | --- |
| O4 | M2 denominator — do `ON_VACATION`, `SICK_WITHOUT_CLIENT`, `PENDING_VACATION`, `ASSIGNED_OFFICE_WORK` count as "without client"? The n8n rule says yes; it materially moves the ratio | Police & Control |
| O6 | M6 date asymmetry — the n8n MV query pins `dateOfPayment` to one date, the CC query uses a range. Likely a bug; not changed silently | P&C + Accounting |
| O7 | Worked examples are synthetic. Supply two real cases already verified by hand | Police & Control |
| O8 | **Widened 2026-09-02.** The ERP classifier has **seven** outcomes, not the n8n matrix's four: `FAB_MASTER_CARD`, `PAYROLL_CARD` and `OVER_THE_COUNTER` were never in it. All three are prepaid or cash instruments — the same risk shape as du Pay — so transitions into them very likely belong in the red-flag set. Decide, and restate the matrix over the ERP's own values | Police & Control |
| O13 | **Contract as-at resolution.** D7.5 provides the dates; the exact predicate (month overlap vs start/termination bounds) and whether `CONTRACTS_HISTORY` is the better source are undecided | P&C + Client Mgmt |
| O14 | Loan month boundary — v2 ERP code uses `< payrollEnd`, legacy uses `payrollEnd + 1 day`. Pick one | Payroll Management |
| O16 | **Timezone of `TIMESTAMP_NTZ`.** Confirm which zone mmdb writes and apply an explicit conversion; affects M6's `RECEIVED_DATE` bound | Data team |
| O19 | **Approved-KPI register not searched.** `INSIGHTS_DASHBOARD_CONTAINER` exists but its `TOOLTIP_INFO` contents need a warehouse (O1). Until searched, "no approved definition exists" for M2/M5/M6/M9/M10 is an assumption | Data team |
| O20 | **Pro-ration divisor.** N1's columns are named `*_PRO_RATED_*` and nothing states the divisor — calendar days, 30-day month, or working days. Also governs mid-month joiners and leavers in M2 and M3 | Payroll Management |
| O21 | Displaying the MOHRE ID needs a named pre-approval, or the case-reference scheme stands | Police & Control |
| O22 | M1's company-MOL-number exclusion — hard-coded, or read from a source? | Data team |
| O23 | M3 restatement — freeze each month at first clean run and show later movement separately. Confirm | Police & Control |
| O25 | M10 threshold re-calibration — the n8n 5% was measured against `not_received` only; `M10_uncollected` is the wider bucket | Police & Control |
| O26 | Tie-out 3 — WPS row-selection rule, which date defines the month, and key normalisation / `MAID_ID` vs `EMPLOYEE_UNIQUE_ID` | Data team + P&C |
| O27 | Tie-out 3 materiality tolerance. Proposed AED 5,000 or 0.05% | Police & Control |
| O30 | **Control gap, independent of this dashboard.** A housemaid's payment account (`NEWREQUESTS.EMPLOYEE_ACCOUNT_WITH_AGENT`) has **no audit trail** — `NEWREQUESTS` is Envers-audited but this field is not in the audited set, and no Snowflake revision view carries it — **no approval step or permission check**, and **no validation** (unconstrained `@Column String`; payroll only checks non-empty). Nobody can say who changed a maid's payment account, when, or from what. Detecting diversion after the fact is a poor substitute for preventing it | Payroll Management + whoever owns payroll integrity |
| O29 | **Three columns hold "employee account with agent" and they differ.** The ERP getter reads `NEWREQUESTS.EMPLOYEE_ACCOUNT_WITH_AGENT` via `HOUSEMAIDS.VISA_NEW_REQUEST_ID`; `HOUSEMAIDS.EMPLOYEE_ACCOUNT_WITH_AGENT` is unused by it; D1.7 is `HOUSEMAIDPAYROLLLOGS.EMPLOYEE_ACCOUNT_WITH_AGENT`. Check 9 must use D1.7 (per-month, what was actually paid), so `HOUSEMAIDS_INFO.ANSARI_PAYMENT_METHOD` and `HOUSEMAID_PAYROLL_HISTORY.ANSARI_PAYMENT_METHOD` can disagree for one maid. Confirm no metric mixes them | Data team |
| O28 | ~~Republish the mockup to match v2~~ **CLOSED** — MOHRE ID column replaced by a case reference; "Amount at risk" split to "Uncollected receivable" (M10 only) | — |
| O5 | ~~M5 population~~ **CLOSED** — grp5/grp6 are the live-out remapping of grp1/grp2; the CC-only filter is correct | — |
| O9 | ~~grp3 / grp4~~ **LIKELY CLOSED** — the enum carries only `GROUP_1/2/5/6`. One-line confirmation still wanted | Payroll |
| O10 | ~~ERP native names for N1–N4~~ **CLOSED** — resolved via Ask the Code, §7 | — |
| O11 | ~~Prospect-type picklist labels~~ **CLOSED** — `SALES_SILVER.CONTRACTS.CONTRACT_TYPE` already carries `CC`/`MV`, documented as "CC when `CONTRACT_PROSPECT_TYPE_ID` = 1650; otherwise MV". No picklist lookup needed | — |

### Questions a Snowflake engineer would still have to ask

Read §2.3 as a build brief; these are what stand between it and a start. Those marked ★ are
P&C's own decisions and should be answered in this spec, not passed to the data team.

1. Which target schema and layer do the new models land in?
2. ★ Deletion predicate and polarity for `IS_DELETED`, `EXCLUDED_FROM_PAYROLL`, `TRASHED` — O15.
3. ★ Which of `PAYROLL_DATE` / `REPORT_DATE` / `UPLOADED_DATE` defines a WPS month, and the
   de-dup rule — O26.
4. ★ How `CC Live In`/`CC Live Out` collapse, and where `FREEDOM_OPERATOR` and `WALKIN` go — O18.
5. The as-at contract-resolution predicate now that `STATUS = 'ACTIVE'` is rejected — O13.
6. Which month-boundary convention for `REPAYMENT_DATE` — O14.
7. ★ Is the company MOL number hard-coded in M1, or read from somewhere — O22.
8. ★ Tie-out 3's materiality tolerance — O27.
9. ★ Which amount column feeds the N6 CC arrears numerator — **answered in M7b: `NET_SALARY`**.
10. Does N2 mean widening `CLIENT_MANAGEMENT_PAYMENTS` or a new model — **answered in N2:
    widen it.**
11. What is the pro-ration divisor behind N1's `*_PRO_RATED_*` columns — O20.

---

## 7. Ask the Code — ERP native names

Queried **2026-09-02** against `erp/magnamedia-payroll-management`, `erp/magnamedia-accounting`
and `erp/magnamedia-client-management` (model `composer-2.5`). Names recorded exactly as
returned, including the ERP's own misspelling of `EXCULDED_FROM_PAYROLL`. These describe the
**ERP operational database**, not Snowflake.

**Answer 1 — day-group earnings and unpaid salaries**

- Enum `HousemaidSalaryGroup`: `GROUP_1`, `GROUP_2`, `GROUP_5`, `GROUP_6`. Days assigned by
  `PayrollGroupService.createHousemaidPayrollAttendanceLog` via
  `HousemaidPayrollAttendanceLog.salaryGroup`.
- grp1 = with client / assigned office work → **basic (full) salary** days; grp2 = in
  accommodation → **accommodation salary** days; grp5 / grp6 = the **live-out** equivalents,
  remapped when `liveOut = true`.
- Storage on `HOUSEMAIDPAYROLLLOGS`: `TOTAL_PRO_RATED_SALARY` (grp1), `MOHRE_PRO_RATED_SALARY`
  (grp2), `TOTAL_LIVE_OUT_PRO_RATED_SALARY` (grp5), `MOHRE_LIVE_OUT_PRO_RATED_SALARY` (grp6).
  Copied at export into `HOUSEMAIDPAYROLLBEANS` as `EARNING_IN_GROUP_ONE` / `_TWO` / `_FIVE` /
  `_SIX`, mirrored on `HOUSEMAIDBEANINFOS`.
- `PREVIOUSLY_UNPAID_SALARIES` lives on `HOUSEMAIDPAYROLLBEANS` (and `HOUSEMAIDBEANINFOS`),
  computed **at export** as the sum of `TOTAL_SALARY` over prior unpaid `HOUSEMAIDPAYROLLLOGS`
  rows **for maid-visa maids** — not stored on `HOUSEMAIDPAYROLLLOGS`. → **O12**.

**Answer 2 — contract link and loans**

- `Contr-<number>` is `CONTRACTS.ID`. `CONTRACT_NAME` is a display string
  `'Contr-' || CONTRACTS.ID` and **not a foreign key**.
- Join: `HOUSEMAIDPAYROLLBEANS.HOUSEMAID_ID → HOUSEMAIDS.ID`;
  `CONTRACTS.HOUSEMAID_ID = HOUSEMAIDS.ID AND CONTRACTS.STATUS = 'ACTIVE'`;
  `CONTRACTS.CLIENT_ID → CLIENTS.ID`. Alternate entry:
  `HOUSEMAIDPAYROLLLOGS.HOUSEMAID_PAYROLL_BEAN_ID → HOUSEMAIDPAYROLLBEANS.ID`. The
  `STATUS = 'ACTIVE'` filter is the defect behind **O13**.
- No persisted maid-level loan balance; computed as
  `EMPLOYEELOANS.AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT`. Export snapshot:
  `HOUSEMAIDPAYROLLBEANS.REMAINING_LOAN_BALANCE`.
- Current-month repayment: `REPAYMENTS.AMOUNT` (export `HOUSEMAIDPAYROLLBEANS.LOAN_REPAYMENT`),
  filtered `REPAYMENT_DATE >= payrollStart AND REPAYMENT_DATE < payrollEnd` (legacy path uses
  `payrollEnd + 1 day` → **O14**), `PAID_REPAYMENT = true`, `EXCULDED_FROM_PAYROLL = false`.
  Lifetime figures — `EMPLOYEELOANS.REPAID_AMOUNT` and
  `HOUSEMAIDPAYROLLBEANS.TOTAL_LOAN_REPAYMENTS` — must never be the numerator.

**Answer 3 — Payment Report filters**

| Filter property | Table | Column |
| --- | --- | --- |
| `contract.contractProspectType.id` | `CONTRACTS` | `CONTRACT_PROSPECT_TYPE_ID` |
| `typeOfPayment.id` | `PAYMENTS` | `TYPE_OF_PAYMENT_ID` |
| `dateOfPayment` | `PAYMENTS` | `DATE_OF_PAYMENT` |
| `dateChangedToReceived` | `PAYMENTS` | `DATE_CHANGED_TO_RECEIVED` |
| `status` | `PAYMENTS` | `STATUS` |

**Answer 4 — the Ansari account classifier** (`erp/magnamedia-payroll-management`, two questions)

- `ANSARI_PAYMENT_METHOD` is **computed at read time by `Housemaid.getAnsariPaymentMethod()`**,
  enum `com.magnamedia.extra.AnsariPaymentMethod`. **Nothing writes it to the database.**
- It reads **`NEWREQUESTS.EMPLOYEE_ACCOUNT_WITH_AGENT`** via `HOUSEMAIDS.VISA_NEW_REQUEST_ID`
  (`visaNewRequest`). `HOUSEMAIDS.EMPLOYEE_ACCOUNT_WITH_AGENT` exists but **is not used by this
  getter** → O29.
- Decision order on the trimmed value: `AE` → du Pay marker? → else `BANK_TRANSFER` · else `9` →
  `PAYROLL_CARD` · else strip `^0+` → `5` = `FAB_MASTER_CARD`, `10` = `ANSARI_VISA_CARD`,
  `19` = `OVER_THE_COUNTER` · else `''`.
- du Pay test: starts `AE`, digits after `AE` of length ≥ 14, and `digits.substring(6,14)` equals
  the constant **`"75123000"`**. Worked ERP example: `AE220260751230000682808`.
- The field itself is an unconstrained `@Column String` on `NewRequest` — **no `@Pattern`,
  `@Size` or length limit**, and payroll only checks non-empty (`Strings.isNullOrEmpty`). There is
  no regex validating it anywhere. `OcrHelper.OCR_IBAN_PATTERN = "AE[\d\s]+"` exists but is for
  OCR extraction only and is not applied to this field.
- A short `AE…` value still classifies as `BANK_TRANSFER` — the ERP's own test value is
  `"AE123456751"`. There is **no IBAN length check** in this path.

Full comparison against the n8n patterns, and the two residual issues, are in **M9**.

**Answer 5 — is there a historical diversion to test against?** (`erp/magnamedia-payroll-management`,
`erp/magnamedia-complaints`, `erp/magnamedia-housemaid-management`)

- **No salary-fraud, salary-diversion or payroll-investigation entity exists** in the accessible
  payroll or complaints code. `EMPLOYEELOANS.LOAN_TYPE = 'SALARY_DISPUTE'` is a recoverable loan
  bucket, not an investigation; a `PAYROLLMANAGERNOTES` addition with reason `salary_dispute` is a
  salary correction; `PAYROLLAUDITHOUSEMAIDEXCEPTIONS` covers arithmetic exceptions only;
  `COMPLAINTS` has a "Money Disputes" type with no payroll linkage in code.
- `NEWREQUESTS` **is** Envers-audited → `NEWREQUESTS_REVISIONS`, with `REVISION`, `REVISION_TYPE`
  (0/1/2), per-field `{COLUMN}_MODIFIED` flags, and `HISTORY_REVISIONS` (`TIMESTAMP`, `CREATOR`).
  Sibling tables follow the same pattern (`HOUSEMAIDS_REVISIONS`, `CONTRACTS_REVISIONS`).
- **`EMPLOYEE_ACCOUNT_WITH_AGENT` is not in the audited field set** — the audited list is
  `WORKER_TYPE_ID`, `LABOR_CARD_EXPIRY_DATE`, `ILOE_INSURANCE_START_DATE`, `RENEW_REQUEST_ID`,
  the entry-visa / work-permit / passport expiry dates, `EMPLOYEE_UNIQUE_ID`,
  `ENTRY_VISA_PERMIT_NUMBER`, the sample/result dates, `LOCATION_ID`, `MEDICAL_STATUS`,
  `BIO_STATUS`, plus the `BaseEntity` / `WorkflowEntity` / `VisaRequest` fields. → **O30**.
- Verified independently in Snowflake: `SHOW TERSE VIEWS LIKE '%REVISION%' IN DATABASE BA_VIEWS`
  returns three views, of which one is maid-related —
  `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO_REVISION`, `COUNT(*) = 5,510,443`, 126 columns,
  **none of them the payment account**. (Its profiled metadata reports "no non-null values" for
  every column, which conflicts with the row count and is most likely stale profiling — row
  contents could not be checked without a warehouse, O1.)

**Not resolved.** The picklist label for `TYPE_OF_PAYMENT_ID = 1` — the question timed out twice.
Not blocking: the filter is the integer, and the CC/MV split now comes from D7.3's ready-made
`CONTRACT_TYPE` rather than the prospect-type picklist (O11 closed).

**Caveat on all of the above.** Ask the Code answers are generated from code and can miss a
second table holding adjustments, overrides or corrections. Where a number matters — the loan
numerator especially — probe for adjustment and reversal tables before treating the named column
as complete.

---

## 8. What the migration removes

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
| Contract link fixed to the maid's *currently active* contract | **Improved** — D7.5's validity dates allow as-at resolution (O13) |

Two things the migration does **not** fix on its own: the mid-month CC↔MV transition (N5), which
needs an ERP change; and Check 7's CC arm (O12), which needs a definition decision.

---

## 9. Access request — what the Snowflake admin needs to grant

Everything below was measured in this session on 2026-09-02/03 as
`hassan.ahmed@maids.cc` / `PAYROLL_AND_MONEY_CONTROL_ROLE`, account `IH42925`.

### 9.1 Warehouse USAGE — blocking, and the only thing stopping verification

**Symptom.** `SHOW WAREHOUSES` returns **0 rows** and `SELECT CURRENT_WAREHOUSE()` returns the
empty string. Statements Snowflake can serve from metadata succeed — `SHOW …`, `DESC VIEW …`,
`GET_DDL(…)`, and a bare `SELECT COUNT(*) FROM <view>`. Anything needing compute fails with:

> `Unable to run the command. You must specify the warehouse to use by either setting the`
> `warehouse field in the body of the request or by setting the DEFAULT_NAMESPACE property for`
> `the current user.`

That includes `MAX(<date>)`, any `GROUP BY`, any explicit column list, `SELECT * … LIMIT 0`, and
every `INFORMATION_SCHEMA` query. The MCP connector exposes only a `sql` parameter with no
warehouse field, so the warehouse must resolve server-side.

**Grant needed.** Two statements — the grant alone is not enough, because nothing in the request
names a warehouse:

```sql
GRANT USAGE ON WAREHOUSE <WH> TO ROLE PAYROLL_AND_MONEY_CONTROL_ROLE;
ALTER USER "hassan.ahmed@maids.cc" SET DEFAULT_WAREHOUSE = <WH>;
```

**Sizing.** `XSMALL` is ample. The workload is aggregate reads over views of ≤ 5.5M rows, run
monthly by one person — not the dashboard's own refresh, which the ERP/data-governance team owns
(§1). Attaching a resource monitor is reasonable and will not get in the way.

**What it unblocks, concretely:** O1 (freshness, grain and period coverage measured rather than
asserted), O19 (searching `INSIGHTS_DASHBOARD_CONTAINER` for approved definitions), O24 (one
`COUNT(*) … GROUP BY ANSARI_PAYMENT_METHOD` settles whether `PAYROLL_CARD` and
`OVER_THE_COUNTER` occur), O15 (reading the actual `'00'`/`'01'` polarity instead of guessing),
and the M9 back-test that produces check 9's acceptance test and threshold calibration.

### 9.2 `SILVER.HOUSEMAID_MANAGEMENT` — non-blocking, one question only

`BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_PAYROLL_HISTORY` is a passthrough
(`SELECT * FROM SILVER.HOUSEMAID_MANAGEMENT.HOUSEMAID_PAYROLL_HISTORY`), and in `SILVER` this role
sees only `INFORMATION_SCHEMA` and `PUBLIC` — `SILVER.HOUSEMAID_MANAGEMENT` returns *"does not
exist or not authorized"*. That is what prevented diffing the dbt `ANSARI_PAYMENT_METHOD` CASE
against the Java getter (O24).

```sql
GRANT USAGE ON SCHEMA SILVER.HOUSEMAID_MANAGEMENT TO ROLE PAYROLL_AND_MONEY_CONTROL_ROLE;
```

**Or simply have the data team paste the model's CASE expression** — read access to the SILVER
layer is not otherwise needed, and the narrower option is preferable.

### 9.3 `SNOWFLAKE.ACCOUNT_USAGE` — not needed

The role holds USAGE on `BA_VIEWS`, `MAIDSCCINSIGHTS`, `MARKETING`, `PAYROLL` and `SILVER`, and
none on the `SNOWFLAKE` share. The plugin's discovery queries use
`SNOWFLAKE.ACCOUNT_USAGE.TABLES` / `.COLUMNS`, which are therefore unavailable — but `SHOW …` and
`DESC VIEW` covered every discovery need here. **Do not request it.**

### 9.4 What is already sufficient

No further object grants are needed for the build. The role already holds 425 view grants across
`BA_VIEWS`, covering every table this spec names as verified: `HOUSEMAID_PAYROLL_HISTORY`,
`HOUSEMAIDS_INFO`, `HOUSEMAID_TYPE_LOGS`, `WPS_RECORDS`, `HOUSEMAID_OUTSTANDING_BALANCE_DETAILS`,
`CLIENT_MANAGEMENT_PAYMENTS`, `SALES_SILVER.CONTRACTS`, `CONTRACTS_HISTORY`, and the five
`BI_PAYROLL_*` gold models. It also holds full DDL rights on `PAYROLL.CROSS_DOMAIN`,
`PAYROLL.PUBLIC` and `PAYROLL.RAW_DATA`, all currently empty — the natural home for the new
models if the Snowflake team wants one.
