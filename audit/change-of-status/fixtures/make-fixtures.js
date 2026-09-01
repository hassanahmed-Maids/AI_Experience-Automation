'use strict';
// Generates pinned-data fixtures for offline testing of the n8n flow.
//
// WHY THE ROWS ARE SLIM. Each fixture row carries only the fields the flow
// actually reads - id, date, amount, expense.id, housemaids[0].housemaid.id,
// newRequestExpense.purpose, and description where a case needs it. The FULL
// ERP row shape was already exercised against real payloads by
// scorer/verify-generated.js; repeating 157 fields per row here would add bulk
// and prove nothing new.
//
// WHY 260 POPULATION ROWS. Verify Population Pull refuses a cohort below 250,
// because a real month runs 303-1,040 and a short one is a query bug. That
// floor is NOT lowered to fit a fixture - the fixture is built to clear it,
// which is the right way round.

const P = (id, maid, date, amount, opts) => {
  const o = opts || {};
  const row = {
    id: id,
    date: date,
    amount: amount,
    expense: { id: o.head || 1677 },
    housemaids: o.noMaid ? [] : [{ housemaid: { id: maid } }],
    newRequestExpense: { purpose: o.purpose || 'Change of Status' }
  };
  if (o.description !== undefined) row.description = o.description;
  return row;
};

// ---- the population: July 2026 -------------------------------------------
const population = [];
let id = 900000, maid = 700000;

// 250 ordinary rows at exactly the era base -> clean, "One application, one price"
for (let i = 0; i < 250; i++) population.push(P(++id, ++maid, '2026-07-' + String((i % 28) + 1).padStart(2, '0'), 575.65));

// 4 fine-bearing rows -> pending, capped (fines record refused)
const FINE_IDS = [];
for (let i = 0; i < 4; i++) { const t = ++id; FINE_IDS.push(t); population.push(P(t, ++maid, '2026-07-10', 575.65 + 50 * (i + 1))); }

// 1 duplicate: 80 days after a prior charge -> finding, "Duplicate application"
const DUP_MAID = ++maid, DUP_TXN = ++id, DUP_PRIOR = ++id;
population.push(P(DUP_TXN, DUP_MAID, '2026-07-20', 575.65));

// 1 out-of-window repeat: 140 days -> pending, NO verdict word (request grain refused)
const OOW_MAID = ++maid, OOW_TXN = ++id, OOW_PRIOR = ++id;
population.push(P(OOW_TXN, OOW_MAID, '2026-07-15', 575.65));

// 1 misfiled product -> pending, "Misfiled charge" (purity gate, Order 25)
const MISFILED_TXN = ++id;
population.push(P(MISFILED_TXN, ++maid, '2026-07-09', 1054.71, { purpose: 'Entry Visa' }));

// 1 row with no maid id -> inconclusive, "Identity unresolved"
const NOMAID_TXN = ++id;
population.push(P(NOMAID_TXN, null, '2026-07-11', 575.65, { noMaid: true }));

// 1 negative amount -> pending, "Negative amount"
const NEG_TXN = ++id;
population.push(P(NEG_TXN, ++maid, '2026-07-12', -3078));

// 1 unreadable amount -> pending, NO verdict word
const NULLAMT_TXN = ++id;
population.push(P(NULLAMT_TXN, ++maid, '2026-07-13', null));

// ---- the trailing history: the population plus the two priors --------------
const history = population.slice();
history.push(P(DUP_PRIOR, DUP_MAID, '2026-05-01', 575.65));   // 80 days before 2026-07-20
history.push(P(OOW_PRIOR, OOW_MAID, '2026-02-25', 575.65));   // 140 days before 2026-07-15

// A SLIM-HISTORY variant, for feeding the n8n pinned test without an 87 KB
// payload. It drops the 250 filler rows from history and keeps only the rows a
// verdict actually depends on, plus the two priors.
//
// WHAT THIS CHANGES AND WHAT IT DOES NOT. Verdicts are identical - a filler row
// absent from history gets duplicate_band 'not found in history' instead of
// 'first charge on this maid', and stays clean either way. The realistic shape,
// where history contains the whole population, IS exercised - by the local
// scorer against the full fixture above. This variant exists to test the n8n
// WIRING, and the wiring cannot tell the two apart.
const interesting = population.slice(250);
const slimHistory = interesting.concat([
  P(DUP_PRIOR, DUP_MAID, '2026-05-01', 575.65),
  P(OOW_PRIOR, OOW_MAID, '2026-02-25', 575.65)
]);

const page = (rows, total) => ({ content: rows, totalElements: total, size: 40, numberOfElements: rows.length });
const full = (body) => ({ statusCode: 200, headers: {}, body: body });

const out = {
  expected: {
    population_rows: population.length,
    history_rows: history.length,
    clean: 250,
    pending: 4 /*fine*/ + 1 /*out-of-window*/ + 1 /*misfiled*/ + 1 /*negative*/ + 1 /*null amount*/,
    finding: 1,
    inconclusive: 1,
    needing_a_verdict_word: 4 /*fine*/ + 1 /*out-of-window*/ + 1 /*null amount*/
  },
  pinData: {
    'Manual Trigger': [{ json: { params: { erp_auth: { bearer: 'Bearer offline-pinned-fixture' }, history_days: 120 } } }],
    'Preflight Count Population': [{ json: full({ totalElements: population.length, content: [] }) }],
    'Preflight Count History': [{ json: full({ totalElements: history.length, content: [] }) }],
    'Get Population': [{ json: page(population, population.length) }],
    'Get Trailing History': [{ json: page(history, history.length) }],
    'Cases -> Workbook': [{ json: { updates: { updatedRows: population.length } } }],
    'Run -> Workbook': [{ json: { updates: { updatedRows: 1 } } }],
    'Draft: cases to review': [{ json: { id: 'draft-pinned', message: { id: 'm', threadId: 't', labelIds: ['DRAFT'] } } }],
    'Draft: audit failed': [{ json: { id: 'draft-pinned-fail', message: { id: 'm', threadId: 't', labelIds: ['DRAFT'] } } }]
  }
};
out.pinDataSlimHistory = Object.assign({}, out.pinData, {
  'Get Trailing History': [{ json: page(slimHistory, slimHistory.length) }]
});
out.expected.slim_history_rows = slimHistory.length;
process.stdout.write(JSON.stringify(out));
