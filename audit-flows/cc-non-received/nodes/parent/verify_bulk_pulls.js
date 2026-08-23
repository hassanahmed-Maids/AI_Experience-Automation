// ERP-COMPLIANCE: no-breaker-because this node reads FOUR RUN-LEVEL PAGINATED SWEEPS, not a
// per-entity fan-out, and none of §5's three thresholds can reach them. Stated per sweep rather
// than as one wave of the hand:
//
//   Get Active CC Contracts / Get Terminated Contracts / Get Payment Statuses - each is ONE
//   n8n HTTP node walking pages internally. n8n aborts the walk at the FIRST failing page and
//   sends the node's whole output to its error output, which goes to Release Lease (error) ->
//   Fail Loudly. So the success items this node reads are, by construction, only successes: a
//   breaker here would classify a batch that cannot contain a failure and would report `ok` on
//   every run for ever - the false-clearance shape this project keeps finding. The walk stops
//   itself at page one of the trouble, sooner than a breaker reading the finished batch could.
//
//   Get Month Payments - a single call. A batch of one reaches none of the three thresholds:
//   consecutive needs 5, degraded_rate needs 20 samples, and latency needs an earlier batch of
//   the same key in the same run.
//
// WHAT STOPS THE RUN INSTEAD, and it is stricter than a breaker would be. Gate 2 below throws
// if any of the four sweeps produced nothing on its success output, if a declared total is
// absent or non-numeric, if the contract cohort is under the population floor, if the payment
// sweep is empty, or if the status sweep ended on a full page. Every one of those is a refusal
// to score, not a warning. The three per-entity fan-outs downstream - where a degrading ERP CAN
// be measured across a batch - each carry a real generated breaker: Judge Replacements Batch,
// Judge Plan Batch, Judge CPT Batch.
//
// Verify Bulk Pulls - GATE 2 (Order 20): "Absent evidence halts the run - it
// never satisfies a comparison."
//
// This node is the single most important line in the spec. The DELETED CC flow
// had a version of this guard and it was INERT:
//
//     const declared = (b.total != null) ? b.total : b.totalElements;
//     if (collected < Number(declared)) throw ...
//
// The endpoint returned total: "" (empty string). `"" != null` is TRUE, so it
// never fell through to totalElements; `Number("")` is 0; the test became
// 24000 < 0. The sweep truncated at 24,000 of 29,772 rows, ERP returns
// newest-first, so the 5,772 rows it dropped were the OLDEST - 1 July, where
// most monthly payments sit. The run reported SUCCESS and produced thousands of
// false reds.
//
// Therefore, in this node:
//   * a declared total that is null, "", or non-numeric ABORTS THE RUN. It is
//     never coerced, never defaulted, never compared.
//   * a row count is never proof of completeness on its own.
//
// THE THREE SWEEPS NEED THREE DIFFERENT GUARDS (measured 2026-08-13), which is
// why this is not one loop:
//   1. Get Active CC Contracts  - paged, carries a top-level `total`. The
//      literal assertion applies. `clients.totalElements` CAPS AT 40 and
//      `last:true` lies on page 0 of 3 - never reconcile against those.
//   2. Get Month Payments       - one call, no envelope at all. Guarded by the
//      shape of the response plus a floor, never by a declared total.
//   3. Get Payment Statuses     - advancesearch: NO top-level total exists and
//      the nested totalElements caps at 40. This sweep is STRUCTURALLY
//      UNRECONCILED and is declared as such on the run rather than quietly
//      accepted.
//
// POPULATION FLOOR. The active-contract cohort is independently expected at
// ~5,283 (measured 2026-08-12) and the floor is 4,600. THE FLOOR IS NEVER
// LOWERED TO MATCH A RUN - lowering it was proposed once during the incident and
// would have permanently blessed a cohort missing 80% of the book. The caller
// may raise it via params.population_floor; it may not lower it.
const validated = $('Validate Inputs').first().json;
const params = validated.params || {};

const POPULATION_FLOOR_MIN = 4600;
const callerFloor = Number(params.population_floor);
const POPULATION_FLOOR = Number.isFinite(callerFloor) && callerFloor > POPULATION_FLOOR_MIN
  ? callerFloor
  : POPULATION_FLOOR_MIN;

function pages(nodeName) {
  let items = [];
  try {
    items = $(nodeName).all() || [];
  } catch (e) {
    throw new Error('GATE 2: ' + nodeName + ' did not execute (' + e.message +
      '). Refusing to score a cohort built on a pull that never ran.');
  }
  if (items.length === 0) {
    throw new Error('GATE 2: ' + nodeName + ' returned nothing on its success output, so its ' +
      'error output fired - almost certainly an ERP auth, pagecode or permission failure. ' +
      'An empty pull is NOT "nobody paid" and NOT "no contracts".');
  }
  return items.map(function (i) { return (i && i.json) || {}; });
}

// A declared total is USABLE only if it is a finite number. Anything else - null,
// undefined, "", "abc", NaN - aborts. This function never returns a default.
function declaredTotal(body, field) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, field)) return { present: false };
  const raw = body[field];
  if (raw === null || raw === undefined || raw === '' ||
      (typeof raw === 'string' && raw.trim() === '')) {
    return { present: true, usable: false, raw: JSON.stringify(raw) };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return { present: true, usable: false, raw: JSON.stringify(raw) };
  return { present: true, usable: true, value: n };
}

function erpErrorBody(b) {
  return b && (b.status || b.message || b.error || b.path) ? true : false;
}

// ---------------------------------------------------------------- 1. contracts
const contractPages = pages('Get Active CC Contracts');
let contractRows = 0;
let declared = { present: false };
for (const p of contractPages) {
  if (!p.clients) {
    if (erpErrorBody(p)) {
      throw new Error('GATE 2: Get Active CC Contracts returned an ERP error body instead of ' +
        'contracts - status=' + (p.status || '?') + ' message=' + (p.message || p.error || '?') +
        ' path=' + (p.path || '?') + '. Refusing to score an empty cohort.');
    }
    throw new Error('GATE 2: Get Active CC Contracts has no `clients` object - shape changed? ' +
      'keys=' + Object.keys(p).join(','));
  }
  const content = Array.isArray(p.clients.content) ? p.clients.content : [];
  contractRows += content.length;
  // Read the TOP-LEVEL total, never clients.totalElements (caps at 40).
  if (!declared.present || declared.usable !== true) {
    const d = declaredTotal(p, 'total');
    if (d.present) declared = d;
  }
}

if (declared.present && declared.usable !== true) {
  throw new Error('GATE 2: Get Active CC Contracts declared a total that cannot be read as a ' +
    'number (total=' + declared.raw + '). This is the exact shape that made the deleted flow\'s ' +
    'guard inert - `Number("")` is 0, so the comparison silently passed. ' +
    'FAILING CLOSED: no case is scored on an unverifiable sweep.');
}
if (declared.usable === true && contractRows < declared.value) {
  throw new Error('GATE 2: contract sweep INCOMPLETE - collected ' + contractRows + ' of ' +
    declared.value + ' contracts ERP says match (' + contractPages.length + ' page(s)). ' +
    'ERP reports clients.totalElements / totalPages / last as if page 0 were the whole result ' +
    'set, so raise options.pagination.maxRequests on Get Active CC Contracts or fix its ' +
    'completeExpression - never trust clients.last.');
}
if (!declared.present) {
  // No declared total to compare against. The substitute guard is the floor.
  console.log(JSON.stringify({ stage: 'gate2', warning:
    'contract sweep carried NO top-level total - reconciled against the population floor only' }));
}

// SUBSTITUTE GUARD (required by gate 2 for a sweep with no trustworthy declared
// total). A short population is invisible: a contract missing from the cohort is
// never audited, and that is a FALSE GREEN BY OMISSION which no downstream gate
// can catch. An independent expectation is the only thing that sees it.
if (contractRows < POPULATION_FLOOR) {
  throw new Error('GATE 2: active CC contract cohort is ' + contractRows + ', below the ' +
    'population floor of ' + POPULATION_FLOOR + ' (independently measured at 5,283 on ' +
    '2026-08-12). A cohort under the floor is a COHORT BUG until proven otherwise from a ' +
    'source other than this query - most likely a flattened pagination context, a changed ' +
    'body field, or includeNullNationality flipped to true (which NARROWS to ~1,043). ' +
    'The floor is never lowered to match a run.');
}

// ------------------------------------------ 1b. GATE 16: terminated contracts
// NEVER treat an empty terminated-contract response as "nobody terminated". It is
// indistinguishable from a broken call, and it silently restores the blind spot
// this gate exists to close - 122 contracts with zero payment rows in July alone.
const termPages = pages('Get Terminated Contracts');
let termRows = 0;
let termDeclared = { present: false };
for (const p of termPages) {
  if (!p.clients) {
    if (erpErrorBody(p)) {
      throw new Error('GATE 2/16: Get Terminated Contracts returned an ERP error body - status=' +
        (p.status || '?') + ' message=' + (p.message || p.error || '?') + '. If it 500s, the status ' +
        'filter is probably a non-member of the enum (TERMINATED / FILTER_TERMINATED / FILTER_ALL all ' +
        '500 loudly, which is safer than the plain CANCELLED that fails quietly).');
    }
    throw new Error('GATE 2/16: Get Terminated Contracts has no `clients` object - shape changed? ' +
      'keys=' + Object.keys(p).join(','));
  }
  termRows += Array.isArray(p.clients.content) ? p.clients.content.length : 0;
  if (!termDeclared.present || termDeclared.usable !== true) {
    const d = declaredTotal(p, 'total');       // the OUTER total, never totalPages
    if (d.present) termDeclared = d;
  }
}
if (termRows === 0) {
  throw new Error('GATE 16: the terminated-contract sweep returned ZERO rows for ' +
    validated.range_start + '..' + validated.range_end + '. That is not "nobody terminated" - 628 CC ' +
    'contracts terminated in July 2026 alone. An empty list here is indistinguishable from a broken ' +
    'call and silently restores the blind spot the gate exists to close. Check the status filter is ' +
    'FILTER_CANCELED with ONE L: the two-L CANCELLED returns 5,317 ACTIVE contracts with HTTP 200.');
}
if (termDeclared.present && termDeclared.usable !== true) {
  throw new Error('GATE 16: the terminated sweep declared a total that cannot be read as a number (' +
    termDeclared.raw + '). Failing closed rather than comparing against it.');
}
if (termDeclared.usable === true && termRows < termDeclared.value) {
  throw new Error('GATE 16: terminated sweep INCOMPLETE - collected ' + termRows + ' of ' +
    termDeclared.value + '. Reconcile against the OUTER total beside `clients`, never totalPages, and ' +
    'raise options.pagination.maxRequests on Get Terminated Contracts.');
}

// ------------------------------------------------------------ 2. month payments
const paymentPages = pages('Get Month Payments');
let paymentRows = 0;
for (const p of paymentPages) {
  if (!Array.isArray(p.payments)) {
    if (erpErrorBody(p)) {
      throw new Error('GATE 2: Get Month Payments returned an ERP error body instead of rows - ' +
        'status=' + (p.status || '?') + ' message=' + (p.message || p.error || '?') +
        ' path=' + (p.path || '?') + '. If this is a bare 403 with no ERP JSON, the /accounting/ ' +
        'prefix is missing from the URL - the load balancer answers before ERP does, and it ' +
        'reads exactly like an account ban.');
    }
    throw new Error('GATE 2: Get Month Payments has no `payments` array - shape changed? keys=' +
      Object.keys(p).join(','));
  }
  paymentRows += p.payments.length;
}
// A window returning zero rows is NOT "nobody paid" - it is very likely a wrong
// window or a failed call. Abort rather than scoring an empty pull as findings:
// with zero payment rows EVERY contract in the population reads unpaid.
if (paymentRows === 0) {
  throw new Error('GATE 2: the received-payments pull for ' + validated.range_start + ' -> ' +
    validated.range_end + ' returned ZERO rows. That is not "nobody paid": a real month carries ' +
    'tens of thousands of rows (33,195 in July 2026). Treat it as a wrong window or a failed ' +
    'call. Scoring it would report every contract in the book as never billed.');
}

// -------------------------------------------------- 3. payment statuses (union)
// UNRECONCILED BY CONSTRUCTION: this endpoint returns no top-level total and its
// nested totalElements caps at 40. It is declared, not accepted in silence.
const statusPages = pages('Get Payment Statuses');
let statusRows = 0;
let lastPageShort = false;
for (const p of statusPages) {
  if (!Array.isArray(p.content)) {
    if (erpErrorBody(p)) {
      throw new Error('GATE 2: Get Payment Statuses returned an ERP error body instead of rows - ' +
        'status=' + (p.status || '?') + ' message=' + (p.message || p.error || '?') + '. ' +
        'If this sweep is unreachable the cohort collapses back to the active-only list, which ' +
        'audits a fraction of the book while every gate still passes. Failing instead.');
    }
    throw new Error('GATE 2: Get Payment Statuses has no `content` array - shape changed? keys=' +
      Object.keys(p).join(','));
  }
  statusRows += p.content.length;
  lastPageShort = p.content.length < 40;
}
if (statusRows === 0) {
  throw new Error('GATE 2: the payment-status sweep returned ZERO rows for this month. It is the ' +
    'SECOND HALF OF THE COHORT (contracts settling their final months are absent from the ' +
    'active list) and the only source of status.value. Refusing to run on the active list alone.');
}
if (!lastPageShort) {
  throw new Error('GATE 2: the payment-status sweep ended on a FULL page (' + statusRows +
    ' rows over ' + statusPages.length + ' page(s)), so it hit the page cap rather than the end ' +
    'of the data. This endpoint has no total to reconcile against, so a truncated walk is ' +
    'invisible - raise options.pagination.maxRequests on Get Payment Statuses.');
}

const stats = {
  stage: 'gate2_completeness',
  contracts_collected: contractRows,
  contracts_declared_total: declared.usable === true ? declared.value : null,
  contracts_pages: contractPages.length,
  terminated_rows: termRows,
  terminated_declared_total: termDeclared.usable === true ? termDeclared.value : null,
  terminated_pages: termPages.length,
  population_floor: POPULATION_FLOOR,
  payment_rows: paymentRows,
  status_rows: statusRows,
  status_pages: statusPages.length,
  status_sweep_reconciled: false,
  status_sweep_note: 'advancesearch returns no top-level total and its nested totalElements caps ' +
    'at 40 - completeness rests on the short-page terminator alone. Declared, not assumed.',
  gates_evaluated_lazily: 'gates 40/50/60 are evaluated only for contract-months that are not ' +
    'already settled by gate 70. They can change a green case\'s REASON, never its verdict.'
};
console.log(JSON.stringify(stats));

return [{ json: { _gate2: stats } }];
