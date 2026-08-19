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
> Not urgent in itself — the reference sits inside a `try/catch` so it cannot crash, and
> `Join Scored` throws hard before the empty-cases path can be reached. It is listed here
> only because **repo and deployment must not silently drift**, which is the trap that
> produced the bug in the first place. Every other node in this repo matches its deployed
> version as of 2026-08-19.

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
