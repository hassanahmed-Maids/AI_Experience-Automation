// Format Failure Email - normalises TWO very different failure shapes into one
// readable email, AND makes the execution actually fail.
//
// Shape A - handled: the error rail's payload from Build Error Callback,
//   { result:'error', error:{ code, message, status, retryable }, run_id, ... }
//
// Shape B - crash: n8n's Error Trigger payload,
//   { execution:{ id, url, error:{ message, stack }, lastNodeExecuted }, workflow:{ id, name } }
//
// Both matter and they catch different things. The rail only sees an ERP call that
// routed to its error output. A THROW - Verify Bulk Pulls in execution 76796 -
// aborts the run and never touches the rail. Without the crash trigger, the loudest
// failures were the silent ones.
//
// ============================ WHY THIS NODE NOW THROWS ============================
// Run 90669 failed after 95 minutes and n8n recorded it as SUCCESS.
//
// The chain is: Get Payment Statuses#error -> Build Error Callback -> Error Gate ->
// THIS NODE -> "Email: audit failed", which is DISABLED and has no outputs. A branch
// that ends in a disabled node is a clean completion as far as n8n is concerned, so
// the rail reached the correct verdict - its own payload even said "No audit result
// was written for this run" - and that verdict went nowhere. Nothing was delivered,
// the three sheets stayed empty, and the run reported success.
//
// That is a false clearance in the run's own status, which is the one thing this
// check may never produce. The rail's judgement must be visible to whatever reads
// execution status, and the only mechanism that survives every callback and email
// being disabled is a throw.
//
// IF THE EMAIL IS EVER RE-ENABLED: this throw must MOVE to a node wired AFTER the
// email, or the mail will never be sent. Throw last, always - but throw.
// =================================================================================

const j = $input.first().json || {};
const isCrash = !!(j.execution || j.workflow);

let runId, nodeName, code, message, status, retryable, execId, execUrl, wfName;

if (isCrash) {
  const ex = j.execution || {};
  const wf = j.workflow || {};
  execId   = ex.id || '';
  execUrl  = ex.url || '';
  wfName   = wf.name || 'CC Monthly Payments Below Agreed Amount';
  nodeName = ex.lastNodeExecuted || '(unknown node)';
  message  = (ex.error && (ex.error.message || ex.error.description)) || 'no message';
  code     = 'workflow_crash';
  status   = null;
  retryable = false;
  try { runId = $('Validate Inputs').first().json.run_id; } catch (e) { runId = '(unknown)'; }
} else {
  const e = j.error || {};
  runId    = j.run_id || '(unknown)';
  // The rail's payload carries no node name, so the email said only "(handled)" and
  // "Execution: -" while telling the reader to go open the execution and find the
  // failing node themselves. On run 90669 that record was too large for the API to
  // serve, so the advice was unfollowable. Both fields are now filled from what IS
  // reachable here.
  nodeName = e.node || j.node || j.failed_node || '(handled - see error rail)';
  code     = e.code || 'internal';
  message  = e.message || 'no message';
  status   = e.status != null ? e.status : null;
  retryable = e.retryable === true;
  wfName   = 'CC Monthly Payments Below Agreed Amount';
  execUrl = '';
  try { execId = String($execution.id || ''); } catch (err) { execId = ''; }
}

// What to check first, by failure type.
let advice;
if (/identical\s*5x|returned response was identical/i.test(String(message))) {
  // Run 90669's actual failure. n8n's pagination loop guard: the walk never
  // terminated, so it kept fetching and the responses stopped changing.
  advice = 'This is n8n\'s PAGINATION LOOP GUARD, not an ERP fault. A paginated sweep never ' +
           'satisfied its stop condition, so it walked past the real end of the data and the ' +
           'responses stopped changing. Cause on 2026-08-17: the status sweep terminated only on ' +
           'a SHORT page, and advancesearch clamps an over-range page while still returning a ' +
           'full one - so the condition could never be true. Fixed by bounding the walk on the ' +
           'envelope\'s declared totalPages. If this reappears on a DIFFERENT sweep, that sweep ' +
           'has the same defect. Do NOT fix it by lowering maxRequests: that hides the loop ' +
           'behind a cap and turns it into a silent short walk, which is far worse.';
} else if (code === 'erp_auth_expired' || status === 498 || status === 401 || status === 403) {
  advice = 'ERP rejected the credential. Check that every ERP node in the workflow has the ' +
           '"ERP Hassan Prod" credential selected, and that the credential itself is still valid. ' +
           'A 498 means the token is missing or malformed - retrying will not help. NOTE: a 401 ' +
           'from the webhook validator means the WEBHOOK SECRET, not the ERP token - the message ' +
           'is deliberately terse so an unauthenticated caller learns nothing, which also means ' +
           'it cannot tell you which check failed.';
} else if (code === 'timeout') {
  advice = 'ERP did not respond in time. The nodes allow 90s. If this recurs, ERP is slow ' +
           'under load - consider capping concurrency (batchSize) rather than raising the timeout.';
} else if (code === 'erp_unavailable') {
  advice = 'ERP returned a 5xx. Usually transient - this one IS retryable.';
} else if (code === 'workflow_crash') {
  advice = 'A node threw rather than routing to the error rail. If it was "Verify Bulk Pulls" ' +
           'or "Split Contracts", that is a GUARD firing on purpose: an ERP pull returned no ' +
           'usable data and the run was stopped so it could not report a successful audit of ' +
           'zero cases. Read the message above - it names which pull failed.';
} else {
  advice = 'Open the execution in n8n and read the failing node\'s input and output. If the ' +
           'record is too large to open, the run\'s own footprint self-report in Build Runs Log ' +
           'is the substitute - a diagnosis that depends on retrieving the execution fails ' +
           'exactly when the execution is in trouble.';
}

const subject = '[CC Monthly Payments Below Agreed Amount] FAILED - ' + code +
                (status ? ' (HTTP ' + status + ')' : '') +
                ' - run ' + String(runId).slice(0, 8);

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const rows = [
  ['What broke', isCrash ? ('a node threw: ' + nodeName) : ('an ERP call failed (handled): ' + nodeName)],
  ['Error code', code],
  ['ERP status', status != null ? String(status) : '-'],
  ['Message', message],
  ['Retryable', retryable ? 'yes' : 'no'],
  ['Run id', runId],
  ['Execution', execId ? (execUrl ? ('<a href="' + esc(execUrl) + '">' + esc(execId) + '</a>') : esc(execId)) : '-']
];

const html =
  '<div style="font-family:Calibri,Arial,sans-serif;max-width:640px;">' +
  '<div style="background:#DC2626;color:#fff;padding:12px 16px;font-size:16px;font-weight:bold;">' +
  'CC Monthly Payments Below Agreed Amount - run failed</div>' +
  '<div style="padding:12px 16px;">' +
  '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
  rows.map(function (r) {
    return '<tr>' +
      '<td style="padding:5px 8px;border-bottom:1px solid #E2E8F0;color:#64748B;width:120px;">' + esc(r[0]) + '</td>' +
      '<td style="padding:5px 8px;border-bottom:1px solid #E2E8F0;">' + (r[0] === 'Execution' ? r[1] : esc(r[1])) + '</td>' +
      '</tr>';
  }).join('') +
  '</table>' +
  '<div style="background:#FEF3C7;border-left:4px solid #B45309;padding:10px 12px;margin-top:14px;font-size:12.5px;">' +
  '<strong>What to check first.</strong><br>' + esc(advice) + '</div>' +
  '<div style="margin-top:12px;font-size:11px;color:#94A3B8;">No audit result was written for this run. ' +
  'Security Room will show it as failed rather than passing with an empty cohort.</div>' +
  '</div></div>';

// The full payload goes to the console FIRST, so it survives the throw below and is
// readable even when the execution record itself is too large to fetch.
console.log(JSON.stringify({ stage: 'run_failed', subject: subject, failure_code: code,
  erp_status: status, failing_node: nodeName, run_id: runId, execution_id: execId,
  message: message, advice: advice }));

// AND NOW FAIL. Everything above is the report; this is what makes the run's status
// tell the truth. A run that delivered nothing must never read as success.
throw new Error('AUDIT RUN FAILED (' + code + ')' + (status ? ' HTTP ' + status : '') +
  ' at ' + nodeName + ' - run ' + runId + ' - ' + message +
  ' | No audit result was written. Details logged above; email node is disabled by design.');

