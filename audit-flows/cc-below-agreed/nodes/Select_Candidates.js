// Select Candidates - which cases get their message evidence read.
//
// THE BUDGET IS THE WHOLE DESIGN CONSTRAINT HERE. The message reads are the only
// per-case ERP cost on this check: 1-2 calls per candidate, scoped with
// dateFrom/dateTo, against a ~500-call-per-run budget. The measured July funnel is
// 5,612 CC contracts paid, 4,575 exact, 984 short - so reading messages for every
// short month is roughly 250-800 calls and sits right on the budget. That is the
// number to watch, and it is why this node exists rather than fanning out over the
// whole population.
//
// It is ALSO why the verifier is not handed the 984: 983 of them are settled without
// it. Handing the raw 984 to a model would reproduce a 983-in-984 false-positive
// rate on judgement it never needed to make.
const payload = $('Build Case Payload').first().json;
const cases = (payload.result_data && payload.result_data.cases) || [];

function s(v) { return v === null || v === undefined ? '' : String(v); }
function n2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

const CALL_BUDGET = 500;          // 2 calls per candidate: WhatsApp + SMS
const MAX_CANDIDATES = Math.floor(CALL_BUDGET / 2);

const out = [];
const skippedNoClient = [];
let overBudget = 0;

for (const c of cases) {
  const m = c.metadata || {};
  const cm = c.computed || {};

  // Every case the scorer could not settle needs the quoted amount: the candidates
  // (gate 13) and the inconclusive ones (which may become explicable once we can
  // see what we actually asked for).
  if (c.new_state !== 'red_flag') continue;
  if (c.skip_computation === true) continue;

  // No client id means no message log can be read for it. Counted, never silently
  // dropped - a dropped case is an un-audited shortfall.
  if (!m.client_id) { skippedNoClient.push(c.case_key); continue; }

  out.push({ json: {
    case_key: c.case_key,
    contract_id: s(m.contract_id),
    client_id: s(m.client_id),
    client_name: s(m.client_name),
    maid_name: s(m.maid_name),
    audit_month: s(m.audit_month),
    // The window for the message read. A quote about this month can land slightly
    // after it - a reminder sent on 30 July is about July - so the read runs from
    // the start of the audited month to two weeks past its end rather than being
    // clipped to the calendar month.
    messages_from: s(cm.months && Object.keys(cm.months).length ? Object.keys(cm.months).sort()[0] : '') || '',
    state: c.new_state,
    reason_code: c.reason_code,
    reason_text: c.reason_text,
    requires_verifier: c.requires_verifier === true,
    requires_auditor_review: c.requires_auditor_review === true,
    verifier_reason: s(c.verifier_reason),
    is_candidate: c.is_candidate === true,
    escalation_blocked: c.escalation_blocked === true,
    escalation_blocked_reason: s(c.escalation_blocked_reason),
    relief_visible: c.relief_visible === true,

    // The arithmetic the verifier must NOT redo. Rule: trust these figures over any
    // reading of your own.
    expected: cm.expected,
    expected_gross: cm.expected_gross,
    expected_known: cm.expected_known !== false,
    expected_note: s(cm.expected_note),
    actual: n2(cm.actual),
    shortfall: cm.shortfall,
    tolerance: cm.tolerance,
    in_flight: n2(cm.in_flight),
    persistence: cm.persistence || null,
    coverage: cm.coverage || null,
    months: cm.months || {},

    refund_mp_reversing: n2(m.refund_mp_reversing),
    refund_other: n2(m.refund_other),
    unrecognised_refund: m.unrecognised_refund === true,
    types_seen: m.types_seen || {},
    discount_text: Array.isArray(m.discount_text) ? m.discount_text : [],
    gate4_departure: m.gate4_departure || null,
    rate_is_contractual_not_billed: true
  } });
}

// The budget is a hard ceiling, and going over it is reported rather than absorbed.
// Truncating silently would leave un-read shortfalls looking identical to read ones.
if (out.length > MAX_CANDIDATES) {
  overBudget = out.length - MAX_CANDIDATES;
  console.log(JSON.stringify({ stage: 'select_candidates', warning:
    'OVER THE MESSAGE-READ BUDGET: ' + out.length + ' candidates x 2 calls exceeds the ~' + CALL_BUDGET +
    '-call budget by ' + (overBudget * 2) + ' calls. Nothing is truncated - the run proceeds and this ' +
    'is on the record - because dropping candidates would hide shortfalls. If this fires every run, ' +
    'either the budget or the candidate definition needs revisiting, not the cases.' }));
}

console.log(JSON.stringify({ stage: 'select_candidates',
  selected: out.length,
  candidates: out.filter(function (o) { return o.json.is_candidate; }).length,
  inconclusive: out.filter(function (o) { return o.json.requires_auditor_review; }).length,
  skipped_no_client_id: skippedNoClient.length,
  skipped_no_client_id_keys: skippedNoClient.slice(0, 50),
  estimated_message_calls: out.length * 2,
  call_budget: CALL_BUDGET,
  over_budget_by: overBudget * 2 }));

return out;

