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
  const rows = [
    pay(7711064, 'monthly_payment', 'BOUNCED', 2568.0, '2025-04-01', true),
    pay(10168143, 'monthly_payment', 'RECEIVED', 2568.0, '2025-04-01'),
  ];
  const r = S.scoreContractMonth({ auditedMonth: '2025-04', contract: c, payments: rows });
  check('case 2 · 1053569 · 2025-04 → clean', r.verdict, S.VERDICT.CLEAN);
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
  const r = S.scoreContractMonth({ auditedMonth: '2026-06', contract: c, payments: june });
  check('case 3 · 1099709 · 2026-06 → clean', r.verdict, S.VERDICT.CLEAN);
  check('case 3 · June sums to 168, not 1743', r.received, 168);
  check('case 3 · recognised as the first partial month', r.isStartMonth, true);
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
  const july = S.scoreContractMonth({
    auditedMonth: '2026-07', contract: c,
    payments: [pay(16337774, 'monthly_payment', 'RECEIVED', 1638.0, '2026-07-01')],
  });
  check('case 5 · 1099709 · 2026-07 → clean at full amount', july.verdict, S.VERDICT.CLEAN);
  check('case 5 · July expected 1638', july.expected, 1638);

  // The trap itself: June must NOT be scored against 1,638.
  const juneOnly = S.scoreContractMonth({
    auditedMonth: '2026-06', contract: c,
    payments: [pay(16355526, 'monthly_payment', 'RECEIVED', 168.0, '2026-06-26')],
  });
  check('case 5 · June does NOT invent a 1470 shortfall', juneOnly.verdict, S.VERDICT.CLEAN);
  check('case 5 · June raises no amount-mismatch red', juneOnly.redFlagType, undefined);
}

console.log('\n=== THE TWO CONFIRMED REDS (2026-08-17) ===\n');

// Contract 1023590 · due 2026-03 · one monthly_payment row, BOUNCED, replaced=false,
// AED 1,838, zero received. The client paid the FOLLOWING month, so this is not
// termination. replaced=false is the discriminator against case 2.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-03',
    contract: mv(1023590, 10004, '2025-06-01', plan(1670, 168, 1838)),
    payments: [
      pay(90001, 'monthly_payment', 'BOUNCED', 1838.0, '2026-03-01', false),
      pay(90002, 'monthly_payment', 'RECEIVED', 1838.0, '2026-04-01'),
    ],
  });
  check('red 1 · 1023590 · 2026-03 → finding', r.verdict, S.VERDICT.RED);
  check('red 1 · type is missing 1st-of-month', r.redFlagType, S.RED_TYPE.MISSING_1ST);
  check('red 1 · chain NOT settled (replaced=false)', r.chainSettled, false);
  check('red 1 · next month does not settle this one', r.received, 0);
}

// Contract 1074171 · due 2026-06 · same shape, AED 2,405.
{
  const r = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1074171, 10005, '2025-03-01', plan(2237, 168, 2405)),
    payments: [
      pay(91001, 'monthly_payment', 'BOUNCED', 2405.0, '2026-06-01', false),
      pay(91002, 'monthly_payment', 'RECEIVED', 2405.0, '2026-07-01'),
    ],
  });
  check('red 2 · 1074171 · 2026-06 → finding', r.verdict, S.VERDICT.RED);
  check('red 2 · gap is the full 2405', r.gap, 2405);
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
  check('unknown payment type → red, not a green month', r.verdict, S.VERDICT.RED);
  check('unknown type red carries the right portal type', r.redFlagType, S.RED_TYPE.BAD_TYPE);
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
  check('vVip alone does not clear under the conservative default', vvip.verdict, S.VERDICT.RED);
  const vvipOn = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000012, 10017, '2025-01-01', plan(1470, 168, 1638), { vip: false, vVip: true }),
    payments: [pay(17600003, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
    options: { vipCountsVVip: true },
  });
  check('vVip clears once the owner rules it in', vvipOn.verdict, S.VERDICT.CLEAN_VIP);
}

// Gate 14: a ZERO credit note is a non-empty string — a truthy test counts it as relief.
{
  const zeroNote = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000013, 10018, '2025-01-01', plan(1470, 168, 1638), {
      creditNotes: [{ amount: '0', redeemedContractId: 1000013 }],
    }),
    payments: [pay(17700001, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
  });
  check('a zero credit note is not relief', zeroNote.verdict, S.VERDICT.RED);

  // Match the redemption pointer, not just the contract.
  const otherContract = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000014, 10019, '2025-01-01', plan(1470, 168, 1638), {
      creditNotes: [{ amount: '638', redeemedContractId: 9999999 }],
    }),
    payments: [pay(17700002, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
  });
  check('a credit note redeemed elsewhere is not relief here', otherContract.verdict, S.VERDICT.RED);

  const covering = S.scoreContractMonth({
    auditedMonth: '2026-06',
    contract: mv(1000015, 10020, '2025-01-01', plan(1470, 168, 1638), {
      creditNotes: [{ amount: '638', redeemedContractId: 1000015 }],
    }),
    payments: [pay(17700003, 'monthly_payment', 'RECEIVED', 1000.0, '2026-06-01')],
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

console.log('\n' + '='.repeat(60));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(60));
if (fail) {
  console.log('\nFAILURES:\n');
  failures.forEach(function (f) { console.log('  - ' + f + '\n'); });
  process.exit(1);
}
