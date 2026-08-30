// R-Visa Audit — offline test suite for the deterministic scorer.
//
// Run: node audit/r_visa/scorer.test.js
//
// Every one of the spec's six named test cases, plus a guard for each edge the
// rules name: the three base fees, a non-integer remainder, a suppressed date, a
// missing anchor, an ambiguous anchor, both population eras, and each of the
// four deliberate exclusions.
//
// Independently reproducing the spec's own verified figures is the strongest
// signal the logic is right, so where the spec states a number (92 fine days
// against 140 implied; 54-day undercharge; 4 excess days across the three 2026
// overcharges) the test asserts THAT number, not merely a verdict colour.

'use strict';

const S = require('./scorer.js');

let passed = 0, failed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  failures.push('  ✗ ' + name + '\n      expected: ' + e + '\n      actual:   ' + a);
}

function group(title) {
  console.log('\n' + title);
}

const DEDICATED_MV_NEW = 'NEW - MV Housemaids - R-visa Application 2 years';
const DEDICATED_CC_RENEW = 'RENEW - CC Housemaids - R-visa Application 2 years';
const GENERIC_CC_NEW = 'NEW - Immigration - CC Maids';
const GENERIC_MV_RENEWAL = 'Renewal and Cancellation - Immigration - MV Maids';

function pay(o) {
  return {
    txn_id: o.txn_id,
    txn_date: o.txn_date,
    amount: o.amount,
    expense_name: o.expense_name || DEDICATED_MV_NEW,
    description: o.description || 'R-VISA fee',
    description_date: o.description_date || null,
    creator: o.creator || 'staff-a'
  };
}

function baseCase(o) {
  return Object.assign({
    maid_id: o.maid_id,
    payments: o.payments || [],
    refunds: o.refunds || [],
    entry_visa_payments: o.entry_visa_payments || [],
    visa_cycle: o.visa_cycle === undefined ? null : o.visa_cycle,
    visa_history_markers: o.visa_history_markers || [],
    cancellation_type: null,
    rejection_status: null,
    refund_request_date: null,
    contract_term_years: null,
    issued_visa_validity: null,
    fine_repayment_responsibility: null,
    written_explanations: o.written_explanations || {}
  });
}

// ═══════════════════════════════════════════ SPEC TEST CASES ═══════════════════
group('Spec test cases (Notion "Five real cases to test with" + the sixth)');

// ---- Case 1: maid 105870, the clean double-payment shape ----------------------
// Two AED 446.65 fees 4 days apart, same creator, one maid id, BOTH inside the
// visa request that ran 2025-09-06 → 09-19. Transaction 1486146 also carries a
// year-0025 description date, and ❹ must suppress the FINE gates only so the
// duplicate red still fires. This case is the reason that fix exists.
{
  const r = S.scoreCase(baseCase({
    maid_id: 105870,
    payments: [
      pay({ txn_id: 1482201, txn_date: '2025-09-13', amount: 446.65, description_date: '2025-09-13' }),
      pay({ txn_id: 1486146, txn_date: '2025-09-17', amount: 446.65, description_date: '0025-09-13' })
    ],
    visa_cycle: { start: '2025-09-06', end: '2025-09-19' }
  }));
  check('case1 verdict is a finding', r.case_verdict, 'finding (red)');
  check('case1 reds at ⓫', r.pairs[0].gate, '⓫');
  check('case1 reason is double-payment', r.pairs[0].reason, 'double-payment');
  check('case1 discriminator is the visa cycle, not the day gap', r.pairs[0].discriminator, 'visa-cycle');
  check('case1 gap is 4 days', r.pairs[0].gap_days, 4);
  check('case1 red is provisional pending verifier ❶', r.pairs[0].provisional, true);
  check('case1 loss is one surplus base fee', r.pairs[0].loss_aed, 446.65);
  // ❹ must NOT have parked the whole record.
  const rec = r.records.filter(function (x) { return x.txn_id === 1486146; })[0];
  check('case1 ❹ suppressed the fine gates on 1486146',
    rec.annotations.indexOf('fine-gates-suppressed-by-date-integrity') >= 0, true);
  check('case1 ❹ flagged the year-0025 date',
    rec.annotations.indexOf('date-integrity:description-year-before-1900') >= 0, true);
}

// ---- Case 2: maid 61273, a 2-year visa renewed after 2 years ------------------
// The MODE of the repeat-payment distribution — 60 of 183 pairs — so if this
// comes out red the whole rule is inverted.
{
  const r = S.scoreCase(baseCase({
    maid_id: 61273,
    payments: [
      pay({ txn_id: 856161, txn_date: '2024-05-22', amount: 446.65 }),
      pay({ txn_id: 2085707, txn_date: '2026-08-19', amount: 457.46 })
    ]
  }));
  check('case2 is NOT a finding', r.case_verdict === 'finding (red)', false);
  check('case2 pair clears at ❾', r.pairs[0].gate, '❾');
  check('case2 pair is clean', r.pairs[0].verdict, 'clean (green)');
  check('case2 gap is 819 days', r.pairs[0].gap_days, 819);
  check('case2 cleared by the pre-taxonomy gap fallback',
    r.pairs[0].discriminator, 'gap>=601 (pre-taxonomy fallback)');
}

// ---- Case 2b: the same pair, both payments on a RENEW head -------------------
// A renewal declares itself in the expense; the gap is then not consulted.
{
  const r = S.scoreCase(baseCase({
    maid_id: 61274,
    payments: [
      pay({ txn_id: 1, txn_date: '2026-01-10', amount: 457.46, expense_name: DEDICATED_CC_RENEW }),
      pay({ txn_id: 2, txn_date: '2026-03-10', amount: 457.46, expense_name: DEDICATED_CC_RENEW })
    ]
  }));
  check('renew head clears even at a 59-day gap', r.pairs[0].verdict, 'clean (green)');
  check('renew head is the discriminator', r.pairs[0].discriminator, 'renew-head');
}

// ---- Case 3: maid 94824, a re-application across two visa cycles -------------
// Her current request ran 2025-07-30 → 10-16, so only the second payment belongs
// to it and the first predates the request entirely. This is the case that showed
// the duplicate rule should key on visa-request identity, not a day gap.
{
  const r = S.scoreCase(baseCase({
    maid_id: 94824,
    payments: [
      pay({ txn_id: 1351061, txn_date: '2025-06-13', amount: 446.65, creator: 'staff-a' }),
      pay({ txn_id: 1532914, txn_date: '2025-10-14', amount: 446.65, creator: 'staff-b' })
    ],
    visa_cycle: { start: '2025-07-30', end: '2025-10-16' },
    visa_history_markers: ['Fill Previous Visa Info']
  }));
  check('case3 is NOT a finding', r.case_verdict === 'finding (red)', false);
  check('case3 settled by visa-cycle identity, not the 123-day gap',
    r.pairs[0].discriminator, 'visa-cycle (different requests — re-application)');
  check('case3 gap is 123 days', r.pairs[0].gap_days, 123);
}

// ---- Case 4: transaction 1526423, the year-0025 date -------------------------
// ❹ must suppress the fine gates before ❼/❽ compute a two-thousand-year overstay.
// Khalil's dashboard differenced it silently and reported OK with a 54-day
// undercharge.
{
  const r = S.scoreCase(baseCase({
    maid_id: 999001,
    payments: [
      pay({ txn_id: 1526423, txn_date: '2025-10-07', amount: 446.65 + 54 * 50, description_date: '0025-10-03' })
    ],
    entry_visa_payments: [{ txn_id: 900001, date: '2025-01-01' }]
  }));
  const rec = r.records[0];
  check('case4 record is pending, not red', rec.verdict, 'pending');
  check('case4 falls to the ⓭ floor', rec.gate, '⓭');
  check('case4 carries the date-integrity reason',
    rec.reason, 'unsettled:date-integrity:description-year-before-1900');
  check('case4 computed no day count from the corrupt date', rec.fine_days_implied, null);
  check('case4 still read 54 fine days from the AMOUNT', rec.fine_days_paid, 54);
  // The verifier still asks who repays a fine that was in fact paid.
  const v2 = r.verifier.filter(function (v) { return v.rule === 'V❷'; });
  check('case4 verifier ❷ still fires on the paid fine', v2.length, 1);
}

// ---- Case 5: transaction 1641662, the largest fine of 2025 -------------------
// 92 fine days paid against 140 implied — a 48-day gap. The prior art calls this
// OK. Every constant in the check is load-bearing here at once.
{
  const r = S.scoreCase(baseCase({
    maid_id: 999002,
    payments: [pay({ txn_id: 1641662, txn_date: '2025-12-17', amount: 5046.65 })],
    // gap of 200 days ⇒ implied = 200 − 60 = 140
    entry_visa_payments: [{ txn_id: 900002, date: '2025-05-31' }]
  }));
  const rec = r.records[0];
  check('case5 reds at ❽', rec.gate, '❽');
  check('case5 reason is fine-days-below-date-gap', rec.reason, 'fine-days-below-date-gap');
  check('case5 paid 92 fine days', rec.fine_days_paid, 92);
  check('case5 dates imply 140', rec.fine_days_implied, 140);
  check('case5 shortfall is 48 days', rec.shortfall_days, 48);
  check('case5 resolved the 446.65 base', rec.base_fee, 446.65);
}

// ---- Case 6: transaction 1536291, AED 798.05 --------------------------------
// Fits neither base fee plus any multiple of 50. The cheapest test that the
// catch-all actually fires.
{
  const r = S.scoreCase(baseCase({
    maid_id: 105525,
    payments: [pay({ txn_id: 1536291, txn_date: '2025-10-17', amount: 798.05 })]
  }));
  check('case6 parks as pending', r.records[0].verdict, 'pending');
  check('case6 names the base fee as the suspect', r.records[0].reason, 'base-fee-unresolved');
  check('case6 parks at ❺', r.records[0].gate, '❺');
}

// ---- ❼'s three real 2026 overcharges ----------------------------------------
// Each sits on a maid with exactly one entry-visa payment, so none depends on the
// anchor choice. Total excess 4 days, AED 200.
group('❼ — the three real 2026 overcharges (total excess 4 days, AED 200)');
{
  const specs = [
    { txn: 1692426, maid: 112473, paid: 2, implied: 1 },
    { txn: 1706249, maid: 113746, paid: 7, implied: 5 },
    { txn: 1990079, maid: 130746, paid: 9, implied: 8 }
  ];
  let totalExcessDays = 0, totalExcessAed = 0;
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const txnDate = '2026-03-10';
    const anchorDate = new Date(Date.UTC(2026, 2, 10) - (s.implied + 60) * 86400000)
      .toISOString().slice(0, 10);
    const r = S.scoreCase(baseCase({
      maid_id: s.maid,
      payments: [pay({ txn_id: s.txn, txn_date: txnDate, amount: 457.46 + s.paid * 50 })],
      entry_visa_payments: [{ txn_id: 9000 + i, date: anchorDate }]
    }));
    const rec = r.records[0];
    check('txn ' + s.txn + ' reds at ❼', rec.gate, '❼');
    check('txn ' + s.txn + ' paid ' + s.paid + ' days', rec.fine_days_paid, s.paid);
    check('txn ' + s.txn + ' implied ' + s.implied + ' days', rec.fine_days_implied, s.implied);
    check('txn ' + s.txn + ' has exactly one anchor candidate', rec.anchor_candidates, 1);
    totalExcessDays += s.paid - s.implied;
    totalExcessAed += rec.loss_aed;
  }
  check('❼ total excess is 4 days', totalExcessDays, 4);
  check('❼ total excess is AED 200', totalExcessAed, 200);
}

// ═══════════════════════════════════════════ EDGE GUARDS ══════════════════════
group('❶ population — both eras and the four deliberate exclusions');
{
  // Dedicated head, description never says R-VISA. This is 33.6% of 2026 rows;
  // a description test here throws a third of the population away.
  check('dedicated RENEW head with no R-VISA text is IN',
    S.classifyPayment({ expense_name: DEDICATED_CC_RENEW, description: 'Current Housemaid / Renew Residence' }).leg,
    'dedicated-head');

  // Pre-cutover renewal leg: says R-VISA zero times in 10,855 rows.
  check('generic renewal head + "Renew Residence" is IN',
    S.classifyPayment({ expense_name: GENERIC_MV_RENEWAL, description: 'Current Housemaid / Renew Residence' }).leg,
    'generic-renewal-text');

  // Cancellations on that same head: a different product at a different price.
  check('generic renewal head + "cancel residence" is OUT',
    S.classifyPayment({ expense_name: GENERIC_MV_RENEWAL, description: 'cancel residence for maid' }).reason,
    'cancellation-different-product');

  check('generic new head + R-VISA text is IN',
    S.classifyPayment({ expense_name: GENERIC_CC_NEW, description: 'R-VISA payment' }).leg,
    'generic-new-text');

  // Entry visa / MOHRE / change of status share the generic buckets — 14,047 of
  // 14,437 sit there, so expense alone widens the population roughly tenfold.
  check('generic head with unrelated text is OUT',
    S.classifyPayment({ expense_name: GENERIC_CC_NEW, description: 'MOHRE contract submission' }).reason,
    'generic-head-text-not-rvisa');

  check('office staff head is OUT',
    S.classifyPayment({ expense_name: 'NEW - OfficeStaff - R-visa Application 2 years', description: 'R-VISA' }).reason,
    'office-staff-out-of-scope');

  // Any description-only filter picks these up.
  check('salary row mentioning R-visa is OUT (unclassified, not dropped)',
    S.classifyPayment({ expense_name: 'MaidVisa Housemaids Basic Salary', description: 'R-VISA related' }).reason,
    'unclassified-expense-head');
}

group('❺ base fee — resolution by remainder, never by date');
{
  function resolved(amount) {
    const r = S.resolveBaseFee(amount);
    return { ok: r.ok, base: r.base, fine_days: r.fine_days, candidates: r.candidates };
  }
  // SPEC CORRECTION: 446.65 − 346.65 = 100.00 = 2 × 50, so BOTH bases fit every
  // amount on the main base. The rule body claims they cannot. The tie-break
  // takes the highest fitting base — 0 fine days, not 2.
  check('446.65 exact resolves with 0 fine days', resolved(446.65),
    { ok: true, base: 446.65, fine_days: 0, candidates: 2 });
  check('and it records that a second base also fitted',
    S.resolveBaseFee(446.65).alternatives, [{ base: 346.65, fine_days: 2 }]);
  check('457.46 (live since 2025-07-07) resolves unambiguously', resolved(457.46),
    { ok: true, base: 457.46, fine_days: 0, candidates: 1 });
  check('346.65 cohort resolves unambiguously', resolved(346.65),
    { ok: true, base: 346.65, fine_days: 0, candidates: 1 });
  // The latent defect in the prior art: a fine on the newer base computes as
  // 507.46 − 446.65 = 60.81 = 1.216 days under a hardcoded 446.65.
  check('507.46 resolves on the NEW base as 1 fine day', resolved(507.46),
    { ok: true, base: 457.46, fine_days: 1, candidates: 1 });
  check('798.05 fits no base plus any multiple of 50', S.resolveBaseFee(798.05).ok, false);
  check('an amount below every base parks', S.resolveBaseFee(100).ok, false);
  // Float guard: 3146.65 − 446.65 lands at 2699.9999999999995 in binary floating point.
  check('3146.65 is 54 whole fine days despite float error', S.resolveBaseFee(3146.65).fine_days, 54);
}

group('❼/❽ anchor — the LAST entry-visa payment on or before the R-visa date');
{
  const anchors = [
    { txn_id: 'a', date: '2023-01-01' },
    { txn_id: 'b', date: '2025-06-01' },
    { txn_id: 'c', date: '2026-01-01' }  // after the R-visa date — not a candidate
  ];
  const got = S.resolveAnchor(anchors, S.parseDate('2025-12-17'));
  check('picks the LAST candidate on or before', got.anchor.txn_id, 'b');
  check('counts 2 candidates, flagging the ambiguity', got.candidates, 2);
  check('no candidate at all is not an anchor', S.resolveAnchor([{ txn_id: 'z', date: '2027-01-01' }], S.parseDate('2025-01-01')).ok, false);
}
{
  // Where none exists the record parks rather than guessing.
  const r = S.scoreCase(baseCase({
    maid_id: 999003,
    payments: [pay({ txn_id: 7001, txn_date: '2025-12-17', amount: 5046.65 })],
    entry_visa_payments: []
  }));
  check('a fine with no anchor parks', r.records[0].reason, 'entry-visa-anchor-missing');
  check('a fine with no anchor is pending, not red', r.records[0].verdict, 'pending');
}
{
  // Ambiguity is annotated, not silently resolved: the worst anchor choice moves
  // one real answer by 965 days.
  const r = S.scoreCase(baseCase({
    maid_id: 999004,
    payments: [pay({ txn_id: 7002, txn_date: '2025-12-17', amount: 5046.65 })],
    entry_visa_payments: [{ txn_id: 'a', date: '2023-04-26' }, { txn_id: 'b', date: '2025-05-31' }]
  }));
  check('ambiguous anchor is annotated',
    r.records[0].annotations.indexOf('anchor-ambiguous:2-candidates') >= 0, true);
  check('ambiguous anchor still uses the LAST one', r.records[0].fine_days_implied, 140);
}

group('❽ — zero-fine rows are not tested against a fine that was never charged');
{
  // 99.83% of the population carries no fine at all. Under the wide reading this
  // ordinary payment would red; under the implemented scoping it does not.
  const input = baseCase({
    maid_id: 999005,
    payments: [pay({ txn_id: 7003, txn_date: '2025-12-17', amount: 446.65 })],
    entry_visa_payments: [{ txn_id: 'a', date: '2025-05-31' }]
  });
  check('zero-fine row does not red by default', S.scoreCase(input).records[0].verdict, 'pending');
  const wide = S.scoreCase(input, { evaluate_zero_fine_rows: true });
  check('zero-fine row WOULD red under the wider reading', wide.records[0].gate, '❽');
  check('and the wider reading names 140 implied days', wide.records[0].fine_days_implied, 140);
}

group('❸ refund netting — R-visa expenses only, all-time');
{
  // The 27 client refunds carry "pre R-visa cancellation" in a free-text reason
  // and run to −AED 83,558. Netting them would erase real findings wholesale.
  const r = S.scoreCase(baseCase({
    maid_id: 999006,
    payments: [
      pay({ txn_id: 8001, txn_date: '2025-09-13', amount: 446.65 }),
      pay({ txn_id: 8002, txn_date: '2025-09-17', amount: 446.65 })
    ],
    visa_cycle: { start: '2025-09-06', end: '2025-09-19' },
    refunds: [{ txn_id: 8003, date: '2025-11-20', amount: -11508, expense_name: '' }]
  }));
  check('a blank-expense client refund is NOT netted', r.refunded_aed, 0);
  check('and the duplicate red therefore stands', r.pairs[0].verdict, 'finding (red)');
}
{
  // Transaction 1172259, −AED 239.50: the one genuine R-visa fee refund in 2025.
  const r = S.scoreCase(baseCase({
    maid_id: 999007,
    payments: [
      pay({ txn_id: 8101, txn_date: '2025-09-13', amount: 446.65 }),
      pay({ txn_id: 8102, txn_date: '2025-09-17', amount: 446.65 })
    ],
    visa_cycle: { start: '2025-09-06', end: '2025-09-19' },
    refunds: [{ txn_id: 1172259, date: '2025-11-20', amount: -446.65, expense_name: DEDICATED_MV_NEW }]
  }));
  check('an R-visa-expense refund IS netted', r.refunded_aed, 446.65);
  check('a fully refunded duplicate is not a loss', r.pairs[0].verdict === 'finding (red)', false);
  check('and it says so', r.pairs[0].annotations.indexOf('duplicate-fully-refunded') >= 0, true);
}

group('❷ identity — a null id parks, it never merges into another maid\'s case');
{
  const r = S.scoreCase(baseCase({
    maid_id: null,
    payments: [pay({ txn_id: 9001, txn_date: '2025-09-13', amount: 446.65 })]
  }));
  check('null id parks the case', r.case_verdict, 'pending');
  check('null id reason', r.case_reason, 'identity-unresolved');
}

group('⓭ / V❹ — neither layer lets silence mean clean');
{
  // The 31–90 day band: red by no rule, clean by no rule.
  const r = S.scoreCase(baseCase({
    maid_id: 999008,
    payments: [
      pay({ txn_id: 9101, txn_date: '2025-01-10', amount: 446.65 }),
      pay({ txn_id: 9102, txn_date: '2025-03-01', amount: 446.65 })
    ]
  }));
  check('a 50-day pair is neither red nor clean', r.pairs[0].verdict, 'pending');
  check('it falls to the ⓭ floor', r.pairs[0].gate, '⓭');
  check('carrying the gap in its reason', r.pairs[0].reason, 'duplicate-question-unsettled:gap-50d');
}
{
  // A duplicate pair with no written explanation and no fine matched none of the
  // three verifier rules and used to exit verdictless.
  const r = S.scoreCase(baseCase({
    maid_id: 999009,
    payments: [
      pay({ txn_id: 9201, txn_date: '2025-09-13', amount: 446.65 }),
      pay({ txn_id: 9202, txn_date: '2025-09-17', amount: 446.65 })
    ],
    visa_cycle: { start: '2025-09-06', end: '2025-09-19' }
  }));
  const v1 = r.verifier.filter(function (v) { return v.rule === 'V❶'; })[0];
  check('V❶ with no explanation gets a verdict from the V❹ floor', v1.verdict, 'pending');
  check('and it upholds the provisional red', v1.upholds, true);
  check('the case verdict is still the red', r.case_verdict, 'finding (red)');
}

group('⓬ / ❻ — annotations that must never halt evaluation');
{
  const r = S.scoreCase(baseCase({
    maid_id: 999010,
    payments: [
      pay({ txn_id: 9301, txn_date: '2025-09-13', amount: 446.65 }),
      pay({ txn_id: 9302, txn_date: '2025-09-17', amount: 446.65 })
    ],
    visa_cycle: { start: '2025-09-06', end: '2025-09-19' }
  }));
  check('⓬ annotates that the sub-audit did not execute',
    r.annotations.indexOf('rejection-sub-audit-not-executed') >= 0, true);
  check('❻ annotates the unverifiable term', r.annotations.indexOf('term-unverifiable') >= 0, true);
  check('and ⓫ still reached its red', r.case_verdict, 'finding (red)');
  check('V❸ reports inconclusive, never clean',
    r.verifier.filter(function (v) { return v.rule === 'V❸'; })[0].verdict, 'inconclusive');
}

group('declared gaps travel with every result');
{
  const r = S.scoreCase(baseCase({ maid_id: 1, payments: [] }));
  check('eight declared gaps are returned', r.declared_gaps.length, 8);
}

// ══════════════════════════════════════════════ REPORT ════════════════════════
console.log('\n' + '─'.repeat(66));
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('─'.repeat(66));
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
