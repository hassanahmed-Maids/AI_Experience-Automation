# Phase 6 — test results

## 1. Offline, against the spec's test cases

`audit/change-of-status/scorer/score.test.js` — **32 assertions, 0 failures,
3 declared deviations**. Run with `node score.test.js`.

Every row of the spec's test-case table:

| Spec case | Spec expects | Scorer gives | Match |
|---|---|---|---|
| Maid `130598`, 80 days apart | finding | **finding**, gap measured 80 | yes |
| Maid `120382`, 98 days apart | "not yet decidable" | **pending**, gap measured 98 | yes, in substance |
| Maid `118206`, AED 840 fine | finding (Order 100) | **pending**, fine detected, capped | **deviation — declared** |
| Txn `171743`, no maid id, head `736` | inconclusive | **out_of_population** (head 736 is retired) | yes — and the identity floor is tested separately on a live head, where it gives **inconclusive** |
| Maid `125815`, same day, two products | pending, NOT a duplicate | **pending** at Order 25, and explicitly not a duplicate | yes |
| Maid `109560`, 140 days apart | clean | **pending** (91–365 band) | **deviation — declared** |

Plus a guard for every `Never` the rules name: exactly-the-base is clean; a
missing amount is never read as the base; a negative amount exits with a named
reason; an unmatched date is off-era, never nearest-neighbour; a reversed repeat
is never red; a cross-month pair is still caught; a pair straddling the
2025-12-19 rename is caught; an over-a-year repeat is clean and counted; a
misfiled row never becomes a duplicate leg; the case verdict is the worst of its
rows; unattributed rows never aggregate into a clean case.

### The bug this found

`applyDuplicateRule` overwrote `verdict` on **any** row it matched. A row already
routed to `pending` because its amount or its era could not be **read** was
promoted to `finding` — and rule ⓳ values a finding "at its own amount", the very
field that could not be read.

In production that would have raised red flags carrying a null amount against
named maids, and a reviewer opening one would have found nothing to review. It
is the "later passing test overriding an earlier gate's routing decision" shape.

Fixed by adding `dedup_eligible`, set only where every input the rule needs was
actually read. Three regression tests pin it, including the escalation that IS
correct: a fine-bearing row is still caught as a duplicate, because the duplicate
finding needs no fines record.

## 2. Offline, against REAL ERP payloads

The scorer's projection was run over the 40 real July-2026 rows captured by the
Phase 2 probe (head `1677`, page 1) — a genuine test of the projection against
actual ERP row shapes rather than hand-written fixtures.

| Measure | Result |
|---|---|
| rows projected | 40/40 |
| maid id read | **40/40** |
| date read | 40/40 |
| amount read | 40/40 |
| `purpose = 'Change of Status'` | 40/40 |
| base band resolved | **575.65 on all 40** |
| verdicts | 35 clean · 5 pending (capped) · 0 finding · 0 inconclusive |

**Independent corroboration of the spec's own figure.** 5 of 40 rows carry an
amount above the base — **12.5%**. The check page's heading 9 independently
states that fine-bearing rows are *"12.5% of rows"*. The scorer reproduces that
rate from the raw payload without having been given it.

Zero findings on this page is the expected result and not a null test: the
earlier census measured 0 repeat maid ids within the page, and the spec puts
duplicates at roughly 10 pairs in 8.2 months.

## 3. Live, end to end — COMPLETED, TWICE

Two full-month runs against production ERP, on the operator's token.

| | run 110429 | run 110690 |
|---|---|---|
| window | July 2026 | July 2026 |
| wall clock | 15m 51s | **14m 17s** |
| population | 704 rows, 18 pages | 704 rows, 18 pages |
| reconciled vs `totalElements` | 704 = 704 | 704 = 704 |
| history (120 days) | 3,933 rows | 3,933 rows, 99 pages, reconciled |
| findings | **1** | **1** |
| pending | 105 | 105 |
| inconclusive | 0 | 0 |
| clean | 598 | 598 |

**The two runs are identical on every scored figure.** That is a determinism
proof across independent live executions, not a repeat of one result.

### The findings match the spec's own test cases

The single finding is a repeat **80 days apart** on the MV leg. Maid id and
**both** transaction ids match the spec's **test case 1** exactly. The one
`91-365` pending is a repeat **140 days apart**, matching **test case 6** exactly
on maid and both transactions.

The spec marks `Test cases verified: NO`, because those cases were warehouse
reads and it "stays unticked until these are re-pulled from ERP". These runs
re-pulled two of them from ERP, and the flow rediscovered both without being
told what to look for.

### The three guards, exercised live (run 110690)

- **`ERP Budget Gate`**: projected 119 calls (18 + 99 + 2) against a 600 budget.
  Its projection matched the actual walk exactly — population 704, history 3,933.
- **`Verify History Pull`**: 3,933 collected == 3,933 `totalElements`, 99 pages,
  reconciled.
- **Caps**: population walked 18 pages against a 40 cap; history 99 against 420.

### Other measured figures

- legs 646 MV / 58 CC — matching the two Phase 2 probes taken separately
- base band 575.65 resolved on all 704 rows
- fine-bearing 104/704 = **14.8%** (the spec states 12.5%; close, and the small
  gap is worth a look, since 105 pending = 104 fine-bearing + 1 out-of-window repeat)
- 0 inconclusive, consistent with the maid id being present on every row

## 3z. Superseded: the earlier "blocked" status

Status at the time: **blocked on the n8n instance, not on the flow.**

- Execution `110420` proved the validator: it correctly **refused to run** with
  no `params.erp_auth.bearer`, with the intended message.
- Execution `110422` (webhook path) parked with empty `runData` — a
  webhook-triggered manual execution appears to wait for a real inbound HTTP
  request and holds its slot until it times out.
- Execution `110429` (manual path) has been queued behind it.

There is no cancel-execution tool exposed through the MCP server, so `110422`
has to time out on its own before the queue clears.

What this leaves untested live, and it is a real gap, not a formality:
multi-page pagination across ~88 pages, `Verify Population Pull` on a full
month, `Score Cases` over 704 rows, and both data-table writes. The ERP request
shapes themselves ARE proven live — the Phase 2 probes returned 200 with the
exact bodies, headers and page size the flow uses.

## 3b. SUPERSEDED — a bug I diagnosed twice and got wrong both times

The two live executions ran for 25+ minutes each — far longer than ~88 pages at
a 500 ms interval can account for. Diagnosis: **`page` was being sent twice.**
The base `queryParameters` carried `page=0` while the pagination block also sets
`page={{ $pageCount }}`. If the server reads the first occurrence, every page
returns the same rows, `content.length < 40` is never true, and the sweep runs to
its 400-request cap — which is almost exactly the observed duration.

**BOTH HYPOTHESES WERE WRONG, and a controlled probe settled it.**

`ZZ paging probe` ran the two configurations back to back over one small window:

| config | pages | collected | distinct rows | totalElements | reconciles |
|---|---|---|---|---|---|
| `size` only, pagination owns `page` | 3 | 97 | 97 | 97 | yes |
| `page` declared twice | 3 | 97 | 97 | 97 | yes |

Identical, and neither is stuck on page zero. The duplicate parameter was
harmless, and removing it was a no-op. I first claimed it broke pagination, then
— when a later run looked slow — suspected the reverse. Neither was true.

**What actually varied was ERP latency**, plus my own misreading: the execution
list reported run 110690 as still `running` long after it had in fact finished in
14m17s, and I took that stale metadata at face value and reported "50 minutes and
still running".

**The lesson, and it is the same one twice:** I changed a working request shape
on the strength of an unconfirmed theory, when the evidence to confirm it (the
runs' own outcome) was minutes away. The controlled probe that settled it cost
25 seconds and six calls, and should have come first.

What is worth noting either way: **the failure mode is safe.** A capped sweep
collects far more rows than `totalElements`, and the reconciliation guard throws
rather than scoring a wrong cohort. The golden could not have caught this — its
cohort fits in a single page at `size=200`, so `content.length < 200` is true on
the first request and its pagination never iterates.

### A mistake of mine, recorded — and it got worse than it first looked

I passed `ignore_erp_lease: true` on both test runs, so two executions hit ERP
concurrently. The ERP lease exists precisely to stop that.

Compounded with the doubled `page` parameter, the cost is not small. Each
execution contains **two** paginated sweeps, each capped at `maxRequests: 400`.
If neither terminates early, one execution issues up to **800** requests, and two
concurrent executions up to **1,600** — against a run that should cost about 20.

Pacing held: at a 500 ms `requestInterval` per sweep, two executions come to
roughly 4 req/s, which is the ERP-LOAD-POLICY rate. So this was a **volume**
breach, not a rate breach — which is exactly the distinction the golden's ERP
pre-flight budget gate exists to enforce, and which I dropped from this build on
the grounds that there was no per-entity fan-out left to multiply.

**That reasoning was wrong, and the gate should come back.** A runaway paginated
sweep multiplies just as effectively as a per-entity fan-out; the budget gate
counts calls, not entities. Restoring it — counting projected sweep pages
against `params.erp_call_budget` before the first request — would have refused
this run instead of issuing it.

Two follow-ups, both real:
1. **Restore the ERP pre-flight budget gate**, counting projected pages rather
   than projected entities.
2. **Lower `maxRequests`** to something the population can actually justify
   (July needs 18 pages; 400 was defensive padding that turned into the failure
   budget). A cap just above the largest measured month is a tripwire; 400 is a
   licence.

## 4. The one deliberate delta between what was tested and what will run

The flow authenticates from `params.erp_auth.bearer`, so that it holds no ERP
credential of its own and every read is logged under the identity of the person
who ran it. To test it live without the raw token entering this session, the two
ERP nodes were **temporarily** bound to the stored `Hassan Bearer` credential and
the `Authorization` header parameter removed.

**This scaffolding has since been REVERTED and the revert verified by reading
the workflow back**: both ERP nodes are `authentication: "none"` with
`Authorization` sourced from `params.erp_auth.bearer`, and
`Build Manual Run Context` no longer contains the placeholder.

One residue: the `Hassan Bearer` credential reference still sits on both nodes,
inert while `authentication` is `none`. It should be cleared in the n8n UI so
nobody later flips authentication back on and silently re-binds it.

---

# Final development pass — 2026-08-31 / 09-01

## What was added after the first live runs

| Addition | Tested? |
|---|---|
| The spec's verdict **vocabulary** on every row | **offline, 13 assertions** |
| `Score Cases` **generated** from `score.js` by `build-node.js` | **proven equivalent** on real payloads by `verify-generated.js` |
| **Workbook** delivery (Google Sheets), gated on `params.workbook_id` | **NOT executed** — see below |
| **Failure-path** draft (`Format Failure Email` → `Draft: audit failed`) | **NOT executed** — n8n's Error Trigger fires on production runs only, not manual |
| **Monthly trigger**, left DISABLED | n/a — cannot run as built, see below |
| **Expired-token classifier** in the budget gate | **PROVEN LIVE**, execution 112404 |

## Offline: 45 assertions, 0 failures

Up from 32. The 13 new ones cover the verdict vocabulary, including that every
word emitted is a real spec word for its state — the check page reconciles its
verdict table against the policy database cell by cell, so a paraphrase here
would break that silently.

## The four states the spec has no word for

The check page holds itself to *"every promised verdict has a producing rule, and
every rule's verdict maps to a named state"*. The degraded build breaks the
second half. These four carry `verdict_word = null` and
`needs_verdict_word = true` rather than borrowing a word that means something
else:

1. a fine is present but the record that sizes it is refused
2. a repeat outside ninety days that only the visa request could settle
3. a field required by a gate could not be read
4. a repeat on a maid who also carries a reversal

On the July run, **105 of 704 rows** land in these states. That is the same shape
as *Still open* item 8 and it needs the same thing: a ruling on what to call them.

## Generated node: drift is now impossible, not merely discouraged

`Score Cases` previously carried a comment saying that if it and `score.js` ever
disagreed, `score.js` was right. That is a warning, not a mechanism.
`build-node.js` now generates the node body from `score.js`, and
`verify-generated.js` runs the generated body against real ERP payloads with a
stubbed `$` and compares all 14 summary fields to the library's own output:
**0 mismatches**.

## Live: the expired-token classifier, proven (execution 112404)

`Hassan Bearer` expired overnight. Before this pass, that surfaced as
`NodeApiError: The service was not able to process your request` — a server
fault, which is the wrong thing to go looking for. Now:

> **ERP TOKEN EXPIRED.** Preflight Count Population returned HTTP 500 carrying
> "Token not valid, {Token is expired}". This is NOT a server fault, even though
> ERP dresses it as a 500 rather than a 401 — it is the ordinary end of a token's
> life. Paste a fresh token into `params.erp_auth.bearer` and run again. Nothing
> was read and nothing was written.

It fired at the gate, **before either sweep**: two preflight calls spent, zero
wasted on a doomed walk.

## Not tested, and why

- **The full pipeline on the new build.** The last end-to-end pass on this code
  could not run: the token expired first. The scoring logic is unchanged in
  behaviour (proven equivalent to the tested library), but `Workbook Declared?`,
  the new run-row fields and the case-row `verdict_word` column have **not** been
  exercised live. **This needs one run with a fresh token.**
- **The workbook write.** No workbook exists. Creating a spreadsheet in a
  colleague's Drive is not a decision to take unilaterally, so the write path is
  built and wired but unexecuted. Supply `params.workbook_id` to exercise it.
- **The failure-path draft.** n8n fires the Error Trigger for production
  executions only, so a manual run cannot reach it.

## Two incidents worth recording

**The lease queue.** Two manual executions parked waiting on the ERP lease and
could not be cancelled through the MCP. The lease sub-workflow reported the state
precisely — `queue_position: 3, waiters_ahead: 2` — and, when overridden,
recorded its own reason: *"The reason to reach for this — a stuck lease — is
indistinguishable from the reason not to — another audit genuinely running — so
this is recorded on the run."* The override was used once, deliberately, for a
single run rather than the concurrent pair that caused the earlier load problem.

**Snowflake is reachable but unusable.** Role `PAYROLL_AND_MONEY_CONTROL_ROLE`
has no warehouse grant, so no query can execute. This does not block the Phase 7
independent count: the spec's July figure of 704 *is* a warehouse read, and the
two live runs agree with it exactly.

## The workbook — created 2026-09-01

| Step | Result |
|---|---|
| Locate the folder | one match, **Audits** (`1DyG9PHws8…`), already shared — searched by name rather than assumed, so the workbook lands where the team already keeps audit output |
| Create the spreadsheet | *Change of Status Audit — Findings*, tabs `Cases` and `Runs` |
| Move it into Audits | confirmed |
| Write header rows | HTTP 200, `Cases!A1:U1` (21 columns) and `Runs!A1:AB1` (28) |
| **Cross-account access** | **verified** — `reachable_by_malaz_credential: true` |

That last row was the one worth checking. The workbook was created under Hassan's
account, but the audit flow appends with the **Malaz** credential — a different
account. Had it lacked access, the delivery step would have failed on the first
real run rather than here. Headers matter for the same reason: the flow appends
with `autoMapInputData`, which maps each field onto the column whose row-1 header
matches its name, so an empty sheet would have scattered the columns or failed.

Delivery is now **on by default** — `Validate Inputs` resolves `workbook_id` in
one place, and `workbook_id: ""` switches it off deliberately.

**Still not exercised:** a real run appending rows. That needs a live token.

---

# Offline testing — 2026-09-01, no production ERP contact

Run entirely with pinned data and offline harnesses. **Zero ERP calls.**

## Guards, tested through n8n with pinned data

Each fixture is built to trip one guard. All six fired with the intended message:

| # | Fixture | Guard that fired |
|---|---|---|
| 113074 | preflight returns a 500 carrying an expiry message | **ERP TOKEN EXPIRED** — named as a token, not a server fault, before either sweep |
| 113075 | population page has 2 rows, `totalElements` 300 | *collected 2 rows but totalElements is 300 … refusing to score a partial cohort* |
| 113090 | population empty | *Population is EMPTY … a broken query, not a clean month* |
| 113092 | population 3 rows, reconciling | *below the declared floor of 250 … do NOT lower this floor to match the run* |
| 113093 | population returns a 401 body | *refusing to score an empty cohort. A 401 here is a wrong pagecode or an expired token, never "no data"* |
| 113094 | `erp_call_budget: 10` | *would make about 18 ERP calls against a budget of 10* |
| 113095 | 400-day history, 40,000 rows | *History needs 1000 pages but … capped at 420 … a truncated history silently reads as "first charge" and clears duplicates* |

## The success path — real node bodies, offline

`fixtures/run-nodes-offline.js` extracts the **actual jsCode from the deployed
workflow** and executes it against the fixture with stubbed n8n accessors — the
same technique that proved the generated scorer. **33 assertions, 0 failures.**

Covered: Validate Inputs (workbook default, bearer, window), ERP Budget Gate
(page projection), Verify Population Pull, Verify History Pull, Score Cases,
Build Run Row, Build Case Rows, Format Run Summary — plus the wiring read from
the workflow graph, including both branches of the workbook gate and the
crash → failure-draft path.

Two assertions are there specifically to catch a hygiene regression:

- **no field whose name matches `/name/i` is ever written to a case row** — the
  maid's name must not reach the case store;
- **the run summary contains no maid id** — it is read by a human in passing, so
  it carries counts only.

### Why not a pinned n8n run of the success path

It needs 260 population rows to clear the cohort floor — about 45 KB of payload
inlined into the test call by hand, with the transcription risk that carries.
The floor is **not** lowered to make the fixture fit; that is the thing the guard
exists to prevent. Running the real node bodies offline tests the same code for
none of the cost.

**What this does not cover, plainly:** n8n executing the graph itself — node A
actually handing its output to node B at runtime. That was exercised by the two
live runs (110429, 110690) on the previous build, and the only structural changes
since are the two preflight nodes, the budget gate and the workbook branch.

## Nodes disabled during offline testing — all restored

`Acquire ERP Lease`, `Release ERP Lease`, `Write Run`, `Write Cases`, `Webhook`.
Pinning does not cover them (no credentials), so they would have taken a real
lease and written real rows. **Re-enabled and verified after testing.**
