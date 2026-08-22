// Fail Loudly (CC Price Stage 3) - the end of the error rail.
//
// STAGE 3 IS THE STAGE THAT RELEASES THE LEASE, and it does so in its LAST node. That makes
// every failure ahead of the release a stranded lease: Stage 1 acquired it, Stage 2 handed off
// and ended, and this execution died before reaching Release ERP Lease - so nothing frees it
// until the 3-hour staleness backstop does.
//
// AND THIS IS NOT AN EXOTIC PATH. Reconcile + Aggregate throws DELIVERY REFUSED whenever the
// Cases table is short of the population - a designed outcome, the whole point of the stage
// being that a partial report must never look like a complete one. The flow was built to refuse,
// and every refusal blocked the queue.
//
// WHY RE-THROW. n8n marks an execution SUCCESS when it runs off the end of an error output. A
// rail that released and stopped would turn a REFUSED delivery into a run that reports as
// delivered - which inverts the exact guarantee this stage exists to provide.
const item = $input.first().json || {};

const raw = item.error;
const msg = typeof raw === 'string' ? raw
          : String((raw && raw.message) || item.message || 'unknown error');
const failedNode = String((raw && raw.node && raw.node.name) || item.node || 'unknown node');

let runId = 'unknown', auditMonth = null;
try {
  const p = $('Receive Baton').first().json.params || {};
  runId = String(p.run_id || 'unknown');
  auditMonth = p.audit_month || null;
} catch (e) { }

console.log(JSON.stringify({ stage: 'ccprice_stage3_failed', run_id: runId, audit_month: auditMonth,
  failed_node: failedNode, error: msg,
  note: 'ERP lease RELEASED on the error rail. This stage releases the lease in its last node, ' +
        'so a failure before that point used to leave it held by a finished run.' }));

throw new Error('CC PRICE STAGE 3 FAILED at "' + failedNode + '": ' + msg +
  ' | The ERP lease was released, so the next audit is not blocked. | NOTHING WAS REPORTED for ' +
  'run ' + runId + ' - the Cases table still holds the scored rows, but no run summary and no ' +
  'sheet rows were confirmed, so do not read the spreadsheet as covering this run.');
