// ERP PRE-FLIGHT BUDGET GATE — ERP-LOAD-POLICY.md §3. Canonical: tools/erp_preflight_gate.js.
//
// Sits between `Route by skip_computation` and `Get Transaction Detail`, which is the last point
// before the first PER-ENTITY ERP call. Everything upstream is the paginated cohort sweep, whose
// cost is a handful of pages; everything downstream multiplies by the population.
//
// It is deliberately AFTER the switch rather than before it, so it counts the items that will
// actually be enriched (`in_range`) and not the carried-forward cases, which cost nothing: a
// gate that over-counts is a gate someone eventually raises the budget to silence.
//
// WHY VOLUME NEEDS ITS OWN CONTROL. Pacing bounds requests per second; it does not bound how
// many there are. This flow paced perfectly at 4 req/s still makes 12N calls for N over-base
// transactions, and that is the shape of the failure that took ERP down three times: a check
// tested on August (151 cohort rows) behaves identically on January (811), and nothing in
// between makes the cost visible before the calls go out.
//
// IT HARD-FAILS. It does not trim the cohort to fit. Auto-capping produces a run that completes
// with incomplete coverage, and a partial audit that looks complete is the single failure this
// whole check family exists to avoid - the same reason `Verify Cohort Pull` aborts on a short
// walk instead of scoring what it got.

// --- per-flow constants: what this run actually costs, stated honestly -----------------------
// ENRICHMENT LANE, one call each per over-base transaction:
//   1. Get Transaction Detail   - always.
//   2. Get Overstay Fines       - only for identity-RESOLVED transactions, so fewer in practice.
//   3. Get Overstay Payments    - same subset.
// Budgeted at the full count rather than the resolved subset, because identity is only known
// after call 1 and a budget that assumes the happy case is not a budget.
const ERP_CALLS_PER_TRANSACTION = 3;

// EVIDENCE LANE, downstream of `Build Case Payload`, per RED case:
//   4. Get Maid Complaints      - one list call.
//   5. Get Complaint Thread     - up to MAX_THREADS_PER_CASE = 8, the cap set in
//                                 `Split Relevant Complaints`.
// Only red cases reach it, and a normal month reds a small minority - but "how many will be red"
// is exactly what this run has not computed yet, so the worst case is one red per transaction.
// This is the larger half of the bill and the half a reader is most likely to forget: the
// enrichment sticky note has always said "three calls per transaction", and three is 25% of it.
const ERP_CALLS_DOWNSTREAM_PER_TRANSACTION = 9;

const ERP_CALLS_PER_ENTITY = ERP_CALLS_PER_TRANSACTION + ERP_CALLS_DOWNSTREAM_PER_TRANSACTION; // 12

// Cohort pages already spent. January (811 rows) walks 5 pages at size=200; the node's own
// maxRequests hard-caps the walk at 50. Only used when the run cannot report what it walked.
const SWEEP_CALLS_FALLBACK = 5;

const DEFAULT_BUDGET = 2000;         // ERP-LOAD-POLICY.md §1 — a run that names no budget
const SIGNOFF_THRESHOLD = 15000;     // above this a human decision must be recorded first

const _validated = $('Validate Inputs').first().json || {};
const params = _validated.params || {};

const askedBudget = Number(params.erp_call_budget);
const budget = Number.isFinite(askedBudget) && askedBudget > 0 ? askedBudget : DEFAULT_BUDGET;

// Prefer what the run MEASURED over the constant: `Verify Cohort Pull` already reconciled the
// walk and knows how many pages it took, and a real number beats an estimate that quietly ages.
let measuredPages = 0;
try { measuredPages = Number($('Verify Cohort Pull').first().json.pages_fetched) || 0; } catch (e) { measuredPages = 0; }
if (!measuredPages) {
  try { measuredPages = $('Get Change of Status Transactions').all().length; } catch (e) { measuredPages = 0; }
}
const sweepCalls = measuredPages > 0 ? measuredPages : SWEEP_CALLS_FALLBACK;

// One item per in-range case. `Split Transactions` emits a lone `_no_overstay_in_window` marker
// for a month where nothing cleared the base, and `Merge with previous_cases` drops anything
// without a txn_id, so both are filtered rather than counted as work.
const rows = $input.all().map(function (i) { return i.json; })
  .filter(function (r) { return r && !r._no_overstay_in_window && r.txn_id; });
const entities = rows.length;
const projectedEnrichment = entities * ERP_CALLS_PER_TRANSACTION;
const projectedEvidence = entities * ERP_CALLS_DOWNSTREAM_PER_TRANSACTION;
const projectedTotal = sweepCalls + projectedEnrichment + projectedEvidence;

console.log(JSON.stringify({ stage: 'erp_preflight_gate',
  check: 'mv-overstay-fines',
  run_id: _validated.run_id || null,
  audit_window: String(_validated.range_start || '') + ' to ' + String(_validated.range_end || ''),
  transactions: entities, calls_per_transaction: ERP_CALLS_PER_ENTITY,
  projected_enrichment: projectedEnrichment, projected_evidence_worst_case: projectedEvidence,
  sweep_calls_spent: sweepCalls, projected_total: projectedTotal, budget: budget,
  budget_source: Number.isFinite(askedBudget) && askedBudget > 0
    ? 'params.erp_call_budget' : 'default (' + DEFAULT_BUDGET + ')',
  minutes_at_policy_rate: Math.round(projectedTotal / 4 / 60),
  within_budget: projectedTotal <= budget }));

// ABOVE THE SIGN-OFF THRESHOLD, BE LOUD EVEN WHEN ALLOWED. ERP-LOAD-POLICY.md §7 says a run over
// the threshold needs a recorded human decision. Setting params.erp_call_budget high enough IS
// that decision - it is an explicit act in the payload - but a decision nobody can find later is
// not much of a record. Without this the threshold only ever appeared inside a refusal, which
// meant the one case it most needed to mark - a large run that was ALLOWED - was the case it
// said nothing about.
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
    '  ' + entities + ' over-base transactions x ' + ERP_CALLS_PER_TRANSACTION +
    ' (detail + OS fines + overstay-fee payments) = ' + projectedEnrichment + '\n' +
    '  ' + entities + ' x ' + ERP_CALLS_DOWNSTREAM_PER_TRANSACTION +
    ' (complaints list + up to 8 threads, worst case every case red) = ' + projectedEvidence + '\n' +
    '  cohort pages already spent = ' + sweepCalls + '\n' +
    '  at the 4 req/s policy rate that is roughly ' + Math.round(projectedTotal / 4 / 60) +
    ' minutes of ERP time.\n' +
    'Two ways forward, and both are deliberate: narrow audit_window so the run is a declared ' +
    'partial, or raise params.erp_call_budget because a full month is genuinely wanted. The ' +
    'cohort is NOT trimmed automatically - a run that quietly audits part of the month and ' +
    'reports like a whole one is the failure this check exists to prevent, and `Verify Cohort ' +
    'Pull` already refuses a partial walk for the same reason.' +
    (projectedTotal > SIGNOFF_THRESHOLD
      ? '\nNOTE: above ' + SIGNOFF_THRESHOLD + ' calls, ERP-LOAD-POLICY.md §7 requires a recorded ' +
        'human decision before the run fires, not just a bigger number in the payload.'
      : ''));
}

// Pass the population on untouched, with the item-linking chain PINNED. `Attach Identity` runs
// Once for Each Item and reads `$('Split Transactions').item`, and n8n does not auto-assign
// pairedItem for a node running Once for All Items - `Merge with previous_cases` sets it by hand
// for exactly this reason and records the live failure that taught it. Inserting this gate into
// that chain without pinning would sever it. Output item i came from input item i.
const _out = $input.all();
for (let i = 0; i < _out.length; i++) _out[i].pairedItem = { item: i };
return _out;
