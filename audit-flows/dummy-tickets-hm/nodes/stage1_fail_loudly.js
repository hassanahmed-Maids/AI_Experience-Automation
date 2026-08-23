// Fail Loudly (Dummy Tickets Housemaids, 1-Score) - the end of the error rail.
//
// WHY THE RAIL EXISTS. This flow acquires the ERP lease before Get Dummy Ticket Transactions and
// releases it after the verdict rows reach the sheet - which is AFTER the last ERP call, because
// Get All-Time Refunds sits downstream of the case and summary writes. Until 2026-08-23 there
// was no lease at all; now that there is one, every way this flow can die between those two
// points - a breaker trip, a budget refusal, a dead token, a sub-workflow throw - would
// otherwise leave the lease held by a run that no longer exists, and the staleness backstop only
// clears it after 3 hours. That is a 3-hour hole in the queue after every failure.
//
// WHY IT IS AN ERROR OUTPUT AND NOT THE ERROR TRIGGER. On Workflow Crash fires in a SEPARATE
// execution, where $('Validate Inputs') does not resolve - so it cannot name the run that holds
// the lease, and a release that guesses is the silent-steal path the lease exists to prevent. An
// error OUTPUT stays inside the same execution, so the release names the real holder. The Error
// Trigger keeps its job of reporting a crash to the caller; it does not touch the lease.
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
let auditWindow = '';
try {
  const v = $('Validate Inputs').first().json;
  runId = String(v.run_id);
  auditWindow = String(v.range_start || '') + ' to ' + String(v.range_end || '');
} catch (e) { }

console.log(JSON.stringify({ stage: 'dummy_tickets_hm_1score_failed', run_id: runId,
  audit_window: auditWindow, failed_node: failedNode, error: msg,
  note: 'ERP lease RELEASED on the error rail. Without it this run would have held the lease ' +
        'until the 3-hour staleness backstop, because Release ERP Lease sits at the end of the ' +
        'delivery chain and never runs when the flow dies.' }));

throw new Error('DUMMY TICKETS HOUSEMAIDS 1-SCORE FAILED at "' + failedNode + '": ' + msg +
  ' | The ERP lease was released, so the next audit is not blocked. | Anything already written to ' +
  'the sheet for this run is a PARTIAL and must not be read as the month: the run died before ' +
  'its verdicts were delivered. Re-run the same window once the cause is fixed.');
