// Fail Loudly (CC Overstay Fines) — the end of the error rail. Replaces `Fail The Run`.
//
// WHY THE RAIL EXISTS. This flow acquires the ERP lease before `Get CC Change of Status
// Transactions` and releases it after `Write Run`. Until this audit there was no lease at all;
// now that there is one, every way this flow can die between those two points — a breaker trip,
// a budget refusal, a dead token, an ERP 500, a paired-item throw — would otherwise leave the
// lease held by a run that no longer exists, and the staleness backstop only clears it after
// three hours. That is a three-hour hole in the queue after every failure.
//
// THE ORDER ON THE RAIL IS DELIBERATE: capture, record, release, THEN fail.
//   Build Error Callback   reads the real error item and names the node that produced it
//   Build Error Run Row    writes the Runs row, so a failed run still has a record it ran
//   Release Lease (error)  hands the lease back
//   Fail Loudly            re-throws
// The release sits after the record rather than before it because nothing between them touches
// ERP, and putting the capture first is the only way `Build Error Callback` sees the failure
// instead of the lease sub-workflow's return value.
//
// WHY IT IS AN ERROR OUTPUT AND NOT THE ERROR TRIGGER. `On Workflow Crash` fires in a SEPARATE
// execution, where `$('Build Run Context')` does not resolve — so it cannot name the run that
// holds the lease, and a release that guesses is the silent-steal path the lease exists to
// prevent. An error OUTPUT stays inside the same execution, so the release names the real
// holder. There is a second reason here specifically: this flow is MANUAL-ONLY, and n8n does not
// fire error workflows for manual executions at all. On the only way this check is ever run, the
// Error Trigger is not a rail — it is decoration.
//
// WHY IT RE-THROWS. n8n marks an execution SUCCESS when it runs off the end of an error output.
// A rail that released and stopped would turn a failed audit into one the run log reports as
// fine — strictly worse than the stranded lease it was added to fix, because a stranded lease is
// loud within three hours and a silently-successful audit is never looked at again.
const item = $input.first().json || {};

// This node sits downstream of `Release Lease (error)`, so the item it receives is the LEASE's
// return value, not the original error. The error was already read, classified and recorded by
// `Build Error Callback`; that node is asked for it by name rather than re-derived here, so
// there is exactly one classification of any given failure in this flow.
let failedNode = 'unknown node';
let message = 'unknown error';
let errorCode = '';
try {
  const e = ($('Build Error Callback').first().json || {}).error || {};
  failedNode = String(e.node || failedNode);
  message = String(e.message || message);
  errorCode = String(e.code || '');
} catch (err) { /* the rail fired before Build Error Callback could run */ }

let runId = 'unknown';
let auditWindow = '';
try {
  const c = $('Build Run Context').first().json;
  runId = String(c.run_id);
  auditWindow = String(c.window_from || '') + ' to ' + String(c.window_to || '');
} catch (err) { /* crashed before intake, or running inside the Error Trigger's execution */ }

// The lease call's own answer, so "was the lease actually handed back?" is a fact in the log
// rather than an assumption. A release from a non-holder is a no-op by construction — which is
// the correct outcome when the rail fired at `Acquire ERP Lease` itself and this run never held
// anything.
const leaseAction = String(item.action || '');
const leaseState = String(item.state || '');

console.log(JSON.stringify({ stage: 'cc_overstay_fines_failed', run_id: runId,
  audit_window: auditWindow, failed_node: failedNode, error_code: errorCode, error: message,
  lease_action: leaseAction || null, lease_state: leaseState || null,
  note: 'ERP lease RELEASED on the error rail. Without it this run would have held the lease ' +
        'until the 3-hour staleness backstop, because Release ERP Lease sits after Write Run ' +
        'and never runs when the flow dies.' }));

throw new Error('CC OVERSTAY FINES FAILED at "' + failedNode + '"' +
  (errorCode ? ' [' + errorCode + ']' : '') + ': ' + message +
  ' | The ERP lease was released (' + (leaseAction || 'no lease action reported') +
  '), so the next audit is not blocked. | Window ' + auditWindow + ', run ' + runId +
  '. | The Cases and Verdicts tables were NOT written for this run, so there is no partial ' +
  'result to mistake for a complete one; the Runs row written by this rail records the failure. ' +
  'Re-run the same window once the cause is fixed.');
