'use strict';
// Offline tests for the Change of Status scorer.
//
// Every row of the spec's test-case table, plus a guard for each edge the rules
// name. Where the DEGRADED build must deviate from the spec's expected verdict,
// the test asserts the degraded outcome AND records the deviation, so the
// deviation is visible in the test output rather than discovered later.

const S = require('./score.js');

let pass = 0, fail = 0;
const deviations = [];

function check(name, actual, expected) {
  if (actual === expected) { pass++; console.log('  ok   ' + name + '  -> ' + actual); }
  else { fail++; console.log('  FAIL ' + name + '  -> got ' + actual + ', expected ' + expected); }
}
function deviation(caseName, specSays, weSay, why) {
  deviations.push({ case: caseName, spec: specSays, degraded: weSay, why: why });
}
function row(o) {
  return Object.assign({ purpose: 'Change of Status', status: 'Added', description: 'X / Change of Status / 2026-07-09 / P1P' }, o);
}
function verdictOf(res, txn) {
  const r = res.scored.find(x => String(x.txn_id) === String(txn));
  return r ? r.verdict : 'MISSING';
}

console.log('\n=== Spec test cases ===');

// 1. Maid 130598, txns 1868833 and 2025798, 80 days apart, head 1677 -> finding.
{
  const hist = [
    row({ txn_id: 1868833, maid_id: 130598, expense_id: 1677, date: '2026-03-01', amount: 575.65 }),
    row({ txn_id: 2025798, maid_id: 130598, expense_id: 1677, date: '2026-05-20', amount: 575.65 })
  ];
  const pop = [hist[1]];                     // the run month is May
  const res = S.run(pop, hist);
  check('case 1  maid 130598, 80 days apart', verdictOf(res, 2025798), 'finding');
  check('case 1  gap measured as 80 days',
    String(res.scored[0].gap_days), '80');
}

// 2. Maid 120382, 2026-01-13 and 2026-04-21, 98 days apart.
//    Spec: "not yet decidable - finding if the two share one visa request,
//    clean if not". The visa request is refused, so the degraded answer is
//    pending, which is the honest reading of "not yet decidable".
{
  const hist = [
    row({ txn_id: 9001, maid_id: 120382, expense_id: 1677, date: '2026-01-13', amount: 575.65 }),
    row({ txn_id: 9002, maid_id: 120382, expense_id: 1677, date: '2026-04-21', amount: 575.65 })
  ];
  const res = S.run([hist[1]], hist);
  check('case 2  maid 120382, 98 days apart', verdictOf(res, 9002), 'pending');
  check('case 2  gap measured as 98 days', String(res.scored[0].gap_days), '98');
  deviation('case 2 (maid 120382)', 'undecidable pending one GET /visa/newRequest',
    'pending - request grain refused',
    'Same outcome the spec asked for, reached because the deciding call is unavailable rather than unmade.');
}

// 3. Maid 118206, txn 1743919, AED 1,415.00 carrying an AED 840 fine.
//    Spec: finding, via the inherited recovery rule at Order 100.
//    Degraded: Orders 30-150 are refused, so the fine cannot be sized or its
//    recovery checked -> pending, capped and named. NOT a false clearance.
{
  const pop = [row({ txn_id: 1743919, maid_id: 118206, expense_id: 1677, date: '2026-02-10', amount: 1415.00 })];
  const res = S.run(pop, pop);
  check('case 3  maid 118206, unrecovered fine', verdictOf(res, 1743919), 'pending');
  check('case 3  fine detected as present', String(res.scored[0].fine_present), 'true');
  check('case 3  capped and named', res.scored[0].capped_by ? 'capped' : 'uncapped', 'capped');
  deviation('case 3 (maid 118206)', 'finding - unrecovered fine (Order 100)',
    'pending - fine present but unsized',
    'Order 40 forbids sizing a fine by subtraction, and both the fines record and the maid-loan record are refused on the operator token. The fine IS detected; only its size and recovery are unavailable.');
}

// 4a. Txn 171743, no maid id, head 736 - retired, so out of the live population.
{
  const pop = [row({ txn_id: 171743, maid_id: null, expense_id: 736, date: '2019-09-19', amount: 9675.00 })];
  const res = S.run(pop, pop);
  check('case 4a head 736 is out of population', verdictOf(res, 171743), 'out_of_population');
}
// 4b. The identity floor itself: a LIVE-head row with no maid id.
{
  const pop = [row({ txn_id: 4002, maid_id: null, expense_id: 1677, date: '2026-07-03', amount: 575.65 })];
  const res = S.run(pop, pop);
  check('case 4b live-head row with no maid id', verdictOf(res, 4002), 'inconclusive');
}

// 5. Maid 125815, same maid, same day, two DIFFERENT products. The trap: a
//    naive dedup reports a duplicate that does not exist and invents a fine.
{
  const pop = [
    row({ txn_id: 1802431, maid_id: 125815, expense_id: 1589, date: '2026-03-09', amount: 590.54, purpose: 'Change of Status' }),
    row({ txn_id: 1802411, maid_id: 125815, expense_id: 1589, date: '2026-03-09', amount: 1054.71, purpose: 'Entry Visa', description: 'Entry Visa > 1000 AED' })
  ];
  const res = S.run(pop, pop);
  check('case 5  the Entry Visa row exits at the purity gate', verdictOf(res, 1802411), 'pending');
  check('case 5  purity gate is Order 25',
    res.scored.find(r => r.txn_id === 1802411).gate, 'Order 25');
  check('case 5  the genuine CoS row is NOT called a duplicate',
    res.scored.find(r => r.txn_id === 1802431).duplicate_band || 'none', 'first charge on this maid');
  check('case 5  no finding anywhere in this case',
    res.cases[0].verdict === 'finding' ? 'finding' : 'not a finding', 'not a finding');
}

// 6. Maid 109560, 140 days apart. Spec: clean under the window as written.
{
  const hist = [
    row({ txn_id: 1799921, maid_id: 109560, expense_id: 1677, date: '2026-01-05', amount: 575.65 }),
    row({ txn_id: 2037055, maid_id: 109560, expense_id: 1677, date: '2026-05-25', amount: 575.65 })
  ];
  const res = S.run([hist[1]], hist);
  check('case 6  maid 109560, 140 days apart', verdictOf(res, 2037055), 'pending');
  check('case 6  gap measured as 140 days', String(res.scored[0].gap_days), '140');
  deviation('case 6 (maid 109560)', 'clean - outside the ninety-day window',
    'pending - 91-365 band, request grain refused',
    'DELIBERATE. The window is a proxy for "a different visa cycle"; the visa request answers it directly and is refused. Clearing this band would be clearing a pair nothing examined. 27 pairs in a decade land here, about 3 a year.');
}

console.log('\n=== Edge guards named by the rules ===');

// Order 20: at exactly the base there is no overstay.
{
  const pop = [row({ txn_id: 5001, maid_id: 1, expense_id: 1677, date: '2026-07-01', amount: 575.65 })];
  check('exactly the base is clean, not a fine', verdictOf(S.run(pop, pop), 5001), 'clean');
}
// Order 20 Never: a missing amount must not be read as the base.
{
  const pop = [row({ txn_id: 5002, maid_id: 2, expense_id: 1677, date: '2026-07-01', amount: null })];
  const res = S.run(pop, pop);
  check('missing amount routes to review', verdictOf(res, 5002), 'pending');
  check('missing amount is not silently clean',
    res.scored[0].reason.indexOf('amount missing') >= 0 ? 'named' : 'unnamed', 'named');
}
// Order 128: a reversal is a named reason, not silence.
{
  const pop = [row({ txn_id: 5003, maid_id: 3, expense_id: 1677, date: '2026-07-01', amount: -3078 })];
  check('negative amount exits pending', verdictOf(S.run(pop, pop), 5003), 'pending');
}
// Order 15 Never: an unmatched date is off-era, never nearest-neighbour.
{
  const pop = [row({ txn_id: 5004, maid_id: 4, expense_id: 1677, date: '2015-06-01', amount: 575.65 })];
  const res = S.run(pop, pop);
  check('off-era date exits pending', verdictOf(res, 5004), 'pending');
  check('off-era is named as such',
    res.scored[0].reason.indexOf('off-era') >= 0 ? 'named' : 'unnamed', 'named');
}
// Rule 19 Never: never red a charge that was already reversed.
{
  const hist = [
    row({ txn_id: 5010, maid_id: 25742, expense_id: 1677, date: '2026-04-01', amount: 575.65 }),
    row({ txn_id: 5011, maid_id: 25742, expense_id: 1677, date: '2026-04-20', amount: 575.65 }),
    row({ txn_id: 5012, maid_id: 25742, expense_id: 1677, date: '2026-04-25', amount: -3078 })
  ];
  const res = S.run([hist[1]], hist);
  check('a reversed repeat is not red', verdictOf(res, 5011), 'pending');
}
// Rule 19 Never: the run window must not truncate the comparison.
// Population is July alone; the prior charge is in May. It must still be found.
{
  const hist = [
    row({ txn_id: 5020, maid_id: 777, expense_id: 1677, date: '2026-05-10', amount: 575.65 }),
    row({ txn_id: 5021, maid_id: 777, expense_id: 1677, date: '2026-07-08', amount: 575.65 })
  ];
  const res = S.run([hist[1]], hist);
  check('a cross-month pair is still caught', verdictOf(res, 5021), 'finding');
}
// Rule 19: the pair may straddle the 2025-12-19 rename (all-era history).
{
  const hist = [
    row({ txn_id: 5030, maid_id: 888, expense_id: 150, date: '2025-11-20', amount: 590.54 }),
    row({ txn_id: 5031, maid_id: 888, expense_id: 1677, date: '2026-01-15', amount: 575.65 })
  ];
  const res = S.run([hist[1]], hist);
  check('a pair straddling the rename is caught', verdictOf(res, 5031), 'finding');
}
// Rule 19: an over-a-year repeat is expected behaviour, and is counted.
{
  const hist = [
    row({ txn_id: 5040, maid_id: 999, expense_id: 1677, date: '2024-01-10', amount: 575.65 }),
    row({ txn_id: 5041, maid_id: 999, expense_id: 1677, date: '2026-07-10', amount: 575.65 })
  ];
  const res = S.run([hist[1]], hist);
  check('an over-a-year repeat is clean', verdictOf(res, 5041), 'clean');
  check('...and is counted for the run summary', String(res.summary.over_year_repeats_cleared), '1');
}
// Rule 19: a misfiled row never becomes a duplicate leg.
{
  const hist = [
    row({ txn_id: 5050, maid_id: 1010, expense_id: 1677, date: '2026-07-01', amount: 1054.71, purpose: 'Entry Visa' }),
    row({ txn_id: 5051, maid_id: 1010, expense_id: 1677, date: '2026-07-05', amount: 575.65 })
  ];
  const res = S.run([hist[1]], hist);
  check('a misfiled row is not a duplicate leg',
    res.scored[0].duplicate_band, 'first charge on this maid');
}
// Case aggregation: the worst verdict wins, and inconclusive outranks clean.
{
  // Dates over a year apart, so the duplicate rule does not fire and this test
  // measures aggregation alone: one clean row plus one fine-present row.
  const hist = [
    row({ txn_id: 6001, maid_id: 2020, expense_id: 1677, date: '2025-01-01', amount: 575.65 }),
    row({ txn_id: 6002, maid_id: 2020, expense_id: 1677, date: '2026-07-02', amount: 1415.00 })
  ];
  const res = S.run([hist[1]], hist);
  const c = res.cases.find(x => x.maid_id === 2020);
  check('case verdict is the worst of its rows', c.verdict, 'pending');
}
{
  const pop = [
    row({ txn_id: 6010, maid_id: null, expense_id: 1677, date: '2026-07-01', amount: 575.65 }),
    row({ txn_id: 6011, maid_id: null, expense_id: 1677, date: '2026-07-02', amount: 575.65 })
  ];
  const res = S.run(pop, pop);
  check('unattributed rows never aggregate into a clean case',
    res.cases.every(c => c.verdict === 'inconclusive') ? 'all inconclusive' : 'some clean', 'all inconclusive');
}

console.log('\n=== Regression: the duplicate rule must not override an unread field ===');
// Found in test, 2026-08-30. applyDuplicateRule used to overwrite `verdict` on
// any row it matched. A row already routed to `pending` because a field could
// not be READ was promoted to `finding` - and rule 19 values a finding "at its
// own amount", the very field that was unreadable. In production that would
// have raised red flags carrying a null amount against named maids, and a
// reviewer opening one would find nothing to review.
{
  const hist = [
    row({ txn_id: 7001, maid_id: 3030, expense_id: 1677, date: '2026-07-01', amount: 575.65 }),
    row({ txn_id: 7002, maid_id: 3030, expense_id: 1677, date: '2026-07-20', amount: null })
  ];
  const res = S.run([hist[1]], hist);
  check('unreadable amount is NOT promoted to a finding', verdictOf(res, 7002), 'pending');
}
{
  const hist = [
    row({ txn_id: 7003, maid_id: 3031, expense_id: 1677, date: '2015-07-01', amount: 575.65 }),
    row({ txn_id: 7004, maid_id: 3031, expense_id: 1677, date: '2015-07-20', amount: 575.65 })
  ];
  const res = S.run([hist[1]], hist);
  check('off-era row is NOT promoted to a finding', verdictOf(res, 7004), 'pending');
}
// The escalation that IS correct: a duplicate is a duplicate whether or not the
// row also carries a fine, because the duplicate finding needs no fines record.
{
  const hist = [
    row({ txn_id: 7005, maid_id: 3032, expense_id: 1677, date: '2026-07-01', amount: 575.65 }),
    row({ txn_id: 7006, maid_id: 3032, expense_id: 1677, date: '2026-07-20', amount: 1415.00 })
  ];
  const res = S.run([hist[1]], hist);
  check('a fine-bearing row IS still caught as a duplicate', verdictOf(res, 7006), 'finding');
}

console.log('\n=== The spec verdict vocabulary ===');
// The check page reconciles its verdict table against the policy database "cell
// by cell", so a word that drifts here breaks that reconciliation silently.
const SPEC_WORDS = {
  finding:      ['Duplicate application', 'Unrecovered fine'],
  clean:        ['Recovered', 'Waived', 'Under-threshold and paid anyway', 'One application, one price'],
  pending:      ['Sub-threshold fine, no recovery found', 'Misfiled charge', 'Off-era', 'Raised but unsettled', 'Negative amount'],
  inconclusive: ['Identity unresolved', 'No record anywhere']
};
{
  let bad = 0;
  for (const k of Object.keys(S.VERDICT_WORD)) {
    const v = S.VERDICT_WORD[k];
    if (v.word === null) continue;
    if ((SPEC_WORDS[v.state] || []).indexOf(v.word) === -1) { bad++; console.log('    drift: ' + v.word + ' is not a spec word for ' + v.state); }
  }
  check('every emitted word is a real spec word for its state', bad === 0 ? 'all match' : bad + ' drifted', 'all match');
}
{
  const pop = [row({ txn_id: 8001, maid_id: 41, expense_id: 1677, date: '2026-07-01', amount: 575.65 })];
  const r = S.run(pop, pop).scored[0];
  check('clean carries the spec word', r.verdict_word, 'One application, one price');
}
{
  const pop = [row({ txn_id: 8002, maid_id: 42, expense_id: 1677, date: '2026-07-01', amount: 1054.71, purpose: 'Entry Visa' })];
  check('misfiled carries the spec word', S.run(pop, pop).scored[0].verdict_word, 'Misfiled charge');
}
{
  const pop = [row({ txn_id: 8003, maid_id: 43, expense_id: 1677, date: '2015-07-01', amount: 575.65 })];
  check('off-era carries the spec word', S.run(pop, pop).scored[0].verdict_word, 'Off-era');
}
{
  const pop = [row({ txn_id: 8004, maid_id: 44, expense_id: 1677, date: '2026-07-01', amount: -3078 })];
  check('negative carries the spec word', S.run(pop, pop).scored[0].verdict_word, 'Negative amount');
}
{
  const pop = [row({ txn_id: 8005, maid_id: null, expense_id: 1677, date: '2026-07-01', amount: 575.65 })];
  check('identity carries the spec word', S.run(pop, pop).scored[0].verdict_word, 'Identity unresolved');
}
{
  const hist = [
    row({ txn_id: 8006, maid_id: 45, expense_id: 1677, date: '2026-04-01', amount: 575.65 }),
    row({ txn_id: 8007, maid_id: 45, expense_id: 1677, date: '2026-06-20', amount: 575.65 })
  ];
  check('duplicate carries the spec word', S.run([hist[1]], hist).scored[0].verdict_word, 'Duplicate application');
}
// The four states the spec has NO word for must say so, not borrow one.
{
  const pop = [row({ txn_id: 8010, maid_id: 46, expense_id: 1677, date: '2026-07-01', amount: 1415.00 })];
  const r = S.run(pop, pop).scored[0];
  check('fine-present has NO borrowed word', String(r.verdict_word), 'null');
  check('...and is flagged as needing one', String(r.needs_verdict_word), 'true');
}
{
  const hist = [
    row({ txn_id: 8011, maid_id: 47, expense_id: 1677, date: '2026-01-05', amount: 575.65 }),
    row({ txn_id: 8012, maid_id: 47, expense_id: 1677, date: '2026-05-25', amount: 575.65 })
  ];
  const r = S.run([hist[1]], hist).scored[0];
  check('out-of-window repeat has NO borrowed word', String(r.verdict_word), 'null');
  check('...and is flagged as needing one', String(r.needs_verdict_word), 'true');
}
{
  const pop = [row({ txn_id: 8013, maid_id: 48, expense_id: 1677, date: '2026-07-01', amount: null })];
  check('unreadable field has NO borrowed word', String(S.run(pop, pop).scored[0].verdict_word), 'null');
}
{
  const pop = [
    row({ txn_id: 8020, maid_id: 49, expense_id: 1677, date: '2026-07-01', amount: 575.65 }),
    row({ txn_id: 8021, maid_id: 49, expense_id: 1677, date: '2026-07-10', amount: 1415.00 })
  ];
  const res = S.run(pop, pop);
  check('the summary counts unnamed states', String(res.summary.rows_needing_a_verdict_word >= 1), 'true');
}

console.log('\n=== Declared deviations from the spec (degraded build) ===');
for (const d of deviations) {
  console.log('  * ' + d.case);
  console.log('      spec expects : ' + d.spec);
  console.log('      degraded gives: ' + d.degraded);
  console.log('      why           : ' + d.why);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + deviations.length + ' declared deviations');
process.exit(fail ? 1 : 0);
