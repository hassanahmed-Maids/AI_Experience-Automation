# ERP load compliance — Terminated Housemaid Tickets

Audited and **fixed** 2026-08-23 against `../ERP-LOAD-POLICY.md`. Two flows, **both were
untagged** and are now tagged `audit: Terminated HM`. Neither is live. Verdicts are
`tools/erp_compliance.py`.

| flow | id | live | verdict |
|---|---|---|---|
| 0-Fetch Profiles (sub-workflow) | `dhkfRbuaGv8MXzSG` | no | **PASSES** — was 3 findings |
| 1-Score (parent, webhook entry point) | `sXsn4NUYt4kh3OAU` | no | **PASSES** — was 9 findings |

Both were invisible to every coverage sweep in this project, because those sweeps work off the
`audit: *` tags. Neither is active, so the cost of the omission here was a gap in the record
rather than exposure.

## What was fixed

**§1 pacing.** `Get FT29 Transactions` is the paginated population sweep and had **no
`requestInterval` and no timeout** — pages back to back, a hung call holding its slot for ever.
Now 250 ms and 120 s. `Get Transaction Detail`, `Get All-Time Reversals` and `Get Housemaid Info`
all dropped from 5 in flight to 2.

**§3 budget gate.** New `ERP Budget Gate` between `Verify Population` and `Get Transaction
Detail`. Projects sweep pages + 3 calls per transaction and hard-fails. It budgets one profile
call **per transaction** rather than per unique maid, because identity is only resolved after the
detail call.

**§5 breakers.** Two new dedicated nodes, `Judge Detail Batch` and `Judge Reversals Batch`, each
judging one fan-out and passing the batch on unchanged — kept out of `Resolve Maids` (8.5 KB of
identity logic) and `Score Cases` (22 KB of gate logic), where a generated 10 KB block would make
the interesting code the minority of the file. Plus `Project Profiles` in the sub-workflow.
`Verify Population` carries the paginated-sweep exemption.

**§4 lease.** Acquire before the first ERP call, release after the run summary reaches the sheet,
`Release Lease (error)` → `Fail Loudly` on the rail hung off every single-output node in between.
The rail uses error **outputs**, not the Error Trigger: `On Workflow Crash` runs in a separate
execution where `$('Validate Inputs')` does not resolve, so it cannot name the run that holds the
lease, and a release that guesses is the silent-steal path the lease exists to prevent. `Fail
Loudly` re-throws, because n8n reports an execution that runs off the end of an error output as
**SUCCESS**.

**Fix the lease before activation, not after.** This flow is not live, so it is not currently part
of the broken-mutex problem — but it would have joined it the moment someone activated it. That is
now done.

## A gap this audit created, and closed

Same as the sibling: the sub-workflow's new breaker keys its baseline on `run_id` and nothing was
putting one on the chunk baton. `Baton For 0-Fetch` now does, and logs loudly when it is empty.

## What was already good here, and is worth keeping

`Project Profiles` carries the clearest statement of the `neverError` trap anywhere in the
codebase — that `retryOnFail` only fires because `neverError` is **off**, and that setting it true
would silence the throw and make the retry rule silently unimplemented. It also uses
`responseFormat: autodetect` on purpose, because ERP's error page is HTML and under `json` the node
emits a parse-error item with **no `statusCode` at all**, making a dead token indistinguishable
from an unclassifiable anomaly. Neither is a load-policy matter and both survived the edit intact.

## Remaining warning, on purpose

`Validation OK?` and `Post runs log?` are IF nodes whose error output is not at an index this
project will guess at. The checker names them every run rather than letting the rail read as
complete.
