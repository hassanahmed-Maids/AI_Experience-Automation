// Gate 2, payment-sweep block - tested against the STAGED shape (CC-only rows plus a
// declared pre-filter count) and the UNSTAGED one, because both can reach this node and
// they must not be quietly interchangeable.
//
// The point of these cases: staging the sweeps out moved the CC filter UPSTREAM of the
// completeness gate, which is normally how a completeness gate gets blinded. So each case
// asks whether a specific way of losing rows is still caught.
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'Verify_Bulk_Pulls.js'), 'utf8');
const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_active_pop.json'), 'utf8'));
const TOTAL = real.total;

function popPage(n, total) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ id: 'c' + i, startOfContract: '2025-01-01',
    client: { id: '1', name: 'x' }, housemaid: { id: '2', label: 'y' }, status: 'ACTIVE',
    contractProspectType: { code: 'maids.cc_prospect' } });
  return { json: { clients: { content: rows, size: 100, totalPages: 1, last: true }, total: total } };
}
function goodPopulation() {
  const full = Math.ceil(TOTAL / 40), a = [];
  for (let i = 0; i < full - 1; i++) a.push(popPage(40, TOTAL));
  a.push(popPage(TOTAL - 40 * (full - 1), TOTAL));
  return a;
}
// A staged window as WF-P returns it: CC rows only, plus the raw count it filtered from.
function staged(cc, raw, dropped, untyped) {
  const rows = [];
  for (let i = 0; i < cc; i++) rows.push({ contractID: 'c' + i, contractType: 'CC Maid',
    paymentId: i, paymentAmount: 5712, paymentDate: '2026-07-05',
    paymentMethod: 'Direct Debit', paymentType: 'Monthly Payment' });
  return [{ json: { payments: rows, _projected_by: 'CC Below Agreed - 0-Sweep Payments',
    _raw_rows: raw, _cc_rows: cc, _dropped_non_cc: dropped === undefined ? raw - cc : dropped,
    _rows_missing_contract_type: untyped || 0, _month_key: '2026-07' } }];
}
// The unstaged shape: a bare HTTP response, no provenance, MV rows included.
function unstaged(n) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ contractID: 'c' + i, contractType: i % 5 ? 'MV Maid' : 'CC Maid',
    paymentId: i, paymentAmount: 1620, paymentDate: '2026-07-05',
    paymentMethod: 'Card', paymentType: 'Monthly Payment' });
  return [{ json: { payments: rows } }];
}

// Every case states the expectation FIRST, so a flipped outcome is a failure of the test
// rather than something to reinterpret afterwards.
const CASES = [
  { label: 'all three staged and healthy (6,774 CC of 33,213)',
    want: 'pass', m: [staged(60, 300), staged(60, 300), staged(60, 300)],
    check: l => l.payment_sweeps_staged === 3 && l.payment_sweeps_unstaged === 0 &&
                l.payment_rows === 180 && l.payment_raw_rows_per_window['2026-07'] === 300 },
  { label: 'staged, raw below the 10,000-row floor -> truncated pull',
    want: 'block', m: [staged(60, 300), staged(60, 300), staged(20, 90)], floorCase: true },
  { label: 'staged, cc + dropped does not equal raw -> filter lost rows',
    want: 'block', m: [staged(60, 300, 200), staged(60, 300), staged(60, 300)] },
  { label: 'staged, raw healthy but ZERO CC rows -> contractType shape change',
    want: 'block', m: [staged(0, 300, 300), staged(60, 300), staged(60, 300)] },
  { label: 'staged, raw zero -> wrong window or failed call',
    want: 'block', m: [staged(0, 0, 0), staged(60, 300), staged(60, 300)] },
  { label: 'mixed: two staged, one unstaged -> gate 18 would compare unlike months',
    want: 'block', m: [staged(60, 300), staged(60, 300), unstaged(300)] },
  { label: 'all three unstaged and non-empty -> passes on the WEAKER test, and says so',
    want: 'pass', m: [unstaged(300), unstaged(300), unstaged(300)],
    check: l => l.payment_sweeps_staged === 0 && l.payment_sweeps_unstaged === 3 &&
                /NOT reconciled/.test(l.payment_sweep_note) },
  { label: 'unstaged and empty -> zero rows is never a quiet month',
    want: 'block', m: [unstaged(0), unstaged(300), unstaged(300)] }
];

// The floor is 10,000 in production. Testing it at that scale means building 30,000 rows
// three times per case, so the cases above run against a LOWERED floor and the floor case
// is proved separately at the real number - the constant itself is asserted here.
const FLOOR = Number((SRC.match(/const PAYMENT_RAW_FLOOR = (\d+);/) || [])[1]);
if (FLOOR !== 10000) { console.log('FAIL: PAYMENT_RAW_FLOOR is ' + FLOOR + ', expected 10000'); process.exit(1); }
const LOWERED = SRC.replace('const PAYMENT_RAW_FLOOR = 10000;', 'const PAYMENT_RAW_FLOOR = 100;');

let pass = 0, fail = 0;
for (const c of CASES) {
  const r = runWith(c.floorCase ? SRC : LOWERED, c);
  const got = r.ok ? 'pass' : 'block';
  let ok = got === c.want;
  if (ok && c.check) ok = !!c.check(r.log);
  console.log((ok ? 'ok   ' : 'FAIL ') + c.label);
  if (!r.ok) console.log('       -> ' + r.msg.split('.')[0].slice(0, 120));
  else if (c.want === 'block') console.log('       -> passed the gate when it should have blocked');
  ok ? pass++ : fail++;
}
console.log('\n' + pass + '/' + (pass + fail) + ' cases behaved as specified');
process.exit(fail ? 1 : 0);

function runWith(src, c) {
  const validated = { audit_month: '2026-07', range_start: '2026-07-01', range_end: '2026-07-31',
    params: {}, persistence_windows: [
      { key: '2026-07', from: '2026-07-01', to: '2026-07-31', node: 'Get Month Payments' },
      { key: '2026-06', from: '2026-06-01', to: '2026-06-30', node: 'Get Payments (M-1)' },
      { key: '2026-05', from: '2026-05-01', to: '2026-05-31', node: 'Get Payments (M-2)' }] };
  const nodes = { 'Validate Inputs': [{ json: validated }],
    'Get CC Contract Population': goodPopulation(),
    'Get Month Payments': c.m[0], 'Get Payments (M-1)': c.m[1], 'Get Payments (M-2)': c.m[2],
    'Get Payment Statuses': [{ json: { content: [{ id: 1 }], totalElements: 1, totalPages: 1 } }],
    'Get Terminated Contracts': [{ json: { clients: { content: [] }, total: 0 } }] };
  const $ = (n) => { if (!(n in nodes)) throw new Error('unexpected $(' + n + ')');
    const a = nodes[n]; return { all: () => a, first: () => a[0] }; };
  const logs = [];
  try {
    new Function('$input', '$', 'console', src)({ all: () => [] }, $, { log: m => logs.push(m) });
    const l = logs.map(x => { try { return JSON.parse(x) } catch (e) { return {} } }).pop() || {};
    return { ok: true, log: l };
  } catch (e) { return { ok: false, msg: e.message }; }
}
