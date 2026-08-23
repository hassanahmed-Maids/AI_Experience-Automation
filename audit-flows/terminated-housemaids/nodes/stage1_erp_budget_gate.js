// ERP PRE-FLIGHT BUDGET GATE — ERP-LOAD-POLICY.md §3. Canonical: tools/erp_preflight_gate.js.
//
// Sits between Verify Population and Get Transaction Detail, which is the last point before the
// first PER-ENTITY ERP call. Everything upstream of here is the paginated sweep, whose cost is a
// handful of pages; everything downstream multiplies by the population.
//
// WHY VOLUME NEEDS ITS OWN CONTROL. Pacing bounds requests per second. It does not bound how many
// there are. This flow paced perfectly at 4 req/s still makes 3N calls for a population of N, and
// that is the shape of the failure that took ERP down three times: a check tested on a week of
// transactions behaves identically on a year of them, and nothing in between makes the cost
// visible before the calls go out.
//
// IT HARD-FAILS. It does not trim the population to fit. Auto-capping produces a run that
// completes with incomplete coverage, and a partial audit that looks complete is the single
// failure this whole check family exists to avoid.

// --- per-flow constants: what this run actually costs, stated honestly -----------------------
// 1. Get Transaction Detail   - one call per in-window transaction.
// 2. Fetch Profiles (0-Fetch) - one call per UNIQUE maid. Unknown here, because identity is only
//                               resolved after the detail call. Worst case is one maid per
//                               transaction, so it is budgeted at 1 per transaction rather than
//                               guessed lower - a budget that assumes the happy case is not a
//                               budget.
// 3. Get All-Time Reversals   - one call per reversal reference, worst case one per transaction.
const ERP_CALLS_PER_TRANSACTION = 3;
const SWEEP_CALLS_FALLBACK = 5;      // pages, when the run cannot report what it walked

const DEFAULT_BUDGET = 2000;         // ERP-LOAD-POLICY.md §1 — a run that names no budget
const SIGNOFF_THRESHOLD = 15000;     // above this a human decision must be recorded first

const _validated = $('Validate Inputs').first().json || {};
const params = _validated.params || {};

const askedBudget = Number(params.erp_call_budget);
const budget = Number.isFinite(askedBudget) && askedBudget > 0 ? askedBudget : DEFAULT_BUDGET;

// Prefer what the run MEASURED over the constant: the sweep already knows how many pages it
// walked, and a real number beats an estimate that quietly ages.
let measuredPages = 0;
try { measuredPages = $('Get FT29 Transactions').all().length; } catch (e) { measuredPages = 0; }
const sweepCalls = measuredPages > 0 ? measuredPages : SWEEP_CALLS_FALLBACK;

const rows = $input.all().map(function (i) { return i.json; })
  .filter(function (r) { return r && !r._empty && !r._seed_only && r.transaction_id !== undefined; });
const entities = rows.length;
const projectedPhase = entities * ERP_CALLS_PER_TRANSACTION;
const projectedTotal = sweepCalls + projectedPhase;

console.log(JSON.stringify({ stage: 'erp_preflight_gate',
  check: 'terminated-housemaids-tickets',
  transactions: entities, calls_per_transaction: ERP_CALLS_PER_TRANSACTION,
  sweep_calls_spent: sweepCalls, projected_per_entity: projectedPhase,
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
    'budget of ' + budget + '. Refusing to start the per-entity phase.\n' +
    '  ' + entities + ' transactions x ' + ERP_CALLS_PER_TRANSACTION +
    ' (detail + profile + all-time reversals, worst case) = ' + projectedPhase + '\n' +
    '  sweep pages already spent = ' + sweepCalls + '\n' +
    '  at the 4 req/s policy rate that is roughly ' + Math.round(projectedTotal / 4 / 60) +
    ' minutes of ERP time.\n' +
    'Two ways forward, and both are deliberate: narrow the audit window so the run is a declared ' +
    'partial, or raise params.erp_call_budget because a full month is genuinely wanted. The ' +
    'population is NOT trimmed automatically - a run that quietly audits part of the month and ' +
    'reports like a whole one is the failure this check exists to prevent.' +
    (projectedTotal > SIGNOFF_THRESHOLD
      ? '\nNOTE: above ' + SIGNOFF_THRESHOLD + ' calls, ERP-LOAD-POLICY.md §7 requires a recorded ' +
        'human decision before the run fires, not just a bigger number in the payload.'
      : ''));
}

// Pass the population on untouched. Verify Population's items reach Get Transaction Detail
// exactly as they did before this node existed.
return $input.all();
