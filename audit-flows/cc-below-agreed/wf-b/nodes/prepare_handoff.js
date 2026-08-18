// Prepare Handoff - builds the NEXT baton once this batch's verdicts are written.
// Emits exactly one item; More batches? routes it to a self-call (candidates remain)
// or to WF-C (done).
//
// The verdict tally accumulates ACROSS batches by riding the baton - never by reading
// the Verdicts sheet back. Reading it back would reintroduce the partial-read risk the
// baton design exists to remove, and a short read would understate the findings.
const baton = $('Validate Inputs').first().json._baton;

// Merge Agent Verdicts emits ONE item shaped {reviewed, tally, cases, ...}. Reading it
// as per-case items was the sibling's first-draft bug, and its offline chain test
// passed anyway because the fake verdicts had the wrong shape too. Read the real
// envelope, defensively: this node must not be the reason a batch's verdicts are lost.
let merged = {};
try { merged = $('Merge Agent Verdicts').first().json || {}; } catch (e) { merged = {}; }
const batchTally = merged.tally || {};
const batchReviewed = Number(merged.reviewed) || 0;

const tally = Object.assign({}, (baton.verdicts && baton.verdicts.by_verdict) || {});
for (const k of Object.keys(batchTally)) tally[k] = (tally[k] || 0) + batchTally[k];
const processed = ((baton.verdicts && baton.verdicts.processed) || 0) + batchReviewed;

// These two travel too, because WF-C's summary must be able to say how much of the
// residue was never actually judged. A run that verified 40 of 300 candidates and
// reported only the 40 verdicts reads as a clean result rather than a partial one.
const unreviewed = ((baton.verdicts && baton.verdicts.unreviewed) || 0) + (Number(merged.unreviewed) || 0);
const cappedForNoQuote = ((baton.verdicts && baton.verdicts.findings_capped_for_no_quote) || 0) +
  (Number(merged.findings_capped_for_no_quote) || 0);

const remaining = baton.candidates.slice(baton.batch_size);
const next = Object.assign({}, baton, {
  candidates: remaining,
  batch_index: (baton.batch_index || 0) + 1,
  verdicts: { processed: processed, by_verdict: tally, unreviewed: unreviewed,
              findings_capped_for_no_quote: cappedForNoQuote }
});
// has_more must NEVER ride inside the baton itself. On hop 1 it is true, the baton is
// passed onward whole, and a stale true would overwrite the fresh value on the LAST
// hop - sending a zero-candidate self-call instead of routing to WF-C, which WF-B's
// own Validate Inputs would then refuse. Assign it LAST, outside the baton.
delete next.has_more;

console.log(JSON.stringify({ stage: 'wfb_prepare_handoff', run_id: baton.run_id,
  batch_just_done: baton.batch_index, verdicts_this_batch: batchReviewed,
  processed_total: processed, unreviewed_total: unreviewed, remaining: remaining.length,
  has_more: remaining.length > 0 }));

return [{ json: Object.assign({}, next, { has_more: remaining.length > 0 }) }];
