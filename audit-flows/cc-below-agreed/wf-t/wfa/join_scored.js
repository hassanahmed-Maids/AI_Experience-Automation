// Join Scored (WF-A) - put the batches back together, and refuse anything short.
//
// WF-T returns one item per batch carrying that batch's scored cases. This flattens them into
// the single { cases: [...] } item Build Runs Log has always read off its own input, so
// Build Runs Log, Build Case Payload, Build Summary Row and Assemble Baton needed no edit at
// all - the same envelope-preserving move as the staged sweeps.
//
// EVERY CHECK BELOW EXISTS BECAUSE A SHORT COHORT IS A FALSE GREEN BY OMISSION. A batch that
// silently returned nothing would produce a run that reports on 4,400 of 5,632 contracts and
// looks completely clean about it - no gate downstream can tell the difference, because they
// all reason about the cases they were given.
const returned = $input.all().map(function (i) { return i.json || {}; });
const expected = $('Chunk Cases').all().map(function (i) { return i.json; });

function s(v) { return v === null || v === undefined ? '' : String(v); }

const expectedCases = expected.reduce(function (t, b) {
  return t + (Array.isArray(b.cases) ? b.cases.length : 0); }, 0);
const expectedBatches = expected.length;

let cases = [];
const seenBatches = [];
let rowsAppended = 0;
const bands = {};
let candidateAed = 0, requiresVerifier = 0, escalationBlocked = 0;

for (const r of returned) {
  const list = Array.isArray(r.scored_cases) ? r.scored_cases : null;
  if (!list) {
    throw new Error('Join Scored: a WF-T return carried no scored_cases array (keys=' +
      Object.keys(r).join(',') + '). Those contracts were either never scored or were scored ' +
      'and lost; either way the run would report on a cohort it never assessed.');
  }
  seenBatches.push(r._batch_index === undefined ? null : r._batch_index);
  rowsAppended += Number(r._rows_appended) || 0;
  candidateAed += Number(r._candidate_aed) || 0;
  requiresVerifier += Number(r._requires_verifier) || 0;
  escalationBlocked += Number(r._escalation_blocked) || 0;
  const b = r._bands || {};
  for (const k of Object.keys(b)) bands[k] = (bands[k] || 0) + (Number(b[k]) || 0);
  cases = cases.concat(list);
}

if (returned.length !== expectedBatches) {
  throw new Error('Join Scored: ' + returned.length + ' batch result(s) for ' + expectedBatches +
    ' batches sent. A missing batch is ~1,200 contracts absent from the run with nothing to ' +
    'mark their absence.');
}
if (cases.length !== expectedCases) {
  throw new Error('Join Scored: ' + cases.length + ' scored cases returned for ' + expectedCases +
    ' sent. The cohort must survive the batch boundary exactly - a short return under-reports ' +
    'coverage while every later gate passes.');
}
// Batch indexes must form 0..n-1 exactly once. A repeat means one batch's cases were counted
// twice (double-reported on the Cases tab and in the run total); a gap means one was dropped.
const sortedIdx = seenBatches.slice().sort(function (a, b) { return a - b; });
for (let i = 0; i < sortedIdx.length; i++) {
  if (sortedIdx[i] !== i) {
    throw new Error('Join Scored: batch indexes came back as [' + seenBatches.join(',') +
      '] for ' + expectedBatches + ' batches. A repeat double-counts ~1,200 contracts and a gap ' +
      'loses them silently.');
  }
}
// Duplicate case_keys across batches would each get their own row on the Cases tab and their
// own contribution to the totals. Checked here as well as inside WF-T, because WF-T only sees
// one batch and cannot detect an overlap BETWEEN batches.
const seen = {};
let dupes = 0;
for (const c of cases) {
  const k = s(c.case_key);
  if (seen[k]) dupes++;
  seen[k] = true;
}
if (dupes > 0) {
  throw new Error('Join Scored: ' + dupes + ' case_key(s) appeared in more than one batch. ' +
    'Each would be written to the Cases tab twice and counted twice in the run total.');
}
// The sheet is written inside WF-T, so this is the only place the write can be reconciled
// against the cohort. Rows are appended per batch: fewer rows than cases means the review
// queue is short of contracts this run is about to report as audited.
if (rowsAppended < cases.length) {
  throw new Error('Join Scored: the Cases tab received ' + rowsAppended + ' rows for ' +
    cases.length + ' scored cases. The review queue is missing cases the run will report on.');
}

// ------------------------------------------- THE CIRCULARITY TRIPWIRE, RUN-LEVEL
// The same test Guards runs, repeated here over the WHOLE cohort, and the reason is the
// batching: Guards arms only at TRIPWIRE_MIN_POPULATION (500) scored cases, so its per-batch
// arming is a function of the batch size. At 1,200 a batch it arms; at 300 it would silently
// stop, and the failure it watches for - ERP's currentPayment falling through to its
// PAYMENT-derived tier, making the audit compare a payment against itself - is the one that
// makes the output look BETTER rather than worse. A guard whose arming depends on a tuning
// parameter is not a guard. So the run-level check lives here, where the cohort is whole and
// the batch size cannot switch it off.
//
// The constants are Guards' constants and must stay in step with them: measured July 2026,
// 4,575 exact of 5,612 = 81.5% is NORMAL, the ceiling is 97%, and 984 were short.
const TOLERANCE = 5.00;
const EXACT_SHARE_CEILING = 0.97;
const TRIPWIRE_MIN_POPULATION = 500;
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
const withVariance = cases.filter(function (k) {
  return !k.skip_computation && k.computed && k.computed.variance !== null &&
         k.computed.variance !== undefined;
});
const exactlyMatched = withVariance.filter(function (k) { return r2(k.computed.variance) === 0; }).length;
const shortfallCases = withVariance.filter(function (k) { return k.computed.variance < -TOLERANCE; }).length;
const exactShare = withVariance.length ? exactlyMatched / withVariance.length : null;
if (withVariance.length >= TRIPWIRE_MIN_POPULATION && exactShare > EXACT_SHARE_CEILING) {
  throw new Error('CIRCULARITY TRIPWIRE (run-level): ' + exactlyMatched + ' of ' + withVariance.length +
    ' scored cases (' + Math.round(exactShare * 1000) / 10 + '%) have expected EXACTLY equal to what was ' +
    'received, against a measured norm of 81.5% and a ceiling of ' +
    Math.round(EXACT_SHARE_CEILING * 100) + '%. Guards checks this per batch; this checks the whole ' +
    'cohort, so the batch size cannot switch it off. The likely cause is ERP\'s currentPayment falling ' +
    'through to its PAYMENT-derived tier - the audit comparing a payment against itself. Refusing to ' +
    'publish these verdicts.');
}
if (withVariance.length >= TRIPWIRE_MIN_POPULATION && shortfallCases === 0) {
  throw new Error('CIRCULARITY TRIPWIRE (run-level): ' + withVariance.length + ' scored cases across ' +
    returned.length + ' batches and NOT ONE is short by more than the AED ' + TOLERANCE.toFixed(2) +
    ' tolerance. July 2026 measured 984 short of 5,612. A perfectly reconciled book of this size is a ' +
    'broken comparison, not good news. Refusing to publish a clean bill of health that was never tested.');
}

console.log(JSON.stringify({ stage: 'join_scored', cases: cases.length,
  batches: returned.length, batch_indexes: seenBatches, rows_appended: rowsAppended,
  bands: bands, candidate_aed: Math.round(candidateAed * 100) / 100,
  requires_verifier: requiresVerifier, escalation_blocked: escalationBlocked,
  cases_with_a_variance: withVariance.length, exactly_matched: exactlyMatched,
  exact_share_pct: exactShare === null ? null : Math.round(exactShare * 1000) / 10,
  shortfall_cases: shortfallCases,
  circularity_tripwire_run_level: withVariance.length < TRIPWIRE_MIN_POPULATION
    ? 'not armed - fewer than ' + TRIPWIRE_MIN_POPULATION + ' scored cases in the whole run'
    : 'armed and passed over the whole cohort, independent of batch size',
  note: 'emits the same { cases } envelope the scorer used to, so Build Runs Log and ' +
        'everything after it is unchanged. The Cases tab was already written, per batch.' }));

return [{ json: { cases: cases, _scored_in_batches: returned.length,
                  _rows_appended: rowsAppended, _bands: bands } }];
