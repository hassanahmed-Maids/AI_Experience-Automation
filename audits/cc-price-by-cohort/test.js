const { score } = require('./scorer');
const card = require('./card.json');

// Pinned run date. The scorer defaults to real today; the harness freezes it so
// the expected figures below stay stable. 2026-08-17 is the date the card was
// captured, which is what makes 525 / 4137 / 1585.50 comparable to the spec.
const AS_OF = { asOfMs: Date.UTC(2026, 7, 17) };

// Seven rows from "Five real cases to test with" - five single contracts plus
// two CLASSES. Amounts and cohorts are the spec's own verified figures.
const cases = [
  {
    label: '1060026 (cleanest finding)',
    expect: { state: 'red', verdict: 'Under-priced', reason_code: 'below_card_unexplained', cohort_now: 'livein:Ethiopian', gap_aed: 525, flags: [], needs_human: true, tests: [false, false, false] },
    c: {
      contract_id: 1060026, maid_nationality: 'Ethiopian', live_out: false,
      contract_start_date: '2025-01-19', agreed_monthly_rate: 2604,
      additional_discount: '', credit_note_discount: '',
      payment_term_nationality: 'Ethiopian', live_in_out_logs: [],
    },
  },
  {
    label: '1102788 (largest gap)',
    expect: { state: 'red', verdict: 'Under-priced', reason_code: 'below_card_unexplained', cohort_now: 'liveout:Filipina', gap_aed: 4137, flags: [], needs_human: true, tests: [false, false, false] },
    c: {
      contract_id: 1102788, maid_nationality: 'Filipina', live_out: true,
      contract_start_date: '2026-08-14', agreed_monthly_rate: 1575,
      additional_discount: '', credit_note_discount: '',
      payment_term_nationality: 'Filipina', live_in_out_logs: [],
    },
  },
  {
    label: '1087078 (verifier case)',
    expect: { state: 'red', verdict: 'Under-priced', reason_code: 'below_card_unexplained', cohort_now: 'livein:Filipina', gap_aed: 1585.5, flags: ['payment_term_nationality_mismatch'], needs_human: true, tests: [false, false, false] },
    c: {
      contract_id: 1087078, maid_nationality: 'Filipina', live_out: false,
      contract_start_date: '2026-01-18', agreed_monthly_rate: 3129,
      additional_discount: '', credit_note_discount: '',
      payment_term_nationality: 'Kenyan', live_in_out_logs: [],
    },
  },
  {
    label: '1102274 (ERP-corrected 2725)',
    expect: { state: 'red', verdict: 'Under-priced', reason_code: 'below_card_unexplained', cohort_now: 'livein:Filipina', gap_aed: 1989.5, flags: ['payment_term_nationality_mismatch'], needs_human: true, tests: [false, false, false] },
    c: {
      contract_id: 1102274, maid_nationality: 'Filipina', live_out: false,
      contract_start_date: '2026-08-05', agreed_monthly_rate: 2725,
      additional_discount: '', credit_note_discount: '',
      payment_term_nationality: 'Kenyan', live_in_out_logs: [],
    },
  },
  {
    label: '999444 (grandfathered - THE clearance)',
    expect: { state: 'green', verdict: 'Grandfathered', reason_code: 'matches_published_price', cohort_now: 'livein:Filipina', gap_aed: null, flags: [], needs_human: false, tests: [false, false, true] },
    c: {
      contract_id: 999444, maid_nationality: 'Filipina', live_out: false,
      contract_start_date: '2018-11-01', agreed_monthly_rate: 4301,
      additional_discount: '', credit_note_discount: '',
      payment_term_nationality: 'Filipina', live_in_out_logs: [],
    },
  },
  {
    label: 'CLASS: pre-2024-07-15 live-out',
    expect: { state: 'pending', verdict: 'Unpriceable', reason_code: 'no_published_price_at_start', cohort_now: 'liveout:Filipina', gap_aed: 1512, flags: ['unpriceable_at_start'], needs_human: true, tests: [false, false, false] },
    c: {
      contract_id: 900001, maid_nationality: 'Filipina', live_out: true,
      contract_start_date: '2023-05-01', agreed_monthly_rate: 4200,
      additional_discount: '', credit_note_discount: '',
      payment_term_nationality: 'Filipina', live_in_out_logs: [],
    },
  },
  {
    label: 'CLASS: living-switch (in -> out)',
    expect: { state: 'pending', verdict: "Can't tell", reason_code: 'cleared_on_a_test_but_gate_requires_review', cohort_now: 'liveout:Filipina', gap_aed: null, flags: ['living_switch'], needs_human: true, tests: [false, false, true] },
    c: {
      contract_id: 900002, maid_nationality: 'Filipina', live_out: true,
      contract_start_date: '2023-05-01', agreed_monthly_rate: 4301,
      additional_discount: '', credit_note_discount: '',
      payment_term_nationality: 'Filipina',
      live_in_out_logs: [
        { date: '2025-03-10', oldValue: 'IN', newValue: 'OUT', reason: 'CLIENT_CHANGE_REQUEST' },
      ],
    },
  },
  // Extra guards not in the table but required by gates 4 and 10.
  {
    label: 'GUARD: empty nationality',
    expect: { state: 'pending', verdict: 'Unpriceable', reason_code: 'no_nationality', cohort_now: undefined, gap_aed: null, flags: [], needs_human: true, tests: null },
    c: {
      contract_id: 900003, maid_nationality: '', live_out: false,
      contract_start_date: '2025-01-01', agreed_monthly_rate: 3000,
      additional_discount: '', credit_note_discount: '', live_in_out_logs: [],
    },
  },
  {
    label: 'GUARD: live-out Ethiopian prices as Other',
    expect: { state: 'green', verdict: 'Priced correctly', reason_code: 'matches_current_card', cohort_now: 'liveout:Other', gap_aed: null, flags: [], needs_human: false, tests: [true, true, true] },
    c: {
      contract_id: 900004, maid_nationality: 'Ethiopian', live_out: true,
      contract_start_date: '2026-01-01', agreed_monthly_rate: 4126.5,
      additional_discount: '', credit_note_discount: '', live_in_out_logs: [],
    },
  },
  {
    label: 'GUARD: zero credit note is not a discount',
    expect: { state: 'green', verdict: 'Priced correctly', reason_code: 'matches_current_card', cohort_now: 'livein:Filipina', gap_aed: null, flags: [], needs_human: false, tests: [true, true, true] },
    c: {
      contract_id: 900005, maid_nationality: 'Filipina', live_out: false,
      contract_start_date: '2026-01-01', agreed_monthly_rate: 4714.5,
      additional_discount: '',
      credit_note_discount: 'Credit Note Amount: 0 applied on Service Fee',
      live_in_out_logs: [],
    },
  },
];

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let failures = 0;
console.log(pad('CASE', 38), pad('STATE', 8), pad('VERDICT', 17), pad('COHORT', 18), pad('GAP', 9), 'TESTS n/s/h  RESULT');
console.log('-'.repeat(125));

for (const t of cases) {
  const r = score(t.c, card, AS_OF);
  const e = t.expect;
  const tests = r.tests.price_now === undefined
    ? null
    : [r.tests.price_now, r.tests.price_at_contract_start, r.tests.any_historic_price];

  const diffs = [];
  const cmp = (name, actual, expected) => {
    if (!eq(actual, expected)) diffs.push(name + ': got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
  };
  cmp('state', r.state, e.state);
  cmp('verdict', r.verdict, e.verdict);
  cmp('reason_code', r.reason_code, e.reason_code);
  cmp('cohort_now', r.cohort_now, e.cohort_now);
  cmp('gap_aed', r.gap_aed, e.gap_aed);
  cmp('flags', r.flags.slice().sort(), e.flags.slice().sort());
  cmp('needs_human', r.needs_human, e.needs_human);
  cmp('tests', tests, e.tests);

  if (diffs.length) failures++;
  console.log(
    pad(t.label, 38),
    pad(r.state, 8),
    pad(r.verdict, 17),
    pad(r.cohort_now || '-', 18),
    pad(r.gap_aed === null ? '-' : r.gap_aed, 9),
    pad(tests ? tests.map((x) => (x ? 'P' : 'f')).join('/') : '-/-/-', 12),
    diffs.length ? 'FAIL' : 'pass'
  );
  for (const d of diffs) console.log(' '.repeat(4) + '! ' + d);
}

// A NULL never satisfies a comparison: prove price_at_start cannot pass when the
// cohort had no window at the start date, independently of the case table.
const nullGuard = score({
  contract_id: 900099, maid_nationality: 'Filipina', live_out: true,
  contract_start_date: '2020-01-01', agreed_monthly_rate: 5712,
  additional_discount: '', credit_note_discount: '', live_in_out_logs: [],
}, card, AS_OF);
if (nullGuard.tests.price_at_contract_start !== false || nullGuard.needs_human !== true) {
  console.log('    ! NULL-GUARD: price_at_start must never pass on a null window');
  failures++;
}

// needs_human is ONE-WAY: a gate-routed contract must never be cleared by a
// later passing test. Assert it directly rather than trusting the case table.
const oneWay = score({
  contract_id: 900098, maid_nationality: 'Filipina', live_out: true,
  contract_start_date: '2023-05-01', agreed_monthly_rate: 4300.8,
  additional_discount: '', credit_note_discount: '',
  live_in_out_logs: [{ date: '2025-03-10', oldValue: 'IN', newValue: 'OUT' }],
}, card, AS_OF);
if (oneWay.state === 'green') {
  console.log('    ! ONE-WAY GUARD: a passing test cleared a gate-routed contract');
  failures++;
}

console.log('-'.repeat(125));
console.log((cases.length - failures) + '/' + cases.length + ' cases pass' + (failures ? '  <-- ' + failures + ' FAILING' : ''));
process.exit(failures ? 1 : 0);
