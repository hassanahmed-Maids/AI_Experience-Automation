'use strict';
/**
 * SINGLE SOURCE OF TRUTH for Client Refunds scoring.
 *
 * This file is BOTH the offline reference (required by the tests) and the body of the
 * n8n Score node (inlined verbatim by build-node.js). It exists because the first n8n
 * build hand-copied the scorer, and the copy had already drifted from the tested version
 * before it ever ran - the flow knew nothing about group routing or G-ATTACH.
 *
 * A hand-copy of scoring logic is a second implementation nobody tests. Generate it.
 * `parity.test.js` proves the emitted node and this file agree case for case.
 */

// ============================ PURPOSE -> GROUP PARTITION ============================
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

// ================================ SCORING GATES ====================================
/**
 * Client Refunds — deterministic scorer (Notion spec v0.8).
 *
 * Built standalone on purpose: it is faster to iterate outside n8n, and it gives the
 * n8n build a fixed reference. If a later refactor moves these numbers, the refactor
 * is wrong.
 *
 * SCOPE, AND WHY IT IS THIS SMALL. Of the twelve deterministic gates, six (❶❷❸❹❺⓮)
 * frame the population and fix the comparison basis, and exactly ONE (⓫) can conclude
 * a finding from data this role can actually read today. ❻❼❽❾❿ and every group rule
 * with measured findings (G3/G5/G8) declare, in their own run-time-sourcing notes,
 * that their evidence is either 401 for this role or has no ERP route at all — and
 * their own stated fallback is "route to the verifier". That is implemented here as
 * `pending` with a named gap, never as clean. See NOTES.md.
 */

// ---------------------------------------------------------------------------
// ⓮ — comparison basis. Both sides gross of VAT; tolerance AED 0.50 ABSOLUTE.
// Never a percentage: a percentage scales with the amount and so forgives exactly
// the largest errors. VAT is never derived — the purpose list carries both
// `Pre-collected Salary` and `Pre-collected Salary - No VAT`, so any single assumed
// rate is wrong on every no-VAT refund.
// ---------------------------------------------------------------------------
const TOLERANCE_AED = 0.50;

function exceeds(actual, expected) {
  return (actual - expected) > TOLERANCE_AED;
}

/**
 * Numeric coercion that REFUSES empty string and null rather than mapping them to 0.
 *
 * This is the NULL-comparison false-clearance shape. `limitForCeoApproval` arrives as
 * '' on rows where it is not set, and `Number('')` is 0 — which would make
 * `amount >= limit` true for every refund and, worse, would make a missing limit
 * indistinguishable from a limit of zero. Returns null so callers must decide.
 */
function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Label-or-value reader: ERP returns {label,value}, {name}, or a bare string. */
function lbl(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    const s = v.label != null ? v.label : (v.name != null ? v.name : (v.value != null ? v.value : ''));
    return String(s).trim();
  }
  return String(v).trim();
}

/**
 * An approval is "recorded" when a non-empty action is present.
 *
 * ⚠️ `ceoApproval` uses an EMPTY STRING, not null and not false (observed on the
 * dynamic-API sample: managerApproval "APPROVE" alongside ceoApproval ""). Empty must
 * never be read as a rejection, and must never be defaulted to approved.
 */
function hasApproval(v) {
  const s = lbl(v).toUpperCase();
  if (!s) return false;
  return s !== 'REJECT' && s !== 'REJECTED' && s !== 'NONE';
}

// ---------------------------------------------------------------------------
// Verdicts. "Needs review" is NOT a finding and NOT a clearance — ⓭ exists to stop
// the third state collapsing into green.
// ---------------------------------------------------------------------------
const RED = 'finding';
const CLEAN = 'clean';
const PENDING = 'pending';

/**
 * ⓫ — Approval is judged against the purpose's OWN configured limit.
 *
 * The lookup takes TWO keys, not one: purpose id AND
 * partialRefundForCancellationPaymentMethod. Purpose 2 (`Partial Refunds for
 * Cancellation`) carries four rows — a default at 5,000 and 3,000 on each of
 * Mild / Severe / Standard-weekly. Keying on purpose alone silently picks one of four.
 *
 * 🔴 Never use the inferred AED 10,000. The real config runs 100 → 12,000 across
 * nineteen values and only two rows sit at or above 10,000, so a flat 10,000 gate
 * would ignore every unsigned refund between a purpose's own limit and 10,000 — the
 * false-clean direction across most of the book.
 */
function gateApproval(refund, setupRows) {
  const purposeId = refund.purpose && refund.purpose.id != null ? refund.purpose.id : null;
  if (purposeId === null) {
    return { verdict: PENDING, rule: '11', reason: 'no purpose id on the refund row' };
  }

  const method = lbl(refund.partialRefundForCancellationPaymentMethod);
  const setup = findSetup(setupRows, purposeId, method);

  // Missing config is never green. "The cheapest way to pass" must not be "have no data".
  if (!setup) {
    return {
      verdict: PENDING, rule: '11',
      reason: 'no clientRefundSetup row for purpose ' + purposeId +
              (method ? ' / method ' + method : ' / default method')
    };
  }

  // Read the SWITCH before the limit. `limitForCeoApproval` stays populated on ten of
  // the eleven `checkCeoLimit = false` rows — a stale number behind an off switch.
  // "No limit configured" and "limit ignored" were called opposite findings.
  if (setup.checkCeoLimit !== true) {
    return { verdict: CLEAN, rule: '11', reason: 'checkCeoLimit is off — this purpose has no limit, so an unsigned refund is correct by design' };
  }

  const limit = num(setup.limitForCeoApproval);
  if (limit === null) {
    // Switch on but no usable number: config we cannot read, not a case we cleared.
    return { verdict: PENDING, rule: '11', reason: 'checkCeoLimit is on but limitForCeoApproval is empty/non-numeric' };
  }

  const amount = num(refund.amount);
  if (amount === null) {
    return { verdict: PENDING, rule: '11', reason: 'refund amount missing or non-numeric' };
  }

  // Either approval satisfies the gate. They SUBSTITUTE for each other, they do not
  // escalate — there is no manager-limit field; manager is the default path and the
  // only configured threshold escalates to COO/CEO.
  const approved = hasApproval(refund.managerAction) || hasApproval(refund.ceoAction);

  if (amount >= limit) {
    if (!approved) {
      return { verdict: RED, rule: '11', reason: 'amount reaches the purpose\'s own CEO limit and neither a manager nor a CEO approval is recorded', limit: limit };
    }
    return { verdict: CLEAN, rule: '11', reason: 'at or above the limit and an approval is recorded' };
  }

  // Below the limit. Auto-approval clears it only for the case's OWN payment method.
  if (autoApprovedFor(setup, refund)) {
    return { verdict: CLEAN, rule: '11', reason: 'below the limit and auto-approval is on for this payment method' };
  }

  if (approved) {
    return { verdict: CLEAN, rule: '11', reason: 'below the limit and an approval is recorded' };
  }

  // Auto-approval OFF, below the limit, no manager approval. The manager step is the
  // default path so its absence LOOKS wrong, but nothing has measured how often it
  // happens legitimately. Explicitly NOT a finding until that base rate exists.
  return { verdict: PENDING, rule: '11', reason: 'below the limit, auto-approval off, no approval recorded — base rate unmeasured, routed to the verifier' };
}

/** Two-key setup lookup, with the default row as fallback only when no method is set. */
function findSetup(rows, purposeId, method) {
  const list = Array.isArray(rows) ? rows : [];
  const forPurpose = list.filter(function (r) {
    const p = r && r.paymentRequestPurpose;
    return p && Number(p.id) === Number(purposeId);
  });
  if (!forPurpose.length) return null;

  if (method) {
    const exact = forPurpose.find(function (r) {
      return lbl(r.partialRefundForCancellationPaymentMethod).toUpperCase() === method.toUpperCase();
    });
    if (exact) return exact;
    // A method we have no row for is unresolved config, not the default row.
    return null;
  }

  // No method on the case → the backend's getUniquePurposeSetup() takes the row whose
  // partialRefundForCancellationPaymentMethod is NULL/empty.
  const dflt = forPurpose.find(function (r) {
    return lbl(r.partialRefundForCancellationPaymentMethod) === '';
  });
  return dflt || null;
}

/** Auto-approval is per payment method; `bothAutoApproved` covers bank + card. */
function autoApprovedFor(setup, refund) {
  const m = lbl(refund.methodOfPayment).toUpperCase();
  if (setup.bothAutoApproved === true) return true;
  if (m.indexOf('BANK') !== -1) return setup.bankTransferAutoApproved === true;
  if (m.indexOf('CREDIT') !== -1 || m.indexOf('CARD') !== -1) return setup.creditCardAutoApproved === true;
  // Unknown method: do not borrow another method's flag.
  return false;
}

// ---------------------------------------------------------------------------
// ❶❷❹ — population framing. These decide whether a row is IN SCOPE at all.
// ---------------------------------------------------------------------------
function inPopulation(refund, monthStart, monthEnd) {
  const status = lbl(refund.status).toUpperCase();
  if (status !== 'PAID') return { included: false, reason: 'status ' + (status || '(none)') + ' is not PAID' };

  // ❷ the PAID date puts a refund in the period, never the creation date. 625 of 5,227
  // refunds (12%) fall in a different month from their creation month.
  const d = refund.statusChangeDate;
  if (!d) return { included: false, reason: 'no statusChangeDate — cannot place the refund in a month' };
  const t = Date.parse(d);
  if (!Number.isFinite(t)) return { included: false, reason: 'unparseable statusChangeDate' };
  if (t < Date.parse(monthStart) || t >= Date.parse(monthEnd)) {
    return { included: false, reason: 'paid outside the audited month' };
  }
  return { included: true };
}

/**
 * Score one refund. Order matters: ❹ before ⓫, and ⓭ last.
 *
 * Gates whose evidence this role cannot read do NOT run and do NOT clear — each adds a
 * named gap and forces the case to `pending`. A later passing test must never override
 * an earlier gate's routing decision; `pending` is therefore sticky against `clean`.
 */
function scoreRefund(refund, setupRows, opts) {
  const o = opts || {};
  const gaps = [];
  const fired = [];

  // ❹ — a refund whose contract cannot be resolved is pending, never clean. Every basis
  // this check tests hangs off the contract, and no basis is not the same as no problem.
  if (!lbl(refund.contract)) {
    return finalize({ verdict: PENDING, reasons: ['no resolvable contract id (❹)'], gaps: gaps, rules_fired: ['4'] }, refund);
  }
  fired.push('4');

  // ⓫ — the one gate with a live source today.
  const a = gateApproval(refund, setupRows);
  fired.push('11');
  if (a.verdict === RED) {
    return finalize({ verdict: RED, reasons: [a.reason + ' (⓫)'], gaps: gaps, rules_fired: fired }, refund);
  }

  // The unsourceable gates. Declared, never silently skipped.
  for (const g of (o.unsourcedGates || [])) gaps.push(g);

  // ⓭ — nothing exits this check clean by silence. A clean verdict is a positive
  // statement that a gate tested this case and it passed. Any declared gap means some
  // part of the case was never examined, so it cannot close clean.
  if (gaps.length) {
    return finalize({ verdict: PENDING, reasons: [a.reason + ' (⓫)'], gaps: gaps, rules_fired: fired }, refund);
  }
  if (a.verdict === PENDING) {
    return finalize({ verdict: PENDING, reasons: [a.reason + ' (⓫)'], gaps: gaps, rules_fired: fired }, refund);
  }
  return finalize({ verdict: CLEAN, reasons: [a.reason + ' (⓫)'], gaps: gaps, rules_fired: fired }, refund);
}

/** Case identity only — never amounts, names, IBANs or note text. */
function finalize(r, refund) {
  return {
    refund_id: refund.id != null ? refund.id : null,
    display_id: lbl(refund.displayId) || null,
    contract_type: lbl(refund.contractType) || null,
    verdict: r.verdict,
    reasons: r.reasons,
    gaps: r.gaps,
    rules_fired: r.rules_fired
  };
}


/**
 * G-ATTACH — a purpose whose config REQUIRES a document, on a refund that has none.
 *
 * This is the second gate that can conclude from data already inline: `requireAttachment`
 * comes from the same config read ⓫ uses, and the refund's own attachment fields arrive
 * on the population row. No extra call, no extra permission.
 *
 * It exists because three group rules each name it independently:
 *   G2b — `Full refunds of unused monthly payments` requires an attachment ("a new
 *         deterministic control on this group").
 *   G7  — `Removing Bad Google Review` carries requireAttachment=true, "so a missing
 *         document there IS a violation" — the one member of that group not unguarded.
 *   G10 — `Taxi Reimbursements` requires one; `Passport renewal refund` does NOT, and
 *         applying either purpose's flag to the other is called out as forbidden.
 *   G2a — the three escalation rows of `Partial Refunds for Cancellation` require one;
 *         the default row does not. That is the two-key lookup earning its keep again.
 *
 * ⚠️ Presence is NEVER evidence the amount is right (G10 states this outright). This gate
 * only ever fires on ABSENCE where the config demands presence.
 */
function gateAttachment(refund, setupRow) {
  if (!setupRow || setupRow.requireAttachment !== true) {
    return { verdict: CLEAN, rule: 'G-ATTACH', reason: 'no document required for this purpose' };
  }

  const arrays = ['attachments', 'paymentProofAttachment'];
  let sawPresent = false;
  let sawEmptyArray = false;
  for (const k of arrays) {
    const v = refund[k];
    if (Array.isArray(v)) {
      if (v.length > 0) sawPresent = true;
      else sawEmptyArray = true;
    }
  }
  if (refund.proofUploaded === true) sawPresent = true;

  if (sawPresent) {
    return { verdict: CLEAN, rule: 'G-ATTACH', reason: 'a document is required and one is attached' };
  }

  // Only red when absence is POSITIVELY established. A slim projection that dropped the
  // attachment fields must not read as "no document" — that is a finding invented from a
  // missing input, which is the mirror of the false-clearance bug and just as wrong.
  const definitelyAbsent = refund.proofUploaded === false || sawEmptyArray;
  if (!definitelyAbsent) {
    return { verdict: PENDING, rule: 'G-ATTACH', reason: 'a document is required but the attachment fields were not present on the row — cannot tell' };
  }
  return { verdict: RED, rule: 'G-ATTACH', reason: 'this purpose requires a supporting document and the refund carries none' };
}

/**
 * Full scoring pass: framing gates, the two live gates, then group routing.
 *
 * `scoreRefund` above is the narrow ⓫-only path kept for the offline reference tests.
 * This is what the flow runs.
 */
function scoreRefundWithGroups(refund, setupRows, opts) {
  const o = opts || {};
  const groups = o.groups || { GROUPS: GROUPS, groupOf: groupOf };
  const gaps = [];
  const findings = [];
  const reasons = [];

  // ❹ — no contract, no basis. "We could not check it" is not "we checked it and it was fine".
  if (!lbl(refund.contract)) {
    return finalize({ verdict: PENDING, reasons: ['no resolvable contract id (❹)'], gaps: [], rules_fired: ['4'] }, refund);
  }

  // ❺ — the purpose selects the rule set, nothing more.
  const purposeName = lbl(refund.purpose && refund.purpose.name) || lbl(refund.purposeName);
  const groupKey = groups.groupOf(purposeName);
  if (!groupKey) {
    // An unmapped purpose means the partition has drifted, not that the case is fine.
    return finalize({
      verdict: PENDING,
      reasons: ['purpose "' + (purposeName || '(none)') + '" is not in the 41-purpose partition — ERP has added or renamed one. Route to a human and update groups.js; never score an unmapped purpose.'],
      gaps: [], rules_fired: ['5']
    }, refund);
  }
  const group = groups.GROUPS[groupKey];

  const method = lbl(refund.partialRefundForCancellationPaymentMethod);
  const pid = refund.purpose && refund.purpose.id != null ? refund.purpose.id : null;
  const setupRow = pid === null ? null : findSetup(setupRows, pid, method);

  // ⓫ — approval against this purpose's own configured limit.
  const a = gateApproval(refund, setupRows);
  reasons.push(a.reason + ' (⓫)');
  if (a.verdict === RED) findings.push(a.reason + ' (⓫)');

  // G-ATTACH — required document missing.
  const att = gateAttachment(refund, setupRow);
  if (att.verdict === RED) findings.push(att.reason + ' (G-ATTACH)');
  else if (att.verdict === PENDING) gaps.push(att.reason + ' (G-ATTACH)');

  // The group's own test, which for every group is currently unsourceable.
  gaps.push(group.gap);
  if (group.coverageGap) {
    const members = group.coverageGapMembers;
    const applies = !members || members.indexOf(purposeName) !== -1;
    if (applies) gaps.push('DECLARED COVERAGE GAP (' + groupKey + '): reported as a gap, never as a clean bill.');
  }
  if (group.unauditableMembers && group.unauditableMembers.indexOf(purposeName) !== -1) {
    gaps.push('UNAUDITABLE MEMBER: on roughly half these cases there is no evidence at all — not scoreable and not reviewable. Routes to the auditor, never clean on absence.');
  }
  for (const g of (o.unsourcedGates || [])) gaps.push(g);

  // A finding is never downgraded by a later gap.
  // ⓭ — nothing exits clean by silence.
  //
  // THE GROUP IS STAMPED ON EVERY PATH, findings included. An earlier version returned early
  // on the findings branch and set the label only afterwards, so a FINDING - the case that
  // matters most - came out unlabelled: the run's group spread counted it as "(unrouted)"
  // and it would have reached the workbook with a blank group column. Caught by the first
  // end-to-end run, not by the unit tests, because those asserted the verdict and never
  // looked at the label. One exit, one place the label is set.
  const verdict = findings.length ? RED : (gaps.length ? PENDING : (a.verdict === CLEAN ? CLEAN : PENDING));
  const out = finalize({
    verdict: verdict,
    reasons: findings.length ? findings : reasons,
    gaps: gaps,
    rules_fired: ['4', '5', '11', 'G-ATTACH', groupKey]
  }, refund);
  out.group = groupKey;
  out.group_name = group.name;
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GROUPS: GROUPS, groupOf: groupOf, assertPartition: assertPartition, quarterlyTotal: quarterlyTotal,
    TOLERANCE_AED: TOLERANCE_AED, exceeds: exceeds, num: num, lbl: lbl, hasApproval: hasApproval,
    findSetup: findSetup, autoApprovedFor: autoApprovedFor, gateApproval: gateApproval,
    gateAttachment: gateAttachment, inPopulation: inPopulation,
    scoreRefund: scoreRefund, scoreRefundWithGroups: scoreRefundWithGroups,
    RED: RED, CLEAN: CLEAN, PENDING: PENDING
  };
}
