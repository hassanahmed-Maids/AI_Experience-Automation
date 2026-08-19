// Adjudicate Cases - the deterministic gate between scoring and publishing.
//
// It NEVER re-derives an expected amount: it reads only the figures the scorer
// published, so it is structurally incapable of disagreeing with the scoring it is
// gating. Three passes, and one of them is this check's whole character.
const input = $input.first().json || {};
const cases = Array.isArray(input.cases) ? input.cases : [];

function s(v) { return v === null || v === undefined ? '' : String(v); }

// ---------------------------------------------------------------------------
// PASS 1 - REPAIR: carried and auditor-pinned states.
// The scorer deliberately leaves new_state null on a carried case rather than
// guessing. Restore the carried state; never touch a pinned override.
let repaired = 0, pinned = 0;
for (const k of cases) {
  if (k.skip_computation !== true) continue;
  const override = s(k.manual_override_state);
  if (override) {
    k.new_state = override;
    k.reason_code = 'manual_override';
    k.reason_text = 'A human set this case to ' + override + '. It is not re-scored, in window or out.';
    k.requires_verifier = false;
    pinned++;
    continue;
  }
  if (k.carried_state) {
    k.new_state = k.carried_state;
    k.reason_code = 'carried_forward';
    k.reason_text = 'Carried forward as ' + k.carried_state + ' from a previous run: outside this ' +
      'run\'s window and not re-scored.';
    k.requires_verifier = false;
    repaired++;
  } else {
    throw new Error('Case ' + k.case_key + ' is marked skip_computation with neither a carried state ' +
      'nor an override. Refusing to publish a case with no state.');
  }
}

// ---------------------------------------------------------------------------
// PASS 2 - GATE 13, ENFORCED HERE AS WELL AS IN THE SCORER.
// No case may leave this flow as an established finding on arithmetic alone. The
// rate on file is the CONTRACTUAL rate and is not reliably what was billed - on
// 1054346 / 1086789 / 1090543 it read 4,715 / 4,715 / 5,712 while the client paid
// 2,100 / 2,100 / 3,360 for months, with BOTH numbers sent to the client in
// writing. So every red is a CANDIDATE until the verifier has read what we quoted.
//
// This is belt-and-braces on purpose: the scorer sets requires_verifier, and this
// pass refuses to let a red through without it. If a future edit to the scorer ever
// forgets, the run fails loudly here instead of publishing a finding that the spec
// says cannot exist.
let candidates = 0;
for (const k of cases) {
  if (k.skip_computation === true) continue;
  if (k.new_state !== 'red_flag') continue;
  if (k.requires_verifier !== true) {
    throw new Error('Case ' + k.case_key + ' is red without requires_verifier. Gate 13 says a gap ' +
      'against the contract rate is a CANDIDATE, never a finding on its own - the scorer must not ' +
      'produce a final red. Refusing to publish it as one.');
  }
  if (s(k.finding_reason)) {
    throw new Error('Case ' + k.case_key + ' arrived with finding_reason "' + k.finding_reason +
      '" already set. Only the verifier may decide between Underpaid and Under-billed, because only ' +
      'the quoted amount distinguishes them.');
  }
  k.is_candidate = true;
  candidates++;
}

// ---------------------------------------------------------------------------
// PASS 3 - INCONCLUSIVE, kept DISTINCT from pending.
// The spec is explicit that these are different states and that collapsing them
// would make an unread case indistinguishable from an unresolvable one:
//   pending      - the money simply has not moved yet
//   inconclusive - we read the evidence and still cannot tell
// The skeleton has no `inconclusive` state, so an inconclusive case stays red (the
// money stays on the books) and carries requires_auditor_review, which the report
// renders as its own band and the verifier branch can never turn into a finding.
let inconclusive = 0;
for (const k of cases) {
  if (k.skip_computation === true) continue;
  const m = k.metadata || {};
  const c = k.computed || {};
  const reasons = [];

  if (c.expected_known === false) {
    reasons.push('the contract\'s own rate could not be read, so the expected amount is UNKNOWN - ' +
      'never zero, and never the price card');
  }
  if (c.coverage && c.coverage.known === false) {
    reasons.push('maid coverage for the month is unknown (' + s(c.coverage.why) + ')');
  }
  if (m.unrecognised_refund === true) {
    reasons.push('a refund type outside the known nine is present, so its effect on the month is ' +
      'unverified');
  }
  if (Number(m.refund_other) > 0) {
    reasons.push('AED ' + m.refund_other + ' was refunded under a type that does not reverse the ' +
      'monthly payment - annotated, never netted');
  }
  // GATE 6 can neither clear nor exclude: ERP stores no freeze date anywhere, and a
  // "currently frozen" test is a proven 4-of-4 false positive. Where the shortfall
  // did not persist, a freeze is exactly what it could be - so it is named rather
  // than silently ruled out.
  if (k.reason_code === 'shortfall_unstable') {
    reasons.push('the shortfall does not persist across the window, and ERP stores no freeze date to ' +
      'rule a freeze in or out (gate 6 is unbuildable; gate 18 is the mitigation)');
  }

  if (k.new_state === 'red_flag' && reasons.length) {
    k.requires_auditor_review = true;
    k.reason_code = 'inconclusive';
    k.reason_text = k.reason_text + ' CANNOT TELL: ' + reasons.join('; ') +
      '. This case must be read by an auditor and must never be reported as a finding on this ' +
      'evidence alone.';
    inconclusive++;
  } else {
    k.requires_auditor_review = false;
  }
}

// ---------------------------------------------------------------------------
// PASS 4 - RELIEF VISIBILITY. A discount or a credit note does not settle a
// shortfall, but it does mean relief was given somewhere, so "nothing explains it"
// is not established. Flagged so the verifier can never escalate past review.
let reliefBlocked = 0;
for (const k of cases) {
  if (k.skip_computation === true) continue;
  const m = k.metadata || {};
  const hasRelief = (Array.isArray(m.discount_text) && m.discount_text.length > 0);
  k.relief_visible = hasRelief;
  if (k.new_state === 'red_flag' && hasRelief) {
    k.escalation_blocked = true;
    k.escalation_blocked_reason = 'a discount is written on this contract (' +
      m.discount_text.join(' | ') + '), so relief exists somewhere and "nothing explains it" is not ' +
      'established. Note the discount is NOT subtracted from the expectation - see gate4_departure.';
    reliefBlocked++;
  } else {
    k.escalation_blocked = false;
    k.escalation_blocked_reason = '';
  }
}

console.log(JSON.stringify({ stage: 'adjudicate_cases', cases: cases.length,
  carried_repaired: repaired, pinned_overrides: pinned,
  candidates_requiring_the_verifier: candidates, inconclusive: inconclusive,
  escalation_blocked_by_relief: reliefBlocked,
  green: cases.filter(function (k) { return k.new_state === 'green_flag'; }).length,
  pending: cases.filter(function (k) { return k.new_state === 'pending_flag'; }).length,
  gate4_departures: cases.filter(function (k) { return k.metadata && k.metadata.gate4_departure; }).length,
  note: 'No case leaves this node as an established finding. Underpaid vs Under-billed is the ' +
        'verifier\'s call, because only the quoted amount distinguishes them.' }));

return [{ json: { cases: cases } }];
