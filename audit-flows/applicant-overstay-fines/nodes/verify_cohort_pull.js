// Verify Cohort Pull — runOnceForAllItems.
//
// THIS NODE OWNS THE POPULATION PROOF.  Every downstream consumer reads it from
// here by name — `$('Verify Cohort Pull').first().json.population` — and never
// from whatever survived three transforms.  On the MV build the proof arrived at
// `Build Run Row` as `{}` because an intermediate node dropped it, so every run
// wrote `population_complete: false` and stamped itself untrustworthy.
//
// Three separate obligations, none of which is the others:
//   (a) PAGINATION.  Summed content.length must equal totalElements.  Measured
//       live 2026-08-12 across nine months (963 rows): complete every month.
//   (b) EMPTY ABORTS.  An empty result is never "no findings".  A month with zero
//       CC change-of-status transactions is a broken query — the cohort row's own
//       Default Value says so.
//   (c) NO FOREIGN EXPENSE.  expense.id 1589 only.  The MV expense is 1677; the
//       names differ by three characters and the codes by one digit, and reading
//       the wrong one audits an entirely different population while every gate
//       still passes and the walk still terminates cleanly.
//
// ERP-COMPLIANCE: no-breaker-because this node reads a PAGINATED SWEEP, not a per-entity batch.
// ERP-LOAD-POLICY.md §5 wants the breaker wherever a batch of ERP responses is read, and none of
// its three thresholds can do useful work on this one:
//   * consecutive_failures needs five responses in a row. The pager stops at the FIRST failing
//     page — `Get CC Change of Status Transactions` is on continueErrorOutput, so page N's
//     failure ends the walk and goes straight to the error rail. There can never be a second
//     failure to count, let alone a fifth. The walk aborting sooner than a breaker reading the
//     finished batch is not a gap; it is a stricter rule.
//   * degraded_rate needs >= 20 responses. Measured 2026-08-12, nine months of cohort is 963
//     rows at size=200 — five pages. A window would have to cover roughly thirty years to
//     produce twenty of them, and `maxRequests` caps the walk at fifty pages anyway.
//   * latency needs an earlier batch of the same key in the same run. There is exactly one
//     cohort walk per run.
// What stops the run instead: the three throws below (empty cohort, truncated walk, foreign
// expense id), the pager's own `maxRequests: 50`, and the error rail, which releases the ERP
// lease and re-throws at `Fail Loudly`.

const pages = $input.all();
const EXPENSE_ID = 1589;

let rows = [];
let reported = null;
for (const p of pages) {
  const b = p.json && p.json.body !== undefined ? p.json.body : p.json;
  const content = (b && b.content) || [];
  if (!Array.isArray(content)) {
    throw new Error('Cohort page did not carry a content array — the response shape changed.');
  }
  rows = rows.concat(content);
  if (reported === null && b && typeof b.totalElements === 'number') reported = b.totalElements;
}

// (b) EMPTY ABORTS — before anything else, so an empty month cannot be reported clean.
if (rows.length === 0) {
  throw new Error(
    'CC change-of-status cohort returned ZERO transactions for the window. ' +
    'An empty result is a broken query, never "no findings" — the run is aborted.'
  );
}

// (a) PAGINATION
const complete = (reported === null) ? false : (rows.length === reported);
if (!complete) {
  throw new Error(
    'Cohort walk incomplete: pulled ' + rows.length + ' rows but the envelope reports ' +
    reported + ' totalElements. Never audit a truncated population.'
  );
}

// (c) NO FOREIGN EXPENSE
const foreign = Array.from(new Set(
  rows.map((r) => (r.expense || {}).id).filter((id) => id !== EXPENSE_ID)
));
if (foreign.length) {
  throw new Error('Foreign expense ids in the cohort: ' + JSON.stringify(foreign) +
                  '. Only 1589 belongs to this check.');
}

const cohort_rows = rows.map((r) => ({
  txn_id: String(r.id),
  txn_amount: typeof r.amount === 'number' ? r.amount : null,
  txn_date: r.date || '',
  vat_amount: r.vatAmount,
  expense_id: (r.expense || {}).id
  // `description` is deliberately NOT carried forward.  It contains the maid's
  // name and must never be able to resolve an identity (gate 3).
}));

return [{
  json: {
    population: {
      cohort_count: cohort_rows.length,
      total_elements_reported: reported,
      pages_fetched: pages.length,
      population_complete: complete,
      foreign_expense_ids: foreign,
      expense_id: EXPENSE_ID
    },
    cohort_rows
  },
  pairedItem: { item: 0 }
}];
