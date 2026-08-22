# ERP load compliance — CC Price by Cohort

Audited 2026-08-20 against `../ERP-LOAD-POLICY.md`. Three flows, tag `audit: CC Price Cohort`.
All three flows audited and fixed. Stage 2 was exported to disk and run through
`tools/erp_compliance.py` — the first flow in this project checked mechanically rather than by
reading — and **passes**.

| stage | id | verdict |
|---|---|---|
| 1 — Population & Price Card | `7j5Z5KPvBcWRPfvy` | pacing fixed; lease + budget gate added |
| 2 — Enrich & Score | `bBYbpHcWMWybDQxN` | **PASSES the checker** — breaker + declarations added |
| 3 — Deliver & Verify | `ZJDiRTzk6uRYBJwq` | no ERP nodes; releases the lease |

## Fixed

**§1 pacing.** `Get Population (dynamic API)` ran `batchSize 3 / batchInterval 250` = **12 req/s**,
three times the ceiling. Now 2 / 500 = 4 req/s. The sweep is ~12 pages, so this costs a couple of
seconds of wall-clock.

## Open findings

### 1. §1 page size — `SIZE = 500`, unmeasured

`Build Page List` and `Population Guard` both hardcode `SIZE = 500`. The new §1 rule caps
nested/entity responses at **100 rows**, allowing larger *only with a measured per-page byte cost
recorded next to the node*. There is no such measurement here.

**It may well be fine**, and that is why it is a finding rather than a fix: this route is
`admin/dynamicApi/evaluateApi?code=getactivecccontracts`, which returns a **flat six-field
projection**, not the nested contract trees that took clientmgmt down at `size=500`. A flat 500
rows is a different animal from a nested 500. But nobody has measured it, and the whole point of
the new rule is that the response — not the call count — is the load.

**Do not change it blind**, for a second reason: `SIZE` appears in *two* nodes and they must
agree. `Population Guard` validates page shapes against it (interior pages must be exactly
`SIZE`), so changing one and not the other fails the guard on correct data. That coupling is
itself worth removing — the guard should read the size the page list actually used.

Action: measure one page's byte cost when ERP is healthy, then either record it beside the node
or drop to 100.

### ~~2. §3 no pre-flight budget gate~~ — FIXED

`ERP Budget Gate` now sits between `Population Guard` and `Launch Stage 2`, the last point at
which the whole cost is known. `ERP_CALLS_PER_ENTITY = 3` (details + live-in/out logs + active
CPT), downstream 0 because Stage 3 touches no ERP surface.

**~5,400 contracts × 3 = ~16,200 calls**, which is over §8's 15,000 sign-off threshold on its
own. A full run therefore now requires `params.erp_call_budget` set deliberately. That is the
intended friction, and it is consistent with what the flow already does elsewhere: Stage 3
refuses to report a short case set for the same reason.

Note the distinction this made explicit: the flow already chunks at 1,000 contracts to survive
the 2400 s execution kill, but **chunking bounds one execution, not the run's total cost against
ERP.** Two different limits that look like one.

### ~~3. §4 no ERP lease~~ — FIXED, with the lease held ACROSS executions

Stage 1 is an entry flow (webhook) that reaches ERP, so §4 applies. But it launches Stage 2 with
**`waitForSubWorkflow: false`** — fire and forget — so Stage 1 *ends* while Stage 2 is still
hitting ERP. A lease released when Stage 1 ends would protect almost nothing.

Done as **acquire in Stage 1 (after the price-card checksum, before the first ERP call), release
in Stage 3 (after the sheet writes are verified)**. The lease is a row keyed by `run_id`, not
something an execution has to stay alive to hold, so the chain carries it across executions by
passing `run_id` along — which it already did. A crashed chain is covered by the 3-hour staleness
takeover.

Stage 3's release is `onError: continueRegularOutput`: a lease hiccup must not fail a run whose
report has already landed and been verified. An unreleased lease is cleaned up in 3 hours; a
failed Stage 3 looks like a failed audit.

**The pattern is worth naming: the lease is held by the RUN, not the execution.** That is also
what sidesteps the 2400 s ceiling — nothing has to stay alive to keep holding it.

### ~~4. §5 no circuit breaker~~ — FIXED in Stage 2

`Assemble Contract Payload` now carries the generated block. It needed a **new call-site**: this
node runs inside a `splitInBatches` loop and sees only 5 responses per turn, so judged one turn at
a time the breaker would be nearly blind — the rate rule needs 20 samples and would never fire at
all, and "5 consecutive" would mean "this entire batch", both too sensitive and too late. The
`loop` call-site accumulates responses across every iteration via `.all(0, runIndex)`, so the
sample grows as the chunk proceeds and the elapsed clock is a running mean over the whole chunk.

`Population Guard` in Stage 1 still has no breaker. Its guards are all about *completeness* —
page shapes, an independent count from a deliberately different route, a probe page past the end.
Partial mitigation: `Get Population` sets no `neverError`, so a 5xx fails the node after 3 retries
and stops the run. That is abort-on-error rather than a breaker, and it means one 5xx kills a run
a breaker would have let ride.

### 5. §5 no circuit breaker in Stage 1's `Population Guard` — still open

## Worth copying from this check

Stage 1 answers the webhook **200 immediately** (`Respond 200 (accepted)`) and audits in the
background. MV Monthly Payment does not — it holds the connection for the whole run and would 524.
This flow gets it right.

## Two defects this audit found in the CHECKER itself

Both were found by deploying a correct change and being told it was wrong — which is the right
way round, but only because the deployment was verified rather than trusted.

**1. Byte-compare flagged every parameterised copy as drift.** The canonical block is generated
with the default `--source-node`, so a flow that legitimately uses `--source-node "Explode
Contracts"` differed in the guard's `$('...')` reference and was reported as DRIFTED. The
deployed body was byte-identical to what the generator produced. Fixed by normalising node
references before comparing — a checker that cries wolf on its own supported options is worse
than no checker, because after a few false alarms nobody reads it.

**2. "Acquired and never released" was wrong for a fire-and-forget chain.** Stage 1 acquires and
Stage 3 releases; the checker saw only the acquire. Acting on that finding would have meant adding
a release to Stage 1 that frees the lease **while Stage 2 is still calling ERP** — the exact
collision the lease exists to prevent. Fixed with the `ERP-COMPLIANCE: lease-released-downstream`
declaration, and the failure message now names it.

## Found live, 2026-08-20: a failed Stage 1 leaves the lease held for three hours

Run `selfreq-test-2` acquired the lease and then died at `Get Population (dynamic API)`
(HTTP 500, `java.lang.SecurityException: Access denied` — Hassan's account still lacks the
`getactivecccontracts` grant, re-confirmed). Stage 1 has **no error rail**, so nothing released
the lease. It stayed held by a run that no longer existed until it was freed by hand two days
later; without that, every other audit would have queued behind a corpse for the full 3-hour
staleness window.

**This is not the `lease-released-downstream` exemption doing its job — it is the hole in it.**
The exemption is correct for the SUCCESS path: Stage 1 hands off to Stage 2 fire-and-forget and
ends, so releasing in Stage 1 would free the lease while Stage 2 is still calling ERP, and
Stage 3 releases it instead. But on the ERROR path Stage 2 never launches, so *no* stage
releases it. The declaration silences the checker on both paths when only one of them is safe.

Two things follow:

- **CC Price Stage 1 needs an error rail that releases the lease** — reachable only when the
  failure happens *before* Stage 2 is launched. After the handoff, releasing is still wrong.
  Same for Stage 2: a failure there must release, because Stage 3 will never run.
- **`erp_compliance.py` should not accept `lease-released-downstream` on its own.** A flow that
  declares it should also have to show an error-path release, or the declaration is a promise
  nobody keeps. Right now the checker is green on a flow that strands the lease on every failure.

The stale-takeover guard did eventually clear it — attempt 94 took the lease over at 181 minutes
with a loud message naming the previous holder — so the queue does not deadlock for ever. That is
the backstop working, not the design working.

## Confirmed working, same run: the self-re-invoke wait

The same run is the best evidence the `no_wait` rail behaves as designed:

| | |
|---|---|
| attempts | **94**, each a separate execution of ~65 s |
| total wait | **101 minutes** — 2.5x the 2400 s ceiling that used to kill a blocking run silently |
| ticket | persisted throughout: `waited_ms` measured the RUN (6,065,777 ms), not the execution |
| position | held at 1 the whole time; never sent to the back of the queue |
| outcome | granted, then failed on its own merits (the missing grant), not on the lease |

## Fixed, 2026-08-22: error rails on all three stages, and the checker tightened

**All three stages had the hole, not just Stage 1.** Once the rule was written down properly it
was obvious the failure was structural rather than a Stage 1 oversight:

| stage | how a failure stranded the lease | reported by the old checker |
|---|---|---|
| 1 | acquires, hands off fire-and-forget; Stage 2 never launches, so nothing releases | PASS (exemption covered it) |
| 2 | self-chains chunk to chunk; a dead chunk ends the chain, Stage 3 never runs | PASS (sub-workflow, not examined) |
| 3 | **releases in its LAST node** — every failure ahead of it, including its own designed `DELIVERY REFUSED`, blocked the queue | PASS (sub-workflow, not examined) |

Stage 3 is the one worth pausing on. It was built to refuse a short case set, and refusing is
the behaviour that matters most in the whole chain — a partial report that reads as complete is
the failure this check family exists to prevent. Every time it did the right thing, it blocked
every other audit for three hours.

Each stage now routes the error output of every single-output node between the acquire and the
hand-off to `Release Lease (error)` → `Fail Loudly`. Deliberately not wired: the queued/retry
rail (no lease is held there), and `Any Findings?` / `Batch of 5` / `More Chunks?` (an IF has
true/false before its error output and a splitInBatches has done/loop, so index 1 is not the
error branch and reading it as one would be silently wrong).

### The checker changes, and the bug the first version of them introduced

`erp_compliance.py` now asks two independent questions instead of "does the word release appear
in a lease node?":

- **success path** — a release NOT reachable from an error output, or the
  `lease-released-downstream` declaration.
- **error path** — a release that IS reachable from an error output, ending in a `throw` or a
  Stop and Error. Required of any flow that acquires the lease, and of any stage that owns the
  release, entry flow or sub-workflow.

A middle stage of a fire-and-forget chain that holds someone else's lease gets a **warning**,
not a failure: whether its death actually strands the lease depends on whether its caller
waited, and that is not visible in the child's own export. Guessing would be the crying-wolf
failure that made the byte-compare drift check useless before it was fixed.

**The first version of this got it wrong in a way worth recording.** Adding the error rule while
the success check still asked "is there a release node anywhere?" meant the new ERROR release
*satisfied the success check* — so when the `lease-released-downstream` declaration was
accidentally dropped from Stage 1 (a `replace: true` parameter edit took the node's notes with
it), the tool stayed green. A fix for one hole opening another, in the same section, inside an
hour. The declaration is now a sticky note on the canvas rather than a hidden node field, and
`tools/offline/compliance_test.py` carries a regression test for the masking itself.

Coverage: 26 assertions, 11/11 mutants caught. Stages 1 and 2 verified against their real
exports; Stage 3 against a graph fixture in `tools/offline/fixtures/` (it has no ERP HTTP nodes,
so §4 is the whole of its applicable audit).
