// Read Lease Request (ERP Lease) - take the four things the lease needs and refuse a call
// that cannot be reasoned about.
//
// This workflow is called by every audit, so its input is the one thing it cannot assume.
// A missing run_id is the dangerous one: the lease is keyed on WHO holds it, and a blank
// holder makes "did I acquire this?" and "did somebody else?" the same question - which is
// exactly the ambiguity the release guard depends on being able to answer.
const incoming = $input.first().json || {};

const mode = String(incoming.mode === null || incoming.mode === undefined ? '' : incoming.mode).trim();
const runId = String(incoming.run_id === null || incoming.run_id === undefined ? '' : incoming.run_id).trim();
const checkId = String(incoming.check_id === null || incoming.check_id === undefined ? '' : incoming.check_id).trim();

if (mode !== 'acquire' && mode !== 'release') {
  throw new Error('ERP Lease: mode must be "acquire" or "release", got "' + mode + '". Guessing ' +
    'acquire would block the queue; guessing release would free a lease held by someone else.');
}
if (!runId) {
  throw new Error('ERP Lease: no run_id was passed. The lease records WHO holds it, and every ' +
    'later decision - is this mine to release, is the holder still alive - reads that field. A ' +
    'blank holder makes those questions unanswerable, so the call is refused here.');
}
if (!checkId) {
  throw new Error('ERP Lease: no check_id was passed. When a run is refused the message names ' +
    'which audit is holding the lease, and "" is not an answer anyone can act on.');
}

console.log(JSON.stringify({ stage: 'erp_lease_request', mode: mode, run_id: runId,
  check_id: checkId, ignore_lease: incoming.ignore_lease === true,
  note: 'ERP-LOAD-POLICY.md §4 - one audit against ERP at a time, override available and logged' }));

return [{ json: { mode: mode, run_id: runId, check_id: checkId,
                  ignore_lease: incoming.ignore_lease === true } }];
