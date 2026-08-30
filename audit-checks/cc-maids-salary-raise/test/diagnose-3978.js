'use strict';
/**
 * Why does the spec's flagship red come out clean?
 *
 * Prints salary-rule COMPONENT LABELS (not values), renewal counts, and her position RELATIVE TO
 * ENTITLEMENT — which is exactly how the spec says a maid's position may be expressed
 * ("+350 over allowed", never an absolute salary). No absolute salary is printed.
 */
const { call, sleep, assertTokenLive } = require('../lib/erp');
const S = require('../lib/scorer');

const MONTH = 'Jul 2026';
const MONTH_END = '2026-07-31T23:59:59Z';

(async () => {
  assertTokenLive();
  for (const id of [3978, 44770, 65604, 10907, 11964]) {
    const prof = await call('GET', '/staffmgmt/housemaid/getHousemaidInfo/' + id, 'HousemaidDetails'); await sleep();
    const rule = await call('GET', '/payroll/salaryrules/getruleofhousemaid/' + id, 'HousemaidsPayrollList'); await sleep();
    const hist = await call('GET', '/payroll/HousemaidPayroll/' + id + '/getHistoryLog?monthsCount=18', 'HousemaidsPayrollList'); await sleep();
    const docs = await call('GET', '/visa/renewRequest/housemaidProfile/documents/' + id, 'HousemaidDocuments'); await sleep();

    const p = prof.body || {};
    const details = Array.isArray(rule.body) ? rule.body : [];
    const ruleTotal = S.sumSalaryRuleComponents(details);
    const raise = S.readRenewalRaise((p.nationality || {}).tags) || 0;
    const rens = S.countQualifyingRenewals(Array.isArray(docs.body) ? docs.body : [], MONTH_END);
    const paidRead = S.readPaidForMonth(Array.isArray(hist.body) ? hist.body : [], MONTH);
    const paid = paidRead.paid;

    const ruleName = details.length ? (details[0].salaryRule || {}).label : '(none)';
    const labels = details.map(d => (d.salaryComponent || {}).label);
    const counted = labels.filter(l => String(l).toLowerCase() !== 'accommodationsalary');

    console.log('\n=== maid ' + id + '  nationality=' + ((p.nationality || {}).name || '?') +
                '  live_out=' + p.liveOut);
    console.log('  salary rule           : ' + ruleName);
    console.log('  components            : ' + labels.join(', '));
    console.log('  counted toward base   : ' + counted.join(', ') + '   (accommodation excluded)');
    console.log('  renewal_raise tag     : ' + raise);
    console.log('  qualifying renewals   : ' + rens.count + '  [' + rens.dates.join(', ') + ']');

    if (paid === null || ruleTotal === null) { console.log('  (no payroll row or no rule)'); continue; }

    // Position relative to entitlement under each reading of the cap. Deltas only.
    const lifetime2 = paid - (ruleTotal + raise * Math.min(rens.count, 2));
    const window2yr = paid - (ruleTotal + raise * Math.min(1, rens.count));   // the 2-yr-lookback reading
    const uncapped  = paid - (ruleTotal + raise * rens.count);
    console.log('  position vs entitlement:');
    console.log('    LIFETIME cap of 2 (what the spec RULES) : ' + (lifetime2 > 0 ? '+' : '') + lifetime2);
    console.log('    2-year lookback = 1 renewal (the reading the spec WARNS AGAINST) : ' +
                (window2yr > 0 ? '+' : '') + window2yr);
    console.log('    uncapped (' + rens.count + ' renewals)                : ' + (uncapped > 0 ? '+' : '') + uncapped);
    console.log('  paid equals base + ' + ((paid - ruleTotal) / (raise || 1)) + ' x renewal_raise');
  }
})();
