# Running the audit end to end

One POST starts the whole chain. Stage 1 answers immediately and the run
continues asynchronously through Stages 2 and 3.

```
POST https://sami-team.app.n8n.cloud/webhook/cc-price-by-cohort-stage1
Content-Type: application/json

{
  "erp_auth": {
    "bearer":    "Bearer <ERP JWT>",
    "device_id": "<the device id from the same ERP session>"
  },
  "params": {
    "audit_month": "2026-07"
  }
}
```

`audit_month` is optional and defaults to the **last completed month**. The
current month is rejected: on the 18th you cannot say whether August was billed
correctly, because August has not finished.

The bearer is taken per run, never stored in a credential and never written to a
data table. It is the audit-trail attribution for every ERP read the run makes,
so it must belong to whoever is running the audit. The population endpoint
(`dynamicApi/getactivecccontracts`) needs a grant — see `nationality-resolved.md`.

## What lands where

| Output | Where |
|---|---|
| One row per contract, all 5,400 | Data table **CC Price by Cohort — Cases** |
| One row per run | Data table **CC Price by Cohort — Runs** |
| One summary row per run | Sheet **Audit Runs** in *Price trends* |
| One row per non-green in-scope contract | Sheet **Audit Findings** in *Price trends* |

Sheet1 of *Price trends* is the price card and is only ever read.

The Findings tab deliberately excludes greens and out-of-scope contracts — they
are all in the Cases table, and the Audit Runs row carries their counts, so the
two tabs reconcile without repeating thousands of uninteresting rows.

## Reading the numbers

`green / red / pending` are shares of **in-scope** contracts, never of the
population. A contract is in scope for month M only if it was active for the
whole of M *and* a monthly rate covers M. Everything else is out of scope with a
reason, and out of scope is a third outcome — never a pass.

## Optional payload knobs

| Key | Default | What it does |
|---|---|---|
| `params.run_id` | generated | pin the run id |
| `params.smoke` | `false` | prefixes `check_id` with `SMOKE-` |
| `params.chunk.size` | `1500` | contracts per Stage 2 execution |
| `params.chunk.max_chunks` | `0` (no cap) | runaway brake; hitting it reports `HALTED EARLY`, never a finished audit |
| `params.warn_only` | `false` | population floor warns instead of aborting |

## Changing the scoring

Never edit the Score Batch node in the n8n UI. It is generated:

```
# edit scorer-month.js / paymentsinfo.js / n8n/score-glue.js, then
node n8n/build-score-node.js
node test-node-parity.js      # runs the 44-case suite against BOTH sources and the generated body
```

and the generated `n8n/score-batch.gen.js` is pasted into the node. The parity
run is what makes the shipped code provably the code the assertions cover.
