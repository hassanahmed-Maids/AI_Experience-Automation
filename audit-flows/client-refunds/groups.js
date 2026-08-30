'use strict';
/**
 * The purpose → group partition, and what each group can conclude.
 *
 * The spec states the partition is exact: 41 purposes, every one in a group, none left
 * over, adding to 5,227 refunds and AED 8,344,603. `assertPartition()` below re-checks
 * that claim against this table rather than trusting it.
 *
 * ❺ governs how this is used: the recorded purpose selects WHICH RULE SET APPLIES and
 * that is all it does. It is a statement typed by whoever filed the refund, not a
 * verified fact about the money. A miscategorisation routes to a human; it is never a
 * finding on its own.
 */

// Each entry: purposes, and why the group's own test cannot conclude at run time.
// `gap` is the sentence that lands on the case. A group with no live test NEVER closes
// clean — ⓭ holds it at pending with this reason attached.
const GROUPS = {
  G1: {
    name: 'Duplicate payment refunds',
    quarterAED: 368727,
    purposes: [
      'Duplicated payment',
      'Non-automated Duplicated Payment Refund',
      'SDR Duplicated payment',
      'Non-MP Duplicated payment',
      'Bank Charged the family on several DD forms'
    ],
    // 🔴 Declared coverage gap, and permanently so. Once a duplicate charge is refunded
    // the offending row is DELETED or marked replaced (114 of 127 show only a
    // bounce-retry chain), and staff notes are 0% — so when the deterministic test
    // cannot confirm, there is nothing for the verifier to read either.
    coverageGap: true,
    gap: 'G1 duplicate charges: the offending payment row is deleted or replaced once refunded, and notes are 0% — a charge may be CONFIRMED by the payment log but never DENIED by it. Absence is not evidence.'
  },
  G2a: {
    name: 'Partial cancellation refunds',
    quarterAED: 850335,
    purposes: [
      'Partial Refunds for Cancellation',
      'Refund for cancellation at the beginning of the month',
      'Refund due escalation after cancellation'
    ],
    gap: 'G2a pro-rata exit: termination is readable, but the day-arithmetic half reads the write-only detail lines no ERP route returns.'
  },
  G2b: {
    name: 'Full cancellation refunds',
    quarterAED: 800980,
    purposes: [
      'Full refunds of unused monthly payments - for cancellation',
      'Full refund for cancellation - Switch CC to MV',
      'Insurance payment refund',
      'Matching fee payment refund'
    ],
    gap: 'G2b full reversal: the gross match needs the per-contract payment reads, which are 401 for this role.'
  },
  G3: {
    name: 'Partial freeze refunds',
    quarterAED: 636831,
    purposes: ['Partial refund - freezing'],
    gap: 'G3 partial freeze: neither leg is ERP-readable — freeze windows have no located route (hunt closed 2026-08-27) and the detail lines have none, permanently.'
  },
  G4: {
    name: 'Full freeze refunds',
    quarterAED: 981814,
    purposes: ['Full refund - freezing'],
    gap: 'G4 full freeze: freeze windows have no ERP route in any module, and the month-grain detail fields have none, permanently.'
  },
  G5: {
    name: 'Recruitment fee and Travel Assist refunds',
    quarterAED: 1937804,
    purposes: ['Same day recruitment fee for maidvisa', 'Travel Assist Refund'],
    gap: 'G5 recruitment fee: the expense ledger has no legal ERP read, and the Travel Assist ceiling needs the payment reads (401).'
  },
  G6: {
    name: 'Trial-day and travel-discount refunds',
    quarterAED: 642673,
    purposes: [
      'Related to number of days', '7 days trial', '5 days trial', '3 days trial',
      '10 days trial', '50% traveling discount', '25% traveling discount',
      "Paying maid's salary only - traveling discount"
    ],
    gap: 'G6 day-count: the agreed rate is readable, but the days-claimed side lives in the write-only detail lines no route returns.'
  },
  G7: {
    name: 'Goodwill refunds and overstay fines',
    quarterAED: 1138014,
    purposes: [
      'Not related to number of days',
      'Discount to retract cancellation',
      'Removing Bad Google Review',
      'Overstay fines'
    ],
    // 🔴 Coverage gap on the two big members only. All three candidate controls were
    // tested and closed there: arithmetic (detail lines 17% / 2%), ticket-exists (the
    // link is 0 of 1,768 and the fallback fires for 85–100% — a test that passes for
    // everyone is not a test), and approval (checkCeoLimit is FALSE on both, so an
    // unsigned refund is correct by design and absence can never be the finding).
    // `Removing Bad Google Review` and `Overstay fines` DO carry live controls.
    coverageGap: true,
    coverageGapMembers: ['Not related to number of days', 'Discount to retract cancellation'],
    gap: 'G7 flat goodwill: on the two big members all three candidate controls are closed — no arithmetic, a ticket test that passes everyone, and no configured limit so absence of approval is correct by design.'
  },
  G8: {
    name: 'WPS and service-charge refunds',
    quarterAED: 88089,
    purposes: ['Waiving WPS processing', 'Service charge payment refund'],
    gap: 'G8 standard-fee reversal: the arithmetic reads the write-only detail lines, and the charge-exists proof needs the payment reads (401).'
  },
  G9: {
    name: 'Maid salary refunds',
    quarterAED: 578577,
    purposes: [
      'Pre-collected Salary', 'MV salary refund',
      "Maid's salary due to missing medical certificate",
      "Maid's overseas employment certificate refund",
      'OWWA Registration refund', "Maid's contract verification refund"
    ],
    gap: "G9 maid-side: the maid's payroll ledger read is documented but unread for this population, and the maid bridge from a terminated contract is the weak leg.",
    // 🚩 Said out loud rather than buried: on roughly half this member's cases there is
    // NOTHING — ledger 53%, notes 0%, approval 0%, detail lines 0%. Not scoreable and
    // not reviewable. It routes to the auditor as unauditable, never clean on absence.
    unauditableMembers: ["Maid's salary due to missing medical certificate"]
  },
  G10: {
    name: 'Taxi and passport reimbursements',
    quarterAED: 44752,
    purposes: ['Taxi Reimbursements', 'Passport renewal refund'],
    gap: "G10 reimbursements: the only real control is the receipt's AMOUNT against the refund, which requires opening the document — verifier-only."
  },
  G11: {
    name: 'Nationality-switch refunds',
    quarterAED: 45296,
    purposes: ['Switching to a cheaper nationality Refund'],
    gap: 'G11 nationality switch: no confirmed ERP route returns the nationality change yet (getReplacementHistory unmeasured, the replacements key on CONTRACT_DETAILS unread).'
  },
  G12: {
    name: 'Other and referral refunds',
    quarterAED: 230713,
    purposes: ['Other', 'Referral Case'],
    gap: 'G12: `Other` is a reclassification question for the verifier; `Referral Case` has NO SOURCE AT ALL — every REFERRAL object in the warehouse is maid-side and this is a client referral bonus.'
  }
};

/** Lower-cased purpose → group key. Built once. */
const PURPOSE_TO_GROUP = (function () {
  const m = {};
  for (const key of Object.keys(GROUPS)) {
    for (const p of GROUPS[key].purposes) m[p.trim().toLowerCase()] = key;
  }
  return m;
})();

/**
 * Which group a purpose belongs to, or null.
 *
 * Returning null is NOT a shrug — an unmapped purpose means the partition has drifted
 * (a purpose was added in ERP, or renamed). The caller must route it to a human, never
 * score it. A silently unmatched purpose would otherwise fall through every group test
 * and reach ⓭ looking like an ordinary unsettled case.
 */
function groupOf(purposeName) {
  if (!purposeName) return null;
  return PURPOSE_TO_GROUP[String(purposeName).trim().toLowerCase()] || null;
}

/**
 * Re-check the spec's own partition claim: 41 purposes, no duplicates, none orphaned.
 * Run as a test, and at flow start before any scoring — a reference-data checksum.
 */
function assertPartition() {
  const seen = {};
  const dupes = [];
  let count = 0;
  for (const key of Object.keys(GROUPS)) {
    for (const p of GROUPS[key].purposes) {
      const k = p.trim().toLowerCase();
      if (seen[k]) dupes.push(p + ' (in ' + seen[k] + ' and ' + key + ')');
      seen[k] = key;
      count++;
    }
  }
  return { purposes: count, groups: Object.keys(GROUPS).length, duplicates: dupes };
}

/** Quarterly AED by group — the spec's own figures, for reconciling a run's coverage report. */
function quarterlyTotal() {
  let t = 0;
  for (const key of Object.keys(GROUPS)) t += GROUPS[key].quarterAED;
  return t;
}

module.exports = { GROUPS, groupOf, assertPartition, quarterlyTotal };
