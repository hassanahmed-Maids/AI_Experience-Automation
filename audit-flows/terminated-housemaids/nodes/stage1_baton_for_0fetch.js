// Puts run_id on the chunk baton, and nothing else.
//
// WHY THIS EXISTS. 0-Fetch Profiles' circuit breaker keys its latency baseline on the run: it
// stores the first chunk's ms/call in the sub-workflow's static data and clears that store the
// moment it sees a DIFFERENT run_id. Without a run_id on the baton every run looks like the same
// run, the store is never cleared, and chunk 1 of today's run is judged against a baseline taken
// from a run days ago - "ERP at 9am and ERP at 9pm are not the same server", which is exactly the
// comparison the breaker is written not to make.
//
// It is a node rather than four lines inside Resolve Maids, because Resolve Maids is
// 8.5 KB of identity logic that must not be reopened to carry a field through, and because a
// baton is a real thing in this chain and deserves to be visible on the canvas.
//
// erp_t0 is deliberately NOT stamped here. The sub-workflow stamps its own, one node before its
// own ERP batch fires, so the elapsed clock measures that chunk's ERP time. A clock started in
// the parent would include every earlier chunk and read worse on each one.
const runId = String(($('Validate Inputs').first().json || {}).run_id || '');
if (!runId) {
  // Never silently. An empty run_id does not break the run, it breaks the breaker's ability to
  // tell runs apart - the quiet kind of damage this project keeps finding after the fact.
  console.log(JSON.stringify({ stage: 'baton_for_0fetch',
    warning: 'run_id is empty on Validate Inputs; 0-Fetch cannot separate this run from the last ' +
             'one, so its latency baseline will be carried across runs. Check the caller payload.' }));
}
return $input.all().map(function (it) {
  return { json: Object.assign({}, it.json, { run_id: runId }) };
});
