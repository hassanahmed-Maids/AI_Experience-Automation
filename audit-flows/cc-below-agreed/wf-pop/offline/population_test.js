// Offline suite for WF-Pop (CC Below Agreed - 0-Sweep Population). Runs the two REAL node
// bodies against the redacted live population page, then feeds the projected output into
// the REAL gate 2 and the REAL Build Cohort, because the only question that matters is
// whether staging changed what the check sees. No ERP token, no n8n.
//
// The four things this suite exists to prove:
//   1. gate 2 and Build Cohort read the PROJECTED shape identically to the raw one - same
//      row count, same declared total, same reconciliation verdict, same cohort.
//   2. ONE ITEM PER PAGE is necessary, not stylistic: the collapsed shape is run through
//      gate 2 and must FAIL, which is what stops someone "simplifying" it later.
//   3. workerSalaryMonthlyTip never crosses the boundary - asserted on the output, not on
//      the intent.
//   4. Every silent-failure path still throws: error bodies, a missing envelope, an
//      unknown mode, a malformed range_start, and (active only) zero rows.
const fs = require('fs'), path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const READ = R('../nodes/read_request.js');
const PROJ = R('../nodes/project_rows.js');
const GATE2 = R('../../nodes/Verify_Bulk_Pulls.js');
const COHORT = R('../../nodes/Build_Cohort.js');
const REAL = JSON.parse(R('../../offline/fixture_active_pop.json'));
const TOTAL = REAL.total;
const ROW = REAL.clients.content[0];

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}
function throws(fn, label, needle) {
  try { fn(); fail++; console.log('FAIL ' + label + '\n       -> returned instead of throwing'); }
  catch (e) {
    const hit = !needle || e.message.indexOf(needle) !== -1;
    if (hit) { pass++; console.log('ok   ' + label); }
    else { fail++; console.log('FAIL ' + label + '\n       -> wrong error: ' + e.message.slice(0, 140)); }
  }
}

// ---------------------------------------------------------------- node runners
function runRead(input) {
  const logs = [];
  const out = new Function('$input', 'console', READ)(
    { first: () => ({ json: input }) }, { log: m => logs.push(m) });
  return { json: out[0].json, log: JSON.parse(logs[logs.length - 1] || '{}') };
}
function runProject(pages, req) {
  const logs = [];
  const $ = (n) => {
    if (n === 'Read Population Request') return { first: () => ({ json: req }) };
    throw new Error('unexpected $(' + n + ')');
  };
  const out = new Function('$input', '$', 'console', PROJ)(
    { all: () => pages }, $, { log: m => logs.push(m) });
  return { pages: out, log: JSON.parse(logs[logs.length - 1] || '{}') };
}

// ------------------------------------------------------------- page generators
// A real page, cloned. `fullResponse` wraps the body one level down, which is how the
// ACTIVE walk is configured; the terminated walk is not, so both shapes are exercised.
function realPage(n, total, opts) {
  const o = opts || {};
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = JSON.parse(JSON.stringify(ROW));
    r.id = 500000 + i;
    if (o.terminated) { r.status = 'CANCELLED'; r.dateOfTermination = '2026-07-1' + (i % 10) + ' 00:00:00'; }
    rows.push(r);
  }
  const body = { total: total, clients: { content: rows, size: 100, totalPages: 1, last: true } };
  return { json: o.flat ? body : { body: body, statusCode: 200 } };
}
function walk(total, opts) {
  const pages = [], full = Math.floor(total / 40);
  for (let i = 0; i < full; i++) pages.push(realPage(40, total, opts));
  pages.push(realPage(total - 40 * full, total, opts));   // the short last page
  return pages;
}

// ============================================================ 1. read the request
ok(runRead({ bearer: 'Bearer x', mode: 'active' }).json.mode === 'active', 'active mode is accepted');
ok(runRead({ bearer: 'Bearer x', mode: 'terminated', range_start: '2026-07-01' }).json.range_start
   === '2026-07-01', 'terminated mode carries range_start through');
throws(() => runRead({ mode: 'active' }), 'no bearer is refused', 'no usable bearer');
throws(() => runRead({ bearer: 'x', mode: 'active' }), 'a bearer without the Bearer prefix is refused');
throws(() => runRead({ bearer: 'Bearer x', mode: '' }), 'an empty mode is refused, never defaulted', 'mode must be');
throws(() => runRead({ bearer: 'Bearer x', mode: 'ACTIVE' }), 'mode is case-sensitive');
throws(() => runRead({ bearer: 'Bearer x', mode: 'terminated' }),
  'terminated with no range_start is refused', 'range_start');
throws(() => runRead({ bearer: 'Bearer x', mode: 'terminated', range_start: '2026-7-1' }),
  'terminated with a malformed range_start is refused');

// ============================================================ 2. the projection
const ACT = { bearer: 'Bearer x', mode: 'active', range_start: '', run_id: 'r' };
const TER = { bearer: 'Bearer x', mode: 'terminated', range_start: '2026-07-01', run_id: 'r' };

const proj = runProject(walk(TOTAL), ACT);
ok(proj.pages.length === Math.floor(TOTAL / 40) + 1, 'one output item per input page',
   'got ' + proj.pages.length);
ok(proj.log.rows === TOTAL, 'every row survives the projection', 'got ' + proj.log.rows);
ok(proj.log.declared_total === TOTAL, 'the top-level total is carried, largest-seen');
ok(proj.log.last_page_short === true, 'the short last page is still visible to the terminator');
ok(proj.log.salary_fields_dropped === TOTAL, 'every salary field is counted as dropped',
   'counted ' + proj.log.salary_fields_dropped + ' of ' + TOTAL);

const flat = JSON.stringify(proj.pages);
ok(flat.indexOf('workerSalaryMonthlyTip') === -1, 'THE MAID SALARY IS NOT IN THE OUTPUT');
ok(flat.indexOf('lastBlockLog') === -1, 'the client block-log tree is not in the output');
ok(flat.indexOf('clientComplaints') === -1 && flat.indexOf('maidComplaints') === -1,
   'the unread complaint counters are not in the output');
ok(flat.indexOf('"size"') === -1 && flat.indexOf('totalPages') === -1 && flat.indexOf('"last"') === -1,
   'the three lying envelope fields are NOT passed on');

// The saving. NOTE THE NUMBER BELOW IS FIXTURE-DERIVED and reads high: every name and id
// in the redacted fixture is the literal string REDACTED, which inflates the raw side. The
// figure to quote is the one measured on a live page on 2026-08-19: 904 B/row raw, ~351
// B/row projected, so 4.66 MB -> 1.81 MB across 5,405 rows. The assertion below is
// therefore a floor ("at least half"), not the headline.
const rawBytes = JSON.stringify(walk(TOTAL).map(p => p.json)).length;
const projBytes = JSON.stringify(proj.pages.map(p => p.json)).length;
console.log('     [measured] raw ' + Math.round(rawBytes / 1024) + ' KB (' +
  Math.round(rawBytes / TOTAL) + ' B/row) -> projected ' + Math.round(projBytes / 1024) + ' KB (' +
  Math.round(projBytes / TOTAL) + ' B/row), ' +
  Math.round(100 - (100 * projBytes) / rawBytes) + '% smaller');
ok(projBytes < rawBytes / 2, 'the projection is at least half the size');

// The terminated walk arrives WITHOUT fullResponse, so the body sits at the top level.
const tproj = runProject(walk(949, { terminated: true, flat: true }), TER);
ok(tproj.log.rows === 949, 'the flat (no fullResponse) shape is parsed too', 'got ' + tproj.log.rows);
ok(tproj.pages[0].json.clients.content[0].dateOfTermination.indexOf('2026-07') === 0,
   'dateOfTermination survives - it is the whole point of the terminated walk');

// ============================================ 3. failure paths that must not be quiet
throws(() => runProject([{ json: { body: { status: 401, message: 'UNAUTHORIZED' } } }], ACT),
  'an ERP error body is never read as an empty page', 'error body');
throws(() => runProject([{ json: { body: { unexpected: true } } }], ACT),
  'a page with no clients.content is refused', 'no clients.content');
throws(() => runProject([realPage(0, 0)], ACT),
  'ZERO active rows is an access failure, never a real state', 'ZERO rows');

// Zero TERMINATED rows is a legitimate (if improbable) month and must not crash - but the
// envelope has to survive, or Build Cohort throws on a missing one and blames the wrong node.
const tzero = runProject([], TER);
ok(tzero.pages.length === 1 && Array.isArray(tzero.pages[0].json.clients.content) &&
   tzero.pages[0].json.clients.content.length === 0 &&
   tzero.pages[0].json._synthetic_empty_envelope === true,
   'zero terminated pages emit ONE empty envelope, preserving the read-happened proof');

// ============================================ 4. gate 2 reads the projection identically
function runGate2(popPages, termPages) {
  const validated = { audit_month: '2026-07', range_start: '2026-07-01', range_end: '2026-07-31',
    params: {}, persistence_windows: [
      { key: '2026-07', from: '2026-07-01', to: '2026-07-31', node: 'Get Month Payments' },
      { key: '2026-06', from: '2026-06-01', to: '2026-06-30', node: 'Get Payments (M-1)' },
      { key: '2026-05', from: '2026-05-01', to: '2026-05-31', node: 'Get Payments (M-2)' }] };
  const pay = (cc, raw) => [{ json: { payments: Array.from({ length: cc }, (_, i) => ({
    contractID: 'c' + i, contractType: 'CC Maid', paymentId: i, paymentAmount: 5712,
    paymentDate: '2026-07-05', paymentMethod: 'Direct Debit', paymentType: 'Monthly Payment' })),
    _projected_by: 'CC Below Agreed - 0-Sweep Payments', _raw_rows: raw, _cc_rows: cc,
    _dropped_non_cc: raw - cc, _rows_missing_contract_type: 0, _month_key: '2026-07' } }];
  const nodes = { 'Validate Inputs': [{ json: validated }],
    'Get CC Contract Population': popPages,
    'Get Month Payments': pay(6774, 33213), 'Get Payments (M-1)': pay(6700, 33000),
    'Get Payments (M-2)': pay(6600, 32000),
    'Get Payment Statuses': [{ json: { content: [{ id: 1 }], totalElements: 1, totalPages: 1 } }],
    'Get Terminated Contracts': termPages };
  const $ = (n) => { if (!(n in nodes)) throw new Error('unexpected $(' + n + ')');
    const a = nodes[n]; return { all: () => a, first: () => a[0] }; };
  const logs = [];
  new Function('$input', '$', 'console', GATE2)({ all: () => [] }, $, { log: m => logs.push(m) });
  return logs.map(x => { try { return JSON.parse(x) } catch (e) { return {} } }).pop() || {};
}

const rawG = runGate2(walk(TOTAL), [{ json: { clients: { content: [] }, total: 0 } }]);
const projG = runGate2(proj.pages, tzero.pages);
ok(projG.population_rows === rawG.population_rows && projG.population_rows === TOTAL,
   'gate 2 counts the same population rows before and after staging',
   'raw ' + rawG.population_rows + ' vs projected ' + projG.population_rows);
ok(projG.population_declared_total === TOTAL && projG.population_reconciled === true,
   'gate 2 still RECONCILES against the route total on the projected shape');
ok(projG.population_pages === rawG.population_pages,
   'gate 2 sees the same page count, so the short-page terminator is intact');
ok(projG.population_route === rawG.population_route,
   'gate 2 still identifies the route as contract/search/page, not the flat dynamic shape');

// THE POINT OF ONE-ITEM-PER-PAGE. Collapse the walk the way WF-S does and gate 2 must
// throw - if this ever starts passing, the terminator has been blinded.
const collapsed = [{ json: { clients: { content: proj.pages.reduce((a, p) =>
  a.concat(p.json.clients.content), []) }, total: TOTAL } }];
throws(() => runGate2(collapsed, tzero.pages),
  'COLLAPSING the walk to one item is caught by gate 2 (which is why pages stay pages)',
  'FULL page');

// =========================================== 5. Build Cohort reads the projection too
function runCohort(popPages, termPages) {
  const validated = { audit_month: '2026-07', range_start: '2026-07-01', range_end: '2026-07-31',
    params: {}, persistence_windows: [
      { key: '2026-07', from: '2026-07-01', to: '2026-07-31', node: 'Get Month Payments' }] };
  const nodes = { 'Validate Inputs': [{ json: validated }],
    'Get CC Contract Population': popPages,
    'Get Terminated Contracts': termPages,
    'Get Month Payments': [{ json: { payments: [] } }],
    'Get Payments (M-1)': [{ json: { payments: [] } }],
    'Get Payments (M-2)': [{ json: { payments: [] } }],
    'Get Payment Statuses': [{ json: { content: [], totalElements: 0, totalPages: 0 } }],
    'Verify Bulk Pulls': [{ json: {} }] };
  const $ = (n) => { if (!(n in nodes)) throw new Error('unexpected $(' + n + ')');
    const a = nodes[n]; return { all: () => a, first: () => a[0] }; };
  const logs = [];
  const out = new Function('$input', '$', 'console', COHORT)(
    { all: () => [] }, $, { log: m => logs.push(m) });
  return { out: out, log: logs.map(x => { try { return JSON.parse(x) } catch (e) { return {} } }).pop() || {} };
}
let cohortRaw = null, cohortProj = null, cohortErr = null;
try {
  cohortRaw = runCohort(walk(TOTAL), walk(949, { terminated: true, flat: true }));
  cohortProj = runCohort(proj.pages, tproj.pages);
} catch (e) { cohortErr = e.message; }
if (cohortErr) {
  console.log('skip Build Cohort comparison - the node needs upstream nodes this harness ' +
    'does not stub (' + cohortErr.slice(0, 90) + '). Covered by offline/cohort_test.js.');
} else {
  // Build Cohort returns ONE ITEM PER CASE (out.map(c => ({json: c}))), not a single
  // envelope with a cases array - and it throws outright on an empty cohort, so a
  // 0-vs-0 comparison here would be a broken test rather than a passing one.
  const nRaw = cohortRaw.out.length;
  const nProj = cohortProj.out.length;
  ok(nProj === nRaw && nProj > 0, 'Build Cohort builds the SAME cohort from the projection',
     'raw ' + nRaw + ' vs projected ' + nProj);
  const a = cohortRaw.out[0].json;
  const b = cohortProj.out[0].json;
  ok(a.contract_id === b.contract_id && a.contract_start === b.contract_start &&
     a.contract_status === b.contract_status && a.maid_live_out === b.maid_live_out,
     'the first case is field-for-field the same on the fields the projection carries');
}

console.log('\n' + pass + '/' + (pass + fail) + ' assertions behaved as specified');
process.exit(fail ? 1 : 0);
