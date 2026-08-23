// Capture Failure - the FIRST node on the error rail, and the reason the rail can still say what
// went wrong.
//
// WHY IT EXISTS. The rail used to run `failing node -> Release Lease (error) -> Fail Loudly`, and
// Release Lease (error) is an Execute Sub-workflow node with waitForSubWorkflow: true. That node
// does not pass its input through - it REPLACES the item with whatever the lease workflow
// returned. So by the time Fail Loudly read $input, the error payload was gone and every message
// it could ever produce was "FAILED at \"unknown node\": unknown error".
//
// The lease was still released and the run still re-threw, so nothing was unsafe. What was lost
// was the entire point of the node: a human reads that message at the moment the audit dies.
// Found 2026-08-23 by a subagent remediating a sibling flow, in a rail copied from MV Monthly
// Payment Stage 1 - which has the same shape and has never been exercised, so nobody had ever
// seen it produce "unknown node".
//
// So the error is captured HERE, before the lease call can overwrite it, and Fail Loudly reads
// $('Capture Failure') by name instead of $input. This node deliberately does not throw: the
// release has to happen first, and a throw here would strand the lease - the exact hole the rail
// exists to close.
const item = $input.first().json || {};

// The error output's shape is not guaranteed: n8n puts a string here for some node types and an
// object for others. Both are handled rather than one assumed.
const raw = item.error;
const message = typeof raw === 'string' ? raw
              : String((raw && raw.message) || item.message || 'unknown error');
const node = String((raw && raw.node && raw.node.name) || item.node || 'unknown node');

console.log(JSON.stringify({ stage: 'capture_failure', failed_node: node, error: message,
  note: 'Captured before Release Lease (error), which replaces the item with the lease\'s own ' +
        'output. Fail Loudly reads this node by name.' }));

return [{ json: { _failure: { node: node, message: message, at: new Date().toISOString() } } }];
