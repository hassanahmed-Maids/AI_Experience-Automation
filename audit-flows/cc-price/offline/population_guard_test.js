// Population Guard (CC Price Stage 1) with its embedded breaker, run in place.
//
// A byte-compare against the canonical block proves the block was not EDITED. It does not prove
// the block RUNS: the surrounding node has to define `responses` and `ERP_BREAKER_PHASE`, the
// guard has to find its stamp on $('Build Page List'), and - the part that is easy to get wrong
// and impossible to see - the breaker has to execute BEFORE the shape check below it, because
// that check throws on the very same pages the breaker is meant to describe. Get the order
// wrong and the breaker is present, byte-identical, and never speaks.
//
// So this file runs the real node body against the response shapes ERP actually returns.
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'population_guard.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}

const SIZE = 500;
const TOTAL = 5420;                      // 11 data pages (10 x 500 + 420) + 1 probe = 12 items
const FULL_PAGES = Math.ceil(TOTAL / SIZE);

function okPage(i) {
  const rows = [];
  const n = i < FULL_PAGES - 1 ? SIZE : (i === FULL_PAGES - 1 ? TOTAL - SIZE * (FULL_PAGES - 1) : 0);
  for (let k = 0; k < n; k++) {
    rows.push({ contractId: i * SIZE + k, clientId: 9000 + k, maidNationality: 'Filipina',
                maidLiveOut: false, startDate: '2020-01-01', scheduledDateOfTermination: '' });
  }
  return { body: rows, statusCode: 200 };
}
// The Spring shape ERP actually returns, arriving as a normal item because the HTTP node is set
// to continueRegularOutput - which is exactly why it must be, or these never reach this node.
function serverErrorPage() {
  return { error: { message: '503 - {"timestamp":"2026-08-22 10:00:00","status":503,'
    + '"error":"Service Unavailable","path":"/admin/dynamicApi/evaluateApi"}' } };
}
function authPage() {
  return { error: { message: '500 - {"status":498,"error":"Internal Server Error",'
    + '"message":"Access Token is missing or malformed <LOGOUT>"}' } };
}

function run(pages, opts) {
  const o = opts || {};
  const params = { run_id: o.runId || 'test-run', population:
    { abort_below: 4600, warn_below: 4900, max_divergence_pct: 1, warn_only: false } };
  const nodes = {
    'Parse + Assert Card': [{ json: { params: params, price_card: { checksum_ok: true } } }],
    'Get Independent Count': [{ json: { total: TOTAL } }],
    'Build Page List': [{ json: { run_id: params.run_id, erp_t0: Date.now() - 30000 } }]
  };
  const $ = (n) => {
    if (!(n in nodes)) throw new Error('unexpected $(' + n + ')');
    return { all: () => nodes[n], first: () => nodes[n][0] };
  };
  const items = pages.map(p => ({ json: p }));
  const logs = [];
  const statics = o.statics === undefined ? {} : o.statics;
  const out = new Function('$input', '$', 'console', '$getWorkflowStaticData', SRC)(
    { all: () => items, first: () => items[0] }, $, { log: m => logs.push(m) },
    // A canvas run has no static data at all: the call THROWS rather than returning null, which
    // is what erpBreakerStatic catches. Returning null here would have the guard see {} and
    // report the check as available - the fixture proving the opposite of what it claims.
    () => { if (statics === null) throw new Error('not available'); return statics; });
  return { json: (out || [])[0] ? out[0].json : null,
           logs: logs.map(x => { try { return JSON.parse(x); } catch (e) { return {}; } }) };
}
function throwsWith(fn, label, ...needles) {
  try { fn(); fail++; console.log('FAIL ' + label + '\n       -> did not throw'); }
  catch (e) {
    const miss = needles.filter(n => e.message.indexOf(String(n)) === -1);
    if (miss.length) { fail++; console.log('FAIL ' + label + '\n       -> message lacked: ' +
      miss.join(', ') + '\n       -> got: ' + e.message.slice(0, 260)); }
    else { pass++; console.log('ok   ' + label); }
  }
}

console.log('--- a healthy sweep is untouched ---');
{
  const pages = [];
  for (let i = 0; i <= FULL_PAGES; i++) pages.push(okPage(i));
  const r = run(pages);
  ok(r.json && r.json.population.count === TOTAL,
     'twelve good pages pass the breaker and reconcile to the independent count',
     r.json && String(r.json.population.count));
  const b = r.logs.filter(l => l.stage === 'erp_breaker')[0];
  ok(b && b.tripped === null && b.counts.ok === FULL_PAGES + 1,
     'and the breaker logs a clean verdict over every page', JSON.stringify(b && b.counts));
}

console.log('\n--- five consecutive server errors ---');
{
  const pages = [];
  for (let i = 0; i <= FULL_PAGES; i++) pages.push(i >= 2 && i <= 6 ? serverErrorPage() : okPage(i));
  // THE ORDERING ASSERTION. These pages fail the shape check too - they are not arrays - so if
  // the breaker ran after it, the run would die reporting a missing grant while ERP was on fire.
  throwsWith(() => run(pages),
    'the BREAKER speaks first, not the shape check',
    'ERP CIRCUIT BREAKER TRIPPED', '5 consecutive', 'Population Guard (CC Price Stage 1)');
  let msg = '';
  try { run(pages); } catch (e) { msg = e.message; }
  ok(msg.indexOf('POPULATION SHAPE UNEXPECTED') === -1,
     'and the misleading "the account lacks the grant" diagnosis never surfaces');
  ok(msg.indexOf('DO NOT re-fire') !== -1 && msg.indexOf('DO NOT raise the thresholds') !== -1,
     'the message carries the two things not to do');
}

console.log('\n--- a dead token is NOT degradation ---');
// Every page answers 498. If auth counted as degradation this would trip on page five and
// report ERP as failing, sending someone to check a healthy server.
{
  const pages = [];
  for (let i = 0; i <= FULL_PAGES; i++) pages.push(authPage());
  throwsWith(() => run(pages),
    'twelve auth failures do NOT trip the breaker - the shape check stops the run instead',
    'POPULATION SHAPE UNEXPECTED');
  let msg = '';
  try { run(pages); } catch (e) { msg = e.message; }
  ok(msg.indexOf('CIRCUIT BREAKER') === -1,
     'and ERP is not blamed for a token problem');
}

console.log('\n--- under the threshold ---');
{
  const pages = [];
  for (let i = 0; i <= FULL_PAGES; i++) pages.push(i >= 3 && i <= 6 ? serverErrorPage() : okPage(i));
  throwsWith(() => run(pages),
    'four consecutive failures are below the limit, so the shape check refuses instead',
    'POPULATION SHAPE UNEXPECTED');
}

console.log('\n--- what this batch size CANNOT do, pinned so nobody assumes otherwise ---');
{
  // Three of twelve is 25%, which would trip the rate rule if the rule applied. It does not:
  // twelve responses never reach rateMinSamples (20). Pinned because "a quarter of the batch
  // failed and nothing happened" looks like a bug unless the reason is written down.
  const pages = [];
  for (let i = 0; i <= FULL_PAGES; i++) pages.push(i === 1 || i === 4 || i === 8 ? serverErrorPage() : okPage(i));
  let msg = '';
  try { run(pages); } catch (e) { msg = e.message; }
  ok(msg.indexOf('CIRCUIT BREAKER') === -1 && msg.indexOf('POPULATION SHAPE UNEXPECTED') !== -1,
     'scattered failures do not trip the rate rule - 12 responses never reach its 20-sample floor');

  const pages2 = [];
  for (let i = 0; i <= FULL_PAGES; i++) pages2.push(okPage(i));
  const r = run(pages2, { statics: {} });
  const b = r.logs.filter(l => l.stage === 'erp_breaker')[0];
  ok(b && b.baseline_carried === false,
     'and no latency baseline is ever carried - a 12-call sweep is far under the 200-call floor',
     JSON.stringify(b && b.baseline_ms_per_call));
  const set = r.logs.filter(l => l.stage === 'erp_breaker_baseline_set');
  ok(set.length === 0, 'nor does this sweep set one for anybody else');
}

console.log('\n--- the guard survives a canvas run, where static data is absent ---');
{
  const pages = [];
  for (let i = 0; i <= FULL_PAGES; i++) pages.push(okPage(i));
  const r = run(pages, { statics: null });
  ok(r.json && r.json.population.count === TOTAL,
     'a manual execution with no static data still completes rather than throwing');
  const b = r.logs.filter(l => l.stage === 'erp_breaker')[0];
  ok(b && b.static_data_available === false, 'and says so, rather than reporting a check it did not make');
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' + (pass + fail) : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
