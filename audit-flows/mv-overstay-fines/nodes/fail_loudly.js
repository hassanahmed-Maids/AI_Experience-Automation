// Fail Loudly (MV Overstay Fines) - the end of the error rail.
//
// WHY THE RAIL EXISTS. This flow acquires the ERP lease before `Get Change of Status
// Transactions` and releases it at `Run Complete`, after both the run row and the verdict rows
// have been written. Until 2026-08-23 there was no lease at all; now that there is one, every
// way this flow can die between those two points - a breaker trip, a budget refusal, a dead
// token, a cohort assertion, a data-table write - would otherwise leave the lease held by a run
// that no longer exists, and the staleness backstop only clears it after 3 hours. That is a
// 3-hour hole in the queue after every failure, on a flow whose ERP phase runs long.
//
// WHY IT IS AN ERROR OUTPUT AND NOT THE ERROR TRIGGER. `On Workflow Crash` fires in a SEPARATE
// execution, where `$('Validate Inputs')` does not resolve - so it cannot name the run that
// holds the lease, and a release that guesses is the silent-steal path the lease exists to
// prevent. An error OUTPUT stays inside the same execution, so `Release Lease (error)` names the
// real holder. The Error Trigger keeps its own job of drafting the failure email; it does not
// touch the lease.
//
// WHY IT RE-THROWS. n8n marks an execution SUCCESS when it runs off the end of an error output -
// a routed error is a handled error as far as the engine is concerned. The rail this flow was
// built with did exactly that: every error output went to `Build Error Callback`, the portal was
// told the run had died, and the execution list showed a green tick. That is strictly worse than
// a stranded lease, because a stranded lease is loud within three hours and a run that claims to
// have finished is never looked at again.
//
// WHERE IT SITS AND WHY. It hangs off `Build Error Callback`, not off `Release Lease (error)`
// directly, so the portal callback is built and `Error Gate` is reached BEFORE this throws.
// `Error Gate` is drawn above this node on the canvas, and under executionOrder v1 that is what
// decides which sibling branch runs first - which is a real dependency on node position and is
// recorded here rather than left for someone to discover by moving a box.
const item = $input.first().json || {};

// The error output's shape is not guaranteed: n8n puts a string here for some node types and an
// object for others, and `Build Error Callback` has already normalised what it could. Read the
// normalised fields first, then fall back to the raw ones.
const raw = item.error;
const msg = (raw && typeof raw === 'object' && raw.message) ? String(raw.message)
          : (typeof raw === 'string' ? raw : String(item.message || 'unknown error'));
const failedNode = String((raw && raw.node && raw.node.name) || item.node || 'unknown node');

let runId = String(item.run_id || 'unknown');
let auditWindow = '';
try {
  const v = $('Validate Inputs').first().json;
  if (v && v.run_id) runId = String(v.run_id);
  auditWindow = String(v.range_start || '') + ' to ' + String(v.range_end || '');
} catch (e) { }

console.log(JSON.stringify({ stage: 'mv_overstay_fines_failed', run_id: runId,
  audit_window: auditWindow, failed_node: failedNode, error: msg,
  portal_told: item.result === 'error',
  note: 'ERP lease RELEASED on the error rail. Without it this run would have held the lease ' +
        'until the 3-hour staleness backstop, because Release ERP Lease sits at Run Complete ' +
        'and never runs when the flow dies.' }));

throw new Error('MV OVERSTAY FINES FAILED at "' + failedNode + '": ' + msg +
  ' | The ERP lease was released, so the next audit is not blocked. | The portal callback was ' +
  'built on this same rail, so the Security Room has been told the run ended. | Cases and ' +
  'verdicts for this run are incomplete or absent - do not read a partial data-table write as a ' +
  'finished audit. Re-run the same window once the cause is fixed.');
