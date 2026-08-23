# ERP load compliance — Applicant Real Ticket

Audited and **fixed** 2026-08-23 against `../ERP-LOAD-POLICY.md`. Two flows, tag
`audit: Applicant Ticket`. Verdicts are `tools/erp_compliance.py`, not reading.

| flow | id | live | verdict |
|---|---|---|---|
| the audit check (draft) | `YXRZdtk2Geeeqaal` | no | **PASSES** — was 10 findings |
| publish results to Google Sheets | `B8r6dyuHz9kFC3HJ` | no | **PASSES** — no ERP nodes at all |

## Scope: the rebuild only

`7M7xzzYpOecao9PE` "Applicant Real Ticket Refund Audit" is the **pre-existing working check** this
draft reimplements. It is live, it predates the load policy, and it is deliberately **out of
scope**: Moe's instruction on 2026-08-23 was that the audit covers the flows the
`erp-audit-flow-builder` skill produced, not the ones they replace. It was briefly tagged and
manifested earlier the same day and both were reverted; it carries no tag, its `versionId` still
matches its `activeVersionId`, and nothing in it was changed.

That does mean its numbers stand un-remediated, and they are worth knowing before the cutover
decision: 10 in flight / 200 ms = 50 req/s on one node, 5/300 on another, a paginated sweep with
no interval, no timeout anywhere, no lease, gate, breaker or error trigger — and
`Fetch All-Time for Flagged`, a `for` loop calling `this.helpers.httpRequest` inside a **Code**
node, which has no `batching` options to set and which the node-scanning checker cannot see at
all. **Cutting over to the fixed rebuild retires all of that in one move**, which is a better use
of the effort than remediating a flow that is scheduled for deletion.

## What was fixed

**§1 pacing.** `Get Transaction Detail` ran 5 in flight / 500 ms = 10 req/s. `Get Flight Tickets`
and `Get All-Time Reversals` ran 3 / 750 ms — which is *exactly* 4 req/s, at the rate ceiling and
not over it, and still a violation: §1 caps **in-flight connections at 2** as well as the rate,
because three connections are three connections. All three are now 2 / 500. `Get Population Pages`
was already compliant at 2 / 750 and was left alone.

**§3 budget gate.** New `ERP Budget Gate` between `Build Page List` and `Get Population Pages` —
the first point at which the run knows its size and the last before any fan-out. It projects
pages + 3 calls per transaction and **hard-fails**; auto-capping would not only hide findings but
break `Population Guard`, which proves completeness by comparing rows pulled against
`totalElements`. It also stamps `run_id` onto the page items, because `Validate Inputs` keeps it
at `params.run_id` and the generated breaker block reads a top-level `run_id`.

**§5 breakers.** Four new nodes — `Judge Population Pages`, `Judge Detail Batch`,
`Judge Tickets Batch`, `Judge Reversals Batch` — each judging one fan-out and passing the batch on
unchanged. They are separate nodes rather than blocks pasted into `Population Guard`,
`Resolve Identity + Net Reversals`, `Score Deterministic` (15 KB) and `Rescore With Reversals`,
because a generated 10 KB block dropped into any of those makes the interesting code the minority
of the file. `Build Page List` carries a batch-of-one exemption: `Get Independent Count` makes a
single call, so none of the three thresholds can reach it, and that node already throws by name on
an expired token, `INSUFFICIENT_PERMISSIONS`, a `SecurityException`, a missing `totalElements` and
a zero count.

**§4 lease.** Acquire between `Respond 200 (accepted)` and the count call; release after
`Write Run`; `Release Lease (error)` → `Fail Loudly` on the rail. This flow needed the rail more
than its siblings, because **it is designed to refuse**: `Build Page List` and `Population Guard`
both throw by name rather than degrade, and every one of those deliberate refusals would have held
the lease until the 3-hour staleness backstop.

## What each breaker can and cannot do, stated in the node

All four call sites say which of §5's three thresholds actually fires there. `consecutive_failures`
is live everywhere. `degraded_rate` needs 20 samples, so it is live on the detail and ticket
fan-outs and **conditional** on the reversals one, which is one call per red ticket and can be
under 20 in a clean month. `latency` **cannot fire at all** in this flow: it compares a batch
against an earlier batch of the same key in the same run, and every fan-out here happens exactly
once. That is written into each node rather than left to be discovered, because a latency check
that silently never fires is the false-clearance shape this project keeps finding.

## The `neverError: true` interaction, and why the ERP nodes keep continueRegularOutput

Every ERP node here runs `neverError: true`, so an HTTP error arrives as an **item** carrying a
`statusCode` rather than as a thrown failure. That is exactly what lets the breakers count them —
and it is why those nodes must **not** be switched to `continueErrorOutput` when wiring the rail:
an error output would route the failures past the Judge node and leave it counting only successes.
The rail is hung off the Code nodes instead. `Get Population Pages` was moved from `stopWorkflow`
to `continueRegularOutput` for the same reason; `Population Guard` throws on any non-200 page, so
nothing is softened by it.

## Remaining warning, on purpose

`Inputs OK?`, `Needs Detail?`, `Any All-Time Lookups?`, `Any Verifier Cases?` and the three `Join`
merges can kill the run without reaching the rail. They are IF and Merge nodes, whose error output
is not at an index this project will guess at — guessing wrong is silent. The checker names them
every run rather than letting the rail read as complete.
