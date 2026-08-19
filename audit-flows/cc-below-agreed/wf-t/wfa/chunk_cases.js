// Chunk Cases (WF-A) - split the assembled cohort into batches for WF-T, one item per batch.
//
// WHY BATCHES AT ALL. n8n retains every node's output for the life of an execution, and the
// scoring tail was the last unstaged stage: Compute Case States, Guards, Adjudicate Cases,
// Build Sheet Rows and the Sheets node each held the whole cohort. Measured on execution
// 93346 - the furthest any run has reached - that is ~2.5 KB per assembled case over ~5,632
// cases, about 14 MB per retained output, five to six times over. The run crashed 26 seconds
// after the last enrichment chunk returned, at exactly that point.
//
// THIS NODE COSTS ONE COPY, and it is worth being explicit that it is not free. The batch
// payloads are a second copy of the cohort (the first is Merge Streams, which n8n retains
// whatever happens). One copy paid to remove five is the trade. The alternative - passing ids
// and re-reading - is not available here: unlike the sweeps, these case objects are DERIVED
// from three payment windows and an enrichment read, so there is nothing to re-read them from.
//
// BATCH SIZE. 1,200 is a deliberate compromise, not a round number: at ~2.5 KB a case that is
// ~3 MB in flight per sub-execution, five batches for the measured 5,632-case cohort, and each
// sub-execution's own five retained copies stay around 15 MB - well inside the healthy band.
// Smaller batches would cut the peak further but multiply the sub-execution overhead, which
// was measured at 56-57 s per WF-E chunk of 750; the scoring work per case is far cheaper than
// an ERP read, so the overhead, not the memory, is what sets the floor here.
const CHUNK_DEFAULT = 1200;
const CHUNK_MAX = 2000;

const cases = $input.all().map(function (i) { return i.json; });
const validated = $('Validate Inputs').first().json;
const params = validated.params || {};

// A caller may ask for smaller batches (a memory experiment) but never larger: past ~2,000 the
// sub-execution carries the same peak the parent used to, and the staging buys nothing.
let size = Number(params.score_batch_size);
if (!Number.isFinite(size) || size < 1) size = CHUNK_DEFAULT;
size = Math.min(Math.floor(size), CHUNK_MAX);

if (cases.length === 0) {
  throw new Error('Chunk Cases: the cohort is EMPTY at the scoring stage. Build Cohort already ' +
    'refuses a zero cohort, so reaching this line means the cases were lost between there and ' +
    'here - and a run that scores nothing must never report a clean month.');
}

// The partition is by INDEX, which is what makes the no-duplicate check inside WF-T a real
// check rather than a restatement: if a case ever appears in two batches, the fault is here
// and WF-T says so by case_key.
const batches = [];
for (let i = 0; i < cases.length; i += size) batches.push(cases.slice(i, i + size));

const total = batches.reduce(function (t, b) { return t + b.length; }, 0);
if (total !== cases.length) {
  throw new Error('Chunk Cases: batched ' + total + ' of ' + cases.length + ' cases. A cohort ' +
    'that loses cases at the chunker under-reports coverage and every later gate passes.');
}

console.log(JSON.stringify({ stage: 'chunk_cases', cases: cases.length,
  batches: batches.length, batch_size: size,
  batch_sizes: batches.map(function (b) { return b.length; }),
  note: 'one item per batch; each is scored, banded and written to the Cases tab inside its ' +
        'own sub-execution, and only the scored cases come back' }));

return batches.map(function (b, idx) {
  return { json: {
    cases: b,
    validated: validated,
    batch_index: idx,
    batch_count: batches.length
  } };
});
