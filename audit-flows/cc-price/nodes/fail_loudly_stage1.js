// Fail Loudly (CC Price Stage 1) - the end of the error rail.
//
// The rail above this node released the ERP lease, which is the point of the rail: this stage
// hands off to Stage 2 fire-and-forget, Stage 3 releases the lease, and NEITHER of them runs
// when this stage dies - so a failure here strands the lease until the 3-hour staleness backstop
// clears it. Measured 2026-08-20: run selfreq-test-2 died at Get Population and blocked the
// queue exactly that way.
//
// THIS NODE EXISTS BECAUSE RELEASING IS NOT ENOUGH. n8n marks an execution SUCCESS when it runs
// off the end of an error output - as far as the engine is concerned, a routed error is a
// handled one. So a rail that releases and stops turns a failed audit into one the run log
// reports as fine, which is strictly worse than the stranded lease it was added to fix: a
// stranded lease is loud within three hours, a silently-successful audit is never looked at
// again.
//
// So: release, then re-throw. The original failure is carried through rather than replaced,
// because "CC PRICE STAGE 1 FAILED" on its own tells you nothing you could act on.
const item = $input.first().json || {};

// The error output's shape is not guaranteed: n8n puts a string here for some node types and an
// object for others. Both are handled rather than one assumed, because getting it wrong would
// swallow the only useful part of the message.
const raw = item.error;
const msg = typeof raw === 'string' ? raw
          : String((raw && raw.message) || item.message || 'unknown error');
const failedNode = String((raw && raw.node && raw.node.name) || item.node || 'unknown node');

let runId = 'unknown';
try { runId = String($('Validate Inputs').first().json.params.run_id); } catch (e) { }

console.log(JSON.stringify({ stage: 'ccprice_stage1_failed', run_id: runId,
  failed_node: failedNode, error: msg,
  note: 'ERP lease RELEASED on the error rail. Stage 2 was never launched, so no later stage ' +
        'would have released it and the queue would have been blocked until the 3-hour ' +
        'staleness backstop cleared it.' }));

throw new Error('CC PRICE STAGE 1 FAILED at "' + failedNode + '": ' + msg +
  ' | The ERP lease was released, so the next audit is not blocked. | No contract was scored ' +
  'and Stage 2 was not launched - this run produced nothing, rather than producing a partial ' +
  'result that looks complete.');
