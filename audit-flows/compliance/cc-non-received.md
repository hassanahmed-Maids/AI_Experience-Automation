# ERP load compliance — CC Non Received Monthly Payments, Stage 2 (Verify)

Audited and **fixed** 2026-08-23 against `../ERP-LOAD-POLICY.md`. Scope was **one flow**:
`qAuvLHhae2sKD7mM` "CC Non Received · 2-Verify". It is **live**, so it was deployed as a draft,
byte-compared against the repo sources in `cc-non-received/nodes/`, and only then published.
Verdicts are `tools/erp_compliance.py`.

| flow | id | live | verdict | published version |
|---|---|---|---|---|
| 2-Verify (sub-workflow, self-calling) | `qAuvLHhae2sKD7mM` | yes | **PASSES** — was 14 findings | `371c8453-0680-4dd6-8192-16fba6ba2a8c` |
| 1-Score / WF-A (parent) | `Qq473Ygj543jxPUN` | no | **read-only in THIS pass** — remediated the same day by a parallel pass; see §4 | — |
| 3-Deliver / WF-C | `XN5DaOAfveAqtDMC` | yes | not audited this pass (makes **no** ERP calls) | — |

## The shape, because §3 and §4 depend on it

WF-A scores the month and launches this stage **without waiting**
(`Launch Verifier (WF-B)`, `waitForSubWorkflow: false`). This stage takes the first `batch_size`
(50, fixed in WF-A's `Assemble Baton`) candidates off the baton, verifies them, then either
**self-calls** with the remaining baton (`Next Batch (self)`, also fire-and-forget) or hands to
WF-C. **Every batch is therefore a separate production execution of the same workflow, and the run
spans all of them** — which is what makes the §5 latency rule live here and inert in the sibling
flows audited the same day.

## What was fixed

**§1 pacing.** All **seven** ERP nodes were at `batchSize 5 / batchInterval 500` — 10 req/s against
a 4 req/s ceiling, with five connections open at once. Now **2 / 500** with the existing 90 s
timeout kept. Six read as per-item to `erp_load_check.py`; `Get Client Complaints` reads as
run-level because it interpolates `$('Select Red Cases').item.json…` rather than `$json`, so it
was only a warning — it is per-item in fact and was fixed with the rest.

`onError` was **left at `continueRegularOutput` on all seven, deliberately.**
`continueErrorOutput` would route a failed call away from the judge node that has to count it and
leave the breaker seeing only successes. The breaker wins.

**§2 / §3 budget gate.** New `ERP Budget Gate` between `Select Red Cases` and the six
per-candidate fan-outs. It declares `ERP_CALLS_PER_ENTITY = 6` (complaints list + client notes +
sales to-do + manager/credit + SMS + WhatsApp) plus `ERP_CALLS_THREADS_MAX = 5`
(`MAX_PER_CASE` in `Split Relevant Complaints`) — **11 worst case** — and `ERP_CALLS_DOWNSTREAM = 0`,
because WF-C was checked and makes no ERP calls.

It **projects the whole run, not the batch in hand**, from `baton.candidates_total`. A per-batch
gate would have waved a 5,000-candidate run through 100 times at 300 calls a go and never once
stated the real number. The projection is constant for the life of the run, so the gate can only
throw on batch 0; re-asserting it every batch is a cheap guard against a self-call whose list grew.

Sweep pages already spent by WF-A are recovered from `baton.stats.gate2`
(`contracts_pages + terminated_pages + status_pages`), with the canonical 185 as fallback for a
hand-pasted `Test Baton`.

**The lever is named but not yet plumbed, and the node says so.** The gate reads
`baton.erp_call_budget`; nothing sets it today, so every real run gets the 2,000 default. Raising
it deliberately is a one-line change in WF-A's `Assemble Baton`. At 11 calls per candidate the
default refuses a run of more than ~180 red cases — which is the intended §3 behaviour, not a bug.
The July 2026 residue was 4 cases.

**§5 breakers.** Seven dedicated judge nodes, one directly after each ERP fan-out, each generated
with `tools/make_breaker_block.py --source-node "Validate Inputs"` and each returning `$input.all()`
unchanged: `Judge Complaints Batch`, `Judge Threads Batch`, `Judge Client Notes Batch`,
`Judge Sales Todo Batch`, `Judge Manager Notes Batch`, `Judge SMS Batch`, `Judge WhatsApp Batch`.
Dedicated nodes rather than embedding: `Split Relevant Complaints` is 5 KB of selection logic and
`Build Evidence Bundle` is 18 KB reading all five note/SMS fan-outs by name — one shared block
there could not have judged five separate batches, and five stacked blocks would have buried the
code that matters.

`Validate Inputs` now stamps `erp_t0` alongside the `run_id` it already carried; that is the single
clock every judge node reads.

## The latency rule IS live here, and that is the difference from the sibling flows

The sibling audits (`dummy-tickets-hm`, `terminated-housemaids`) state that their parents' fan-outs
happen once per run, so there is no earlier batch of the same key to baseline against and the
latency threshold can never fire. **This flow is the opposite case, and it took working out:**

- it **self-calls per batch**, so batch 2 runs in a *different execution of the same workflow*;
- `run_id` rides the baton unchanged through `Prepare Handoff`, so the breaker's run key does not
  change between batches and the baseline store is not cleared;
- `$getWorkflowStaticData('global')` persists **between production executions** on this instance
  (policy §5, verified on `GgqCYYnmRcC6cUet`), so batch 1's measurement reaches batch 2.

So: **inert on batch 1, live on batches 2..n, inert in manual runs** (static data is not written for
those), and **inert on any run that fits in one batch of 50** — which on this check is most months.
`baseline_carried` logs which case each batch was.

Two judgement calls that go with it, both stated in the call sites rather than left implicit:

- **`callsMade` is cumulative across the batch, not the node's own count.** Under `executionOrder
  v1` the six fan-outs run one after another, so by the time a later judge runs, the clock from
  `erp_t0` already contains every branch before it. Dividing that by one node's 50 calls would
  report the node as several times slower than it is, and would swing with however many complaint
  threads that month happened to have. Dividing by the calls actually made makes it a running mean
  per call over the batch — the same quantity in every batch, which is the only thing a baseline
  can honestly be compared against. The helper sums `$(node).all().length` over the seven ERP
  nodes inside a `try`, so a branch that has not run yet contributes zero.
- **`minCallsForBaseline: 50`, not the policy's 200.** The 200 exists to stop a small *canary*
  chunk from setting the baseline for much larger chunks behind it. This flow has no canary:
  `batch_size` is fixed at 50 and every batch is the same shape, so batch 1 is a like-for-like
  sample for batch 7. The residual is the **short last batch of a run**, which amortises the
  batch's fixed overhead over fewer calls and therefore reads slightly slow; at 3× that is headroom
  rather than a trip, and it is named in every call site rather than hidden.

Where a threshold cannot fire, the call site says which and why: `degraded_rate` needs ≥ 20
responses, so it is inert on a tail batch under 20 and on the complaint-thread **keepalive
sentinel** (`Split Relevant Complaints` emits one throwaway `/historyOfComplaint/0` when a batch has
no threads; ERP rejects it, and one degraded response can never reach the sample floor).

## §4 — the lease: this section was true when written and false four hours later

**CORRECTED 2026-08-23, after WF-A was remediated by a parallel pass.** What this section said —
that the whole CC Non Received chain runs unleased, that `ERP-COMPLIANCE: lease-held-by-caller`
must NOT be written because it would be false, and that the checker's §4 warnings should keep
firing — was accurate at the moment it was written and is kept here rather than deleted, because
the failure is worth more than the tidy version. Two remediation passes ran the same afternoon,
one on this stage and one on `Qq473Ygj543jxPUN`, and **neither could see the other**. Left alone,
this note and the canvas sticky it summarised would have instructed the next reader to delete a
declaration that had become true.

### What is actually true now

**WF-A acquires the lease** (`9gVijqvtLVEhQZXz`) before its first ERP call, declares
`ERP-COMPLIANCE: lease-released-downstream`, and **3-Deliver** (`XN5DaOAfveAqtDMC`) hands it back
at the end of the chain. So `ERP-COMPLIANCE: lease-held-by-caller` **is written** on this stage's
`Validate Inputs`, and it is true.

**This stage also releases on its error rail, although it never acquires** — and that is not a
contradiction. WF-A launches this stage fire-and-forget and ends; this stage self-calls per batch
the same way and finally launches WF-C. Any way THIS execution dies takes the whole chain with it,
and the 3-Deliver release that would have freed the lease never runs. That is a 3-hour hole in the
queue after every failure, cleared only by the staleness backstop. **Remediating WF-A is what
created the need for a rail here**; before it, a release here would have freed a lease nobody took.

The rail: **20 single-output nodes** carry `continueErrorOutput` into `Capture Failure` →
`Release Lease (error)` → `Fail Loudly`. Two details are load-bearing:

- **`Capture Failure` resolves `run_id` from the RAW BATON under `When Called`**, not from
  `Validate Inputs`. Validate Inputs is itself on the rail — a malformed baton, a missing bearer
  and an empty candidate list all throw there — and a release that cannot name a `run_id` frees
  nothing, because the lease only ever releases to the run that holds it. The rail would have
  looked like it worked while the lease stayed stranded. `When Called` is
  `inputSource: passthrough`, so the baton is there whatever Validate Inputs did with it.
- **It also holds the error**, because `Release Lease (error)` is an Execute Sub-workflow node and
  those REPLACE their input item. A terminal reading `$input` downstream of one can only ever
  report `unknown node / unknown error` — the bug that was in 12 of 13 rails in this repo.

Deployed as a draft, byte-compared against `cc-non-received/nodes/`, then published; the canvas
sticky was corrected and published in the same way. **Still unwired on purpose**: `Join Evidence`,
`Join Verdict Paths`, `Needs the model?` and `More batches?` — their error output is not at index 1
and guessing is silent. The checker names them as blind spots on every run and that warning is
true.

### The judgement that is now obsolete, kept because the reasoning was sound

The original section argued against acquiring a lease HERE: it would protect only the tail of the
run, nothing downstream would release it, and doing it properly needs the `no_wait` + `Re-queue
Self` shape this flow does not have. **That reasoning was right and it still is** — this stage
still does not acquire. What changed is that the entry point finally does, which is exactly where
the original section said the fix belonged.

`ERP-COMPLIANCE: budget-gate-in-caller` was likewise **not** written: WF-A had no budget gate when
this pass ran, so a real gate was built here instead. **WF-A has one now** — added by the same
parallel pass — and the gate here is still the right call: it is the only one that can see this
stage's own 11-calls-per-candidate fan-out, which WF-A's gate does not cost.

## Remaining warnings, on purpose

The two §4 warnings above. They are the honest state of the chain, not noise to be tuned away.

## What this audit could not close

WF-A's own load: it sweeps the active-contract, terminated-contract and payment-status pages and
makes up to three enrichment calls per cohort member, with **no gate, no lease and no breaker**.
This stage's gate says out loud that those calls are not counted, so the number it prints is a
floor, not a total.
