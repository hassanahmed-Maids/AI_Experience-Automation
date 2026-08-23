// ERP-COMPLIANCE: no-breaker-because this sweep's breaker is the GROUP boundary, not this node.
//
// This node is the projection node for Fetch Population Page, so section 5 would normally want
// the generated block from tools/erp_breaker.js right here. It is deliberately not here, and the
// reason is that the alternative is WEAKER rather than merely different:
//
//   - The generated breaker judges ONE BATCH and trips on 5 consecutive failures. This sweep
//     runs in groups of 20 pages and the IF node below (Group Healthy?) aborts on the FIRST
//     failing page of a group. One failure beats five, so the bespoke stop is strictly earlier.
//   - The latency detector CANNOT FIRE here. It needs a ~200-call baseline before it will judge
//     anything, and the whole sweep is ~136 pages for the larger cohort. It would never arm, so
//     installing it would add a threshold that reads as coverage and provides none.
//   - What stops the run instead: Group Healthy? false -> Circuit Breaker Tripped, which returns
//     aborted with NO rows, and Stage 1's Reconcile Union And Chunk throws on aborted. A partial
//     population is never scored.
//
// WHAT IS STILL MISSING, recorded rather than papered over: there is no LATENCY signal. An ERP
// that is answering 200 but dying slowly will not trip anything here. Same gap as Stage 2's
// Chunk Summary. Logged in compliance/mv-monthly-payment.md.
//
// Projects to a SLIM shape immediately so the parent never retains raw contract rows.
// A full sweep is ~45k rows across both cohorts; the raw form is tens of MB.
const specs = $('Fan Out Group Pages').all().map(function (i) { return i.json; });
const res = $input.all().map(function (i) { return i.json; });

const bad = [];
const rows = [];
let observedTotal = null;

for (let i = 0; i < specs.length; i++) {
  const s = specs[i];
  const r = res[i] || {};
  if (r.statusCode !== 200) {
    bad.push({ page: s.page, size: s.size, status: r.statusCode === undefined ? null : r.statusCode });
    continue;
  }
  const body = r.body || {};
  if (observedTotal === null && typeof body.total === 'number') observedTotal = body.total;
  const content = ((body.clients || {}).content) || [];
  for (const row of content) {
    if (!row || row.id === undefined) continue;
    const cl = row.client || {};
    rows.push({
      contractId: row.id,
      clientId: cl.id,
      vip: cl.vip === true,
      vVip: cl.vVip === true,
      startOfContract: row.startOfContract || null,
      dateOfTermination: row.dateOfTermination || null,
      scheduledDateOfTermination: row.scheduledDateOfTermination || null,
      status: row.status || null,
    });
  }
}

return [{ json: {
  groupIndex: specs.length ? specs[0].groupIndex : -1,
  rows: rows,
  pagesRequested: specs.length,
  pagesFailed: bad.length,
  failures: bad.slice(0, 5),
  observedTotal: observedTotal,
  healthy: bad.length === 0,
} }];
