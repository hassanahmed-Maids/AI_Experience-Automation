# Change of Status Audit — production deployment request

Prepared 2026-09-01. Draft ticket body for the Jira deploy request, plus the
gate check that decides whether it can be raised yet.

---

## ⛔ Gate check — THREE gates are open

The spec sets these itself; they are not my additions.

| Gate | Where it is written | State |
|---|---|---|
| **`Test cases verified`** | Property description on the Checks database: *"Five real cases checked in the ERP by a human. **Flow cannot go live without this.**"* | **NO.** 2 of 6 re-pulled from ERP by the live runs; cases 3, 4 and 5 are not, and case 2 needs the `GET /visa/newRequest/{request_id}` that is refused. |
| **Independent review** | `Independent review required` = YES. Reviewer: Malaz, or whoever owns the Visa module's escalations. | **Not done.** This check can move a charge onto a maid's salary loan or raise a claim against a client. |
| **One clean full run on the current build** | Builder process, Phase 6 | **Not done.** The token expired before the final pass could run, so the **workbook append has never executed once**. |

**A deploy request can be drafted now. It should not be raised as "ready" until
at least the third closes**, because a delivery path that has never run once is
not a deployment risk you can size.

---

## Draft ticket

**Summary:** Deploy Change of Status Audit (road-map #58) to production n8n

**Type:** Task · **Module:** Visa · **Spec:** v0.7 · **Flow version:** v1.0 (degraded)

### What this is

A monthly audit that asks whether we paid the same government Change-of-Status
fee twice for the same maid. Nothing else in the company looks for this.
Measured exposure: **10 repeat pairs worth AED 7,771 since 2025-12-19**, about
AED 950 a month.

### What is being deployed

| | |
|---|---|
| Flow | `g87PqF93EtPnvKQ8` — *Change of Status Audit — generated v1* (Adeeb, 29 nodes) |
| Workbook | Google Sheet `1jBz1WkAtpbQ7RnyTs9nfCqD_pCmmthEEPZen2LwzQwM`, shared **Audits** folder |
| Data tables | `q8rNVmE91G5UKgIJ` (Cases), `ZjPcZPOYQdp0Egeq` (Runs) |
| Cloned from | `LDtsstXDfF99TnYe` — MV Overstay Fines generated v1 |
| Code + tests | `AI_Experience-Automation` @ `claude/erp-audit-flow-builder-lo2kzc`, `audit/change-of-status/` |

### Evidence

- **45 offline assertions, 0 failures**, covering every one of the spec's test
  cases and a guard for each `Never` the rules name.
- **Two live July-2026 runs, identical on every figure**: 704 charges over 18
  pages reconciled against `totalElements`; 1 finding, 105 pending, 0
  inconclusive, 598 clean.
- The single finding reproduces **spec test case 1** (80-day repeat) on maid id
  and both transaction ids; the one out-of-window pending reproduces **test case
  6** (140 days). Both from ERP, not the warehouse.
- Population agrees five ways with delta zero (two head-level probes, a combined
  probe, and both live runs) against the warehouse figure on the spec page.

### It delivers 7 of 21 rules, and why

Four ERP surfaces return **401 `INSUFFICIENT_PERMISSIONS`** on the operator's own
token — probed under multiple pagecodes, so this is access and not a pagecode
error:

```
GET /visa/overstay-fines/housemaid/{id}
GET /visa/newRequest/{id}
GET /visa/visaRequestExpenses/newRequest/{id}
GET /payroll/loans/getHousemaidLoans/{id}
```

Consequences, all declared on every run rather than absorbed:

- The **request grain** of rule ⓳ cannot run. It historically carries **23 of the
  repeat pairs (AED 16,954)**, including 4 at 591–965 days that the ninety-day
  window cannot catch, and it is the only way to detect a charge booked onto the
  **wrong maid's** request.
- **Orders 30–150** — fine sizing, recovery, waivers — cannot run at all, because
  Order 40 forbids deriving a fine by subtraction and the fines record is
  unreadable. A fine's *presence* is still detected; its size is not.
- Affected rows exit `pending`, capped and naming the refused surface. **No row
  reaches `clean` through a surface that was refused.**

### Asks

1. **Grant the four permissions above** to the account that will run the check —
   this is what turns 7 rules into 21.
2. **Decide the run identity.** The flow deliberately holds no ERP credential:
   the token is supplied per run so every read is logged under a real person.
   That means the **monthly trigger cannot fire on its own** — it is shipped
   **disabled**. Production needs either a dedicated audit service account, or an
   accepted manual monthly run.
3. **Confirm the delivery target** — the workbook is currently in the Audits
   folder under Hassan's account, readable by the Malaz credential the flow
   writes with.

### Pre-deploy checklist

- [ ] `Test cases verified` ticked by a human (spec: cannot go live without it)
- [ ] Independent review by Malaz
- [ ] One clean full run on the current build with a fresh token
- [ ] Detach the leftover `Hassan Bearer` credential from the four ERP nodes —
      inert today because `authentication` is `none`, but if anyone later flips a
      node to `genericCredentialType` it silently re-binds a shared token and the
      run stops being attributable
- [ ] Clear the test rows from both data tables and the three test drafts from
      Malaz's mailbox
- [ ] Rule on the **105 rows per run that reach states the spec has no verdict
      word for** (same gap as *Still open* item 8)
- [ ] Rule on *Still open* items 1 and 4

### Rollback

Unpublish the flow. It writes only to its own two data tables and its own
workbook, sends nothing (email is a **draft** to Malaz, never sent), and makes no
writes to ERP — every ERP call is a read.
