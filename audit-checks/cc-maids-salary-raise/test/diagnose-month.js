'use strict';
/**
 * Is the audited month a SETTLED, FULL payroll month, or a partial/excluded one?
 *
 * Maid 3978 reads +350 over entitlement in 15 of 24 months and BELOW it in a handful, including
 * the month this build first picked. If those dips are prorated or excluded months, scoring them
 * clears a maid who is genuinely overpaid — a false clearance.
 *
 * Prints payroll-row STATE fields (status, transferred, exclusion reasons, paid dates) and the
 * delta vs entitlement. No absolute salary.
 */
const { call, sleep, assertTokenLive } = require('../lib/erp');
const S = require('../lib/scorer');

(async () => {
  assertTokenLive();
  const docs = await call('GET', '/visa/renewRequest/housemaidProfile/documents/3978', 'HousemaidDocuments'); await sleep();
  const hist = await call('GET', '/payroll/HousemaidPayroll/3978/getHistoryLog?monthsCount=24', 'HousemaidsPayrollList');
  const rows = Array.isArray(hist.body) ? hist.body : [];
  const RULE_TOTAL = 2000;

  console.log('month      delta   status              transferred paidOn      autoExcl  manualExcl  canBePaid todoClosed');
  for (const r of rows) {
    const key = S.monthKey(r.formattedPayrollMonth);
    const n = S.countQualifyingRenewals(Array.isArray(docs.body) ? docs.body : [], key + '-28T23:59:59Z').count;
    const d = r.basicSalary - (RULE_TOTAL + 350 * Math.min(n, 2));
    const auto = Array.isArray(r.automaticExclusionReasons)
      ? (r.automaticExclusionReasons.length ? r.automaticExclusionReasons.join('|') : '-')
      : (r.automaticExclusionReasons || '-');
    console.log(
      String(r.formattedPayrollMonth).padEnd(10) +
      String(d > 0 ? '+' + d : d).padStart(6) + '   ' +
      String(r.status || '-').padEnd(20) +
      String(r.transferred).padEnd(12) +
      String(r.paidOnDate || '-').slice(0, 10).padEnd(12) +
      String(auto).slice(0, 9).padEnd(10) +
      String(r.manualExclusionReason || '-').slice(0, 11).padEnd(12) +
      String(r.canBeMarkedAsPaid).padEnd(10) +
      String(r.accountantTodoIsClosed)
    );
  }
})();
