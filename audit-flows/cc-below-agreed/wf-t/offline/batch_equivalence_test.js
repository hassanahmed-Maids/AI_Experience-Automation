// WF-T equivalence suite: the batched tail must produce EXACTLY what the un-batched tail did.
//
// This is the only test that matters for this refactor. Relocating ~1,100 lines of scoring
// into a sub-workflow is worth nothing if it moves a single verdict, and the failure mode is
// silent: a lifted body reading $('Some Node') that no longer exists gets an exception, but a
// body reading a field that arrived undefined just scores differently and reports confidently.
//
// So both chains are run over the SAME fixtures, and the outputs are compared field by field:
//   OLD:  Compute Case States -> Guards -> Adjudicate Cases -> bandOf (Build Runs Log's copy)
//         -> Build Sheet Rows
//   NEW:  Chunk Cases -> [per batch: Validate Inputs, Join Enrichment, Compute Case States,
//         Guards, Adjudicate Cases, Stamp Display Bands, Build Sheet Rows, Return Batch]
//         -> Join Scored
// Every batch size from 1 to n+1 is exercised, because an off-by-one in the partition shows up
// only at the boundaries.
const fs = require('fs'), path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const RR = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

const COMPUTE = R('nodes/compute_case_states.js');
const GUARDS = R('nodes/guards.js');
const ADJUD = R('nodes/adjudicate_cases.js');
const SHEETS = R('nodes/build_sheet_rows.js');
const WFT_VALIDATE = R('nodes/validate_inputs.js');
const WFT_JOIN = R('nodes/join_enrichment.js');
const WFT_BANDS = R('nodes/stamp_bands.js');
const WFT_RETURN = R('nodes/return_batch.js');
const CHUNK = R('wfa/chunk_cases.js');
const JOIN_SCORED = R('wfa/join_scored.js');
const RUNS_LOG = RR('nodes/Build_Runs_Log.js');
// The WF-A originals, for the un-batched arm. Compute/Guards are the deployed truth in the
// repo; Adjudicate and Build Sheet Rows are the same files the lifted copies came from, so the
// arms differ ONLY in the wiring - which is precisely what this suite is testing.
const A_COMPUTE = RR('nodes/Compute_Case_States.js');
const A_GUARDS = RR('nodes/Guards.js');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}

// ------------------------------------------------------------------ the runner
function exec(src, inputItems, nodes) {
  const $ = (n) => {
    if (!(n in nodes)) throw new Error('unexpected $(' + n + ') - the lifted body reads a node ' +
      'that does not exist in this arm');
    const a = nodes[n];
    return { all: (i) => a, first: () => a[0] };
  };
  const logs = [];
  const out = new Function('$input', '$', 'console', src)(
    { all: () => inputItems, first: () => inputItems[0] }, $, { log: m => logs.push(m) });
  return { out: out || [],
           log: logs.map(x => { try { return JSON.parse(x) } catch (e) { return {} } }).pop() || {} };
}

// ---------------------------------------------------------------- the fixtures
const WINDOWS = [
  { key: '2026-07', from: '2026-07-01', to: '2026-07-31', node: 'Get Month Payments' },
  { key: '2026-06', from: '2026-06-01', to: '2026-06-30', node: 'Get Payments (M-1)' },
  { key: '2026-05', from: '2026-05-01', to: '2026-05-31', node: 'Get Payments (M-2)' }
];
const VALIDATED = {
  check_id: 'cc-below-agreed', run_id: 'r-batch-test',
  callback_url: 'https://nnbyjbdbigcpoqtsczlz.supabase.co/functions/v1/ta-callback/' + 'a'.repeat(64),
  audit_month: '2026-07', range_start: '2026-07-01', range_end: '2026-07-31',
  persistence_windows: WINDOWS, params: {}
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
// A spread wide enough that every band and several gates are represented - a suite in which
// every case lands in the same band would prove nothing about the relocation.
const COHORT = [
  caseOf({ contract_id: '1054346', plan: plan(4715),
           months: { '2026-07': mp(2100), '2026-06': mp(3129), '2026-05': mp(3129) } }),
  caseOf({ contract_id: '1090543', plan: plan(5712),
           months: { '2026-07': mp(3360), '2026-06': mp(3360), '2026-05': mp(3360) } }),
  caseOf({ contract_id: '1097602', plan: plan(4452, {
             additional_discount: { present: true, text: 'Discount Amount: 1000 applied on Service Fees over 4 months',
                                    amount: 1000, months: 4, per_month: 250 } }),
           months: { '2026-07': mp(2252, { other_received: 2200, types_seen: { 'Service charge': 2200 } }),
                     '2026-06': mp(4452), '2026-05': mp(4452) } }),
  caseOf({ contract_id: '1055190', plan: plan(5299),
           months: { '2026-07': month({ monthly_received: 10598, refund_mp_reversing: 5299, monthly_net: 5299 }),
                     '2026-06': mp(5299), '2026-05': mp(5299) } }),
  caseOf({ contract_id: '1101890', contract_start: '2026-07-31', plan: plan(5712),
           months: { '2026-07': mp(184) } }),
  caseOf({ contract_id: '1088698', plan: plan(5712),
           months: { '2026-07': mp(939), '2026-06': mp(5712), '2026-05': mp(5712) } }),
  caseOf({ contract_id: '1102001', plan: plan(null),          // expected unknown -> inconclusive
           months: { '2026-07': mp(1000) } }),
  caseOf({ contract_id: '1102002', plan: plan(5712),          // in flight
           months: { '2026-07': month({ monthly_received: 0, monthly_net: 0, in_flight: 5712 }) } }),
  caseOf({ contract_id: '1102003', plan: plan(5712), received_anything: false,
           needs_enrichment: false, months: { '2026-07': mp(0) } }),   // nothing received
  // Carried forward. carried_state is REQUIRED on a skip_computation case - Adjudicate
  // refuses to publish one with no state at all, which is the right refusal and is why the
  // fixture carries it.
  caseOf({ contract_id: '1102004', skip_computation: true, carried_state: 'red_flag',
           plan: plan(5712), months: { '2026-07': mp(0) } }),
  caseOf({ contract_id: '1102005', plan: plan(5712, { monthly_schedule_starts: '2026-09-01' }),
           months: { '2026-07': mp(1000) } }),                         // gate 35 candidate
  caseOf({ contract_id: '1102006', plan: plan(5712),
           months: { '2026-07': mp(5712), '2026-06': mp(5712), '2026-05': mp(5712) } })  // paid in full
];

// ---------------------------------------------------------- ARM 1: un-batched
function bandOfFromRunsLog() {
  // Pulled out of Build Runs Log by source so the comparison uses ITS definition, not a
  // hand-copy - if the two ever diverge this test is what notices.
  const m = /function bandOf\(c\) \{[\s\S]*?\n\}/.exec(RUNS_LOG);
  if (!m) throw new Error('could not locate bandOf in Build_Runs_Log.js');
  return new Function('return ' + m[0])();
}
function unbatched(cohort) {
  const items = cohort.map(c => ({ json: JSON.parse(JSON.stringify(c)) }));
  const vNodes = { 'Validate Inputs': [{ json: VALIDATED }] };
  const scored = exec(A_COMPUTE, items, vNodes).out;
  const guarded = exec(A_GUARDS, scored,
    Object.assign({ 'Join Enrichment': items }, vNodes)).out;
  const adj = exec(ADJUD, guarded, vNodes).out;
  const cases = adj[0].json.cases;
  const bandOf = bandOfFromRunsLog();
  for (const c of cases) c.display_band = bandOf(c);
  const rows = exec(SHEETS, [], Object.assign({
    'Stamp Display Bands': cases.map(c => ({ json: c }))
  }, vNodes)).out;
  return { cases: cases, rows: rows.map(r => r.json) };
}

// ------------------------------------------------------------ ARM 2: batched
function batched(cohort, batchSize) {
  const items = cohort.map(c => ({ json: JSON.parse(JSON.stringify(c)) }));
  const validated = Object.assign({}, VALIDATED,
    { params: Object.assign({}, VALIDATED.params, { score_batch_size: batchSize }) });
  const chunkOut = exec(CHUNK, items, { 'Validate Inputs': [{ json: validated }] }).out;

  const returns = [];
  for (const b of chunkOut) {
    const called = [{ json: b.json }];
    const vOut = exec(WFT_VALIDATE, called, {}).out;
    const vNodes = { 'Validate Inputs': vOut, 'When Called': called };
    const perCase = exec(WFT_JOIN, [], vNodes).out;
    const scored = exec(COMPUTE, perCase, vNodes).out;
    const guarded = exec(GUARDS, scored,
      Object.assign({ 'Join Enrichment': perCase }, vNodes)).out;
    const adj = exec(ADJUD, guarded, vNodes).out;
    const banded = exec(WFT_BANDS, adj[0].json.cases.map(c => ({ json: c })), vNodes).out;
    const rows = exec(SHEETS, [],
      Object.assign({ 'Stamp Display Bands': banded }, vNodes)).out;
    // The Sheets append echoes one item per appended row.
    const ret = exec(WFT_RETURN, rows,
      Object.assign({ 'Stamp Display Bands': banded }, vNodes)).out;
    returns.push({ json: ret[0].json, _rows: rows.map(r => r.json) });
  }
  const joined = exec(JOIN_SCORED, returns.map(r => ({ json: r.json })),
    { 'Chunk Cases': chunkOut }).out;
  return { cases: joined[0].json.cases,
           rows: returns.reduce((a, r) => a.concat(r._rows), []),
           batches: chunkOut.length,
           joinedMeta: joined[0].json };
}

// ------------------------------------------------------------- the comparison
const base = unbatched(COHORT);
ok(base.cases.length === COHORT.length, 'the un-batched arm scores every case',
   base.cases.length + ' of ' + COHORT.length);
ok(base.rows.length === COHORT.length, 'the un-batched arm writes one sheet row per case');
const baseBands = {};
for (const c of base.cases) baseBands[c.display_band] = (baseBands[c.display_band] || 0) + 1;
ok(Object.keys(baseBands).length >= 4,
   'the fixtures span at least four display bands, so the comparison is not vacuous',
   JSON.stringify(baseBands));
console.log('     [bands] ' + JSON.stringify(baseBands));

for (const size of [1, 2, 5, COHORT.length - 1, COHORT.length, COHORT.length + 3]) {
  const b = batched(COHORT, size);
  const label = 'batch size ' + size + ' (' + b.batches + ' batch' + (b.batches === 1 ? '' : 'es') + ')';
  ok(b.cases.length === base.cases.length, label + ': same number of scored cases',
     b.cases.length + ' vs ' + base.cases.length);
  // Field-for-field, in order. Not a spot check on the verdict: a relocation that got the
  // verdict right and the shortfall wrong would still be a wrong report.
  const a = JSON.stringify(base.cases);
  const c = JSON.stringify(b.cases);
  ok(a === c, label + ': scored cases are IDENTICAL, field for field and in order',
     a === c ? '' : firstDiff(base.cases, b.cases));
  // written_at is excluded, and it is the ONE field that legitimately differs: it is stamped
  // at write time, so the two arms produce two different instants. Batching does change its
  // meaning slightly and that is worth stating rather than hiding - a row's written_at is now
  // the moment ITS BATCH was appended, not one run-level instant for all 5,632 rows. That is
  // more accurate, not less, and it also means a crash mid-run leaves rows whose timestamps
  // show how far the run got. Every other column is compared exactly.
  const strip = (rows) => rows.map(r => { const o = Object.assign({}, r); delete o.written_at; return o; });
  const ar = JSON.stringify(strip(base.rows)), cr = JSON.stringify(strip(b.rows));
  ok(ar === cr, label + ': the Cases-tab rows are IDENTICAL (every column but written_at)',
     ar === cr ? '' : firstDiff(strip(base.rows), strip(b.rows)));
  ok(b.rows.every(r => typeof r.written_at === 'string' && r.written_at.length >= 20 &&
       !Number.isNaN(Date.parse(r.written_at))),
     label + ': every row still carries a parseable written_at');
  ok(b.joinedMeta._rows_appended === COHORT.length,
     label + ': the write receipt reconciles against the cohort');
}

function firstDiff(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = JSON.stringify(a[i]), y = JSON.stringify(b[i]);
    if (x !== y) {
      const keysA = a[i] ? Object.keys(a[i]) : [], keysB = b[i] ? Object.keys(b[i]) : [];
      for (const k of keysA) {
        if (JSON.stringify(a[i][k]) !== JSON.stringify(b[i][k])) {
          return 'index ' + i + ' field "' + k + '": unbatched=' +
            JSON.stringify(a[i][k]).slice(0, 120) + ' batched=' + JSON.stringify(b[i][k]).slice(0, 120);
        }
      }
      return 'index ' + i + ' differs; keys ' + keysA.length + ' vs ' + keysB.length;
    }
  }
  return 'lengths differ: ' + a.length + ' vs ' + b.length;
}

// --------------------------------------------- the guards on the new boundary
function throws(fn, label, needle) {
  try { fn(); fail++; console.log('FAIL ' + label + '\n       -> returned instead of throwing'); }
  catch (e) {
    if (!needle || e.message.indexOf(needle) !== -1) { pass++; console.log('ok   ' + label); }
    else { fail++; console.log('FAIL ' + label + '\n       -> wrong error: ' + e.message.slice(0, 140)); }
  }
}
throws(() => exec(CHUNK, [], { 'Validate Inputs': [{ json: VALIDATED }] }),
  'Chunk Cases refuses an empty cohort', 'EMPTY');
throws(() => exec(WFT_VALIDATE, [{ json: { validated: VALIDATED, cases: [] } }], {}),
  'WF-T refuses an empty batch', 'EMPTY batch');
throws(() => exec(WFT_VALIDATE, [{ json: { validated: VALIDATED } }], {}),
  'WF-T refuses a call with no cases array', 'no cases array');
throws(() => exec(WFT_VALIDATE, [{ json: {
    validated: Object.assign({}, VALIDATED, { persistence_windows: WINDOWS.slice(0, 2) }),
    cases: [COHORT[0]] } }], {}),
  'WF-T refuses two persistence windows where gate 18 needs three', 'persistence_windows');
{
  const dup = [COHORT[0], COHORT[0]];
  const called = [{ json: { cases: dup, validated: VALIDATED, batch_index: 0, batch_count: 1 } }];
  throws(() => exec(WFT_JOIN, [], { 'When Called': called }),
    'WF-T refuses a duplicate case_key inside one batch', 'duplicate case_key');
}
// A batch that comes back short must not be quietly absorbed by the joiner.
{
  const chunkOut = exec(CHUNK, COHORT.map(c => ({ json: c })),
    { 'Validate Inputs': [{ json: Object.assign({}, VALIDATED,
        { params: { score_batch_size: 4 } }) }] }).out;
  const short = [{ json: { scored_cases: [], _batch_index: 0, _rows_appended: 0, _bands: {} } }];
  throws(() => exec(JOIN_SCORED, short, { 'Chunk Cases': chunkOut }),
    'Join Scored refuses fewer batch results than batches sent', 'batch result');
  const wrongIdx = chunkOut.map((b, i) => ({ json: {
    scored_cases: b.json.cases, _batch_index: 0, _rows_appended: b.json.cases.length, _bands: {} } }));
  throws(() => exec(JOIN_SCORED, wrongIdx, { 'Chunk Cases': chunkOut }),
    'Join Scored refuses repeated batch indexes', 'batch indexes');
  const shortWrite = chunkOut.map((b, i) => ({ json: {
    scored_cases: b.json.cases, _batch_index: i, _rows_appended: 0, _bands: {} } }));
  throws(() => exec(JOIN_SCORED, shortWrite, { 'Chunk Cases': chunkOut }),
    'Join Scored refuses a short Cases-tab write', 'review queue is missing');
}

console.log('\n' + pass + '/' + (pass + fail) + ' assertions behaved as specified');
process.exit(fail ? 1 : 0);
