'use strict';
/**
 * Offline test suite. No ERP, no n8n, no network.
 * Run: node test/run.js
 *
 * Two halves:
 *   1. THE FIVE REAL CASES — deterministic verdict, then final verdict after adjudication.
 *      These are the fixed reference; a refactor that moves them is wrong.
 *   2. EDGE GUARDS — one per hazard the rules or the variable rows explicitly name. Every one
 *      of these exists because getting it wrong produces a FALSE CLEARANCE, which is the failure
 *      nobody finds out about.
 */

const S = require('../lib/scorer');
const A = require('../lib/adjudicate');
const F = require('./cases');

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++; failures.push(name + (detail ? '  →  ' + detail : ''));
}
function eq(name, got, want) {
  check(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function throws(name, fn, rx) {
  try { fn(); fail++; failures.push(name + '  →  expected a throw, got none'); }
  catch (e) {
    if (rx && !rx.test(e.message)) { fail++; failures.push(name + '  →  wrong message: ' + e.message); }
    else pass++;
  }
}

// ── 0. Reference-data checksum, asserted before anything is scored ──────────────────────────
console.log('\n── rulings ──');
const CK = S.rulingsChecksum(S.RULINGS);
console.log('  checksum: ' + CK);
eq('rulings checksum is stable', CK, 'cap=2;Ethiopian|live_in=1500,Filipina|live_out=3200;n=2');
throws('a missing lifetime cap STOPS the run', () => S.assertRulings({ ruled_cohort_level: {} }), /RULING MISSING/);
throws('a missing cohort-level table STOPS the run', () => S.assertRulings({ renewal_raise_lifetime_cap: 2 }), /RULING MISSING/);

// ── 1. The five real cases ──────────────────────────────────────────────────────────────────
console.log('\n── the five real cases ──');
for (const tc of F.REAL_CASES) {
  const det = S.scoreMaid(tc.maid);
  const d = tc.expect_deterministic;
  eq(tc.label + ' :: deterministic verdict', det.verdict, d.verdict);
  eq(tc.label + ' :: allowed', det.allowed, d.allowed);
  eq(tc.label + ' :: paid vs allowed', det.paid_vs_allowed, d.paid_vs_allowed);
  eq(tc.label + ' :: settled by', det.settled_by, d.settled_by);
  if (d.capped_out !== undefined) eq(tc.label + ' :: capped out', det.capped_out, d.capped_out);

  const fin = A.adjudicate(det, tc.reading);
  const f = tc.expect_final;
  eq(tc.label + ' :: FINAL verdict', fin.verdict, f.verdict);
  eq(tc.label + ' :: final settled by', fin.settled_by, f.settled_by);
  if (f.allowed_verified !== undefined) eq(tc.label + ' :: verified allowance', fin.allowed_verified, f.allowed_verified);

  console.log('  ' + (fin.verdict === f.verdict ? '✓' : '✗') + ' ' + tc.label.split(' — ')[0] +
              '  det=' + det.verdict + '(' + det.settled_by + ')  final=' + fin.verdict +
              '(' + fin.settled_by + ')');
}

// ── 2. Edge guards ──────────────────────────────────────────────────────────────────────────
console.log('\n── edge guards ──');

// accommodationSalary must be EXCLUDED from the standard.
eq('salary-rule total excludes accommodationSalary',
   S.sumSalaryRuleComponents(F.filipinaLiveInRule()), 2000);
eq('an empty component list is null, never 0',
   S.sumSalaryRuleComponents([]), null);
eq('a missing component list is null, never 0',
   S.sumSalaryRuleComponents(null), null);

// renewal_raise tag parsing.
eq('renewal_raise is read from the tag', S.readRenewalRaise(F.FILIPINA.tags), 350);
eq('ABSENCE IS THE ANSWER on Ethiopian', S.readRenewalRaise(F.ETHIOPIAN.tags), null);
eq('max_renewal_raise is NOT mistaken for renewal_raise',
   S.readRenewalRaise(['max_renewal_raise:400']), null);
eq('mv_app_salary_range splits on the FIRST colon only',
   (S.readMvAppSalaryRange(F.FILIPINA.tags) || {}).max, 3200);

// r-visa tag drift and date basis.
eq('pre-2020 tag spellings count as a renewal',
   S.countQualifyingRenewals([F.renewal('2018-08-01', '2018-03-01', 'stampedRvisa')], F.MONTH_END).count, 1);
eq('one cycle carrying THREE r-visa spellings counts as ONE renewal',
   S.countQualifyingRenewals([{ attachments: [
     { tag: 'stampedRvisa', creationDate: '2018-08-01' },
     { tag: 'oldRvisa', creationDate: '2018-08-03' },
     { tag: 'rvisaApplication', creationDate: '2018-07-20' }
   ] }], F.MONTH_END).count, 1);
eq('non-r-visa attachments never count',
   S.countQualifyingRenewals([{ attachments: [
     { tag: 'medicalCertificate', creationDate: '2024-01-01' },
     { tag: 'electronicWorkPermit', creationDate: '2024-01-02' }
   ] }], F.MONTH_END).count, 0);
eq('a renewal uploaded AFTER the audited month does not raise her allowance',
   S.countQualifyingRenewals([F.renewal('2026-09-15', '2026-05-01')], F.MONTH_END).count, 0);
eq('the ATTACHMENT date is used, not the request date',
   S.countQualifyingRenewals([F.renewal('2026-09-15', '2026-01-01')], F.MONTH_END).count, 0);

// Recurring additions — the VPM-8374 shape.
const rec = S.detectRecurringAddition(F.history(F.MONTHS, 2000,
  { '2026-03': 350, '2026-04': 350, '2026-05': 350, '2026-06': 350, '2026-07': 350 }));
check('a recurring identical addition is detected', rec && rec.amount === 350 && rec.months_count === 5,
      JSON.stringify(rec));
eq('a ONE-OFF airfare addition is NOT a raise',
   S.detectRecurringAddition(F.history(F.MONTHS, 2000, { '2026-05': 1500 })), null);
eq('zero-valued additions never form a recurring run',
   S.detectRecurringAddition(F.history(F.MONTHS, 2000)), null);
eq('a broken run does not survive the gap',
   S.detectRecurringAddition(F.history(F.MONTHS, 2000, { '2026-01': 350, '2026-03': 350 })), null);

// netSalary must never drive a verdict: an inflated net is present on every fixture row.
const netTrap = S.scoreMaid(F.base({ maid_id: 7320, payroll_history: F.history(F.MONTHS, 2000, { '2026-07': 200 }) }));
eq('an addition inflating netSalary does NOT make a clean maid a candidate', netTrap.verdict, 'clean');

// The month defines the population — this is how the OPEN paying-status question is answered.
const noRow = S.scoreMaid(F.base({ maid_id: 1, payroll_month: '2026-12' }));
eq('no payroll row for the month = out of population, never clean', noRow.verdict, 'out_of_population');

// Unknowns land on pending, never clean.
eq('"No Rule is found!" is pending, never "no ceiling applies"',
   S.scoreMaid(F.base({ maid_id: 2, salary_rule_no_rule_found: true })).verdict, 'pending');
eq('two disagreeing active rules are pending',
   S.scoreMaid(F.base({ maid_id: 3, salary_rule_conflict: true })).verdict, 'pending');
eq('unknown living status is pending, never inferred live-in',
   S.scoreMaid(F.base({ maid_id: 4, live_out: null })).verdict, 'pending');
eq('missing nationality is pending',
   S.scoreMaid(F.base({ maid_id: 5, nationality: { name: '', tags: [] } })).verdict, 'pending');
eq('an evidence sweep that did not reconcile is pending, never clean',
   S.scoreMaid(F.base({ maid_id: 6, evidence_sweep: { reconciled: false, pulled: 20, total_elements: 96 } })).verdict,
   'pending');

// A nationality with no renewal_raise tag earns no renewal raise.
// Isolated on Ethiopian LIVE-OUT, which carries NO ruled cohort level — so the base is her own
// salary-rule total and nothing masks the renewal-raise question. (Live-out has no Ethiopian
// cohort on the CC price card, but the salary rule is what prices HER, and this is the only
// cohort where gate ⓰ stays out of the way.)
const ethOut = S.scoreMaid(F.base({
  maid_id: 7, live_out: true, nationality: F.ETHIOPIAN, salary_rule_details: F.ethiopianLiveInRule(),
  renew_requests: [F.renewal('2024-01-01'), F.renewal('2026-01-01')],
  payroll_history: F.history(F.MONTHS, 1200)
}));
eq('Ethiopian earns NO renewal raise however many renewals', ethOut.allowed, 1200);
eq('an Ethiopian at her standard is clean', ethOut.verdict, 'clean');
eq('two renewals were still COUNTED — they simply buy nothing', ethOut.renewals_counted, 2);
eq('an Ethiopian above her standard is a candidate, not an automatic finding',
   S.scoreMaid(F.base({ maid_id: 71, live_out: true, nationality: F.ETHIOPIAN,
     salary_rule_details: F.ethiopianLiveInRule(),
     renew_requests: [F.renewal('2024-01-01')],
     payroll_history: F.history(F.MONTHS, 1550) })).verdict, 'candidate');

// Ethiopian LIVE-IN carries a ruled cohort level of 1,500 (gate ⓰), which REPLACES her
// salary-rule total of 1,200. Without this the whole ruled cohort would price 300 low and every
// one of them would be flagged — the candidate flood the ruling exists to stop.
const ethIn = S.scoreMaid(F.base({
  maid_id: 72, nationality: F.ETHIOPIAN, salary_rule_details: F.ethiopianLiveInRule(),
  renew_requests: [F.renewal('2024-01-01'), F.renewal('2026-01-01')],
  payroll_history: F.history(F.MONTHS, 1200)
}));
eq('the ruled level replaces the salary-rule total for Ethiopian live-in', ethIn.base, 1500);
eq('and renewal raises do not stack on it', ethIn.allowed, 1500);
eq('an Ethiopian live-in below the ruled level is clean', ethIn.verdict, 'clean');
eq('an Ethiopian live-in at EXACTLY 1,500 routes rather than clearing (the OPEN boundary)',
   S.scoreMaid(F.base({ maid_id: 73, nationality: F.ETHIOPIAN,
     salary_rule_details: F.ethiopianLiveInRule(),
     payroll_history: F.history(F.MONTHS, 1500) })).route_reason,
   'at_exactly_ruled_cohort_level');

// Ruled cohort levels (gate ⓰), and the deliberate deviation at the boundary.
const filLiveOut = S.scoreMaid(F.base({
  maid_id: 8, live_out: true, renew_requests: [F.renewal('2024-01-01')],
  payroll_history: F.history(F.MONTHS, 3200)
}));
eq('a ruled cohort level replaces the salary-rule total as the base', filLiveOut.base, 3200);
eq('renewal raises do NOT stack on a ruled cohort level', filLiveOut.allowed, 3200);
eq('at EXACTLY the ruled level she routes (conservative deviation), never auto-clears',
   filLiveOut.verdict, 'candidate');
eq('the deviation is attributable', filLiveOut.route_reason, 'at_exactly_ruled_cohort_level');
eq('below a ruled level is clean',
   S.scoreMaid(F.base({ maid_id: 9, live_out: true, payroll_history: F.history(F.MONTHS, 3000) })).verdict,
   'clean');
eq('above a ruled level is a candidate',
   S.scoreMaid(F.base({ maid_id: 10, live_out: true, payroll_history: F.history(F.MONTHS, 3500) })).verdict,
   'candidate');
// The 561-of-798 cluster must NOT become 561 findings.
eq('the Filipina live-out 3,200 cluster is not a finding',
   S.scoreMaid(F.base({ maid_id: 11, live_out: true, payroll_history: F.history(F.MONTHS, 3200) })).verdict !== 'finding',
   true);

// MV→CC switchers: pending, never red, on a missing renewal alone.
const sw = S.scoreMaid(F.base({
  maid_id: 12, payroll_type: 'MV_TO_CC', renew_requests: [],
  payroll_history: F.history(F.MONTHS, 2700)
}));
eq('an MV→CC switcher above her allowance is PENDING, never red', sw.verdict, 'pending');
eq('the switcher is settled by Order 57 ⓫', sw.settled_by, 'Order 57 ⓫');

// ...but a switcher at or BELOW the base alone is provably fine and must still clear. Her
// CC-service raise can only RAISE the allowance, so no answer to the open clock question could
// make her overpaid. Marking these pending would bury ~1,500 maids in the review queue every
// run, and a queue nobody can get through is how a real finding gets missed.
const swClean = S.scoreMaid(F.base({
  maid_id: 121, payroll_type: 'MV_TO_CC', renew_requests: [],
  payroll_history: F.history(F.MONTHS, 1900)
}));
eq('an MV→CC switcher at or below the base alone is CLEAN, not pending', swClean.verdict, 'clean');
eq('and the unresolvable service clock is still recorded as a gap', swClean.gaps.length, 1);
eq('but that gap does not block a clean', swClean.gaps_blocking.length, 0);

// Same shape: unreadable renewal documents can only ADD to her allowance.
const unreadable = S.scoreMaid(F.base({
  maid_id: 122, renew_requests: [], renew_requests_unreadable: true,
  payroll_history: F.history(F.MONTHS, 1900)
}));
eq('unreadable renewals do not block a clean when she is below the base', unreadable.verdict, 'clean');
eq('the unreadable-renewal gap is recorded', unreadable.gaps.length, 1);
eq('and it is non-blocking', unreadable.gaps_blocking.length, 0);

// The opposite shape: a gap that could LOWER her allowance must block.
const livingDispute = S.scoreMaid(F.base({
  maid_id: 123, live_out: true, live_out_asserted: false,
  payroll_history: F.history(F.MONTHS, 3000)
}));
eq('a living-status disagreement BLOCKS a clean (live-in is the lower standard)',
   livingDispute.verdict, 'pending');
eq('and it is recorded as blocking', livingDispute.gaps_blocking.length, 1);

const paidDispute = S.scoreMaid(F.base({
  maid_id: 124,
  payroll_history: F.MONTHS.map(m => ({ formattedPayrollMonth: m, basicSalary: 2000,
    companySalary: 2400, totalAddition: 0, totalDeduction: 0, netSalary: 2400 }))
}));
eq('basicSalary/companySalary disagreement BLOCKS a clean', paidDispute.verdict, 'pending');

// Structural asserts.
throws('a case with no maid id STOPS the run',
       () => S.scoreMaid(F.base({ maid_id: null })), /JOIN KEY MISSING/);
throws('a MAID_VISA maid in the population STOPS the run',
       () => S.scoreMaid(F.base({ maid_id: 13, payroll_type: 'MAID_VISA' })), /MAID_VISA IN THE POPULATION/);

// The VPM-8374 route, end to end.
const hidden = S.scoreMaid(F.base({
  maid_id: 14, renew_requests: [F.renewal('2024-09-03')],
  payroll_history: F.history(F.MONTHS, 2350, { '2026-04': 350, '2026-05': 350, '2026-06': 350, '2026-07': 350 })
}));
eq('a raise hidden in recurring additions routes even AT standard', hidden.verdict, 'candidate');
eq('it is routed by Order 62 ⓭', hidden.settled_by, 'Order 62 ⓭');
eq('a hidden raise with no authorisation on a reconciled sweep is a finding',
   A.adjudicate(hidden, { sweep_reconciled: true, authorisation_found: false, approved_amount: null,
     addition_is_raise_in_disguise: true, approval_denied: false,
     renewal_raises_consumed_by_approval: 0, todo_ids: [], documented_amounts: [] }).verdict,
   'finding');
eq('the same addition judged a BENEFIT is clean',
   A.adjudicate(hidden, { sweep_reconciled: true, authorisation_found: true, approved_amount: null,
     addition_is_raise_in_disguise: false, approval_denied: false,
     renewal_raises_consumed_by_approval: 0, todo_ids: ['x'], documented_amounts: [] }).verdict,
   'clean');

// Verifier-side guards.
const cand = S.scoreMaid(F.base({ maid_id: 15, renew_requests: [F.renewal('2024-09-03')],
                                  payroll_history: F.history(F.MONTHS, 2700),
                                  evidence_sweep: { reconciled: true, pulled: 5, total_elements: 5 } }));
eq('a DENIED raise is not an authorisation — it is a finding',
   A.adjudicate(cand, { sweep_reconciled: true, authorisation_found: true, approved_amount: null,
     approval_denied: true, renewal_raises_consumed_by_approval: 0, todo_ids: ['648325'],
     documented_amounts: [] }).verdict, 'finding');
eq('a reading derived from To-do TYPES alone is pending',
   A.adjudicate(cand, { read_from_type_only: true, sweep_reconciled: true, authorisation_found: true,
     approved_amount: 2700, renewal_raises_consumed_by_approval: 0, todo_ids: ['x'] }).verdict, 'pending');
eq('a blanket cohort pattern never clears an individual',
   A.adjudicate(cand, { sweep_reconciled: true, authorisation_found: true, approved_amount: null,
     justification_is_cohort_wide: true, approval_denied: false,
     renewal_raises_consumed_by_approval: 0, todo_ids: ['x'], documented_amounts: [] }).verdict, 'pending');
eq('no authorisation on an UNRECONCILED sweep is pending, never a finding',
   A.adjudicate(cand, { sweep_reconciled: false, authorisation_found: false, approved_amount: null,
     approval_denied: false, renewal_raises_consumed_by_approval: 0, todo_ids: [],
     documented_amounts: [] }).verdict, 'pending');
eq('evidence composing ABOVE what she was paid is pending, not a finding (this check looks upward only)',
   A.adjudicate(cand, { sweep_reconciled: true, authorisation_found: true, approved_amount: 3000,
     approved_amount_is_base: true, approval_denied: false,
     renewal_raises_consumed_by_approval: 0, renewals_since_approval: 0, todo_ids: ['x'],
     documented_amounts: [3000] }).verdict, 'pending');
// "Approximately" is not "exactly" — ❽ clears only on an exact composition.
eq('an approved figure composing to ONE AED under the paid amount is a finding, not a clearance',
   A.adjudicate(cand, { sweep_reconciled: true, authorisation_found: true, approved_amount: 2349,
     approved_amount_is_base: true, approval_denied: false,
     renewal_raises_consumed_by_approval: 0, renewals_since_approval: 1, todo_ids: ['x'],
     documented_amounts: [2349] }).verdict, 'finding');
throws('adjudicating an already-settled case STOPS the run',
       () => A.adjudicate(S.scoreMaid(F.base({ maid_id: 16 })), {}), /ADJUDICATE CALLED ON A SETTLED CASE/);

// The final safety net.
eq('a case still holding candidate at delivery becomes PENDING, never clean',
   A.finalise([cand])[0].verdict, 'pending');
eq('and it is attributed to Order 78 ⓯', A.finalise([cand])[0].settled_by, 'Order 78 ⓯');

// ── Summary ─────────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(78));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  ✗ ' + f)); }
console.log('─'.repeat(78) + '\n');
process.exit(fail ? 1 : 0);
