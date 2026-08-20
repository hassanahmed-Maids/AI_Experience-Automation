# ERP load policy for audit flows

**Status: binding on every audit flow, existing and future.** Agreed with Hassan 2026-08-20
after ERP was brought down three times by audit traffic.

ERP is production. It serves the business while we read it. The failure this policy exists to
prevent is specific and has happened: **a flow that behaves perfectly on ten test contracts and
takes ERP down on five thousand, because nothing between those two runs made the cost visible.**

---

## 1. The numbers

| limit | value | applies to |
|---|---|---|
| **Concurrency** | **2 in flight** | every ERP HTTP node (`batching.batch.batchSize: 2`) |
| **Batch interval** | **500 ms** | every ERP HTTP node (`batching.batch.batchInterval: 500`) |
| **Effective ceiling** | **4 requests/second** | per flow |
| **Global** | **one audit at a time** | across all flows — see §4 |
| **Default call budget** | **2,000 calls/run** | a run that does not name a budget gets this one |
| **Sign-off threshold** | **> 15,000 calls** | needs a human decision recorded before it fires |
| **Paged sweeps** | `requestInterval` ≥ 250 ms, `maxRequests` set and justified | every paginated node |
| **Page size** | **≤ 100 rows** for nested/entity responses | every paginated node — see below |
| **Timeout** | 90 s (120 s where a page is measured slower) | every ERP node |

**These replace 15 concurrent / 500 ms**, which is what every per-item node in
`cc-below-agreed` was running: 30 req/s, three times the ceiling the build method already
documented. Nobody chose 15; it was cloned forward.

### Call count is not load — the response is (added 2026-08-20)

**Every number above bounds REQUESTS. The 2026-08-19 clientmgmt incident proves that is not
sufficient.** A sweep of **~116 requests** at `size=500`, 5 concurrent, took the entire
clientmgmt module to nginx 503 — contract search *and* `get-client-details`, and it stayed down
even for `size=1`. By call count that sweep is trivial: 116 requests is under a minute of the
budget this policy would happily approve. The load was in the **response**: each `size=500` page
carries 500 nested contract records, so 116 requests moved as much of the database as tens of
thousands of small ones.

This is a real gap in §1 and §3, found by auditing `MV Monthly Payment · 0-Sweep Population`,
which already knew it. That flow was rebuilt after the incident at **pageSize 100, one request at
a time**, and its sticky note states the lesson in four words: *call count is not load*.

### Measured, 2026-08-20 — the numbers behind the rule

Probed live with curl on `clientmgmt/contract/search/page`, ACTIVE CC contracts (population
**5,410**), one request at a time:

| page | size asked | rows returned | payload | time |
|---|---|---|---|---|
| 0 | 100 | **40** | 71.6 KB | 14.1 s |
| 1 | 100 | 100 | 227.2 KB | 16.8 s |
| 2 | 100 | 100 | 172.5 KB | 17.5 s |

**~2 KB per row, and ~16 seconds per 100-row page.** Extrapolated, a `size=500` page is **~1 MB
and ~80 seconds** — which is why ~116 of them took the module down: roughly **116 MB** of nested
records for ERP to assemble, five at a time.

Three consequences that are not obvious from the rule alone:

- **Pacing barely matters on this route.** `batchInterval: 500` is meaningless when the call
  itself takes 16 s; 2 concurrent gives about **0.125 req/s** in practice, not 4. The ceiling in
  §1 is an upper bound, not a description.
- **A `size=500` page would blow most of our timeouts.** At ~80 s it exceeds the 45 s and 60 s
  timeouts in use, and sits uncomfortably close to 90 s. Anything above size 100 needs its
  timeout re-derived, not inherited.
- **Page 0 returns 40 rows whatever you ask for**, confirmed live. Every pager over this route
  must special-case it or silently lose rows 40–99.

So, for any paginated or bulk read:

| rule | value |
|---|---|
| **Page size** | **≤ 100 rows** for a nested/entity-shaped response; larger only with a measured per-page byte cost recorded next to the node |
| **What the budget counts** | calls **and** rows. A sweep's cost is `pages × pageSize`, not `pages` |
| **The question to ask before a sweep** | not "how many requests is this?" but "**how much of the database is this asking ERP to assemble?**" |

A flow can therefore be inside every rate limit in this document and still be the heaviest thing
hitting ERP that day. **Concurrency is the other half of the same lesson**: 3 concurrent / 750 ms
and 2 concurrent / 500 ms are both 4 req/s, but the first holds three connections open at once.
When the rate is identical, always take the lower peak — it is free.

### What 4 req/s costs, stated honestly

At 30 req/s the enrichment phase took 7 minutes. At 4 req/s the same 11,264 calls take **47
minutes**, and a full uncapped run goes from ~45 min to **~90 min** — which is close to where
execution 89604 died at 94m44s. Two consequences follow, and both are intended:

- **Uncapped runs stop being casual.** That is the point. A full audit becomes a deliberate,
  scheduled act rather than something you fire to see what happens.
- **Reducing CALLS matters more than it used to.** The `ClientReplacement` permission is now a
  load argument, not a tidiness one: half of `cc-below-agreed`'s enrichment calls are
  `401 INSUFFICIENT_PERMISSIONS` on an account without it (PROBE-RESULTS #6/#13). Granting it —
  or skipping the read when the account lacks it — removes ~5,632 calls and **~23 minutes of
  ERP time per run**.

---

## 2. Every flow declares its cost per entity

The reason population-scaled load is invisible is that nobody writes the multiplier down. So:

> **Every flow that makes per-entity ERP calls MUST declare `ERP_CALLS_PER_ENTITY` as a named
> constant next to the node that makes them, and the pre-flight gate MUST read it.**

`cc-below-agreed` declares 2 (plan read + replacement read) for enrichment and 2 (WhatsApp +
SMS) for message evidence. A flow that cannot state this number does not understand its own
cost and is not ready to run.

---

## 3. The pre-flight budget gate — hard-fail, never auto-cap

Before any per-entity phase, and **after** the cohort is known but **before** the first
per-entity call:

```
projected = sweep_calls + (cohort_size × ERP_CALLS_PER_ENTITY)
if projected > budget:  THROW
```

**It fails the run. It never trims the cohort to fit.** Auto-capping produces a run that
completes with incomplete coverage, and a partial audit that looks complete is the expensive
failure this whole check family is built around. The throw must name both numbers, so the
operator's next move is obvious: raise the budget deliberately, or cap the cohort deliberately.

`budget` comes from `params.erp_call_budget`; absent, it is 2,000.

---

## 4. One audit at a time

Per-flow ceilings multiply. VALIDATION §19 records two audits crashing in the same n8n instance
within ten minutes — at the old settings that was 60 req/s at ERP.

A flow acquires a **lease** before its first ERP call and releases it when the run ends, however
it ends. A second audit finding the lease held **takes a ticket and queues**, polling every 60 s
until it reaches the head of the queue.

**It queues rather than refusing.** Throwing was the first design and it was correct but useless:
the honest response to "someone else is using ERP" is to wait, not to make a person notice and
re-fire by hand later. Ordering is by ticket rather than by who polls first — otherwise a run that
waited twenty minutes can lose to one that arrived a second ago.

**The lease spans a whole run, not a call** — acquire before the first ERP call, release at the
end; every sub-workflow runs inside it. Leasing per call would be pointless, since §1 already
governs rate. That sets the queue's scale: a holder keeps it for **45–90 minutes**, so a caller
that runs long must pass its own `max_wait_ms` (MV Monthly Payment passes 45 min) or its queued
successors time out every time and the queue never once succeeds.

### The 2400-second ceiling, measured — and what it means for waiting

**This instance cancels any execution 2400 seconds (40 minutes) after it starts.** Measured
2026-08-20: execution `95598` queued at 12:28:30 with no wait limit, polled happily past the
13:08:30 ceiling while parked, and was **canceled at 13:09:43 — the first moment it woke up**.

Two facts follow, and both are load-bearing:

- **Offloaded waits still count.** A poll longer than 65 s parks the execution and releases its
  worker (confirmed: `status: waiting` with a `waitTill`), so waiting is cheap in *capacity* —
  but the timeout clock is wall-clock from start and is enforced on resume. Parking buys you
  nothing against the ceiling.
- **The kill is silent.** Status is `canceled`, not `error`. The lease never threw its own
  message; the run simply vanished. **An unbounded wait therefore produces the least legible
  failure available** — which is why every caller sets a budget *below* the ceiling, so it fails
  with an explanation instead of disappearing.

So a blocking caller's arithmetic is fixed: **wait budget = 2400 s − the run's own duration −
margin.** MV Monthly Payment allows 10 minutes (its execution spans a whole slice); CC Price
allows 25 (it sweeps, hands off fire-and-forget, and ends).

**Waiting indefinitely needs the caller to stop blocking** — try, and on `queue` re-invoke itself
with the same payload and exit, so no single execution ever waits long. `CC Below Agreed · 2-Verify`
already self-calls per batch, so the pattern is proven here. Not built yet.

**The wait is capped (default 20 min, `max_wait_ms`)**, because an ERP session lasts about four
hours and every token dies at 22:00 UTC while an audit runs 45–90 minutes: a run that queues for
hours reaches the front with a token too short to finish. Queueing turns *fails immediately* into
*fails only when waiting is pointless* — it is **not** never-fails, and treating it as such would
hide the failure rather than remove it. A queued run also holds an n8n execution slot while it
waits.

Queueing **cannot be store-and-forward**: the run payload carries the ERP bearer token, and
persisting that to replay later would be storing a credential. The waiting run stays alive in its
own execution.

- The lease carries the holder's `run_id` and an acquisition timestamp.
- A lease older than **3 hours** is treated as stale and may be taken — a crashed run must not
  block the queue for ever.
- `params.ignore_erp_lease: true` overrides it. The override is logged loudly and named in the
  run record, because the reason to reach for it (a stuck lease) is indistinguishable from the
  reason not to (another audit genuinely running).

### Built — `erp-lease/`

Workflow `9gVijqvtLVEhQZXz` "ERP Lease · one audit at a time", published 2026-08-20, backed by
Data Table `erp_audit_lease` (`nje7kLNpRssRtzsf`). Call it with Execute Sub-workflow:

```
mode: 'acquire' | 'release'   run_id: <this run>   check_id: <which audit>   ignore_lease: bool
```

A refusal is **not** a return value — it throws, so the calling run dies *at* the lease rather
than proceeding past it. Full contract in `erp-lease/README.md`.

It is a **cooperative** lease, not a mutex: nothing physically stops a flow that skips the check.
What it stops is two flows that both use it colliding by accident, which is the failure that
actually happened.

**Acquire is not atomic, and is checked after the fact.** Read, decide and write are three
separate nodes, so two audits starting in the same instant could both see `free`, both write, and
both proceed. The Data Table has no compare-and-swap, so the lease instead writes, settles
1500 ms, **reads the row back, and refuses if it does not name this run** — exactly one winner,
because the row holds exactly one `holder_run_id`. The loser holds nothing and must not release
anything; it cannot damage the winner, since a release from a non-holder is already a no-op.

This narrows the race rather than closing it. The honest guarantee is **two audits starting more
than about a second apart cannot both proceed** — which covers two people starting runs minutes
apart, and does *not* cover simultaneous programmatic fan-out. If audits are ever fired by a
scheduler, revisit this.

**The release path is the one that matters.** Releasing a lease you do not hold is silent — the
other audit keeps running, the lease reads free, and the next audit starts alongside it. So a
release only ever frees a lease this `run_id` actually holds; anything else is a no-op that names
the real holder. The first version of `Decide Lease` got this wrong in the most expensive
possible way: it printed the correct refusal and wrote this run's id into `holder_run_id`
underneath it. The offline suite caught it before it ran.

Verified live, against the real table: acquire (95315), refuse while held (95318), non-holder
release is a no-op with the row unchanged (95320), holder release frees it (95321); re-verified
through the read-back at 95373/95374/95375. Offline: **29 assertions, 7/7 mutations of the
read-back caught.** The lost-race branch is offline-only — exercising it live needs the row to
change between the write and the read-back, which no single manual run can produce.

**Not yet wired into any audit.** Adding acquire-before-first-call and release-on-both-rails to
the 67-node WF-A needs `tools/verify_order.py` re-run (position is behaviour under
`executionOrder: v1`) and a live smoke test, which the deactivated ERP accounts currently block.

---

## 5. The circuit breaker

Pacing (§1) bounds requests per second. The pre-flight gate (§3) bounds how many there are.
Neither notices that ERP has **already started failing** and keeps feeding it the remaining ten
thousand calls. A run that is degrading ERP must stop, not finish the job: aborting loses a run,
not aborting loses ERP for everyone.

Every projection node that reads a batch of ERP responses MUST carry the breaker.

| trips on | threshold | why |
|---|---|---|
| consecutive `5xx` / `429` / connection timeouts | **5** | the shape of a server falling over |
| share of the batch degraded | **≥ 25%**, over at least 20 responses | scattered failure that never reaches 5 in a row |
| mean ms per call vs the run's first full batch | **> 3×** | ERP still answering, but dying |

**A `401`/`403`/`498` is not degradation.** It is a permission or a dead token — the same answer
arriving quickly every time, which is the opposite of an overloaded server. This is not a nicety:
`Fetch Replacements` returns `INSUFFICIENT_PERMISSIONS` on **every** call for an account without
ClientReplacement, ~5,632 of them unbroken, so a breaker that counted them would trip on call
five of every run ever fired — and the fix anyone reaches for at that point is to raise the
threshold until it stops complaining, at which point it detects nothing. Auth failures are
counted and reported; they have their own detectors (`isTokenDead`) and their own consequence.

### Two things this section originally asked for that are not possible, and what replaced them

**"Abort at 5" cannot mean mid-batch.** n8n's HTTP node takes the whole input and returns when
its *last* request is done; the projection node runs once, afterwards. There is no moment during
the batch at which our code is running, so nothing of ours can stop request 6 of 1,500. The
breaker trips **between batches**, which makes **the chunk size the blast radius**. Hence the
**canary chunk**: the first chunk of a run is deliberately small (50), so the first verdict costs
~100 calls instead of ~1,500. One real mid-chunk saving does exist — `Project Plan` sits between
the two HTTP nodes, so a trip there stops the chunk's second phase, 750 calls not made.

**"p50 latency over the first 20 responses" is not measurable.** The HTTP node reports no
per-response timing anywhere — not in the body, not in the headers, not with `fullResponse`. What
is measurable is the batch's wall clock: stamp before the HTTP node, stamp in the projection,
divide by calls made. So the latency signal is a **mean per call for the batch**, compared against
the run's first full batch. Blunter than a p50, and honest.

The baseline is taken from the first batch of **at least 200 calls**, never from the canary: 50
calls amortise fixed overhead over too few requests and read slower per call, which would inflate
the baseline and leave the breaker *less* sensitive for the rest of the run — a safety measure
quietly weakening the safety check behind it.

### How the baseline survives between chunks (and when it does not)

It cannot travel in the payload: WF-A builds every chunk item up front and hands them to Execute
Workflow in `each` mode, so there is no point at which WF-A can put chunk N's measurement into
chunk N+1's input. n8n's per-workflow static data is the carrier.

**Verified on this instance** (workflow `GgqCYYnmRcC6cUet`, executions 95332/95333 manual,
95335/95336 production): `$getWorkflowStaticData('global')` is available in the Code sandbox, and
what it writes **persists between production executions but not between manual ones**. So the
latency check is live in real runs and **inert on the canvas**. Every batch therefore logs
`baseline_carried`, because a latency check that silently never fires is the false-clearance shape
this project keeps finding.

### Built — `tools/erp_breaker.js`

Canonical logic plus `tools/build_breaker_embed.py`, which **generates** the block that is pasted
into each projection node. Generated rather than hand-copied for one reason: hand-copying is how
`batchSize: 15` got into every node of every flow and stayed there, a drifted copy nobody could
tell had drifted. `tools/erp_compliance.py` re-generates the block and compares it byte-for-byte
against what is deployed, so drift is a finding rather than an opinion.

Tests: `tools/offline/breaker_test.js` — **41 assertions, 8/8 mutations caught**, fixtures being
the response shapes ERP actually returns (the Spring error body, the n8n error object that carries
no status code anywhere predictable, the permanent `INSUFFICIENT_PERMISSIONS`, the 498-inside-500).
`cc-below-agreed/wf-e/offline/enrich_test.js` — **62 assertions**, proving the *embedded copy*
runs in place: 40 straight denials pass untouched, five consecutive 503s stop the chunk before its
replacement phase fires, scattered 502s trip on rate.

---

## 6. Enforcement, in two phases

### Status, 2026-08-20

| layer | state |
|---|---|
| §1 pacing ceiling | **enforced** — 5 violations found and fixed across WF-E, WF-B, WF-Pop |
| §2 declared cost per entity | **done** for cc-below-agreed (`ERP_CALLS_PER_ENTITY = 2`) |
| §3 pre-flight budget gate | **live in WF-A** (`Chunk Candidates`), 13 assertions, 6/6 mutations caught |
| §4 one-audit-at-a-time lease | **built + published + proven live** — FIFO queue, write-read-verify (`erp-lease/`, 42 assertions, 8/8 mutations) — *wired into MV Monthly Payment only* |
| §5 circuit breaker | **built + tested** (`tools/erp_breaker.js`, 41 + 62 assertions, 8/8 mutations) — *embedded in WF-E in the repo, not yet deployed* |
| §6 phase 2 ERP Gateway | **not built** |

**Phase 1 (now): every flow enforces it, and a static checker proves it.**
`tools/erp_load_check.py` reads deployed workflow JSON and fails on any ERP node that exceeds
concurrency, lacks pacing, lacks a timeout, or paginates without an interval. Run it before
every publish. A convention that is not checked is a comment, and this project has already
watched a cloned-forward comment misfile an entire review queue.

**Phase 2 (next): one chokepoint.** ERP calls move behind a shared **ERP Gateway**
sub-workflow that accepts a batch of requests and paces them internally. Then the limit lives in
one place instead of in every node of every flow, and a new check cannot get it wrong by
cloning. Phase 1 is not a stepping stone to be skipped — it is what protects ERP while phase 2
is built.

---

## 7. The standard structure every audit flow must have

The four rules above are not four independent good ideas. They are four points on a single
path a run takes, and each one catches what the one before it cannot see. Written as a shape:

```
  params in
     |
     +-- [1] LEASE ACQUIRE  ......... is another audit already hitting ERP?
     |          erp-lease, mode: acquire, before the FIRST ERP call
     |          refuses by THROWING, so the run dies here rather than proceeding past it
     |
     +-- [2] sweeps ................. paced: interval >= 250 ms, maxRequests set
     |
     +-- [3] PRE-FLIGHT BUDGET GATE   how many calls will the per-entity phase make?
     |          projects sweeps + entities x per-entity + entities x downstream
     |          over budget -> THROWS with both numbers. Never trims the work to fit.
     |
     +-- [4] canary chunk ........... first chunk small, so the breaker gets a cheap verdict
     |
     +-- [5] per-entity phase ....... paced: 2 concurrent / 500 ms, timeout set
     |          each projection node carries the CIRCUIT BREAKER
     |          consecutive / rate / latency -> THROWS
     |
     +-- [6] LEASE RELEASE .......... on BOTH rails: success and error
```

**Each layer sees exactly one thing and is blind to the others.** Pacing knows the rate and
nothing about the count. The gate knows the count and nothing about whether the calls succeed.
The breaker knows how ERP is answering and nothing about who else is calling it. The lease knows
who else is calling it and nothing about any of the rest. Drop one and the others do not cover
for it — which is how a flow can be perfectly paced, correctly budgeted, and still take ERP down
because a second audit started ten minutes later.

### The five things a compliant flow has

| # | requirement | where it lives | checked by |
|---|---|---|---|
| 1 | every ERP node at 2 concurrent / 500 ms, with a timeout | node parameters | `tools/erp_load_check.py` |
| 2 | every paginated node with `requestInterval` ≥ 250 ms and a justified `maxRequests` | node parameters | `tools/erp_load_check.py` |
| 3 | a pre-flight budget gate before the per-entity phase | the last Code node before the first per-entity call | `tools/erp_compliance.py` |
| 4 | the circuit-breaker block in every projection node that reads a batch of ERP responses | generated, pasted | `tools/erp_compliance.py` (byte-compare against the generated block) |
| 5 | lease acquire before the first ERP call, release on both rails | Execute Sub-workflow → `9gVijqvtLVEhQZXz` | `tools/erp_compliance.py` |

Run `python3 tools/erp_compliance.py --all` to audit every flow against all five. It is the
retrofit tool as well as the pre-publish gate: point it at an existing flow and it names what is
missing and where it belongs.

**Why generated, not hand-written.** Requirements 3 and 4 are code that must be identical
everywhere. Hand-copying them is precisely how `batchSize: 15` ended up in every node of every
flow and stayed there for months — a value nobody chose, that no one could tell had drifted,
because there was nothing to compare it against. So the blocks are generated from a canonical
file and the checker re-generates and compares. A convention that is not checked is a comment.

---

## 8. Rules for building a new audit flow

1. Probe with `curl`, never with a flow (WORKSPACE-HYGIENE.md).
2. Declare `ERP_CALLS_PER_ENTITY` before writing the node that makes the calls.
3. Wire the pre-flight gate before the per-entity phase, not after.
4. Set concurrency 2 / interval 500 ms on every ERP node. Copy the numbers from this file, not
   from a sibling flow — that is how 15 got everywhere.
5. Acquire the lease before the first ERP call and release it on **both** rails. A release that
   never fires leaves a 3-hour hole in the queue until the staleness rule cleans up after it.
6. Generate the breaker block into every projection node that reads a batch of ERP responses —
   `python3 tools/build_breaker_embed.py`. Do not hand-edit the copies.
7. Size the first chunk as a canary. The breaker cannot speak until a batch finishes, so the
   first batch is what an already-failing ERP costs you before anything of ours gets a say.
8. **The first run of any new flow is capped. No exceptions.**
9. Run `python3 tools/erp_compliance.py --all` before publishing. Green or it does not ship.
10. An uncapped run over 15,000 projected calls needs a recorded human decision first.
