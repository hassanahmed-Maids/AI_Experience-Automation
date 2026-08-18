// Project CC Payments (WF-P) - keep the CC rows, count the MV rows that were dropped,
// and let this execution die with the raw pull.
//
// THE ENVELOPE SHAPE IS DELIBERATELY IDENTICAL to what the HTTP node used to emit:
// { payments: [...] }. WF-A's Verify Bulk Pulls and Attach Month Payments both reach for
// Get Month Payments / Get Payments (M-1) / Get Payments (M-2) BY NODE NAME and read
// page.json.payments, so returning the same key under the same node names means neither
// needed rewriting. The caller nodes in WF-A keep those names for the same reason.
//
// EVERY FIELD IS KEPT, and that is not laziness. Measured on the live July pull: the DTO
// has exactly seven fields and Attach Month Payments reads all seven - contractType (its
// CC test), paymentDate (bucketing; NEVER paymentReceivedDate, which is not on this DTO),
// contractID, paymentId (de-duplication against the status sweep), paymentAmount,
// paymentMethod, paymentType (the monthly/other/refund split that the whole check rests
// on). Dropping any of them would break a gate. So the row shape passes through unchanged
// and the ONLY reduction is the row count.
//
// THE CC FILTER IS THE WHOLE SAVING: 6,774 of 33,213 July rows are CC. The 26,439 MV rows
// are discarded by Attach Month Payments on its first line regardless - dropping them HERE
// means WF-A never retains them. 6.06 MB -> 1.28 MB per window; ~18.2 MB -> ~3.8 MB across
// the three.
//
// FILTERING HERE DOES NOT WEAKEN GATE 2. The gate's job is to prove the window was really
// swept, and a CC count cannot do that - a genuine CC-quiet month and a failed call both
// read as few rows. So the RAW count crosses the boundary as _raw_rows and gate 2 tests
// that instead, which is a stronger check than the old payments.length > 0: it now knows
// the difference between "the sweep returned nothing" and "the sweep worked and CC was
// quiet", where before it could only see the sum.
const items = $input.all();

// CC vs MV is decided on contractType, and the test is startsWith('CC') to match Attach
// Month Payments EXACTLY. Live values are 'CC Maid', 'CC Maid - Sponsored', 'MV Maid', ...
// A contains-style test would fold MV rows in; a whole-string equality test would drop the
// sponsored variants. Never loosen this without changing both sides together.
function isCC(v) { return String(v === null || v === undefined ? '' : v).indexOf('CC') === 0; }

let rows = [];
let rawRows = 0, droppedMV = 0, missingType = 0;
const typeCounts = {};

for (const it of items) {
  const b = it.json || {};
  const body = b.body !== undefined ? b.body : b;
  if (!Array.isArray(body.payments)) {
    // An ERP error body must never read as an empty sweep - that is the one failure mode
    // that scores the whole book as short. Refuse it here, where the raw response is still
    // visible, rather than passing an empty projection to a gate that cannot tell.
    if (body.status || body.message || body.error || body.path) {
      throw new Error('WF-P: getReceivedClientsPayments returned an error body instead of rows - ' +
        'status=' + (body.status || '?') + ' message=' +
        String(body.message || body.error || '?').slice(0, 200) + '. A bare 403 with no ERP JSON ' +
        'means the /accounting/ prefix is missing from the URL: the load balancer answers before ' +
        'ERP does and it reads exactly like an account ban.');
    }
    throw new Error('WF-P: the response had no payments array. keys=' + Object.keys(body).join(','));
  }
  for (const r of body.payments) {
    rawRows++;
    const ct = r.contractType;
    if (ct === null || ct === undefined || ct === '') missingType++;
    if (!isCC(ct)) { droppedMV++; continue; }
    const t = String(r.paymentType === null || r.paymentType === undefined ? '' : r.paymentType);
    typeCounts[t] = (typeCounts[t] || 0) + 1;
    rows.push({
      contractID: r.contractID,
      contractType: r.contractType,
      paymentId: r.paymentId,
      paymentAmount: r.paymentAmount,
      paymentDate: r.paymentDate,
      paymentMethod: r.paymentMethod,
      paymentType: r.paymentType
    });
  }
}

// A row with NO contractType is neither CC nor MV, and it is silently dropped by the
// filter above. That is the right handling - an untyped row cannot be attributed to a
// population - but it must be visible, because a shape change that empties the field
// would otherwise present as a perfectly clean run with an empty cohort.
if (missingType > 0 && missingType === rawRows) {
  throw new Error('WF-P: every one of ' + rawRows + ' rows had an empty contractType, so the CC ' +
    'filter dropped the entire sweep. That is a shape change on the route, not a quiet month - ' +
    'the live DTO carries contractType on 100% of rows (measured 33,213/33,213 on 2026-07).');
}
if (rawRows === 0) {
  throw new Error('WF-P: the sweep returned ZERO rows for ' +
    $('Read Payment Window').first().json.from + ' .. ' + $('Read Payment Window').first().json.to +
    '. A real month carries tens of thousands (33,213 in July 2026), so treat this as a wrong ' +
    'window or a failed call, never as a quiet month.');
}

console.log(JSON.stringify({ stage: 'wfp_project_cc_payments',
  month_key: $('Read Payment Window').first().json.month_key,
  raw_rows: rawRows, cc_rows: rows.length, dropped_non_cc: droppedMV,
  rows_missing_contract_type: missingType,
  cc_share_pct: rawRows ? Math.round((1000 * rows.length) / rawRows) / 10 : null,
  distinct_payment_types: Object.keys(typeCounts).length,
  note: 'row shape passes through unchanged - all seven fields are read downstream. The saving ' +
        'is the CC filter, and the MV rows die with this execution, which is the entire point.' }));

return [{ json: {
  payments: rows,
  // Provenance and the numbers gate 2 now reconciles against. _raw_rows is what proves
  // the window was swept; payments.length alone cannot.
  _projected_by: 'CC Below Agreed - 0-Sweep Payments',
  _raw_rows: rawRows,
  _cc_rows: rows.length,
  _dropped_non_cc: droppedMV,
  _rows_missing_contract_type: missingType,
  _month_key: $('Read Payment Window').first().json.month_key,
  _from: $('Read Payment Window').first().json.from,
  _to: $('Read Payment Window').first().json.to
} }];
