# Handover — Change of Status Audit

Built 2026-08-30 by the `erp-audit-flow-builder` process.
Operator / token identity: hassan.ahmed@maids.cc (`Hassan Bearer`).

## What exists

| Thing | Where |
|---|---|
| Flow (DRAFT, never published, never scheduled) | n8n `g87PqF93EtPnvKQ8` — *Change of Status Audit — generated v1*, Adeeb project |
| Case store | data table `q8rNVmE91G5UKgIJ` — *Change of Status — Cases* |
| Run log | data table `ZjPcZPOYQdp0Egeq` — *Change of Status — Runs* |
| Scorer + tests (canonical) | `audit/change-of-status/scorer/` |
| Surface probe evidence | `01-surface-probe.md` |
| Diff vs golden | `02-diff-vs-golden.md` |
| Spec corrections to file | `03-spec-corrections.md` |
| Test results | `04-test-results.md` |

Throwaway probe workflows to delete once the corrections are filed:
`GJxubuyT27j5FVr6`, `vnsyLedHRpUcyhri`, `Puff7xnNYLN2rVPt`.

## State of the flow

Test scaffolding has been **reverted and the revert verified** by reading the
workflow back. Both ERP nodes are `authentication: "none"` with the
`Authorization` header sourced from `params.erp_auth.bearer`, and
`Build Manual Run Context` carries no placeholder token.

The flow holds **no ERP credential of its own**: every read is logged under the
identity of the person who ran it, so findings that name real clients are
attributable to a real person.

**One residue to clear in the UI:** the `Hassan Bearer` credential reference
still sits on `Get Population` and `Get Trailing History`. It is inert while
`authentication` is `none`, but it should be removed so nobody later flips
authentication back on and silently re-binds a shared token.

## Guards added after the runaway test run (2026-08-30)

Three fixes, all applied to the flow, none yet exercised live:

1. **`ERP Budget Gate` restored** — two `size=1` counting calls read
   `totalElements` for both windows, project the page count, and **hard-fail**
   if it exceeds `params.erp_call_budget` (default 400). It counts CALLS, not
   entities, because a runaway paginated sweep multiplies just as effectively as
   a per-entity fan-out — which is the reasoning error that let the test run
   issue hundreds of requests.
2. **`Verify History Pull` added** — the history sweep was previously
   unreconciled. That was a **false-clearance hole**: if the sweep truncates, a
   maid's prior charge simply is not there, the row reads as `first charge` and
   exits **clean**. A duplicate cleared by a gap in the evidence. `Score Cases`
   refused an *empty* history, but empty is the easy case — a merely SHORT
   history looks exactly like a clean month.
3. **`maxRequests` lowered** from 400 to tripwires just above the real
   requirement: 40 for the population (July needs 18, the largest measured month
   needs 26) and 260 for the history (400 days needs ~210).

## How to run it

Manual: it defaults to the month just ended, but still needs a token —
`params.erp_auth.bearer` must be supplied (`"Bearer <token>"`).
Webhook: `POST https://sami-team.app.n8n.cloud/webhook/cos-audit-run` with header
`x-sr-webhook-secret`, and a body carrying `check_id`, `run_id`, `audit_window`
and `params.erp_auth.bearer`.

Do **not** pass `ignore_erp_lease: true` — that bypasses the lease that stops two
audits hitting ERP at once.

## What still needs a human

1. **Sign-off before any production run, and before publishing or scheduling.**
   Not given. The spec names an independent reviewer — Malaz, or whoever owns the
   Visa module's escalations — and marks `Independent review required` YES. This
   check can move a charge onto a maid's salary loan or raise a claim against a
   client; build completion is not approval.
2. **The permission grant.** Four ERP surfaces are refused on the operator's
   token (see below). Until they are granted, this is the duplicate check only.
3. **Two business rulings that are still open and that this build had to assume
   around:**
   - *Still open* item 4 — where the duplicate window sits. This build routes the
     91–365 band to `pending` rather than clearing it, because the request grain
     that would settle it is refused. A ruling changes that band's disposition.
   - *Still open* item 1 — whether the inherited fine-recovery rules stay tagged.
     The permission gap answers it by force for now; the ruling still matters for
     when access is granted.
4. **Filing the spec corrections** in `03-spec-corrections.md` back to Notion.
   Not done — those pages belong to Jacky and Malaz.

## Declared gaps — what this check does NOT do

| Gap | Effect on the numbers |
|---|---|
| Request grain of rule ⓳ (`/visa/newRequest/{id}` refused) | Historically carries **23 of the repeat pairs (AED 16,954)**, including 4 at 591–965 days the ninety-day window cannot catch. Also makes the charge-on-the-wrong-maid's-request shape (5 of 23) undetectable. |
| Orders 30–150 — fine sizing, recovery, waivers (`/visa/overstay-fines`, `/payroll/loans` refused) | A fine's **presence** is still detected (amount > era base) but it cannot be sized or its recovery checked. Those rows exit `pending`, capped and named — never clean, never a finding. |
| Over-365 repeats | Cleared as expected visa cycles, and **counted** in the run summary. Historically 4 of 117 such pairs shared one visa request; those are undetectable without visa access. |
| Trailing history is a 400-day sweep, not all-time | A repeat whose prior charge is older than the window reads as a first charge. Consistent with the over-365 band being legitimate, but it is a bound, not a proof. |
| Live end-to-end run | **Completed twice**, identical results — see `04-test-results.md` §3. |

## Population proof

July 2026, now **five** independent reads agreeing, delta zero:

| Read | totalElements |
|---|---|
| probe: head `1677` alone | 646 |
| probe: head `1589` alone | 58 |
| probe: both heads via `operation: "in"` | **704** |
| live run 110429 | **704** walked, 18 pages, reconciled |
| live run 110690 | **704** walked, 18 pages, reconciled |

646 + 58 = 704, and the spec's own warehouse table gives July = 704. The two live
runs also agree with each other on **every** scored figure — 1 finding, 105
pending, 0 inconclusive, 598 clean — which is a determinism proof, not a repeat.

## The findings reproduce the spec's test cases

The single finding matches the spec's **test case 1** (80-day repeat) on maid id
and both transaction ids; the one out-of-window pending matches **test case 6**
(140 days) the same way. The spec keeps `Test cases verified` unticked pending an
ERP re-pull — these runs are that re-pull for two of the six.

## Could any clearance in here be wrong?

The three ways a row reaches `clean`, and what backs each:

1. **`amount == era base`, no repeat within 90 days.** Sound as far as it goes.
   What it does not prove is that no *fine* was owed — Order 20 only says a fine
   exists when the amount exceeds the base, which is the spec's own rule.
2. **A repeat more than 365 days apart.** Cleared deliberately, per the variable
   row calling that band legitimate business behaviour. This is the weakest
   clearance in the check and it is declared and counted, not silent.
3. **A row whose prior charge falls outside the 400-day history sweep.**
   Reads as a first charge. Same exposure as (2).

Everything else that could not be examined exits `pending` or `inconclusive`.
No row reaches `clean` through a surface that was refused — that was the single
governing constraint of the degraded build, and the `dedup_eligible` fix in the
scorer exists because the first version violated it.
