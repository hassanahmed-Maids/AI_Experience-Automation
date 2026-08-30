'use strict';
/**
 * Why does maid 3978 come out with 2 qualifying renewals when the spec implies 1?
 * Prints renew-request flags, statuses and attachment tags/dates only. No amounts.
 */
const { call, sleep, assertTokenLive } = require('../lib/erp');
const S = require('../lib/scorer');

(async () => {
  assertTokenLive();
  for (const id of [3978, 44770, 11964]) {
    const r = await call('GET', '/visa/renewRequest/housemaidProfile/documents/' + id, 'HousemaidDocuments');
    const reqs = Array.isArray(r.body) ? r.body : [];
    console.log('\n=== maid ' + id + ' — ' + reqs.length + ' renew request(s)');
    reqs.forEach((q, i) => {
      const rv = (q.attachments || []).filter(a =>
        S.RVISA_TAGS.indexOf(String(a.tag || '').trim().toLowerCase()) !== -1);
      console.log('  [' + i + '] type=' + q.type + '  completed=' + q.completed +
                  '  stopped=' + q.stopped + '  status=' + q.status);
      console.log('       created=' + String(q.creationDate || '').slice(0, 10) +
                  '  rVisaExpiry=' + String(q.rVisaExpiryDate || '').slice(0, 10) +
                  '  renewedLaborCardExpiry=' + String(q.renewedLaborCardExpiryDate || '').slice(0, 10));
      console.log('       attachments=' + (q.attachments || []).length +
                  '  r-visa tagged=' + rv.length +
                  (rv.length ? '  [' + rv.map(a => a.tag + '@' + String(a.creationDate || '').slice(0, 10)).join(', ') + ']' : ''));
      const allTags = (q.attachments || []).map(a => a.tag).filter(Boolean);
      console.log('       all tags: ' + (allTags.length ? allTags.join(', ') : '(none)'));
    });
    const counted = S.countQualifyingRenewals(reqs, '2026-07-31T23:59:59Z');
    console.log('  -> scorer counts ' + counted.count + ' qualifying: ' + counted.dates.join(', '));
    const completedOnly = S.countQualifyingRenewals(reqs.filter(q => q.completed === true), '2026-07-31T23:59:59Z');
    console.log('  -> COMPLETED-only would count ' + completedOnly.count + ': ' + completedOnly.dates.join(', '));
    await sleep();
  }
})();
