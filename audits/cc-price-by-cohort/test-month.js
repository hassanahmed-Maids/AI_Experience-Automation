// ---------------------------------------------------------------------------
// Assertion harness for the MONTH-SCOPED scorer.
//
// Runs in a second with no ERP access, which is the whole point: the run-date
// scorer's gate order survived 2026-08-18 intact while everything touching live
// payloads needed three attempts. This is where the month logic gets proven
// BEFORE it is wired into n8n.
// ---------------------------------------------------------------------------

// SCORER lets the identical suite run against the GENERATED n8n node body as
// well as the sources, which is what makes the shipped code provably the code
// these assertions cover. See test-node-parity.js.
const TARGET = process.env.SCORER || 'sources';
const M = TARGET === 'sources'
  ? Object.assign({}, require('./scorer-month'), require('./paymentsinfo'))
  : require(TARGET);
const { scoreMonth, monthBounds, lastCompletedMonth, liveOutAt, parseEntry, resolveMonthlyRate } = M;
const card = require('./card.json');

let pass = 0, fail = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++;
  failures.push('  ' + label + '\n     expected ' + e + '\n     actual   ' + a);
}

function view(r, keys) {
  const o = {};
  keys.forEach(function (k) { o[k] = r[k]; });
  return o;
}

// --- the two real contracts read out of ERP on 2026-08-18 -------------------

const STEPPED = [
  'Service Fees: 2027 + 102 VAT, on Today (One Time Payment)',
  'Service Fees: 3990 + 200 VAT, on Sep 01 2026 (Monthly (for 2 months))',
  'Service Fees: 4490 + 225 VAT, on Nov 01 2026 (Monthly)',
];
const ESTABLISHED = ['Service Fees: 4096 + 205 VAT, on Jun 10 2020 (Monthly)'];

const c1103073 = {
  contract_id: 1103073, maid_nationality: 'Filipina', live_out: false,
  contract_start_date: '2026-08-18', payments_info: STEPPED,
  additional_discount: '', credit_note_discount: '',
  payment_term_nationality: 'Filipina', live_in_out_logs: [],
};
const c1005750 = {
  contract_id: 1005750, maid_nationality: 'Filipina', live_out: false,
  contract_start_date: '2020-06-10', payments_info: ESTABLISHED,
  additional_discount: '', credit_note_discount: '',
  payment_term_nationality: 'Filipina', live_in_out_logs: [],
};

// === paymentsInfo parsing ===================================================

check('parse: one-time entry amount is fee+VAT',
  (function () { const e = parseEntry(STEPPED[0], Date.UTC(2026, 7, 18)); return [e.kind, e.amount, e.duration_months]; })(),
  ['one_time', 2129, null]);

check('parse: "Today" resolves to the contract start date',
  parseEntry(STEPPED[0], Date.UTC(2026, 7, 18)).effective_ms, Date.UTC(2026, 7, 18));

check('parse: bounded monthly carries its duration',
  (function () { const e = parseEntry(STEPPED[1], 0); return [e.kind, e.amount, e.duration_months]; })(),
  ['monthly', 4190, 2]);

check('parse: open-ended monthly has no duration',
  (function () { const e = parseEntry(STEPPED[2], 0); return [e.kind, e.amount, e.duration_months]; })(),
  ['monthly', 4715, null]);

check('parse: a line that does not match the shape is a FAILURE, not a skip',
  (function () { const e = parseEntry('Service Fees: some amount, whenever', 0); return [e.parse_failed, typeof e.why]; })(),
  [true, 'string']);

check('parse: decimals and thousands separators survive',
  parseEntry('Service Fees: 4,096.50 + 204.83 VAT, on Jun 10 2020 (Monthly)', 0).amount, 4301.33);

// coverage windows on the stepped plan
function applicable(ym) {
  const b = monthBounds(ym);
  return resolveMonthlyRate(STEPPED, b.first, Date.UTC(2026, 7, 18)).applicable.map(function (e) { return e.amount; });
}
check('coverage: Aug 2026 - before the first monthly entry', applicable('2026-08'), []);
check('coverage: Sep 2026 - intro rate', applicable('2026-09'), [4190]);
check('coverage: Oct 2026 - intro rate, second of two months', applicable('2026-10'), [4190]);
check('coverage: Nov 2026 - intro expired, steady state', applicable('2026-11'), [4715]);
check('coverage: Mar 2027 - still steady state', applicable('2027-03'), [4715]);
check('coverage: a one-time entry is NEVER a rate',
  resolveMonthlyRate([STEPPED[0]], monthBounds('2026-09').first, Date.UTC(2026, 7, 18)).applicable.length, 0);

// an unbounded entry truncates at the next entry's month, not at its own end
check('coverage: unbounded entry stops when the next one starts',
  (function () {
    const p = ['Service Fees: 1000 + 50 VAT, on Jan 01 2026 (Monthly)',
               'Service Fees: 2000 + 100 VAT, on Apr 01 2026 (Monthly)'];
    return ['2026-01', '2026-03', '2026-04'].map(function (m) {
      return resolveMonthlyRate(p, monthBounds(m).first, 0).applicable.map(function (e) { return e.amount; });
    });
  })(),
  [[1050], [1050], [2100]]);

// === month bounds and the default ==========================================

check('bounds: February in a leap year ends on the 29th',
  new Date(monthBounds('2024-02').last).toISOString().slice(0, 10), '2024-02-29');
check('bounds: December rolls the year',
  new Date(monthBounds('2026-12').last).toISOString().slice(0, 10), '2026-12-31');
check('default: the current month is never audited - 18 Aug 2026 audits July',
  lastCompletedMonth(Date.UTC(2026, 7, 18)), '2026-07');
check('default: January rolls back to the previous December',
  lastCompletedMonth(Date.UTC(2026, 0, 3)), '2025-12');

// === scope ==================================================================

check('scope: a contract that started mid-month is OUT OF SCOPE for that month',
  view(scoreMonth(c1103073, card, { audit_month: '2026-08' }), ['scope', 'scope_reason', 'state']),
  { scope: 'out_of_scope', scope_reason: 'started_after_month_start', state: null });

check('scope: it enters the population the following month',
  scoreMonth(c1103073, card, { audit_month: '2026-09' }).scope, 'in_scope');

check('scope: starting exactly on the 1st is IN scope',
  scoreMonth(Object.assign({}, c1005750, { contract_start_date: '2026-07-01' }), card, { audit_month: '2026-07' }).scope,
  'in_scope');

check('scope: terminated mid-month is out of scope',
  view(scoreMonth(Object.assign({}, c1005750, { scheduled_date_of_termination: '2026-07-14' }), card, { audit_month: '2026-07' }),
       ['scope', 'scope_reason']),
  { scope: 'out_of_scope', scope_reason: 'terminated_before_month_end' });

check('scope: terminated ON the last day is still IN scope for the month',
  scoreMonth(Object.assign({}, c1005750, { scheduled_date_of_termination: '2026-07-31' }), card, { audit_month: '2026-07' }).scope,
  'in_scope');

check('scope: the EARLIER of the two termination dates wins',
  view(scoreMonth(Object.assign({}, c1005750, { date_of_termination: '2026-07-05', scheduled_date_of_termination: '2026-12-01' }), card, { audit_month: '2026-07' }),
       ['scope', 'scope_reason']),
  { scope: 'out_of_scope', scope_reason: 'terminated_before_month_end' });

check('scope: a one-time-only plan has no rate for the month',
  view(scoreMonth(Object.assign({}, c1005750, { payments_info: [STEPPED[0]] }), card, { audit_month: '2026-07' }),
       ['scope', 'scope_reason']),
  { scope: 'out_of_scope', scope_reason: 'no_rate_for_month' });

check('scope: an EMPTY plan is a pending, not a silent out-of-scope',
  view(scoreMonth(Object.assign({}, c1005750, { payments_info: [] }), card, { audit_month: '2026-07' }),
       ['scope', 'state', 'reason_code']),
  { scope: 'in_scope', state: 'pending', reason_code: 'no_payment_plan' });

// === the verdicts that matter ==============================================

// The nine false reds of 2026-08-18 came from reading currentPayment (2129, a
// one-time joining fee) against a monthly card price. Under month scoping the
// same contract is simply not audited for August.
check('REGRESSION: the 2026-08-18 false red no longer exists',
  scoreMonth(c1103073, card, { audit_month: '2026-08' }).state, null);

check('stepped plan, intro month: FLAGGED (policy call 2026-08-19)',
  view(scoreMonth(c1103073, card, { audit_month: '2026-09' }),
       ['state', 'verdict', 'reason_code', 'actual_rate', 'card_price', 'gap_aed', 'needs_human']),
  { state: 'red', verdict: 'Under-priced', reason_code: 'below_card_unexplained',
    actual_rate: 4190, card_price: 4714.5, gap_aed: 524.5, needs_human: true });

check('stepped plan, intro month: the human is told the rate is time-bounded',
  scoreMonth(c1103073, card, { audit_month: '2026-09' }).flags, ['bounded_rate_period']);

check('stepped plan, steady-state month: GREEN at card price',
  view(scoreMonth(c1103073, card, { audit_month: '2026-11' }),
       ['state', 'verdict', 'reason_code', 'actual_rate', 'card_price', 'gap_aed']),
  { state: 'green', verdict: 'Priced correctly', reason_code: 'matches_card_for_month',
    actual_rate: 4715, card_price: 4714.5, gap_aed: null });

check('established contract: grandfathered on an old published price',
  view(scoreMonth(c1005750, card, { audit_month: '2026-07' }),
       ['state', 'verdict', 'reason_code', 'actual_rate', 'cohort']),
  { state: 'green', verdict: 'Grandfathered', reason_code: 'matches_published_price',
    actual_rate: 4301, cohort: 'livein:Filipina' });

check('grandfathering cannot use a price published AFTER the audit month',
  // 4301 matches the 3/3/2024 window (4300.8). Audit a month before that window
  // opened and the same rate must NOT clear.
  scoreMonth(c1005750, card, { audit_month: '2023-06' }).state, 'red');

// === gates ==================================================================

check('gate: no nationality never defaults to the cheapest bucket',
  view(scoreMonth(Object.assign({}, c1005750, { maid_nationality: '' }), card, { audit_month: '2026-07' }),
       ['state', 'verdict', 'reason_code', 'needs_human']),
  { state: 'pending', verdict: 'Unpriceable', reason_code: 'no_nationality', needs_human: true });

check('gate: no living axis never defaults to live-in',
  view(scoreMonth(Object.assign({}, c1005750, { live_out: null }), card, { audit_month: '2026-07' }),
       ['state', 'reason_code']),
  { state: 'pending', reason_code: 'no_living_axis' });

check('gate: live-out Ethiopian prices as Other - 5 cohorts, not 6',
  scoreMonth(Object.assign({}, c1005750, { maid_nationality: 'Ethiopian', live_out: true }), card, { audit_month: '2026-07' }).cohort,
  'liveout:Other');

check('gate: unreadable line routes to a human, never falls back to currentPayment',
  view(scoreMonth(Object.assign({}, c1005750, { payments_info: ESTABLISHED.concat(['Service Fees: unreadable garbage']) }), card, { audit_month: '2026-07' }),
       ['state', 'reason_code', 'needs_human', 'actual_rate']),
  { state: 'pending', reason_code: 'rate_unreadable', needs_human: true, actual_rate: null });

check('gate: two monthly entries in the same month -> never pick one',
  view(scoreMonth(Object.assign({}, c1005750, {
        payments_info: ['Service Fees: 4096 + 205 VAT, on Jun 10 2020 (Monthly)',
                        'Service Fees: 3000 + 150 VAT, on Jun 10 2020 (Monthly)'] }), card, { audit_month: '2026-07' }),
       ['state', 'reason_code', 'needs_human']),
  { state: 'pending', reason_code: 'multiple_rates_in_month', needs_human: true });

// livein:Other has windows starting 1/6/2025 AND 2/13/2025 - February 2025 had
// two published prices for that cohort.
check('gate: a card boundary inside the month -> never average, never pick',
  view(scoreMonth(Object.assign({}, c1005750, { maid_nationality: 'Kenyan', contract_start_date: '2024-01-01',
        payments_info: ['Service Fees: 3000 + 150 VAT, on Jan 01 2024 (Monthly)'] }), card, { audit_month: '2025-02' }),
       ['state', 'reason_code', 'flags', 'needs_human']),
  { state: 'pending', reason_code: 'card_changed_mid_month', flags: ['card_changed_mid_month'], needs_human: true });

check('gate: the month AFTER a card change scores normally',
  scoreMonth(Object.assign({}, c1005750, { maid_nationality: 'Kenyan', contract_start_date: '2024-01-01',
    payments_info: ['Service Fees: 3000 + 150 VAT, on Jan 01 2024 (Monthly)'] }), card, { audit_month: '2025-03' }).reason_code,
  'below_card_unexplained');

// === living switch ==========================================================

const LOGS = [{ date: '2026-03-10', oldValue: 'IN', newValue: 'OUT' }];

check('switch: the axis in force during M is reconstructed from the log',
  [liveOutAt(true, LOGS, Date.UTC(2026, 0, 1)), liveOutAt(true, LOGS, Date.UTC(2026, 6, 1))],
  [false, true]);

// Switched to live-out in March, so July's cohort is liveout:Filipina - but the
// contract still pays 4301, a price livein:Filipina published in 2024. It clears
// on history WITHOUT a human, because a switch that completed before M leaves no
// ambiguity about which cohort applied during M. This is the case the run-date
// scorer had to route to a human and month scoping resolves.
check('switch: a switch BEFORE the audit month is unambiguous, not a pending',
  view(scoreMonth(Object.assign({}, c1005750, { live_out: true, live_in_out_logs: LOGS }), card, { audit_month: '2026-07' }),
       ['cohort', 'state', 'verdict', 'needs_human']),
  { cohort: 'liveout:Filipina', state: 'green', verdict: 'Grandfathered', needs_human: false });

// The identical contract with the switch INSIDE July sat in two cohorts that
// month. It still matches a published price - and that must NOT clear it.
// needs_human is one-way: a passing test never releases a gated contract.
check('switch: a switch INSIDE the audit month routes to a human',
  view(scoreMonth(Object.assign({}, c1005750, { live_out: true, live_in_out_logs: [{ date: '2026-07-10', oldValue: 'IN', newValue: 'OUT' }] }), card, { audit_month: '2026-07' }),
       ['state', 'verdict', 'reason_code', 'flags']),
  { state: 'pending', verdict: "Can't tell", reason_code: 'cleared_on_a_test_but_gate_requires_review', flags: ['living_switch_in_month'] });

// === reproducibility ========================================================

check('reproducible: the same month gives the same answer regardless of "now"',
  [Date.UTC(2026, 8, 1), Date.UTC(2027, 5, 1), Date.UTC(2030, 0, 1)].map(function (n) {
    return scoreMonth(c1005750, card, { audit_month: '2026-07', nowMs: n }).state;
  }),
  ['green', 'green', 'green']);

check('tolerance: 3.00 AED absolute absorbs VAT float noise',
  scoreMonth(Object.assign({}, c1005750, {
    payments_info: ['Service Fees: 4712 + 2.5 VAT, on Jun 10 2020 (Monthly)'] }), card, { audit_month: '2026-07' }).state,
  'green');

check('tolerance: 3.01 AED does not',
  scoreMonth(Object.assign({}, c1005750, {
    payments_info: ['Service Fees: 4711 + 0.49 VAT, on Jun 10 2020 (Monthly)'] }), card, { audit_month: '2026-07' }).state,
  'red');

// ---------------------------------------------------------------------------
console.log(failures.length ? failures.join('\n\n') + '\n' : '');
console.log(pass + ' passed, ' + fail + ' failed  [target: ' + TARGET + ']');
process.exit(fail ? 1 : 0);
