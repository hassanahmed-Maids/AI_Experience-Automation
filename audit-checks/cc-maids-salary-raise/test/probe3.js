'use strict';
/**
 * Phase 2, round three. Confirms the payload shape on the pagecode that ACTUALLY works,
 * pins monthsCount's real behaviour, and finds the accepted population status filter.
 * Credentials come from .env via lib/erp.js. Reports key paths, types and counts only.
 */
const { call, sleep, assertTokenLive } = require('../lib/erp');
const M = 3978;

(async () => {
  const t = assertTokenLive();
  console.log('token: user claim present=' + Boolean(t.user) + ', exp ' + t.exp + '\n');

  console.log('### A. getHistoryLog under the WORKING pagecode - real field shape');
  const h = await call('GET', '/payroll/HousemaidPayroll/' + M + '/getHistoryLog?monthsCount=12', 'HousemaidsPayrollList');
  console.log('  status ' + h.status + '  envelope: ' +
    (Array.isArray(h.body) ? 'bare array[' + h.body.length + ']' : 'object{' + Object.keys(h.body || {}).join(',') + '}'));
  const rows = Array.isArray(h.body) ? h.body : ((h.body || {}).content || []);
  if (rows.length) {
    console.log('  row keys: ' + Object.keys(rows[0]).join(', '));
    for (const k of ['formattedPayrollMonth', 'basicSalary', 'companySalary', 'netSalary', 'totalAddition', 'totalDeduction']) {
      const present = Object.prototype.hasOwnProperty.call(rows[0], k);
      console.log('    ' + k.padEnd(24) + ' present=' + present + (present ? '  type=' + typeof rows[0][k] : ''));
    }
    console.log('  months returned: ' + rows.map(r => r.formattedPayrollMonth).join(' '));
    const eq = rows.filter(r => r.basicSalary === r.companySalary).length;
    console.log('  basicSalary===companySalary on ' + eq + ' of ' + rows.length + ' rows');
  }
  await sleep();

  console.log('\n### B. monthsCount really counts backwards from today?');
  const h1 = await call('GET', '/payroll/HousemaidPayroll/' + M + '/getHistoryLog?monthsCount=1', 'HousemaidsPayrollList');
  const r1 = Array.isArray(h1.body) ? h1.body : [];
  console.log('  monthsCount=1        -> ' + r1.length + ' row(s): ' + r1.map(r => r.formattedPayrollMonth).join(' '));
  await sleep();
  const h0 = await call('GET', '/payroll/HousemaidPayroll/' + M + '/getHistoryLog', 'HousemaidsPayrollList');
  const r0 = Array.isArray(h0.body) ? h0.body : [];
  console.log('  monthsCount omitted  -> ' + r0.length + ' row(s): ' + r0.map(r => r.formattedPayrollMonth).join(' '));
  await sleep();

  console.log('\n### C. The population status filter - find the accepted key');
  const cands = [
    { maidPayrollTypes: ['MAID_CC'], statuses: ['WITH_CLIENT'] },
    { maidPayrollTypes: ['MAID_CC'], housemaidStatus: ['WITH_CLIENT'] },
    { maidPayrollTypes: ['MAID_CC'], status: 'WITH_CLIENT' },
    { maidPayrollTypes: ['MAID_CC'], housemaidStatuses: ['WITH_CLIENT'] },
    { maidPayrollTypes: ['MAID_CC'], maidStatus: ['WITH_CLIENT'] }
  ];
  for (const b of cands) {
    const k = Object.keys(b).filter(x => x !== 'maidPayrollTypes')[0];
    const r = await call('POST', '/payroll/HousemaidPayroll/filterHousemaids?page=0&size=40', 'HousemaidsPayrollList', b);
    console.log('  ' + (k + '=' + JSON.stringify(b[k])).padEnd(40) + ' -> ' + r.status +
      '  total=' + ((r.body || {}).totalElements !== undefined ? r.body.totalElements : '-') +
      (r.status >= 400 ? '  ' + String(r.raw).slice(0, 110) : ''));
    await sleep();
  }

  console.log('\n### D. raiseApproved - other pagecodes (corroboration only, never a clearance)');
  for (const pc of ['VisaProcessingPage', 'HousemaidDocuments', 'HousemaidDetails', 'HousemaidsPayrollList']) {
    const r = await call('GET', '/visa/renewRequest/housemaid/' + M, pc);
    console.log('  ' + pc.padEnd(28) + ' -> ' + r.status + '  ' + (r.dm || ''));
    await sleep();
  }
})();
