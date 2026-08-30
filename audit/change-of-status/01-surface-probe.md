# Phase 2/3 — ERP surfaces, probed live

Probed 2026-08-30 on the operator's own token (`Hassan Bearer`, n8n credential
`6LuYiBDo4D641TEz`, Adeeb project). Two throwaway probe workflows:
`vnsyLedHRpUcyhri` (exec 110390) and `Puff7xnNYLN2rVPt` (exec 110394).
Every probe used full-response mode so non-2xx was read, not swallowed.

## Token liveness (Phase 1 result)

| Credential | Result |
|---|---|
| `ERP Token 12th Aug 2026` (uDGE06IdxKx74kFz) | **expired** — HTTP 500, `Token not valid, {Token is expired}` |
| `ERP Hassan Prod` (egREvHnZfspVnrza) | **expired** — same shape |
| `Hassan Bearer` (6LuYiBDo4D641TEz) | **live** — authenticates; four routes return 200 |

The expired shape is a 500 carrying an expiry message, not a 401 — as the traps
predict. `Hassan Bearer` is live: it returns 200 on four surfaces, so its 401s
elsewhere are authorization, not authentication.

## Surface table

| # | Surface | Route | pagecode | Status | Shape | Check can proceed? |
|---|---|---|---|---|---|---|
| P1 | Population (MV, by name) | POST `/accounting/transactions/page/advancesearchNew` | `ManageTransactions` | **200** | paged | yes, but see below |
| P2 | Population (CC, by id) | POST `/accounting/transactions/page/advancesearch` | `ManageTransactions` | **200** | paged | **yes — the route to use** |
| Q9 | Population (MV, by id) | POST `/accounting/transactions/page/advancesearch` | `ManageTransactions` | **200** | paged | yes |
| Q10 | Population, both heads at once | same, `operation: "in"` | `ManageTransactions` | **200** | paged | **yes — contradicts the spec** |
| P6 | Client payments (MV recovery leg) | POST `/accounting/payments/page/advancesearch` | `PaymentReport` | **200** | paged | yes |
| P8 | Maid complaints (waiver evidence) | GET `/complaints/complaint/limited/housemaid/{id}` | `HousemaidComplaints` | **200** | paged | yes |
| P3 | Transaction detail | GET `/accounting/transactions/{id}` | `AddEditTransaction` | 401 | `INSUFFICIENT_PERMISSIONS` | **not needed any more** |
| Q11 | Transaction detail, alt pagecode | GET `/accounting/transactions/{id}` | `ManageTransactions` | 401 | bare 401 (wrong pagecode) | not needed |
| P4 | Overstay fines (the EXPECTED side) | GET `/visa/overstay-fines/housemaid/{id}` | `VisaProcessingPage` | 401 | `INSUFFICIENT_PERMISSIONS` | **BLOCKED** |
| P5 | Visa request (the request grain) | GET `/visa/newRequest/{id}` | `VisaProcessingPage` | 401 | `INSUFFICIENT_PERMISSIONS` | **BLOCKED** |
| Q12 | same, alt pagecode | GET `/visa/newRequest/{id}` | `VisaProcessing` | 401 | bare 401 | BLOCKED |
| Q13 | same, alt pagecode | GET `/visa/newRequest/{id}` | `NewVisaRequest` | 401 | bare 401 | BLOCKED |
| Q14 | Visa request expenses | GET `/visa/visaRequestExpenses/newRequest/{id}` | `VisaProcessingPage` | 401 | `INSUFFICIENT_PERMISSIONS` | BLOCKED |
| P7 | Maid loans (the CC ACTUAL side) | GET `/payroll/loans/getHousemaidLoans/{id}` | `HousemaidsPayrollLoans` | 401 | `INSUFFICIENT_PERMISSIONS` | **BLOCKED** |

The visa route was probed under three pagecodes and the transaction detail under
two, so these are permission gaps on the operator's identity, not pagecode
mistakes. This is the failure the builder process warns about by name: these
routes are recorded as verified in the Overstay Fines goldens, but that
verification was made on `ERP Token 12th Aug 2026` — a different login.

## Three spec claims overturned

1. **`operation: "in"` works.** Rule ❶ and the check page both state that asking
   for both heads at once "fails outright" / returns HTTP 500. On
   `advancesearch` it returns **200**. It presumably fails on `advancesearchNew`,
   which is the route the claim was measured against. One sweep, not two.
2. **The maid id arrives inline.** `housemaids[0].housemaid.id` is present on
   **40/40** rows, alongside `description`, `amount`, `date`, `vatType`,
   `vatAmount` and `contractId`. *Still open* item 2 is answered, and answered in
   the good direction.
3. **The population does NOT have to come from the warehouse.** The check page's
   "binding constraint" — 573–1,040 calls against a 500-call cap, worst months
   don't fit — assumed one call per row for identity. There is no per-row call.
   A full month is **18 page reads at size=40** (704 rows in July), or fewer at a
   larger page size. Two orders of magnitude under the cap.

## Population proof (Phase 7 evidence, obtained early)

July 2026, three independent reads:

| Read | Query | totalElements |
|---|---|---|
| Q9 | head `1677` alone | 646 |
| P2 | head `1589` alone | 58 |
| Q10 | both heads via `operation: "in"` | **704** |

646 + 58 = 704, and the spec's own warehouse table gives July = **704**.
Three-way agreement, **delta zero**.

## Which route to use, and why it matters

`advancesearchNew` (the MV golden's route) returns 45 key paths and **no
`housemaids` link** — it would force a per-row detail call that the operator's
token cannot make anyway. `advancesearch` returns 157 key paths **including the
maid**. The check must use `advancesearch`.

## Free wins found on the row

- **`newRequestExpense.purpose` is a structured enum**, `'Change of Status'` on
  40/40 rows. Gate ⓲ (the purity gate) was specified as a description-vocabulary
  match, and its `Pending Technical` closing action was "a full enumeration of
  the description vocabulary". **Key on `purpose` instead** — an enum beats
  parsing prose, and it closes that action without the enumeration.
- `newRequestExpense.status` = `'Added'` on 40/40, matching the filter rule ⓳
  measured on.
- **VAT is now partly characterised** (the spec says "stated as unmeasured rather
  than assumed zero"): `vatType` is `'IN'` — inclusive — on 40/40, and
  `vatAmount` is **not** uniformly zero. Comparing the amount as booked is
  therefore correct, as the spec instructs.
- All 40 descriptions carry an embedded date — the service-date trap the spec
  warns about is real and present on every row. Window on `date`, never on the
  description.

## What is NOT on the row, and what that costs

**There is no visa request id anywhere on the transaction payload.** Checked
every candidate: `newRequestExpense.referenceNumber` is 18 chars, non-numeric and
**distinct on 40/40 rows**, so it is a per-line external reference, not a request
key; `newRequestExpense.id` is likewise distinct per line; `contracts`,
`officeStaffs`, `prospects`, `freedomOperators` and `sales` are all empty.

So the request grain genuinely requires the visa module, and the visa module is
refused. Consequences, taken from rule ⓳'s own measurements:

- The **request-grain leg cannot run**. That leg carries **23 of the pairs**
  (AED 16,954), including **4 same-request pairs at 591–965 days** that the
  ninety-day window explicitly cannot catch — ⓳ says the window "silently clears
  every one of them".
- The **charge-on-the-wrong-maid's-request** shape (5 of the 23) cannot be
  detected at all. It has no verdict word yet either (*Still open* item 8).
- ⓳'s Never — "never call a same-request pair a duplicate without confirming both
  legs carry the same maid id" — is unreachable, so no same-request conclusion may
  be drawn in either direction.

The maid-grain ninety-day leg is unaffected and runs on the population sweep alone.

## Effect on the inherited fine-recovery half (Orders 20–150)

The EXPECTED side (`/visa/overstay-fines/housemaid/{id}`) and the CC ACTUAL side
(`/payroll/loans/getHousemaidLoans/{id}`) are both refused. Order 40 forbids
deriving a fine by subtracting the base from the amount, so with the fines record
unreadable **the fine cannot be sized at all** — only its existence inferred
(Order 20, amount > base, which does run).

That collapses Orders 30–150. In effect the operator's access forces the outcome
that *Still open* item 1 was already weighing: **this becomes the duplicate
check, not the fine-recovery check.** Item 1's option A — "untag Orders 40–150,
leaving this purely the duplicate check at 9 rules" — is what the token can
actually deliver.

## Call budget, recounted

| Stage | Spec's figure | Measured |
|---|---|---|
| Population sweep | 573–1,040 (one per row) | **18 page reads** at size=40 (July) |
| Per-row identity enrichment | 1 per row | **0** — inline |
| Trailing history per candidate maid | 1–2 per run | unchanged, and cheap |
| Fine recovery (`+130–190/month` if Orders 20–150 stay) | 130–190 | **0 — blocked** |

A month costs roughly **20 ERP calls**, not 573–1,040. The ERP pre-flight budget
gate inherited from the golden will pass with enormous headroom, and the staged
sub-workflow architecture the goldens need for large populations is unnecessary
here — this fits in one execution.
