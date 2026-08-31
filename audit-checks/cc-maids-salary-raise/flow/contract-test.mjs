// Contract tests over the DEPLOYED bodies. Run: node flow/contract-test.mjs
import fs from 'node:fs';
import { runNode, byNode } from './harness.mjs';

let pass = 0, fail = 0;
const ok  = (l) => { console.log('  ok   ' + l); pass++; };
const bad = (l, d) => { console.log('  FAIL ' + l + '\n         ' + d); fail++; };
function eq(label, got, want) { got === want ? ok(label) : bad(label, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }

// ── fixtures: three maids, one of each outcome ──────────────────────────────
const R = (b) => ({ json: { statusCode: 200, body: b } });
const NAT = { id: 614, name: 'Filipina', tags: ['renewal_raise:350', 'max_renewal_raise:400'] };
const RULE = [{ salaryComponent: { label: 'accommodationSalary' }, value: 846 },
              { salaryComponent: { label: 'primarySalary' }, value: 1500 },
              { salaryComponent: { label: 'monthlyLoan' }, value: 500 }];       // -> 2000
const hist = (v) => [{ formattedPayrollMonth: 'Jun 2026', basicSalary: v, companySalary: v, totalAddition: 0 },
                     { formattedPayrollMonth: 'Jul 2026', basicSalary: v, companySalary: v, totalAddition: 0 }];
const rv = (d) => ({ attachments: [{ tag: 'rVisa', creationDate: d }] });
const comp = (base) => R({ content: [{ id: base, complaintType: { label: 'Salary Increase' }, initialDescription: 'x', commentCount: 0 },
                                     { id: base + 1, complaintType: { label: 'Salary Increase' }, initialDescription: 'x', commentCount: 0 }], totalElements: 2 });

const cfg = { params: { run_id: 'contract', check_id: 'c', check_name: 'c', trigger: 'test', smoke: true,
    started_at: '2026-08-30T00:00:00Z', audited_month: 'Jul 2026', audited_month_key: '2026-07',
    back_audit: false, cohort_status: 'WITH_CLIENT', narrowing: true, max_candidates: 0, only_maids: [],
    erp_call_budget: 5000, page_size: 40, history_months: 18 },
  rulings: { renewal_raise_lifetime_cap: 2, ruled_cohort_level: { 'Filipina|live_out': 3200, 'Ethiopian|live_in': 1500 } },
  narrowing_floors: { Filipina: 2000, Ethiopian: 1200 },
  rulings_checksum: 'cap=2;Ethiopian|live_in=1500,Filipina|live_out=3200;n=2' };

const cand = (id, salary, sw) => ({ json: { maid_id: id, nationality_name: 'Filipina', status: 'WITH_CLIENT',
  basic_salary_today: salary, is_switcher: sw, _run: { run_id: 'contract', population_reported: 3, population_pulled: 3,
    population_reconciled: true, filter_narrowed: true, candidates_found: 3, switcher_total: 1, below_floor: 0, declared_gaps: [] } } });

// Get Extra Sweep Pages and Get Comment Threads are on branches NOT taken here, so they are
// absent from the node map on purpose: that is the real shape of a run where no maid has more
// than 20 complaints and none has comments, which is the common case.
const nodes = {
  'Assert Rulings': [{ json: cfg }],
  'Narrow To Candidates': [cand('1', 3050, false), cand('2', 2850, false), cand('3', 2700, true)],
  'Get Maid Profile': [R({ id: 1, nationality: NAT, liveOut: false }), R({ id: 2, nationality: NAT, liveOut: false }), R({ id: 3, nationality: NAT, liveOut: false })],
  'Get Salary Rule': [R(RULE), R(RULE), R(RULE)],
  'Get Payroll History': [R(hist(3050)), R(hist(2850)), R(hist(2700))],
  'Get Renew Documents': [R([rv('2019-08-18'), rv('2021-08-14'), rv('2023-07-28'), rv('2025-04-25')]), R([rv('2025-03-11')]), R([])],
  'Get Complaints Page 0': [comp(1000), comp(2000), comp(3000)],
  'Build Sweep Pages': [{ json: { _no_extra: true } }],
  'Build Thread Requests': [{ json: { _no_threads: true } }]
};

// Get Extra Sweep Pages and Get Comment Threads are ABSENT from the node map on purpose. A node
// on an untaken branch is UNEXECUTED, and $() on it throws - the harness reproduces that. This is
// the COMMON case (no maid over 20 complaints, no complaint with a comment), and it is invisible
// to any pinned test, because a pinned node is readable whether or not its branch ran.
console.log('\n── a quiet cohort: both optional branches never execute ──');
let scored;
try {
  scored = runNode('Score Deterministic', { input: [{ json: {} }], nodes });
  ok('the scorer survives both branch nodes being unexecuted');
} catch (e) {
  bad('the scorer CRASHES when an optional branch did not run - this is the common case', e.message);
  scored = [];
}

console.log('\n── the deployed Score -> Adjudicate contract ──');
eq('three cases scored', scored.length, 3);

const cases = scored.map(i => i.json);
eq('maid 1 allowance = 2000 + 350x2 (4 renewals, capped)', cases[0].allowed_aed, 2700);
eq('maid 2 allowance = 2000 + 350x1', cases[1].allowed_aed, 2350);
eq('maid 3 (switcher) allowance = base alone', cases[2].allowed_aed, 2000);
eq('maid 3 settled by Order 57, pending never red', cases[2].verdict, 'pending');

const selected = runNode('Select Verifier Cases', { input: scored, nodes });
eq('two candidates routed to the verifier', selected.length, 2);

const readings = [
  { json: { output: { sweep_reconciled: true, authorisation_found: false, approved_amount: null, approved_amount_is_base: true,
      approval_denied: false, renewal_raises_consumed_by_approval: 0, renewals_since_approval: null,
      justification_is_cohort_wide: false, addition_is_raise_in_disguise: null, read_from_type_only: false, todo_ids: [], notes: '' } } },
  { json: { output: { sweep_reconciled: true, authorisation_found: true, approved_amount: 2500, approved_amount_is_base: true,
      approval_denied: false, renewal_raises_consumed_by_approval: 0, renewals_since_approval: 1,
      justification_is_cohort_wide: false, addition_is_raise_in_disguise: null, read_from_type_only: false, todo_ids: ['228006'], notes: '' } } }
];
const merged = runNode('Merge Readings', { input: readings, nodes: { ...nodes, 'Select Verifier Cases': selected } });
const adj = runNode('Adjudicate', { input: merged, nodes: { ...nodes, 'Score Deterministic': scored } }).map(i => i.json);

// THE REGRESSION. Before the fix these composed to NaN and maid 2 came back pending.
eq('maid 1 -> finding (reconciled sweep, nothing authorises the excess)', adj[0].verdict, 'finding');
eq('maid 2 -> CLEAN (approved base 2500 + one earned raise = 2850, exactly what she was paid)', adj[1].verdict, 'clean');
eq('maid 2 composed allowance is a real number, not NaN', adj[1].allowed_verified_aed, 2850);
eq('maid 3 -> pending (switcher, untouched by the verifier)', adj[2].verdict, 'pending');

console.log('\n── every det.* field Adjudicate reads is one the scorer emits ──');
const emitted = new Set(Object.keys(cases[0]).concat(Object.keys(cases[1])));
const read = new Set([...byNode['Adjudicate'].matchAll(/\bdet\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]));
const missing = [...read].filter(f => !emitted.has(f));
missing.length === 0 ? ok([...read].length + ' fields read, all supplied by the scorer')
                     : bad('Adjudicate reads fields the scorer never emits', missing.join(', '));

console.log('\n── every If gate uses an operation n8n actually implements ──');
const VALID = new Set(['exists', 'notExists', 'true', 'false', 'equals', 'notEquals']);
const sk = fs.readFileSync(new URL('./skeleton.sdk.js', import.meta.url), 'utf8');
const ops = [...sk.matchAll(/type:\s*'boolean',\s*operation:\s*'([a-zA-Z]+)'/g)].map(m => m[1]);
const badOps = ops.filter(o => !VALID.has(o));
ops.length > 0 ? (badOps.length === 0 ? ok(ops.length + ' boolean gate(s), all valid: ' + [...new Set(ops)].join(', '))
                                      : bad('invalid boolean operation(s) - an unimplemented operation evaluates FALSE, sending the happy path down the empty branch', [...new Set(badOps)].join(', ')))
               : bad('no boolean gates found in the skeleton', 'the regex stopped matching - fix it, do not delete the check');

console.log('\n' + (fail === 0 ? `  ${pass} passed, 0 failed` : `  ${pass} passed, ${fail} FAILED`) + '\n');
process.exit(fail ? 1 : 0);
