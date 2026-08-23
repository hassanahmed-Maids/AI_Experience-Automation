// Fail Loudly (MV Monthly Payment Stage 1) - the end of the error rail.
//
// WHY THE RAIL EXISTS. Stage 1 acquires the ERP lease before Count Cohorts and releases it after
// Deliver Run. Until now that release was the ONLY one, so every way this flow could fail - a
// dropped ERP session, a breaker trip in Stage 0 or Stage 2, a budget refusal, a short case set
// in Stage 3 - left the lease held by a run that no longer exists. The staleness backstop clears
// it after 3 hours, which is a 3-hour hole in the queue after every failure.
//
// The old note said an Error Trigger could not recover the run's run_id and a force-release would
// be the silent-steal path the lease exists to prevent. Both true, and both irrelevant to THIS
// shape: an error OUTPUT stays inside the same execution, so $('Validate Run Input') still
// resolves and the release names the real holder. No steal, no guess.
//
// WHY IT RE-THROWS. n8n marks an execution SUCCESS when it runs off the end of an error output.
// A rail that released and stopped would turn a failed audit into one the run log reports as
// fine - strictly worse than the stranded lease it was added to fix, because a stranded lease is
// loud within three hours and a silently-successful audit is never looked at again.
const item = $input.first().json || {};

// The error output's shape is not guaranteed: n8n puts a string here for some node types and an
// object for others. Both are handled rather than one assumed.
const raw = item.error;
const msg = typeof raw === 'string' ? raw
          : String((raw && raw.message) || item.message || 'unknown error');
const failedNode = String((raw && raw.node && raw.node.name) || item.node || 'unknown node');

let runId = 'unknown';
let auditedMonth = '';
try {
  const v = $('Validate Run Input').first().json;
  runId = String(v.runId);
  auditedMonth = String(v.auditedMonth || '');
} catch (e) { }

console.log(JSON.stringify({ stage: 'mvmp_stage1_failed', run_id: runId,
  audited_month: auditedMonth, failed_node: failedNode, error: msg,
  note: 'ERP lease RELEASED on the error rail. Without it this run would have held the lease ' +
        'until the 3-hour staleness backstop, because Release ERP Lease sits after Deliver Run ' +
        'and never runs when the flow dies.' }));

throw new Error('MV MONTHLY PAYMENT STAGE 1 FAILED at "' + failedNode + '": ' + msg +
  ' | The ERP lease was released, so the next audit is not blocked. | Whatever this slice had ' +
  'already scored is in the Cases table under run ' + runId + ' - roll it up with the ' +
  'mv-monthly-payment-rollup webhook (Stage 3) rather than re-sweeping, and pass ' +
  'contractsPlanned as the number actually attempted, not the population.');
