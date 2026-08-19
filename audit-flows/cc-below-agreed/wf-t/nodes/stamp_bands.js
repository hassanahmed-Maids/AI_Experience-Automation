// Stamp Display Bands (WF-T) - one classification, computed once, per case.
//
// bandOf IS LIFTED VERBATIM FROM Build Runs Log and must stay identical to it. There are now
// three readers of display_band - this node, Build Runs Log (which recomputes it from the
// same fields and must agree) and Build Case Payload's local fallback - and the comment in
// Build Runs Log already says the two definitions have to be kept in step. Adding a third
// copy is not ideal; the alternative was worse, because Build Sheet Rows needs the band and
// now runs per batch, BEFORE any run-level node exists to stamp it.
//
// WHY THIS IS SAFE TO MOVE: bandOf is pure. It reads only fields on the case it is given -
// skip_computation, reason_code, computed.expected_known, quoted, new_state,
// requires_verifier - all of which are set by Compute Case States, Guards and Adjudicate
// Cases, all three of which have already run inside this batch. It reads nothing run-level
// and nothing about other cases, so batching cannot change its answer. Build Runs Log
// recomputing the same value over the returned cases is therefore a free cross-check: if the
// two ever disagree, the run record and the Cases tab disagree, and that is worth a hard look.
//
// THE INPUT IS ONE ENVELOPE ITEM, NOT ONE ITEM PER CASE. Compute Case States, Guards and
// Adjudicate Cases each return `[{ json: { cases: [...] } }]` - the WF-A idiom all three were
// lifted byte-identical with - and Adjudicate Cases wires straight into this node. This node
// was written NEW for WF-T and originally read $input.all() as one-item-per-case, which made
// it treat the envelope itself as a single case: 100 cases in, one meaningless row out, the
// batch returning `_cases: 1`, and four junk rows on the Cases tab.
//
// It survived 11 green offline suites because batch_equivalence_test.js unwrapped the
// envelope for it - `exec(WFT_BANDS, adj[0].json.cases.map(c => ({ json: c })))` - modelling a
// wiring the deployed graph does not have. The offline arm has been corrected to feed `adj`
// directly, so the harness now tests the shape that actually runs.
//
// Caught live by Join Scored on execution 94122: "4 scored cases returned for 400 sent".
// The reconciliation that exists to stop a short cohort passing as a clean run earned its
// place on the first end-to-end execution.
const _input = $input.all();
let cases;
if (_input.length === 1 && _input[0].json && Array.isArray(_input[0].json.cases)) {
  cases = _input[0].json.cases;
} else {
  cases = _input.map(function (i) { return i.json; });
  // The same fault in a new shape: a "case" carrying a `cases` array is an unwrapped
  // envelope, never a case. Refuse rather than score one meaningless row per batch.
  for (const _c of cases) {
    if (_c && Array.isArray(_c.cases)) {
      throw new Error('WF-T Stamp Display Bands: an input item carries a `cases` array, so a ' +
        'scorer envelope reached this node unwrapped. Scoring would proceed on one ' +
        'meaningless case per batch and the run would under-report coverage by ~99%.');
    }
  }
}

//   not_in_scope  nothing arrived at all -> that is the SIBLING check's finding
//   inconclusive  the money question cannot be answered from what we can read:
//                 expected unknown, the scorer fell through, the quoted amount
//                 could not be resolved, or a green that still needs a human
//                 (unrecognised refund, unknown coverage). "Can't tell".
//   in_flight     PRE_PDP / PDC would cover the gap
//   paid_in_full  inside the AED 5.00 tolerance, overpaid, or not owed
//   candidate     short against the contract rate - PROVISIONAL, never a finding
function bandOf(c) {
  if (c.skip_computation === true) return 'carried';
  if (c.reason_code === 'out_of_scope_nothing_received') return 'not_in_scope';
  const cm = c.computed || {};
  const q = c.quoted || null;
  const quotedUnresolved = !!q && (q.no_quote_found === true || q.read_failed === true);
  if (cm.expected_known === false || c.reason_code === 'unscored' || quotedUnresolved) return 'inconclusive';
  if (c.new_state === 'pending_flag') return 'in_flight';
  if (c.new_state === 'green_flag' || c.new_state === 'green_flag_manual') {
    return c.requires_verifier === true ? 'inconclusive' : 'paid_in_full';
  }
  return 'candidate';
}

const bands = {};
for (const c of cases) {
  c.display_band = bandOf(c);
  bands[c.display_band] = (bands[c.display_band] || 0) + 1;
}

console.log(JSON.stringify({ stage: 'wft_stamp_bands', cases: cases.length, bands: bands,
  note: 'bandOf is lifted verbatim from Build Runs Log, which recomputes it downstream over ' +
        'the same fields - a disagreement between the two means the run record and the Cases ' +
        'tab have drifted' }));

return cases.map(function (c) { return { json: c }; });
