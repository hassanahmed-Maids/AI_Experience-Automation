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
_replacement_fetch_failures, _replacement_permission_denied, _chunk_index }`.

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

`node wf-e/offline/enrich_test.js` — **39/39** (plus the plan-date cases in `offline/guards_test.js`), covering all five nodes: the fan-out and
every refusal, the discount prose parsing (including "1000 over 4 months" = 250/month and
the non-empty string describing a zero discount), an empty `amountValue` reading as unknown
rather than zero, ERP error bodies as fetch failures, the `newHousemaid: ""` no-successor
signal, truncated histories, the 401 counted separately, chunk splitting and clamping, and
the join's missing-delta / duplicate-key refusals. With
`WFE_LIVE_PLAN_FIXTURE=<path to a real get-client-details response>` it also asserts the
live payload parses — flags only, never the amount, which is client financial data.

## Nodes

1. `When Called` — `executeWorkflowTrigger`, four defined input fields
2. `Read Chunk` — validates, fans out one item per candidate
3. `Fetch Contract Plan` — `POST /clientmgmt/client/get-client-details/{clientId}`, pagecode
   `ClientSummary`, batch 15 / 500 ms
4. `Project Plan` — gates 3, 4 and the gate-5 inputs
5. `Fetch Replacements` — `GET /complaints/replacement/page/contract/{id}`, pagecode
   `ClientReplacement`, **401 today**
6. `Project Replacements` — coverage rows, then collapse to one item

Node bodies live in `nodes/` (WF-E) and `wfa/` (the two WF-A nodes). The two WF-A bodies
were diffed byte-for-byte against the deployed copies; WF-E's three were read back and
checked line by line at every escape-sensitive point.
