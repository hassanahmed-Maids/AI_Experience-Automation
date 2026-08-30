# Ruling: no webhooks, monthly schedule, Google Sheets output

**Date:** 2026-08-30 · **Source:** operator ruling
**Status:** recorded and reflected in the drafts. **The n8n conversions are NOT yet applied.**

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
