# ERP load compliance — Applicant Real Ticket

Audited 2026-08-23 against `../ERP-LOAD-POLICY.md`. Three flows, tag `audit: Applicant Ticket`
(one of them tagged *by this audit* — see below). Verdicts are `tools/erp_compliance.py`, not
reading.

| flow | id | live | verdict |
|---|---|---|---|
| Refund Audit — the **live legacy** check | `7M7xzzYpOecao9PE` | **yes** | **FAIL** — the worst flow in the manifest |
| the audit check (draft, rebuild) | `YXRZdtk2Geeeqaal` | no | **FAIL** — close, four real gaps |
| publish results to Google Sheets | `B8r6dyuHz9kFC3HJ` | no | **PASS** — no ERP nodes at all |

## The legacy flow was invisible, and it is live

`7M7xzzYpOecao9PE` was **untagged**. Every coverage sweep in this project has worked off the
`audit: *` tags, so a tag sweep could not see it, the manifest never listed it, and
`erp_compliance.py --all` reported green over a set that did not contain the single worst
offender. It is tagged `audit: Applicant Ticket` as of 2026-08-23.

This is the same failure mode the manifest exists to prevent, one level up: the manifest stops
`--all` going green over a subset of the *exports directory*, but nothing stopped the export
list itself going green over a subset of the *instance*. See "What to change" below.

It predates `ERP-LOAD-POLICY.md` (created 2026-05-25; the policy is from June). Its numbers:

| node | pacing | rate | policy |
|---|---|---|---|
| `Get Transaction Detail` | 10 in flight / 200 ms | 50 req/s | 2 / 500 ms = 4 req/s |
| `Get Hustler Workflow` | 5 in flight / 300 ms | 17 req/s | same |
| `Get Transactions` (paginated) | no interval | pages back to back | 250 ms minimum |
| `Fetch All-Time for Flagged` | **a Code node calling `this.helpers.httpRequest` in a `for` loop** | unpaced, uncounted, invisible to the checker's node scan | — |

No timeout on any of the three HTTP nodes. No lease, no budget gate, no breaker, no error
trigger. `Fetch All-Time for Flagged` deserves its own line: pacing lives in the HTTP node's
`batching` options, and a hand-rolled loop inside a Code node has none — the checker flags the
flow for its *other* nodes and says nothing about this one, because there is no node parameter
to read. It is bounded only by how many applicants got flagged.

**It is webhook-triggered, not scheduled.** No flow in this manifest has a Schedule Trigger — the
live entry points all wait on a POST from the audit orchestrator. So this is not "it fires
tonight"; it is "the next time someone runs the Real Ticket check for a month, ERP takes 50 req/s
from one node with nothing able to stop it". That is a smaller window and the same size of hole.

## The lease guarantee is broken instance-wide

§4 exists so two audits cannot hit ERP at once — "per-flow pacing bounds ONE audit; two audits
running together is how ERP was taken down before". There are now **three live webhook entry
points** that reach ERP, and only one of them takes the lease:

| live entry point | takes lease `9gVijqvtLVEhQZXz`? |
|---|---|
| `CC Monthly Payments Below Agreed Amount` (WF-A) | yes |
| `Applicant Real Ticket Refund Audit` (legacy) | **no** |
| `Dummy Tickets Housemaids · 1-Score` | **no** |

WF-A can hold the lease and be perfectly compliant while either of the other two runs straight
through it. A mutex only one participant respects is not a mutex. This is the single most
important finding of this audit and it is not fixable inside any one flow.

## The rebuild is close, and its gaps are real

`YXRZdtk2Geeeqaal` is a serious piece of work — every ERP node timed out, an error trigger, a
population guard, redaction at the boundary. Four things still fail:

1. **§1 concurrency.** `Get Transaction Detail` at 5 in flight / 500 ms, and `Get Flight Tickets`
   / `Get All-Time Reversals` at 3 in flight / 750 ms. The second pair is *exactly* 4 req/s —
   at the ceiling, not over it — and still violates §1, because §1 caps **in-flight connections
   at 2** as well as the rate. The policy says so in as many words: "3 concurrent / 750 ms and
   2 concurrent / 500 ms are both 4 req/s, but the first holds three connections open at once."
2. **§3 no pre-flight budget gate**, with four per-item ERP nodes. Pacing bounds requests per
   second; nothing bounds how many.
3. **§5 no circuit breaker** on any of the five projection nodes.
4. **§4 no lease** — it is a webhook entry point that reaches ERP.

Fixing 1 is a parameter change. 2, 3 and 4 are the standard blocks (`tools/erp_preflight_gate.js`,
`tools/build_breaker_embed.py`, the lease pair) and should be generated, not hand-copied.

Fix the rebuild first and cut the legacy flow over to it: that retires
`Fetch All-Time for Flagged` and 50 req/s in one move, rather than spending the same effort
patching a flow that is scheduled for deletion.

## The publisher is genuinely clean

`B8r6dyuHz9kFC3HJ` touches Google Sheets and the data tables and nothing else — zero ERP nodes,
so §1/§3/§4/§5 do not apply and it passes without an exemption. It is in the manifest anyway,
because "this flow has no ERP nodes" is a claim worth re-checking on every run rather than
remembering.

## What to change (governance)

The manifest guards the exports directory. Nothing guards the manifest against the *instance*.
Both times coverage has been wrong it was because a list was built from something narrower than
reality — first the directory, now the tag set. The manifest now carries a `_scope` field naming
the six checks and calling out that Real Ticket has three flows and not two, but a field is a
note, not a check. A sweep that lists every workflow in the instance and fails on any ERP-touching
flow absent from the manifest is the actual fix; it is in `REMEDIATION-PLAN.md`.
