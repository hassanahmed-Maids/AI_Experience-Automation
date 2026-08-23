# ERP load compliance — Dummy Tickets (Housemaids)

Audited and **fixed** 2026-08-23 against `../ERP-LOAD-POLICY.md`. Two flows, tag
`audit: Dummy Tickets HM`. **Both are live**, so both were deployed as drafts, byte-compared
against the repo sources, and only then published. Verdicts are `tools/erp_compliance.py`.

| flow | id | live | verdict | published |
|---|---|---|---|---|
| 0-Fetch Tickets (sub-workflow) | `YQlNlxrnhbQpBbdl` | yes | **PASSES** — was 3 findings | `c4fe970c` |
| 1-Score (parent, webhook entry point) | `aTmGMAlYLwsJQ7js` | yes | **PASSES** — was 11 findings | `881fb66d` |

## Scope: the rebuild only

`aTmGMAlYLwsJQ7js`'s own description names `FXrhGBJUnGYgrs9R` as the flow it rebuilds. That
pre-existing check is **out of scope** and untouched, per Moe's instruction that the audit covers
what the `erp-audit-flow-builder` skill produced.

## What was fixed

**§1 pacing.** `Get Dummy Ticket Transactions` had **no pacing of any kind** — no `batchSize`, no
`batchInterval`, no pagination `requestInterval`, no timeout. Every input item fired at once, pages
went back to back, and a hung call held its slot for ever. Now 2 / 500, 250 ms between pages,
120 s timeout. `Get Transaction Detail`, `Get All-Time Refunds` and `Get Hustler Tickets` all
dropped from 5 in flight to 2.

`Get All-Time Refunds` also had **no `onError` at all**, so its failure could reach no rail. It is
now `continueRegularOutput` rather than `continueErrorOutput`, deliberately: its failures have to
flow on as items for `Judge Refunds Batch` to count them.

**The sticky notes were the real hazard.** Both flows carried "**Pacing 5 concurrent / 500 ms**,
matching the golden's rail". That matched an *older* golden; 5/500 is 10 req/s against a 4 req/s
ceiling. A number in prose that contradicts the parameter is worse than no note, because it reads
as a deliberate compliance decision and stops the next reader looking. Both are rewritten, with
the number, the reason the in-flight count is capped separately from the rate, and what the flow
now declares.

**§3 budget gate.** New `ERP Budget Gate` in the parent between `Select Unresolved` and
`Get Transaction Detail`. Projects sweep pages + 3 calls per transaction and hard-fails. It
budgets one ticket call **per transaction** rather than per unique applicant, because identity is
only resolved after the detail call — a budget that assumes the happy case is not a budget.

**§5 breakers.** `Project Tickets` in the sub-workflow, plus two new dedicated nodes in the
parent (`Judge Detail Batch`, `Judge Refunds Batch`). `Verify Population` carries the
paginated-sweep exemption: that walk stops itself at the first failing page, sooner than a breaker
reading the finished batch could.

**§4 lease.** The parent now acquires before its first ERP call and releases after
`Verdicts -> Sheet` — the end of the delivery chain, **not** the last ERP call, because
`Get All-Time Refunds` runs downstream of the case and summary writes. A lease handed back early
is a lease two audits can hold at once. `Release Lease (error)` → `Fail Loudly` covers every
failing path. The sub-workflow declares `lease-held-by-caller` and `budget-gate-in-caller` rather
than implying them; both claims were previously false, because the caller held neither.

**`Verify Residue`'s blind spot**, closed with `continueRegularOutput` rather than a guessed
error-output index: `Merge Verdicts` fails closed by construction — "a model error, an unparseable
answer … leaves the ticket exactly as the deterministic gates left it. There is no path here by
which a confirmed loss becomes clean." The sibling Terminated Housemaids flow already did this;
the two were inconsistent for no reason.

## A gap this audit created, and closed

The sub-workflow's new breaker clears its latency baseline the moment it sees a **different**
`run_id`, and nothing was putting a `run_id` on the chunk baton. Every run would have looked like
the same run, the baseline store would never have been cleared, and chunk 1 of today would have
been judged against a baseline from days ago — the exact cross-run comparison the breaker is
written not to make. `Baton For 0-Fetch` now stamps it, and logs loudly when it is empty.

This is worth recording as a class: **a safety mechanism can arrive with its own precondition
unmet.** The breaker was correct, the flow was correct, and the seam between them was not.

## Why the latency rule is meaningful here and nowhere else in the chain

The parent's fan-outs each happen exactly **once** per run, so there is no earlier batch of the
same key to baseline against and the latency threshold can never fire — stated in both parent call
sites. The sub-workflow is different: it is called once per chunk of 25, so its baseline is taken
from chunk 1 and applied to the rest. `Expand Applicants` stamps `erp_t0` one node before its own
batch fires, so the clock measures that chunk and not the parent's whole run.

## Remaining warning, on purpose

`Validation OK?` and `Post runs log?` are IF nodes whose error output is not at an index this
project will guess at. `Validation OK?` runs before the lease is taken and cannot strand it;
`Post runs log?` can. The checker names both every run rather than letting the rail read as
complete.
