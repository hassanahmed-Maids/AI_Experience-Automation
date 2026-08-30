'use strict';
/**
 * Fixtures for the five REAL cases on the check page, plus a guard for each edge the rules name.
 *
 * The five are not a sample: they are the actual above-allowance population of CC Filipina
 * live-in maids as read live on 2026-08-19, and each one's expected verdict has a NAMED RULE
 * that produces it. Reproducing all five independently is the strongest available signal the
 * logic is right — so these numbers are the fixed reference. If a refactor moves them, the
 * refactor is wrong, not the fixture.
 *
 * Cohort constants used below, all from the spec's own verified reads:
 *   Filipina live-in salary-rule total .... 2000   (mv_app_salary_range trap: ".default is 1500
 *                                                   for Filipina, while the CC live-in
 *                                                   salary-rule total is 2000")
 *   Filipina renewal_raise ................ 350    (nationality tag, read live)
 *   Filipina max_renewal_raise ............ 400    (a DIFFERENT number — caps one raise's size)
 *   renewal_raise_lifetime_cap ............ 2      (ruling, Jacky 2026-08-19 — not an ERP value)
 *   Ethiopian renewal_raise ............... absent (all 38 tags dumped; absence IS the answer)
 */

const FILIPINA = {
  id: 614,
  name: 'Filipina',
  tags: [
    'renewal_raise:350',
    'max_renewal_raise:400',
    'mv_app_salary_range:{"default":1500,"default_on_contract":1500,"min":1500,"max":3200,"order":1,"showInNationalityStep":true}'
  ]
};

// Ethiopian carries NO renewal_raise tag at all. ERP configuration independently confirms the
// ruling that Ethiopians receive no renewal raise.
const ETHIOPIAN = { id: 501, name: 'Ethiopian', tags: ['african_nationality', 'nationality_group_grade:2'] };

/** Filipina live-in salary rule: components summing to 2000, plus accommodation held separately. */
function filipinaLiveInRule() {
  return [
    { salaryRule: { id: 11, label: 'CC Filipina Live-in' }, salaryComponent: { id: 1, label: 'primarySalary' },      value: 1500 },
    { salaryRule: { id: 11, label: 'CC Filipina Live-in' }, salaryComponent: { id: 2, label: 'holiday' },            value: 200 },
    { salaryRule: { id: 11, label: 'CC Filipina Live-in' }, salaryComponent: { id: 3, label: 'overTime' },           value: 300 },
    // MUST be excluded from the total — getTotalSalaryFromComponents() sums every component
    // EXCEPT accommodationSalary. Including it would inflate every allowance by 846 and clear
    // real findings.
    { salaryRule: { id: 11, label: 'CC Filipina Live-in' }, salaryComponent: { id: 4, label: 'accommodationSalary' }, value: 846 }
  ];
}

function ethiopianLiveInRule() {
  return [
    { salaryRule: { id: 22, label: 'CC Ethiopian Live-in' }, salaryComponent: { id: 1, label: 'primarySalary' }, value: 1000 },
    { salaryRule: { id: 22, label: 'CC Ethiopian Live-in' }, salaryComponent: { id: 2, label: 'holiday' },       value: 200 },
    { salaryRule: { id: 22, label: 'CC Ethiopian Live-in' }, salaryComponent: { id: 4, label: 'accommodationSalary' }, value: 846 }
  ];
}

/** A completed renew request whose r-visa attachment landed on `uploadDate`. */
function renewal(uploadDate, requestDate, tag) {
  return {
    completed: true,
    status: 'COMPLETED',
    creationDate: requestDate || uploadDate,
    attachments: [
      { tag: 'medicalCertificate', creationDate: requestDate || uploadDate },
      { tag: tag || 'rVisa', creationDate: uploadDate },
      { tag: 'newEmiratesIdFront', creationDate: uploadDate }
    ]
  };
}

/** N months of payroll history at a flat total, with optional additions. */
function history(months, total, additions) {
  const add = additions || {};
  return months.map(m => ({
    formattedPayrollMonth: m,
    basicSalary: total,
    companySalary: total,
    totalAddition: Number(add[m] || 0),
    totalDeduction: 0,
    // Present ON PURPOSE and inflated: netSalary must NEVER be read. Net = total + additions −
    // deductions, and maid 7320 reads 2550 in Dec 2025 and Jun 2026 purely because a 200 addition
    // landed while her rate never moved. If a refactor starts reading this field, these fixtures
    // change verdict and the suite fails.
    netSalary: total + Number(add[m] || 0) + 999
  }));
}

const MONTHS = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'];
const AUDITED = '2026-07';
const MONTH_END = '2026-07-31T23:59:59Z';

function base(overrides) {
  return Object.assign({
    maid_id: 0,
    payroll_month: AUDITED,
    month_end_iso: MONTH_END,
    payroll_type: 'MAID_CC',
    nationality: FILIPINA,
    live_out: false,
    salary_rule_details: filipinaLiveInRule(),
    salary_rule_no_rule_found: false,
    salary_rule_conflict: false,
    renew_requests: [],
    payroll_history: history(MONTHS, 2000),
    evidence_sweep: { reconciled: true, pulled: 0, total_elements: 0 }
  }, overrides || {});
}

// ── THE FIVE REAL CASES ─────────────────────────────────────────────────────────────────────
const REAL_CASES = [
  {
    label: 'maid 3978 — finding via verifier ❼ (the cleanest red in the population)',
    note: '96 of 96 complaints swept, ZERO raise or salary To-dos exist. No approved base, no ' +
          'authorisation. It only holds because the sweep reconciled: at the default page size ' +
          'the first 20 showed nothing either.',
    maid: base({
      maid_id: 3978,
      renew_requests: [renewal('2024-09-03', '2024-05-22')],       // 1 qualifying renewal
      payroll_history: history(MONTHS, 2700),                      // allowed 2350, paid 2700
      evidence_sweep: { reconciled: true, pulled: 96, total_elements: 96 }
    }),
    expect_deterministic: { verdict: 'candidate', allowed: 2350, paid_vs_allowed: 350, settled_by: 'Order 60 ❻' },
    reading: {
      sweep_reconciled: true, authorisation_found: false, approved_amount: null,
      approved_amount_is_base: true, approval_denied: false,
      renewal_raises_consumed_by_approval: 0, renewals_since_approval: null,
      justification_is_cohort_wide: false, addition_is_raise_in_disguise: null,
      todo_ids: [], documented_amounts: [], notes: 'no raise or salary To-dos in 96 complaints'
    },
    expect_final: { verdict: 'finding', settled_by: 'Verifier Order 112 ❼' }
  },
  {
    label: 'maid 44770 — clean via verifier ❽ (approved NON-STANDARD BASE plus one renewal)',
    note: 'To-do 228006: "promised a salary of 2500 AED if she joins before December 15th, and ' +
          'she did but her ERP salary is 2000." One qualifying renewal adds the raise. Lands ' +
          'EXACTLY on her entitlement.',
    maid: base({
      maid_id: 44770,
      renew_requests: [renewal('2025-03-11', '2024-12-02')],
      payroll_history: history(MONTHS, 2850),
      evidence_sweep: { reconciled: true, pulled: 26, total_elements: 26 }
    }),
    expect_deterministic: { verdict: 'candidate', allowed: 2350, paid_vs_allowed: 500, settled_by: 'Order 60 ❻' },
    reading: {
      sweep_reconciled: true, authorisation_found: true, approved_amount: 2500,
      approved_amount_is_base: true, approval_denied: false,
      renewal_raises_consumed_by_approval: 0, renewals_since_approval: 1,
      justification_is_cohort_wide: false, addition_is_raise_in_disguise: null,
      todo_ids: ['228006'], documented_amounts: [2500], notes: 'approved joining base of 2500'
    },
    expect_final: { verdict: 'clean', settled_by: 'Verifier Order 108 ❽', allowed_verified: 2850 }
  },
  {
    label: 'maid 65604 — clean via verifier ❽ (THE most error-prone line in the spec)',
    note: 'To-do 675772: "retracted under live in, 500 salary raise, new salary should be 2500 ' +
          'please." Approved BASE plus one renewal. This case was WRONGLY CALLED A FINDING during ' +
          'the rebuild by reading the approved base as a final salary.',
    maid: base({
      maid_id: 65604,
      renew_requests: [renewal('2025-06-18', '2025-02-04')],
      payroll_history: history(MONTHS, 2850),
      evidence_sweep: { reconciled: true, pulled: 18, total_elements: 18 }
    }),
    expect_deterministic: { verdict: 'candidate', allowed: 2350, paid_vs_allowed: 500, settled_by: 'Order 60 ❻' },
    reading: {
      sweep_reconciled: true, authorisation_found: true, approved_amount: 2500,
      approved_amount_is_base: true, approval_denied: false,
      renewal_raises_consumed_by_approval: 0, renewals_since_approval: 1,
      justification_is_cohort_wide: false, addition_is_raise_in_disguise: null,
      todo_ids: ['675772'], documented_amounts: [2500, 500],
      notes: 'approved base 2500 on retraction under live-in'
    },
    expect_final: { verdict: 'clean', settled_by: 'Verifier Order 108 ❽', allowed_verified: 2850 }
  },
  {
    label: 'maid 10907 — pending via verifier ❾ (documented, but the arithmetic needs a human)',
    note: '22/22 swept. Three raise To-dos — a 500 renewal raise, a 200 retention bump, and a ' +
          'reference to a 350 renewal raise — none of which reconciles cleanly to her paid ' +
          'amount on its own. Not a clearance and not an accusation.',
    maid: base({
      maid_id: 10907,
      renew_requests: [renewal('2024-11-20', '2024-07-15')],
      payroll_history: history(MONTHS, 2900),
      evidence_sweep: { reconciled: true, pulled: 22, total_elements: 22 }
    }),
    expect_deterministic: { verdict: 'candidate', allowed: 2350, paid_vs_allowed: 550, settled_by: 'Order 60 ❻' },
    reading: {
      sweep_reconciled: true, authorisation_found: true,
      approved_amount: null,                    // no SINGLE figure composes — that is the point
      approved_amount_is_base: true, approval_denied: false,
      renewal_raises_consumed_by_approval: 0, renewals_since_approval: null,
      justification_is_cohort_wide: false, addition_is_raise_in_disguise: null,
      todo_ids: ['t1', 't2', 't3'], documented_amounts: [500, 200, 350],
      notes: 'three raise To-dos, no single reading composes to the paid amount'
    },
    expect_final: { verdict: 'pending', settled_by: 'Verifier Order 115 ❾' }
  },
  {
    label: 'maid 11964 — finding via verifier ❹ (a THIRD renewal raise beyond a lifetime cap of two)',
    note: 'To-do 282840 grants "a raise of 700 AED upon renewal. Her salary should become 2700" ' +
          '— BOTH allowed renewal raises consumed in one instruction, capping her (❿). She then ' +
          'renewed again in June 2026 and now sits 350 higher. This shape is INVISIBLE to any ' +
          'rule that only compares against a nationality standard.',
    maid: base({
      maid_id: 11964,
      renew_requests: [
        renewal('2022-04-10', '2022-01-05'),
        renewal('2024-05-19', '2024-02-02'),
        renewal('2026-06-08', '2026-02-11')     // the third
      ],
      payroll_history: history(MONTHS, 3050),
      evidence_sweep: { reconciled: true, pulled: 33, total_elements: 33 }
    }),
    // allowed = 2000 + 350 x min(3, 2) = 2700; paid 3050. Capped out.
    expect_deterministic: { verdict: 'candidate', allowed: 2700, paid_vs_allowed: 350, capped_out: true, settled_by: 'Order 60 ❻' },
    reading: {
      sweep_reconciled: true, authorisation_found: true, approved_amount: 2700,
      approved_amount_is_base: false,           // the sentence names the RESULTING salary
      approval_denied: false,
      renewal_raises_consumed_by_approval: 2,   // "+700" on a 350 nationality = both raises
      renewals_since_approval: 1,
      justification_is_cohort_wide: false, addition_is_raise_in_disguise: null,
      todo_ids: ['282840'], documented_amounts: [700, 2700],
      notes: 'later To-do records her refusing to renew because 2700 was no longer enough'
    },
    expect_final: { verdict: 'finding', settled_by: 'Verifier Order 110 ❹', allowed_verified: 2700 }
  }
];

module.exports = {
  FILIPINA, ETHIOPIAN, filipinaLiveInRule, ethiopianLiveInRule,
  renewal, history, MONTHS, AUDITED, MONTH_END, base, REAL_CASES
};
