# MV Monthly Payment check — ERP surfaces, probed

**Probed live 2026-08-19** against production, paced, read-only.
Spec: Notion *MV Monthly Payment check*, v0.8 draft.

> **Attribution caveat.** All probes below ran on a token issued to ERP user **`Abdullaha`**
> (device `1783257240058`), not to the operator running this build. Every "works" result is
> therefore verified **on that account**, and must be re-confirmed on whichever account runs
> the check before these rows are treated as the operator's access. Recorded because a route
> once documented as verified turned out to be refused on the auditing account.

`audit_intel/` — the directory the spec cites for its saved payloads — is not present in this
environment, so nothing below is inherited. Every figure was re-observed.

---

## Access matrix

| # | Surface | Method + path | pagecode | Status | Notes |
|---|---|---|---|---|---|
| 1 | Contract population | `POST /clientmgmt/contract/search/page?searchKey=` | **`ClientList`** | **200** | Spec says "no pageCode required" — **wrong**, empty pagecode returns 401 `PAGE_CODE_MISSING` |
| 2 | Payment ledger | `POST /accounting/payments/page/advancesearch?page&size&sort=` | `PaymentReport` | **200** | Filter body is an **array**. `ClientSummary` → 401 |
| 3 | Contract details | `POST /clientmgmt/client/get-client-details/{clientId}?type=CONTRACT_DETAILS&contractId={id}` | `ClientSummary` | **200** | 35 top-level keys. `ClientList` → 401 |
| 4 | Message log | `GET /clientmgmt/client/smsLog/{clientId}?messageType=WHATSAPP&emailSubject=` | `ClientMgmtSMSLog` | **200** | **Two required params**, both undocumented in the spec |
| 5 | Complaints list | `GET /complaints/complaint/page/client/{clientId}?page&size` | `ClientComplaints` | **200** | Also works with `post-sale-services_Open_Complaint` |
| 6 | Complaint thread | `GET /complaints/teamComplaintUpdate/historyOfComplaint/{id}` | `ClientComplaints` | not probed | Needs a complaint id from surface 5 |
| 7 | Credit notes (structured) | — | — | **NOT FOUND** | No structured credit-note source on CONTRACT_DETAILS — see correction C4 |
| 8 | Refund types | — | — | not probed | Live picklist read still outstanding |

**No blockers.** All three population/ledger/plan surfaces are readable, so the check can run.

### Denial shapes, with their real discriminators

The `developermessage` response header separates causes that all present as HTTP 401:

| `developermessage` | Meaning | Fix |
|---|---|---|
| `PAGE_CODE_MISSING` | pagecode header absent or empty | send one |
| `API_NOT_FOUND_FOR_PAGE` | route not registered for that pagecode | use the right pagecode |
| *(absent)* on a 401 | genuine permission gap | request the permission — it is a finding |
| 5xx containing `498` / `malformed` | dead token | fresh token |

---

## Surface 1 — population. The 40-row page-0 cap is REAL and unchanged

| call | status | rows | `total` | first id | last id |
|---|---|---|---|---|---|
| `p0 size=500` | 200 | **40** | 22,867 | 999425 | 1000803 |
| `p0 size=40` | 200 | 40 | 22,867 | 999425 | 1000803 |
| `p1 size=500` | 200 | **500** | 22,867 | 1008343 | 1014201 |
| `p1 size=40` | 200 | 40 | 22,867 | 1000858 | 1001808 |
| `p2 size=500` | 200 | 500 | 22,867 | 1014205 | 1018073 |

- Page 0 caps at 40 regardless of `size`; **`size` is honoured on every later page**. Confirmed.
- `p0` ends at id **1000803** and `p1 size=40` begins at **1000858** — contiguous, and both ids
  match the spec's recorded boundary exactly.
- A flat `size=500` walk never requests offsets 40–499. The two-pass sweep is required.
- `total` = **22,867** (outer). `clients.totalElements` = **40** — the capped field. Read the
  outer one. Reconcile with tolerance: 22,867 today vs 22,825 on 2026-08-11.
- **Population is 22,867, not the "~2,950" the spec's budget section states.**

Sweep cost: 1 (page 0) + 12 (head, size 40) + ~46 (tail, size 500) = **~59 calls**.

## Surface 2 — payment ledger. The cap does NOT generalise

| call | status | rows | `totalElements` |
|---|---|---|---|
| `p0 size=500` | 200 | **127** | 127 |
| `p0 size=200` | 200 | **127** | 127 |
| `p0 size=50` | 200 | 50 | 127 |
| `p0 size=40` | 200 | 40 | 127 |

**Page 0 honours `size` on this route.** One call at `size=500` returns a whole contract's
ledger. This is the single biggest budget finding — the spec assumes 1–11 paged calls per
contract; it is **1**.

Full reconciled walk of contract 1099709 (4 pages × 40) pulled 127 of 127 — reconciles.
Independently reproduced the spec's own recorded figures:

- status spread: `PDC` ×117 · `RECEIVED` ×5 · `DELETED` ×3 · `BOUNCED` ×2 — exact match.
- `status.value` = `PDC` while `status.label` = `PDP` on all 117.
- 122 of 127 rows are `monthly_payment`; the rest `transfer_fee` ×3, `same_day_recruitment_fee` ×2.
- exactly **1** `RECEIVED` row carrying **0.00**.

Row shape: **22 keys**, `amountOfPayment` present, **no `amount` key** — confirms the
resolved TA conflict. `replaced` is a row-level bool. `contract.client.id` rides along, so a
ledger read yields the client id for free (no extra lookup for enrichment).

Envelope: `content`, `total`, `totalSum`, `totalVat`, `totalElements`, `totalPages`, `last`,
`numberOfElements`, `empty`.

## Surface 3 — CONTRACT_DETAILS. Everything the scorer needs, one call

Read on contract 1099709 (client 469560):

```
currentPayment            = { amount: "AED 1,638", amountValue: 1638.0, status: "" }   # display summary, 3 keys
currentPayments[0]        = { workerSalary: 1470.0, workerSalaryWithoutVAT: 1400.0,
                              visaFees: 168.0, amountValue: 1638.0,
                              paymentTypeCode: "monthly_payment", status: "RECEIVED" }
isWorkerSalaryVatted      = true          # TOP-LEVEL, not on the currentPayments row
vatOnSalary               = true
contractStartDate         = "2026-06-26 09:18:52"    # a DATETIME, not a date
dateOfTermination         = ""                        # EMPTY STRING when absent, not null
scheduledDateOfTermination = ""  ·  isScheduledForTermination = false
nextMonthlyPaymentAmount  = 1638.0                    # populated here; still not to be used
preCollectedInfo.isPreCollectedSalary = true
preCollectedInfo.currentPreCollectedPayments = [
  { amount: "AED 1,638", preCollectedPaymentDate: "01 Jul 2026",
    status: "RECEIVED", paymentType: "Monthly Payment" } ]
paymentPlan.paymentsInfo  = 5 free-text strings
paymentPlan.additionalDiscount / .creditNoteDiscount   # <- the real relief fields
```

`workerSalary + visaFees == amountValue` exactly (1470 + 168 = 1638), and the plan's own
`(Monthly)` line agrees: *"WPS Processing + Maid Salary: 1400 Maid's Salary + 160 + 78 VAT,
on Jul 01 2026 (Monthly)"* = 1,638. The other four plan lines are `(One Time Payment)` or
`(Once every 2 years)` — gate 12's exclusions are visible in the text.

## Surface 4 — message log. Two undocumented required params, and the wrong channel

`messageType` is a **required** enum, and `emailSubject` is **also required on every
channel** (pass empty). Neither appears in the spec. Omitting either returns HTTP 400.

`MessageType` constants (via LCP, `MessageType.java:4`): `SMS`, `EMAIL`, `NOTIFICATION`,
`WHATSAPP`, `WHATSAPP_CONVERSATION`.

| channel | row fields | date field |
|---|---|---|
| `SMS` | body, contractId, **creationDate**, id, messageType, receiverId, receiverName, receiverType, smsType, status, subject | `creationDate` **populated 20/20** |
| `WHATSAPP` | deliveryStatus, outboundNumber, **sentDate**, skill, smsContent, smsSend, templateContent, templateName | `sentDate` **populated 27/27** |

**Use `WHATSAPP`.** It is the only channel carrying `sentDate`, and the only one that can
satisfy all three of verifier rule 3's tests. Page 0 honours `size` here too (27 rows at
`size=100`, `totalPages` 1).

`deliveryStatus` values observed: `READ`, `RESPONDED`, `DELIVERED`, `SKIPPED`, `FAILED`.
Delivered set = {DELIVERED, READ, RESPONDED}; SKIPPED and FAILED are not deliveries.

Template names are structured identifiers — 23 distinct on one client. Chases look like
`Accounting_dd_messaging_setup_clientBouncedPayment`, `MV_PAYMENT_FOR_APPROVAL_REQUEST_FROM_ERP`.
Non-chases that must be excluded include `MV_PAYMENT_RECEIVED_NOTIFICATION` (a **receipt**
containing the word PAYMENT), `CM_CLIENT_BROADCAST_*`, `PRE_SALE_CRM_CAMPAIGN_ACTION_*`,
`MAID_BIRTHDAY_REMINDER_FOR_CLIENT`, `CM_PORTAL_WHATSAPP_OTP_1`, `Client _VAT_Confirmation`.
Some template names are **bare numeric ids** (`669348018255590`) — unclassifiable, and
therefore not counted as chasing.

**Sensitive:** this surface carries `outboundNumber` (a phone number) and message content.
**Only the date leaves the check.**

## Surface 5 — complaints list

Row keys: `assignTo`, `caller`, `category`, `client`, `commentCount`, `complaintDate`,
`creationDate`, `housemaid`, `id`, `initialDescription`, `managerNotes`, `primaryType`,
`recentSummary`, `replacement`, `resolutionDetails`, `seriousnessLevel`, `status`, `summary`.

Both `initialDescription` (what verifier rule 1 requires) and `summary` (what it forbids
concluding from) are present, so that trap is live and relevant. `managerNotes` and
`recentSummary` are also available as context.

---

## Call budget — recounted against probed reality

| | Spec | Probed reality |
|---|---|---|
| Population | ~2,950 | **22,867** |
| Population sweep | 58 calls | **~59 calls** ✔ |
| Ledger pages per contract | 1–11 | **1** (page 0 honours size=500) |
| Payment-search calls, per-contract walk | 3,000–8,000 | **22,867** |

The spec's own architecture (one walk per contract) costs **~22,867 calls**, not 3,000–8,000.
That is ~3× the spec's high estimate rather than the ~30× I projected before probing — the
page-0 finding on surface 2 absorbed most of it. Still far too many for one execution on the
endpoint that has previously taken the Accounting module down.

### Chosen architecture

```
Stage 1  population two-pass sweep, reconciled to response.total       ~59 calls
Stage 1  month payment sweep (audited month), sub-workflow, slim       ~50-100 calls
         └─ join contract -> its rows for the month, in memory
Stage 2  candidates only (no RECEIVED monthly row in the month)        ~2,835 per v0.8
         ├─ CONTRACT_DETAILS per candidate                             ~2,835 calls
         └─ single-call ledger read per candidate (chain proof)        ~2,835 calls
Stage 3  evidence per surviving red (WhatsApp log + complaints)        ~154 x 2
                                                              TOTAL   ~9,000 calls
```

Constraints this respects:
- The month sweep is bounded and paced, mirroring the proven `CC Below Agreed · 0-Sweep
  Payments` sub-workflow. **Still to confirm by probe** that `advancesearch` accepts a
  date-range filter at this width; if refused, fall back to candidate-only single-call reads.
- Candidates come from the month sweep, so a contract with **no row at all** still surfaces —
  the never-billed shape the ERP-only ruling exists to catch stays visible.
- `MAX_PAGES_PER_SWEEP` must be ≥ 46 for the tail pass at MV scale.

## Free wins confirmed

- `is_pre_collected`, the advance array, the salary/fee split, `dateOfTermination` and the
  plan text **all ride on one `CONTRACT_DETAILS` call**.
- `contract.client.id` comes back on every **payment** row — no separate client lookup.
- `client.vip` / `client.vVip` are projected by the **population** call, so VIP costs nothing.
- One ledger call per contract instead of up to eleven.
