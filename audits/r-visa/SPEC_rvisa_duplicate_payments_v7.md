# Spec — R-Visa Duplicate Payments

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Spec version** | v7 |
| **Date** | 2026-09-14 |
| **UI mockup** | https://claude.ai/code/artifact/3ce6b63e-afbb-4b45-8eff-d530f899e735 |
| **Discovery record** | https://claude.ai/code/artifact/619fb3c1-44dc-4b52-a8dd-ad57ca57154a |
| **Status** | Draft. **All three flowchart legs now have rules; two await a measurement (§9.1). Read §9 first, then §0.** |

---

## 0. What changed in v6 and v7, and why it matters

v5 asked one question at one grain: *did this visa request get charged twice?* v6 keeps that, and adds the question the business actually asks: **did this maid get charged for R-visa cover she already had?** Four things made that answerable, and each of them retired an assumption v5 was carrying.

### 0.1 An authority tariff was read. The base fee is no longer reverse-engineered.

Two company documents, both Dec 2025, giving identical figures — and the first of them is the sheet ERP **Alert 931 (Money Lost — Visa Expense Overspend Detected)** uses as its thresholds, so it is operative, not a note.

- `visa steps cost` — `1Apz6DNFjQwqx2hwvyGjJpYnCGJng85EAn99z4CSDUaU`
- `Visa Expenses Master Guide – Policing Department` §4.3, §4.4.7 — `1ZymaVnHk2qUzYzmv38KF7iwEvs1ROB0B-Nb6R6BbMU8`

Both state: **R-visa is 443.50 or 457.46 for two years, 343.50 for one year.** The 1-year AIO rate has never been paid.

### 0.2 The term is stored — in the price. That is the whole of the new rule.

**`343.50` ⇒ 1 year. `443.50` / `457.46` ⇒ 2 years.** No extra field, no extra ERP call. A second fee paid while the first term is still running is a payment for cover we already owned; a second fee paid after it is a renewal. This replaces v5's flat 300-day span test (old T6), which had no theory behind it at all.

### 0.3 Cancellation is an expense row, not a note.

`RESIDENCE_CANCELLATION` · `ONLINE_CANCELLATION` · `IMMIGRATION_CANCELLATION` · `CANCELLATION_PAPER`. A cancellation falling between two fee payments proves a re-application **from the ledger**. v5 treated this as unprovable and routed it to a human reader. It is provable, and it accounts for **71 pairs** — more than the same-request duplicate count.

### 0.4 Therefore the AI verifier is no longer required.

v5 set `AI verifier = Required` on the grounds that three questions were prose-only. Measured, they are not: cancellation is structural (§0.3), term is structural (§0.2), and fine responsibility has a documented default (§2.6). The irreducible reading job is **8 cases, all-time**. §9 keeps the prompt, marked not required, so the decision is reversible without a rewrite.

### 0.5 Measurements withdrawn

Anything computed through `IS_DELETED = FALSE` on `VISAREQUESTEXPENSES` is **void**: that predicate matches zero rows. The canonical population filter is `OWNER_TYPE = 'HOUSEMAID' AND TRANSACTION_ID IS NOT NULL`, and no deleted-flag test. This withdraws v5's fine-sizing figures (AED 152,850 across 195 payments) and the loan-linkage result. They are not restated here; they must be re-measured.


### 0.6 Headline numbers, v6

All measured 2026-09-14 on the per-maid grain, over every priced R-visa fee payment all-time.

| | Pairs | Since 2025 | AED | Reading |
| --- | --- | --- | --- | --- |
| **A** same request — duplicate | **68** | 37 | **29,905** | Deterministic finding |
| **B** renewal after term | 16,013 | ~9,000 | — | Clean. Median gap **716 d** vs a 730-day term |
| **C1** cancelled then re-applied | 71 | 62 | — | Clean, proved from the ledger |
| **C2 · S1** re-payer defect | 20 | — | **8,870** | One control gap (§3.7) |
| **C2 · S2** term mismatch | 25 | — | — | New finding class, AMBER (§3.8) |
| **C2 · S3** unexplained | **8** | — | — | The manual queue |

v5's per-request figures — 90 multi-payment cases, 45 confirmed, duplicated AED 20,344.50, still out AED 16,853.50 — remain valid **at their own grain** and are not superseded; they answer a narrower question. Where the two disagree on a case, the per-maid grain is authoritative for the business question and the per-request grain for the request-level one. **Do not add the two AED totals together.**

⚠️ The A-bucket total (AED 29,905) is **gross duplicated fee, before refunds**. v5's recovery work (§3.4) applies unchanged: refunds are partial, 239.50 or 289.50, and **zero cases all-time have been fully recovered**.

### 0.7 What v7 adds, and what it still owes

v7 exists because v6 answered one of the three checks the flowchart asks at this node and did not say so. §9 is the fix — a source-coverage comparison, read from the PDF, run before anything else on every revision.

**Closed in v7:**
- §9 source coverage exists, and running it found a **fourth leg from a different source** that no gate could have caught (§9.2a), plus a **scope conflict** between the roadmap and §2.6 (§9.2b).
- **T10** (§3.9) turns §2.6's finding into a rule with a full verdict contract, written specifically against the version of it that would red every case.
- **FINE_STEP = 50** is reclassified as a matcher tolerance making no claim about authority pricing (§9.5) — which retires the class of defect `DNA-9529` was withdrawn over.
- The term measurement is **routed** to a named table with both of its known traps written down (§9.3).
- The 981 orphans are **decided**: build the proximity screen (§9.6). v6 offered two options and shipped neither.

**Still owed, and not disguised:**
- Three measurements — `Q-TERM`, `Q-FINE`, `Q-ORPHAN` — none of which this session could run.
- One Ask-the-Code answer (§9.7), which is the only thing that can confirm whether a Modification charge can ride inside an R-visa payment. Everything §2.6 says about that today is read from the ledger's shape.
- Five decisions that need a person (§6.a).

⛔ **Two of the three flowchart legs therefore read SPECIFIED, NOT MEASURED — not BUILT.** The corrected DNA pair cannot be raised on this. Filing a spec whose own coverage table says "not measured" is the same mistake in a new coat.

---

## 1. Business Logic

**The control.** maids.cc pays the UAE government a residence-visa ("R-visa") fee per maid — once when the visa is issued, once per renewal cycle. Exactly one fee per application and per renewal. This report proves or disproves that.

**When the fee is paid, and to whom.** The ERP fires a workflow task named **"Apply for R-visa"** — once in a maid's *initial* visa journey (producing `APPLY_FOR_RVISA`) and once per *renewal* journey (producing `RENEW_RESIDENCE`). Verified against `BA_VIEWS.VISA_SILVER.MISSING_EXPENSES`, which maps that task to exactly those two purposes. The permit runs two years, so renewals recur roughly biennially. The money goes to the UAE immigration authority; **`Noqoodi` is a payment gateway, not the payee** — it adds `3.00 + 0.15 VAT` on top of the `443.50` government fee, which is where the `446.65` all-in figure comes from.

**The failure it catches.** The same application or the same renewal charged more than once — one firing of "Apply for R-visa", two fees out.

**Two dimensions, deliberately separate.**

| | Mutable? | Meaning |
| --- | --- | --- |
| **Verdict** | **No** | The control failed. Two payments went out on one visa request. A refund does not undo this. |
| **Recovery** | **Yes** | Unrecovered · Partial · Full · Unknown. Recomputed each run from live data. |

A refund can never turn a RED into a GREEN. If it could, a team could make a broken process look healthy by cleaning up after itself, and the control-failure count — the number that says "fix this" — would fall while the fault stayed put. Recovery is computed, never written back, so this stays a dashboard and not an application.

**Why it can happen.** Nothing in the ERP prevents or detects it:

- Two `Added` R-visa lines sit on one visa request with nothing objecting.
- `Dismissed` exists and staff use it on these same requests for other products — but on none of these lines. In fact **no paid R-visa line has ever carried any status but `Added`** (0 of 69,218).
- The visa-request ledger has **no R-visa refund purpose**: 0 negative rows in 71,791 `APPLY_FOR_RVISA` and `RENEW_RESIDENCE` lines, against 2,977 negatives on other purposes. Refunds exist only as negative *transactions* on accounting heads, with no link back to the line they reverse. **Verified 2026-09-10, not assumed** — see D14.
- `DUPLICATE_EXPENSES`, the company's own detector, flags **0 of these**, and structurally cannot — see "Non-overlap" in §3.

**Recovery is partial by design.** Measured: 15 of 45 confirmed cases carry a refund; **none is full**. Refunds cluster on `AED 239.50` (2025-02 onward) and `AED 189.00` (2020–2024). The authority appears to return a fixed portion of roughly 239.50 against a 443.50 fee and keep the rest.

**So a duplicated fee is a loss even when refunded** — the residue of ~204 per case is unrecoverable. Requestor ruling of 2026-09-09 that duplicates are treated as loss therefore stands, on firmer ground than when it was given.

**Reader and action.** Police & Control, on demand. A confirmed row is a **finding to be actioned**, and the default view is Confirmed + Unrecovered.

**This report is a detector, and that is the deliverable — not a shortfall.** Ruled 2026-09-10: P&C's remit is to detect; preventing the defect is the ERP and Visa teams' work. Nothing in the ERP stops a second `Added` R-visa line on one request, and a guard at the "Apply for R-visa" task would be the preventive fix — but that is a **recommendation handed over**, not a precondition for this report and not a reason to call the report incomplete.

**Population in scope.** Every R-visa payment owned by a housemaid, all-time.

🔴 **A blind spot that belongs on the report, not just in this spec.** **981 transactions sit on R-visa heads with no visa line at all** — 1.4% of the population, ten times the finding set. They carry no case key, so **no test examines them**. A duplicate whose second leg is one of those 981 — same maid, same head, same era, days apart — is invisible here. That is a different and larger gap than the absent-payment one §8 describes. It needs either a proximity screen (same maid, same head, ±90 days against the scored population, hits published in the Controls panel) or an explicit out-of-coverage statement on the report.

**Explicitly out of scope.**

| Out | Why |
| --- | --- |
| Overstay fines | Own audit. Where a duplicate carries fine days, only the era fee is counted. |
| Office staff | `OWNER_TYPE <> 'HOUSEMAID'`. |
| Whether the fee amount was right | Tests *count*, not price. |
| R-visa **modification** charges | A different product — amending a visa, not paying the fee. Heads `1622` `1649` `1735`. |
| Entry visa · E-ID · Change of Status | Own audits. Duplicates seen in them during this work are handed over, not scored (§6.4). |

**Dates and time zone.** Every date in this spec is a D12b `DATE` value, Dubai calendar, no conversion applied. "Today", T1's upper bound and M10's year boundaries all use the snapshot date shown in the report's provenance line.

**Grain.** One row per **case** = (`VISA_REQUEST_ID`, `PURPOSE`). Money counts *excess payments* within the case: three payments = two excess, one case.

⚠️ **Not one row per maid** — a maid key would drop cases whose defect is a missing maid id, since `COUNT(DISTINCT)` ignores NULLs. Three cases in this population have no maid id at all.
⚠️ **Not one row per visa request alone** — a request accumulates lines for years, so one `APPLY` plus one `RENEW` five years apart looks like a duplicate. That error produced **8,785 cases and AED 4,215,566** against the correct **90 and AED 29,218**.

**Refresh.** Manual, on demand. Never scheduled; a standing run goes to the ERP team.

**Scan window.** All-time. A period-scoped duplicate test splits pairs across the boundary and passes both halves.

---

## 2. Data Points Needed

### 2.1 Verified in Snowflake

Verified by `DESC` and by queries that ran, 2026-09-09/10.

| # | Data point | Table · Column | Type | Notes |
| --- | --- | --- | --- | --- |
| D1 | Expense line | `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | view | Grain is the **line**, not the payment. |
| D2 | Case key part 1 | ″ `VISA_REQUEST_ID` | NUMBER(38,0) | Range 1–119,422. Non-null. |
| D3 | Case key part 2 | ″ `PURPOSE` | VARCHAR | `APPLY_FOR_RVISA` **54,554** · `RENEW_RESIDENCE` **17,237** — re-counted 2026-09-10; sums to 71,791 and ties to M9's opening line. Structured enum. *(Earlier drafts carried 54,484 / 17,217 from a profiling run taken before the population was settled; that pair was 90 short and broke the completeness control.)* |
| D4 | Payment link | ″ `TRANSACTION_ID` | NUMBER(38,0), nullable | **Two lines may share one id** — happens exactly once in 69,218 payments (request `12822`). Collapse to payment grain first. |
| D5 | Line status | ″ `STATUS` | VARCHAR | Column holds `Added` · `Dismissed` · `Pending`, but **within the audited population only `Added` ever occurs** (0 of 69,218 otherwise). Not a scope filter; tested at T7 as a guard. |
| D6 | Government fee | ″ `AMOUNT` | FLOAT | ⚠️ **Not reliably the fee** — 117 payments book the all-in total here with `CHARGE`/`VAT_CHARGE` null. Reconcile against R-FEE-SCHEDULE. |
| D7 | Channel charge | ″ `CHARGE` | FLOAT | 0 · 2.5 · 3 · 60 · 180. Nullable; null on every pre-2021 row. |
| D8 | VAT on charge | ″ `VAT_CHARGE` | FLOAT | 0 · 0.125 · 0.15 · 4.2 · 9 · 30. Nullable. |
| D9 | Channel | ″ `PAYMENT_TYPE` | VARCHAR | `Noqoodi` `Credit_Card` `CBD` `Edirhams` `EWallet` `PayPRO_Wallet` `CASH` `EDNRD`. |
| D10 | Owner type | ″ `OWNER_TYPE` | VARCHAR | `HOUSEMAID` · `OFFICE_STAFF`. |
| D11 | Line created | ″ `CREATION_DATE` | TIMESTAMP_NTZ | Earliest 2017-06-21. ⚠️ Runs **one day before** the transaction date throughout. Not the payment clock. |
| D12 | Transaction | `BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS` | table | 2,123,075 rows. |
| D12a | ″ id | ″ `ID` | NUMBER(38,0) | Join key to D4. |
| D12b | ″ date | ″ `TRANSACTION_DATE` | DATE | **The payment clock.** All dated logic uses this, never D11. |
| D12c | ″ amount | ″ `TRANSACTION_AMOUNT` | FLOAT | Negative = refund. |
| D12d | ″ expense head | ″ `EXPENSE_ID` | NUMBER(38,0) | See R-VISA-HEADS. |
| D12e | ″ maid | ″ `HOUSEMAID_ID` | NUMBER(38,0), nullable | **Display, recovery matching and T8 only — never the case key.** ≥99.9% populated from 2021; 0.46% in 2019. |
| D12f | ″ description | ″ `DESCRIPTION` | VARCHAR | **The column the shared-head description test runs on.** Confirmed present by `DESC TABLE`, 2026-09-10. Carries maid names and, from 2026-01, passport numbers — **predicate only, never selected** (§4). |
| D12g | ″ transaction type | ″ `TRANSACTION_TYPE` | VARCHAR | **Verified 2026-09-10: exactly two values on R-visa heads — `Expense` · `Refund`.** This is the *declared* nature of the row, so §3.4 matches refunds on it rather than inferring from the sign of the amount. |
| D12h | ″ head name | ″ `EXPENSE`, `EXPENSE_ROOT` | VARCHAR | The head's name, carried on the transaction itself — no join to D15 needed. Use as a **cross-check** on R-VISA-HEADS: a row whose `EXPENSE_ID` is in the list but whose name does not read as R-visa is a run exception. |
| D12i | ″ payee | ″ `SUPPLIER_NAME` | VARCHAR | **Checked and empty** — null on every dedicated R-visa head. It does not name the authority, so §1's statement of the recipient stands on head naming and the `EDNRD` channel, which is inference. Do not cite a payee as verified. |
| D12j | ″ staff names | ″ `CREATOR`, `LAST_MODIFIER` | VARCHAR | Personal data. **Never selected** (§4). |
| D13 | Existing detector | `BA_VIEWS.MONEY_CONTROL_SILVER.DUPLICATE_EXPENSES` · `TRANSACTION_ID`, `CRITERIA` | view | Used **solely** for the non-overlap metric. Never sources a finding. |
| D14 | Refund ledger — **checked and rejected** | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_REFUNDS_HISTORY` | view | Carries `EXPENSE_TRANSACTION`, a deterministic refund→payment link. **Does not cover this population.** 0 rows across all 21 candidate heads; 0 of 69,218 R-visa payments and 0 of 184 case payments match, against **11,993 linked transactions** present in the ledger — so the zero is separation, not an empty column. Built on `expenserequesttodos` (money-control request pipeline); R-visa fees run through `VISAREQUESTEXPENSES` (visa pipeline). Two ledgers, no bridge. |
| D15 | Head names | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_HIERARCHY` · `EXPENSE_ID`, `EXPENSE_NAME`, `ROOT` | view | Source for the named head table in §2.4. Excludes `is_secure` and `is_deleted` types — a head that fails to resolve is one or the other, which is itself a finding. |

**Price decomposition, verified at row grain.** Ledger total = `AMOUNT + CHARGE + VAT_CHARGE`. Noqoodi `443.50 + 3.00 + 0.15 = 446.65`; Credit_Card `457.46 + 0 + 0`. The `.65` is a channel fee, not a government fee.

### 2.2 Approved KPI definitions

**None.** No entry in `BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` defines duplicate R-visa payment. Every figure in this spec is therefore an **unverified ad hoc definition, not an approved KPI**, and should be added to the Data Catalog on approval.

### 2.3 Ingestion request

| # | Data point | Source | Detail | Owner | History |
| --- | --- | --- | --- | --- | --- |
| N1 | Credit_Card reversal status | Card provider / finance, outside ERP | Whether a failed card R-visa charge is reversed at the bank | Finance / card-flow owner | **2025-11-05 onward** — covers all 11 affected cases |
| N2 | Visa-request status history | ERP, Visa module | Distinguishes re-application from duplicate on long-gap cases. Native table not yet identified — **Ask the Code before build** | Visa team | All-time |

Until N1 lands, T4 is BLOCKED. Until N2 lands, T6 is BLOCKED. Both make cases AMBER, never clean.

### 2.4 Reference lists that gate a verdict

Every list here decides an outcome, so each is a named data point with an owner and a run guard.

**R-VISA-PURPOSES** — `APPLY_FOR_RVISA`, `RENEW_RESIDENCE`. Owner: P&C.
*Guard:* both must appear each run; no other purpose may enter the population.
⚠️ **Membership verified against a warehouse view only.** The claim that the "Apply for R-visa" task emits exactly these two rests on `MISSING_EXPENSES`, itself a view, and one whose coverage starts 2025-06-01. A third purpose the same task can emit — or one retired before that cutoff — is invisible to both the population and this guard. Confirm against the ERP enum when the ask-the-code token is restored.

---

**R-VISA-HEADS** — accounting heads carrying R-visa money. Owner: P&C. Names verified 2026-09-10 against D15; all 21 candidate heads resolved (none secure or deleted).

*In scope — dedicated R-visa fee*

| Head | Name |
| --- | --- |
| `1620` | NEW - CC Housemaids - R-visa Application 2 years |
| `1587` | RENEW - CC Housemaids - R-visa |
| `1647` | RENEW - CC Housemaids - R-visa Application 2 years |
| `1708` | NEW - MV Housemaids - R-visa Application 2 years |
| `1675` | RENEW - MV Housemaids - R-visa |

*In scope — shared immigration buckets, admissible **only with a description test** for `R-VISA` or `RENEW RESIDENCE`*

| Head | Name | Note |
| --- | --- | --- |
| `150` | NEW - Immigration - CC Maids | last seen 2021-06 |
| `736` | New - immigration - MV Maids | |
| `161` | Renewal and Cancellation - Immigration - CC Maids | ⚠️ also holds **cancellation** money — confirmed, not inferred: `MISSING_EXPENSES` maps `Cancel → GDRFA Cancellation → RESIDENCE_CANCELLATION` (217 alerts) |
| `737` | Renewal and Cancellation - immigration - MV Maids | ⚠️ same — the description test is what keeps cancellation fees out of the population |
| `149` | NEW - Immigration - Cleaners | Cleaners are a distinct worker category that `OWNER_TYPE = 'HOUSEMAID'` selects. **Deliberately in scope** — the company paid a residence-visa fee for a person it sponsors. |

*Out of scope, and why*

| Head | Name | Reason |
| --- | --- | --- |
| `1622` `1649` `1735` | NEW/RENEW - CC & MV Housemaids - **R-visa Modification** | Out of scope for the duplicate leg — a modification amends an existing visa and is not the residence fee. Carries 0 payments in the current population. 🔴 **But it is not priceless, and it is not irrelevant.** The company tariff (*visa steps cost*, Dec 2025) gives it as **"Update Personal Information in Immigration — most of the times the amount is 143.5 and it could be 243.5, it is not clear why they rarely vary"**, and the *Master Guide* §2.4 defines the underlying service as *"Modify Person Information in MOHRE / Immigration — corrects mistakes in name, passport number, nationality, etc."* **This is the R-visa document-error charge.** It belongs to audit leg 3 (fine responsibility), not leg 1. Measure it; do not fold it into the duplicate count. |
| `779` | **InPut VAT Maids.cc Expenses** | Not an expense head — a VAT account. 936 transactions, none worded R-visa, no negatives ever. The 3 case payments booked here are **mis-bookings**; they get a published exception, not a head-list entry. |
| `1797` | NEW - OfficeStaff - R-visa Application 2 years | Office staff. |
| `1576` `1664` `1607` `1614` `1695` `1702` | CC/MV Housemaids - Entry Visa (incl. Inside/Outside Country applications) | Entry visa — own audit. |

⚠️ **Two generations of head scheme, and both are required.** The generic buckets (`149` `150` `161` `736` `737`) run 2018 → late 2025; the granular heads (`15xx`–`17xx`) begin around 2025-12. A list restricted to either generation silently loses an era of refunds. Do not "tidy" the legacy heads away.

⚠️ **No structural family exists.** Every head is top-level in D15 — `ROOT` equals its own name in all 21 cases. The grouping above is held together by naming convention and this table, nothing else, which is exactly why it needs sign-off rather than inheritance.

⚠️ **Payments and refunds are selected by different means, and that asymmetry is structural — not a defect to be "fixed" by making them identical.**
- **Payments** are selected by `PURPOSE` (§3.1). No head filter, no description test — the visa ledger already says what the money was for.
- **Refunds** carry no purpose. They are bare negatives on a head, so the head list *plus* the description test on D12f is the only handle available.

An earlier draft demanded the test be "applied identically on both sides". That is unimplementable — there is nothing to apply it to on the payment side — and stating it that way hid the real risk. The real risk is **inconsistency within the refund side**: applying the description test to some shared heads and not others, which is what attributed **AED 668.00 of entry-visa refunds** (739.50/89.50 shapes) to R-visa recoveries. Twice.

*The rule that replaces it:* **every** shared head (`150` `736` `161` `737` `149`) takes the description test; **no** dedicated head does; and the predicate is written once and referenced, never retyped per head. **Here it is, written once** — a reference list in its own right, owner P&C:

```sql
-- R-VISA-DESCRIPTION-TEST · shared heads only, identically on payments and refunds
    ( UPPER(TRIM(t.DESCRIPTION)) LIKE '%R-VISA%'
   OR UPPER(TRIM(t.DESCRIPTION)) LIKE '%RENEW RESIDENCE%' )
AND UPPER(TRIM(t.DESCRIPTION)) NOT LIKE '%CANCEL%'   -- heads 161/737 also hold cancellations
AND t.DESCRIPTION IS NOT NULL                        -- a null description fails, never passes
```

*Guard:* publish, per shared head, the count this predicate **admits** and **rejects**. Two things to check before build — spelling variants (`R VISA`, `RVISA`, `RESIDENCE RENEWAL`) that would slip through, and how many rows `NOT LIKE '%CANCEL%'` removes from `161`/`737`. That second count measures how much of Refunded depends on this predicate working.

⚠️ **Residual risk to quantify before build.** Heads `161` and `737` also hold cancellation money. Publish how many of the candidate refunds sit on those two heads, so a reviewer can see how much of Refunded depends on the description test doing its job.

*Guard.* Every distinct `EXPENSE_ID` reached by the purpose-selected population is compared to this list. A surplus head is **published as an exception**, and is a **run failure only if it carries negative transactions** — an unlisted head holding refunds means recovery is being under-counted. An unlisted head with no negatives is logged, and its cases record recovery as **confirmed zero** rather than merely unmatched. Verified 2026-09-10: surplus head **`779`** carries **0 negatives** across 936 transactions, so nothing is hidden there. Separately — and *not* as a surplus head — the in-scope Cleaners head **`149`** carries 0 negatives across 211 transactions, noted for the same reason. `149` stays in R-VISA-HEADS unless §6.10 rules cleaners out.

---

**R-FEE-SCHEDULE** — the government fee by date. Owner: **P&C, pending Finance sign-off (§6.7)**.
Sourced 2026-09-10 by measuring every amount in the population with its own transaction-date window, not by eyeballing the audited cases.

| Fee | Window (first → last payment seen) | Payments | Channel |
| --- | --- | --- | --- |
| 555.00 | 2018-08-15 → 2018-11-25 | 52 | Noqoodi |
| 556.00 | 2018-10-04 → 2018-11-25 | 52 | Noqoodi |
| 476.00 | 2018-07-31 → 2020-03-25 | 447 | Noqoodi |
| 477.00 | 2018-07-31 → 2018-11-26 | 414 | Noqoodi |
| 496.00 | 2018-11-26 → 2019-11-27 | 1,696 | Noqoodi |
| 497.00 | 2018-11-27 → 2019-11-26 | 1,498 | Noqoodi |
| 396.00 | 2019-12-03 → 2020-06-23 | 780 | Noqoodi |
| 397.00 | 2019-12-03 → 2020-06-23 | 695 | Noqoodi |
| 393.50 | 2020-06-27 → 2023-05-16 | 13,515 | Noqoodi |
| 443.50 | **2023-05-17** → present | 44,100 | Noqoodi |
| 457.46 | 2025-07-07 → present | 5,354 | Credit_Card |
| **343.50** | **1-year tier**, 2023-05-17 → present | 90 | Noqoodi |
| **293.50** | **1-year tier of the 393.50 era** (proposed, §6.13) | 11 | Noqoodi |

**Fee matching.** A payment matches a schedule entry when the entry is valid on the payment's **transaction date** and `amount − fee` is 0 or a positive multiple of 50 (an overstay day). Where more than one entry matches, take the **largest** — it attributes the least to fines, and the windows are built so this is never contested. A payment matching no entry is **T3 BLOCKED**, never an input to T1.

⚠️ **Amounts 50 apart are indistinguishable from a fee plus one fine day, so every window must be disjoint within a residue family.** Verified: 496→396 and 497→397 succeed with no overlap. 393.50 and 443.50 appeared to overlap for 27 months until measured — across that span 393.50 has **13,437** payments and 443.50 has **nine**, so those nine are fine-shapes and 443.50's era begins the day after 393.50's ends. Re-run this check whenever a fee is added.

🔴 **CORRECTION 2026-09-10 — `343.50` is the 1-year R-visa rate, not a partial payment.** Two independent company sources say so: the internal tariff sheet *visa steps cost* (`1Apz6DNFjQwqx2hwvyGjJpYnCGJng85EAn99z4CSDUaU`, Omar El Joueidi, Dec 2025) — *"AIO: 457.46 2-Year (incl. VAT), MOHRE: 443.5 2-Year / MOHRE: 343.5 1-Year"* — and the *Visa Expenses Master Guide – Policing Department* §4.4.7 — *"~343.50 AED for 1-year R-Visa; ~443.50–457.46 AED for 2-year R-Visa."* The 1-year AIO rate has never been paid. The earlier rejection reasoned only from monthly volume and was wrong: 343.50 is a **different product tier**, not a shortfall.

**Consequence.** The schedule gains a second axis — **term**, not just date. A payment must be priced against the tier that matches the visa actually issued, and `443.50 − 343.50 = 100` is a term difference, not two overstay days. Dependent figures needing recomputation before v6 is signed: the 46 excess fee payments, Duplicated AED 20,344.50, and every fine residue measured against a 443.50/457.46/393.50 base. **Measured blast radius on the duplicate finding: 2 payments in 2 cases (`24296`, `27713`), both 2024** — small, but the fee-residue arithmetic is affected population-wide.

⚠️ **Still rejected as era fees — partial payments, not prices.** `472.50` (110 payments / 23 months, 2020-07 → 2022-12, which is what rules it out of case `36025`'s 2024 payment) and `418.50` (10), against 443.50's 919 per month.

🟡 **`293.50` moved out of the rejected list, on inference not on a source.** The term step is **100 dirhams** (443.50 − 343.50). Applied to the previous era that gives 393.50 − 100 = **293.50**, and 11 payments carry it. No document states it and no case in the 53-row residue shows a 293.50 payment directly, so this is the weakest row in the schedule. It is admitted because excluding it silently reclassifies 11 real 1-year visas as underpayments; it is flagged in §6.13 for confirmation.

⚠️ **Fee does not vary by contract type.** Measured across the 393.50 era: CC and MV split evenly over all four shared heads. The schedule is one-dimensional — date only. Do not add a CC/MV axis on the assumption one must exist.

⚠️ **`AMOUNT` sometimes holds the all-in total.** 117 payments (2024-11 → 2026-09) carry `fee + 3.00 + 0.15` with `CHARGE` and `VAT_CHARGE` null — e.g. 446.65 for a 443.50 fee. Where `CHARGE IS NULL` and the amount equals a schedule fee plus the channel charge, the government fee is that schedule fee. A standing pattern, not an anomaly.

⚠️ **Incomplete before 2018-07.** No amount clears the volume floor earlier, though payments exist from 2017-06 (D11). Any case whose payments predate 2018-07-31 is **T3 BLOCKED** until the schedule is extended. No case in the current population is affected.

⚠️ **Never derive the fee from the group being audited.** Using the within-group minimum inflated one case's base to 1,443.50 — a fee plus 1,000 of overstay — and put that overstay straight into the headline, breaching the scope ruling the formula existed to enforce. The same error recurred later as `MIN(matched fee)` across a case that spanned two eras. Price **each excess payment at its own matched fee**; there is no such thing as "the case's fee".

---

**R-REFUND-AMOUNTS** — recognised R-visa refund values. Owner: P&C, **provisional (§6.5)**.
`239.50` (2025-02 onward) · `189.00` (2020 → 2024) · `189.50` · `289.50`.
*Guard:* a negative on an R-visa head at an unrecognised amount does not count as recovery; publish the count. All 18 candidates found in the current run matched one of the four.

**THRESHOLDS** — six numeric cutoffs decide verdicts. Each needs an owner and a derivation, exactly as the lists above do.

| Cutoff | Used by | Currently holds | Source | Owner |
| --- | --- | --- | --- | --- |
| **50** — fee-match **tolerance** (v7: no longer an "AED fine step") | The fee-match rule only | Everything. It is why 493.50, 543.50, 1,293.50 and 8,943.50 still price at their era fee | ✅ **Reclassified, §9.5.** This spec makes **no claim about how the authority prices anything** through this number. It is the modulus that lets a payment carrying an unrelated add-on still be recognised as carrying its era fee. Sensitivity is a property of this matcher, not of a tariff — which removes the constant `DNA-9529` was withdrawn over | **P&C (owns the matcher). Finance sign-off no longer required for this row** |
| **180** days of remaining cover | T6 cover window | Reclassifies **708 pairs** from suspect to renewal | ✅ **Measured, 2026-09-14.** The distribution of remaining cover decays smoothly 396 → 203 → 109 across the 61-90 / 91-120 / 121-180 bands, then **collapses to 5** in 181-270. A 22× cliff at 180 is where the renewal population ends. Corroboration to verify, not to rely on: `VPMGOV-1508` sets a renewal gate at `labor card expiry − today > 180` | Visa team (§6.8) |
| **180** days | Recovery window, upper bound | The widest a refund may lag the last payment | ⚠️ **Assumed.** All 18 candidates land within 15 days, so the window could close far tighter | Finance (§6.5) |
| **first excess payment** | Recovery window, lower bound | 3 cases, AED 618.50 | **Derived, not assumed** — a refund cannot reverse a payment that has not happened | P&C |
| **50%** match-rate floor | Withholds all recovery for a period | Nothing today — see the match-rate metric | ⚠️ **Assumed**, and the rate it gates was undefined until v4 | P&C |
| **100,000** AED · **2016-01-01** | T1 BLOCKED bounds | Nothing — never triggered | ⚠️ **Assumed**, and never sized against the population | P&C |

⚠️ **The 50-step does more work than any list in this section.** It is the entire tolerance of the fee match: widen it and fines become fees, narrow it and every fine-bearing payment falls to T3. It is currently an inference from the shape of the data. Get the tariff.

**BATCH-DATES** — `2020-02-24`, `2020-03-17`→**`2020-03-18`**. Owner: P&C, **provisional (§6.3)**.
⚠️ Stated on the **transaction** clock (D12b). The line-creation dates are one day earlier; an earlier draft used those and the test matched **zero** cases while the batch plainly existed.
*Guard:* the count of **payments** on these dates must be stable run to run — payments and cases are different denominators and both must be published. Currently **18 payments (11 on 2020-02-24, 7 on 2020-03-18) across 18 cases** inside the multi-payment population; the population-wide payment count on those two dates is **not yet measured** and must be before publication.

### 2.6 What an R-visa "fine" actually is — and who bears it

🔴 **v5 priced above-tariff residue as overstay days at AED 50/day. That constant belongs to a different node.**

The Alert-931 threshold sheet carries a column headed **"May include Fines?"**. **R-visa is `FALSE`. Only E-ID is `TRUE`.** By the company's own control definition an R-visa payment above tariff is an **overspend to be explained**, not a fine to be accepted.

The real R-visa fine is a different charge entirely, and the tariff names it:

> **R-visa Modification → Update Personal Information in Immigration →** *"most of the times the amount is 143.5 and it could be 243.5, it is not clear why they rarely vary"*

and the Master Guide §2.4 defines the service: *"Modify Person Information in MOHRE / Immigration — corrects mistakes in name, passport number, nationality, etc."* **It is the cost of re-submitting data we typed wrong.** Operational evidence: `RPA-3655` *"Incorrect Document Uploads During 'Apply for R-Visa' Step"*, a month of cases, ending with a residency issued under a misspelled name after the correct spelling had been flagged the day before.

Two consequences for this spec:

- **A 50-step residue test cannot see it.** `143.50 mod 50 = 43.50`. A modification charge riding inside an R-visa payment was never detectable by v5's arithmetic, and conversely any 50-step residue found here is overstay arithmetic that belongs to the overstay audits, not to R-visa.
- **It has its own heads** — `1622` / `1649` / `1735`. Those rows should be priced at 143.50 / 243.50 and scored as a document-error cost, never against the residence fee.

**Who bears it.** ERP **Alert 970 (Money Lost — Expenses Should Be Added as a Loan but Are Not)** carries the authoritative loan-mapping table of 17 expense types that must become a maid loan. `OVERSTAY_FINES_FEES` is in it, **CC only**, sourced from `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS.OVERSTAY_FEE` — a real column, and a far better source than deriving fine days from a residue. **No R-visa item appears in that table at all, modification included.** So the company shouldering an R-visa fine is the **expected** state, not a finding.

➡️ The finding is therefore **"a fine was paid and nobody assessed whose fault it was"**, never "no loan exists". A rule written the second way reds every case. The E-ID node is the only one in the flowchart with an explicit fault rule — *"if the EID was lost and a replacement requested, confirm whose fault it is; if the maid's, charge it to her loan"* — and no equivalent is written for R-visa.


### 2.5 Data hygiene traps

| Trap | Detail | Consequence if ignored |
| --- | --- | --- |
| **Line vs payment grain** | Two lines can share one `TRANSACTION_ID` | One payment counted as two; money invented |
| **Null transaction** | 1,770 lines with no `TRANSACTION_ID` | A booking with no payment counted as money out |
| **Two clocks** | D11 line-creation runs one day before D12b transaction date | Any dated list (BATCH-DATES, fee eras) silently misses by a day |
| **`AMOUNT` inconsistently booked** | 117 rows hold the all-in total, charge/VAT null | Fee comparisons off by 3.15; `.65` endings in a government-fee sum |
| **`AMOUNT` outlier** | Profiled max ≈ 19.7 trillion | Unguarded `SUM` meaningless. **BLOCKED, never filtered out** |
| **Asymmetric head predicate** | Description test applied to payments but not refunds | Entry-visa refunds credited as R-visa recoveries |
| **50-step fee ladder** | Era fees 50 apart are confusable with fee + 1 fine day | A partial payment reads as a second full fee |
| **Two enum vocabularies** | `OWNER_TYPE` uses `'HOUSEMAID'`; D14's `RELATED_TO_TYPE` uses `'MAID'` | Silent zero rows across the ledger boundary |
| **Two sign conventions** | Refunds are negative on D12c, positive on D14 | Recovery totals with the wrong sign |
| `PAYMENT_DATE` sentinel | Minimum `0025-11-06` | Two-thousand-year arithmetic. Do not use; use D12b |
| `CONTRACT_TYPE` trailing space | `'CC '`, `'MV '` | Equality joins match nothing; always `TRIM` |
| `IS_DELETED` is TEXT | Only ever `'0'` | Boolean comparison matches nothing, reads as "none deleted" |
| `DESCRIPTION` personal data | Maid names; passport numbers from 2026-01 | See §4. Permitted as a predicate, never selected |

**Join.** `VISAREQUESTEXPENSES.TRANSACTION_ID` → `TRANSACTIONS.ID`, both NUMBER(38,0), no cast.

---

## 3. Metric Calculations

### 3.1 Populations — two, named separately

| Name | Definition | Size |
| --- | --- | --- |
| **All R-visa payments** | `PURPOSE IN R-VISA-PURPOSES AND OWNER_TYPE = 'HOUSEMAID' AND TRANSACTION_ID IS NOT NULL`, collapsed to one row per distinct `TRANSACTION_ID` | **69,218 payments** across **69,124 cases** |
| **Multi-payment cases** | Cases (`VISA_REQUEST_ID`, `PURPOSE`) within that population holding **more than one** payment | **90 cases · 184 payments · 94 excess** |

⚠️ `STATUS` is **not** a population filter. Scope is defined by the audited record — money that left — and line status is a test outcome (T7). Filtering on it would delete a paid-then-`Dismissed` duplicate from every count, every total and every tie-out with nothing on the report saying it existed.

⚠️ **Scope is per test, not global.** An earlier draft said "tests run over all 69,124 cases" so that T5 could fire on `12822`. That fixed one dead test and created a larger fault: T3 blocks any case holding a payment that matches no schedule entry, and §2.4 names **221 population payments at amounts the schedule rejects** — almost all in single-payment cases. Run globally, T3 alone blocks hundreds of cases that were never counted, and the published clean total is that much too high.

| Test | Scope | Why |
| --- | --- | --- |
| **T0** payment usable · **T5** line integrity · **T7** line status | **All cases** | Input and booking guards. A single-payment case is the only place T5's defect can appear — and **T0 is why the 19.7-trillion outlier in §2.5 cannot be reported clean.** |
| **T1** · **T2** · **T3** · **T4** · **T6** · **T8** · **T9** | **Multi-payment cases** | Duplicate-shape tests. A single payment cannot be a duplicate, and blocking one for an unexplained amount answers a question this report does not ask — that belongs to the price-accuracy audit (§6.11). |

⚠️ **T0 exists because scoping T1 to the 90 put the input guards out of reach.** T1 alone carried the null / negative / >100,000 / bad-date bounds, and §2.5 records a profiled max `AMOUNT` of ≈19.7 trillion with the rule "BLOCKED, never filtered out". Confine those bounds to multi-payment cases and a single-payment case holding that row is counted **clean** — the clearance defect arriving through the scope table. T0 carries them over the full population instead.

⚠️ **M5's clean and blocked totals must be produced by the run, not extrapolated.** The v3 figures were measured inside the 90 and published population-wide. Under the scoping above the only tests reaching single-payment cases are T5 and T7, both measured: T5 fires once, T7 never.

Every metric states which population it reads.

### 3.2 Verdict algebra

Let `A` be the tests applicable to a case.

```
RED    ⟸ any test in A returned RED
AMBER  ⟸ not RED, and any test in A returned BLOCKED
GREEN  ⟺ every test in A RAN and returned GREEN
```

- **No early exit.** Every applicable test is evaluated; all outcomes go in a trace column. The ladder is display precedence for the *reason*, never control flow.
- **Every test returns exactly one of** `RED(type)` / `GREEN` / `BLOCKED(reason)` / `NOT_APPLICABLE`.
- **One verdict column, computed once.** Every tile, chart, filter, colour and export aggregates it. Nothing re-derives eligibility.
- **Three states only.** There is no "excluded". A case we chose not to score is **AMBER with a reason**, so it stays in every denominator. Workflow status (`New` / `Under review` / `Escalated` / `Closed`) is a separate column and **must not feed any filter default that changes a metric**.
- **A clearing test never cancels a fired finding.** One RED outweighs any number of GREENs; one BLOCKED outweighs any number of GREENs.

### 3.3 The tests

| Test | RED | GREEN | BLOCKED | NOT_APPLICABLE |
| --- | --- | --- | --- | --- |
| **T0** payment usable | — | Every payment has a non-null amount in `[0, 100,000]` and a non-null transaction date in `[2016-01-01, today]` | Any payment fails either bound, reason `unusable-input` | — |
| **T1** duplicate fee | ≥ 2 payments in the case match R-FEE-SCHEDULE | 0 or 1 such payment | — *(input plausibility moved to T0)* | Case has one payment |
| **T2** batch posting | — | No payment falls on a BATCH-DATE | Any payment falls on a BATCH-DATE — its nature is a P&C inference, not established | — |
| **T3** unexplained amount | — | Every payment matches a schedule entry | Any payment matches none. Reason `sub-fee-payment` when the amount is below **the schedule fee valid on that payment's own transaction date**, `amount-unexplained` otherwise | Case has one payment |
| **T4** channel switch | N1 confirms the card charge was **not** reversed | N1 confirms it **was** reversed | Pending N1, reason `card-reversal-unknown` | Payments do not span two `PAYMENT_TYPE` values |
| **T5** line integrity | — | Each payment maps to exactly one line | Two or more lines share one `TRANSACTION_ID`, reason `line-integrity` | — |
| **T6** cover window | — | The second fee falls **after** the first term expired, i.e. `gap ≥ term_days − 180` (term from the price, §0.2) | A payment in the case matches no schedule entry, so no term can be assigned — reason `term-unknown` | Case has one payment |
| **T7** line status | — | Every payment's line is `Added` | Any paid line is `Dismissed` or `Pending` | — |
| **T8** case identity | — | All payments resolve to one `HOUSEMAID_ID`, or to none | Payments resolve to **more than one** maid, reason `two-maids-one-case` | Case has one payment |
| **T9** refund before duplicate | — | Set A is non-empty and no member predates the first excess payment | The earliest member of **Set A** (§3.4) predates the first excess payment — pay → partial refund → pay again reads as a correction cycle, not a duplicate | **Set A is empty** |

**T1 names no class.** A batch posting at 196.00 matches no schedule entry, so it never counts as a second fee payment; T3 then blocks the case rather than T1 being suppressed by a lookup table. Classification is the *reason*, never the gate.

**T7 is a guard, not an open risk.** Measured: 0 of 69,218 paid lines carry any status but `Added`. D5's other values cannot affect a verdict in this population. It stays in so a future change is caught, and publishes a count of 0.

**T8 accepts a missing maid.** Zero maids is not a contradiction — it is 2019 under-instrumentation, and it makes *recovery* Unknown, not the verdict AMBER. Only two different maids on one case blocks.

### 3.4 Recovery — evidence, not a verdict

**Why this is probabilistic at all.** A deterministic refund→payment key exists in the warehouse (D14) and was tested against this population on 2026-09-10: **zero overlap**, against 11,993 linked transactions in that ledger — it serves the money-control request pipeline, not the visa pipeline. No key bridges the two. Everything below therefore matches on maid, head, amount and time, and every safeguard exists because that is a weaker join than an id. **Do not replace it with a "simpler" lookup without re-running the D14 test.**

Recovery is computed per confirmed case and **cannot alter the verdict**.

**Two named sets, because one window cannot serve both jobs.** An earlier draft defined a single candidate set opening at the *first excess payment* — which made T9, the test for a refund that arrives *before* the duplicate, structurally unable to fire. Its BLOCKED branch was unreachable and its GREEN a tautology.

- **Set A — `case negatives`.** Every D12 row with **`TRANSACTION_TYPE = 'Refund'`** on a head in **R-VISA-HEADS** (shared heads additionally passing the D12f description test), same `HOUSEMAID_ID`, dated **from the case's first payment** to 180 days after its last. Amount is *not* filtered here.
  → **T9 reads Set A.** BLOCKED when Set A is non-empty and its earliest member predates the first excess payment.
  → **M11's denominator is Set A.**
- **Set B — `attributable recovery`.** The members of Set A dated **at or after the first excess payment** whose amount is in R-REFUND-AMOUNTS.
  → **M2 sums Set B.** A refund that cannot reverse a payment which had not yet happened is evidence about the case, not money back on it.
- ⚠️ **Match on the declared type, not on the sign.** `TRANSACTION_AMOUNT < 0` is an inference about what a row means; `TRANSACTION_TYPE` is the row saying so. Keep the sign test as a **cross-check** and publish the count where the two disagree — a `Refund` row with a positive amount, or an `Expense` row with a negative one, is a booking defect worth surfacing rather than silently picking one predicate.
- ⚠️ **Set B opens at the first excess payment; Set A opens at the first payment.** A refund predating the duplicate cannot be a recovery of it — but it must still be *seen*, or T9 cannot fire. Three refunds (AED 618.50) were credited as recoveries in an earlier run; under this split they sit in Set A, keep those three cases blocked at T9, and contribute nothing to M2.
- **More than one member of Set B → the case's recovery is `Unknown`**, never "take the first". *Currently no case has more than one.* The nearest-in-time candidate is shown in the drill-down for the reviewer, but **it does not become the recovery** — display only, so the two rules cannot contradict.
- **Consumed once.** A refund may be attributed to at most one case.
- **No maid id → recovery `Unknown`.** Publish that count. *Currently 3.*
- **Zero candidates → `Unrecovered`**, provided the maid id resolves and the head guard passed. Where the head guard published a surplus head carrying negatives, zero candidates reads **`Unknown`** instead — the refund may exist somewhere the matcher cannot see. *This branch decides 27 of the 45 confirmed cases and most of the headline, so it is stated rather than left to fall through.*
- **Match rate *(M11)* — published per period.** Defined as **candidate refunds attributed to a case ÷ candidate R-visa negatives found in the window**. Below 50%, recovery reads `Unknown` for the whole period — an absence is not evidence when the matcher is unreliable.
  ⚠️ Precisely: **numerator** = members of Set A attributed to exactly one case as recovery (i.e. Set B, after the tie-break); **denominator** = all of Set A. Amount is deliberately *not* filtered in the denominator, so a period where refunds arrive at unrecognised amounts drives the rate **down** — which is the signal the floor exists to catch. Defined the other way round, with the amount filter on both sides, the ratio is ~1 by algebra and the floor can never fire.
  ⚠️ **Not** "confirmed cases carrying a refund ÷ confirmed cases". That reading gives 15/45 = 33%, below its own floor, and would zero out Refunded and add AED 3,491.00 to the headline. Two readings, either side of the cutoff — the definition is load-bearing.
  **Current value: 18 / 18 = 100%** — every negative found in Set A resolved: 15 attributed to recovery, 3 holding their case at T9.
- **Chance baseline.** Publish, beside the observed recovery rate, the per-maid chance that one of that maid's own R-visa negatives lands in the case window by geometry alone — `1 − (1 − p)^k`, `p = window_days / that maid's observation_days`, `k` = that maid's count of R-visa negatives, computed **per maid and summed**, never on the cohort mean. Also bin refunds by signed distance from the last payment: a real recovery decays toward the payment, a flat distribution means the window is talking to itself.
  ✅ **Measured 2026-09-10 and it passes decisively:** 12 of 18 candidate refunds fall on the **exact day** of the last payment, the rest within a fortnight. That is not a flat distribution — it is a duplicate spotted and partly reversed the same day.

---

### Duplicated fees *(M1)*

- **Definition.** Government fees paid more than once for the same application or renewal, at the era fee, excluding overstay.
- **Population.** Multi-payment cases, verdict confirmed.
- **Formula.** `SUM(matched fee)` over every payment in the case except the earliest that matched. **Not** `(payments − 1) × one fee` — a case can span two eras, and a non-matching payment is not a duplicated fee.
- **Inputs.** D2, D3, D4, D6, **D7, D8** (the all-in rule needs both to recognise a `fee + 3.15` booking), D12b, R-FEE-SCHEDULE, THRESHOLDS (the 50 step).
- **Filters.** The population definition only. **No amount range filter** — an implausible amount is T1 BLOCKED, not a deleted row.
- **Currency.** AED, no FX. **Rounding.** 2 dp at case level, then summed.
- **Nulls.** Null amount → T1 BLOCKED → case AMBER → contributes 0.
- **Division by zero.** N/A.
- **Current value.** **AED 20,344.50** — 45 cases, 46 excess payments.

### Refunded *(M2)*

- **Definition.** Refunds attributable to confirmed cases.
- **Population.** Multi-payment cases, verdict confirmed, recovery ≠ `Unknown`.
- **Formula.** `SUM(min(matched refund, case duplicated fees))`.
- **Inputs.** D12a, D12b, D12c, D12d, D12e, D12f, R-VISA-HEADS, R-REFUND-AMOUNTS, THRESHOLDS (180 days, first-excess bound).
- **Filters.** §3.4's candidate definition only.
- **Currency.** AED, no FX. **Rounding.** 2 dp at case level, then summed.
- **Nulls.** No maid id → recovery `Unknown` → contributes 0 and is excluded from this population, not counted as zero recovery.
- **Division by zero.** N/A.
- **Current value.** **AED 3,491.00** across **15 cases**. **Zero fully recovered.**

### Still out *(M3 — the headline)*

- **Definition.** Duplicated fees not returned. What the company is still down.
- **Formula.** Duplicated fees − Refunded.
- ⚠️ **The two sides are computed over different populations** — M1 over all confirmed cases, M2 over confirmed cases with a resolvable recovery. Subtracting them is safe **only while every `Unknown`-recovery case contributes 0 to M2**, which holds today (all 3 have no maid id and no matched refund). It is not an identity; assert it. A future `Unknown` case with a partial match would make M3 overstate.
- **Inputs.** M1, M2.  **Filters.** none.  **Currency.** AED, no FX.  **Rounding.** 2 dp.
- **Nulls.** A null on either side propagates; both are `SUM`s over non-null contributions, so N/A in practice.
- **Division by zero.** N/A.
- **Current value.** **AED 16,853.50**.
- **Threshold.** No green band — any exposure is a finding. Cases sort by this, descending.

### Pending a ruling *(M4)*

- **Definition.** Value that becomes exposure if the outstanding rulings go against us.
- **Population.** Multi-payment cases, verdict AMBER.
- **Formula.** Same as Duplicated fees, over blocked cases.
- **Inputs.** as M1.  **Filters.** verdict = blocked.  **Currency.** AED.  **Rounding.** 2 dp at case level.
- **Nulls.** A blocked case with no matched fee contributes 0 — **25 of the 45** do; the other 20 carry one matched excess fee each.
- **Division by zero.** N/A.
- **Current value.** **AED 8,873.50** across **45 cases**.
- ⚠️ A blocked case contributes only its *matched* excess fees. A batch case (496.00 plus a 196.00) contributes **zero** — the 196.00 is not a duplicated fee, it is an unexplained payment. Pricing every blocked case at `(payments − 1) × era fee` instead gives **AED 21,912.56**, overstating by 13,039.06; the nearest wrong variant, `(fee-payments − 1) × era fee`, gives 8,978.56.

### Cases by verdict *(M5)*

- **Population.** All cases.
- **Formula.** `COUNT(DISTINCT case_id)` by the single verdict column, `case_id = TO_VARCHAR(VISA_REQUEST_ID) || '·' || PURPOSE`.
- **Nulls.** D2 is non-null on the audited record; where no case key resolves, mint a surrogate so the record stays countable.
- **Current value.** **45 confirmed · 46 blocked · 69,033 clean** *(45 blocked within the 90 multi-payment cases, plus `12822` blocked at T5 with one payment)*.

### Exception rates, both denominators *(M6)*

- **Formula.** Two ratios, with **three** distinct numerators in play. Name them apart:
  - *confirmed cases* (45) / *multi-payment cases* (90) = **50.0%**
  - *excess fee payments in confirmed cases* (46) / *all payments* (69,218) = **0.066%**
  - *all excess payments, every shape* (94) / *all payments* (69,218) = **0.136%**
- **Inputs.** M5, §3.1.  **Filters.** none beyond the population.  **Rounding.** 1 dp.  **Nulls.** N/A.
- **Division by zero.** Renders "—", not 0%.
- ⚠️ **"Excess" is overloaded and that is how a wrong number gets published.** §3.1 uses it for all 94 extra payments; M1 uses it for the 46 that are duplicated *fees* inside *confirmed* cases. A builder reading "excess payments / all payments" from an earlier draft would have published 0.136% on a tile the spec labels 0.066%. Always qualify the word.
- **Current value on the tile — every string carries its own denominator**, because the label is where this goes wrong:
  - "**50.0%** of multi-payment cases are confirmed duplicates (45 of 90)"
  - "**0.13%** of requests were paid more than once (90 of 69,124)"
  - "**0.066%** of all R-visa payments are a duplicated fee (46 of 69,218)"
  ⚠️ An earlier draft's tile read *"50.0% of requests paid more than once"* — a sentence whose true value is 0.13%, published on the KPI strip. Never state a rate without the denominator inside the same string.

### Exposure by year *(M10)*

- **Population.** Multi-payment cases, all verdicts.
- **Formula.** The money metrics grouped by the **year of the case's last payment** (D12b).
- ⚠️ **A case is attributed to the year it closed, not the year it opened.** A case running 2021 → 2023 counts in 2023. Do not read a zero year as "no duplicates that year".

| Year | Confirmed | Duplicated | Refunded | **Still out** | Blocked | Pending |
| --- | --- | --- | --- | --- | --- | --- |
| 2018 | 1 | 476.00 | 0.00 | 476.00 | 0 | 0.00 |
| 2019 | 4 | 1,985.00 | 0.00 | 1,985.00 | 0 | 0.00 |
| 2020 | 0 | 0.00 | 0.00 | 0.00 | 21 | 497.00 |
| 2021 | 3 | 1,180.50 | 0.00 | 1,180.50 | 3 | 393.50 |
| 2022 | 0 | 0.00 | 0.00 | 0.00 | 0 | 0.00 |
| 2023 | 4 | 1,624.00 | 567.00 | 1,057.00 | 3 | 1,330.50 |
| 2024 | 10 | 4,435.00 | 0.00 | 4,435.00 | 5 | 887.00 |
| 2025 | 14 | 6,209.00 | 1,197.50 | 5,011.50 | 2 | 887.00 |
| 2026 | 9 | 4,435.00 | 1,726.50 | 2,708.50 | 11 | 4,878.50 |
| **All-time** | **45** | **20,344.50** | **3,491.00** | **16,853.50** | **45** | **8,873.50** |

⚠️ **The blocked column totals 45, not the 46 in M5** — M10's population is multi-payment cases, so case `12822` (one payment, held at T5) is correctly absent here and correctly present there.
⚠️ **Prior years are not frozen.** A third payment arriving on an existing case restates the year that case previously sat in, because attribution follows the *last* payment. Publish the as-of date on the table; 12 cases already span more than 300 days, so the shape is live.

**Three readings this table is here to force.**

1. 🔴 **The rate is rising, not decaying.** AED 8,607.00 still out across 25 confirmed cases in the last 24 months — over half the all-time exposure. The all-time average is ~2,100/year; the current run-rate is ~4,300, with 2026 only eight months old. A reader shown AED 16,853.50 over eight years concludes "immaterial, historic". That conclusion is wrong and this table exists to prevent it.
2. **Nothing before 2023 was ever recovered.** The earliest refund in the population is 2023-02-13. AED 3,641.50 from 2018–2021 is total loss with no recovery attempted. Recovery practice began in 2023 and only became consistent in 2025.
3. **2020 is the batch and nothing else** — 21 blocked, 0 confirmed, all resting on the one unanswered question in §6.3.

### Recovery distribution *(M7)*

- **Population.** Multi-payment cases, verdict confirmed.
- **Current value.** Unrecovered **27** · Partial **15** · Full **0** · Unknown **3**.

### Non-overlap with the sanctioned detector *(M8)*

- **Formula.** Count of distinct payments in multi-payment cases present in D13.
- **Current value.** **0 of 184**, and 0 of 69,218 overall.
- **The zero is structural, not lucky.** D13 is built on `EXPENSES_REQUESTS`, the money-control pipeline; it **cannot see visa-request expenses at all**. Its own model documentation disclaims it: *"NOT a certified/authoritative source — a rule-based, name/amount-matching heuristic (no unique transaction-level dedup key is checked) … treat results as leads to investigate, not confirmed duplicate payments."* It matches on expense type + amount + related party over `request_status = 'PAID'` only. Neither authoritative nor pointed at this ledger.

### Coverage waterfall *(M9)*

| Step | Lines / payments | Note |
| --- | --- | --- |
| R-visa lines in D1, both purposes | **71,791** ✅ | Ties to D3: 54,554 + 17,237 = 71,791. |
| less `OWNER_TYPE = 'OFFICE_STAFF'` | 802 | |
| less null `TRANSACTION_ID` | 1,770 | Bookings with no payment |
| less lines sharing a transaction | 1 | Collapsed to payment grain — one line, request `12822` |
| **= All R-visa payments** | **69,218** | |
| *memo:* payments whose line is not `Added` | **0** | Not a deduction. Sized here, tested at T7 |
| *memo:* transactions on R-visa heads with no visa line | 981 | **Outside the case grain, reconciled separately** — not a deduction and not a verdict. They have no case key, so calling them "blocked" put 981 records in a state nothing counts. They belong to tie-out 1, as a named line. |
| *memo:* payments in the population whose `TRANSACTION_ID` resolves to no D12 row | **0** ✅ | **Measured 2026-09-10 — every payment in the 69,218 resolves to a transaction, so none is scored on a clock it does not have.** The 1,532 figure quoted in earlier drafts counted a wider set (other owner types and unpaid lines) and does not belong in this waterfall. Re-run each refresh: a non-zero here means payments are being fee-matched and date-tested against nothing. |

✅ **The deduction chain reconciles: 71,791 − 802 − 1,770 − 1 = 69,218.** Re-run each refresh; a residual is a run failure.

✅ **The opening line ties to D3** — 54,554 + 17,237 = 71,791 — and zero payments in the population lack a transaction, so nothing is scored on a clock it does not have. T1's null-date bound stays in as a guard rather than a live condition.

⚠️ **Both are run guards, not one-time checks.** The purpose counts and the unlinked-payment count are re-measured every refresh; either drifting is a run failure, because the first breaks the waterfall's opening balance and the second means payments are being fee-matched against no date.

### Tie-out rules

Two identities, each with its two sides drawn from **different objects**.

```
1. COUNT(DISTINCT TRANSACTION_ID) in All R-visa payments        [visa ledger, D1]
 = COUNT(DISTINCT ID) in D12 on R-VISA-HEADS,
   TRANSACTION_TYPE = 'Expense',
   shared heads passing R-VISA-DESCRIPTION-TEST                   [money ledger, D12]
 + every reconciling line below, each measured and shown
   residual after the named lines must be 0

2. Σ ( AMOUNT
     + COALESCE(CHARGE, 0)
     + COALESCE(VAT_CHARGE, 0) )  in D1 for payments in multi-payment cases
 = Σ TRANSACTION_AMOUNT in D12 for the same transaction ids
   residual displayed; the only external money control available
```

🔴 **The `COALESCE` is not cosmetic.** D7 and D8 are both nullable and **58 of the 184 case payments carry NULL in both** — every pre-2021 row, plus the all-in bookings. `AMOUNT + NULL + NULL` evaluates to NULL, `SUM` skips the row, and the left side silently drops **AED 21,660.30**. Written without the coalesce this identity shows a large residual on its first run and every run after, and a tie-out that always fails is one an operator switches off.

**Both sides, as numbers.** Left side, coalesced: **AED 88,966.11** (= 88,603.86 of `AMOUNT` + 345.00 of `CHARGE` + 17.25 of `VAT_CHARGE`). 🔴 **The right side is not yet measured**, and the expected residual turns on one question: does `TRANSACTION_AMOUNT` carry the gateway charge, or only the government fee? If only the fee, this identity carries a permanent **362.25** residual because the charge is booked on the visa line and never reaches the money ledger — in which case tie `AMOUNT` to `TRANSACTION_AMOUNT` directly and reconcile the 362.25 as its own named line. Settle before publication; a tie-out with an unexplained standing residual gets switched off.
```sql
SELECT ROUND(SUM(TRANSACTION_AMOUNT),2) FROM BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS
WHERE ID IN (<the 184 transaction ids>);   -- 88,966.11 or 88,603.86?
```
*Guard:* publish the count of rows where `CHARGE IS NULL`, so the coalesce cannot mask a change in booking practice. Currently 58 of 184, spanning 2018-10-29 → 2026-08-01 — not a legacy-only shape.

**Identity 1's reconciling lines — all five, because the two selections differ in five ways and an unexplained residual gets a tie-out switched off:**

| Line | On the left? | On the right? | Value |
| --- | --- | --- | --- |
| Orphan transactions — R-visa head, no visa line | no | yes | **981** |
| Payments on head `779` — mis-booked, head deliberately excluded | yes | no | **3** |
| Payments on any surplus head the guard publishes | yes | no | *from the guard* |
| Payments on shared heads whose description fails the test | yes | no | 🔴 **not yet measured — potentially thousands.** The shared heads span 2018 → late 2025, the whole legacy era |
| Payments whose transaction row is absent | yes | no | **0** (measured 2026-09-10) |

🔴 **The fourth line must be sized before this tie-out is built** — it is the difference between a control with a small named residual and one with a large unexplained one.

⚠️ The right side selects **`TRANSACTION_TYPE = 'Expense'`**, not `amount > 0` — the same declared-type rule §3.4 uses. Selecting on sign here while arguing against it there would turn the one booking defect the spec asks to surface into a silent residual.

⚠️ **Two shapes that look like tie-outs and are not.** `duplicated + pending + excluded = total` partitions one derived column. And `COUNT(DISTINCT TRANSACTION_ID) = Σ payments across cases` — which an earlier draft used as identity 1 — compares the payment population against a case table **built by grouping that same population**. It is an algebraic identity, not a control; it cannot produce a residual under any bug worth catching. If a proposed tie-out's two sides trace to one query, it is not a tie-out.

**Assertions that can fail:**

1. Every AMBER case has at least one non-null blocking reason.
2. Reason buckets sum to the AMBER total in **cases-with-that-reason**, not in disjoint counts — a case may carry several. Money is attributed once, to the case.
3. Every rendered verdict word is one of Confirmed / Blocked / Clean.
4. Every distinct `EXPENSE_ID` in the purpose-selected population is inside R-VISA-HEADS, or is published as an exception with its negative-transaction count.
5. Every payment resolves to exactly one line; the unmatched count is published and a change run-to-run is a run failure.
6. Every fee used is a member of R-FEE-SCHEDULE valid on that payment's transaction date.
7. Within any residue family, no two schedule windows overlap.
8. The M9 waterfall sums exactly.

---

### 3.6 The per-maid pair classifier — v6's primary instrument

The tests above run **per visa request**. They cannot see a maid charged on two different requests, which is where most of the money is. The classifier below runs **per maid**, over every priced R-visa fee payment she has ever had, and sorts each consecutive pair into one of four buckets. The request-level tests still run, as hygiene gates, on anything the classifier calls a finding.

**Inputs per pair:** the two payments' dates and matched fees; `term_days` = 365 if the first fee is a 1-year tier, else 730; the two `VISA_REQUEST_ID`s; and whether any cancellation-purpose expense for that maid falls strictly between the two payment dates.

| Bucket | Condition, evaluated in order | Verdict | Measured |
| --- | --- | --- | --- |
| **A** same request | `req = next_req` | **RED — duplicate.** No reading required | **68 pairs · 67 maids · 37 since 2025 · AED 29,905** |
| **B** renewal | `gap ≥ term_days − 180` | GREEN | **16,013 pairs**, median gap **716 d** against a 730-day term |
| **C1** re-application | a cancellation expense falls between the two payments | GREEN | **71 pairs · 62 since 2025** |
| **C2** paid while covered | everything else | **RED, subject to §3.7** | **53 pairs** |

⚠️ **Order is load-bearing.** B before C1 before C2. If C2 ran first it would red every renewal; if C1 ran before B, a maid who cancelled and then renewed two years later would be cleared for the wrong reason and the cancellation statistic would be wrong.

✅ **B is the check's own sanity test.** A median renewal gap of **716 days** against a term the spec independently derives as **730** is the strongest available evidence that pricing the term off the amount is sound. If that median ever drifts far from the term, the term rule is broken and every bucket below it is unsafe. **Publish it on every run.**

⚠️ **Grain warning — `VISA_REQUEST_ID` is not unique.** Measured 2026-09-14: every request id in the sampled window carries a `NewRequest` row for one maid **and** a `CancelRequest` row for a different, unrelated maid (e.g. `56223` → maids `30686` and `33958`). Cancel requests run their own colliding id sequence. Consequences: **T8 (`maids <= 1`) is mandatory, not defensive** — the per-request grain silently merges two people whenever an id collides; the classifier is safe because it partitions by maid first; and **anything keying on request id alone is exposed**, including DNA-9529's `COUNT(DISTINCT OWNER_ID)` acceptance criterion and VPMGOV-1670's ERP walk.

### 3.7 C2 splits into three shapes, and only one of them is a case to read

The 53 C2 pairs are not 53 independent findings. They carry three distinct mechanisms, and conflating them would report one control gap as twenty line items.

| Shape | Signature | Pairs | Reading |
| --- | --- | --- | --- |
| **S1** re-payer defect | old `RENEW_RESIDENCE` request → new `APPLY_FOR_RVISA` request, 21–129 day gap | **20 · AED 8,870** | **One process defect, not twenty errors** |
| **S2** term mismatch | ~365-day gap after a 2-year fee | **25** | A money finding of a different kind — §3.8 |
| **S3** unexplained | everything else, 9–18 month gaps | **8** | The manual queue |

**S1 — the re-payer defect.** Second request ids come in contiguous runs (`59182`–`59188`, seven consecutive; `56223`–`56224`) with **no re-payers on either side of the run**. Their maid ids are long-standing (12k–31k) with prior requests in the 8xxx range, while every neighbouring request in the same id block belongs to a freshly-created applicant (78xxx). So: **a new initial request is opened for a maid whose renewal is already in flight, and the fee is charged again.** Two occurrences three months apart (Nov 2024, Jan 2025), so it recurs and there are likely more outside the sampled id ranges.

⚠️ **First-expense timestamps span seven weeks, so these were not created and paid in one programmatic batch.** The ids were assigned together; the work happened case by case. Do **not** file this as a batch posting and do **not** add it to BATCH-DATES — that would suppress it. It is a live control gap, and the fix is a guard in ERP: refuse to open an initial R-visa request for a maid with an open renewal request.

**S3 is the only shape needing a person.** Eight cases, all-time.

### 3.8 New finding class — term mismatch (paid two years, got one)

25 pairs show a full 2-year fee followed by another full fee about 365 days later. **Six of them have a second payment of exactly `343.50`** — the 1-year tier — which says those maids are on an annual cycle and the *first* payment was priced as 2-year. Either we bought one year at the two-year price, or the visa was cut short.

This is **leg 2 of `Visa_Process_Audit_Flow.pdf`** — *"Confirm the 1-year or 2-year option matches the contract and the visa validity"* — appearing in the data for the first time. It is **not a duplicate**, and must not be added to the duplicated-AED total. It needs its own metric and its own owner.

🟡 **The measurement is now routed, not open — see §9.3.** The visa validity actually issued comes from `BA_VIEWS.VISA_SILVER.HOUSEMAIDS_VISA_INFORMATION` as `R_VISA_EXPIRY_DATE − R_VISA_ISSUANCE_DATE`, banded at 400 days, **deduplicated to one term per maid before joining** (the table is one row per request and fans out 5–20× otherwise), with NULL and negative terms held as `BLOCKED(term-unreadable)` rather than dropped. Query `Q-TERM` in the handover pack.

Until it has run, these 25 stay **AMBER with reason `term-mismatch-unverified`**, never RED. **And when it runs, the result is a COUNT first**: §9.5 forbids attaching money to this class until the 1-year tier is confirmed against the ERP rather than against the ledger's shape.


### 3.9 T10 — fine responsibility (the flowchart's third check)

§2.6 establishes the finding and stops there. This is the rule.

**Scope.** The Modification heads `1622` / `1649` / `1735` — *Update Personal Information in Immigration* — priced at **143.50**, sometimes **243.50**. **Not** the residence-fee payments, and **not** 50-step residue, which §2.6 shows belongs to the overstay checks.

**One case = one modification charge**, keyed on the maid. A maid charged twice for two different corrections is two cases; the duplicate question for these heads is out of scope here and belongs to T1's population if it is ever brought in.

| Test | RED | GREEN | BLOCKED | NOT_APPLICABLE |
| --- | --- | --- | --- | --- |
| **T10** fine responsibility | A modification charge exists and **no fault assessment exists for it** — no loan row, no written statement of who bears it, no linked complaint | A fault assessment exists, whoever it lands on — including a documented decision that the company bears it | The charge exists but the fault evidence cannot be read (no note, ambiguous note, evidence route unavailable), reason `fault-unassessed-unreadable` | The maid has no modification charge |

⛔ **The trap this contract is written against.** A rule of the form *"RED when no maid loan exists"* reds **every** case, because Alert 970's loan-mapping table contains no R-visa item at all — the company bearing the cost is the **expected** state (§2.6). Such a rule would be an assertion wearing a test's clothes. **T10 tests whether the question was ever asked, not what the answer was.**

**Who assesses fault, and what a RED asks for.** Nobody owns this today — that is itself the finding. The flowchart gives an explicit fault rule at exactly one node, E-ID: *"if the EID was lost and a replacement requested, confirm whose fault it is; if the maid's, charge it to her loan."* **No equivalent is written for R-visa.** A RED row therefore asks a named owner to make the E-ID ruling's counterpart for R-visa modifications: was the wrong data ours (RPA / data entry / the visa team) or the client's, and does the resulting charge become a maid loan, a client recharge, or a company cost? → §6.15 names the owner.

**M12 — document-error cost.** A **COUNT and an AED total at the modification heads**, by year, split by whether a fault assessment exists. Reported **separately from every duplicate figure** and never added to Duplicated AED — it is a different loss with a different cause. 🔴 **Unmeasured.** v6 §0.5 withdrew v5's fine-sizing numbers (AED 152,850 across 195 payments) as void — computed through `IS_DELETED = FALSE`, a predicate matching zero rows — and they have never been restated. **M12 starts from zero, not from those.** Query in the handover pack (`Q-FINE`).

⚠️ **Expect a small or empty result and do not treat that as failure.** v5 measured **0 payments** on heads 1622/1649/1735 in its population. Either the charge is booked somewhere else, or it is rare. A zero here is a real answer that redirects the question to §9.7's last sentence; it is not a reason to widen the scope until something appears.


---

## 4. Finalised UI Report

Mockup: https://claude.ai/code/artifact/3ce6b63e-afbb-4b45-8eff-d530f899e735 — restated here because a link is not machine-readable to the DNA intake bot.

**Layout.** KPI strip (Still out, AED · Confirmed cases, count · both exception rates with denominators · Unrecovered, **count and value** — 27 cases, AED 12,713.00) → filter bar → exception table → one chart (cases carrying each blocking reason) → **Controls panel**. One screen to the top of the table.

⚠️ **The reason chart is not a tie-out and must not be labelled one.** Within multi-payment cases, 45 blocked cases carry **71 reason-hits** (46 and 72 across all cases, including `12822`) — a case may be held for several, and all 18 batch cases are also part-payment cases. Label the axis *"cases carrying this reason (a case may carry several — 45 cases, 71 reason-hits)"*, or an operator will read 71 against a blocked count of 45.

**Controls panel — required, because §3 says these are published and nothing else on the page shows them.** Each row carries a pass/fail and the as-of stamp:

| Control | Passes when |
| --- | --- |
| Coverage waterfall | residual = 0 across all five lines |
| Tie-out 1 — payment counts, two ledgers | residual displayed, orphans and unlinked lines named |
| Tie-out 2 — money, two ledgers | residual displayed; NULL-charge row count published alongside |
| Match rate (M11) | ≥ 50%, else recovery withheld for the period |
| Chance baseline | published beside the observed recovery rate |
| Head guard | every `EXPENSE_ID` in R-VISA-HEADS, or listed as an exception with its negative count |
| Unmatched payments | count published; a change run-to-run is a run failure |
| T7 line status | count of non-`Added` paid lines published (currently 0) |
| T0 payment usable | count of unusable-input payments published (expected 0) |
| Refund type vs sign | count where `TRANSACTION_TYPE` and the amount's sign disagree — a booking defect, surfaced not resolved |
| Recovery `Unknown` — no maid id | count published (currently **3**) |
| Negatives at unrecognised amounts | count published (R-REFUND-AMOUNTS guard) |
| Refunds on cancellation heads `161`/`737` | share of Refunded that depends on the description test |
| BATCH-DATES payment count | within the 90: **18 payments / 18 cases**; population-wide: **to be measured** |
| Orphan-transaction proximity screen | hits against the scored population (§1 blind spot) |

**Columns.**

| Column | Row-level expression | Format | Default |
| --- | --- | --- | --- |
| Case | `VISA_REQUEST_ID · PURPOSE` | text | — |
| Rule breached | The test's own words | text | — |
| Reason | Blocking reasons, blocked rows only; may be several | labels | — |
| Payments | count of distinct payments in this case | integer | — |
| First / last payment | transaction date + transaction id | `YYYY-MM-DD` | — |
| Era fee | matched schedule fee | AED #,##0.00 | — |
| Duplicated | sum of matched fees on excess payments | AED #,##0.00 | — |
| Refunded | matched refund for this case | AED #,##0.00 | — |
| **Still out** | duplicated − refunded | AED #,##0.00 | **sort desc** |
| Recovery | Unrecovered · Partial · Full · Unknown · **Not applicable** *(case not confirmed)* | label | — |
| Span | days between first and last payment | integer | secondary sort |
| Channel | Noq · Card · mixed | label | — |
| Verdict | the single verdict column | Confirmed / Blocked / Clean + word | — |
| Status | workflow | New · Under review · Escalated · Closed | — |

**Filters.** Verdict (**default Confirmed**) · recovery (**default Unrecovered**) · reason · period of last payment · channel. Every default shown on screen.

⚠️ **The two defaults together hide all 45 blocked cases**, while the KPI strip shows a Pending tile of AED 8,873.50 whose rows take two filter changes to reach. **The KPI strip always reports the full population and does not respond to the filter bar** — state that on the page, and show the in-view subtotal separately above the table.

**Drill-down.** The payments in the case: transaction id, transaction date, `AMOUNT`, `CHARGE`, `VAT_CHARGE`, channel, matched fee, and the T1–T9 trace. **Excluded from the drill-down and the export, by column name:** `D1.DESCRIPTION` · `D1.EMPLOYEE_NAME` · `D1.CREATOR_NAME` · `D1.LAST_MODIFIER_NAME` · **`TRANSACTIONS.DESCRIPTION`** · **`TRANSACTIONS.CREATOR`** · **`TRANSACTIONS.LAST_MODIFIER`**. The last three were missing from earlier drafts, which instead forbade `RELATED_TO_NAME` — a column on D14, a view this design does not read. An exclusion list is implemented by column name, so a name that resolves to nothing protects nothing.

**Conditional formatting.** Row colour driven by the verdict column only, never colour alone — every row carries the verdict word.

**Provenance line.** Sources and as-of timestamp, displayed.

**Export.** CSV of row-level detail, excluding the columns above.

**Sensitive data.** The report reads visa request ids, transaction ids, dates, amounts, channels and maid ids for display. `DESCRIPTION` carries maid names and, from 2026-01, passport numbers; `EMPLOYEE_NAME`, `CREATOR_NAME`, `LAST_MODIFIER_NAME` and `RELATED_TO_NAME` carry staff and subject names. **None may be selected into the report, the export, a chat reply or an email.** Reading `DESCRIPTION` as a *filter predicate* is permitted; selecting it for display is not. Operator identity is not reported — the concentration statistic in §6.6 was computed and deliberately not carried into the report.

---

## 5. Worked Examples

### A — Clean: the lifecycle, not a duplicate

🔴 **This example needs a sourced request before publication.** An earlier draft used request `9141`, which is **a confirmed finding** — `9141 · RENEW_RESIDENCE` holds two payments of 443.50 (2025-02-06 and 2025-02-13) and is one of the 45. A builder calibrating T1 against it would tune until a real finding vanished. It was also dated on the line-creation clock this spec forbids. Source a genuine one:

```sql
-- a request with exactly one APPLY payment and exactly one RENEW payment,
-- and therefore in neither purpose's multi-payment set
WITH pay AS (
  SELECT VISA_REQUEST_ID, PURPOSE, TRANSACTION_ID
  FROM BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES
  WHERE PURPOSE IN ('APPLY_FOR_RVISA','RENEW_RESIDENCE')
    AND OWNER_TYPE = 'HOUSEMAID' AND TRANSACTION_ID IS NOT NULL
  GROUP BY 1,2,3
)
SELECT VISA_REQUEST_ID
FROM pay GROUP BY VISA_REQUEST_ID
HAVING COUNT(DISTINCT PURPOSE) = 2 AND COUNT(*) = 2
LIMIT 5;
```

**The shape the example must show.** One visa request carries an `APPLY_FOR_RVISA` payment at the fee of its era and, years later, a `RENEW_RESIDENCE` payment at the fee of *its* era. Keying on request **and purpose** puts them in two cases of one payment each; T1 is clean in both. Quote both legs on the **transaction** clock (D12b).

⚠️ Keying on request alone classes this as a duplicate — across the population that produced **8,785 cases and AED 4,215,566** against the correct **90 and AED 29,218**.

⚠️ **Standing assertion:** no request used as a lifecycle example may appear in the multi-payment set. Check it before publishing, and re-check whenever the snapshot moves — a request that is clean today can acquire a second payment tomorrow.

### B — Confirmed, partly refunded: the standing positive control

Request `87012`, `APPLY_FOR_RVISA`:

| Payment | Transaction date | Txn | `AMOUNT` | Matched fee |
| --- | --- | --- | --- | --- |
| 1 | 2025-09-13 | 1482201 | 443.50 | 443.50 |
| 2 | 2025-09-17 | 1486146 | 443.50 | 443.50 |

T1 **RED** · T2–T9 clean or N/A. Duplicated = **443.50** (the second payment's own fee).

This case is confirmed against live ERP with a name cross-check. **Any change to T1 that clears it is wrong.**

### C — Blocked: the case T5 exists for, and it has one payment

Request `12822`, `RENEW_RESIDENCE`: two `Added` lines, both 2025-07-18, both 443.50 — **both carrying `TRANSACTION_ID` 1394128**.

At payment grain the case holds **one** payment, so T1 is clean and it is **not a multi-payment case**. **T5 BLOCKED** (`line-integrity`).

**Verdict Blocked. Duplicated 0.00** — nothing left twice. It appears on the exception table and in the blocked count.

⚠️ This is the case that proves the tests must run over **all** cases. Scope them to multi-payment cases and T5 can never fire — it becomes a permanent clean, and the one line-integrity defect in 69,218 payments is invisible. Exactly one payment in the population has this shape.

### D — Blocked: an inference is not a finding

Request `6301`, `APPLY_FOR_RVISA`: 496.00 on 2018-12-15 (txn 118064), then **196.00 on 2020-02-24** (txn 195979).

196.00 matches no schedule entry, so T1 sees one fee payment and is **clean**. **T3 BLOCKED** (`sub-fee-payment`), **T2 BLOCKED** (`batch-posting-unconfirmed`) — transaction ids 195977–195988 are consecutive and all dated 2020-02-24, which is a bulk posting, but that is P&C's reading and nobody has confirmed it. **T6 BLOCKED** as well: 436 days.

**Verdict Blocked. Duplicated 0.00, Pending 0.00** — the 196.00 is not a duplicated fee. Counted in the blocked total under three reasons.

⚠️ T2 and T3 are **not disjoint**. All 18 batch cases are also sub-fee cases: the batch posting *is* the sub-fee payment. A reason chart that treats the buckets as exclusive double-counts.

### E — Confirmed with a fine: base only

Request `92283`, `APPLY_FOR_RVISA`: 443.50 (2026-01-02), then **1,293.50** (2026-01-27).

`1,293.50 − 443.50 = 850 = 17 × 50`, so the second payment is a schedule fee plus 17 overstay days. T1 **RED**. Duplicated = **443.50**. The 850 of fine **routes to the overstay audit and is never counted here**.

⚠️ Request `96965` pays 1,443.50 then 8,943.50; both carry fines, so a within-group minimum gives a base of 1,443.50 and silently books **1,000 of overstay** as duplicated fee. The schedule gives 443.50 twice and the correct answer.

### F — Blocked: two people, one case

Request `120669`, `APPLY_FOR_RVISA`: two payments of 443.50, same day (2026-07-31), consecutive transaction ids — and **two different `HOUSEMAID_ID` values**.

T1 would read this as a textbook duplicate. **T8 BLOCKED** (`two-maids-one-case`): two people's fees are not one person's duplicate. Either the request is shared or one payment is mis-attributed, and nothing in the data says which.

**Verdict Blocked. Pending AED 443.50.** Without T8 this is a confirmed finding worth AED 443.50 that may be entirely legitimate.

### G — Blocked: the refund came first

Request `96965`, `APPLY_FOR_RVISA`: 1,443.50 on 2026-02-23, a **239.50 refund on 2026-04-01**, then 8,943.50 on 2026-08-11.

The refund predates the second payment by four months, so it cannot be a recovery of it — and pay → partial refund → pay again reads as plausibly a correction cycle as a duplicate. **T9 BLOCKED** (`refund-before-duplicate`).

Two cases behave the same way (`9529`, `46031`). Counting their refunds as recoveries inflated Refunded by **AED 618.50**; counting the cases as confirmed inflated Duplicated by **AED 1,330.50**.

---

## 6. Decisions required before approval

1. **Confirm the loss ruling.** Duplicates are treated as loss. The evidence now supports it for a reason not known when it was given: recovery exists but is **partial by design** — a fixed ~239.50 against a 443.50 fee, never full in 15 of 15 observed cases. → **Hassan**
2. 🟡 **Do failed Credit_Card charges reverse outside the ERP?** **Asked 2026-09-10; awaiting response.** Settles 11 cases at once — either loss or zero, and T4 cannot return RED until answered. AED 4,878.50 of Pending turns on it. → **Finance / card-flow owner**
3. **Is the 2020 batch reading correct?** 18 cases held blocked on P&C's inference from consecutive transaction ids on two dates at a non-fee amount. Confirm or kill. → **Visa team**
4. **Who receives the findings, and who owns the preventive guard?** Two different people. Detection is P&C's and settled. The guard sits at one identified place — the **"Apply for R-visa"** task, in both the initial and renewal pipelines — and belongs to whoever owns that task. Recommend it; do not block on it. → **Hassan / Malaz**
5. **Confirm R-REFUND-AMOUNTS.** 239.50 · 189.00 · 189.50 · 289.50 are inferred from concentration, not from a published schedule. → **Finance**
6. **Operator concentration — report or not?** One operator holds 45.6% of duplicates against a 25.2% population share (~1.8×). Not a batch signature; not R-visa money. Currently computed and deliberately unreported. → **Hassan**
7. **Sign off R-FEE-SCHEDULE.** Now measured with dated windows and volumes, but never read from an authority tariff. Every money figure depends on it. Two specifics: are `555.00`/`556.00` (2018) genuine fees, and is the pre-2018-07 gap acceptable? → **Finance**
8. **Long-gap cases.** 12 cases held blocked pending N2. Confirm N2 exists or accept them as permanently blocked. → **Visa team**
9. **The three refund-before-duplicate cases.** Held blocked as correction cycles. Treating them as confirmed instead adds **AED 1,330.50** to Duplicated and **AED 618.50** to Refunded. → **Hassan**
10. **Cleaners in or out?** Head `149` covers cleaners, whom `OWNER_TYPE = 'HOUSEMAID'` selects. Currently in scope. → **Hassan**
11. **Do single-payment cases with an unexplained amount belong to anyone?** Under v4's per-test scoping they are not blocked here — a single payment cannot be a duplicate. But §2.4 names 221 population payments at amounts the schedule rejects, and nobody is looking at them. They belong to a **price-accuracy audit**, which does not exist. → **Hassan**
12. **Sign off the 50-dirham fine step.** It is the entire tolerance of the fee match and is currently inferred from the shape of the data, never read from an overstay tariff. Widen it and fines become fees. → **Finance**

---

13. **Confirm `293.50` as the 1-year tier of the 393.50 era.** Admitted on a 100-dirham inference, not on a source (§2.4). 11 payments turn on it. → **Finance, with the fee-schedule sign-off**
14. **Rule on the S1 re-payer defect's filing shape** — one process defect with 20 instances, or 20 duplicate findings. The exposure is AED 8,870 either way; what differs is whether anyone is asked to fix the cause. Spec recommends the defect. → **P&C**
15. **Own the term-mismatch class (§3.8).** 25 cases, a different kind of loss from duplication, and currently nobody's. → **P&C / Visa**
16. **Re-measure the withdrawn fine figures** on the correct population filter (§0.5), and re-scope them to the modification charge rather than overstay days (§2.6). → **P&C**

17. **Rule on the overstay scope conflict (§9.2b).** The Security Room roadmap assigns overstay-fine accuracy and responsibility to this check; §2.6 moved it off on the Alert-931 tariff evidence. Spec recommends: R-visa keeps the Modification-fine leg, overstay stays with the CC/MV overstay checks, roadmap row #12 is corrected. → **P&C**
18. **Accept R1 as an ERP gap, not a spec gap (§9.4).** The roadmap's rejected-R-visa refund leg cannot be built: ERP exposes no rejection status and no refund-request field for R-visa. Either accept it as carried-out-of-coverage, or raise the ERP change that would make it buildable. → **P&C, with Visa**

### 6.a Status of the earlier decisions

v6 carried sixteen decisions as an undifferentiated list, which is why its status line never moved. They are not all the same kind of thing:

- **Rulings this spec can make and has made:** the fee-match tolerance (§9.5, was 6.7's hardest part), the S1 filing shape (spec recommends the process defect, §3.7), building the orphan screen rather than carrying it (§9.6), and dropping the AI verifier (§0.4).
- **Needs a person, and the spec is blocked without it:** 7 (fee-schedule sign-off), 13 (`293.50`), 15 (term-mismatch owner), 17, 18.
- **Needs a measurement, not a decision:** 16 (re-measure the fine figures) and the term class — both now have queries and neither is a judgement call.

⚠️ **The status line will not read "no decisions outstanding" until the five in the middle group are answered.** Naming them as blocked is the honest state; marking them resolved to clear the line is how `DNA-9529` came to be raised prematurely.

## 7. Handoff to DNA

**File as two linked issues.** SQL/model work always blocks the visual build, so this is pre-split rather than left for intake to guess:

| Issue | Type | Scope |
| --- | --- | --- |
| `[Split from DNA-X] Analytic Engineering: R-visa duplicate payments — model` | Analytic Engineer Task | §2 data points, §2.4 reference lists and thresholds, §3 tests and metrics, the coverage waterfall and both tie-outs. **Blocks the BI issue.** |
| `[Split from DNA-X] BI: R-visa duplicate payments — dashboard` | BI Visualization Task | §4 in full, including the Controls panel. **Blocked by the model issue.** |

| Field | Value |
| --- | --- |
| Layer | Silver (reads `VISA_SILVER`, `MONEY_CONTROL_SILVER`) |
| Grain | one row per (`VISA_REQUEST_ID`, `PURPOSE`) |
| Consumer | Police & Control, on demand |
| Business owner | Hassan Ahmed |
| Historical backfill | all-time. Earliest **source row** 2017-06-21 (D11); earliest payment in a multi-payment case 2018-10-29. R-FEE-SCHEDULE does not reach before 2018-07-31, so pre-2018-07 cases are T3 BLOCKED — **do not read 2018-10-29 as the backfill boundary** |
| Out of scope | overstay fines · office staff · R-visa modification heads · entry visa · E-ID · change of status |

**Acceptance criteria — numeric and testable against the 2026-09-10 snapshot:**

1. `COUNT(*) − COUNT(DISTINCT case_id) = 0` on the case table.
2. Multi-payment cases = **90**; payments in them = **184**; excess = **94**.
3. Confirmed = **45**; excess fee payments = **46**; Duplicated = **AED 20,344.50**.
4. Refunded = **AED 3,491.00** over **15** cases; fully recovered = **0**.
5. Still out = **AED 16,853.50**.
6. Blocked = **46** (45 multi-payment + case `12822`); Pending = **AED 8,873.50**.
7. Waterfall residual = **0**; both tie-out residuals displayed with their values.
8. Every blocked case carries ≥ 1 reason. **Within multi-payment cases:** blocked = **45**, reason-hits = **71**. **Across all cases:** blocked = **46**, reason-hits = **72** (case `12822` adds one `line-integrity` hit).
9. No case carries a verdict word outside Confirmed / Blocked / Clean.
10. The export's and drill-down's column lists contain **none of** `D1.DESCRIPTION`, `D1.EMPLOYEE_NAME`, `D1.CREATOR_NAME`, `D1.LAST_MODIFIER_NAME`, `TRANSACTIONS.DESCRIPTION`, `TRANSACTIONS.CREATOR`, `TRANSACTIONS.LAST_MODIFIER`. Testable by name, not by inspection.

**Done when** all ten pass on the snapshot, the Controls panel renders every row in §4, and P&C has signed the §6 decisions that gate a verdict (2, 3, 5, 7, 9, 12).

**Prior attempts — searched 2026-09-10. This audit has been filed before and must be raised as the successor, not as a new request.**

| Key | What it is | Status | Bearing on this ticket |
| --- | --- | --- | --- |
| **DNA-9529** | *R-Visa fee audit — silver model: per-payment tests + per-maid verdict* | **Cancelled 2026-09-06** | The same audit. Withdrawn by the requester the day it was filed: *"raised prematurely, before the requesting team had signed off the spec … A corrected pair will be raised after review."* **That corrected pair is this one.** Reference it by key. |
| **DNA-9530** | *[Split from DNA-9529] BI: R-Visa fee audit — P&C exception dashboard* | **Cancelled 2026-09-07** | Its BI half. Same successor relationship. |
| **VPMGOV-1670** | *Publish n8n flow: R-Visa Audit* | **To Do** | A built four-workflow n8n implementation of the same audit against the **ERP APIs**, awaiting publication and blocked because `/accounting/transactions/{id}` returns `INSUFFICIENT_PERMISSIONS` for the auditing account. Different data path, same question — **reconcile findings with it before either goes live, or the company runs two duplicate counts that disagree.** |
| **MC-2005** | *Publish n8n flow: Change of Status Audit* | open | The identical pattern on a different government fee. Not this scope; worth the same treatment. |

⚠️ **Two substantive disagreements with DNA-9529 that a reviewer will ask about.**
1. **Grain.** DNA-9529 rolls up **per maid** and counts **182** all-time repeat cases; this spec keys on (`VISA_REQUEST_ID`, `PURPOSE`) and finds **90**. The gap is the maid key: one woman's application and her later renewal read as two payments for one maid. That is the same error that produced AED 4,215,566 of imaginary loss here before the purpose split (§1). Its acceptance criterion `RED + AMBER + GREEN = COUNT(DISTINCT OWNER_ID)` also drops the **three cases with no maid id**, because `COUNT(DISTINCT)` ignores NULLs.
2. **Scope.** DNA-9529 covers duplicates **plus** overstay-fine overcharge, undercharge and unassigned repayment responsibility. This spec is duplicates only, by the requestor's ruling of 2026-09-09; overstay has its own audit. The constant that broke DNA-9529's acceptance criteria — the overstay grace period — is therefore not load-bearing here.

**Also not a duplicate of** — dismiss at intake: `MISSING_EXPENSES` (the mirror control — completeness, not duplication; named in §8 as a sibling), `DUPLICATE_EXPENSES` (money-control pipeline, structurally blind to visa expenses), `LOST_VISA_EXPENSES` (lost cost on failed visas; carries no R-visa purpose).

| ModelName | `RVISA_DUPLICATE_PAYMENTS` |
| TargetSchemaOrDomain | `VISA` (Silver), consumed by a P&C dashboard |
| Dependencies | N1 and N2 block T4 and T6; §6 decisions 2, 3, 5, 7, 9, 12 gate verdicts; every 🔴 measurement in §1, §2.4, §3 and M9 closes first |

**Attachments** — `SPEC_rvisa_duplicate_payments_v5.md` **← start here** · `payments-184.tsv` (the 184 case payments; columns in order: req, purpose, seq, txn, pay_date, line_date, amount, charge, vat, channel, lines_on_txn — **no header row**) · `cases.json` · `queries_W1_W2.sql`.

🔴 **Two standard attachments are missing and the handoff is not filed without them:** `DNA_ATTACHMENT_source_tables.md`, and `DNA_ATTACHMENT_verification_queries.md` pairing **every** measured figure to the query that produced it — including the ones this spec could not run, which currently carry their queries inline.

---

## 8. Handover notes

- **No approved KPI exists.** Every figure here is an unverified ad hoc definition; recommend adding it to the Data Catalog on approval.
- **Do not schedule this.** Manual trigger only — a standing run goes to the ERP team.
- **The population definition was wrong four times in development.** Too narrow (a 90-day gap filter hid 25 real cases); catastrophically too wide (grouping purposes together turned the normal apply-then-renew lifecycle into AED 4.2m of imaginary loss); contaminated (an asymmetric head predicate credited AED 668 of entry-visa refunds as R-visa recoveries, twice); and mis-clocked (dated lists written against line-creation dates when the payments are dated one day later, which made the batch test match zero cases).
- **Three tests were dead or missing when v2 was written.** T5 was scoped so it could never fire; T8 and T9 did not exist, and between them they were worth AED 1,774.00 of false findings.
- **Renewals carry most of the exposure.** They are **24%** of R-visa lines (17,237 of 71,791) but **58%** of confirmed duplicates (26 of 45) and **AED 11,433.50** of the 20,344.50 — 2.4× over-represented. Measured from this report's own cases; a process owner should start there.
- **The lesson for whoever maintains this:** detecting two payments on one request is trivial. **Classifying which of nine shapes you are looking at is the entire job.** Two rules carry most of that weight: the refund side applies the description test to **every shared head and no dedicated head, from one written predicate** (§2.4) — while the payment side is selected by `PURPOSE` and takes no description test at all; and **every dated predicate runs on the transaction clock**, never on line creation.

---

## 9. Source coverage — what the flowchart asks, and whether we built it

**Run this section first on every revision.** It exists because a missing rule leaves no hole to find: every gate this spec has passed through was checking the rules that exist, not the rules that should. Two sibling specs ran this comparison for the first time in the week of 2026-09-14 and both found checks they had never specced.

Read from `Visa_Process_Audit_Flow.pdf` directly on 2026-09-14, not from a summary of it.

### 9.1 The three checks the PDF names at the R-visa node

| The check, in the PDF's own words | Status | Where it lives |
| --- | --- | --- |
| *"Ensure no duplicate payments for the same maid."* | ✅ **BUILT** | T1 (per request) and bucket **A** (per maid, §3.6) |
| *"Confirm the 1-year or 2-year option matches the contract and the visa validity."* | 🟡 **SPECIFIED, NOT MEASURED** | §3.8 + §9.3. 25 pairs, held AMBER |
| *"If fines apply, check who is responsible for repayment."* | 🟡 **SPECIFIED, NOT MEASURED** | §2.6 + **T10** (§3.9) + M12. Rule now exists; the number does not |

The PDF's R-visa cost line reads **"Cost 443 (2-year)"** — it names only the 2-year price. That is consistent with the 1-year tier being rare and is not a contradiction of §2.4.

### 9.2 🔴 What the comparison found: a fourth leg, from a different source

The PDF is not the only thing that scopes this check, and the two sources disagree. The **Security Room Projects Road Map** (row #12, *R-Visa Audit*) scopes it as:

> *"We audit: duplicated R-visa payments without a valid reason (re-paying after a cancelled R-visa is valid); **rejected R-visas with no refund request within 60 days**; and overstay fines, checking whether the days paid are accurate and who is responsible."*

Two things fall out, and neither is in v6.

**(a) A rejected-R-visa refund leg exists in the roadmap and in no rule.** Note the shape of the flowchart: **Entry Visa** carries *"For rejected entry visas, confirm the partial refund was claimed within 60 days; if not, record as a loss"* and **Medical** carries the same at 90 days. **R-visa carries no refund check at all in the PDF** — but the roadmap says it should, at 60 days. This is exactly the failure mode described above: the requirement was known (the v5 check page records it as gate ⓬ and verifier ❸, *"unbuildable — R-visa has no rejection-status or refund-request field in ERP at all"*) but was never carried forward into v6 as a rule, so no gate could miss it. It is now **R1** in §9.4 — carried explicitly as out of coverage with a stated reason, which is a different thing from being absent.

**(b) The roadmap assigns overstay fines to this check; §2.6 moved them off it.** That is a scope change v6 made on evidence but without authority, and it should be ruled on rather than left implicit. The evidence for moving them: the Alert-931 tariff marks R-visa **"May include Fines? = FALSE"**; overstay has a dedicated column (`INITIAL_VISA_REQUESTS.OVERSTAY_FEE`) and its own sibling checks with their own constants (CC Overstay Fines, expense 1589; MV, expense 1677). **Recommendation: R-visa carries the Modification-fine leg only, overstay stays with the overstay checks, and the roadmap row is corrected.** → decision §6.17, **P&C**.

### 9.3 The term check is unblocked — the table is named

§3.8 held 25 pairs AMBER pending *"the visa validity actually issued, per case."* That fact is available:

**`BA_VIEWS.VISA_SILVER.HOUSEMAIDS_VISA_INFORMATION`** — `MAID_ID`, `R_VISA_ISSUANCE_DATE`, `R_VISA_EXPIRY_DATE`. The term is **`EXPIRY − ISSUANCE`**; **no stored 1-year/2-year field exists anywhere in the warehouse.** Band at 400 days. Sourced from the E-ID spec §3.4d, which needed the same fact — `UNVERIFIED here — to confirm` until this spec has run its own DESC against it.

Population context, measured by that spec 2026-09-14 over 306,267 maids carrying both dates: 1 year (201–400 d) **1,782** · 401–600 d **628** · 2 years (601–800 d) **269,230** · over 800 **34,285** · under 200 **94** · negative **248**.

⚠️ **The one-year residence visa is 0.6% of all history and 0.2% of the current era.** Whatever this finds will be small. A large result means the join is wrong, not that a large finding was hiding.

**Two traps that will silently break this join.** Both are inherited findings, not hypotheses:

1. **The table is one row per REQUEST, not per maid.** Joining without deduplicating fans out roughly 5–20× — the same sibling query returned 1,682 charges for 82 maids before the dedupe and 95 after. **Reduce to one term per maid first** (latest issuance, then latest expiry), the same way §3.4 handles the refund set.
2. **The dates are NULL on 94,445 rows and negative on 248.** A maid with no readable term is **neither a finding nor clean** — she is `BLOCKED(term-unreadable)` and stays in the denominator. Silently dropping her is the trap this spec's whole verdict algebra (§3.2) exists to prevent.

🔴 **Pricing: do not assume you may.** The sibling E-ID check measured its charge at **AED 353.91 on a one-year visa and AED 353.91 on a two-year one** — the price does not track the term at all — and therefore made its term metric **a COUNT and refused to attach money**, on the ground that naming a cheaper one-year price would be inventing a constant. R-visa looks different: a **documented** 1-year tier at 343.50 from two company sources, and a 100-dirham step. **But that must be proved before it is priced** — 343.50 carries 90 payments against 443.50's 44,100, and 293.50 is in the schedule on inference alone (§6.13). **If the evidence does not hold, follow E-ID: report the count, price nothing, route it.** See §9.5 for the question that settles it.

### 9.4 Carried out of coverage, with a size

| Ref | What is not covered | Size | Why, and what would change it |
| --- | --- | --- | --- |
| **R1** | Rejected R-visa with no refund request within 60 days (roadmap leg) | **Unknown — unmeasurable today** | ERP exposes no rejection status and no refund-request field for R-visa. This is an **ERP gap, not a spec gap**; it cannot be built from the warehouse. → §6.18 |
| **R2** | The **981 orphan transactions** — R-visa heads carrying no visa line | **1.4% of the population, 10× the finding set** | v6 left this as "either a proximity screen or an out-of-coverage statement", and shipped neither. v7 chooses: **build the screen** (§9.6). Until it runs, this row stands |
| **R3** | Overstay fine accuracy and responsibility | Owned elsewhere | Moved off this node on the Alert-931 tariff evidence; §9.2(b) puts it to P&C as a ruling |

### 9.5 Constants: what is sourced, what is a tolerance, what is unverified

`DNA-9529` was withdrawn on 2026-09-06, hours after being graded *Ready*, for exactly this class of defect:

> *"A subsequent check against the ERP code contradicted one of the constants it quotes. This ticket assumes a 60-day grace period before overstay begins. The ERP has no flat 60-day grace: it reads `PARAMETERS.CODE = 'tourist_visa_grace_period'` (seed default 0) or `'employment_visa_grace_period'` (seed default 30), selected by `NEWREQUEST.TYPE_OF_PREVIOUS_VISA`. The AED 50/day rate is likewise a configurable parameter (`fine_for_tourist_visa` / `fine_for_employment_visa`), not a constant."*

**`FINE_STEP = 50` is reclassified, not re-sourced.** It is no longer an overstay rate in this spec and makes **no claim about how the authority prices anything**. It is a **fee-matching tolerance**: the modulus that lets a payment carrying an unrelated add-on still be recognised as carrying its era fee. It is load-bearing in one direction only — widen it and residue becomes fee, narrow it and every residue-bearing payment falls to T3 — and that is a sensitivity of *this spec's matcher*, not of the tariff. ✅ This removes the constant DNA-9529 was withdrawn over from the R-visa node.

**`293.50` — `UNVERIFIED, to confirm.`** Admitted on a 100-dirham inference. No document states it and no case in the 53-pair residue carries one. It stays in the schedule because excluding it silently reclassifies 11 genuine 1-year visas as underpayments, which is the less conservative error — but it is labelled, not asserted.

**Both go to Ask the Code, not to the ledger.** The ERP is the only source of truth for how a fee is priced; a pattern in the ledger is corroboration and never a tariff. The question to put to it is in §9.7. ⛔ **Until that answer is in hand, `343.50` is sourced (two company documents) and `293.50` is not, and the term class may be counted but not priced.**

### 9.6 R2 — the orphan proximity screen (v7 rules: build it)

**Screen.** For each of the 981 orphan transactions: is there an R-visa fee payment for the **same maid** on the **same head** within **±90 days**? Publish the hit count and the hit list; a hit is a candidate duplicate the line-keyed population cannot see, because the money moved with no visa line behind it.

**Verdict contract.** A hit is **BLOCKED(`orphan-proximity`)**, never RED. An orphan has no line, so no term, no purpose and no schedule match — everything T1 needs is missing. It is a pointer for a human, and the screen's job is to stop 981 transactions sitting outside every test with nobody able to say how much they are worth.

### 9.7 The question for Ask the Code

Not runnable from this session (`scripts/ask-code.sh` requires a `.env` that is not present here). To be run by the spec owner, verbatim:

> For the "Apply for R-visa" and "Renew Residence" visa steps: what determines the fee amount charged? Is the 1-year versus 2-year residence term a stored field on the request, or is it inferred from the amount? Name the parameter codes in `PARAMETERS` (or equivalent) that hold the R-visa fee for each term, and their seed defaults. Separately: is there any code path that adds a fine, penalty or modification charge onto the R-visa expense line itself rather than booking it to its own expense head?

The last sentence is the one that matters most: it is the only way to settle whether a Modification charge can ride inside an R-visa payment, which §2.6 currently answers from the ledger's shape alone.

---

## 10. The AI verifier prompt

🟢 **`AI verifier` = NOT REQUIRED as of v6.** The prompt below is kept complete and runnable so the decision is reversible without a rewrite, but it should not be built today. **Reason, measured:** the three questions v5 called prose-only are not — cancellation is an expense row (§0.3), term is the price (§0.2), and fine responsibility has a documented default (§2.6). After those, the irreducible reading job is **8 cases, all-time** (§3.7 shape S3). That is a person's afternoon, and a deterministic verdict can be re-derived by a human from the case row where an LLM verdict cannot — which matters on a check that still carries reverse-engineered constants into Finance review.

**What would reverse this:** if S3 grows past roughly a hundred a year, or if the term-mismatch class (§3.8) turns out to need the written record rather than the visa validity field. Re-run the bucket counts before deciding, not the argument.

The verifier, if ever built, exists because some things this check must know are recorded only in prose. It receives **the residue only** — the duplicate pairs in the short-gap band and the fine-bearing records — never the population.

### 9.1 What the verifier is and is not

It is a **reader of written evidence**. It does not price payments, recompute gaps, or re-derive fine days: every constant it would need for that is either unsourced or already applied upstream by the deterministic gates. Asking it to check arithmetic invites it to launder an assumption into a conclusion.

Its single job: **for each question, say whether the written record answers it, and if so, what the answer is.**

### 9.2 The input contract

One case per invocation. The orchestrator supplies:

```json
{
  "case_id": "113190:APPLY_FOR_RVISA",
  "maid_id": 139111,
  "contract_type": "CC",
  "question_set": ["Q1", "Q2", "Q4"],
  "payments": [
    {"txn_id": 2101445, "date": "2026-06-12", "amount": 443.50,
     "channel": "Noqoodi", "fee_matched": 443.50, "residue": 0.00,
     "description": "<verbatim>", "creator": "<verbatim>"}
  ],
  "refunds":      [{"txn_id": 2107781, "date": "2026-06-20", "amount": 239.50, "description": "<verbatim>"}],
  "visa_notes":   [{"date": "2026-06-18", "author": "<verbatim>", "text": "<verbatim>"}],
  "visa_requests":[{"request_id": 113190, "type": "NewRequest",
                    "status": "<verbatim>", "from": "2026-05-30", "to": "2026-08-14"}]
}
```

`question_set` is set by the deterministic gates. **The verifier answers only the questions it is given** and returns `NOT_APPLICABLE` for the rest. It never invents a question, and never answers one that was not asked because the gates already settled it.

### 9.3 The prompt

```text
You are the audit verifier for the maids.cc R-Visa check, run by Police & Control.

You are reading the written record for ONE case that the deterministic rules could
not settle on their own. Your job is to answer a fixed set of questions from that
written record — nothing else.

WHAT YOU ARE GIVEN
A JSON object describing one case: its R-visa payments, any refunds, the visa notes
on that maid, and her visa request records. All free text is verbatim from the ERP.

WHAT YOU MUST NOT DO
- Do not compute or re-check any amount, fee, gap, or fine-day count. Those were
  settled upstream. If an arithmetic claim in the input looks wrong to you, say so
  in `observations` and change nothing else.
- Do not reason from the maid's wider history, from how common a pattern is, or from
  what "usually" happens. A conclusion must rest on a specific piece of written text
  in THIS case, quoted.
- Do not treat the absence of a note as evidence of anything. Silence is BLOCKED,
  never PASS. This is the single most important rule on this page.
- Do not widen a conclusion beyond the record it came from. A clearance written on
  one transaction of a duplicate pair settles THAT PAIR. It never settles the maid's
  other payments.
- Do not put a person's name in `rationale` or any summary field. Names may appear
  only inside `evidence_quote`, which is verbatim and goes to the case file only.

THE QUESTIONS

Q1 — CANCELLATION CLEARANCE  (verifier rule ❶)
  Asked when: two or more full R-visa fees were paid for one maid.
  Answer: does the written record say the FIRST visa was cancelled, rejected, or
  withdrawn before the second fee was paid — so that the second payment is a
  re-application rather than a duplicate?
  PASS  (= not a duplicate) requires text that names a cancellation, rejection or
        re-application AND is dated at or before the second payment, OR a visa
        request record whose window excludes the first payment.
  FAIL  (= a real duplicate) requires text that positively rules a cancellation out,
        or a request record covering BOTH payments in one continuous window.
  BLOCKED otherwise — including when there is simply nothing written.

Q2 — FINE RESPONSIBILITY  (verifier rule ❷)
  Asked when: the payment carried a fine on top of the fee.
  Answer: does the written record show that someone assessed WHOSE FAULT the fine was?
  Note: the company's own rule (ERP Alert 970) puts no R-visa item in the maid-loan
  table, so the company bearing the cost is the EXPECTED state, not a finding. The
  finding here is that no one ever asked whose fault it was.
  PASS  requires text assessing fault or naming who bears the cost.
  FAIL  requires evidence the question was raised and dropped without an answer.
  BLOCKED when nothing addresses it. Do NOT return PASS because a loan is absent —
  an absent loan is the default, not an answer.

Q3 — REJECTED R-VISA  (verifier rule ❸)
  Return BLOCKED with reason "no rejection field exists in ERP" unless the input
  carries an explicit rejection status. This question is currently unanswerable by
  design and is present so the gap stays visible.

Q4 — THE FLOOR  (verifier rule ❹)
  Asked when Q1 came back BLOCKED and the case carries no fine.
  Answer: is there ANY written explanation for the second payment at all — of any
  kind, not only cancellation?
  PASS requires a specific explanation, quoted. Anything else is FAIL: an unexplained
  second full fee for the same maid is a finding. This rule is why a case can never
  exit with no verdict.

Q5 — CHANNEL SWITCH  (proposed; answer only if asked)
  Asked when one fee was paid on Noqoodi and one by card.
  Answer: does the written record say the first payment failed, was reversed, or was
  re-submitted on another channel?
  PASS = a payment retry, not a duplicate. FAIL = two genuine purchases. BLOCKED
  otherwise.

HOW TO RETURN EACH QUESTION
Exactly one of:
  RAN_PASS         you found text that answers it, and the answer clears the case
  RAN_FAIL         you found text that answers it, and the answer is a finding
  BLOCKED          the written record does not answer it
  NOT_APPLICABLE   this question was not in question_set
Every RAN_PASS and RAN_FAIL must carry `evidence_quote` (verbatim, ≤ 300 chars) and
`evidence_locator` (which record it came from). A RAN_ verdict without a quote is
invalid — return BLOCKED instead.

HOW THE CASE VERDICT IS DERIVED
Apply in this order and stop at the first match:
  1. any question RAN_FAIL                     -> "finding"
  2. any question BLOCKED                      -> "pending"
  3. every asked question RAN_PASS             -> "clean"
There is no fourth outcome. "clean" requires that every question you were asked
actually RAN and passed — not that none of them failed. A case where you found
nothing is "pending", never "clean".
"inconclusive" is reserved for Q3 and is NOT a synonym for clean.

OUTPUT
Return only this JSON object, no prose around it:

{
  "case_id": "<echoed>",
  "questions": {
    "Q1": {"result": "RAN_PASS|RAN_FAIL|BLOCKED|NOT_APPLICABLE",
           "evidence_quote": "<verbatim or null>",
           "evidence_locator": "<e.g. visa_notes[2] 2026-06-18 or txn 2107781 description>",
           "reason": "<one sentence, no names>"},
    "Q2": {...}, "Q3": {...}, "Q4": {...}, "Q5": {...}
  },
  "verdict": "finding|clean|pending|inconclusive",
  "verdict_basis": "<which rule above produced it, e.g. 'Q1 BLOCKED -> pending'>",
  "observations": ["<anything you noticed that no question covered; may be empty>"]
}
```

### 9.4 Why the verdict derivation is written out longhand

The failure this check is most exposed to is not a wrong answer — it is a **missing answer read as a clean one**. A verifier that finds no note and reports `clean` produces a green case that nobody ever looks at again, and it does so on exactly the cases where the evidence was thinnest. Hence three things in the prompt above, all load-bearing:

- **Four return values, not two.** `BLOCKED` has to be distinguishable from `RAN_PASS`, or silence collapses into clearance.
- **`clean` is defined as a conjunction over the asked questions**, not as the absence of a failure.
- **Q4 exists as a floor**, so a case with nothing written still lands somewhere.

### 9.5 Volume

The verifier sees **9 pairs** in the 0–30 day duplicate band all-time plus the **25** fine cases — never the 48,009 maids. If a run sends it materially more than that, the gates upstream have stopped filtering and the run should be stopped rather than paid for.

### 9.6 Open

Q5 has **no rule row** on the Audit Conditional Policy database yet. Until one is written, channel-switch cases stay blocked at T4 and are not sent to the verifier at all — the prompt carries the question so the rule can be turned on without a rewrite, not because it is live.
