# R-Visa Audit — production deployment request

Paste-ready body for the Jira ticket. Prepared 2026-09-01.

---

## Summary

Deploy the **R-Visa Audit** check (roadmap #52, spec v0.6) to the production n8n
instance. Three workflows plus two data tables. Manual trigger only — nothing
scheduled, nothing published, no ERP credential stored on any of them.

The check asks whether we paid a residence-visa fee we should not have: a second
fee with no cancellation behind it, an overstay fine the dates cannot support, or
a fine nobody was made to repay.

## What to deploy

| Workflow | Staging id | Role |
|---|---|---|
| R-Visa Audit · 1-Run | `2yJCYs1YUZz7BVDG` | The check — 23 nodes |
| R-Visa Audit · 0-Sweep Head | `4Fn3xvQDPMVucq0I` | Paginated sweep of one expense head |
| R-Visa Audit · 0-Resolve Identity | `j3jHiOtkAOOLTe3o` | Maid-id resolution for one chunk |

| Data table | Staging id |
|---|---|
| R-Visa Audit — Cases | `850KgI3ms4Zw9T7L` |
| R-Visa Audit — Runs | `AYSssg596CcIXtpp` |

## ⚠️ Re-pointing required — these ids do not travel

An export carries the *values* of these references, not their meaning. Every one
must be re-pointed at the production equivalent or the flow fails at that node.

| Node | Currently points at | Action |
|---|---|---|
| `Sweep Heads` | workflow `4Fn3xvQDPMVucq0I` | re-point to the deployed *0-Sweep Head* |
| `Resolve Identity` | workflow `j3jHiOtkAOOLTe3o` | re-point to the deployed *0-Resolve Identity* |
| `Write Run (data table)` | table `AYSssg596CcIXtpp` | re-point to the production *Runs* table |
| `Write Cases (data table)` | table `850KgI3ms4Zw9T7L` | re-point to the production *Cases* table |
| `Draft: cases to review` | Gmail credential `HWLDCw7k30SwXenp` | re-point to the production Gmail credential |

Both data tables must be **created with identical column names** before first
run: the two write nodes use `autoMapInputData`, so a renamed or missing column
is dropped silently rather than erroring. Schemas are in
`audit/r_visa/BUILD-NOTES.md`.

## Manual step the API cannot do

**The webhook has no authentication of its own.** n8n's API cannot attach a
credential to a webhook node, so this needs a UI click on the production
instance: add an `httpHeaderAuth` credential to the `Run Webhook` node.

Scope of the exposure without it, stated honestly: the flow is **self-limiting**,
because every ERP read uses a token the caller supplies. Without a valid token
the run is rejected at `Validate Inputs` and returns 400 before any ERP call or
any table write. So an unauthenticated caller cannot read ERP data or write a
case row. What they *could* do is trigger executions. Worth closing, not worth
blocking the deploy over.

## Decisions the deploying team should take deliberately

**1. The ERP lease was removed.** The staging build called a shared
*ERP Lease · one audit at a time* sub-workflow before its first ERP call. That is
an instance-local id that would not resolve in production, so it is gone.

Consequence: per-node pacing (batch size and interval) and the pre-flight budget
gate both remain, so a *single* run is still bounded — but **nothing now prevents
two audits hitting ERP concurrently**. If production has its own lease workflow,
re-introduce it: acquire before `Build Head Plan`, release on both branches out
of `Any Reds?` and after `Capture Failure`.

**2. Execution data retains the bearer token.** The token arrives in the webhook
payload, so it is visible in every stored execution to anyone with read access to
the project. The golden checks accept this; tokens are short-lived (hours). If
production needs tighter handling, set `saveDataSuccessExecution` to `none` — at
the cost of losing the run's own audit trail.

**3. Test rows exist in the staging tables.** Run ids `r-visa-PINNED-TEST-2026-08-31`,
`r-visa-PINNED-A-happy`, `r-visa-PINNED-B-blocked` and `r-visa-PINNED-C-noleases`.
Do not migrate them.

## How it is run

`POST` to the webhook with:

```json
{
  "erp_auth": { "bearer": "Bearer <the operator's own ERP JWT>", "device": "<numeric device id>" },
  "params": {
    "window_from": "2026-08-01",
    "window_to": "2026-08-31",
    "entry_visa_expense_names": []
  }
}
```

**The token must belong to the person running the check.** ERP logs every read
under the token's identity, and this check produces findings naming real clients
and real money. The spec names **Malaz** as the independent reviewer — so the
check must not run on his token, or the reviewer becomes an actor in the evidence
he has to review. A placeholder is refused at `Validate Inputs` before any ERP
call (added 2026-09-01 after a fixture token reached ERP and made 14 rejected
reads).

Defaults: reporting window is the previous full calendar month; the sweep is
**all-time** regardless, because a case is every payment a maid has ever had.

## State at handover — read before scheduling a first run

**Tested:** 131 offline assertions (91 on the rules, 40 on the glue running the
exact deployed node body) plus two end-to-end runs of the deployed flow against
pinned fixtures, covering the happy path and the blocked-identity path.

**NOT tested:** the paginated sweep against real ERP. Pinning supplies the
sweep's *output*, so the pagination loop, the completion expression, the
60-request cap and the `pulled == totalElements` reconciliation have never run
against a real paginated response. The spec's own pre-run requirement — walk one
month against ERP with `pulled == totalElements` asserted — is still outstanding.

**Treat the first production run as that walk**: supervised, one month, output
checked, not as a validated run.

## Known limitations shipped deliberately

Each is declared on every run row and every case row, not hidden:

| Rule | Limitation |
|---|---|
| ⓫ | `GET /accounting/transactions/{id}` is refused with `INSUFFICIENT_PERMISSIONS` on the auditing account, so identity is unresolvable and **no red can fire**. Fixing this is the single highest-value change — better still, adding the housemaid id to the transaction list payload, which also cuts the call cost from ~48,000 to ~241. |
| ❼ / ❽ | No entry-visa expense head established, so the fine gates are suppressed rather than clocked from a guessed anchor. |
| ⓬ / verifier ❸ | **Unbuildable.** R-visa has no rejection-status or refund-request field in ERP at all (confirmed via the low-code platform, 2026-09-01). |
| ❻ | Issued validity is readable; the purchased 1y/2y term appears not to be stored anywhere. |
| ⓫ recall | Identity is scoped by `contractId`, so a maid whose two payments sit on different contracts is not examined for a duplicate. |

## Sign-off required before findings are delivered

This is a **money-out** check and the spec requires independent review before
delivery. Reviewer: **Malaz**. Build completion is not approval, and the delivery
node creates a Gmail **draft** — nothing is sent automatically.
