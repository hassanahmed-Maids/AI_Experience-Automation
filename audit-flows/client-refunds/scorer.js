'use strict';
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

module.exports = {
  TOLERANCE_AED, exceeds, num, lbl, hasApproval,
  findSetup, autoApprovedFor, gateApproval, inPopulation, scoreRefund,
  RED, CLEAN, PENDING
};
