# CC Monthly Payments Below Agreed Amount

> ## ⚠ PENDING DEPLOYMENT — do this BEFORE the next run
>
> **DEPLOYED 2026-08-22 — the ERP circuit breaker is now live in WF-E and WF-B.** It had never
> been deployed at all: the repo carried the embeds since 2026-08-20 and the live flows had no
> breaker in them, so this was an absence rather than drift. Six nodes went out, each verified
> byte-identical to its repo file after deploy:
>
> | node | flow | what it does |
> |---|---|---|
> | `Read Chunk` | WF-E `NDk03cYGF4XSXsk5` | stamps `erp_t0`, declares gate + lease held by WF-A |
> | `Project Plan` | WF-E | breaker — a trip stops the chunk's replacement phase, 750 calls |
> | `Project Replacements` | WF-E | breaker over the whole chunk |
> | `Select Candidates` | WF-B `2LaIbHqQ1A2sEBKm` | stamps `erp_t0`, same declarations |
> | `Resolve Quoted Amounts` | WF-B | breaker over both message reads together |
> | `Get Messages (WhatsApp)` / `(SMS)` | WF-B | `onError: continueRegularOutput` + `alwaysOutputData` |
>
> **The stamps are not optional extras.** The guard reads `erp_t0` off the stamp node; without
> it the latency detector can never fire and every batch reports `baseline_carried: false` for
> ever — a safety check that looks present and can only speak on two of its three rules.
>
> **Nor is that last row.** Both message nodes had *no* `onError`, so an ERP failure killed the
> execution and `Resolve Quoted Amounts` never ran — leaving the breaker blind to exactly the
> failures it exists to catch. The node body already assumed otherwise (`fetchFailed`,
> `failedReads`, `read_failed` on every case), so the config contradicted its own code.
>
> `python3 tools/erp_compliance.py --all` now reports **PASS** for WF-E and WF-B (WF-B carries
> one WARN, below).
>
> ### Still outstanding
>
> | item | flow | why it was not shipped here |
> |---|---|---|
> | `wf-b/nodes/merge_agent_verdicts.js` | WF-B | unrelated — fails CLOSED when the model omits `evidence_class` |
> | `wf-e/wfa/chunk_candidates.js` | WF-A | the **canary first chunk (50)**. §5's blast-radius control, not the embed: without it the first verdict costs a full 1,200-candidate chunk instead of ~100 calls |
> | error-path lease release | WF-B | `erp_compliance.py` warns that WF-B is a middle link in a fire-and-forget chain (`Next Batch (self)`, `Finish (WF-C)` both launch without waiting) holding a lease it never releases. If a batch dies, the chain stops and nothing frees the lease. The tool cannot see whether WF-A waits, so it warns rather than fails — but WF-A launches WF-B without waiting, so this is real |
>
> **`nodes/Build_Runs_Log.js` was deployed on 2026-08-23** and is no longer on this list. It went
> out as a draft, was byte-compared against the repo file, and was published only on an
> identical match — see VALIDATION.md.
>
> The remaining two are behaviour changes beyond "deploy the breaker" and are left for a
> deliberate decision. The fourth is the same defect fixed in CC Price on 2026-08-22.
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
