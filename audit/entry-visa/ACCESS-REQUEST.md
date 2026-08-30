# Entry Visa Audit — access needed to finish the build

Two grants, two different owners. Both are small. Together they unblock everything that is
currently stalled, and neither is a workaround for the other.

---

## 1. ERP pagecode grants — for `Hassan.Ahmed`

**Diagnosed, not guessed.** Three probe runs (23 read-only calls, 2026-08-30) established
that the token is valid and ERP refuses it at *authorization*, not authentication:

- A deliberately corrupted token returns `500 Invalid token signature` with no
  `developermessage` header.
- The real token returns `401` with `developermessage: INSUFFICIENT_PERMISSIONS`.
- Two different answers ⇒ ERP verifies the signature, accepts the identity, and refuses on
  rights. **A fresh token changes nothing.**

Full evidence: `PHASE-2-PROBE-RESULT.md`.

| pagecode | route | why the check needs it |
|---|---|---|
| `VisaProcessingPage` | `GET /visa/newRequest/{id}` | The core surface. Carries `expenses[]`, `taskHistorys[]`, `stopped`, `taskName`, `ownerId`. Gates 1, 3, 5, 6, 7, 8 all read it. **Without this there is no check.** |
| `AddEditTransaction` | `GET /accounting/transactions/{id}` | `transaction_date` — the only usable clock, since the expense line's own `paymentDate` is NULL on 85.7% of charge rows. Also carries the structured `housemaids[]` array gate 2 uses for identity. |
| `CancellationVisaProcessingPage` | cancel-request routes | Gate 4's cancel-side refunds. **243 refunds hang off the cancellation request** — without this they are invisible and 243 genuinely refunded cases become false findings against real people. |
| `ManageTransactions` | `POST /accounting/transactions/page/advancesearchNew` | The independent count for the Phase 7 population proof. Lowest priority of the four — the check runs without it, but its completeness guard does not. |

**Read-only.** The flow makes no writes to ERP, ever.

### Please also record who verified what

Several ERP Variables rows are marked `LIVE ERP READ, 2026-08-20` with verbatim payload
snippets, and two are `Confirmed` / `Verified` on that basis. Those reads were made on a
**different login**, and the same routes are refused on the account that would actually run
this check. That is not a criticism of the reads — it is that the rows do not say whose
account they were made on, so the next person cannot tell a real capability from someone
else's.

Adding a "read by which account" note to those rows would have saved this build 23
production ERP calls.

---

## 2. A Snowflake warehouse — for the same user

**Also diagnosed.** `CURRENT_WAREHOUSE()` returns empty and `CURRENT_DATABASE()` returns
empty for `hassan.ahmed@maids.cc` on role `PAYROLL_AND_MONEY_CONTROL_ROLE`.

The symptom is confusing enough to be worth writing down, because it does not look like a
permissions problem:

| Query | Works? | Why |
|---|---|---|
| `SELECT 1` | yes | no compute needed |
| `SELECT COUNT(*) FROM <view>` | yes | Snowflake answers from table metadata, no warehouse |
| `SHOW SCHEMAS` / `SHOW VIEWS` | yes | metadata |
| `GROUP BY`, `WHERE`, `SELECT *`, `INFORMATION_SCHEMA`, `RESULT_SCAN` | **no** | need real compute |

Every failure returns the same generic message — *"You must specify the warehouse… or set
the DEFAULT_NAMESPACE property"* — which reads like a client misconfiguration rather than a
missing grant, and masks genuine SQL errors behind it.

**The ask:** grant `USAGE` on a warehouse to `PAYROLL_AND_MONEY_CONTROL_ROLE`, and set a
`DEFAULT_WAREHOUSE` (and ideally `DEFAULT_NAMESPACE = BA_VIEWS`) on the user.

### Why this matters more than it looks

The Entry Visa Audit's population is a **warehouse read** — the spec says so, and every
population figure on the check page is Snowflake-derived. Two consequences:

1. **It is the only way to validate the scorer at scale.** The offline tests prove the
   scorer agrees with the spec on 7 hand-built cases. Reproducing the spec's own measured
   figures — 1,095 charges, 223 findings, AED 164,299.19 charged, AED 105,758.50
   recoverable — against the real 619,056-row `VISAREQUESTEXPENSES` view would prove it
   agrees with reality. That is the strongest correctness signal available, and it needs no
   ERP access at all.
2. **Gate 13 has no other data source.** The duplicate family runs on *every* entry-visa
   charge, rejected or not. Fed from ERP that is thousands of ID-scoped calls — not a
   slower run, an unrunnable one. It is affordable only as a warehouse query. See
   `SPEC-CORRECTIONS.md` §2.

The objects are confirmed present and readable at the metadata level:

| view | rows |
|---|---|
| `BA_VIEWS.VISA_SILVER.VISAREQUESTEXPENSES` | 619,056 |
| `BA_VIEWS.VISA_SILVER.CANCEL_VISA_REQUESTS` | 98,702 |

*(An earlier note in this repo said `VISA_SILVER` held only two views and that
`VISAREQUESTEXPENSES` was missing. That was wrong — the MCP connector returns only the
first partition of a paginated result, so a 50-view listing arrived as 2. Corrected here so
nobody acts on it.)*

**Usage would be ad hoc only** — this check is manual-trigger, and no recurring or
scheduled Snowflake query is part of the design. Recurring data processes go to the ERP/Data
team, per the standing policy.

---

## What is already done and waiting on these

- The deterministic scorer: all 15 gates, both case grains, pure. Green.
- 23 offline tests, 82 assertions, including all 7 of the spec's ERP-verified test cases.
  Test case 7 independently reproduces the SOP's AED 283.00.
- The Phase 2 probe: built, and hardened by three rounds of real refusals. It answers every
  open surface question in a single ~18-call run the moment the ERP grants land.
- Seven spec corrections filed with evidence.

Nothing has been run against production beyond the 23 diagnostic calls. No flow is
published, scheduled or activated.
