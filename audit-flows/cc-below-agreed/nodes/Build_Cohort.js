// Build Cohort - GATE 1 (Order 10) population, now from THREE sources plus a
// termination index. One item per contract; case key is contract_id:YYYY-MM.
//
// SOURCE A - the CC population sweep. contract/search/page since 2026-08-18 (the
//   dynamic route is access-denied on this account - see the block on source A), so
//   identity costs no extra call. THE START DATE IS `startDate` - not
//   `startOfContract` (that is contract/search/page's spelling) and not
//   `contractStartDate` (which exists nowhere). It must come from HERE:
//   startOfContract came back NULL on CONTRACT_DETAILS for all three pro-rate test
//   contracts, so sourcing it from the plan read would silently switch pro-rating
//   off - and 408 of the 984 July shortfalls are legitimately pro-rated first
//   months. There is NO pagination envelope: the server applies .getContent() and
//   strips totalElements and totalPages, so completeness rests on the empty-page
//   terminator alone plus gate 2's floor.
//
// SOURCE B - the contract stub embedded on this month's payment rows. Free, and it
//   is how contracts that terminated mid-month get back in: source A returns only
//   contracts ACTIVE NOW. A 40-row sample ran 23 CANCELLED to 17 ACTIVE.
//
// SOURCE C - Get Terminated Contracts (gate 19 / ACP Order 15), added 2026-08-17.
//   Sources A and B TOGETHER still miss a contract that terminated inside the month
//   and was never billed: absent from A because it is not active, absent from B
//   because it has no payment row. Measured 628 CC terminations in July 2026, 122
//   of them with no payment rows of any status. A month that never billed them is
//   exactly what this check exists to find, so their absence was a false clearance
//   by omission.
//
// THE TERMINATION INDEX. Source C is swept from window start to an OPEN upper bound
// (2099), so it lists every contract that died on or after the window opened. That
// makes it an evidence base for dating source B: a payment-row stub carries no
// dateOfTermination, and reading blank as "still alive" is what pulled 3,782
// long-dead cancelled contracts into the sibling's cohort, produced 1,828 false
// reds and doubled its memory. A cancelled stub ABSENT from the index provably died
// BEFORE the window. That is a proof, not a heuristic - no age cutoff, no start-date
// filter, no status guess.
const validated = $('Validate Inputs').first().json;
const auditMonth = validated.audit_month;
const rangeStart = validated.range_start;
const rangeEnd = validated.range_end;

const CC_PROSPECT = 'maids.cc_prospect';

function s(v) { return v === null || v === undefined ? '' : String(v); }
function ymd(v) { return s(v).slice(0, 10); }
function digits(v) { return s(v).replace(/\D+/g, ''); }

// A contract is in the month only if its life covers at least one day of it.
// A MISSING START DATE IS HELD, NEVER READ AS BLANK: a blank start silently puts
// every month in scope for every contract.
function coversMonth(startDate, terminationDate) {
  const start = ymd(startDate);
  const end = ymd(terminationDate);
  if (!start) return { covers: false, reason: 'missing_start_date' };
  if (start > rangeEnd) return { covers: false, reason: 'starts_after_window' };
  if (end && end < rangeStart) return { covers: false, reason: 'terminated_before_window' };
  return { covers: true, reason: '' };
}

const cohort = new Map();
const dropped = { mv: 0, unknown_prospect: 0, outside_month: 0, no_contract_id: 0,
  dead_before_window_by_index: 0 };
const held = [];

function seed(contractId) {
  if (!cohort.has(contractId)) {
    cohort.set(contractId, {
      contract_id: contractId,
      case_key: contractId + ':' + auditMonth,
      audit_month: auditMonth,
      client_id: '', client_name: '',
      maid_id: '', maid_name: '', maid_nationality: '',
      // BLANK IS NOT FALSE on maidLiveOut - blank on the 345 rows with no maid, and
      // live-out rates run ~AED 1,600/month higher, so defaulting blanks to live-in
      // manufactures findings against clients who are paying correctly. Carried,
      // never assumed.
      maid_live_out: null,
      contract_status: '', contract_start: '', scheduled_termination: '',
      termination_source: '',
      sources: []
    });
  }
  return cohort.get(contractId);
}

// ============================== SOURCE C, FIRST ==============================
// Built before anything else, because source B depends on it for dating.
const terminationIndex = new Map();
let termPages = 0, termRows = 0, termPagesWithEnvelope = 0;
let termRaw = [];
try { termRaw = $('Get Terminated Contracts').all(); } catch (e) { termRaw = []; }
for (const page of termRaw) {
  termPages++;
  const j = page.json || {};
  const body = j.body !== undefined ? j.body : j;
  const wrapper = body && body.clients ? body.clients : null;
  if (!wrapper || !Array.isArray(wrapper.content)) continue;
  termPagesWithEnvelope++;
  for (const r of wrapper.content) {
    termRows++;
    const id = s(r.id);
    if (!id) continue;
    const endDate = ymd(r.dateOfTermination) || ymd(r.scheduledDateOfTermination);
    if (endDate) terminationIndex.set(id, endDate);
  }
}

// A FAILED SWEEP MUST NOT LOOK LIKE A QUIET MONTH. If the index is empty because
// the read failed, every undated cancelled stub would be "proven" dead before the
// window and silently excluded - mass false clearance, and the cohort would look
// merely small rather than wrong. So the two cases are distinguished by SHAPE, not
// by count: a legitimate zero still returns a page carrying a clients.content
// array. No envelope at all means the read did not happen.
if (termPagesWithEnvelope === 0) {
  throw new Error('Get Terminated Contracts returned no readable page envelope (' + termPages +
    ' items seen). The termination index is what dates cancelled payment stubs, so an ' +
    'unread sweep would silently exclude them as dead-before-window. Refusing to build a ' +
    'cohort that could report a false clearance. Check the sweep, its pagecode (ClientList) ' +
    'and its FILTER_CANCELED status value.');
}

// ------------------------------------------- A. the CC population sweep
// ROUTE CHANGED 2026-08-18, and the reason is an access finding, not a preference.
// The dynamic API (`code=getactivecccontracts`) is DENIED to this workspace's
// account: HTTP 500 `java.lang.SecurityException: Access denied.` on pagecode
// <none>/ClientList/ClientSummary/AdminDynamicApi alike, while a deliberately bogus
// code returns 404 - so the surface resolves and that ONE code is simply not granted.
// It does work on another auditor's login. That is exactly why it was not tested
// there: a permission verified on someone else's account looks granted forever, and
// every ERP read behind a finding is logged under whoever's token made it.
//
// Replaced with contract/search/page (status ACTIVE + maids.cc_prospect), probed live
// on this account: 5,393 contracts, every field this node needs, and - unlike the
// dynamic route - a top-level `total`, which finally makes gate 2 a real
// reconciliation instead of only a floor.
//
// THREE MEASURED LIES IN THIS ENVELOPE, every one of them an HTTP 200:
//   * clients.totalPages is currentPage+1 (1,2,3 ... 24), NOT a page count. It resets
//     to 1 on the empty page past the end.
//   * clients.last is true on EVERY page, including page 0.
//   * clients.size ECHOES the size you asked for (100, 200) while the server never
//     returns more than 40 rows. Trusting it would walk 5393/100 = 54 pages, collect
//     2,160 of 5,393 contracts, and pass every downstream gate on 40% of the book.
// Completeness therefore rests on the EMPTY-PAGE terminator plus gate 2's
// reconciliation against `total`. Never on last, totalPages or size.
//
// BOTH SHAPES ARE PARSED - the nested one this route returns, and the dynamic route's
// flat camelCase - so restoring the grant needs no code change here, and a run that
// somehow gets a mixture is still counted correctly.
let popRows = 0, popNested = 0, popFlat = 0;
for (const page of $('Get CC Contract Population').all()) {
  const j = page.json || {};
  const body = j.body !== undefined ? j.body : j;

  // Shape 1: contract/search/page -> { clients: { content: [ ... ] }, total: N }
  const wrapper = body && body.clients ? body.clients : null;
  const nested = wrapper && Array.isArray(wrapper.content) ? wrapper.content : null;
  // Shape 2: the dynamic route -> a bare array of flat rows
  const flat = Array.isArray(body) ? body : null;
  const rows = nested || flat || [];
  if (nested) popNested += rows.length;
  if (flat) popFlat += rows.length;

  for (const r of rows) {
    popRows++;
    // id on the nested shape, contractId on the flat one.
    const contractId = s(r.contractId || r.id);
    if (!contractId) { dropped.no_contract_id++; continue; }

    // Prospect type is filtered server-side by the request body, but a silently
    // ignored filter is the failure mode that audits the wrong population with
    // every gate passing, so it is re-checked here rather than trusted. Absent on
    // the flat shape, which is why an empty code is allowed through.
    const prospect = s(r.contractProspectType && r.contractProspectType.code);
    if (prospect && prospect !== CC_PROSPECT) {
      if (prospect === 'maidvisa.ae_prospect') dropped.mv++; else dropped.unknown_prospect++;
      continue;
    }

    // START DATE: `startDate` is the dynamic route's spelling, `startOfContract` is
    // contract/search/page's. Never `contractStartDate` (exists nowhere), and never
    // from the plan read - startOfContract came back NULL on CONTRACT_DETAILS for all
    // three pro-rate test contracts, so sourcing it there would switch pro-rating off
    // silently, and 408 of the 984 July shortfalls are legitimately pro-rated months.
    const startDate = r.startDate || r.startOfContract;
    const endDate = r.scheduledDateOfTermination || r.dateOfTermination;
    const cover = coversMonth(startDate, endDate);
    if (!cover.covers) {
      if (cover.reason === 'missing_start_date') {
        held.push({ contract_id: contractId, reason: 'missing_start_date',
          detail: 'no start date on the population row - held for a human rather than audited or ' +
                  'dropped, because a blank start date would put every month in scope' });
      } else { dropped.outside_month++; }
      continue;
    }
    const c = seed(contractId);
    c.sources.push('population_route');
    c.client_id = c.client_id || digits(r.clientId || (r.client && r.client.id));
    c.client_name = c.client_name || s(r.clientName || (r.client && r.client.name));
    c.maid_id = c.maid_id || digits(r.maidId || (r.housemaid && r.housemaid.id));
    c.maid_name = c.maid_name || s(r.maidName || (r.housemaid && (r.housemaid.label || r.housemaid.name)));
    c.maid_nationality = c.maid_nationality || s(r.maidNationality || (r.housemaid && r.housemaid.nationality));
    // BLANK IS NOT FALSE. liveOut sits contract-level on the nested shape and
    // maidLiveOut on the flat one; live-out rates run ~AED 1,600/month higher, so a
    // blank read as live-in manufactures findings against clients paying correctly.
    const liveOut = (r.maidLiveOut !== undefined && r.maidLiveOut !== null) ? r.maidLiveOut
                  : ((r.liveOut !== undefined && r.liveOut !== null) ? r.liveOut
                  : ((r.housemaid && r.housemaid.liveOut !== undefined) ? r.housemaid.liveOut : null));
    if (c.maid_live_out === null && (liveOut === true || liveOut === false)) c.maid_live_out = liveOut;
    c.contract_status = c.contract_status || s(r.contractStatus || r.status);
    c.contract_start = c.contract_start || ymd(startDate);
    c.scheduled_termination = c.scheduled_termination || ymd(endDate);
    if (c.scheduled_termination) c.termination_source = c.termination_source || 'population_row';
  }
}

// ----------------------------- B. contract stubs on this month's payment rows
let stubSeen = 0, stubNoContract = 0, datedByIndex = 0;
for (const page of $('Get Payment Statuses').all()) {
  const rows = Array.isArray(page.json.content) ? page.json.content : [];
  for (const row of rows) {
    const stub = row.contract;
    if (!stub || typeof stub !== 'object') { stubNoContract++; continue; }
    stubSeen++;
    const contractId = s(stub.id);
    if (!contractId) { dropped.no_contract_id++; continue; }

    // MaidVisa must never appear here - structurally different expected amount, and
    // its own check. The July pull is 80% MV by row count (26,431 of 33,205).
    const code = s(stub.contractProspectType && stub.contractProspectType.code);
    if (code && code !== CC_PROSPECT) {
      if (code === 'maidvisa.ae_prospect') dropped.mv++; else dropped.unknown_prospect++;
      continue;
    }

    // ---- ACP Order 12: date a cancelled stub from the index, never assume alive.
    let endDate = ymd(stub.dateOfTermination);
    let endFrom = endDate ? 'payment_stub' : '';
    const statusText = s(stub.status).toUpperCase();
    const looksCancelled = statusText.indexOf('CANCEL') !== -1;
    if (!endDate && looksCancelled) {
      if (terminationIndex.has(contractId)) {
        endDate = terminationIndex.get(contractId);
        endFrom = 'termination_index';
        datedByIndex++;
      } else {
        // Absent from a sweep that covers window-start onwards = died before it.
        dropped.dead_before_window_by_index++;
        continue;
      }
    }

    const cover = coversMonth(stub.startOfContract || stub.startDate, endDate);
    if (!cover.covers) {
      if (cover.reason === 'missing_start_date') {
        held.push({ contract_id: contractId, reason: 'missing_start_date',
          detail: 'payment-row contract stub carries no start date' });
      } else { dropped.outside_month++; }
      continue;
    }

    const c = seed(contractId);
    if (c.sources.indexOf('payment_stub') === -1) c.sources.push('payment_stub');
    c.client_id = c.client_id || digits(stub.client && stub.client.id);
    c.client_name = c.client_name || s(stub.client && stub.client.name);
    c.maid_id = c.maid_id || digits(stub.housemaid && stub.housemaid.id);
    c.maid_name = c.maid_name || s(stub.housemaid && (stub.housemaid.label || stub.housemaid.name));
    // NATIONALITY IS A STRING HERE and an OBJECT on contract/search/page. This check
    // prices nothing by nationality, so it is stored as-is and never compared.
    c.maid_nationality = c.maid_nationality || s(stub.housemaid && stub.housemaid.nationality);
    c.contract_status = c.contract_status || s(stub.status);
    c.contract_start = c.contract_start || ymd(stub.startOfContract || stub.startDate);
    if (endDate) { c.scheduled_termination = c.scheduled_termination || endDate;
                   c.termination_source = c.termination_source || endFrom; }
  }
}

// ------------------- C(ii). terminated contracts joining the cohort directly
// The 122 measured July contracts that appear in NEITHER source above. Same
// coverage test as everyone else - being in the index is not a free pass, it only
// proves when the contract died.
let fromTerminated = 0;
for (const page of termRaw) {
  const j = page.json || {};
  const body = j.body !== undefined ? j.body : j;
  const wrapper = body && body.clients ? body.clients : null;
  if (!wrapper || !Array.isArray(wrapper.content)) continue;
  for (const r of wrapper.content) {
    const contractId = s(r.id);
    if (!contractId) { dropped.no_contract_id++; continue; }
    const code = s(r.contractProspectType && r.contractProspectType.code);
    if (code && code !== CC_PROSPECT) {
      if (code === 'maidvisa.ae_prospect') dropped.mv++; else dropped.unknown_prospect++;
      continue;
    }
    const endDate = ymd(r.dateOfTermination) || ymd(r.scheduledDateOfTermination);
    const cover = coversMonth(r.startOfContract || r.startDate, endDate);
    if (!cover.covers) {
      if (cover.reason === 'missing_start_date') {
        held.push({ contract_id: contractId, reason: 'missing_start_date',
          detail: 'terminated-contracts row carries no start date' });
      } else { dropped.outside_month++; }
      continue;
    }
    const existed = cohort.has(contractId);
    const c = seed(contractId);
    if (c.sources.indexOf('terminated_sweep') === -1) c.sources.push('terminated_sweep');
    if (!existed) fromTerminated++;
    c.client_id = c.client_id || digits(r.client && r.client.id);
    c.client_name = c.client_name || s(r.client && r.client.name);
    c.maid_id = c.maid_id || digits(r.housemaid && r.housemaid.id);
    c.maid_name = c.maid_name || s(r.housemaid && (r.housemaid.label || r.housemaid.name));
    if (c.maid_live_out === null && (r.liveOut === true || r.liveOut === false)) c.maid_live_out = r.liveOut;
    c.contract_status = c.contract_status || s(r.status);
    c.contract_start = c.contract_start || ymd(r.startOfContract || r.startDate);
    if (endDate) { c.scheduled_termination = c.scheduled_termination || endDate;
                   c.termination_source = c.termination_source || 'terminated_sweep'; }
  }
}

const out = Array.from(cohort.values());
const cohortBeforeCap = out.length;

// ------------------------------------------------- PIPELINE-TEST COHORT CAP
// params.cohort_cap is for pipeline tests ONLY. ABSENT = UNCAPPED = real audit, so
// a forgotten parameter can never silently shrink an audit. Capped on the COHORT and
// never the window: a short window makes more contracts look unpaid and distorts
// every verdict, while auditing fewer contracts distorts nothing about the ones
// audited - there are simply fewer.
const rawCap = (validated.params && validated.params.cohort_cap !== undefined) ? validated.params.cohort_cap : validated.cohort_cap;
const cohortCap = (rawCap === null || rawCap === undefined || rawCap === '') ? null : Number(rawCap);
if (cohortCap !== null && (!isFinite(cohortCap) || cohortCap < 1 || Math.floor(cohortCap) !== cohortCap)) {
  throw new Error('cohort_cap must be a positive integer or absent. Got: ' + JSON.stringify(rawCap));
}
let capped = false;
if (cohortCap !== null && cohortBeforeCap > cohortCap) {
  out.sort(function (a, b) { return String(a.contract_id).localeCompare(String(b.contract_id)); });
  out.length = cohortCap;
  capped = true;
}
for (const c of out) {
  c.pipeline_test = capped;
  c.cohort_cap = capped ? cohortCap : null;
  c.cohort_before_cap = cohortBeforeCap;
}

const stats = {
  stage: 'build_cohort',
  audit_month: auditMonth,
  cohort: out.length,
  cohort_before_cap: cohortBeforeCap,
  cohort_cap: capped ? cohortCap : null,
  pipeline_test: capped,
  population_rows_seen: popRows,
  payment_stubs_seen: stubSeen,
  payment_rows_without_contract: stubNoContract,
  terminated_pages_seen: termPages,
  terminated_pages_with_envelope: termPagesWithEnvelope,
  terminated_rows_seen: termRows,
  termination_index_size: terminationIndex.size,
  cancelled_stubs_dated_by_index: datedByIndex,
  cancelled_stubs_excluded_dead_before_window: dropped.dead_before_window_by_index,
  contracts_only_from_terminated_sweep: fromTerminated,
  from_population_only: out.filter(function (c) { return c.sources.length === 1 && c.sources[0] === 'population_route'; }).length,
  from_payment_stub_only: out.filter(function (c) { return c.sources.length === 1 && c.sources[0] === 'payment_stub'; }).length,
  from_terminated_only: out.filter(function (c) { return c.sources.length === 1 && c.sources[0] === 'terminated_sweep'; }).length,
  from_multiple: out.filter(function (c) { return c.sources.length > 1; }).length,
  maidless_kept: out.filter(function (c) { return !c.maid_id; }).length,
  live_out_unknown: out.filter(function (c) { return c.maid_live_out === null; }).length,
  held_for_human: held.length,
  held_detail: held.slice(0, 50),
  dropped: dropped
};
if (capped) {
  console.log('PIPELINE TEST - NOT AN AUDIT: cohort capped at ' + cohortCap + ' of ' + cohortBeforeCap +
    ' contract-months. Coverage is incomplete BY DESIGN and no number from this run is publishable.');
}
console.log(JSON.stringify(stats));

// The zero-check reads the POST-cap list on purpose: a cap that produced nothing is
// as broken as a population that produced nothing.
if (out.length === 0) {
  throw new Error('Build Cohort produced ZERO contract-months for ' + auditMonth + ' from ' + popRows +
    ' population rows, ' + stubSeen + ' payment stubs and ' + termRows + ' terminated rows. ' +
    'A zero-contract audit must never be reportable as a pass.');
}

return out.map(function (c) { return { json: c }; });

