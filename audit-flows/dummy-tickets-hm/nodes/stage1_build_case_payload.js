// The portal payload (Pattern B contract: result_data.summary + result_data.cases[]).
//
// PER-CASE DETAIL BELONGS HERE and only here - the portal case store IS 'behind the case'. The
// runs log carries counts and totals only.
//
// THE HEADLINE BEHAVIOURAL CHANGE vs the flow this replaces: it mapped 'anything not refunded'
// to red_flag, which published a not-yet-due refund, a zero-amount CANCELED shell and an ERP
// outage all as red flags about people. Here 'pending' and 'needs_verifier' are their own portal
// states, and only a genuine finding is a red.
const input = $input.first().json || {};
const scored = input._scored || input;
const validated = scored.validated || $('Validate Inputs').first().json;
const cases = scored.cases || [];
const counts = scored.counts || {};

const REASON_TEXT = {
  financial_loss: 'Dummy ticket Lost / refund failed - confirmed financial loss',
  refund_overdue: 'Dummy ticket past its scheduled refund date, or never scheduled, and still unrefunded',
  refunded: 'Dummy ticket refunded - the money came back',
  awaiting_scheduled_refund: 'Refund is scheduled and not yet due - re-read on the next run',
  immaterial: 'Ticket carries no amount, so it cannot open a case',
  erp_unreachable: 'ERP could not be read for this applicant after one retry - infrastructure, not a finding',
  unsettled: 'No gate settled this ticket - a gap in the rules, recorded so it stays visible',
  used_review: 'Dummy ticket was flown on - a human must read the written record',
  unresolved: 'The verifier could not answer from the record',
  repeat_bookings: 'Repeated dummy bookings for one applicant - a booking-pattern review, ' +
    'separate from whether the money came back'
};

const prevByKey = {};
for (const p of (validated.previous_cases || [])) prevByKey[String(p.case_key)] = p.state;

const portalCases = [];
let red_to_green = 0, new_red = 0, green_to_red = 0, surfaced_by_repeat = 0;

for (const c of cases) {
  const prev = prevByKey[String(c.case_key)] || null;

  // GATE 110 IS ADDITIVE. It routes to a reviewer ALONGSIDE whatever the money gates concluded -
  // 'separate from whether any single ticket was refunded'. So it has to be able to SURFACE a
  // case the money gates would have left silent, or the rule does nothing on a clean applicant.
  // It must never replace or downgrade a verdict: a finding still outranks it.
  const needsRepeat = !!c.needs_repeat_review;

  // A clean case produces NO portal row - unless it resolves a previous red, or the repeat
  // review pulls it in.
  if (c.state === 'clean' && !needsRepeat) {
    if (prev === 'red_flag') {
      red_to_green++;
      portalCases.push({ case_key: c.case_key, previous_state: prev, new_state: 'green_flag',
        reason_code: 'refunded_resolved',
        reason_text: 'Dummy ticket now refunded - auto-resolved',
        metadata: { applicant_id: c.applicant_id, verdict: c.verdict,
          dummy_ticket_count: c.dummy_ticket_count, tickets: c.tickets,
          hustler_workflow_url: c.hustler_url } });
    }
    continue;
  }

  // Portal state takes the MOST urgent of the money verdict and the repeat review.
  let newState, reasonCode;
  if (c.state === 'finding') {
    newState = 'red_flag'; reasonCode = c.verdict;
  } else if (c.state === 'verifier') {
    newState = 'needs_verifier'; reasonCode = c.verdict;
  } else if (needsRepeat) {
    // clean or pending money verdict, surfaced only by the booking-pattern question
    newState = 'needs_verifier'; reasonCode = 'repeat_bookings'; surfaced_by_repeat++;
  } else {
    newState = 'pending'; reasonCode = c.verdict;
  }

  if (newState === 'red_flag') {
    if (prev === null) new_red++;
    else if (prev === 'green_flag' || prev === 'green_flag_manual') green_to_red++;
  }

  portalCases.push({ case_key: c.case_key, previous_state: prev, new_state: newState,
    reason_code: reasonCode, reason_text: REASON_TEXT[reasonCode] || reasonCode,
    metadata: {
      applicant_id: c.applicant_id,
      // Both are carried: the reviewer needs to know the money answer even when the booking
      // pattern is what brought the case to them.
      money_verdict: c.verdict, money_state: c.state,
      repeat_review: needsRepeat, gate_reason: c.reason,
      driving_ticket_id: c.driving_ticket_id, dummy_ticket_count: c.dummy_ticket_count,
      exposure_aed: c.exposure_aed, flags: c.flags, tickets: c.tickets,
      infrastructure: !!c.infrastructure,
      http_status: (c.http_status === undefined ? null : c.http_status),
      seeded_from_previous: !!c.seeded_from_previous,
      in_window_transactions: c.in_window_transactions || [],
      hustler_workflow_url: c.hustler_url
    } });
}

// ---- THE VERDICT. ZERO FINDINGS IS NOT THE SAME AS A CLEAN MONTH. --------------------------
// Measured 2026-08-24, execution 100409: 399 of 399 applicants came back erp_unreachable - the
// Hustlers endpoint refuses this identity with INSUFFICIENT_PERMISSIONS - and this row said
// overall 'pass', result 'pass', findings 0. The run had not read a single applicant's tickets.
//
// The bug was that `overall` was computed from findings alone, and a check that COULD NOT LOOK
// produces exactly the same zero a check that looked and found nothing produces. Those two states
// are indistinguishable in the field a reader reads first, and one of them is a false all-clear
// about real people's money.
//
// Gate 2 already refuses to trust an absence before pulled == totalElements. That guards the
// POPULATION. Nothing guarded the EVIDENCE. This is the same rule one layer down: an entity that
// could not be read has not been audited, and a run that could not read some of its entities is a
// declared PARTIAL, never a pass.
//
//   findings > 0                      -> 'fail'        (a real finding is real even on a partial run)
//   findings == 0 and all readable    -> 'pass'        (looked everywhere, found nothing)
//   findings == 0 and some unreadable -> 'incomplete'  (found nothing, could not look everywhere)
//
// `result` carries the same logic to the portal, where 'error' is the existing value for a run
// that did not produce a usable audit - the portal must never record this as a clean month.
const unreachable = Number(scored.unreachable || 0);
const evidenceComplete = unreachable === 0;
const findings = Number(counts.finding || 0);
const overallVerdict = findings > 0 ? 'fail' : (evidenceComplete ? 'pass' : 'incomplete');
const portalResult = findings > 0 ? 'fail' : (evidenceComplete ? 'pass' : 'error');

const summary = Object.assign({}, input.record || {}, {
  overall: overallVerdict,
  // Always present, both ways round, so a reader never has to infer completeness from a count
  // they might not scroll to.
  evidence_complete: evidenceComplete,
  applicants_unreadable: unreachable,
  runs_log: input.runs_log || 'not_configured',
  portal_rows: portalCases.length,
  surfaced_by_repeat_review: surfaced_by_repeat,
  transitions: { red_to_green: red_to_green, green_to_red: green_to_red,
    new_red: new_red, new_green: 0 }
});

return [{ json: {
  check_id: validated.check_id, run_id: validated.run_id, callback_url: validated.callback_url,
  result: portalResult,
  result_data: { summary: summary, cases: portalCases },
  notes: 'Rebuilt on the CC Non Received golden rails. Gates 50/90/100 are implemented, so a ' +
    'not-yet-due refund is pending rather than red and a zero-amount ticket is parked rather than ' +
    'sized. Repeat-booking review is ADDITIVE and can surface a case whose money all came back. ' +
    'Verifier rules 1 and 2 are NOT built: those cases are routed to human review.',
  completed_at: new Date().toISOString()
}}];