// Fail Loudly (CC Price Stage 2) - the end of the error rail.
//
// WHY STAGE 2 NEEDS ITS OWN. Stage 1 acquires the ERP lease and Stage 3 releases it. Stage 2 is
// the middle, and it self-chains: each chunk launches the next with waitForSubWorkflow false and
// then ends. So a chunk that dies does not merely lose its own work - it ends the CHAIN. Stage 3
// is never reached, nothing releases, and the lease stays held by a run that no longer exists
// until the 3-hour staleness backstop clears it. That is the failure measured on Stage 1 on
// 2026-08-20 (run selfreq-test-2); the same hole was open here.
//
// AND WHY RELEASING IS NOT ENOUGH. n8n marks an execution SUCCESS when it runs off the end of an
// error output - a routed error is a handled error as far as the engine is concerned. A rail
// that released and stopped would report a dead chunk chain as a completed run, which is worse
// than the stranded lease it fixes: the lease is loud within three hours, a run that claims to
// have finished is never looked at again.
const item = $input.first().json || {};

// n8n puts a string here for some node types and an object for others. Both are handled rather
// than one assumed, because getting it wrong would swallow the only actionable part.
const raw = item.error;
const msg = typeof raw === 'string' ? raw
          : String((raw && raw.message) || item.message || 'unknown error');
const failedNode = String((raw && raw.node && raw.node.name) || item.node || 'unknown node');

let runId = 'unknown', offset = null;
try {
  const b = $('Receive Baton').first().json;
  runId = String((b.params && b.params.run_id) || 'unknown');
  offset = ((b.params && b.params.chunk) || {}).offset;
} catch (e) { }

console.log(JSON.stringify({ stage: 'ccprice_stage2_failed', run_id: runId, chunk_offset: offset,
  failed_node: failedNode, error: msg,
  note: 'ERP lease RELEASED on the error rail. This chunk chain is dead, so Stage 3 will never ' +
        'run and nothing else would have released it.' }));

throw new Error('CC PRICE STAGE 2 FAILED at "' + failedNode + '" (chunk offset ' + offset + '): ' +
  msg + ' | The ERP lease was released, so the next audit is not blocked. | The chunk chain has ' +
  'stopped and Stage 3 will not run, so this run reports nothing rather than a partial case set.');
