# WF-E — CC Below Agreed · 0-Enrich Candidates  (`NDk03cYGF4XSXsk5`)

Stage 0, third of three. WF-A no longer enriches candidates itself: `Chunk Candidates`
splits them into chunks, `Enrich Candidates (WF-E)` calls **this** workflow once per chunk
(`mode: each`, `waitForSubWorkflow: true`), and `Join Enrichment` puts the returned deltas
back onto the cases. The raw plan and replacement bodies **die with each chunk's
sub-execution**.

It replaces four WF-A nodes: `Get Contract Plan`, `Attach Plan`, `Get Replacements`,
`Attach Replacements`.

## Why it exists

Run 92534 (2026-08-18) crashed at 38m36s with **both sweeps already staged and both
successful** — 16m57s after the last sweep, with nothing but this chain still running. See
`VALIDATION.md` §15.

`Attach Month Payments` sets `needs_enrichment = received_anything`, and measured on the
real July pull **5,632 of 5,651 distinct CC contracts received something** — the gate
excludes 19. Each survivor cost two calls, re-probed live the same day:

| call | measured | per candidate |
|---|---|---|
| `get-client-details?type=CONTRACT_DETAILS` | 200, **3,851 B** minified, **1.80s** | 1 |
| `replacement/page/contract/{id}` | **401**, 185 B, 1.11s | 1 |

That is **~22.7 MB of raw bodies** retained for the life of the run, plus a copy of every
case at each of four node outputs.

## What it does and does not fix

**Fixes:** WF-A's retention of the raw bodies (~21.7 MB of plan responses and ~1.0 MB of
401s never cross the boundary), and three of the four retained node outputs — the chain
becomes ids-in (0.34 MB), deltas-back (~5.6 MB), assembled once (~14 MB, as before).
Net **~22 MB off the projected peak**, taking it from ~95 MB toward ~73 MB against a
measured kill band of 100.6–142.6 MB.

**Does not fix:** the call count. 11,264 calls are still 11,264 calls, chunks run
**sequentially**, and the run is still ~26 minutes of enrichment. Cutting that needs a bulk
source for the contract monthly rate — the open question in
`askcode/q-bulk-contract-rate.md`. **Do not read this workflow as a cost fix.**

## Contract with WF-A

**Input** (defined trigger fields; `Chunk Candidates` maps them):

| field | value |
|---|---|
| `bearer` | from `params.erp_auth.bearer` |
| `cases` | array of `{case_key, contract_id, client_id}` — **ids only**, never whole cases |
| `chunk_index` | 0-based |
| `run_id` | for log correlation |
| `replacements_grant` | **optional**, added 2026-08-24 — `granted` \| `denied` \| `inconclusive`, the verdict of WF-A's once-per-run ClientReplacement probe. Anything else, including absent, makes WF-E probe for itself. |
| `replacements_grant_probe` | **optional**, diagnostic only — `{http_code, marked, source}`. Nothing routes on it; it exists so `_replacement_permission_denied_unmarked` keeps its meaning across the hop. |

**Output**: ONE item — `{ enriched: [ {case_key, contract_id, client_id, plan,
replacements, replacements_meta} ], _candidates, _plan_fetch_failures,
_replacement_fetch_failures, _replacement_permission_denied, _chunk_index }` — emitted by
`Project Replacements` when the phase ran and by `Skip Replacements` when it did not, in the
same shape and with the same counters. WF-A cannot tell which node produced it, and that is
deliberate: see *The ClientReplacement grant probe* below.

The `plan` delta also carries **gate 35's inputs**, added 2026-08-19:
`monthly_schedule_starts` (the `(Monthly)` prose line's date, yyyy-mm-dd),
`monthly_schedule_starts_raw`, `monthly_schedule_date_is_today`, and `one_time_dates`. WF-A's
`Guards` node compares the first against the audited month; WF-E emits dates rather than a
verdict because it does not know which month is being audited. The delta also states
`plan_line_amounts_are_ex_vat: true` — measured at exactly 1.05 against `currentPayment` on
four contracts — because comparing a prose amount to `currentPayment` without adding VAT
would report a 5% shortfall on the entire compliant population. **Only the dates are read;
no prose amount is.**

`Join Enrichment` merges each delta onto its case **by `case_key`**, and emits exactly the
shape the old `Attach Replacements` handed `Merge Streams` — so `Compute Case States` was
not touched.

## The ClientReplacement grant probe (2026-08-24) — ~5,632 refused calls become 1

`Fetch Replacements` calls `GET /complaints/replacement/page/contract/{id}` under pagecode
`ClientReplacement`, once per candidate. On an operator whose ERP identity lacks that grant,
**every one of those calls returns 401 INSUFFICIENT_PERMISSIONS** — on the real July cohort,
**~5,632 refused requests per run**, every one of them known to fail before it was sent. The
denial is **account-scoped, not check-scoped**: measured 2026-08-23, the same route returns 200
on another operator's token (`PROBE-RESULTS` correction 2). So it is a real permission gap and
not a flow bug — but rediscovering it 5,632 times a run is indefensible load on production ERP,
and `ERP-LOAD-POLICY.md` §1 now counts it as ~23 minutes of ERP time per run.

The chain is therefore gated:

```
Project Plan -> Probe Replacements Grant  (ONE call, executeOnce)
             -> Restore Chunk Items       ($('Project Plan').all() - the existing idiom, so the
                                           fan-out gets its 750 items back)
             -> Replacements Granted? --true--> Fetch Replacements -> Project Replacements
                                      \-false-> Skip Replacements
```

**Inside WF-E this is once per CHUNK, not once per run, and the difference is stated rather than
rounded away.** A WF-E execution handles one chunk and separate executions share no memory. At the
deployed chunk size of 750, a 5,632-candidate cohort is **eight executions**, so a denied run made
**8** refused replacement calls instead of ~5,632.

**Two corrections to numbers this file used to print.** It said *nine*, on the arithmetic
"a 50-candidate canary plus eight chunks". **The canary is not deployed** — see *The canary chunk
is in the repo and not in the instance* below — so live it was eight, not nine. And as of the same
day it is **one**: WF-A now probes once per RUN and passes the verdict down. See the next section.

### The last hop: WF-A probes once per RUN, and WF-E takes its word for it

`uJ8UVNKdN2s5PHHA` — WF-A — runs once per run, which is the thing WF-E cannot be. It now carries
its own `Probe Replacements Grant` (one `executeOnce` call, immediately after `Chunk Candidates`,
inside the lease) and a `Classify Grant Probe` node that stamps the verdict onto every chunk before
`Enrich Candidates (WF-E)` hands it over:

```
Chunk Candidates -> Probe Replacements Grant (ONE call, executeOnce)
                 -> Classify Grant Probe   (three-way verdict onto every chunk)
                 -> Enrich Candidates (WF-E)   +replacements_grant, +replacements_grant_probe
```

and inside WF-E:

```
Project Plan -> Caller Passed a Verdict?
   --true (granted|denied|inconclusive)--> Apply Caller Verdict ----\
   --false (absent / empty / unrecognised)-> Probe Replacements Grant -> Restore Chunk Items --\
                                                                                                +-> Replacements Granted?
```

**Be honest about what this is worth.** It saves **7 refused calls out of ~11,264**, about
**0.06%** of a run. It is worth having only because it is total: after it, the number of calls a
denied run makes that were known to fail before they were sent is **one**.

**The fallback is not optional and not decoration.** WF-E is callable standalone and by older
callers. `Caller Passed a Verdict?` accepts *only* the three known verdicts, normalised for case
and padding; **absent, empty string, `null`, a boolean, a number, a misspelling — all of them route
to WF-E's own probe** and the workflow behaves exactly as it did before WF-A learned to probe. n8n
fills a declared-but-unsent string field with `""`, so "I passed nothing" and "I passed a verdict"
must be distinguishable, and they are. There is deliberately no fourth meaning and no default:
`Apply Caller Verdict` **throws** rather than guess, because guessing `granted` would spend a whole
chunk of refused calls and guessing `denied` would declare a permission gap nobody measured.
`offline/enrich_test.js` runs the deployed IF condition itself — mirrored verbatim in
`nodes/caller_verdict_gate.js` — over every one of those inputs, and then asserts that what the
fallback path produces is **identical, key for key and value for value**, to what the caller path
produces. The fallback is not a degraded mode; it is the same answer bought at a higher price.

**The two ends cannot drift apart.** `Classify Grant Probe` (WF-A) and `Restore Chunk Items` (WF-E)
carry byte-identical `httpCodeOf` / `failureText` / `isTokenDead` / `isPermissionDenied`, and the
suite asserts that rather than trusting the comment that says so — one 401 must not mean two things
depending on which end of the hop saw it.

**A dead token throws in WF-A**, before the ~11,264-call enrichment phase rather than 11,264 calls
into it, for exactly the reason it throws in WF-E: an empty maid history scores as *"no maid
change"*, so a dead session has to be named as a dead session and never reported as a permission
gap.

#### The regression this buys, stated rather than buried

Probing per chunk meant a grant **revoked mid-run** was re-detected by the next chunk, and every
chunk after it skipped. Probing once per run loses that. If the grant is revoked after WF-A has
answered `granted`, every remaining chunk is told `granted`, `Fetch Replacements` 401s through all
of them, `Project Replacements` counts them denied and **the gap is still declared** — nothing reads
as falsely clean — but the refused calls are made.

**The bound is the REST OF THE RUN, not one chunk.** Worst case ~5,632 refused calls, which is
exactly what this flow did on every denied run until 2026-08-24. Before this change the bound was
one chunk (≤750). That is a real widening of the blast radius on a rare event, bought with seven
calls on the everyday one, and it is written down here rather than rounded to "the same bound the
opt-out already permits", which is what it is not.

**Reversing it is one edit and no rebuild:** delete `replacements_grant` and
`replacements_grant_probe` from WF-A's `Enrich Candidates (WF-E)` input mapping. WF-E's gate then
sees nothing usable, every chunk probes for itself, and the one-chunk bound is back — at a cost of
seven refused calls per denied run.

### The verdict is three-way, and the third value is the one that keeps it safe

| verdict | what it is | what happens |
|---|---|---|
| `granted` | the probe returned a replacement page | the phase runs, exactly as before |
| `denied` | 401/403 with no dead-token marker | the phase is skipped and the gap is **declared** |
| `inconclusive` | 5xx, timeout, 404, anything else | **the phase runs anyway** |

The verdict crosses the WF-A → WF-E boundary **as a verdict**, never as a boolean.
`false` would have to mean both *"refused"* and *"we could not tell"*, and those have opposite safe
answers. `granted` and `inconclusive` both mean "run the phase" and are still kept apart, because
the run log has to be able to say which of the two happened: one is an answer and the other is the
absence of one.

A transient must never be allowed to mean "no grant": one bad second would otherwise convert a
whole chunk into declared non-coverage. Falling through costs calls and loses nothing, and the
real batch is then judged by `Project Replacements`' own breaker. A **dead token throws** in
`Restore Chunk Items` rather than being reported as a permission gap — the flow already knows how
to name that state and the diagnosis matters.

### What `Skip Replacements` emits, and why the count is the whole point

It emits `Project Replacements`' **exact** output shape. Every counter WF-A reads carries the
**same number a fully refused chunk carries today**:

```
_replacement_permission_denied        = the number of contracts NOT ATTEMPTED   (not 0)
_replacement_fetch_failures           = the same number
replacements_meta.fetch_failed        = true   -> coveredDays() returns known:false
replacements_meta.permission_denied   = true   -> Join Enrichment rolls it into the run log
replacements_meta.token_dead          = false
replacements                          = []
```

`fetch_failed: true` is load-bearing. `Compute Case States`' `coveredDays()` reads it and returns
`{known: false, why: 'replacement_fetch_failed'}`, so gate 7 marks coverage **unknown** and routes
the case to a human. An empty maid history with `fetch_failed: false` would walk as *"no maid
change"* and clear cases nobody looked at.

**Trading ~5,632 wasted calls for a false all-clear would be a bad deal, and it is not the deal
made here.** If skipping set the denial count to 0, a capped run would start reading as a complete
one — the execution-100409 false-clean shape. `offline/enrich_test.js` pins it two ways: directly
(`_replacement_permission_denied === N`), and by running both paths over the same chunk and
asserting that every counter, every `replacements_meta` field gate 7 reads, and the full top-level
key set are identical.

Three fields are **additive** and nothing downstream reads them — `replacements_meta.not_attempted`,
`_replacement_phase_skipped`, `_replacement_skip`. They exist so a person can tell *"we were
refused"* from *"we did not ask"*; the counters deliberately do not make that distinction, because
what the audit **knows** is identical either way.

### Two things about `Project Replacements` that were deliberately NOT changed

**`callsMade` is still `responses.length * 2`.** A granted chunk now makes **2N+1** ERP calls — N
plan reads, one probe, N replacement reads — and `elapsedMs`, stamped in `Read Chunk`, does include
the probe. The bias that leaves on `ms_per_call` is **+0.07%** on the divisor against a **3×**
threshold, which moves no verdict. It is left alone because correcting it means re-transmitting
35 KB of the node that classifies permission denials, dead tokens and every breaker input **by
hand** — and a transcription error there is the one class of mistake a stale-export check cannot
catch (`exports/README.md`). Fix it the next time that body is regenerated by a tool. Recorded on
the node itself (`parameters.notes`) and pinned in `offline/enrich_test.js` so it stays a decision
rather than an oversight.

**The `config: { authWall: false }` opt-out is KEPT — and one leg of its reasoning has been
withdrawn.** The probe removed the *everyday* reason the wall would have fired: on a denied account
`Project Replacements` is not reached at all, so the full-denial batch is never made. What is left
is the case no probe can cover — the grant answering the probe 200 and then refusing the batch
behind it.

Until the WF-A hop, that argument ended *"and the probe re-runs per sub-execution, so a mid-run
revocation is re-detected by the next chunk; the blast radius of not tripping is one chunk, the same
bound the wall itself would have given."* **That sentence is no longer true when WF-A is driving**,
because the probe no longer re-runs per chunk — see *The regression this buys* above. The real bound
is now the rest of the run.

The opt-out survives that correction on the other three legs, which are untouched and are the ones
that always did the work: the phase is an **optional** enrichment, its denial is **account**-scoped
(PROBE-RESULTS correction 2), the same chunk's plan phase **succeeded**, and the gap is **already
declared** in this node's own counters — `coveredDays()` still returns `known:false` and gate 7 still
caps coverage on every one of those chunks. What is traded is ERP load on a rare event against
ending a run over an enrichment that is optional by declaration, and ending the run is still the
worse of the two.

**The lever, named so it is a choice rather than an oversight.** Turning `authWall` back on would
restore a one-chunk bound — the wall trips on the first fully refused batch — at the cost of killing
the run. That is a more defensible choice than it was this morning, precisely because the everyday
full-denial batch no longer reaches this node from either probe. **It is not made here:** it changes
what a revocation does to a run, which is a decision for whoever owns the run, not for whoever is
removing calls. The cheaper lever is the one in *The regression this buys*: drop the two fields from
WF-A's mapping and the per-chunk bound returns for seven calls.

A dead token was never covered by the opt-out and still is not: that throws above the breaker, in
`Restore Chunk Items` or, with WF-A driving, in `Classify Grant Probe` before enrichment starts.

### What this does NOT touch

- **`Chunk Candidates`' §3 projection.** It still projects `cohort_size × 2`. With WF-A probing,
  the true cost is `2N + 1` on a granted run and `N + 1` on a denied one, so the projection is now
  **one call low** on a granted run (11,265 against a projected 11,264, **0.009%**) and ~5,631
  calls **high** on a denied one. Both errors are in the safe direction for a gate that hard-fails
  on over-projection. **Declared, not corrected**, for the same reason as the `callsMade` divisor:
  correcting it means hand-retransmitting the 9 KB body of the node that decides whether the run is
  allowed to start at all, and a transcription error there is the one class of mistake a
  stale-export check cannot catch. The fix when that body is next regenerated by a tool is to add a
  fixed-cost term (`ERP_PHASE_FIXED_CALLS = 1`) to `projectedPhase` rather than bend
  `ERP_CALLS_PER_ENTITY`, which is genuinely 2. Recorded on the node's `parameters.notes` and
  pinned in `offline/enrich_test.js`.
- **`Fetch Replacements`' editor note.** Its top-level `notes` field still contains the sentence
  *"the first thing to switch off if runtime matters more than readiness"*, which this change
  makes automatic. `update_workflow` has **no operation that reaches top-level `notes`**
  (ERP-LOAD-POLICY.md §4), so the correction was written as an addendum in `parameters.notes`,
  where every checker in this repo reads it but the n8n editor does not render it. Worth five
  seconds in the editor next time someone is in there. The same applies to `Probe Replacements
  Grant`'s and `Restore Chunk Items`' top-level notes, which still say the WF-A hop is "NOT done
  here"; addenda saying otherwise are in their `parameters.notes`.

### The canary chunk is in the repo and not in the instance (found 2026-08-24)

Everything in this repo that computes *"a 50-candidate canary plus eight chunks = nine executions"*
— this file until today, `ERP-LOAD-POLICY.md` §5, and four assertions in `offline/enrich_test.js` —
is arithmetic about a body that **is not running**. `cc-below-agreed/wf-e/wfa/chunk_candidates.js`
contains the canary (`params.erp_canary_chunk_size`, the `is_canary` flag, the
`calls_before_the_breaker_can_first_speak` log line); the **deployed** `Chunk Candidates` in
`uJ8UVNKdN2s5PHHA` does not, and neither did the 2026-08-23 export taken from the instance. Live,
5,632 candidates split into **8 chunks of 750** with no canary, so the breaker's first verdict costs
~1,500 calls and not ~100 — which is the saving §5 says the canary exists to buy.

**Not fixed here, on purpose.** Deploying the canary is a change to chunking that nobody asked for,
and deleting it from the mirror would throw away work that may simply never have been published. It
needs a decision. Until then, read every "nine executions" in this repo as **eight**, and read the
canary's protection as **not present**.

## Chunk size is a memory budget, not a throughput knob

Default 750, override with `params.enrich_chunk_size`, clamped to WF-E's own ceiling of
1,200 (`CHUNK_MAX` in `Read Chunk`). 750 × 3,851 B is ~2.9 MB of plan bodies per
sub-execution. Raising it buys nothing: chunks are sequential, so runtime is identical and
the only thing that changes is how much one sub-execution holds.

## What it refuses to do

- **Enrich without a bearer.** Every call would 401, and a 401 on the plan read presents
  downstream as an unreadable contract rate — which routes the case to a human as CANNOT
  TELL rather than failing. That is the worst direction to fail in, so it is refused twice:
  in `Chunk Candidates` and again in `Read Chunk`.
- **Accept a chunk over 1,200**, which would retain the megabytes this workflow exists to
  release — moving the crash rather than removing it.
- **Shorten a chunk.** A candidate missing any of the three ids is an error, not a skip:
  the two projections pair **positionally**, so a changed item count would price one
  contract from another's plan.
- **Return fewer deltas than candidates.** WF-A cannot tell a missing delta from an unsent
  candidate, so `Join Enrichment` treats it as a hard error and names the count.

## Pairing: positional inside a chunk, by key across chunks

Inside one chunk, positional pairing is safe *because* both HTTP nodes run
`alwaysOutputData` with `onError: continueRegularOutput` and therefore emit exactly one item
per input item even when a call fails. Both settings are load-bearing and both projections
throw on a count mismatch. Across chunks there is no position to trust — chunk 3's third
delta is not the third case — so `Join Enrichment` joins explicitly by `case_key` and
refuses duplicates.

## The regexes are written without backslashes, deliberately

`Project Plan` is lifted from WF-A's `Attach Plan` and must stay behaviourally identical,
but a body shipped into a Code node as a string is exactly where a backslash class gets
eaten. So `[.]` replaces `\.`, `[ ]+` replaces `\s+`, `[(]Monthly[)]` replaces
`\(Monthly\)`, and newlines are flattened with `String.fromCharCode(10)` first so the
narrower space class cannot change an outcome. `offline/enrich_test.js` runs both forms over
the same strings and asserts they agree.

## Tests

`node wf-e/offline/enrich_test.js` — **130/130** (plus the plan-date cases in `offline/guards_test.js`), covering all seven WF-E Code/IF nodes and WF-A's `Classify Grant Probe`: the fan-out and
every refusal, the discount prose parsing (including "1000 over 4 months" = 250/month and
the non-empty string describing a zero discount), an empty `amountValue` reading as unknown
rather than zero, ERP error bodies as fetch failures, the `newHousemaid: ""` no-successor
signal, truncated histories, the 401 counted separately, chunk splitting and clamping,
the join's missing-delta / duplicate-key refusals, the whole grant-probe / skip path
(including the pin that the declared gap survives the skip), and the WF-A hop: the deployed IF
condition run over every input a caller can produce, the three-way verdict surviving the boundary,
a caller-supplied denial producing byte-identical output to WF-E's own probe AND to a chunk that
made every call and was refused, and the fallback proving that with the flag absent nothing
changed. With
`WFE_LIVE_PLAN_FIXTURE=<path to a real get-client-details response>` it also asserts the
live payload parses — flags only, never the amount, which is client financial data.

## Nodes

1. `When Called` — `executeWorkflowTrigger`, six defined input fields (four required by the
   contract, two optional grant fields added 2026-08-24)
2. `Read Chunk` — validates, fans out one item per candidate
3. `Fetch Contract Plan` — `POST /clientmgmt/client/get-client-details/{clientId}`, pagecode
   `ClientSummary`, batch 15 / 500 ms
4. `Project Plan` — gates 3, 4 and the gate-5 inputs
5. `Caller Passed a Verdict?` — IF; true when the caller sent `granted`/`denied`/`inconclusive`,
   false for absent, empty, `null` or anything unrecognised. Its condition is mirrored verbatim in
   `nodes/caller_verdict_gate.js` and executed by the offline suite
6. `Apply Caller Verdict` — takes WF-A's once-per-run verdict; makes **no ERP call**
7. `Probe Replacements Grant` — `GET /complaints/replacement/page/contract/{id}?page=0&size=1`,
   pagecode `ClientReplacement`, **`executeOnce`** — ONE call that asks whether this account
   holds the grant. **The fallback path**: reached only when the caller sent no usable verdict
8. `Restore Chunk Items` — classifies the probe, then re-emits `$('Project Plan').all()` so the
   fan-out below still gets its 750 items
9. `Replacements Granted?` — IF; true runs the phase, false skips it
10. `Fetch Replacements` — `GET /complaints/replacement/page/contract/{id}`, pagecode
   `ClientReplacement`, **401 today**, and no longer called at all on an account without the grant
11. `Project Replacements` — coverage rows, then collapse to one item
12. `Skip Replacements` — the same one item, with the permission gap declared for every contract
    that was not attempted

WF-A's two new nodes, `Probe Replacements Grant` and `Classify Grant Probe`, sit between
`Chunk Candidates` and `Enrich Candidates (WF-E)` — after the ERP lease is acquired, and after the
§3 budget gate, which `Chunk Candidates` itself carries.

Node bodies live in `nodes/` (WF-E, including `caller_verdict_gate.js` — the IF condition, mirrored
so the offline suite can execute it) and `wfa/` (the WF-A nodes: `chunk_candidates.js`,
`join_enrichment.js`, `classify_grant_probe.js`). The two WF-A bodies
were diffed byte-for-byte against the deployed copies; WF-E's three were read back and
checked line by line at every escape-sensitive point.
