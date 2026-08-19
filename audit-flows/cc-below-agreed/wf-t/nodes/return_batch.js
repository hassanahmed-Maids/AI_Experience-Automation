// Return Batch Result (WF-T) - hand the caller the scored cases and the write receipt, then
// let this execution die with everything else.
//
// WHAT CROSSES THE BOUNDARY AND WHY IT IS STILL THE WHOLE CASE. The scored cases go back in
// full, because Build Runs Log, Build Case Payload, Build Summary Row, Select Candidates and
// Assemble Baton between them read almost every field - and unlike the sweeps there is no
// re-read available for anything left behind: these objects are derived, not fetchable. So
// this boundary does not shrink a case; it BOUNDS how many exist at once.
//
// WHAT IT REMOVES, measured against execution 93346's structure: WF-A used to retain the full
// case list at Compute Case States, Guards, Adjudicate Cases, Build Sheet Rows AND the Sheets
// node's echo of the appended rows - five retained copies at ~2.5 KB a case over 5,632 cases,
// about 70 MB. All five now live and die inside one batch's sub-execution. What WF-A keeps is
// Merge Streams, the chunker, the joined result, Build Runs Log and Build Case Payload.
//
// THE SHEET IS ALREADY WRITTEN by the time this runs. That is the second half of the point:
// the Cases tab is appended per batch, so a crash after batch 5 leaves five batches of rows
// on the sheet instead of nothing at all, and rows_appended below is the receipt that says
// how many. A run that reports cases it never wrote is the failure this makes visible.
const rows = $input.all();
const cases = $('Stamp Display Bands').all().map(function (i) { return i.json; });
const ctx = $('When Called').first().json || {};

// The Sheets node returns one item per appended row. FEWER than the batch's cases means the
// append was partial, and a partial write reported as success leaves a reviewer working from
// a queue that is quietly short. MORE means the append landed twice - a duplicated review
// queue and doubled totals - which is the risk the node's retry setting introduces, so it is
// checked in the same breath rather than assumed away.
const appended = rows.length;
if (appended < cases.length) {
  throw new Error('WF-T: the Cases append returned ' + appended + ' rows for ' + cases.length +
    ' cases in batch ' + (ctx.batch_index === undefined ? '?' : ctx.batch_index) + '. A short ' +
    'write means the review queue is missing cases this run will nonetheless report as audited.');
}
if (appended > cases.length) {
  throw new Error('WF-T: the Cases append returned ' + appended + ' rows for only ' + cases.length +
    ' cases in batch ' + (ctx.batch_index === undefined ? '?' : ctx.batch_index) + '. The append ' +
    'landed more than once, so the review queue and the run totals would both be doubled.');
}

const bands = {};
let candidateAed = 0, requiresVerifier = 0, escalationBlocked = 0;
for (const c of cases) {
  const b = c.display_band || 'unknown';
  bands[b] = (bands[b] || 0) + 1;
  const cm = c.computed || {};
  if (b === 'candidate' && cm.expected_known !== false) {
    candidateAed += (Number(cm.shortfall) || 0);
  }
  if (c.requires_verifier === true) requiresVerifier++;
  if (c.escalation_blocked === true) escalationBlocked++;
}

console.log(JSON.stringify({ stage: 'wft_return_batch',
  batch_index: ctx.batch_index === undefined ? null : ctx.batch_index,
  batch_count: ctx.batch_count === undefined ? null : ctx.batch_count,
  cases: cases.length, rows_appended: appended, bands: bands,
  candidate_aed: Math.round(candidateAed * 100) / 100,
  requires_verifier: requiresVerifier, escalation_blocked: escalationBlocked,
  note: 'counts and totals only in this line - per-case amounts and identities travel in the ' +
        'returned cases, which go to the case store and the Cases tab, never into a log' }));

return [{ json: {
  scored_cases: cases,
  _projected_by: 'CC Below Agreed - 1-Score Batch',
  _batch_index: ctx.batch_index === undefined ? null : ctx.batch_index,
  _cases: cases.length,
  _rows_appended: appended,
  _bands: bands,
  _candidate_aed: Math.round(candidateAed * 100) / 100,
  _requires_verifier: requiresVerifier,
  _escalation_blocked: escalationBlocked
} }];
