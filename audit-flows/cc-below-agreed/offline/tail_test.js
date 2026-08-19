// WF-A TAIL suite - Join Scored -> Build Runs Log -> Build Case Payload -> Build Summary Row
//                   -> Select Candidates -> Assemble Baton
//
// WHY THIS EXISTS. Until 2026-08-19 this stretch had NEITHER an offline test NOR a live
// execution. Execution 94122 was the first run ever to reach the scoring tail and it was
// stopped at Join Scored, one node short of here; 93346 died earlier still. So everything
// below Join Scored has never executed, in any run, ever - and Assemble_Baton.js,
// Build_Case_Payload.js and Build_Summary_Row.js had no test loading them at all.
//
// THE FIXTURES ARE NOT HAND-BUILT, AND THAT IS THE WHOLE POINT OF THE DESIGN.
// 94122's bug was that `Stamp Display Bands` read its wire as one-item-per-case while its
// upstream emits ONE ENVELOPE item. Eleven offline suites were green because
// batch_equivalence_test.js unwrapped the envelope FOR that node - it modelled a wiring the
// deployed graph does not have. A hand-authored fixture cannot catch a shape mismatch,
// because the hand that authors it authors the mismatch away.
//
// So this suite does not invent a Join Scored output. It runs the REAL WF-T chain
// (Chunk Cases -> Validate Inputs -> Join Enrichment -> Compute Case States -> Guards ->
// Adjudicate Cases -> Stamp Display Bands -> Build Sheet Rows -> Return Batch) and then the
// REAL Join Scored over its returns, and feeds THAT envelope to the tail. The only thing
// mocked is the wiring itself, and it is mocked to match the DEPLOYED graph, read off
// WF-A `uJ8UVNKdN2s5PHHA` on 2026-08-19:
//
//   Join Scored -> Build Runs Log -> Post runs log? -> [Callback - Runs Log: DISABLED,
//     so n8n passes input straight through] -> Build Case Payload
//   Build Case Payload -> [Callback - Results: DISABLED, passthrough] -> Select Candidates
//     -> Assemble Baton -> Launch Verifier (WF-B)
//   Build Case Payload -> Build Summary Row -> Run Summary -> Google Sheet
//
// Both disabled callback nodes are passthroughs in n8n, which is why Select Candidates runs
// at all despite its only inbound wire coming from a disabled node. If either is ever
// ENABLED and starts transforming its input, this suite's wiring stops matching production
// and must be updated with it.
//
// THE $ MOCK THROWS ON AN UNKNOWN NODE, deliberately, exactly as the other suites do. That
// is what makes a lifted body reading a node that no longer exists visible here rather than
// in a 35-minute run. Build Runs Log reads several nodes inside try/catch on purpose (the
// sweeps, for its footprint self-report), so those degrade to zero rather than failing -
// which is also what n8n does.
// PROVEN TO BITE. A suite that cannot fail is worth nothing - that is precisely how 94122's
// bug survived eleven green suites. Each of these was applied to the REAL node body, the suite
// re-run, and the body restored (2026-08-19):
//
//   mutation                                                        result
//   Build Runs Log treats each wire ITEM as a case (the 94122 shape) caught, 9 assertions
//   Build Case Payload loses the run record                          caught, 4
//   Select Candidates emits an envelope instead of per-item          caught, 4
//   the zero-cases fallback reverted to $('Compute Case States')     caught, 4
//   Select Candidates DROPS a no-client-id shortfall silently        caught, 2
//   Assemble Baton reads only the first candidate                    caught, 2
//
// A seventh mutation - rewriting $input.first().json as $input.all()[0].json - was NOT caught,
// and correctly so: on a one-item wire those are the same expression, so nothing had changed.
// Worth recording because it is the trap in mutation testing itself. A mutation that does not
// alter behaviour proves nothing about the suite, and reading it as a blind spot would have
// sent someone hunting for a gap that is not there.

const fs = require('fs'), path = require('path');
const R  = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// --- the tail, WF-A's own bodies -------------------------------------------------------
const RUNS_LOG   = R('nodes/Build_Runs_Log.js');
const CASE_PAY   = R('nodes/Build_Case_Payload.js');
const SUMMARY    = R('nodes/Build_Summary_Row.js');
const SELECT     = R('nodes/Select_Candidates.js');
const BATON      = R('nodes/Assemble_Baton.js');
// --- the head that produces the tail's input, WF-T's deployed bodies --------------------
const CHUNK      = R('wf-t/wfa/chunk_cases.js');
const JOIN_SCORED= R('wf-t/wfa/join_scored.js');
const T_VALIDATE = R('wf-t/nodes/validate_inputs.js');
const T_JOIN     = R('wf-t/nodes/join_enrichment.js');
const T_COMPUTE  = R('wf-t/nodes/compute_case_states.js');
const T_GUARDS   = R('wf-t/nodes/guards.js');
const T_ADJUD    = R('wf-t/nodes/adjudicate_cases.js');
const T_BANDS    = R('wf-t/nodes/stamp_bands.js');
const T_SHEETS   = R('wf-t/nodes/build_sheet_rows.js');
const T_RETURN   = R('wf-t/nodes/return_batch.js');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}

function exec(src, inputItems, nodes) {
  const $ = (n) => {
    if (!(n in nodes)) throw new Error('unexpected $(' + n + ') - this body reads a node that ' +
      'does not exist at this point in the deployed graph');
    const a = nodes[n];
    return { all: () => a, first: () => a[0] };
  };
  const logs = [];
  const out = new Function('$input', '$', 'console', src)(
    { all: () => inputItems, first: () => inputItems[0] }, $, { log: m => logs.push(m) });
  return { out: out || [],
           logs: logs.map(x => { try { return JSON.parse(x); } catch (e) { return {}; } }) };
}
const lastLog = (r) => r.logs[r.logs.length - 1] || {};

// ------------------------------------------------------------------------- fixtures
const WINDOWS = [
  { key: '2026-07', from: '2026-07-01', to: '2026-07-31', node: 'Get Month Payments' },
  { key: '2026-06', from: '2026-06-01', to: '2026-06-30', node: 'Get Payments (M-1)' },
  { key: '2026-05', from: '2026-05-01', to: '2026-05-31', node: 'Get Payments (M-2)' }
];
// Assemble Baton THROWS without a bearer - by design, so a missing credential fails loudly
// here instead of as per-case "missing evidence" inside WF-B. The fixture carries a dummy.
const VALIDATED = {
  check_id: 'cc-below-agreed', run_id: 'r-tail-test',
  callback_url: 'https://nnbyjbdbigcpoqtsczlz.supabase.co/functions/v1/ta-callback/' + 'a'.repeat(64),
  audit_month: '2026-07', range_start: '2026-07-01', range_end: '2026-07-31',
  persistence_windows: WINDOWS,
  params: { erp_auth: { bearer: 'Bearer offline-test-not-a-real-token' }, batch_size: 50 }
};
function month(o) {
  return Object.assign({ monthly_received: 0, other_received: 0, monthly_net: 0, received_gross: 0,
    refund_mp_reversing: 0, refund_other: 0, in_flight: 0, dead_rows: 0, rows: 0,
    unrecognised_refund: false, types_seen: {}, bulk_only_rows: 0 }, o);
}
function mp(net, extra) { return month(Object.assign({ monthly_received: net, monthly_net: net }, extra || {})); }
function plan(gross, extra) {
  return Object.assign({ expected_amount_known: gross !== null, expected_gross: gross,
    first_month_payment: null, daily_rate_amount: null, is_one_month_agreement: false,
    additional_discount: { present: false, text: '', amount: 0, months: null, per_month: 0 },
    credit_note_discount: { present: false, text: '', amount: 0, months: null, per_month: 0 },
    monthly_schedule_starts: '', monthly_schedule_starts_raw: '', one_time_dates: [],
    rate_is_contractual_not_billed: true }, extra || {});
}
function caseOf(o) {
  return Object.assign({
    case_key: o.contract_id + ':2026-07',
    contract_id: '', client_id: 'c1', client_name: 'REDACTED', maid_id: 'm1', maid_name: 'REDACTED',
    maid_nationality: '', contract_status: 'ACTIVE', contract_start: '2025-01-01',
    scheduled_termination: '', termination_source: '', maid_live_out: false,
    sources: ['population_route'], needs_enrichment: true, received_anything: true,
    skip_computation: false, replacements: [], replacements_meta: { fetch_failed: false,
      permission_denied: true, token_dead: false, rows: 0, declared_total: null, truncated: null },
    plan: plan(5712), months: {}
  }, o);
}
// The same spread batch_equivalence_test uses, so several bands and gates are represented -
// a cohort that lands in one band would prove nothing about the tail's counting. One case
// (1102007) is added here specifically for Select Candidates' no-client-id path.
const COHORT = [
  caseOf({ contract_id: '1054346', plan: plan(4715),
           months: { '2026-07': mp(2100), '2026-06': mp(3129), '2026-05': mp(3129) } }),
  caseOf({ contract_id: '1090543', plan: plan(5712),
           months: { '2026-07': mp(3360), '2026-06': mp(3360), '2026-05': mp(3360) } }),
  caseOf({ contract_id: '1055190', plan: plan(5299),
           months: { '2026-07': month({ monthly_received: 10598, refund_mp_reversing: 5299, monthly_net: 5299 }),
                     '2026-06': mp(5299), '2026-05': mp(5299) } }),
  caseOf({ contract_id: '1088698', plan: plan(5712),
           months: { '2026-07': mp(939), '2026-06': mp(5712), '2026-05': mp(5712) } }),
  caseOf({ contract_id: '1102001', plan: plan(null),
           months: { '2026-07': mp(1000) } }),                          // expected unknown
  caseOf({ contract_id: '1102002', plan: plan(5712),
           months: { '2026-07': month({ monthly_received: 0, monthly_net: 0, in_flight: 5712 }) } }),
  caseOf({ contract_id: '1102003', plan: plan(5712), received_anything: false,
           needs_enrichment: false, months: { '2026-07': mp(0) } }),
  caseOf({ contract_id: '1102004', skip_computation: true, carried_state: 'red_flag',
           plan: plan(5712), months: { '2026-07': mp(0) } }),
  caseOf({ contract_id: '1102006', plan: plan(5712),
           months: { '2026-07': mp(5712), '2026-06': mp(5712), '2026-05': mp(5712) } }),
  // A SHORTFALL WITH NO CLIENT ID. Select Candidates must COUNT this, never drop it: a
  // dropped case is an un-audited shortfall that looks identical to one that was read.
  caseOf({ contract_id: '1102007', client_id: '', plan: plan(5712),
           months: { '2026-07': mp(1200), '2026-06': mp(1200), '2026-05': mp(1200) } })
];

// ------------------------------------------------- the real head, producing a real envelope
function scoreThroughWfT(cohort, batchSize) {
  const items = cohort.map(c => ({ json: JSON.parse(JSON.stringify(c)) }));
  const validated = Object.assign({}, VALIDATED,
    { params: Object.assign({}, VALIDATED.params, { score_batch_size: batchSize }) });
  const chunkOut = exec(CHUNK, items, { 'Validate Inputs': [{ json: validated }] }).out;
  const returns = [];
  for (const b of chunkOut) {
    const called = [{ json: b.json }];
    const vOut = exec(T_VALIDATE, called, {}).out;
    const vNodes = { 'Validate Inputs': vOut, 'When Called': called };
    const perCase = exec(T_JOIN, [], vNodes).out;
    const scored  = exec(T_COMPUTE, perCase, vNodes).out;
    const guarded = exec(T_GUARDS, scored, Object.assign({ 'Join Enrichment': perCase }, vNodes)).out;
    const adj     = exec(T_ADJUD, guarded, vNodes).out;
    // THE ENVELOPE GOES IN UNWRAPPED - this is the deployed wire, and the line that used to
    // unwrap it here is what hid 94122's bug.
    const banded  = exec(T_BANDS, adj, vNodes).out;
    const rows    = exec(T_SHEETS, [], Object.assign({ 'Stamp Display Bands': banded }, vNodes)).out;
    // The Sheets append echoes ONE ITEM PER APPENDED ROW (probe #15, settled from execution
    // 88906 of a sibling audit), so the echo is the rows themselves.
    const ret     = exec(T_RETURN, rows, Object.assign({ 'Stamp Display Bands': banded,
                                                         'When Called': called }, vNodes)).out;
    returns.push({ json: ret[0].json });
  }
  return exec(JOIN_SCORED, returns, { 'Chunk Cases': chunkOut });
}

// ------------------------------------------------------------------ the tail under test
function runTail(joinScored, opts) {
  const o = opts || {};
  const validated = o.validated || VALIDATED;
  const cases = joinScored.out[0].json.cases;

  // Build Cohort emits ONE ITEM PER CONTRACT and logs its stats to the console only, so
  // Build Runs Log re-derives the cohort figures from the items. Mocked in that shape.
  const cohortItems = cases.map(c => ({ json: {
    sources: (o.pipelineTest ? ['population_route'] : ['population_route', 'payment_stub']),
    maid_id: 'm1', maid_live_out: false,
    pipeline_test: !!o.pipelineTest,
    cohort_cap: o.pipelineTest ? o.cohortCap : undefined,
    cohort_before_cap: o.pipelineTest ? o.cohortBeforeCap : undefined
  } }));
  const gate2 = { population_rows: 5401, population_pages: 136, population_floor: 4600,
    population_reconciled: true, payment_rows_per_window: { '2026-07': 6774 },
    status_rows: 43727, status_pages: 22, status_sweep_reconciled: true };

  const base = {
    'Validate Inputs': [{ json: validated }],
    'Verify Bulk Pulls': [{ json: { _gate2: gate2 } }],
    'Build Cohort': cohortItems,
    'Join Scored': joinScored.out
  };
  // A couple of sweep nodes so the footprint self-report actually computes rather than
  // silently reporting zero. The rest are absent on purpose: Build Runs Log wraps every
  // estimate in try/catch, and 'did not execute' is the honest answer for a node that did not.
  const withSweeps = Object.assign({
    'Get Payment Statuses': [{ json: { content: new Array(200).fill({ id: 1, status: 'PAID', amount: 1 }) } }],
    'Get Month Payments': [{ json: { payments: new Array(120).fill({ contractID: 1, paymentAmount: 1 }) } }]
  }, base);

  const runs = exec(RUNS_LOG, joinScored.out, withSweeps);
  const withRuns = Object.assign({ 'Build Runs Log': runs.out }, withSweeps);
  // Post runs log? is an IF and Callback - Runs Log is DISABLED: both pass the item through.
  const payload = exec(CASE_PAY, runs.out, withRuns);
  const withPay = Object.assign({ 'Build Case Payload': payload.out }, withRuns);
  const summary = exec(SUMMARY, payload.out, withPay);
  // Callback - Results is DISABLED, so Build Case Payload's item reaches Select Candidates.
  const select  = exec(SELECT, payload.out, withPay);
  const baton   = exec(BATON, select.out, Object.assign({ 'Select Candidates': select.out }, withPay));
  return { runs, payload, summary, select, baton, cases };
}

// ================================================================================ TESTS
console.log('--- the head, run for real so the tail gets a genuine envelope ---');
const joined = scoreThroughWfT(COHORT, 4);          // 3 batches over 10 cases
const scoredCases = joined.out[0].json.cases;
ok(joined.out.length === 1, 'Join Scored emits exactly ONE item (an envelope), not one per case',
   'got ' + joined.out.length);
ok(Array.isArray(scoredCases) && scoredCases.length === COHORT.length,
   'Join Scored carries every case the cohort started with',
   scoredCases.length + ' of ' + COHORT.length);

const T = runTail(joined);

console.log('\n--- seam shapes: the 94122 class of bug ---');
ok(T.runs.out.length === 1 && Array.isArray(T.runs.out[0].json.cases),
   'Build Runs Log consumes the envelope and re-emits one');
ok(T.runs.out[0].json.record.results.cases === COHORT.length,
   'the run record counts every case, so nothing was lost across the Join Scored seam',
   'record says ' + T.runs.out[0].json.record.results.cases);
ok(T.payload.out.length === 1, 'Build Case Payload emits ONE item');
ok(T.summary.out.length === 1, 'Build Summary Row emits ONE row');
// Select Candidates is the one PER-ITEM emitter in the tail, and Assemble Baton reads
// $input.all(). If either side ever flips, the baton silently carries one candidate.
ok(T.select.out.length === lastLog(T.select).selected,
   'Select Candidates emits ONE ITEM PER CANDIDATE (per-item, not an envelope)',
   T.select.out.length + ' items vs log ' + lastLog(T.select).selected);
ok(T.baton.out.length === 1 && T.baton.out[0].json.candidates.length === T.select.out.length,
   'Assemble Baton reads every Select Candidates item across the per-item seam',
   'baton ' + T.baton.out[0].json.candidates.length + ' vs select ' + T.select.out.length);

console.log('\n--- nothing is lost or duplicated through the tail ---');
const inKeys = scoredCases.map(c => c.case_key).sort();
const outKeys = T.payload.out[0].json.result_data.cases.map(c => c.case_key).sort();
ok(JSON.stringify(inKeys) === JSON.stringify(outKeys),
   'every case_key entering the tail appears exactly once in the case payload');

console.log('\n--- the two band definitions must agree ---');
// Build Runs Log recomputes display_band with its OWN bandOf over the cases Stamp Display
// Bands already stamped. The comment in both nodes says a disagreement means the run record
// and the Cases tab have drifted. This is the test that would notice.
const drift = scoredCases.filter(c => {
  const stamped = c.display_band;
  return typeof stamped !== 'string' || stamped.length === 0;
});
ok(drift.length === 0, 'every case carries a display_band after the tail', drift.length + ' without one');
const bandCounts = {};
for (const c of scoredCases) bandCounts[c.display_band] = (bandCounts[c.display_band] || 0) + 1;
const rec = T.runs.out[0].json.record.results;
ok(rec.candidates_provisional === (bandCounts.candidate || 0),
   'the record\'s candidate count equals the stamped candidate band',
   rec.candidates_provisional + ' vs ' + (bandCounts.candidate || 0));
ok(rec.paid_in_full_or_not_owed === (bandCounts.paid_in_full || 0),
   'the record\'s paid-in-full count equals the stamped band');
ok(rec.inconclusive_cant_tell === (bandCounts.inconclusive || 0),
   'the record\'s inconclusive count equals the stamped band');
ok(Object.keys(bandCounts).length >= 3,
   'the fixture spans at least three bands, so the counting assertions are not vacuous',
   JSON.stringify(bandCounts));

console.log('\n--- the record may never call a candidate a finding ---');
ok(Object.keys(rec.finding_reasons || {}).length === 0,
   'finding_reasons is EMPTY off the scorer - only the verifier may fill it');
ok(typeof rec.candidates_provisional === 'number' && rec.total_candidate_shortfall_aed >= 0,
   'shortfall money is reported as CANDIDATE money');
ok(!/\bfindings\b/i.test(JSON.stringify(T.runs.out[0].json.record.results)),
   'the results block does not use the word "findings"');

console.log('\n--- Select Candidates: the selection rule, and the case it must not drop ---');
const expectSelected = scoredCases.filter(c =>
  c.new_state === 'red_flag' && c.skip_computation !== true && (c.metadata || {}).client_id);
ok(T.select.out.length === expectSelected.length,
   'selects exactly the red_flag, non-carried cases that have a client_id',
   T.select.out.length + ' vs expected ' + expectSelected.length);
const noClient = scoredCases.filter(c =>
  c.new_state === 'red_flag' && c.skip_computation !== true && !(c.metadata || {}).client_id);
ok(lastLog(T.select).skipped_no_client_id === noClient.length,
   'a shortfall with no client_id is COUNTED, never silently dropped',
   'log says ' + lastLog(T.select).skipped_no_client_id + ', cohort has ' + noClient.length);
ok(noClient.length > 0,
   'the fixture actually contains a no-client-id shortfall, so the check above is not vacuous');
ok(T.select.out.every(i => i.json.rate_is_contractual_not_billed === true),
   'every selected candidate carries the contractual-rate warning the verifier depends on');

console.log('\n--- the baton WF-B receives ---');
const b = T.baton.out[0].json;
ok(b.kind === 'cc-below-agreed-baton' && b.v === 1, 'baton is self-identifying and version 1');
ok(b.batch_size > 0, 'baton carries a positive batch_size');
ok(b.candidates_total === b.candidates.length, 'candidates_total matches the list it describes');
ok(b.has_candidates === (b.candidates.length > 0), 'has_candidates matches the list');
ok(JSON.stringify(b.persistence_windows) === JSON.stringify(WINDOWS),
   'the three persistence windows travel EXACTLY as derived, not re-derived in WF-B');
ok(b.verdicts && b.verdicts.processed === 0 && Object.keys(b.verdicts.by_verdict).length === 0,
   'the verdict tally starts empty - empty means "not yet verified", never "nothing found"');
ok(!!b.bearer, 'the baton carries a bearer (Assemble Baton throws without one)');

console.log('\n--- a capped run must mark itself unpublishable ---');
const capped = runTail(joined, { pipelineTest: true, cohortCap: 400, cohortBeforeCap: 5612 });
const cr = capped.runs.out[0].json.record;
ok(cr.pipeline_test === true && cr.publishable === false,
   'a capped run records pipeline_test true and publishable false');
ok(/PIPELINE TEST - NOT AN AUDIT/.test(cr.caveats[0]),
   'the FIRST caveat on a capped run says it is not an audit', cr.caveats[0]);
ok(capped.baton.out[0].json.stats.pipeline_test === true,
   'the capped flag reaches WF-B on the baton, so the verifier cannot mistake it for an audit');

console.log('\n--- REGRESSION: the zero-cases fallback (fixed 2026-08-19) ---');
// Build Runs Log's fallback named $('Compute Case States') until today. That node moved into
// WF-T when the tail was batched, so WF-A has not contained it since - the lookup could only
// throw, and the catch swallowed it. The guard was dead and looked healthy. It now names
// Join Scored. Feed a wire with NO cases and the fallback must recover them.
const strippedWire = [{ json: Object.assign({}, joined.out[0].json, { cases: [] }) }];
const recovered = exec(RUNS_LOG, strippedWire, {
  'Validate Inputs': [{ json: VALIDATED }],
  'Verify Bulk Pulls': [{ json: { _gate2: {} } }],
  'Build Cohort': [],
  'Join Scored': joined.out
});
ok(recovered.out[0].json.cases.length === COHORT.length,
   'when the wire arrives without cases, the fallback recovers them from Join Scored',
   'recovered ' + recovered.out[0].json.cases.length + ' of ' + COHORT.length);
// Comments are stripped first: the node's own comment BLOCK explains the old name, so a
// naive grep over the raw source matches the explanation rather than the code. (That is
// exactly what this assertion did on its first run - a test bug, caught by the test.)
const RUNS_LOG_CODE = RUNS_LOG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
ok(/\$\('Join Scored'\)/.test(RUNS_LOG_CODE) && !/\$\('Compute Case States'\)/.test(RUNS_LOG_CODE),
   'the fallback CODE names Join Scored and no longer names the departed Compute Case States');

console.log('\n--- every $(name) the tail reads must exist in WF-A ---');
// The static twin of tools/seam_check.py check 1, kept here so `node offline/tail_test.js`
// catches a re-broken reference without needing an export of the deployed graph.
const WFA_NODES = new Set(['Validate Inputs','Verify Bulk Pulls','Build Cohort','Join Scored',
  'Build Runs Log','Build Case Payload','Build Summary Row','Select Candidates','Assemble Baton',
  'Attach Month Payments','Chunk Cases','Chunk Candidates','Join Enrichment','Merge Streams',
  'Get CC Contract Population','Get Terminated Contracts','Get Month Payments','Get Payments (M-1)',
  'Get Payments (M-2)','Get Payment Statuses','Get Contract Plan','Get Replacements',
  'Get Messages (WhatsApp)','Get Messages (SMS)','Merge with previous_cases','Score Batch (WF-T)',
  'Enrich Candidates (WF-E)','Manual Run Config','Build Error Callback']);
const bodies = { 'Build Runs Log': RUNS_LOG, 'Build Case Payload': CASE_PAY,
                 'Build Summary Row': SUMMARY, 'Select Candidates': SELECT, 'Assemble Baton': BATON };
let dangling = [];
for (const [name, src] of Object.entries(bodies)) {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  for (const m of stripped.matchAll(/\$\('([^']+)'\)/g)) {
    if (!WFA_NODES.has(m[1])) dangling.push(name + " -> $('" + m[1] + "')");
  }
}
ok(dangling.length === 0, 'no tail body reads a node that is not in WF-A', dangling.join('; '));

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' + (pass + fail) : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
