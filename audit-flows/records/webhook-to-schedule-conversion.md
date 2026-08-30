# Ruling: no webhooks, monthly schedule, Google Sheets output

**Date:** 2026-08-30 · **Source:** operator ruling
**Status:** Dummy Tickets unpublished. **Wellcare converted.** The other five are specified below
but **NOT applied** — two findings below say why, and both are load-bearing.

## The rule

1. **No webhooks — in either direction.** No inbound webhook trigger, and no outbound callback to
   the Security Room or anywhere else. This supersedes the 2026-08-30 note that the Security Room
   allowlist merely had nothing calling it: the wiring goes, not just the traffic.
2. **Everything runs on a monthly schedule** (for now).
3. **Results are posted to Google Sheets.** The workbook is the delivery mechanism, not a callback
   and not an e-mail body.

This makes every audit flow match the shape `VPMGOV-1633` already describes for Travel Assist:
*"No webhook, no manual trigger, no inbound endpoint of any kind."*

## What each flow needs

Measured node-by-node from the live workflow JSON on 2026-08-30.

| Flow | Trigger today | Callbacks out | Sheets nodes | Conversion |
|---|---|---|---|---|
| **Dummy Tickets** `aTmGMAlYLwsJQ7js` | `Webhook` + 2 respond | 3 | 3 ✓ | swap trigger → schedule; delete 3 callbacks + 2 respond nodes; **unpublish first — it is live** |
| **Applicant Real Ticket** `YXRZdtk2Geeeqaal` | `Run (webhook)` + 2 respond | 0 | **0 ✗** | swap trigger; delete respond nodes; **build the Sheets output — new work, see below** |
| **Wellcare** `7HYpRKJQnH5C7jkj` | none | 0 | 3 ✓ | **add** a schedule trigger — that is all |
| **CC Overstay Fines** `3465kkSf4JYjlpXk` | none | 2 | 4 ✓ | add a schedule trigger; delete 2 callbacks |
| **MV Overstay Fines** `LDtsstXDfF99TnYe` | `Webhook` + 2 respond | 3 | 3 ✓ | swap trigger; delete 3 callbacks + 2 respond nodes |
| **MV Monthly Payment** Stage 1 `IKRXhIco1mwxrcPq` | `Run Check` webhook | 0 | 0 | swap the chain's entry trigger → schedule |
| **MV Monthly Payment** Stage 3 `Z9fTvmaM526eYofe` | `Rollup In` webhook | 0 | 0 | delete the rollup webhook entry entirely |
| **Terminated HM** `sXsn4NUYt4kh3OAU` *(not in the deploy six)* | `Webhook` + 2 respond | 3 | 2 ✓ | same treatment when its turn comes |

### The one that is not a swap

**Applicant Real Ticket has zero Google Sheets nodes.** Its results currently live only in its five
Data Tables — there is no callback either, so today nothing leaves the flow. "Results are posted to
Google Sheets" is therefore **new build work** on this check, not a rewiring. It needs:

- the `Hassan Maids Account` credential wired,
- Cases / Run Summary / Verdicts writes matching the sibling checks' layout,
- the existing workbook (already linked on its Notion row) as the target.

Everything else in the table is deletion plus one trigger swap.

### Deleting the rollup entry has a cost worth stating

MV Monthly Payment Stage 3's `Rollup In` webhook exists for a real reason, recorded in its own
sticky: *a run can die mid-slice and everything already scored would otherwise be unreportable,*
because Stage 1 is the only other way in and it always sweeps the ERP first. Removing the webhook
removes that recovery path. The replacement is a **manual execution of Stage 3** for a dead run —
acceptable, but it should be a stated fallback rather than a capability that silently disappears.

## Proposed schedule

Follow the Travel Assist precedent unless told otherwise:

- **Monthly, on the 15th at 06:00 Asia/Dubai**
- each run audits the **previous full calendar month**
- the two-week lag is deliberate — payments need time to settle

⚠ Four of the flows have **no workflow timezone set** (Applicant Real Ticket, Wellcare, CC Overstay
Fines, MV Overstay Fines). A monthly schedule with no timezone is ambiguous about which month a
boundary transaction falls in, so `Asia/Dubai` must be set explicitly on each as part of the
conversion.

## What this changes about the Security Room

The 2026-08-30 finding was that the ruling *"nothing delivers to the Security Room"* held in
practice but not in capability — the allowlist and callback nodes were still wired and Dummy Tickets
was published. **This ruling closes that properly:** the callback nodes are deleted, so there is no
capability left to constrain, and the `CALLBACK_ORIGIN_ALLOWLIST` constants become dead code that
should go with them.

The webhook-secret slots held inline in Code node bodies also become moot once the webhook triggers
are gone — which resolves the open hygiene item recorded in `security-room-delivery.md` by deletion
rather than by migration to a credential.

## Before applying

Two things need a decision, and one needs design:

1. **The schedule** — 15th at 06:00 Asia/Dubai, or something else?
2. **Dummy Tickets is published.** It should be unpublished before its trigger is rewired, rather
   than edited live.
3. **Applicant Real Ticket's Sheets output** needs its column layout agreed before it is built.


---

# Applied 2026-08-30

## Done

- **`aTmGMAlYLwsJQ7js` Dummy Tickets — unpublished.** No longer live; safe to rewire.
- **`7HYpRKJQnH5C7jkj` Wellcare — converted.** Added `Run Monthly` (schedule trigger, monthly, 15th,
  06:00) feeding the same `Manual Run Config` node the manual trigger feeds, and set the workflow
  timezone to `Asia/Dubai`. 37 → 38 nodes. This was the safe one: **a pure addition**, nothing
  deleted, nothing rewired. The manual trigger stays as a re-run path.

## Finding 1 — the other five are not deletions, they are bridges

The callback and respond nodes are **mid-chain, not leaves**. Deleting them naively severs the main
execution path. Measured from the live graph:

| Flow | Node | Feeds | Consequence of a naive delete |
|---|---|---|---|
| Dummy Tickets | `Respond 200` | → `Acquire ERP Lease` | **the whole run chain is severed** |
| Dummy Tickets | `Callback — Runs Log` | → `Build Case Payload` | scoring path severed |
| Dummy Tickets | `Callback — Results` | → `Build Sheet Rows`, `Build Summary Row` | **the Sheets writes are downstream of the callback** — deleting it removes the very delivery the ruling requires |
| MV Overstay | `Respond 200` | → `Acquire ERP Lease` | run chain severed |
| MV Overstay | `Respond 400` | → `Alert on rejection?` | rejection alerting severed |
| MV Overstay | `Callback — Results` | → `Capture Failure` | failure capture severed |
| MV Overstay | `Callback: Agent Review` | → `Format Agent Review Email` | verifier e-mail severed |
| CC Overstay | `Callback — Results`, `Callback — Error` | → nothing | ✅ genuine leaves, safe to delete |

So each removal is **`removeNode` + `addConnection(predecessor → successor)`** to bridge the gap, and
the bridge has to be right or the flow silently loses a branch. Only CC Overstay Fines' two callbacks
are true leaves.

The `Callback — Results` case on Dummy Tickets is the one to look at twice: the Google Sheets writes
sit *downstream of the callback node*. The delivery path the ruling mandates currently hangs off the
delivery path the ruling forbids.

## Finding 2 — a monthly schedule cannot work with a 24-hour token

**This is the blocker for the whole architecture, not a per-flow detail.**

ERP tokens last **24 hours** — stated in Wellcare's own run-config node, which throws rather than run
without one. Four of the six flows take the token **per run**, from the webhook payload or from
`$vars.ERP_BEARER`:

| Flow | ERP token source |
|---|---|
| Wellcare | `$vars.ERP_BEARER` (workflow variable) |
| Dummy Tickets | `$vars.ERP_BEARER` + request payload |
| Applicant Real Ticket | request payload |
| MV Monthly Payment Stage 1 | request payload |
| MV Overstay Fines | **mixed** — stored credential *and* payload |
| CC Overstay Fines | stored credential only ✅ |

A monthly run has no valid token on 29 days out of 30. Removing the webhook removes the mechanism
that was *supplying* the token, so the conversion actively makes this worse.

**Travel Assist — the one audit flow already scheduled monthly and submitted to Jira — uses a stored
credential (`ERP Hassan Prod`, HTTP Custom Auth) on all 14 of its ERP nodes.** That is the working
pattern, and it is why the deployment ticket's *"the deploying team creates the ERP credential with a
production token"* line is load-bearing rather than administrative.

**So the skeleton rule needs a fourth element:** a **stored ERP credential**, never a per-run token.
Written into the builder skill alongside the schedule/no-webhook/Sheets rules.

## Finding 3 — two flows carry doctrine that contradicts the ruling

Wellcare and Dummy Tickets both state in code: *"MANUAL TRIGGER ONLY: never scheduled, never on a
cron. Recurring data processes go through the ERP/Data team."*

That doctrine is **superseded**, and the distinction matters: the ERP/Data-team routing rule governs
**Snowflake/warehouse** processes. These flows read the ERP API and write their own workbook. Travel
Assist is already scheduled monthly on the same pattern. Wellcare's node has been updated to say so;
Dummy Tickets' has not yet.

## What is left, and what it needs

1. **A decision on the ERP credential** — nothing scheduled runs without it. This is the first domino.
2. **The four bridged conversions** (Dummy Tickets, MV Overstay, Applicant, MV Monthly Payment
   Stages 1+3), each `removeNode` + a verified bridge.
3. **CC Overstay Fines** — the easy one after Wellcare: add a trigger, delete two true-leaf callbacks.
4. **Applicant Real Ticket's Sheets output** — still new build work, unchanged by any of the above.
5. **An end-to-end test per flow.** The builder skill's Phase 6 requires it, and it cannot run without
   a token — which is finding 2 again. Converting without testing is exactly what the skill's phase
   order exists to prevent.
