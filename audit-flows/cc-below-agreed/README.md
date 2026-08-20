# CC Monthly Payments Below Agreed Amount

> ## ⚠ PENDING DEPLOYMENT — do this BEFORE the next run
>
> `nodes/Build_Runs_Log.js` in this repo is **one change ahead of the deployed WF-A**
> (`uJ8UVNKdN2s5PHHA`). The node's zero-cases fallback named `$('Compute Case States')`,
> which moved into WF-T when the tail was batched, so it had been dead since that refactor.
> The repo version names `$('Join Scored')` instead.
>
> **To deploy:** paste the repo file into WF-A's `Build Runs Log` node (n8n UI is safest —
> the body carries regexes whose escaping is easy to corrupt in transit), then publish
> WF-A. Verify by diffing the deployed `jsCode` against `nodes/Build_Runs_Log.js`; they
> must be byte-identical.
>
> **Second pending change, same rule:** `wf-b/nodes/merge_agent_verdicts.js` now fails CLOSED
> when the model omits `evidence_class`. Before, the cap read `evidenceClass && evidenceClass
> !== 'JUSTIFIED'`, so an absent class was falsy and `Agent Justified` cleared the candidate —
> the one path in that node that produced a false clearance. Deploy it to WF-B
> (`2LaIbHqQ1A2sEBKm`) the same way and diff to confirm.
>
> **Third and fourth, added 2026-08-20 — the ERP circuit breaker** (`ERP-LOAD-POLICY.md` §5):
>
> | file | flow | what changed |
> |---|---|---|
> | `wf-e/nodes/read_chunk.js` | WF-E `NDk03cYGF4XSXsk5` | stamps `erp_t0`, declares its gate and lease are held by WF-A |
> | `wf-e/nodes/project_plan.js` | WF-E | breaker block — a trip here stops the chunk's replacement phase |
> | `wf-e/nodes/project_replacements.js` | WF-E | breaker block over the whole chunk |
> | `wf-b/nodes/select_candidates.js` | WF-B `2LaIbHqQ1A2sEBKm` | stamps `erp_t0`, same declarations |
> | `wf-b/nodes/resolve_quoted_amounts.js` | WF-B | breaker block over both message reads together |
> | `wf-e/wfa/chunk_candidates.js` | WF-A `uJ8UVNKdN2s5PHHA` | canary first chunk (50) |
>
> These were **not** hand-transmitted: the bodies run to ~30 KB and carry backslash escapes,
> which is exactly the material that gets corrupted in transit. Paste them from the repo
> through the n8n UI and diff, as above. Nothing can run until the ERP accounts are
> reactivated anyway, so nothing is lost by waiting for a channel that cannot damage them.
>
> Not urgent in itself — the reference sits inside a `try/catch` so it cannot crash, and
> `Join Scored` throws hard before the empty-cases path can be reached. It is listed here
> only because **repo and deployment must not silently drift**, which is the trap that
> produced the bug in the first place. Every other node in this repo matches its deployed
> version as of 2026-08-19.
>
> After deploying, prove it rather than assume it:
> `get_workflow_details` each flow into `audit-flows/exports/`, then
> `python3 audit-flows/tools/erp_compliance.py --all` — which re-generates the breaker block
> and compares it byte-for-byte against what is live.

Spec: Notion "CC Monthly Payments Below Agreed Amount" v1.5 · flow `uJ8UVNKdN2s5PHHA` (DRAFT, never published)

These are the **offline-testable** parts of the n8n flow, extracted so the deterministic
logic can be regression-tested without an ERP token or an n8n run. The flow in n8n is the
deployed copy; these files are what was tested before pushing.

    node offline/harness.js      # the scorer vs the spec's 7 verified cases + 6 edge guards
    node offline/cohort_test.js  # population parser vs the real API envelope + failure shapes
    node offline/gate2_test.js   # completeness gate vs every way a short walk can pass

`offline/fixture_active_pop.json` is a **structure-only** capture: real field names, nesting,
row count and the envelope's misleading values are preserved; every identifier and name is
replaced. No client or maid data is retained.

`PROBE-RESULTS.md` records the live ERP probe — status, denial shape and envelope shape per
surface, the spec corrections it produced, and two probe errors of my own so they are not
mistaken for flow defects.

## What these tests exist to stop

Not crashes — **false clearances**. Every case below was a green verdict on a contract that
deserved review:

- gate 80 credited any unrelated charge large enough to cover the gap (monthly 1,000 against
  expected 5,000 with a 9,000 unrelated charge scored `paid_in_full`). The discriminator is the
  leftover: a genuine split lands on the amount owed exactly.
- gate 110 cleared an unnetted overpayment as green while gate 100's covered-month attribution
  is only half built, so the month it also covered reads as zero.
- gate 2 would have accepted 2,160 of 5,393 contracts if it trusted `clients.size`, which echoes
  the size you requested while the server never returns more than 40 rows.
