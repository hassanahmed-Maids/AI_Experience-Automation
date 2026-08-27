# D17 on Terminated HM and Dummy Tickets — 2026-08-27

Both flows **already downgraded correctly**. Neither retained a red on an unanswered call, and
that is worth stating because it changes what the fix is. The defect in both was the second
half of D17 — *"nothing in the output says the review did not happen."*

## Terminated Housemaids — a green light wired to nothing

`Merge Verdicts` was already right:

```js
if (!a) {                                   // the agent did not answer this case
  copy.verifier = { answered: false, reason: 'agent_did_not_answer_this_case' };
  copy.case_verdict = 'pending';
  copy.case_reason  = 'verifier_did_not_answer';
}
```

and it sets `verifier_expected`, `verifier_answered`, `verifier_unanswered`,
`verifier_malformed_answers` on `run_totals`. The Cases sheet already carried
`verifier_answered = NO`.

**But `Build Summary Row` read `t.verifier_failures` — a field `Merge Verdicts` never writes.**
So the run summary reported `verifier_failures: 0` on every run whatever the verifier did. A
column that always says "fine" is worse than no column, because someone trusts it.

Fixed in that one node: the four real counters now surface, `verifier_failures` keeps its
original name (so the existing sheet column keeps working) but carries
`unanswered + malformed`, and a new `verifier_complete` says `yes` / `NO` / `n/a - nothing
routed` in one glance. The per-case logic was not touched.

## Dummy Tickets — the summary is written before the verifier runs

This one could not be fixed the same way, and the reason is structural:

```
Build Summary Row → Run Summary → Sheet → Select For Verifier → … → Verify Residue → Merge Verdicts
```

The run record — sheet row *and* Runs table row — is written **before the verifier is even
selected**. No field added to the summary could ever report on it.

Per *case* the signal was already there: `Build Verdict Rows` writes `model_verdict: NO_ANSWER`
onto the Verdicts sheet. And `Merge Verdicts` computes a real starvation tripwire
(`suspected_starved_verifier`) — which **nothing read**. It is attached to
`out[out.length-1].json.__counters`: the last item only, and gone entirely when the merge
produces no items — i.e. missing in exactly the run that matters most.

So two nodes were added **after** `Verdicts -> Sheet`:

- **`Record Verifier Outcome`** — recomputes the outcome from `Merge Verdicts`' own decision
  rows rather than trusting `__counters`. Counts a bundled case that never came back out of the
  merge as unanswered, because counting only what returned would report a clean review for a run
  that lost cases. Refuses (throws) if no `run_id` can be resolved, rather than stamping a blank
  key.
- **`Stamp Verifier Outcome On Run`** — updates the Runs row this execution already wrote,
  matched on `run_id`.

Five columns added to `Dummy Tickets — Runs`: `verifier_expected`, `verifier_no_answer`,
`verifier_auditor_review`, `verifier_starved_suspected`, `verifier_complete`.

## Verified

- TermHM: summary node replaced, one node, no other change.
- Dummy: both nodes wired (`Verdicts -> Sheet → Record Verifier Outcome → Stamp Verifier
  Outcome On Run`), body parses, `executeOnce` on both.
- **9/9 unit tests** on `Record Verifier Outcome` (`tests/test-rvo.mjs`): all-answered → `yes`;
  one `NO_ANSWER` → `NO`; a case lost by the merge counted as unanswered; **verifier returned
  nothing at all** → all bundled cases counted and `run_id` falls back to `Validate Inputs`;
  nothing routed → `n/a` rather than a false alarm; starvation detected; starvation *not* raised
  when the model applied something; `auditor_review` counts `NO_TEXT`/`UNRESOLVED`/`NO_ANSWER`;
  no `run_id` anywhere → refuses.

## Worth knowing: none of the Dummy Tickets work is live

`activeVersionId` is `da348166`, unchanged through every edit this session (D7, D10, D16, D17).
The published version is still the pre-session one; everything is in the **draft**. So the "this
is the one active flow" caution I raised earlier overstated the risk — these changes reach
production only when someone publishes.

## Not done

Neither flow was run. Both fixes are verified by unit test and by re-read, not by execution —
Terminated HM needs an ERP token, and Dummy Tickets should not be published on my say-so.
