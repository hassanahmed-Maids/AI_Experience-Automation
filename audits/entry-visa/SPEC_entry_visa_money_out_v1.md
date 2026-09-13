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
populated, fresh, or at the cardinality assumed** — and the `IS_DELETED` episode below proves the
profiled comments can be wrong about values, not merely incomplete. `ENTRY-VISA-DISCOVERY.sql` closes
that gap; until it runs, treat every population figure in this spec as absent rather than zero.

**Partially closed 2026-09-13:** a first run measured the ledger's volumes and value ranges (the ✅
items under *Data hygiene*). The population, rejection, expiry and coverage queries have **not** run
yet, so every finding-family count and every AED figure in this spec and its mockup remains an
example.

| # | Data point | Table | Column | Notes |
| --- | --- | --- | --- | --- |
| D1 | The charge | `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | `PURPOSE`, `AMOUNT`, `STATUS`, `CREATION_DATE` | Grain: one row per expense line across new/renew/cancel, `UNION ALL`, no dedup. `ID` is a `ROW_NUMBER()` surrogate — **never a business key** |
| D2 | The refund | same | `PURPOSE = 'REFUND_FOR_ENTRY_VISA'` | Booked negative by the code's sign flip; may sit on a **cancel** request |
| D3 | Payment evidence | same | `TRANSACTION_ID`, `REFERENCE_NUMBER`, `PAYMENT_TYPE`, `BUCKET`, `PAYMENT_DATE` | `PAYMENT_DATE` carries a sentinel `0025-11-06`; filter `> '1900-01-01'`. `REFERENCE_NUMBER` is Qashio or Noqodi depending on portal |
| D4 | Population dimensions | same | `CONTRACT_TYPE`, `OWNER_TYPE`, `EMPLOYEE_TYPE`, `OWNER_ID` | `CONTRACT_TYPE` values carry a **trailing space** (`'CC '`, `'MV '`) — `TRIM` before comparing |
| D5 | Request header | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS` | `REQUEST_STATUS`, `STOPPED_COMPLETED_DATE`, `ENTRY_VISA_APPLICATION_DATE`, `ENTRY_VISA_ISSUANCE_DATE`, `ENTRY_VISA_EXPIRY_DATE`, `ENTRY_VISA_PERMIT_NUMBER`, `PROBLEM_OF_ENTRY_VISA`, `RVISA_ISSUANCE_DATE` | `REQUEST_STATUS ∈ {ONGOING, COMPLETED, STOPPED}` |
| D6 | Dated rejection | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY` | `ENTRY_VISA_IMMIGRATION_APPROVED` + `_MODIFIED`, `LAST_MODIFICATION_DATE`, `LAST_MODIFIER` | Revision rows. ✅ `_MODIFIED` is **NUMBER(18,5), never NULL** — filter `= 1`; `IS NOT NULL` is a no-op and reads carried-forward state as change events. ⚠️ **Not sufficient alone** — see G5: it misses 196 of 868 rejected requests, and records nothing between 2019-04 and 2025-09 |
| D7 | Step timing & rework | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_TASKS` | `TASK_NAME`, `STEP_STATUS`, `STARTED_AT`, `COMPLETED_AT`, `ITERATION`, `MOVE_OUT_DATE_SET_BY` | `ITERATION` is the ERP's own re-entry count for a step — a re-application counter that needs no expense join |
| D8 | Unbooked payments | `BA_VIEWS.VISA_SILVER.MISSING_EXPENSES` | `MISSING_EXPENSE_NAME = 'ENTRY_VSIA_OR_ENTRY_VISA_LESS_THAN_1000'`, `MOVE_OUT_FROM_MISSING_EXPENSES_STEP` | ERP's own detector: step done, no expense row. **Earliest row 2025-06-02** — hard floor on F6 |
| D9 | Arrival / outcome | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_STATUS_LOGS` | `HOUSEMAID_ID`, `TO_STATUS`, `CHANGE_DATE`, `NEXT_CHANGE_DATE` | Interval table — as-of reads are plain containment. `LANDED_IN_DUBAI`, `VISA_UNSUCCESSFUL`, `NO_SHOW` are the outcome vocabulary |
| D10 | Company's own loss view | `BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES` | `CATEGORY='ENTRY VISA'`, `SUB_CATEGORY`, `EXPENSES_TYPE`, `EXPENSES_AMOUNT` | **Reconciliation target, not a population.** Carries a `NATIONALITY != 'Pakistani'` exclusion |

**Join keys.** `VISAREQUESTEXPENSES.VISA_REQUEST_ID` = `INITIAL_VISA_REQUESTS.REQUEST_ID` =
`INITIAL_VISA_REQUESTS_HISTORY.REQUEST_ID` = `INITIAL_VISA_REQUESTS_TASKS.VISA_REQUEST_ID`, all
`NUMBER`. Person: `VISAREQUESTEXPENSES.OWNER_ID` = `HOUSEMAIDS_INFO.ID` **only when
`OWNER_TYPE = 'HOUSEMAID'`** — office-staff ids come from a different table and will silently
mis-join if `OWNER_TYPE` is not carried through every join.

**Data hygiene.** Items marked ✅ were **measured on 2026-09-13**; the rest are still profile-only.

- ✅ `AMOUNT` maximum is genuinely **19,711,606,003,430** — range-guard before any `SUM`. But
  **all 6 out-of-range rows sit outside the entry-visa population** (`purpose_and_amount` equals
  `purpose_only` at 62,466), so for this audit the VOID-on-amount bucket is **empty**, and the
  coverage bar must say so rather than reserve a slice for it.
- ✅ `AMOUNT` minimum is **−1,022.50** — refunds and corrections share the column. No NULLs:
  625,941 rows, 625,941 non-null.
- 🔴 ✅ **`IS_DELETED` does NOT hold `'0'`.** The view's own profiled comment claims it "contains
  only '0' … a `WHERE IS_DELETED = '0'` filter is safe but redundant". **That comment is wrong about
  the value**: the predicate matched **0 of 625,941 rows** and silently emptied the entire query
  battery on first run. The predicate is **removed, not corrected** — the same comment's other claim,
  that deleted rows are filtered upstream, means there is nothing for it to do. *This is the spec's
  own worked example of taking a column's meaning from its documentation instead of from a
  `GROUP BY`.* Its actual value is still **`UNVERIFIED`** and no test may depend on it.
- ✅ `PURPOSE` holds **49 distinct values** where the ERP `ExpensePurpose` enum has **52** — the
  warehouse enum is shorter than the source enum, so a purpose absent from the warehouse is not
  proof it is unused. One row carries an **empty-string** purpose: read purpose with exact equality,
  and `NULLIF(TRIM(PURPOSE),'')` anywhere it is treated as free text.
- ✅ Entry-visa volume: **62,466** charge lines — `ENTRY_VSIA` **57,396** and
  `ENTRY_VISA_LESS_THAN_1000` **5,070**, i.e. the sub-threshold code is only **8.1%** of them.
  `REFUND_FOR_ENTRY_VISA` totals **1,598** lines across all time.
- `STATUS` is the *expense-row* lifecycle (`Added`/`Dismissed`/`Pending`), **not** the request
  workflow. `CONTRACT_TYPE` has trailing spaces. `PAYMENT_DATE` has a year-25 sentinel.

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

### The verdict model — seven values

**A charge is GREEN only when every applicable test ran and passed.** One RED outweighs any number
of GREENs; **one BLOCKED does too**. Verdicts are assigned **per test**, then rolled to the charge by
severity (G3) — a charge is never given a verdict a test did not produce.

| Verdict | Meaning | Counts as clean? |
| --- | --- | --- |
| **GREEN** | The test ran on this charge and passed | Yes |
| **RED** | A finding — money out, not recovered, not explained | No |
| **CANDIDATE** | Looks red, but one named fact would settle it. The row states which | No |
| **NOT_APPLICABLE** | The test's precondition is absent, so there is nothing to test — e.g. an expiry test on a charge that was never approved | Neutral: excluded from both numerator and denominator, and **reported with its count** |
| **VOID** | The test could not be trusted — a positive control failed, or a source column is unpopulated | **No** |
| **BLOCKED** | A required input is unavailable (N1–N5 not ingested, or no date to measure from) | **No** |
| **REPORTED** | Already raised and owned; excluded from new-finding totals, kept in coverage | Neutral |

🔴 **NOT_APPLICABLE exists because without it "the test did not fire" collapses into "the charge
passed".** Every family below therefore states all four outcomes, not just its RED condition.

---

### G — Guards that run before any family

- **G0 · No predicate without a `GROUP BY` behind it.** Every equality filter on a status, flag or
  enum column must be justified by a distribution query showing the value exists, and that query
  belongs in the battery (`QG`). A filter's job is to exclude; a filter that excludes everything
  returns a clean-looking empty result. **Earned three times over on this one view:** `IS_DELETED`
  did not hold the documented value, `_MODIFIED` did not hold the documented type, and the rejection
  enum held a tenth value no metadata listed.
- **G1 · Threshold dating guard.** ✅ **Measured and confirmed.** The reclassification shipped
  **July 2025** and was **not backfilled**: `ENTRY_VISA_LESS_THAN_1000` has **zero** rows before
  2025-07-07. Pre-boundary, **15,254 charges (AED 5,951,645)** carry `ENTRY_VSIA` at ≤1000 purely
  because the rule did not yet exist — a **dating artefact, reported as a data note, never a
  finding**. Post-boundary the rule holds at 99.7%; the **40 exceptions (AED 18,937)** are
  CANDIDATE, not RED, with a named hypothesis: the reclassification runs **on save**, so an amount
  edited downward afterwards keeps its original purpose. The single reverse case (AED 1,022.50 under
  the sub-threshold code, 2026-06-15) is evidence the **threshold parameter has changed at least
  once** since July 2025 — which is exactly why N2 (its value history) is required before this guard
  can be called closed.
- **G2 · Amount sanity.** `AMOUNT` is **FLOAT**; cast to `NUMBER(18,2)` before grouping, banding or
  summing. Range `-50,000 … 50,000`; anything outside is **VOID** with its own count and total.
  ✅ **Measured: no entry-visa line falls outside**, and none is NULL. The bucket is empty — report
  it as zero, do not omit it, and keep the guard as a tripwire.
- **G3 · One verdict per charge, by this severity order.** Pair-grain families collapse to charge
  grain **before** any sum. The order is fixed, highest first, and is "whole fee lost" before
  "part of fee lost" before "no money at stake":
  **F4 → F3(avoidable) → F5 → F10 → F1 → F2 → F3(unavoidable) → F8 → F9 → F6b → F6 → F7.**
  A charge carrying both an F4 and an F1 verdict counts once, at F4, and its amount enters M3 not M1.
- **G4 · Positive controls.** Two, and both must pass before F3 reports a number.
  - *Arrival source* — ✅ **PASSED**: `HOUSEMAID_STATUS_LOGS` carries `LANDED_IN_DUBAI` 43,505 ·
    `VISA_UNSUCCESSFUL` 52,266 · `NO_SHOW` 76,933, all current to 2026-09-13.
  - *Date population* — ✅ **PASSED, after the control itself was corrected.** The first run measured
    against all 37,867 requests created in the window and read **34.1%**, under my 50% bar. That
    denominator was wrong: it counted every request that never reached the entry-visa step. Measured
    against **requests that actually paid** (Q6c): **13,882 paying requests, 13,367 with an issuance
    date (96.3%) and 13,363 with an expiry date (96.3%)**. The columns are healthy; my control was
    not. **F3 is no longer VOID.**
    *Carried as a standing lesson: a positive control is only as good as its denominator, and a
    control measured against the wrong population must be re-run, never re-interpreted.*
    Also from Q6c: **12,344 of 13,882 paying requests (88.9%) reached a residence visa**, so
    **1,538** did not — the in-window ceiling for F3 and F10 combined.

- **G5 · Point-in-time — read BOTH rejection sources and union them.** *(Corrected by measurement;
  the table, the 868-request union and the provenance split are in §2.1's D6 note and the guard
  block that follows it.)*
- **G5e · A fourth floor: step history begins 2019-04-02.** ✅ **Confirmed by year (Q9d), and it is
  an ingestion boundary, not behaviour:**

  | first charge | requests | with no step history | AED |
  | --- | --- | --- | --- |
  | 2017 | 604 | **100.0%** | 342,951 |
  | 2018 | 2,936 | **100.0%** | 1,416,241 |
  | 2019 | 3,655 | **27.9%** | 660,181 |
  | 2020–2022 | 9,465 | **0.0%** | 0 |
  | 2023–2026 | 43,969 | **0.0%** (5 rows) | 2,513 |

  A clean step: total absence before 2019, a partial year consistent with an April cutover, then
  effectively complete. Any test joining a charge to its workflow steps is therefore **BLOCKED
  before 2019-04-02**, never clean. The *boundary* is measured; the *cause* — that the legacy
  rejection codes stop on the same day, implying one migration — remains `UNVERIFIED` against the
  code, and nothing depends on it.

### F6b — Paid, with no application step *(the mirror of F6, and the residual of G5e)*

- ✅ **5 requests, AED 2,513**, paid an entry-visa charge with **no `Apply for entry Visa` step at
  all**, in years where the step history is complete: **1 in 2023, 2 in 2025, 2 in 2026**.
- F6 asks "the step was done — where is the payment?". This asks the reverse: **the payment was
  made — where is the application?** Both are step/expense mismatches; only this one is money
  already out.
- **CANDIDATE**, at request grain. What would settle it: whether the step exists under a different
  task name, or the charge was posted to the wrong request. Tiny money, but it survived a guard that
  removed 4,565 look-alikes, which is exactly what makes it worth a human minute.

- **G6 · Window vs scan window.** The 12-month window is a **reporting** window. F4 and F5 compare
  *pairs of charges*, so a pair straddling the boundary would otherwise never be compared and both
  charges would go GREEN. Those two families therefore **scan the full charge history of any request
  that has a charge inside the window**, and report the pair against the later charge's period.

---

### F0 — No authorised amount exists *(control finding — NO record-grain verdict)*

- **Statement.** The entry-visa fee is typed by an agent and saved unconditionally — no price list,
  no cap, no approval routing. `ENTRY_VISA_COST_INSIDE_UAE = 900` / `_OUTSIDE_UAE = 400` are dead
  code (`getEntryVisaCost()` has zero callers, `@JsonIgnore`); the auto-costing service that used
  them was commented out in 2018. The only live reference is accounting's
  `getDefaultEntryVisaExpenses()` fallback of 1073/403 — ✅ and **the measured modes are 1022.50 and
  372.50**, so even that fallback is stale by ~50 and ~30 AED.
- 🔴 **F0 carries no verdict on any charge.** v1 typed it RED against every charge, which under the
  spec's own algebra ("one RED outweighs any number of GREENs") made GREEN unreachable, turned M2
  into the entire ledger, and contradicted its own clean examples. It is a statement about the
  **system**, not a test at charge grain.
- **Where it appears.** A `control_findings` block in the report header, with the count and value of
  charges it affects. It changes the **interpretation of M6** — it is why M6 is empirical rather than
  authoritative — and the colour of nothing.

---

### F1 — Rejected, refund never recovered

| Outcome | Condition |
| --- | --- |
| **RED** | Charge `Added` with payment evidence, on a request in the G5 rejection union, and no `REFUND_FOR_ENTRY_VISA` line matched to it **on either the new or the cancel leg** |
| **GREEN** | A matched refund line exists at `Added` |
| **CANDIDATE** | The refund line exists but sits at `Pending` or `Dismissed`; or the charge/refund match is ambiguous (>1 candidate) |
| **NOT_APPLICABLE** | The request is not in the rejection union — nothing was rejected, so no refund was ever due |
| **BLOCKED** | Rejection known only from the live column (**196 requests**, undated): refund-existence can be tested, **ordering and ageing cannot**. Also every charge before **2025-09-05**, per G5b |

- **Split by owner, because the action differs.** *Never filed* (no refund line) · *Filed and stuck*
  (line at `Pending`) · *Filed and withdrawn* (line `Dismissed`).
- ✅ **The cancel leg is material: 160 of 788 refunds (20%) sit on it.** Matching within one
  `VISA_REQUEST_ID` under-counts recoveries by a fifth.
- 🔴 **`refundedStatus` never clears a row.** It is a user-typed form field. Where it says
  *Refunded* and the ledger disagrees, that is **F2**, not a clearance.

### F2 — The claim says refunded, the ledger does not

| Outcome | Condition |
| --- | --- |
| **RED** | `refundedStatus = true` (N4) and no matched `Added` refund; **or** a refund line open longer than the ageing threshold |
| **CANDIDATE** | Refund line at `Pending` within the threshold |
| **NOT_APPLICABLE** | `refundedStatus` is false or unset and no refund line exists — F1's territory, not F2's |
| **BLOCKED** | N4 not ingested. **Currently the whole family**, since `refundedStatus` is not in the warehouse |

- 🔴 **Ageing threshold corrected from 95 days to 7 — I was measuring the wrong clock.** 95 days was
  the slowest *workflow step* to close, but the step can stay open long after the money moved. The
  **money** clock is what matters, and R2 measured it: of 556 refunds matched to a dated rejection,
  **547 arrived within 7 days**, 9 more within 30, and **not one ever arrived later than 30**.
- **The operational reality that follows is stark: a refund either happens at the counter within a
  week, or it never happens at all.** There is no long tail to wait on. So the **145 claims currently
  open, averaging 255 days and oldest 582**, are not pending — on this evidence they are dead money,
  and should be reported as findings rather than as work in progress.
- ⚠️ **13 refunds are dated *before* their rejection**, by up to 60 days. Either the rejection date
  is wrong or the refund belongs to an earlier attempt on the same request. **CANDIDATE**, and a
  reason to pair refunds to charges by sequence rather than by request id alone.

### F3 — Paid, approved, expired unused *(the family a rejection-keyed audit cannot see)*

| Outcome | Condition |
| --- | --- |
| **RED** | Permit issued, expiry passed, person never progressed (no residence visa, no `LANDED_IN_DUBAI` inside the permit window), no refund and no write-off |
| **GREEN** | The person progressed, or a refund exists |
| **CANDIDATE** | Expiry passed but the outcome is unresolved — still `ONGOING`, or arrival status silent |
| **NOT_APPLICABLE** | The application was never approved (no issuance date) — there was no permit to waste. **Also every `OWNER_TYPE = 'OFFICE_STAFF'` charge**, see below |
| **VOID** | G4's date-population control fails |
| **BLOCKED** | Issuance/expiry cannot be resolved **per application attempt** (below) |

- 🔴 **Corrected: this family must read issuance and expiry from the history, not the live row.**
  v1 read `ENTRY_VISA_ISSUANCE_DATE` / `ENTRY_VISA_EXPIRY_DATE` off `INITIAL_VISA_REQUESTS` — the
  same live row G5 forbids for rejection, and for the same reason: a request that let permit #1
  expire and then re-applied carries **permit #2's** dates today. The expired-unused test would run
  against the wrong permit and the lost money would vanish. Both columns are carried in
  `INITIAL_VISA_REQUESTS_HISTORY` (`ENTRY_VISA_EXPIRY_DATE` + `_MODIFIED`), so resolve them
  **per attempt, keyed to the charge**, exactly as G5 does for rejection. Where an attempt's dates
  cannot be resolved, the charge is **BLOCKED**, not GREEN.
- 🔴 **Office staff cannot be tested and must be priced, not silently dropped.** The arrival source
  is `HOUSEMAID_STATUS_LOGS`, and `OWNER_TYPE = 'OFFICE_STAFF'` rows have no entry there by
  construction. ✅ **570 charge lines, AED 459,442** — NOT_APPLICABLE with its own coverage line.
- **The split that matters is avoidability**, since the code guarantees no refund is recorded either
  way (`CancelEvisaExpiredMaidsService` writes nothing financial): expired *while still pending
  approval* (recoverable in principle — the company's own view calls this
  *"Should Have Been Refunded"*) vs expired *after approval* (*"Can not be Refunded"*).

### F4 — Paid twice for one entry visa

| Outcome | Condition |
| --- | --- |
| **RED** | Two `Added` charges with payment evidence on one request, **no `Added` refund between them and no rejection between them** |
| **GREEN** | A refund or a rejection sits between the two charges — an ordinary reject → refund → re-charge cycle |
| **CANDIDATE** | The pair falls in a bulk-posting cluster (below), or the charges are same-day and indistinguishable |
| **NOT_APPLICABLE** | The request carries one charge — no pair to test |

- ✅ **Candidate pool measured: 521 requests carry 2+ `Added` charges and zero refunds** (485 with
  two, 32 with three, 3 with four, 1 with twelve), **AED 921,880** charged. That is before the
  rejection and bulk-posting guards — the real finding will be a fraction of it, and this is the
  denominator to report against.
- ✅ **PRIMARY TEST, measured: more paid charges than applications.** `ITERATION` counts re-entries
  to `Apply for entry Visa`. A genuine re-application re-enters the step; **a second charge booked
  against a single step visit is a duplicate with no application behind it.** This test needs **no
  rejection history at all**, which matters because that is exactly where the false negatives are.

  🔴 **It needs one guard, and Q9c is why.** The raw result's largest row is **4,520 requests with
  one charge and *zero* step visits, AED 2,371,063** — which is not a duplicate at all. The task
  history (`workflowtaskhistorys`) begins **2019-04-02** while charges begin **2017-06-21**, so
  roughly two years of charges have no step rows to compare against. Those requests are **BLOCKED,
  never RED**: absence of a step there is absence of *recording*. Without the guard this test would
  have published AED 2.37m of "duplicates" that are an ingestion boundary.

  ✅ **With `step_visits ≥ 1` enforced, the population is:**

  | | requests | AED |
  | --- | --- | --- |
  | More charges than applications, **and no refund at all** → RED pool | **415** | **760,338** |
  | More charges than applications, some refund taken → CANDIDATE | 86 | 156,849 |
  | **Total excess-charge requests** | **501** | **917,187** |
  | Excluded by the guard — no step history (pre-2019-04-02) | 4,565 | 2,421,886 |

  The 415 are the tightest duplicate-payment evidence in this audit: more money posted than
  applications made, and nothing given back. Cross-check against the older test — 521 requests with
  2+ charges and no refund — and adjudicate the overlap at G3.
- **Bulk-posting cluster, provisional: ≥5 candidate pairs sharing one charge date** is treated as
  **one posting event**, CANDIDATE, not N findings. The number is provisional pending the date
  distribution (`Q4b`) and is flagged as such rather than presented as settled.
- ✅ **One request carries 12 charges and a NULL `VISA_REQUEST_ID`** — see F8.

### F5 — Paid at two different price points across a rejection

| Outcome | Condition |
| --- | --- |
| **RED** | Two charges on one request straddling a rejection, differing by **more than AED 500** |
| **GREEN** | Amounts within AED 500 — a re-charge at the same price band |
| **CANDIDATE** | A rejection is known but undated (G5's live-only 196), so "straddling" cannot be established |
| **NOT_APPLICABLE** | One charge, or no rejection |

- **"Materially different" is AED 500**, set from the measured distribution, not asserted: within a
  band the spread is at most **AED 32.21** (1022.50 / 1025.65 / 1054.71, and 372.50 / 375.65 /
  384.24), while the gap between bands is about **AED 650**. AED 500 separates the two cleanly and
  cannot fire on intra-band variation.
- **Renamed from "wrong entry-visa type submitted"**, which describes an action the system does not
  permit — the agent chooses an amount and the code derives the purpose.

### F6 — The step was done and no payment was booked

| Outcome | Condition |
| --- | --- |
| **CANDIDATE** | `MISSING_EXPENSES` flags the `Apply for entry Visa` step complete with no entry-visa expense |
| **NOT_APPLICABLE** | The step is not complete, or an expense exists |
| **BLOCKED** | Anything before **2026-06-10**, the earliest row the detector holds for this expense name |

- ✅ **Measured: 8 cases** (7 MV, 1 CC), 2026-06-10 → 2026-09-12. Small, and **never RED on its own**
  — it means either an unbooked government payment or a step closed without doing it, and only a
  human can say which. It carries **no AED claim** until that is settled.
- ⚠️ `STEP_STATUS` evaluates **SNOOZED → EXCLUDED → COMPLETED**, so a completed step that is snoozed
  or RPA-excluded never reads `COMPLETED` and this detector under-counts. ✅ **49 entry-visa steps
  are `EXCLUDED`** — the audited system's own exclusion flag, which this audit must not inherit
  silently: it is a coverage line.

### F7 — Charges stranded at `Pending` *(hygiene — no AED claim)*

| Outcome | Condition |
| --- | --- |
| **CANDIDATE** | Charge at `Pending` older than 95 days (F2's threshold) |
| **NOT_APPLICABLE** | Charge is `Added` or `Dismissed` |

- 🔴 **Re-cut from "paid with no evidence of payment", which has no population.** ✅ Measured: of
  14,308 `Added` entry-visa charges in the window, **`TRANSACTION_ID` is NULL on zero and
  `REFERENCE_NUMBER` is blank on zero.** Every posted charge is evidenced.
- ✅ What remains is **234 charges at `Pending`, AED 156,045** — and **every one has no
  transaction**, which means they are **unposted lines, not unrecovered payments**. Reporting them
  as exposure would overstate by AED 156,045. They are a process-hygiene queue with a **count and an
  age, and deliberately no money figure**.
- This is also what justifies every money family scoping to `STATUS = 'Added'`: the exclusion is
  evidenced, not assumed.

### F8 — Spend attached to no request and no person *(new, from the first run)*

- ✅ **12 entry-visa charge lines, AED 7,516, with a NULL `VISA_REQUEST_ID` and a NULL `OWNER_ID`**
  (2017-08-13 → 2017-11-20). Unattributable spend: no case, no person, no owner to ask.
- **RED** on existence; **BLOCKED** on cause, since there is nothing to join to. Reported at
  cohort grain, not charge grain.

### F9 — Refund amounts booked as charges *(new, from the first run)*

- ✅ **31 charges sit at exactly the two known refund values: 20 at AED 89.50 and 11 at AED 739.50**
  (Q1c bands `a` and `c` reconcile exactly: 20 × 89.50 = 1,790 and 11 × 739.50 = 8,134.50).
- **The mechanism is in the code.** `addExpense` sign-flips to a credit **only** when the purpose is
  `REFUND_FOR_ENTRY_VISA`. Choose the wrong purpose and a refund books as an **additional cost**
  instead of a credit — so each instance swings the ledger by twice its value.
- ✅ **Sharpened by R5, and it is one person.** All **31** were created by a **single user account**,
  across **22 distinct days**, every one carrying a real transaction — and **26 of the 31 are in
  2026**, so it is current, not historical. A repeated habit by one operator is a training and
  supervision matter, not a systemic defect. **Report the count and the pattern to that person's
  manager; never name them in the report** (see §4's blocklist).
- ✅ **The 75 zero-value charges drop out of the money families entirely**: none of them is `Added`.
  They sit at `Pending` or `Dismissed`, so they are unposted lines, not payments. Moved to F7.
- Corroboration from R1: the same two values appear as **refunds of exactly themselves**
  (89.50 → 89.50 on 19 pairs, 739.50 → 739.50 on 13), which is what a miskeyed refund followed by a
  correcting entry looks like.

### F10 — Approved, then cancelled *(added after Q7 — the largest bucket, and v1 missed it)*

| Outcome | Condition |
| --- | --- |
| **RED** | Entry visa paid and approved, then the case was cancelled, with no refund recorded |
| **GREEN** | A refund line exists |
| **CANDIDATE** | Cancelled for a reason that may make the fee recoverable — the cancellation-type split below |
| **NOT_APPLICABLE** | Never approved (F1's territory), or approved and used |
| **BLOCKED** | Before **2024-02-06**, the earliest refund row the company's own view holds |

✅ **R3 measured the recovery rate on this family, and it is essentially nil: of 5,747
approved-then-cancelled requests, 5,721 have no refund ever recorded and 26 do — 0.45%.**
Those 26 are the important number, not the 5,721: they prove recovery is **possible**. The question
for the business is therefore not "is this recoverable?" but **"what did those 26 cases do that the
other 5,721 did not?"** Given F0b — no owner, no alert, no obligation to record an outcome — the
likeliest answer is that someone happened to be standing there.

🔴 **v1's F3 covered only *expired* permits. The company's own taxonomy has three terminal states —
not approved, cancelled, expired — and the one I missed is the biggest.** ✅ Measured from
`LOST_VISA_EXPENSES` (all time, and note it excludes Pakistani nationals):

| Sub-category | Expense type | rows | AED |
| --- | --- | --- | --- |
| Canceled E-Visas | **Approved and Canceled Entry Visas** | **5,747** | **3,454,994** |
| Not Approved | Not Approved (Pending Approval or Rejected) | 1,073 | 672,879 |
| Canceled E-Visas | Visa Cancellation Fees (125 AED) | 3,740 | 519,184 |
| Expired | **Expired & Pending Approval (Should Have Been Refunded)** | 444 | **329,107** |
| Expired | Expired & Approved (Can not be Refunded) | 18 | 11,908 |
| Not Approved | Refunded Not Approved Entry Visas | 578 | **−254,762** |
| | **Net already booked as lost entry-visa expense** | | **≈ 4,733,310** |

Reads that change the spec:

- **Approved-and-cancelled is AED 3.45m, 73% of the company's own entry-visa loss book**, and v1 had
  no family for it. It is now F10.
- **`Expired & Pending Approval (Should Have Been Refunded)` — 444 cases, AED 329,107 — is the
  company naming its own unclaimed refunds.** That is F3's recoverable core, already quantified by
  someone else. ⚠️ But that view derives expiry from the **live request row**, so it inherits the
  exact defect F3 was corrected for: on a request that re-applied, it reads permit #2's dates.
  **Treat the 444 as a reconciliation target, not as a verified count**, and expect our per-attempt
  figure to differ.
- **A third floor, and the tightest one: refunds are only recorded from 2024-02-06.**
  `Refunded Not Approved Entry Visas` has no row before it. So refund-recovery tests are
  **BLOCKED before 2024-02**, independently of the 2025-09-05 rejection floor.
- `Visa Cancellation Fees (125 AED)` averages **AED 138.80**, not 125. The label and the data
  disagree; flagged, not adjudicated.

---

### The refund tariff — SOLVED from the data, 2026-09-13

v1 said no expected-refundable reference existed and blocked M1 on it. **It does exist; it was just
never written down.** Pairing every paid charge with the refund that followed it (R1) gives a rule so
clean it can only be the government's own:

| charge paid | refund returned | **kept by the government** | pairs |
| --- | --- | --- | --- |
| 1,022.50 | 739.50 | **283.00** | 1,537 |
| 372.50 | 89.50 | **283.00** | 362 |
| 1,054.71 | 739.50 | 315.21 | 69 |
| 384.24 | 89.50 | 294.74 | 37 |
| 1,025.65 | 739.50 | 286.15 | 9 |
| 375.65 | 89.50 | 286.15 | 2 |

> ### The government keeps a flat **AED 283.00**, and never returns a surcharge.
> The four "odd" retentions are the same 283 plus the surcharge that was paid on top of the base
> price, to the fils: **1,054.71 − 1,022.50 = 32.21** and **315.21 − 283.00 = 32.21**;
> **384.24 − 372.50 = 11.74** and **294.74 − 283.00 = 11.74**; **1,025.65 − 1,022.50 = 3.15** and
> **286.15 − 283.00 = 3.15**. Four independent confirmations, exact.

**M1 is therefore UNBLOCKED:**

> **expected refund = amount paid − 283.00 − (amount paid − base price of its band)**
> where the base prices are the measured modes, **1,022.50** and **372.50**.

**This also settles the remainder ruling with evidence rather than inference.** The non-refundable
part is a **fixed government retention of AED 283**, not a percentage and not a penalty — it is
identical on the large and the small application. So:

| Situation | Remainder is | Now because |
| --- | --- | --- |
| Correct single application, immigration rejected it | **Cost** | AED 283 is the government's standing fee for considering an application. Unavoidable |
| We caused the waste — F4, F5, F3-avoidable | **Loss — the whole fee** | The 283 was spent on an application that should never have been made |

The prior manual run booked AED 10,215.38 of remainder as loss across 35 cases **that were every one
refunded on time** — roughly 30% of its reported total, and exactly what this rule prevents.

⚠️ **The counts above are pair counts, not case counts.** R1 joins charges to refunds on the request
alone, so a request with two charges and one refund yields two pairs; total pairs (~2,226) exceed the
refund lines that exist. **The mapping is proven; the volumes are not.** `R1b` pairs each refund to
its nearest preceding charge before any AED figure is published.

### F11 — Short refunds and over-refunds *(new, and the prior check said neither existed)*

R1's off-diagonal cells are findings in both directions, and the previous audit reported **zero** of
the first and did not look for the second:

| Shape | pairs | Per case | Reading |
| --- | --- | --- | --- |
| Paid **1,022.50**, got back **89.50** | 89 | **−650.00** vs expected | **Short refund.** Claimed at the small band's value against a large-band charge |
| Paid **1,054.71**, got back **89.50** | 1 | −650.00 | same |
| Paid **372.50**, got back **739.50** | 78 | **+367.00** — refund **exceeds the charge** | **Over-refund.** We received more than we paid. Possibly a liability, not a win |
| Paid **384.24**, got back **739.50** | 1 | +355.26 | same |
| 1,022.50 → **739.57** | 5 | −0.07 | Keystroke |
| 372.50 → **89.00** | 1 | −0.50 | Keystroke |
| 372.50 → **125.65** | 1 | — | 125.65 is the *visa cancellation* fee — wrong purpose entirely |

- **RED** on the two large cells, **CANDIDATE** on the keystroke and wrong-purpose cells.
- Order-of-magnitude only, pending `R1b`: roughly **AED 58,000** under-recovered and **AED 51,000**
  over-recovered. **Do not publish either figure until the pairing is 1:1.**
- The over-refunds matter for a reason beyond money: an audit that reports only under-recovery looks
  like advocacy. Reporting both directions is what makes the number credible.

### F0b — Nobody owns the refund, and nothing ever chases it *(control finding, no record verdict)*

The clearest root cause in this audit. Asked of the code directly, and every answer is negative:

| Question | Answer |
| --- | --- |
| Is anyone assigned the refund step? | **No.** No role, team, user or round-robin. It surfaces in a shared queue filtered by task name — `VisaManualStep.applyTaskListStepFilters` — and whoever pulls it, pulls it |
| Any todo, alert or reminder when it opens, or while it sits? | **None.** `onEntry` only recalculates a priority number |
| Any SLA? | **No** — and pointedly so: the `DELAYED_TODO_THRESHOLD` config is a task-name→hours map, and *"Refund Entry Visa Application" is not in it*. The delayed-todo filter can never flag this step. The only ageing signal is a display-only colour label |
| Must a refund be recorded to complete the step? | **No.** No validation, no `BusinessException`. An operator can close the step whether or not any money came back — and on the non-cancellation path the step *deletes* the pending payment record |
| Is anyone told when an entry visa expires unused? | **No.** `CancelEvisaExpiredMaidsService` stops the request, opens a cancel request and sets the maid `VISA_UNSUCCESSFUL`. No mail, no todo, no complaint, no reminder — a `LOGGER.info` and nothing else |

**This explains the shape of every money family above**: no owner, no deadline, no alert, and no
obligation to record an outcome. ✅ It also explains R2 — refunds either happen at the counter within
a week or never happen at all — and R3, where **5,721 of 5,747** approved-then-cancelled cases have
no refund: nothing exists to tell anyone the money is there.

Like F0, this carries **no record-grain verdict**. It is the reason the findings exist, not a finding
against any charge.

### M — Measures

| ID | Measure | Definition | State |
| --- | --- | --- | --- |
| **M1** | Recoverable | `amount paid − 283.00 − surcharge`, minus refund received | ✅ **UNBLOCKED.** The tariff was solved from the data (above). Legitimate where M6 is not, because a **refund is the government's decision, not ours** — observing what they returned is external evidence, whereas observing what we typed would be the population auditing itself. **Headline once `R1b` gives 1:1 counts** |
| **M2** | Gross exposure | Full charge amount on every RED row | ✅ Computable now. Shown beside M1 |
| **M3** | Avoidable waste | **Whole fee**, on F4, F5 and F3-avoidable rows | ✅ Computable. **One definition only** — v1 also carried "first charge − refund recovered" under F5, which contradicted this and would have given two different totals from one spec. The causation ruling governs: where we caused the waste, none of the fee should have been spent, so the whole fee is the loss |
| **M4** | Recovery rate | Refunds received ÷ refunds **due** | ✅ **UNBLOCKED** — "due" is now computable from the tariff. Measure the denominator on **both** sides of any period comparison; a moving denominator fakes a trend |
| **M5** | Claim ageing | Days from rejection to refund received; unreceived shown as days open | ✅ Computable for the 672 dated cases, **BLOCKED for the 196 undated**. ⚠️ **Threshold corrected to 7 days** — see F2 |
| **M6** | Unit price | Amount paid vs the observed mode for its band | ✅ **Computable, with its limitation stated**: anchored on the measured modes (1022.50 / 372.50), because no authorised price exists (F0). Accounting's 1073/403 default is cited as a **stale comparator**, not a tariff. Still **BLOCKED for the inside/outside split** until N3 lands |

**Currency** AED, as paid, no VAT adjustment. **Rounding** 2 dp at row level, **never inside an
aggregate** — round after summing, not before. **Nulls** in any amount make the row CANDIDATE.
**Division by zero** renders `—`.

**Tie-out rule — restated so it can actually hold.** v1 tied *(charges − refunds)* to
`LOST_VISA_EXPENSES`, which compares a **cost** to a **loss model**: they can never be equal, the
residual is definitional and enormous, and a tie-out that always fails gets switched off. Replace it
with an identity that proves the verdict column is exhaustive:

> **Charges in scope = GREEN + RED + CANDIDATE + NOT_APPLICABLE + VOID + BLOCKED + REPORTED**,
> in both count and AED. Any charge in none of these is a build defect, not a rounding note.

`LOST_VISA_EXPENSES` becomes a **reconciliation note with a named variance**, not a tie-out — and
its exclusion is now priced from the ledger rather than from inside the view, which cannot see what
it removed: ✅ **411 charge lines, AED 418,717 for Pakistani nationals.**

**Coverage statement — mandatory, in the header, not a footnote.** ✅ Measured for the 12-month
window:

| Slice | lines | AED |
| --- | --- | --- |
| Inside the window — examined | **14,653** | **12,321,981** |
| Older than the window | **47,815** | **39,102,016** |
| VOID on amount | **0** | **0** |
| Office staff — F3 NOT_APPLICABLE | 570 | 459,442 |
| Pakistani cohort — excluded by `LOST_VISA_EXPENSES`, priced here | 411 | 418,717 |
| RPA-`EXCLUDED` entry-visa steps | 49 steps | — |
| Before the F6 detector floor (2026-06-10) | — | BLOCKED |
| Before the G5b history floor (2025-09-05) | — | BLOCKED for rejection-keyed families |

🔴 **The window examines 23% of all-time entry-visa lines.** AED 39.1m sits outside it — priced, not
silent. And **GREEN means every applicable test ran and passed**, not "audited".

---

## 4. Finalised UI Report

**Layout.** Header KPI strip → `control_findings` block (F0) → coverage bar → exception table →
family breakdown. One screen.

**KPI strip.** Gross exposure (M2, headline for v1) · Avoidable waste (M3) · Charges examined /
total · Claims open past 95 days. **M1 and M4 appear only once unblocked**, and a blocked measure is
shown as a blocked tile with its reason, never omitted and never zero.

**Coverage bar.** One stacked bar, examined vs each excluded slice, **priced in AED**, from the table
above. This is the element that stops the report reading as "all clean".

**Exception table.** One row per charge: request id · person id · population (`CONTRACT_TYPE` /
`OWNER_TYPE`) · charge date · amount · family · verdict · recoverable · days open · owner action ·
"what would settle it" on every CANDIDATE · "what is missing" on every BLOCKED.

**Conditional formatting.** Verdict drives the row colour across **seven** states. VOID, BLOCKED and
NOT_APPLICABLE are each visually distinct from GREEN — never grey-as-good.

**Drill-down.** The charge's timeline: application → rejection events (dated where the history has
them, marked *undated* where only the live column does) → refund step open/close → refund lines with
status → expiry → outcome.

🔴 **No personal data is rendered or exported, and that constrains the drill-down.** v1's drill-down
showed rejection revisions "with modifier" — those are staff **names**, attached to cases the report
frames as wrongdoing. Provenance is carried as **numeric user ids** for routing only. The following
are **blocklisted from every surface**: `EMPLOYEE_NAME`, `CREATOR_NAME`, `LAST_MODIFIER_NAME`,
`MOVE_OUT_DATE_SET_BY`, `CREATOR`/`LAST_MODIFIER` name resolutions, and `DESCRIPTION` — which
concatenates a **passport number** for housemaid rows. Payment buckets are reported as *"a named
Visa-team card"* with its last four digits, never the cardholder.

**Provenance line.** Sources and the as-of timestamp, displayed. ⚠️ **The ledger is live** — the
entry-visa line count moved between two runs an hour apart on 2026-09-13 — so every tie-out is
as-of, and two figures from different runs do not reconcile by construction.

**Export.** CSV at row grain: ids, counts, amounts, verdicts. Nothing from the blocklist.

---

## 5. Worked Examples

*Synthetic ids; amounts use the measured modes. Six examples covering **all seven verdicts**, because
v1 showed only GREEN and RED and so demonstrated nothing landing outside the clean count.*

### A — GREEN, used
Charge AED 1,022.50 → immigration `Approved` → residence visa issued. **GREEN.**
Tests that ran: refund-due (NOT_APPLICABLE — never rejected), expiry (NOT_APPLICABLE — progressed),
duplicate (NOT_APPLICABLE — single charge), unit price (GREEN — on the measured mode).
*v1 claimed this case GREEN partly on "price band ✓" and "inside-country", both of which the spec
itself marks blocked. Corrected: the verdict stands on tests that can actually run.*

### B — RED, rejected and never claimed
Charge AED 1,054.71 → dated `Rejected` revision → refund step opened and closed in 26 minutes → no
refund line on the new **or** cancel leg. Request now closed, so it never will receive one.
**RED / F1 never-filed.** M2 = 1,054.71. M1 **BLOCKED** (no expected-refundable reference).
Remainder is **cost**, not loss — a correct single application. Action: *file the claim, or record
why it cannot be.*

### C — RED, approved then expired unused
Charge AED 372.50 → `Approved` → permit issued → expiry passed → never landed. The daily job stopped
the request, opened an IMMIGRATION cancel request and set the maid `VISA_UNSUCCESSFUL`, **writing no
expense, refund or write-off**. Never rejected, so a rejection-keyed population never sees it.
**RED / F3.** M3 = 372.50 if avoidable. Dates resolved **per attempt from the history**, not from the
live row.

### D — BLOCKED, not green
Same shape as B, but the rejection is known **only from the live column** — one of the 196 with no
history event. Refund-existence can be tested; **ordering and ageing cannot**.
**BLOCKED / F1.** Shown as blocked with "no dated rejection", counted in coverage, **not in the clean
total**. Action: *none available until the date is recoverable.*

### E — GREEN, the trap
Two identical AED 1,022.50 charges 32 days apart, and the request carries **no rejection row in
history** — so a naive no-rejection-between test calls it a duplicate. But an `Added` refund of
−739.50 sits between them: an ordinary reject → refund → re-charge cycle, and the history has a
false negative.
**GREEN under F4** by the *"no `Added` refund between"* exclusion. Without that second exclusion this
reports as a duplicate and is wrong.

### F — one request, three verdicts
Outside 372.50 → rejected → refunded 89.50 same day → re-applied inside 1,022.50 → `Approved`.
Two **GREEN** charge-grain rows, plus one **RED** pair-grain row at F5: the amounts differ by
AED 650, over the 500 threshold. **M3 = the whole first fee, 372.50**, per the causation ruling —
*not* 372.50 − 89.50, which was v1's contradictory second definition of M3. G3 collapses to one
verdict per charge before totalling.

### G — VOID
An F3 run where Q6 shows `ENTRY_VISA_ISSUANCE_DATE` populated on under 50% of in-window requests.
**VOID, not zero.** The family reports no count at all, states that its positive control failed, and
the charges it would have covered are priced in coverage. *A test that could not run is never a pass.*

---

## 6. What is blocked, and on whom

| Blocker | Effect | Needs |
| --- | --- | --- |
| **Expected-refundable reference** | **M1 and M4 BLOCKED**; M2 is the v1 headline | Visa team, or a government schedule. Not derivable from our own data |
| N3 — inside/outside location | **M6's band split BLOCKED** | ERP: location is computed, never stored. Ingest `new_request.location_id` → `picklist_item.name`, and `office_staff.location_enum` |
| N4 — `refundedStatus` | **F2 BLOCKED entirely** | ERP ingestion |
| N2 — threshold value history | **G1 not closeable**; the 2026-06-15 reverse case is evidence it has changed | ERP Setup parameter history |
| Per-attempt issuance/expiry | **F3 BLOCKED** where the history cannot resolve them | Query work on `INITIAL_VISA_REQUESTS_HISTORY`; no new source needed |
| NewRequest ↔ CancelRequest link | F1's cancel-leg match has **no defined key** | Ask the code which column links them (`CancelRequestController.addExpense`). Until then, match by owner + date window and **publish the match rate with a floor** |
| G4 date-population control | **F3 VOID.** Q6 ran against the wrong denominator; the control has not been passed | `Q6c` — one query |
| Refund-recording floor 2024-02-06 | Refund-recovery tests **BLOCKED** before it | Nothing recoverable — state it |
| — | *(closed)* F4's primary test is measured and its guard confirmed | — |
| Legacy `0`/`1` meaning | Only matters for a backfill before 2025-09-05 | Ask the code |
| History blackout 2019-04 → 2025-09 | Rejection-keyed families **BLOCKED**, not clean, in that range | Nothing recoverable — state it |

**Nothing above may be defaulted quietly. A BLOCKED test is not a pass.**

⚠️ **Two joins must carry `REQUEST_TYPE`.** `VISA_REQUEST_ID` is drawn from `newrequestexpenses`,
`renewrequestexpenses` **or** `cancelrequestexpenses` depending on the leg, so the id namespace is
per-leg: a CancelRequest expense with id 5000 joins cleanly to an unrelated NewRequest 5000. Every
join to a request header is qualified by `REQUEST_TYPE`, and F1 — which deliberately reaches across
legs — matches on the linking column above, never on a bare id.
