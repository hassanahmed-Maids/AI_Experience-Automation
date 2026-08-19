// Guards - gate 35 and the circularity tripwire, added 2026-08-19.
//
// WHY THIS IS ITS OWN NODE RATHER THAN TWO EDITS TO THE SCORER, stated plainly because the
// ideal placement would be inside the gate chain. Compute Case States is 576 lines of
// carefully ordered gates, tested 13/13 against the spec's own cases, and it is shipped into
// n8n as a string - so editing it in place means retyping the whole body, and a slip there
// moves money. These two guards need no scorer internals: gate 35 needs the plan dates
// (available from Join Enrichment) and the audited window, and the tripwire needs the
// finished verdicts. So they run here, on the scorer's output, and the scorer stays a pure
// function nobody had to touch.
//
// WHAT THAT COSTS, AND IT IS NOT NOTHING: the scorer still scores a gate-35 case internally
// before this node overwrites the verdict, so its OWN log line will count that case among
// its candidates. This node logs `scorer_tally_superseded_for` so the two logs can be
// reconciled by a reader. Nothing downstream sees the superseded verdict - Adjudicate Cases
// reads this node's output, not the scorer's.
const validated = $('Validate Inputs').first().json;
const WINDOWS = validated.persistence_windows || [];
const auditKey = WINDOWS.length ? WINDOWS[0].key : validated.audit_month;
const rangeEnd = validated.range_end;

function s(v) { return v === null || v === undefined ? '' : String(v); }
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

const TOLERANCE = 5.00;   // must match Compute Case States

const incoming = $input.first().json || {};
const cases = Array.isArray(incoming.cases) ? incoming.cases : null;
if (!cases) {
  throw new Error('Guards: the scorer output carried no `cases` array (keys=' +
    Object.keys(incoming).join(',') + '). Refusing to pass an unrecognised payload downstream, ' +
    'because Adjudicate Cases would read zero cases as a clean run.');
}

// The plan deltas, by case_key. Gate 35 needs `monthly_schedule_starts`, which the scorer
// does not carry through into its output - so it is read from the enrichment join.
const planByKey = {};
let planSource = 'Join Enrichment';
try {
  for (const i of $('Join Enrichment').all()) {
    const j = i.json || {};
    if (j.case_key) planByKey[s(j.case_key)] = j.plan || {};
  }
} catch (e) {
  // Enrichment only runs for candidates; a run where gate 1 closed everyone out has no
  // Join Enrichment output at all. That is not an error - it just means gate 35 has nothing
  // to test - but it must be VISIBLE rather than looking like a gate that passed.
  planSource = 'unavailable (' + e.message.split('.')[0] + ')';
}

// ---------------------------------------------------------------- GATE 35
// WAS A MONTHLY PAYMENT EVEN DUE THIS MONTH?
//
// ADDED AFTER A LIVE FALSE CLEARANCE AND A LIVE FALSE CANDIDATE, both from the same blind
// spot: nothing read WHEN the contract's recurring schedule begins.
//
//   1103085 / 1103086 / 1103097 - brand-new contracts. currentPayment.amountValue returned
//   the ONE-TIME first-month figure, which equalled what the client had just paid, so the
//   case scored exactly-paid and SELF-CLEARED. Nothing was verified.
//   1101305 - the opposite. Its recurring schedule starts 2026-09-01, the client paid the
//   stated one-time amount, and currentPayment returned the FULL monthly rate - so the case
//   read ~58% short. A false candidate costs a reviewer's day; a false clearance costs the
//   finding.
//
// The plan prose settles it. Measured over 44 live contracts, the date on the `(Monthly)`
// line is the RECURRING-SCHEDULE START, not a next-payment date: median +0.8 months after
// startOfContract, 40 of 44 within 0-2.5 months, and it stays fixed in the past on old
// contracts (1014657 started 2022-07-12, its line reads 2022-08-01).
//
// IT IS NOT A CLEARANCE OF THE MONEY. Whether the one-time amount itself was correct is a
// different question against a different expectation, and no gate in this check can answer
// it - so the case is closed OUT OF SCOPE under its own reason code, countable and
// auditable, never merged into paid_in_full.
//
// IT NEVER OVERWRITES GATE 10 OR A CARRIED CASE. A month with nothing received belongs to
// the sibling check whatever the plan says, and a carried case was not re-scored at all.
const PROTECTED_REASONS = ['out_of_scope_nothing_received', 'payment_in_flight', 'carried_forward'];
let g35 = 0;
const supersededFrom = {};
const out = cases.map(function (k) {
  if (k.skip_computation === true) return k;
  if (PROTECTED_REASONS.indexOf(s(k.reason_code)) !== -1) return k;
  const plan = planByKey[s(k.case_key)] || {};
  const monthlyStarts = s(plan.monthly_schedule_starts);
  if (!monthlyStarts || monthlyStarts <= rangeEnd) return k;

  g35++;
  supersededFrom[s(k.reason_code) || 'none'] = (supersededFrom[s(k.reason_code) || 'none'] || 0) + 1;
  const oneTimes = Array.isArray(plan.one_time_dates) ? plan.one_time_dates : [];
  return Object.assign({}, k, {
    new_state: 'green_flag',
    reason_code: 'no_monthly_obligation_yet',
    reason_text: 'The contract\'s own payment plan starts its recurring monthly schedule on ' +
      monthlyStarts + ', after ' + auditKey + ' ended (' + rangeEnd + '), so no MONTHLY payment was due ' +
      'in the audited month - what was due was a stated one-time amount' +
      (oneTimes.length ? ' (plan shows one-time lines dated ' + oneTimes.join(', ') + ')' : '') +
      '. Out of scope for this check rather than paid-in-full: whether that one-time amount was itself ' +
      'correct is a different expectation no gate here can test. currentPayment is unreliable on these ' +
      'contracts in BOTH directions - measured returning the one-time figure on some and the full ' +
      'monthly rate on others, which is why this is decided from the plan schedule instead.',
    finding_reason: '',
    requires_verifier: false,
    verifier_reason: '',
    computed: Object.assign({}, k.computed, {
      expected: null,
      expected_note: 'no monthly payment was due in ' + auditKey + '; the recurring schedule starts ' +
        monthlyStarts,
      shortfall: null,
      variance: null,
      monthly_schedule_starts: monthlyStarts,
      one_time_dates: oneTimes,
      superseded_verdict: { reason_code: s(k.reason_code), new_state: s(k.new_state),
        note: 'the scorer scored this case before gate 35 saw the plan schedule; its verdict is void' }
    }),
    gate35_applied: true
  });
});

// ------------------------------------------------- THE CIRCULARITY TRIPWIRE
// WHAT IT WATCHES FOR. `expected` comes from currentPayment.amountValue, and ERP computes
// that with a two-tier fallback (PaymentRepository.java:519-531,
// ContractService.java:1587-1593): tier one takes the amount from an actual PAYMENT row in
// the current window, tier two computes the contractual amount from the payment term. If
// tier one ever starts firing for this flow's reads, the audit compares a payment against
// itself: every case lands exactly-paid, the book goes green, and NO PER-CASE GATE CAN
// NOTICE, because each case individually looks perfectly reconciled.
//
// PROBED 2026-08-19 AND IT IS NOT FIRING TODAY: contract 1101305 paid ~42% of its agreed
// rate and currentPayment still returned the full agreed figure, matching 1054346 / 1086789
// / 1090543. So this is a tripwire against a regression, not a live defect - which is
// exactly when one is worth having, because the day it starts firing the output looks
// BETTER rather than worse.
//
// WHY THESE NUMBERS. Measured July 2026 funnel: 5,612 CC contracts paid, 4,575 exact, 984
// short - an 81.5% exact rate is NORMAL, so a naive "too many exact matches" alarm would
// fire every month. The ceiling is 97%, sixteen points above the measured norm and
// unreachable by ordinary drift. The second test is sharper: a month of this size with ZERO
// shortfalls is not a well-behaved book, it is a broken comparison.
//
// IT THROWS. Halting costs a run; publishing a book of green verdicts built on a circular
// comparison costs the reader's trust in every green this check ever prints.
const withVariance = out.filter(function (k) {
  return !k.skip_computation && k.computed && k.computed.variance !== null &&
         k.computed.variance !== undefined;
});
const exactlyMatched = withVariance.filter(function (k) { return r2(k.computed.variance) === 0; }).length;
const shortfallCases = withVariance.filter(function (k) { return k.computed.variance < -TOLERANCE; }).length;
const exactShare = withVariance.length ? exactlyMatched / withVariance.length : null;
const EXACT_SHARE_CEILING = 0.97;
const TRIPWIRE_MIN_POPULATION = 500;

if (withVariance.length >= TRIPWIRE_MIN_POPULATION && exactShare > EXACT_SHARE_CEILING) {
  throw new Error('CIRCULARITY TRIPWIRE: ' + exactlyMatched + ' of ' + withVariance.length +
    ' scored cases (' + Math.round(exactShare * 1000) / 10 + '%) have expected EXACTLY equal to what was ' +
    'received, against a measured norm of 81.5% (July 2026: 4,575 exact of 5,612) and a ceiling of ' +
    Math.round(EXACT_SHARE_CEILING * 100) + '%. The likely cause is ERP\'s currentPayment falling ' +
    'through to its PAYMENT-derived tier, which makes this audit compare a payment against itself and ' +
    'turns the whole book green. Verify before re-running: take a contract that underpaid and compare ' +
    'its currentPayment.amountValue against ContractPaymentTerm/getnewddInfo?contractId=&startDate= ' +
    '(suggestedAmount), which is computed from the payment term and never reads PAYMENTS. Refusing to ' +
    'publish these verdicts.');
}
if (withVariance.length >= TRIPWIRE_MIN_POPULATION && shortfallCases === 0) {
  throw new Error('CIRCULARITY TRIPWIRE: ' + withVariance.length + ' scored cases and NOT ONE is short by ' +
    'more than the AED ' + TOLERANCE.toFixed(2) + ' tolerance. July 2026 measured 984 short of 5,612, and ' +
    'this check exists because ~108 contracts are stably under-billed at ~AED 64,000 a month. A perfectly ' +
    'reconciled book of this size is a broken comparison, not good news - most likely expected is being ' +
    'read from the payment itself. Refusing to publish a clean bill of health that was never tested.');
}

const tally = { green: 0, pending: 0, candidate: 0, carried: 0, inconclusive: 0 };
for (const k of out) {
  if (k.skip_computation === true) tally.carried++;
  else if (k.new_state === 'green_flag') tally.green++;
  else if (k.new_state === 'pending_flag') tally.pending++;
  else tally.candidate++;
  if (k.requires_verifier === true) tally.inconclusive++;
}

console.log(JSON.stringify({ stage: 'guards',
  cases: out.length,
  plan_source: planSource,
  plans_available: Object.keys(planByKey).length,
  gate35_no_monthly_obligation_yet: g35,
  scorer_tally_superseded_for: supersededFrom,
  cases_with_a_variance: withVariance.length,
  exactly_matched: exactlyMatched,
  exact_share_pct: exactShare === null ? null : Math.round(exactShare * 1000) / 10,
  exact_share_ceiling_pct: Math.round(EXACT_SHARE_CEILING * 100),
  shortfall_cases: shortfallCases,
  circularity_tripwire: withVariance.length < TRIPWIRE_MIN_POPULATION
    ? 'not armed - fewer than ' + TRIPWIRE_MIN_POPULATION + ' scored cases'
    : 'armed and passed: exact share under the ceiling and shortfalls present',
  tally: tally,
  note: 'gate 35 verdicts REPLACE what the scorer said for those cases; the scorer\'s own log line ' +
        'counts them under its original verdicts, which is what scorer_tally_superseded_for reconciles.' }));

return [{ json: { cases: out, _guards: {
  gate35_applied: g35, exact_share_pct: exactShare === null ? null : Math.round(exactShare * 1000) / 10,
  shortfall_cases: shortfallCases, tally: tally } } }];
