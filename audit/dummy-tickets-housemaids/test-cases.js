'use strict';
/**
 * Offline test suite — Dummy Tickets Submitted for Refund (Housemaids), spec v0.4.
 * Fixtures are the spec's own five test cases, as read live from ERP 2026-08-17,
 * plus one guard per edge the rule bodies explicitly name.
 * Run: node test-cases.js
 */
const { scoreCase, scoreTicket, reaggregateAfterVerifier, STANDARD_STATE } = require('./scorer.js');

// Raw ERP ticket shape (flightsTickets.requestFlightTicketActions[] element)
const T = (o) => ({
  id: o.id, ticketType: o.type ?? 'DUMMY', status: o.status ?? '',
  ticketOutcome: o.outcome ? { label: o.outcome } : undefined,
  amountInAED: o.aed === undefined ? '' : o.aed,
  amount: o.face,                                  // decoy: must never be used
  currency: o.cur ? { name: o.cur } : '',
  requestRefundOn: o.refundOn ?? '',
  requestRefundAutomaticallyType: o.autoType ?? '',
  flightTicketDate: o.flight ?? '',
  refundReason: o.reason ? { label: o.reason } : undefined,
  applicantTask: o.task ? { label: o.task } : undefined,
});

const CTX = (run_date, over = {}) =>
  ({ run_date, repeat_threshold: null, ...over });

const results = [];
function check(name, got, want, detail) {
  const pass = got === want;
  results.push({ name, pass, got, want, detail });
}

// ══════════════════════════ the spec's five test cases ══════════════════════

// TC1 — applicant 1508067: the one unambiguous money-lost shape. Produced by gate 70.
const tc1 = scoreCase({ id: 1508067, reachable: 200, tickets: [
  T({ id: 4261989, status: 'REFUND_FAILED', outcome: 'Lost', aed: 4674.74, face: 4675, cur: 'AED' }),
]}, CTX('2026-08-19'));
check('TC1 verdict', tc1.verdict, 'financial_loss');
check('TC1 state', tc1.state, 'finding');
check('TC1 exposure', tc1.exposure_aed, 4674.74);

// TC2 — applicant 1697770: the happy path, two REFUNDED. Produced by gate 60.
const tc2 = scoreCase({ id: 1697770, reachable: 200, tickets: [
  T({ id: 5384011, status: 'REFUNDED', outcome: 'Refunded', aed: 4835.00, face: 4835, cur: 'AED',
      refundOn: '2026-05-21 00:00:00', autoType: 'TwentyFourHoursBeforeDepartureTime', reason: 'Automatic refund' }),
  T({ id: 5335411, status: 'REFUNDED', outcome: 'Refunded', aed: 3600.00, face: 3600, cur: 'AED',
      refundOn: '2026-06-02 20:25:00', autoType: 'CustomTime', reason: 'Automatic refund' }),
]}, CTX('2026-08-19'));
check('TC2 verdict', tc2.verdict, 'refunded');
check('TC2 state', tc2.state, 'clean');
check('TC2 exposure', tc2.exposure_aed, 0);

// TC3 — applicant 1846842: portal holds this red on PENDING_REFUND; live both are
// REFUNDED on exactly their scheduled date. The case the running check gets wrong.
// Also the mixed-currency applicant (one SAR, one AED) per gate 40.
const tc3 = scoreCase({ id: 1846842, reachable: 200, tickets: [
  T({ id: 5297353, status: 'REFUNDED', outcome: 'Refunded', aed: 3604.69, face: 3569, cur: 'SAR',
      refundOn: '2026-06-03 00:00:00', autoType: 'CustomTime' }),
  T({ id: 5192074, status: 'REFUNDED', outcome: 'Refunded', aed: 4547.00, face: 4547, cur: 'AED',
      refundOn: '2026-05-08 00:00:00', autoType: 'CustomTime' }),
]}, CTX('2026-08-19'));
check('TC3 verdict', tc3.verdict, 'refunded');
check('TC3 state', tc3.state, 'clean');
check('TC3 no currency escalation on clean', tc3.flags.includes('route_verifier_currency'), false);

// TC4 — applicant 1535511: exercises gate 90's zero-amount path and gate 50's
// not-yet-due path together. Scored at the LAST PRODUCTION RUN's date (2026-06-04),
// before the 2026-06-15 scheduled refund landed.
const tc4 = scoreCase({ id: 1535511, reachable: 200, tickets: [
  T({ id: 5303581, status: 'PENDING_REFUND', aed: 4640.00, face: 4640, cur: 'AED',
      refundOn: '2026-06-15 00:00:00', autoType: 'CustomTime', task: 'Refund_Flight_Ticket' }),
  T({ id: 5303553, status: 'CANCELED', aed: '', face: undefined, cur: '', task: 'Dummy_Flight_Ticket' }),
]}, CTX('2026-06-04'));
check('TC4 verdict', tc4.verdict, 'awaiting_scheduled_refund');
check('TC4 state', tc4.state, 'pending');
check('TC4 zero-amount sibling parked', tc4.tickets.find(t => t.id === 5303553).verdict, 'immaterial');
check('TC4 exposure', tc4.exposure_aed, 0);

// TC5 — applicant 1473519, the trickiest: the AED 4,773.53 loss sits BEHIND two
// successful refunds. Any rule that reads one ticket gets this wrong.
const tc5 = scoreCase({ id: 1473519, reachable: 200, tickets: [
  T({ id: 9000001, status: 'REFUNDED', outcome: 'Refunded', aed: 3600.00, face: 3600, cur: 'AED' }),
  T({ id: 9000002, status: 'REFUNDED', outcome: 'Refunded', aed: 290.53, face: 291, cur: 'AED' }),
  T({ id: 9000003, status: 'CANCELED', aed: '', cur: '' }),
  T({ id: 9000004, status: 'REFUND_FAILED', outcome: 'Lost', aed: 4773.53, face: 4774, cur: 'AED' }),
]}, CTX('2026-08-19'));
check('TC5 verdict', tc5.verdict, 'financial_loss');
check('TC5 exposure is the loss only', tc5.exposure_aed, 4773.53);
check('TC5 all four tickets listed', tc5.dummy_ticket_count, 4);

// ══════════════════════════ edge guards, one per named rule ══════════════════

// E1 — REFUND_SENT_TO_PAYERS: money in flight. Not clean, not red. Gate 115.
const e1 = scoreTicket(T({ id: 1, status: 'REFUND_SENT_TO_PAYERS', aed: 4000, cur: 'AED' }), CTX('2026-08-19'));
check('E1 REFUND_SENT_TO_PAYERS -> unsettled', e1.verdict, 'unsettled');
check('E1 reason recorded', e1.reason, 'no_gate_matched');

// E2 — a refund 1-29 days late: too late for gate 50, inside gate 100's grace. Gate 115.
const e2 = scoreTicket(T({ id: 2, status: 'PENDING_REFUND', aed: 4000, cur: 'AED',
  refundOn: '2026-08-05 00:00:00', autoType: 'CustomTime' }), CTX('2026-08-19'));
check('E2 refund 14 days late -> unsettled', e2.verdict, 'unsettled');

// E3 — gate 90 must NOT be applied to gate 70 retrospectively.
const e3 = scoreTicket(T({ id: 3, status: 'REFUND_FAILED', outcome: 'Lost', aed: '', cur: '' }), CTX('2026-08-19'));
check('E3 Lost with unknown amount stays a loss', e3.verdict, 'financial_loss');
check('E3 routes for pricing', e3.flags.includes('route_verifier_for_pricing'), true);

// E4 — REAL and FAKE are out of scope; ticketType is the only discriminator.
check('E4 REAL out of scope',
  scoreTicket(T({ id: 4, type: 'REAL', status: 'REFUND_FAILED', outcome: 'Lost', aed: 500 }), CTX('2026-08-19')).verdict,
  'out_of_scope');
check('E4 FAKE out of scope',
  scoreTicket(T({ id: 5, type: 'FAKE', status: 'REFUND_FAILED', aed: 500 }), CTX('2026-08-19')).verdict,
  'out_of_scope');

// E5 — a missing ticketType is never assumed DUMMY or REAL.
const e5 = scoreTicket(T({ id: 6, type: '', status: 'ISSUED', aed: 500 }), CTX('2026-08-19'));
check('E5 missing ticketType -> unsettled', e5.verdict, 'unsettled');
check('E5 routed to verifier', e5.flags.includes('route_verifier_unknown_type'), true);

// E6 — an unreadable profile is an outage. ERP returns 500, not 404.
const e6 = scoreCase({ id: 132244, reachable: 500, tickets: [] }, CTX('2026-08-19'));
check('E6 unreachable -> erp_unreachable', e6.verdict, 'erp_unreachable');
check('E6 is pending not finding', e6.state, 'pending');
check('E6 never named applicant_not_found', e6.verdict === 'applicant_not_found', false);

// E7 — the substring trap: contains('REFUND') turns REFUND_FAILED green.
check('E7 REFUND_FAILED is not refunded',
  scoreTicket(T({ id: 7, status: 'REFUND_FAILED', aed: 4000 }), CTX('2026-08-19')).verdict,
  'financial_loss');

// E8 — null is not zero; both park, with different reasons.
check('E8 null amount reason',
  scoreTicket(T({ id: 8, status: 'CANCELED', aed: '' }), CTX('2026-08-19')).reason, 'amount_unknown');
check('E8 zero amount reason',
  scoreTicket(T({ id: 9, status: 'CANCELED', aed: 0 }), CTX('2026-08-19')).reason, 'amount_zero');

// E9 — THE 154-CASE REGRESSION. A zero-amount CANCELED with an empty schedule must
// be parked by gate 90, never dragged into gate 100's red.
const e9 = scoreTicket(T({ id: 10, status: 'CANCELED', aed: '', autoType: '' }), CTX('2026-08-19'));
check('E9 zero-amount CANCELED parked, not red', e9.verdict, 'immaterial');
check('E9 did not reach gate 100', e9.gate, 90);

// E10 — an unattributable transaction is never clean.
const e10 = scoreCase({ id: null, reachable: 200, tickets: [] }, CTX('2026-08-19'));
check('E10 no identity -> verifier', e10.state, 'verifier');

// E11 — amountInAED only. `amount` differs on 72 of 88 money-bearing rows.
check('E11 face amount never substituted',
  scoreTicket(T({ id: 11, status: 'CANCELED', aed: '', face: 4675 }), CTX('2026-08-19')).verdict,
  'immaterial');

// E12 — verifier rule 1 is TICKET-SCOPED: an explained emergency must not absorb
// a sibling's overdue red. (The recheck's severity-1.)
const e12base = scoreCase({ id: 777001, reachable: 200, tickets: [
  T({ id: 12001, outcome: 'Used', status: 'ISSUED', aed: 4640, cur: 'AED' }),
  T({ id: 12002, status: 'ISSUED', aed: 5200, cur: 'AED', refundOn: '2026-05-01 00:00:00', autoType: 'CustomTime' }),
]}, CTX('2026-08-19'));
check('E12 pre-verifier worst is Used', e12base.verdict, 'used_review');
const e12after = reaggregateAfterVerifier(e12base, { 12001: { rule: 1, explained: true } }, CTX('2026-08-19'));
check('E12 sibling overdue red survives', e12after.verdict, 'refund_overdue');
check('E12 exposure is the surviving red', e12after.exposure_aed, 5200);

// E13 — currency guard escalates only on a SIZED red.
const e13 = scoreTicket(T({ id: 13, status: 'REFUND_FAILED', outcome: 'Lost', aed: 3604.69, cur: 'SAR' }), CTX('2026-08-19'));
check('E13 non-AED red escalates', e13.flags.includes('route_verifier_currency'), true);

// E14 — gate 100 fires on an explicit DoNotRequestRefund with money outstanding.
const e14 = scoreTicket(T({ id: 14, status: 'ISSUED', aed: 4500, cur: 'AED', autoType: 'DoNotRequestRefund' }), CTX('2026-08-19'));
check('E14 DoNotRequestRefund -> red', e14.verdict, 'refund_overdue');

// E15 — the empty-schedule reading (see SPEC-FINDINGS #1). Conservative default ON.
const e15on = scoreTicket(T({ id: 15, status: 'ISSUED', aed: 4500, cur: 'AED', autoType: '' }), CTX('2026-08-19'));
check('E15 empty schedule -> red (conservative)', e15on.verdict, 'refund_overdue');
const e15off = scoreTicket(T({ id: 15, status: 'ISSUED', aed: 4500, cur: 'AED', autoType: '' }),
  CTX('2026-08-19', { empty_schedule_means_do_not_request: false }));
check('E15 alternate reading -> unsettled', e15off.verdict, 'unsettled');

// E16 — gate 50 must not read an empty requestRefundOn as a future date.
const e16 = scoreTicket(T({ id: 16, status: 'ISSUED', aed: 4500, cur: 'AED', refundOn: '', autoType: 'CustomTime' }), CTX('2026-08-19'));
check('E16 empty refundOn is not future', e16.verdict === 'awaiting_scheduled_refund', false);

// E17 — a refunded dummy ticket whose applicantTask flipped to Refund_Flight_Ticket
// must still be seen (population is never filtered on applicantTask).
check('E17 Refund_Flight_Ticket still scored',
  scoreTicket(T({ id: 17, status: 'REFUNDED', outcome: 'Refunded', aed: 4000, task: 'Refund_Flight_Ticket' }), CTX('2026-08-19')).verdict,
  'refunded');

// E18 — 'Immediately' is a FOURTH requestRefundAutomaticallyType, observed live 2026-08-19
// (92 occurrences in the reference window) and NOT in the spec's allowed-values list. It is
// a real schedule, so the empty-means-DoNotRequestRefund default must NOT apply to it: an
// unrefunded ticket carrying one lands in the terminal net, visible but not red.
const e18 = scoreTicket(T({ id: 18, status: 'ISSUED', aed: 4200, cur: 'AED', autoType: 'Immediately' }), CTX('2026-08-19'));
check('E18 Immediately is not DoNotRequestRefund', e18.verdict, 'unsettled');
check('E18 recorded as a rules gap', e18.reason, 'no_gate_matched');

// E19 — an unlisted status must never clear. Guards the open-ended enum fail-safe.
check('E19 unknown status -> unsettled',
  scoreTicket(T({ id: 19, status: 'SOME_NEW_STATE', aed: 4200, cur: 'AED', autoType: 'CustomTime' }), CTX('2026-08-19')).verdict,
  'unsettled');

// E20 — the live gate-100 shape: money, no schedule at all, not refunded. Under the
// conservative reading this is the ONE red gate 100 produced across 93 applicants.
const e20 = scoreTicket(T({ id: 20, status: 'ISSUED', aed: 4200, cur: 'AED', autoType: '', refundOn: '' }), CTX('2026-08-19'));
check('E20 no schedule at all -> red', e20.verdict, 'refund_overdue');
check('E20 reason names the cause', e20.reason, 'no_refund_scheduled');

// ── OWNER RULING, Hassan 2026-08-19: zero-amount siblings ──────────────────
// R1 — money all came back + a cancelled shell beside it => CLEAN, not pending.
// This is the 26-of-93 case from the reference window.
const r1 = scoreCase({ id: 900001, reachable: 200, tickets: [
  T({ id: 91, status: 'REFUNDED', outcome: 'Refunded', aed: 4561.15, cur: 'AED', autoType: 'Immediately' }),
  T({ id: 92, status: 'REFUNDED', outcome: 'Refunded', aed: 2755.13, cur: 'AED', autoType: 'Immediately' }),
  T({ id: 93, status: 'CANCELED', aed: '', cur: '' }),
]}, CTX('2026-08-19'));
check('R1 refunds outrank a zero-amount shell', r1.verdict, 'refunded');
check('R1 case is clean', r1.state, 'clean');
check('R1 shell still listed', r1.dummy_ticket_count, 3);

// R2 — a case with ONLY zero-amount tickets stays PENDING. Nothing in it was ever
// verified as refunded, so there is no evidence to clear it with.
const r2 = scoreCase({ id: 900002, reachable: 200, tickets: [
  T({ id: 94, status: 'CANCELED', aed: '', cur: '' }),
  T({ id: 95, status: 'CANCELED', aed: '', cur: '' }),
]}, CTX('2026-08-19'));
check('R2 only-zero-amount case stays pending', r2.state, 'pending');
check('R2 verdict is immaterial', r2.verdict, 'immaterial');

// R3 — the ruling must NEVER promote a real finding to clean. A loss beside refunds and
// shells still decides the case.
const r3 = scoreCase({ id: 900003, reachable: 200, tickets: [
  T({ id: 96, status: 'REFUNDED', outcome: 'Refunded', aed: 3600, cur: 'AED' }),
  T({ id: 97, status: 'CANCELED', aed: '', cur: '' }),
  T({ id: 98, status: 'REFUND_FAILED', outcome: 'Lost', aed: 4773.53, cur: 'AED' }),
]}, CTX('2026-08-19'));
check('R3 a loss still outranks everything', r3.verdict, 'financial_loss');
check('R3 exposure is the loss only', r3.exposure_aed, 4773.53);

// R4 — a not-yet-due refund still outranks a zero-amount shell, so TC4's shape is
// unchanged by the ruling.
const r4 = scoreCase({ id: 900004, reachable: 200, tickets: [
  T({ id: 99, status: 'PENDING_REFUND', aed: 4640, cur: 'AED', refundOn: '2026-06-15 00:00:00', autoType: 'CustomTime' }),
  T({ id: 100, status: 'CANCELED', aed: '', cur: '' }),
]}, CTX('2026-06-04'));
check('R4 not-yet-due still decides the case', r4.verdict, 'awaiting_scheduled_refund');

// ── OWNER RULING, Hassan 2026-08-19: repeat-booking threshold = 2 ──────────
const CTX2 = (run_date) => ({ run_date, repeat_threshold: 2 });

// T1 — the additive rule must SURFACE a clean case. Two refunded tickets: money is clean,
// but the booking pattern still goes to a reviewer. A flag alone would have been invisible,
// because a clean case produces no portal row.
const t1 = scoreCase({ id: 910001, reachable: 200, tickets: [
  T({ id: 81, status: 'REFUNDED', outcome: 'Refunded', aed: 3865, cur: 'AED' }),
  T({ id: 82, status: 'REFUNDED', outcome: 'Refunded', aed: 4028, cur: 'AED' }),
]}, CTX2('2026-08-19'));
check('T1 money verdict stays clean', t1.state, 'clean');
check('T1 but the case surfaces', t1.portal_state, 'needs_verifier');
check('T1 flagged for repeat review', t1.needs_repeat_review, true);

// T2 — one ticket is below the threshold and stays silent.
const t2 = scoreCase({ id: 910002, reachable: 200, tickets: [
  T({ id: 83, status: 'REFUNDED', outcome: 'Refunded', aed: 3865, cur: 'AED' }),
]}, CTX2('2026-08-19'));
check('T2 single ticket stays silent', t2.portal_state, 'silent');
check('T2 not flagged', t2.needs_repeat_review, false);

// T3 — THE RULE MUST NEVER DOWNGRADE A FINDING. A loss plus a refund is over the threshold,
// so it is flagged for the booking question too, but it stays a RED.
const t3 = scoreCase({ id: 910003, reachable: 200, tickets: [
  T({ id: 84, status: 'REFUNDED', outcome: 'Refunded', aed: 3600, cur: 'AED' }),
  T({ id: 85, status: 'REFUND_FAILED', outcome: 'Lost', aed: 4773.53, cur: 'AED' }),
]}, CTX2('2026-08-19'));
check('T3 stays a finding', t3.state, 'finding');
check('T3 portal keeps the red', t3.portal_state, 'red_flag');
check('T3 repeat flag still recorded', t3.needs_repeat_review, true);
check('T3 exposure untouched', t3.exposure_aed, 4773.53);

// T4 — switching the question off returns the clean case to silent.
const t4 = scoreCase({ id: 910004, reachable: 200, tickets: [
  T({ id: 86, status: 'REFUNDED', outcome: 'Refunded', aed: 3865, cur: 'AED' }),
  T({ id: 87, status: 'REFUNDED', outcome: 'Refunded', aed: 4028, cur: 'AED' }),
]}, CTX('2026-08-19'));
check('T4 threshold off -> silent again', t4.portal_state, 'silent');

// ══════════════════════════ report ══════════════════════════
const pass = results.filter(r => r.pass).length;
const fail = results.filter(r => !r.pass);
console.log(`\n  ${pass}/${results.length} assertions passed\n`);
for (const f of fail) console.log(`  FAIL  ${f.name}\n        got ${JSON.stringify(f.got)}  want ${JSON.stringify(f.want)}`);
if (!fail.length) console.log('  All spec test cases and edge guards green.\n');
process.exit(fail.length ? 1 : 0);
