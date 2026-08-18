// Validate Inputs (WF-B) - unpacks the baton from WF-A (or from a self-call) and
// exposes it in EXACTLY the shape WF-A's Validate Inputs produces. That is not
// tidiness: every evidence node in this workflow was lifted from WF-A unchanged and
// reads $('Validate Inputs').first().json.params.erp_auth.bearer and
// persistence_windows[0]. Same node name, same shape, so their bodies run here
// byte-identical - one validation path per workflow, never two.
//
// THE BATON IS THE ONLY INPUT, and it is small by design - identity, window,
// credential, candidates and stats, nothing bulk. The whole point of the split is
// that no execution ever holds the population again: n8n retains every node's output
// for the life of an execution, so WF-A's sweeps can only be released by WF-A ENDING.
// Run 89604 died at 94m44s inside the measured 100.6-142.6 MB kill band and run 90669
// grew past the point where its own record could be read back at all.
//
// If this node sees anything but a baton it refuses loudly rather than guessing.
const raw = $input.first().json || {};
const baton = raw.kind === 'cc-below-agreed-baton' ? raw
            : (raw.body && raw.body.kind === 'cc-below-agreed-baton' ? raw.body : null);
if (!baton) {
  throw new Error('WF-B called without a baton. Expected {kind:"cc-below-agreed-baton", ...} from ' +
    'WF-A (Assemble Baton) or from a self-call. Got keys: ' + Object.keys(raw).join(',') +
    '. Note the kind is check-specific on purpose: accepting another check\'s baton would be silent ' +
    'cross-contamination between two audits that share a verifier shape.');
}
if (baton.v !== 1) throw new Error('Baton version ' + baton.v + ' unsupported (expected 1).');
if (!baton.bearer || String(baton.bearer).indexOf('Bearer ') !== 0) {
  throw new Error('Baton carries no usable bearer, so every message read would 401 and every candidate ' +
    'would look like it had no evidence. An absent token must never be indistinguishable from an ' +
    'absent message. Refusing.');
}
if (!Array.isArray(baton.candidates)) throw new Error('Baton has no candidates array.');
if (baton.candidates.length === 0) {
  throw new Error('WF-B called with ZERO candidates. WF-A must not launch the verifier for an empty ' +
    'set, and a self-call with nothing left must route to WF-C instead. This is a wiring bug, not a ' +
    'data condition.');
}
// PERSISTENCE WINDOWS ARE LOAD-BEARING HERE, and this check needs them for a reason
// its sibling does not. Both message reads are scoped to persistence_windows[0] - the
// AUDITED month alone, never the full three-month window. Widening that scope would
// pull in quotes for other months and let the verifier read a May figure as July's
// agreed amount, which is precisely the confusion rule 14 exists to prevent.
if (!Array.isArray(baton.persistence_windows) || baton.persistence_windows.length === 0) {
  throw new Error('Baton carries no persistence_windows. The evidence reads are scoped to ' +
    'persistence_windows[0] (the audited month), so without them the message window would be ' +
    'undefined and every quote would come back unscoped.');
}

console.log(JSON.stringify({ stage: 'wfb_validate_inputs', run_id: baton.run_id,
  batch_index: baton.batch_index, batch_size: baton.batch_size,
  candidates_remaining: baton.candidates.length, candidates_total: baton.candidates_total,
  audited_month: baton.persistence_windows[0].key }));

return [{ json: {
  _error: false,
  run_id: baton.run_id,
  check_id: baton.check_id,
  callback_url: baton.callback_url,
  audit_month: baton.audit_month,
  range_start: baton.range_start,
  range_end: baton.range_end,
  persistence_windows: baton.persistence_windows,
  params: { erp_auth: { bearer: baton.bearer } },
  _baton: baton
} }];
