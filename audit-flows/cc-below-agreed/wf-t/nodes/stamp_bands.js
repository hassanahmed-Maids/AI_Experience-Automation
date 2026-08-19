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
const cases = $input.all().map(function (i) { return i.json; });

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
