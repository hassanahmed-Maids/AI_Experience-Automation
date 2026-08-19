// ── n8n Stage 2 wrapper ──────────────────────────────────────────────────────
// Everything above is the scoring core, kept byte-identical to
// audit/mv-monthly-payment/scorer.stage2.js so the offline suite can run against it.
const inp = $('Chunk In').first().json;
const c = $('Fan Out Contracts').item.json;
const led = $('Read Payment Ledger').item.json || {};
const det = $json || {};
const ledStatus = led.statusCode === undefined ? null : led.statusCode;
const ledBody = led.body || {};
const rows2 = Array.isArray(ledBody.content) ? ledBody.content : [];
const totalEl = ledBody.totalElements;
const ledgerComplete = ledStatus === 200 && typeof totalEl === 'number' && rows2.length === totalEl;
const detStatus = det.statusCode === undefined ? null : det.statusCode;
const d = det.body || {};
const contractObj = {
  id: c.contractId, clientId: c.clientId, prospectTypeCode: 'maidvisa.ae_prospect',
  startDate: d.contractStartDate || c.startOfContract || null,
  dateOfTermination: (d.dateOfTermination !== undefined ? d.dateOfTermination : c.dateOfTermination) || null,
  scheduledDateOfTermination: (d.scheduledDateOfTermination !== undefined ? d.scheduledDateOfTermination : c.scheduledDateOfTermination) || null,
  isScheduledForTermination: d.isScheduledForTermination === true,
  currentPayment: d.currentPayment || null,
  currentPayments: Array.isArray(d.currentPayments) ? d.currentPayments : null,
  preCollectedInfo: detStatus === 200 ? (d.preCollectedInfo || {}) : undefined,
  vip: c.vip === true, vVip: c.vVip === true, paymentPlan: d.paymentPlan || {}
};
let out;
if (detStatus !== 200) {
  out = { verdict: 'inconclusive', gate: 'surface', reason: 'CONTRACT_DETAILS unreadable (status ' + detStatus + ')', caps: ['contract details unreadable'], needsVerifier: true, monthUnderTest: null };
} else if (!ledgerComplete) {
  out = { verdict: 'inconclusive', gate: 'surface', reason: 'payment ledger incomplete - pulled ' + rows2.length + ' of ' + totalEl + ' (status ' + ledStatus + ')', caps: ['ledger incomplete - a negative cannot be trusted'], needsVerifier: true, monthUnderTest: null };
} else {
  out = scoreContractMonth({ auditedMonth: inp.auditedMonth, contract: contractObj, payments: rows2, options: {} });
}
const DISPLAY = { 'clean': 'OK', 'clean-vip-exception': 'OK - VIP Exception', 'finding': 'Red Flag', 'pending': 'Still in flight', 'inconclusive': 'Awaiting reviewer' };
const STATE = { 'clean': 'clean', 'clean-vip-exception': 'clean', 'finding': 'finding', 'pending': 'pending', 'inconclusive': 'pending' };
const monthKeyed = out.monthUnderTest || inp.auditedMonth;
const capsOut = Array.isArray(out.caps) ? out.caps : [];
return { json: {
  run_id: String(inp.runId || ''), case_key: String(c.contractId) + ':' + monthKeyed,
  contract_id: String(c.contractId), client_id: String(c.clientId),
  audit_month: String(inp.auditedMonth), target_month: String(out.monthUnderTest || ''),
  verdict: DISPLAY[out.verdict] || String(out.verdict || ''), state: STATE[out.verdict] || 'pending',
  red_flag_type: String(out.redFlagType || ''), reason_code: 'gate-' + String(out.gate || 'none'),
  reason_text: String(out.reason || ''), gate: String(out.gate || ''),
  expected_total: typeof out.expected === 'number' ? out.expected : 0,
  paid_total: typeof out.received === 'number' ? out.received : 0,
  gap: typeof out.gap === 'number' ? out.gap : 0,
  expected_known: typeof out.expected === 'number', expected_source: String(out.expectedSource || ''),
  is_pre_collected: out.isPreCollected === true,
  pre_collected_undetermined: out.isPreCollected === null || out.isPreCollected === undefined,
  month_shifted: out.monthShifted === true,
  advance_received: typeof out.advanceReceived === 'number' ? out.advanceReceived : 0,
  chain_settled: out.chainSettled === true,
  in_flight_aed: typeof out.inFlight === 'number' ? out.inFlight : 0,
  vip: c.vip === true, v_vip: c.vVip === true,
  refund_present: out.refundPresent === true, credit_note_present: out.reliefTextPresent === true,
  block_pil: out.refundPresent === true, payments_truncated: !ledgerComplete, ledger_rows: rows2.length,
  unknown_statuses: (out.unknownStatuses || []).join('|'),
  unrecognised_type_codes: (out.unrecognisedTypeCodes || []).join('|'),
  caps: capsOut.join(' | ').slice(0, 900), needs_human: out.needsVerifier === true,
  population_sample: inp.populationSample === true, scored_at: new Date().toISOString()
} };
