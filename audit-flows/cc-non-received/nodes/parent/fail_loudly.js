// Fail Loudly (CC Non Received Monthly Payments, 1-Score) - the end of the error rail.
//
// WHY THE RAIL EXISTS. This flow acquires the ERP lease before Get Active CC Contracts and does
// NOT release it on the success path - it launches 2-Verify fire-and-forget and ends, so the
// lease is meant to be handed back by 3-Deliver at the end of the chain (see the
// ERP-COMPLIANCE: lease-released-downstream declaration on Acquire ERP Lease). That hand-off
// only ever happens on a run that REACHES 3-Deliver. Every way this flow can die between the
// acquire and Launch Verifier - a gate 2 completeness throw, a budget refusal, a breaker trip,
// a dead ERP token, a sheet write that fails - ends the chain here, and the stage that would
// have released never runs. Without this rail the lease sits held by a run that no longer
// exists until the 3-hour staleness backstop clears it: a 3-hour hole in the queue after every
// failure.
//
// WHY IT IS AN ERROR OUTPUT AND NOT THE ERROR TRIGGER. On Workflow Crash fires in a SEPARATE
// execution, where $('Validate Inputs') does not resolve - so it cannot name the run that holds
// the lease, and a release that guesses which run it is freeing is the silent-steal path the
// lease exists to prevent. An error OUTPUT stays inside the same execution, so the release names
// the real holder. On Workflow Crash keeps its own job - reporting the crash by email - and this
// throw is what fires it.
//
// WHY IT RE-THROWS. n8n marks an execution SUCCESS when it runs off the end of an error output.
// A rail that released and stopped would turn a failed audit into one the run log reports as
// fine - strictly worse than the stranded lease it was added to fix, because a stranded lease is
// loud within three hours and a silently-successful audit is never looked at again. It also
// matters more here than in a leaf flow: 1-Score is the head of a three-stage chain, and a
// "successful" head that launched nothing is indistinguishable from one that did.
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

console.log(JSON.stringify({ stage: 'ccnonreceived_1score_failed', run_id: runId,
  audit_window: auditWindow, failed_node: failedNode, error: msg,
  note: 'ERP lease RELEASED on the error rail. This flow never releases on success - 3-Deliver ' +
        'owns that - so without this rail a dead run would hold the lease for three hours.' }));

throw new Error('CC NON RECEIVED MONTHLY PAYMENTS 1-SCORE FAILED at "' + failedNode + '": ' + msg +
  ' | The ERP lease was released, so the next audit is not blocked. | 2-Verify was NOT launched, ' +
  'so no partial verdict set exists for this run - anything already written to the Cases tab is ' +
  'an unfinished run and must not be read as an audit. Re-run the same window once the cause is ' +
  'fixed.');
