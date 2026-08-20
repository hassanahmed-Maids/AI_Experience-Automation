# CC Price by Cohort — the self-re-invoke lease wait

Three stages. Stage 1 (`7j5Z5KPvBcWRPfvy`) is the only one that acquires the ERP lease; Stage 3
releases it. This file documents the entry structure Stage 1 gained on 2026-08-20, because it is
the pattern every audit flow should copy and it is not obvious from the canvas.

## The problem it solves

The lease queues rather than refuses — a blocked run takes a ticket and waits. The first
implementation waited *inside the acquiring execution*: the lease workflow polled in a 90 s Wait
loop until it reached the head of the queue.

That cannot work, and the reason is a hard instance limit rather than a bug:

- **n8n kills an execution 2400 s (40 min) after it starts.** `executionTimeout: 86400` is
  rejected outright — *"exceeds this instance's maximum of 2400s"*.
- **An offloaded Wait does not stop that clock.** n8n parks a Wait longer than 65 s (`status:
  waiting` + `waitTill`) and frees the worker, but the timeout is wall-clock from execution
  start and is enforced on resume.
- **The kill is silent.** Status is `canceled`, not `error`. Nothing throws, no error rail
  fires, no error workflow runs. The run simply stops existing.

Measured: execution 95598 queued at 12:28:30 and was canceled at 13:09:43 — 41 minutes, no
error, no output. So blocking capped the wait at 40 minutes *and* made exceeding it invisible.

That is the exact failure Moe ruled out: *"idc how much an operator waits for the flows to
finish as long as it finishes and never times out or errors because of that safety mechanism."*

## The structure

```
Run (webhook) ─┐
               ├─▶ Normalize Entry ─▶ Validate Inputs ─▶ Inputs OK? ─▶ From Webhook? ─┬─▶ Respond 200 ─▶ Read Price Card
Retry Entry ───┘                                                                      └─▶ Read Price Card
                                                                                              │
                                            ┌── granted ──▶ Get Independent Count ──▶ ...     ▼
                        Acquire ERP Lease ─▶ Lease Granted? ◀──────────────── Parse + Assert Card
                        (no_wait: true)      │
                                             └── queued ──▶ Build Retry Payload ─▶ Pause Before Retry (60 s) ─▶ Re-queue Self
```

Five things make it correct, and each one was a defect first:

1. **`no_wait: true` on the acquire.** The lease answers immediately — granted, or `queued` with
   a position — and never polls. Every execution stays seconds long, so the 2400 s ceiling can
   never be reached no matter how long the *run* waits.

2. **Two entries, one normalizer.** `Retry Entry` (an `executeWorkflowTrigger`, passthrough) is
   the way back in. `Normalize Entry` accepts both shapes — a webhook payload is wrapped in
   `body`, a sub-workflow input is not, which is structural rather than a flag someone can
   forget to pass — and everything downstream reads the request from *it*.

3. **Nothing downstream may reference a trigger.** `$('Run (webhook)')` throws in any execution
   where that node did not run, which is every retry. `ERP Budget Gate` and `Acquire ERP Lease`
   both had this bug; the lease node still evaluated
   `$('Run (webhook)').first().json.body.erp_lease_max_wait_ms` after the retry rail was built,
   which would have thrown on the first retry. Both now read `$('Normalize Entry')`.

4. **`Build Retry Payload` pins `run_id`.** `Validate Inputs` mints a run_id when the payload
   carries none. A retry that did not pin it would arrive as a brand-new run: a new queue
   ticket, enqueued now, at the back of the line — so a waiting run could be overtaken by every
   newer arrival, for ever. Pinning it keeps the ticket and its original `enqueued_at_ms`, so
   the run holds its place across as many attempts as it takes. `_lease_attempt` and
   `_lease_first_attempt_at` ride along so the log reports how long the **run** has waited, not
   how long this execution has been alive.

5. **`Re-queue Self` is fire-and-forget** (`waitForSubWorkflow: false`). If it waited, the
   parent would stay alive across every attempt and hit the ceiling anyway — the whole point is
   that this execution *ends* and the next attempt starts a fresh clock.

`Pause Before Retry` is 60 s: fast enough to take the lease promptly after a release, and well
inside the lease's 5-minute ticket-staleness window, so a waiting run keeps its place between
attempts.

## What the retry rail costs

One re-invocation per minute per waiting run, each one three cheap nodes and one Data Table
read. No ERP call is made until the lease is granted, so a queued run puts **zero** load on ERP
however long it waits — which is the property that makes an unbounded wait acceptable.

## Files

| file | node |
|---|---|
| `nodes/validate_inputs.js` | Validate Inputs — the two-token fix, audit-month rules |
| `nodes/normalize_entry.js` | Normalize Entry — the single entry point for both rails |
| `nodes/build_retry_payload.js` | Build Retry Payload — pins run_id, counts the attempt |
