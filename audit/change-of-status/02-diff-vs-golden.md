# Phase 7 — field-level diff versus the golden

Golden: `MV Overstay Fines — generated v1` (`LDtsstXDfF99TnYe`), 81 nodes.
Built:  `Change of Status Audit — generated v1` (`g87PqF93EtPnvKQ8`), 18 nodes.

The built flow is deliberately much smaller than the golden, and the reason is
the Phase 2 probe rather than a decision to cut corners: the golden's size comes
almost entirely from per-entity enrichment and evidence lanes that this check no
longer needs, because the fields arrive inline and the evidence surfaces are
refused.

## Nodes kept, and why

| Golden node | Here | Change |
|---|---|---|
| `Validate Inputs` | `Validate Inputs` | Kept whole, including the callback-origin allowlist, the checked webhook secret, the bearer shape check and the no-`URL`-constructor guard. Added: `history_days`, and `callback_url` made optional (this check delivers a workbook and a Gmail draft, not a portal callback). |
| `Acquire ERP Lease` / `Release ERP Lease` / `Release Lease (error)` | same three | Kept, `check_id` changed to `change-of-status`. |
| `Verify Cohort Pull` | `Verify Population Pull` | Kept whole: the pagination/population/empty triad, the ERP-error-body throw, the `totalElements` reconciliation and the never-lower-the-floor rule. |
| `Build Run Row` / `Write Run` / `Build Case Rows` / `Write Cases` | same four | Kept, retargeted to the two new data tables. Runs row still written **before** the case payload. |
| `On Workflow Crash` | same | Kept. |

## Nodes dropped, each with its reason

| Golden node | Dropped because |
|---|---|
| `Get Transaction Detail` + `Judge Detail Batch` | The maid id, purpose, amount, date, VAT and contract all arrive **inline** on the list response (probed 40/40 rows). The enrichment call is unnecessary — and is refused on the operator token anyway. |
| `Get Overstay Fines` + `Attach Fines` + `Judge Fines Batch` | `/visa/overstay-fines/housemaid/{id}` → 401 INSUFFICIENT_PERMISSIONS. |
| `Get Overstay Payments` + `Attach Payments` + `Judge Payments Batch` | The MV recovery leg is reachable (200) but useless without the fines record to compare against — Order 40 forbids deriving the expected side by subtraction. |
| `Get Maid Complaints` / `Get Complaint Thread` / `Split Relevant Complaints` / `Attach Threads` / `Build Evidence Bundle` | Both readable (200), but they exist to evidence **waivers on fines**, and fines cannot be sized. Nothing for the evidence lane to evidence. |
| `Verify Red Flags` (AI agent) + `Anthropic Chat Model` + `Verdict Schema` + `Merge Agent Verdicts` + verdict tables | The verifier layer's two jobs are waivers and identity. Waivers are blocked; identity has **zero cases** in the live population (maid id present on all 6,000 rows). No model call has anything to decide. |
| `ERP Budget Gate` | The gate exists to stop a per-entity fan-out multiplying by population. There is no per-entity fan-out left: the run is two paginated sweeps. Kept as a documented non-need rather than dead code. |
| `Callback — Results` / `Callback — Error` / `Respond 200` / `Respond 400` | Portal delivery is **not ticked** on this check (*Still open* item 1), and `check_id` is deliberately empty rather than invented. The webhook path still validates identically. |

## Field-level diff inside the population request

| Field | Golden | Here | Why |
|---|---|---|---|
| route | `/accounting/transactions/page/advancesearchNew` | `/accounting/transactions/page/advancesearch` | `advancesearchNew` does not return the `housemaids` link (45 key paths vs 157). Using it would force a per-row call that is also refused. |
| expense filter | `expense.name = "NEW - MV Housemaids…"` with `alternatives: ["expense.code"]` | `expense.id in [1677, 1589]` | Probed: `operation: "in"` returns **200**, contradicting the spec's "fails outright". One sweep covers both heads. Filtering on the id also avoids depending on a display name that was renamed on 2025-12-19. |
| `size` | 200 | **40** | Rule ❶ (Order 5): "walked at `size=40` so offsets stay contiguous". |
| `completeExpression` | `< 200` | `< 40` | Follows the page size. |
| `maxRequests` | 50 | 400 | The history sweep is up to ~225 pages at 40/page. 50 would silently truncate it — and a truncated history is a *false clearance*, since an unseen prior charge reads as "first charge". |
| auth | stored credential `ERP Token 12th Aug 2026` | `Authorization` header from `params.erp_auth.bearer` | The flow holds no ERP credential of its own. |
| retained row | full ERP row | slim projection, **description reduced to a boolean** | The description carries the maid's name and passport number verbatim. Nothing downstream needs either, so neither is retained in execution data or written to the case store. |

## Row counts produced

| Stage | Golden (Aug 2026, head 1677) | Here (July 2026, both heads) |
|---|---|---|
| population rows | 151 | **704** (646 + 58, reconciled three ways) |
| pages walked | 8 at size 20 / 1 at size 200 | 18 at size 40 |
| per-entity ERP calls | 12 × N | **0** |
