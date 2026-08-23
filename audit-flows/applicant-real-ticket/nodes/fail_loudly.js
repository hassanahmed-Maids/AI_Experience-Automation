// Fail Loudly (Applicant Real Ticket, the audit check) - the end of the error rail.
//
// WHY THE RAIL EXISTS. This flow acquires the ERP lease before Get Independent Count and releases
// it after the run row is written. Until 2026-08-23 it took no lease at all; now that it does,
// every way it can die between those two points - a breaker trip, a budget refusal, an expired
// token, a Population Guard refusal, a foreign expense id - would otherwise leave the lease held
// by a run that no longer exists, and the staleness backstop only clears it after 3 hours. That
// is a 3-hour hole in the queue after every failure, and this flow is DESIGNED to refuse: half
// its guards throw on purpose.
//
// WHY IT IS AN ERROR OUTPUT AND NOT THE ERROR TRIGGER. On Workflow Crash fires in a SEPARATE
// execution, where $('Validate Inputs') does not resolve - so it cannot name the run that holds
// the lease, and a release that guesses is the silent-steal path the lease exists to prevent. An
// error OUTPUT stays inside the same execution, so the release names the real holder. On Workflow
// Crash keeps its own job, writing the error run row; it does not touch the lease.
//
// WHY IT RE-THROWS. n8n marks an execution SUCCESS when it runs off the end of an error output.
// A rail that released and stopped would turn a refused audit into one the run log reports as
// fine - strictly worse than the stranded lease it was added to fix, because a stranded lease is
// loud within three hours and a silently-successful audit is never looked at again. It matters
// more here than anywhere: this check's guards refuse rather than degrade, and a refusal that
// reads as success is a truncated population presented as a clean month.
// READ THE FAILURE FROM Capture Failure, NOT FROM $input. Release Lease (error) sits between the
// failing node and this one, and an Execute Sub-workflow node REPLACES the item with the lease's
// own return value - so $input here holds the lease's answer, not the error. Reading $input is
// what this rail did until 2026-08-23, and it would have reported "unknown node / unknown error"
// on every failure it ever handled. Nobody saw it because no rail in this project has yet fired.
let msg = 'unknown error', failedNode = 'unknown node';
try {
  const f = ($('Capture Failure').first().json || {})._failure || {};
  if (f.message) msg = String(f.message);
  if (f.node) failedNode = String(f.node);
} catch (e) { }

let runId = 'unknown';
let window = '';
try {
  const p = ($('Validate Inputs').first().json || {}).params || {};
  runId = String(p.run_id || 'unknown');
  window = String(p.window_from || '') + ' to ' + String(p.window_to || '');
} catch (e) { }

console.log(JSON.stringify({ stage: 'applicant_real_ticket_failed', run_id: runId,
  window: window, failed_node: failedNode, error: msg,
  note: 'ERP lease RELEASED on the error rail. Without it this run would have held the lease ' +
        'until the 3-hour staleness backstop, because Release ERP Lease sits after Write Run and ' +
        'never runs when the flow dies.' }));

throw new Error('APPLICANT REAL TICKET FAILED at "' + failedNode + '": ' + msg +
  ' | The ERP lease was released, so the next audit is not blocked. | No case, verdict or run row ' +
  'was written for this run, so there is no partial result to mistake for a complete one - and ' +
  'the publisher refuses any run whose population assertion did not pass. Re-run the same window ' +
  'once the cause is fixed.');
