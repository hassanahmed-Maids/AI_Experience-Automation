// Capture Failure (WF-B) - the FIRST node on the error rail, and the reason the rail can both
// release the right lease and say what went wrong.
//
// TWO JOBS, AND NEITHER IS OBVIOUS.
//
// 1. IT HOLDS THE ERROR. Release Lease (error) is an Execute Sub-workflow node with
//    waitForSubWorkflow: true, and that node does not pass its input through - it REPLACES the
//    item with whatever the lease workflow returned. A terminal downstream of it that reads
//    $input gets the lease's answer, not the error, and the only message it can produce is
//    'FAILED at "unknown node": unknown error'. Twelve of thirteen rails in this repo shipped
//    that way (2026-08-23). So the error is read HERE, before the release can overwrite it.
//
// 2. IT RESOLVES run_id WITHOUT DEPENDING ON Validate Inputs. Validate Inputs is itself on this
//    rail - a malformed baton, a missing bearer and an empty candidate list all throw there - and
//    when it is the node that failed it has no output to read a run_id from. A release with no
//    run_id frees nothing: the lease only ever releases to the run that holds it, so the stranded
//    lease would stay stranded and the rail would look like it had done its job. When Called is
//    inputSource: passthrough, so the RAW BATON is available under it whatever Validate Inputs
//    did with it, and the baton carries run_id and check_id. That is the primary source; the
//    Validate Inputs projection is the fallback, for the self-call path where both exist.
//
// IT DOES NOT THROW. The release has to happen first, and a throw here would strand the lease -
// the exact hole the rail exists to close.
const item = $input.first().json || {};

// The error output's shape is not guaranteed: n8n puts a string here for some node types and an
// object for others. Both are handled rather than one assumed.
const raw = item.error;
const message = typeof raw === 'string' ? raw
              : String((raw && raw.message) || item.message || 'unknown error');
const node = String((raw && raw.node && raw.node.name) || item.node || 'unknown node');

let runId = '', checkId = 'cc-nonreceived-monthly-payments', batchIndex = null;
try {
  const b = $('When Called').first().json || {};
  const baton = b.kind === 'cc-nonreceived-baton' ? b
              : (b.body && b.body.kind === 'cc-nonreceived-baton' ? b.body : {});
  if (baton.run_id) runId = String(baton.run_id);
  if (baton.check_id) checkId = String(baton.check_id);
  if (baton.batch_index !== undefined) batchIndex = baton.batch_index;
} catch (e) { }
if (!runId) {
  try {
    const v = $('Validate Inputs').first().json || {};
    if (v.run_id) runId = String(v.run_id);
    if (v.check_id) checkId = String(v.check_id);
  } catch (e) { }
}

console.log(JSON.stringify({ stage: 'wfb_capture_failure', run_id: runId || '(unresolved)',
  batch_index: batchIndex, failed_node: node, error: message,
  run_id_source: runId ? 'baton via When Called, or Validate Inputs' : 'NONE - the release will be a no-op',
  note: 'Captured before Release Lease (error), which replaces the item with the lease\'s own ' +
        'output. Release Lease (error) and Fail Loudly both read this node by name.' }));

return [{ json: { run_id: runId, check_id: checkId, batch_index: batchIndex,
                  _failure: { node: node, message: message, at: new Date().toISOString() } } }];
