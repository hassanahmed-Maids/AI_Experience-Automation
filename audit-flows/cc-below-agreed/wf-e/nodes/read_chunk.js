// Read Chunk (WF-E) - unpack one chunk of enrichment candidates and fan it out to one
// item per candidate, so the two HTTP nodes below can run per-item as they did in WF-A.
//
// WHY THIS WORKFLOW EXISTS. Run 92534 (2026-08-18) proved the sweeps were no longer the
// problem: both staged sweeps succeeded, and WF-A still crashed 16m57s after the last one
// with nothing but the enrichment chain left to blame. Measured on the real July pull,
// 5,632 of 5,651 CC contracts pass Attach Month Payments' needs_enrichment gate, and each
// one costs two calls - get-client-details at 3,851 B and 1.80s, and replacement/page at
// 185 B, 1.11s and still 401. That is ~22.7 MB of raw bodies retained for the life of the
// run, on top of four retained node outputs each holding a copy of every case.
//
// Running it here bounds both: the raw bodies die with each chunk's sub-execution, and
// WF-A keeps ONE output (the deltas) where it used to keep four.
//
// IT DOES NOT REDUCE THE CALL COUNT. 11,264 calls are still 11,264 calls, and chunks run
// sequentially, so the wall-clock is unchanged at roughly 26 minutes. Cutting the fan-out
// needs a bulk source for the contract rate - the open ask-the-code question. This
// workflow is the memory fix, and only that; do not let it read as a cost fix.
// ERP-COMPLIANCE: budget-gate-in-caller - WF-A's Chunk Candidates gates the whole cohort before
// the first chunk is built, so this workflow inherits a decision made with the full count.
// ERP-COMPLIANCE: lease-held-by-caller - WF-A holds the ERP lease for the run; a sub-workflow
// acquiring its own would deadlock against its caller.
const incoming = $input.first().json || {};

const bearer = incoming.bearer || '';
const cases = incoming.cases;
const chunkIndex = incoming.chunk_index === undefined || incoming.chunk_index === null
  ? null : Number(incoming.chunk_index);

if (!bearer || String(bearer).indexOf('Bearer ') !== 0) {
  throw new Error('WF-E: no usable bearer was passed in. Every call would 401, and a 401 on the plan ' +
    'read is indistinguishable downstream from a contract whose rate is genuinely unreadable - which ' +
    'sends the case to a human as CANNOT TELL instead of failing loudly. Refusing.');
}
if (!Array.isArray(cases) || cases.length === 0) {
  throw new Error('WF-E: expected a non-empty `cases` array, got ' +
    (Array.isArray(cases) ? 'an empty array' : typeof cases) + '. An empty chunk returns an empty ' +
    'projection, which the caller cannot tell from a chunk whose candidates all failed.');
}
// THE CHUNK CEILING IS THE WHOLE POINT. One sub-execution holding every candidate would
// retain the same ~22.7 MB this workflow exists to release - it would move the crash, not
// remove it. 1,200 x 3,851 B is ~4.6 MB of raw bodies per sub-execution, which is the
// budget this was sized against.
const CHUNK_MAX = 1200;
if (cases.length > CHUNK_MAX) {
  throw new Error('WF-E: chunk of ' + cases.length + ' candidates exceeds the ceiling of ' + CHUNK_MAX +
    '. The caller must split further: at 3,851 B per plan response a chunk this size would retain ' +
    Math.round((cases.length * 3851) / 1048576) + ' MB inside this sub-execution, which defeats the ' +
    'reason it exists.');
}

// THE BREAKER'S CLOCK STARTS HERE. n8n's HTTP node reports no per-response timing anywhere -
// not in the body, not in the headers, not with fullResponse - so the only latency signal
// available is the batch's wall clock, measured from before the first request to the
// projection that reads the last one. ERP-LOAD-POLICY.md §5 originally asked for a p50 over
// the first 20 responses; that is not measurable here, and the policy has been corrected
// rather than the number quietly faked.
const erpT0 = Date.now();

const out = [];
let missingIds = 0;
for (const c of cases) {
  const caseKey = c && c.case_key === undefined ? '' : String(c.case_key);
  const contractId = c && c.contract_id === undefined ? '' : String(c.contract_id);
  const clientId = c && c.client_id === undefined ? '' : String(c.client_id);
  // A candidate with no client id cannot be priced, and a candidate with no contract id
  // cannot have its maid history read. Dropping either silently would shorten the chunk
  // and break the POSITIONAL pairing the projections rely on, so it is refused instead.
  if (!caseKey || !contractId || !clientId) { missingIds++; continue; }
  // chunk_index and run_id ride along on every item so the projection at the end can
  // report which chunk it was without reaching back past the fan-out.
  out.push({ json: { bearer: bearer, case_key: caseKey, contract_id: contractId,
                     client_id: clientId, chunk_index: chunkIndex,
                     run_id: incoming.run_id || null, erp_t0: erpT0 } });
}
if (missingIds > 0) {
  throw new Error('WF-E: ' + missingIds + ' of ' + cases.length + ' candidates arrived without a ' +
    'case_key, contract_id or client_id. Positional pairing across the two HTTP nodes depends on the ' +
    'item count never changing, so an incomplete candidate is refused rather than skipped.');
}

console.log(JSON.stringify({ stage: 'wfe_read_chunk', chunk_index: chunkIndex,
  candidates: out.length, run_id: incoming.run_id || null,
  note: 'one item per candidate; the two HTTP nodes fan out per item at batchSize 2 / 500ms ' +
        '= 4 req/s, the ceiling in audit-flows/ERP-LOAD-POLICY.md (was 15 / 500ms = 30 req/s ' +
        'until 2026-08-20, three times the documented limit, and nobody chose it - it was cloned ' +
        'forward from a sibling check)' }));

return out;
