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

## The ClientReplacement grant probe (2026-08-24) — ~5,632 refused calls become 9

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

**It is once per CHUNK, not once per run, and the difference is stated rather than rounded away.**
A WF-E execution handles one chunk and separate executions share no memory. At the default 750,
a 5,632-candidate cohort is a 50-candidate canary plus eight chunks = **nine executions**, so a
denied run makes **9** refused replacement calls instead of ~5,632 — a **99.84%** cut, not 100%.
Collapsing those nine into one needs WF-A to probe and pass a flag down; that is a change to
`uJ8UVNKdN2s5PHHA` and it is **not** made here.

### The verdict is three-way, and the third value is the one that keeps it safe

| verdict | what it is | what happens |
|---|---|---|
| `granted` | the probe returned a replacement page | the phase runs, exactly as before |
| `denied` | 401/403 with no dead-token marker | the phase is skipped and the gap is **declared** |
| `inconclusive` | 5xx, timeout, 404, anything else | **the phase runs anyway** |

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

**The `config: { authWall: false }` opt-out is KEPT.** The probe removed the *everyday* reason it
existed — on a denied account `Project Replacements` is not reached at all, so the full-denial
batch is never made and the wall never sees it. What is left is the case the probe **cannot**
cover: the grant answering the probe 200 and then refusing the batch behind it, i.e. the state
changing mid-chunk. All three conditions the call site declares still hold there (optional
enrichment, account-scoped; the same chunk's plan phase succeeded; the gap is already declared),
and one more now does too: **the probe re-runs per sub-execution**, so a mid-run revocation is
re-detected by the next chunk and every chunk after it skips. The blast radius of not tripping is
therefore **one chunk** — the same bound the wall itself would have given. Removing the opt-out
would buy nothing and would let one optional grant kill a run. A dead token was never covered by
it and still is not: that throws above the breaker.

### What this does NOT touch

- **WF-A.** `Chunk Candidates` still projects `cohort_size × 2` for the §3 budget gate. On a
  granted run the real cost is now 9 calls higher (11,273 vs a projected 11,264, **0.08%**); on a
  denied run it is ~5,623 calls **lower** than projected. Both errors are in the safe direction
  for a gate that hard-fails on over-projection, so it is left alone rather than edited from here.
- **`Fetch Replacements`' editor note.** Its top-level `notes` field still contains the sentence
  *"the first thing to switch off if runtime matters more than readiness"*, which this change
  makes automatic. `update_workflow` has **no operation that reaches top-level `notes`**
  (ERP-LOAD-POLICY.md §4), so the correction was written as an addendum in `parameters.notes`,
  where every checker in this repo reads it but the n8n editor does not render it. Worth five
  seconds in the editor next time someone is in there.

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

`node wf-e/offline/enrich_test.js` — **92/92** (plus the plan-date cases in `offline/guards_test.js`), covering all five nodes: the fan-out and
every refusal, the discount prose parsing (including "1000 over 4 months" = 250/month and
the non-empty string describing a zero discount), an empty `amountValue` reading as unknown
rather than zero, ERP error bodies as fetch failures, the `newHousemaid: ""` no-successor
signal, truncated histories, the 401 counted separately, chunk splitting and clamping,
the join's missing-delta / duplicate-key refusals, and the whole grant-probe / skip path
(including the pin that the declared gap survives the skip). With
`WFE_LIVE_PLAN_FIXTURE=<path to a real get-client-details response>` it also asserts the
live payload parses — flags only, never the amount, which is client financial data.

## Nodes

1. `When Called` — `executeWorkflowTrigger`, four defined input fields
2. `Read Chunk` — validates, fans out one item per candidate
3. `Fetch Contract Plan` — `POST /clientmgmt/client/get-client-details/{clientId}`, pagecode
   `ClientSummary`, batch 15 / 500 ms
4. `Project Plan` — gates 3, 4 and the gate-5 inputs
5. `Probe Replacements Grant` — `GET /complaints/replacement/page/contract/{id}?page=0&size=1`,
   pagecode `ClientReplacement`, **`executeOnce`** — ONE call that asks whether this account
   holds the grant
6. `Restore Chunk Items` — classifies the probe, then re-emits `$('Project Plan').all()` so the
   fan-out below still gets its 750 items
7. `Replacements Granted?` — IF; true runs the phase, false skips it
8. `Fetch Replacements` — `GET /complaints/replacement/page/contract/{id}`, pagecode
   `ClientReplacement`, **401 today**, and no longer called at all on an account without the grant
9. `Project Replacements` — coverage rows, then collapse to one item
10. `Skip Replacements` — the same one item, with the permission gap declared for every contract
    that was not attempted

Node bodies live in `nodes/` (WF-E) and `wfa/` (the two WF-A nodes). The two WF-A bodies
were diffed byte-for-byte against the deployed copies; WF-E's three were read back and
checked line by line at every escape-sensitive point.
