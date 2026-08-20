# ERP Lease — one audit at a time

**Workflow:** `9gVijqvtLVEhQZXz` · "ERP Lease · one audit at a time" (published 2026-08-20)
**Data table:** `erp_audit_lease` (`nje7kLNpRssRtzsf`), project `gxKXV4pckO4b4pQM`
**Policy:** `../ERP-LOAD-POLICY.md` §4

## Why this exists

Per-flow pacing bounds **one** flow to 4 req/s. It says nothing about **two**. VALIDATION §19
records two audits crashing in the same n8n instance within ten minutes — at the settings of the
time, 60 req/s arriving at ERP from a system that believed it was being careful. Every per-flow
limit is multiplied by however many audits are running, so the count has to be bounded somewhere,
and the only place that can see across flows is shared state.

It is a **cooperative** lease, not a mutex. Nothing physically stops a flow that skips the check
from calling ERP. What it stops is two flows that both use it colliding by accident — which is
the failure that actually happened. The failure mode was never malice; it was two people starting
audits ten minutes apart.

## Calling contract

Call it with the Execute Sub-workflow node.

```
mode:         'acquire' | 'release'    (required, no default — see below)
run_id:       this run's id            (required)
check_id:     which audit              (required)
ignore_lease: true to override         (optional, default false)
```

Returns:

```
{ lease, action, granted, state, holder_run_id, holder_check_id, verified,
  took_over_stale_lease, override_used, reason, run_id, check_id }
```

The row reported is the one read **back** after the write, not the one we meant to write.

`action` is one of `acquire` | `release` | `noop`. A refusal is **not** a return value — it
throws, so the calling run dies at the lease instead of proceeding past it.

**Acquire before the first ERP call. Release when the run ends, however it ends** — success rail
and error rail both. A release that never fires is what the 3-hour staleness rule cleans up
after, and cleaning up after it means a 3-hour hole in the queue.

There is no default `mode`: guessing `acquire` would block the queue, and guessing `release`
would free a lease held by someone else.

## It is not a mutex, and the read-back is why that matters

`Get Lease Row` → `Decide Lease` → `Write Lease` are three separate nodes, so **acquire is not
atomic**. Two audits starting within the same instant can both read `free`, both decide to
acquire, and both write — last write wins, and both proceed believing they are alone. That is
the exact state the lease exists to prevent, reached through the lease itself. n8n's Data Table
has no compare-and-swap, so the write cannot be made conditional on the row still reading free.

So the write is checked after the fact: **write, settle 1500 ms, read the row back, and refuse
if it does not name you.** Exactly one winner falls out of the store holding exactly one
`holder_run_id` — the two runs never have to agree with each other, only with the row.

The loser holds nothing and is told not to release anything. It could not damage the winner
anyway: a release from a non-holder is already a no-op by construction, a property built for a
different reason that pays for itself again here.

**1500 ms is measured, not chosen by taste.** `Get Lease Row` and `Write Lease` each complete in
~90 ms on this instance, so a competitor's whole read-decide-write span is well under 300 ms. It
is paid once per run, against an audit that takes 45–90 minutes.

**This narrows the race; it does not close it.** A competitor stalled longer than the settle
window is still missed. The honest guarantee is: *two audits starting more than about a second
apart cannot both proceed* — which covers the real failure mode, two people starting runs
minutes apart. Against simultaneous programmatic fan-out it is not sufficient, so if audits ever
get fired by a scheduler or a batch trigger, this needs revisiting.

**What not to reach for:** filtering the upsert on `state = 'free'` looks like a conditional
write, but n8n finds no match when the lease is held and **inserts a second row** instead, after
which `Get Lease Row` returns whichever comes back first. That turns a small race into a
nondeterministic one.

## The three ways a lease goes wrong

All three are handled in `nodes/decide_lease.js` rather than discovered later:

1. **A run crashes holding it** and every later audit is blocked for ever
   → a lease older than **3 hours** may be taken, and the takeover is logged and returned as
   `took_over_stale_lease: true`.
2. **Someone needs to override it right now**, at 2am, with no idea why it is stuck
   → `params.ignore_erp_lease: true`, logged loudly and carried into the run record, because the
   reason to reach for it (a stuck lease) is indistinguishable from the reason not to (another
   audit genuinely running).
3. **A run releases someone else's lease** and two audits proceed believing they are alone
   → release only ever frees a lease this `run_id` actually holds.

Case 3 is the dangerous one because it is **silent**: the other audit keeps running, the lease
reads free, and the next audit starts alongside it. Nothing downstream would report a problem.

### The bug this caught in itself

The first version of `Decide Lease` returned the standard payload for every action, so a no-op
release — the branch that exists *specifically* to protect another run's lease — wrote this run's
id into `holder_run_id`. The refusal message printed correctly and the write underneath it stole
the lease anyway. The offline suite caught it before it ever ran. That is why `_write: false` and
the explicit unchanged-row echo exist, and why the downstream upsert being unconditional is safe.

## Tests

`node offline/lease_test.js` — **29 assertions, all passing; 7 of 7 mutations of the read-back
caught.** Pure functions over the real node bodies; no n8n, no network.

The **lost-race branch is offline-only, and that is a limitation worth stating**: exercising it
live needs the row to change between `Write Lease` and `Verify Lease Row`, which no single
manual click can produce. The offline suite pins it — including that of two runs reading the
same row back, exactly one proceeds — but no execution id here proves it.

Live, against the real Data Table:

| exec | path | result |
|---|---|---|
| 95315 | run A acquires an unheld lease | granted, row created |
| 95318 | run B acquires while A holds | **refused** — run dies with the holder named |
| 95320 | run B releases A's lease | **no-op** — row written back unchanged, `state: held`, holder still A |
| 95321 | run A releases its own lease | freed, `state: free`, holder cleared |

Re-verified through the read-back after the hardening landed:

| exec | path | result |
|---|---|---|
| 95373 | run A acquires | `granted: true`, `verified: true`, settle measured at 1,507 ms |
| 95374 | run B releases A's lease | no-op, and the read-back still shows A holding it |
| 95375 | run A releases its own | `state: free`, holder cleared |

Row left `free` after 95375, so the table is in its reset state.

## Files

| file | node |
|---|---|
| `nodes/read_lease_request.js` | Read Lease Request — validates input, refuses a blank `run_id` |
| `nodes/decide_lease.js` | Decide Lease — the whole decision, the only file worth reading closely |
| `nodes/settle.js` | Settle — the 1500 ms pause before the read-back |
| `nodes/return_lease_result.js` | Return Lease Result — verifies the read-back, then answers the caller |
| `nodes/test_lease_call.js` | Test Lease Call — manual harness, inert by default |
| `offline/lease_test.js` | the suite |

Node bodies contain **zero backslash escapes**, deliberately, so they survive transmission
through the SDK without escaping damage. Keep it that way:
`cat nodes/*.js | tr -cd '\\' | wc -c` must print `0`.

## Not yet wired

No audit calls this yet. Wiring it into WF-A means adding an acquire before the first ERP call
and a release on **both** rails of a 67-node flow, and position is behaviour under
`executionOrder: v1` — so that change needs `tools/verify_order.py` re-run and a live smoke test,
which is not possible while the ERP accounts are deactivated. Until then the lease is built,
published, and proven; it is simply not yet in anyone's path.
