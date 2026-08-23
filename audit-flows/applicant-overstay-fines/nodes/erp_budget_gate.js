// ERP PRE-FLIGHT BUDGET GATE — ERP-LOAD-POLICY.md §3. Canonical: tools/erp_preflight_gate.js.
//
// Sits on the TRUE branch of `Has Cases?`, between it and `Get Transaction Detail`. That is the
// last point before the first PER-ENTITY ERP call: everything upstream is the paginated cohort
// walk, whose cost is a handful of pages whatever the window; everything downstream multiplies
// by the number of over-base transactions.
//
// WHY VOLUME NEEDS ITS OWN CONTROL. Pacing bounds requests per second. It does not bound how
// many there are. This flow paced perfectly at 4 req/s still makes 3N calls for its
// deterministic band alone, and up to 78N once the verifier band fans out - and that is the
// shape of the failure that took ERP down three times: a check tested on one month behaves
// identically on a year, and nothing in between makes the cost visible before the calls go out.
//
// IT HARD-FAILS. It does not trim the cohort to fit. Auto-capping produces a run that completes
// with incomplete coverage, and a partial audit that looks complete is the single failure this
// whole check family exists to avoid. The throw names both numbers so the operator's next move
// is obvious: narrow the window deliberately, or raise the budget deliberately.

// --- per-flow constants: what this run actually costs, stated honestly -----------------------
// The deterministic band, one call each per over-base transaction:
//   1. Get Transaction Detail  - identity. One per transaction, always.
//   2. Get Overstay Fines      - one per transaction with a resolved maid. Budgeted at one per
//                                transaction rather than per unique maid, because identity is
//                                only resolved AFTER the detail call. A budget that assumes the
//                                happy case is not a budget.
//   3. Get Housemaid Loans     - one per case that got past the fines read, worst case one per
//                                transaction.
const ERP_CALLS_PER_TRANSACTION = 3;

// The verifier band. It is CONDITIONAL - only a case with a waived OVERSTAY_FINES_FEES loan or
// an unsettled fine reduction reaches it - and in nine months of live data measured 2026-08-12
// exactly ZERO cases did. But "usually zero" is not a bound, and this is the band that fans out:
//   4. Get Maid Complaints  - one call per verifier case.
//   5. Get Complaint Thread - one call per complaint the keyword scan selects, PLUS one wasted
//                             call per case with no thread worth reading (that carrier item
//                             still reaches the HTTP node with an empty complaint_id). The
//                             largest complaint list measured live on this endpoint was 74 rows
//                             (maid 113572, 2026-08-12; 66 and 49 on two others), so 74 is the
//                             measured worst case for one maid, not a guess.
const MAX_THREADS_PER_CASE = 74;
const VERIFIER_CALLS_PER_CASE = 1 + MAX_THREADS_PER_CASE;

// Worst case every transaction needs the verifier. That is what makes this projection an upper
// bound rather than a forecast, and the log below prints the realistic floor next to it so the
// operator is deciding between two real numbers instead of one scary one.
const SWEEP_CALLS_FALLBACK = 5;      // cohort pages, when the run cannot report what it walked

const DEFAULT_BUDGET = 2000;         // ERP-LOAD-POLICY.md §1 — a run that names no budget
const SIGNOFF_THRESHOLD = 15000;     // above this a human decision must be recorded first

const _ctx = $('Build Run Context').first().json || {};
const params = _ctx.params || {};

const askedBudget = Number(params.erp_call_budget);
const budget = Number.isFinite(askedBudget) && askedBudget > 0 ? askedBudget : DEFAULT_BUDGET;

// Prefer what the run MEASURED over the constant: `Verify Cohort Pull` already counted the pages
// it walked, and a real number beats an estimate that quietly ages.
let measuredPages = 0;
try {
  measuredPages = Number((($('Verify Cohort Pull').first().json || {}).population || {}).pages_fetched) || 0;
} catch (e) { measuredPages = 0; }
const sweepCalls = measuredPages > 0 ? measuredPages : SWEEP_CALLS_FALLBACK;

// The sentinel never reaches this branch - `Has Cases?` routes `no_cases` the other way - but it
// is filtered anyway, because a gate that counts a sentinel as an entity projects a cost for
// work that will not happen.
const rows = $input.all().map(function (i) { return i.json; })
  .filter(function (r) { return r && r.no_cases !== true && r.case_key !== undefined; });
const entities = rows.length;

const projectedDeterministic = entities * ERP_CALLS_PER_TRANSACTION;
const projectedVerifier = entities * VERIFIER_CALLS_PER_CASE;
const projectedTotal = sweepCalls + projectedDeterministic + projectedVerifier;
// The floor: what the run costs if the verifier band stays empty, which is what nine months of
// live data say it does. Printed, never used as the budget test - see below.
const projectedFloor = sweepCalls + projectedDeterministic;

console.log(JSON.stringify({ stage: 'erp_preflight_gate',
  check: 'cc-overstay-fines',
  over_base_transactions: entities,
  calls_per_transaction: ERP_CALLS_PER_TRANSACTION,
  verifier_calls_per_case_worst_case: VERIFIER_CALLS_PER_CASE,
  sweep_calls_spent: sweepCalls,
  projected_deterministic_band: projectedDeterministic,
  projected_verifier_band_worst_case: projectedVerifier,
  projected_total_worst_case: projectedTotal,
  projected_floor_if_no_verifier_cases: projectedFloor,
  budget: budget,
  budget_source: Number.isFinite(askedBudget) && askedBudget > 0
    ? 'Build Run Context params.erp_call_budget' : 'default (' + DEFAULT_BUDGET + ')',
  minutes_at_policy_rate_worst_case: Math.round(projectedTotal / 4 / 60),
  minutes_at_policy_rate_floor: Math.round(projectedFloor / 4 / 60),
  within_budget: projectedTotal <= budget }));

// THE TEST IS THE WORST CASE, NOT THE FLOOR, and that is a deliberate choice with a cost.
// Budgeting the floor would let a run start that cannot finish inside its budget the moment the
// verifier band is not empty - and the whole reason that band has never fired is that no waived
// overstay loan has appeared yet, which is a fact about nine months of data, not a guarantee.
// A gate that only bounds the cheap half of a run is not a gate. The floor is logged so raising
// the budget is an informed act rather than a shrug.
if (projectedTotal > SIGNOFF_THRESHOLD) {
  console.log(JSON.stringify({ stage: 'erp_preflight_high_volume',
    projected_total: projectedTotal, threshold: SIGNOFF_THRESHOLD, budget: budget,
    minutes_at_policy_rate: Math.round(projectedTotal / 4 / 60),
    allowed: projectedTotal <= budget,
    note: 'ERP-LOAD-POLICY.md §7: a run this size needs a recorded human decision. The explicit ' +
          'erp_call_budget in Build Run Context is that record; this line is where it can be ' +
          'found afterwards.' }));
}

if (projectedTotal > budget) {
  throw new Error(
    'ERP PRE-FLIGHT GATE: this run could make about ' + projectedTotal + ' ERP calls against a ' +
    'budget of ' + budget + '. Refusing to start the per-entity phase.\n' +
    '  ' + entities + ' over-base transactions x ' + ERP_CALLS_PER_TRANSACTION +
    ' (detail + fines + loans) = ' + projectedDeterministic + '\n' +
    '  ' + entities + ' x ' + VERIFIER_CALLS_PER_CASE + ' (complaints list + up to ' +
    MAX_THREADS_PER_CASE + ' threads, worst case every case needs the verifier) = ' +
    projectedVerifier + '\n' +
    '  cohort pages already spent = ' + sweepCalls + '\n' +
    '  floor if the verifier band stays empty, as it has for nine months = ' + projectedFloor + '\n' +
    '  at the 4 req/s policy rate the worst case is roughly ' +
    Math.round(projectedTotal / 4 / 60) + ' minutes of ERP time.\n' +
    'Two ways forward, and both are deliberate: narrow the window in Build Run Context so the ' +
    'run is a declared partial, or raise params.erp_call_budget there because the whole window ' +
    'is genuinely wanted. The cohort is NOT trimmed automatically - a run that quietly audits ' +
    'part of the window and reports like a whole one is the failure this check exists to prevent.' +
    (projectedTotal > SIGNOFF_THRESHOLD
      ? '\nNOTE: above ' + SIGNOFF_THRESHOLD + ' calls, ERP-LOAD-POLICY.md §7 requires a recorded ' +
        'human decision before the run fires, not just a bigger number in the payload.'
      : ''));
}

// Pass the cohort on untouched. `Get Transaction Detail` reads `$json.txn_id` from these items
// exactly as it did when `Has Cases?` fed it directly.
return $input.all();
