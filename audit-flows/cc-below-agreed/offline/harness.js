// Offline harness for "Compute Case States" (CC Monthly Payments Below Agreed Amount).
// Runs the node's real jsCode against fixtures built from the spec's seven verified
// test cases plus edge guards. No ERP token, no n8n.
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'nodes', 'Compute_Case_States.js'), 'utf8');

const WINDOWS = [
  { key: '2026-07', from: '2026-07-01', to: '2026-07-31', node: 'Get Month Payments' },
  { key: '2026-06', from: '2026-06-01', to: '2026-06-30', node: 'Get Payments (M-1)' },
  { key: '2026-05', from: '2026-05-01', to: '2026-05-31', node: 'Get Payments (M-2)' },
];
const AUG_WINDOWS = [
  { key: '2026-08', from: '2026-08-01', to: '2026-08-31', node: 'Get Month Payments' },
  { key: '2026-07', from: '2026-07-01', to: '2026-07-31', node: 'Get Payments (M-1)' },
  { key: '2026-06', from: '2026-06-01', to: '2026-06-30', node: 'Get Payments (M-2)' },
];

function run(cohort, windows) {
  const validated = {
    persistence_windows: windows,
    audit_month: windows[0].key,
    range_start: windows[0].from,
    range_end: windows[0].to,
  };
  const $input = { all: () => cohort.map(j => ({ json: j })) };
  const $ = (name) => {
    if (name === 'Validate Inputs') return { first: () => ({ json: validated }) };
    throw new Error('unexpected $(' + name + ')');
  };
  const logs = [];
  const console_ = { log: (...a) => logs.push(a.join(' ')) };
  const fn = new Function('$input', '$', 'console', SRC);
  const out = fn($input, $, console_);
  return { cases: out[0].json.cases, logs };
}

// ---- fixture builders -----------------------------------------------------
// month slot shape produced upstream by Attach Month Payments
function month(o) {
  return Object.assign({
    monthly_received: 0, other_received: 0, monthly_net: 0, received_gross: 0,
    refund_mp_reversing: 0, refund_other: 0, in_flight: 0, dead_rows: 0, rows: [],
    unrecognised_refund: false, types_seen: {}, bulk_only_rows: 0,
  }, o);
}
function mp(net, extra) { return month(Object.assign({ monthly_received: net, monthly_net: net }, extra || {})); }

function caseOf(o) {
  return Object.assign({
    case_key: o.contract_id + ':' + (o.audit || '2026-07'),
    contract_id: '', client_id: 'c', client_name: 'REDACTED', maid_id: 'm', maid_name: 'REDACTED',
    contract_status: 'ACTIVE', contract_start: '2025-01-01', scheduled_termination: '',
    maid_live_out: false, sources: ['population'], needs_enrichment: true,
    received_anything: true, skip_computation: false,
    replacements: [], replacements_meta: {},
    plan: { expected_amount_known: true, expected_gross: 0, first_month_payment: null,
            daily_rate_amount: null, is_one_month_agreement: false,
            additional_discount: { text: '' }, credit_note_discount: { text: '' } },
    months: {},
  }, o);
}

// ---- the seven spec cases -------------------------------------------------
const SPEC = [
  { id: 'T1 1054346 Jul', expect: { state: 'red_flag', code: 'shortfall_persistent_varying', verifier: true },
    why: 'rate 4,715; paid 3,129 May, 3,129 Jun, 2,100 Jul - short every month, magnitude moved',
    fixture: caseOf({ contract_id: '1054346',
      plan: { expected_amount_known: true, expected_gross: 4715, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': mp(2100), '2026-06': mp(3129), '2026-05': mp(3129) } }) },

  { id: 'T2 1090543 Jul', expect: { state: 'red_flag', code: 'shortfall_persistent', verifier: true },
    why: 'rate 5,712; paid 3,360 in May, Jun, Jul - stable shortfall across the window',
    fixture: caseOf({ contract_id: '1090543',
      plan: { expected_amount_known: true, expected_gross: 5712, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': mp(3360), '2026-06': mp(3360), '2026-05': mp(3360) } }) },

  { id: 'T3 1097602 Jul (split collection)', expect: { state: 'green_flag', code: 'paid_in_full', verifier: false },
    why: 'expected 4,452; July = 2,252 Monthly Payment + 2,200 Service charge, gap-completion closes it exactly',
    fixture: caseOf({ contract_id: '1097602',
      plan: { expected_amount_known: true, expected_gross: 4452, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: 'Discount Amount: 1000 applied on Service Fees over 4 months' },
              credit_note_discount: { text: '' } },
      months: { '2026-07': mp(2252, { other_received: 2200, types_seen: { 'Service charge': 2200 } }),
                '2026-06': mp(4452), '2026-05': mp(4452) } }) },

  { id: 'T4 1055190 Jul (double + refund)', expect: { state: 'green_flag', code: 'paid_in_full', verifier: false },
    why: 'agreed 5,299; July received 10,598 with a 5,299 MP-reversing refund - nets to exactly one month',
    fixture: caseOf({ contract_id: '1055190',
      plan: { expected_amount_known: true, expected_gross: 5299, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': month({ monthly_received: 10598, refund_mp_reversing: 5299, monthly_net: 5299 }),
                '2026-06': mp(5299), '2026-05': mp(5299) } }) },

  { id: 'T5 1101890 Jul (pro-rate 1 day)', expect: { state: 'green_flag', code: 'paid_in_full', verifier: false },
    why: 'started 2026-07-31, agreed 5,712, collected 184 = round(1 x 5712/31)',
    fixture: caseOf({ contract_id: '1101890', contract_start: '2026-07-31',
      plan: { expected_amount_known: true, expected_gross: 5712, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': mp(184) } }) },

  { id: 'T6 1088698 Jul (freeze)', expect: { state: 'red_flag', code: 'shortfall_unstable', verifier: true },
    why: 'froze 5 Jul - 7 Aug, collected 939 of 5,712. ERP stores no freeze date; gate 128 must route it to the verifier, never to a final red and never to green',
    fixture: caseOf({ contract_id: '1088698',
      plan: { expected_amount_known: true, expected_gross: 5712, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': mp(939), '2026-06': mp(5712), '2026-05': mp(5712) } }) },

  { id: 'T7 1093404 Aug (in flight)', expect: { state: 'pending_flag', code: 'payment_in_flight', verifier: false },
    why: 'ACTIVE since 2026-03-22, rate 3,129; August carries ONE PRE_PDP row of 305 and nothing received',
    windows: AUG_WINDOWS,
    fixture: caseOf({ contract_id: '1093404', audit: '2026-08', contract_start: '2026-03-22',
      received_anything: false,
      plan: { expected_amount_known: true, expected_gross: 3129, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: 'Discount Amount: 1000 applied on Service Fee over 4 months' },
              credit_note_discount: { text: '' } },
      months: { '2026-08': month({ in_flight: 305 }), '2026-07': mp(3129), '2026-06': mp(3129) } }) },
];

// ---- edge guards ---------------------------------------------------------
const EDGES = [
  { id: 'E1 double payment, NO refund', expect: { state: 'any', code: 'any', verifier: true },
    why: 'rule 10: receipts in one calendar month may settle more than one covered month. 2x the rate with no refund must not clear as a green overpayment - the month it also covers will read as zero receipts',
    fixture: caseOf({ contract_id: 'E1',
      plan: { expected_amount_known: true, expected_gross: 5000, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': mp(10000), '2026-06': mp(5000), '2026-05': mp(5000) } }) },

  { id: 'E2 expected amount unreadable', expect: { state: 'red_flag', code: 'unscored', verifier: true },
    why: 'gate 30: expected UNKNOWN, never zero and never the price card. Header comment claims inconclusive',
    fixture: caseOf({ contract_id: 'E2',
      plan: { expected_amount_known: false, expected_gross: null, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': mp(1000) } }) },

  { id: 'E3 other_received far EXCEEDS the gap', expect: { state: 'red_flag', code: 'shortfall_persistent', verifier: true },
    why: 'the 400-contract protection: monthly 1,000 vs expected 5,000, a 9,000 unrelated charge must close only the 4,000 gap and never rescue the case',
    fixture: caseOf({ contract_id: 'E3',
      plan: { expected_amount_known: true, expected_gross: 5000, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': mp(1000, { other_received: 9000 }), '2026-06': mp(1000, { other_received: 9000 }),
                '2026-05': mp(1000, { other_received: 9000 }) } }) },

  { id: 'E4 replacement fetch failed', expect: { state: 'any', code: 'any', verifier: true },
    why: 'a blocked evidence surface must cap confidence, never default to covered',
    fixture: caseOf({ contract_id: 'E4', replacements_meta: { fetch_failed: true },
      plan: { expected_amount_known: true, expected_gross: 5000, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': mp(5000), '2026-06': mp(5000), '2026-05': mp(5000) } }) },

  { id: 'E5 no maid placed all month', expect: { state: 'green_flag', code: 'no_maid_coverage', verifier: false },
    why: 'contract starts after the audited month, so no monthly amount was due',
    fixture: caseOf({ contract_id: 'E5', contract_start: '2026-09-01',
      plan: { expected_amount_known: true, expected_gross: 5000, first_month_payment: null,
              daily_rate_amount: null, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': mp(0) } }) },

  { id: 'E6 zero-valued discount + firstMonthPayment branch', expect: { state: 'green_flag', code: 'paid_in_full', verifier: false },
    why: 'gate 5: a set firstMonthPayment makes ERP skip pro-rating entirely',
    fixture: caseOf({ contract_id: 'E6', contract_start: '2026-07-15',
      plan: { expected_amount_known: true, expected_gross: 5712, first_month_payment: 2000,
              daily_rate_amount: 0, is_one_month_agreement: false,
              additional_discount: { text: '' }, credit_note_discount: { text: '' } },
      months: { '2026-07': mp(2000) } }) },
];

// ---- execute ------------------------------------------------------------
function check(t) {
  const wins = t.windows || WINDOWS;
  const { cases } = run([t.fixture], wins);
  const c = cases[0];
  const got = { state: c.new_state, code: c.reason_code, verifier: c.requires_verifier };
  let pass;
  if (t.expect.state === 'NOT green_flag') pass = got.state !== 'green_flag' && got.verifier === true;
  else if (t.expect.state === 'any') pass = got.verifier === t.expect.verifier;
  else pass = got.state === t.expect.state && got.code === t.expect.code && got.verifier === t.expect.verifier;
  return { t, got, c, pass };
}

const results = [];
for (const t of SPEC.concat(EDGES)) {
  try { results.push(check(t)); }
  catch (e) { results.push({ t, got: { error: e.message }, pass: false }); }
}

let passed = 0;
for (const r of results) {
  const mark = r.pass ? 'PASS' : 'FAIL';
  if (r.pass) passed++;
  console.log(mark + '  ' + r.t.id);
  console.log('      expected: state=' + r.t.expect.state + ' code=' + r.t.expect.code + ' verifier=' + r.t.expect.verifier);
  console.log('      got     : state=' + r.got.state + ' code=' + r.got.code + ' verifier=' + r.got.verifier +
              (r.got.error ? ' ERROR=' + r.got.error : ''));
  if (r.c && r.c.computed) {
    const k = r.c.computed;
    console.log('      figures : expected=' + k.expected + ' actual=' + k.actual +
                ' (monthly=' + k.actual_from_monthly + ' +gap=' + k.actual_from_other_types_closing_the_gap +
                ' ignored=' + k.other_types_ignored_as_separate_charges + ')' +
                ' shortfall=' + k.shortfall + ' persistence=' + (k.persistence && k.persistence.verdict));
  }
  if (!r.pass) console.log('      WHY IT MATTERS: ' + r.t.why);
  console.log('');
}
console.log('==== ' + passed + '/' + results.length + ' passed ====');
