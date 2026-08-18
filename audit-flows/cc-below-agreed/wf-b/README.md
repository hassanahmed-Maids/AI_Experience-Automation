# WF-B — CC Below Agreed · 2-Verify  (`2LaIbHqQ1A2sEBKm`)

Stage 2 of 3. WF-A scores and hands over a baton; WF-B verifies one batch of
candidates against the month's message evidence, writes verdict rows, then either
self-calls for the next batch or hands off to WF-C (`yEF4BHYDZAnhBnYg`).

    node offline/baton_hops.js    # the multi-hop batching loop + the four refusal guards

## Why the split exists at all

n8n retains every node's output for the life of an execution, so WF-A's sweeps can
only be released by WF-A **ending**. Run 89604 died at 94m44s inside the measured
100.6–142.6 MB kill band; run 90669 grew past the point where its own record could be
read back. `Launch Verifier (WF-B)` therefore runs with `waitForSubWorkflow: false`.

## The four nodes authored here (the rest are lifted from WF-A unchanged)

`Validate Inputs` keeps WF-A's node name and output shape deliberately — every lifted
evidence node reads `$('Validate Inputs').first().json.params.erp_auth.bearer` and
`persistence_windows[0]`, so keeping both means their bodies run byte-identical. One
validation path per workflow, never two. The manual `Test Baton` path feeds the *same*
node, so a manual test cannot pass on a shape the real baton would fail.

`Select Candidates` also keeps WF-A's name, because `Resolve Quoted Amounts` reads
`$('Select Candidates').all()`.

## What the hop test is guarding

`has_more` is assigned **outside** the baton. On hop 1 it is true; the baton is passed
onward whole; a stale `true` on the final hop would send a zero-candidate self-call
instead of routing to WF-C — and WF-B's own `Validate Inputs` would then refuse it,
losing the run's verdicts. The test walks 7 candidates at batch size 3 and asserts
3+3+1, exactly one finish, and no extra self-call.

The four refusals are all "absent evidence must not look like clean evidence": no
candidates, no bearer (every read would 401 and every case would look unevidenced),
another check's baton (silent cross-contamination between audits sharing a verifier
shape), and no `persistence_windows` (the message window would be unscoped).

## Verified after deploy

The four lifted code nodes are byte-identical to WF-A's on executable lines. All 33
baked templates match, and the safety-critical invariant holds: the amount sits at
index 3 for `quotes_contract_rate` and index 1 for `quotes_requested_amount`, exactly
one value per family — a positional guess would cross them, which is the error rule 14
exists to prevent.
