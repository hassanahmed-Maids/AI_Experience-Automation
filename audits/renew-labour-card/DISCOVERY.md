# Renew Labour Card — Stage 1 discovery (what the payment is, and what could be audited)

**Status:** discovery, evidence-first. Nothing here is taken from the Notion Audit Flow Factory; the two
Notion mentions below are cited only to record that the step is *not* specced there.
**Date:** 2026-09-13. **Author:** P&C audit pipeline session (Hassan).

Two evidence sources are still **blocked** and are named at the bottom: row-level Snowflake (no warehouse
grant on this connection) and Ask-the-Code (no ERP bearer token in this container). Everything below came
back from a query, a document, or a Jira record that is cited inline.

---

## 1. What this payment is

**Product:** the government fee to renew a domestic worker's **labour card** (the MOHRE record of the
employment: employer, job, salary, terms). It is not the work permit — the work permit is MOHRE's
*permission to employ*; the labour card is the *registered record* of that employment, and it must be
kept valid in line with the residence visa.
*Source: `Visa Expenses Master Guide – Policing Department` §3.4 (Drive `1ZymaVnHk...`, owner Mohammad Khalil).*

**Tariff:** **AED 1,208.57** (variant 1,211.72 across channels).
*Source: `visa steps cost` sheet (Drive `1Apz6DNFjQ...`, owner Omar El Joueidi) — the sheet ERP Alert 931
uses as its overspend thresholds; and Master Guide §4.3.*

**Share of the renewal bundle:** a renewal costs **AED 2,641–2,673** per maid all-in (work permit 50.36,
MOHRE insurance 189, labour card 1,208.57, ILOE 126, R-visa 443.50/457.46, medical 270/278.50, E-ID
353.91). The labour card is **~46% of the whole renewal** — the single largest line.
*Source: Master Guide §4.2–4.3.*

**When it is paid:** on a **renewal request**, at the workflow step **"Upload Contract to Tasheel"**,
after the maid confirms she will renew and the contract is filled, and *before* medical, R-visa and E-ID.
The renewal cycle is meant to start **30–60 days before visa expiry**.
*Sources: Master Guide §2.3 (renewal checklist) and §4.5.2; step names read from
`BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS_TASKS.TASK_NAME` profiled values (see §3).*

**How it is paid:** an RPA drives the MOHRE/Tasheel portal and pays by **Qashio credit card**; ERP then
carries the expense with `purpose = "Submit Renew Labour Card Application"`, `amount 1208.57`,
`paymentType Credit_Card`, `status Added`, a Qashio `referenceNumber`, and a `cardDetail`.
**The same portal flow also pays MOHRE Insurance (AED 189) in the same transaction**, but the two get
**separate Qashio transaction IDs**, and the insurance one arrives late — so the insurance expense is
currently **recorded without its transaction ID**.
*Source: VPMGOV-1701 (Pending PO, 2026-09-12), spec doc `16MCoyUHx...`, plus Omar Alomari's comment
carrying a verbatim API payload: "The MOHRE Insurance payment timestamp is the same as the payment
timestamp recorded for the 'Submit Renew Labour Card Application' expense, as both payments were done
within the same transaction."*

**Who it is paid for:** CC housemaids, MV housemaids, and office staff (small volume). The ERP expense
configuration maps the purpose to a different account head per employee type — see §2.

**Why we pay it at all:** MOHRE will not keep the employment file (and immigration will not renew the
residence visa) without a renewed labour contract/card. It is a precondition, paid up front by the
company, before any of the steps that could still fail (medical, R-visa, E-ID).

---

## 2. Where it lands in the books (ERP configuration — verified)

`VisaExpenseConfiguration` export (`Visa Expenses and Visa Payment Types`, Drive `16AnZ_tI-...`,
owner Malaz Alool) maps **expensePurpose → expense head**:

| Employee type | Purpose | expenseId | Expense head (label) | Code | Payment types configured |
|---|---|---|---|---|---|
| `MAID_CC` | Submit Renew Labour Card Application | **164** | Renewal and Cancellation - MOHRE - CC Maids | FT 19 | Edirhams, Credit_Card |
| `MAID_VISA` | Submit Renew Labour Card Application | **735** | Renewal and Cancellation - Mohre - MV Maids | MV 10 | Edirhams, Credit_Card |
| `OFFICE_STAFF` | *(no row for this purpose)* | — | — | — | — |

🔴 **The account head does not identify the product.** Heads 164 / 735 also carry MOHRE Insurance
(renewal), Modify contract, Unpaid Leave, Offer Letter, Work Permit, Labour Card Fees, Uploading Contract
to Tasheel, Modify Person Information, Cancellation Paper and Online Cancellation. A head-based population
— the approach the R-Visa and E-ID checks use — would be roughly an order of magnitude too wide here.
**The population must be driven by `PURPOSE`, not by the expense head.**

The heads were later renamed; post-rename the product has its own head, spelled **"Contract Submission"**:
`RENEW - CC Housemaids - Contract Submission`, `RENEW - MV Housemaids - Contract Submission`,
`RENEW - OfficeStaff - Contract Submission`. **The word "labour card" does not appear in the current head
name** — a filter written on "labour card" audits only the dead era. (Same trap as the E-ID check's
`EID` vs `E-ID` renewal-head miss.)

---

## 3. Where it lands in the warehouse (Snowflake — structure verified, content not)

Verified by `DESC VIEW` / `SHOW COLUMNS` (metadata only; this connection currently has **no warehouse
grant**, so no row-level count below is my own measurement).

**`BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES`** — one row per expense line on a visa request.
- `PURPOSE` — profiled `allowed_values` include **`SUBMIT_RENEW_LABOR_CARD_APPICATION`**
  (⚠️ the enum carries a **typo** — "APPICATION", American "LABOR"), alongside `MOHRE_INSURANCE`,
  `MEDICAL_RENEW`, `EID_RENEW`, `RENEW_RESIDENCE`, `UPLOAD_TO_TASHEEL`, `PAY_LABOR_CARD_FEE`.
- `REQUEST_TYPE` — `NewRequest` / `RenewRequest` / `CancelRequest` (literal per UNION leg).
- `STATUS` — `Added` / `Dismissed` / `Pending` (the expense row's own status, not the request's).
- `AMOUNT` — FLOAT; profiled max ≈ 19.7 **trillion** → range-guard before summing.
- `TRANSACTION_ID` — nullable; NULL means no payment transaction is linked.
- `REFERENCE_NUMBER` — Qashio/Noqodi reference (migrated legacy `QASHIO_TRANSACTION_ID`, per MC-1933 /
  VPMGOV-1658).
- `PAYMENT_DATE` — ⚠️ sentinel minimum `0025-11-06`; filter `> '1900-01-01'`.
- `IS_DELETED` — only ever `'0'` (deleted rows filtered upstream) — **do not** reuse the R-Visa page's
  `IS_DELETED = FALSE` predicate, which matches nothing.
- `OWNER_ID` / `OWNER_TYPE` (`HOUSEMAID` | `OFFICE_STAFF`), `CONTRACT_TYPE` (`'CC '` / `'MV '` — trailing
  space, needs TRIM), `CREATOR` / `CREATOR_NAME`.

**`BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS`** — grain: **one row per renewal case** (`REQUEST_ID`,
profiled range 1–20,241 → ~20k renewal cases all-time).
- `REQUEST_STATUS` — derived `COMPLETED` / `STOPPED` / `ONGOING`; `STOPPED_COMPLETED_DATE`.
- `LABOR_CARD_EXPIRY_DATE` — *"the trigger date for the renewal process"*.
- `LABOR_CARD_IN_GRACE_PERIOD` — TRUE within **30 days after** expiry ⚠️ computed with
  `CURRENT_TIMESTAMP()` **at dbt build time**, so it is as-of the last refresh, not as-of the case.
- `RENEWED_LABOR_CARD_EXPIRY_DATE` — the new card's expiry, i.e. **the evidence that the fee bought
  something**.
- `ELECTRONIC_WORK_PERMIT_ISSUE_DATE`, `R_VISA_EXPIRY_DATE`, `LAST_DATE_ALLOWED_STAY`, `FINES_PAID`,
  `SUBSCRIPTION_PAID`, `MANUALLY_PAUSED`, `PAUSE_REASON`, `CURRENT_TASKS`, `MEDICAL_STATUS`, `EID_STATUS`.
- `IS_DELETED` here is **`'00'` / `'01'`** (an in-app soft delete that is **not** filtered out of the
  model) — a different vocabulary from the expenses view. Two views, two delete conventions.

**`BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS_TASKS`** — one row per workflow step
(`STEP_ID`; profiled 633k rows all-time). `TASK_NAME` profiled values include, in flow order:
*Pending To Start Renewal · Maids Confirmed That Will Renew · Fill Information · **Upload Contract to
Tasheel** · Check Tasheel Contract Approval · Upload Tasheel Contract to ERP · Approve Signed Contract ·
Renew Electronic Work Permit · Prepare Medical Application · Waiting for the maid to go to medical test
and EID fingerprinting · Pending medical certificate approval from DHA · Apply for R-visa · Prepare EID
Application · Receival of EID Card · Insert Renewed Labour Card Expiry Date · Get Form from GDRFA*.
`STARTED_AT` / `COMPLETED_AT` / `STEP_STATUS` (`ONGOING`/`COMPLETED`/`SNOOZED`/`EXCLUDED`) /
`ITERATION` (rework count, profiled up to 1,909) / `MOVED_IN_BY_ERP` / `MOVED_OUT_BY_ERP`.

**`BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES`** — the warehouse's existing "lost expense" model.
`CATEGORY` ∈ {WORK PERMIT, ENTRY VISA, MEDICAL}; `EXPENSES_TYPE` has 13 values, of which the only
renewal-side one is *Medical Renew Expenses*. 🔴 **No renewal labour-card loss type exists in it** —
the loss this audit is about is not modelled anywhere in the warehouse today.

---

## 4. What it costs the company (measured, but from a company report — not my query)

From `Expense_Analysis_Report_v2` (Drive `1vkDnZrx...`, owner Malaz Alool), period **2025-12-01 →
2026-02-28** (3 months, 63,118 transactions):

| Head (post-rename) | Spend (AED) | Txns | Avg | Max |
|---|---|---|---|---|
| RENEW - MV Housemaids - Contract Submission | 1,096,172.99 | 907 | 1,208.57 | 1,208.57 |
| RENEW - CC Housemaids - Contract Submission | 351,693.87 | 291 | 1,208.57 | 1,208.57 |
| RENEW - OfficeStaff - Contract Submission | 18,128.55 | 15 | 1,208.57 | 1,208.57 |
| **Total (one quarter)** | **1,465,995.41** | **1,213** | | |

⇒ **≈ AED 5.9M a year, ≈ 400 payments a month**, three-quarters of it MV. Every single transaction in the
quarter is exactly at tariff, so *overspend* is not where the money leaks on this product — **whether the
payment bought anything is**.

Two observations worth a test (leads, not findings):
1. **Pairing gap.** Same quarter, same portal flow: labour card **907** MV vs MOHRE insurance **826** MV
   (`RENEW - MV Housemaids - MOHRE Insurance`, 156,114.00); CC **291** vs **257** (48,573.00). If the two
   fees are genuinely paid in one transaction (VPMGOV-1701), ~115 labour-card payments that quarter have
   no insurance sibling. Window edges explain some; it needs measuring per request, not per month.
2. **Legacy heads still moving.** `Renewal and Cancellation - Mohre - MV Maids` (432 txns, max 1,360.85)
   and `- MOHRE - CC Maids` (111, max 821.54 avg) are alive in the same quarter — so a
   post-rename-only population misses an era, exactly as the R-Visa check found for its own product.

---

## 5. What already exists (prior art — so the audit does not re-file a solved problem)

| Control | State | What it covers | What it leaves open |
|---|---|---|---|
| **ERP Alert 933** — *Money Lost, Renewal: Labour Card Paid but Maid Didn't Go to Medical* (DNA-4401, live since 2026-03-16; owners Mohammad Al Sharani / Ahmad Sharanek; daily 21:00) | Live | Renewal requests with a `Submit Renew Labour Card Application` expense, **no move-out from the "Waiting for the maid to go to medical test and EID fingerprinting" step**, and the employee turned *Employment Terminated / Terminated* **within the same request and the same step**. Loss reported = sum of all expenses on the request. | Only the **termination** exit. A renewal that is **STOPPED** for any other reason (client cancels, maid absconds, transfer, duplicate request) after the fee is paid is invisible. Only last-24h records. No duplicate test. No per-product loss figure (it sums the whole request). Alert output is an email, not an adjudicated ledger. |
| **ERP Alert 936** — *Stage Mutual Exclusivity Violation* (DNA-4404) | Live | Employees with ≥2 active visa requests (incl. Renewal + Cancellation). | Flags the overlap, not the money paid inside it. |
| **ERP Alert 932** — *Replacement Maid Expenses Recorded (Work Permit + Labour Card + MOHRE Insurance)* (DNA-4400) | Live | **Initial**-side bundle. | Nothing renewal-side. |
| **Alert 931** — Visa Expense Overspend | Live | Above-tariff spend, thresholds from the `visa steps cost` sheet. | Renewal labour card is 100% at tariff this quarter ⇒ this alert can never fire on it. |
| **LAWP reservoir** (Alerts 944/945 + the Notion *Non-Used LAWP Reservoir* check) | Live / under spec | **Initial** work permit + insurance + labour card, reuse within 3 months. | Explicitly excludes renewals: *"A renewed permit is not reservoir stock."* |
| Master Guide §5 audit procedures | Written | LAWP, Entry Visa, Medical, MV cancellation refunds. | **No renewal check of any kind.** |
| Notion Audit Flow Factory | — | 8 visa-step checks. | **No row for this step** (confirmed 2026-09-13). |

**Conclusion of prior art:** the renewal labour card — the largest single fee in a AED 5.9M/yr renewal
programme — is covered by exactly one narrow daily email alert, on one exit reason, with no recovery
question asked and no loss ledger.

---

## 6. Candidate failure modes (to be confirmed or killed by measurement)

Ranked by expected money, each with the test that would settle it and what would kill it.

| # | Failure mode | Why it is plausible here | Settles with |
|---|---|---|---|
| **F1** | **Paid, then the renewal never completed** — request `STOPPED`, or `ONGOING` long past the labour-card grace period, with no `RENEWED_LABOR_CARD_EXPIRY_DATE`. | Alert 933 covers only the terminated-in-medical-step slice; `LOST_VISA_EXPENSES` has no renewal LC type. | Renewal requests with a paid LC expense ⨯ `REQUEST_STATUS` / `RENEWED_LABOR_CARD_EXPIRY_DATE` / final step reached. |
| **F2** | **Paid twice for one renewal cycle** — two `SUBMIT_RENEW_LABOR_CARD_APPICATION` rows on one request, or a second renewal request opened for the same maid inside the same 2-year card validity. | `ITERATION` on the workflow step goes far above 1 (rework loops exist); Alert 936 proves multi-request overlap is real; Alerts 930/957 chase duplicates generically at request grain. | Count per `VISA_REQUEST_ID` and per maid over the card's validity window, with reversals netted. |
| **F3** | **Labour card paid without its MOHRE-insurance sibling** (or vice-versa) | The two are one portal payment (VPMGOV-1701) yet counts diverge by ~115/quarter. | Per-request pairing of the two purposes. |
| **F4** | **No recovery from anyone** — is the renewal LC ever charged to the MV client or to a maid loan? | Alert 970's loan-mapping table (17 expense types that must become a loan) carries no R-visa item; whether it carries a renewal LC item is **unknown**. MV clients pay for visa services, so an MV renewal may be billable. | Alert 970's table + contract terms; then look for the recovery leg. |
| **F5** | **Paid while a cancellation was already running** (Alert 936's overlap, priced) | Renewal + Cancellation overlap is a named live alert. | Requests overlapping a cancel request, restricted to those that paid. |
| **F6** | **Payment recorded with no transaction / no reference** — control violation rather than loss | `TRANSACTION_ID` is nullable; the sibling insurance fee is *known* to be recorded without its ID. | Null-rate on `TRANSACTION_ID` / `REFERENCE_NUMBER` for this purpose. |
| **F7** | **Office staff in or out of scope** — 15 payments/quarter, and the ERP config has **no** `OFFICE_STAFF` row for this purpose yet `RENEW - OfficeStaff - Contract Submission` has spend. | Config/reality mismatch is itself a finding-shaped thing. | Ask-the-code: which write path creates the office-staff renewal expense. |

Deliberately **not** candidates: overspend vs tariff (F0) — every transaction in the measured quarter is
exactly 1,208.57, so the test can only under-count and Alert 931 already owns it. It stays as a cheap
guard, never as the headline.

---

## 7. Blocked — what this session could not verify, and what unblocks it

1. 🔴 **Row-level Snowflake.** `SELECT CURRENT_ROLE()` returns `PAYROLL_AND_MONEY_CONTROL_ROLE`, and
   `SHOW GRANTS TO ROLE …` returns **669 grants, none of them a WAREHOUSE** (`SHOW WAREHOUSES` returns 0
   rows). Any aggregate fails with *"You must specify the warehouse to use…"*; only metadata-served
   queries (`SHOW`, `DESC`, bare `COUNT(*)`) run. So every count in §4 is a document read, not my
   measurement, and §6 stays candidate-level.
   **Unblocks with:** a warehouse usage grant on that role (or the warehouse name + key-pair values that
   `scripts/sf_query.py` expects — this container has only `.env.example`).
2. 🔴 **Ask-the-Code.** No ERP bearer token in this container (`.env` absent). Needed for: which write
   path creates the renewal LC expense and whether it can fire twice; whether a reversal/refund route
   exists for it; Alert 970's loan-mapping table; the office-staff path (F7).
   **Unblocks with:** a fresh `ERP_AUTH_TOKEN` (+ `ERP_SECC_PLATFORM`) pasted at the moment of use.

---

## 8. Evidence index

| Evidence | Where |
|---|---|
| Tariff 1,208.57, "May include Fines? FALSE" | Drive sheet `1Apz6DNFjQwqx2hwvyGjJpYnCGJng85EAn99z4CSDUaU` |
| Renewal checklist, cost bundle, §5 audit procedures | Drive doc `1ZymaVnHk2qUzYzmv38KF7iwEvs1ROB0B-Nb6R6BbMU8` |
| Purpose → expense head mapping (164 / 735) | Drive sheet `16AnZ_tI-e8g5dPYwDadSui1c4u14wH9iJyHcW3DKLBY` |
| Quarterly spend by head | Drive sheet `1vkDnZrxaZqGfOD71k-U8LhRFTBHzvdB94gD89PWg4LA` |
| One-transaction pairing with MOHRE insurance + live API payload | Jira VPMGOV-1701 + doc `16MCoyUHx-2cLdUxgslI7JshK_QNBkgV4eht7Y_VXo94` |
| Alert 933 conditions | Jira DNA-4401 + doc `1z1E0XWZP6gH5iIkcJ1PcifEyIsomqAZJmDjHRGfvAZM` |
| Alert 936 conditions | Jira DNA-4404 + doc `1EpuU6Y3fkwHoFAxjT625Q5nE3oeoGCiFYMkhnm9IvtQ` |
| Alert 932 | Jira DNA-4400 |
| Warehouse structure, enums, gotchas | `DESC VIEW` on `BA_VIEWS.VISA_SILVER.{VISAREQUESTEXPENSES, RENEW_VISA_REQUESTS, RENEW_VISA_REQUESTS_TASKS, LOST_VISA_EXPENSES}` |
