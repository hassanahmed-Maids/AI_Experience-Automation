// Offline test bench for the E-ID deterministic scorer.
// Every spec test case, plus a guard for each edge the ERP Variables rows name.
// Run: node audits/e-id/scorer.test.js

'use strict';
const { score, bandOf } = require('./scorer.js');

const WINDOW = { windowFrom: '2025-09-01', windowTo: '2026-02-28' };
let pass = 0, fail = 0;
const failures = [];

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; failures.push({ name, want, got }); }
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          want ' + JSON.stringify(want) + '\n          got  ' + JSON.stringify(got)));
}

function caseFor(rows, maidId, opts) {
  const r = score(rows, opts || WINDOW);
  return r.cases.filter(function (c) { return c.maidId === String(maidId); });
}

// ---------------------------------------------------------------------------
// The five named spec cases plus the sixth false-positive trap.
// Heads marked ASSUMED are not stated on the spec page and must be confirmed
// by the live detail call in Phase 2. Every other field is an ERP read.
// ---------------------------------------------------------------------------
console.log('\nSPEC TEST CASES');

// (1) Maid 21014 -- two x 353.91 the same day, consecutive ids, head 1719. Finding.
{
  const rows = [
    { transactionId: 1763388, expenseId: 1719, date: '2026-02-24', amount: 353.91, maidId: 21014 },
    { transactionId: 1763389, expenseId: 1719, date: '2026-02-24', amount: 353.91, maidId: 21014 },
  ];
  const c = caseFor(rows, 21014)[0];
  check('21014 duplicate application -> finding', c.verdict, 'finding');
  check('21014 fires Order 50', c.rulesFired.indexOf(50) !== -1, true);
  check('21014 gap is 0 days', c.gapDays, [0]);
}

// (2) Maid 28099 -- one 353.91, nothing else. The 97.4% case, no verifier.
{
  const rows = [{ transactionId: 1770515, expenseId: 1719, date: '2026-02-28', amount: 353.91, maidId: 28099 }];
  const c = caseFor(rows, 28099)[0];
  check('28099 single standard fee -> clean', c.verdict, 'clean');
  check('28099 settled by Order 120', c.rulesFired, [120]);
  check('28099 never reaches a verifier', c.needsVerifier, false);
}

// (3) Maid 88623 -- 454.62 replacement, head 748. Deterministic layer routes it out.
{
  const rows = [{ transactionId: 1489422, expenseId: 748, date: '2025-09-20', amount: 454.62, maidId: 88623 }];
  const c = caseFor(rows, 88623)[0];
  check('88623 replacement -> route to verifier', c.verdict, 'route to verifier');
  check('88623 fires Order 70', c.rulesFired, [70]);
}

// (4) Maid 67236 -- 454.62 replacement, head 1682. Same deterministic route.
{
  const rows = [{ transactionId: 1764251, expenseId: 1682, date: '2026-02-25', amount: 454.62, maidId: 67236 }];
  const c = caseFor(rows, 67236)[0];
  check('67236 replacement -> route to verifier', c.verdict, 'route to verifier');
}

// (5) Maid 122251 -- 353.91 then two x 84.00 the same day. Duplicate-SHAPED and
//     must NOT be called a duplicate. Parks at Order 90.
{
  const rows = [
    { transactionId: 1708354, expenseId: 1682, date: '2026-01-29', amount: 353.91, maidId: 122251 }, // head ASSUMED
    { transactionId: 1711755, expenseId: 1682, date: '2026-01-31', amount: 84.00,  maidId: 122251 }, // head ASSUMED
    { transactionId: 1711756, expenseId: 1682, date: '2026-01-31', amount: 84.00,  maidId: 122251 }, // head ASSUMED
  ];
  const c = caseFor(rows, 122251)[0];
  check('122251 -> pending, not a finding', c.verdict, 'pending');
  check('122251 parks at Order 90', c.rulesFired.indexOf(90) !== -1, true);
  check('122251 never fires the duplicate gate', c.rulesFired.indexOf(50), -1);
  check('122251 is not called clean', c.rulesFired.indexOf(120), -1);
}

// (6) Maid 105395 -- 353.91 then 454.62 four days apart. THE FALSE-POSITIVE TRAP:
//     looks exactly like a duplicate, is a replacement case.
{
  const rows = [
    { transactionId: 1487393, expenseId: 738, date: '2025-09-18', amount: 353.91, maidId: 105395 }, // head ASSUMED
    { transactionId: 1490563, expenseId: 738, date: '2025-09-22', amount: 454.62, maidId: 105395 }, // head ASSUMED
  ];
  const c = caseFor(rows, 105395)[0];
  check('105395 -> route to verifier, NOT a duplicate', c.verdict, 'route to verifier');
  check('105395 never fires the duplicate gate', c.rulesFired.indexOf(50), -1);
  check('105395 classified a replacement case (Order 60)', c.isReplacementCase, true);
  check('105395 gap is 4 days', c.gapDays, [4]);
}

// ---------------------------------------------------------------------------
// Guards for the edges the ERP Variables rows name explicitly.
// ---------------------------------------------------------------------------
console.log('\nEDGE GUARDS');

// Era boundary. The bug this catches misclassified 100% of any pre-Aug-2025 month.
check('354.55 on 2025-03-01 is STANDARD (era 1)', bandOf(354.55, '2025-03-01'), 'STANDARD');
check('353.91 on 2025-03-01 is NOT standard (era 1)', bandOf(353.91, '2025-03-01'), 'OFF_PRICE');
check('353.91 on 2026-02-24 is STANDARD (era 2)', bandOf(353.91, '2026-02-24'), 'STANDARD');
check('354.55 on 2026-02-24 is NOT standard (era 2)', bandOf(354.55, '2026-02-24'), 'OFF_PRICE');
check('454.55 on 2025-03-01 is REPLACEMENT (era 1)', bandOf(454.55, '2025-03-01'), 'REPLACEMENT');
check('454.62 on 2026-02-25 is REPLACEMENT (era 2)', bandOf(454.62, '2026-02-25'), 'REPLACEMENT');

// The 84.00 charge ENDED. Outside its window it is not that band.
check('84.00 inside its window is UNIDENTIFIED_84', bandOf(84.00, '2026-03-01'), 'UNIDENTIFIED_84');
check('84.00 after 2026-05-02 is OFF_PRICE', bandOf(84.00, '2026-06-01'), 'OFF_PRICE');

// The two short-lived 2026 bands, named so 1,022 rows route deliberately.
check('382.10 is SHORT_LIVED_2026', bandOf(382.10, '2026-05-20'), 'SHORT_LIVED_2026');
check('442.11 is SHORT_LIVED_2026', bandOf(442.11, '2026-06-01'), 'SHORT_LIVED_2026');

// Zero and null must never look settled.
check('null amount bands OFF_PRICE, never zero', bandOf(null, '2026-02-24'), 'OFF_PRICE');
check('zero amount bands OFF_PRICE', bandOf(0, '2026-02-24'), 'OFF_PRICE');
{
  const rows = [{ transactionId: 1, expenseId: 1682, date: '2026-02-24', amount: null, maidId: 900001 }];
  const c = caseFor(rows, 900001)[0];
  check('null amount -> pending at Order 100, never clean', [c.verdict, c.rulesFired], ['pending', [100]]);
}
{
  const rows = [{ transactionId: 2, expenseId: 1682, date: '2026-02-24', amount: 0, maidId: 900002 }];
  const c = caseFor(rows, 900002)[0];
  check('zero amount -> pending at Order 100 (before 110)', [c.verdict, c.rulesFired], ['pending', [100]]);
}

// Negatives park and are never netted against a positive.
{
  const rows = [
    { transactionId: 3, expenseId: 1682, date: '2026-02-20', amount: 353.91,  maidId: 900003 },
    { transactionId: 4, expenseId: 1682, date: '2026-02-21', amount: -353.91, maidId: 900003 },
  ];
  const c = caseFor(rows, 900003)[0];
  check('a negative parks and is not netted', c.verdict, 'pending');
  check('the positive is not cleared by the reversal', c.rulesFired.indexOf(120), -1);
}

// Fine candidate.
{
  const rows = [{ transactionId: 5, expenseId: 1682, date: '2026-02-24', amount: 500.00, maidId: 900004 }];
  const c = caseFor(rows, 900004)[0];
  check('above 454.72 -> pending Fine candidate (Order 80)', [c.verdict, c.rulesFired], ['pending', [80]]);
}

// THE RENAME-PAIR COLLAPSE. Keying on the raw head finds 3 of 5 duplicates and
// falsely clears the other 2 -- a false clearance on 40% of the finding population.
{
  // Spec: maid 105241, three payments on 646/646/1594, gaps 62 and 75 days.
  // All three sit in era 2, so all three are 353.91 -- see the era guard above.
  const rows = [
    { transactionId: 6, expenseId: 646,  date: '2025-10-05', amount: 353.91, maidId: 105241 },
    { transactionId: 7, expenseId: 646,  date: '2025-12-06', amount: 353.91, maidId: 105241 },
    { transactionId: 8, expenseId: 1594, date: '2026-02-19', amount: 353.91, maidId: 105241 },
  ];
  const c = caseFor(rows, 105241);
  check('646 + 1594 collapse to ONE case', c.length, 1);
  check('a duplicate spanning the rename is still a finding', c[0].verdict, 'finding');
  check('105241 gaps are 62 and 75 days', c[0].gapDays, [62, 75]);
}
{
  // Spec: maid 109320, 738 then 1682, gap 104 days.
  const rows = [
    { transactionId: 9,  expenseId: 738,  date: '2025-10-05', amount: 353.91, maidId: 109320 },
    { transactionId: 10, expenseId: 1682, date: '2026-01-17', amount: 353.91, maidId: 109320 },
  ];
  const c = caseFor(rows, 109320);
  check('738 + 1682 collapse to ONE case', c.length, 1);
  check('MV duplicate spanning the rename is a finding', c[0].verdict, 'finding');
  check('109320 gap is 104 days', c[0].gapDays, [104]);
}
{
  // The counterfactual: key on the RAW head and both cases above split in two,
  // each with a single standard fee, and both clear. This is the 40% false
  // clearance the rename-pair collapse exists to prevent.
  const rawKey = function (rows) {
    const seen = {};
    rows.forEach(function (r) { seen[r.maidId + '|' + r.expenseId] = (seen[r.maidId + '|' + r.expenseId] || 0) + 1; });
    return Object.keys(seen).filter(function (k) { return seen[k] > 1; }).length;
  };
  check('raw-head keying would find no duplicate for 109320', rawKey([
    { maidId: 109320, expenseId: 738 }, { maidId: 109320, expenseId: 1682 },
  ]), 0);
}

// ...but NEW and RENEW must stay apart: one application and one renewal years
// apart are two legitimate payments, not a duplicate.
{
  const rows = [
    { transactionId: 30, expenseId: 1682, date: '2026-01-10', amount: 353.91, maidId: 900005 },
    { transactionId: 31, expenseId: 1719, date: '2026-02-10', amount: 353.91, maidId: 900005 },
  ];
  const c = caseFor(rows, 900005);
  check('NEW and RENEW stay two cases', c.length, 2);
  check('neither is a finding', c.map(function (x) { return x.verdict; }), ['clean', 'clean']);
}

// CC and MV must stay apart too -- they decide the payer.
{
  const rows = [
    { transactionId: 12, expenseId: 1594, date: '2026-01-10', amount: 353.91, maidId: 900006 },
    { transactionId: 13, expenseId: 1682, date: '2026-02-10', amount: 353.91, maidId: 900006 },
  ];
  check('CC and MV stay two cases', caseFor(rows, 900006).length, 2);
}

// Out-of-scope heads are bucketed with their id, never silently dropped.
{
  const r = score([{ transactionId: 14, expenseId: 1771, date: '2026-02-10', amount: 353.91, maidId: 900007 }], WINDOW);
  check('office-staff head is not in the population', r.cases.length, 0);
  check('office-staff head is bucketed, not dropped', r.unclassifiedHeads.length, 1);
}

// A row with no maid id parks; the description name is never used.
{
  const r = score([{ transactionId: 15, expenseId: 1682, date: '2026-02-10', amount: 353.91, maidId: null }], WINDOW);
  check('no maid id -> unidentified bucket', r.unidentifiedRows.length, 1);
  check('no maid id never becomes a case', r.cases.length, 0);
}

// A row with no usable date aborts rather than being guessed into a period.
{
  let threw = false;
  try { score([{ transactionId: 16, expenseId: 1682, date: null, amount: 353.91, maidId: 900008 }], WINDOW); }
  catch (e) { threw = true; }
  check('a dateless row aborts the run', threw, true);
}

// All-time history: the duplicate rule must see a payment BEFORE the window.
{
  const rows = [
    { transactionId: 17, expenseId: 1682, date: '2025-06-01', amount: 354.55, maidId: 900009 }, // pre-window
    { transactionId: 18, expenseId: 1682, date: '2026-01-15', amount: 353.91, maidId: 900009 }, // in window
  ];
  const c = caseFor(rows, 900009)[0];
  check('all-time history makes the in-window row a duplicate', c.verdict, 'finding');
}
// ...and a case with NO in-window row is not reported at all.
{
  const rows = [
    { transactionId: 19, expenseId: 1682, date: '2025-06-01', amount: 354.55, maidId: 900010 },
    { transactionId: 20, expenseId: 1682, date: '2025-07-01', amount: 354.55, maidId: 900010 },
  ];
  check('an all-out-of-window case is not reported', caseFor(rows, 900010).length, 0);
}

// A later gate must never overwrite an earlier gate's routing decision.
{
  const rows = [
    { transactionId: 21, expenseId: 1682, date: '2026-02-01', amount: 353.91, maidId: 900011 },
    { transactionId: 22, expenseId: 1682, date: '2026-02-02', amount: 353.91, maidId: 900011 },
    { transactionId: 23, expenseId: 1682, date: '2026-02-03', amount: 454.62, maidId: 900011 },
  ];
  const c = caseFor(rows, 900011)[0];
  check('a duplicate is not downgraded by a later replacement row', c.verdict, 'finding');
  check('the replacement row still routes to a verifier', c.transactions.filter(function(t){return t.rule===70;}).length, 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
