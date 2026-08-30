# ILOE Checker — spec corrections and resolved logic

Written during the build, 2026-08-30. Against spec v0.8.

---

## A. Corrections to file back to the Notion variable rows

These are **stale bodies contradicting their own properties** — in every case the
property row and `Example Values` were updated after a live read on 2026-08-20
and the free-text body underneath was not. Each one currently tells a future
builder that a field is unverified when the same page proves it was verified.

| Row | Body says | Same page's own evidence says | Action |
|---|---|---|---|
| `iloe_expense_name` | "`ERP Value Status` is **Pending Technical** and not Confirmed … no ILOE row has been seen on an ERP API response. Promote only after one live `advancesearchNew` call returns an ILOE row." | Property `ERP Value Status: Confirmed`; `Example Values` records a live `advancesearchNew` call on 2026-08-20 returning `totalElements 489` with a page-0 expense mix across five of the six live names. | Delete the body paragraph — the condition it sets was met on the same day. |
| `iloe_txn_amount` | "the API field name `amount` … has not been re-read on an ILOE row" | `Example Values`: "Live ERP call, 2026-08-20 … `\"amount\": 126.0` on every subscription row read. The field name is `amount` on both the search row and the `/accounting/transactions/{id}` detail." | Delete the trailing clause. |
| `iloe_loan_type` | "what is **not** confirmed is that the ERP API spells these three enum members exactly as the warehouse does. That is the first thing to check when the ERP account is back." | `Example Values`: "CONFIRMED ON A LIVE ERP PAYLOAD, 2026-08-20 … the API spells the members EXACTLY as the warehouse does." | Delete the body paragraph. |
| `iloe_loan_waive_notes` | "**no note has been read**, so `Example Values` says so rather than showing a plausible shape." | `Example Values` quotes three notes read live on 2026-08-20 (maids 132174 ×2, 132336). | Delete the body sentence. |

None of these changes a verdict. All four cost a future builder a re-probe of
something already proven, which is exactly what the "stale verified rows cost
more than blank ones" rule is about.

---

## B. The population call budget — the spec's own open question, settled from the spec

The check page flags this as unmeasured and says it "halves the budget":

> The first `N` is a `GET /accounting/transactions/{id}` per case *to resolve the
> maid*, which assumes the maid id is absent from the population response. …
> this page's own population bullet says the staff expenses are excluded because
> "0 of 87 carry a housemaid id", which reads as though an id is visible at
> population time. **The two statements cannot both describe the ERP response.**

**They can both be true, and the spec already contains the answer twice.**

1. `iloe_expense_name` → `Example Values` lists the **verbatim key set** of an ILOE
   `advancesearchNew` row: `amount, attachments, clientId, contractId, creationDate,
   date, description, expense, fromBucket, id, license, paymentId, paymentType,
   pnlValueDate, revenue, supplier, toBucket, transactionType, vatAmount, vatType`.
   There is **no `housemaids` key**.
2. `overstay_txn_maid_id` → `Traps`, E-ID binding, measured 2026-08-20: "this field
   is NOT present on the transactions SEARCH response. A verbatim search row
   (transaction 1770576) carries expense, amount, date, description,
   transactionType and attachments — and contractId and clientId as EMPTY STRINGS,
   with no `housemaids[]` at all."

The "0 of 87" observation came from the **Snowflake mirror**, where `HOUSEMAID_ID`
is a column. It is a statement about the warehouse, not the ERP payload. So:

> **The maid id is NOT on the search row. The budget is the ~1,519-call figure,
> not the ~770 one.**

This is still to be confirmed on a live probe (it is probe P1 in the build), but
the architecture is designed for the expensive case, so a confirmation is a
simplification rather than a rebuild.

### Recounted budget for a 750-payment month

| Leg | Calls | Note |
|---|---|---|
| Population sweep | ⌈750/40⌉ = 19 | plus ~2 more for the netting lookahead window (below) |
| Identity (`/accounting/transactions/{id}`) | 750 | one per payment; no way around it |
| Loans (`/payroll/loans/getHousemaidLoans/{maidId}`) | ~730 | memoised per maid, not per payment |
| **Total** | **~1,500** | **3× the 500-call ERP client cap** |

At Jacky's standing 2.0 s pacing that is **~50 minutes of wall clock**, over the
~2400 s single-execution ceiling. **The check cannot run as one execution.** It is
built as a staged sub-workflow chain with slim projections, and the run window is
a parameter so "a week at a time" is a setting rather than a rebuild.

---

## C. A gap the spec does not cover: reversals that land outside the audited month

Gate 12 nets a payment against its reversal. Its own worked example — maid
`132396`, `+126` on **2026-05-21** reversed by `−126` on **2026-07-11** — spans
**three calendar months**.

Under the forward-only monthly run (ruling R6), a May run sees only the `+126`.
Gate 12 nets it to 126, gate 5 finds no loan, and the case is raised as
**ILOE not recovered** — a red on money that was returned to us seven weeks later.

**Implemented mitigation:** the population sweep pulls the audited month **plus a
60-day lookahead**, and rows outside the audited month are used *only* for
netting — they never become cases. This reproduces the `132396` result correctly
and costs ~2 extra pages, not extra per-entity calls.

**Residual, declared:** a payment reversed *after the run executes* is unknowable
at run time. The direction of the error is a **false red, not a false clearance**,
and a re-run corrects it. Recommend running month M no earlier than M+2, or
accepting that late reversals self-correct on re-run.

---

## D. Judgement calls made where the spec is silent

| # | Question the spec does not answer | What was implemented, and why |
|---|---|---|
| D1 | **What is "the single-unit price"** in gates 12 and 9? Gate 3 forbids treating 402.86 as an expected fine, and fines carry 14 distinct observed values, so no tariff can be hard-coded. | The **largest positive payment in the group**. This reproduces every documented case: `+126+126−126` → no excess; `+126+126` → excess 126; fine + zero row → no excess; `+126/−126` 51 days apart → net 0, reversed. Verified against the spec's own figures (see below). |
| D2 | **What is the finding amount when one case fires two reds?** Gate 5 ("the whole 126 never came back") and gate 9 ("we paid this twice") can describe the same dirhams. | The headline `finding_aed` is the **larger** of the components, never their sum. Both components are also carried separately (`unrecovered_aed`, `duplicate_excess_aed`) in the case store. Summing them would inflate the reported total. On measured data the intersection looks empty — all three real duplicates are fully loaned — but it is reachable and must not silently double-count. |
| D3 | **Where does the group excess get attributed** when one case is one payment but the excess is per group? | To the **highest transaction id in the group**, once. A two-payment duplicate yields one excess, not two. This is what makes 3 duplicate groups × 126 come to the spec's stated AED 378 rather than 756. |
| D4 | **Verifier 2 with a reason nobody has ruled on.** The rule as written cleans any note naming an approver and a reason, but ruling R3 says the real question is *which reasons are acceptable*, and it is open. | A note whose reason is outside the two observed values (`Escalation`, `Duplicate`) is **pending**, not clean — the same "an unseen member routes, never cleans" discipline the rest of the spec uses. Notes with `Escalation`/`Duplicate` clean as gate 2 says. The reason is carried verbatim into the case record and counted in the run summary so Malaz can rule on a real list. |
| D5 | **Independent population count.** The check needs a second count source, and the natural one is the Snowflake mirror. | The flow's in-run guard is `pulled == totalElements` at `size=40`, **not** a Snowflake query. Building a warehouse read into a repeatable audit run would be a recurring data process, which is the ERP/Data team's to own. The Snowflake cross-count is done **once, by hand, out of band** for the population proof. |

---

## E. Rules carried as declared gaps

| Rule | Status | Effect on the numbers |
|---|---|---|
| Gate 6 + Verifier 1 (**ruling R1** — who owes the CC subscription) | `Pending Business` | Every CC payment with no loan is `pending`, never scored. On live-era rates that is **~1,280 of 2,335 CC new-subscription payments**. The pending count will dominate the run. This is the spec's intent, not a defect. |
| Gate 9 (**ruling R4** — duplicate window) | `Pending Business` | Implemented as **within the audited month plus the netting lookahead**, which is the conservative reading. A rolling window would find more. |
| Verifier 3 (**ruling R3** — waiver authority) | `Pending Business`, and **has no known reachable case** | Implemented and unit-tested, but `waiveNotes` is auto-generated from a template that always supplies an approver and a reason, so it may be unproducible by construction. It fires in tests only on a synthetic empty/bare note. **Declared: this red has zero real cases.** |
| Fine responsibility | Answered structurally | ILOE has its own `UNEMPLOYMENT_INSURANCE_FINES` loan type, so this never routes to the verifier here. Where no FINES loan exists it is gate 5/6's own outcome. |

---

## F. Offline verification already passed

- **28 / 28** unit tests green — all seven of the spec's test cases, plus a guard
  for every trap the rule bodies name (retired expense names, retired
  `UNEMPLOYMENT_INSURANCE_PREMIUM` loan type, `%UNEMPLOYMENT%` type bleed,
  fine-vs-subscription mismatch, the absolute AED 0.50 tolerance, the
  over-recovery mirror case, NEW-vs-RENEW partitioning, waiver-must-not-clean-a-
  duplicate, unreadable loans call, zero-amount rows).
- **Spec figures reproduced independently**: the netting logic turns the same
  **8** count-based candidate maids into the same **3** real duplicates
  (`132336`, `132405`, `132888`) for the same **AED 378** of excess.

Run them with `node checks/iloe/scorer/run_tests.js` and
`node checks/iloe/scorer/reproduce_spec_figures.js`.

---

## G. Confirmed and corrected on live ERP, 2026-08-30

Probed on the operator's own `Hassan Bearer` credential. Full detail in
`probe-report.md`.

### G1. Section B is confirmed — the maid id is NOT on the search row

Read live: **0 of 40** rows carry a `housemaids` key. The verbatim key set is
recorded in the probe report. The budget is the **~1,500-call** figure. Nothing
in the architecture changes.

### G2. `iloe_expense_name` — the recorded row key set is incomplete

Five fields are returned that the row does not list: `fromBucketIsSecure`,
`isDescriptionSecured`, `previouslyUnknown`, `qashioTransactionId`,
`toBucketIsSecure`. None is used by the check; the list should still be corrected
so the next reader is not surprised.

### G3. New trap for `iloe_expense_name` — there is no `in` operator

`{"property":"expense.id","operation":"in","value":"1693,1692,..."}` returns a
**500** with `For input string: "1693,1692,1605,1604,1727,1639"`. The endpoint
parses the value as a single integer. An exact-id population needs six separate
`=` queries. `expense.name` + `=` does bind (confirmed, 208 rows on head 1693).

### G4. `totalElements 489` reproduced exactly, ten days later

Same window (`2026-08-01 → 2026-08-19`), same figure as the spec's 2026-08-20
read. The population endpoint is stable.

### G5. **BLOCKER — two routes recorded as `Confirmed` are refused on the auditing account**

| Route | pagecode | Result |
|---|---|---|
| `GET /accounting/transactions/{id}` | `AddEditTransaction` | 401 `INSUFFICIENT_PERMISSIONS` |
| `GET /payroll/loans/getHousemaidLoans/{maidId}` | `HousemaidsPayrollLoans` | 401 `INSUFFICIENT_PERMISSIONS` |

A deliberately-wrong-pagecode control on the same endpoint returned a **different**
shape (`API_NOT_FOUND_FOR_PAGE`), which proves the pagecodes are right and the
account lacks the grant.

The spec marks both `Confirmed` against live ERP on 2026-08-20 — that verification
was made on a **different login**. The variable rows should record that the
permission is login-dependent, so the next builder does not read `Confirmed` as
"available to whoever runs this".

These are gate 2 (identity) and gate 4 (recovery). Without them every case is
`pending` and the check produces no verdicts at all. Access is required before any
live run.
