# ERP load compliance — Dummy Tickets (Housemaids)

Audited 2026-08-23 against `../ERP-LOAD-POLICY.md`. Two flows, tag `audit: Dummy Tickets HM`.
**Both are live.** Verdicts are `tools/erp_compliance.py`, not reading.

| flow | id | live | verdict |
|---|---|---|---|
| 0-Fetch Tickets (sub-workflow) | `YQlNlxrnhbQpBbdl` | yes | **FAIL** — 3 findings |
| 1-Score (parent, webhook entry point) | `aTmGMAlYLwsJQ7js` | yes | **FAIL** — 11 findings |

Both are recent, careful builds — index-alignment assertions that throw rather than guess,
slim projections so the parent never retains an applicant tree, `neverError: false` kept
deliberately so `retryOnFail` actually fires. The failures below are load-policy gaps in a flow
that is otherwise well made, not sloppiness.

## 1-Score — the parent

**§1 pacing, three separate breaches.**

| node | setting | problem |
|---|---|---|
| `Get Dummy Ticket Transactions` | **no `batchSize`, no `batchInterval`, no timeout** | every input item fires at once; a hung call holds its slot for ever. Also the paginated sweep, with no `requestInterval` — pages go back to back |
| `Get Transaction Detail` | 5 in flight / 500 ms | over the 2-in-flight cap (10 req/s) |
| `Get All-Time Refunds` | 5 in flight / 500 ms | same, and **no `onError`** — its failure cannot reach the error rail |

The 5/500 pair is worth naming precisely, because the flow's own sticky note calls it
"**Pacing 5 concurrent / 500 ms**, matching the golden's rail". That was true of an older golden.
The current §1 is 2 in flight / 500 ms = 4 req/s, and 5/500 is 10 req/s — two and a half times
over. The note is not lying; it is *stale*, which is more dangerous, because it reads as a
deliberate compliance decision. The note has to change with the number.

**§3 no pre-flight budget gate**, with three per-item ERP nodes.
**§5 no circuit breaker** on any of the four projection nodes (`Verify Population`,
`Build Error Payload`, `Resolve Applicants`, `Build Evidence Bundle`).
**§4 no ERP lease** — this is a live webhook entry point that reaches ERP. See the
instance-wide lease finding in `applicant-real-ticket.md`; this flow is one of the two live
entry points running outside the mutex.

## 0-Fetch Tickets — the sub-workflow

**§1** `Get Hustler Tickets` at 5 in flight / 500 ms — the same stale-golden number, and the same
sticky note claiming it matches the rail.

**§3** no budget gate, one per-item ERP node. The parent does not declare one either, so this is
a real gap and not a `budget-gate-in-caller` case — the exemption is only honest once the caller
actually gates the cohort.

**§5** no breaker in `Project Tickets`, which reads the whole batch from `Get Hustler Tickets`
and is the only node that can tell ERP has started failing.

**§4** it relies on its caller holding the lease and **does not say so** — and the caller does not
hold one. The checker reports this as `ok (undeclared)` plus a warning, which is the right
verdict for a sub-workflow in isolation and the wrong impression in this case: the declaration is
missing *and* the claim it would make is currently false.

## Why the per-item nodes matter more than the paginated one

`Get Dummy Ticket Transactions` is paginated: it stops itself at the first failure, so it is
partly self-limiting even unpaced. `Get Hustler Tickets`, `Get Transaction Detail` and
`Get All-Time Refunds` fan out **per item** — every call in the batch completes before any Code
node downstream runs, so nothing in the flow can observe a failure until all of them are done.
That is exactly the shape §5 exists for, and it is why "no breaker" on those three is a heavier
finding than the missing `requestInterval` on the paginated one.

## Fix order

1. `Get Dummy Ticket Transactions` — add `batchSize`/`batchInterval`/`requestInterval`/timeout.
   Cheapest fix, removes the only truly unbounded node.
2. Drop all four per-item nodes to 2 / 500, **and rewrite the two sticky notes** so the number in
   prose and the number in the parameter cannot drift apart again.
3. Lease on `1-Score`, `ERP-COMPLIANCE: lease-held-by-caller` in `0-Fetch Tickets`.
4. Budget gate in `1-Score` before the first per-entity call; `budget-gate-in-caller` in
   `0-Fetch Tickets` once that is true.
5. Breakers — generated with `tools/build_breaker_embed.py`, never hand-copied.

Steps 3–5 are the standard blocks. Step 2 is the one that needs a human to accept the wall-clock
cost, the same trade recorded in `ERP-LOAD-POLICY.md` §"What 4 req/s costs, stated honestly".
