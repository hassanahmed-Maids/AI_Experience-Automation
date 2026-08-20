// Build Evidence Bundle - assemble what WE told the client, then decide whether the
// model is needed at all.
//
// WHAT THE VERIFIER IS FOR ON THIS CHECK, AND IT IS NOT WHAT IT WAS ON THE SIBLING.
// There, the model read staff prose to see whether a missing month was explained.
// Here it does one irreducible reading job: two template families quote DIFFERENT
// amounts for the same month - `..._monthly_reminder_*` quotes the contract's stored
// rate, `..._online_reminder_*` quotes what accounting actually asked for - and
// deciding which was agreed decides whether this is `Under-billed` or `Underpaid`.
// That cannot be reduced to arithmetic, which is why gate 14 says the extraction is
// explicitly NOT purely deterministic.
//
// WHAT IS DELIBERATELY NOT FETCHED, and it is a stated limit rather than an
// oversight: complaints, manager notes and sales notes. Reading them for every
// candidate would cost 3-5 calls each on top of the 2 message calls - roughly
// 3,000-5,000 calls against a ~500-call budget on a 984-candidate month. So the
// message log is the corroborating witness here, and a case the messages cannot
// settle comes out INCONCLUSIVE for an auditor to read in the portal. It never comes
// out as a finding on absent evidence.
const bundlesIn = $('Resolve Quoted Amounts').all().map(function (i) { return i.json; });

function s(v) { return v === null || v === undefined ? '' : String(v); }
function n2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

const VALID_VERDICTS = [
  'Agent Justified',
  'Agent Candidate - Auditor Review Required',
  'Agent Finding - Under-billed',
  'Agent Finding - Underpaid'
];
const REVIEW = 'Agent Candidate - Auditor Review Required';

const out = [];
const stats = { model: 0, deterministic: 0, no_quote: 0, read_failed: 0, both_families: 0 };

for (const c of bundlesIn) {
  const q = c.quoted || {};
  const quotes = Array.isArray(q.quotes) ? q.quotes : [];
  const expected = c.expected;
  const actual = n2(c.actual);
  const contractQuoted = q.contract_rate_quoted;
  const requestedQuoted = q.requested_quoted;

  // ---------------------------------------------------------- routeVerdict()
  // The ONE place the verdict boundary lives on this check.
  function routeVerdict() {
    // A failed message read is never an absence of evidence. Rule 21: an unread
    // case is inconclusive, and it is never a finding.
    if (q.read_failed === true) {
      return { preset: REVIEW, cls: 'UNRESOLVED',
        why: 'the client message log could not be read, so what we quoted for this month is unknown. ' +
             'Unread is not unexplained - no case is reported on evidence a human has not seen.' };
    }
    // No quote found is ALSO not evidence that nothing was quoted: the message may
    // predate the log window, have gone by a channel this endpoint does not carry,
    // or used a template the baked lookup does not know (the lookup is a snapshot,
    // pulled ' + q.lookup_pulled_on + ').
    if (q.no_quote_found === true || quotes.length === 0) {
      return { preset: REVIEW, cls: 'NO TEXT',
        why: 'no quoted amount could be resolved from the message log for this month, so gate 13 has ' +
             'nothing to corroborate the gap against. The baked template lookup was pulled ' +
             s(q.lookup_pulled_on) + ' and knows ' + s(q.templates_known) + ' templates; an unknown ' +
             'template lands here too.' };
    }
    // The expectation itself is unreadable - there is no comparison to make.
    if (c.expected_known === false) {
      return { preset: REVIEW, cls: 'UNRESOLVED',
        why: 'the contract\'s own rate could not be read, so there is no expectation to compare a ' +
             'quote against.' };
    }
    return { preset: '', cls: '', why: '' };
  }
  const routed = routeVerdict();

  // ------------------------------------------------------------- the prompt
  // Built here rather than in the agent node so the exact text a verdict rests on
  // is visible in the execution data.
  const bothFamilies = (q.families_seen || []).length > 1;
  if (bothFamilies) stats.both_families++;

  const quoteLines = quotes.map(function (x) {
    return '  - ' + s(x.sent_date) + ' [' + s(x.channel) + '] template ' + s(x.template) +
      ' (' + s(x.family) + ') quoted AED ' + x.amount +
      (s(x.label) ? ' for "' + s(x.label) + '"' : '') + '. Resolved by ' + s(x.resolved_by) + '.';
  }).join('\n');

  const facts = {
    case_key: s(c.case_key),
    contract_id: s(c.contract_id),
    client_id: s(c.client_id),
    audit_month: s(c.audit_month),
    reason_code: s(c.reason_code),
    expected: expected,
    expected_note: s(c.expected_note),
    actual: actual,
    shortfall: c.shortfall,
    tolerance: c.tolerance,
    contract_rate_quoted: contractQuoted,
    requested_quoted: requestedQuoted,
    both_families_quoted: bothFamilies,
    persistence: c.persistence || null,
    coverage: c.coverage || null,
    discount_text: Array.isArray(c.discount_text) ? c.discount_text : [],
    gate4_departure: !!c.gate4_departure,
    escalation_blocked: c.escalation_blocked === true,
    escalation_blocked_reason: s(c.escalation_blocked_reason),
    requires_auditor_review: c.requires_auditor_review === true,
    lookup_pulled_on: s(q.lookup_pulled_on),
    quotes_seen: quotes.length
  };

  const prompt =
    'CASE ' + facts.case_key + ' - contract ' + facts.contract_id + ', month ' + facts.audit_month + '\n' +
    'Deterministic outcome: CANDIDATE (' + facts.reason_code + '). Nothing is a finding yet.\n\n' +
    'THE ARITHMETIC - trust these figures, do not recompute them:\n' +
    '  contract rate on file (expected): AED ' + expected + '  (' + facts.expected_note + ')\n' +
    '  actually received this month:     AED ' + actual + '\n' +
    '  shortfall:                        AED ' + (facts.shortfall === null ? 'unknown' : facts.shortfall) +
      '   (tolerance AED ' + facts.tolerance + ')\n' +
    '  persistence across the window:    ' + s(facts.persistence && facts.persistence.verdict) +
      ' (' + s(facts.persistence && facts.persistence.months_short) + ' of ' +
      s(facts.persistence && facts.persistence.months_seen) + ' months short, variance AED ' +
      s(facts.persistence && facts.persistence.variance) + ')\n' +
    (facts.discount_text.length ? '  discount written on the contract: ' + facts.discount_text.join(' | ') +
      '\n    (NOT subtracted from the expectation - the stored rate already reflects it)\n' : '') +
    '\nWHAT WE QUOTED THIS CLIENT (from the message log, resolved by parameter NAME):\n' +
    (quoteLines || '  (none resolved)') + '\n' +
    '\n  amount quoted by the CONTRACT-RATE family:      ' +
      (contractQuoted === null || contractQuoted === undefined ? 'none' : 'AED ' + contractQuoted) + '\n' +
    '  amount quoted by the ACCOUNTING-REQUESTED family: ' +
      (requestedQuoted === null || requestedQuoted === undefined ? 'none' : 'AED ' + requestedQuoted) + '\n' +
    (facts.escalation_blocked ? '\nHARD STOP: ' + facts.escalation_blocked_reason + '\n' : '') +
    (facts.requires_auditor_review ? '\nThis case is already marked CANNOT TELL. It cannot become a ' +
      'finding on this evidence.\n' : '') +
    '\nDecide whether we under-billed this client, the client underpaid, or the gap is explained.';

  if (routed.preset) stats.deterministic++; else stats.model++;
  if (routed.cls === 'NO TEXT') stats.no_quote++;
  if (routed.cls === 'UNRESOLVED') stats.read_failed++;

  out.push({ json: {
    case_key: facts.case_key,
    contract_id: facts.contract_id,
    client_id: facts.client_id,
    preset_verdict: routed.preset,
    preset_evidence_class: routed.cls,
    why_no_model: routed.why,
    prompt: prompt,
    facts: facts,
    quoted: q,
    evidence: quotes.map(function (x) {
      return { kind: 'message', id: s(x.template), link: '', quote: s(x.sent_date) + ' [' + s(x.channel) +
        '] AED ' + x.amount + (s(x.label) ? ' for ' + s(x.label) : '') };
    }),
    valid_verdicts: VALID_VERDICTS
  } });
}

console.log(JSON.stringify({ stage: 'build_evidence_bundle', bundles: out.length,
  to_model: stats.model, settled_in_code: stats.deterministic,
  no_quote_resolved: stats.no_quote, message_read_failed: stats.read_failed,
  cases_where_both_families_quoted: stats.both_families,
  note: 'Complaints and staff notes are deliberately NOT fetched here - 3-5 calls per candidate ' +
        'against a ~500-call budget. A case the messages cannot settle is inconclusive for an ' +
        'auditor, never a finding on absent evidence.' }));

return out;

