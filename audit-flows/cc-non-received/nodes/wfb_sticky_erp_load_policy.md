## ERP load policy — where this stage stands

Audited and fixed 2026-08-23 against `audit-flows/ERP-LOAD-POLICY.md`. The verdict that counts is
`python3 tools/erp_compliance.py exports/ccnonreceived-2-verify.json`, not this note.

### §1 pacing — fixed
All **seven** ERP nodes now run at **2 in flight / 500 ms**, 90 s timeout. They were at 5 / 500 ms:
10 req/s against a 4 req/s ceiling, with five connections held open at once. Nobody chose 5 — it was
cloned forward, which is exactly how `batchSize: 15` got into every node of every flow.

### §2 / §3 budget — added
`ERP Budget Gate` sits between `Select Red Cases` and the six per-candidate fan-outs. It declares
**6 fixed calls per candidate + up to 5 complaint threads = 11 worst case**, projects the **whole
run** from `baton.candidates_total` (this stage self-calls per batch of 50, so a per-batch
projection would never state the real number) and **hard-fails**. It never trims the cohort.

It does **not** cover WF-A's own per-cohort enrichment calls — those are spent before this stage
exists and are invisible from inside it. **WF-A now has its own gate**, added the same day by the
pass that remediated it; this note said it had none, which was true when it was written and stopped
being true a few hours later.

### §4 lease — NOT ACQUIRED HERE, RELEASED HERE ON FAILURE. Both halves matter.
This stage is a middle link in a fire-and-forget chain: **WF-A** (`Qq473Ygj543jxPUN`) scores and
launches this stage without waiting → this stage self-calls per batch → **WF-C**
(`XN5DaOAfveAqtDMC`) delivers. §4 says the lease is taken once, by the entry point, before the first
ERP call, and released by the last stage. **WF-A acquires it and WF-C releases it** — as of
2026-08-23, when WF-A was remediated. So `ERP-COMPLIANCE: lease-held-by-caller` is written on
`Validate Inputs`, and it is now TRUE.

**An earlier version of this note said the opposite** — that the chain ran unleased, that the
declaration must not be written, and that `erp_compliance.py`'s §4 warnings were true and should
keep firing. All of that was correct when it was written. WF-A was remediated hours later by a
parallel pass, and neither pass could see the other. Left alone, this note would have told the next
reader to delete a true declaration.

**Why this stage releases on its error rail although it never acquires.** WF-A launches it
fire-and-forget and ends; this stage self-calls the same way and finally launches WF-C. So any way
THIS execution dies takes the whole chain with it, and the WF-C release that would have freed the
lease never runs — a 3-hour hole in the queue, cleared only by the staleness backstop. Twenty
single-output nodes therefore carry `continueErrorOutput` into **Capture Failure** →
**Release Lease (error)** → **Fail Loudly**.

`Capture Failure` reads `run_id` from the **raw baton under `When Called`**, not from
`Validate Inputs`. Validate Inputs is itself on the rail — a malformed baton, a missing bearer and
an empty candidate list all throw there — and a release that cannot name a `run_id` frees nothing,
so the rail would look like it had worked while the lease stayed stranded. It also holds the error
itself, because `Release Lease (error)` is an Execute Sub-workflow node and those **replace** their
input item; a terminal reading `$input` downstream of one can only ever report
`unknown node / unknown error`.

Still unwired, on purpose: `Join Evidence`, `Join Verdict Paths`, `Needs the model?` and
`More batches?`. Their error output is not at index 1 and guessing is silent. `erp_compliance.py`
names them as blind spots on every run; that warning is TRUE and should keep firing.

### §5 circuit breakers — added
Seven dedicated judge nodes, one per ERP fan-out, each generated from `tools/erp_breaker.js` and
each returning its batch unchanged. Every ERP node stays on **`continueRegularOutput` on purpose**:
`continueErrorOutput` would route failures away from the breaker and leave it counting only
successes. The breaker wins.

Each call site states which of the three thresholds can actually fire there. Short version:

* **consecutive failures** — live everywhere.
* **degraded rate** — live once a batch carries ≥ 20 responses; inert on a short tail batch, and
  inert on the complaint-thread keepalive sentinel (one response).
* **latency** — live **from the second batch of a run onwards**. This stage self-calls, so each
  batch is a separate production execution of the same workflow, `run_id` rides the baton unchanged
  and `$getWorkflowStaticData('global')` carries the baseline between them. On a run that fits in one
  batch of 50 — most months; the July 2026 residue was 4 cases — there is no second batch and the
  rule never fires. `baseline_carried` says which case a given batch was, every time.