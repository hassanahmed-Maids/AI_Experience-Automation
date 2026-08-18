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
//   Get Month Payments / M-1 / M-2   RECONCILABLE SINCE 2026-08-18, though not by an
//                                envelope - this route still has none. Each is now a
//                                sub-workflow call that returns CC rows only and
//                                declares the RAW count it filtered from, so the gate
//                                checks that raw count against a floor, balances
//                                cc + dropped against it, and separately requires CC
//                                to be present. Unstaged, the only detectable failure
//                                is zero rows, and "zero rows" is never "nobody paid".
//   Get Payment Statuses         RECONCILABLE, corrected 2026-08-18. This gate used
//                                to say it has "no top-level total" and that
//                                "totalElements caps at 40". Measured live: 43,727
//                                totalElements over 1,094 totalPages, both CONSTANT
//                                across pages, `last` correctly false-then-true, and
//                                an over-range page returns 0 rows. Nothing caps at 40
//                                but the page size.
//
// This gate is STATUS: PENDING TECHNICAL on the rule row, and what it is pending on has
// NARROWED TWICE in one day - worth restating rather than leaving either old reason
// standing. Both PAGED sweeps reconcile against a server-declared total. The three BULK
// payment sweeps were the stated residue; staging them into a sub-workflow closed most of
// that too, because the sub-workflow can declare its pre-filter row count even though ERP
// declares nothing.
//
// WHAT IS GENUINELY LEFT, and it is narrow: the bulk route still returns no total of its
// own, so a truncated response that is above the 10,000-row floor would pass. The floor
// and the CC/MV balance are proxies, not a server reconciliation. That residue is what a
// sign-off covers - not the population read, and no longer the whole payment pull. It
// still fails CLOSED.
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
// RECONCILABLE SINCE 2026-08-18, by a route nobody planned for. Those three sweeps now
// run in a sub-workflow ('CC Below Agreed - 0-Sweep Payments') that returns CC ROWS ONLY
// - about 20% of the pull - and hands back the RAW count it filtered from as `_raw_rows`.
// So a gate that could previously ask only "did anything come back at all" can now ask
// three separate questions:
//   was the window actually swept?   _raw_rows against a floor
//   did the CC filter behave?        cc + dropped === raw, exactly
//   was CC itself present?           cc_rows > 0
// The old test could not tell a failed call from a CC-quiet month, because the sum was
// all it ever saw. This is STRONGER than what it replaced, which matters: filtering
// upstream of a completeness gate is normally exactly how you blind one, so the raw
// count is carried across the boundary specifically so the gate does not lose sight of it.
//
// THE RAW FLOOR IS PER WINDOW AND DELIBERATELY LOW. Measured on the live July 2026 pull:
// 33,213 rows across both populations, 6,774 of them CC (20.4%). A window returning under
// 10,000 rows IN TOTAL is a truncated or wrong-window pull, not a quiet month. As with the
// population floor, it is never lowered to make a run pass.
const PAYMENT_RAW_FLOOR = 10000;
const perWindow = {};
const perWindowRaw = {};
let stagedWindows = 0, legacyWindows = 0, ccDropped = 0, ccUntyped = 0;
for (const w of WINDOWS) {
  const pgs = pages(w.node);
  let rows = 0, raw = null, dropped = 0, untyped = 0;
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
    const r = Number(p._raw_rows);
    if (Number.isFinite(r)) {
      raw = (raw === null ? 0 : raw) + r;
      dropped += Number(p._dropped_non_cc) || 0;
      untyped += Number(p._rows_missing_contract_type) || 0;
    }
  }

  if (raw === null) {
    // THE UNSTAGED SHAPE: a plain HTTP node with no provenance, which is what this node
    // saw before the sweeps were staged out. Keep the only test that shape permits, and
    // record that the weaker one ran - a green gate must never imply a check it skipped.
    legacyWindows++;
    if (rows === 0) {
      throw new Error('GATE 2: ' + w.node + ' returned ZERO rows for ' + w.key + ' (' + w.from + ' to ' +
        w.to + '). A real month carries tens of thousands of rows (33,213 in July 2026). Treat it as a ' +
        'wrong window or a failed call, not as a quiet month.');
    }
    perWindow[w.key] = rows;
    perWindowRaw[w.key] = null;
    continue;
  }

  stagedWindows++;
  if (raw === 0) {
    throw new Error('GATE 2: ' + w.node + ' swept ' + w.key + ' (' + w.from + ' to ' + w.to + ') and got ' +
      'ZERO rows before any filtering. A real month carries tens of thousands (33,213 in July 2026), so ' +
      'this is a wrong window or a failed call, never a quiet month.');
  }
  if (raw < PAYMENT_RAW_FLOOR) {
    throw new Error('GATE 2: ' + w.node + ' swept only ' + raw + ' raw rows for ' + w.key + ', below the ' +
      'floor of ' + PAYMENT_RAW_FLOOR + ' (July 2026 measured 33,213 across both populations). A partial ' +
      'response on this route is otherwise invisible - it has no paging envelope - so the floor is the ' +
      'only thing standing between a truncated pull and a book-wide false shortfall. It is never lowered ' +
      'to match a run.');
  }
  if (rows + dropped !== raw) {
    throw new Error('GATE 2: ' + w.node + ' does not add up - ' + rows + ' CC rows + ' + dropped +
      ' dropped = ' + (rows + dropped) + ', but ' + raw + ' rows were swept. Every row is either CC or ' +
      'not, so the difference of ' + Math.abs(raw - rows - dropped) + ' means the CC filter in the ' +
      'sub-workflow lost rows silently. Auditing an under-counted population passes every later gate.');
  }
  if (rows === 0) {
    throw new Error('GATE 2: ' + w.node + ' swept ' + raw + ' rows for ' + w.key + ' and NONE of them ' +
      'were CC. CC is 20.4% of this route by row count (6,774 of 33,213 in July 2026), so a CC-silent ' +
      'month is a contractType shape change or a wrong population, not a quiet month. The whole cohort ' +
      'would score as unpaid.');
  }
  perWindow[w.key] = rows;
  perWindowRaw[w.key] = raw;
  ccDropped += dropped;
  ccUntyped += untyped;
}
// A window in each shape means someone half-reverted the staging, and the two halves
// are not comparable: one window's count is CC-only and another's is CC+MV, which
// silently changes what the persistence test in gate 18 is comparing across months.
if (stagedWindows > 0 && legacyWindows > 0) {
  throw new Error('GATE 2: ' + stagedWindows + ' payment window(s) came back staged (CC-only, with a raw ' +
    'count) and ' + legacyWindows + ' unstaged (CC+MV, no provenance). Gate 18 compares months against ' +
    'each other, so mixing the two shapes compares a CC-only month with a CC+MV one. Stage all three or ' +
    'none.');
}

// ------------------------------------------------------- 3. the status sweep
const statusPages = pages('Get Payment Statuses');
let statusRows = 0, lastPageShort = false, statusDeclaredTotal = null, maxStatusPageSeen = 0;
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
  // The short-page test must compare against the page size ACTUALLY IN USE, never a
  // hardcoded 40. Measured 2026-08-18: advancesearch honours `size` up to a server
  // clamp of 2,000, and per-page latency is ~flat at ~22-25s whatever the size - so
  // the sweep runs at size 2000 (23 requests) rather than 40 (1,094 requests, 6.8
  // HOURS). With a hardcoded 40, the final 1,727-row page would not read as short,
  // gate 2 would declare the walk truncated and throw on a complete sweep.
  maxStatusPageSeen = Math.max(maxStatusPageSeen, p.content.length);
  lastPageShort = p.content.length < maxStatusPageSeen;
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
// THE RECONCILIATION IS THE PROOF; the short-page test is only a FALLBACK for when
// the envelope declared no total. Running both unconditionally is what made the page
// size load-bearing: a reconciled sweep is complete by arithmetic, whatever shape its
// last page happened to be, and throwing on it would reject a correct run.
if (!statusReconciled && !lastPageShort) {
  throw new Error('GATE 2: the payment-status sweep ended on a FULL page (' + statusRows + ' rows over ' +
    statusPages.length + ' page(s)) AND declared no totalElements to reconcile against, so there is no ' +
    'evidence the walk reached the end of the data. Raise options.pagination.maxRequests on Get Payment ' +
    'Statuses, or restore the envelope.');
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
  payment_raw_rows_per_window: perWindowRaw,
  payment_sweeps_staged: stagedWindows,
  payment_sweeps_unstaged: legacyWindows,
  payment_rows_dropped_non_cc: ccDropped,
  payment_rows_missing_contract_type: ccUntyped,
  payment_sweep_note: stagedWindows === WINDOWS.length
    ? 'RECONCILED: each window declared its pre-filter row count, checked against the floor of ' +
      PAYMENT_RAW_FLOOR + ', and cc + dropped balanced exactly against it. payment_rows counts CC ' +
      'ROWS ONLY - the ~80% MV rows are dropped in the sub-workflow and never reach this run.'
    : 'NOT reconciled on ' + legacyWindows + ' window(s): an unstaged HTTP sweep declares no ' +
      'pre-filter count, so for those the only detectable failure is zero rows and a partial ' +
      'response stays invisible. Those counts include MV rows.',
  payment_rows: Object.keys(perWindow).reduce(function (a, k) { return a + perWindow[k]; }, 0),
  status_rows: statusRows,
  status_pages: statusPages.length,
  status_page_size_seen: maxStatusPageSeen,
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

