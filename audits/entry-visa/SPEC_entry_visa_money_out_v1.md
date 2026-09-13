# Spec — Entry Visa Audit (money out)

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Spec version** | v1 — draft, populations not yet measured |
| **Date** | 2026-09-13 |
| **Supersedes** | Notion *Entry Visa Audit* (`Under spec'ing`, rejection-refund scope only) — its measured work is carried in below and credited |
| **UI mockup** | https://claude.ai/code/artifact/c5b9ecd3-e4eb-4c99-9292-ebf0f53c429c — layout only, every figure is an example |
| **Status** | Draft — awaiting the discovery battery (`ENTRY-VISA-DISCOVERY.sql`) |

---

## 0. How this business case was derived

Nothing here is taken from the prior Notion page. The payment was reconstructed from two
independent sources and the page was read only afterwards, to reconcile.

| Source | What it gave | Limits of it |
| --- | --- | --- |
| Snowflake `BA_VIEWS` — `DESC`/`GET_DDL`/`SHOW` only | Column inventory, profiled enums, model lineage, the company's own "lost expense" taxonomy | **Metadata only.** This role has `SELECT` on 427 views but **no warehouse grant**, so not one row was read. Structure is proven; population, freshness and cardinality are not. |
| ERP ask-the-code, `erp/magnamedia-visa-processing` + `-accounting` | The workflow, the purpose-assignment rule, the refund mechanics, the expiry job, the cost constants | Generated from code; strong lead, not gospel. Verified by asking for class/method names on every claim. |

### When is it paid?

The entry visa is one step in the initial (new) visa request — the case file for putting one
person onto a maids.cc-sponsored residence visa. Its ordering is fixed by the code, not inferred:

```
Offer letter  →  Tasheel / MOHRE contract  →  Work permit + labour card + MOHRE insurance
      →  ⟨ Apply for entry Visa ⟩  →  Check entry-visa immigration approval
              ├─ inside UAE, or office staff  →  Change of Status  →  medical → EID → R-visa
              └─ outside UAE                  →  medical / flight  →  EID → R-visa
```

`ApplyForEntryVisaStep` (`STEP_ID = "Apply for entry Visa"`) is queued **unconditionally after
work-permit approval** — `CheckWorkPermitMinistryApprovalStep.onDone`, `CheckLabourCardApprovalStep.onDone`,
`PendingOfferLetterToBeSignedStep`. So the fee is paid *after* we have committed to the work permit
and *before* the maid can travel or change status. That ordering is what makes it leakable: by the
time we pay it, money is already sunk in the work-permit bundle, and the maid has not yet arrived.

Warehouse corroboration on the request header: `ENTRY_VISA_APPLICATION_DATE` →
`ENTRY_VISA_ISSUANCE_DATE` → `ENTRY_VISA_EXPIRY_DATE`, sitting between `WORK_PERMIT_SUBMITION_DATE`
and `MEDICAL_*` / `EID_*` / `RVISA_ISSUANCE_DATE`.

### Why do we pay it?

We are the sponsor. The entry permit is what lets the person enter the UAE (or, if already here,
what the change-of-status is applied against) before a residence visa exists. It is a government
fee we front. It is **not** re-billed to the client inside visa-processing: the module records only
`new_request_expense.amount` as a company cost, and the recharge columns `charge` / `vat_charge` are
written asynchronously by the accounting module's `visaExpenseService.updateVisaExpenseCharge`. The
profiled values of those columns in the warehouse are `0, 3, 60, 180, 2.5` — portal-fee scale, not
fee recovery. **Treat the entry-visa fee as company money out.**

> The AED 2,614 entry-visa charge that *clients* pay is a different question, a different
> counterparty and a different direction of money. It is out of scope here (see §1).

### Who pays it — settled from the code

**Everyone on a new visa request: MV (`MAID_VISA`) maids, CC/Normal maids, and `OFFICE_STAFF`.**
There is no housemaid-type or owner-type branch that suppresses the entry-visa expense;
`ApplyForEntryVisaStep.getFormKeys` branches on housemaid-vs-office-staff only to pick the *location*
form field. The MV/non-MV branch in `CheckWorkPermitMinistryApprovalStep.onDone` routes the
*preceding* labour-card step, not the entry visa.

Consequence for scope: no maid-type category describes this population. It is
**"every new visa request that reaches the entry-visa step"**, and the report must carry
`CONTRACT_TYPE` and `OWNER_TYPE` as dimensions rather than as filters.

### How is it paid, and how much?

One row on the visa-request expense ledger:
`BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES`, `REQUEST_TYPE = 'NewRequest'`,
`PURPOSE ∈ {ENTRY_VSIA, ENTRY_VISA_LESS_THAN_1000}`, `AMOUNT` = the government fee,
`PAYMENT_TYPE` defaulting to `Noqoodi`, out of a funding `BUCKET`, evidenced by `TRANSACTION_ID`
→ `mmdb_transformed.transactions` and/or `REFERENCE_NUMBER` (Qashio or Noqodi reference).

🔴 **The purpose is a function of the amount, not a property of the application.** This inverts the
assumption the prior check was built on. In `NewRequestController.addExpense` (change tag VPM-8872):

```java
int parameterAmount = Integer.parseInt(Setup.getParameter(
        Setup.getCurrentModule(), VisaProcessingModule.PARAM_ENTRY_VISA_EXPENSE_AMOUNT_THRESHOLD));
if (expense.getAmount() <= parameterAmount && ExpensePurpose.ENTRY_VSIA.equals(expense.getPurpose())) {
    expense.setPurpose(ExpensePurpose.ENTRY_VISA_LESS_THAN_1000);
}
expenseRepository.save(expense);
```

The agent always submits `ENTRY_VSIA`; the code rewrites it to `ENTRY_VISA_LESS_THAN_1000` when the
amount is at or below the threshold (`PARAM_ENTRY_VISA_EXPENSE_AMOUNT_THRESHOLD`, seeded at **1000**).
The labels are literally *"Entry Visa > 1000 AED"* and *"Entry Visa < 1000 AED"*. Three consequences:

1. Any test comparing purpose against amount band is **circular** — it can only ever fire on rows
   written before VPM-8872 shipped, or while the threshold held a different value. Such rows are a
   **dating artefact, not a business anomaly**, and must not be reported as findings (M-guard G1).
2. A verdict named *"wrong entry-visa type submitted"* describes something the system does not let a
   user do. The underlying event is real — a request that paid an inside-country price and then an
   outside-country price across a rejection — but it must be named and ruled on **the amounts**,
   not on the purpose codes.
3. `ENTRY_VSIA` is a **misspelling that is the live enum value.** Spelling it `ENTRY_VISA` returns
   zero rows and reads as a scoping decision rather than a bug. Every query in this spec uses the
   misspelling deliberately.

🔴 **There is no price list, no validation, and no approval limit on the amount.** The amount is
free-typed by an agent in a form and saved unconditionally. This was checked directly rather than
assumed, and the answer is stronger than expected:

- `NewRequest.ENTRY_VISA_COST_INSIDE_UAE = 900` / `ENTRY_VISA_COST_OUTSIDE_UAE = 400` are **dead
  code**. `getEntryVisaCost()` has **zero callers** in visa-processing or accounting, and is
  `@JsonIgnore` so it never even reaches the UI. Introduced 2017, functionally untouched since.
- They stopped being meaningful when `EntryVisaExpensesService` — the service that once auto-created
  the expense — was **commented out in the May-2018 "remove expense default values" cleanup**.
- The only server-side code that touches the typed amount is the VPM-8872 purpose reclassification
  above. It compares against the threshold parameter, **not** against any cost. Nothing is rejected,
  nothing is capped, nothing routes for approval.
- The **one live reference figure left anywhere** is accounting's `getDefaultEntryVisaExpenses()`,
  returning **1073 inside / 403 outside** as a fallback default. It is a default, not an authorised
  tariff — but it is the closest thing to an expected price the company has, and M6 should anchor on
  it rather than on a population average.

*That absence is the first control finding of this audit* (F0 below): a government fee with no
system-enforced expected amount, no cap, and no approval routing.

### How does the money come back — and when doesn't it?

On rejection, `CheckEntryVisaImmigrationApprovalStep.onDone` routes the case to
`RefundEntryVisaApplicationStep` (`STEP_ID = "Refund Entry Visa Application"`). That step is
**manual**. A user then types a `REFUND_FOR_ENTRY_VISA` expense through the same `addExpense`
endpoint; the code's only intervention is a **sign flip** (ACC-5640 #5) so a positive entry books as
a credit. The amount is user-entered — **no calculation, no expected refund, no percentage rule.**

🔴 **There is no 60-day claim window anywhere in the code or configuration.** No constant, no
parameter, no scheduled job encodes a deadline for reclaiming an entry-visa fee from immigration.
(`PARAMETER_REFUND_DAYS` and `PARAMETER_NUMBER_OF_DAYS_TO_CALCULATE_REFUND_AMOUNT` are accounting's
*client contract* refund rules and are unrelated.) If a 60-day rule exists it is a government rule
held in someone's head, not a system control — so a *"refunded late"* verdict has **no anchor to be
late against**, which is the likeliest explanation for its having zero cases in 11.5 months. This
spec therefore does not ship a lateness verdict; it ships an **ageing** measure instead (M5).

🔴 **`refundedStatus` is a user-typed claim, not evidence of money.** `NewRequest.refundedStatus`
(`refunded_status`) is a form field on the refund step whose options are literally
`"Refunded;Not Refunded"`. It gates only whether a refund expense line is *required*
(`CancelRequestController.getRequiredExpense`); it never creates one and never proves receipt.
**Any test that clears a case on `refundedStatus = true` will clear real losses.**

🔴 **An approved entry visa that simply expires unused produces no financial record at all.**
`CancelMaidAfter3DaysEvisaExpiredJob` (cron `0 0 13 * * *`) finds open requests where
`entryVisaExpiryDate <= now − 3 days`, skips those whose work permit was consumed
(`workPermitConsumed`), and calls `CancelEvisaExpiredMaidsService.execute`, which **only**: stops the
request, opens an `IMMIGRATION` cancel request, and sets the maid to `VISA_UNSUCCESSFUL`. It writes
**no expense, no refund line, no write-off**. This is money out with zero accounting trace, it
involves no rejection event, and it is therefore **structurally invisible to any rejection-keyed
audit population**. It is the single largest gap this spec closes.

The warehouse already names these shapes, in `VISA_SILVER.LOST_VISA_EXPENSES` where
`CATEGORY = 'ENTRY VISA'`:
`Not Approved E-Visas` · `Canceled E-Visas` · `Expired E-Visas`, broken down as
*Approved and Canceled Entry Visas* · *Not Approved Entry Visas (Pending Approval or Rejected)* ·
*Refunded Not Approved Entry Visas* · **_Expired & Pending Approval (Should Have Been Refunded)_** ·
*Expired & Approved (Can not be Refunded)*.

⚠️ That view is a **reporting** model, not an audit population, and it carries a standing exclusion:
its entry-visa and work-permit branches filter `NATIONALITY != 'Pakistani'`. Reusing it wholesale
would inherit an unpriced exclusion. This spec reads the ledger directly and **prices the Pakistani
population separately** (§3, coverage).

### Reconciliation with the prior Notion check

| Prior page says | This spec says | Basis |
| --- | --- | --- |
| Two *kinds* of entry-visa application; open ruling ❿ "nobody has established which charge gets which" | Not two kinds. One application; the purpose code is derived from the amount at save time | `NewRequestController.addExpense`, VPM-8872 |
| ⓮ *"Wrong entry-visa type submitted"* — 50 switches, AED 24,131 | The **event** is real; the **rule and name** are wrong. Re-cut as *paid twice at different price points across a rejection* (F4), ruled on amounts | same |
| "we have 60 days to claim it back"; verdicts ❻/❾ count 60 days | No 60-day rule exists in the system. Lateness verdict dropped; ageing reported instead (M5) | no constant/parameter/job found |
| Population = charges on requests **rejected at some point** | Rejection is one of four exit paths. Population = **every paid entry-visa charge** | `CancelMaidAfter3DaysEvisaExpiredJob` records nothing financial |
| `Added` + has a transaction | Adding that filter makes `Pending` charges invisible; the page's own test case 4 was falsified by exactly this | page's 2026-08-20 ERP re-pull |
| `ENTRY_VSIA` is a typo with 56,542 rows behind it | Confirmed — and it is the live enum name, not a data error | `ExpensePurpose` enum, 52 values |
| Rejection does not persist on the record (694 ever vs 487 today) | Confirmed and adopted: read `INITIAL_VISA_REQUESTS_HISTORY`, never the live column | `*_MODIFIED` revision pairs |

Its measured figures (223 unrefunded charges, AED 164,299.19 fees / AED 105,758.50 recoverable,
window 2025-09-05 → 2026-08-20) are **its measurements, not ours** — reproduced in §5 as a
reconciliation target for F1 only, not adopted as this spec's numbers.

---

## 1. Business Logic

**The control.** Every dirham paid to immigration for an entry visa must end its life in one of
three states, and the state must be visible in the system: **used** (the person entered or changed
status and progressed to residence), **recovered** (a refund line exists and the money came back), or
**explained** (a written, dated reason it was neither). A paid entry visa sitting in none of those
states is uncontrolled money.

**The failure it catches.** Company cash that left for a government fee and neither bought the
outcome nor came back — because nobody claimed the refund, because the permit was left to expire,
because the same visa was paid for twice, because the amount typed was not the amount owed, or
because the payment was never booked against the request at all.

**Reader and action.** The Visa/Policing owner, monthly. A red row names one request, one charge,
one amount and one owner-action: *file the refund claim*, *chase the stuck claim*, *recover the
duplicate*, *explain the expiry*. A row that cannot be settled from data routes to a human verifier.

**Population in scope.** Every `NewRequest` entry-visa charge line in the rolling 12-month window,
across **all three populations** — MV maids, CC maids, office staff — and both locations, inside and
outside the UAE. Dimensions, never filters.

**Explicitly out of scope.**
- **Renewal and cancellation entry visas** (`REQUEST_TYPE ∈ {RenewRequest, CancelRequest}`) as a
  *charge* source. Cancellation requests remain in scope as a *refund* source — a refund for a
  NewRequest charge can legitimately be booked on the cancel request (`CancelRequestController.addExpense`),
  so matching refunds only within one `VISA_REQUEST_ID` will under-count recoveries.
- **The client-side AED 2,614 entry-visa charge** — money *in*, different counterparty, owned by the
  Travel Assist Payments check.
- **`REFUND_MEDICAL_APPLICATION_FEES`** — same ledger, same endpoint, different audit and a different
  clock. A `LIKE '%REFUND%'` filter pulls it in; use exact purpose equality.
- **`AFTER_ENTRY_CANCELLATION`**, `CHANGE_OF_STATUS`, `WORK_PERMIT`, `MOHRE_INSURANCE`,
  `PAY_LABOR_CARD_FEE` — adjacent costs on the same request, each its own check.
- Anything about whether the *maid* should repay the fee. She should not; it is a sponsor cost.

**Grain.** **One row per entry-visa charge line** (`VISA_REQUEST_ID` × charge), because that is the
unit of money that leaves. Two finding families (F4, F5) are inherently about *pairs* of charges;
they emit at pair grain and are reconciled to charge grain by G3 before any total is taken.

**Refresh expectation.** Monthly, manual trigger, after month close.
**No recurring Snowflake job.** Ad hoc Snowflake is not a governed system of record; anything
standing goes to the ERP/Data team as a built model. This spec is that handoff.

---

## 2. Data Points Needed

### 2.1 Verified present in Snowflake — structure only

⚠️ Every row below was established from `DESC` / `GET_DDL` / `SHOW` with **no warehouse grant**, so
it proves the column exists, its type and its profiled enum. **It does not prove the column is
populated, fresh, or at the cardinality assumed.** `ENTRY-VISA-DISCOVERY.sql` closes that gap; until
it runs, treat every population figure in this spec as absent rather than zero.

| # | Data point | Table | Column | Notes |
| --- | --- | --- | --- | --- |
| D1 | The charge | `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | `PURPOSE`, `AMOUNT`, `STATUS`, `CREATION_DATE` | Grain: one row per expense line across new/renew/cancel, `UNION ALL`, no dedup. `ID` is a `ROW_NUMBER()` surrogate — **never a business key** |
| D2 | The refund | same | `PURPOSE = 'REFUND_FOR_ENTRY_VISA'` | Booked negative by the code's sign flip; may sit on a **cancel** request |
| D3 | Payment evidence | same | `TRANSACTION_ID`, `REFERENCE_NUMBER`, `PAYMENT_TYPE`, `BUCKET`, `PAYMENT_DATE` | `PAYMENT_DATE` carries a sentinel `0025-11-06`; filter `> '1900-01-01'`. `REFERENCE_NUMBER` is Qashio or Noqodi depending on portal |
| D4 | Population dimensions | same | `CONTRACT_TYPE`, `OWNER_TYPE`, `EMPLOYEE_TYPE`, `OWNER_ID` | `CONTRACT_TYPE` values carry a **trailing space** (`'CC '`, `'MV '`) — `TRIM` before comparing |
| D5 | Request header | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS` | `REQUEST_STATUS`, `STOPPED_COMPLETED_DATE`, `ENTRY_VISA_APPLICATION_DATE`, `ENTRY_VISA_ISSUANCE_DATE`, `ENTRY_VISA_EXPIRY_DATE`, `ENTRY_VISA_PERMIT_NUMBER`, `PROBLEM_OF_ENTRY_VISA`, `RVISA_ISSUANCE_DATE` | `REQUEST_STATUS ∈ {ONGOING, COMPLETED, STOPPED}` |
| D6 | Dated rejection | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY` | `ENTRY_VISA_IMMIGRATION_APPROVED` + `_MODIFIED`, `LAST_MODIFICATION_DATE`, `LAST_MODIFIER` | Envers-style revision pairs. **The only point-in-time source** — the live column is overwritten on re-application |
| D7 | Step timing & rework | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS` | `TASK_NAME`, `STEP_STATUS`, `STARTED_AT`, `COMPLETED_AT`, `ITERATION`, `MOVE_OUT_DATE_SET_BY` | `ITERATION` is the ERP's own re-entry count for a step — a re-application counter that needs no expense join |
| D8 | Unbooked payments | `BA_VIEWS.VISA_SILVER.MISSING_EXPENSES` | `MISSING_EXPENSE_NAME = 'ENTRY_VSIA_OR_ENTRY_VISA_LESS_THAN_1000'`, `MOVE_OUT_FROM_MISSING_EXPENSES_STEP` | ERP's own detector: step done, no expense row. **Earliest row 2025-06-02** — hard floor on F6 |
| D9 | Arrival / outcome | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS` | `HOUSEMAID_ID`, `TO_STATUS`, `CHANGE_DATE`, `NEXT_CHANGE_DATE` | Interval table — as-of reads are plain containment. `LANDED_IN_DUBAI`, `VISA_UNSUCCESSFUL`, `NO_SHOW` are the outcome vocabulary |
| D10 | Company's own loss view | `BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES` | `CATEGORY='ENTRY VISA'`, `SUB_CATEGORY`, `EXPENSES_TYPE`, `EXPENSES_AMOUNT` | **Reconciliation target, not a population.** Carries a `NATIONALITY != 'Pakistani'` exclusion |

**Join keys.** `VISAREQUESTEXPENSES.VISA_REQUEST_ID` = `INITIAL_VISA_REQUESTS.REQUEST_ID` =
`INITIAL_VISA_REQUESTS_HISTORY.REQUEST_ID` = `INITIAL_VISA_REQUESTS_TASKS.VISA_REQUEST_ID`, all
`NUMBER`. Person: `VISAREQUESTEXPENSES.OWNER_ID` = `HOUSEMAIDS_INFO.ID` **only when
`OWNER_TYPE = 'HOUSEMAID'`** — office-staff ids come from a different table and will silently
mis-join if `OWNER_TYPE` is not carried through every join.

**Data hygiene, each earned from the view metadata.**
`AMOUNT` maximum profiles at **~19.7 trillion** — range-guard before any `SUM`.
`AMOUNT` minimum is **negative** (`-1022.5`) — refunds and corrections share the column.
`IS_DELETED` only ever holds `'0'`.
`STATUS` is the *expense-row* lifecycle (`Added`/`Dismissed`/`Pending`), **not** the request workflow.
`CONTRACT_TYPE` has trailing spaces. `PAYMENT_DATE` has a year-25 sentinel.

### 2.2 Approved KPI definitions reused

**None exists.** No approved definition for entry-visa loss, recovery or unit cost was found in
`BA_VIEWS.CORE_SILVER`. *(`UNVERIFIED` — `INSIGHTS_DASHBOARD_CONTAINER` stores definitions in
`SEMANTIC_ID` + a `TOOLTIP_INFO` VARIANT and needs a row read to search; blocked by the warehouse
grant.)* Every metric below is therefore a **new Police & Control definition** and should be added
to the Data Catalog on approval.

### 2.3 Ingestion requests — not in Snowflake

| # | Data point | Source | Native location | Why it is needed |
| --- | --- | --- | --- | --- |
| N1 | A reference entry-visa fee | ERP — accounting | `getDefaultEntryVisaExpenses()` → **1073 inside / 403 outside** (live fallback default). ⛔ **Do not use** `NewRequest.ENTRY_VISA_COST_*` (900/400) — verified dead code, zero callers | The only live reference price in the company. It is a *default*, not an authorised tariff; M6 must say so on its face |
| N2 | The purpose threshold, **with its value history** | ERP Setup parameter | `PARAM_ENTRY_VISA_EXPENSE_AMOUNT_THRESHOLD` (seeded `1000`, added July 2025) | Without the value *as at* each charge date, G1 cannot separate a dating artefact from a real mismatch |
| N3 | Inside/outside UAE, as at application | ERP | **Computed, never stored.** Re-derive from `new_request.location_id` → `picklist_item.name` (emirate names ⇒ inside) or, for office staff, `office_staff.location_enum` | The single largest cost driver, and there is **no `is_inside_uae` column on the request or the expense**. Ingest the location picklist join, not a flag — nothing to copy |
| N4 | `refundedStatus` | ERP | `new_request.refunded_status`, `cancel_request.refunded_status` | Needed as a **contradiction detector** (F2), never as a clearance |
| N5 | Refund-claim provenance | ERP | `RefundEntryVisaApplicationStep` step open/close, `LAST_MODIFIER` | Distinguishes *never filed* from *filed and stuck* — different owners, different actions |

---

## 3. Finding Families and Metric Calculations

### The verdict model

Six values, not two. **A charge is GREEN only when every applicable test ran and passed.**
One red outweighs any number of greens; **one blocked test does too**.

| Verdict | Meaning |
| --- | --- |
| **GREEN** | Every applicable test ran and passed: the fee was used, recovered, or explained |
| **RED** | A finding — money out, not recovered, not explained |
| **CANDIDATE** | Looks red, but one named fact would settle it. The row states which fact |
| **VOID** | The test could not be trusted — a positive control failed, or a source column is unpopulated |
| **BLOCKED** | A required input is unavailable (N1–N5 not ingested). **Not green** |
| **REPORTED** | Already raised and owned; excluded from new-finding totals, kept in coverage |

---

### G — Guards that run before any family

- **G1 · Threshold dating guard.** The reclassification shipped in **July 2025** (VPM-8872/8874).
  So: before July 2025 the purpose was whatever the agent typed and `ENTRY_VISA_LESS_THAN_1000`
  should barely exist; from July 2025 the purpose is a pure function of the amount. A charge whose
  `PURPOSE` disagrees with its own `AMOUNT` band is therefore a **dating artefact**, not a business
  anomaly — report it as a data note and **never** as a finding. The July-2025 boundary is itself a
  testable assertion (Q1b): if pre-July-2025 rows carry `ENTRY_VISA_LESS_THAN_1000` in quantity, the
  reclassification was backfilled and this guard needs re-cutting. Without N2 (the threshold's value
  history) charges are **BLOCKED**, not GREEN, wherever the band is ambiguous.
- **G2 · Amount sanity.** `AMOUNT BETWEEN -50000 AND 50000`. Anything outside is VOID with its own
  count and total shown, never silently dropped.
- **G3 · One verdict per charge.** Pair-grain families (F4, F5) are collapsed to charge grain by
  severity rank **before** any sum. Overlapping families otherwise double-count.
- **G4 · Positive control on the expiry family.** Before reporting any count of expired-unused
  permits, confirm `ENTRY_VISA_ISSUANCE_DATE` and `ENTRY_VISA_EXPIRY_DATE` are populated at a
  plausible rate (Q6). If they are not, **F3 is VOID, not zero.**
- **G5 · Point-in-time.** Rejection is read **only** from D6 revisions. Reading the live column is
  forbidden: it is overwritten on re-application and loses exactly the re-applied cases — the ones
  where an unclaimed refund hides. The history additionally has **known false negatives**; a charge
  with no rejection revision but an `Added` refund between two charges is treated as *rejected,
  undated*, not as *never rejected*.

---

### F0 — No authorised amount exists *(control finding, reported once, not per row)*

- **Statement.** The entry-visa government fee is free-typed by an agent with **no price list, no
  validation, no cap and no approval routing**. The two constants that look like a price (900/400)
  are dead code with zero callers; the auto-costing service that once used them was commented out in
  2018. The only live reference is an accounting *fallback default* of 1073/403.
- **Why it leads.** Every downstream unit-price test is empirical rather than authoritative because
  of this. It is a standing control weakness and belongs in the report header, not in a footnote.
- **Verdict.** RED, reported once per run with the count and value of charges it affects (i.e. all).

### F1 — Rejected, refund never recovered

- **Population.** Charges (`STATUS = 'Added'`, payment evidence present) on requests with a dated
  `Rejected` revision (D6) at or after the charge, bounded by the next charge on the same request.
- **Test.** No `REFUND_FOR_ENTRY_VISA` line matched to that charge — **searched on both the new
  request and any linked cancel request**.
- **Split by owner, because the action differs.** *Never filed* (no refund line, refund step closed
  or request closed) · *Filed and stuck* (refund line exists at `Pending`) · *Filed and withdrawn*
  (refund line `Dismissed`).
- **M1 recoverable** = expected refundable amount − refund actually received.
- **M2 gross** = full charge amount.
- **Headline is M1; M2 shown beside it as gross exposure.**
- 🔴 **`refundedStatus` never clears this row.** It is a typed claim. Where it reads `Refunded` and
  no refund line exists, or the line sits `Pending`, that is a **contradiction to report** (F2),
  not a clearance.

### F2 — The claim says refunded, the ledger does not

- **Test.** `refundedStatus = true` (N4) while no matching `Added` refund line exists, or the line
  is `Pending` beyond the ageing threshold (M5).
- **Why it is separate.** It is a different failure — a control that reads clean while money is
  outstanding — and a different fix. Without N4 this family is **BLOCKED**, never GREEN.

### F3 — Paid, approved, expired unused *(the family the prior check cannot see)*

- **Population.** Charges on requests where `ENTRY_VISA_ISSUANCE_DATE` is present,
  `ENTRY_VISA_EXPIRY_DATE` has passed, and the person never progressed — no `RVISA_ISSUANCE_DATE`,
  and no `LANDED_IN_DUBAI` in D9 within the permit window.
- **Corroborating signal.** The maid sits at `VISA_UNSUCCESSFUL` and the request is `stopped` —
  the exact fingerprint written by `CancelEvisaExpiredMaidsService`.
- **Test.** No refund line and no write-off — which the code guarantees, since the expiry job
  records nothing financial. **So the expected result is that nearly all of these are unrecovered.**
  The finding is therefore not "is it unrecovered" but **"was it avoidable"**: split by whether the
  permit expired while still `Pending` approval (LOST_VISA_EXPENSES calls this
  *Should Have Been Refunded*) or after approval (*Can not be Refunded*).
- **Guarded by G4.** If the date columns are thin, this family is **VOID**, not zero.

### F4 — Paid twice for one entry visa

- **Grain.** Charge pair on one request. Collapsed by G3.
- **Test.** Two `Added` charges with payment evidence on the same request, **with no `Added` refund
  line and no dated rejection between them**. Both exclusions are load-bearing: a
  reject → refund → re-charge cycle is ordinary business, not a duplicate.
- **Bulk-posting guard.** Before reporting, group candidates by charge date. A cluster of pairs
  sharing one date is **one posting event**, not N independent leaks; report it as one.

### F5 — Paid at two different price points across a rejection

- Formerly *"wrong entry-visa type submitted"*. **Re-cut to rule on amounts**, because the code does
  not let a user choose a type (see §0).
- **Test.** Two charges on one request straddling a dated rejection, at materially different amounts
  — the inside-country price then the outside-country price, or the reverse.
- **M3 wasted** = first charge − refund recovered on it.
- **This is the family where the non-refundable remainder is a loss** (see the ruling below).

### F6 — The step was done and no payment was booked

- **Population.** D8, `MISSING_EXPENSE_NAME = 'ENTRY_VSIA_OR_ENTRY_VISA_LESS_THAN_1000'`.
- **Why it matters.** Either a government payment left the company with no ledger entry, or a step
  was closed without doing it. Both are control failures; only the first is money.
- **Hard floor: 2025-06-02**, the earliest row the detector holds. Anything before that is
  **BLOCKED, not clean.**

### F7 — Paid with no evidence of payment

- **Test.** `STATUS = 'Added'` with `TRANSACTION_ID IS NULL` **and** `REFERENCE_NUMBER` blank.
- **Charges stranded at `Pending`** get their own CANDIDATE row with an ageing measure — they are
  neither paid nor cancelled, and any population filtered on `Added` renders them invisible. The
  prior check's own falsified test case is the evidence that this hole is real.

---

### The ruling on the non-refundable remainder — decided from the code

You asked me to decide this from the code. **The code has no concept of a non-refundable portion.**
The refund amount is typed by a user; nothing computes it, nothing marks a fraction unrecoverable,
and accounting explicitly forces `charge = 0` and `vatCharge = 0` on refund lines rather than
apportioning anything. So the premise that "the remainder is the government's standard
non-refundable portion" **cannot be sourced from the system**; it is an observed residue.

Therefore, the only defensible split is by **causation**, not by arithmetic:

| Situation | Remainder is | Rationale |
| --- | --- | --- |
| Correct single application, immigration rejected it | **Cost** — not a finding | We did nothing wrong; the residue is the price of applying |
| We caused the waste — F4 duplicate, F5 double price point, F3 avoidable expiry | **Loss — the whole fee** | None of it should have been spent; there is no correct-application defence |

This is conservative in the direction the audit should be conservative: it can only under-count.
The prior manual run booked AED 10,215.38 of remainder as loss across 35 cases that were *every one
refunded inside the window* — roughly 30% of its reported total, and exactly what this rule prevents.

---

### M — Measures

| ID | Measure | Definition | Notes |
| --- | --- | --- | --- |
| **M1** | Recoverable | Expected refundable − refund received, per charge | **Headline.** Requires an expected-refundable reference; until one exists, computed from the observed refund mode per price band and marked `UNVERIFIED` |
| **M2** | Gross exposure | Full charge amount on every red row | Shown beside M1, never instead of it |
| **M3** | Avoidable waste | Whole fee on F3-avoidable, F4, F5 rows | Per the causation ruling |
| **M4** | Recovery rate | Refunds received ÷ refunds due, by month | Measure the **denominator on both sides** — a moving denominator fakes a trend |
| **M5** | Claim ageing | Days from rejection to refund received; unreceived shown as days open | Replaces the unanchored "late" verdict |
| **M6** | Unit price | Amount paid vs the 1073/403 reference (N1), split inside/outside (N3) | **BLOCKED until N3 lands** — without location, the wrong reference gets applied. Do not substitute a population average: that audits the population against itself. Label the reference a *default*, not a tariff |

**Currency** AED throughout, as paid, **no VAT adjustment** — refund lines carry no charge or VAT by
design. **Rounding** 2 dp at row level, never on the total. **Nulls** in any amount make the row
CANDIDATE, never zero. **Division by zero** renders as `—`.

**Tie-out rule.** For any period: *(entry-visa charges, `Added`, guarded)* − *(refund lines matched
to them, both channels)* = *(net entry-visa cost)*, and that figure must reconcile to the
`CATEGORY = 'ENTRY VISA'` total in D10 **once D10's `NATIONALITY != 'Pakistani'` exclusion is added
back**. Any residual gap is itself an exception row, not a rounding note.

**Coverage statement — mandatory on every run.** The report states, in the header and not a
footnote:
1. Charges examined, and the AED they carry.
2. Charges **not** examined and why, each priced: outside the 12-month window · before the F6 floor
   of 2025-06-02 · BLOCKED on N1–N5 · VOID on G2/G4 · the Pakistani-national population that D10
   excludes.
3. That **GREEN means every applicable test ran and passed**, not "audited".

---

## 4. Finalised UI Report

**Layout.** Header KPI strip → coverage bar → exception table → family breakdown. One screen.

**KPI strip.** Recoverable (M1) · Gross exposure (M2) · Avoidable waste (M3) · Recovery rate (M4) ·
Charges examined / total.

**Coverage bar.** A single stacked bar, examined vs each excluded slice, **priced in AED**. This is
the element that stops the report being read as "all clean".

**Exception table.** One row per charge: request id · person id · population (`CONTRACT_TYPE` /
`OWNER_TYPE`) · charge date · amount · family · verdict · recoverable · days open · owner action ·
"what would settle it" for every CANDIDATE.

**Conditional formatting.** Verdict drives the row colour, six states not two. VOID and BLOCKED are
visually distinct from GREEN — never grey-as-good.

**Drill-down.** Opens the charge's timeline: application → rejection revisions (dated, with
modifier) → refund step open/close → refund lines with status → expiry → maid status.

**Provenance line.** Sources and as-of timestamp, displayed, so an auditor can cite the run.

**Export.** CSV at row grain. **Ids, counts and amounts only — no names, no contact details, no
salaries.** `INITIAL_VISA_REQUESTS` carries salary columns; they are never selected.

---

## 5. Worked Examples

*Illustrative, with synthetic ids and amounts — these demonstrate the arithmetic and the verdict
routing. They are **not** measured cases; the discovery battery produces the real ones.*

### A — clean, used
Charge AED 1,022.50 inside-country → immigration `Approved` → change of status → `RVISA_ISSUANCE_DATE`
populated. No refund due. **GREEN**, M1 = 0. Every applicable test ran: used ✓, price band ✓, evidence ✓.

### B — the finding the report exists for: rejected, never claimed
Charge AED 1,054.71 → dated `Rejected` revision → refund step opened and **closed in 26 minutes** →
no refund line anywhere, on the request or on a linked cancel request. Request now closed, so it
will never receive one.
**RED / F1 never-filed.** M1 = expected refundable − 0. M2 = 1,054.71. Remainder = **cost**, not loss
(correct single application). Owner action: *file the claim, or record why it cannot be filed.*

### C — the family the prior check cannot see: approved, expired, unused
Charge AED 372.50 outside-country → `Approved` → `ENTRY_VISA_ISSUANCE_DATE` set →
`ENTRY_VISA_EXPIRY_DATE` passes → the daily job stops the request, opens an IMMIGRATION cancel
request, sets the maid `VISA_UNSUCCESSFUL`. **No expense, no refund, no write-off is written.**
Never rejected, so a rejection-keyed population never sees it.
**RED / F3.** M3 = 372.50 if avoidable. Owner action: *explain, and fix whatever let the permit lapse.*

### D — contradiction, not clearance
`refundedStatus = Refunded`, request reads finished — and the `REFUND_FOR_ENTRY_VISA` line of −739.50
is **still `Pending` 297 days later**.
**RED / F2**, and the case that proves why a check gating on `refundedStatus` clears a real loss.
M5 = 297 days open.

### E — the trap: not a duplicate
Two identical AED 1,022.50 charges 32 days apart, and the request carries **zero** `Rejected` rows in
history — so a naive no-rejection-between test calls it a duplicate. But an `Added` refund of −739.50
sits between them: this is an ordinary reject → refund → re-charge cycle, and the rejection history
has a **false negative**.
**GREEN under F4** by the *"no `Added` refund between"* exclusion, and G5 records the history false
negative. Without that second exclusion this reports as a duplicate and is wrong.

### F — pair grain and charge grain on one request
Outside 372.50 → rejected → refunded 89.50 same day → re-applied inside 1,022.50 → `Approved`.
Yields **two clean charge-grain rows** and **one RED pair-grain row (F5)**: waste =
372.50 − 89.50 = **AED 283.00**. G3 collapses to one verdict per charge before totalling.
Remainder here is **loss**, not cost — we paid two different price points.

---

## 6. What is blocked, and on whom

| Blocker | Effect | Needs |
| --- | --- | --- |
| **No Snowflake warehouse grant on this role** | Zero rows read. Every population and amount in this spec is absent, not zero | Run `ENTRY-VISA-DISCOVERY.sql`, or grant warehouse usage |
| N3 — inside/outside location | **M6 BLOCKED**; the unit-price control cannot pick the right reference | ERP ingestion of the location picklist join (no flag exists to copy) |
| N2 — threshold history | **G1 BLOCKED**; pre-VPM-8872 charges inherit BLOCKED | ERP ingestion |
| N4 — `refundedStatus` | **F2 BLOCKED** | ERP ingestion |
| Expected refundable reference | M1 computed from observed modes and marked `UNVERIFIED` | Visa team, or a government schedule |
| D10 Pakistani-national exclusion | Tie-out cannot close until priced | One query, Q7 |

**Nothing above may be defaulted quietly.** A BLOCKED test is not a pass.
