# ERP load compliance — MV Overstay Fines

Audited and **fixed** 2026-08-23 against `../ERP-LOAD-POLICY.md`. One flow, built by the
`erp-audit-flow-builder` skill and never brought to the load policy. It is a **DRAFT and stays
one** — nothing here was published, and `activeVersionId` is still null. Verdicts are
`tools/erp_compliance.py`.

| flow | id | live | verdict |
|---|---|---|---|
| MV Overstay Fines — generated v1 | `LDtsstXDfF99TnYe` | no (draft) | **PASSES** — was 16 findings |

The flow is untagged, so it is invisible to every `audit: *` coverage sweep in this project.
Nothing here changed that; it is a gap in the record rather than exposure, because the flow
cannot fire.

## What was fixed

**§1 pacing.** Five per-item ERP nodes ran at **batchSize 5 / batchInterval 500** — 10 req/s
against a 4 req/s ceiling, and five connections held open at once. `Get Transaction Detail`,
`Get Overstay Fines`, `Get Overstay Payments`, `Get Maid Complaints` and `Get Complaint Thread`
are now 2 / 500. `Get Change of Status Transactions` was already 1 / 500 with `requestInterval`
500 and `maxRequests` 50 and was left alone.

**Its sticky note was the real hazard**, and it is rewritten. "Every one is **batchSize 5,
batchInterval 500 ms**" matched the parameters exactly, which is worse than a note that
contradicts them: it read as a deliberate compliance decision and stopped the next reader
looking. The note now carries the number, why the in-flight count is capped separately from the
rate, and the twelve-calls-per-transaction cost the flow actually has.

**§3 budget gate.** New `ERP Budget Gate` between `Route by skip_computation` and
`Get Transaction Detail` — after the switch, so it counts the `in_range` items that will really
be enriched rather than the carried-forward cases that cost nothing. It declares **12 ERP calls
per over-base transaction** and hard-fails over budget.

That 12 is the finding worth keeping. Every sticky note and every prior reading of this flow
says "three calls per over-base transaction", and three is a quarter of the bill: the evidence
phase downstream of `Build Case Payload` makes **one complaints list plus up to eight threads
per red case** (`MAX_THREADS_PER_CASE = 8`, set in `Split Relevant Complaints`), and the run does
not yet know how many cases will be red when the gate runs. Worst case is one red per
transaction, so the gate budgets 3 + 9. At January's measured ~161 over-base transactions that
is ~1,937 calls plus 5 sweep pages, which fits the default 2,000 budget with nothing to spare —
a bigger month refuses and says so, naming both numbers.

**§5 breakers.** Five new dedicated nodes, one per fan-out, each judging its batch and passing
it on unchanged: `Judge Detail Batch`, `Judge Fines Batch`, `Judge Payments Batch`,
`Judge Complaints Batch`, `Judge Threads Batch`. They are separate nodes and not blocks pasted
into the neighbouring code for a structural reason, not a stylistic one: `Attach Identity`,
`Attach Fines` and `Attach Payments` all run **Once for Each Item**, so `$input.all()` does not
exist in them and they can never see a batch.

`Verify Cohort Pull` carries the paginated-sweep exemption. That walk stops itself sooner and
harder than a breaker reading the finished batch could — it throws on an ERP error body, on a
missing `content` array, on a walk that does not reconcile to `totalElements`, on an empty
cohort and on a cohort below the declared floor of 100 — all before the per-entity phase makes
one call.

**Three ERP nodes moved from `continueErrorOutput` to `continueRegularOutput`, and that is the
point of the section.** `Get Transaction Detail`, `Get Overstay Fines` and `Get Overstay
Payments` routed their failures to the error rail, which would have left their new breakers
counting successes only. A breaker that cannot see a failure is worse than no breaker, because
its green gets quoted. The breaker wins; the failures now arrive as items and are counted.

**§4 lease.** `Acquire ERP Lease` before `Get Change of Status Transactions`, released at
`Run Complete`. `Release Lease (error)` → `Build Error Callback` → `Fail Loudly` hangs off every
single-output node in between, and `Fail Loudly` **re-throws**.

The rail uses error **outputs**, not the Error Trigger: `On Workflow Crash` runs in a separate
execution where `$('Validate Inputs')` does not resolve, so it cannot name the run that holds
the lease, and a release that guesses is the silent-steal path the lease exists to prevent.

## Three things judged rather than followed

**1. The success release needed a terminus that did not exist.** `Build Case Payload` fans out
four ways. The run-row branch always runs but finishes *before* the red-cases branch makes the
last two ERP fan-outs, so releasing there hands the lease back while this run is still calling
ERP. The red-cases branch ends after every ERP call but produces nothing at all when there are
no reds — `Select Red Cases` returns `[]` and the whole branch, `Write Verdicts` included, never
executes. Neither is a safe release point on its own.

So a `Run Complete` merge node was added, fed by `Write Run (data table)` and
`Write Verdicts (data table)`, and the release sits after it. **This depends on n8n running a
Merge once an input branch has resolved without executing** — behaviour this flow already relies
on at `Merge Streams`, whose carry-forward and unattributed inputs are empty on most runs, but
which could not be exercised here: the flow is a draft and this environment has no ERP
credentials. It is the one runtime assumption in this remediation that was not verified.

**2. Inserting nodes into a chain that walks `pairedItem` backwards.** `Attach Identity`,
`Attach Fines` and `Attach Payments` run Once for Each Item and reach back with `$('...').item`.
`Merge with previous_cases` carries the scar in its own comments: n8n does **not** auto-assign
`pairedItem` for a node running Once for All Items, and the first live run past intake died on
exactly that. The budget gate and the three enrichment breakers are four new Once-for-All nodes
in that chain, so each of them pins `pairedItem: { item: i }` explicitly rather than trusting
`return $input.all()` alone, which is what the sibling flows do. The two evidence breakers do
not pin: nothing downstream of them reaches back with `.item`, and adding it would imply a
dependency that does not exist.

**3. The `Verify Red Flags` blind spot was closed rather than warned about.** An Agent's error
output is not at an index this project guesses at, so it could not be hung on the rail — and it
is the node most likely to fail on any given run, which made it the largest hole in the rail.
It is now `continueRegularOutput`, because `Merge Agent Verdicts` already fails closed: an
errored or missing verifier item becomes `decided_by: unreviewed` with the Auditor Review
Required fallback, counted as unreviewed and never reported as a model judgement. The sibling
Dummy Tickets flow closed `Verify Residue` the same way for the same reason.

## What the onError change costs downstream, and what was done about it

With the three enrichment nodes on `continueRegularOutput`, a failed read now reaches the
`Attach …` node as an n8n error item. All three already routed such an item to review rather
than scoring it clean, so nothing was mis-scored — but the review note would have described a
payload that never arrived. Each now branches on the error item first and names the real cause
(`detail_unreadable`, `fines_unread`, `payments_unread`).

`Attach Fines` also carried the sentence *"`Get Overstay Fines` runs with continueErrorOutput,
so a read that failed goes down the error rail rather than arriving here"*. That is now false
and is rewritten in place. A stale comment about error routing is the kind that makes the next
reader stop checking the parameter.

## Known gaps, stated rather than left to be found

- **The latency threshold can fire nowhere in this flow.** Every fan-out runs exactly once per
  run, so there is never an earlier batch of the same key to baseline against, and no node
  stamps `erp_t0`, so `elapsedMs` is null and the rule is disabled before the baseline question
  is reached. `baseline_carried` logs false on every batch. Each of the five call sites says so,
  because a green run must not be read as "all three thresholds looked and were happy".
- **`degraded_rate` is usually inert in the complaints phase.** That batch is one item per red
  case and a normal month reds far fewer than the 20 responses the rate rule needs. The
  consecutive rule is what watches that phase.
- **A failed complaints read still reads as "no complaints".** `Split Relevant Complaints` takes
  a failed item as a page with no `content`, so the case loses its evidence silently. That is
  pre-existing — `Get Maid Complaints` was already on `continueRegularOutput` — and is recorded
  in the `Judge Complaints Batch` call site rather than fixed here, since it is a scoring
  question and not a load one.
- **The cohort sweep asks for `size=200`.** §1's page-size rule is ≤ 100 rows for a
  nested/entity-shaped response, and `erp_load_check.py` does not check page size, so the node
  passes. It was left as found per the audit's scope; a transaction row is flat and small, but
  the number has never been measured for this route and should be before the flow goes live.
- **The lease `max_wait_ms` default is 10 minutes**, overridable with
  `params.erp_lease_max_wait_ms`. This instance cancels any execution 2400 s after it starts, so
  the wait budget is 2400 s minus the run's own duration minus margin. The flow does **not** use
  the §7 `no_wait` self-re-invoke pattern; that is the shape every new flow should use and it is
  outstanding work here.

## Remaining warnings, on purpose

`Validation OK?`, `Webhook Run?`, `Alert on rejection?`, `Route by skip_computation`,
`Merge Streams`, `Identity Resolved?`, `Portal Delivery Declared?`, `Needs the model?`,
`Join Verdict Paths`, `Agent Callback Declared?`, `Error Gate` and `Run Complete` are IF, Switch
and Merge nodes whose error output is not at an index this project will guess at. The checker
names them every run rather than letting the rail read as complete. `Validation OK?`,
`Webhook Run?` and `Alert on rejection?` all run before the lease is taken and cannot strand it;
the rest can.

## Files

Every deployed Code body was written to `../mv-overstay-fines/nodes/` first, `node --check`ed,
deployed, then re-fetched and byte-compared against its repo source — **11 of 11 match**. The
breaker call sites live in `../mv-overstay-fines/nodes/call-sites/`, which is what
`tools/make_breaker_block.py --call-site-file` reads to regenerate them.
