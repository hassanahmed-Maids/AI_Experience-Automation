# ILOE Checker — Phase 2 probe report

Probed 2026-08-30 against production ERP (`erpbackendpro.maids.cc`) on the
**`Hassan Bearer`** credential (Adeeb project, `6LuYiBDo4D641TEz`) — the operator's
own login. Probe workflow: `ESOVrx1JZMby60W1`, execution `110400`.

## Result table

| # | Surface | pagecode | Status | Denial shape | Check can proceed? |
|---|---|---|---|---|---|
| P1 | `POST /accounting/transactions/page/advancesearchNew` (`like ILOE`) | `ManageTransactions` | **200** | — | yes |
| P2 | `GET /accounting/transactions/{id}` | `AddEditTransaction` | **401** | `INSUFFICIENT_PERMISSIONS` | **NO — blocker** |
| P3 | `GET /payroll/loans/getHousemaidLoans/137833` | `HousemaidsPayrollLoans` | **401** | `INSUFFICIENT_PERMISSIONS` | **NO — blocker** |
| P4 | `GET /payroll/loans/getHousemaidLoans/65876` | `HousemaidsPayrollLoans` | **401** | `INSUFFICIENT_PERMISSIONS` | **NO — blocker** |
| P5 | `GET /staffmgmt/housemaid/getHousemaidInfo/121794` | `HousemaidDetails` | **200** | — | yes |
| P6 | *control:* loans with a deliberately wrong pagecode | `HousemaidLoans` | 401 | `API_NOT_FOUND_FOR_PAGE` | control, as designed |
| P7 | `advancesearchNew` with `expense.id` + `operation: "in"` | `ManageTransactions` | **500** | `For input string: "1693,1692,…"` | approach rejected |
| P8 | `advancesearchNew` with `expense.name` + `operation: "="` | `ManageTransactions` | **200** | — | yes |
| P9 | `GET /payroll/loans/getHousemaidLoans/132174` | `HousemaidsPayrollLoans` | **401** | `INSUFFICIENT_PERMISSIONS` | **NO — blocker** |

## The blocker, and why it is a permissions finding and not a pagecode bug

P6 exists precisely to separate the two 401 causes the spec warns about, and it
worked. The deliberately-wrong pagecode returned **`API_NOT_FOUND_FOR_PAGE`**.
The loans and transaction-detail routes returned **`INSUFFICIENT_PERMISSIONS`**.

Different shapes ⇒ **the pagecodes are correct and the account lacks the grant.**
`HousemaidsPayrollLoans` and `AddEditTransaction` are the right page codes; this
login is simply not permitted to call them.

**This is exactly the failure the process warns about.** The spec records both
routes as `Confirmed` against live ERP on **2026-08-20** — but that verification
was made on a **different login**. On the auditing account they are refused. A
permission recorded as working on a borrowed token stays recorded, and the gap
only surfaces when someone tries to run the check for real.

### Effect on the check

Both blocked routes are load-bearing, not evidential:

- **`/accounting/transactions/{id}`** is gate 2, identity resolution. The maid id
  exists **only** on this call (confirmed below). Without it there is no maid.
- **`/payroll/loans/getHousemaidLoans/{maidId}`** is gate 4, the entire recovery
  side of the comparison. Without it there is no "did the money come back".

With these refused, every case resolves to `pending` via gate 11
(`loans_call_unreadable` / `maid_unresolved`). **The check cannot produce a single
finding or a single clean.** This is a blocker, not a degradation — there is no
honest degraded path, because the degraded path is "no verdicts at all".

**What is needed:** read access for `hassan.ahmed@maids.cc` (or the audit service
account) to page codes **`AddEditTransaction`** and **`HousemaidsPayrollLoans`**.
Both are read-only routes.

## What the working surfaces confirm

### P1 — population (`ManageTransactions`), the headline result

`totalElements: 489`, `totalPages: 13`, for the window `2026-08-01 → 2026-08-19`.

**This reproduces the spec's recorded read of 2026-08-20 exactly** — same window,
same 489. The endpoint behaves identically ten days on.

Page-0 expense mix, five of the six live heads on one page:

| Expense id | Name | Rows |
|---|---|---|
| 1605 | NEW - CC Housemaids - ILOE Subscription | 27 |
| 1693 | NEW - MV Housemaids - ILOE Subscription | 6 |
| 1639 | RENEW - CC Housemaids - ILOE Subscription | 4 |
| 1727 | RENEW - MV Housemaids - ILOE Subscription | 2 |
| 1692 | NEW - MV Housemaids - ILOE Fines | 1 |

Other confirmations: `amount` numeric on every row; `date` is `YYYY-MM-DD` on every
row; `vatAmount` zero on every row (no VAT basis to choose — as the spec says);
`contractId` returns as an **empty string**.

### ✅ The spec's open call-budget question is now settled on live data

> **The search row carries no `housemaids` key — 0 of 40 rows.**

Verbatim row key set, read live:

```
amount, attachments, clientId, contractId, creationDate, date, description,
expense, fromBucket, fromBucketIsSecure, id, isDescriptionSecured, license,
paymentId, paymentType, pnlValueDate, previouslyUnknown, qashioTransactionId,
revenue, supplier, toBucket, toBucketIsSecure, transactionType, vatAmount, vatType
```

So the maid id is **not** available at population time, the "0 of 87 carry a
housemaid id" line was a warehouse observation, and the run costs the
**~1,519-call** figure, not the ~770 one. The architecture was already built for
this case, so nothing needs redesigning.

**Spec correction:** the recorded key list is missing five fields that are
actually returned — `fromBucketIsSecure`, `isDescriptionSecured`,
`previouslyUnknown`, `qashioTransactionId`, `toBucketIsSecure`.

### P7 — `operation: "in"` does not exist on this endpoint

`[{"property":"expense.id","operation":"in","value":"1693,1692,…"}]` returns
**500** with `For input string: "1693,1692,1605,1604,1727,1639"` — the server tried
to parse the whole CSV as one integer. There is no `in` operator here.

An exact-id population is therefore **six separate `=` queries**, not one. Since
P8 proves `expense.name` + `=` binds (208 rows for head 1693 alone in the same
window), the cheaper equivalent is what the build already does: one `like 'ILOE'`
sweep, then filter to the six known names client-side, routing anything
ILOE-shaped but unrecognised to `pending`.

### P5 — housemaid info (`HousemaidDetails`) works

Maid 121794 returns `nationality.name`, `status: WITH_CLIENT`,
`housemaidType: Normal` — matching the spec's recorded read exactly, and
confirming the corrected pagecode (`HousemaidDetails`, not the invented
`HousemaidInfo`) is right.

Note this surface is **only** used to test Afif's CC-nationality rule, never to
conclude. Ruling R1 is open and nationality does not separate the population.

## Pacing observed

Nine probes, serial, no rate-limit response. Jacky's standing 2.0 s pacing is
respected in the build; the probes themselves were well inside it.
