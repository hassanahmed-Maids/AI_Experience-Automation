'use strict';
/**
 * Tests for the purpose partition, the attachment gate and group-aware scoring.
 * Companion to scorer.test.js — run both.
 */
const S = require('./scorer');
const G = require('./groups');
let pass = 0, fail = 0;
const failures = [];
function t(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; failures.push(name + '\n    expected ' + e + '\n    actual   ' + a); }
}

// =====================================================================================
// The partition. The spec claims 41 purposes, none left over, totalling AED 8,344,603.
// Re-checked here rather than trusted — the same discipline the config checksum applies.
// =====================================================================================
const part = G.assertPartition();
t('partition covers exactly 41 purposes', part.purposes, 41);
t('no purpose sits in two groups',        part.duplicates, []);
// The spec's own per-group figures sum to within rounding of its stated total.
t('group totals reconcile to the spec total within AED 5',
  Math.abs(G.quarterlyTotal() - 8344603) <= 5, true);

// Routing is case- and whitespace-insensitive, because ERP labels are typed by staff.
t('G6 claims the biggest duplicate-noise purpose', G.groupOf('Related to number of days'), 'G6');
t('routing tolerates case and padding',            G.groupOf('  full refund - freezing '), 'G4');
t('the two freeze purposes are in DIFFERENT groups',
  [G.groupOf('Partial refund - freezing'), G.groupOf('Full refund - freezing')], ['G3', 'G4']);
t('the two cancellation shapes are in DIFFERENT groups',
  [G.groupOf('Partial Refunds for Cancellation'),
   G.groupOf('Full refunds of unused monthly payments - for cancellation')], ['G2a', 'G2b']);
t('an unknown purpose routes nowhere',             G.groupOf('Some New Purpose'), null);
t('an empty purpose routes nowhere',               G.groupOf(''), null);

// =====================================================================================
// G-ATTACH. Fires only on absence where the config demands presence.
// =====================================================================================
const needsDoc = { requireAttachment: true };
const noDoc    = { requireAttachment: false };

t('G-ATTACH CLEAN — no document required',
  S.gateAttachment({ attachments: [] }, noDoc).verdict, S.CLEAN);
t('G-ATTACH CLEAN — required and an attachment is present',
  S.gateAttachment({ attachments: [{ id: 1 }] }, needsDoc).verdict, S.CLEAN);
t('G-ATTACH CLEAN — required and proofUploaded is true',
  S.gateAttachment({ proofUploaded: true, attachments: [] }, needsDoc).verdict, S.CLEAN);
t('G-ATTACH RED — required, arrays empty and proofUploaded false',
  S.gateAttachment({ attachments: [], paymentProofAttachment: [], proofUploaded: false }, needsDoc).verdict, S.RED);
t('G-ATTACH RED — required and the array is positively empty',
  S.gateAttachment({ attachments: [] }, needsDoc).verdict, S.RED);
// A slim projection that dropped the fields must NOT read as "no document". Inventing a
// finding from a missing input is the mirror of a false clearance, and just as wrong.
t('G-ATTACH PENDING — required but the fields are absent from the row, so we cannot tell',
  S.gateAttachment({}, needsDoc).verdict, S.PENDING);
// G10 is explicit that these two purposes disagree and neither flag may be borrowed.
t('G-ATTACH CLEAN — Passport renewal does not require a document even with none attached',
  S.gateAttachment({ attachments: [] }, { requireAttachment: false }).verdict, S.CLEAN);

// =====================================================================================
// Group-aware scoring
// =====================================================================================
const SETUP = [
  // Purpose 2 = Partial Refunds for Cancellation. Default row: 5,000, no doc required.
  { paymentRequestPurpose: { id: 2, name: 'Partial Refunds for Cancellation' },
    partialRefundForCancellationPaymentMethod: '', checkCeoLimit: true, limitForCeoApproval: 5000,
    requireAttachment: false, bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  // Mild escalation: 3,000 AND a document required. Both differences ride on the 2nd key.
  { paymentRequestPurpose: { id: 2 }, partialRefundForCancellationPaymentMethod: { label: 'Mild' },
    checkCeoLimit: true, limitForCeoApproval: 3000, requireAttachment: true,
    bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  // Removing Bad Google Review: the one G7 member with real controls.
  { paymentRequestPurpose: { id: 40, name: 'Removing Bad Google Review' },
    partialRefundForCancellationPaymentMethod: '', checkCeoLimit: true, limitForCeoApproval: 3000,
    requireAttachment: true, bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  // Not related to number of days: no limit at all, so unsigned is correct by design.
  { paymentRequestPurpose: { id: 41, name: 'Not related to number of days' },
    partialRefundForCancellationPaymentMethod: '', checkCeoLimit: false, limitForCeoApproval: 700,
    requireAttachment: false, bankTransferAutoApproved: false, creditCardAutoApproved: false, bothAutoApproved: false },
  // Full refund - freezing: live limit 6,000, both methods auto-approved.
  { paymentRequestPurpose: { id: 50, name: 'Full refund - freezing' },
    partialRefundForCancellationPaymentMethod: '', checkCeoLimit: true, limitForCeoApproval: 6000,
    requireAttachment: false, bothAutoApproved: true, bankTransferAutoApproved: true, creditCardAutoApproved: true }
];
const base = { id: 1, contract: 'C-1', status: 'PAID', statusChangeDate: '2026-07-10T00:00:00Z' };
function r(o) { return Object.assign({}, base, o); }

t('an unmapped purpose is PENDING and names the drift, never scored',
  S.scoreRefundWithGroups(r({ amount: 100, purpose: { id: 999, name: 'Brand New Purpose' } }), SETUP, {}).verdict,
  S.PENDING);

// The routing itself is real work even when the group's test cannot run.
const g4case = S.scoreRefundWithGroups(
  r({ amount: 100, purpose: { id: 50, name: 'Full refund - freezing' }, methodOfPayment: 'BANK_TRANSFER' }), SETUP, {});
t('a freeze refund routes to G4', g4case.group, 'G4');
t('and closes pending, because G4 has no readable evidence', g4case.verdict, S.PENDING);
t('with the reason named on the case',
  g4case.gaps.some(function (x) { return /freeze windows have no ERP route/.test(x); }), true);

// G-ATTACH can conclude RED even though the group test cannot run — a real finding today.
const attRed = S.scoreRefundWithGroups(
  r({ amount: 100, purpose: { id: 40, name: 'Removing Bad Google Review' },
      managerAction: 'APPROVE', attachments: [], paymentProofAttachment: [], proofUploaded: false }), SETUP, {});
t('G7 Removing Bad Google Review with no document is a FINDING', attRed.verdict, S.RED);
t('and the finding is the missing document, not the group gap',
  attRed.reasons.some(function (x) { return /requires a supporting document/.test(x); }), true);

// The two-key lookup drives BOTH the limit and the document requirement.
const mildRed = S.scoreRefundWithGroups(
  r({ amount: 3000, purpose: { id: 2, name: 'Partial Refunds for Cancellation' },
      partialRefundForCancellationPaymentMethod: { label: 'Mild' },
      managerAction: '', ceoAction: '', attachments: [] }), SETUP, {});
t('Mild escalation reds on BOTH its 3,000 limit and its document requirement',
  mildRed.reasons.length, 2);
// The same refund on the default row: 5,000 limit, no document needed → neither fires.
const dfltOk = S.scoreRefundWithGroups(
  r({ amount: 3000, purpose: { id: 2, name: 'Partial Refunds for Cancellation' },
      managerAction: 'APPROVE', attachments: [] }), SETUP, {});
t('the same refund on the default row produces no finding at all',
  dfltOk.verdict, S.PENDING);

// G7's two big members are the declared coverage gap; the other two are not.
const gw = S.scoreRefundWithGroups(
  r({ amount: 500, purpose: { id: 41, name: 'Not related to number of days' }, managerAction: '' }), SETUP, {});
t('a flat-goodwill case carries the DECLARED COVERAGE GAP label',
  gw.gaps.some(function (x) { return /DECLARED COVERAGE GAP/.test(x); }), true);
t('but Removing Bad Google Review does NOT — it is not one of the two unguarded members',
  attRed.gaps.some(function (x) { return /DECLARED COVERAGE GAP/.test(x); }), false);
// ⓫ still clears it correctly: no configured limit means unsigned is correct by design.
t('and an unsigned goodwill refund is not a finding — that purpose has no limit',
  gw.verdict, S.PENDING);

console.log('\n' + (fail ? failures.join('\n\n') + '\n' : ''));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
