# Spec — R-Visa Duplicate Payments

| | |
| --- | --- |
| **Requested by** | Hassan Ahmed, Police & Control |
| **Spec version** | v3 |
| **Date** | 2026-09-10 |
| **UI mockup** | https://claude.ai/code/artifact/3ce6b63e-afbb-4b45-8eff-d530f899e735 |
| **Discovery record** | https://claude.ai/code/artifact/619fb3c1-44dc-4b52-a8dd-ad57ca57154a |
| **Status** | Draft — decisions in §6 outstanding |

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

**Reader and action.** Police & Control, on demand. A confirmed row is a **process fix**. The default view is Confirmed + Unrecovered.

**Population in scope.** Every R-visa payment owned by a housemaid, all-time.

**Explicitly out of scope.**

| Out | Why |
| --- | --- |
| Overstay fines | Own audit. Where a duplicate carries fine days, only the era fee is counted. |
| Office staff | `OWNER_TYPE <> 'HOUSEMAID'`. |
| Whether the fee amount was right | Tests *count*, not price. |
| R-visa **modification** charges | A different product — amending a visa, not paying the fee. Heads `1622` `1649` `1735`. |
| Entry visa · E-ID · Change of Status | Own audits. Duplicates seen in them during this work are handed over, not scored (§6.4). |

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
| D3 | Case key part 2 | ″ `PURPOSE` | VARCHAR | `APPLY_FOR_RVISA` 54,484 · `RENEW_RESIDENCE` 17,217. Structured enum. |
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
| `1622` `1649` `1735` | NEW/RENEW - CC & MV Housemaids - **R-visa Modification** | A modification amends an existing visa; it is not the residence fee and has no R-FEE-SCHEDULE price. Scoring it against a fee schedule is a category error. Carries 0 payments in the current population. |
| `779` | **InPut VAT Maids.cc Expenses** | Not an expense head — a VAT account. 936 transactions, none worded R-visa, no negatives ever. The 3 case payments booked here are **mis-bookings**; they get a published exception, not a head-list entry. |
| `1797` | NEW - OfficeStaff - R-visa Application 2 years | Office staff. |
| `1576` `1664` `1607` `1614` `1695` `1702` | CC/MV Housemaids - Entry Visa (incl. Inside/Outside Country applications) | Entry visa — own audit. |

⚠️ **Two generations of head scheme, and both are required.** The generic buckets (`149` `150` `161` `736` `737`) run 2018 → late 2025; the granular heads (`15xx`–`17xx`) begin around 2025-12. A list restricted to either generation silently loses an era of refunds. Do not "tidy" the legacy heads away.

⚠️ **No structural family exists.** Every head is top-level in D15 — `ROOT` equals its own name in all 21 cases. The grouping above is held together by naming convention and this table, nothing else, which is exactly why it needs sign-off rather than inheritance.

⚠️ **The description test must be applied identically on both the payment side and the refund side.** Omitting it on the refund side attributed **AED 668.00 of entry-visa refunds** (739.50/89.50 shapes) to R-visa recoveries in an earlier run. Twice.

*Guard.* Every distinct `EXPENSE_ID` reached by the purpose-selected population is compared to this list. A surplus head is **published as an exception**, and is a **run failure only if it carries negative transactions** — an unlisted head holding refunds means recovery is being under-counted. An unlisted head with no negatives is logged, and its cases record recovery as **confirmed zero** rather than merely unmatched. Verified 2026-09-10: `779` and `149` each carry **0 negatives** across 936 and 211 transactions, so no recovery is hidden on either.

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

**Fee matching.** A payment matches a schedule entry when the entry is valid on the payment's **transaction date** and `amount − fee` is 0 or a positive multiple of 50 (an overstay day). Where more than one entry matches, take the **largest** — it attributes the least to fines, and the windows are built so this is never contested. A payment matching no entry is **T3 BLOCKED**, never an input to T1.

⚠️ **Amounts 50 apart are indistinguishable from a fee plus one fine day, so every window must be disjoint within a residue family.** Verified: 496→396 and 497→397 succeed with no overlap. 393.50 and 443.50 appeared to overlap for 27 months until measured — across that span 393.50 has **13,437** payments and 443.50 has **nine**, so those nine are fine-shapes and 443.50's era begins the day after 393.50's ends. Re-run this check whenever a fee is added.

⚠️ **Rejected as era fees — these are partial payments, not prices.** `343.50` (90 payments over 37 months), `472.50` (110 / 23 months), `293.50` (11), `418.50` (10), against 443.50's 919 per month. Admitting them let a partial payment read as a second full fee. `472.50` ran only 2020-07 → 2022-12, which is what rules it out of case `36025`'s 2024 payment.

⚠️ **Fee does not vary by contract type.** Measured across the 393.50 era: CC and MV split evenly over all four shared heads. The schedule is one-dimensional — date only. Do not add a CC/MV axis on the assumption one must exist.

⚠️ **`AMOUNT` sometimes holds the all-in total.** 117 payments (2024-11 → 2026-09) carry `fee + 3.00 + 0.15` with `CHARGE` and `VAT_CHARGE` null — e.g. 446.65 for a 443.50 fee. Where `CHARGE IS NULL` and the amount equals a schedule fee plus the channel charge, the government fee is that schedule fee. A standing pattern, not an anomaly.

⚠️ **Incomplete before 2018-07.** No amount clears the volume floor earlier, though payments exist from 2017-06 (D11). Any case whose payments predate 2018-07-31 is **T3 BLOCKED** until the schedule is extended. No case in the current population is affected.

⚠️ **Never derive the fee from the group being audited.** Using the within-group minimum inflated one case's base to 1,443.50 — a fee plus 1,000 of overstay — and put that overstay straight into the headline, breaching the scope ruling the formula existed to enforce. The same error recurred later as `MIN(matched fee)` across a case that spanned two eras. Price **each excess payment at its own matched fee**; there is no such thing as "the case's fee".

---

**R-REFUND-AMOUNTS** — recognised R-visa refund values. Owner: P&C, **provisional (§6.5)**.
`239.50` (2025-02 onward) · `189.00` (2020 → 2024) · `189.50` · `289.50`.
*Guard:* a negative on an R-visa head at an unrecognised amount does not count as recovery; publish the count. All 18 candidates found in the current run matched one of the four.

**BATCH-DATES** — `2020-02-24`, `2020-03-17`→**`2020-03-18`**. Owner: P&C, **provisional (§6.3)**.
⚠️ Stated on the **transaction** clock (D12b). The line-creation dates are one day earlier; an earlier draft used those and the test matched **zero** cases while the batch plainly existed.
*Guard:* the count of population payments on these dates must be stable run to run. Currently 18 cases.

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

⚠️ **Tests run over all 69,124 cases, not only the 90.** A single-payment case is GREEN unless a test blocks it — and T5 can, which is the only way case `12822` is ever seen. Scoping the tests to multi-payment cases makes T5 an assertion that cannot fail.

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
| **T1** duplicate fee | ≥ 2 payments in the case match R-FEE-SCHEDULE | 0 or 1 such payment | Any payment's amount is null, negative or > 100,000; or its transaction date falls outside `[2016-01-01, today]` | — |
| **T2** batch posting | — | No payment falls on a BATCH-DATE | Any payment falls on a BATCH-DATE — its nature is a P&C inference, not established | — |
| **T3** unexplained amount | — | Every payment matches a schedule entry | Any payment matches none. Reason `sub-fee-payment` when below the case's first matched fee, `amount-unexplained` when above it by a non-fine amount | — |
| **T4** channel switch | N1 confirms the card charge was **not** reversed | N1 confirms it **was** reversed | Pending N1, reason `card-reversal-unknown` | Payments do not span two `PAYMENT_TYPE` values |
| **T5** line integrity | — | Each payment maps to exactly one line | Two or more lines share one `TRANSACTION_ID`, reason `line-integrity` | — |
| **T6** long gap | — | Span ≤ 300 days | Span > 300 days and N2 unavailable — re-application cannot be told from duplicate | Case has one payment |
| **T7** line status | — | Every payment's line is `Added` | Any paid line is `Dismissed` or `Pending` | — |
| **T8** case identity | — | All payments resolve to one `HOUSEMAID_ID`, or to none | Payments resolve to **more than one** maid, reason `two-maids-one-case` | Case has one payment |
| **T9** refund before duplicate | — | No matched refund predates the first excess payment | A matched refund predates it — pay → partial refund → pay again reads as a correction cycle, not a duplicate | Case has no matched refund |

**T1 names no class.** A batch posting at 196.00 matches no schedule entry, so it never counts as a second fee payment; T3 then blocks the case rather than T1 being suppressed by a lookup table. Classification is the *reason*, never the gate.

**T7 is a guard, not an open risk.** Measured: 0 of 69,218 paid lines carry any status but `Added`. D5's other values cannot affect a verdict in this population. It stays in so a future change is caught, and publishes a count of 0.

**T8 accepts a missing maid.** Zero maids is not a contradiction — it is 2019 under-instrumentation, and it makes *recovery* Unknown, not the verdict AMBER. Only two different maids on one case blocks.

### 3.4 Recovery — evidence, not a verdict

**Why this is probabilistic at all.** A deterministic refund→payment key exists in the warehouse (D14) and was tested against this population on 2026-09-10: **zero overlap**, against 11,993 linked transactions in that ledger — it serves the money-control request pipeline, not the visa pipeline. No key bridges the two. Everything below therefore matches on maid, head, amount and time, and every safeguard exists because that is a weaker join than an id. **Do not replace it with a "simpler" lookup without re-running the D14 test.**

Recovery is computed per confirmed case and **cannot alter the verdict**.

- **Candidate refund:** a negative `TRANSACTION_AMOUNT` in D12 on a head in **R-VISA-HEADS with the same description test as the payment side**, same `HOUSEMAID_ID`, dated between the **first excess payment** and 180 days after the last payment, at an amount in R-REFUND-AMOUNTS.
- ⚠️ **The window opens at the first excess payment, not the first payment.** A refund that predates the duplicate cannot be a recovery of it. Three refunds (AED 618.50) were credited that way in an earlier run; those cases are now T9 BLOCKED.
- **Tie-break:** nearest in time to the last payment. **More than one candidate → the case's recovery is `Unknown`**, never "take the first". *Currently no case has more than one.*
- **Consumed once.** A refund may be attributed to at most one case.
- **No maid id → recovery `Unknown`.** Publish that count. *Currently 3.*
- **Match rate published per period.** Below 50%, recovery reads `Unknown` for the whole period — an absence is not evidence when the matcher is unreliable.
- **Chance baseline.** Publish, beside the observed recovery rate, the per-maid chance that one of that maid's own R-visa negatives lands in the case window by geometry alone — `1 − (1 − p)^k`, `p = window_days / that maid's observation_days`, `k` = that maid's count of R-visa negatives, computed **per maid and summed**, never on the cohort mean. Also bin refunds by signed distance from the last payment: a real recovery decays toward the payment, a flat distribution means the window is talking to itself.
  ✅ **Measured 2026-09-10 and it passes decisively:** 12 of 18 candidate refunds fall on the **exact day** of the last payment, the rest within a fortnight. That is not a flat distribution — it is a duplicate spotted and partly reversed the same day.

---

### Duplicated fees *(M1)*

- **Definition.** Government fees paid more than once for the same application or renewal, at the era fee, excluding overstay.
- **Population.** Multi-payment cases, verdict confirmed.
- **Formula.** `SUM(matched fee)` over every payment in the case except the earliest that matched. **Not** `(payments − 1) × one fee` — a case can span two eras, and a non-matching payment is not a duplicated fee.
- **Inputs.** D2, D3, D4, D6, D12b, R-FEE-SCHEDULE.
- **Filters.** The population definition only. **No amount range filter** — an implausible amount is T1 BLOCKED, not a deleted row.
- **Currency.** AED, no FX. **Rounding.** 2 dp at case level, then summed.
- **Nulls.** Null amount → T1 BLOCKED → case AMBER → contributes 0.
- **Division by zero.** N/A.
- **Current value.** **AED 20,344.50** — 45 cases, 46 excess payments.

### Refunded *(M2)*

- **Definition.** Refunds attributable to confirmed cases.
- **Population.** Multi-payment cases, verdict confirmed, recovery ≠ `Unknown`.
- **Formula.** `SUM(min(matched refund, case duplicated fees))`.
- **Current value.** **AED 3,491.00** across **15 cases**. **Zero fully recovered.**

### Still out *(M3 — the headline)*

- **Definition.** Duplicated fees not returned. What the company is still down.
- **Formula.** Duplicated fees − Refunded.
- **Current value.** **AED 16,853.50**.
- **Threshold.** No green band — any exposure is a finding. Cases sort by this, descending.

### Pending a ruling *(M4)*

- **Definition.** Value that becomes exposure if the outstanding rulings go against us.
- **Population.** Multi-payment cases, verdict AMBER.
- **Formula.** Same as Duplicated fees, over AMBER cases.
- **Current value.** **AED 8,873.50** across **45 cases**.
- ⚠️ A blocked case contributes only its *matched* excess fees. A batch case (496.00 plus a 196.00) contributes **zero** — the 196.00 is not a duplicated fee, it is an unexplained payment. Pricing every AMBER case at `(payments − 1) × fee` overstated this by roughly AED 3,500 in an earlier draft.

### Cases by verdict *(M5)*

- **Population.** All cases.
- **Formula.** `COUNT(DISTINCT case_id)` by the single verdict column, `case_id = TO_VARCHAR(VISA_REQUEST_ID) || '·' || PURPOSE`.
- **Nulls.** D2 is non-null on the audited record; where no case key resolves, mint a surrogate so the record stays countable.
- **Current value.** **45 confirmed · 46 blocked · 69,033 clean** *(45 blocked within the 90 multi-payment cases, plus `12822` blocked at T5 with one payment)*.

### Exception rates, both denominators *(M6)*

- **Formula.** confirmed / multi-payment cases, **and** excess payments / all payments.
- **Division by zero.** Renders "—", not 0%.
- **Current value.** **50.0% of multi-payment cases** · **0.066% of all R-visa payments**.
- ⚠️ **Both must appear on the tile.** 50% alone reads as "half our residence-visa payments are duplicated".

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
| R-visa lines in D1, both purposes | 71,791 | |
| less `OWNER_TYPE = 'OFFICE_STAFF'` | 802 | |
| less null `TRANSACTION_ID` | 1,770 | Bookings with no payment |
| less lines sharing a transaction | 1 | Collapsed to payment grain — one line, request `12822` |
| **= All R-visa payments** | **69,218** | |
| *memo:* payments whose line is not `Added` | **0** | Not a deduction. Sized here, tested at T7 |
| Transactions on R-visa heads with no visa line | 981 | Pre-2017-06; no case key. **BLOCKED, not clean** |
| Visa lines with no matching transaction | 1,532 | Payment link absent |

✅ **Measured and reconciling: 71,791 − 802 − 1,770 − 1 = 69,218.** Re-run each refresh; a residual is a run failure.

### Tie-out rules

Two identities, both against independent controls — not partitions of a derived column.

```
1. COUNT of distinct TRANSACTION_ID in All R-visa payments
   = Σ payments across all cases (single-payment + multi-payment)
   residual displayed as its own exception row

2. Σ (AMOUNT + CHARGE + VAT_CHARGE) in D1 for payments in multi-payment cases
   = Σ TRANSACTION_AMOUNT in D12 for the same transaction ids
   residual displayed; the only genuinely external money control available
```

⚠️ `duplicated + pending + excluded = total` is **not** a tie-out — both sides come from the same case table by the same expression and it cannot fail.

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

## 4. Finalised UI Report

Mockup: https://claude.ai/code/artifact/3ce6b63e-afbb-4b45-8eff-d530f899e735 — restated here because a link is not machine-readable to the DNA intake bot.

**Layout.** KPI strip (Still out · Confirmed cases · both exception rates · Unrecovered) → filter bar → exception table → one chart (cases by blocking reason, which is also the AMBER tie-out). One screen to the top of the table.

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
| Recovery | Unrecovered · Partial · Full · Unknown | label | — |
| Span | days between first and last payment | integer | secondary sort |
| Channel | Noq · Card · mixed | label | — |
| Verdict | the single verdict column | Confirmed / Blocked / Clean + word | — |
| Status | workflow | New · Under review · Escalated · Closed | — |

**Filters.** Verdict (**default Confirmed**) · recovery (**default Unrecovered**) · reason · period of last payment · channel. Every default shown on screen.

**Drill-down.** The payments in the case: transaction id, transaction date, `AMOUNT`, `CHARGE`, `VAT_CHARGE`, channel, matched fee, and the T1–T9 trace. **Excluded from the drill-down and the export: `DESCRIPTION`, `EMPLOYEE_NAME`, `CREATOR_NAME`, `LAST_MODIFIER_NAME`, and D14's `RELATED_TO_NAME`.**

**Conditional formatting.** Row colour driven by the verdict column only, never colour alone — every row carries the verdict word.

**Provenance line.** Sources and as-of timestamp, displayed.

**Export.** CSV of row-level detail, excluding the columns above.

**Sensitive data.** The report reads visa request ids, transaction ids, dates, amounts, channels and maid ids for display. `DESCRIPTION` carries maid names and, from 2026-01, passport numbers; `EMPLOYEE_NAME`, `CREATOR_NAME`, `LAST_MODIFIER_NAME` and `RELATED_TO_NAME` carry staff and subject names. **None may be selected into the report, the export, a chat reply or an email.** Reading `DESCRIPTION` as a *filter predicate* is permitted; selecting it for display is not. Operator identity is not reported — the concentration statistic in §6.6 was computed and deliberately not carried into the report.

---

## 5. Worked Examples

### A — Clean: the lifecycle, not a duplicate

Request `9141` carries `APPLY_FOR_RVISA` 497.00 (2019-09-03) **and** `RENEW_RESIDENCE` 443.50 (2025-02-05).

Keying on request **and purpose** puts these in two cases. T1 clean in both.

⚠️ Keying on request alone classes this as a duplicate — across the population that produced **8,785 cases and AED 4,215,566** against the correct **90 and AED 29,218**.

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
2. 🔴 **Do failed Credit_Card charges reverse outside the ERP?** Settles 11 cases at once — either loss or zero, and T4 cannot return RED until answered. → **Finance / card-flow owner**
3. **Is the 2020 batch reading correct?** 18 cases held blocked on P&C's inference from consecutive transaction ids on two dates at a non-fee amount. Confirm or kill. → **Visa team**
4. **Who owns the process fix?** The defect happens at one identified place: the **"Apply for R-visa"** task in the Visa module, in both the initial and renewal pipelines. Whoever owns that task owns the fix. Without an owner this is a dashboard, not a control. → **Hassan / Malaz**
5. **Confirm R-REFUND-AMOUNTS.** 239.50 · 189.00 · 189.50 · 289.50 are inferred from concentration, not from a published schedule. → **Finance**
6. **Operator concentration — report or not?** One operator holds 45.6% of duplicates against a 25.2% population share (~1.8×). Not a batch signature; not R-visa money. Currently computed and deliberately unreported. → **Hassan**
7. **Sign off R-FEE-SCHEDULE.** Now measured with dated windows and volumes, but never read from an authority tariff. Every money figure depends on it. Two specifics: are `555.00`/`556.00` (2018) genuine fees, and is the pre-2018-07 gap acceptable? → **Finance**
8. **Long-gap cases.** 12 cases held blocked pending N2. Confirm N2 exists or accept them as permanently blocked. → **Visa team**
9. **The three refund-before-duplicate cases.** Held blocked as correction cycles. Treating them as confirmed instead adds **AED 1,330.50** to Duplicated and **AED 618.50** to Refunded. → **Hassan**
10. **Cleaners in or out?** Head `149` covers cleaners, whom `OWNER_TYPE = 'HOUSEMAID'` selects. Currently in scope. → **Hassan**

---

## 7. Handover notes

- **No approved KPI exists.** Every figure here is an unverified ad hoc definition; recommend adding it to the Data Catalog on approval.
- **Do not schedule this.** Manual trigger only — a standing run goes to the ERP team.
- **The population definition was wrong four times in development.** Too narrow (a 90-day gap filter hid 25 real cases); catastrophically too wide (grouping purposes together turned the normal apply-then-renew lifecycle into AED 4.2m of imaginary loss); contaminated (an asymmetric head predicate credited AED 668 of entry-visa refunds as R-visa recoveries, twice); and mis-clocked (dated lists written against line-creation dates when the payments are dated one day later, which made the batch test match zero cases).
- **Three tests were dead or missing when v2 was written.** T5 was scoped so it could never fire; T8 and T9 did not exist, and between them they were worth AED 1,774.00 of false findings.
- 🔴 **A sibling control already exists, and nobody has joined them up.** `BA_VIEWS.VISA_SILVER.MISSING_EXPENSES` flags the *opposite* failure — the "Apply for R-visa" step completing with **no** payment recorded. Since its 2025-06-01 cutoff it holds **58 renewal alerts against 1 initial**. This report cannot see an absent payment (a scan over rows that exist never can); that report cannot see a duplicated one. **Together they are the whole control and separately neither is.** The 58:1 split also says the renewal pipeline is the weaker one at *both* ends — over-paying and under-recording — which is where a process owner should look first. Out of scope here; handed over, not absorbed.
- **The lesson for whoever maintains this:** detecting two payments on one request is trivial. **Classifying which of nine shapes you are looking at is the entire job** — and every predicate must be applied identically on both sides of any comparison, on the same clock.
