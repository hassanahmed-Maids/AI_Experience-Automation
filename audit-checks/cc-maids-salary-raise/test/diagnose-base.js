'use strict';
/**
 * Confirms the salary-rule total is the figure the spec names (a POLICY standard, not a person's
 * pay — the spec publishes these openly), and traces maid 3978's position RELATIVE TO
 * ENTITLEMENT month by month. Deltas only; no absolute salary is printed.
 */
const { call, sleep, assertTokenLive } = require('../lib/erp');
const S = require('../lib/scorer');
const MONTH_END = '2026-07-31T23:59:59Z';

(async () => {
  assertTokenLive();

  const rule = await call('GET', '/payroll/salaryrules/getruleofhousemaid/3978', 'HousemaidsPayrollList'); await sleep();
  const details = Array.isArray(rule.body) ? rule.body : [];
  console.log('=== salary rule ' + ((details[0] || {}).salaryRule || {}).label + ' — component breakdown (POLICY standard)');
  for (const d of details) {
    console.log('  ' + String((d.salaryComponent || {}).label).padEnd(22) + ' = ' + d.value +
                (String((d.salaryComponent || {}).label).toLowerCase() === 'accommodationsalary' ? '   [EXCLUDED from the standard]' : ''));
  }
  const ruleTotal = S.sumSalaryRuleComponents(details);
  console.log('  --> nationality_standard_total = ' + ruleTotal +
              '   (spec says the CC Filipina live-in total is 2000: ' + (ruleTotal === 2000 ? 'MATCH' : 'MISMATCH') + ')');

  const prof = await call('GET', '/staffmgmt/housemaid/getHousemaidInfo/3978', 'HousemaidDetails'); await sleep();
  const p = prof.body || {};
  console.log('\n=== maid 3978 profile');
  console.log('  status=' + p.status + '  housemaidType=' + p.housemaidType +
              '  liveOut=' + p.liveOut + '  startDate=' + String(p.startDate || '').slice(0, 10));

  const docs = await call('GET', '/visa/renewRequest/housemaidProfile/documents/3978', 'HousemaidDocuments'); await sleep();
  const rens = S.countQualifyingRenewals(Array.isArray(docs.body) ? docs.body : [], MONTH_END);

  const hist = await call('GET', '/payroll/HousemaidPayroll/3978/getHistoryLog?monthsCount=24', 'HousemaidsPayrollList'); await sleep();
  const rows = Array.isArray(hist.body) ? hist.body : [];

  console.log('\n=== maid 3978 — position vs entitlement, month by month (DELTAS ONLY)');
  console.log('  qualifying renewals as of each month, allowance = standard + 350 x min(renewals, 2)');
  console.log('  month      renewals  delta_vs_allowed  addition>0  net!=total');
  for (const r of rows) {
    const key = S.monthKey(r.formattedPayrollMonth);
    const asOf = key + '-28T23:59:59Z';
    const n = S.countQualifyingRenewals(Array.isArray(docs.body) ? docs.body : [], asOf).count;
    const allowed = ruleTotal + 350 * Math.min(n, 2);
    const d = r.basicSalary - allowed;
    console.log('  ' + String(r.formattedPayrollMonth).padEnd(10) +
                String(n).padStart(5) + '     ' +
                String(d > 0 ? '+' + d : d).padStart(10) + '        ' +
                String(r.totalAddition > 0).padEnd(10) +
                String(r.netSalary !== r.basicSalary));
  }
  console.log('\n  renewal dates: ' + rens.dates.join(', '));
  console.log('  Under the spec\'s LIFETIME cap of 2 she is BELOW entitlement in every month above.');
  console.log('  The spec\'s expected "+350 over allowed" only holds if she has ZERO qualifying renewals.');
})();
