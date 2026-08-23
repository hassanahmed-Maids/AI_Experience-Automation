# ERP load compliance — CC Non Received Monthly Payments, Stage 2 (Verify)

Audited and **fixed** 2026-08-23 against `../ERP-LOAD-POLICY.md`. Scope was **one flow**:
`qAuvLHhae2sKD7mM` "CC Non Received · 2-Verify". It is **live**, so it was deployed as a draft,
byte-compared against the repo sources in `cc-non-received/nodes/`, and only then published.
Verdicts are `tools/erp_compliance.py`.

| flow | id | live | verdict | published version |
|---|---|---|---|---|
| 2-Verify (sub-workflow, self-calling) | `qAuvLHhae2sKD7mM` | yes | **PASSES** — was 14 findings | `371c8453-0680-4dd6-8192-16fba6ba2a8c` |
| 1-Score / WF-A (parent) | `Qq473Ygj543jxPUN` | no | **read-only this pass** — see §4 below | — |
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

## §4 — the lease is NOT held, and nothing in the flow says otherwise

`erp_compliance.py` offers `ERP-COMPLIANCE: lease-held-by-caller` for a sub-workflow whose caller
takes the lease. **That declaration was NOT written, because it would be false.**

`Qq473Ygj543jxPUN` was read (read-only) on 2026-08-23: there is **no Execute Sub-workflow node
anywhere in it pointing at the lease workflow `9gVijqvtLVEhQZXz`**, and no `ERP-COMPLIANCE:`
declaration of any kind. WF-C does not release one either. **The whole CC Non Received chain runs
unleased** — a second audit can run alongside it, which is the failure §4 exists to prevent.

An acquire was **not** added here either, and that is a judgement rather than an omission:

- WF-A spends its sweeps and its per-cohort enrichment *before* this stage exists, so a lease taken
  here protects only the tail of the run;
- nothing downstream releases (WF-C writes one sheet row and ends), so it would be stranded for the
  full three-hour staleness window after **every** run;
- doing it correctly needs the `no_wait` acquire + `Re-queue Self` shape (§7 requirement 6), which
  this flow does not have and which is not a change to make blind on a live flow;
- and WF-A is out of scope for this pass and may be under edit elsewhere.

**The fix belongs at WF-A's entry point**: acquire before its first sweep, release in WF-C, and an
error-rail release in every stage that can die holding it. Until that exists, the checker's two §4
warnings on this flow are **true** and should keep firing. A sticky note on the canvas
(`Sticky: ERP load policy`) says all of this on the canvas, so the next reader does not have to
re-derive it — and says explicitly that the declaration must not be added to silence the warnings.

`ERP-COMPLIANCE: budget-gate-in-caller` was likewise **not** written: WF-A has no budget gate, so a
real gate was built here instead.

## Remaining warnings, on purpose

The two §4 warnings above. They are the honest state of the chain, not noise to be tuned away.

## What this audit could not close

WF-A's own load: it sweeps the active-contract, terminated-contract and payment-status pages and
makes up to three enrichment calls per cohort member, with **no gate, no lease and no breaker**.
This stage's gate says out loud that those calls are not counted, so the number it prints is a
floor, not a total.
