'use strict';
/**
 * Offline tests for the Client Refunds deterministic scorer.
 *
 * Every case here is either a rule the spec states in words, or a trap the spec says
 * killed a previous version of this check. The traps matter more than the happy paths:
 * all three gates this check has already lost were lost to a FALSE CLEARANCE, not a crash.
 */
const S = require('./scorer');
let pass = 0, fail = 0;
const failures = [];

function t(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; failures.push(name + '\n    expected ' + e + '\n    actual   ' + a); }
}

// --- setup config fixture, shaped like GET /accounting/clientRefundSetup/list ---------
// Purpose 2 deliberately carries FOUR rows, as the real config does.
const SETUP = [
  { paymentRequestPurpose: { id: 2, name: 'Partial Refunds for Cancellation' },
    partialRefundForCancellationPaymentMethod: '', checkCeoLimit: true, limitForCeoApproval: 5000,
    bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  { paymentRequestPurpose: { id: 2 }, partialRefundForCancellationPaymentMethod: { id: 1, label: 'Mild' },
    checkCeoLimit: true, limitForCeoApproval: 3000,
    bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  { paymentRequestPurpose: { id: 2 }, partialRefundForCancellationPaymentMethod: { id: 2, label: 'Severe' },
    checkCeoLimit: true, limitForCeoApproval: 3000,
    bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  { paymentRequestPurpose: { id: 2 }, partialRefundForCancellationPaymentMethod: { id: 3, label: 'Standard-weekly' },
    checkCeoLimit: true, limitForCeoApproval: 3000,
    bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  // The stale-number-behind-an-off-switch row: 10 of 11 checkCeoLimit=false rows keep a limit.
  { paymentRequestPurpose: { id: 35, name: 'Goodwill' }, partialRefundForCancellationPaymentMethod: '',
    checkCeoLimit: false, limitForCeoApproval: 500,
    bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  { paymentRequestPurpose: { id: 90, name: 'Paying maid\'s salary only / traveling discount' },
    partialRefundForCancellationPaymentMethod: '', checkCeoLimit: true, limitForCeoApproval: 100,
    bankTransferAutoApproved: true, creditCardAutoApproved: false, bothAutoApproved: false },
  // Switch on, limit never filled in.
  { paymentRequestPurpose: { id: 77 }, partialRefundForCancellationPaymentMethod: '',
    checkCeoLimit: true, limitForCeoApproval: '',
    bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false }
];

const base = { id: 1, contract: 'C-1', status: 'PAID', statusChangeDate: '2026-07-10T00:00:00Z' };
function r(over) { return Object.assign({}, base, over); }

// =====================================================================================
// ⓮ — tolerance is AED 0.50 ABSOLUTE, never a percentage
// =====================================================================================
t('⓮ 0.50 exactly is within tolerance', S.exceeds(1000.50, 1000), false);
t('⓮ 0.51 is past tolerance',            S.exceeds(1000.51, 1000), true);
// The whole reason the tolerance is absolute: on a big refund a percentage would forgive
// a real overpayment. AED 500 over on AED 100,000 is 0.5% — a percentage rule clears it.
t('⓮ big absolute error on a big refund is still a breach', S.exceeds(100500, 100000), true);

// =====================================================================================
// NULL/empty coercion — the false-clearance shape the skill names explicitly
// =====================================================================================
t('num("") is null, never 0', S.num(''), null);
t('num(null) is null',        S.num(null), null);
t('num(0) is 0',              S.num(0), 0);
t('num("3000") is 3000',      S.num('3000'), 3000);

// `ceoApproval: ""` must not read as a rejection, and must never default to approved.
t('empty approval is absent',    S.hasApproval(''), false);
t('null approval is absent',     S.hasApproval(null), false);
t('APPROVE is present',          S.hasApproval('APPROVE'), true);
t('REJECT is not an approval',   S.hasApproval('REJECT'), false);

// =====================================================================================
// ⓫ — the two-key lookup. Keying on purpose alone silently picks one of purpose 2's four rows.
// =====================================================================================
t('⓫ purpose 2 default row is the 5,000 one',
  S.findSetup(SETUP, 2, '').limitForCeoApproval, 5000);
t('⓫ purpose 2 + Mild is the 3,000 row',
  S.findSetup(SETUP, 2, 'Mild').limitForCeoApproval, 3000);
t('⓫ a method with no row does NOT fall back to the default row',
  S.findSetup(SETUP, 2, 'Unlisted-method'), null);

// RED: switch on, amount reaches the purpose's own limit, no approval of either kind.
t('⓫ RED — at the limit with no approval',
  S.gateApproval(r({ amount: 5000, purpose: { id: 2 }, managerAction: '', ceoAction: '' }), SETUP).verdict,
  S.RED);
// The 3,000 escalation row must red at 3,000 — a flat 5,000 (or the inferred 10,000) clears it.
t('⓫ RED — Mild row reds at 3,000, which a default-row lookup would clear',
  S.gateApproval(r({ amount: 3000, purpose: { id: 2 },
    partialRefundForCancellationPaymentMethod: { label: 'Mild' },
    managerAction: '', ceoAction: '' }), SETUP).verdict,
  S.RED);
// 🔴 The inferred AED 10,000 regression: purpose 90's own limit is 100.
t('⓫ RED — purpose 90 reds at 150, which an inferred 10,000 gate would clear',
  S.gateApproval(r({ amount: 150, purpose: { id: 90 }, methodOfPayment: 'CASH',
    managerAction: '', ceoAction: '' }), SETUP).verdict,
  S.RED);

// Either approval satisfies the gate — they substitute, they do not escalate.
t('⓫ CLEAN — manager approval alone satisfies it',
  S.gateApproval(r({ amount: 9000, purpose: { id: 2 }, managerAction: 'APPROVE', ceoAction: '' }), SETUP).verdict,
  S.CLEAN);
t('⓫ CLEAN — CEO approval alone satisfies it',
  S.gateApproval(r({ amount: 9000, purpose: { id: 2 }, managerAction: '', ceoAction: 'APPROVE' }), SETUP).verdict,
  S.CLEAN);

// Never read the limit without the switch: purpose 35 keeps a stale 500 behind checkCeoLimit=false.
t('⓫ CLEAN — switch off, so the stale 500 limit is ignored',
  S.gateApproval(r({ amount: 5000, purpose: { id: 35 }, managerAction: '', ceoAction: '' }), SETUP).verdict,
  S.CLEAN);

// Auto-approval clears only the case's OWN payment method.
t('⓫ CLEAN — below the limit, bank auto-approval on, method is bank',
  S.gateApproval(r({ amount: 50, purpose: { id: 90 }, methodOfPayment: { label: 'BANK_TRANSFER' },
    managerAction: '', ceoAction: '' }), SETUP).verdict,
  S.CLEAN);
t('⓫ PENDING — below the limit but card auto-approval is OFF; must not borrow the bank flag',
  S.gateApproval(r({ amount: 50, purpose: { id: 90 }, methodOfPayment: { label: 'CREDIT_CARD' },
    managerAction: '', ceoAction: '' }), SETUP).verdict,
  S.PENDING);

// Missing config is never green — "the cheapest way to pass" must not be having no data.
t('⓫ PENDING — no setup row for the purpose',
  S.gateApproval(r({ amount: 5000, purpose: { id: 999 } }), SETUP).verdict, S.PENDING);
t('⓫ PENDING — switch on but the limit is empty (must not coerce to 0 and red everything)',
  S.gateApproval(r({ amount: 5000, purpose: { id: 77 }, managerAction: '', ceoAction: '' }), SETUP).verdict,
  S.PENDING);
t('⓫ PENDING — auto-approval off, below the limit, no approval: base rate unmeasured',
  S.gateApproval(r({ amount: 100, purpose: { id: 2 }, managerAction: '', ceoAction: '' }), SETUP).verdict,
  S.PENDING);

// =====================================================================================
// ❶❷ — population framing
// =====================================================================================
const M0 = '2026-07-01T00:00:00Z', M1 = '2026-08-01T00:00:00Z';
t('❶ PAID inside the month is in',
  S.inPopulation(r({ statusChangeDate: '2026-07-10T00:00:00Z' }), M0, M1).included, true);
t('❶ REJECTED is out — no money left the company',
  S.inPopulation(r({ status: 'REJECTED' }), M0, M1).included, false);
t('❶ PENDING is out',  S.inPopulation(r({ status: 'PENDING' }), M0, M1).included, false);
t('❶ STOPPED is out',  S.inPopulation(r({ status: 'STOPPED' }), M0, M1).included, false);
// ❷ the creation date is context only; using it swaps 12% of the population for a different 12%.
t('❷ paid in July but created in April is IN (paid date decides)',
  S.inPopulation(r({ statusChangeDate: '2026-07-02T00:00:00Z', creationDate: '2026-04-06T00:00:00Z' }), M0, M1).included,
  true);
t('❷ paid in August but created in July is OUT',
  S.inPopulation(r({ statusChangeDate: '2026-08-02T00:00:00Z', creationDate: '2026-07-06T00:00:00Z' }), M0, M1).included,
  false);
t('❷ a missing paid date cannot be placed in a month',
  S.inPopulation(r({ statusChangeDate: null }), M0, M1).included, false);

// =====================================================================================
// ❹ / ⓭ — nothing exits clean by silence
// =====================================================================================
t('❹ PENDING — no contract id, never clean',
  S.scoreRefund(r({ contract: '', amount: 100, purpose: { id: 2 } }), SETUP, {}).verdict, S.PENDING);

// ⓭: a declared gap means part of the case was never examined, so it cannot close clean.
t('⓭ PENDING — ⓫ passes but a gate was unsourceable',
  S.scoreRefund(r({ amount: 9000, purpose: { id: 2 }, managerAction: 'APPROVE' }), SETUP,
    { unsourcedGates: ['❾ freeze windows: no ERP route'] }).verdict,
  S.PENDING);
t('⓭ the gap is NAMED on the case, not swallowed',
  S.scoreRefund(r({ amount: 9000, purpose: { id: 2 }, managerAction: 'APPROVE' }), SETUP,
    { unsourcedGates: ['❾ freeze windows: no ERP route'] }).gaps,
  ['❾ freeze windows: no ERP route']);
// A RED from ⓫ must survive a later gap — an earlier gate's decision is not overridden.
t('a ⓫ RED is not downgraded to pending by a later gap',
  S.scoreRefund(r({ amount: 5000, purpose: { id: 2 }, managerAction: '', ceoAction: '' }), SETUP,
    { unsourcedGates: ['❾ freeze windows: no ERP route'] }).verdict,
  S.RED);
// Clean is only reachable with no gaps at all.
t('CLEAN reachable only with zero declared gaps',
  S.scoreRefund(r({ amount: 9000, purpose: { id: 2 }, managerAction: 'APPROVE' }), SETUP, {}).verdict,
  S.CLEAN);

// =====================================================================================
// Output hygiene — the case record must carry no amounts, names, IBANs or note text.
// =====================================================================================
const out = S.scoreRefund(r({ amount: 9000, purpose: { id: 2 }, managerAction: 'APPROVE',
  client: 'A Client Name', iban: 'AE00', accountName: 'Holder', notes: 'bank details' }), SETUP, {});
t('hygiene — no client/iban/accountName/notes/amount on the scored case',
  Object.keys(out).filter(k => ['client','iban','accountName','notes','amount'].includes(k)), []);

console.log('\n' + (fail ? failures.join('\n\n') + '\n' : ''));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
