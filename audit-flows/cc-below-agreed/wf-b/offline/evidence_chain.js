// WF-B EVIDENCE CHAIN suite - Resolve Quoted Amounts -> Build Evidence Bundle
//                             -> Merge Agent Verdicts -> Build Verdict Rows
//
// WHY THIS IS THE MOST IMPORTANT UNTESTED CODE IN THE CHECK. This check "cannot produce a
// finding" from arithmetic: currentPayment.amountValue is the CONTRACTUAL rate and is not
// reliably what was billed. On contract 1054346 the stored rate read 4,715 while the client
// was billed and paid 2,100 - and BOTH numbers were sent to that client in writing, days
// apart, by two different template families. So the scorer yields a CANDIDATE, and the only
// thing that can turn a candidate into "Underpaid" (we asked the contract rate, less arrived)
// or "Under-billed" (we asked less than the contract says) is what we actually quoted.
//
// That decision lives entirely in these four nodes, and until now not one of them had a repo
// file, let alone a test. `baton_hops.js` covers the baton arithmetic across batches; it does
// not touch the evidence chain.
//
// THE EXPENSIVE FAILURE HERE IS FALSE CLEARANCE - a candidate cleared on evidence nobody read.
// Merge Agent Verdicts carries two caps that exist for exactly that, and both are asserted
// below with a model that misbehaves in the specific way each cap anticipates:
//   cap 1  a model answering "Agent Justified" on a case whose evidence class is NOT JUSTIFIED
//          is a model ignoring its instructions. Only JUSTIFIED may clear a candidate.
//   cap 2  a model answering with a Finding when no quoted amount resolved is a guess dressed
//          as arithmetic. Without the quote, Under-billed and Underpaid are indistinguishable.
//
// FIXTURES ARE REAL-SHAPED, NOT CONVENIENT. The message rows carry the field names ERP
// actually returns (templateName / templateContent / sentDate) and the parameter-value format
// it actually sends ("{1}: 2,100, {2}: the monthly visa fee and salary"). sentDate is the only
// usable date on that endpoint - creationDate and dateOfMessage are null on every row - so the
// fixtures leave those null on purpose, and a node that started reading them would fail here.
//
// WIRING, read off the deployed WF-B `2LaIbHqQ1A2sEBKm` on 2026-08-19:
//   Select Candidates -> Get Messages (WhatsApp) + Get Messages (SMS) -> Join Messages
//     -> Resolve Quoted Amounts -> Build Evidence Bundle -> Needs the model?
//   Needs the model? [true: preset_verdict is EMPTY] -> Verify Candidates -> Join Verdict Paths
//   Needs the model? [false]                         -> Join Verdict Paths
//   Join Verdict Paths -> Merge Agent Verdicts -> Build Verdict Rows -> Verdicts -> Google Sheet
// So ONLY bundles with no preset reach the model, which is what `modelRouted` counts and what
// the separate cursor in Merge Agent Verdicts pairs against.
// PROVEN TO BITE. Each mutation was applied to the REAL node body, the suite re-run, the body
// restored (2026-08-19). All eight were caught:
//
//   mutation                                                          caught by
//   resolver reads a FIXED position, not the per-family amount_index  3 assertions
//   an UNKNOWN template silently produces a quote                     6
//   a case with NO quote is sent to the model instead of an auditor   5
//   CAP 2 removed (a Finding accepted with no resolved quote)         4
//   CAP 1 reverted to the truthiness form (the false-clearance hole)  3
//   preset cases also advance the model cursor (the pairing bug)      1, and the exact one:
//                                                                     "the second model verdict
//                                                                      lands on the second ROUTED
//                                                                      case, not shifted by one"
//   the positional pairing guard removed                              2
//   a failed message read treated as an empty log                     2
//
// Two earlier attempts were discarded rather than counted: one broke the node's syntax, and one
// used an anchor that did not exist. A mutation that does not compile proves nothing about the
// suite, and recording it as "caught" would overstate what these tests cover.

const fs = require('fs'), path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const RESOLVE = R('nodes/resolve_quoted_amounts.js');
const BUNDLE  = R('nodes/build_evidence_bundle.js');
const MERGE   = R('nodes/merge_agent_verdicts.js');
const ROWS    = R('nodes/build_verdict_rows.js');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}
function throws(fn, label, match) {
  try { fn(); fail++; console.log('FAIL ' + label + '\n       -> did not throw'); }
  catch (e) {
    if (match && !new RegExp(match, 'i').test(e.message)) {
      fail++; console.log('FAIL ' + label + '\n       -> threw the wrong thing: ' + e.message.slice(0, 140));
    } else { pass++; console.log('ok   ' + label); }
  }
}
function exec(src, inputItems, nodes) {
  const $ = (n) => {
    if (!(n in nodes)) throw new Error('unexpected $(' + n + ')');
    const a = nodes[n];
    return { all: () => a, first: () => a[0] };
  };
  const logs = [];
  const out = new Function('$input', '$', 'console', src)(
    { all: () => inputItems, first: () => inputItems[0] }, $, { log: m => logs.push(m) });
  return { out: out || [], logs: logs.map(x => { try { return JSON.parse(x); } catch (e) { return {}; } }) };
}
const lastLog = (r) => r.logs[r.logs.length - 1] || {};

// ------------------------------------------------------------------------- fixtures
const VALIDATED = {
  check_id: 'cc-below-agreed', run_id: 'r-wfb-test',
  callback_url: 'https://nnbyjbdbigcpoqtsczlz.supabase.co/functions/v1/ta-callback/' + 'a'.repeat(64),
  audit_month: '2026-07'
};
// A message row exactly as ERP's smsLog returns it. creationDate / dateOfMessage are null on
// EVERY real row - the node must read sentDate and nothing else.
function msg(templateName, templateContent, sentDate) {
  return { templateName, templateContent, sentDate,
           creationDate: null, dateOfMessage: null, smsContent: '' };
}
function candidate(o) {
  return Object.assign({
    case_key: (o.contract_id || '1') + ':2026-07', contract_id: '1', client_id: 'c1',
    client_name: 'REDACTED', maid_name: 'REDACTED', audit_month: '2026-07',
    state: 'red_flag', reason_code: 'short_vs_agreed', reason_text: '',
    requires_verifier: true, requires_auditor_review: false, is_candidate: true,
    escalation_blocked: false, escalation_blocked_reason: '', relief_visible: false,
    expected: 4715, expected_gross: 4715, expected_known: true, expected_note: '',
    actual: 2100, shortfall: 2615, tolerance: 5, in_flight: 0,
    persistence: { verdict: 'persistent', months_short: 3, months_seen: 3, variance: 0 },
    coverage: null, months: {}, discount_text: [], gate4_departure: null,
    rate_is_contractual_not_billed: true
  }, o);
}
function runResolve(cases, wa, sms) {
  return exec(RESOLVE, [], {
    'Select Candidates': cases.map(c => ({ json: c })),
    'Get Messages (WhatsApp)': wa.map(b => ({ json: b })),
    'Get Messages (SMS)': sms.map(b => ({ json: b }))
  });
}

// ============================================================ RESOLVE QUOTED AMOUNTS
console.log('--- Resolve Quoted Amounts: the Underpaid / Under-billed discriminator ---');

// THE CASE THE WHOLE CHECK EXISTS FOR. Contract 1054346: the monthly_reminder family quoted
// the CONTRACT rate (4,715) and the online_reminder family quoted what accounting actually
// ASKED FOR (2,100), days apart, to the same client. Both must survive as separate figures -
// collapsing them to one is what makes Under-billed and Underpaid indistinguishable.
// Note the differing amount positions: monthly_reminder is {3}, online_reminder is {1}. That
// is a per-family constant measured off the live template bodies, not a global index.
const R1 = runResolve(
  [candidate({ contract_id: '1054346' })],
  [[ msg('acc_cc_client_paying_via_cc_monthly_reminder_1_1',
         '{1}: Fatima, {2}: 2026-07-31, {3}: 4,715, {4}: yes', '2026-07-05 09:00:00') ]],
  [[ msg('acc_cc_client_online_reminder_required_one_payment_1_3',
         '{1}: 2,100, {2}: the monthly visa fee and salary', '2026-07-12 09:00:00') ]]
);
const q1 = R1.out[0].json.quoted;
ok(q1.contract_rate_quoted === 4715,
   'the contract-rate family resolves 4,715 from position {3}', 'got ' + q1.contract_rate_quoted);
ok(q1.requested_quoted === 2100,
   'the accounting-requested family resolves 2,100 from position {1}', 'got ' + q1.requested_quoted);
ok(q1.families_seen.length === 2,
   'both families are recorded separately - this is what separates Under-billed from Underpaid',
   JSON.stringify(q1.families_seen));
ok(q1.no_quote_found === false && q1.read_failed === false, 'the case counts as resolved');
ok(q1.quotes[0].sent_date === '2026-07-12',
   'quotes sort most-recent-first off sentDate', q1.quotes[0].sent_date);
ok(q1.quotes.every(x => x.sent_date && x.sent_date.length === 10),
   'sentDate is the date source - creationDate and dateOfMessage are null on every real row');

console.log('\n--- amount parsing ---');
const R2 = runResolve([candidate({}), candidate({ contract_id: '2' })],
  [[ msg('acc_cc_client_online_reminder_required_one_payment_1_3', '{1}: AED 3,360.50, {2}: fees', '2026-07-02 09:00:00') ],
   [ msg('acc_cc_client_online_reminder_required_one_payment_1_3', '{1}: not-a-number, {2}: fees', '2026-07-02 09:00:00') ]],
  [[], []]);
ok(R2.out[0].json.quoted.requested_quoted === 3360.5,
   'comma grouping and an AED prefix normalise to a number', String(R2.out[0].json.quoted.requested_quoted));
ok(R2.out[1].json.quoted.no_quote_found === true,
   'an unparseable amount yields NO quote rather than a coerced number');
ok(Object.keys(lastLog(R2).unknown_or_unparsed_templates).some(k => k.indexOf('UNPARSED:') === 0),
   'the unparseable row is counted as UNPARSED, not silently dropped');

console.log('\n--- the label beside the amount (contract 1097602) ---');
// On 1097602 "{2}: the monthly visa fee and salary" sat beside a SECOND payment link for a
// different figure. Reading only the amount and not its label understates the month by 2,200.
ok(q1.quotes.find(x => x.family === 'quotes_requested_amount').label === 'the monthly visa fee and salary',
   'the label at amount_index+1 is carried with the quote');

console.log('\n--- templates the bake does not know, and templates with no amount ---');
const R3 = runResolve([candidate({}), candidate({ contract_id: '2' })],
  [[ msg('some_template_invented_after_the_bake', '{1}: 999', '2026-07-02 09:00:00') ],
   [ msg('notifiers_settle_payment_reminder', '{1}: link', '2026-07-02 09:00:00') ]],
  [[], []]);
ok(R3.out[0].json.quoted.no_quote_found === true,
   'an UNKNOWN template yields no quote - it can never clear or create a finding');
ok(lastLog(R3).unknown_or_unparsed_templates['some_template_invented_after_the_bake'] === 1,
   'the unknown template is counted by name so the bake can be refreshed');
ok(R3.out[1].json.quoted.no_quote_found === true,
   'a known template carrying NO amount (amount_index null) yields no quote');
ok(lastLog(R3).lookup_pulled_on === '2026-08-14' && lastLog(R3).templates_in_lookup === 33,
   'the bake stamps its pull date and size on every run - staleness is reported, not hidden');

console.log('\n--- failed message reads ---');
// The response BODY is the error object itself - not an array containing one. Getting this
// wrong on the first run made the fixture look like a healthy empty log, which is exactly the
// confusion the node's fetchFailed() exists to prevent.
const R4 = runResolve([candidate({})],
  [ { error: 'ERP 500' } ], [ [] ]);
ok(R4.out[0].json.quoted.read_failed === true,
   'an error body is read_failed, NOT an empty message log');

console.log('\n--- the positional pairing guard ---');
throws(() => runResolve([candidate({}), candidate({ contract_id: '2' })], [[]], [[], []]),
  'a WhatsApp/SMS count mismatch throws rather than mis-attributing a quote', 'positional pairing');

// ============================================================== BUILD EVIDENCE BUNDLE
console.log('\n--- Build Evidence Bundle: what is settled in code vs sent to the model ---');
function runBundle(resolved) { return exec(BUNDLE, [], { 'Resolve Quoted Amounts': resolved.out }); }
const B1 = runBundle(R1);
ok(B1.out[0].json.preset_verdict === '',
   'a resolvable case with both families has NO preset - it is the model\'s to judge');
ok(/4715/.test(B1.out[0].json.prompt) && /2100/.test(B1.out[0].json.prompt),
   'the prompt shows BOTH quoted amounts, which is the decision the model is there to make');
ok(/trust these figures, do not recompute/i.test(B1.out[0].json.prompt),
   'the prompt tells the model not to redo the arithmetic');
ok(B1.out[0].json.valid_verdicts.length === 4, 'the four permitted verdicts travel with the bundle');

const B_noquote = runBundle(R3);
ok(B_noquote.out[0].json.preset_verdict === 'Agent Candidate - Auditor Review Required' &&
   B_noquote.out[0].json.preset_evidence_class === 'NO TEXT',
   'no resolvable quote is settled in code as auditor review, never sent to the model');
const B_failed = runBundle(R4);
ok(B_failed.out[0].json.preset_evidence_class === 'UNRESOLVED',
   'a failed message read is settled in code as UNRESOLVED');
const R5 = runResolve([candidate({ expected_known: false })],
  [[ msg('acc_cc_client_online_reminder_required_one_payment_1_3', '{1}: 2,100, {2}: fees', '2026-07-02 09:00:00') ]], [[]]);
ok(runBundle(R5).out[0].json.preset_evidence_class === 'UNRESOLVED',
   'an unreadable contract rate is settled in code - there is no expectation to compare against');

// =============================================================== MERGE AGENT VERDICTS
console.log('\n--- Merge Agent Verdicts: the caps that prevent a false clearance ---');
function runMerge(bundles, agentOuts) {
  const nodes = { 'Validate Inputs': [{ json: VALIDATED }],
                  'Build Evidence Bundle': bundles.out,
                  'Resolve Quoted Amounts': [] };
  if (agentOuts !== null) nodes['Verify Candidates'] = agentOuts.map(j => ({ json: j }));
  return exec(MERGE, [], nodes);
}
// CAP 1, all four branches. Two findings came out of writing these, both recorded in
// VALIDATION section 25:
//
//  (a) 'JUSTIFIED' is NOT a member of the Verdict Schema's evidence_class enum. That enum is
//      UNDER_BILLED / UNDERPAID / EXPLAINED / AMBIGUOUS / NO QUOTE / UNRESOLVED, and its
//      clearing class is EXPLAINED. So every SCHEMA-VALID 'Agent Justified' is downgraded and
//      that verdict is unreachable through the model path. Fail-safe - it over-reviews and
//      never clears wrongly - but the model can never clear a candidate. Whether EXPLAINED
//      should clear is a business decision and is NOT made here.
//  (b) omitting evidence_class used to BYPASS the cap entirely, because the condition read
//      `evidenceClass && ...` and '' is falsy. That was the one path here that produced a
//      false clearance. Fixed 2026-08-19 to fail closed; the last assertion pins it.
function justifiedWith(ec) {
  const v = { verdict: 'Agent Justified', confidence: 'high', reasoning: 'looks fine' };
  if (ec !== undefined) v.evidence_class = ec;
  return runMerge(B1, [v]).out[0].json.cases[0].agent_review;
}
ok(justifiedWith('EXPLAINED').verdict === 'Agent Candidate - Auditor Review Required',
   'CAP 1: "Agent Justified" + EXPLAINED is capped - so the verdict is unreachable via the model (finding a)',
   justifiedWith('EXPLAINED').verdict);
ok(justifiedWith('AMBIGUOUS').verdict === 'Agent Candidate - Auditor Review Required',
   'CAP 1: "Agent Justified" + AMBIGUOUS is capped');
ok(justifiedWith('JUSTIFIED').verdict === 'Agent Justified',
   'CAP 1: only the literal JUSTIFIED clears - which the schema cannot currently produce');
ok(justifiedWith(undefined).verdict === 'Agent Candidate - Auditor Review Required',
   'CAP 1 FAILS CLOSED: an ABSENT evidence_class no longer clears the candidate (finding b, fixed)',
   justifiedWith(undefined).verdict);
ok(/none supplied/.test(justifiedWith(undefined).why_no_model || ''),
   'the capped case says the class was missing, rather than reporting an empty one');
const c1 = justifiedWith('EXPLAINED');

// Cap 2 needs a case the model was allowed to judge but with NO resolved quote. Bundles with
// no quote get a preset, so build one that reaches the model and then strip its quote - the
// shape a re-run of the verifier alone produces.
const B_stripped = { out: [{ json: Object.assign({}, B1.out[0].json, {
  preset_verdict: '', quoted: { no_quote_found: true, read_failed: false } }) }] };
const M_cap2 = runMerge(B_stripped, [{ verdict: 'Agent Finding - Underpaid', confidence: 'high', reasoning: 'short' }]);
const c2 = M_cap2.out[0].json.cases[0].agent_review;
ok(c2.verdict === 'Agent Candidate - Auditor Review Required',
   'CAP 2: a Finding with no resolved quoted amount is capped - the two findings are indistinguishable without it',
   'got ' + c2.verdict);
ok(M_cap2.out[0].json.findings_capped_for_no_quote === 1 &&
   M_cap2.out[0].json.capped_case_keys.length === 1,
   'the cap is COUNTED and the case key recorded, not silently applied');
ok(/only the quoted amount can/i.test(c2.why_no_model || ''),
   'the case carries WHY it was capped, for the auditor who reads it');

const M_ok = runMerge(B1, [{ verdict: 'Agent Finding - Under-billed', confidence: 'high',
                             reasoning: 'we asked 2,100 against a 4,715 contract rate' }]);
const c3 = M_ok.out[0].json.cases[0].agent_review;
ok(c3.verdict === 'Agent Finding - Under-billed' && c3.finding_reason === 'Under-billed',
   'a Finding WITH a resolved quote is accepted and maps to its finding_reason', c3.verdict);

console.log('\n--- an unusable model answer fails CLOSED ---');
for (const [label, bad] of [['no item at all', []],
                            ['an errored item', [{ error: 'quota exceeded' }]],
                            ['an invalid verdict', [{ verdict: 'Looks fine to me' }]]]) {
  const M = runMerge(B1, bad);
  const c = M.out[0].json.cases[0].agent_review;
  ok(c.verdict === 'Agent Candidate - Auditor Review Required' && M.out[0].json.unreviewed === 1,
     'unreviewed (' + label + ') falls back to auditor review and is counted', 'got ' + c.verdict);
}
const M_down = runMerge(B1, []);
ok(M_down.out[0].json.verifier_down === true,
   'a run where the model answered nothing it was asked reports verifier_down');
ok(M_down.out[0].json.pairing_ok === false,
   'pairing_ok compares model outputs against bundles ROUTED, so a degraded run is visible');

console.log('\n--- the separate cursor: a deterministic case must not eat a model output ---');
// THE BUG THIS GUARDS. Merge walks ALL bundles but only advances the model cursor on the ones
// that were routed. If it advanced on every bundle, a preset case sitting between two model
// cases would consume the next model verdict and every later verdict would attach to the wrong
// contract - silently, with pairing_ok still true.
const mixed = { out: [
  { json: Object.assign({}, B1.out[0].json, { case_key: 'A:2026-07', preset_verdict: '' }) },
  { json: Object.assign({}, B_noquote.out[0].json, { case_key: 'B:2026-07' }) },   // preset - not routed
  { json: Object.assign({}, B1.out[0].json, { case_key: 'C:2026-07', preset_verdict: '' }) }
] };
const M_mixed = runMerge(mixed, [
  { verdict: 'Agent Finding - Under-billed', confidence: 'high', reasoning: 'for A' },
  { verdict: 'Agent Justified', confidence: 'high', reasoning: 'for C', evidence_class: 'JUSTIFIED' }
]);
const byKey = {};
for (const c of M_mixed.out[0].json.cases) byKey[c.case_key] = c;
ok(byKey['A:2026-07'].agent_review.verdict === 'Agent Finding - Under-billed',
   'the first model verdict lands on the first ROUTED case', byKey['A:2026-07'].agent_review.verdict);
ok(byKey['B:2026-07'].agent_review.decided_by === 'code' || byKey['B:2026-07'].agent_review.verdict === 'Agent Candidate - Auditor Review Required',
   'the preset case in the middle is decided in code and consumes no model output');
ok(byKey['C:2026-07'].agent_review.verdict === 'Agent Justified',
   'the second model verdict lands on the second ROUTED case, not shifted by one',
   byKey['C:2026-07'].agent_review.verdict);
ok(M_mixed.out[0].json.pairing_ok === true && M_mixed.out[0].json.model_routed === 2,
   'pairing is reported ok with exactly the two routed cases');

console.log('\n--- the agent-review endpoint is derived, never guessed ---');
ok(/\/ta-agent-review\//.test(M_ok.out[0].json.callback_url),
   'the review endpoint is derived from the validated callback_url');
throws(() => exec(MERGE, [], {
    'Validate Inputs': [{ json: Object.assign({}, VALIDATED, { callback_url: 'https://evil.example/hook' }) }],
    'Build Evidence Bundle': B1.out, 'Resolve Quoted Amounts': [] }),
  'a callback_url with no /ta-callback/ throws rather than posting verdicts to a guessed URL',
  'refusing to post');

// ================================================================= BUILD VERDICT ROWS
console.log('\n--- Build Verdict Rows ---');
const rows = exec(ROWS, M_ok.out, { 'Validate Inputs': [{ json: VALIDATED }] });
ok(rows.out.length === M_ok.out[0].json.cases.length,
   'one row per verified case (per-item, for the Sheets append)',
   rows.out.length + ' rows for ' + M_ok.out[0].json.cases.length + ' cases');
ok(rows.out.every(r => typeof r.json === 'object'), 'every row is a flat json item');

console.log('\n--- every $(name) these bodies read must exist in WF-B ---');
const WFB_NODES = new Set(['Validate Inputs','Select Candidates','Get Messages (WhatsApp)',
  'Get Messages (SMS)','Join Messages','Resolve Quoted Amounts','Build Evidence Bundle',
  'Needs the model?','Verify Candidates','Join Verdict Paths','Merge Agent Verdicts',
  'Build Verdict Rows','Verdicts -> Google Sheet','Prepare Handoff','More batches?',
  'Next Batch (self)','Finish (WF-C)','When Called','Test Baton']);
let dangling = [];
for (const [name, src] of [['Resolve Quoted Amounts', RESOLVE], ['Build Evidence Bundle', BUNDLE],
                           ['Merge Agent Verdicts', MERGE], ['Build Verdict Rows', ROWS]]) {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  for (const m of stripped.matchAll(/\$\('([^']+)'\)/g)) {
    if (!WFB_NODES.has(m[1])) dangling.push(name + " -> $('" + m[1] + "')");
  }
}
ok(dangling.length === 0, 'no evidence-chain body reads a node that is not in WF-B', dangling.join('; '));

// ============================================ THE CIRCUIT BREAKER, AS EMBEDDED IN WF-B
// ERP-LOAD-POLICY.md §5. The canonical logic is proved in tools/offline/breaker_test.js; what
// is proved here is that the COPY in Resolve Quoted Amounts runs, reads Select Candidates'
// stamp, and judges the two message reads TOGETHER - a WhatsApp side that is fine and an SMS
// side that is failing is a failing ERP, and judging them apart would halve the consecutive
// count on each side and let a full outage sit under the threshold twice.
console.log('\n--- circuit breaker, in place (WF-B) ---');
{
  const E503 = { error: { message: '503 Service Unavailable' } };
  const cases = [], wa = [], sms = [];
  for (let i = 0; i < 12; i++) {
    cases.push(candidate({ contract_id: 'c' + i, case_key: 'k' + i }));
    wa.push(i >= 8 ? E503 : []);     // 4 failures on the WhatsApp side
    sms.push(i >= 8 ? E503 : []);    // 4 on the SMS side - neither alone reaches five
  }
  throws(() => runResolve(cases, wa, sms),
    'four WhatsApp plus four SMS failures trip the breaker: eight failing calls is eight, not two lots of four',
    'ERP CIRCUIT BREAKER TRIPPED');
}
{
  const cases = [], wa = [], sms = [];
  for (let i = 0; i < 12; i++) { cases.push(candidate({ contract_id: 'c' + i, case_key: 'k' + i })); wa.push([]); sms.push([]); }
  const r = runResolve(cases, wa, sms);
  ok(r.out.length === 12, 'a healthy batch passes the breaker untouched');
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' + (pass + fail) : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
