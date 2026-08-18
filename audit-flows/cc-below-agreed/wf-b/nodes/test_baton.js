// Test Baton - the manual test path, so WF-B can be proven WITHOUT running WF-A.
// It feeds the SAME Validate Inputs as the real caller, so a manual test is validated
// identically and cannot pass on a shape the real baton would fail on.
//
// ============================== READ THIS ==================================
// PASTE A FRESH ERP TOKEN INTO ERP_BEARER AND ONE OR TWO REAL CANDIDATES BELOW.
// The token is the value after 'Bearer ' in the Authorization header of any logged-in
// erp.maids.cc request, and it must KEEP the 'Bearer ' prefix here.
//
// It is DELIBERATELY LEFT EMPTY. ERP tokens last 24h, so a baked one is stale within
// the day, and anything pasted here is a plaintext secret readable by anyone with
// access to this n8n project and written into every execution's data. Clear it again
// once the test is done.
// ===========================================================================
const ERP_BEARER = '';

// Two real contracts are enough to exercise the whole chain: one whose month carries
// BOTH template families (the case rule 14 exists for) and one with no accounting
// message at all (which must resolve UNRESOLVED, never zero and never a finding).
const CANDIDATES = [
  // { case_key: '1054346:2026-07', contract_id: '1054346', client_id: '', is_candidate: true,
  //   state: 'red_flag', reason_code: 'shortfall_persistent_varying', expected: 4715, actual: 2100 },
];

const AUDIT_YEAR = 2026;
const AUDIT_MONTH = 7;

if (!ERP_BEARER || ERP_BEARER.indexOf('Bearer ') !== 0) {
  throw new Error('Test Baton has no ERP token. Paste a fresh one into ERP_BEARER in this node ' +
    '(they expire after 24h). Refusing to run a verifier test that would 401 on every message read ' +
    'and report every candidate as having no evidence.');
}
if (!CANDIDATES.length) {
  throw new Error('Test Baton has no candidates. Uncomment and fill CANDIDATES with one or two real ' +
    'contract_id / client_id pairs from a WF-A run. A verifier test with nothing to verify proves ' +
    'only that the wiring parses.');
}

function pad(n) { return String(n).padStart(2, '0'); }
function monthWindow(y, m) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { key: y + '-' + pad(m), from: y + '-' + pad(m) + '-01', to: y + '-' + pad(m) + '-' + pad(last) };
}
// Three windows, most recent first, exactly as WF-A derives them - the evidence reads
// take [0] and nothing else, but the shape must match or a lifted node reads undefined.
const w0 = monthWindow(AUDIT_YEAR, AUDIT_MONTH);
const prev = AUDIT_MONTH === 1 ? { y: AUDIT_YEAR - 1, m: 12 } : { y: AUDIT_YEAR, m: AUDIT_MONTH - 1 };
const prev2 = prev.m === 1 ? { y: prev.y - 1, m: 12 } : { y: prev.y, m: prev.m - 1 };

console.log(JSON.stringify({ stage: 'wfb_test_baton', candidates: CANDIDATES.length,
  audited_month: w0.key, note: 'MANUAL TEST - verdict rows written by this run are not an audit' }));

return [{ json: {
  kind: 'cc-below-agreed-baton',
  v: 1,
  run_id: 'manual-wfb-test-' + w0.key,
  check_id: 'manual-cc-below-agreed',
  callback_url: 'https://nnbyjbdbigcpoqtsczlz.supabase.co/functions/v1/ta-callback/' +
    new Array(64).fill('0').join(''),
  trigger: 'manual',
  audit_month: w0.key,
  range_start: w0.from,
  range_end: w0.to,
  persistence_windows: [w0, monthWindow(prev.y, prev.m), monthWindow(prev2.y, prev2.m)],
  bearer: ERP_BEARER,
  candidates: CANDIDATES,
  candidates_total: CANDIDATES.length,
  batch_index: 0,
  batch_size: 50,
  stats: { evidence_cap: null, manual_test: true },
  verdicts: { processed: 0, by_verdict: {} }
} }];
