# MV Monthly Payment check — ERP surfaces and call budget

Status: **Phase 2 planned, not yet probed** — awaiting the operator's ERP token.
Spec: Notion *MV Monthly Payment check*, v0.8 draft (2026-08-17).

`audit_intel/` — the directory the spec cites for every saved payload, probe script and
raw ERP confirmation — **is not present in this environment**. It lives on the spec
author's machine. Every "verified live" claim below is therefore inherited, not
re-observed here, and is re-probed rather than trusted.

---

## Surfaces the check needs

| # | Surface | Method + path | pagecode | Role | Blocker? |
|---|---|---|---|---|---|
| 1 | Contract population | `POST /clientmgmt/contract/search/page?searchKey=` | none required | Enumerate every MV contract; also projects `client.vip` / `client.vVip` | **BLOCKER** — no population, no run |
| 2 | Payment ledger | `POST /accounting/payments/page/advancesearch?page&size&sort=` | `PaymentReport` | What was actually paid | **BLOCKER** |
| 3 | Contract details | `POST /clientmgmt/client/get-client-details/{clientId}?type=CONTRACT_DETAILS&contractId={id}` | `ClientSummary` | Expected amount, split, `preCollectedInfo`, `dateOfTermination`, `discount` | **BLOCKER** |
| 4 | Message log | `GET /clientmgmt/client/smsLog/{clientId}` | `ClientMgmtSMSLog` | Verifier: last follow-up date (**date only**) | Degradation |
| 5 | Complaints list | `GET /complaints/complaint/page/client/{clientId}?page&size` | `ClientComplaints` | Verifier: `initialDescription` | Degradation |
| 6 | Complaint thread | `GET /complaints/teamComplaintUpdate/historyOfComplaint/{id}` | `ClientComplaints` | Verifier: staff-written reason | Degradation |
| 7 | Credit notes | *route not recorded in the variable inventory* | — | Gate 14 relief | Degradation |
| 8 | Refund types | live read of the payment-type picklist | — | Gate 16 vocabulary | Degradation |

Surfaces 1–3 are the check. 4–8 only cap verdict confidence: if unreadable, cases still
score deterministically and affected verdicts are capped and labelled with the named gap
(`message log unread — PIL blocked`, etc.), never silently defaulted.

### Probe plan (one paced call per row, serial, 500 ms apart)

Both documented **and** alternative pagecodes get probed on surfaces 4–7, because a wrong
pagecode and a missing permission both return 401 and only the `developermessage` header
separates them. Known-good ids from the spec: contracts `1099709`, `1029517`, `1019110`,
`1053569`, `1086626`; confirmed reds `1023590` (2026-03), `1074171` (2026-06).

Boundary probes to run, because the spec's own numbers depend on them:
- surface 1: `page=0&size=500`, `page=1&size=500`, `page=1&size=40` — confirm the page-0
  40-row cap still bites where recorded, and that `size` is honoured on pages 1+.
- surface 1: read `response.total` **and** `response.clients.totalElements` and confirm they
  still differ (the outer one is the audit count).
- surface 2: walk one contract to exhaustion and assert `pulled == totalElements` before
  trusting any negative month.

---

## Call budget — recounted, and the spec is wrong by ~30×

The spec's *Where do the results go?* heading states:

> population sweep ≈ 58 calls (two-pass, ~2,950 contracts measured 2026-08-11) + one
> payment-history walk per contract at 1–11 pages each ≈ **3,000–8,000** payment-search calls

Both figures in that sentence are wrong, and they are wrong in a way that changes the
architecture rather than the runtime.

**The population is 22,825, not ~2,950.** The `mv_contract_population` variable row records
`response.total = 22,825` active MV contracts, measured the same day; the ~2,950 figure is
the **CC cohort** that lost 460 rows to the pagination trap, transcribed into the MV budget.
The Snowflake measurement in v0.8 corroborates 22,825: 28,518 distinct contracts across 11
months, ~243k contract-months.

The 58-call sweep figure is right — it was computed for 22,825 (1 + 12 + ~46). Only the
contract count beside it is wrong.

**The per-contract payment walk is therefore unaffordable as specced:**

| | Spec's figure | Actual |
|---|---|---|
| Population | ~2,950 | **22,825** |
| Population sweep | 58 calls | 58 calls ✔ |
| Payment walk (1–11 pages × population) | 3,000–8,000 | **22,825 – 251,075** |
| `CONTRACT_DETAILS` per scored case | "per scored case" | up to 22,825 |

At a sequential 500 ms pace, ~68,000 calls (population × ~3 pages average) is **~9.5 hours
of wall clock in one execution**, on the endpoint the spec itself records as *"the one that
took the Accounting module down"*. It also cannot live in one n8n execution on retained
data alone.

### Architecture that fits: windowed sweep + candidate-only enrichment

Instead of one payment walk per contract, sweep the **audited month once** and join in
memory. A month's monthly-payment rows across all MV contracts is ~22.8k rows; at `size=500`
that is ~50–100 paged calls.

```
Stage 1  population sweep (two-pass)                     ~58 calls
Stage 1  month payment sweep, audited month ±1           ~150 calls   (sub-workflow, slim projection)
         └─ join: contract → its rows for the month
Stage 2  candidates only (no RECEIVED row in month)      ~2,835 contracts per the v0.8 measurement
         ├─ CONTRACT_DETAILS per candidate               ~2,835 calls
         └─ full ledger walk per candidate (chain proof) ~2,835–8,500 calls
Stage 3  evidence per surviving red                      ~154 × 3 calls
                                                  TOTAL  ~9,000–15,000 calls
```

That is ~20× cheaper than the literal reading and lands in the same order of magnitude the
spec *believed* it had. Two constraints it must respect:

- The spec forbids "a bare date-range sweep at width" on surface 2. The month sweep is
  bounded (one month, paced, sequential) and mirrors the proven `CC Below Agreed · 0-Sweep
  Payments` sub-workflow, which does exactly this in 31-day windows. **To be re-confirmed by
  probe before the full run** — if the month sweep is refused or throttled, fall back to
  candidate-only walks driven by a cheaper candidate source.
- Candidates must be derived from a source that **cannot hide a never-billed contract**. The
  month sweep satisfies this: a contract with no row at all appears as a candidate precisely
  because the join finds nothing. Narrowing the population by "appears in the payments book"
  would reintroduce the payroll-file blindness the owner's ERP-only ruling exists to prevent.

`MAX_PAGES_PER_SWEEP` must be raised to **≥ 46** before pointing the pager at MV (tail offset
20,000 at the current 40). Forgetting aborts the run rather than under-reporting — the
shortfall guard raises when collected rows fall short of `response.total` by more than
`max(3, 0.2%)` — but it wastes a full sweep.

---

## Free wins already banked (no extra call)

- `is_pre_collected` = `preCollectedInfo.isPreCollectedSalary` — on `CONTRACT_DETAILS`, which
  the check already reads. Deletes the Accounting-module round trip gates 4/5 once waited on.
- The advance itself = `preCollectedInfo.currentPreCollectedPayments[]` on the same payload.
- The salary/fee split = `currentPayments[]` on the same payload. No separate plan call.
- `client.vip` / `client.vVip` are projected by the **population** call, so VIP costs nothing.
  They are *not* on `get-client-details` — looking there reads "not VIP" for everyone.
