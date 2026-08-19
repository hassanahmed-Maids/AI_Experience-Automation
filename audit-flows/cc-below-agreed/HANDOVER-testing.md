# Handover: test CC Monthly Payments Below Agreed Amount end to end

Paste the block below into a fresh session. Everything it references is on disk and pushed.

---

You are picking up a finished-but-never-executed n8n audit chain and taking it through
end-to-end testing. Load the `erp-audit-flow-builder` skill first — it is the standing method
for this work. All state is on disk; read it rather than trusting this summary where the two
disagree.

## The check

**CC Monthly Payments Below Agreed Amount.** For each CC contract-month it compares what the
client actually paid against the contract's own agreed rate (`currentPayment.amountValue`,
VAT-inclusive) and routes shortfalls to a verifier. Its defining property: **it cannot produce
a finding.** The rate on file is the CONTRACTUAL rate and is not reliably what was billed — on
contracts 1054346 / 1086789 / 1090543 it read 4,715 / 4,715 / 5,712 while the client was billed
and paid 2,100 / 2,100 / 3,360 for months, and both numbers were sent to the same client in
writing. So arithmetic yields a CANDIDATE; only the verifier reading what we quoted can say
whether it is "Underpaid" or "Under-billed".

The expensive failure class is **false clearance** — a case that quietly passes on evidence
nobody read. Most of the guard code exists for that reason, and the comments say which
measurement each guard came from.

## Where everything is

- Repo `/home/user/AI_Experience-Automation`, branch `claude/erp-audit-flow-builder-26mxgd`,
  working dir `audit-flows/cc-below-agreed`.
- n8n project **Adeeb** `gxKXV4pckO4b4pQM`. All eight flows are **published/active** and tagged
  `audit: CC Below Agreed`.

| flow | id | role |
|---|---|---|
| WF-A · parent (webhook) | `uJ8UVNKdN2s5PHHA` | 67 nodes: validate → sweeps → cohort → enrich → batch-score → runs log → payload → verifier handoff |
| WF-Pop · 0-Sweep Population | `RbW2fT3b6rtqVQ9H` | `mode: active` and `mode: terminated`, both walks of `contract/search/page` |
| WF-P · 0-Sweep Payments | `M79KcC9vaHte5Ibi` | one 31-day payment window per call, ×3 |
| WF-S · 0-Sweep Statuses | `D1mCMJuN9lMURJHb` | the paged status sweep, projected |
| WF-E · 0-Enrich Candidates | `NDk03cYGF4XSXsk5` | one chunk of candidates: plan read + replacement read |
| WF-T · 1-Score Batch | `pOa3yRIyguSyoBk4` | one batch: score → guards → adjudicate → band → sheet rows → Cases append |
| WF-B · 2-Verify | `2LaIbHqQ1A2sEBKm` | verifies candidates against message evidence, self-calls per batch |
| WF-C · 3-Deliver | `yEF4BHYDZAnhBnYg` | one Run Summary row |

Everything heavy runs in a sub-execution because n8n retains every node's output for the life
of an execution — ending a sub-execution is the only thing that frees it.

## What is proven and what has never run

**Offline: 11 suites, all green.** Run them all before and after any change:

```bash
cd audit-flows/cc-below-agreed
for t in offline/harness.js offline/gate2_test.js offline/gate2_payments_test.js \
         offline/attach_payments_test.js offline/cohort_test.js offline/guards_test.js \
         offline/validate_inputs_test.js wf-b/offline/baton_hops.js \
         wf-e/offline/enrich_test.js wf-pop/offline/population_test.js \
         wf-t/offline/batch_equivalence_test.js; do
  printf '%-44s ' "$t"; node "$t" >/dev/null 2>&1 && echo PASS || echo FAIL
done
```

The most important one is `wf-t/offline/batch_equivalence_test.js` — it runs the batched and
un-batched scoring chains over the same fixtures at six batch sizes and asserts the scored cases
are identical field for field.

**Never executed, by anything:** WF-Pop (both modes), WF-T, and every node after
`Join Enrichment` in WF-A. The last real execution is **93346** (2026-08-19), which reached
41.5 minutes and crashed at the scoring join — the exact thing WF-T was built to fix. Read
`VALIDATION.md` §19 for its measured timeline and §21 for what changed after it.

## Firing it

`POST https://sami-team.app.n8n.cloud/webhook/cc-below-agreed-amount` with header
`X-SR-Webhook-Secret`. The full command, the required body shape and the callback_url allowlist
are in **`RUNBOOK-trigger.md`** — use it rather than reconstructing the payload.

- The ERP token travels in the request body as `params.erp_auth.bearer` (`"Bearer <jwt>"`), so
  ERP attributes every read to whoever sends it. It is never stored in the flow or the repo.
- The webhook secret is the `live` slot of `ACCEPTED_WEBHOOK_SECRETS`, line 116 of
  `nodes/Validate_Inputs.js`.
- **All ERP tokens die at 22:00 UTC / 02:00 Dubai** regardless of when they were issued, and can
  also die early from a logout elsewhere. A ~45-minute run started after ~21:15 UTC loses its
  bearer mid-flight. WF-E now throws on a dead token rather than scoring empty reads.
- **A crash deactivates the workflow.** The next POST then returns `404 ... is not registered`,
  which looks like a bad payload and is not — re-publish and re-fire. Publish leaves before the
  parent; n8n refuses WF-A while any child is unpublished and names them.

### Run parameters

| param | default | effect |
|---|---|---|
| `params.cohort_cap` | absent = uncapped | caps the cohort in `Build Cohort`. **This is the main ERP-load lever** — it applies before enrichment, so it cuts enrichment calls proportionally. Capped runs are marked `pipeline_test: true` and log `PIPELINE TEST - NOT AN AUDIT`. |
| `params.score_batch_size` | 1,200 (max 2,000) | cases per WF-T sub-execution. Lower to force more batches on a small cohort. Below ~600 the circularity tripwire inside `Guards` stops arming per batch; `Join Scored` repeats it run-level so nothing is lost. |
| `params.enrich_chunk_size` | 750 (max 1,200) | candidates per WF-E sub-execution. Changes call *batching*, not the total call count. |
| `params.population_floor` | 4,600 | gate 2's floor; may be raised, never lowered. |
| `params.previous_cases` | `[]` | carried cases from a prior run. |

## ERP load — the one thing worth being careful with

A full uncapped run is roughly **11,000 ERP reads**, and ERP is production:

| phase | calls | measured cost |
|---|---|---|
| population walk (active) | ~136 pages | 5.03 s/page, 40 rows/page — the route caps at 40 however large a `size` you ask for |
| population walk (terminated) | ~24 pages | same route, `requestInterval` 250 ms |
| payment windows | 3 | 1.6–1.9 s each; window must be ≤31 days and start within 6 months (both HTTP 400 beyond) |
| status sweep | ~22 pages | server clamps `size` at 2,000; 7 min 51 s total |
| enrichment | **2 per candidate × ~5,632 ≈ 11,264** | 56–57 s per chunk of 750 |

So the enrichment is ~97% of the ERP traffic. **`cohort_cap` is what reduces it** — a run with
`cohort_cap: 2000` makes roughly 4,000 enrichment calls instead of 11,264, at the same sweep
cost (the cap applies after the sweeps).

Throttles already in the flows, worth leaving alone: `maxRequests` 400/200 on the two population
walks, `requestInterval` 250 ms on the terminated walk, `timeout` 90 s on the ERP nodes, and the
per-page caps above. When you need to learn how a route behaves, `curl` it once rather than
building a probe flow — it is faster, leaves nothing in the shared n8n project, and makes one
request instead of a paged walk. `PROBE-RESULTS.md` has 15 probes already recorded, including
which routes are denied.

**Half the enrichment calls currently fail by design:** `/complaints/replacement/page/contract/{id}`
returns 401 `INSUFFICIENT_PERMISSIONS` on this account (probes #6 and #13, unchanged since
2026-08-18). That is ~5,632 wasted round trips per uncapped run. Requesting the
`ClientReplacement` permission would halve the enrichment load and improve gate 7's coverage
answer — worth raising.

## What to read in the logs

Every Code node emits one JSON line. In order:

1. `validate_inputs` — `secret_slot_matched`, the derived window.
2. `wfpop_project_rows` ×2 — `last_page_short: true` on the active walk, `salary_fields_dropped`
   > 0 (proof the maid salary never reached WF-A).
3. `_gate2` on `Verify Bulk Pulls` — `population_reconciled`, `payment_raw_rows_per_window`.
4. `build_cohort` — `cohort`, `from_population_only` / `from_payment_stub_only` /
   `from_terminated_only`, `held_for_human`, `dropped`.
5. `wfe_project_plan` / `wfe_project_replacements` per chunk — `plan_fetch_failures`,
   `permission_denied`, `token_dead`, `plan_token_dead`.
6. `join_enrichment` — every candidate came back, no duplicates.
7. `chunk_cases` — `batches`, `batch_sizes`.
8. `wft_return_batch` per batch — `rows_appended` equals `cases`, `bands` populated.
9. `join_scored` — `batch_indexes` is `0..n-1` with no gap or repeat, `rows_appended` equals
   `cases`, `circularity_tripwire_run_level` armed and passed.
10. `guards` — `plan_source` reads `Join Enrichment` (not `unavailable`),
    `gate35_no_monthly_obligation_yet`, `exact_share_pct`.
11. `adjudicate_cases`, `build_runs_log`, `build_case_payload`.

Results land in Google Sheet `12ModCwP5xgXhuEsYvhIfI5cSUePH4jrDhlT-pW0-DLw` — **Cases** tab
(`gid=0`, appended per batch), Run Summary, Verifier Verdicts. The three portal callback nodes
are disabled, so nothing is POSTed outside n8n and Sheets.

Expected shape from the measured July 2026 funnel: 5,612 CC contracts paid, **4,575 exact
(81.5%)**, **984 short**, of which ~108 look stably under-billed at ~AED 64,000/month. An exact
share above 97%, or zero shortfalls in a cohort over 500, throws the circularity tripwire — that
guards against ERP's `currentPayment` falling back to a PAYMENT-derived value, which would make
the audit compare a payment against itself and turn the whole book green.

## Open questions

1. **Is the memory peak actually fixed?** The point of WF-T. Before: five retained copies of the
   cohort at ~14 MB each.
2. **Is the ceiling per-execution or per-INSTANCE?** `VALIDATION.md` §19 — two audits crashed in
   the same instance within ten minutes on 2026-08-19. Running this alone settles it.
3. Gate 60 (freeze) is unbuildable — ERP stores no freeze date anywhere; gate 18's persistence
   test is the mitigation (cuts 17 false positives to 2). Gate 100 (covered month) is half built:
   `paymentDate` places a payment in the period but nothing exposes the billing cycle that says
   which month it settles.
4. The five display-band labels are the owner's PROPOSED vocabulary and are not signed off.

## Docs, in reading order

`README.md` → `VALIDATION.md` (§14 retention ledger, §15 the 92534 diagnosis, §16 WF-E, §17
ask-the-code, §18 the two guards, §19 execution 93346, §20 population staging, §21 the batched
tail) → `PROBE-RESULTS.md` (15 probes, plus the denial shapes and my own probe errors) →
`RUNBOOK-trigger.md` → the per-flow `wf-*/README.md` → `../WORKSPACE-HYGIENE.md`.

Correct any doc you find wrong — a correction is not done until it is written into the file that
caused it.
