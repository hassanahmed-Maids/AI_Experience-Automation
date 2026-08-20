# ERP load compliance — MV Monthly Payment

Audited 2026-08-20 against `../ERP-LOAD-POLICY.md`. Five flows, tag `audit: MV Monthly Pmt`.

**Read rather than checker-run.** There is no `.env` in the remote container, so flows could not
be exported to disk for `tools/erp_compliance.py`. The structural checks below were done by
reading the live flows against the same five requirements; the **byte-compare of the breaker
block was not run** and needs a local export. Treat that one line as unverified.

| stage | id | verdict |
|---|---|---|
| 0-Sweep Population | `9jOMFEC2zEWy2RHM` | fixed — declarations added; bespoke breaker kept |
| 1-Population | `IKRXhIco1mwxrcPq` | fixed — lease + budget gate added |
| 2-Score chunk | `CopNHNsXUzFO59bW` | fixed — pacing, declarations |
| 3-Deliver | `Z9fTvmaM526eYofe` | **clean** — no ERP nodes, policy does not apply |
| 4-Verify findings | `9T91z5VFH5g69WyT` | fixed — lease on the standalone re-verify entry |

## What this audit changed about the POLICY

**Call count is not load; the response is.** Stage 0 was rebuilt after the 2026-08-19 clientmgmt
outage and already knew something §1 did not: ~116 requests at `size=500` took the whole module
to nginx 503, and it stayed down even for `size=1`. By call count that sweep is trivial — the
policy would have approved it without comment. The load was in the response, each page carrying
500 nested contract records. §1 now carries a page-size ceiling and counts a sweep's cost as
`pages × pageSize`. See `../ERP-LOAD-POLICY.md` §1 and `docs/decisions.md` 2026-08-20.

The audit ran in both directions. A flow built after a specific incident is a source of policy,
not only a subject of it.

## Per-stage detail

### Stage 1 — the two real gaps

An entry flow (webhook) that reaches ERP, with **neither the lease nor the budget gate**.

- **Lease** — `Acquire ERP Lease` before `Count Cohorts` (the first ERP call), `Release ERP Lease`
  after `Deliver Run`.
- **Budget gate** — a new node between the chunk plan and `Score Chunk`. `Reconcile Union And
  Chunk` already knew the population and the chunk plan; it had always been able to see the cost
  and simply never refused it. Projects sweeps-already-spent (measured from what Stage 0
  returned, not estimated) + contracts × 2 + Stage 4's worst case.
- A full month projects **~47,000 calls**, so an uncapped full run now has to be an explicit
  decision. The flow's own `offset`/`limit` slicing already implied that — a full month outlives
  an ERP token — but nothing enforced it.

### Stage 2 — pacing, and why the change is free

Ran `3 concurrent / 750 ms`. That is 4 req/s, the correct **rate**, but three connections held
open at once. `2 / 500` is identical throughput at a lower peak, and peak is the dimension the
outage was sensitive to. No wall-clock cost.

### Stage 4 — the entry point nobody had counted

Two entries: `Sub Trigger` (inside Stage 1's lease) and **`Re-verify Webhook`, an independent
entry that reaches ERP with no lease at all**. It cannot simply always acquire: under a different
`run_id` while its own caller holds the lease it would be refused, deadlocking Stage 4 against
Stage 1.

So the acquire is gated on the entry point, discriminated **structurally** — n8n wraps a webhook
payload in `body` and a sub-workflow input is not wrapped — rather than by a flag someone can
forget to pass. The lease is taken as `runId:verify`.

**The release is deliberately ungated.** On the Stage 1 path it names a run that does not hold the
lease, and a non-holder release is a no-op by construction. That property was built to stop one
audit freeing another's lease; here it pays for itself again by removing a branch. `Verify Result`
re-emits the summary so the webhook's response contract is unchanged.

## The bespoke breakers are KEPT, against the checker

Both would fail a byte-compare against the generated block. Both are better here:

- **Stage 0** aborts at a **group** boundary (20 pages) rather than a batch boundary — it stops
  earlier than any batch-level breaker can.
- **Stage 2's `Chunk Summary`** classifies denial *shapes* and prescribes a different human action
  for each: session inactive vs module unavailable vs a real access gap. It tests the
  `<LOGOUT>` / `UNAUTHENTICATED` marker **before** the plain 401/403 branch, because a dropped ERP
  session wears both a 401 and a 5xx, and reading the status class first sends the operator off to
  request a permission they already hold. Derived independently there (probes 2026-08-19 11:33Z
  and 14:42Z) and matching the canonical classifier's ordering — two derivations agreeing is
  decent evidence both are right.

Replacing them would trade knowledge for uniformity.

**What they lack is the latency signal** — "ERP still answering, but dying". Recorded as a known
gap rather than closed by a rewrite.

## Outstanding

1. **Release on the error rail** (Stage 1). Only the happy path releases. n8n's Error Trigger
   cannot recover the run's `run_id`, and a force-release would be the silent-steal path the lease
   exists to prevent. A crashed run holds the lease until the 3-hour staleness takeover. That is
   the designed fallback, but three hours is a long block and deserves a better answer.
2. **Nothing here was smoke-tested.** These flows are DRAFT and marked UNTESTED by their own
   author; ERP was still unhealthy. The changes are structurally sound and unexercised.
3. **The breaker byte-compare never ran** — see the note at the top.
4. **No latency signal** in either bespoke breaker.
