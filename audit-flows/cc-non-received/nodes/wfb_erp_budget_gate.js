// ERP PRE-FLIGHT BUDGET GATE (ERP-LOAD-POLICY.md §3) - CC Non Received, Stage 2 (Verify).
//
// Sits between Select Red Cases and the six per-candidate ERP fan-outs, which is the last
// moment before this stage's first per-entity request. It passes the batch through untouched;
// its only job is to refuse a run whose cost nobody has looked at.
//
// IT PROJECTS THE WHOLE RUN, NOT THIS BATCH. This stage self-calls once per batch of 50
// (Prepare Handoff -> More batches? -> Next Batch (self)), so a gate that only costed the 50
// candidates in front of it would wave through a 5,000-candidate run 100 times at 300 calls a
// go and never once state the real number. The projection is therefore built from
// baton.candidates_total, which is constant for the life of the run - so this gate can only
// ever throw on batch 0, and re-asserting it on every batch is a cheap way to catch a self-call
// whose candidate list somehow grew.
//
// WHAT IT DOES NOT COVER, said out loud. WF-A (the scorer, Qq473Ygj543jxPUN) spends its own
// sweeps AND up to three per-cohort-member enrichment calls (replacements, contract plan, CPT)
// before this stage exists, and it has no gate of its own. The sweep PAGES are recoverable here
// because the baton carries gate 2's page counts; the enrichment calls are not visible from
// inside this execution and are NOT counted below. That gap belongs to WF-A's entry point and
// is recorded in audit-flows/compliance/cc-non-received.md - it is not something this stage can
// honestly close, and pretending otherwise would make the number below look complete when it
// is not.

// --- per-flow constants: ERP-LOAD-POLICY.md §2 -----------------------------------------
// Six calls fire for EVERY candidate, one per fan-out off Select Red Cases:
//   Get Client Complaints, Get Client Notes, Get Sales Todo Notes,
//   Get Manager+Credit Notes, Get SMS Log (SMS), Get SMS Log (WhatsApp)
const ERP_CALLS_PER_ENTITY = 6;
// Plus the complaint threads. Split Relevant Complaints reads every complaint that HAS a
// thread, capped at MAX_PER_CASE = 5 per case. Five is the worst case, and the worst case is
// what a budget is for: a gate that assumes the happy case is not a gate.
const ERP_CALLS_THREADS_MAX = 5;
// Stage 3 (XN5DaOAfveAqtDMC, CC Non Received 3-Deliver) makes NO ERP calls - checked
// 2026-08-23, it builds one summary row and appends it to a Google Sheet.
const ERP_CALLS_DOWNSTREAM = 0;
// Used only when the baton carries no gate-2 page counts (a hand-built Test Baton). WF-A walks
// the active-contract, terminated-contract and payment-status pages; ~185 is the figure the
// canonical gate in tools/erp_preflight_gate.js carries for the same sweeps.
const SWEEP_CALLS_FALLBACK = 185;
// ---------------------------------------------------------------------------------------

const DEFAULT_BUDGET = 2000;      // ERP-LOAD-POLICY.md §1 - a run that names no budget
const SIGNOFF_THRESHOLD = 15000;  // above this a human decision must be recorded first

const validated = $('Validate Inputs').first().json;
const baton = validated._baton || {};

// The lever, and the honest note about it: nothing plumbs erp_call_budget into the baton today.
// WF-A's Assemble Baton does not set it, so every real run gets DEFAULT_BUDGET. Raising the
// budget deliberately means adding `erp_call_budget` to the baton in WF-A (or to a hand-pasted
// Test Baton). Naming the field here is what makes that a one-line change instead of an
// archaeology exercise.
const askedBudget = Number(baton.erp_call_budget);
const budget = Number.isFinite(askedBudget) && askedBudget > 0 ? askedBudget : DEFAULT_BUDGET;

const g2 = (baton.stats && baton.stats.gate2) || {};
const measuredSweeps = (Number(g2.contracts_pages) || 0)
                     + (Number(g2.terminated_pages) || 0)
                     + (Number(g2.status_pages) || 0);
const sweepCalls = measuredSweeps > 0 ? measuredSweeps : SWEEP_CALLS_FALLBACK;

// The WHOLE run's cohort, not this batch's slice.
const entities = Number(baton.candidates_total) || $input.all().length;
const perEntity = ERP_CALLS_PER_ENTITY + ERP_CALLS_THREADS_MAX;
const projectedPhase = entities * perEntity;
const projectedLater = entities * ERP_CALLS_DOWNSTREAM;
const projectedTotal = sweepCalls + projectedPhase + projectedLater;

console.log(JSON.stringify({ stage: 'erp_preflight_gate', run_id: baton.run_id,
  batch_index: baton.batch_index, batch_in_hand: $input.all().length,
  entities_whole_run: entities, calls_per_entity: perEntity,
  calls_per_entity_fixed: ERP_CALLS_PER_ENTITY, calls_per_entity_threads_max: ERP_CALLS_THREADS_MAX,
  sweep_calls_spent: sweepCalls, sweep_source: measuredSweeps > 0 ? 'baton.stats.gate2' : 'fallback',
  projected_this_stage: projectedPhase, projected_downstream_worst_case: projectedLater,
  projected_total: projectedTotal, budget: budget,
  budget_source: Number.isFinite(askedBudget) && askedBudget > 0
    ? 'baton.erp_call_budget' : 'default (' + DEFAULT_BUDGET + ')',
  minutes_at_policy_rate: Math.round(projectedTotal / 4 / 60),
  wfa_enrichment_calls_not_counted: true,
  within_budget: projectedTotal <= budget }));

// ABOVE THE SIGN-OFF THRESHOLD, BE LOUD EVEN WHEN ALLOWED. §7 wants a recorded human decision
// for a run this size; an explicit budget IS that decision, but a decision nobody can find
// later is not much of a record. So the allowed case announces itself too - that is the case
// the threshold used to say nothing about.
if (projectedTotal > SIGNOFF_THRESHOLD) {
  console.log(JSON.stringify({ stage: 'erp_preflight_high_volume', run_id: baton.run_id,
    projected_total: projectedTotal, threshold: SIGNOFF_THRESHOLD, budget: budget,
    minutes_at_policy_rate: Math.round(projectedTotal / 4 / 60),
    allowed: projectedTotal <= budget,
    note: 'ERP-LOAD-POLICY.md §7: a run this size needs a recorded human decision. An explicit ' +
          'erp_call_budget on the baton is that record; this line is where it can be found.' }));
}

if (projectedTotal > budget) {
  throw new Error(
    'ERP PRE-FLIGHT GATE: this run would make about ' + projectedTotal + ' ERP calls in the ' +
    'verify stage against a budget of ' + budget + '. Refusing to start the per-entity phase.\n' +
    '  cohort ' + entities + ' x ' + perEntity + ' (6 fixed + up to ' + ERP_CALLS_THREADS_MAX +
    ' complaint threads) = ' + projectedPhase + '\n' +
    '  downstream (stage 3) = ' + projectedLater + '\n' +
    '  WF-A sweep pages already spent = ' + sweepCalls +
    (measuredSweeps > 0 ? ' (measured, from the baton)' : ' (estimated - the baton carried no gate-2 page counts)') + '\n' +
    '  NOT counted: WF-A\'s per-cohort enrichment calls, which are spent before this stage runs ' +
    'and are invisible from here. The real total is HIGHER than the number above.\n' +
    '  at the 4 req/s policy rate that is roughly ' + Math.round(projectedTotal / 4 / 60) + ' minutes of ERP time.\n' +
    'Two ways forward, and both are deliberate: cut the candidate list in WF-A so the run is a ' +
    'declared partial, or set erp_call_budget on the baton because a full audit is genuinely ' +
    'wanted. The cohort is NOT trimmed automatically - a run that quietly verifies part of the ' +
    'residue and reports like a whole one is the failure this check exists to prevent.' +
    (projectedTotal > SIGNOFF_THRESHOLD
      ? '\nNOTE: above ' + SIGNOFF_THRESHOLD + ' calls, ERP-LOAD-POLICY.md §7 requires a recorded ' +
        'human decision before the run fires, not just a bigger number on the baton.'
      : ''));
}

// Pass the batch on untouched. Get Client Complaints resolves
// $('Select Red Cases').item.json.client_id through this node, so returning the input items
// themselves - rather than rebuilding them as {json: ...} - is what keeps that paired-item
// lineage intact.
return $input.all();
