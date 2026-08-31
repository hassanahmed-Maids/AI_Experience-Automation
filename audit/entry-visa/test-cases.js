'use strict';
/**
 * Entry Visa Audit — offline test harness.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE OF THESE FIXTURES — READ THIS FIRST
 * ---------------------------------------------------------------------------
 * These are RECONSTRUCTED from the payload details the Notion spec records as having
 * been read live from ERP on 2026-08-20. They are NOT a live ERP read made by this
 * harness, and no live ERP call has been made for them in this session.
 *
 * That distinction matters and must not be quietly lost: a fixture derived from the
 * spec can only ever prove that the SCORER agrees with the SPEC. It cannot prove the
 * spec agrees with ERP. Confirming that is Phase 2's job and needs a live token.
 *
 * Where the spec records a field, it is used verbatim. Where the spec is silent on a
 * field the scorer needs (a charge's own transaction date, say), a value consistent
 * with the spec's narrative is supplied and marked ASSUMED in the fixture note.
 * Assumed values are never load-bearing for the expected verdict.
 */

const S = require('./scorer.js');

const AS_OF = '2026-08-20';

// ---------------------------------------------------------------------------
// Fixture builders — keep the cases readable
// ---------------------------------------------------------------------------
let nextLineId = 1000;
function charge(purpose, amount, txnDate, opts) {
  const o = opts || {};
  return {
    id: o.id || nextLineId++,
    purpose: purpose,
    status: o.status || S.EXPENSE_STATUS.ADDED,
    amount: amount,
    transactionId: o.transactionId === undefined ? (o.status === S.EXPENSE_STATUS.PENDING ? null : 9000 + nextLineId) : o.transactionId,
    transactionDate: txnDate,
    paymentDate: o.paymentDate === undefined ? null : o.paymentDate
  };
}
function refund(amount, txnDate, opts) {
  const o = opts || {};
  return {
    id: o.id || nextLineId++,
    purpose: o.purpose || 'Refund For Entry Visa',
    status: o.status || S.EXPENSE_STATUS.ADDED,
    amount: amount,
    transactionId: o.transactionId === undefined ? 9500 + nextLineId : o.transactionId,
    transactionDate: txnDate,
    paymentDate: o.paymentDate === undefined ? null : o.paymentDate
  };
}
const HIGH = 'Entry Visa > 1000 AED';
const LOW  = 'Entry Visa < 1000 AED';

// ---------------------------------------------------------------------------
// The seven spec test cases
// ---------------------------------------------------------------------------

const CASES = [];

CASES.push({
  name: 'TC1 · request 91412 — the stuck claim',
  note: 'Spec: charged 1,054.71, rejected 2025-10-27 17:19:57, refund step closed in 26 minutes, ' +
        'and the Refund For Entry Visa line of -739.50 is STILL status Pending 297 days later while ' +
        'refundedStatus reads true and the request reads finished. ASSUMED: charge 1 dated 2025-10-23 ' +
        '(the spec records "Apply for entry Visa" opening 2025-10-23 06:54).',
  input: { requests: [{
    requestId: 91412, ownerId: 110179, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2025-10-27 17:19:57'],
    expenses: [
      charge(HIGH, 1054.71, '2025-10-23 06:54:00', { id: 1 }),
      refund(-739.50, '2025-10-27 00:00:00', { id: 2, status: S.EXPENSE_STATUS.PENDING, transactionId: null, paymentDate: '2025-10-27 00:00:00' }),
      charge(HIGH, 1022.50, '2025-10-27 17:50:52', { id: 3 }),
      // Noise that must be ignored: other visa costs on the same request.
      { id: 4, purpose: 'Medical', status: 'Added', amount: 270.00, transactionId: 111, transactionDate: '2025-10-24' },
      { id: 5, purpose: 'R-Visa', status: 'Added', amount: 443.50, transactionId: 112, transactionDate: '2025-11-02' }
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.charge_cases, 2, 'two charge-grain cases');
    const f = byChargeId(r.charge_cases, 1);
    eq(f.gate, 7, 'charge 1 settles at gate 7');
    eq(f.verdict, S.VERDICT.FINDING, 'charge 1 is a finding');
    eq(f.evidence.finding_shape, 'claimed_never_paid', 'the stuck-claim shape');
    eq(f.recoverable, 739.50, 'valued at the HIGH refundable constant');
    eq(f.evidence.refundedStatus_deliberately_ignored, true, 'refundedStatus is never gated on');
    eq(f.evidence.premature_by_abandonment, false, 'not premature — 297 days elapsed');
    const c = byChargeId(r.charge_cases, 3);
    eq(c.gate, 5, 'charge 3 settles at gate 5');
    eq(c.verdict, S.VERDICT.CLEAN, 'charge 3 is the application that worked');
    assertCount(r.pair_cases, 0, 'no pair-grain case — both charges are the same type');
  }
});

CASES.push({
  name: 'TC2 · request 90564 — never filed',
  note: 'Spec: charged 1,054.71, entryVisaImmigrationApproved = Rejected, refundedStatus = false, ' +
        'stopped = true. Refund step opened 2025-12-02 12:57:58 and closed 2025-12-06 15:46:19, and NO ' +
        'refund line was ever created on the request at all. ASSUMED: charge dated 2025-11-28.',
  input: { requests: [{
    requestId: 90564, ownerId: 109230, ownerType: 'HOUSEMAID',
    stopped: true, taskName: 'Waiting for reply of Ansari',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2025-12-02 12:57:58'],
    expenses: [
      charge(HIGH, 1054.71, '2025-11-28 00:00:00', { id: 10 }),
      { id: 11, purpose: 'MOHRE Insurance', status: 'Added', amount: 189.00, transactionId: 120, transactionDate: '2025-11-28' }
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.charge_cases, 1, 'one charge-grain case');
    const f = r.charge_cases[0];
    eq(f.gate, 7, 'gate 7');
    eq(f.verdict, S.VERDICT.FINDING, 'a finding');
    eq(f.evidence.finding_shape, 'never_filed', 'the never-filed shape');
    eq(f.recoverable, 739.50, 'valued at the HIGH constant');
    eq(f.evidence.premature_by_abandonment, false, 'abandoned, but 261 days have elapsed');
  }
});

CASES.push({
  name: 'TC3 · request 114521 — abandoned INSIDE the refund step after 27 days',
  note: 'Spec, corrected: Rejected, refund line -739.50 at Pending, 27 days elapsed, stopped = TRUE and ' +
        'the request abandoned while sitting in Refund Entry Visa Application. The expected verdict was ' +
        'WRONG in an earlier spec version and is now FINDING — gate 7 reds it because abandonment alone ' +
        'satisfies the condition, and the missing minimum-elapsed guard is logged as a defect.',
  input: { requests: [{
    requestId: 114521, ownerId: 135387, ownerType: 'HOUSEMAID',
    stopped: true, taskName: 'Refund Entry Visa Application',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-07-24 19:31:13'],
    expenses: [
      charge(HIGH, 1054.71, '2026-07-20 00:00:00', { id: 20 }),
      refund(-739.50, null, { id: 21, status: S.EXPENSE_STATUS.PENDING, transactionId: null })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.charge_cases, 1, 'one charge-grain case');
    const f = r.charge_cases[0];
    eq(f.gate, 7, 'gate 7');
    eq(f.verdict, S.VERDICT.FINDING, 'a finding — the corrected expectation');
    eq(f.evidence.finding_shape, 'claimed_never_paid', 'the claim exists but is stuck');
    eq(f.evidence.premature_by_abandonment, true, 'PREMATURE: 27 days < the 60-day window');
    eq(f.defect, 'GATE-7-NO-MINIMUM-ELAPSED-GUARD', 'the defect is carried on the case');
    truthy(r.declared_gaps.some(function (g) { return g.id === 'GATE-7-NO-MINIMUM-ELAPSED-GUARD'; }),
      'and declared in the run summary rather than absorbed');
  }
});

CASES.push({
  name: 'TC4 · request 115431 — a refund Added against a charge never paid',
  note: 'Spec: the original claim (a refund with NO charge) was FALSE. A charge does exist — Entry Visa ' +
        '< 1000 AED 372.50 at status Pending — invisible to a population requiring Added + a transaction ' +
        'id. The real anomaly is an 89.50 refund Added against a charge that was never paid.',
  input: { requests: [{
    requestId: 115431, ownerId: 136001, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-06-01 10:00:00'],
    expenses: [
      charge(LOW, 372.50, null, { id: 30, status: S.EXPENSE_STATUS.PENDING, transactionId: null }),
      refund(89.50, '2026-06-01 12:00:00', { id: 31 })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.charge_cases, 1, 'one case, from gate 12 — the Pending charge is not scored as paid');
    const f = r.charge_cases[0];
    eq(f.gate, 12, 'gate 12');
    eq(f.verdict, S.VERDICT.VERIFIER, 'routed, never scored');
    eq(f.evidence.charges_pending_unpaid, 1, 'the Pending charge IS counted, so this is not called an orphan');
    truthy(/NEVER PAID/.test(f.why), 'and the why-text says what is actually strange about it');
  }
});

CASES.push({
  name: 'TC5 · request 115840 — one request, three verdicts',
  note: 'Spec: outside 372.50 -> rejected -> refunded 89.50 (same day) -> re-applied inside 1,022.50 -> ' +
        'Approved. Yields exactly TWO charge-grain cases, both clean (372.50 at gate 6, 1,022.50 at ' +
        'gate 5), PLUS a gate-14 pair-grain finding. This is what the two-grain design exists for.',
  input: { requests: [{
    requestId: 115840, ownerId: 136400, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-01-12 09:00:00'],
    expenses: [
      charge(LOW, 372.50, '2026-01-10 00:00:00', { id: 40 }),
      refund(89.50, '2026-01-12 11:00:00', { id: 41 }),
      charge(HIGH, 1022.50, '2026-01-13 00:00:00', { id: 42 })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.charge_cases, 2, 'exactly two charge-grain cases');
    const a = byChargeId(r.charge_cases, 40);
    eq(a.gate, 6, 'the 372.50 settles at gate 6');
    eq(a.verdict, S.VERDICT.CLEAN, 'refunded in time');
    const b = byChargeId(r.charge_cases, 42);
    eq(b.gate, 5, 'the 1,022.50 settles at gate 5');
    eq(b.verdict, S.VERDICT.CLEAN, 'the application that worked');
    assertCount(r.pair_cases, 1, 'exactly one pair-grain case');
    eq(r.pair_cases[0].gate, 14, 'gate 14');
    eq(r.pair_cases[0].verdict, S.VERDICT.FINDING, 'a wrong-type finding');
    eq(r.pair_cases[0].evidence.direction, 'outside -> rejected -> inside', 'the mirror error, four times more common than the SOP story');
  }
});

CASES.push({
  name: 'TC6 · request 114752 — NOT a duplicate (the false-negative history)',
  note: 'Spec, ERP-confirmed: two identical 1,022.50 charges 32 days apart and ZERO Rejected rows in ' +
        'the history table — which is how it passed the no-rejection-between test — while a ' +
        'Refund For Entry Visa of -739.50 was taken Added on 2026-07-10, BETWEEN the two charges. ' +
        'An ordinary reject-refund-recharge cycle, not a duplicate. Severity-1: the rejection history ' +
        'has false negatives, so gate 13 needs the second test.',
  input: { requests: [{
    requestId: 114752, ownerId: 135364, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: [],                    // <-- the false negative, verbatim
    expenses: [
      charge(HIGH, 1022.50, '2026-06-15 00:00:00', { id: 50 }),
      refund(-739.50, '2026-07-10 00:00:00', { id: 51 }),
      charge(HIGH, 1022.50, '2026-07-17 00:00:00', { id: 52 })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.pair_cases, 0, 'NO duplicate finding — the Added refund between the charges proves a rejection the history did not record');
    assertCount(r.charge_cases, 0, 'and no charge-grain cases either: with no rejection event the request is outside the refund family');
  }
});

CASES.push({
  name: 'TC7 · request 92147 — the SOP story, and the AED 283.00 figure',
  note: 'Spec, ERP-confirmed: inside 1,022.50 paid 2025-10-31, rejected, refund step 2025-11-01 ' +
        '10:24-11:30, 739.50 refunded Added, then outside 372.50 submitted the same day. The wasted ' +
        'amount is 1,022.50 - 739.50 = AED 283.00 — precisely Khalil section 5.2\'s "≈283 lost". ' +
        'Reproducing that figure independently is the strongest signal the logic is right.',
  input: { requests: [{
    requestId: 92147, ownerId: 110942, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2025-11-01 10:24:00'],
    expenses: [
      charge(HIGH, 1022.50, '2025-10-31 00:00:00', { id: 60 }),
      refund(-739.50, '2025-11-01 11:30:00', { id: 61 }),
      charge(LOW, 372.50, '2025-11-01 14:00:00', { id: 62 })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.charge_cases, 2, 'two charge-grain cases');
    eq(byChargeId(r.charge_cases, 60).gate, 6, 'the 1,022.50 was refunded in time');
    eq(byChargeId(r.charge_cases, 60).verdict, S.VERDICT.CLEAN, 'so it is clean at the charge grain');
    eq(byChargeId(r.charge_cases, 62).gate, 5, 'the 372.50 is the application that worked');
    assertCount(r.pair_cases, 1, 'one pair-grain finding');
    eq(r.pair_cases[0].gate, 14, 'gate 14 — wrong type');
    eq(r.pair_cases[0].evidence.direction, 'inside -> rejected -> outside', 'the SOP\'s own direction');
    eq(r.pair_cases[0].wasted, 283.00, 'AED 283.00 — the non-refundable remainder, matching the SOP independently');
    truthy(r.pair_cases[0].dependsOnOpenRuling !== null, 'and flagged as depending on open ruling 1');
  }
});

// ---------------------------------------------------------------------------
// Guards for each edge the rules explicitly name
// ---------------------------------------------------------------------------

CASES.push({
  name: 'GUARD · a refund dated long BEFORE the rejection belongs to a previous cycle',
  note: 'Gate 6: of 62 requests whose only refund pre-dates the rejection, just 11 are within 7 days; ' +
        'the other 51 are 11-462 days earlier. Accepting those would clear a live loss.',
  input: { requests: [{
    requestId: 70001, ownerId: 700, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-05-01 00:00:00'],
    expenses: [
      charge(HIGH, 1054.71, '2026-04-25 00:00:00', { id: 70 }),
      refund(-739.50, '2026-01-01 00:00:00', { id: 71 })   // 120 days BEFORE the rejection
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    eq(r.charge_cases[0].gate, 7, 'the stale refund does NOT clear it — gate 7 reds');
    eq(r.charge_cases[0].verdict, S.VERDICT.FINDING, 'a finding');
  }
});

CASES.push({
  name: 'GUARD · a refund 3 days before the rejection IS booking skew and does clear',
  input: { requests: [{
    requestId: 70002, ownerId: 701, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-05-01 00:00:00'],
    expenses: [
      charge(HIGH, 1054.71, '2026-04-25 00:00:00', { id: 72 }),
      refund(-739.50, '2026-04-28 00:00:00', { id: 73 })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    eq(r.charge_cases[0].gate, 6, 'inside the 7-day booking-skew tolerance');
    eq(r.charge_cases[0].verdict, S.VERDICT.CLEAN, 'clean');
  }
});

CASES.push({
  name: 'GUARD · a CANCEL-SIDE refund counts (243 refunds hang off the cancellation request)',
  note: 'Gate 4: joining refunds only on the new-request id raises 243 findings against money we DID get back.',
  input: { requests: [{
    requestId: 70003, ownerId: 702, ownerType: 'HOUSEMAID',
    stopped: true, taskName: 'Pending to cancel active visa',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-03-01 00:00:00'],
    expenses: [ charge(HIGH, 1054.71, '2026-02-25 00:00:00', { id: 74 }) ],
    cancelSideRefunds: [ refund(-739.50, '2026-03-02 00:00:00', { id: 75 }) ]
  }]},
  expect: function (r) {
    eq(r.charge_cases[0].gate, 6, 'the cancel-side refund clears it');
    eq(r.charge_cases[0].evidence.channel, 'CancelRequest', 'and the channel is recorded');
  }
});

CASES.push({
  name: 'GUARD · REFUND_MEDICAL_APPLICATION_FEES must NOT clear an entry-visa charge',
  note: 'It sits in the SAME expenses[] array with 1,335 Added rows and belongs to a check whose window ' +
        'is 90 days, not 60. A contains("REFUND") filter pulls it in and silently clears real findings.',
  input: { requests: [{
    requestId: 70004, ownerId: 703, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-03-01 00:00:00'],
    expenses: [
      charge(HIGH, 1054.71, '2026-02-25 00:00:00', { id: 76 }),
      refund(-739.50, '2026-03-02 00:00:00', { id: 77, purpose: 'Refund Medical Application Fees' })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    eq(r.charge_cases[0].gate, 7, 'the medical refund is not this check\'s refund');
    eq(r.charge_cases[0].verdict, S.VERDICT.FINDING, 'so the case is still a finding');
  }
});

CASES.push({
  name: 'GUARD · a POSITIVE refund amount still counts (never decide a refund by its sign)',
  note: 'Gate 4: REFUND_FOR_ENTRY_VISA on the new-request side ranges from -1,022.50 to +739.50.',
  input: { requests: [{
    requestId: 70005, ownerId: 704, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-03-01 00:00:00'],
    expenses: [
      charge(HIGH, 1054.71, '2026-02-25 00:00:00', { id: 78 }),
      refund(+739.50, '2026-03-02 00:00:00', { id: 79 })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) { eq(r.charge_cases[0].gate, 6, 'the positive-signed refund clears it'); }
});

CASES.push({
  name: 'GUARD · an Added charge with NO transaction id is not in the population',
  note: 'Gate 1: 1,995 Added charge lines carry no transaction id. Added is not proof money moved.',
  input: { requests: [{
    requestId: 70006, ownerId: 705, ownerType: 'HOUSEMAID',
    stopped: true, taskName: 'x', identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-03-01 00:00:00'],
    expenses: [ charge(HIGH, 1054.71, '2026-02-25', { id: 80, transactionId: null }) ],
    cancelSideRefunds: []
  }]},
  expect: function (r) { assertCount(r.charge_cases, 0, 'no case — no proof money moved'); }
});

CASES.push({
  name: 'GUARD · a Dismissed refund routes to the verifier, never scores',
  note: 'Gate 7: 69 requests, the largest of the three shapes. Only a human can say whether ' +
        'withdrawing the claim was right.',
  input: { requests: [{
    requestId: 70007, ownerId: 706, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-03-01 00:00:00'],
    expenses: [
      charge(HIGH, 1054.71, '2026-02-25 00:00:00', { id: 81 }),
      refund(-739.50, null, { id: 82, status: S.EXPENSE_STATUS.DISMISSED, transactionId: null })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    eq(r.charge_cases[0].verdict, S.VERDICT.VERIFIER, 'routed');
    eq(r.charge_cases[0].evidence.finding_shape, 'claim_dismissed', 'the dismissed shape');
    eq(r.charge_cases[0].recoverable, null, 'and deliberately unvalued');
  }
});

CASES.push({
  name: 'GUARD · purpose and amount band disagreeing routes instead of being valued',
  note: 'Gate 10: 22 charge lines of 1,022.50 are booked under the purpose named ' +
        'ENTRY_VISA_LESS_THAN_1000, so the purpose contradicts its own amount.',
  input: { requests: [{
    requestId: 70008, ownerId: 707, ownerType: 'HOUSEMAID',
    stopped: true, taskName: 'x', identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-03-01 00:00:00'],
    expenses: [ charge(LOW, 1022.50, '2026-02-25 00:00:00', { id: 83 }) ],   // LOW purpose, HIGH amount
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    eq(r.charge_cases[0].verdict, S.VERDICT.FINDING, 'still a finding');
    eq(r.charge_cases[0].recoverable, null, 'but UNVALUED');
    truthy(/disagree/.test(r.charge_cases[0].valuationBasis), 'and the basis says why');
  }
});

CASES.push({
  name: 'GUARD · an unresolved identity routes and is never dropped',
  input: { requests: [{
    requestId: 70009, ownerId: 708, ownerType: 'HOUSEMAID',
    stopped: true, taskName: 'x', identityAgrees: false, everRejectedKnown: true,
    rejectionDates: ['2026-03-01 00:00:00'],
    expenses: [ charge(HIGH, 1054.71, '2026-02-25 00:00:00', { id: 84 }) ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    eq(r.charge_cases[0].gate, 2, 'gate 2 runs before any status or amount is read');
    eq(r.charge_cases[0].verdict, S.VERDICT.VERIFIER, 'routed, not dropped');
  }
});

CASES.push({
  name: 'GUARD · gate 13 sees duplicates on requests that were NEVER rejected (the wider scope)',
  note: 'Scoping gate 13 behind the rejection filter hid 134 of 176 duplicate-shaped pairs worth ' +
        'AED 92,247.32, including the 62 cleanest ones.',
  input: { requests: [{
    requestId: 70010, ownerId: 709, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: [],                              // never rejected
    expenses: [
      charge(HIGH, 1022.50, '2026-02-01 00:00:00', { id: 85 }),
      charge(HIGH, 1022.50, '2026-02-20 00:00:00', { id: 86 })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.charge_cases, 0, 'outside the refund family, so no charge-grain cases');
    assertCount(r.pair_cases, 1, 'but gate 13 still sees it');
    eq(r.pair_cases[0].verdict, S.VERDICT.FINDING, 'a duplicate finding');
    eq(r.pair_cases[0].wasted, 1022.50, 'valued at the duplicate charge IN FULL, not a refundable constant');
  }
});

CASES.push({
  name: 'GUARD · gate 13 emits ONE case per pair, not two (the double-count bug)',
  note: 'The earlier self-join used b.id <> a.id, which emits BOTH orderings whenever two charges share ' +
        'a date — so every same-day figure was DOUBLED. "22 pairs, AED 22,495" was really 11 pairs.',
  input: { requests: [{
    requestId: 70011, ownerId: 710, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: [],
    expenses: [
      charge(HIGH, 1022.50, '2026-04-21 00:00:00', { id: 87 }),
      charge(HIGH, 1022.50, '2026-04-21 00:00:00', { id: 88 })   // SAME DAY, same amount
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.pair_cases, 1, 'exactly ONE case, not two');
    eq(r.pair_cases[0].evidence.same_day, true, 'and it is the same-day shape');
  }
});

CASES.push({
  name: 'GUARD · gate 13 spans REQUESTS, because its key is the person',
  note: 'The rule is "the same maid charged twice", not "the same request".',
  input: { requests: [
    { requestId: 70012, ownerId: 711, ownerType: 'HOUSEMAID', stopped: false, taskName: 'Visa processing complete',
      identityAgrees: true, everRejectedKnown: true, rejectionDates: [],
      expenses: [ charge(HIGH, 1022.50, '2026-02-01 00:00:00', { id: 89 }) ], cancelSideRefunds: [] },
    { requestId: 70013, ownerId: 711, ownerType: 'HOUSEMAID', stopped: false, taskName: 'Visa processing complete',
      identityAgrees: true, everRejectedKnown: true, rejectionDates: [],
      expenses: [ charge(HIGH, 1022.50, '2026-02-15 00:00:00', { id: 90 }) ], cancelSideRefunds: [] }
  ]},
  expect: function (r) {
    assertCount(r.pair_cases, 1, 'one cross-request duplicate');
    eq(r.pair_cases[0].evidence.cross_request, true, 'flagged as cross-request');
  }
});

CASES.push({
  name: 'GUARD · same-day DIFFERENT amounts route to the verifier, never score',
  note: 'Gate 13: 8 pairs across 4 people, spanning 89.50 to 1,025.65 — could be component lines of one fee.',
  input: { requests: [{
    requestId: 70014, ownerId: 712, ownerType: 'HOUSEMAID', stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true, rejectionDates: [],
    expenses: [
      charge(HIGH, 1025.65, '2026-04-21 00:00:00', { id: 91 }),
      charge(LOW, 89.50, '2026-04-21 00:00:00', { id: 92 })
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.pair_cases, 1, 'one case');
    eq(r.pair_cases[0].verdict, S.VERDICT.VERIFIER, 'routed, not scored');
  }
});

CASES.push({
  name: 'GUARD · silence is pending — an unreadable `stopped` parks at gate 8, never reds',
  note: 'Gate 7: "Never let the default reach this gate as a red." An unreadable stopped defaults to ' +
        'false without the completion task name, which sends the case to gate 8.',
  input: { requests: [{
    requestId: 70015, ownerId: 713, ownerType: 'HOUSEMAID',
    stopped: null, taskName: null,                     // unreadable
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-03-01 00:00:00'],
    expenses: [ charge(HIGH, 1054.71, '2026-02-25 00:00:00', { id: 93 }) ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    eq(r.charge_cases[0].gate, 8, 'parks at gate 8');
    eq(r.charge_cases[0].verdict, S.VERDICT.PENDING, 'pending, the conservative direction');
  }
});

CASES.push({
  name: 'GUARD · an unrecognised refund amount does NOT clear the case',
  note: 'Gate 11 is BLOCKED from concluding a shortfall, but clearing at gate 6 would be a false ' +
        'clearance. So it routes. DECLARED DEVIATION — see SPEC-CORRECTIONS.md.',
  input: { requests: [{
    requestId: 70016, ownerId: 714, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-03-01 00:00:00'],
    expenses: [
      charge(HIGH, 1054.71, '2026-02-25 00:00:00', { id: 94 }),
      refund(-400.00, '2026-03-02 00:00:00', { id: 95 })      // not 89.50, 739.50 or 125.65
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    eq(r.charge_cases[0].gate, 11, 'gate 11');
    eq(r.charge_cases[0].verdict, S.VERDICT.VERIFIER, 'routed, never cleared and never scored as a shortfall');
  }
});

CASES.push({
  name: 'GUARD · a charge that cannot be dated pends, and NEVER reads as clean',
  note: 'REGRESSION. A paid charge whose transaction date is unreadable used to reach gate 5 and score ' +
        '"Application succeeded, no refund due" — a false clearance. Gate 5 asks whether a rejection ' +
        'falls after THIS charge, which is unanswerable without its date. Reachable as soon as ERP ' +
        'enrichment is wired: a charge can carry a transaction id and still fail to be dated.',
  input: { requests: [{
    requestId: 70018, ownerId: 716, ownerType: 'HOUSEMAID',
    stopped: true, taskName: 'x', identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-03-01 00:00:00'],
    // Added + a transaction id, so it IS in the population — but undateable.
    expenses: [ charge(HIGH, 1054.71, null, { id: 98, transactionId: 555 }) ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    assertCount(r.charge_cases, 1, 'one case');
    eq(r.charge_cases[0].gate, 15, 'gate 15, not gate 5');
    eq(r.charge_cases[0].verdict, S.VERDICT.PENDING, 'pending, never clean');
    eq(r.charge_cases[0].evidence.missing, 'transactionDate', 'and it says what was missing');
  }
});

CASES.push({
  name: 'GUARD · a rejection 322 days later must NOT pair with an old charge',
  note: 'Gate 3: one measured charge of 2025-08-05 has its nearest later rejection on 2026-06-23 — ' +
        '322 days and at least one intervening cycle away.',
  input: { requests: [{
    requestId: 70017, ownerId: 715, ownerType: 'HOUSEMAID',
    stopped: false, taskName: 'Visa processing complete',
    identityAgrees: true, everRejectedKnown: true,
    rejectionDates: ['2026-06-23 00:00:00'],
    expenses: [
      charge(HIGH, 1054.71, '2025-08-05 00:00:00', { id: 96 }),
      charge(HIGH, 1022.50, '2025-09-01 00:00:00', { id: 97 })    // bounds the first cycle
    ],
    cancelSideRefunds: []
  }]},
  expect: function (r) {
    eq(byChargeId(r.charge_cases, 96).gate, 5, 'the old charge is bounded by the next charge and is clean');
    eq(byChargeId(r.charge_cases, 97).gate, 7, 'the later charge owns the 2026 rejection');
  }
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const failures = [];
let assertions = 0;
let currentCase = '';

function eq(actual, expected, what) {
  assertions++;
  if (actual !== expected) {
    failures.push(currentCase + ' :: ' + what + ' — expected ' + JSON.stringify(expected) +
                  ', got ' + JSON.stringify(actual));
  }
}
function truthy(v, what) {
  assertions++;
  if (!v) failures.push(currentCase + ' :: ' + what + ' — expected truthy, got ' + JSON.stringify(v));
}
function assertCount(arr, n, what) { eq(arr.length, n, what); }
function byChargeId(cases, id) {
  const f = cases.filter(function (c) { return c.chargeId === id; })[0];
  if (!f) { failures.push(currentCase + ' :: no case found for charge ' + id); return {}; }
  return f;
}

// Exported so the n8n end-to-end test can drive the REAL flow with the SAME fixtures the
// offline harness uses. One source of truth: if the two ever disagree, that is a finding
// about the flow, not a fixture mismatch to be explained away.
module.exports = { CASES: CASES, AS_OF: AS_OF };

// Only run the suite when invoked directly, so requiring this file does not print.
if (require.main !== module) return;

console.log('Entry Visa Audit — offline scorer test run');
console.log('Fixtures are SPEC-DERIVED, not a live ERP read. See the header of this file.');
console.log('as-of date: ' + AS_OF);
console.log('');

CASES.forEach(function (tc) {
  currentCase = tc.name;
  const before = failures.length;
  let result;
  try {
    result = S.score(tc.input, { asOf: AS_OF });
    tc.expect(result);
  } catch (e) {
    failures.push(currentCase + ' :: THREW — ' + e.message);
  }
  const passed = failures.length === before;
  console.log((passed ? '  PASS  ' : '  FAIL  ') + tc.name);
  if (!passed) {
    failures.slice(before).forEach(function (f) { console.log('          ' + f.split(' :: ').slice(1).join(' :: ')); });
  }
});

console.log('');
console.log('assertions: ' + assertions + ' | failures: ' + failures.length);
if (failures.length) { process.exitCode = 1; }
