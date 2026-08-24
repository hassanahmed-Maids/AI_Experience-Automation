// WF-E end to end, offline: Read Chunk -> Project Plan -> Project Replacements, then
// WF-A's Chunk Candidates and Join Enrichment around it.
//
// What these cases are for: WF-E REPLACES four nodes that were carefully reasoned in WF-A
// (Get Contract Plan / Attach Plan / Get Replacements / Attach Replacements). A staging
// change that silently altered the plan parsing would move money, so the parsing is tested
// against the ORIGINAL regex forms as well as against expected values.
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, '..');
const READ = fs.readFileSync(path.join(D, 'nodes', 'read_chunk.js'), 'utf8');
const PLAN = fs.readFileSync(path.join(D, 'nodes', 'project_plan.js'), 'utf8');
const REPL = fs.readFileSync(path.join(D, 'nodes', 'project_replacements.js'), 'utf8');
const CHUNK = fs.readFileSync(path.join(D, 'wfa', 'chunk_candidates.js'), 'utf8');
const JOIN = fs.readFileSync(path.join(D, 'wfa', 'join_enrichment.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}
function throws(fn, label, wants) {
  try { fn(); fail++; console.log('FAIL ' + label + '\n       -> did not throw'); }
  catch (e) {
    const good = !wants || e.message.indexOf(wants) !== -1;
    if (good) { pass++; console.log('ok   ' + label + '\n       -> ' + e.message.split('.')[0].slice(0, 110)); }
    else { fail++; console.log('FAIL ' + label + '\n       -> wrong error: ' + e.message.slice(0, 140)); }
  }
}
function run(src, inputItems, nodes) {
  const $ = (n) => {
    if (!(n in nodes)) throw new Error('unexpected $(' + n + ')');
    const a = nodes[n];
    return { all: () => a, first: () => a[0] };
  };
  const logs = [];
  const out = new Function('$input', '$', 'console', src)(
    { all: () => inputItems, first: () => inputItems[0] }, $, { log: m => logs.push(m) });
  // PICK THE STAGE LOG BY NAME, NOT BY POSITION. This used to take the last line logged, which
  // was true right up until the circuit breaker was pasted into these nodes and started logging
  // after the stage summary - at which point ten assertions began reading the breaker's counters
  // and reporting that the node had stopped counting denials. Nothing was wrong with the node.
  // Position is not identity; it was not for the nodes on the canvas either.
  const parsed = logs.map(function (l) { try { return JSON.parse(l); } catch (e) { return {}; } });
  const stageLogs = parsed.filter(function (l) { return String(l.stage || '').indexOf('wfe_') === 0; });
  return { out: out,
           log: stageLogs.length ? stageLogs[stageLogs.length - 1] : (parsed.length ? parsed[parsed.length - 1] : {}),
           logs: parsed,
           logOf: function (stage) {
             const m = parsed.filter(function (l) { return l.stage === stage; });
             return m.length ? m[m.length - 1] : null;
           } };
}

const BEARER = 'Bearer test.token.value';
function cand(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push({ case_key: 'c' + i + ':2026-07', contract_id: '90000' + i, client_id: '5' + i });
  return a;
}
// A plan response shaped like the live one (measured 2026-08-18: 33 top-level keys,
// currentPayment.amountValue, paymentPlan with prose discount fields and a paymentsInfo array).
function planResp(amount, additional, creditNote, info, extra) {
  return Object.assign({
    currentPayment: amount === undefined ? undefined : { amountValue: amount },
    paymentPlan: { additionalDiscount: additional === undefined ? '' : additional,
                  creditNoteDiscount: creditNote === undefined ? '' : creditNote,
                  paymentsInfo: info || [] }
  }, extra || {});
}
function replResp(rows, total) {
  return { content: rows || [], totalElements: total === undefined ? (rows || []).length : total };
}

// ---------------------------------------------------------------- 1. Read Chunk
{
  const r = run(READ, [{ json: { bearer: BEARER, cases: cand(3), chunk_index: 2, run_id: 'r1' } }], {});
  ok(r.out.length === 3 && r.out[0].json.chunk_index === 2 && r.out[0].json.bearer === BEARER,
    'Read Chunk fans one item out per candidate, carrying the chunk index');
  throws(() => run(READ, [{ json: { bearer: 'nope', cases: cand(1) } }], {}),
    'Read Chunk refuses a bearer without the scheme', 'no usable bearer');
  throws(() => run(READ, [{ json: { bearer: BEARER, cases: [] } }], {}),
    'Read Chunk refuses an empty chunk', 'non-empty');
  throws(() => run(READ, [{ json: { bearer: BEARER, cases: cand(1201) } }], {}),
    'Read Chunk refuses a chunk over the 1,200 ceiling', 'exceeds the ceiling');
  throws(() => run(READ, [{ json: { bearer: BEARER, cases: [{ case_key: 'k', contract_id: '1' }] } }], {}),
    'Read Chunk refuses a candidate missing an id rather than shortening the chunk', 'without a');
}

// ------------------------------------------------------------- 2. Project Plan
{
  const chunkItems = run(READ, [{ json: { bearer: BEARER, cases: cand(4), chunk_index: 0 } }], {}).out;
  const nodes = { 'Read Chunk': chunkItems };
  const responses = [
    planResp(4452, 'Discount Amount: 1000 applied on Service Fees over 4 months', '',
             ['AED 4452 (Monthly)', 'AED 1200 (One Time Payment)']),
    planResp(5712, '', 'Credit Note Amount: 0 applied on Service Fee', ['AED 5712 (Monthly)']),
    planResp('', '', '', []),
    { status: 500, error: 'Internal Server Error', path: '/clientmgmt/client/get-client-details' }
  ].map(j => ({ json: j }));
  const r = run(PLAN, responses, nodes);
  const p = r.out.map(x => x.json.plan);

  ok(p[0].expected_gross === 4452 && p[0].expected_amount_known === true,
    'expected comes from currentPayment.amountValue, unmultiplied');
  ok(p[0].additional_discount.present === true && p[0].additional_discount.amount === 1000 &&
     p[0].additional_discount.months === 4 && p[0].additional_discount.per_month === 250,
    '1000 over 4 months parses as 250 a month, not 1000 off this month');
  ok(p[0].gate4_departure && p[0].gate4_departure.needs_ruling === true,
    'a discount sets gate4_departure so the reviewer sees rule and code disagree');
  ok(p[0].monthly_info_line.indexOf('(Monthly)') !== -1 && p[0].one_time_line.indexOf('One Time') !== -1,
    'the Monthly line and the first-month One Time stub are separated');
  ok(p[1].credit_note_discount.present === false && p[1].credit_note_discount.text !== '',
    'a NON-EMPTY string describing a ZERO discount is not a discount');
  ok(p[2].expected_amount_known === false && p[2].expected_gross === null,
    'an empty amountValue is unknown, never zero');
  ok(p[3].fetch_failed === true && p[3].expected_amount_known === false,
    'an ERP error body is a fetch failure, not a contract with no rate');
  ok(r.log.plan_fetch_failures === 1 && r.log.unreadable_expected_amount === 2 &&
     r.log.with_a_discount === 1 && r.log.with_first_month_stub === 1,
    'the stage log counts failures, unreadable rates, discounts and stubs',
    JSON.stringify(r.log));

  throws(() => run(PLAN, responses.slice(0, 3), nodes),
    'Project Plan refuses a response/candidate count mismatch', 'Positional pairing is broken');
}

// THE REGEX REWRITE IS PROVED EQUIVALENT, not assumed. WF-E writes every pattern with
// character classes ([.] for a dot, [ ]+ for a space) because a backslash class is what
// gets eaten shipping a body into a Code node as a string. These are the ORIGINAL patterns
// from WF-A's Attach Plan, run against the same strings.
{
  const strings = [
    'Discount Amount: 1000 applied on Service Fee over 4 months',
    'Discount Amount: 1,500.50 applied on Service Fees over 12 months',
    'Credit Note Amount: 0 applied on Service Fee',
    'Discount Amount: 250 applied on Service Fee',
    'Discount Amount: -300 applied over 3 months',
    '   ',
    'AED 4452 (Monthly)',
    'AED 1200 (One  Time Payment)'
  ];
  let equivalent = true, detail = '';
  for (const t of strings) {
    const oldNum = /(-?[0-9][0-9,]*(?:\.[0-9]+)?)/.exec(t);
    const newNum = /(-?[0-9][0-9,]*(?:[.][0-9]+)?)/.exec(t);
    const oldMon = /over\s+([0-9]+)\s+month/i.exec(t);
    const newMon = /over[ ]+([0-9]+)[ ]+month/i.exec(t);
    const oldMonthly = /\(Monthly\)/i.test(t), newMonthly = /[(]Monthly[)]/i.test(t);
    const oldOne = /\(One\s*Time/i.test(t), newOne = /[(]One[ ]*Time/i.test(t);
    const same = String(oldNum && oldNum[1]) === String(newNum && newNum[1]) &&
                 String(oldMon && oldMon[1]) === String(newMon && newMon[1]) &&
                 oldMonthly === newMonthly && oldOne === newOne;
    if (!same) { equivalent = false; detail = 'diverged on: ' + t; break; }
  }
  ok(equivalent, 'the character-class patterns match the original backslash patterns exactly', detail);
}

// ------------------------------------------------- 3. Project Replacements
{
  const chunkItems = run(READ, [{ json: { bearer: BEARER, cases: cand(4), chunk_index: 1 } }], {}).out;
  const planOut = run(PLAN, [planResp(1000), planResp(1000), planResp(1000), planResp(1000)]
    .map(j => ({ json: j })), { 'Read Chunk': chunkItems }).out;
  const nodes = { 'Read Chunk': chunkItems, 'Project Plan': planOut };
  const responses = [
    replResp([{ replacementDate: '2026-06-26T12:28:00', oldHousemaid: { id: '7', label: 'X' },
                newHousemaid: { id: '8', label: 'Y' }, oldHousemaidDaysSpentWithClient: 120,
                replacementReason: 'client request', done: true }]),
    // newHousemaid "" is the no-successor signal gate 7 turns on, and the other spelling
    // of the date field is the one ERP's docs also use.
    replResp([{ replacmentDate: '2026-07-02', oldHousemaid: { id: '9', label: 'Z' },
                newHousemaid: '', done: false }]),
    replResp([{ replacementDate: '2026-05-01' }], 5),           // declared 5, got 1 -> truncated
    { status: 401, error: 'Unauthorized', message: 'INSUFFICIENT_PERMISSIONS' }
  ].map(j => ({ json: j }));
  const r = run(REPL, responses, nodes);
  const e = r.out[0].json.enriched;

  ok(r.out.length === 1 && Array.isArray(e) && e.length === 4,
    'the whole chunk collapses to ONE item carrying one delta per candidate');
  ok(e[0].replacements[0].date === '2026-06-26' && e[0].replacements[0].old_days_with_client === 120,
    'the replacement date is truncated to a day and the day-count is carried');
  ok(e[1].replacements[0].date === '2026-07-02', 'the alternate date spelling is read too');
  ok(e[1].replacements[0].new_housemaid.empty === true,
    'newHousemaid "" reads as no successor, not as a missing field');
  ok(e[2].replacements_meta.truncated === true,
    'a short read against a declared total is flagged, since it would hide a maid change');
  ok(e[3].replacements_meta.fetch_failed === true && e[3].replacements_meta.permission_denied === true,
    'the known 401 is counted separately, so a grant landing shows as this falling to zero');
  ok(e[3].plan && e[3].plan.expected_amount_known === true,
    'a failed replacement read does not cost the case its plan');
  ok(r.log.permission_denied === 1 && r.log.truncated_histories === 1 && r.log.candidates === 4,
    'the stage log separates denials from other failures', JSON.stringify(r.log));

  throws(() => run(REPL, responses.slice(0, 2), nodes),
    'Project Replacements refuses a pairing mismatch', 'Positional pairing is broken');
}

// -------------------------------------------- 4. Chunk Candidates (in WF-A)
{
  // erp_call_budget is set explicitly because this suite exercises CHUNKING, not the ERP
  // pre-flight budget gate that now sits in the same node - its fixtures are deliberately
  // larger than the 2,000-call default. The gate has its own suite,
  // offline/preflight_gate_test.js, which is where its behaviour is pinned.
  const validated = { run_id: 'run-1',
    params: { erp_auth: { bearer: BEARER }, erp_call_budget: 1000000 } };
  const cases = [];
  for (let i = 0; i < 1600; i++) cases.push({ json: { case_key: 'k' + i, contract_id: 'c' + i,
    client_id: 'cl' + i, months: { '2026-07': { monthly_net: 1 } }, needs_enrichment: true } });
  const r = run(CHUNK, cases, { 'Validate Inputs': [{ json: validated }] });
  ok(r.out.length === 4 && r.out[0].json.cases.length === 50 &&
     r.out[1].json.cases.length === 750 && r.out[2].json.cases.length === 750 &&
     r.out[3].json.cases.length === 50,
    '1,600 candidates split into a 50-candidate canary + 750 + 750 + 50');
  ok(r.out[0].json.is_canary === true && r.out[1].json.is_canary === false,
    'the canary is flagged as one, so a reader of the log can tell why chunk 0 is small');
  ok(r.log.calls_before_the_breaker_can_first_speak === 100,
    'the canary buys the first breaker verdict at 100 calls instead of 1,500, and the log says so');
  ok(Object.keys(r.out[0].json.cases[0]).length === 3,
    'only the three ids cross the boundary, not the whole case');
  ok(r.log.calls_this_will_make === 3200,
    'the log states the call count, which is the cost this staging does NOT reduce');

  const capped = run(CHUNK, cases, { 'Validate Inputs': [{ json:
    { run_id: 'r', params: { erp_auth: { bearer: BEARER }, enrich_chunk_size: 5000,
        erp_call_budget: 1000000 } } }] });
  ok(capped.out.every(c => c.json.cases.length <= 1200),
    'a caller asking for a chunk bigger than WF-E allows is clamped, not passed through');

  const none = run(CHUNK, [], { 'Validate Inputs': [{ json: validated }] });
  ok(none.out.length === 0 && none.log.chunks === 0,
    'zero candidates is a real state (gate 1 closed the cohort) and not an error');

  throws(() => run(CHUNK, cases, { 'Validate Inputs': [{ json: { params: {} } }] }),
    'Chunk Candidates refuses to fan out without a bearer', 'no usable bearer');
}

// ---------------------------------------------- 5. Join Enrichment (in WF-A)
{
  const scalars = [];
  for (let i = 0; i < 5; i++) scalars.push({ json: { case_key: 'k' + i, contract_id: 'c' + i,
    client_id: 'cl' + i, months: { '2026-07': { monthly_net: 100 + i } }, needs_enrichment: true } });
  function delta(i) { return { case_key: 'k' + i, contract_id: 'c' + i, client_id: 'cl' + i,
    plan: { expected_gross: 1000 + i, expected_amount_known: true, fetch_failed: false },
    replacements: [], replacements_meta: { fetch_failed: false, permission_denied: false, rows: 0 } }; }
  const chunkA = { json: { enriched: [delta(0), delta(1), delta(2)], _chunk_index: 0 } };
  const chunkB = { json: { enriched: [delta(3), delta(4)], _chunk_index: 1 } };
  const nodes = { 'Needs enrichment?': scalars };
  const r = run(JOIN, [chunkA, chunkB], nodes);
  ok(r.out.length === 5, 'every case comes back out, once');
  ok(r.out[3].json.plan.expected_gross === 1003 && r.out[3].json.months['2026-07'].monthly_net === 103,
    'the delta is joined onto the RIGHT case across a chunk boundary');
  ok(r.out[0].json.replacements_meta && Array.isArray(r.out[0].json.replacements),
    'the emitted shape matches what the old Attach Replacements handed Merge Streams');

  throws(() => run(JOIN, [chunkA], nodes),
    'a lost chunk is a hard error, not a batch of cases with no rate', 'no enrichment delta');
  throws(() => run(JOIN, [chunkA, chunkB, { json: { enriched: [delta(1)], _chunk_index: 2 } }], nodes),
    'a case appearing in two chunks is refused rather than scored twice', 'more than one chunk');
  throws(() => run(JOIN, [{ json: { rows: [] } }], nodes),
    'a return with no enriched array is refused', 'no enriched array');
}

// ------------------------------- 6. against the REAL client-details response
// Optional: only runs when the live probe from 2026-08-18 is present in the session
// scratchpad. It asserts FLAGS ONLY - never the amount, which is client financial data.
{
  const live = process.env.WFE_LIVE_PLAN_FIXTURE;
  if (live && fs.existsSync(live)) {
    const resp = JSON.parse(fs.readFileSync(live, 'utf8'));
    const chunkItems = run(READ, [{ json: { bearer: BEARER, cases: cand(1), chunk_index: 0 } }], {}).out;
    const r = run(PLAN, [{ json: resp }], { 'Read Chunk': chunkItems });
    const p = r.out[0].json.plan;
    ok(p.fetch_failed === false && p.expected_amount_known === true,
      'the live get-client-details response yields a readable expected rate');
    ok(typeof p.expected_gross === 'number' && p.expected_gross > 0,
      'the parsed rate is a positive number (value deliberately not printed)');
    ok(Array.isArray(p.payments_info), 'paymentsInfo is read as an array of prose lines');
  } else {
    console.log('skip  live client-details fixture not present (set WFE_LIVE_PLAN_FIXTURE)');
  }
}

// =====================================================================================
// FAILURE CLASSIFICATION (added 2026-08-19, fixing a detector that read 0 for everything)
//
// The shapes below are what n8n's continueRegularOutput actually hands a Code node when the
// HTTP call fails - an ERROR OBJECT, not the HTTP body. Every one of these was previously
// classified as "not a permission denial", which is how the counter read 0 while all 750
// replacement calls in execution 93346 were failing.
// =====================================================================================
function n8nError(httpCode, message, extra) {
  // The NodeApiError shape: the interesting text is NESTED, and String() on it yields
  // '[object Object]'. That single fact is what the old detector tripped over.
  return { error: Object.assign({
    name: 'NodeApiError', httpCode: String(httpCode), message: message,
    description: message, context: { httpCode: String(httpCode) }
  }, extra || {}) };
}
function replRun(responses, n) {
  const chunkItems = run(READ, [{ json: { bearer: BEARER, cases: cand(n), chunk_index: 0 } }], {}).out;
  const planItems = run(PLAN, responses.map(() => ({ json: planResp(5712) })),
    { 'Read Chunk': chunkItems }).out;
  return run(REPL, responses.map(r => ({ json: r })),
    { 'Project Plan': planItems, 'Read Chunk': chunkItems });
}

// --- the exact shape that defeated the old detector -----------------------------------
{
  const r = replRun([n8nError(401, '401 - {"developermessage":"INSUFFICIENT_PERMISSIONS"}'),
                     replResp([])], 2);
  ok(r.log.permission_denied === 1,
     'a NESTED n8n error object with httpCode 401 is counted as a permission denial',
     'counted ' + r.log.permission_denied + ' (the old detector counted 0 here)');
  ok(r.log.permission_denied_unmarked === 0,
     'an INSUFFICIENT_PERMISSIONS denial is not flagged as unmarked');
  // Project Replacements collapses the chunk to ONE item - {enriched:[...]} - which is the
  // whole point of the sub-workflow, so the per-case meta lives one level in.
  const meta0 = r.out[0].json.enriched[0].replacements_meta;
  ok(meta0.permission_denied === true && meta0.token_dead === false,
     'the per-case meta records denied, not dead');
  ok(r.log.token_dead === 0 && r.log.other_failures === 0,
     'a denial is not miscounted as a dead token or an unclassified failure');
  ok(Array.isArray(r.log.failure_samples) && r.log.failure_samples.length === 1,
     'one raw failure sample is carried, so the next reader sees the real shape');
}
// --- every replacement call denied: the real steady state of this route ---------------
{
  const r = replRun([n8nError(401, 'INSUFFICIENT_PERMISSIONS'),
                     n8nError(401, 'INSUFFICIENT_PERMISSIONS'),
                     n8nError(401, 'INSUFFICIENT_PERMISSIONS')], 3);
  ok(r.log.permission_denied === 3 && r.log.replacement_fetch_failures === 3,
     'a fully denied route counts every call, and does NOT throw - gate 7 is built for it');
  ok(r.out[0].json.enriched.length === 3,
     'every candidate still comes back from a fully denied chunk');
}
// --- a bare 403 with no ERP marker: still a denial, but flagged as unmarked ------------
{
  const r = replRun([n8nError(403, 'Forbidden'), replResp([])], 2);
  ok(r.log.permission_denied === 1 && r.log.permission_denied_unmarked === 1,
     'a bare 403 counts as denied AND as unmarked, so a vocabulary change is visible');
}
// --- a dead token is a different animal and must stop the chunk -----------------------
throws(() => replRun([n8nError(401, 'UNAUTHORIZED <LOGOUT>'), replResp([])], 2),
  'a logged-out token throws instead of scoring empty maid histories as "no change"',
  'DEAD TOKEN');
throws(() => replRun([n8nError(401, 'UNAUTHENTICATED'), replResp([])], 2),
  'UNAUTHENTICATED throws too');
throws(() => replRun([{ error: { message: '500 - {"status":498,"error":"token has expired"}' } }], 1),
  'the 498-inside-500 shape is recognised as a dead token, not a server error');
// --- something genuinely unclassified is counted, never interpreted -------------------
{
  const r = replRun([n8nError(502, 'Bad Gateway'), replResp([])], 2);
  ok(r.log.other_failures === 1 && r.log.permission_denied === 0 && r.log.token_dead === 0,
     'a 502 is counted as an unclassified failure, not folded into either bucket');
}

// --- the plan side, which had no classifier at all ------------------------------------
function planRun(responses, n) {
  const chunkItems = run(READ, [{ json: { bearer: BEARER, cases: cand(n), chunk_index: 0 } }], {}).out;
  return run(PLAN, responses.map(r => ({ json: r })), { 'Read Chunk': chunkItems });
}
throws(() => planRun([n8nError(401, 'UNAUTHORIZED <LOGOUT>'), planResp(5712)], 2),
  'a dead token on the plan read throws rather than reporting the rate as merely unknown',
  'DEAD TOKEN');
throws(() => planRun([n8nError(500, 'Internal Server Error'),
                      n8nError(500, 'Internal Server Error')], 2),
  'a chunk where EVERY plan read failed throws - 7 of 7 probed contracts answered 200',
  'all 2 plan reads');
{
  const r = planRun([n8nError(404, 'Not Found'), planResp(5712)], 2);
  ok(r.log.plan_fetch_failures === 1 && r.log.plan_token_dead === 0,
     'ONE unreadable plan is still a per-contract "cannot tell", not a run-stopper');
  ok(r.out[0].json.plan.expected_amount_known === false &&
     r.out[1].json.plan.expected_amount_known === true,
     'the readable contract in the same chunk is unaffected');
}

// =========================================================================================
// THE CIRCUIT BREAKER, AS EMBEDDED IN THESE NODES (ERP-LOAD-POLICY.md §5).
//
// tools/offline/breaker_test.js already proves the canonical logic. What is proved HERE is the
// COPY: that the generated block actually runs inside these two node bodies, reads the stamp
// Read Chunk leaves, survives the absence of n8n static data, and - the one that matters -
// does not trip on the permanent 401 that every replacement call returns.
// =========================================================================================
console.log('\n--- circuit breaker, in place ---');
{
  const denials = [];
  for (let i = 0; i < 40; i++) denials.push(n8nError(401, 'INSUFFICIENT_PERMISSIONS'));
  const r = replRun(denials, 40);
  ok(r.out.length === 1 && r.out[0].json._candidates === 40,
     'a chunk of 40 straight permission denials passes the breaker untouched');
  const bl = r.logOf('erp_breaker');
  ok(bl !== null, 'the breaker logged its verdict');
  ok(bl && bl.counts.auth === 40 && bl.tripped === null,
     'the denials are counted as auth, and nothing tripped');
  ok(bl && bl.consecutive_max === 0,
     '40 consecutive denials do not count as one consecutive degradation');
  ok(bl && bl.baseline_carried === false,
     'no static data offline, so it reports the baseline as not carried rather than inventing one');
  // 2026-08-24: IT NOW PASSES FOR A DIFFERENT REASON, AND THAT REASON MUST BE VISIBLE.
  // The canonical breaker gained an auth-wall rule - a batch that was refused outright with not
  // one success stops the run, because a missing grant cannot heal and the remaining calls are
  // load for zero information. This phase is the single declared exception in the repo (the
  // denial is account-scoped, the same chunk's plan phase succeeded, and the gap is already
  // reported), so its call site passes config.authWall:false in writing.
  //
  // The assertions above would now be green EITHER because auth is harmless OR because someone
  // silenced the rule. These two separate those readings: the wall was SEEN, and it was
  // deliberately not enforced. If the opt-out is ever removed, this block fails loudly instead
  // of a run dying in production with no test having noticed.
  ok(bl && bl.auth_wall === true,
     'the wall IS detected - 40 refusals and not one success - and is written to the run log');
  ok(bl && bl.auth_wall_enforced === false,
     '...and is passing only because THIS call site declares an opt-out, not because it went unseen');
}
{
  // The opt-out is for the permission path only. Degradation still stops this node.
  const mixed = [];
  for (let i = 0; i < 20; i++) mixed.push(n8nError(401, 'INSUFFICIENT_PERMISSIONS'));
  for (let i = 0; i < 5; i++) mixed.push(n8nError(503, 'Service Unavailable'));
  let threw = '';
  try { replRun(mixed, 25); } catch (e) { threw = e.message; }
  ok(threw.indexOf('ERP CIRCUIT BREAKER TRIPPED') !== -1 && threw.indexOf('5 consecutive') !== -1,
     'opting out of the auth wall does NOT opt this node out of degradation', threw.slice(0, 160));
}
{
  const resp = [];
  for (let i = 0; i < 10; i++) resp.push(planResp(5712));
  for (let i = 0; i < 5; i++) resp.push(n8nError(503, 'Service Unavailable'));
  for (let i = 0; i < 10; i++) resp.push(planResp(5712));
  throws(() => planRun(resp, 25),
    'five consecutive 503s in the plan phase stops the chunk before the replacement phase fires',
    'ERP CIRCUIT BREAKER TRIPPED');
}
{
  const resp = [];
  for (let i = 0; i < 10; i++) resp.push(planResp(5712));
  for (let i = 0; i < 4; i++) resp.push(n8nError(503, 'Service Unavailable'));
  for (let i = 0; i < 10; i++) resp.push(planResp(5712));
  const r = planRun(resp, 24);
  ok(r.out.length === 24, 'four consecutive 503s do not stop it - a blip is not a breakdown');
}
{
  // A quarter of the batch failing, never twice in a row. Nothing about this is a blip, and the
  // consecutive rule alone would never see it.
  const resp = [];
  for (let i = 0; i < 60; i++) resp.push(i % 3 === 0 ? n8nError(502, 'Bad Gateway') : planResp(5712));
  throws(() => planRun(resp, 60),
    'scattered failure that never reaches five in a row still trips, on rate',
    'of 60 responses were 5xx');
}

console.log('\n' + pass + '/' + (pass + fail) + ' assertions passed');
process.exit(fail ? 1 : 0);
