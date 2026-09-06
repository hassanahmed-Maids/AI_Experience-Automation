# Spec — R-Visa Audit

| | |
| --- | --- |
| **Requested by** | Police & Control (Notion check owner: Malaz; reviewer: Malaz; scope rulings: Jacky) |
| **Spec version** | v1 — DRAFT, feedback loop pass 1 open |
| **Date** | 2026-09-06 |
| **UI mockup** | https://claude.ai/code/artifact/27e47862-a479-40d1-b60c-b611ccac0bc9 |
| **Status** | Draft — not yet approved by requestor |
| **Source check** | Notion → Audit Flow Factory → Both Maids → Checks — Both Maids → *R-Visa Audit* |
| **Jira** | **DNA-9529** (Analytic Engineer Task, model) blocks **DNA-9530** (BI Visualization Task, dashboard) — filed 2026-09-06. Pre-existing: SD-67794 (n8n build request). |
| **Archetype** | Exception / rule-breach list (ui-patterns §4), with an authorised-vs-actual sub-shape for the two fine tests |

> **What is new in this spec versus the Notion check page.** The Notion page designs the check
> against the **ERP transactions API**, where it declares four rules unbuildable (no entry-visa
> anchor, no maid id on the list payload, no cancellation route, no visa term). Discovery for this
> spec found `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` in the warehouse, which carries a structured
> `PURPOSE` code, `VISA_REQUEST_ID`, `OWNER_ID`/`OWNER_TYPE` and `TRANSACTION_ID`. **Three of the
> four declared blockers are removable in a warehouse build.** See §2.4.

---

## 1. Business Logic

**The control.** An R-visa is a housemaid's UAE residence visa. maids.cc pays the government fee
for it once per visa term, and where the visa is issued late the authority also charges an overstay
fine. The control is: **exactly one residence-visa fee per visa term, at the tariff in force, and
any overstay fine paid must equal the fine the entry and payment dates imply — and must be assigned
to somebody to repay.**

**The failure it catches.** Money paid out on a maid's residence visa that should not have been
paid, or should have been recovered:

1. **Double payment** — a second R-visa fee inside the same visa term with no cancellation behind it (≈ AED 447 each).
2. **Fine overcharge** — more overstay days paid than the transaction dates justify (AED 50/day).
3. **Fine undercharge** — fewer overstay days paid than the dates imply. *This is the direction the prior art never tested and where most real cases sit* — 18 of 25 in 2025.
4. **Fine responsibility unassigned** — a fine sitting on our books with nobody made to repay it.

**Reader and action.** Police & Control auditor, per run (manual trigger, not scheduled). A red row
is worked case by case: pull both transaction ids, re-derive the day arithmetic shown on the row,
and either recover the money or record why not. Reds are drafted to Malaz by email.

**Population in scope.** Every residence-visa fee payment for **CC maids and MV maids**, all-time.

**Explicitly out of scope** — each is named because a looser filter sweeps it in:

| Excluded | Size (measured 2026-08-28) | Why |
| --- | --- | --- |
| Office staff R-visa payments | 35 rows in 2025 (34 on `Visa Expenses - Dubai Expat staff`, 1 on `NEW - OfficeStaff - R-visa Application 2 years`) | Deliberate ruling, Jacky 2026-08-20. Structurally excludable as `OWNER_TYPE <> 'HOUSEMAID'` |
| Salary rows mentioning "R-visa" | 2 rows, AED 1,000 each (`MaidVisa Housemaids Basic Salary`) | Not a visa fee. Any description-only filter picks them up |
| Client refunds carrying "pre R-visa cancellation" | 27 rows, −AED 83,558 | Client money-**in**, owned elsewhere. Only transaction `1172259` (−AED 239.50) is a genuine R-visa fee refund and stays in |
| Cancellation fees on the shared immigration heads | median AED 125.65 | Different product |
| Entry visa, MOHRE, change-of-status, EID, ILOE on the shared immigration heads | 14,047 of 14,437 rows | Different products. The expense filter alone widens the population ~10× |
| VAT treatment | — | Authority fees are paid gross; no VAT line is separated. Not a gap |
| Maid nationality | — | Irrelevant to an R-visa fee. Not a gap |

**Grain.** Two grains, both explicit and both carried in the model:

- **Detail grain — one row per R-visa payment.** All tests evaluate here.
- **Report grain — one row per maid (the "case"), carrying every R-visa payment she has ever had.**
  Not one transaction and **not one calendar year**: within 2025 only 2 maids have a repeat payment;
  all-time the figure is **182**. A window-scoped duplicate scan misses roughly nine cases in ten
  (spec-traps §11).

**Refresh expectation.** Manual / on demand. **The reporting window scopes reporting only — the
duplicate scan population is always all-time.** Nothing here runs unattended (see §7 Guardrails).

---

## 2. Data Points Needed

### 2.1 Verified — already in Snowflake

Connection used: account `IH42925`, role `PAYROLL_AND_MONEY_CONTROL_ROLE`, 2026-09-06.

> ⚠️ **Verification depth.** This role has **no warehouse grant**. `COUNT(*)` on a table is served
> from metadata and is real; every row-scanning query was refused
> (*"You must specify the warehouse to use"*). So the evidence below proves **structure, types,
> grain, enum membership, lineage and view filters** — it does **not** prove population, freshness
> or cardinality inside the audit period. Content figures in this spec come from the check's own
> prior measurements (Notion page, measured 2026-08-20 / 2026-08-28) and are labelled as such.
> §6 O1 lists the queries that close the gap.

| # | Data point | Database.Schema.Table | Column(s) | Grain | Verification |
| --- | --- | --- | --- | --- | --- |
| **D1** | Money-out payment ledger | `BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS` | `ID`, `TRANSACTION_DATE` (DATE), `TRANSACTION_AMOUNT` (FLOAT), `EXPENSE_ID` (NUMBER), `EXPENSE`, `EXPENSE_ROOT`, `DESCRIPTION`, `CREATOR`, `HOUSEMAID_ID` (NUMBER), `PAYMENT_ID`, `VAT_TYPE`, `VAT_AMOUNT` | One row per transaction | `DESC TABLE` — 30 columns, all types read. `COUNT(*)` = **2,119,291**. TRANSIENT table, **no dbt column comments** |
| **D2** | Visa-request expense ledger — *the key object* | `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | `VISA_REQUEST_ID`, `REQUEST_TYPE`, `PURPOSE`, `AMOUNT`, `STATUS`, `TRANSACTION_ID`, `OWNER_ID`, `OWNER_TYPE`, `CONTRACT_TYPE`, `PAYMENT_DATE`, `CREATION_DATE`, `IS_DELETED`, `CHARGE`, `VAT_CHARGE`, `CREATOR`, `REFERENCE_NUMBER` | One row per expense line item across new / renew / cancel requests | `GET_DDL` — full dbt metadata read. `COUNT(*)` = **622,673** |
| **D3** | Expense-head configuration | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` | `ID`, `CODE`, `EXPENSE_TYPE`, `STATUS`, `BENEFICIARY_TYPE`, `CATEGORY`, `TOP_PARENT_CATEGORY`, `EXPENSE_DISPLAY_CODE` | One row per expense type | `DESC VIEW` — 47 columns with dbt comments |
| **D4** | Expense parent tree | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_HIERARCHY` | `EXPENSE_ID`, `EXPENSE_NAME`, `ROOT` | One row per expense type | `GET_DDL` |
| **D5** | Visa request headers | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS`, `.RENEW_VISA_REQUESTS`, `.CANCEL_VISA_REQUESTS` (+ `_TASKS`, `_HISTORY`) | `REQUEST_ID`, `OWNER_ID`, `OWNER_TYPE` confirmed as referenced by D2; remaining columns **UNVERIFIED** | One row per visa request | Objects confirmed to exist (`SHOW OBJECTS`); referenced by D2 as dbt `ref()` dependencies. Columns not individually read |
| **D6** | R-visa duration detail | `BA_VIEWS.VISA_SILVER.RVISA_DURATIONS_DETAILS_INITIAL` / `_RENEWAL` / `_CANCELATION`; `RVISA_RAW_DATA_INITIAL` / `_RENEWAL` / `_CANCELATION` | **UNVERIFIED — Snowflake team to confirm** | unknown | Objects confirmed to exist only. Candidate source for the visa **term** (T8) |
| **D7** | Maid visa information | `BA_VIEWS.VISA_SILVER.HOUSEMAIDS_VISA_INFORMATION` | **UNVERIFIED — Snowflake team to confirm** | unknown | Object confirmed to exist only |
| **D8** | Adjacent existing model — **check before building** | `BA_VIEWS.VISA_SILVER.LOST_VISA_EXPENSES`, `.MISSING_EXPENSES`, `.MISSING_EXPENSES_HISTORICAL`, `VISA_GOLD.REQUESTS_EXPENSES_DETAILS` | — | — | Named as downstream models of D2 in D2's dbt lineage. **These may already implement part of this check** — see O2 |

**Key structural facts read out of D2's dbt metadata** (each one changes the design):

| Fact | Consequence |
| --- | --- |
| `PURPOSE` enum includes `APPLY_FOR_RVISA`, `RENEW_RESIDENCE`, `ENTRY_VSIA` *(sic — misspelt in source)*, `ENTRY_VISA_LESS_THAN_1000`, `RESIDENCE_CANCELLATION`, `ONLINE_CANCELLATION`, `IMMIGRATION_CANCELLATION`, `EID`, `MEDICAL`, `CHANGE_OF_STATUS`, `ILOE_SUBSCRIPTION`, `WORK_PERMIT` … (enum shown truncated with "…" in the comment) | The population is identifiable **structurally**, not by expense-head text. The whole "expense heads renamed 2025-12-19, two legs, text matching" problem disappears — see §2.4 |
| `REQUEST_TYPE` ∈ `NewRequest`, `RenewRequest`, `CancelRequest`; `VISA_REQUEST_ID` present | Duplicate detection can key on **visa-request identity**, which Notion test case 3 established as the correct key |
| `OWNER_TYPE` ∈ `HOUSEMAID`, `OFFICE_STAFF`; `OWNER_ID` present | Office staff excluded structurally; maid identity available **without** an ERP detail call |
| `TRANSACTION_ID` — FK to `mmdb_transformed.transactions.ID`, **nullable** | Join to D1. Nullable ⇒ absence must be BLOCKED, never clean (spec-traps §7) |
| `PAYMENT_DATE` minimum observed `0025-11-06` — documented as a **source-system sentinel**, with the model's own advice to filter `> '1900-01-01'` | The Notion page's "year-0025" mystery (test case 4) is a **known sentinel**, not a warehouse artefact. Upgrades T7 from heuristic to documented rule |
| `AMOUNT` observed max ≈ **19.7 trillion** — flagged as a data-quality anomaly, `SUM` without a range filter listed as a HIGH anti-pattern | A range guard is mandatory before any total |
| `STATUS` ∈ `Added`, `Dismissed`, `Pending` (the **expense-row** status, not the request workflow status) | A `Dismissed` line is not a payment. Must be handled explicitly, not assumed |
| `IS_DELETED` contains only `'0'` — deleted rows filtered upstream | Filter is safe but redundant. **Do not** treat it as a working soft-delete guard |
| `CONTRACT_TYPE` ∈ `'CC '`, `'MV '` — **values carry a trailing space** | `TRIM()` required on every comparison, or the CC/MV split silently matches nothing (spec-traps §15) |
| `CONTRACT_TYPE` is resolved from an `ActiveContracts` CTE filtered to `STATUS='ACTIVE'`, `rn=1` — the **latest active** contract | CC/MV is **as-of-now, not as-of-payment**. A maid who moved between products is labelled by her current contract. Material for a historical audit — see O3 |
| D2's renew and cancel legs use **INNER JOIN** to `RENEWREQUESTEXPENSES` / `CANCELREQUESTEXPENSES` | A renewal or cancellation expense with no matching request record **is absent from the enrichment**, not visible as unmatched (spec-traps §7) |
| `EXPENSES_HIERARCHY` (D4) filters `e.is_deleted <> 1 AND e.is_secure <> 1` | A **secure** expense head is invisible in D4. "No such expense head" cannot be concluded from D4 alone |

### 2.2 Approved KPI definitions reused

`BA_VIEWS.CORE_SILVER.INSIGHTS_DASHBOARD_CONTAINER` **exists** (confirmed by `SHOW OBJECTS`, view in
`BA_VIEWS.CORE_SILVER`). Its **rows could not be read** — reading them needs warehouse compute this
role does not have.

> **No approved definition has been confirmed for any metric in §3.** Every metric below is therefore
> a **new Police & Control definition**, labelled an unverified ad hoc definition and **not** an
> approved KPI. **Action for DNA (blocking, O4):** query the container for R-visa / visa-fee / overstay
> entries before building; if an approved definition exists, its logic and **all** its filters
> (including `FAKE = false`) replace the corresponding metric here verbatim. If none exists, the Data
> team should add M1–M4 to the Data Catalog.

### 2.3 New data ingestion request — NOT in Snowflake

#### N1 — Authority tariff for the R-visa fee and the overstay fine

- **Definition.** The government's published price for a residence visa (by term), the overstay fine per day, and the grace period before overstay begins.
- **Source.** **Not a system.** A published authority tariff / the `Visa Process Details` document held by the Visa & PRO team.
- **Native location.** None. Not in Snowflake, not established in the ERP.
- **Owner.** Visa / PRO team (route via Malaz).
- **Why this is the single most important item in the spec.** **Three of the four constants this check runs on — the base fee, the AED 50/day rate, and the 60-day grace — were reverse-engineered from Khalil's dashboard arithmetic and have never been read from an authority source.** They reconcile on 25 of 25 fine rows in 2025 and 15 of 15 off-base rows in 2026 — *two independent periods, which proves consistency and never correctness.* Every red T2/T3 verdict and the whole of M5/M6 rest on them.
- **Values currently in use** (measured, not sourced): base fee **446.65 / 457.46 / 346.65**; the `Visa Process Details` tariff reads **457.46**, matching the figure live since **2025-07-07**. Fine **AED 50/day**. Grace **60 days**.
- **History needed.** A dated tariff table — fee **by effective date**, since 2024-01-01. A single current price cannot audit a 2025 payment.
- **Format.** Three columns minimum: `EFFECTIVE_FROM`, `EFFECTIVE_TO`, `AMOUNT`, per fee type and per term.
- **Until it exists.** T2/T3 red verdicts are reported but carry the flag `CONSTANTS_UNSOURCED = TRUE`, and the report displays it on the provenance line. This is a stated limitation, not a silent one.

#### N2 — Fine repayment responsibility

- **Definition.** Who is required to repay an overstay fine that maids.cc paid — the maid (via loan), the client, or nobody.
- **Source.** Recorded **only in prose** today. No structured field.
- **Native location.** Unknown — **UNVERIFIED**. The sibling checks carry it structurally: *MV Overstay Fines* (expense 1677, threshold AED 300, base 575.65, **client pays**) and *CC Overstay Fines* (expense 1589, threshold 200, **the maid's loan pays**). R-Visa has **no established payer**.
- **Owner.** Malaz (policy), Visa team (operational).
- **Volume.** 25 fine cases (2025) + ~15 (2026 to 08-20) = **~40 all-time**. Small enough to resolve by hand once.
- **Why it matters.** T5 is one of the four red shapes and **cannot run at all** without this. Until then T5 returns `BLOCKED(no_responsibility_source)` on every fine record, which makes every fine case AMBER. That is the correct behaviour, and it is why the AMBER count will initially be large.

#### N3 — Written clearance for a duplicate that followed a cancellation

- **Definition.** The owner's written statement that a second R-visa fee is explained by a cancellation of the first.
- **Source.** Free text on the transaction / visa-request notes. Candidate structured route now exists — see §2.4 — but the **written** clearance itself is prose.
- **Native location.** `BA_VIEWS.VISA_SILVER.VISAREQUESTSNOTES` — object confirmed to exist; columns **UNVERIFIED**.
- **Owner.** Visa team.
- **Volume for the verifier.** **9 pairs** in the 0–30-day duplicate band, all-time.
- **Requirement (do not soften).** This is an **AI-judgement field**: put to the model the question *"Does this note state that an earlier R-visa fee for this maid was cancelled or refunded, and identify which payment?"*; allowed outputs `CANCELLED_EXPLAINED` / `NOT_EXPLAINED` / `UNCLEAR`; `UNCLEAR` and low confidence ⇒ `BLOCKED`, never a pass. Evidence may sit on **either** transaction of the pair. A conclusion binds **the pair**, never the maid's whole payment history.

#### N4 — R-visa rejection and refund-request status

- **Definition.** Whether an R-visa application was rejected, and whether a refund was requested.
- **Status.** **Does not exist in the ERP at all** (established on the Notion page). `VISA_DOCUMENTS_REJECTION_HISTORY` exists in `VISA_SILVER` but is document-level rejection, **not** R-visa application rejection — **UNVERIFIED** as a substitute.
- **Consequence.** T9 returns `BLOCKED(no_rejection_source)` permanently. Declared, not hidden. Do not report `inconclusive` as clean.

**Join keys.**

| From | To | Key | Types | Risk |
| --- | --- | --- | --- | --- |
| D2 `TRANSACTION_ID` | D1 `ID` | `TRANSACTION_ID = ID` | NUMBER → NUMBER | **Nullable on D2.** Unlinked expense ⇒ BLOCKED, not dropped |
| D2 `OWNER_ID` (where `OWNER_TYPE='HOUSEMAID'`) | D1 `HOUSEMAID_ID` | equality | NUMBER → NUMBER | D1's `HOUSEMAID_ID` fill rate **UNVERIFIED**; do not assume populated |
| D1 `EXPENSE_ID` | D3 `ID` / D4 `EXPENSE_ID` | equality | NUMBER → NUMBER | D4 hides secure/deleted heads |
| D2 `VISA_REQUEST_ID` + `REQUEST_TYPE` | D5 `REQUEST_ID` | composite | NUMBER + VARCHAR | `VISA_REQUEST_ID` is **not unique alone** across the three request types — the composite is required |

**Known data hygiene issues.** `AMOUNT` outlier ≈19.7tn (range guard mandatory) · `PAYMENT_DATE`
sentinel `0025-11-06` (filter `> '1900-01-01'`) · `CONTRACT_TYPE` trailing space (`TRIM()`) ·
`IS_DELETED` is inert · D2 `ID` is a `ROW_NUMBER()` surrogate **not stable across rebuilds — never
use it as a business key** · a `STATUS='Dismissed'` line with no `TRANSACTION_ID` is not a payment
(see the scope table in M1) · D2 renew/cancel INNER JOIN drops unmatched rows · D4 hides `is_secure`
heads · D1 has **no dbt comments**, so no column semantics are documented for it.

**Edge cases, each with its stated treatment.**

| Edge case | Treatment |
| --- | --- |
| **Timezone** | D1 `TRANSACTION_DATE` is a `DATE`; D2 `PAYMENT_DATE`/`CREATION_DATE` are `TIMESTAMP_NTZ` with **no timezone stated anywhere in the metadata**. A payment near midnight can land in a different month on the two sources, and the anchor arithmetic is a day count. **Period assignment uses D1 `TRANSACTION_DATE` alone**; every day count is computed in **Gulf Standard Time (UTC+4)**; and the timezone of `TIMESTAMP_NTZ` must be confirmed — **O14** |
| **Retroactive corrections** | A payment corrected after its period closed is reported **in the period of the original transaction date**, and history restates. The run stamps `AS_OF` so two runs of the same period can be diffed. Do not report the correction in the current period — it would double-count against M1 |
| **Refunds / negatives** | Genuine R-visa fee refunds stay in and net against the case (`1172259`, −AED 239.50). T6 is `NOT_APPLICABLE` on a negative amount. Client refunds carrying "pre R-visa cancellation" are out of scope (§1) |
| **Zero amounts** | Exception row, never silently clean |
| **Multi-currency** | Not applicable — AED only, authority fees paid gross |
| **Mid-period start/end, pro-ration** | Not applicable — a visa fee is a single event, not an accrual. No pro-ration basis is needed |
| **Present in one source, not the other** | An R-visa expense line with `TRANSACTION_ID IS NULL`, or a transaction with no matching D2 row, becomes an **exception row** — never a silently dropped row |
| **Completeness** | This report is **not** a completeness audit: every test fires on a payment that exists, so no expected-population source is required. A *missing* R-visa payment (a maid who should have been charged and was not) is **out of scope and is a separate check** — stated so nobody assumes this report can see one |

### 2.4 Three of the four declared blockers are removable

The Notion page's *Known limitations at build time* list four blockers of the **ERP-API** build. Against the warehouse:

| Notion blocker | Warehouse position |
| --- | --- |
| ❼/❽ **cannot fire** — "no entry-visa expense head has been established" | **Removable.** D2 `PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')` gives the anchor structurally, per `OWNER_ID`, with dates. *Confirm the enum tail — the comment truncates with "…", so membership must be profiled (O5).* |
| ⓫ **refused** — `GET /accounting/transactions/{id}` returns `INSUFFICIENT_PERMISSIONS`, no maid id on the list payload | **Removable.** D2 carries `OWNER_ID` / `OWNER_TYPE` directly. No per-transaction ERP call, so the ~500-call budget problem does not exist in a warehouse build |
| ⓬ / verifier ❸ **unbuildable** — no rejection/refund field | **Still blocked.** N4. T9 stays permanently BLOCKED |
| ❻ — purchased 1y/2y term "appears not to be stored anywhere" | **Possibly removable.** D6 `RVISA_DURATIONS_DETAILS_*` are candidates. **UNVERIFIED** — O6 |

Also removable: the **duplicate key**. The prior art keyed on the maid's **name**, parsed out of free
text, at ~4% precision — 56 multi-payment groups in 2025, of which **54 resolve to more than one
distinct maid id**. Keyed on identity the answer is **2**. D2's `OWNER_ID` and `VISA_REQUEST_ID`
make the name parse unnecessary. **Do not re-implement name matching.**

And the **population rule**. The Notion page needs two legs either side of the 2025-12-19 expense-head
rename, because before that date no account line meant "R-visa" and only the payment text separated
them, while after it reading the text throws away **33.6% of 2026 rows (3,826 of 11,392)**. On D2,
`PURPOSE` is stable across the rename, so the warehouse population is **one rule, not two**. The
expense-head route (D1 + D3/D4) is retained as the **reconciliation control**, not the definition —
that disagreement is exactly what TO-2 measures.

---

## 3. Metric Calculations

### 3.0 Verdict algebra — read this before any metric

Every test returns exactly one of **four** values: `RED(type)` · `GREEN` · `BLOCKED(reason)` ·
`NOT_APPLICABLE`. The record verdict is:

```
RED    ⟸ any applicable test returned RED          (one is enough)
AMBER  ⟸ not RED, and any applicable test BLOCKED
GREEN  ⟺ every applicable test RAN and returned GREEN
```

Four rules that make it hold, each of which **corrects the Notion page's design**:

1. **No early exit.** The Notion page orders its gates so that "the first rule that fires decides"
   (❾ parks before ⓫; ❹ suppresses ❼/❽). Evaluate **every** applicable test, record all outcomes in a
   `TEST_TRACE` column, and use the Notion ordering **only as display precedence for the reason
   shown**. A test that *cannot* run does not fire, so an early-exit ladder lets a record reach GREEN
   with an applicable test silently unrun.
2. **One verdict column, computed once,** at detail grain, rolled to case grain by the same algebra.
   Every tile, chart, filter, row colour and export aggregates `VERDICT`. Nothing re-derives
   eligibility for itself.
3. **No fourth state.** The Notion page names five outcome words. They map onto three verdicts plus a
   **separate workflow column** — they are not verdict values:

   | Notion word | `VERDICT` | `WORKFLOW_STATE` | `REASON_CODE` |
   | --- | --- | --- | --- |
   | Double payment / Fine overcharge / Fine undercharge / Fine responsibility unassigned | `RED` | `New` | the test name |
   | Renewal / Duplicate explained | `GREEN` | `Cleared` | — |
   | Pending (identity / base fee / unsettled) | `AMBER` | `New` | the blocking reason |
   | Route to verifier | `AMBER` | `With verifier` | the blocking reason |
   | Inconclusive | `AMBER` | `With verifier` | `inconclusive` |

   **`inconclusive` is not a synonym for clean.** A run that counts it as one has answered a question
   it never asked.
4. **Blocking is scoped to the single test.** A missing anchor blocks T2/T3 only — the duplicate test
   T4 still runs on the same record. This is precisely why Notion test case 1 must still go red.

**Blocking is not a suppressor.** Notion's ❹ "date integrity" is modelled here as
`T2/T3 = BLOCKED(date_sentinel)` with T4 unaffected — same intent, expressible in the algebra,
and it carries no verdict of its own.

### The tests

| ID | Test | RED when | GREEN when | BLOCKED when | N/A when |
| --- | --- | --- | --- | --- | --- |
| **T1** | Identity resolved | never | `OWNER_ID` present and `OWNER_TYPE='HOUSEMAID'` | `OWNER_ID` null, or D2↔D1 link absent | — |
| **T2** | Fine overcharge | `paid_fine_days > implied_fine_days` | `paid_fine_days ≤ implied_fine_days` | no anchor, ambiguous **material** anchor, sentinel date, or T6 BLOCKED | payment carries no fine (`paid_fine_days = 0`) |
| **T3** | Fine undercharge | `paid_fine_days < implied_fine_days` | `paid_fine_days ≥ implied_fine_days` | as T2 | `implied_fine_days = 0` |
| **T4** | Duplicate payment | ≥2 R-visa fees on one `VISA_REQUEST_ID` (or one visa term) with no cancellation and no written clearance | exactly one fee per term, or a second fee explained by a cancellation/renewal | T1 BLOCKED, or clearance text `UNCLEAR` (N3) | maid has one lifetime payment |
| **T5** | Fine responsibility assigned | fine exists and is explicitly assigned to nobody | fine exists and a payer is recorded | **always, until N2 exists** | payment carries no fine |
| **T6** | Base fee resolvable | never | `amount − k×50 ∈ {446.65, 457.46, 346.65}` for some integer `k ≥ 0` | no such `k` | refund rows (negative amount) |
| **T7** | Date integrity | never | all dates > `1900-01-01` and ≤ run date | any date is a sentinel or implausible | — |
| **T8** | Visa term matches contract | term bought ≠ contract term | term bought = contract term | **always, until D6/O6 confirms a term source** | — |
| **T9** | Rejected R-visa handled | rejected visa with no refund claimed | — | **always (N4 — no source exists)** | — |

T5, T8 and T9 are **BLOCKED by construction today**. They are listed rather than dropped, because a
test removed from the table is a test nobody remembers to build (spec-traps §8). Their effect is
stated plainly in §5 Example D: **no case can currently reach GREEN.** That is honest, and it is why
M9 is on the KPI strip.

### The anchor rule (T2/T3) — matching without a key

There is no foreign key from an R-visa payment to the entry-visa payment that starts its 60-day clock.

- **Candidate set.** All D2 rows with `PURPOSE IN ('ENTRY_VSIA','ENTRY_VISA_LESS_THAN_1000')`, same `OWNER_ID`, `PAYMENT_DATE ≤` the R-visa payment date, `PAYMENT_DATE > '1900-01-01'`.
- **Zero candidates ⇒ `BLOCKED(no_anchor)`.** Never guess, never infer from the maid's arrival.
- **One candidate ⇒ use it.**
- **More than one ⇒ compute the verdict under *every* candidate.** If all candidates yield the same T2/T3 verdict, the choice is immaterial and the verdict stands. If they disagree, `BLOCKED(anchor_ambiguous)`. **Never take the latest, and never take the first.** Of the 40 fine rows since 2025, **6 have more than one candidate and the worst choice moves the answer by 965 days.** Notion's three 2026 overcharges each sit on a maid with exactly one entry-visa payment, so none of them depends on this.
- **Published metric, not a silent filter.** M10 anchor match rate, **per period**, with a floor of **90%**. Below the floor, T2/T3 are withheld for that period and the period is reported unverified. **A low match rate means unverified, never clean.**

---

### M1 — Population: R-visa payments in window

- **Definition.** Every residence-visa fee payment made for a CC or MV housemaid in the reporting window.
- **Formula.** `COUNT(*)` and `SUM(TRANSACTION_AMOUNT)` over the population below.
- **Inputs.** D2, D1.
- **Scope — defined by the audited record alone.** `PURPOSE IN ('APPLY_FOR_RVISA','RENEW_RESIDENCE')` and `TRANSACTION_DATE` in window. **That is the whole population filter.**

  > **Everything else is a test outcome, never a filter** (spec-traps §3). A filter written on a joined
  > column evaluates on the joined row, so a missing join and a NULL both make it UNKNOWN and the
  > record vanishes from every count, total, reason bucket and tie-out — while the tie-outs still
  > balance perfectly on the survivors. Nothing on the report would say those records existed, and
  > **that is worse than counting them as clean.** Join outward with `LEFT JOIN` and let a missing row
  > be amber:
  >
  > | Attribute | Wrong (as a filter) | Right |
  > | --- | --- | --- |
  > | `OWNER_TYPE` | `= 'HOUSEMAID'` — drops every NULL owner | Exclude only `= 'OFFICE_STAFF'` explicitly. NULL ⇒ **T1 BLOCKED**, record stays in |
  > | `CONTRACT_TYPE` | `TRIM(...) IN ('CC','MV')` in the **model** — drops NULL contract | **Displayed, and filterable in the UI** *(ruling, 2026-09-06)*. Three selectable buckets — `CC`, `MV`, **`Unknown`** — all on by default, so a null-contract record is visible and de-selectable rather than absent. `TRIM()` is mandatory (trailing space). It is never a filter in the model itself |
  > | `STATUS` | `<> 'Dismissed'` — drops NULL status, **and inherits the audited system's own filter** | Exclude a row only where `STATUS = 'Dismissed'` **and** `TRANSACTION_ID IS NULL`. A dismissed line that still carries a transaction id means money moved and is in scope — the ERP's own bookkeeping state must never clear a case (spec-traps §12) |
  > | `AMOUNT` | `BETWEEN -2000 AND 100000` — drops NULL and outliers | Rows outside the guard are **exception rows**, reported and excluded from `SUM` only, never dropped. NULL `AMOUNT` ⇒ exception row. Bound is a placeholder — **O7** |
  > | `IS_DELETED` | `= '0'` | Inert (only `'0'` exists). Do **not** rely on it as a soft-delete guard |
- **Currency & FX.** AED throughout. No conversion. **VAT-inclusive** — authority fees are paid gross and no VAT line is separated on them.
- **Rounding.** 2 dp, half up, **at row level**; totals sum the rounded rows.
- **Nulls.** A null `AMOUNT` is an exception row, never zero.
- **Division by zero.** N/A.
- **Approved KPI?** No approved definition confirmed — new P&C definition (§2.2).
- **Reference values** (prior measurement, Notion, 2026-08-28, expense-head route): 2025 = **19,311 rows / AED 8,684,562.33** (new generic 13,997 / 6,281,989.41 + renewal generic 4,782 / 2,163,697.11 + dedicated heads 19–31 Dec 532 / 238,875.81). 2026 to 08-28 = **11,558 rows / AED 5,220,544.65** (dedicated 11,392 / 5,144,606.29 + renewal tail 166 / 75,938.36). Monthly volume 2026 ranged **1,072 to 1,926** — budget the worst month, not the ~1,400 average.

### M2 — Cases

- **Definition.** One case per maid with at least one R-visa payment, carrying **every** payment she has ever had.
- **Formula.** `COUNT(DISTINCT OWNER_ID)` over the all-time population.
- **Filters.** As M1 **but with no window** — the scan population is all-time (spec-traps §11).
- **Nulls.** `OWNER_ID` null ⇒ the payment forms a singleton case flagged `T1 BLOCKED`. **Never dropped.**
- **Reference value.** Maids with a repeat payment: **2** within 2025; **182** all-time.

### M3 — Amount at risk (headline) — money already gone

- **Definition.** Money **paid out** that should not have been, exposed by red findings.
- **Formula.** `M3 = M4 + M5 + M7`, summed over cases where `VERDICT = 'RED'`.
- **M6 is deliberately excluded** — see M6a. *(Ruling, 2026-09-06.)*
- **Rounding.** 2 dp at row level.
- **This is the number an executive reads alone** — so it must be a true loss figure, not the
  population total and not a figure inflated by money we have not in fact paid.

### M6a — Underpaid fine exposure (reported separately, never inside M3)

- **Definition.** Fine days the dates imply that we have **not yet paid** — a liability that may still
  land, not a loss already taken.
- **Formula.** Identical to M6. Displayed as its own figure, labelled *"exposure not yet paid"*.
- **Why separated.** 18 of 25 fine rows in 2025 are undercharges. Folded into M3 they would dominate
  the headline and make money-not-yet-spent read as money lost. Kept separate, both numbers stay
  honest — and the undercharge finding, which is the main thing this spec adds over the prior
  dashboard, still gets a figure of its own rather than being demoted to context.

### M4 — Duplicate exposure (T4)

- **Formula.** For each duplicate group, `(count_of_fees_in_group − 1) × base_fee_of_the_group`.
- **Grouping, not pairing.** Group duplicates and nominate one representative, so a group of three does not contribute its amount three times (spec-traps §11).
- **Nulls / zero-division.** A group whose base fee is unresolved (T6 BLOCKED) contributes **nothing to M4** and the case is AMBER.
- **Threshold.** None. One unexplained duplicate is a finding.

### M5 — Fine overcharge exposure (T2)

- **Formula.** `Σ (paid_fine_days − implied_fine_days) × 50` over T2-RED payments.
- **Reference value.** 2025: **0 of 25** fine rows. 2026-01-01 → 2026-08-20: **3** (transactions `1692426`, `1706249`, `1990079`), total excess **4 days, AED 200**.
- ⛔ **Do not retire T2 on a one-year zero.** *A zero measured on one period is a fact about that period, not a property of the check.*

### M6 — Fine undercharge exposure (T3)

- **Formula.** `Σ (implied_fine_days − paid_fine_days) × 50` over T3-RED payments.
- **Reference value.** 2025: **18 of 25** fine rows (day gaps of 105, 54, 53, 48). 2026: **5 of 14**. The prior-art dashboard stamps all of these `OK`.
- **Note.** An undercharge is money **not yet** paid out. Keep it in a **separate column** from M4/M5, which are money already gone — see O8.

### M7 — Unassigned fine-responsibility exposure (T5)

- **Formula.** `Σ fine_amount` over T5-RED payments.
- **Today.** T5 is BLOCKED on every record, so **M7 = 0 and the fine cases are AMBER, not GREEN.** M7 becomes meaningful only when N2 lands.

**Conventions shared by M3–M7** (stated once rather than repeated): inputs are D1 `TRANSACTION_AMOUNT`
and D2 `AMOUNT`, `PURPOSE`, `PAYMENT_DATE`, `VISA_REQUEST_ID`, `OWNER_ID`, plus N1 for every constant ·
AED, VAT-inclusive, no FX · 2 dp half-up **at row level**, totals sum the rounded rows · a NULL input
makes its test `BLOCKED`, never zero · no division occurs except `÷ 50`, which is a constant, so no
division-by-zero case arises · **no tolerance band**: these are exact-arithmetic tests, and a
threshold would be a policy decision nobody has made (unlike the sibling overstay checks, which carry
AED 300 and AED 200 thresholds — **do not borrow theirs**).

### M8 — Exception rate

`M8 = RED cases ÷ M2`, 1 dp. Denominator displayed beside it (spec-traps §5 of the discovery traps — a ratio without a visible denominator cannot be told apart from a coverage change).

### M9 — Blocked rate

`M9 = AMBER cases ÷ M2`, with a breakdown by `REASON_CODE`. **On day one this will be ~100%** because T5/T8/T9 are BLOCKED by construction. The report must not read as "everything is broken" — see the UI note in §4.

### M10 — Anchor match rate

`M10 = payments with a usable anchor ÷ payments carrying a fine`, **per period**. Floor **90%**.

---

### Tie-out rules

| ID | Identity | Why |
| --- | --- | --- |
| **TO-1** | `Σ payments across all cases = M1` in both count and AED, **both sides carrying identical filters** | A filtered population compared against an unfiltered control total produces a definitional residual every period, and a tie-out that always fails is switched off (spec-traps §10) |
| **TO-2** | `PURPOSE`-route population − expense-head-route population = the named exclusion lines in §1, each quantified | This is the reconciliation that proves the new population rule matches the old one. A residual that is not one of the named lines is itself an exception row |
| **TO-3** | `RED + AMBER + GREEN = M2`, exactly. No fourth bucket | Proves no record fell out of the denominator |
| **TO-4** | `Σ REASON_CODE buckets = AMBER total`, in both count and money | This is the real assertion. *"Count displayed as blocked = count counted as blocked"* is a **tautology** when both sides read the one verdict column, and it passes in exactly the failure mode it was written to catch (spec-traps §2) |
| **TO-5** | Every AMBER record has a non-null `REASON_CODE`; every verdict rendered anywhere is one of three words | — |

---

## 4. Finalised UI Report

**Artifact.** https://claude.ai/code/artifact/27e47862-a479-40d1-b60c-b611ccac0bc9 — the layout below is
**restated in full here and in the DNA ticket**, because a Claude artifact link is not readable by the
DNA intake bot and is logged `UNVERIFIED`.

**Layout.** One screen: KPI strip → tie-out line → exception table → one chart (fine rows by outcome).

**KPI strip.** `M3` amount at risk (money already gone) · `M6a` exposure not yet paid · `M8` exception rate (with denominator `M2`) · `M9` blocked rate · `M10` anchor match rate. Each tile shows its metric ID. **M3 and M6a are never added together.**

**Columns.**

| Column | Source | Format | Sort |
| --- | --- | --- | --- |
| Case (maid) | M2 | `Maid #NNNNNN` — **id only, never a name** | — |
| Contract | D2 `TRIM(CONTRACT_TYPE)` | CC / MV | — |
| Payments | detail count | `#` | — |
| Verdict | `VERDICT` | Red / Amber / Green — **label + icon, never colour alone** | — |
| Rule breached | `REASON_CODE` | the rule in its own words | — |
| Amount at risk | M3 | `AED #,##0.00` right-aligned | **default desc** |
| Day arithmetic | T2/T3 | `paid 92 d vs implied 140 d` | — |
| Transaction ids | D1 `ID` | both ids, so a human can re-derive | — |
| Workflow | `WORKFLOW_STATE` | New / With verifier / Cleared / Escalated | — |

**Filters.** Period (default: current year) · CC/MV (default both) · verdict (default Red+Amber) · workflow state. **The period filter scopes reporting only — the duplicate scan stays all-time.**

**Drill-down.** A case opens its payments: date, amount, purpose, visa request id, anchor used, every test outcome from `TEST_TRACE`, and the blocking reason where present.

**Conditional formatting.** Row colour is driven by the single `VERDICT` column. Nothing else.

**Provenance line (required).** Sources, as-of timestamp, **and the two standing caveats**:
*"Fee/fine constants are unsourced (N1). T5/T8/T9 are blocked pending N2/O6/N4 — no case can currently reach GREEN."*

**Export.** Row-level CSV. **Per-person detail goes to the workbook/file only, never into chat, run summaries or email** — counts and totals only in those.

**Sensitivity — re-read against the column list above.** The report reads no salary, no IBAN and no
contact detail. It **does** read the transaction description field, and the sibling *E-ID Audit*
measured that same field carrying `Passport Number` and `Visa ID` from 2026-01 onward (31 of 1,738
rows in January, 77 of 1,759 in February, rising). **That was measured on E-ID rows, not R-visa rows,
so the share here is unmeasured.** Treated as sensitive until someone measures it: **the description
field is never displayed and never exported** — it is read only to compute, and the UI shows the
structured `PURPOSE` instead. Maid **names** are never the key and never displayed; `CREATOR` /
`LAST_MODIFIER_NAME` are **staff** personal data attached to cases framed as wrongdoing and are
**excluded from the row-level export** (O9).

---

## 5. Worked Examples

All five source cases were read on the Snowflake mirror 2026-08-20; cases A and C were additionally
confirmed against live ERP with a name cross-check. Arithmetic below is recomputed from §3 formulas.

### Example A — RED, duplicate payment *(Notion case 1)*

| Input | Value |
| --- | --- |
| Maid | `105870` |
| Payments | `1482201` (2025-09-13, AED 446.65), `1486146` (2025-09-17, AED 446.65) |
| Gap | 4 days, same creator, one maid id |
| Complication | `1486146`'s description carries a **year-0025** date |

T7 = `BLOCKED(date_sentinel)` → T2, T3 = `BLOCKED`. T6 GREEN (446.65 − 0×50 ✓). T4 = **RED** — two
fees, one visa term, no cancellation. T5/T8/T9 BLOCKED.
**Verdict = RED** (one red outweighs any number of blocked). **M4 = (2 − 1) × 446.65 = AED 446.65.**
*This case is the reason blocking must be scoped to the test: under the Notion page's original ❹ the
whole case would have returned `pending` and the duplicate red would have been lost.*

### Example B — GREEN-shaped, renewal *(Notion case 2)* — today AMBER

| Input | Value |
| --- | --- |
| Maid | `61273` |
| Payments | `856161` (2024-05-22), `2085707` (2026-08-19) |
| Gap | **819 days**, on `NEW - MV Housemaids - R-visa Application 2 years` |

A 2-year visa renewed after 2 years. T4 = **GREEN** (two terms, one fee each). T2/T3 N/A (no fine).
T6 GREEN. **T5 N/A, T8 BLOCKED, T9 BLOCKED ⇒ Verdict = AMBER (`term_source_missing`).**
**This is the mode of the repeat-payment distribution — 60 of 183 pairs — so if this case comes out
RED the whole rule is inverted.** It is the clearest argument for closing O6: until the visa term has
a source, the single most common legitimate pattern cannot be signed off as clean.

### Example C — GREEN-shaped, re-application *(Notion case 3)*

Maid `94824`, payments `1351061` (2025-06-13) and `1532914` (2025-10-14), 123 days apart, different
creators. Her visa request runs 2025-07-30 → 2025-10-16, so only the second payment belongs to it and
the first predates the request entirely; her history carries `Fill Previous Visa Info`, the marker of
a second visa cycle. **Two cycles, one payment each ⇒ T4 GREEN.**
*This is the case that proves T4 must key on `VISA_REQUEST_ID`, not on a day gap.* Verdict today
AMBER for the same T8/T9 reason as B.

### Example D — AMBER, blocked *(Notion case 4)* — the required blocked example

Transaction `1526423` (2025-10-07), description date `0025-10-03`. T7 = `BLOCKED(date_sentinel)`
⇒ T2/T3 `BLOCKED`. T4 N/A (single payment). **Verdict = AMBER**, reason `date_sentinel`.
**It counts in M9 and in TO-4's reason buckets, and it is absent from the clean count.**
The prior-art dashboard differenced the year-0025 date silently and reported `OK` with a 54-day
undercharge. `0025-11-06` is documented in D2's own dbt metadata as a source-system sentinel, so this
is a known defect class, not a one-off.

### Example E — RED, fine undercharge *(Notion case 5 — the hardest)*

| Input | Value |
| --- | --- |
| Transaction | `1641662`, 2025-12-17 |
| Amount | **AED 5,046.65** — the largest fine of 2025 |

- T6: `5,046.65 − 446.65 = 4,600`; `4,600 ÷ 50 = 92` — integer ⇒ **GREEN**, base fee 446.65, `paid_fine_days = 92`.
- Anchor: last entry-visa payment on or before 2025-12-17 ⇒ `implied_fine_days = 140`.
- T2: `92 > 140`? No ⇒ **GREEN**.
- T3: `92 < 140`? Yes ⇒ **RED**. **M6 = (140 − 92) × 50 = AED 2,400.** Expected total would have been `446.65 + 140×50 = AED 7,446.65`.

**Verdict = RED.** The prior art calls this `OK`. Every constant in the check is load-bearing here at
once — the base fee, the AED 50/day rate and the 60-day grace — which is exactly why N1 blocks
sign-off rather than merely annotating it.

### Example F — AMBER, catch-all *(the sixth Notion case)*

Transaction `1536291` (maid `105525`, 2025-10-17, **AED 798.05**). Fits no base fee plus any multiple
of 50: `798.05 − 446.65 = 351.40` (÷50 = 7.028), `− 457.46 = 340.59` (÷50 = 6.81),
`− 346.65 = 451.40` (÷50 = 9.028). **T6 = `BLOCKED(base_fee_unresolved)` ⇒ T2/T3 BLOCKED ⇒ Verdict =
AMBER.** The cheapest test that the catch-all actually fires.

---

## 6. Open Items

| # | Item | Owner | Blocking? |
| --- | --- | --- | --- |
| **O1** | **Row-level verification never ran.** This role has no warehouse grant. Re-run §2.1 as a `SnowFlake Access Request`, then profile: `PURPOSE` distribution, D1↔D2 join rate, `HOUSEMAID_ID` fill rate, and M1 reproduced on the `PURPOSE` route against the 19,311 / 11,558 reference figures | DNA / DE | **Yes** |
| ~~**O2**~~ | **CLOSED 2026-09-06.** DNA searched (project-wide, summary and full-text). **No ticket or model audits R-visa *fees*** — every R-visa item in DNA is a process-speed KPI or a step-blocker alert. Four relevant neighbours found; see the *Not a duplicate* table in §7, and O15/O16 below | P&C | Closed |
| ~~**O3**~~ | **RESOLVED 2026-09-06.** `CONTRACT_TYPE` is **displayed and filterable in the UI** (CC / MV / Unknown, all on by default) and is **never a population filter in the model**. As-of-payment sourcing is not pursued; the as-of-now caveat is carried on the provenance line | Malaz | Closed |
| **O4** | Query `INSIGHTS_DASHBOARD_CONTAINER` for an approved R-visa / visa-fee / overstay definition. If one exists it replaces M1–M4 verbatim with all its filters | DNA | **Yes** |
| **O5** | D2's `PURPOSE` enum is **truncated with "…"** in the column comment. Profile full membership — the warehouse enum has been shorter than the source enum before (spec-traps §5). Make the surplus a run guard asserting zero out-of-scope values | DNA | **Yes** |
| **O6** | Confirm whether `RVISA_DURATIONS_DETAILS_*` (D6) carries the purchased 1y/2y term. Until it does, **T8 is BLOCKED and no case can reach GREEN** | DNA | **Yes** |
| **O7** | `AMOUNT` range guard bound is a placeholder (`-2000 … 100000`). Set it from the profiled distribution | DNA | No |
| ~~**O8**~~ | **RESOLVED 2026-09-06.** M6 is reported separately as **M6a**, outside M3. M3 = M4 + M5 + M7 | Malaz | Closed |
| **O15** | **Alert 946 — "Money Lost — Overstay Fines Not Paid by Client"** already exists (DNA-5725 modified its conditions; DNA-7915 excluded old cases). It overlaps **T5** (fine responsibility). Read its conditions before building T5 — and note it is scoped to *client*-paid fines, whereas R-Visa's payer is the open question in N2. **Do not inherit its filter** | Malaz / DNA | **Yes** — it decides whether T5 is new work or a re-point |
| **O16** | **DNA-6078 — "Inflated Total Excluded Hours in R-Visa Duration Calculation"** is a known defect in the R-Visa duration tables (D6), and **DNA-2363** changed their columns and filtering logic. D6 is the candidate source for the visa term (O6). Read both before depending on D6, or T8 inherits a known-wrong calculation | DNA | **Yes** — gates O6 |
| **O9** | Confirm `CREATOR` / `LAST_MODIFIER_NAME` are excluded from the row-level export — staff names attached to cases framed as wrongdoing | Malaz | No |
| **O10** | N1 tariff — the three unsourced constants. **This does not block the build; it blocks trusting a red T2/T3 verdict.** Ship with `CONSTANTS_UNSOURCED` displayed | Visa/PRO | No (build) / **Yes** (sign-off) |
| **O11** | N2 fine payer, ~40 cases, resolvable by hand once | Malaz | No — T5 correctly BLOCKED meanwhile |
| **O12** | D5, D6, D7 columns are `UNVERIFIED — Snowflake team to confirm`. D1 has no dbt comments at all, so no column semantics are documented for it | DNA | No |
| **O14** | Confirm the timezone of D2's `TIMESTAMP_NTZ` columns and that D1 `TRANSACTION_DATE` is already Gulf-local. Day counts and period assignment both depend on it | DNA | No |
| **O13** | The Notion page's `Test cases verified` tick "records a decision, not the thing the property describes". Three of the five cases remain warehouse-only. Do not read the tick as five human-verified ERP cases | P&C | No |

---

## 7. DNA Handoff — filed

> **Duplicate search: done, 2026-09-06 (O2 closed).** DNA searched project-wide by summary and by
> full text for `R-visa`, `overstay`, `visa fee`, `duplicate payment`, `VISAREQUESTEXPENSES`,
> `LOST_VISA_EXPENSES`, `MISSING_EXPENSES`. **No ticket or model audits R-visa *fees*.** Every R-visa
> item in DNA is a process-speed KPI (`R-Visa Speed`, `Days to Get the R-Visa`, the duration tables)
> or a step-blocker alert. Two neighbours materially affect this spec and are recorded as O15 and O16.
>
> **Set the issue type yourself on creation** — Jira automation re-types new tickets to " New Request".
> **Precedent to mirror:** DNA-9454 / DNA-9455 (*"Applicant ticketing audit — model the eleven Police
> & Control metrics in silver/gold from existing BA_VIEWS objects"*) is the same department, the same
> shape and the same AE→BI split, and DNA-9446 / DNA-9449 is a second P&C audit pair. Match their
> framing.

### Ticket 1 — DNA-9529 · `Analytic Engineer Task`

https://jira-maids-cc.atlassian.net/browse/DNA-9529

**Summary.** `R-Visa fee audit — silver model: per-payment tests + per-maid verdict`

**What we need.** Police & Control audits every residence-visa fee paid for a CC or MV housemaid, to
catch a second fee inside one visa term, an overstay fine that disagrees with the dates, and a fine
nobody was made to repay. Everything the model reads is already in `BA_VIEWS` — `VISA_SILVER.VISAREQUESTEXPENSES`
and `MONEY_CONTROL_SILVER.TRANSACTIONS`.

> **No new object, grant, warehouse or pipeline is requested for the model itself. The ask is narrow:
> build one silver model at payment grain carrying nine test outcomes and one verdict column, plus a
> case-grain roll-up. The business logic is attached in full — you do not need to reverse-engineer it.**

*(One access request is separate and does block verification — see Dependencies.)*

**Playbook fields.**

| Field | Value |
| --- | --- |
| `TaskCategory` | New Snowflake model |
| `TargetSchemaOrDomain` | `VISA` (silver), consumed by Police & Control |
| `ModelName` | `RVISA_FEE_AUDIT` (payment grain) + `RVISA_FEE_AUDIT_CASES` (maid grain) |
| `Layer` | SILVER |
| `Grain` | One row per R-visa payment; roll-up one row per maid, all-time |
| `BusinessGoal` | Detect duplicate residence-visa fees and mis-stated overstay fines |
| `Consumer` | Police & Control (Security Room portal, workbook, email draft) |
| `SourceData` | D1–D4 below |
| `HistoricalBackfill` | Full history — the duplicate scan is all-time by design, not window-scoped |
| `ColumnSet` | See "What it reads" and §3 of the attached spec |
| `BusinessOwner` | Malaz (Police & Control) |
| `Dependencies` | Blocks Ticket 2. Warehouse grant (below) blocks verification, not build |
| `OutOfScope` | Office staff; salary rows; client refunds; entry visa / MOHRE / change-of-status / EID / ILOE; VAT treatment; **missing** R-visa payments (a separate check) |
| `References` | This spec; Notion *R-Visa Audit*; SD-67794 |

**The metrics, by fixed name and id.** M1 population · M2 cases · M3 amount at risk · M4 duplicate
exposure · M5 fine overcharge exposure · M6 fine undercharge exposure · M6a underpaid exposure reported separately · M7 unassigned-responsibility
exposure · M8 exception rate · M9 blocked rate · M10 anchor match rate. **Every card and column
carries these ids** — two id systems on one page is how a reader ends up comparing figures that were
never comparable.

**What it reads.**

| Id | Object | Used for |
| --- | --- | --- |
| D1 | `BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS` | amount, transaction date, ids |
| D2 | `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | `PURPOSE`, `VISA_REQUEST_ID`, `OWNER_ID`/`OWNER_TYPE`, `TRANSACTION_ID`, `PAYMENT_DATE` |
| D3 | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` | expense-head reconciliation (TO-2) |
| D4 | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_HIERARCHY` | expense-head reconciliation (TO-2) |

**The joins that exist and the ones that do not.** D2 `TRANSACTION_ID` → D1 `ID` (NUMBER→NUMBER,
**nullable on D2** — an unlinked expense is amber, not dropped). D2 `OWNER_ID` → D1 `HOUSEMAID_ID`
(NUMBER→NUMBER, **D1 fill rate unmeasured**). **There is no key at all** from an R-visa payment to the
entry-visa payment that starts its 60-day clock — that match is a documented heuristic with a
published match rate and a 90% floor (§3, anchor rule). Coverage on every join is unmeasured because
this spec was written without warehouse compute.

**Traps — each silently produces wrong numbers.**

| Trap | Cost if ignored |
| --- | --- |
| Scoping the population on a joined column (`OWNER_TYPE`, `CONTRACT_TYPE`, `STATUS`) | Records vanish from every count and total while the tie-outs still balance on the survivors. Worse than counting them clean |
| Early-exit rule ladder | A record reaches green with an applicable test silently unrun. Notion test case 1 loses its duplicate red this way |
| Keying duplicates on the maid's **name** from free text | ~4% precise: 56 groups in 2025, of which **54 resolve to more than one maid id**. Keyed on identity the answer is **2** |
| Filtering the population on description text | Throws away **33.6% of 2026 rows (3,826 of 11,392)**; and before 2025-12-19 the renewal leg says `R-VISA` **zero times in 10,855 rows**, hiding **AED 2.16M** |
| `CONTRACT_TYPE` compared without `TRIM()` | Values carry a trailing space — the CC/MV split matches nothing, silently |
| `SUM(AMOUNT)` without a range guard | Observed max ≈ **19.7 trillion** |
| `PAYMENT_DATE` used without excluding `0025-11-06` | A two-thousand-year overstay; the prior dashboard differenced it silently and reported `OK` on a 54-day undercharge |
| Duplicate scan limited to the reporting window | 2 repeat-payment maids inside 2025 versus **182 all-time** — roughly nine cases in ten missed |

**Data asks — non-blocking for the model build.**

| Ask | What it unlocks |
| --- | --- |
| N1 authority tariff (dated) | Lets a red T2/T3 verdict be trusted rather than merely reported |
| N2 fine payer | Unblocks T5 (~40 cases, resolvable by hand once) |
| N3 clearance text + AI judgement field | Unblocks the duplicate clearance route (9 pairs all-time) |
| O6 visa term source | Unblocks T8 — **until then no case can reach green** |

**What needs a decision, not engineering.** O3 (`CONTRACT_TYPE` is as-of-now, not as-of-payment) ·
O8 (undercharge reported separately from money already gone) · O9 (staff names out of the export) ·
O10 (ship with `CONSTANTS_UNSOURCED` displayed).

**Sensitivity — so it does not stall at intake.** No salary, no IBAN, no contact detail. The
transaction **description** field is read to compute and is never displayed or exported: a sibling
check measured that same field carrying passport numbers and visa ids from 2026-01 onward (31 of
1,738 rows in January, 77 of 1,759 in February, rising), and **the share on R-visa rows is
unmeasured**. Maid names are never a key and never displayed. Staff creator names are excluded from
the row-level export.

**Attached.** `DNA_ATTACHMENT_source_tables.md` *(Start here)* · `DNA_ATTACHMENT_verification_queries.md`
(every measured figure with the query that produced it, aggregate only) · `SPEC_r_visa_audit_v1.md`.

**Not a duplicate.**

| Ticket / object | Status | Why it does not overlap |
| --- | --- | --- |
| **DNA-5725** · **DNA-7915** — Alert 946, *Money Lost — Overstay Fines Not Paid by Client* | Done / live | **The closest thing that exists.** An *alert* on client-paid overstay fines, not an audit of R-visa fee payments; no duplicate test, no fine-vs-dates arithmetic. Overlaps T5 only — see **O15**, and do not inherit its filter |
| **DNA-6078** — *Inflated Total Excluded Hours in R-Visa Duration Calculation* · **DNA-2363** — *Add New Columns & Filtering Logic to R-Visa Duration Tables* | Done | Both act on the R-Visa **duration** tables (D6), which measure process speed, not money. They matter here only because D6 is the candidate source for the visa term — see **O16** |
| **DNA-9454** · **DNA-9455** — Applicant ticketing audit (P&C, eleven metrics) | To Do | Same department and same ticket shape, **different check entirely**. Listed as the precedent, not an overlap |
| **DNA-9446** · **DNA-9449** — Payroll audit, monthly archived files | To Do | Different population (payroll), different sources (file ingestion) |
| `LOST_VISA_EXPENSES` | existing silver model | Downstream of D2. Searched — no R-visa fee audit logic in DNA against it |
| `MISSING_EXPENSES`, `MISSING_EXPENSES_HISTORICAL` | existing silver models | Absence of an expected expense; this check audits payments that exist |
| `REQUESTS_EXPENSES_DETAILS` | existing gold model | Reporting detail, no verdict logic |
| SD-67794 | open | The **n8n / ERP-API** build of the same check. Different runtime, and three of its four blockers do not apply in the warehouse (§2.4) |
| MV Overstay Fines · CC Overstay Fines · E-ID Audit · ILOE Checker · Change of Status | sibling P&C checks | Share two policies (duplicate payments, fine responsibility) and **share no constants** — MV is expense 1677/base 575.65/client pays, CC is expense 1589/maid's loan pays, R-Visa is neither |

**Done when — numeric acceptance criteria.**

1. `COUNT(*) − COUNT(DISTINCT PAYMENT_ID) = 0` on the payment-grain model — the grain holds.
2. `RED + AMBER + GREEN = COUNT(DISTINCT OWNER_ID)` exactly, **residual 0** (TO-3).
3. `Σ REASON_CODE buckets − AMBER total = 0` in both count and AED (TO-4).
4. Every AMBER row has a non-null `REASON_CODE`: `COUNT(*) WHERE VERDICT='AMBER' AND REASON_CODE IS NULL = 0`.
5. Every rendered verdict is one of exactly three words: `COUNT(DISTINCT VERDICT) = 3`.
6. Population reproduces the reference measurement within **±0.5%** on both count and AED: 2025 = **19,311 rows / AED 8,684,562.33**; 2026-01-01→08-28 = **11,558 rows / AED 5,220,544.65**. A larger gap means the `PURPOSE` route and the expense-head route disagree — that gap is TO-2 and must be reconciled to **named, quantified lines**, not left as a residual.
7. Expected magnitudes on first run, from the prior measurement — a wrong build is visible against these: duplicate-red cases **≈2 within 2025** and **≈182 repeat-payment cases all-time** (a result near **56** means the name-keyed rule was rebuilt); T3 undercharge **18 of 25** fine rows in 2025 and **5 of 14** in 2026; T2 overcharge **0 of 25** in 2025 and exactly **3** in 2026 (`1692426`, `1706249`, `1990079`, total excess 4 days / AED 200).
8. All six worked examples in §5 of the spec return the stated verdict, including **Example D landing in AMBER and absent from the clean count**.
9. `COUNT(*) WHERE PURPOSE NOT IN (<profiled enum>) = 0` — the run guard on the truncated enum (O5).
10. Anchor match rate published per period; where it is `< 90%`, T2/T3 are withheld for that period and the period is labelled unverified.

### Ticket 2 — DNA-9530 · `BI Visualization Task`

https://jira-maids-cc.atlassian.net/browse/DNA-9530

**Summary.** `R-Visa fee audit — Police & Control exception dashboard`

**Blocked by DNA-9529** — the Blocks link is set. SQL/model work always blocks the visual build.

> ⚠️ **Issue type.** Both tickets were created with the correct types (`Analytic Engineer Task`, `BI Visualization Task`) and a Jira automation re-typed both to `" New Request"`. Setting them back was tried twice and the automation reverted it each time. This matches the known DNA behaviour — the intake bot recommends the type on its pass. **Someone with the right permission should confirm the types after the bot has graded them.**

**Layout, restated in the description** (the artifact link is not readable by the intake bot):
KPI strip `M3` amount at risk (money already gone) · `M6a` exposure not yet paid — **never summed with M3** ·
`M8` exception rate with its denominator · `M9` blocked rate · `M10` anchor match rate → tie-out line showing TO-1/TO-3/TO-4 → exception table at case grain,
default sort **amount at risk descending**, columns: case (maid id, **never a name**), contract CC/MV/Unknown (filterable, all on by default),
payment count, verdict, rule breached in the rule's own words, amount at risk, day arithmetic
(`paid 92 d vs implied 140 d`), both transaction ids, workflow state → one chart, fine rows by
outcome per period → provenance line carrying the two standing caveats → row-level CSV export.

**Non-negotiables.** Row colour is driven by the single verdict column and nothing re-derives
eligibility · verdict is shown as **label + icon, never colour alone** · the `M8` denominator is
visible beside it · the provenance line always states *"constants unsourced (N1); T5/T8/T9 blocked —
no case can currently reach green"*.

**Done when.** Every tile and the row colour aggregate the same `VERDICT` column (assert: tile counts
= `GROUP BY VERDICT` counts, difference 0) · the tie-out line renders on screen and is not a
back-office check · CSV export contains no description field and no staff name column.
