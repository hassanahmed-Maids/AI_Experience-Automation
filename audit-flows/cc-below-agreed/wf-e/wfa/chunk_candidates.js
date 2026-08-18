// Chunk Candidates (WF-A) - split the enrichment candidates into chunks and hand each to
// WF-E, so no single execution holds every plan response.
//
// WHY, in one line: run 92534 crashed with both sweeps already staged, and the only thing
// left running was the per-contract enrichment chain - 5,632 candidates x 2 calls, ~22.7 MB
// of raw bodies, retained across four node outputs. See VALIDATION.md section 15.
//
// THE CHUNK SIZE IS A MEMORY BUDGET, NOT A THROUGHPUT KNOB. Chunks run SEQUENTIALLY (the
// caller is in `each` mode), so the wall-clock is the same whatever this is set to: the two
// HTTP nodes inside WF-E still make 11,264 calls at batchSize 15 / 500ms, roughly 26
// minutes. What the size buys is a ceiling on what one sub-execution retains: 750 x 3,851 B
// is ~2.9 MB of plan bodies, and they are freed when the chunk ends. Raising it toward
// WF-E's own ceiling of 1,200 trades that ceiling for nothing.
const validated = $('Validate Inputs').first().json;
const params = validated.params || {};

const DEFAULT_CHUNK = 750;
const WFE_CEILING = 1200;   // must match CHUNK_MAX in WF-E's Read Chunk
const asked = Number(params.enrich_chunk_size);
const CHUNK = Number.isFinite(asked) && asked > 0 ? Math.min(asked, WFE_CEILING) : DEFAULT_CHUNK;

const bearer = (params.erp_auth && params.erp_auth.bearer) || '';
if (!bearer || String(bearer).indexOf('Bearer ') !== 0) {
  throw new Error('Chunk Candidates: no usable bearer on the validated payload, so every enrichment ' +
    'call would 401. A 401 on the plan read presents downstream as an unreadable contract rate, which ' +
    'routes the case to a human rather than failing - so it is refused here, loudly, instead.');
}

const candidates = $input.all().map(function (i) { return i.json; });

// ONLY THE THREE IDS CROSS THE BOUNDARY. Sending whole cases would copy every case into
// every sub-execution's input for no benefit: WF-E reads nothing else, and the cases are
// already retained here, where `Join Enrichment` will put the deltas back onto them.
const slim = [];
for (const c of candidates) {
  slim.push({ case_key: String(c.case_key === undefined ? '' : c.case_key),
              contract_id: String(c.contract_id === undefined ? '' : c.contract_id),
              client_id: String(c.client_id === undefined ? '' : c.client_id) });
}

const chunks = [];
for (let i = 0; i < slim.length; i += CHUNK) {
  chunks.push({ json: {
    bearer: bearer,
    cases: slim.slice(i, i + CHUNK),
    chunk_index: chunks.length,
    run_id: validated.run_id || ''
  } });
}

// ZERO CANDIDATES IS A REAL STATE and it is not an error: it means every contract in the
// cohort received nothing in the audited month, which gate 1 closes out to the sibling
// check. But it must not silently produce zero chunks that then read as a completed
// enrichment - so it is reported, and the downstream join is written to accept it.
if (chunks.length === 0) {
  console.log(JSON.stringify({ stage: 'chunk_candidates', candidates: 0, chunks: 0,
    note: 'no contract received anything in the audited month, so there is nothing to enrich. ' +
          'Gate 1 closed the whole cohort out; this is not a failure.' }));
  return [];
}

console.log(JSON.stringify({ stage: 'chunk_candidates', candidates: slim.length,
  chunks: chunks.length, chunk_size: CHUNK,
  calls_this_will_make: slim.length * 2,
  note: 'chunks run SEQUENTIALLY - this bounds memory per sub-execution, not runtime. ' +
        'The call count is unchanged and is the real cost: see VALIDATION.md section 15.' }));

return chunks;
