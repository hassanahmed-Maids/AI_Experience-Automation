// ERP PRE-FLIGHT BUDGET GATE — the canonical implementation (ERP-LOAD-POLICY.md §3).
//
// COPY THIS INTO THE NODE THAT KNOWS THE COHORT SIZE AND SITS IMMEDIATELY BEFORE THE FIRST
// PER-ENTITY ERP CALL. n8n has no shared-code mechanism, so this file is the reference and
// each flow carries its own copy; `tools/erp_load_check.py` checks pacing, and this checks
// VOLUME, which only the run can know.
//
// WHY VOLUME NEEDS ITS OWN CONTROL. Pacing bounds requests per second. It does not bound how
// many there are. A flow paced perfectly at 4 req/s still makes 13,400 calls if the cohort is
// 5,632, and that is the shape of the failure that took ERP down three times: a flow tested on
// ten contracts behaves identically on five thousand, and nothing in between made the cost
// visible. The multiplier is invisible unless something writes it down and compares it to a
// budget BEFORE the first call.
//
// IT HARD-FAILS. It does not trim the cohort to fit. Auto-capping produces a run that completes
// with incomplete coverage, and a partial audit that looks complete is the single failure this
// whole check family is built to avoid. The throw names both numbers so the operator's next
// move is obvious: raise the budget deliberately, or cap the cohort deliberately. Either is a
// decision; silently auditing 40% of the book is not.
//
// EACH FLOW MUST SET THE THREE CONSTANTS HONESTLY. A flow that cannot state its calls-per-
// entity does not understand its own cost and is not ready to run.

// --- per-flow constants: EDIT THESE ---------------------------------------------------
const ERP_CALLS_PER_ENTITY = 2;      // calls this phase makes per entity
const ERP_CALLS_DOWNSTREAM = 2;      // per-entity calls LATER phases will make, worst case
const SWEEP_CALLS_FALLBACK = 185;    // sweeps already spent, when the run cannot report them
// ---------------------------------------------------------------------------------------

const DEFAULT_BUDGET = 2000;         // ERP-LOAD-POLICY.md §1 — a run that names no budget
const SIGNOFF_THRESHOLD = 15000;     // above this a human decision must be recorded first

const askedBudget = Number((params || {}).erp_call_budget);
const budget = Number.isFinite(askedBudget) && askedBudget > 0 ? askedBudget : DEFAULT_BUDGET;

// Prefer what the run MEASURED over the constant: gate 2 already counted the pages it walked,
// and a real number beats an estimate that quietly ages.
const _g2 = (function () {
  try { return $('Verify Bulk Pulls').first().json._gate2 || {}; } catch (e) { return {}; }
})();
const _measuredSweeps = (Number(_g2.population_pages) || 0) + (Number(_g2.status_pages) || 0) + 3;
const sweepCalls = _measuredSweeps > 3 ? _measuredSweeps : SWEEP_CALLS_FALLBACK;

const entities = slim.length;                       // the cohort about to be enriched
const projectedPhase = entities * ERP_CALLS_PER_ENTITY;
const projectedLater = entities * ERP_CALLS_DOWNSTREAM;
const projectedTotal = sweepCalls + projectedPhase + projectedLater;

console.log(JSON.stringify({ stage: 'erp_preflight_gate',
  entities: entities, calls_per_entity: ERP_CALLS_PER_ENTITY,
  sweep_calls_spent: sweepCalls, projected_this_phase: projectedPhase,
  projected_downstream_worst_case: projectedLater, projected_total: projectedTotal,
  budget: budget, budget_source: Number.isFinite(askedBudget) && askedBudget > 0
    ? 'params.erp_call_budget' : 'default (' + DEFAULT_BUDGET + ')',
  minutes_at_policy_rate: Math.round(projectedTotal / 4 / 60),
  within_budget: projectedTotal <= budget }));

// ABOVE THE SIGN-OFF THRESHOLD, BE LOUD EVEN WHEN ALLOWED. Policy §7 says a run over
// SIGNOFF_THRESHOLD calls needs a recorded human decision. Setting params.erp_call_budget high
// enough IS that decision - it is an explicit, deliberate act in the payload - but a decision
// nobody can find later is not much of a record. So a high-volume run announces itself in the
// run's own log whether it is refused or allowed. Without this the threshold only ever appeared
// inside a refusal, which meant the one case it most needed to mark - a large run that was
// ALLOWED - was the case it said nothing about.
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
    '  cohort ' + entities + ' x ' + ERP_CALLS_PER_ENTITY + ' (this phase) = ' + projectedPhase + '\n' +
    '  cohort ' + entities + ' x ' + ERP_CALLS_DOWNSTREAM + ' (later phases, worst case) = ' + projectedLater + '\n' +
    '  sweeps already spent = ' + sweepCalls + '\n' +
    '  at the 4 req/s policy rate that is roughly ' + Math.round(projectedTotal / 4 / 60) + ' minutes of ERP time.\n' +
    'Two ways forward, and both are deliberate: cap the cohort (params.cohort_cap) so the run is ' +
    'a declared partial, or raise params.erp_call_budget because a full audit is genuinely wanted. ' +
    'The cohort is NOT trimmed automatically - a run that quietly audits part of the book and ' +
    'reports like a whole one is the failure this check exists to prevent.' +
    (projectedTotal > SIGNOFF_THRESHOLD
      ? '\nNOTE: above ' + SIGNOFF_THRESHOLD + ' calls, ERP-LOAD-POLICY.md §7 requires a recorded ' +
        'human decision before the run fires, not just a bigger number in the payload.'
      : ''));
}
