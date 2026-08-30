# D15 — investigation, not yet a fix (2026-08-27)

**Status: incomplete.** I was one query from the answer when the n8n connector dropped and
began requiring re-authentication. What follows is established, and it already changes what
D15 is.

## The defect report's stated fix is not the fix

> **The fix** — Include the live-out cohort and its two card prices.

**Both are already there.** Three independent confirmations:

1. **The scorer supports live-out.** `cohortKey(bucket, liveOut)` returns
   `(liveOut ? 'liveout' : 'livein') + ':' + bucket`, and `bucketOf` collapses Ethiopian into
   `Other` when live-out. So it can produce exactly **two** live-out cohorts —
   `liveout:Filipina` and `liveout:Other` — which is exactly the count of missing card prices
   the report names (5,712 and 4,126.50).
2. **The card already carries them.** Stage 1's `Parse + Assert Card` builds the same key and
   then asserts: *"expected 49 windows across 5 cohorts"* — **aborting the whole run otherwise**.
   Five cohorts is three live-in plus two live-out. If the card lacked live-out prices, no run
   would ever have completed.
3. **The population carries the field.** `Population Guard` maps `live_out: r.maidLiveOut`.

So the machinery is complete end to end. The question is not "add live-out" — it is **why does
no contract ever resolve to a live-out cohort**.

## A theory I formed and then disproved

`coerceBool` in the Stage 2 glue accepts only `true/false/"true"/"out"/"1"/"false"/"in"/"0"`
and returns **null** for anything else. Null hits the `no_living_axis` guard, which parks the
contract as *Unpriceable* rather than scoring it. Meanwhile `cptLiveOut` in the same file shows
ERP's own living-axis vocabulary is **"Live Out" / "Long Term"** — neither of which `coerceBool`
accepts.

Plausible, and wrong. The real `JUL2026-FINAL` run says:

- `unpriceable_at_start_count: 0`
- reason codes contain **no living-axis code at all**:
  `above_card_but_gate_requires_review:79 · matches_card_for_month:1613 ·
  above_card_not_under_priced:671 · below_card_unexplained:508 · no_nationality:229 ·
  cleared_on_a_test_but_gate_requires_review:277 · matches_published_price:1104`
- out-of-scope reasons are only `started_after_month_start:795` and `no_rate_for_month:56`

Nothing is being parked for a missing living axis. The axis always resolves — it just never
resolves to live-out.

## The remaining hypothesis, and why it matters

If `live_out` resolves to a real `false` (rather than null), the `no_living_axis` guard cannot
fire, and every live-out contract is scored against the **live-in** card — the cheaper cohort.
A live-out contract paying its correct 5,712 would then look like an **over-payer** against a
4,714.50 live-in card, and land in `above_card_not_under_priced`, which the run notes describe
as *"valid and is not a finding; they are excluded from red and from the gap total."*

**That bucket holds 671 contracts in the real July run.** If live-out contracts are hiding
there, the check is not merely missing them — it is actively clearing them, and the 29 failing
contracts are inside a bucket labelled "valid". This is the exact failure the scorer's own
comment warns about (*"never default to live-in, it is the cheaper cohort"*), reached by a route
that guard cannot see because the value is a real `false` rather than a null.

**This is a hypothesis, not a finding.** One query settles it — see below.

## A separate problem, found on the way

Filtering `CC Price by Cohort — Cases` to `run_id = JUL2026-FINAL` returned **1 row**. The Runs
row for that same run reports `cases_scored: 5399`.

Either the case rows carry a different `run_id`, or the Cases table does not hold what the run
says it does. Stage 3's entire premise is *"reads the Cases table back as ground truth"* and it
*"refuses to report unless every contract has a case row"* — so this needs explaining on its own
merits, independent of D15.

The single row it did return: `live_out = "true"`, `cohort_now = ""` (empty), and
`card_price_for_month = 0`. A live-out contract that got no cohort and no price. Suggestive of
the hypothesis above — but n=1 proves nothing.

## The one query that finishes this

Read `CC Price by Cohort — Cases` (`CwVPKkhck8kOdY6q`) with **no filter** and tally
`run_id`, `cohort_now`, `live_out`, `cpt_type` and `living_axis_conflict`. That distinguishes:

- **live-out absent from the population** → no rows with `live_out = true`
- **live-out scored as live-in** → rows with `live_out = true` but `cohort_now` starting `livein:`
- **live-out scored correctly** → rows with `cohort_now` starting `liveout:` (D15 would then be
  about something else entirely)

The probe node is already built in the throwaway harness (`0wR51wFA95VJSPmv`, nodes
`Read CC Cases JUL FINAL` → `Tally CC Cohorts`, filter already cleared). It needs only a run
once the n8n connector is re-authorised.

## Blocked on

The **Sami_s_n8n** connector disconnected mid-probe and now requires authentication. That has to
be re-established before this can be finished — or any further flow edit made.
