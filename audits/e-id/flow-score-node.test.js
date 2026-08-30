// End-to-end bench for the DEPLOYED scorer (n8n node "Score Cases",
// workflow ABNaSxxRV6vzQTNi), exercised through the same shape the flow feeds it.
//
// Two jobs:
//   1. prove the in-flow logic reproduces the standalone scorer's verdicts;
//   2. prove the DEGRADED path never clears anything.
// Run: node audits/e-id/flow-score-node.test.js

'use strict';
const { scoreNode, REFERENCE } = require('./flow-score-node.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          want ' + JSON.stringify(want) + '\n          got  ' + JSON.stringify(got)));
}
function run(rows, opts) {
  return scoreNode(Object.assign({}, REFERENCE, { rows: rows }, opts || { identityAvailable: true }));
}
function verdictOf(res, key) {
  const c = res.cases.filter(function (x) { return x.case_key === key; })[0];
  return c ? c.verdict : '(no case)';
}

// ---------------------------------------------------------------------------
console.log('\nIDENTITY AVAILABLE — the six spec cases, through the flow shape');
// ---------------------------------------------------------------------------
{
  const rows = [
    // maid 21014: two x 353.91 same day, head 1719 -> RENEW/MV. Finding.
    { id: 1763388, expenseId: 1719, date: '2026-02-24', amount: 353.91, maidId: '21014' },
    { id: 1763389, expenseId: 1719, date: '2026-02-24', amount: 353.91, maidId: '21014' },
    // maid 28099: one 353.91, nothing else. Clean.
    { id: 1770515, expenseId: 1719, date: '2026-02-28', amount: 353.91, maidId: '28099' },
    // maid 88623: 454.62 replacement, head 748. To the verifier.
    { id: 1489422, expenseId: 748,  date: '2025-09-20', amount: 454.62, maidId: '88623' },
    // maid 67236: 454.62 replacement, head 1682. To the verifier.
    { id: 1764251, expenseId: 1682, date: '2026-02-25', amount: 454.62, maidId: '67236' },
    // maid 122251: 353.91 then two x 84.00. Duplicate-SHAPED, must not be a duplicate.
    { id: 1708354, expenseId: 1682, date: '2026-01-29', amount: 353.91, maidId: '122251' },
    { id: 1711755, expenseId: 1682, date: '2026-01-31', amount: 84.00,  maidId: '122251' },
    { id: 1711756, expenseId: 1682, date: '2026-01-31', amount: 84.00,  maidId: '122251' },
    // maid 105395: 353.91 then 454.62 four days apart. THE FALSE-POSITIVE TRAP.
    { id: 1487393, expenseId: 738,  date: '2025-09-18', amount: 353.91, maidId: '105395' },
    { id: 1490563, expenseId: 738,  date: '2025-09-22', amount: 454.62, maidId: '105395' }
  ];
  const res = run(rows);
  check('21014  duplicate application -> finding', verdictOf(res, '21014|RENEW|MV'), 'finding');
  check('28099  one card one price   -> clean',    verdictOf(res, '28099|RENEW|MV'), 'clean');
  check('88623  replacement          -> verifier', verdictOf(res, '88623|RENEW|MV'), 'route to verifier');
  check('67236  replacement          -> verifier', verdictOf(res, '67236|NEW|MV'),   'route to verifier');
  check('122251 unidentified 84.00   -> pending',  verdictOf(res, '122251|NEW|MV'),  'pending');
  check('105395 app + replacement    -> verifier', verdictOf(res, '105395|NEW|MV'),  'route to verifier');

  const c122 = res.cases.filter(function (x) { return x.case_key === '122251|NEW|MV'; })[0];
  check('122251 never fires the duplicate gate', c122.rules_fired.split(',').indexOf('50'), -1);
  check('122251 is never called clean',          c122.rules_fired.split(',').indexOf('120'), -1);
  const c105 = res.cases.filter(function (x) { return x.case_key === '105395|NEW|MV'; })[0];
  check('105395 never fires the duplicate gate', c105.rules_fired.split(',').indexOf('50'), -1);
  check('105395 gap is 4 days',                  c105.gap_days, '4');

  check('tally: exactly one finding',   res.findings, 1);
  check('tally: exactly one clean',     res.clean, 1);
  check('tally: three to the verifier', res.route_to_verifier, 3);
  check('no row is lost',               res.cases.reduce(function (s, c) { return s + c.txn_count; }, 0), rows.length);
}

// ---------------------------------------------------------------------------
console.log('\nRENAME-PAIR COLLAPSE through the flow shape');
// ---------------------------------------------------------------------------
{
  const res = run([
    { id: 1, expenseId: 646,  date: '2025-10-05', amount: 353.91, maidId: '105241' },
    { id: 2, expenseId: 1594, date: '2026-02-19', amount: 353.91, maidId: '105241' }
  ]);
  check('646 + 1594 are ONE case',                    res.cases.length, 1);
  check('a duplicate spanning the rename is a finding', res.cases[0].verdict, 'finding');
}

// ---------------------------------------------------------------------------
console.log('\nDEGRADED PATH — identity unavailable (the live state today)');
// ---------------------------------------------------------------------------
{
  // Exactly the rows the sweep produces when the detail route is refused:
  // real amounts and heads, no maid id anywhere.
  const rows = [
    { id: 1763388, expenseId: 1719, date: '2026-02-24', amount: 353.91, maidId: null },
    { id: 1763389, expenseId: 1719, date: '2026-02-24', amount: 353.91, maidId: null },
    { id: 1770515, expenseId: 1719, date: '2026-02-28', amount: 353.91, maidId: null },
    { id: 1489422, expenseId: 748,  date: '2025-09-20', amount: 454.62, maidId: null },
    { id: 1708354, expenseId: 1682, date: '2026-01-29', amount: 353.91, maidId: null }
  ];
  const res = run(rows, { identityAvailable: false, identityDenial: 'INSUFFICIENT_PERMISSIONS' });

  check('every row parks as its own case',   res.cases_total, rows.length);
  check('every row counted unidentified',    res.unidentified_rows, rows.length);
  check('NOTHING is cleared',                res.clean, 0);
  check('NOTHING is called a finding',       res.findings, 0);
  check('nothing reaches a verifier',        res.route_to_verifier, 0);
  check('everything is pending',             res.pending, rows.length);
  check('every case fires gate 20 only',     Array.from(new Set(res.cases.map(function (c) { return c.rules_fired; }))), ['20']);
  check('the denial is named on the case',   /INSUFFICIENT_PERMISSIONS/.test(res.cases[0].reasons), true);
  check('no maid id is invented',            Array.from(new Set(res.cases.map(function (c) { return c.maid_id; }))), ['']);

  // THE safety property of this whole build. The two 353.91 rows on 2026-02-24
  // are a real duplicate; with no identity the flow must NOT claim to have
  // found it, and must NOT clear it either.
  const dup = res.cases.filter(function (c) { return c.transaction_ids === '1763388' || c.transaction_ids === '1763389'; });
  check('the real duplicate is neither found nor cleared',
        Array.from(new Set(dup.map(function (c) { return c.verdict; }))), ['pending']);
}

// ---------------------------------------------------------------------------
console.log('\nDEGRADED PATH — a partial identity budget must not clear the rest');
// ---------------------------------------------------------------------------
{
  // Enrichment ran out of call budget: the first maid resolved, the rest did not.
  const res = run([
    { id: 10, expenseId: 1682, date: '2026-02-01', amount: 353.91, maidId: '900100' },
    { id: 11, expenseId: 1682, date: '2026-02-02', amount: 353.91, maidId: null },
    { id: 12, expenseId: 1682, date: '2026-02-03', amount: 353.91, maidId: null }
  ], { identityAvailable: true });
  check('the resolved maid is scored',        verdictOf(res, '900100|NEW|MV'), 'clean');
  check('the unresolved rows still park',     res.unidentified_rows, 2);
  check('unresolved rows are not cleared',    res.cases.filter(function (c) { return c.maid_id === '' && c.verdict !== 'pending'; }).length, 0);
}

// ---------------------------------------------------------------------------
console.log('\nOUT-OF-SCOPE HEADS through the flow shape');
// ---------------------------------------------------------------------------
{
  const res = run([
    { id: 20, expenseId: 1771, date: '2026-02-10', amount: 353.91, maidId: '900200' }, // office staff
    { id: 21, expenseId: 1492, date: '2026-02-10', amount: 353.91, maidId: '900201' }  // family visa
  ]);
  check('out-of-scope heads make no case',    res.cases_total, 0);
  check('out-of-scope heads are bucketed',    res.unclassified_heads, 2);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
