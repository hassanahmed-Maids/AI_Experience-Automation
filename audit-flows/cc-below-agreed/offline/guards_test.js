// The two guards added 2026-08-19, tested against the real node bodies.
//
// The guards run as their OWN node on the scorer's output, so every case here goes through
// the real scorer first and then the real Guards body - which is exactly the pairing that
// runs in n8n.
//
// GATE 35 exists because `currentPayment.amountValue` was measured misbehaving in BOTH
// directions on contracts whose recurring schedule had not started: returning the one-time
// figure (so the case self-cleared) on 1103085/86/97, and the full monthly rate (so the case
// looked ~58% short) on 1101305.
//
// THE CIRCULARITY TRIPWIRE exists because ERP computes currentPayment payment-first, and if
// that tier ever fires for these reads every case looks exactly reconciled - a failure no
// per-case gate can see, because each case individually looks perfect.
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'Compute_Case_States.js'), 'utf8');
const GUARDS = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'Guards.js'), 'utf8');
const PLAN = fs.readFileSync(path.join(__dirname, '..', 'wf-e', 'nodes', 'project_plan.js'), 'utf8');
const READ = fs.readFileSync(path.join(__dirname, '..', 'wf-e', 'nodes', 'read_chunk.js'), 'utf8');

const WINDOWS = [
  { key: '2026-07', from: '2026-07-01', to: '2026-07-31', node: 'Get Month Payments' },
  { key: '2026-06', from: '2026-06-01', to: '2026-06-30', node: 'Get Payments (M-1)' },
  { key: '2026-05', from: '2026-05-01', to: '2026-05-31', node: 'Get Payments (M-2)' },
];
function runScorer(cohort, opts) {
  const o = opts || {};
  const validated = { persistence_windows: WINDOWS, audit_month: '2026-07',
                      range_start: '2026-07-01', range_end: '2026-07-31' };
  const nodes = (n) => {
    if (n === 'Validate Inputs') return { first: () => ({ json: validated }) };
    if (n === 'Join Enrichment') {
      if (o.noJoinNode) throw new Error('Join Enrichment did not execute');
      return { all: () => cohort.map(j => ({ json: { case_key: j.case_key, plan: j.plan } })) };
    }
    throw new Error('unexpected $(' + n + ')');
  };
  const slog = [];
  const scored = new Function('$input', '$', 'console', SRC)(
    { all: () => cohort.map(j => ({ json: j })) }, nodes, { log: (...a) => slog.push(a.join(' ')) });
  const glog = [];
  const guarded = new Function('$input', '$', 'console', GUARDS)(
    { all: () => scored, first: () => scored[0] }, nodes, { log: (...a) => glog.push(a.join(' ')) });
  return { cases: guarded[0].json.cases, log: JSON.parse(glog[glog.length - 1]),
           scorer_log: JSON.parse(slog[slog.length - 1]) };
}
function month(o) {
  return Object.assign({ monthly_received: 0, other_received: 0, monthly_net: 0, received_gross: 0,
    refund_mp_reversing: 0, refund_other: 0, in_flight: 0, dead_rows: 0, rows: 0,
    unrecognised_refund: false, types_seen: {}, bulk_only_rows: 0 }, o);
}
function caseOf(o) {
  const plan = Object.assign({ expected_amount_known: true, expected_gross: 0,
    first_month_payment: null, daily_rate_amount: null, is_one_month_agreement: false,
    additional_discount: { text: '' }, credit_note_discount: { text: '' },
    monthly_schedule_starts: '', one_time_dates: [] }, o.plan || {});
  return Object.assign({}, o, { plan: plan,
    case_key: o.case_key || (o.contract_id + ':2026-07'),
    client_id: 'c', client_name: 'REDACTED', maid_id: 'm', maid_name: 'REDACTED',
    contract_status: 'ACTIVE', contract_start: o.contract_start || '2025-01-01',
    scheduled_termination: '', maid_live_out: false, sources: ['population'],
    needs_enrichment: true, received_anything: o.received_anything !== false,
    skip_computation: false, replacements: [], replacements_meta: {} });
}

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}
function throws(fn, label, wants) {
  try { fn(); fail++; console.log('FAIL ' + label + '\n       -> did not throw'); }
  catch (e) {
    if (!wants || e.message.indexOf(wants) !== -1) {
      pass++; console.log('ok   ' + label + '\n       -> ' + e.message.split('.')[0].slice(0, 120));
    } else { fail++; console.log('FAIL ' + label + '\n       -> wrong error: ' + e.message.slice(0, 140)); }
  }
}

// ============================================================ GATE 35
console.log('--- gate 35: was a monthly payment even due?');
{
  // 1101305's real shape: recurring schedule starts 2026-09-01, paid a one-time amount in
  // the audited month, and currentPayment returned the FULL monthly rate. Before gate 35
  // this scored as a large shortfall - a false candidate.
  const r = runScorer([caseOf({ contract_id: '1101305', contract_start: '2026-07-19',
    plan: { expected_gross: 5712, monthly_schedule_starts: '2026-09-01',
            one_time_dates: ['2026-07-19', '2026-08-01'] },
    months: { '2026-07': month({ monthly_received: 2515, monthly_net: 2515, received_gross: 2515 }) } })]);
  const c = r.cases[0];
  ok(c.reason_code === 'no_monthly_obligation_yet' && c.new_state === 'green_flag',
    'a recurring schedule starting after the audited month closes the case out of scope',
    c.reason_code + ' / ' + c.new_state);
  ok(c.requires_verifier === false && c.finding_reason === '',
    'it is not routed to the verifier and carries no finding reason');
  ok(/different expectation/.test(c.reason_text) && /one-time/.test(c.reason_text),
    'the reason text says the one-time amount is a different expectation, not a clearance');
  ok(c.computed.expected === null && c.computed.monthly_schedule_starts === '2026-09-01',
    'expected is null rather than a monthly rate that was never owed, and the date is carried');
  ok(c.computed.superseded_verdict && c.computed.superseded_verdict.reason_code,
    'the verdict the scorer had given is kept on the case, so the override is auditable',
    JSON.stringify(c.computed.superseded_verdict));
  ok(r.log.gate35_no_monthly_obligation_yet === 1 && Object.keys(r.log.scorer_tally_superseded_for).length === 1,
    'the gate-35 replacement is counted, and it records which scorer verdict it superseded',
    JSON.stringify(r.log.scorer_tally_superseded_for));
}
{
  // The self-clearing shape: currentPayment returned the one-time figure and the client paid
  // exactly that. Under the old code this was paid_in_full. It must not be.
  const r = runScorer([caseOf({ contract_id: '1103097', contract_start: '2026-08-19',
    plan: { expected_gross: 2515, monthly_schedule_starts: '2026-09-01', one_time_dates: ['TODAY'] },
    months: { '2026-07': month({ monthly_received: 2515, monthly_net: 2515, received_gross: 2515 }) } })]);
  ok(r.cases[0].reason_code === 'no_monthly_obligation_yet',
    'the self-clearing first-month shape is caught instead of scoring exactly-paid',
    r.cases[0].reason_code);
}
{
  // An established contract: schedule started long ago. Gate 35 must NOT fire, or the audit
  // would close its whole population out of scope.
  const r = runScorer([caseOf({ contract_id: '1014657', contract_start: '2022-07-12',
    plan: { expected_gross: 4715, monthly_schedule_starts: '2022-08-01' },
    months: { '2026-07': month({ monthly_received: 2100, monthly_net: 2100, received_gross: 2100 }) } })]);
  ok(r.cases[0].reason_code !== 'no_monthly_obligation_yet' && r.log.gate35_no_monthly_obligation_yet === 0,
    'a schedule that started in 2022 does not trigger it', r.cases[0].reason_code);
}
{
  // Schedule starts INSIDE the audited month: due that month, so gate 35 stays out and the
  // pro-rating gate keeps its case.
  const r = runScorer([caseOf({ contract_id: '1098460', contract_start: '2026-07-06',
    plan: { expected_gross: 4715, monthly_schedule_starts: '2026-07-15', first_month_payment: 2400 },
    months: { '2026-07': month({ monthly_received: 2400, monthly_net: 2400, received_gross: 2400 }) } })]);
  ok(r.cases[0].reason_code !== 'no_monthly_obligation_yet',
    'a schedule starting inside the audited month is still in scope (gate 50 owns it)',
    r.cases[0].reason_code);
  ok(r.scorer_log.gate_fires.g50 >= 0, 'pro-rating still sees the case');
}
{
  // No date parsed - gate 35 must abstain rather than guess.
  const r = runScorer([caseOf({ contract_id: '9999999',
    plan: { expected_gross: 4715, monthly_schedule_starts: '' },
    months: { '2026-07': month({ monthly_received: 2100, monthly_net: 2100, received_gross: 2100 }) } })]);
  ok(r.cases[0].reason_code !== 'no_monthly_obligation_yet',
    'an unparsed plan date abstains instead of closing the case', r.cases[0].reason_code);
}
{
  // Gate 10 still wins: nothing received is the sibling's finding, whatever the plan says.
  const r = runScorer([caseOf({ contract_id: '8888888', received_anything: false,
    plan: { expected_gross: 4715, monthly_schedule_starts: '2026-09-01' },
    months: { '2026-07': month({}) } })]);
  ok(r.cases[0].reason_code === 'out_of_scope_nothing_received',
    'gate 10 still precedes gate 35', r.cases[0].reason_code);
}

// ============================================ THE CIRCULARITY TRIPWIRE
console.log('\n--- the circularity tripwire');
function population(n, opts) {
  const o = opts || {};
  const out = [];
  for (let i = 0; i < n; i++) {
    const rate = 4715;
    // by default make a realistic mix: ~82% exact, ~18% short, matching the July funnel
    const isShort = o.allExact ? false : (i % 6 === 0);
    const paid = isShort ? rate - 600 : rate;
    out.push(caseOf({ contract_id: 'c' + i,
      plan: { expected_gross: rate, monthly_schedule_starts: '2024-01-01' },
      months: { '2026-07': month({ monthly_received: paid, monthly_net: paid, received_gross: paid }) } }));
  }
  return out;
}
{
  const r = runScorer(population(600));
  ok(r.log.shortfall_cases > 0 && r.log.exact_share_pct < 97,
    'a realistic month passes, and the log states the share it measured',
    JSON.stringify({ exact: r.log.exact_share_pct, short: r.log.shortfall_cases }));
  ok(/armed and passed/.test(r.log.circularity_tripwire), 'the log says the tripwire was armed');
}
throws(() => runScorer(population(600, { allExact: true })),
  'a book where every case matches exactly is refused', 'CIRCULARITY TRIPWIRE');
{
  // Under the population floor the tripwire must not fire - a small test run of 100
  // exactly-paid contracts is plausible, and halting on it would block legitimate testing.
  const r = runScorer(population(100, { allExact: true }));
  ok(r.cases.length === 100 && /not armed/.test(r.log.circularity_tripwire),
    'under 500 scored cases it stays disarmed rather than blocking a small test run',
    r.log.circularity_tripwire);
}
{
  // The sharper test on its own: shortfalls present but exact share just under the ceiling.
  const cases = population(600);
  const r = runScorer(cases);
  ok(r.log.exact_share_ceiling_pct === 97,
    'the ceiling is 97%, sixteen points above the measured 81.5% norm');
}

// ================================ the plan-line date parser in WF-E
console.log('\n--- WF-E: parsing the plan-line dates gate 35 depends on');
{
  function planResp(info) {
    return { currentPayment: { amountValue: 4715 },
             paymentPlan: { additionalDiscount: '', creditNoteDiscount: '', paymentsInfo: info } };
  }
  function runPlan(info) {
    const chunk = new Function('$input', '$', 'console', READ)(
      { all: () => [], first: () => ({ json: { bearer: 'Bearer t', chunk_index: 0,
        cases: [{ case_key: 'k', contract_id: '1', client_id: '2' }] } }) }, () => {}, { log: () => {} });
    const out = new Function('$input', '$', 'console', PLAN)(
      { all: () => [{ json: planResp(info) }] },
      (n) => ({ all: () => chunk, first: () => chunk[0] }), { log: () => {} });
    return out[0].json.plan;
  }
  let p = runPlan(['Service Fees: 4,240 + 212 VAT, on Sep 1 2026 (Monthly)']);
  ok(p.monthly_schedule_starts === '2026-09-01', 'a Monthly line date parses to yyyy-mm-dd',
    p.monthly_schedule_starts);
  p = runPlan(['Service Fee: 2,394 + 120 VAT, on Today (One Time Payment)',
               'Service Fee: 4,240 + 212 VAT, on Sep 19 2026 (Monthly)']);
  ok(p.monthly_schedule_starts === '2026-09-19' && p.one_time_dates.join() === 'TODAY',
    'a literal "Today" one-time line is carried as TODAY rather than silently dropped',
    JSON.stringify([p.monthly_schedule_starts, p.one_time_dates]));
  p = runPlan(['Service Fees: 1 + 0 VAT, on Jul 19 2026 (One Time Payment)',
               'Service Fees: 1 + 0 VAT, on Aug 1 2026 (One Time Payment)',
               'Service Fees: 4,240 + 212 VAT, on Sep 1 2026 (Monthly)']);
  ok(p.one_time_dates.join() === '2026-07-19,2026-08-01',
    'every one-time date is carried, in order', p.one_time_dates.join());
  p = runPlan(['Service Fees: 4,240 + 212 VAT, on Smarch 1 2026 (Monthly)']);
  ok(p.monthly_schedule_starts === '' && p.monthly_schedule_starts_raw === 'Smarch 1 2026',
    'an unparseable month yields no date but keeps the raw text for a human',
    JSON.stringify([p.monthly_schedule_starts, p.monthly_schedule_starts_raw]));
  p = runPlan(['Service Fees: 4,240 + 212 VAT (Monthly)']);
  ok(p.monthly_schedule_starts === '', 'a line with no ", on " yields no date');
  p = runPlan([]);
  ok(p.monthly_schedule_starts === '' && p.one_time_dates.length === 0,
    'an empty payment plan yields no dates and no throw');
  ok(runPlan(['Service Fees: 1 + 0 VAT, on Sep 1 2026 (Monthly)']).plan_line_amounts_are_ex_vat === true,
    'the ex-VAT nature of the prose amounts is stated on the delta, measured at 1.05');
}

console.log('\n' + pass + '/' + (pass + fail) + ' assertions passed');
process.exit(fail ? 1 : 0);

// ------------------------------------------ the guards' own failure modes
console.log('\n--- the Guards node itself');
{
  // Enrichment does not run when gate 1 closed everyone out, so the plan source is missing.
  // Gate 35 must abstain and SAY the source was unavailable, not pass silently.
  const r = runScorer([caseOf({ contract_id: '7777777', received_anything: false,
    plan: { expected_gross: 4715, monthly_schedule_starts: '2026-09-01' },
    months: { '2026-07': month({}) } })], { noJoinNode: true });
  ok(/unavailable/.test(r.log.plan_source) && r.log.gate35_no_monthly_obligation_yet === 0,
    'a missing Join Enrichment is reported, not treated as a gate that passed', r.log.plan_source);
}
{
  const GUARDS = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'Guards.js'), 'utf8');
  throws(() => new Function('$input', '$', 'console', GUARDS)(
    { first: () => ({ json: { rows: [] } }), all: () => [] },
    (n) => ({ first: () => ({ json: { persistence_windows: WINDOWS, range_end: '2026-07-31' } }),
              all: () => [] }), { log: () => {} }),
    'an unrecognised payload is refused rather than passed on as zero cases', 'no `cases` array');
}
