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
| **Timeout** | 90 s (120 s where a page is measured slower) | every ERP node |

**These replace 15 concurrent / 500 ms**, which is what every per-item node in
`cc-below-agreed` was running: 30 req/s, three times the ceiling the build method already
documented. Nobody chose 15; it was cloned forward.

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
it ends. A second audit finding the lease held **refuses to start**.

- The lease carries the holder's `run_id` and an acquisition timestamp.
- A lease older than **3 hours** is treated as stale and may be taken — a crashed run must not
  block the queue for ever.
- `params.ignore_erp_lease: true` overrides it. The override is logged loudly and named in the
  run record, because the reason to reach for it (a stuck lease) is indistinguishable from the
  reason not to (another audit genuinely running).

---

## 5. The circuit breaker

Every projection node already sees every response. Each MUST track, across its own phase:

- consecutive `5xx` or `429` responses → **abort at 5**;
- p50 latency against the first 20 responses of the run → **abort above 3×**.

A run that is degrading ERP must stop, not finish the job. Aborting loses a run; not aborting
loses ERP for everyone.

---

## 6. Enforcement, in two phases

### Status, 2026-08-20

| layer | state |
|---|---|
| §1 pacing ceiling | **enforced** — 5 violations found and fixed across WF-E, WF-B, WF-Pop |
| §2 declared cost per entity | **done** for cc-below-agreed (`ERP_CALLS_PER_ENTITY = 2`) |
| §3 pre-flight budget gate | **live in WF-A** (`Chunk Candidates`), 13 assertions, 6/6 mutations caught |
| §5 circuit breaker | **not built** — next |
| §4 one-audit-at-a-time lease | **not built** — next |
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

## 7. Rules for building a new audit flow

1. Probe with `curl`, never with a flow (WORKSPACE-HYGIENE.md).
2. Declare `ERP_CALLS_PER_ENTITY` before writing the node that makes the calls.
3. Wire the pre-flight gate before the per-entity phase, not after.
4. Set concurrency 2 / interval 500 ms on every ERP node. Copy the numbers from this file, not
   from a sibling flow — that is how 15 got everywhere.
5. **The first run of any new flow is capped. No exceptions.**
6. Run `tools/erp_load_check.py` before publishing. Green or it does not ship.
7. An uncapped run over 15,000 projected calls needs a recorded human decision first.
