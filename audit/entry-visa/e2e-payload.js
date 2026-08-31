'use strict';
/**
 * Builds the end-to-end test payload for the n8n flow, and the expected result.
 *
 * The SAME fixtures the offline harness uses, combined into ONE population and run through
 * the offline scorer to produce the expected numbers. The n8n flow is then given the
 * identical payload and its output compared field by field.
 *
 * That comparison is the only thing that proves the generated node in n8n is the scorer
 * that was tested. A node edited in the UI, a corrupted paste, or a stale regeneration all
 * show up here as a numeric disagreement.
 */
const { CASES, AS_OF } = require('./test-cases.js');
const S = require('./scorer.js');

// The seven spec test cases only — the guards are single-purpose edge probes and several
// deliberately share owner ids, which would create cross-fixture gate-13 pairs that mean
// nothing. The spec cases are real, distinct requests.
const specCases = CASES.filter(function (c) { return /^TC\d/.test(c.name); });

// PLUS the regression case, deliberately.
//
// The e2e comparison is the ONLY thing that proves the n8n node still behaves like this
// scorer. That makes it a drift detector, and a drift detector is only as good as the paths
// it exercises: a fixture set that never produces a gate-15 case cannot notice a node whose
// gate-15 handling is missing or stale.
//
// This is exactly what went wrong once already — the undateable-charge guard existed here
// and not in n8n, and every fixture carried a date, so nothing failed. Now one does not.
const undateable = {
  requestId: 70018, ownerId: 716, ownerType: 'HOUSEMAID',
  stopped: true, taskName: 'x', identityAgrees: true, everRejectedKnown: true,
  rejectionDates: ['2026-03-01 00:00:00'],
  expenses: [{ id: 98, purpose: 'Entry Visa > 1000 AED', status: 'Added',
               amount: 1054.71, transactionId: 555, transactionDate: null, paymentDate: null }],
  cancelSideRefunds: []
};

const population = [];
specCases.forEach(function (c) {
  c.input.requests.forEach(function (r) { population.push(r); });
});
population.push(undateable);

const expected = S.score({ requests: population }, { asOf: AS_OF });

const payload = {
  run_id: 'e2e-' + AS_OF + '-spec7',
  window_from: '2025-09-05',
  window_to: AS_OF,
  as_of: AS_OF,
  dry_run: true,
  population_source: 'pinned:spec-test-cases-1-7',
  expected_population_count: population.length,
  population: population
};

if (process.argv[2] === '--expected') {
  console.log(JSON.stringify({
    population_count: population.length,
    summary: expected.summary,
    declared_gap_ids: expected.declared_gaps.map(function (g) { return g.id; }).sort()
  }, null, 2));
} else {
  console.log(JSON.stringify(payload));
}
