# ERP load policy for audit flows

> **What is left to do, and how to execute it:** `REMEDIATION-PLAN.md`. This file is the
> policy; that one is the backlog, with a preflight, three tracks and a definition of done.

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

### A number here has to be a LITERAL, and it has to actually be set (added 2026-08-23)

Two failures found in the MV Monthly Payment re-audit, both in flows whose own sticky notes said
they were paced.

**`batchSize` without `batchInterval` is not pacing.** n8n's default interval is 0, so a node at
`batchSize: 1` with no interval fires its requests back to back — sequential, but at whatever rate
ERP will answer. Three nodes were in this state: `Fetch Population Page` (Stage 0, sticky note:
*"ONE request at a time with pacings between them"*), `Read WhatsApp Log` and `Read Complaints`
(Stage 4, sticky note: *"clientmgmt is read GENTLY (2 concurrent, 1s apart)"*). Stage 0 went
further — it **declared a `pacingMs` input, its caller passed 1000, and no node read it**.

So: **both fields, always, on every per-item ERP node.** A prose claim about pacing is not pacing,
and neither is a parameter the flow accepts and discards.

**Set them as literals, never as an expression.** `"={{ $('Sweep In').first().json.pacingMs }}"` is
valid n8n and was the obvious fix for the above. It is wrong twice: §1 is a *ceiling*, and a rate
a caller can set is a rate a caller can set wrong; and an expression's value exists only at
runtime, so `erp_load_check.py` cannot read it and the node passes by accident. An
expression-valued pacing field is now a **FAIL**.

That check found a crash in the tool itself: `check_node` compared the value to an int directly,
so one expression-valued field raised `TypeError` and took the **whole run** down — every flow in
it losing its verdict. Now parsed defensively, with the unreadable ones named. Pinned in
`tools/offline/compliance_test.py`.

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
  ERP time per run**. **Done 2026-08-24** — WF-E probes the grant once per chunk and skips the
  phase when it is refused, and WF-A now probes it once per RUN and passes the verdict down, taking
  a denied run from ~5,632 refused replacement calls to **1**. See §5.

  The general rule underneath it is cheaper than every other lever in this file: **a refusal that
  is fixed for the whole run should be discovered once, not once per entity.** Pacing, budgets and
  the breaker all bound calls that might have worked. This bounds calls that provably cannot.

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

### The gate is per ENTRY POINT, not per flow (added 2026-08-23)

**A second entry point is a second run, and it needs its own gate and its own lease.** MV Monthly
Payment Stage 4 looked gated because its caller, Stage 1, charges one downstream call per contract
as "Stage 4 worst case". That covers the sub-workflow path and nothing else. Stage 4 also has a
**re-verify webhook** that reads every finding for a `runId` out of the case store and makes two
ERP calls each — a month with 3,000 findings is 6,000 ERP calls behind one POST, costed by nobody.

This is the second time the same flow's second entry point has been missed in the same way: the
2026-08-20 audit found it had no **lease** on that path either. Both times the reason was the
same — *the flow reads as a sub-workflow, and the second entry point is one node off to the side.*

So when a flow has more than one trigger, answer §3 and §4 **once per trigger**, and let the gate
say which path it is on rather than pretending they are the same. A gate that hard-fails on the
standalone path and logs-and-passes on the called path is the right shape; the
`ERP-COMPLIANCE: budget-gate-in-caller` declaration then applies to the called path only, and must
say so.

Found by running the checker against a graph fixture. Three read-throughs of the same workflow had
missed it.

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
that runs long must pass its own `max_wait_ms` — MV Monthly Payment Stage 1 passes **10 minutes**,
sized to the 2400 s ceiling below rather than to the holder — or its queued successors time out
every time and the queue never once succeeds. (This sentence used to say 45 min and the paragraph
below said 10; the deployed value is 600000 ms. Corrected 2026-08-23 during the MV re-audit — a
policy that contradicts itself two paragraphs apart is one nobody can be held to.)

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
  message; the run simply vanished. **An unbounded wait inside one execution therefore produces
  the least legible failure available** — it does not fail loudly, it disappears.

A caller that still blocks has fixed arithmetic: **wait budget = 2400 s − the run's own duration −
margin**, so it fails with an explanation instead of vanishing. MV Monthly Payment allows 10
minutes (its execution spans a whole slice). **CC Price no longer blocks at all** — it uses the
`no_wait` self-re-invoke below, which is the only shape in which the wait is genuinely unbounded,
and is what every new flow should use.

**Waiting indefinitely needs the caller to stop blocking — and that is now built.** The caller
passes `no_wait: true`; the lease answers immediately with `granted` or with `queued` plus a
position, and on `queued` the flow re-invokes *itself* with the same payload and exits. No
execution ever waits long, so the 2400 s ceiling stops applying to the wait. See §7 and
`cc-price/README.md`, which documents the five things that make the pattern correct — the
run_id pin being the one that is not obvious.

**There is no default wait cap.** There used to be one (20 minutes), and it was wrong: it meant
the mechanism protecting ERP could kill a run that had done nothing wrong, which is the worst
trade available here. `max_wait_ms` is still honoured when a caller explicitly asks to fail fast,
and a `no_wait` caller is exempt even then — its `waited_ms` is the age of the *run's* ticket
across every re-invocation, so it grows without bound by design and any finite cap would
eventually kill a run behaving exactly as intended.

**Two traps, both hit live on 2026-08-20 (executions 95750, 95726).** The `When Called` trigger
declares `max_wait_ms` as a **number**, and n8n fills a declared-but-unsent number field with
**0**, not `undefined` — so "I passed nothing" and "I want a zero-millisecond limit" arrive
identically and a `>= 0` test reads the former as the latter. And **editing a published workflow
creates a draft while live callers keep serving the active version**, so a lease fix can sit
unpublished while every run executes the old body. Publish, then test.

**What removing the cap does NOT fix, and must not be read as fixing:** an ERP session lasts about
four hours and every token dies at 22:00 UTC while an audit runs 45–90 minutes. A run that queues
for hours reaches the front with a token too short to finish. Removing the queue's own timeout
stops the *lease* from failing the run; it cannot make an expired token work. The thing that makes
the guarantee real is **keeping holds short** — slice long runs — so waits stay well inside a
token's life.

Queueing **cannot be store-and-forward**: the run payload carries the ERP bearer token, and
persisting that to replay later would be storing a credential. The waiting run stays alive in its
own execution.

- The lease carries the holder's `run_id` and an acquisition timestamp.
- A lease older than **3 hours** is treated as stale and may be taken — a crashed run must not
  block the queue for ever.
- `params.ignore_erp_lease: true` overrides it. The override is logged loudly and named in the
  run record, because the reason to reach for it (a stuck lease) is indistinguishable from the
  reason not to (another audit genuinely running).

### A ZERO-ITEM NODE STRANDS THE LEASE, and n8n calls that run a success (found 2026-08-24)

Measured on execution 100409 (`aTmGMAlYLwsJQ7js`, Dummy Tickets HM): the run finished with status
**success**, and the ERP lease was still held. The next run queued behind a dead holder and would
have waited the full 3-hour staleness window.

The cause is structural, not a typo. `Release ERP Lease` sits at the END of the delivery tail:

```
Score Cases -> Build Runs Log -> ... -> Build Sheet Rows -> Cases -> Sheet
  -> Build Summary Row -> Run Summary -> Sheet -> Select For Verifier
  -> Get All-Time Refunds -> ... -> Verdicts -> Sheet -> Release ERP Lease
```

**An n8n node that returns zero items does not fail — it stops its branch, and every node after it
is simply never executed.** So any node in that chain that legitimately goes empty silently deletes
the release. Two of them go empty as a NORMAL outcome:

| node | when it returns `[]` | how normal |
|---|---|---|
| `Build Sheet Rows` | `if (!rows.length) return [];` — no portal rows | a clean month |
| `Select For Verifier` | `return out;` with nothing needing a verifier | a clean month |

So the lease was leaked on **every clean run**. The only runs that released it were the ones that
happened to have both a portal row and a verifier candidate — which is why this survived a live
smoke test, three compliance passes and an endurance run: all of them had findings.

This is the same shape as the mute error rail (§7): a step that matters was made conditional on
something unrelated to it, and the failure is invisible because the run is marked green.

**The rule.** *A lease release must not be reachable only through a chain that can legitimately go
empty.* Checking that the release node EXISTS and is wired is not enough — the question is whether
every success path reaches it.

Note what does NOT fix it:

- **A sentinel item** (the `_empty` / `_seed_only` / `_no_population` pattern this flow already uses
  upstream) cannot simply be added to `Select For Verifier`: the next node is an ERP call, and the
  one after `Build Sheet Rows` is a Sheets append. A sentinel there buys a junk ERP call and a junk
  spreadsheet row. Making it work needs IF gates around both — a real change to the delivery tail.
- **`alwaysOutputData: true`** has the same problem for the same reason.

Until the tail is restructured, a leaked lease is cleared by the 3-hour staleness takeover or by
`params.ignore_erp_lease: true` on the next run.

**THE FIX, and it is three moves rather than one.** Corrected across the flows on 2026-08-24 and
**verified live on execution 100502**: `action: release, state: free, holder_run_id: "",
verified: true, reason: "released by its holder"` - on the exact clean-month path that had leaked.

1. **Put the release at the LAST ERP CALL, not at the end of delivery.** Hang `Release ERP Lease`
   off the breaker that judges the last ERP node, as a **dead-end parallel branch**. Everything
   after that point - scoring, the LLM verifier, the runs log, the portal callback, the
   spreadsheets - touches no ERP, so it has no business standing between the last ERP call and the
   release. This also shortens the hold, which §4 wants anyway.

   **Parallel, never in line.** `Release ERP Lease` is an Execute Sub-workflow with
   `waitForSubWorkflow`, so in line it REPLACES the item with the lease's own output and starves
   everything downstream - the same mistake that made twelve error rails say "unknown error".

2. **A stage that makes no ERP calls releases on ENTRY.** `ccprice-stage3` and `wfc-deliver` hold
   the lease only to write spreadsheets. There is nothing left to protect, so the release hangs off
   the trigger.

3. **`alwaysOutputData` + an IF, where the empty case is legitimate.** For an origin whose empty
   outcome is normal - `Select For Verifier` on a clean month - set `alwaysOutputData: true` so n8n
   emits one empty item instead of nothing, and put an IF after it that routes that item straight
   to the release. Verified: this works on a **Code** node, not only on the Data Table nodes that
   already used it.

   **Do NOT reach for `alwaysOutputData` on a node that is meant to be loud.** `Validate Inputs`
   and `Verify Population` throw rather than return nothing; injecting an empty item there would
   turn a loud stop into a silent one. Those get a written ruling instead - an
   `ERP-COMPLIANCE: empty-exit-ok` note stating why the node cannot hand back an empty stream. The
   note lives on the node so it cannot drift away from the code it excuses.

**Enforcement.** `tools/lease_release_check.py` walks the success route backwards from the release
and fails on any node that can ORIGINATE emptiness and has no ruling.

### `setNodeParameter /notes` REPLACES. Append, or you destroy a ruling (2026-08-24)

A node's `notes` field is where this project records its `ERP-COMPLIANCE:` rulings, and a node can
carry MORE THAN ONE. `update_workflow`'s `setNodeParameter` with path `/notes` overwrites the whole
field. There is no append mode, and nothing warns you.

Measured, on a live published flow: `Verify Population` in `aTmGMAlYLwsJQ7js` held the
paginated-sweep breaker exemption from 2026-08-23. Writing an `empty-exit-ok` ruling to the same
node the next morning silently deleted it, and `erp_compliance.py` went from PASS to
**`§5 NO CIRCUIT BREAKER in "Verify Population"`**. The same edit destroyed the equivalent note on
`sXsn4NUYt4kh3OAU`. Nothing caught it for two hours; it surfaced only because a deploy agent
reported the §5 failure as pre-existing and that claim was checked.

**So: read the existing note first and concatenate.** A subagent working the same day did exactly
that on `Build Page List` without being told to - appending its ruling after the existing one - and
kept both. That is the standard.

Worth knowing while you are in there: `/notes` does not write n8n's own node-note field, which is
**top-level** `notes`, not `parameters.notes`. `update_workflow` has no operation that reaches the
top-level field, so a ruling written this way lives in the workflow JSON - where every checker in
this repo reads it (`erp_compliance.py:86` reads both) - but does not render in the n8n editor. The
repo is split, 190 top-level against 28 in `parameters`. Prefer putting a ruling for a **Code** node
in its `jsCode` header comment instead: it renders, and it sits against the code it excuses. `tools/lease_route_map.py`
prints the last ERP call, its breaker, and what currently feeds the release - the shape you need in
order to place it.


### A BARE CROSS-NODE `run_id` LOOKUP ON THE ERROR RAIL STRANDS THE LEASE (found 2026-08-24)

Execution **100774** on MV Overstay Fines (`LDtsstXDfF99TnYe`), a manual run at 11:04 UTC:

```
 2 Validate Inputs        success  -> run_id: 'manual-100774-2026-06'
 5 Acquire ERP Lease      success  -> lease granted, holder manual-100774-2026-06
12 ERP Budget Gate        ERROR    -> error output
13 Capture Failure        success  -> emits { _failure: {...} }   (a SYNTHETIC item)
14 Release Lease (error)  ERROR    -> "no run_id was passed"
```

Nodes 5 and 14 mapped `run_id` with the **identical** expression,
`={{ $('Validate Inputs').first().json.run_id }}`. It resolved at step 5 and resolved to
**nothing** at step 14, in the same execution, with `Validate Inputs` demonstrably successful.
The payload the lease actually received was

```
{"mode":"release","check_id":"mv-overstay-fines","ignore_lease":false,
 "max_wait_ms":null,"operator":null,"no_wait":null}
```

`run_id` is **absent, not null** — n8n silently DROPPED the field when the expression failed to
resolve, while the three sibling fields that are LITERALS all arrived intact. The node's
`workflowInputs.schema` does declare `run_id`, so this is not a schema omission.

**The lease then refused, and that refusal is correct.** It will not release without knowing who
holds it, because releasing without a holder id could free someone else's lease. Result: the
lease was stranded by a dead run, and retries `100781`, `100782`, `100807` all sat 10+ minutes
behind a holder that had already exited. **Fix the callers, never the guard.**

**The trigger is the SYNTHETIC ITEM.** On the error rail the current item comes from
`Capture Failure`, which builds a brand-new `{_failure:{...}}` item, and the cross-node lookup
cannot be resolved from it. n8n's internal reason is **not established** and nothing here relies
on one — the remedy does not need it.

**THE RULE, and it is two halves. Both already existed in this repo, in different flows, which is
the part worth noticing** — `ccnonreceived-2-verify` read `run_id` off its capture node's own
item; `cc-overstay-fines` wrapped its lookup in a try/catch after being bitten on a crash path.
Neither was general, so eleven flows shipped exposed.

1. **The rail head stamps the identity onto its own output item** — `run_id` and `check_id` at
   top level, beside `_failure`, each source in its own try/catch. `Capture Failure` must never
   throw: it is the node that makes a failure legible, so a throw there strands the lease AND
   destroys the diagnostic.
2. **The error-rail release reads the item first, with a guarded fallback:**
   `={{ (function () { try { return $json.run_id || $('<Validate node>').first().json.<path> || '' } catch (e) { return '' } })() }}`
   Never a bare cross-node lookup.

**Every flow's validate-equivalent node has a different name and shape** — `Validate Inputs`,
`Build Run Context`, `Validate Run Input` (`runId`, not `run_id`), `Verify In` (`leaseRunId`),
`Receive Baton` (`params.run_id`), `When Called`, `Validate Inputs` → `_baton.run_id`,
`params.run_id`. Read each one; do not assume.

**The SUCCESS release is guarded but must NOT read `$json`.** There the current item is an
ordinary pipeline item and its `run_id` is the AUDIT run id, which is not always the lease
holder: MV Stage 4 leases under `runId + ':verify'` while its case rows carry the bare `runId`,
so an item-first read there would name a non-holder and turn the release into a silent no-op.
Success releases get the guard only.

**Two places this pattern cannot reach, recorded rather than papered over:**

- **The Error Trigger path.** `wfa-parent` wires `On Workflow Crash` straight at
  `Release Lease (error)`. An Error Trigger runs in a **separate execution**, where no accessor
  can recover the failed run's `run_id` — the envelope does not carry it. That path now sends
  `''` and is refused loudly instead of having the field silently dropped; freeing the lease
  still needs the 3-hour staleness backstop or `params.ignore_erp_lease`. Routing it through
  `Build Error Callback` first, as `cc-overstay-fines` does, is the available improvement.
- **A refusal costs the diagnostic.** `Release Lease (error)` has no error output, so when the
  lease refuses, `Fail Loudly` never runs and the operator loses the message. Giving that node
  `onError: continueErrorOutput` wired to `Fail Loudly` would keep both. Not done here — it
  changes rail routing and wants its own review.

#### CORRECTION, measured the same day: THE FIX ABOVE DOES NOT WORK. DO NOT COPY IT.

Everything above about the DEFECT is accurate. **The remedy is not.** It was proven wrong by
`test_workflow` execution **100899** on `LDtsstXDfF99TnYe` — the identical failure forced with
`erp_call_budget: 1` and every ERP node pinned, so it cost zero ERP calls:

```
Validate Inputs   success   run_id = 'railtest-lowbudget-2026-06'
ERP Budget Gate   ERROR     error item carries no run_id
Capture Failure   success   run_id = ''          <- THE STAMP IS EMPTY
Release Lease     ERROR     "no run_id was passed"
```

The lease had genuinely been acquired — clearing it afterwards returned
`reason: "released by its holder"`, so the acquire resolved and only the release did not. The bug
reproduced **on the fixed code**.

The reason is that step 1 populates the stamp *from the very lookup that does not work there*:

```js
const s0 = $('Validate Inputs').first().json || {};   // returns nothing on the rail
```

so it falls through every source to `''`. `check_id` survived only because it is a hardcoded
literal in that node, and that is the tell: **every literal arrived, every lookup died.** The
premise written into the deployed node — *"the identity is resolved HERE, where the lookup still
works"* — is false. `$('Node')` fails inside a **Code node** on the error rail exactly as it fails
in expression mapping.

Nothing caught this because the offline suite exercises the resolver against fixtures where the
accessor is stubbed and always resolves. **A test that stubs the thing that is broken cannot fail.**

The mechanism that replaces it must not depend on an item chain or a node lookup at all. The
candidate is `$execution.id` — a global available anywhere — with the lease matching the holder on
the execution that took it; that changes the shared lease workflow, so it is being measured before
it is proposed. Until then, treat every error-rail release in this repo as unable to free the lease
and clear a stranded one with `params.ignore_erp_lease` or the 3-hour backstop.

**Enforcement.** `tools/lease_release_check.py` (`bare_lookup_run_id`) fails any release on an
error rail whose `run_id` is neither guarded nor read off the item. The behavioural half is
`erp-lease/offline/capture_failure_identity_test.js`, which runs every DEPLOYED rail head against
real error items and asserts it stamps `run_id`, returns `''` rather than throwing when every
source is missing, and survives malformed error items. It lives beside `lease_test.js` on
purpose: that suite proves the lease refuses a caller with no holder id, this one proves the
callers stop making it refuse. `tools/offline/` would be the tidier home once someone is free to
move it.

**Known divergence to fold in.** The deployed rail heads are now canonical v3 **plus** the
identity stamp, so they no longer byte-match `tools/erp_capture_failure.js`, and
`make_capture_failure_ops.py` would deploy a stamp-less body to the next new rail. The stamp
belongs in the canonical copy and its offline suite.

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

**Wired into every live audit as of 2026-08-22** — WF-A and CC Price Stage 1 acquire, WF-C and
CC Price Stage 3 release on success, and all four plus WF-B release on the error rail. The MV
drafts carry it too. `python3 tools/erp_compliance.py --all` re-derives that from the deployed
flows and is the thing to trust; `erp-lease/README.md` carries a caller table as a map.

This paragraph previously said "Not yet wired into any audit". It stayed wrong for a day after the
wiring shipped. Position IS still behaviour under `executionOrder: v1`, so a rewire still has to be
verified: the tool for that is **`cc-below-agreed/tools/verify_order.py`** — note the path, it lives
in that check's subtree and not in `audit-flows/tools/`, which is why two separate sessions
concluded it did not exist and said so in writing. `python3 tools/doc_check.py` now resolves cited
paths across the whole tree instead of one directory.

**A live smoke test is still owed**: the ERP accounts were deactivated after execution 94355, so the
lease has never run inside a real audit.

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
| **an auth wall — a batch refused outright with NOT ONE success** | **≥ 5 refusals, 0 ok** | a refusal that is total cannot heal, so every further call is load for zero information |

**A `401`/`403`/`498` is not degradation.** It is a permission or a dead token — the same answer
arriving quickly every time, which is the opposite of an overloaded server. This is not a nicety:
`Fetch Replacements` returns `INSUFFICIENT_PERMISSIONS` on **every** call for an account without
ClientReplacement, ~5,632 of them unbroken, so a breaker that counted them would trip on call
five of every run ever fired — and the fix anyone reaches for at that point is to raise the
threshold until it stops complaining, at which point it detects nothing. Auth failures are
counted and reported; they have their own detectors (`isTokenDead`) and their own consequence.

### …but "auth is not degradation" was read as "auth can never stop a run" (fixed 2026-08-24)

Those are two claims, and only the first is true. The second cost **~2,400 requests to production
ERP in one day**. Dummy Tickets 0-Fetch fans out over 399 unique applicants against
`GET /recruitment/maid-at-common/get-main-data/{id}`, pagecode `RECRUITMENT__HustlersWorkflow`.
The operator's ERP identity lacks that grant, so **every call returned 401** — with
`retryOnFail`/`maxTries 2`, ~800 requests per run, three runs. The breaker watched all of them go
past, because auth was excluded from every counter it owns. The run then reported `overall: pass`.

**What the breaker can actually SEE, established from stored execution data, not assumed.**
Execution 100522 (workflow `YQlNlxrnhbQpBbdl`, node `Get Hustler Tickets`) stores the item verbatim:

```
{ error: { message: '401 - "<html>…<div>UNAUTHORIZED &lt;LOGOUT&gt;</div></body></html>"',
           name: 'AxiosError', code: 'ERR_BAD_REQUEST', status: 401, stack: '…' } }
```

There is **no `response` key and therefore no headers**, so `developerMessage` — the one thing
that separates ERP's three refusals — is genuinely unreachable, and the string
`INSUFFICIENT_PERMISSIONS` is nowhere in the item. The body says `UNAUTHORIZED <LOGOUT>`, which
per `dummy-tickets-hm/ENDPOINT-FINDING.md` means any of three things. **A breaker that claimed to
detect a missing grant from this item would be inventing a signal that is not in it.**

**So the test is not _which_ refusal — it is _how total_.** All three meanings of `<LOGOUT>` share
the only property a fan-out cares about: the grant, the token and the pagecode are all fixed for
the whole run, so none of them can change between call 1 and call N.

> **The rule: the batch produced not one successful response and the failures are auth → stop.**

The negative case is what keeps it from crying wolf, and it is the real one: a **per-entity**
denial arrives mixed with successes, so `counts.ok > 0`, nothing trips, those entities are
recorded unreachable and the run continues exactly as before. **One success anywhere in the batch
proves the token, the pagecode and the endpoint all work.**

It deliberately does **not** consult static data. "Have we seen an ok earlier in this run" would
make the rule stronger and would also make it silently inert on manual runs, where static data is
not written — the false-clearance shape this project keeps finding.

**Cost, measured:** with chunks of 25 the wall trips on the first chunk — **25 calls instead of
~800**. That is the whole saving available: the HTTP node returns only when its last request is
done, so "trip on the first refusal" can only ever mean "trip on the first BATCH", and the batch
size is the bill. Same reasoning as the canary chunk, above.

**Its message is a different message**, and that is the point. The degradation message says
"check ERP is healthy, re-run from a capped cohort" — every word of which is wrong advice for a
permission gap and sends the operator to inspect a server that is working perfectly. The wall
message names the pagecode (**declared by the call site**, because the request headers are not on
the item either), states plainly that `developerMessage` could not be read, lists all three
readings, and gives the one curl that settles which it is.

**Where the header IS reachable.** On a node configured `fullResponse: true` **and**
`neverError: true`, a response arrives as `{body, headers, statusCode, statusMessage}` — verified
on execution 93601, workflow `YXRZdtk2Geeeqaal`, the same ERP endpoint. The breaker reads
`developerMessage` opportunistically there and names the reason instead of hedging. It is read as
a **header lookup and never as a text scan**, because that same verified 200 response carries
`access-control-expose-headers: … developerMessage` on *every* successful call — a
`has('developermessage')` scan would match every healthy response ERP returns, which is the
identical bug shape as the bare `503` scan that classified a contract id of 503 as a server error.

**The one declared opt-out**, and the bar for adding another. `cc-below-agreed/wf-e`'s
`Project Replacements` passes `config: { authWall: false }` at its call site, in writing, because
three things hold together: the phase is an *optional enrichment* whose denial is **account**-scoped
(PROBE-RESULTS correction 2 — the same route returns 200 on another operator's token), the same
chunk's plan phase **succeeded**, and the gap is **already declared** in the flow's output. It
opts out of the wall only — 5xx, 429, timeouts, rate and latency all still trip there — and
`auth_wall: true` is still written to the run log on every chunk, so the suppression is visible
rather than hidden in the code that did it. **The better fix for that flow is not a breaker
setting**: probe the grant once per run and skip the phase, turning ~5,632 refused requests into
one. That is a flow change and it is open.

#### BUILT 2026-08-24 — first to one per chunk, then to one per run

`NDk03cYGF4XSXsk5` now gates the phase: `Project Plan -> Probe Replacements Grant` (one call,
`executeOnce`) `-> Restore Chunk Items -> Replacements Granted?`, true to `Fetch Replacements`,
false to a new `Skip Replacements`. Published and live.

**A WF-E-only probe is once per CHUNK, not once per run.** WF-E is a sub-workflow invoked once per
chunk and separate executions share no memory, so it cannot be a per-run probe. At the deployed
chunk size of 750, a 5,632-candidate cohort is **eight executions**, so a denied run made **8**
refused calls. (This paragraph said *nine*, on the arithmetic "a 50-candidate canary plus eight
chunks". **The canary is in the repo mirror of WF-A's `Chunk Candidates` and is NOT deployed** —
found 2026-08-24, and not in the 2026-08-23 instance export either. Live there is no canary, so the
breaker's first verdict costs ~1,500 calls and not ~100, and every "nine executions" in this repo
should be read as eight. It needs a decision, not a silent edit: see `cc-below-agreed/wf-e/README.md`.)

**And then to ONE, 2026-08-24, by WF-A.** `uJ8UVNKdN2s5PHHA` now carries its own
`Probe Replacements Grant` (one `executeOnce` call, after the lease and after the §3 gate) and a
`Classify Grant Probe` node that stamps the three-way verdict onto every chunk, which
`Enrich Candidates (WF-E)` passes as `replacements_grant` (+ a diagnostic
`replacements_grant_probe`). WF-E's `Caller Passed a Verdict?` routes a recognised verdict to
`Apply Caller Verdict` and everything else — absent, empty, `null`, a boolean, a misspelling — to
its own probe. **The fallback is the point**: WF-E stays callable standalone and by older callers,
unchanged. Net saving of the last hop: **7 refused calls out of ~11,264, about 0.06%**. It is worth
having because it is total, not because it is large, and it is stated that way rather than sold.

**The opt-out above is KEPT — with one leg of its reasoning withdrawn.** The probe removed the
everyday full-denial batch — `Project Replacements` is no longer reached at all on a denied
account — but not the case a probe cannot cover: the grant answering the probe 200 and then
refusing the batch behind it. Three of the four conditions still hold word for word (optional
enrichment, account-scoped denial, the same chunk's plan phase succeeded, the gap already declared).
The fourth does not. This paragraph used to end *"the probe re-runs per sub-execution, so a mid-run
revocation is re-detected by the next chunk... the blast radius of not tripping is one chunk"*.
**With WF-A driving, the probe does not re-run per chunk, and the blast radius is the REST OF THE
RUN** — worst case ~5,632 refused calls, which is what this flow did on every denied run until this
morning. The gap is still declared in every one of those chunks, so nothing reads as falsely clean;
what is spent is ERP load on a rare event, in exchange for not ending a run over an enrichment that
is optional by declaration. Two levers exist and both are named rather than implied: turn `authWall`
back on (one-chunk bound, at the cost of killing the run — a more defensible trade than it was
before the probe, and still not taken), or drop the two grant fields from WF-A's mapping (per-chunk
bound back, at the cost of the seven calls).

**The general lesson, because it generalises past this flow.** *A refusal that is fixed for the
whole run should be discovered once* — but "once" has a scope, and the scope is whatever execution
holds the memory. Moving a probe up a level buys calls and sells re-detection. Say which you bought
and which you sold.

**The part that had to not go wrong.** `Skip Replacements` emits `Project Replacements`' exact
output shape AND still declares the gap: `_replacement_permission_denied` equals **the number of
contracts that were not attempted**, never 0, and `replacements_meta.fetch_failed` stays `true` so
gate 7 still reports coverage as capped. Trading ~5,632 wasted calls for a false all-clear would
be the execution-100409 shape; the offline suite pins it by running both paths over the same chunk
and asserting every counter, every `replacements_meta` field gate 7 reads and the whole top-level
key set are identical. A probe answering 5xx/404 is `inconclusive` and **runs the phase anyway** —
a transient must never read as a missing grant. A dead token throws.

The new `Restore Chunk Items` carries an `ERP-COMPLIANCE: no-breaker-because` ruling: it reads a
batch of ONE and not one of the four thresholds above can fire on it (5 consecutive, 20 samples,
5 refusals, and a latency baseline taken from ≥200 calls). A breaker there could only ever return
"nothing tripped".

Full write-up: `cc-below-agreed/wf-e/README.md`.

Tests: `tools/offline/auth_wall_test.js` — **70 assertions**, fixtures copied verbatim out of
executions 100522 and 93601, including the negative cases (a transient 503 never reaches the
permission path; a whole batch of 503s is still reported as degradation; one success in 750
refusals keeps the run going; a real 200 whose headers contain the word `developerMessage` is
still `ok`).

### Retrying a refusal (`retryOnFail`) — judged 2026-08-24, and the framing needs a correction

`retryOnFail: true, maxTries: 2` on `Get Hustler Tickets` doubled ~400 refusals into ~800. It is
true that **retrying a permission denial is never right**. It is also true that **n8n cannot
express that**: `retryOnFail` is unconditional — the node cannot distinguish a 401 from a 503, and
a 503 genuinely does sometimes heal on the second try. So "turn retry off" trades a real defence
against transients for a saving that the auth wall has already taken:

* before: retry doubled the whole run — 399 refusals → ~800 requests.
* after: the run stops on the first chunk, so retry doubles **one chunk of 25** → 50 requests.

**The retry is now a ~25-call rounding error on a run that stops, not a 400-call multiplier on a
run that grinds.** It is not worth buying that back with a flow that no longer retries a genuine
blip. Left alone deliberately.

The change that *would* fix it properly is `neverError: true` (with `fullResponse: true`, which
these nodes already set): an HTTP refusal then stops throwing, so **it is never retried at all**,
only transport-level failures are — which is exactly the retry semantics you want — **and**
`developerMessage` becomes readable, so the wall message can name the grant instead of listing
three possibilities. It is a real behaviour change (`statusCode !== 200` handling moves from the
error rail into the projection) and it has not been tested against a live 401, which would cost an
ERP call. **Proposed, not done.** Nine ERP nodes are in this state today:

| flow | nodes |
|---|---|
| `ccprice-stage1` | Get Population (dynamic API), Get Independent Count |
| `ccprice-stage2` | Get Contract Details, Get LiveInOut Logs, Get Active CPT |
| `dummy-stage0-fetch-tickets` | Get Hustler Tickets |
| `terminated-hm-stage0-fetch-profiles` | Get Housemaid Info |
| `terminated-hm-stage1-score` | Get Transaction Detail, Get All-Time Reversals |

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

### The classifier read data as status codes (found 2026-08-22, live in three flows)

`erpBreakerClassify` scanned the item's **whole JSON** for the bare strings `502`, `503`, `504`.
Those scans exist for the n8n error object, where the HTTP code sits nowhere predictable except
the message text — but pointed at a *successful* body they match data:

| item | old verdict |
|---|---|
| `{body:[{contractId: 503}], statusCode: 200}` | `server_error` |
| `{body:[{contractId: 1502}], statusCode: 200}` | `server_error` (substring) |
| `{body:{price_inc_vat: 5040}, statusCode: 200}` | `server_error` (substring) |

**5040 is a real price on the CC price card**, and Stage 2 ships per-contract payloads full of
ids and amounts. Five ordinary contracts in a row would have tripped the breaker against a
perfectly healthy ERP — on the flow that makes ~16,000 calls — and the documented reaction to a
spurious trip is to raise thresholds until it stops, at which point it detects nothing.

The bare digits are now scanned only over the **error region** (`o.error`, and a top-level string
`message`). The distinctive phrases still scan the whole item, because they are what catches a
Spring error body nested under `body`, the one shape where the status code is not reachable as a
number. Pinned by four fixtures that carry **no phrase at all**, so the digit scan cannot be
deleted with the suite still green — which is what mutation testing reported the first time.

It was found by embedding the breaker into a node whose fixtures used realistic contract ids.
Fixtures with tidy `{id: 1, 2, 3}` data would never have shown it.

### Built — `tools/erp_breaker.js`

Canonical logic plus `tools/build_breaker_embed.py`, which **generates** the block that is pasted
into each projection node. Generated rather than hand-copied for one reason: hand-copying is how
`batchSize: 15` got into every node of every flow and stayed there, a drifted copy nobody could
tell had drifted. `tools/erp_compliance.py` re-generates the block and compares it byte-for-byte
against what is deployed, so drift is a finding rather than an opinion.

Tests: `tools/offline/breaker_test.js` — **53 assertions, 7/7 mutations caught**, fixtures being
the response shapes ERP actually returns (the Spring error body, the n8n error object that carries
no status code anywhere predictable, the permanent `INSUFFICIENT_PERMISSIONS`, the 498-inside-500).
`cc-below-agreed/wf-e/offline/enrich_test.js` — **130 assertions** (65 before the grant probe, 92 after it, 130 after the WF-A hop), proving the *embedded copy*
runs in place: 40 straight denials pass untouched *because that call site declares an opt-out* —
asserted as `auth_wall: true, auth_wall_enforced: false`, so nobody can read the green as "the
wall does not exist here" — five consecutive 503s stop the chunk before its replacement phase
fires, and scattered 502s trip on rate.

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

### The checker only covers what someone remembered to list — until 2026-08-23

Every checker in this policy reads a set of exports. That set was built three different ways and
each was narrower than reality: the exports directory (missed six flows), then the `audit: *` tag
set (missed three, one of them the worst-paced flow in the estate), then "the checks Moe named"
(missed five that this skill had built). **A green suite over an incomplete list is the failure
mode this whole document exists to prevent, reappearing one level up.**

`tools/manifest_vs_instance.py` closes it by requiring a disposition for **every workflow in the
instance** — a total function, not a list of interesting ones. It fails on a workflow nobody has
classified, on one that changed since it was classified, on any disagreement with `MANIFEST.json`
in either direction, and on a skill-built ERP-touching flow the manifest does not list. Run it
beside `erp_compliance.py --all`; the second one's green means nothing without the first.

It also states the residual rather than implying none: as of 2026-08-23 there are **27
ERP-touching audit checks outside the six-check programme, 11 of them active**, that this policy
has never been applied to. They are out of scope, not compliant, and the difference is now
written down.

### A green checker describes the drawing, not the machine (added 2026-08-24)

Every tool in this repo is STATIC. `erp_compliance.py` reads deployed JSON, `manifest_vs_instance.py`
reconciles two lists, the mutation suites break exports and re-read them. Not one of them runs a flow.

On 2026-08-24 that bill came due. Dummy Tickets Housemaids had been built, reviewed, compliance-audited,
and had its lease, budget gate, breakers and error rails corrected across three separate passes — and
the first time anyone actually ran it, it turned out its per-entity phase had **never once completed**.
`Get Transaction Detail` calls `GET /accounting/transactions/{id}`, which is not a mapped route; ERP
answers `401 / API_NOT_FOUND_FOR_PAGE`. No static reading can find that, because the pageCode-to-route
whitelist is not in the backend at all — it is a JSON file in the frontend repo. Even the ask-the-code
API cannot see it.

The same run found two more things no checker could have: an n8n HTTP error item has no
`error.message`, and inserting the lease call broke a node that read `$json` for its token.

**So: a flow is NOT validated until a real run has reached its delivery stage.** Until then the
compliance verdict is a statement about the drawing. Say which it is when reporting, and treat
"passes `--all`" and "works" as different claims - because for three passes on this check they were.

### Prose is not enforcement — the note is right and the thing is wrong

Added 2026-08-23, after this happened three times in one day. A checker reads values; a human reads
notes; and when the two disagree it is the note that wins the review and the value that runs.

- An MV sticky said *"every one is batchSize 5, batchInterval 500"* and matched the parameters
  exactly — which is worse than contradicting them, because it read as a deliberate compliance
  decision and stopped the next reader looking. 5/500 is 10 req/s.
- A CC Non Received sticky said the chain ran unleased and that the caller-held-lease declaration
  **must not** be added. True when written; false hours later, when the parent was remediated.
- Two `Manual Run Config` nodes carried real signed ERP tokens belonging to **other users**, one in
  the LIVE parent, committed to git. One says *"It is DELIBERATELY LEFT EMPTY… Clear it again once
  the run is done"* three lines above the populated constant. The other logged a hardcoded
  `token_expires` that had been wrong for eight days.

So: **anything a note asserts about a value, a checker must assert about the value.** The pacing
rule reads `batchSize`. §4 re-derives the lease from the connection graph. The new
**`BAKED CREDENTIAL`** rule matches a three-segment signed token in any node field — code, `notes`,
sticky content — and is not issuer-specific, so a Supabase or portal key fails the same way. A
cleared field with a comment *describing* the format passes; it needs a real signature segment to
count. When you find yourself writing a note that explains why something is safe, that is the moment
to ask what re-derives it, because the note will outlive the condition it describes.

### A flow's notes are claims about its NEIGHBOURS, and a neighbour can invalidate them

Added 2026-08-23, from a live near-miss. Two subagents remediated `CC Non Received · 2-Verify` and
its parent WF-A the same afternoon, each scoped to one flow — the boundary that makes parallel
remediation safe. The 2-Verify pass read WF-A, correctly found no lease, and wrote that fact into
its compliance note, a canvas sticky, and an explicit instruction that the
`ERP-COMPLIANCE: lease-held-by-caller` declaration **must not** be added and that the §4 warnings
should keep firing. The WF-A pass then added the acquire. All three statements became false, and
the live flow was left telling the next reader to delete a declaration that had become true — while
the real gap it now had (a fire-and-forget middle link holding a lease nothing releases) sat behind
a warning the sticky explained away.

The scoping was right and should stay. What was missing is the seam. **When a parallel pass touches
one flow in a chain, re-run `erp_compliance.py --all` over the WHOLE chain afterwards and read every
warning against what the other flows CLAIM in prose** — a warning that a canvas note or a compliance
doc explains away is the shape to be most suspicious of, because the note is the thing that stops
anyone re-deriving it. The checker re-derives §4 from deployed JSON on every run and was right
within minutes; the prose is what went stale, and prose is not re-derived by anything.

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
     +-- [0] TWO ENTRIES, ONE NORMALIZER  webhook + Retry Entry -> Normalize Entry
     |          everything downstream reads the request from HERE, never from a trigger
     |
     +-- [1] LEASE ACQUIRE  ......... is another audit already hitting ERP?
     |          erp-lease, mode: acquire, no_wait: true, before the FIRST ERP call
     |          granted -> carry on;  queued -> pause 60 s, RE-INVOKE SELF, exit
     |          it does not throw and it does not block: the wait is unbounded because
     |          no single execution ever waits
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
     +-- [6] LEASE RELEASE .......... on BOTH rails, and they are DIFFERENT rails
                success: here, or in the last stage of a fire-and-forget chain
                error:   ALWAYS here - the later stage never runs when this one dies
                         onError continueErrorOutput -> release -> RE-THROW
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
| 5 | lease acquire before the first ERP call, release on the success path | Execute Sub-workflow → `9gVijqvtLVEhQZXz` | `tools/erp_compliance.py` |
| 5b | **an error-path release that re-throws**, in every stage that holds the lease | `onError: continueErrorOutput` → release → `throw` | `tools/erp_compliance.py` |
| 6 | the acquire passes `no_wait: true` and the flow re-invokes itself on `queued` | Retry Entry + Normalize Entry + Build Retry Payload + Re-queue Self | by reading the flow — see `cc-price/README.md` |
| 7 | **every flow this skill builds that reaches ERP is in `MANIFEST.json`**, so `--all` audits it forever | `exports/instance-register.json` (`skill_built: yes`) | `tools/manifest_vs_instance.py` |

**Requirement 5b is not a second copy of 5 — the two paths are different rails, and conflating
them is what let all three CC Price stages strand the lease while the checker said PASS.** On
2026-08-20, run `selfreq-test-2` died at Get Population; Stage 2 never launched, Stage 3 never
ran, and the lease sat held by a dead run. Stage 1's `lease-released-downstream` declaration was
*correct* — for the success path — and said nothing about the failure path. Stage 2 self-chains,
so a dead chunk ends the chain. Stage 3 is the worst of the three: it releases in its **last**
node, so its own designed refusal (`DELIVERY REFUSED` on a short case set) blocked the queue every
single time it fired.

Three things the rail must get right, each of which was wrong first:

- **Re-throw at the end.** n8n marks an execution **SUCCESS** when it runs off the end of an
  error output — a routed error is a handled error as far as the engine is concerned. A rail
  that releases and stops turns a failed audit into one the run log reports as fine, which is
  strictly worse than the stranded lease it fixes: the lease is loud within three hours, a run
  that claims to have finished is never looked at again.
- **Only from single-output nodes.** An IF has true/false *before* its error output and a Switch
  has as many as it has branches, so "the last output is the error one" is wrong for exactly the
  nodes where being wrong is silent. `erp_compliance.py` refuses to read those and says so
  rather than guessing.
- **Not on the queued/retry rail.** That path runs when the lease was never granted; releasing
  there would free someone else's lease. (It would be a no-op by construction, but wiring it
  says something untrue about the flow.)

**A rail is never complete, and it must SAY which nodes it misses.** The three rules above mean an
IF, a Switch, a Merge and an LLM Agent are left off the rail on purpose - their error output is not
at index 1 and guessing is silent. That is the right call and it leaves a real hole: those nodes can
still kill the run, and nothing then releases the lease. `erp_compliance.py` used to print *§4 error
rail releases the lease and re-throws* and stop, so a flow with a hole read as fully covered - which
is how WF-B was misread on 2026-08-23, its LLM agent (the node in that flow most likely to fail on
any given run) sitting off the rail with the reason recorded only in an n8n version description.
It now names every main-path blind spot as a §4 WARNING. Warning and not failure: the unwired node
is the lesser evil, and the point is that the reader can see it.

**A fifth thing, found 2026-08-23: the rail was safe and mute.** Every rail in this repo but one
ran `failing node -> Release Lease (error) -> Fail Loudly`, and `Fail Loudly` read the error off
`$input`. But `Release Lease (error)` is an **Execute Sub-workflow node with
`waitForSubWorkflow: true`, and that node does not pass its input through — it REPLACES the item
with whatever the sub-workflow returned.** So `$input` at the terminal held the lease's answer, and
the only message any of those rails could ever produce was `FAILED at "unknown node": unknown
error`. **12 of 13 flows had it.** Nothing caught it, because every check asked whether the rail
RELEASES and RE-THROWS — both of which it did — and no rail in this project has ever fired, so
nobody had read the output.

**The rail therefore starts with a capture node.** Put a Code node FIRST, before the lease call:
every error output feeds it, it feeds `Release Lease (error)`, it reads the error off `$input` and
returns it as `_failure`, and it **does not throw** — a throw there would strand the lease, which
is the hole the rail exists to close. The terminal then reads it **by name**:
`$('Capture Failure').first().json._failure`. Canonical body:
`terminated-housemaids/nodes/capture_failure.js`.

`erp_compliance.py` now FAILS a re-throwing rail node that reads `$input` while fed through an
Execute Sub-workflow node. Note what the check had to learn to be usable: it first fired on all
three flows it had just been used to fix, because each one now carries the sentence *"READ THE
FAILURE FROM Capture Failure, NOT FROM `$input`"* — a rule that reads prose cannot tell an
explanation from an instruction, so bodies are stripped of comments before they are searched.
Adding the capture node also put a Code node directly on each ERP node's error output, and §5
promptly demanded a breaker in it; the §5 walk now follows output 0 only, because an error output
carries one failure and a breaker judges a batch.

**A fourth thing, found 2026-08-23: an error rail and n8n node GROUPS cannot coexist.** n8n
requires a node group to be a single-entry, single-exit connected subgraph, and an error output is
a second exit — so `update_workflow` rejects the rail with *"must form a single connected subgraph
with a single entry and exit"*. Every flow in this repo that already has a rail has no groups; that
was never a style choice, it is the constraint, and nobody had written it down. **The rail wins**:
groups are documentation and the rail is behaviour. Move each group's description into a `notes` on
its lead node before clearing them — `notes` is read by `all_text()`, so a declaration living there
still counts, and the knowledge survives.

Requirement 6 is the newest and the least obvious. Its four failure modes are all silent, and
three of them were live at some point on 2026-08-20: a downstream node referencing `$('Run
(webhook)')` throws on every retry; a retry that does not pin `run_id` takes a fresh queue ticket
and can be overtaken for ever; a `Re-queue Self` that waits for the sub-workflow keeps the parent
alive and re-introduces the ceiling it was built to escape; and an acquire that blocks instead of
queueing dies at 2400 s with status `canceled` and no error at all.

Run `python3 tools/erp_compliance.py --all` to audit every flow against 1-5b. It is the
retrofit tool as well as the pre-publish gate: point it at an existing flow and it names what is
missing and where it belongs.

**Re-generating is a command, not a chore.** `python3 tools/regen_breaker_embeds.py` rebuilds
every embed in the repo from the canonical file, reading each one's call site and source node
back out of its own `Re-generate with:` line. `--check` reports what would change and exits
non-zero. This exists because "generated, never hand-copied" only holds while re-generating is
*easier* than patching in place: the first time the canonical changed and four copies needed the
same edit, the temptation to hand-patch them is exactly how the guarantee dies.

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
5b. **Count the flow's TRIGGERS, and answer 3 and 5 once per trigger.** A second entry point is a
   second run. MV Monthly Payment Stage 4 has been caught by this twice — no lease on its
   re-verify webhook (2026-08-20), then no budget gate on it (2026-08-23) — both times because the
   flow reads as a sub-workflow and the second trigger is one node off to the side.
6. Generate the breaker block into every projection node that reads a batch of ERP responses —
   `python3 tools/build_breaker_embed.py`. Do not hand-edit the copies.
7. Size the first chunk as a canary. The breaker cannot speak until a batch finishes, so the
   first batch is what an already-failing ERP costs you before anything of ours gets a say.
8. **The first run of any new flow is capped. No exceptions.**
9. Run `python3 tools/erp_compliance.py --all` before publishing. Green or it does not ship.
10. An uncapped run over 15,000 projected calls needs a recorded human decision first.
