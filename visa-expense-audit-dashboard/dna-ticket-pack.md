# DNA ticket pack — consolidated visa expense audit dashboard

**Status: DRAFT. Nothing has been created in Jira.**
Reporter: Hassan Ahmed (P&C) · Drafted 2026-09-14 · Mockup:
https://claude.ai/code/artifact/24a78ced-ae66-4e92-a646-14161af9ea70

Four tickets, pre-split with the blocks links set. The model work is split in two by volume —
seven audits is more than one ticket's worth — and both halves build against the same shared layer.

| # | Ticket | Issue type | Covers |
|---|---|---|---|
| **①A** | Consolidated silver model, part 1 | `Analytic Engineer Task` | Shared layer + change of status · ILOE · medical · entry visa |
| **①B** | Consolidated silver model, part 2 | `Analytic Engineer Task` | LAWP reservoir · E-ID · R-visa |
| **②** | Visa Expense Audit Console | `BI Visualization Task` | The Streamlit app. Blocked by ①A and ①B |
| **③** | Four ingestion asks | `Data Engineering Task` | Blocks nothing |

---
---

# ①A Analytic Engineer Task — part 1

> **Title:** `[1 of 2] Visa expense audit — consolidated silver model: shared layer plus four Police & Control audits`
> **Issue type:** `Analytic Engineer Task` — **set it on creation.** Jira automation re-types new
> tickets to " New Request" and the bot then has to correct it.
> **Routing:** Analytics Engineering — Belal (belal.alsayed@maids.cc)
> **Blocks:** ② (BI). **Not blocked by** ③ (DE) — every ingestion ask is non-blocking.
> **Sibling:** ①B carries the remaining three audits against the same shared layer.

## What we need

Police & Control runs seven audits over one visa-expense chain — the LAWP reservoir, entry visa,
change of status, medical, ILOE, R-visa and E-ID. Each is measured by hand today, in its own window,
at its own grain, and nobody can answer *where the money is going, in order of size* across them.

This ticket models the first four into silver; **①B carries the other three** against the same
shared layer.

Everything the model reads is already in `BA_VIEWS` and verified by the specs' own discovery runs.

> **No new object, grant, warehouse or pipeline is requested. The ask is narrow: build one shared
> dimension layer, four audit case models over the objects we already read, and one unified case
> view that unions them. The business logic is attached in full, with every trap measured — you do
> not need to reverse-engineer it.**

## Playbook fields

| Field | Value |
|---|---|
| TaskCategory | New Snowflake model |
| TargetSchemaOrDomain | VISA + MONEY_CONTROL (silver), consumed by Police & Control |
| ModelName | `DIM_MAID` · `V_LOAN_LATEST` · `DIM_PRICE_ERA` · `V_TXN` · `V_VISA_EXPENSE_LINE` · `V_CASES_COS` · `V_CASES_ILOE` · `V_CASES_MEDICAL` · `V_CASES_ENTRY_VISA` · `V_AUDIT_CASE` |
| Layer | SILVER |
| Grain | **One per audit, and they differ — see "Grain is per audit" below.** `V_AUDIT_CASE` is one row per case with its grain named on the row |
| BusinessGoal | Detect unrecovered visa-expense money across four audits and show it on one surface without asserting a total that is false |
| Consumer | Police & Control; and BI ticket ② |
| SourceData | D1–D16 below |
| HistoricalBackfill | Full history. **Each audit keeps its own window** — they are not alignable, see below |
| ColumnSet | The unified case contract below, plus each audit's own wide view |
| DomainOnboarding | None — VISA, MONEY_CONTROL, HOUSEMAID_MANAGEMENT, CLIENT_MANAGEMENT and SALES silver schemas are all already onboarded |
| BusinessOwner | Hassan Ahmed, Police & Control |
| Dependencies | Blocks ②. Ingestion asks in ③ are **non-blocking** — each degrades one audit's coverage, none stops the build |
| OutOfScope | Office staff and Dubai expat staff, in every audit. LAWP, E-ID and R-visa — **carried by sibling ticket ①B**. The AI verifiers: the model **reads** a verdict table, it does not run a model |
| References | `Change_of_Status_v5.md` · `SPEC_iloe_checker_v2.md` · `SPEC_medical_from_visa_expenses_v1.md` (v4) · `SPEC_entry_visa_audit_v1.md` · `DESIGN.md` · mockup above |

## 🔴 Metric ids are namespaced, and this is not cosmetic

Every audit numbers its own metrics from M1, and **they mean different things**. `M1` is
*money paid for Change of Status* in one spec, *money we never got back* in another, and *payments
in scope* in a third. Two id systems on one page is how a reader ends up comparing figures that were
never comparable.

**Every metric carries its audit prefix, everywhere — model column, dashboard tile, export header:**

| Audit | Metrics, as this build names them |
|---|---|
| Change of status | `COS.M1` `COS.M2` … `COS.M13`, rules `COS.R1`–`COS.R10` |
| ILOE | `ILOE.R1` `ILOE.R2` `ILOE.R3` `ILOE.R4` |
| Medical | `MED.M1` `MED.M2` `MED.M3`, plus the no-fee-charged class |
| Entry visa | `EV.M0`–`EV.M6`, verifier `EV.V1` |

## Grain is per audit, and the model must say so on every row

| Audit | One case is | Window the spec measured |
|---|---|---|
| Change of status | one Change of Status **transaction** | one closed month (July 2026 worked); live era from 2025-12-19 |
| ILOE | one **finding** — a payment (R2, R1) or a loan (R3, R4) | whole history, from 2024-02-10 |
| Medical | one **fee**, one maid, one visa request | fees Jan 2025 – Sep 2026 |
| Entry visa | one **charge** (M2) / one **maid** (M3) | applications from 2025-09-05 |

**The four windows are not alignable and must not be silently unioned into one.** `V_AUDIT_CASE`
carries `ANCHOR_DATE` plus `ANCHOR_DATE_MEANING` as text, because each audit is on a different clock:
Change of status on `TRANSACTIONS.TRANSACTION_DATE`, entry visa on the **application** date, medical
on the fee's `CREATION_DATE`, ILOE on the transaction date for payments and `BALANCE_DATE` for loans.

## The unified case contract

One row per case, per audit. The columns that carry the consolidation:

| Column | Notes |
|---|---|
| `AUDIT_CODE` · `RULE_ID` · `RULE_NAME` | the spec's own id and its own words |
| `CASE_ID` · `CASE_GRAIN` | grain named on the row, per the table above |
| `FLAG` | `RED` / `AMBER` / `GREY` / `GREEN` |
| `FLAG_LABEL` | `ACTION` / `HOLD` / `UNREADABLE` / `CLEAN` — **never colour alone** |
| `EXPOSURE_CLASS` | `RECOVERABLE` / `LOST` / `UNDECIDED` / `UNVALUED` |
| `AMOUNT_AED` | **`NULL`, never `0`, on an UNVALUED row** |
| `AMOUNT_IS_VALUED` | BOOLEAN — so "found nothing" and "found something we may not price" cannot render the same |
| `WHO_IS_OUT_OF_POCKET` | `COMPANY` / `MAID` / `CLIENT`. It is not always the company — `ILOE.R1` is a case where the **maid** paid twice and is owed AED 124, and `COS.R4` is one where the **client** was billed AED 4,275 for a fine we absorb |
| `ACTION_OWNER` · `ACTION_TEXT` | who works the row, in the spec's own instruction |
| `ANCHOR_DATE` · `ANCHOR_DATE_MEANING` | the clock, named |
| `RECOVERY_STATUS` | independent of `FLAG` — see the rule below |

🔴 **Money sums only within an `EXPOSURE_CLASS`, and the model must make a grand total awkward
rather than easy.** Three specs independently forbid a combined exposure figure:
*"There is no combined exposure figure, and the report must not print one"* (entry visa M6);
*"the two are reported side by side, never summed"* (e-ID §3.4c); *"do not add the two AED totals
together"* (R-visa §0.6).

🔴 **Recovery never changes a verdict.** `FLAG` and `RECOVERY_STATUS` are two independent columns and
recovery is recomputed each run, never written back. A refund cannot turn a red green — otherwise a
team can make a broken process look healthy by cleaning up after itself, and the control-failure
count falls while the fault stays put.

🔴 **Workflow status is not a verdict** and must never feed a filter default that changes a metric.

## What it reads

| Id | Object | Used for |
|---|---|---|
| D1 | `BA_VIEWS.MONEY_CONTROL_SILVER.TRANSACTIONS` | the money ledger — all four audits |
| D2 | `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | the visa ledger — medical, entry visa, COS office-staff exclusion |
| D3 | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` | loans — ILOE, COS |
| D4 | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAIDS_INFO` | the maid dimension |
| D5 | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.HOUSEMAID_TYPE_LOGS` | **COS only** — CC or MV **on the day of the charge** |
| D6 | `BA_VIEWS.HOUSEMAID_MANAGEMENT_SILVER.OVERSTAY_FINES` | COS waivers |
| D7 | `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGEMENT_PAYMENTS` | COS — the client's payment of the fine |
| D8 | `BA_VIEWS.CLIENT_MANAGEMENT_SILVER.CLIENT_MANAGER_NOTES` | COS credit notes — **display only, clears nothing** |
| D9 | `BA_VIEWS.SALES_SILVER.CONTRACTS` | COS — which client. `FAKE = FALSE` everywhere |
| D10 | `BA_VIEWS.SALES_SILVER.CONTRACTS_PAYMENTS_TERMS` | COS discount — **display only** |
| D11 | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS` / `_TASKS` | medical clock, entry visa |
| D12 | `BA_VIEWS.VISA_SILVER.RENEW_VISA_REQUESTS` / `_TASKS` | medical renewal half |
| D13 | `BA_VIEWS.VISA_SILVER.INITIAL_VISA_REQUESTS_HISTORY` | entry visa turn-downs |
| D14 | `BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS` / `_TASKS` | entry visa refund routing, medical root cause |
| D15 | `BA_VIEWS.MONEY_CONTROL_SILVER.EXPENSES_CONFIGURATION` / `EXPENSES_HIERARCHY` | expense-head names and loan settings |
| D16 | `POLICE_CONTROL.VISA_AUDIT.T_VERIFIER_VERDICT` | **new, written by this build** — one verdict contract for all verifiers |

## The joins that exist, and the ones that do not

- **`D2.TRANSACTION_ID → D1.ID`** — NUMBER to NUMBER, no cast. **Nullable**: 1,770 R-visa lines and
  2 COS transactions have no counterpart. **LEFT JOIN and keep the unmatched.**
- **The medical fee and its refund do NOT share a visa request id.** Only **2.3%** of pairs do — the
  fee sits on the initial/renewal request, the refund on the **cancellation** request.
  **Join on the maid id.** Getting this wrong reports ~98% of cases as unrefunded.
- **The COS expense has no key to the CC loan.** Head `1589` cannot create loans at all, and the
  dedicated `1058 Overstay fee Loan` head has been dead since 2025-11-29. The loan is matched **on
  the maid only** — and must **not** additionally require the amount to equal the fine, which would
  hide the one real over-loan in the live era (txn 2100185: two loans, AED 250 + AED 200, against one
  AED 250 fine).
- **`D9` fans out.** Of 704 July maids, 645 have one contract, 38 two, 3 three, 1 four, **17 none**.
  Aggregate per transaction in a subquery before joining back, or the collected figure inflates.
- **Entry visa refunds route two ways** — on the request, and on its cancellation via
  `CANCEL_VISA_REQUESTS.REQUEST_ID → NEW_REQUEST_ID`. `REQUEST_ID` is unique across 99,669 rows so it
  cannot fan out; **`NEW_REQUEST_ID` is not** — 9,762 values are pointed at by two or more
  cancellations, so one request legitimately inherits refunds from several.

## Traps — each one silently produces wrong numbers, and each cost is measured

| # | Trap | Cost if ignored |
|---|---|---|
| 1 | **`HOUSEMAID_OUTSTANDING_BALANCE_DETAILS` is snapshot history, not one row per loan.** Deduplicate on `ID` before any sum, with an **explicit** tie-break (`QUALIFY ROW_NUMBER()`, not `MAX` — ILOE has 5 loans that tie, one four ways) | Found independently by three specs. ILOE overstated subscriptions by **AED 241,161 (+21.7%)** and fines by **AED 97,089 (+15.0%)**; e-ID's replacement figure **moved AED 5,041.82 between two runs of the same query**; COS shipped a **false AED 250 over-loan finding twice** |
| 2 | **`CONTRACT_TYPE` is `'CC '` / `'MV '` with a trailing space.** Always `TRIM` | `= 'CC'` matches **zero rows and raises no error**, which reads exactly like "no findings for CC". The intake bot measured **622,448** untrimmed rows on this column |
| 3 | **Two clocks.** `VISAREQUESTEXPENSES.CREATION_DATE` is when we applied; `TRANSACTIONS.TRANSACTION_DATE` is when Accounting posted — median one day later, up to sixteen | The posting clock **loses 257 of 913** entry visa turn-down charges — **28%** — and scrambles the order of events so a clean case reads unexplained |
| 4 | **`REMAINING_AMOUNT` is 0 on every row** in the warehouse, including `NOT_YET_PAID` ones | Compute remaining as `AMOUNT − REPAID_AMOUNT − WAIVED_AMOUNT`. Reading it clears everything |
| 5 | **`IS_DELETED` is TEXT and inert** — only ever `'0'` / `'00'` | A boolean test matches nothing and reads as "none deleted". R-visa v6 **withdrew an entire measurement set** taken through it |
| 6 | **Float residue on the COS fine.** Derive `FINE_CENTS = ROUND(TRANSACTION_AMOUNT*100) − 57565` **once** and build every test on it | `TRANSACTION_AMOUNT − 575.65` leaves ~1.14e-13. `COS.R3` then fires **35 times in July instead of 5** — thirty fully-recovered cases showing **AED 0.00 at risk** — and **both tie-outs still read variance 0.00 while it happens**, so the identities cannot catch it |
| 7 | **Visa-request ids collide across request types.** 19,997 renewal ids are also initial ids; cancel requests run their own colliding sequence | Reading "either table by id" inflates medical's eligible population from **1,153 to 1,211** and never-claimed from **132 to 188** — a 42% overstatement that looks like a bigger finding rather than a bug |
| 8 | **The renewal task table re-fires up to 1,909 iterations per request.** Aggregate to one row per `VISA_REQUEST_ID` first | 335,583 `ONGOING` rows sit on **2,120** distinct requests — counting rows overstates that population by **158×** |
| 9 | **Never key a maid on her name from free text** | Measured **4% precise** on a sibling check: 54 of 56 "duplicates" were two different maids sharing a name |
| 10 | **Never filter a population on a description keyword** | `DESCRIPTION LIKE '%E-ID%'` misses every renewal (`"EID Renew"`, no hyphen) — **2,911 rows, ~AED 1.04M** in six months. Filter on `EXPENSE_ID` or `PURPOSE` |
| 11 | **`ENTRY_VSIA` is spelled wrong in the live system** and must stay wrong | `ENTRY_VISA` returns nothing |
| 12 | **Status is load-bearing and differs per audit.** A `Dismissed` medical refund is money that never came back and does not clear a case; a `Dismissed` entry visa claim is **ours**, not immigration's, so those 72 cases are RED not amber; R-visa forbids status as a population filter entirely | Reading `STATUS='Added'` alone on the medical refund makes a raised-then-voided refund read **clean** — the exact case audit 1 exists to find |

## Data asks — non-blocking

See ticket ③. None stops this build; each one narrows what an audit can conclude.

## Rulings already made — build to these

P&C settled every open item it owns on 2026-09-14. Nothing below needs a further answer.

| Ruling | Effect on this build |
|---|---|
| **A review status IS saved against a case** | `T_CASE_REVIEW` is the **only** writable table: `REVIEW_STATUS`, `ASSIGNEE`, a note and an outcome, keyed on `(AUDIT_CODE, CASE_ID)`. It never touches a computed column, and never feeds a filter default that changes a metric |
| **A verifier's redacted quote MAY be displayed** | In the drill-down only, never in the CSV export. Redaction happens **at the model**, before the text leaves it. Without the quote a verdict cannot be checked |
| **Duplicates are treated as loss** | Recovery is **partial by design** — ~239.50 against a 443.50 fee, **never full in 15 of 15 observed cases**. The ~204 residue per case is unrecoverable, so a refunded duplicate is still a loss. Underpins `RV.M3` |
| **Cleaners are in scope** | Head `149` stays in `R-VISA-HEADS`. The company paid a residence-visa fee for a person it sponsors |
| **The three refund-before-duplicate R-visa cases stay BLOCKED** | A refund predating the second payment reads as a correction cycle. Treating them as confirmed would add AED 1,330.50 to Duplicated and AED 618.50 to Refunded — the less conservative call, so it is not taken |
| **The S1 re-payer defect files as ONE process defect, not twenty findings** | AED 8,870 either way; twenty findings means nobody is asked to fix the cause, which is a missing ERP guard at the *"Apply for R-visa"* task |
| **Overstay stays OFF the R-visa node** | R-visa carries the Modification-fine leg only (`RV.T10`, `RV.M12`). Overstay remains with the CC and MV overstay checks. Prevents the same money being counted twice |
| **R-visa R1 is carried out of coverage, with its size** | The rejected-R-visa refund leg cannot be built — the ERP exposes no rejection status and no refund-request field. An ERP gap, not a spec gap. It shows on the tab as out-of-coverage, never as absent |
| **The 221 single-payment unexplained-amount cases are OUT of scope here** | They belong to a price-accuracy audit that does not yet exist. Do not widen this build to absorb them |
| **LAWP proceeds on the `HOUSEMAID_TYPE` proxy for PAWP** | With the caveat printed on the tab. Some PAWP bundles may be in the population |
| **The E-ID 121–599 day amber band is kept** | 47 pairs, AED 16,633.77, routed to the verifier. It is the band the verifier exists to resolve |
| **Medical shows pre-2025 findings separately, labelled historical** | `MED.M1` stays Jan 2025 onward so the headline stays collectable. 2024 findings quantify a historical leak; the portal window for claiming them has almost certainly closed |
| **COS: a wrongly-headed charge is reported, not re-posted** | R7 is a reason column. Re-posting is an accounting correction owned elsewhere |
| **COS: a credit note clears nothing** | Only a reduction **on the fine** is relief, which `WAIVED` already reads. `D8` stays display-only |
| **COS: `COLLECTED` accepts a payment on ANY non-fake contract of the maid** | Narrowing it to the contract running on the charge date risks dropping a payment made by the prior client after a handover |
| **Entry visa: a negative "days unclaimed" displays as `0` and flags the row** | 19 claims are dated before their turn-down stamp, up to 74 days — the same posting-lag family |
| **Entry visa: no backfill before 2025-09-05** | No dated immigration rejection exists earlier |
| **Entry visa: the roadmap's AED 12,929,222 is NOT recoverable** | Measured exposure is **AED 137,043** over 12.3 months — about **94× smaller**. It must never be quoted as recoverable, and the roadmap row is being corrected |
| **E-ID: the 5 `UNCLASSIFIED` rows park as pending** | AED 3,295.85. A rising unclassified count is the signal that the expense names changed again — which is why the class exists |

**Still with other teams, and none of it blocks this build:** `Active_Visa` / `Another_Issue` as
entry visa turn-downs (Visa team) · the R-visa fee schedule, the 50-dirham step, `293.50` and the
refund amounts (Finance) · Credit_Card reversal behaviour (Finance) · whether MOHRE insurance
attaches to the paperwork or the person (Mohammad Khalil) · the COS P&L reconciliation and the MV
client recharge ingestion (Snowflake team).

## Sensitivity — so it does not stall at intake

No salaries, no IBANs, no contact details, no phone numbers. The maid is rendered as `Maid #<id>`.

**These columns are read as predicates and are NEVER selected into a view, an export, a chat reply
or an email:** `TRANSACTIONS.DESCRIPTION` (carries maid names, and passport numbers from 2026-01)
· `TRANSACTIONS.CREATOR` · `TRANSACTIONS.LAST_MODIFIER` · `VISAREQUESTEXPENSES.DESCRIPTION` ·
`EMPLOYEE_NAME` · `CREATOR_NAME` · `LAST_MODIFIER_NAME` · `WAIVE_NOTES` / `REPAYMENT_NOTES` raw text
· `VISAREQUESTSNOTES.TEXT` · `COMPLAINTS.COMPLAINT_DESCRIPTION` · `COMPLAINT_COMMENTS.TEXT` ·
`CLIENT_MANAGER_NOTES.TEXT` · `HOUSEMAID_MANAGER_NOTES.NOTE_REASON`.

Reading them to compute is required and permitted. Selecting them is not. Where a note carries an
approval reference, the view extracts the to-do id and discards the rest. The only free text that
ever reaches a column is the **model-redacted quote** a verifier returned — never re-fetched raw text.

Those threads carry other people's pay disputes in plain text. **That is why the exclusion is by
column name, not by intent.**

## Attached

| File | |
|---|---|
| `DESIGN.md` | **Start here** — the consolidation model and why money may not be summed across audits |
| `DNA_ATTACHMENT_source_tables.md` | D1–D16 with every column each audit reads |
| `DNA_ATTACHMENT_verification_queries.md` | every measured figure below with the query that produced it — aggregate only, controls first |
| `Change_of_Status_v5.md` · `SPEC_iloe_checker_v2.md` · `SPEC_medical_from_visa_expenses_v1.md` · `SPEC_entry_visa_audit_v1.md` | the four specs |
| `sql/` | a **reference implementation written from the specs and never executed.** Every table and column name in it came from a spec that measured it; none was invented. Treat it as commentary, not as code to run |

## Not a duplicate

| Ticket | Status | Why it does not overlap |
|---|---|---|
| `DNA-9529` / `DNA-9530` — R-Visa fee audit, AE + BI | Cancelled | Superseded. R-visa is carried by **①B** at its current spec version, with the constants re-sourced. No live overlap |
| `DNA-9454` / `DNA-9455` — Applicant ticketing audit, P&C | To Do / On-Hold | Same department and ticket shape, different check entirely. **The precedent, not an overlap** |
| `DNA-9446` — Payroll audit ingestion | Done | Different population, different sources |
| `DNA-8864` — Recruitment Analytics Dashboard go-live | Pending Deployment | Different domain |
| `SD-67794` | Open | The n8n / ERP-API build of a sibling check. Different runtime |
| Alert 945 / 944 (`DNA-4395`, `DNA-4396`) | Live | LAWP reservoir alerts. The LAWP check in **①B** **recomputes the loss from source records and compares its answer to theirs** (`LAWP.R13`, `LAWP.M10`). **Do not rebuild the alerts** |

## Done when — acceptance criteria

**Grain and integrity**

1. `COUNT(*) − COUNT(DISTINCT CASE_ID) = 0` within each `AUDIT_CODE` in `V_AUDIT_CASE`.
2. `COUNT(*) WHERE EXPOSURE_CLASS = 'UNVALUED' AND AMOUNT_AED IS NOT NULL = 0` — an unvalued row
   carries `NULL`, never `0`.
3. `COUNT(*) WHERE FLAG NOT IN ('RED','AMBER','GREY','GREEN') = 0`, and every `FLAG` has its
   `FLAG_LABEL`.
4. The loan table is deduplicated before every sum: on `HOUSEMAID_OUTSTANDING_BALANCE_DETAILS`,
   `COUNT(*) − COUNT(DISTINCT ID) = 0` in the deduplicated view. Expect **415 → 405** on
   `OVERSTAY_FINES_FEES` and **257 → 169** on `REPEAT_EID`.

**Tie-outs — each displayed, each blocking its own audit**

5. **COS identity 1:** `(charges × 575.65) + SUM(fines) + SUM(unclassified overage) = COS.M1`.
   July 2026: `405,257.60 + 77,250.00 + 0.00 = 482,507.60`, **variance AED 0.00 in all ten live
   months.** The overage term is not optional — without it the identity fails in **five of the ten**,
   by AED 40,967.35 in January 2026 alone.
6. **COS identity 2:** seven terms — `55,025 + 8,775 + 2,325 + 1,300 + 500 + 9,325 + 0 = 77,250`,
   variance 0.00. The seventh is zero in all ten months and **must still exist**, or a grey case
   silently vanishes.
7. **ILOE:** `AED 1,163,242.82 = 587,351.55 + 575,891.27`, variance **AED 0.00**.
8. **Medical:** `132 + 41 + 9 + 971 = 1,153` cases, and on the AED side
   `29,490 + 10,420 + 2,430 + 230,670 = 273,010`.
9. **Entry visa, both sides, counted independently** — charge side `913 = 697 + 216`; refund side
   `892 = 701 + 119 + 70 + 2`; **cross-check 701 vs 697.** The 4-row excess is listed case by case
   and never absorbed. ⚠️ A tie-out computed from one side is decoration: a prior version used
   `LEAST(a,b) + GREATEST(a−b,0) ≡ a`, which is algebraically incapable of failing, and fed a
   deliberately dead refund join it reported **variance 0** while finding nothing.

**Reproduce these measurements, or reconcile the gap to named lines**

| Metric | Expected on first run |
|---|---|
| `COS.M12` money at risk | **AED 9,325** · 6 red · 34 amber · 0 grey · 5.8% of 104 fines (July 2026) |
| `COS.M1` / `COS.M7` / `COS.M8` | AED 482,507.60 over 704 charges · AED 68,300 charged above the gate · AED 50,750 collected (74.3%) |
| `COS.R6` over-loan | **exactly 0 in July.** A result of 1 means the loan table was not deduplicated |
| `COS.R3` | **exactly 5 in July.** A result near 35 means the float guard is missing |
| `ILOE.R2` / `R3` / `R4` | 1,530 / 364 / 6 cases · AED 575,891.27 / 82,138.25 / 864.58 |
| ILOE classification is exhaustive | `3,018 + 31,629 + 47 = 34,694`, the whole maid-linked population |
| `MED.M1` / `M2` / `M3` | AED 39,910 · 173 cases · 11.6% latest quarter |
| Medical no-fee-charged | **119** cases, carrying **no AED** |
| `EV.M2` red | **188** cases · AED 90,276.00 (116 never filed · 72 cancelled by us) |
| `EV.M3` paid twice | **105** charges over **99** maids · AED 74,580.90 |
| `EV.M0` population | 14,597 charges · 13,995 maids · AED 12,413,890.03, summed on the **application** clock. AED 12,487,712.56 across 14,693 charges means the posting clock was used |

10. All worked examples in each spec's §5 return the stated verdict — including every **blocked** and
    **grey** example landing outside the clean count.
11. **No grand total across audits exists in any view, tile or export.** Sums are per
    `(AUDIT_CODE, EXPOSURE_CLASS)`.
12. Every personal-data column in the Sensitivity list returns zero hits against the view definitions:
    `SELECT * FROM INFORMATION_SCHEMA.VIEWS WHERE VIEW_DEFINITION ILIKE '%DESCRIPTION%'` and the rest,
    reviewed by name.
13. `T_CASE_REVIEW` exists, is the only writable object in the schema, and no computed column in any
    view reads from it.
14. Medical returns pre-2025 findings in a class separate from `MED.M1`, and `MED.M1` covers
    Jan 2025 onward only.
15. Entry visa renders a negative "days unclaimed" as `0` with the row flagged, never as a negative.

---
---

# ①B Analytic Engineer Task — part 2

> **Title:** `[2 of 2] Visa expense audit — silver model for LAWP reservoir, E-ID and R-visa`
> **Issue type:** `Analytic Engineer Task` — set on creation.
> **Routing:** Analytics Engineering — Belal. **Blocked by:** ①A (the shared layer).
> **Blocks:** ② (BI).

## What we need

The same build as ①A, over the same shared layer, for the three remaining audits. Filed alongside
①A so the dashboard is not delivered two-thirds complete.

> **Same narrow ask: three more audit case models over objects already in `BA_VIEWS`, emitting into
> the same unified case contract ①A defines. No new object, grant, warehouse or pipeline.**

## Additional traps, on top of ①A's twelve

| # | Trap | Cost if ignored |
|---|---|---|
| 13 | **LAWP `LINKED_REPLACEMENT_ID` resolves against two tables.** It points at `CANCEL_VISA_REQUESTS.REQUEST_ID` (22,862/22,862) and **also matches `INITIAL_VISA_REQUESTS.REQUEST_ID` on 97.6%** | The wrong join **silently succeeds and is wrong every time.** Join to `CANCEL_VISA_REQUESTS` |
| 14 | **LAWP: one hop up the replacement chain is not enough** | **599 of 6,085** `REPLACEMENT` bundles (9.8%) land on a request that is itself `REPLACEMENT`. Reading the holder of an inherited bundle returns zero |
| 15 | **LAWP R18: a duplicate is keyed on AMOUNT EQUALITY within AED 0.01** | 7,049 of the 7,171 different-amount pairs are one fee booked under two purposes. A rule that merely counted rows would red **AED 5.24M** of correctly-paid money |
| 16 | **LAWP: fees must be scoped to the request, not the maid** | Summing a maid's fee rows picks up every visa cycle she ever had — measured **AED 3,188 per bundle**, more than double a real one |
| 17 | **LAWP `PAYMENT_DATE` is NULL on 99.1%** of work-permit rows | Anchor the clock on `CREATION_DATE`, which is NULL on zero |
| 18 | **E-ID: `HOUSEMAIDS_VISA_INFORMATION` is one row per REQUEST, not per maid** | Joining without deduplicating fans out 5–20× — the same query returned **1,682 charges for 82 maids before the dedupe and 95 after** |
| 19 | **E-ID: AED 442.11 is a bundle** (382.10 application + 60.01 typing), not a price | `TYPING_SERVICE` must be tested **before** `APPLICATION`, and the class split then understates typing by ~AED 27,485. The tie-out still balances — the honest limit of a same-table tie-out |
| 20 | **R-visa: `VISA_REQUEST_ID` is not unique.** Cancel requests run their own colliding id sequence | Every request-keyed read merges two unrelated people. T8 is **mandatory, not defensive** |
| 21 | **R-visa: shared expense heads need the description test, dedicated heads must not have it** | Applying it inconsistently attributed **AED 668.00 of entry-visa refunds** to R-visa recoveries. Twice |

## Two things that must never be summed

1. **LAWP `M7` and `M12 + M13`.** `M7` prices paperwork nobody took; `M12`/`M13` price money paid
   twice. **One payment can sit in both.** Print two headline figures side by side — the spec's own
   instruction. The dashboard card carries the second below a rule.
2. **R-visa per-request and per-maid grains.** `M3` (AED 16,853.50, 45 cases) and bucket A
   (AED 29,905 gross, 68 pairs) answer different questions. *"Do not add the two AED totals together."*

## Done when

1. Every acceptance criterion in ①A that applies to the shared layer still holds.
2. **LAWP tie-out:** `6,767 + 296 + 3 + 45 + 202 = 7,313` payments, variance **0**; money
   `9,749,141.90 + 424,004.80 + 1,781.31 + 63,897.92 + 271,171.06 = 10,509,996.99`.
3. **LAWP grain control, both displayed:** **202 payments behind 232 bundles.** A money figure
   computed per bundle rather than per payment overstates by the 41% that broke the prior dashboard.
4. **E-ID class tie-out:** `19,033 + 57 + 256 + 789 + 5 + 2 = 20,142` rows, **AED 7,007,545.03**,
   variance **AED 0.00**. Publish the variance every run; a non-zero value blocks the report.
5. **E-ID `M7`** = AED 57,390.34 over 149 red cases — and **never** with the MV amber
   AED 58,649.84 added, which would assert a AED 116,100 loss nobody has proven.
6. **E-ID `M3`** = **56** of 57 fines unrecovered, AED 21,774.37 — not 57 and not AED 21,834.80.
   A result of 57 means the one recovered fine (maid 41504, txn 1640533) was missed; a result near 0
   means "any loan at all" was accepted instead of the two **named** loan types.
7. **R-visa waterfall:** `71,791 − 802 − 1,770 − 1 = 69,218`, residual **0**.
8. **R-visa sanity test, published every run:** bucket B median renewal gap **716 days** against a
   730-day term. If that median ever drifts far from the term, the term rule is broken and every
   bucket below it is unsafe.
9. Every rule that cannot decide a case returns `BLOCKED` with its reason and **stays in the
   denominator** — never absent, never silently clean.
10. Head `149` (cleaners) is present in `R-VISA-HEADS`; the three refund-before-duplicate cases
    return `BLOCKED`, not `CONFIRMED`; `RV.M12` scopes to modification heads `1622` / `1649` /
    `1735` only, never to 50-step residue; and R1 appears as a named out-of-coverage line with its
    size, never as an absent rule.

---
---

# ② BI Visualization Task

> **Title:** `[Split from DNA-<A>] BI: Visa Expense Audit Console — Streamlit in Snowflake, one tab per audit`
> **Issue type:** `BI Visualization Task` — set on creation.
> **Routing:** BI manager. **Blocked by:** ①A **and** ①B (AE).
> **Build vehicle:** **Streamlit in Snowflake**, per house practice (`PI-5592` Offboarding
> dashboard, the Risk WABA app, `TRAVEL_ASSIST_EXECUTIVE_DASHBOARD`). Snowsight filter widgets
> cannot carry the filter sets below.

## What we need

The mockup is at **https://claude.ai/code/artifact/24a78ced-ae66-4e92-a646-14161af9ea70**.

⚠️ **The intake bot cannot read a Claude artifact link** — it logs
`[UNVERIFIED — link not readable by the bot]` and falls back to the description. **The layout is
therefore restated in full below, and the description is authoritative.**

> **The ask: one Streamlit app over the silver model from ①A and ①B. Eight tabs — a portfolio, then one per
> audit. Each audit tab is the same four bands, so an auditor learns one page and knows all of them.**

## Layout — every audit tab, in this order

```
1  KPI strip        3–6 tiles, each carrying its namespaced metric id (COS.M12, ILOE.R2 …)
2  Filter bar       one row, plus a "more filters" expander
3  In-view line     what the filter selects, against the full population
4  Exception table  worst-first by amount · flag stripe + flag WORD · drill-down · CSV export
```

**Two behaviours that are requirements, not preferences:**

1. 🔴 **The KPI strip reports the full population and does NOT respond to the filter bar.** Filtering
   to `RED` must not make the Undecided tile read zero — that is how an auditor concludes money
   disappeared. The in-view subtotal sits on its own line directly above the table.
2. 🔴 **Review status never feeds a filter default that changes a metric.**

## Portfolio tab

- **One card per audit, largest first**: that audit's total, its case count, a Recoverable / Lost
  split bar, and its counted-not-valued count. Clicking a card opens that audit's tab.
- **No grand total across audits.** Cards do not sum.
- Where an audit carries two totals that may not be added, the card shows the second **below a rule
  with the reason printed** rather than choosing one figure.
- One chart: exposure by audit, stacked by class, direct-labelled.

## Filters — every tab

Period (presets: spec window · last 3/6/12 months · YTD · all-time · custom) · flag (multi-select,
default `RED` + `AMBER`, with the `GREY` count always shown even when filtered out) · rule ·
CC/MV · exposure class · action owner · amount range · age · verifier verdict · verifier reason ·
review status · assignee · free-text search on maid / transaction / case id · sort (default amount
descending, **never by date**).

## Filters — per audit, additional

**Change of status** — month (default last closed) · leg (MV / CC) · verdict (default *needs action*)
· rule R1–R10 · fine vs gate · overstay days · collection state · waiver · loan status · contract
present · head-vs-type mismatch · monthly discount present

**ILOE** — rule R1–R4 · subscription / fine / unclassified · loan type (`_FINES` / `_PREMIUM` /
`_PLAN` / none) · era (pre / post the 2025-03-02 rename) · outstanding band · days since loan ·
to-do reference present · who is out of pocket · repeat gap band · bucket (bulk / unmatched
reversal / office staff / accounting adjustment)

**Medical** — verdict · `MEDICAL` vs `MEDICAL_RENEW` · era rate (220 / 270) · cancellation type ·
refund step created · days since fee · fee quarter · has complaint / has note / no text ·
duplicate pairs

**Entry visa** — list toggle (M2 / M3) · band (inside 739.50 / outside 89.50) · turn-down reason ·
claim state (never filed / cancelled by us / pending / too recent) · days unclaimed (including
negative, per O2b) · wrong-type tag · charges per maid · maid-id disagreement

## Columns

Each table carries the columns its own spec's report section defines, in that order, plus the five
shared ones: `Flag` · `Exposure class` · `Action owner` · `Review status` · `Assignee`. Every column
header carries its **namespaced** metric id in a tooltip. Amounts right-aligned, fixed 2 dp,
thousands separated, `AED` stated once in the header, tabular figures.

## Flags — never colour alone

| Flag | Word | Meaning |
|---|---|---|
| Red | **ACTION** | Judged, and it is a finding |
| Amber | **HOLD** | Judgeable later, or a person must rule first |
| Grey | **UNREADABLE** | The check **cannot judge it at all** — counted and listed beside the red count, **never folded into clean** |
| Green | **CLEAN** | Every applicable test **ran** and passed |

Every flag carries its word and a glyph as well as its colour, so a row survives printing, a
screenshot into a finding, and colour vision deficiency. The flag drives a left-edge stripe.

## Also required

- **CSV export** of row-level detail, excluding every column in ①'s Sensitivity list.
- **Drill-down** per row, to the spec's own drill-down definition. **No free-text note body is
  rendered** — the reader follows the maid-id link into ERP to read notes.
- **Refresh is manual, on demand.** No scheduled task, no stream, no standing unattended run.
  Every one of the specs says so independently.
- **Provenance**: sources and as-of stamp available on the page.

## Open before this ships

**Where does the assurance surface live?** The tie-outs, the baseline-drift control and the
coverage tables currently have no home. Every spec requires its tie-out be **displayed**, and a
non-zero variance is itself a finding. Options: a collapsed strip per audit tab, a separate report,
or a monthly sign-off sheet outside the dashboard. → Hassan Ahmed.

## Done when

1. Eight tabs render, each audit tab with all four bands.
2. Filtering to a single flag leaves every KPI tile unchanged, and changes only the in-view line.
3. No view, tile or export produces a total across audits or across exposure classes.
4. Every tile and column header carries its namespaced metric id.
5. Each flag renders its word and glyph with colour disabled.
6. CSV export contains no column from the Sensitivity list.
7. The grey count is visible on every audit tab even when the flag filter excludes it.

---
---

# ③ Data Engineering Task

> **Title:** `Visa expense audit — four ingestion asks that widen audit coverage (non-blocking)`
> **Issue type:** `Data Engineering Task` — set on creation.
> **Routing:** Data Engineering manager. **Blocks nothing.** Each ask widens one audit.

## What we need

> **None of these blocks ①. Each one is the difference between an audit concluding and an audit
> saying "cannot tell".** Filed together so they can be prioritised against each other rather than
> arriving one at a time.

| # | Data point | Source | What it unlocks | Size today |
|---|---|---|---|---|
| **N1** | **MV client recharge for an E-ID replacement** | ERP — client billing | E-ID MV replacements can be **scored** instead of held. Four independent tests confirm it is genuinely absent from the warehouse, not merely unfound | **131 cases, AED 58,649.84** that can be neither cleared nor condemned |
| **N2** | The ERP primary key of `VisaRequestNote`, added to `BA_VIEWS.VISA_SILVER.VISAREQUESTSNOTES` | ERP, Visa module | The medical verifier's citation contract. The table has **no primary key and no unique column combination** — 1,809,225 rows give only 1,808,902 distinct even on five fields | Until then a surrogate id is used, and **323 rows can change id between runs** |
| **N3** | Per-bundle reservoir type (`cc_lawp` / `cc_pawp` / `mv`) | ERP portal config, VPMGOV-440 | LAWP can exclude PAWP properly. `QUOTA_CONSUMPTION_DETAILS.LAWP_PAWP` covers **3.8–7.4%** and runs 44:1 PAWP to LAWP | Some PAWP bundles are in the LAWP population today, and nobody can say how many |
| **N4** | The ERP parameter table — `@MAX_REPLACEMENT_COUNT@` (VPMGOV-985) and the excluded-nationality list (SD-58457) | ERP parameters | LAWP stops hardcoding a bound and an exclusion. Alert 945 hardcodes *"nationality is NOT Pakistani"* | **A live production blind spot** — those cases cannot be seen at all |

**A near miss worth recording for N1.** `HOUSEMAID_MANAGEMENT_SILVER.MAID_SERVICES` holds the E-ID
request register and declares `CONTRACT_ID`, `CLIENT_ID`, `NOTES`, `IS_APPROVED` and
`LOANS_FORGIVENESS_AMOUNT`. **All five are NULL on all 555 rows.** It looks like the client link and
is not one — but ingesting those five columns would close N1 **without any new table.**

## Done when

Each data point resolves in `BA_VIEWS` with a non-null rate stated, and the owning spec's blocked
metric is re-measured against it.

