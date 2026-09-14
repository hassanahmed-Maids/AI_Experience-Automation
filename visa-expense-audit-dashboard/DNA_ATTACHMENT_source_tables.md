# Source tables — every object the build reads, and every column it reads from it

Attachment to the DNA ticket pack for the **consolidated visa expense audit dashboard**.
Companion to `DESIGN.md` (start there) and `DNA_ATTACHMENT_verification_queries.md`.

Owner: Hassan Ahmed, Police & Control · Drafted 2026-09-14

---

## What this is, and what it is not

This is the **read register**: for each object the seven audits touch, the columns actually read,
what each is used for, and the trap attached to it where one was measured.

Three things to know before using it:

1. **Everything under `BA_VIEWS` is read-only.** The build never writes to it. The only two
   writable objects in the whole design are `T_CASE_REVIEW` and `T_VERIFIER_VERDICT`, both in
   the new `POLICE_CONTROL.VISA_AUDIT` schema, and both listed at the end.
2. **Column names came from the specs' own discovery runs** — each one was named in a query that
   returned a measured figure. None was invented. But this register was **assembled from those
   specs, not re-profiled against the warehouse in one pass**, so treat the first build run as the
   confirmation. `DNA_ATTACHMENT_verification_queries.md` §1 is the guard set that confirms it.
3. **A column marked `PREDICATE ONLY` is read to compute and never projected.** Not into a view,
   not into an export, not into a chat reply or an email. This is enforced by column name, not by
   intent — see the register at the end for why.

### Notation

| Mark | Meaning |
|---|---|
| 🔴 | Getting this wrong produces a wrong number silently — no error, no empty result |
| `PREDICATE ONLY` | Read in a `WHERE` / `CASE` and never selected |
| ①A / ①B | Which model ticket reads it |
| D*n* | The id the tickets use. **D1–D16 are ①A's list and their numbering is fixed** — ①B's additional objects continue at D17 |

---

## Object-to-audit matrix

| Id | Object | LAWP | Entry visa | COS | Medical | ILOE | R-visa | E-ID |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| D1 | `MONEY_CONTROL_SILVER.TRANSACTIONS` | · | ● | ● | ● | ● | ● | ● |
| D2 | `VISA_SILVER.VISAREQUESTEXPENSES` | ● | ● | ● | ● | · | ● | ● |
| D3 | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` | · | · | ● | · | ● | · | ● |
| D4 | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | ● | ● | ● | ● | ● | ● | ● |
| D5 | `HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS` | · | · | ● | · | · | · | · |
| D6 | `HOUSEMAID_MANAGEMENT_SILVER.OVERSTAY_FINES` | · | · | ● | · | · | · | · |
| D7 | `CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGEMENT_PAYMENTS` | · | · | ● | · | · | · | · |
| D8 | `CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGER_NOTES` | · | · | ● | · | · | · | · |
| D9 | `SALES_SILVER.CONTRACTS` | · | · | ● | · | · | · | · |
| D10 | `SALES_SILVER.CONTRACTS_PAYMENTS_TERMS` | · | · | ● | · | · | · | · |
| D11 | `VISA_SILVER.INITIAL_VISA_REQUESTS` / `_TASKS` | ● | ● | · | ● | · | ● | · |
| D12 | `VISA_SILVER.RENEW_VISA_REQUESTS` / `_TASKS` | · | · | · | ● | · | ● | · |
| D13 | `VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY` | · | ● | · | · | · | · | · |
| D14 | `VISA_SILVER.CANCEL_VISA_REQUESTS` / `_TASKS` | ● | ● | · | ● | · | ● | · |
| D15 | `MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` / `EXPENSES_HIERARCHY` | · | ● | ● | ● | ● | ● | ● |
| D16 | `POLICE_CONTROL.VISA_AUDIT.T_VERIFIER_VERDICT` **(new)** | · | ● | ● | ● | · | · | ● |
| D17 | `VISA_SILVER.HOUSEMAIDS_VISA_INFORMATION` | · | · | · | · | · | ● | ● |
| D18 | `MONEY_CONTROL_SILVER.LOST_VISA_EXPENSES` | ● | · | · | · | · | · | · |
| D19 | `MONEY_CONTROL_SILVER.DUPLICATE_EXPENSES` | ● | · | · | · | · | ● | · |
| D20 | `VISA_SILVER.QUOTA_CONSUMPTION_DETAILS` | ● | · | · | · | · | · | · |
| D21 | `HOUSEMAID_MANAGEMENT_SILVER.MAID_SERVICES` | · | · | · | · | · | · | ● |
| D22 | `VISA_SILVER.VISAREQUESTSNOTES` | · | ● | · | ● | · | · | · |
| D23 | `POLICE_CONTROL.VISA_AUDIT.T_CASE_REVIEW` **(new)** | ● | ● | ● | ● | ● | ● | ● |

**D1–D16 = ①A.** **D17–D22 = ①B** (LAWP, E-ID, R-visa). **D23 is shared** and created in ①A.

---
---

# D1 · `BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS`

**The money ledger.** Every audit except LAWP reads it. Wrapped once as `V_TXN` in the shared layer
so its guards cannot be applied in one audit and forgotten in another.

**Grain:** one posted transaction. `ID` is the key.

| Column | Read for | Notes |
|---|---|---|
| `ID` | the key; joined from `D2.TRANSACTION_ID` | NUMBER(38,0) both sides — **no cast** |
| `HOUSEMAID_ID` | the maid, where no expense line exists | 🔴 **The second maid id.** It disagrees with `D2.OWNER_ID` on 5 measured entry-visa charges. `OWNER_ID` is authoritative; the disagreement renders GREY, it is never resolved by picking one |
| `TRANSACTION_DATE` | **clock B — when Accounting posted** | 🔴 Median **one day** after the application date, up to **sixteen**. Using it as the population clock loses **257 of 913** entry-visa turn-down charges — 28% |
| `TRANSACTION_AMOUNT` | 🔴 **the only trusted amount** | Read money from here, never from `D2.AMOUNT`. Profiled max is ~19.7 trillion — the input guard bounds it at 100,000 and a failing row is `BLOCKED`, **never filtered out** |
| `TRANSACTION_TYPE` | `'Expense'` / `'Refund'` — the row declaring its nature | 🔴 Match on this, not on the sign. **271 blank-type rows sit at zero** and would inflate a duplicate count; they type as `BLANK` and never count as a payment. Where type and sign disagree, that is a booking defect, surfaced as a flag |
| `RELATED_TO` | ILOE — what the payment attaches to | |
| `EXPENSE` | the expense-head **name**, for display and the ILOE fine test | |
| `EXPENSE_ROOT` · `EXPENSE_ID` | 🔴 **the population filter** | Filter on the head id, **never on a description keyword** — `DESCRIPTION LIKE '%E-ID%'` misses every renewal (`"EID Renew"`, no hyphen): **2,911 rows, ~AED 1.04M in six months** |
| `CREATION_DATE` | ILOE ordering | |
| `DESCRIPTION` | **`PREDICATE ONLY`** — the ILOE fine test (`'%ILOE FINE%'`), the entry-visa turn-down wording, the R-visa shared-head test | 🔴 Carries maid names, and **passport numbers from 2026-01**. Never projected |
| `CREATOR` · `LAST_MODIFIER` · `SUPPLIER_NAME` | **`PREDICATE ONLY`** | Staff identity. Never projected |

**Not referenced at all:** `IS_DELETED` — it is TEXT, holds only `'0'` / `'00'`, and a boolean test
against it matches nothing while reading as *"none deleted"*. R-visa v6 withdrew an entire
measurement set taken through it.

---

# D2 · `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES`

**The visa ledger.** Wrapped as `V_VISA_EXPENSE_LINE` — deliberately at **line** grain, not payment
grain, because two lines can share one `TRANSACTION_ID` (once in 69,218 R-visa payments, request
12822) and that *is* the finding. Each audit collapses with `LINES_ON_TXN` in hand.

**Grain:** one expense line.

| Column | Read for | Notes |
|---|---|---|
| `VISA_REQUEST_ID` | the request | 🔴 **Not unique across request types.** 19,997 renewal ids are also initial ids; cancel requests run their own colliding sequence. Reading "either table by id" inflated medical's eligible population **1,153 → 1,211** and never-claimed **132 → 188** — a 42% overstatement that looks like a bigger finding |
| `PURPOSE` | 🔴 the population filter | Filter on this or on `EXPENSE_ID`. **`ENTRY_VSIA` is spelled wrong in the live system and must stay wrong** — `ENTRY_VISA` returns nothing |
| `STATUS` | per-audit, and it is load-bearing | Entry visa needs `'Added'` only. Medical needs `Dismissed` and `Pending` too — a **`Dismissed` refund is money that never came back** and must not clear a case. R-visa forbids `STATUS` as a population filter entirely and tests it separately |
| `TRANSACTION_ID` | join to D1 | **Nullable.** 1,770 R-visa lines and 2 COS transactions have no counterpart. **LEFT JOIN and keep the unmatched** |
| `OWNER_ID` | 🔴 **the authoritative maid id** | Preferred over `D1.HOUSEMAID_ID` |
| `OWNER_TYPE` | scope | `'HOUSEMAID'` selects cleaners too — head `149`, **211 transactions, zero negatives**. Cleaners are **in scope** by ruling |
| `REQUEST_TYPE` · `REQUEST_TYPE_ID` | initial / renewal / cancel routing | |
| `CONTRACT_TYPE` | CC / MV | 🔴 **Values are `'CC '` / `'MV '` with a trailing space.** `= 'CC'` matches **zero rows and raises no error** — it reads exactly like *"no findings for CC"*. **622,448** untrimmed rows measured on this column. `TRIM` everywhere |
| `EMPLOYEE_TYPE` | the office-staff / Dubai-expat exclusion | Out of scope in every audit |
| `AMOUNT` | ⚠️ **display only — never the money figure** | Net of VAT, carries −739.57 rows, and holds two with the **sign reversed**. Classifying off it moved entry visa's unclaimed count **216 → 511** |
| `CHARGE` · `VAT_CHARGE` | the channel fee | The `.65` ending is a channel fee, not a government fee |
| `PAYMENT_TYPE` | channel (Noqoodi / Credit_Card) | Drives the R-visa fee era |
| `CREATION_DATE` | 🔴 **clock A — when we applied** | NULL on zero rows. This is the population clock for entry visa and medical |
| `DESCRIPTION` · `EMPLOYEE_NAME` · `CREATOR_NAME` · `LAST_MODIFIER_NAME` | **`PREDICATE ONLY`** | Never projected |

**Not referenced:** `IS_DELETED` (same defect as D1).

---

# D3 · `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS`

🔴 **This is the single most expensive object in the register.** Three specs found the same defect
independently, and each had already published a wrong number before finding it.

**Grain: it is snapshot HISTORY, not one row per loan.** Deduplicate on `ID` before any sum, with an
**explicit** tie-break — `QUALIFY ROW_NUMBER()`, never `MAX`: ILOE measured **5 loans that tie**,
one of them four ways, so `MAX` is non-deterministic between runs.

Wrapped once as `V_LOAN_LATEST`, keeping the row with the largest `REPAID_AMOUNT + WAIVED_AMOUNT`.

**What it cost when it was missed:**

| Where | Cost |
|---|---|
| ILOE | overstated subscriptions by **AED 241,161 (+21.7%)** and fines by **AED 97,089 (+15.0%)** |
| E-ID | the replacement figure **moved AED 5,041.82 between two runs of the same query** |
| COS | shipped a **false AED 250 over-loan finding — twice** |

| Column | Read for | Notes |
|---|---|---|
| `ID` | 🔴 the loan key — **the dedupe partition** | |
| `HOUSEMAID_ID` | the maid | |
| `TYPE` | the loan class | 🔴 E-ID `M3` accepts **two named loan types only**. Accepting "any loan at all" collapses the figure toward zero |
| `BALANCE_DATE` | the snapshot stamp, and ILOE's clock | `TIMESTAMP_NTZ` — compare with `DATEDIFF`, never `BETWEEN` |
| `AMOUNT` · `REPAID_AMOUNT` · `WAIVED_AMOUNT` | the arithmetic | |
| `REMAINING_AMOUNT` | ❌ **never read** | 🔴 It is **0 on every row in the warehouse**, including `NOT_YET_PAID` ones. Reading it clears everything. Outstanding is always `AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT` |
| `STATUS` | display, and the E-ID loan-status filter | 🔴 `STATUS = 'PAID'` **does not mean the money came back** — it includes loans written off in full. Never used to decide recovery |
| `WAIVE_NOTES` · `REPAYMENT_NOTES` | **`PREDICATE ONLY`** — ILOE `R4` needs the ERP to-do reference and nothing else | Template-generated and names a real staff member. Three forms appear: `todo;551534`, `open-todo/730554`, and a full ERP URL. The id is extracted, the rest discarded |

⚠️ **`V_LOAN_LATEST` is for arithmetic only.** E-ID's verifier needs the note text of **every**
snapshot row (52 loans carry different notes per snapshot), so it reads the raw table — and only the
model's redacted quote is ever stored.

---

# D4 · `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO`

**The maid dimension.** Wrapped as `DIM_MAID`. Every tab displays from it.

| Column | Read for | Notes |
|---|---|---|
| `ID` | `MAID_ID` — rendered as **`Maid #<id>`**, never a name | |
| `NATIONALITY` | LAWP filter, and the hardcoded-exclusion blind spot (see D20 / N4) | LAWP reads scope and nationality from the **holder** of the bundle, not the payer |
| `HOUSEMAID_TYPE` | CC / MV, and the LAWP PAWP proxy | `'Normal'` → CC, `'MAID_VISA'` → MV. **An unrecognised value reports as `UNKNOWN`, never silently dropped.** Ruling: LAWP proceeds on this as the PAWP proxy, with the caveat printed on the tab |
| `STATUS` | display | |

🔴 **Never key a maid on her name from free text.** Measured **4% precise** on a sibling check —
54 of 56 "duplicates" were two different maids sharing a name.

---

# D5 · `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS` — COS only

Answers **CC or MV on the day of the charge**, which the current type cannot. A maid who moved
between them after the charge would otherwise be classified into the wrong leg.

| Column | Read for |
|---|---|
| `HOUSEMAID_ID` | the maid |
| `HOUSEMAID_TYPE` (from / to) | the type in force |
| the effective-date column | as-at resolution against `TRANSACTION_DATE` |

---

# D6 · `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.OVERSTAY_FINES` — COS only

The fine, and whether it was waived.

| Column | Read for | Notes |
|---|---|---|
| `HOUSEMAID_ID` | the maid | |
| the fine amount | the COS fine leg | 🔴 **Float residue.** Derive `FINE_CENTS = ROUND(TRANSACTION_AMOUNT*100) − 57565` **once** and build every test on it. `TRANSACTION_AMOUNT − 575.65` leaves ~1.14e-13, and `COS.R3` then fires **35 times in July instead of 5** — thirty fully-recovered cases showing AED 0.00 at risk — while **both tie-outs still read variance 0.00**, so the identities cannot catch it |
| the waiver amount / flag | relief | 🔴 Only a reduction **on the fine** is relief. A credit note (D8) clears nothing |
| overstay days | the filter, and the gate test | |

---

# D7 · `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGEMENT_PAYMENTS` — COS only

The client's payment of the fine. Drives `COS.M8` (**AED 50,750 collected, 74.3%**).

**Ruling:** `COLLECTED` accepts a payment on **any** non-fake contract of the maid, not only the one
running on the charge date — narrowing it risks dropping a payment made by the prior client after a
handover. One July case, AED 400, is matched this way.

---

# D8 · `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGER_NOTES` — COS only

**Display only. Clears nothing.** Ruling: a credit note raised against an overstay fine is not
relief; such a case correctly reads red.

`TEXT` is **`PREDICATE ONLY`** — it carries other people's disputes in plain text.

---

# D9 · `BA_VIEWS.SALES_SILVER.CONTRACTS` — COS only

Which client. 🔴 **`FAKE = FALSE` everywhere.**

🔴 **It fans out.** Of 704 July maids: **645 have one contract, 38 two, 3 three, 1 four, and 17
none.** Aggregate per transaction in a subquery before joining back, or the collected figure
inflates.

---

# D10 · `BA_VIEWS.SALES_SILVER.CONTRACTS_PAYMENTS_TERMS` — COS only

The monthly discount. **Display only** — it is a filter and a column, never a term in a metric.

---

# D11 · `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS` / `INITIAL_VISA_REQUESTS_TASKS`

| Column | Read for | Notes |
|---|---|---|
| `REQUEST_ID` | the key | 🔴 **Unique across 99,669 rows**, so it cannot fan out — but it **collides with renewal and cancel ids** (D2 note) |
| `LINKED_REPLACEMENT_ID` | LAWP — the replacement chain | 🔴 **Resolves against two tables.** It points at `CANCEL_VISA_REQUESTS.REQUEST_ID` (22,862 / 22,862) and **also matches `INITIAL_VISA_REQUESTS.REQUEST_ID` on 97.6%.** The wrong join **silently succeeds and is wrong every time.** Join to `CANCEL_VISA_REQUESTS` |
| `WORK_PERMIT_TYPE` | LAWP filter | |
| `ENTRY_VISA_ISSUANCE_DATE` | LAWP | |
| `_TASKS.TASK_NAME` · `VISA_REQUEST_ID` · `STARTED_AT` · `COMPLETED_AT` | the medical clock; the R-visa *"Apply for R-visa"* guard point | 🔴 **Aggregate to one row per `VISA_REQUEST_ID` first** — see D12 |

🔴 **LAWP: one hop up the replacement chain is not enough.** **599 of 6,085** `REPLACEMENT` bundles
(9.8%) land on a request that is itself `REPLACEMENT`. Reading the holder of an inherited bundle
returns zero.

---

# D12 · `BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS` / `RENEW_VISA_REQUESTS_TASKS`

The medical renewal half, and the R-visa renewal pipeline.

🔴 **The renewal task table re-fires up to 1,909 iterations per request.** **335,583 `ONGOING` rows
sit on 2,120 distinct requests** — counting rows overstates that population by **158×**. Aggregate
to one row per `VISA_REQUEST_ID` before any join.

---

# D13 · `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY` — entry visa only

The turn-down. This is what makes entry visa auditable at all — and **why there is no backfill
before 2025-09-05**: no dated immigration rejection exists earlier.

| Column | Read for |
|---|---|
| `REQUEST_ID` | the request |
| `ENTRY_VISA_IMMIGRATION_APPROVED` · `ENTRY_VISA_IMMIGRATION_APPROVED_MODIFIED` | the turn-down and its stamp |
| `LAST_MODIFICATION_DATE` | the turn-down clock |

🔴 **19 refund claims are dated before their turn-down stamp**, by up to 74 days — the same
posting-lag family. **Ruling: display as `0` and flag the row**, never as a negative age.

⚠️ Still with the Visa team, and **not blocking**: whether `Active_Visa` and `Another_Issue` count
as turn-downs. Either would widen `EV.M1`.

---

# D14 · `BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS` / `CANCEL_VISA_REQUESTS_TASKS`

Entry-visa refund routing, the medical root cause, and the LAWP replacement target.

| Column | Read for | Notes |
|---|---|---|
| `REQUEST_ID` | the cancellation | |
| `NEW_REQUEST_ID` | 🔴 the link back to the original request | **It is not unique** — **9,762 values are pointed at by two or more cancellations**, so one request legitimately inherits refunds from several. Entry-visa refunds route **two ways**: on the request, and on its cancellation via this column |
| `MAID_ID` · `RELATED_MAID_ID` | the maid | |
| `VISA_CANCELLATION_TYPE` | medical root cause, and the cancellation-type filter | |
| `_TASKS.TASK_NAME` · `VISA_REQUEST_ID` | the refund step | |

🔴 **The medical fee and its refund do NOT share a visa request id.** Only **2.3%** of pairs do —
the fee sits on the initial/renewal request, the refund on the **cancellation** request. **Join on
the maid id.** Getting this wrong reports ~98% of cases as unrefunded.

---

# D15 · `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` / `EXPENSES_HIERARCHY`

Expense-head names and loan settings. Read so the population filter is on the **head**, never on a
description keyword (D1 note).

🔴 **COS: head `1589` cannot create loans at all**, and the dedicated `1058 Overstay fee Loan` head
has been **dead since 2025-11-29** — which is why the COS expense has no key to the CC loan and the
loan is matched **on the maid only**.

🔴 **R-visa: shared expense heads need the description test; dedicated heads must not have it.**
Applying it inconsistently attributed **AED 668.00 of entry-visa refunds to R-visa recoveries** —
twice.

---

# D16 · `POLICE_CONTROL.VISA_AUDIT.T_VERIFIER_VERDICT` — **new, written by this build**

One verdict contract for all four AI-verified audits (entry visa, COS, medical, E-ID), so a verdict
means the same thing on every tab.

| Column | Notes |
|---|---|
| `AUDIT_CODE` · `CASE_ID` | which case |
| `VERDICT` · `VERDICT_REASON` | the ruling and its category |
| `REDACTED_QUOTE` | 🔴 **The only free text that ever reaches a column.** Redaction to `[placeholder]` happens **at the model**, before the text leaves it. Shown in the drill-down, **never in the CSV export**. Raw note text is never re-fetched |
| `VERIFIED_AT` · `MODEL_REF` | provenance |

🔴 **Reading a verdict is not running a model.** The build reads this table; it does not call one.

---
---

# ①B — the three remaining audits

# D17 · `BA_VIEWS.VISA_SILVER.HOUSEMAIDS_VISA_INFORMATION` — E-ID, R-visa

🔴 **It is one row per REQUEST, not per maid.** Joining without deduplicating fans out **5–20×** —
the same query returned **1,682 charges for 82 maids before the dedupe and 95 after**.

Read for: the visa term (E-ID's 58 term cases, R-visa's term-mismatch class of 25), and the
`VISA_REQUEST_ID` link.

🔴 **R-visa: `VISA_REQUEST_ID` is not unique** — cancel requests run their own colliding id
sequence, so every request-keyed read merges two unrelated people. The guard is **mandatory, not
defensive**.

---

# D18 · `BA_VIEWS.MONEY_CONTROL_SILVER.LOST_VISA_EXPENSES` — LAWP

The existing loss register. LAWP `R13` / `M10` **recompute the loss from source records and compare
the answer to Alert 945 / 944** (`DNA-4395`, `DNA-4396`).

🔴 **Do not rebuild the alerts.** The check is a comparison against them.

⚠️ Open: the unreconciled gap against this table. It surfaces on the LAWP tab; it does not block.

---

# D19 · `BA_VIEWS.MONEY_CONTROL_SILVER.DUPLICATE_EXPENSES` — LAWP, R-visa

The ERP's own duplicate register, read as a comparison — not as the answer.

🔴 **LAWP `R18`: a duplicate is keyed on AMOUNT EQUALITY within AED 0.01.** **7,049 of the 7,171**
different-amount pairs are one fee booked under two purposes. A rule that merely counted rows would
red **AED 5.24M of correctly-paid money.**

---

# D20 · `BA_VIEWS.VISA_SILVER.QUOTA_CONSUMPTION_DETAILS` — LAWP

| Column | Notes |
|---|---|
| `LAWP_PAWP` | ⚠️ **Covers only 3.8–7.4% of bundles** and runs **44:1 PAWP to LAWP** — it is not a usable bundle-level flag. This is ingestion ask **N3** |
| the bundle link | |

**Ruling:** LAWP proceeds on the `HOUSEMAID_TYPE` proxy (D4) with the caveat printed on the tab.
Some PAWP bundles are in the population and nobody can say how many.

🔴 **`PAYMENT_DATE` is NULL on 99.1% of work-permit rows.** Anchor the LAWP clock on
`CREATION_DATE`, which is NULL on zero.

🔴 **LAWP fees must be scoped to the request, not the maid.** Summing a maid's fee rows picks up
every visa cycle she ever had — measured **AED 3,188 per bundle**, more than double a real one.

---

# D21 · `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.MAID_SERVICES` — E-ID

The E-ID request register. **52 repeat-E-ID requests here have no matching charge** — the only
independent completeness check audit 3 has. **Ruling: publish the count on the tab.**

⚠️ **A near miss worth recording.** It declares `CONTRACT_ID`, `CLIENT_ID`, `NOTES`, `IS_APPROVED`
and `LOANS_FORGIVENESS_AMOUNT`. **All five are NULL on all 555 rows.** It looks like the client link
and is not one — but ingesting those five columns would close ingestion ask **N1** (the MV client
recharge, **131 cases, AED 58,649.84**) **without any new table**.

---

# D22 · `BA_VIEWS.VISA_SILVER.VISAREQUESTSNOTES` — entry visa, medical

The verifier's evidence source. `TEXT` is **`PREDICATE ONLY`** and is never projected — only the
model's redacted quote reaches a column.

🔴 **The table has no primary key and no unique column combination.** 1,809,225 rows give only
1,808,902 distinct **even on five fields**. Until ingestion ask **N2** lands, a surrogate id is used
and **323 rows can change id between runs** — which means a citation can silently re-point.

---

# D23 · `POLICE_CONTROL.VISA_AUDIT.T_CASE_REVIEW` — **new, the only writable table**

**Ruling: a review status IS saved against a case.** Auditors work cases one at a time over a month;
without it two people work the same row and neither can tell.

| Column | |
|---|---|
| `AUDIT_CODE` · `CASE_ID` | the key |
| `REVIEW_STATUS` | Under review / Escalated / Closed |
| `ASSIGNEE` | |
| `NOTE` · `OUTCOME` | |

🔴 **It never touches a computed column, and never feeds a filter default that changes a metric.**
Workflow status is not a verdict. Changing a review status must leave every KPI tile unchanged —
that is acceptance criterion 10 on the BI ticket.

---
---

## The sensitivity register — by column name, not by intent

**Reading these to compute is required and permitted. Selecting them is not.** They never appear in
a view definition's select list, a CSV export, a chat reply or an email.

| Object | Columns |
|---|---|
| D1 `TRANSACTIONS` | `DESCRIPTION` · `CREATOR` · `LAST_MODIFIER` · `SUPPLIER_NAME` |
| D2 `VISAREQUESTEXPENSES` | `DESCRIPTION` · `EMPLOYEE_NAME` · `CREATOR_NAME` · `LAST_MODIFIER_NAME` |
| D3 `HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` | `WAIVE_NOTES` · `REPAYMENT_NOTES` (raw text — the to-do id is extracted, the rest discarded) |
| D8 `CLIENT_MANAGER_NOTES` | `TEXT` |
| D22 `VISAREQUESTSNOTES` | `TEXT` |
| (verifier sources) `COMPLAINTS` | `COMPLAINT_DESCRIPTION` |
| (verifier sources) `COMPLAINT_COMMENTS` | `TEXT` |
| (verifier sources) `HOUSEMAID_MANAGER_NOTES` | `NOTE_REASON` |

No salaries, no IBANs, no contact details, no phone numbers reach any surface. **The maid is
rendered as `Maid #<id>`.**

**Why the exclusion is by column name rather than by intent:** those note threads carry other
people's pay disputes in plain text, and `TRANSACTIONS.DESCRIPTION` has carried passport numbers
since 2026-01. A rule that depends on a developer judging each case will eventually be judged wrong
once. A rule that names the column cannot be.

**The check:** `SELECT * FROM INFORMATION_SCHEMA.VIEWS WHERE VIEW_DEFINITION ILIKE '%DESCRIPTION%'`
and the equivalent for every column above, reviewed by name. Zero hits in a select list.

---

## Four things deliberately not read

| | Why |
|---|---|
| `IS_DELETED` (D1, D2) | TEXT, values `'0'` / `'00'` only. A boolean test matches nothing and reads as *"none deleted"* |
| `REMAINING_AMOUNT` (D3) | 0 on every row in the warehouse, including `NOT_YET_PAID` ones. Reading it clears everything |
| `VISAREQUESTEXPENSES.AMOUNT` as money (D2) | Net of VAT, carries −739.57 rows, two sign-reversed. Money comes from `TRANSACTIONS.TRANSACTION_AMOUNT` |
| Any maid name as a key | 4% precise — 54 of 56 "duplicates" were different people |

---

## Refresh

**Manual, on demand.** No scheduled task, no stream, no standing unattended run. Every one of the
seven specs says so independently, and a recurring Snowflake process is the ERP/Data team's to own,
not this dashboard's.
