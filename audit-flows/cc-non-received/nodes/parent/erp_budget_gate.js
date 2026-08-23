// ERP PRE-FLIGHT BUDGET GATE — ERP-LOAD-POLICY.md §3. Canonical: tools/erp_preflight_gate.js.
//
// WHERE IT SITS AND WHY HERE. Between `Needs enrichment?` (true) and `Get Replacements`, which
// is the last point in this flow before the first PER-ENTITY ERP call. Everything upstream is
// four run-level sweeps whose cost is a few hundred pages however large the book is; everything
// downstream multiplies by the cohort, three times in this flow and eleven more times in
// 2-Verify.
//
// WHY VOLUME NEEDS ITS OWN CONTROL. Pacing (§1) bounds requests per second. It does not bound
// how many there are. This flow paced perfectly at 4 req/s still makes 3N calls here and hands
// 2-Verify a list that costs up to 11N more, and that is the shape of the failure that took ERP
// down three times: a check tested on ten contracts behaves identically on five thousand, and
// nothing in between makes the cost visible before the calls go out.
//
// IT HARD-FAILS. It does not trim the cohort to fit. Auto-capping produces a run that completes
// with incomplete coverage, and a partial audit that looks complete is the single failure this
// whole check family exists to avoid. `Select Red Cases` already carries an EVIDENCE_CAP knob
// and `Validate Inputs` already refuses a window over 31 days — both are DELIBERATE, declared
// truncations. This node must never add a silent one.
//
// THIS GATE ANSWERS FOR ONE ENTRY POINT, and this flow has exactly one: Run Manually ->
// Manual Run Config -> Validate Inputs. There is no webhook and no Execute-Workflow trigger, so
// §3's "a second entry point is a second run" does not apply here — stated rather than left to
// be re-derived, because MV Monthly Payment Stage 4 was missed twice on exactly this point.

// --- per-flow constants: what this run actually costs, stated honestly -----------------------
// THIS PHASE, one call each per enrichment candidate:
//   1. Get Replacements   complaints/replacement/page/contract/{contract_id}
//   2. Get Contract Plan  clientmgmt/client/get-client-details/{client_id}
//   3. Get CPT Info       accounting/directDebit/getActiveCptInfo/{contract_id}
const ERP_CALLS_PER_ENTITY = 3;

// LATER PHASES, worst case, per candidate. 2-Verify (qAuvLHhae2sKD7mM) reads six fixed
// endpoints per red case — complaints list, client notes, sales todo notes, manager+credit
// notes, SMS log (SMS), SMS log (WhatsApp) — and then up to MAX_PER_CASE = 5 complaint threads
// (`Split Relevant Complaints`, read out of the deployed 2-Verify on 2026-08-23). 6 + 5 = 11.
//
// It is charged against the ENRICHMENT cohort, not against the red cases, because the red count
// does not exist yet at this node — `Adjudicate Cases` has not run. The worst case is that every
// enriched contract turns red, and a budget that assumes the happy case is not a budget. This
// is the same call the sibling flows make when identity is only resolved after the phase they
// are gating.
const ERP_CALLS_DOWNSTREAM = 11;

// Sweeps already spent when the run cannot report what it walked. Get Active CC Contracts and
// Get Terminated Contracts cap at maxRequests 200 each, Get Payment Statuses at 400, and Get
// Month Payments is a single call. The fallback is a realistic July figure (~135 contract pages
// + ~13 terminated + ~36 status + 1), not the cap, because a fallback that assumes the worst
// would refuse runs the measured path would allow.
const SWEEP_CALLS_FALLBACK = 185;
// ---------------------------------------------------------------------------------------------

const DEFAULT_BUDGET = 2000;         // ERP-LOAD-POLICY.md §1 — a run that names no budget
const SIGNOFF_THRESHOLD = 15000;     // above this a human decision must be recorded first

const _validated = $('Validate Inputs').first().json || {};
const params = _validated.params || {};

const askedBudget = Number(params.erp_call_budget);
const budget = Number.isFinite(askedBudget) && askedBudget > 0 ? askedBudget : DEFAULT_BUDGET;

// Prefer what the run MEASURED over the constant: gate 2 already counted the pages it walked,
// and a real number beats an estimate that quietly ages.
const _g2 = (function () {
  try { return $('Verify Bulk Pulls').first().json._gate2 || {}; } catch (e) { return {}; }
})();
const _measured = (Number(_g2.contracts_pages) || 0) + (Number(_g2.terminated_pages) || 0) +
                  (Number(_g2.status_pages) || 0) + 1;   // +1 = Get Month Payments, one call
const sweepCalls = _measured > 1 ? _measured : SWEEP_CALLS_FALLBACK;

// The cohort about to be enriched: exactly the items this node is handed, which are exactly the
// items Get Replacements will fan out over. Counted from $input rather than from an upstream
// node by name, so it cannot drift away from what actually reaches the HTTP node.
const entities = $input.all().length;
const projectedPhase = entities * ERP_CALLS_PER_ENTITY;
const projectedLater = entities * ERP_CALLS_DOWNSTREAM;
const projectedTotal = sweepCalls + projectedPhase + projectedLater;

console.log(JSON.stringify({ stage: 'erp_preflight_gate',
  check: 'cc-nonreceived-monthly-payments',
  entry_point: 'Run Manually (the only trigger in this flow)',
  entities: entities, calls_per_entity: ERP_CALLS_PER_ENTITY,
  calls_downstream_per_entity: ERP_CALLS_DOWNSTREAM,
  sweep_calls_spent: sweepCalls, sweep_calls_measured: _measured > 1,
  projected_this_phase: projectedPhase, projected_downstream_worst_case: projectedLater,
  projected_total: projectedTotal, budget: budget,
  budget_source: Number.isFinite(askedBudget) && askedBudget > 0
    ? 'params.erp_call_budget' : 'default (' + DEFAULT_BUDGET + ')',
  minutes_at_policy_rate: Math.round(projectedTotal / 4 / 60),
  within_budget: projectedTotal <= budget }));

// ABOVE THE SIGN-OFF THRESHOLD, BE LOUD EVEN WHEN ALLOWED. §7 says a run over the threshold
// needs a recorded human decision. Setting params.erp_call_budget high enough IS that decision —
// it is an explicit act in the payload — but a decision nobody can find later is not much of a
// record. Without this the threshold only ever appeared inside a refusal, which meant the one
// case it most needed to mark — a large run that was ALLOWED — was the case it said nothing
// about. On this flow that case is the normal one: a full month of the active CC book is a
// five-figure audit.
if (projectedTotal > SIGNOFF_THRESHOLD) {
  console.log(JSON.stringify({ stage: 'erp_preflight_high_volume',
    projected_total: projectedTotal, threshold: SIGNOFF_THRESHOLD, budget: budget,
    minutes_at_policy_rate: Math.round(projectedTotal / 4 / 60),
    allowed: projectedTotal <= budget,
    note: 'ERP-LOAD-POLICY.md §7: a run this size needs a recorded human decision. The explicit ' +
          'params.erp_call_budget is that record; this line is where it can be found afterwards.' }));
}

if (projectedTotal > budget) {
  throw new Error(
    'ERP PRE-FLIGHT GATE: this run would make about ' + projectedTotal + ' ERP calls against a ' +
    'budget of ' + budget + '. Refusing to start the per-entity phase.\n' +
    '  cohort ' + entities + ' x ' + ERP_CALLS_PER_ENTITY +
    ' (replacements + plan + CPT, this flow) = ' + projectedPhase + '\n' +
    '  cohort ' + entities + ' x ' + ERP_CALLS_DOWNSTREAM +
    ' (2-Verify evidence reads, worst case: 6 fixed + up to 5 complaint threads) = ' +
    projectedLater + '\n' +
    '  sweep pages already spent = ' + sweepCalls + '\n' +
    '  at the 4 req/s policy rate that is roughly ' + Math.round(projectedTotal / 4 / 60) +
    ' minutes of ERP time.\n' +
    'Three ways forward, and all three are deliberate: narrow the audit window so the run is a ' +
    'declared partial, set an EVIDENCE_CAP in Select Red Cases so the 2-Verify leg is a declared ' +
    'pipeline test, or raise params.erp_call_budget because a full month is genuinely wanted. ' +
    'The cohort is NOT trimmed automatically — a run that quietly audits part of the book and ' +
    'reports like a whole one is the failure this check exists to prevent.' +
    (projectedTotal > SIGNOFF_THRESHOLD
      ? '\nNOTE: above ' + SIGNOFF_THRESHOLD + ' calls, ERP-LOAD-POLICY.md §7 requires a recorded ' +
        'human decision before the run fires, not just a bigger number in the payload.'
      : ''));
}

// Pass the cohort on untouched. Get Replacements receives exactly the items Needs enrichment?
// sent, in the same order, and Attach Replacements — which pairs $('Needs enrichment?').all(0)
// POSITIONALLY against the HTTP responses and throws if the counts differ — is indifferent to
// this node existing. Returning the input items directly is n8n's passthrough and preserves
// paired-item lineage, which rebuilding them as {json: ...} would drop.
return $input.all();
