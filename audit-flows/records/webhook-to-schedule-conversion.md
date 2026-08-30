# Ruling: no webhooks, monthly schedule, Google Sheets output

**Date:** 2026-08-30 · **Source:** operator ruling
**Status:** Dummy Tickets unpublished. **Wellcare and CC Overstay Fines converted.** The other four
are specified below but **NOT applied** — two findings below say why, and both are load-bearing.

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

- **`3465kkSf4JYjlpXk` CC Overstay Fines — converted.** Added `Run Monthly` feeding the same
  `Build Run Context` node as the manual trigger; deleted `Callback — Results` and `Callback — Error`
  (both verified true leaves — the four Google Sheets writes hang off `Build Case Rows` /
  `Build Verdict Rows` / `Build Run Row`, an independent branch, and were untouched); set the
  timezone. 68 → 67 nodes.

  Three things the conversion turned up inside the flow:

  - **The run window was two hand-edited constants**, `2026-05-01`..`2026-08-31` — a four-month
    range a monthly schedule would have re-audited forever. Replaced with a computed previous full
    calendar month, with `OVERRIDE_FROM`/`OVERRIDE_TO` for a deliberate one-off. The helper was
    unit-tested across year rollover, leap February and 30-day months before it was applied.
  - **`delivery.workbook` was declared `false`**, with the note *"produced outside the flow from the
    Cases table"* — which stopped being true when the flow gained its four Google Sheets nodes. The
    declaration now matches the wiring, which is what the ruling requires it to say.
  - **`run_id` was hard-prefixed `manual-` and `trigger` hard-set `'manual'`.** Both now record
    whether the window was pinned or scheduled. Checked first that nothing branches on either — they
    are written into run rows and never tested.

  Left behind deliberately: `Build Case Payload` → `Portal Delivery Declared?` is now a dead chain
  (it only ever fed the deleted callback). Harmless — it computes and stops — and noted in the node
  for a tidy-up pass rather than removed on judgement.

  **Read back and diffed after applying:** 67 nodes, no webhook nodes, no callback nodes, both
  triggers feeding `Build Run Context`, zero stale references to the deleted nodes, `jsCode`
  byte-identical to what was intended.

## Finding 1 — the remaining four are not deletions, they are bridges

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
| CC Overstay | `Callback — Results`, `Callback — Error` | → nothing | ✅ genuine leaves — **deleted 2026-08-30** |

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
   CC Overstay Fines is the closest to ready: it already uses a stored credential, so it needs a
   production token in place of `ERP Token 12th Aug 2026` and nothing else.
2. **The four bridged conversions** (Dummy Tickets, MV Overstay, Applicant, MV Monthly Payment
   Stages 1+3), each `removeNode` + a verified bridge.
4. **Applicant Real Ticket's Sheets output** — still new build work, unchanged by any of the above.
5. **An end-to-end test per flow.** The builder skill's Phase 6 requires it, and it cannot run without
   a token — which is finding 2 again. Converting without testing is exactly what the skill's phase
   order exists to prevent.


---

# Addendum 2026-08-30 — ERP lease nodes do not ship

Ruling: the production version carries no ERP lease nodes. They exist to serialise ERP access while
checks are run by hand, and production runs on a schedule, one flow at a time.

**Implemented as an export-time strip, not a workflow edit** — see `../jira/README.md`. Deleting
them from staging would remove the protection that testing depends on; the 2026-08-19 `clientmgmt`
503 is the incident the leases exist to prevent.

| Flow | staging | prod export | bridges |
|---|---:|---:|---|
| Wellcare | 37 | 37 | none — **no lease nodes at all** |
| MV Stage 1 | 18 | 15 | `Validate Run Input -> Build Cohort Counts`, `Capture Failure -> Fail Loudly` |
| Terminated HM | 52 | 49 | `Respond 200 -> Get FT29 Transactions`, `Capture Failure -> Fail Loudly` |
| Dummy Tickets | 53 | 50 | `Respond 200 -> Get Dummy Ticket Transactions`, `Capture Failure -> Fail Loudly` |
| Applicant Real Ticket | 63 | 60 | `Respond 200 (accepted) -> Get Independent Count`, `Capture Failure -> Fail Loudly` |
| CC Overstay Fines | 67 | 64 | `Build Run Context -> Get CC Change of Status Transactions`, `Build Error Callback -> Fail Loudly` |
| MV Overstay Fines | 80 | 77 | `Webhook Run? -> …`, `Respond 200 -> …`, `Capture Failure -> Build Error Callback` |

Note what the bridges are: in every single flow the lease sits **between the entry and the first ERP
call**, and the error-side lease sits **between the failure capture and `Fail Loudly`**. A naive
delete would sever the main path *and* silence the error path — which is why this is a script with a
reachability assertion rather than a hand edit.

**Ordering note.** The four flows still awaiting the webhook→schedule conversion will change their
entry node, and the `Respond 200 -> …` bridges above will become `<new schedule entry> -> …`. Re-run
the strip after converting, not before; its output is derived, never stored.
