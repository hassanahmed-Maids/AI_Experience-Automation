// GENERATED - do not edit here. Source: audit-flows/client-refunds/score-core.js
// Regenerate: node build-node.js   |   Verify: node parity.test.js
// score-core.js sha256: e87cf78b28efb3b39c74f12d2b4940939ed5e9ac015bc63f25bce3904c70192a
// Comments are stripped here and live in the source file. Every rule this implements
// is cited there by its spec numeral, with the measurement that justified it.

'use strict';

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

const PURPOSE_TO_GROUP = (function () {
  const m = {};
  for (const key of Object.keys(GROUPS)) {
    for (const p of GROUPS[key].purposes) m[p.trim().toLowerCase()] = key;
  }
  return m;
})();

function groupOf(purposeName) {
  if (!purposeName) return null;
  return PURPOSE_TO_GROUP[String(purposeName).trim().toLowerCase()] || null;
}

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

function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lbl(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    const s = v.label != null ? v.label : (v.name != null ? v.name : (v.value != null ? v.value : ''));
    return String(s).trim();
  }
  return String(v).trim();
}

function hasApproval(v) {
  const s = lbl(v).toUpperCase();
  if (!s) return false;
  return s !== 'REJECT' && s !== 'REJECTED' && s !== 'NONE';
}

const RED = 'finding';
const CLEAN = 'clean';
const PENDING = 'pending';

function gateApproval(refund, setupRows) {
  const purposeId = refund.purpose && refund.purpose.id != null ? refund.purpose.id : null;
  if (purposeId === null) {
    return { verdict: PENDING, rule: '11', reason: 'no purpose id on the refund row' };
  }

  const method = lbl(refund.partialRefundForCancellationPaymentMethod);
  const setup = findSetup(setupRows, purposeId, method);

  if (!setup) {
    return {
      verdict: PENDING, rule: '11',
      reason: 'no clientRefundSetup row for purpose ' + purposeId +
              (method ? ' / method ' + method : ' / default method')
    };
  }

  if (setup.checkCeoLimit !== true) {
    return { verdict: CLEAN, rule: '11', reason: 'checkCeoLimit is off — this purpose has no limit, so an unsigned refund is correct by design' };
  }

  const limit = num(setup.limitForCeoApproval);
  if (limit === null) {
    return { verdict: PENDING, rule: '11', reason: 'checkCeoLimit is on but limitForCeoApproval is empty/non-numeric' };
  }

  const amount = num(refund.amount);
  if (amount === null) {
    return { verdict: PENDING, rule: '11', reason: 'refund amount missing or non-numeric' };
  }

  const approved = hasApproval(refund.managerAction) || hasApproval(refund.ceoAction);

  if (amount >= limit) {
    if (!approved) {
      return { verdict: RED, rule: '11', reason: 'amount reaches the purpose\'s own CEO limit and neither a manager nor a CEO approval is recorded', limit: limit };
    }
    return { verdict: CLEAN, rule: '11', reason: 'at or above the limit and an approval is recorded' };
  }

  if (autoApprovedFor(setup, refund)) {
    return { verdict: CLEAN, rule: '11', reason: 'below the limit and auto-approval is on for this payment method' };
  }

  if (approved) {
    return { verdict: CLEAN, rule: '11', reason: 'below the limit and an approval is recorded' };
  }

  return { verdict: PENDING, rule: '11', reason: 'below the limit, auto-approval off, no approval recorded — base rate unmeasured, routed to the verifier' };
}

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
    return null;
  }

  const dflt = forPurpose.find(function (r) {
    return lbl(r.partialRefundForCancellationPaymentMethod) === '';
  });
  return dflt || null;
}

function autoApprovedFor(setup, refund) {
  const m = lbl(refund.methodOfPayment).toUpperCase();
  if (setup.bothAutoApproved === true) return true;
  if (m.indexOf('BANK') !== -1) return setup.bankTransferAutoApproved === true;
  if (m.indexOf('CREDIT') !== -1 || m.indexOf('CARD') !== -1) return setup.creditCardAutoApproved === true;
  return false;
}

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

  const definitelyAbsent = refund.proofUploaded === false || sawEmptyArray;
  if (!definitelyAbsent) {
    return { verdict: PENDING, rule: 'G-ATTACH', reason: 'a document is required but the attachment fields were not present on the row — cannot tell' };
  }
  return { verdict: RED, rule: 'G-ATTACH', reason: 'this purpose requires a supporting document and the refund carries none' };
}

function scoreRefundWithGroups(refund, setupRows, opts) {
  const o = opts || {};
  const groups = o.groups || { GROUPS: GROUPS, groupOf: groupOf };
  const gaps = [];
  const findings = [];
  const reasons = [];

  if (!lbl(refund.contract)) {
    return finalize({ verdict: PENDING, reasons: ['no resolvable contract id (❹)'], gaps: [], rules_fired: ['4'] }, refund);
  }

  const purposeName = lbl(refund.purpose && refund.purpose.name) || lbl(refund.purposeName);
  const groupKey = groups.groupOf(purposeName);
  if (!groupKey) {
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

  const a = gateApproval(refund, setupRows);
  reasons.push(a.reason + ' (⓫)');
  if (a.verdict === RED) findings.push(a.reason + ' (⓫)');

  const att = gateAttachment(refund, setupRow);
  if (att.verdict === RED) findings.push(att.reason + ' (G-ATTACH)');
  else if (att.verdict === PENDING) gaps.push(att.reason + ' (G-ATTACH)');

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


const pop = $input.first().json;
const cfg = $("Assert Config Checksum").first().json;

if (cfg.config_ok === false) {
  throw new Error("REFUSING TO SCORE: " + cfg.config_denied +
    " | Rule 11 and G-ATTACH both need the per-purpose config. The population read is reported" +
    " above so you can see how far access extends, but no verdict is reachable without it.");
}

const setup = cfg.setup || [];
const rows = pop.rows || [];

const part = assertPartition();
if (part.purposes !== 41 || part.duplicates.length) {
  throw new Error("Purpose partition failed its own check: " + part.purposes +
    " purposes, duplicates " + JSON.stringify(part.duplicates) + ". Refusing to route on a broken table.");
}

const NOTE_KEYS = ["notes", "managerNotes", "description", "rejectionNotes"];

const cases = rows.map(function (r) {
  const c = scoreRefundWithGroups(r, setup, {});
  const src = {};
  for (const k of NOTE_KEYS) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) src[k] = v;
  }
  c.source_row = src;
  return c;
});

if (cases.length !== rows.length) {
  throw new Error("Scored " + cases.length + " cases against a population of " + rows.length + ". Refusing to summarise.");
}

function countBy(v) { return cases.filter(function (c) { return c.verdict === v; }).length; }
const counts = { scored: cases.length, findings: countBy("finding"), pending: countBy("pending"), clean: countBy("clean") };

const byGroup = {};
const byNoteKey = {};
cases.forEach(function (c) {
  const g = c.group || "(unrouted)";
  byGroup[g] = (byGroup[g] || 0) + 1;
  const keys = Object.keys(c.source_row || {});
  const k = keys.length ? keys[0] : "(none)";
  byNoteKey[k] = (byNoteKey[k] || 0) + 1;
});
console.log(JSON.stringify({ stage: "score", counts: counts, by_group: byGroup, note_key_coverage: byNoteKey }));

return [{ json: { cases: cases, counts: counts, by_group: byGroup, note_key_coverage: byNoteKey } }];
