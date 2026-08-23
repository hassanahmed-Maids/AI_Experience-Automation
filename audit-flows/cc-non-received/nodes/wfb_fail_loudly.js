// Fail Loudly (WF-B) - the end of the error rail.
//
// WHY THIS STAGE NEEDS A RAIL AT ALL, WHEN IT NEVER ACQUIRES. WF-B takes no lease: WF-A acquires
// before its first ERP call and 3-Deliver hands it back at the end of the chain. What makes WF-B
// load-bearing is that the chain runs FIRE-AND-FORGET. WF-A launches this stage with
// waitForSubWorkflow false and ends; this stage self-calls per batch the same way and finally
// launches 3-Deliver. So WF-A's own rail cannot cover a failure here - by then WF-A has finished.
// Every way THIS execution can die takes the whole chain with it, and the stage that would have
// released is one that now never runs. The lease then sits held by a run that no longer exists
// until the 3-hour staleness backstop clears it: a 3-hour hole in the queue for every audit.
//
// This was NOT a gap when the flow was audited earlier on 2026-08-23 - the whole CC Non Received
// chain was unleased then, and the audit recorded that adding a release here would strand a lease
// nobody took. Remediating WF-A the same day is what made this rail necessary, and neither pass
// could see the other. The compliance note for this check has been corrected.
//
// WHY IT IS AN ERROR OUTPUT AND NOT THE ERROR TRIGGER. On Workflow Crash fires in a SEPARATE
// execution, where $('Validate Inputs') and $('When Called') do not resolve - so it cannot name
// the run that holds the lease, and a release that guesses is the silent-steal path the lease
// exists to prevent. An error OUTPUT stays inside the same execution, so the release names the
// real holder.
//
// WHY IT RE-THROWS. n8n marks an execution SUCCESS when it runs off the end of an error output.
// A rail that released and stopped would turn a dead chain into one the run log reports as fine -
// strictly worse than the stranded lease it was added to fix, because a stranded lease is loud
// within three hours and a silently-successful audit is never looked at again. It matters twice
// over here: a batch that dies quietly also means every REMAINING batch never runs, so the month
// is verified in part and reported as whole.
//
// READ THE FAILURE FROM Capture Failure, NOT FROM $input. Release Lease (error) sits between the
// failing node and this one, and an Execute Sub-workflow node REPLACES the item with the lease's
// own return value - so $input here holds the lease's answer, not the error.
let msg = 'unknown error', failedNode = 'unknown node', runId = 'unknown', batchIndex = null;
try {
  const c = $('Capture Failure').first().json || {};
  const f = c._failure || {};
  if (f.message) msg = String(f.message);
  if (f.node) failedNode = String(f.node);
  if (c.run_id) runId = String(c.run_id);
  if (c.batch_index !== undefined && c.batch_index !== null) batchIndex = c.batch_index;
} catch (e) { }

console.log(JSON.stringify({ stage: 'wfb_verify_failed', run_id: runId, batch_index: batchIndex,
  failed_node: failedNode, error: msg,
  note: 'ERP lease RELEASED on the error rail. WF-B never acquires it - WF-A does - but WF-B is a ' +
        'middle link in a fire-and-forget chain, so the 3-Deliver release that WOULD have freed it ' +
        'never runs when this batch dies.' }));

throw new Error('CC NON RECEIVED 2-VERIFY FAILED at "' + failedNode + '": ' + msg +
  ' | The ERP lease was released, so the next audit is not blocked. | This kills the WHOLE ' +
  'verification chain, not just batch ' + (batchIndex === null ? '?' : batchIndex) + ': the ' +
  'remaining batches are launched by this execution and 3-Deliver is never reached. Any verdict ' +
  'rows already in the sheet for this run are a PARTIAL and must not be read as the month. ' +
  'Re-run the audit from WF-A once the cause is fixed.');
