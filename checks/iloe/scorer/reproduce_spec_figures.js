'use strict';

/**
 * Independent reproduction of the two figures the ILOE spec verified by hand
 * on 2026-08-20. If the scorer's netting logic is right, it must turn the same
 * 8 count-based candidate maids into the same 3 real duplicates, and produce
 * the same AED 378 of excess.
 *
 * Rows are the ones the spec records verbatim in gate 9 and gate 12.
 */

const S = require('./iloe_scorer');

const SUB_MV_NEW = 'NEW - MV Housemaids - ILOE Subscription';
const FINES_MV_NEW = 'NEW - MV Housemaids - ILOE Fines';

function p(txn, maid, date, name, amount) {
  return { txn_id: txn, maid_id: maid, date: date, expense_name: name, amount: amount,
           amount_cents: S.toCents(amount) };
}

// The 8 maids a raw payment count flags as "more than one payment".
const candidates = {
  // --- the three real duplicates (gate 9, read row by row) ---
  132336: [p(1970166, 132336, '2026-06-15', SUB_MV_NEW, 126.0),
           p(1970167, 132336, '2026-06-15', SUB_MV_NEW, 126.0)],
  132405: [p(1925059, 132405, '2026-05-27', SUB_MV_NEW, 126.0),
           p(1925060, 132405, '2026-05-27', SUB_MV_NEW, 126.0)],
  132888: [p(1970254, 132888, '2026-06-15', SUB_MV_NEW, 126.0),
           p(1970257, 132888, '2026-06-15', SUB_MV_NEW, 126.0)],
  // --- the five that net away (gate 12) ---
  10925:  [p(1, 10925, '2026-06-08', SUB_MV_NEW, 126.0),
           p(2, 10925, '2026-06-08', SUB_MV_NEW, 126.0),
           p(3, 10925, '2026-06-08', SUB_MV_NEW, -126.0)],
  132363: [p(4, 132363, '2026-06-20', SUB_MV_NEW, 126.0),
           p(5, 132363, '2026-06-20', SUB_MV_NEW, 126.0),
           p(6, 132363, '2026-06-20', SUB_MV_NEW, -126.0)],
  134727: [p(7, 134727, '2026-07-18', SUB_MV_NEW, 126.0),
           p(8, 134727, '2026-07-18', SUB_MV_NEW, 126.0),
           p(9, 134727, '2026-07-18', SUB_MV_NEW, -126.0)],
  127281: [p(10, 127281, '2026-04-03', FINES_MV_NEW, 402.86),
           p(11, 127281, '2026-04-03', FINES_MV_NEW, 0)],
  132396: [p(1920424, 132396, '2026-05-21', SUB_MV_NEW, 126.0),
           p(2028002, 132396, '2026-07-11', SUB_MV_NEW, -126.0)],
};

const TOL = S.TOL_CENTS;
const ids = Object.keys(candidates);

let realDuplicates = 0;
let totalExcessCents = 0;
const realIds = [];
const nettedAway = [];

for (let i = 0; i < ids.length; i++) {
  const id = ids[i];
  const g = S.netGroup(candidates[id]);
  const isDup = g.txn_count > 1 && g.net_cents > g.unit_cents + TOL;
  if (isDup) {
    realDuplicates += 1;
    realIds.push(id);
    totalExcessCents += g.net_cents - g.unit_cents;
  } else {
    nettedAway.push(id + ' (net ' + (g.net_cents / 100) + ', unit ' + (g.unit_cents / 100) + ')');
  }
}

const excessAed = totalExcessCents / 100;

console.log('ILOE scorer — reproduction of the spec\'s verified figures');
console.log('=========================================================');
console.log('candidate maids by raw payment count : ' + ids.length + '   (spec says 8)');
console.log('real duplicates after netting        : ' + realDuplicates + '   (spec says 3)');
console.log('maids                                : ' + realIds.join(', ') + '   (spec says 132336, 132405, 132888)');
console.log('total net excess                     : AED ' + excessAed + '   (spec says AED 378)');
console.log('');
console.log('netted away:');
for (let i = 0; i < nettedAway.length; i++) console.log('  - ' + nettedAway[i]);
console.log('');

const ok =
  ids.length === 8 &&
  realDuplicates === 3 &&
  excessAed === 378 &&
  realIds.indexOf('132336') !== -1 &&
  realIds.indexOf('132405') !== -1 &&
  realIds.indexOf('132888') !== -1;

console.log(ok ? 'REPRODUCED — matches the spec on every figure.'
                : 'MISMATCH — the scorer does not reproduce the spec.');
if (!ok) process.exitCode = 1;
