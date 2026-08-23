// Verify Cohort Pull — MV Overstay Fines (v1)
//
// Adapted from the golden's `Verify Bulk Pulls`: same job, one pull instead of
// three. Sits immediately after the cohort request so nothing downstream can
// score a cohort built on a failed or partial ERP fetch.
//
// Three separate obligations, and they are NOT the same check:
//   1. PAGINATION — every page collected, content.length summed == totalElements.
//   2. POPULATION — the count measured against the magnitude the check declares.
//      The Skeleton Contract is explicit that (1) does not prove (2): totalElements
//      comes from the same query, so it can only confirm the filter agrees with
//      itself, and it will happily certify a flawless walk of the wrong set.
//   3. EMPTY IS NOT CLEAN — `change_of_status_transaction` Default Value: an empty
//      result ABORTS the run. A month with zero change-of-status transactions is a
//      broken query, not a clean month.
//
// ERP-COMPLIANCE: no-breaker-because this node reads a PAGINATED SWEEP, not a
// per-entity fan-out, and the walk already stops itself sooner and harder than a
// breaker reading the finished batch could. Taking the three §5 thresholds in turn:
// consecutive_failures and degraded_rate cannot be evaluated on a batch this small
// (January, the largest month measured, is 811 rows = 5 pages at size=200, and the
// rate rule needs 20 responses before it will speak at all); latency cannot fire
// because there is exactly one sweep per run, so there is no earlier batch of the
// same key to baseline against, and no node in this flow stamps erp_t0. What stops
// the run instead is stronger than any of them: the assertions below THROW on an
// ERP error body, on a missing content array, on a walk that does not reconcile to
// totalElements, on an empty cohort and on a cohort under the declared floor of
// 100. A single failed page therefore ends the run here, before the per-entity
// phase that a breaker exists to protect has made one call. The per-entity fan-outs
// each carry a real breaker of their own: Judge Detail Batch, Judge Fines Batch,
// Judge Payments Batch, Judge Complaints Batch, Judge Threads Batch.
const EXPENSE_ID = 1677;
const PAGE_SIZE = 200;

// Expected cohort magnitude, from the population row's Example Values, MEASURED
// live 2026-08-12: August 2026 totalElements 151 (8 pages at size=20), January
// 811, March 664. The floor is a tripwire on the smallest month observed.
//
// THE FLOOR IS NEVER LOWERED TO MATCH AN OBSERVED RUN. A cohort under it is a
// cohort bug until proven otherwise, with evidence from a source other than the
// query that produced it. Recalibrating this number to whatever a run returned
// does not fix the check; it permanently and silently blesses the defect the
// tripwire exists to catch.
const COHORT_FLOOR = 100;

const pages = $input.all().map(function (i) { return i.json; });

if (pages.length === 0) {
  throw new Error('Get Change of Status Transactions produced no response at all — ' +
    'refusing to report an empty audit as success.');
}

let collected = 0;
let totalElements = null;
const rows = [];

for (const p of pages) {
  const looksLikeError = p && !Array.isArray(p.content) && (p.status || p.message || p.error || p.path);
  if (looksLikeError) {
    throw new Error('Cohort request returned an ERP error body instead of transactions: status=' +
      (p.status || '?') + ' message=' + (p.message || p.error || '?') + ' path=' + (p.path || '?') +
      ' — refusing to score an empty cohort. A 401 here is a wrong pagecode or an expired ' +
      'token, NEVER "no data": pagecode ManageTransactions is load-bearing and a wrong one ' +
      '401s silently (measured 2026-08-12 on this check\'s own endpoints).');
  }
  if (!p || !Array.isArray(p.content)) {
    throw new Error('Cohort response has no `content` array — shape changed? keys=' +
      Object.keys(p || {}).join(','));
  }
  collected += p.content.length;
  if (totalElements === null && p.totalElements !== undefined) totalElements = Number(p.totalElements);
  for (const r of p.content) rows.push(r);
}

if (totalElements === null) {
  // Skeleton Contract: a sweep with no reconcilable total is DECLARED
  // unreconciled, never quietly accepted.
  throw new Error('Cohort response carried no top-level totalElements — the walk cannot be ' +
    'reconciled. Declaring the sweep unreconciled rather than accepting it.');
}

if (collected !== totalElements) {
  throw new Error('Cohort walk incomplete: collected ' + collected + ' rows but totalElements is ' +
    totalElements + ' (' + pages.length + ' page(s) at size=' + PAGE_SIZE + '). Refusing to score a ' +
    'partial cohort — a short walk passes in silence and audits a fraction of the population.');
}

if (collected === 0) {
  throw new Error('Cohort is EMPTY for this window. Aborting the run. An empty result is never ' +
    '"no findings": a month with zero change-of-status transactions is a broken query, not a ' +
    'clean month (change_of_status_transaction Default Value).');
}

if (collected < COHORT_FLOOR) {
  throw new Error('Cohort of ' + collected + ' rows is below the declared floor of ' + COHORT_FLOOR +
    '. Measured magnitudes: Aug 2026 = 151, Jan = 811, Mar = 664. Aborting. Do NOT lower this ' +
    'floor to match the run — prove the population from a source other than this query first.');
}

// gate 1 evidence for the run row: the filter must not have over-matched. All 151
// August rows carried expense.id 1677 and nothing else when measured.
const expenseIds = [];
for (const r of rows) {
  const id = (r.expense || {}).id;
  if (expenseIds.indexOf(id) === -1) expenseIds.push(id);
}
const foreign = expenseIds.filter(function (id) { return Number(id) !== EXPENSE_ID; });
if (foreign.length) {
  throw new Error('Cohort contains expense ids other than ' + EXPENSE_ID + ': ' + foreign.join(',') +
    '. The expense filter over-matched — refusing to score fines against a base that was never ' +
    'established for those expenses.');
}

return [{
  json: {
    cohort_rows: rows,
    cohort_count: collected,
    total_elements: totalElements,
    pages_fetched: pages.length,
    page_size: PAGE_SIZE,
    cohort_floor: COHORT_FLOOR,
    population_complete: true,
    distinct_expense_ids: expenseIds
  }
}];
