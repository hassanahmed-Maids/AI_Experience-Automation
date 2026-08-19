'use strict';

// Offline test suite for the MV Monthly Payment scorer.
// Rows are transcribed from the spec's own live-verified payloads (Notion v0.8) so that
// reproducing its figures is evidence the logic is right, not evidence it agrees with me.

const S = require('./scorer');

let pass = 0, fail = 0;
const failures = [];

function check(name, got, want) {
  const ok = got === want;
  if (ok) { pass++; } else { fail++; failures.push(name + '\n    expected: ' + want + '\n    got:      ' + got); }
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '   [' + got + ' != ' + want + ']'));
}

function pay(id, code, status, amount, dateOfPayment, replaced) {
  return {
    id: id,
    typeOfPayment: { code: code, name: code === 'monthly_payment' ? 'Monthly Payment' : code },
    status: { value: status, label: status === 'PDC' ? 'PDP' : status },
    amountOfPayment: amount,
    dateOfPayment: dateOfPayment,
    replaced: replaced === undefined ? false : replaced,
  };
}

function plan(salary, fees, amountValue, extra) {
  return Object.assign({
    currentPayment: { amountValue: amountValue },
    currentPayments: [{
      paymentTypeCode: 'monthly_payment',
      workerSalary: salary,
      workerSalaryWithoutVAT: null,
      visaFees: fees,
      amountValue: amountValue,
      status: 'ACTIVE',
    }],
  }, extra || {});
}

function mv(id, clientId, startDate, planObj, extra) {
  return Object.assign({
    id: id, clientId: clientId, prospectTypeCode: 'maidvisa.ae_prospect',
    startDate: startDate, dateOfTermination: null,
    preCollectedInfo: { isPreCollectedSalary: false, currentPreCollectedPayments: [] },
    vip: false, vVip: false, discount: null, creditNotes: [],
  }, planObj, extra || {});
}

console.log('\n=== THE FIVE SPEC TEST CASES ===\n');

// Case 1 · 1019110 · Feb 2026 → clean. 1,590 RECEIVED against amountValue 1,590.
// salary 1575 + visaFees 15 = 1590. The profit component is 15 against a "standard"
// 85+80 VAT — a mispriced plan, which the owner ruled permanently OUT of scope.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-02',
    contract: mv(1019110, 10001, '2025-08-01', plan(1575, 15, 1590)),
    payments: [pay(14476343, 'monthly_payment', 'RECEIVED', 1590.0, '2026-02-01')],
  });
  check('case 1 · 1019110 · 2026-02 → clean', r.verdict, S.VERDICT.CLEAN);
  check('case 1 · concluded at gate 6', r.gate, '6');
  check('case 1 · expected read as 1590', r.expected, 1590);
  check('case 1 · mispriced plan raises no finding', r.redFlagType, undefined);
}

// Case 2 · 1053569 · Apr 2025 → clean, settled by replacement.
// TERMINATED contract: the currentPayments row comes back status "" with all three money
// fields null. Zeroing the split would make the expectation the fee alone.
{
  const terminated = {
    currentPayment: { amountValue: null },
    currentPayments: [{
      paymentTypeCode: 'monthly_payment', workerSalary: null,
      workerSalaryWithoutVAT: null, visaFees: null, amountValue: null, status: '',
    }],
  };
  const c = mv(1053569, 8279, '2024-11-01', terminated, {
    preCollectedInfo: {
      isPreCollectedSalary: true,
      currentPreCollectedPayments: [
        { amount: 'AED 2,400', preCollectedPaymentDate: '01 Nov 2024', status: 'RECEIVED', paymentType: 'Pre-collected Salary' },
        { amount: 'AED 2,400', preCollectedPaymentDate: '01 Nov 2024', status: 'BOUNCED', paymentType: 'Pre-collected Salary' },
      ],
    },
  });
  // Pre-collected, so auditing 2025-04 tests 2025-03. The spec records March as "the
  // identical shape" — another settled replacement chain — so both months are supplied.
  const rows = [
    pay(7711063, 'monthly_payment', 'BOUNCED', 2568.0, '2025-03-01', true),
    pay(10168142, 'monthly_payment', 'RECEIVED', 2568.0, '2025-03-01'),
    pay(7711064, 'monthly_payment', 'BOUNCED', 2568.0, '2025-04-01', true),
    pay(10168143, 'monthly_payment', 'RECEIVED', 2568.0, '2025-04-01'),
  ];
  const r = S.scoreContractMonth({ auditedMonth: '2025-04', contract: c, payments: rows });
  check('case 2 · 1053569 · 2025-04 → clean', r.verdict, S.VERDICT.CLEAN);
  check('case 2 · pre-collected shifts the month under test to 2025-03', r.monthUnderTest, '2025-03');
  check('case 2 · concluded at gate 7 (chain)', r.gate, '7');
  check('case 2 · null split → expectation unknown, not zero', r.expected, null);
  check('case 2 · advance sums RECEIVED only (2400, not 4800)', r.advanceReceived, 2400);
}

// Case 3 · 1099709 · 2026-06 → clean. The full replacement chain on one date, plus five
// non-monthly rows on the same date that the type filter must exclude.
// Dropping the filter makes June read 1,743 instead of 168.
{
  const c = mv(1099709, 10002, '2026-06-26', plan(1470, 168, 1638), {
    preCollectedInfo: {
      isPreCollectedSalary: true,
      currentPreCollectedPayments: [
        { amount: 'AED 1,638', preCollectedPaymentDate: '01 Jul 2026', status: 'RECEIVED', paymentType: 'Monthly Payment' },
      ],
    },
  });
  const june = [
    pay(16337773, 'monthly_payment', 'DELETED', 168.0, '2026-06-26', false),
    pay(16338019, 'monthly_payment', 'BOUNCED', 168.0, '2026-06-26', true),
    pay(16355526, 'monthly_payment', 'RECEIVED', 168.0, '2026-06-26'),
    pay(16337700, 'transfer_fee', 'DELETED', 1575.0, '2026-06-26'),
    pay(16337701, 'transfer_fee', 'BOUNCED', 1575.0, '2026-06-26', true),
    pay(16337702, 'transfer_fee', 'RECEIVED', 1575.0, '2026-06-26'),
    pay(16337703, 'same_day_recruitment_fee', 'DELETED', 8925.0, '2026-06-26'),
    pay(16337704, 'same_day_recruitment_fee', 'RECEIVED', 0.0, '2026-06-26'),
  ];
  // Under the owner's ruling this contract is pre-collected, so auditing 2026-06 tests
  // 2026-05 — before the 26 Jun start. Correctly raises no case rather than a red.
  const r = S.scoreContractMonth({ auditedMonth: '2026-06', contract: c, payments: june });
  check('case 3 · 1099709 · 2026-06 raises no finding', r.verdict, S.VERDICT.INCONCLUSIVE);
  check('case 3 · month under test shifted to 2026-05', r.monthUnderTest, '2026-05');
  check('case 3 · excluded because it precedes contract start', r.gate, '2');

  // Auditing JULY tests June — the month the spec's case is really about.
  const julyAudit = S.scoreContractMonth({ auditedMonth: '2026-07', contract: c, payments: june });
  check('case 3 · auditing July tests June and is clean', julyAudit.verdict, S.VERDICT.CLEAN);
  check('case 3 · June sums to 168, not 1743', julyAudit.received, 168);
  check('case 3 · June recognised as the first partial month', julyAudit.isStartMonth, true);
}

// Case 4 · 1029517 · Apr 2026 → clean. Three DELETED rows at 1,668 / 1,743 / 1,743 sit in
// the same month. Summing blind gives 6,729 against a true 1,575.
// visaFees is 0.00 and that is clean — the finding is never a profit figure judged alone.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-04',
    contract: mv(1029517, 10003, '2025-01-01', plan(1575, 0, 1575)),
    payments: [
      pay(15075494, 'monthly_payment', 'RECEIVED', 1575.0, '2026-04-01'),
      pay(15075001, 'monthly_payment', 'DELETED', 1668.0, '2026-04-01'),
      pay(15075002, 'monthly_payment', 'DELETED', 1743.0, '2026-04-01'),
      pay(15075003, 'monthly_payment', 'DELETED', 1743.0, '2026-04-01'),
    ],
  });
  check('case 4 · 1029517 · 2026-04 → clean', r.verdict, S.VERDICT.CLEAN);
  check('case 4 · DELETED rows excluded (1575, not 6729)', r.received, 1575);
  check('case 4 · zero profit is clean', r.redFlagType, undefined);
}

// Case 5 · 1099709 · Jun vs Jul — the first-month shape.
// June is 168 (the fee alone); July is the full 1,638. Comparing June against 1,638
// invents a 1,470 shortfall, and isProRated is false so that flag will not save you.
{
  const c = mv(1099709, 10002, '2026-06-26', plan(1470, 168, 1638), {
    isProRated: false,
    preCollectedInfo: {
      isPreCollectedSalary: true,
      currentPreCollectedPayments: [
        { amount: 'AED 1,638', preCollectedPaymentDate: '01 Jul 2026', status: 'RECEIVED', paymentType: 'Monthly Payment' },
      ],
    },
  });
  // Pre-collected, so an AUGUST audit is what tests July's full 1,638.
  const augAudit = S.scoreContractMonth({
    auditedMonth: '2026-08', contract: c,
    payments: [pay(16337774, 'monthly_payment', 'RECEIVED', 1638.0, '2026-07-01')],
  });
  check('case 5 · auditing Aug tests July → clean at full amount', augAudit.verdict, S.VERDICT.CLEAN);
  check('case 5 · July expected 1638', augAudit.expected, 1638);
  check('case 5 · month under test is 2026-07', augAudit.monthUnderTest, '2026-07');

  // The trap itself: June must NOT be scored against 1,638. A July audit tests June.
  const juneViaJuly = S.scoreContractMonth({
    auditedMonth: '2026-07', contract: c,
    payments: [pay(16355526, 'monthly_payment', 'RECEIVED', 168.0, '2026-06-26')],
  });
  check('case 5 · June does NOT invent a 1470 shortfall', juneViaJuly.verdict, S.VERDICT.CLEAN);
  check('case 5 · June raises no amount-mismatch red', juneViaJuly.redFlagType, undefined);
}

console.log('\n=== THE TWO CONFIRMED REDS (2026-08-17) ===\n');

// Both re-probed live 2026-08-19. Real payload shapes, not reconstructions.
// Note BOTH terminate INSIDE the audited month, so they survive gate 2 only because the
// comparison is month-to-month. A date-to-date test would silently delete both reds.

// Contract 1023590 · audited 2026-03 · client 193871 · NOT pre-collected.
// One monthly_payment row in the month: BOUNCED, replaced=false, zero received. Client paid
// the following month (15381654, 2026-04-01), so this is not simply termination.
// Terminated 2026-03-03. currentPayments split is null; amountValue carries 1838.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-03',
    contract: mv(1023590, 193871, '2023-06-22 20:05:51', {
      currentPayment: { amountValue: 1838.0 },
      currentPayments: [{ paymentTypeCode: 'monthly_payment', workerSalary: null,
        workerSalaryWithoutVAT: null, visaFees: null, amountValue: 1838.0, status: '' }],
      paymentPlan: { additionalDiscount: '', creditNoteDiscount: '' },
    }, { dateOfTermination: '2026-03-03 23:00:10' }),
    payments: [
      pay(11860260, 'monthly_payment', 'BOUNCED', 1838.0, '2026-03-01', false),
      pay(15381654, 'monthly_payment', 'RECEIVED', 1838.0, '2026-04-01'),
    ],
  });
  check('red 1 · 1023590 · 2026-03 → finding', r.verdict, S.VERDICT.RED);
  check('red 1 · type is missing 1st-of-month', r.redFlagType, S.RED_TYPE.MISSING_1ST);
  check('red 1 · chain NOT settled (replaced=false)', r.chainSettled, false);
  check('red 1 · next month does not settle this one', r.received, 0);
  check('red 1 · null split falls back to amountValue 1838', r.expected, 1838);
  check('red 1 · termination inside the month keeps it in scope', r.gate, '4');
}

// Contract 1074171 · audited 2026-06 · client 292538 · PRE-COLLECTED (isPreCollectedSalary
// true), advance AED 2,405 dated 01 Oct 2025 on a 01 Sep 2025 contract — a one-off cushion,
// eight months before the audited month, so it cannot cover it.
// This is the regression case: treating an unsettled pre-collected month as inconclusive
// SUPPRESSES a verified red.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-07',
    contract: mv(1074171, 292538, '2025-09-01 08:02:22', plan(2100.0, 305.0, 2405.0, {
      paymentPlan: { additionalDiscount: '', creditNoteDiscount: 'Credit Note Amount: 0 applied on 2-year visa' },
    }), {
      dateOfTermination: '2026-06-14 23:03:55',
      preCollectedInfo: {
        isPreCollectedSalary: true,
        currentPreCollectedPayments: [
          { amount: 'AED 2,405', preCollectedPaymentDate: '01 Oct 2025', status: 'RECEIVED', paymentType: 'Monthly Payment' },
        ],
      },
    }),
    payments: [
      pay(12200570, 'monthly_payment', 'RECEIVED', 2405.0, '2026-05-01'),
      pay(12200576, 'monthly_payment', 'BOUNCED', 2405.0, '2026-06-01', false),
      pay(16942408, 'monthly_payment', 'RECEIVED', 2405.0, '2026-07-01'),
    ],
  });
  check('red 2 · 1074171 · found auditing 2026-07 → finding', r.verdict, S.VERDICT.RED);
  check('red 2 · the month under test is 2026-06', r.monthUnderTest, '2026-06');
  check('red 2 · pre-collected gets the previous-month label', r.redFlagType, S.RED_TYPE.MISSING_PREV);
  check('red 2 · concluded at gate 8, not gate 4', r.gate, '8');
  check('red 2 · gap is the full 2405', r.gap, 2405);

  // THE INTERACTION THAT WOULD SUPPRESS IT: the contract terminated 2026-06-14, so the AUDITED
  // month (July) is past termination. Gate 2 must bound the SHIFTED month, or this red vanishes.
  check('red 2 · survives despite the audited month being past termination', r.gate, '8');

  // And auditing June tests May, which was paid — so June correctly says nothing.
  const juneAudit = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1074171, 292538, '2025-09-01 08:02:22', plan(2100.0, 305.0, 2405.0), {
      dateOfTermination: '2026-06-14 23:03:55',
      preCollectedInfo: { isPreCollectedSalary: true, currentPreCollectedPayments: [
        { amount: 'AED 2,405', preCollectedPaymentDate: '01 Oct 2025', status: 'RECEIVED', paymentType: 'Monthly Payment' }] },
    }),
    payments: [
      pay(12200570, 'monthly_payment', 'RECEIVED', 2405.0, '2026-05-01'),
      pay(12200576, 'monthly_payment', 'BOUNCED', 2405.0, '2026-06-01', false),
    ],
  });
  check('red 2 · auditing June tests May, which was paid → clean', juneAudit.verdict, S.VERDICT.CLEAN);
}

console.log('\n=== TRAP GUARDS ===\n');

// A RECEIVED row can be 0.00. "A RECEIVED row exists" is not "this month was paid".
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000001, 10006, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(16813956, 'monthly_payment', 'RECEIVED', 0.0, '2026-06-01')],
  });
  check('zero-value RECEIVED row does not settle the month', r.verdict, S.VERDICT.RED);
  check('zero-value RECEIVED → timing red, not amount red', r.redFlagType, S.RED_TYPE.MISSING_1ST);
}

// status.value is PDC while status.label is PDP. Testing the label matches nothing,
// silently, forever — which would park every red in pending.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000002, 10007, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(16900001, 'monthly_payment', 'PDC', 1638.0, '2026-06-01')],
  });
  check('in-flight PDC covers the gap → pending', r.verdict, S.VERDICT.PENDING);
  check('in-flight concluded at gate 15', r.gate, '15');
}

// PRE_PDP and any unknown status count as in flight, never as dead.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000003, 10008, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(16900002, 'monthly_payment', 'SOME_NEW_STATUS', 1638.0, '2026-06-01')],
  });
  check('unknown status treated as in flight, not dead', r.verdict, S.VERDICT.PENDING);
}

// In-flight rows from OUTSIDE the audited month must not cover its gap. 117 of contract
// 1099709's rows are future PDC instalments; an unscoped sum parks every red in pending.
{
  const future = [];
  for (let i = 1; i <= 12; i++) {
    future.push(pay(17000000 + i, 'monthly_payment', 'PDC', 1638.0, '2026-' + String(i).padStart(2, '0') + '-01'));
  }
  const rows = future.filter(function (p) { return p.dateOfPayment.slice(0, 7) !== '2026-06'; });
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000004, 10009, '2025-01-01', plan(1470, 168, 1638)),
    payments: rows,
  });
  check('future in-flight rows do NOT cover the audited month', r.verdict, S.VERDICT.RED);
  check('out-of-month in-flight sums to zero', r.inFlight, 0);
}

// Gate 6's Never: never widen the status filter to "RECEIVED or replaced = true".
// A BOUNCED row flagged replaced=true whose successor never reached RECEIVED is a red.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000005, 10010, '2025-01-01', plan(1470, 168, 1638)),
    payments: [
      pay(17100001, 'monthly_payment', 'BOUNCED', 1638.0, '2026-06-01', true),
      pay(17100002, 'monthly_payment', 'BOUNCED', 1638.0, '2026-06-01', false),
    ],
  });
  check('replaced=true without a RECEIVED successor is still a red', r.verdict, S.VERDICT.RED);
}

// Gate 10: an unrecognised payment type is a red flag, never a silent exclusion.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000006, 10011, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(17200001, 'some_unmapped_new_fee', 'RECEIVED', 500.0, '2026-06-01')],
  });
  // The month must NOT close green. Since an unrecognised type is never summed as payment,
  // the month correctly reads unpaid and takes the TIMING red — not the bad-type red, which
  // is now reserved for a genuinely absent type code.
  check('unknown payment type → red, not a green month', r.verdict, S.VERDICT.RED);
  check('unknown type is not summed, so the month reads unpaid', r.received, 0);
  check('unknown type surfaces the code on the case',
    (r.unrecognisedTypeCodes || []).indexOf('some_unmapped_new_fee') !== -1, true);
}

// Gate 9: a null split must not default to zero. Expectation unknown halts the amount test.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000007, 10012, '2025-01-01', {
      currentPayment: { amountValue: null },
      currentPayments: [{ paymentTypeCode: 'monthly_payment', workerSalary: null, visaFees: null, amountValue: null, status: '' }],
    }),
    payments: [pay(17300001, 'monthly_payment', 'RECEIVED', 500.0, '2026-06-01')],
  });
  check('null split does not manufacture a shortfall', r.verdict, S.VERDICT.CLEAN);
  check('null split leaves expected unknown', r.expected, null);
}

// The amount-mismatch shape (gate 17). No verified live red exists for this shape yet —
// this is a synthetic guard, declared as such.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000008, 10013, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(17400001, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
  });
  check('short-paid month → amount-mismatch red', r.verdict, S.VERDICT.RED);
  check('amount red concluded at gate 17', r.gate, '17');
  check('amount red gap is 638', r.gap, 638);
}

// No tolerance: a 1-fil gap flags loud rather than failing silent.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000009, 10014, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(17500001, 'monthly_payment', 'RECEIVED', 1637.99, '2026-06-01')],
  });
  check('a 1-fil shortfall still flags', r.verdict, S.VERDICT.RED);
}

// Gate 13: VIP clears an amount mismatch but must NEVER clear a month nobody paid.
{
  const vipShort = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000010, 10015, '2025-01-01', plan(1470, 168, 1638), { vip: true }),
    payments: [pay(17600001, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
  });
  check('VIP clears a surviving amount mismatch', vipShort.verdict, S.VERDICT.CLEAN_VIP);

  const vipUnpaid = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000011, 10016, '2025-01-01', plan(1470, 168, 1638), { vip: true }),
    payments: [pay(17600002, 'monthly_payment', 'BOUNCED', 1638.0, '2026-06-01', false)],
  });
  check('VIP does NOT clear a month nobody paid', vipUnpaid.verdict, S.VERDICT.RED);

  // vVip alone: conservative default does not clear. Pending Business (Malaz).
  const vvip = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000012, 10017, '2025-01-01', plan(1470, 168, 1638), { vip: false, vVip: true }),
    payments: [pay(17600003, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
  });
  check('vVip alone clears — owner ruled both flags count', vvip.verdict, S.VERDICT.CLEAN_VIP);
  const vvipOn = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000012, 10017, '2025-01-01', plan(1470, 168, 1638), { vip: false, vVip: true }),
    payments: [pay(17600003, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
    options: { vipCountsVVip: false },
  });
  check('the narrow reading is still available as an option', vvipOn.verdict, S.VERDICT.RED);
}

// Gate 14: a ZERO credit note is a non-empty string — a truthy test counts it as relief.
{
  // Real field names, probed live: paymentPlan.additionalDiscount / .creditNoteDiscount.
  const zeroNote = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000013, 10018, '2025-01-01', plan(1470, 168, 1638, {
      paymentPlan: { additionalDiscount: '', creditNoteDiscount: 'Credit Note Amount: 0 applied on 2-year visa' },
    })),
    payments: [pay(17700001, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
  });
  check('a zero credit note is not relief', zeroNote.verdict, S.VERDICT.RED);

  // Relief naming a DIFFERENT bucket must not clear a monthly gap.
  const otherBucket = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000024, 10028, '2025-01-01', plan(1470, 168, 1638, {
      paymentPlan: { additionalDiscount: 'Discount Amount: 5000 applied on 2-year visa', creditNoteDiscount: '' },
    })),
    payments: [pay(17700010, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
  });
  check('relief on another bucket does not clear the monthly gap', otherBucket.verdict, S.VERDICT.RED);
  check('relief on another bucket raises no relief cap', (otherBucket.caps || []).some(function (c) { return /relief prose/.test(c); }), false);

  // Nonzero relief naming the monthly bucket: still a red, but routed to a human. Prose
  // never auto-clears, because no structured source has been located.
  const monthlyProse = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000025, 10029, '2025-01-01', plan(1470, 168, 1638, {
      paymentPlan: { additionalDiscount: 'Discount Amount: 1000 applied on Service Fee over 4 months', creditNoteDiscount: '' },
    })),
    payments: [pay(17700011, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
  });
  check('monthly-bucket relief prose does not auto-clear', monthlyProse.verdict, S.VERDICT.RED);
  check('monthly-bucket relief prose routes to a human', monthlyProse.needsVerifier, true);

  // Match the redemption pointer, not just the contract.
  const otherContract = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000014, 10019, '2025-01-01', plan(1470, 168, 1638), {
      creditNotes: [{ amount: '638', redeemedContractId: 9999999 }],
    }),
    payments: [pay(17700002, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
    options: { useStructuredCreditNotes: true },
  });
  check('a credit note redeemed elsewhere is not relief here', otherContract.verdict, S.VERDICT.RED);

  const covering = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000015, 10020, '2025-01-01', plan(1470, 168, 1638), {
      creditNotes: [{ amount: '638', redeemedContractId: 1000015 }],
    }),
    payments: [pay(17700003, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
    options: { useStructuredCreditNotes: true },
  });
  check('a credit note redeemed on THIS contract covering the gap clears it', covering.verdict, S.VERDICT.CLEAN);
}

// Gate 16: a refund never nets off an uncollected month.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000016, 10021, '2025-01-01', plan(1470, 168, 1638)),
    payments: [
      pay(17800001, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01'),
      pay(17800002, 'refund', 'RECEIVED', 500.0, '2026-06-10'),
    ],
  });
  check('a refund does not reduce the shortfall', r.gap, 638);
  check('a refund is surfaced as context', r.refundPresent, true);
  check('a refund routes the case to a human', r.needsVerifier, true);
}

// Gate 2: months outside the contract's life raise no case; an unreadable end date keeps
// the month IN scope.
{
  const before = S.scoreContractMonth({
    auditedMonth: '2025-01',
    contract: mv(1000017, 10022, '2026-06-26', plan(1470, 168, 1638)),
    payments: [],
  });
  check('month before contract start → no case', before.verdict, S.VERDICT.INCONCLUSIVE);

  const after = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000018, 10023, '2024-01-01', plan(1470, 168, 1638), { dateOfTermination: '2026-03-15' }),
    payments: [],
  });
  check('month after termination → no case', after.verdict, S.VERDICT.INCONCLUSIVE);

  const unreadableEnd = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000019, 10024, '2024-01-01', plan(1470, 168, 1638), { dateOfTermination: null }),
    payments: [pay(17900001, 'monthly_payment', 'BOUNCED', 1638.0, '2026-06-01', false)],
  });
  check('an empty end date keeps the month in scope', unreadableEnd.verdict, S.VERDICT.RED);
}

// Gate 4's Never: an unreadable is_pre_collected halts the case, never defaults to false.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000020, 10025, '2025-01-01', plan(1470, 168, 1638), { preCollectedInfo: {} }),
    payments: [pay(18000001, 'monthly_payment', 'BOUNCED', 1638.0, '2026-06-01', false)],
  });
  check('unreadable is_pre_collected halts rather than red', r.verdict, S.VERDICT.INCONCLUSIVE);
}

// A monthly row with no dateOfPayment must be routed to a human, never counted in-month.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000021, 10026, '2025-01-01', plan(1470, 168, 1638)),
    payments: [
      pay(18100001, 'monthly_payment', 'RECEIVED', 1638.0, null),
      pay(18100002, 'monthly_payment', 'BOUNCED', 1638.0, '2026-06-01', false),
    ],
  });
  check('undated row is not counted in the month', r.received, 0);
  check('undated row routes the case to a human', r.needsVerifier, true);
}

// The company owner's contracts are always excluded from findings.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000022, 24190, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(18200001, 'monthly_payment', 'BOUNCED', 1638.0, '2026-06-01', false)],
  });
  check('company owner excluded from findings', r.verdict, S.VERDICT.INCONCLUSIVE);
}

// Formatted-money parsing: "AED 1,743" must not throw and must not read as 1.
{
  check('parseMoney handles a formatted string', S.parseMoney('AED 1,743'), 1743);
  check('parseMoney rejects an empty value', S.parseMoney(''), null);
  check('parseMoney keeps a real zero', S.parseMoney(0), 0);
}

console.log('\n=== OWNER RULING 1 — small amounts matter, zero does not ===\n');

// "yes even the little amounts Matter, 0 payments do not tho" (owner, 2026-08-19)
{
  // A one-fils shortfall still flags. No floor on small amounts.
  const tiny = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1600001, 25001, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(19900001, 'monthly_payment', 'RECEIVED', 1637.99, '2026-06-01')],
  });
  check('a 1-fil shortfall still opens a case', tiny.verdict, S.VERDICT.RED);
  check('the 1-fil gap is carried and is above zero', tiny.gap > 0 && tiny.gap < 0.02, true);

  // A month where nothing was owed raises no case — nothing at stake.
  const zeroOwed = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1600002, 25002, '2025-01-01', plan(0, 0, 0)),
    payments: [pay(19900002, 'monthly_payment', 'BOUNCED', 0.0, '2026-06-01', false)],
  });
  check('a zero-owed month raises no case', zeroOwed.verdict, S.VERDICT.CLEAN);
  check('and is marked as nothing at stake', zeroOwed.zeroAtStake, true);

  // A BOUNCED row of 0.00 against a REAL plan amount still opens a case: the money at stake is
  // the plan's amount, not the bounced row's. This is the one place the ruling could be read
  // differently, so it is asserted explicitly.
  const zeroRowRealPlan = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1600003, 25003, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(19900003, 'monthly_payment', 'BOUNCED', 0.0, '2026-06-01', false)],
  });
  check('a zero-value BOUNCED row against a real plan still opens a case', zeroRowRealPlan.verdict, S.VERDICT.RED);
  check('and the amount at stake is the plan amount', zeroRowRealPlan.gap, 1638);

  // An unreadable owed amount is never silently dropped by the zero test.
  const unknownOwed = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1600004, 25004, '2025-01-01', {
      currentPayment: { amountValue: null },
      currentPayments: [{ paymentTypeCode: 'monthly_payment', workerSalary: null, visaFees: null, amountValue: null, status: '' }],
    }),
    payments: [pay(19900004, 'monthly_payment', 'BOUNCED', 1638.0, '2026-06-01', false)],
  });
  check('an unreadable owed amount is not dropped as zero', unknownOwed.verdict, S.VERDICT.RED);
}

console.log('\n=== VERIFIER LAYER ===\n');

// Verifier 4's Never: an unread message log is UNKNOWN, not "nobody chased".
{
  const red = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000023, 10027, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(18300001, 'monthly_payment', 'BOUNCED', 1638.0, '2026-06-01', false)],
  });
  const unread = S.applyVerifier(red, { messageLogRead: false }, '2026-08-19');
  check('unread message log blocks the PIL', unread.pilBlocked, true);
  check('unread message log does not clear the finding', unread.verdict, S.VERDICT.RED);

  const explained = S.applyVerifier(red, { messageLogRead: true, explanationForThisMonth: true }, '2026-08-19');
  check('a staff-written reason for THIS month closes it', explained.verdict, S.VERDICT.CLEAN);

  const chased = S.applyVerifier(red, {
    messageLogRead: true, explanationForThisMonth: false, qualifyingFollowupSentDate: '2026-08-15',
  }, '2026-08-19');
  check('recently chased → pending, never the PIL', chased.verdict, S.VERDICT.PENDING);

  const quiet = S.applyVerifier(red, {
    messageLogRead: true, explanationForThisMonth: false, qualifyingFollowupSentDate: '2026-06-01',
  }, '2026-08-19');
  check('chase gone quiet → stays a finding', quiet.verdict, S.VERDICT.RED);
  check('quiet chase concluded at verifier gate 4', quiet.verifierGate, '4');
}

console.log('\n=== FULL PaymentStatus ENUM (14 constants, PaymentStatus.java:15-29) ===\n');

// Every DEAD status must fail to settle AND fail to cover the gap. Before the enum was read,
// five of these were treated as in-flight, which parked a real red in `pending` forever.
{
  const deadStatuses = ['BOUNCED','DELETED','TEARED_UP','RETURNED_TO_CLIENT','UNCOLLECTED',
                        'CANCELLED','CANCELLED_WAITING_CLIENT_PICKUP'];
  deadStatuses.forEach(function (st, i) {
    const r = S.scoreContractMonth({
      auditedMonth: '2026-06',
      contract: mv(1100000 + i, 20000 + i, '2025-01-01', plan(1470, 168, 1638)),
      payments: [pay(19000000 + i, 'monthly_payment', st, 1638.0, '2026-06-01', false)],
    });
    check('dead status ' + st + ' does NOT cover the gap', r.verdict, S.VERDICT.RED);
    check('dead status ' + st + ' contributes nothing in flight', r.inFlight, 0);
  });

  const flightStatuses = ['PDC','PRE_PDP','ADCB_PDC','DEPOSIT','FROZEN','REQUESTED'];
  flightStatuses.forEach(function (st, i) {
    const r = S.scoreContractMonth({
      auditedMonth: '2026-06',
      contract: mv(1200000 + i, 21000 + i, '2025-01-01', plan(1470, 168, 1638)),
      payments: [pay(19100000 + i, 'monthly_payment', st, 1638.0, '2026-06-01', false)],
    });
    check('in-flight status ' + st + ' covers the gap → pending', r.verdict, S.VERDICT.PENDING);
  });

  // A genuinely NEW constant still counts as in flight (gate 15's net), but is surfaced.
  const novel = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1300001, 22001, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(19200001, 'monthly_payment', 'SOME_FUTURE_STATUS', 1638.0, '2026-06-01', false)],
  });
  check('a status outside the enum still counts as in flight', novel.verdict, S.VERDICT.PENDING);
  check('a status outside the enum is surfaced, not hidden',
    (novel.unknownStatuses || []).indexOf('SOME_FUTURE_STATUS') !== -1, true);

  // A dead row replaced by a RECEIVED successor is still settled, whichever dead status.
  const teared = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1300002, 22002, '2025-01-01', plan(1470, 168, 1638)),
    payments: [
      pay(19300001, 'monthly_payment', 'TEARED_UP', 1638.0, '2026-06-01', true),
      pay(19300002, 'monthly_payment', 'RECEIVED', 1638.0, '2026-06-01'),
    ],
  });
  check('a TEARED_UP row replaced by RECEIVED settles the month', teared.verdict, S.VERDICT.CLEAN);
}

console.log('\n=== PAYMENT TYPE CODES (live-observed) ===\n');

// Six legitimate codes were missing from the known set on a 14-contract sample. A blanket red
// on "unrecognised" would have flooded the queue with clean contracts.
{
  const liveCodes = ['insurance','overstay_fee','Urgent_visa_charges','service_charge','oec'];
  liveCodes.forEach(function (code, i) {
    const r = S.scoreContractMonth({
      auditedMonth: '2026-06',
      contract: mv(1400000 + i, 23000 + i, '2025-01-01', plan(1470, 168, 1638)),
      payments: [
        pay(19400000 + i, 'monthly_payment', 'RECEIVED', 1638.0, '2026-06-01'),
        pay(19500000 + i, code, 'RECEIVED', 500.0, '2026-06-01'),
      ],
    });
    check('a live ' + code + ' row does not red a paid month', r.verdict, S.VERDICT.CLEAN);
  });

  // An ABSENT type code is still a red — that is a real data problem.
  const absent = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1500001, 24001, '2025-01-01', plan(1470, 168, 1638)),
    payments: [{ id: 19600001, typeOfPayment: { code: '' }, status: { value: 'RECEIVED' },
                 amountOfPayment: 1638.0, dateOfPayment: '2026-06-01', replaced: false }],
  });
  check('an ABSENT type code is still a red', absent.verdict, S.VERDICT.RED);
  check('absent type carries the right portal type', absent.redFlagType, S.RED_TYPE.BAD_TYPE);

  // An unrecognised-but-present code is surfaced on the case, never a blanket red.
  const novelType = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1500002, 24002, '2025-01-01', plan(1470, 168, 1638)),
    payments: [
      pay(19700001, 'monthly_payment', 'RECEIVED', 1638.0, '2026-06-01'),
      pay(19700002, 'brand_new_fee_type', 'RECEIVED', 99.0, '2026-06-01'),
    ],
  });
  check('an unrecognised code does not red a paid month', novelType.verdict, S.VERDICT.CLEAN);
  check('an unrecognised code is surfaced on the case',
    (novelType.unrecognisedTypeCodes || []).indexOf('brand_new_fee_type') !== -1, true);
  check('an unrecognised code is never summed as payment', novelType.received, 1638);

  // The live refund code must still be caught by refund detection.
  const refund = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1500003, 24003, '2025-01-01', plan(1470, 168, 1638)),
    payments: [
      pay(19800001, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01'),
      pay(19800002, 'non-mp-refund', 'RECEIVED', 500.0, '2026-06-10'),
    ],
  });
  check('the live non-mp-refund code is detected as a refund', refund.refundPresent, true);
  check('a refund still does not reduce the shortfall', refund.gap, 638);
}

console.log('\n=== VERIFIER RULE 3 — FOLLOW-UP CLASSIFICATION (live template names) ===\n');

// Template names and deliveryStatus values below were all observed live 2026-08-19 on the
// WhatsApp channel of a client carrying a confirmed red.
{
  const wa = function (templateName, deliveryStatus, sentDate) {
    return { templateName: templateName, deliveryStatus: deliveryStatus, sentDate: sentDate };
  };

  // Genuine chases.
  check('a bounced-payment template is a chase',
    S.classifyFollowup(wa('Accounting_dd_messaging_setup_clientBouncedPayment', 'DELIVERED', '2026-08-15 10:00:00')).qualifies, true);
  check('a payment-approval request is a chase',
    S.classifyFollowup(wa('MV_PAYMENT_FOR_APPROVAL_REQUEST_FROM_ERP', 'READ', '2026-08-15 10:00:00')).qualifies, true);

  // THE TRAP: a receipt contains "PAYMENT" but is not a chase. Counting it suppresses a red.
  check('a payment RECEIVED notification is NOT a chase',
    S.classifyFollowup(wa('MV_PAYMENT_RECEIVED_NOTIFICATION', 'DELIVERED', '2026-08-18 10:00:00')).qualifies, false);

  // Marketing / campaigns / broadcasts — the rule's own named failure.
  check('a client broadcast is not a chase',
    S.classifyFollowup(wa('CM_CLIENT_BROADCAST_104196', 'DELIVERED', '2026-08-18 10:00:00')).qualifies, false);
  check('a pre-sale CRM campaign is not a chase',
    S.classifyFollowup(wa('PRE_SALE_CRM_CAMPAIGN_ACTION_199_233', 'READ', '2026-08-18 10:00:00')).qualifies, false);
  check('a birthday reminder is not a chase',
    S.classifyFollowup(wa('MAID_BIRTHDAY_REMINDER_FOR_CLIENT', 'DELIVERED', '2026-08-18 10:00:00')).qualifies, false);
  check('an OTP is not a chase',
    S.classifyFollowup(wa('CM_PORTAL_WHATSAPP_OTP_1', 'DELIVERED', '2026-08-18 10:00:00')).qualifies, false);

  // A row is not a delivery.
  check('a FAILED chase does not count',
    S.classifyFollowup(wa('Accounting_dd_messaging_setup_clientBouncedPayment', 'FAILED', '2026-08-18 10:00:00')).qualifies, false);
  check('a SKIPPED chase does not count',
    S.classifyFollowup(wa('Accounting_dd_messaging_setup_clientBouncedPayment', 'SKIPPED', '2026-08-18 10:00:00')).qualifies, false);
  check('a chase with no sentDate does not count',
    S.classifyFollowup(wa('Accounting_dd_messaging_setup_clientBouncedPayment', 'DELIVERED', null)).qualifies, false);

  // Bare numeric template ids are real and unclassifiable — must not count as chasing.
  check('an unclassifiable numeric template id is not a chase',
    S.classifyFollowup(wa('669348018255590', 'DELIVERED', '2026-08-18 10:00:00')).qualifies, false);

  // Newest qualifying chase wins, and ONLY a date comes back.
  const picked = S.lastQualifyingFollowup([
    wa('MV_PAYMENT_RECEIVED_NOTIFICATION', 'DELIVERED', '2026-08-18 09:00:00'),
    wa('Accounting_dd_messaging_setup_clientBouncedPayment', 'DELIVERED', '2026-08-10 09:00:00'),
    wa('CM_CLIENT_BROADCAST_104196', 'READ', '2026-08-17 09:00:00'),
    wa('MV_PAYMENT_FOR_APPROVAL_REQUEST_FROM_ERP', 'RESPONDED', '2026-08-14 09:00:00'),
  ]);
  check('newest QUALIFYING chase wins, not the newest message', picked.lastFollowupDate, '2026-08-14');
  check('only a date is returned', typeof picked.lastFollowupDate, 'string');

  // End to end: a red whose only recent messages are marketing stays red.
  const red = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000030, 10030, '2025-01-01', plan(1470, 168, 1638)),
    payments: [pay(18400001, 'monthly_payment', 'BOUNCED', 1638.0, '2026-06-01', false)],
  });
  const marketingOnly = S.lastQualifyingFollowup([
    wa('CM_CLIENT_BROADCAST_104196', 'DELIVERED', '2026-08-18 09:00:00'),
  ]);
  const v = S.applyVerifier(red, {
    messageLogRead: true, explanationForThisMonth: false,
    qualifyingFollowupSentDate: marketingOnly.lastFollowupDate,
  }, '2026-08-19');
  check('marketing-only contact does not suppress the finding', v.verdict, S.VERDICT.RED);
  check('marketing-only contact concludes at verifier gate 4', v.verifierGate, '4');
}

console.log('\n' + '='.repeat(60));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(60));
if (fail) {
  console.log('\nFAILURES:\n');
  failures.forEach(function (f) { console.log('  - ' + f + '\n'); });
  process.exit(1);
}
