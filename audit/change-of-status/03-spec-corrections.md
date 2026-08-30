# Spec corrections to file — Change of Status Audit v0.7

Each correction below is backed by a live ERP read on 2026-08-30 through the
operator's own token, executions `110390` and `110394` in the Adeeb n8n project.
Every one of them changes what the flow does, not just how the page reads.

---

## 1. `operation: "in"` does NOT fail — CHECK PAGE + RULE ❶

**Currently says** (check page, heading 4): *"They have to be fetched one at a
time; asking the system for both at once fails outright."*
And rule ❶: *"Two reads, one per head — `operation: "in"` with a list of ids
returns HTTP 500 on this endpoint."*

**Measured:** on `POST /accounting/transactions/page/advancesearch`,
`{"property":"expense.id","operation":"in","value":[1589,1677]}` returns
**HTTP 200** with `totalElements` 704 for July 2026.

**Likely cause of the original claim:** it was measured on
`advancesearchNew`, which is the route the MV golden uses. The claim should be
scoped to that route rather than stated of the endpoint generally.

**Effect:** halves the population sweep.

---

## 2. The maid id arrives INLINE — closes *Still open* item 2

**Currently says** (*Still open* item 2, flagged 🔴): *"Does the maid id arrive
on the transactions list response, or does each row need its own call? It
decides whether the check fits its call budget."*
And Order 30's rule body: *"The maid is `overstay_txn_maid_id` … both from
`GET /accounting/transactions/{id}`."*

**Measured:** `housemaids[0].housemaid.id` is present on **40/40** rows of the
`advancesearch` response, together with `description`, `amount`, `date`,
`vatType`, `vatAmount`, `contractId` and `newRequestExpense.purpose`.

**Effect:** no per-row detail call. Order 30's "from `GET /accounting/
transactions/{id}`" is now wrong for this check and should read "from the list
response". The same question is open on E-ID (item 2 says "answer both
together") — this answers it for the shared endpoint.

---

## 3. The call budget was overstated by ~50× — CHECK PAGE heading 9

**Currently says:** *"⚠️ The binding constraint, not yet measured: if the maid
id does not arrive on the list response and each row needs its own call, one
month costs 573–1,040 calls against a 500-call cap — the worst months do not fit
at all, and the population must come from the warehouse instead."*

**Measured:** the antecedent is false. A month is **18 page reads** at
`size=40`. With a 400-day trailing-history sweep the whole run is about **245
calls**, inside the 500 cap and far inside the default 2,000 budget.

**Effect:** the population does **not** have to come from the warehouse, and the
staged sub-workflow architecture the goldens need is unnecessary here. This
constraint should be struck, not just downgraded.

---

## 4. *Still open* item 9 is answerable — the population route

**Currently says:** *"🔴 Re-source the population off a `page` endpoint with
`ask_erp_code` before build."*

**Measured:** `advancesearch` is the route that works AND carries the maid link;
`advancesearchNew` carries neither. Both are `page` routes. If the ban is on
paginated routes generally, it cannot be satisfied on this endpoint — every
variant is paginated — and the guard that matters is the one already
implemented: `content.length == totalElements`, walked at `size=40`, aborting on
a short walk.

---

## 5. Gate ⓲ can key on an enum instead of prose — closes its open action

**Currently says** (⓲, `Pending Technical`): *"the closing action is a full
enumeration of the description vocabulary on heads 1589 and 1677, so the
out-of-scope product list is measured rather than discovered one case at a
time."*

**Measured:** `newRequestExpense.purpose` is a structured enum reading
`'Change of Status'` on 40/40 rows, alongside `visaExpenseType`
(`'NewRequestExpense'`) and `status` (`'Added'`).

**Effect:** the purity gate keys on the enum. The description vocabulary
enumeration is no longer needed as a blocker, and — a real bonus — the
description need never be retained at all, so the maid's name and passport
number stay out of execution data and out of the case store.

---

## 6. VAT is now partly characterised — CHECK PAGE heading 5

**Currently says:** *"`VAT_TYPE` and `VAT_AMOUNT` exist on this table and have
not been characterised here — stated as unmeasured rather than assumed zero."*

**Measured:** `vatType` is `'IN'` (inclusive) on 40/40 rows and `vatAmount` is
**not** uniformly zero.

**Effect:** confirms the spec's own instruction to compare the amount **as
booked**. Still unmeasured: whether any row carries a non-`IN` vatType.

---

## 7. A permission gap the goldens record as verified — NEW, and the important one

The Overstay Fines goldens have these routes bound and working. On the
operator's own token, all four are **401 `INSUFFICIENT_PERMISSIONS`**:

- `GET /visa/overstay-fines/housemaid/{id}` (pagecode `VisaProcessingPage`)
- `GET /visa/newRequest/{id}` (probed under three pagecodes)
- `GET /visa/visaRequestExpenses/newRequest/{id}`
- `GET /payroll/loans/getHousemaidLoans/{id}` (pagecode `HousemaidsPayrollLoans`)

The goldens' verification was made on `ERP Token 12th Aug 2026`, a different
login — which is now itself expired. The ERP Variables rows carrying these
routes are marked `Confirmed`; they are confirmed **for some identity**, not for
the account that will run this check.

**Effect:** the rows should record which identity verified them, and this check
cannot deliver Orders 30–150 or the request grain of ⓳ until the permissions are
granted. See `01-surface-probe.md`.

---

## 8. Where this leaves *Still open* item 1

Item 1 asks whether the inherited fine-recovery rules (Orders 20–150) stay.
The permission gap answers it by force for now: **they cannot run**. That is
option A of the item — "leaving this purely the duplicate check" — arrived at by
constraint rather than by ruling. The ruling is still worth making, because it
decides what happens once the permissions are granted.

---

## 9. The check page's two fine-volume figures contradict each other

**Currently says** (heading 9): *"add one `/visa/overstay-fines/housemaid/{id}`
and one recovery call per fine-bearing row: **12.5% of rows**, roughly
**130–190 a month** on top."*

Those are two different claims and they do not agree:

| Figure | Implies for a 704-row month |
|---|---|
| "12.5% of rows" | **88** rows |
| "130–190 a month" | **18.5% – 27.0%** |
| **Measured, July 2026 (run 110429/110690)** | **104 rows = 14.8%** |

The measured value sits between them, so neither is right as stated. It matters
because it sizes the extra call budget for the fine-recovery half once the visa
and payroll permissions are granted: 104/month, not 88 and not 190.

## 10. The base is exact, and every live fine is a clean AED 50 multiple

Measured over all 704 July rows:

- **All 600 clean rows sit at exactly AED 575.65.** The 2024-onward band in
  ⓱ is confirmed dead-on for the live population — not approximately, exactly.
- **All 104 fine-bearing rows are 575.65 + an exact multiple of AED 50**
  (104/104). Implied days: 1–21 for 98 of them, with six outliers at 49, 55,
  163, 255 and 267 days — the largest being AED 13,350 over base.
- **Zero rows fall in the 52/103/155 daily-rate family.**

**Why this matters for rule ❻'s binding.** The tagged rule's per-check note says
this check has *"two daily-rate families here, so the ×50 consistency test does
not bind identically"*, citing Khalil's two-month sample where both families
appear. In the **live** population only the 50-family is present. The second
family looks like a legacy-era artefact, which would let ❻'s consistency test
bind here after all — worth confirming across more months before ruling.

⚠️ **This is NOT a licence to size fines by subtraction.** Order 40 forbids that
outright, and rule ❻ permits the ×50 arithmetic only as a *consistency check,
never as a source*. What is recorded above is an observation about the shape of
the live data, not a method for valuing a fine. The reason the prohibition still
stands is visible in this very check: AED 590.54 is an unexplained second live
price (*Still open* item 5), and any row carrying it would make the subtraction
produce a phantom ~AED 15 fine. None appeared in July — **zero rows at 590.54** —
but the spec reports 327 such rows across the current heads, so they exist in
other months.

**Also worth a human eye:** the six outliers above 21 implied days, and
especially the 163/255/267-day ones, are far outside the bulk of the
distribution.
