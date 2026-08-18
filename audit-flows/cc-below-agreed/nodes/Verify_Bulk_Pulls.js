// Verify Bulk Pulls - GATE 2 (Order 20). Absent evidence halts the run; it never
// satisfies a comparison.
//
// FIVE SWEEPS, AND NOT ONE OF THEM CAN BE CHECKED THE SAME WAY:
//   Get CC Contract Population   RECONCILABLE since 2026-08-18. Moved to
//                                contract/search/page, which declares a top-level
//                                `total`, so rows-collected is now checked against a
//                                server-declared number - plus the short-page
//                                terminator and the independent floor. (The dynamic
//                                route it replaced returned a bare array with no
//                                envelope at all, and is access-denied on this
//                                account regardless.)
//   Get Month Payments / M-1 / M-2   no paging envelope; one call each. "Zero rows"
//                                is the failure to catch: it is not "nobody paid".
//   Get Payment Statuses         RECONCILABLE, corrected 2026-08-18. This gate used
//                                to say it has "no top-level total" and that
//                                "totalElements caps at 40". Measured live: 43,727
//                                totalElements over 1,094 totalPages, both CONSTANT
//                                across pages, `last` correctly false-then-true, and
//                                an over-range page returns 0 rows. Nothing caps at 40
//                                but the page size.
//
// This gate is STATUS: PENDING TECHNICAL on the rule row, and what it is pending on
// has NARROWED - worth restating rather than leaving the old reason standing. Both
// PAGED sweeps now reconcile against a server-declared total. What remains
// unreconcilable is the three BULK payment sweeps, which return no envelope of any
// kind: for those, "zero rows" is the only detectable failure and a partial response
// is still invisible. That is the residue Hassan's sign-off now covers, not the
// population read. It still fails CLOSED.
//
// WHY IT MATTERS MORE THAN IT LOOKS: a short population is a FALSE GREEN BY
// OMISSION. A contract missing from the cohort is never audited, and no later gate
// can notice. The sibling check's predecessor died exactly here - its guard read
// `(b.total != null) ? b.total : b.totalElements`, ERP returned total:"", `"" != null`
// is true so it never fell through, `Number("")` is 0, and the test became
// `24000 < 0`. Inert. It truncated to 24,000 of 29,772 rows, dropped the oldest
// (the 1st of the month, where most monthly payments sit) and reported success.
const validated = $('Validate Inputs').first().json;
const params = validated.params || {};
const WINDOWS = validated.persistence_windows || [];

// Measured 2026-08-12/13: the dynamic population route returns 5,202 contracts in
// 54 calls and reconciles against an independent total of 5,200 at +2. The floor is
// 4,600 and IT IS NEVER LOWERED TO MATCH A RUN - lowering it was proposed once
// during the sibling's incident and would have permanently blessed a cohort missing
// 80% of the book. The caller may raise it; it may not lower it.
const POPULATION_FLOOR_MIN = 4600;
const callerFloor = Number(params.population_floor);
const POPULATION_FLOOR = Number.isFinite(callerFloor) && callerFloor > POPULATION_FLOOR_MIN
  ? callerFloor : POPULATION_FLOOR_MIN;

function pages(nodeName) {
  let items = [];
  try {
    items = $(nodeName).all() || [];
  } catch (e) {
    throw new Error('GATE 2: ' + nodeName + ' did not execute (' + e.message + '). Refusing to score ' +
      'a cohort built on a sweep that never ran.');
  }
  if (items.length === 0) {
    throw new Error('GATE 2: ' + nodeName + ' returned nothing on its success output, so its error ' +
      'output fired - almost certainly an ERP auth, pagecode or permission failure. An empty pull is ' +
      'NOT "nobody paid" and NOT "no contracts".');
  }
  return items.map(function (i) { return (i && i.json) || {}; });
}
function erpErrorBody(b) {
  return b && (b.status || b.message || b.error || b.path) ? true : false;
}

// ------------------------------------------------------ 1. the population sweep
// GATE 2 IS NO LONGER UNRECONCILABLE, and that is the one good thing to come out of
// losing the dynamic route. contract/search/page returns a top-level `total`
// (5,393 measured 2026-08-18), so `rows collected` can finally be checked against a
// number the server itself declares - the reconciliation the rule row says is
// impossible against the dynamic route's bare array. The floor survives as a second,
// independent guard; it is not replaced by the reconciliation.
//
// THE THREE ENVELOPE FIELDS THAT LIE, all measured live on HTTP 200 responses:
//   clients.totalPages = currentPage+1, not a page count (1,2,3...24, then 1)
//   clients.last = true on EVERY page, page 0 included
//   clients.size = the size you ASKED for, while at most 40 rows ever come back
// Only `total` and the actual row count may be trusted. Trusting `size` would walk
// 54 pages at a claimed 100, collect 2,160 of 5,393, and pass every later gate.
let popRows = 0, lastPopPageSize = null, declaredTotal = null;
let popNestedPages = 0, popFlatPages = 0;
const popPages = pages('Get CC Contract Population');
for (const p of popPages) {
  const body = p.body !== undefined ? p.body : p;
  const wrapper = body && body.clients ? body.clients : null;
  const nested = wrapper && Array.isArray(wrapper.content) ? wrapper.content : null;
  const flat = Array.isArray(body) ? body : null;
  if (!nested && !flat) {
    if (erpErrorBody(body) || erpErrorBody(p)) {
      throw new Error('GATE 2: Get CC Contract Population returned an ERP error body instead of ' +
        'contracts - status=' + (body.status || p.status || '?') + ' message=' +
        (body.message || p.message || body.error || '?') + '. Three different causes look alike here ' +
        'and are fixed in three different places: 404 = the route or dynamic-API code does not exist; ' +
        '401 with developermessage INSUFFICIENT_PERMISSIONS = the pagecode is right and the PERMISSION ' +
        'is missing; 500 with SecurityException = the surface resolves but this account is not granted ' +
        'that code (measured 2026-08-18 on code=getactivecccontracts).');
    }
    throw new Error('GATE 2: Get CC Contract Population returned neither a clients.content envelope ' +
      'nor a bare array (got ' + (body === null ? 'null' : typeof body) + ', keys=' +
      Object.keys(body || p || {}).join(',') + '). If rows arrived as split items, fullResponse is not ' +
      'set on the node.');
  }
  const rows = nested || flat;
  if (nested) {
    popNestedPages++;
    const t = Number(body.total);
    // Live data moves during a 135-page walk, so take the LARGEST declared total seen
    // rather than the first or last - a mid-walk insertion must not shrink the target.
    if (Number.isFinite(t) && t > 0) declaredTotal = Math.max(declaredTotal === null ? 0 : declaredTotal, t);
  } else {
    popFlatPages++;
  }
  popRows += rows.length;
  lastPopPageSize = rows.length;
}

// The terminator must be PROVEN to have fired. A walk that ended on a FULL page hit
// the request cap instead of the end of the data, and a truncated walk is invisible.
// The page cap differs by route: contract/search/page never returns more than 40 rows
// however large a size you ask for; the dynamic route honours 1..100.
const pageCap = popNestedPages > 0 ? 40 : 100;
if (lastPopPageSize !== null && lastPopPageSize >= pageCap) {
  throw new Error('GATE 2: the population walk ended on a FULL page (' + popRows + ' rows over ' +
    popPages.length + ' page(s), last page ' + lastPopPageSize + ' against a cap of ' + pageCap +
    '). A truncated walk is invisible - raise options.pagination.maxRequests on Get CC Contract ' +
    'Population. Never raise the page size to compensate: this route caps rows at 40 while echoing ' +
    'the size you asked for.');
}

// THE RECONCILIATION. A short cohort is a false green by omission, so it fails closed.
// The drift allowance exists because the walk takes minutes and the book changes under
// it - `total` was observed moving 5,392 -> 5,393 between two probes seconds apart.
// It is an allowance for CONCURRENT CHANGE, never for a missing page: one dropped page
// is 40 rows, well outside it.
const POPULATION_RECONCILE_DRIFT = 25;
let reconciled = false;
if (declaredTotal !== null) {
  const delta = popRows - declaredTotal;
  if (delta < -POPULATION_RECONCILE_DRIFT) {
    throw new Error('GATE 2: collected ' + popRows + ' population rows against a server-declared ' +
      'total of ' + declaredTotal + ' (short by ' + (-delta) + ', drift allowance ' +
      POPULATION_RECONCILE_DRIFT + '). One missing page is 40 rows, so this is a truncated walk, not ' +
      'concurrent change. A contract missing from the cohort is never audited and no later gate can ' +
      'notice it.');
  }
  reconciled = true;
}
if (popRows < POPULATION_FLOOR) {
  throw new Error('GATE 2: the CC contract population is ' + popRows + ', below the floor of ' +
    POPULATION_FLOOR + ' (independently measured 5,202 on 2026-08-13 and 5,393 on 2026-08-18). A cohort ' +
    'under the floor is a COHORT BUG until proven otherwise from a source other than this query. The ' +
    'floor is never lowered to match a run.');
}

// -------------------------------------------------- 2. the three payment sweeps
const perWindow = {};
for (const w of WINDOWS) {
  const pgs = pages(w.node);
  let rows = 0;
  for (const p of pgs) {
    if (!Array.isArray(p.payments)) {
      if (erpErrorBody(p)) {
        throw new Error('GATE 2: ' + w.node + ' returned an ERP error body instead of rows - status=' +
          (p.status || '?') + ' message=' + (p.message || p.error || '?') + '. If this is a bare 403 ' +
          'with no ERP JSON, the /accounting/ prefix is missing from the URL: the load balancer answers ' +
          'before ERP does and it reads exactly like an account ban.');
      }
      throw new Error('GATE 2: ' + w.node + ' has no `payments` array - shape changed? keys=' +
        Object.keys(p).join(','));
    }
    rows += p.payments.length;
  }
  // A window returning zero rows is NOT "nobody paid" - it is very likely a wrong
  // window or a failed call, and scoring it would report the whole book as short.
  if (rows === 0) {
    throw new Error('GATE 2: ' + w.node + ' returned ZERO rows for ' + w.key + ' (' + w.from + ' to ' +
      w.to + '). A real month carries tens of thousands of rows (33,195 in July 2026). Treat it as a ' +
      'wrong window or a failed call, not as a quiet month.');
  }
  perWindow[w.key] = rows;
}

// ------------------------------------------------------- 3. the status sweep
const statusPages = pages('Get Payment Statuses');
let statusRows = 0, lastPageShort = false, statusDeclaredTotal = null;
for (const p of statusPages) {
  if (!Array.isArray(p.content)) {
    if (erpErrorBody(p)) {
      throw new Error('GATE 2: Get Payment Statuses returned an ERP error body instead of rows - ' +
        'status=' + (p.status || '?') + ' message=' + (p.message || p.error || '?') + '. Without this ' +
        'sweep there is no payment STATUS at all, so gate 12 cannot run and the cohort loses its ' +
        'terminated half. Failing instead of continuing.');
    }
    throw new Error('GATE 2: Get Payment Statuses has no `content` array - shape changed? keys=' +
      Object.keys(p).join(','));
  }
  statusRows += p.content.length;
  lastPageShort = p.content.length < 40;
  // THIS SWEEP IS RECONCILABLE TOO, corrected 2026-08-18. The note this gate carried
  // said advancesearch "returns no top-level total and its nested totalElements caps
  // at 40". Measured live: totalElements = 43,727 and totalPages = 1,094 CONSTANT
  // across pages, `last` correctly false then true, and an over-range page returns 0
  // rows. Nothing caps at 40 except the page size itself. Unlike contract/search/page,
  // this envelope tells the truth, so the two paged routes must NOT share a
  // terminator idiom.
  const st = Number(p.totalElements);
  if (Number.isFinite(st) && st > 0) {
    statusDeclaredTotal = Math.max(statusDeclaredTotal === null ? 0 : statusDeclaredTotal, st);
  }
}
if (statusRows === 0) {
  throw new Error('GATE 2: the payment-status sweep returned ZERO rows. It is the only source of ' +
    'status.value and the second half of the cohort. Refusing to run on the population list alone.');
}
let statusReconciled = false;
if (statusDeclaredTotal !== null) {
  const sdelta = statusRows - statusDeclaredTotal;
  if (sdelta < -POPULATION_RECONCILE_DRIFT) {
    throw new Error('GATE 2: the payment-status sweep collected ' + statusRows + ' rows against a ' +
      'declared totalElements of ' + statusDeclaredTotal + ' (short by ' + (-sdelta) + '). A truncated ' +
      'status walk silently removes the terminated half of the cohort.');
  }
  statusReconciled = true;
}
if (!lastPageShort) {
  throw new Error('GATE 2: the payment-status sweep ended on a FULL page (' + statusRows + ' rows over ' +
    statusPages.length + ' page(s)), so it hit the page cap rather than the end of the data. Raise ' +
    'options.pagination.maxRequests on Get Payment Statuses.');
}

const stats = {
  stage: 'gate2_completeness',
  population_rows: popRows,
  population_pages: popPages.length,
  population_floor: POPULATION_FLOOR,
  population_declared_total: declaredTotal,
  population_reconciled: reconciled,
  population_route: popNestedPages > 0 ? 'contract/search/page (status ACTIVE)' : 'dynamicApi getactivecccontracts',
  population_note: reconciled
    ? 'RECONCILED against the route\'s own top-level total (' + popRows + ' collected vs ' +
      declaredTotal + ' declared, drift allowance ' + POPULATION_RECONCILE_DRIFT + '), plus the ' +
      'short-page terminator and the independent floor of ' + POPULATION_FLOOR + '. Note clients.last, ' +
      'clients.totalPages and clients.size all lie on this route and are never read.'
    : 'NOT reconciled - this route declares no total, so completeness rests on the short-page ' +
      'terminator plus the floor. Declared, not assumed.',
  // WF-C's Build Summary reads contracts_collected / contracts_declared_total /
  // payment_rows. Emitting only population_rows left those columns BLANK in the Run
  // Summary tab, which reads as "not measured" rather than "measured and fine".
  contracts_collected: popRows,
  contracts_declared_total: declaredTotal,
  payment_rows_per_window: perWindow,
  payment_rows: Object.keys(perWindow).reduce(function (a, k) { return a + perWindow[k]; }, 0),
  status_rows: statusRows,
  status_pages: statusPages.length,
  status_declared_total: statusDeclaredTotal,
  status_sweep_reconciled: statusReconciled,
  status_sweep_note: statusReconciled
    ? 'RECONCILED against totalElements (' + statusRows + ' vs ' + statusDeclaredTotal + '). The old ' +
      'note claiming advancesearch has no total and caps at 40 was measured false on 2026-08-18.'
    : 'no declared totalElements seen on any page.',
  windows: WINDOWS.map(function (w) { return w.key; })
};
console.log(JSON.stringify(stats));

return [{ json: { _gate2: stats } }];

