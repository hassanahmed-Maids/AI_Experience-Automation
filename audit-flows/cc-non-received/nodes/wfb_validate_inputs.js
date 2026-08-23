// ERP-COMPLIANCE: lease-held-by-caller - WF-A (Qq473Ygj543jxPUN) acquires the ERP lease
// (9gVijqvtLVEhQZXz) before its first ERP call and 3-Deliver (XN5DaOAfveAqtDMC) hands it back at
// the end of the chain. This stage never acquires. It DOES release on its error rail, and that is
// not a contradiction: WF-A launches this stage fire-and-forget and ends, so a failure here kills
// the chain and the 3-Deliver release never runs. Releasing a lease this run_id does not hold is
// a no-op that names the real holder, so the rail is safe on the manual-test path too.
//
// Validate Inputs (WF-B) - unpacks the baton from WF-A (or a self-call) and
// exposes it in EXACTLY the shape WF-A's Validate Inputs produces, because every
// copied evidence node reads $('Validate Inputs').first().json.params.erp_auth.bearer
// and the window fields. Same name, same shape, one validation path per workflow.
//
// THE BATON IS THE ONLY INPUT. It is small by design (a few hundred KB at worst,
// shrinking every hop) - the whole point of the split is that no execution ever
// holds the full population again. If this node sees anything but a baton it
// refuses loudly rather than guessing.
const raw = $input.first().json || {};
const baton = raw.kind === 'cc-nonreceived-baton' ? raw
            : (raw.body && raw.body.kind === 'cc-nonreceived-baton' ? raw.body : null);
if (!baton) {
  throw new Error('WF-B called without a baton. Expected {kind:"cc-nonreceived-baton", ...} from ' +
    'WF-A (Assemble Baton) or a self-call. Got keys: ' + Object.keys(raw).join(','));
}
if (baton.v !== 1) throw new Error('Baton version ' + baton.v + ' unsupported (expected 1).');
if (!baton.bearer || String(baton.bearer).indexOf('Bearer ') !== 0) {
  throw new Error('Baton carries no usable bearer - every ERP call would 401. Refusing.');
}
if (!Array.isArray(baton.candidates)) throw new Error('Baton has no candidates array.');
if (baton.candidates.length === 0) {
  throw new Error('WF-B called with ZERO candidates. WF-A must not launch the verifier for an ' +
    'empty set, and a self-call with nothing left must route to WF-C instead. This is a wiring ' +
    'bug, not a data condition.');
}

console.log(JSON.stringify({ stage: 'wfb_validate_inputs', run_id: baton.run_id,
  batch_index: baton.batch_index, batch_size: baton.batch_size,
  candidates_remaining: baton.candidates.length, candidates_total: baton.candidates_total }));

// erp_t0 - the §5 circuit breaker's clock for THIS batch. Every breaker node in this
// flow reads run_id and erp_t0 from THIS node, so the latency signal is measured from
// here to the end of whichever ERP fan-out is being judged, over the cumulative number
// of ERP calls the batch has made by then. It is stamped here rather than next to a
// single HTTP node because six fan-outs share one clock; only two cheap Code nodes
// (Select Red Cases, ERP Budget Gate) sit between this stamp and the first request.
return [{ json: {
  _error: false,
  erp_t0: Date.now(),
  run_id: baton.run_id,
  check_id: baton.check_id,
  callback_url: baton.callback_url,
  audit_month: baton.audit_month,
  range_start: baton.range_start,
  range_end: baton.range_end,
  range_start_dt: baton.range_start_dt,
  range_end_dt: baton.range_end_dt,
  params: { erp_auth: { bearer: baton.bearer } },
  _baton: baton
} }];
