// Select Candidates (WF-B) - the batch slicer. SAME NAME as WF-A's selector on
// purpose: Resolve Quoted Amounts reads $('Select Candidates').all() and the two
// message nodes read client_id and contract_id off these items, so keeping the name
// means those lifted bodies run here unchanged.
//
// It emits the FIRST batch_size candidates. The remainder travels onward in Prepare
// Handoff's next baton, so every batch is a fresh execution with a fresh memory
// budget - which is the entire fix for the runs that died holding the population.
const baton = $('Validate Inputs').first().json._baton;
const batch = baton.candidates.slice(0, baton.batch_size);

// A candidate with no client_id cannot be read at all: the message URL is keyed on
// the CLIENT and scoped by contract, so a blank client would fetch smsLog/undefined.
// WF-A's own selector already skips these and records their keys, so reaching here
// with one is a wiring problem worth seeing rather than silently tolerating. They are
// NOT dropped - a dropped candidate is a case that quietly stops being audited. They
// travel on and their evidence resolves as UNRESOLVED, which routes them to auditor
// review exactly like any other unreadable surface.
const noClient = batch.filter(function (c) { return !c.client_id; }).map(function (c) { return c.case_key; });

console.log(JSON.stringify({ stage: 'wfb_select_candidates', run_id: baton.run_id,
  batch_index: baton.batch_index, batch: batch.length,
  remaining_after_this: Math.max(0, baton.candidates.length - batch.length),
  candidates_without_client_id: noClient.length, without_client_id_keys: noClient.slice(0, 25),
  estimated_message_calls: batch.length * 2 }));

return batch.map(function (c) { return { json: c }; });
