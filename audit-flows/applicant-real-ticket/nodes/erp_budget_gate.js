// ERP PRE-FLIGHT BUDGET GATE — ERP-LOAD-POLICY.md §3. Canonical: tools/erp_preflight_gate.js.
//
// Sits between Build Page List and Get Population Pages: the first point at which the run knows
// how big it is, and the last point before ANY fan-out. Everything upstream is one count call.
//
// WHY VOLUME NEEDS ITS OWN CONTROL. Pacing bounds requests per second. It does not bound how many
// there are. This flow paced perfectly at 4 req/s still makes pages + 3N calls for a population
// of N, and that is the shape of the failure that took ERP down three times: a check tested on a
// week of transactions behaves identically on a year of them, and nothing in between makes the
// cost visible before the calls go out.
//
// IT HARD-FAILS. It does not trim the population to fit. Auto-capping produces a run that
// completes with incomplete coverage, and a partial audit that looks complete is the single
// failure this whole check family exists to avoid - and here it would also break Population
// Guard, which proves completeness by comparing rows pulled against totalElements.
//
// IT ALSO STAMPS run_id ONTO THE PAGE ITEMS. Every circuit breaker in this flow reads its run id
// from this node, because Validate Inputs keeps it at params.run_id and the generated breaker
// block reads a TOP-LEVEL run_id. One node carrying it for all four beats four different
// accessors, and the breaker's baseline store is cleared on a change of run id - so a missing or
// inconsistent one silently makes every run look like the same run.

// --- per-flow constants: what this run actually costs, stated honestly -----------------------
// 1. Get Transaction Detail   - one call per row that needs detail. Worst case every row.
// 2. Get Flight Tickets       - one call per UNIQUE applicant. Unknown here, because identity is
//                               only resolved after the detail call. Worst case one applicant
//                               per transaction, so it is budgeted at 1 per transaction rather
//                               than guessed lower - a budget that assumes the happy case is not
//                               a budget.
// 3. Get All-Time Reversals   - one call per red ticket selected for an all-time lookup, worst
//                               case one per transaction.
const ERP_CALLS_PER_TRANSACTION = 3;

const DEFAULT_BUDGET = 2000;         // ERP-LOAD-POLICY.md §1 — a run that names no budget
const SIGNOFF_THRESHOLD = 15000;     // above this a human decision must be recorded first

const _params = ($('Validate Inputs').first().json || {}).params || {};
const runId = String(_params.run_id || '');
if (!runId) {
  // Never silently: an empty run id does not break the run, it breaks every breaker's ability to
  // tell this run from the last one.
  console.log(JSON.stringify({ stage: 'erp_preflight_gate',
    warning: 'params.run_id is empty; the breakers cannot separate this run from the previous ' +
             'one and will carry a stale latency baseline. Check the caller payload.' }));
}

const askedBudget = Number(_params.erp_call_budget);
const budget = Number.isFinite(askedBudget) && askedBudget > 0 ? askedBudget : DEFAULT_BUDGET;

// Prefer what the run MEASURED over any constant: Build Page List already read totalElements off
// the independent count, and a real number beats an estimate that quietly ages.
const pageItems = $input.all().map(function (i) { return i.json; });
const plan = pageItems[0] || {};
const entities = Number(plan.total_expected) || 0;
const sweepCalls = Number(plan.pages_expected) || pageItems.length;
const projectedPhase = entities * ERP_CALLS_PER_TRANSACTION;
const projectedTotal = sweepCalls + projectedPhase;

console.log(JSON.stringify({ stage: 'erp_preflight_gate',
  check: 'applicant-real-ticket', run_id: runId || null,
  transactions: entities, calls_per_transaction: ERP_CALLS_PER_TRANSACTION,
  sweep_calls_planned: sweepCalls, projected_per_entity: projectedPhase,
  projected_total: projectedTotal, budget: budget,
  budget_source: Number.isFinite(askedBudget) && askedBudget > 0
    ? 'params.erp_call_budget' : 'default (' + DEFAULT_BUDGET + ')',
  minutes_at_policy_rate: Math.round(projectedTotal / 4 / 60),
  within_budget: projectedTotal <= budget }));

// ABOVE THE SIGN-OFF THRESHOLD, BE LOUD EVEN WHEN ALLOWED. §7 says a run over the threshold needs
// a recorded human decision. Setting params.erp_call_budget high enough IS that decision - it is
// an explicit act in the payload - but a decision nobody can find later is not much of a record.
// Without this the threshold only ever appeared inside a refusal, which meant the one case it
// most needed to mark - a large run that was ALLOWED - was the case it said nothing about.
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
    'budget of ' + budget + '. Refusing to start the population walk.\n' +
    '  ' + entities + ' transactions x ' + ERP_CALLS_PER_TRANSACTION +
    ' (detail + flight tickets + all-time reversals, worst case) = ' + projectedPhase + '\n' +
    '  population pages planned = ' + sweepCalls + '\n' +
    '  at the 4 req/s policy rate that is roughly ' + Math.round(projectedTotal / 4 / 60) +
    ' minutes of ERP time.\n' +
    'Two ways forward, and both are deliberate: narrow the window so the run is a declared ' +
    'partial, or raise params.erp_call_budget because a full month is genuinely wanted. The ' +
    'population is NOT trimmed automatically - besides hiding findings, a trimmed walk would ' +
    'fail Population Guard, which proves completeness by comparing rows pulled against ' +
    'totalElements.' +
    (projectedTotal > SIGNOFF_THRESHOLD
      ? '\nNOTE: above ' + SIGNOFF_THRESHOLD + ' calls, ERP-LOAD-POLICY.md §7 requires a recorded ' +
        'human decision before the run fires, not just a bigger number in the payload.'
      : ''));
}

// Pass the page list on, with run_id added. Get Population Pages reads page/size exactly as it
// did before this node existed.
return $input.all().map(function (it) {
  return { json: Object.assign({}, it.json, { run_id: runId }) };
});
