# ERP Lease — one audit at a time

**Workflow:** `9gVijqvtLVEhQZXz` · "ERP Lease · one audit at a time" (published 2026-08-20)
**Data tables:** `erp_audit_lease` (`nje7kLNpRssRtzsf`) and `erp_audit_queue` (`7BmoYNaqNL8lVu2q`),
project `gxKXV4pckO4b4pQM`
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
ignore_lease: true to override         (optional, default false — jumps the queue)
max_wait_ms:  how long to queue        (optional, default 20 min)
```

Returns:

```
{ lease, action, granted, state, holder_run_id, holder_check_id, verified,
  took_over_stale_lease, override_used, reason, run_id, check_id }
```

The row reported is the one read **back** after the write, not the one we meant to write.

`action` is one of `acquire` | `release` | `noop`. **A blocked run does not return and does not
throw — it queues**, polling every 60 seconds until it reaches the head, then returns granted. The
call is therefore slow rather than fatal, and the caller needs no retry logic of its own.

It throws only when waiting has become pointless: the queue timed out, or the caller asked
something unanswerable.

### The lease spans a whole run, not a call

Acquire before the *first* ERP call, release at the *end of the run*. Everything between — sweeps,
per-entity enrichment, verification, delivery, and every sub-workflow, since those execute inside
the caller's execution — is inside the lease. Leasing per call would be pointless: §1 pacing
already governs rate; the lease governs how many audits, which only means anything across a run.

**That sets the queue's scale.** A holder keeps the lease for **45–90 minutes**, so the 20-minute
default wait would time out almost every queued run — the queue would exist and never once
succeed. MV Monthly Payment therefore passes `max_wait_ms: 45 min` explicitly, overridable per run
with `erp_lease_max_wait_ms`. **Any caller that runs long must pass its own.**

45 rather than 90 is deliberate: a queued run still has to *finish* inside its own ERP session
(~4 hours, and every token dies at 22:00 UTC), so waiting 90 minutes only to need another 90 is
how a run reaches the front holding a token too short to use.

**Acquire before the first ERP call. Release when the run ends, however it ends** — success rail
and error rail both. A release that never fires is what the 3-hour staleness rule cleans up
after, and cleaning up after it means a 3-hour hole in the queue.

There is no default `mode`: guessing `acquire` would block the queue, and guessing `release`
would free a lease held by someone else.

## It queues rather than refuses

The first version threw at a held lease. That was correct and useless: the honest response to
"someone else is using ERP" is to wait, not to make a person notice and re-fire by hand twenty
minutes later. A blocked run now takes a **ticket** and polls every 60 s until it is at the head.

**A ticket, not just a retry.** Polling alone is not a queue — whoever happens to poll in the
instant after a release wins, so a run that has waited twenty minutes can lose to one that arrived
a second ago, repeatedly. The ticket records when each run *first* asked, and the lease is granted
only to the head of the queue. That is the whole difference between retrying and queueing.

The ticket is refreshed (`last_seen_ms`) on every poll, so a waiter that dies stops being counted
after three missed polls and cannot block the queue behind it. Its `enqueued_at_ms` is *not*
refreshed — re-stamping it each poll would send a waiting run to the back of its own queue every
tick, a starvation bug that only appears under contention.

### The wait is bounded, and this is not "never fails"

Capped at **20 minutes** by default (`max_wait_ms`). Not out of impatience: an ERP session lasts
about four hours and every token dies at 22:00 UTC, while an audit runs 45–90 minutes. A run that
queues for hours reaches the front holding a token too short to finish with, and n8n's execution
timeout caps it independently.

So queueing turns *"fails immediately"* into *"waits, then fails only when waiting is genuinely
pointless."* That is a real improvement and it is **not** the same as never failing. Building it as
though it were would hide the failure instead of removing it.

**A queued run holds an n8n execution slot while it waits.** The 60 s poll is deliberately under
n8n's 65 s offload threshold, so the wait stays in memory and behaves predictably inside a
sub-workflow — at the cost of occupying a worker. With two or three audits that is the right
trade; with many it would not be.

**Queueing cannot be store-and-forward**, and that is a hard constraint rather than a design
preference. A real job queue would record the request and re-fire it later, but the run payload
carries the ERP bearer token, and persisting that to a table to replay is storing a credential.
The token travels per run and is never stored — so the waiting run stays alive in its own
execution, holding its token in memory exactly as it already does.

**The override deliberately jumps the queue.** Its whole purpose is to get past a lease that
should not be there; making it wait behind the queue it is trying to escape would defeat it.

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

And the queue, end to end — the behaviour that matters most:

| exec | path | result |
|---|---|---|
| 95530 | A acquires a free lease | granted |
| 95531 | B acquires while A holds | **queues**, takes a ticket, polls |
| 95532 | A releases | freed |
| 95531 | B's next poll, 69 s after it started waiting | **granted** — no human re-fired anything |

And FIFO under real contention — three waiters, queued in an order that contradicts alphabetical
so name-ordering could not pass by accident:

| exec | run | queued | granted |
|---|---|---|---|
| 95558 | `holder-run` | — | held first |
| 95559 | `zeta-run` | 1st | **1st** |
| 95560 | `alpha-run` | 2nd | **2nd** |
| 95563 | `mike-run` | 3rd | **3rd** |

Each waiter took the lease in the order it *asked*, not alphabetically and not by who happened to
poll first. `alpha-run` did not barge ahead while `zeta-run` was being granted.

Both tables left in their reset state after 95573.

## Files

| file | node |
|---|---|
| `nodes/read_lease_request.js` | Read Lease Request — validates input, refuses a blank `run_id` |
| `nodes/decide_lease.js` | Decide Lease — the whole decision, the only file worth reading closely |
| `nodes/settle.js` | Settle — the 1500 ms pause before the read-back |
| — | `Get Queue` / `Write Ticket` / `Lease Granted?` / `Wait In Queue` — the FIFO queue (no code) |
| `nodes/return_lease_result.js` | Return Lease Result — verifies the read-back, then answers the caller |
| `nodes/test_lease_call.js` | Test Lease Call — manual harness, inert by default |
| `offline/lease_test.js` | the suite |

Node bodies contain **zero backslash escapes**, deliberately, so they survive transmission
through the SDK without escaping damage. Keep it that way:
`cat nodes/*.js | tr -cd '\\' | wc -c` must print `0`.

## Who calls it (was "Not yet wired" until 2026-08-22)

| caller | acquires | releases on success | releases on error |
|---|---|---|---|
| **WF-A** CC Below Agreed | between `Validation OK?` and the six sweep starters, `no_wait: true` | declared `lease-released-downstream` — WF-C does it | `Release Lease (error)` → `Fail Loudly` |
| **WF-C** CC Below Agreed 3-Deliver | — | `Release ERP Lease`, last node | `Release Lease (error)` → `Fail Loudly` |
| **WF-B** CC Below Agreed 2-Verify | — (holds the caller's) | — | `Release Lease (error)` → `Fail Loudly` |
| **CC Price Stage 1** | after `Parse + Assert Card`, `no_wait: true` + self-re-invoke | declared downstream — Stage 3 does it | `Release Lease (error)` → `Fail Loudly` |
| **CC Price Stage 3** | — | `Release ERP Lease`, last node | `Release Lease (error)` → `Fail Loudly` |
| **MV Stage 1** (draft) | before `Count Cohorts`, `max_wait_ms` 10 min | `Release ERP Lease` after `Deliver Run` | `Release Lease (error)` → `Fail Loudly` |
| **MV Stage 4** (draft) | standalone re-verify path only, as `runId:verify` | `Release ERP Lease` | `Release Lease (error)` → `Fail Loudly` |

**Do not read this table as status.** `python3 tools/erp_compliance.py --all` is the source of
truth and re-derives every line of it from the deployed flows; this is a map, and a map goes stale.
The paragraph it replaced said "No audit calls this yet" for a day after WF-A was wired, and that
kind of sentence has now produced one wrong status report — see `docs/decisions.md`, 2026-08-23.

The precondition that paragraph named is **`cc-below-agreed/tools/verify_order.py`** — it exists,
in that check's subtree rather than in `audit-flows/tools/`. Two sessions looked for it at the root,
did not find it, and recorded "does not exist"; both were wrong. The WF-A rewire was in fact
verified directly — `Respond 200` still target 0, all six sweeps still reaching both `Join Bulk
Pulls` and `Build Error Callback`, retry rail and both error origins confirmed on a re-export — so
the conclusion held, but for a reason that was not the stated one.
