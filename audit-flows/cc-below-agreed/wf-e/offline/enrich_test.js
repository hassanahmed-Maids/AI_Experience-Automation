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
const RESTORE = fs.readFileSync(path.join(D, 'nodes', 'restore_chunk_items.js'), 'utf8');
const SKIP = fs.readFileSync(path.join(D, 'nodes', 'skip_replacements.js'), 'utf8');
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


// =========================================================================================
// THE CLIENTREPLACEMENT GRANT PROBE AND THE SKIP PATH (added 2026-08-24).
//
// `Fetch Replacements` used to be called once per candidate on an account that is refused every
// single time - ~5,632 requests per run, all of them known to fail before they were sent. The
// phase is now gated by ONE probe per sub-execution:
//
//   Project Plan -> Probe Replacements Grant (executeOnce) -> Restore Chunk Items
//                -> Replacements Granted? --true--> Fetch Replacements -> Project Replacements
//                                        \--false-> Skip Replacements
//
// What these cases pin, in order of how expensive getting them wrong would be:
//   1. THE DECLARED GAP SURVIVES. A skipped chunk reports the SAME permission-denied count a
//      fully refused chunk reports - the number of contracts that were not attempted. Trading
//      5,632 wasted calls for a false all-clear would be a bad deal; this is the assertion that
//      says the deal was not made.
//   2. The fan-out is restored: 750 items go into Fetch Replacements, not the single probe item.
//   3. An inconclusive probe RUNS the phase. A transient must never read as a missing grant.
//   4. A dead token still throws, and is never reported as a permission gap.
// =========================================================================================
console.log('\n--- the grant probe and the skip path ---');

function probeRun(probeResponses, n, chunkIndex) {
  const chunkItems = run(READ, [{ json: { bearer: BEARER, cases: cand(n),
                                          chunk_index: chunkIndex === undefined ? 3 : chunkIndex,
                                          run_id: 'run-probe' } }], {}).out;
  const planItems = run(PLAN, cand(n).map(function () { return { json: planResp(5712) }; }),
    { 'Read Chunk': chunkItems }).out;
  const nodes = { 'Read Chunk': chunkItems, 'Project Plan': planItems };
  const list = Array.isArray(probeResponses) ? probeResponses : [probeResponses];
  return { nodes: nodes, planItems: planItems,
           restored: run(RESTORE, list.map(function (j) { return { json: j }; }), nodes) };
}
const GRANTED_PROBE = replResp([{ replacementDate: '2026-06-26', oldHousemaid: { id: '1', label: 'A' },
                                  newHousemaid: { id: '2', label: 'B' } }]);
const DENIED_PROBE = n8nError(401, '401 - {"developermessage":"INSUFFICIENT_PERMISSIONS"}');

// ---- 1. the probe is answered YES: nothing about today's behaviour changes ---------------
{
  const p = probeRun(GRANTED_PROBE, 12);
  ok(p.restored.out.length === 12,
     'a granted probe hands back one item per candidate - the fan-out Fetch Replacements needs');
  ok(p.restored.out.every(function (i) { return i.json._replacements_granted === true; }),
     'every restored item carries the grant verdict, so the IF routes the whole chunk together');
  ok(p.restored.out[5].json.contract_id === p.planItems[5].json.contract_id &&
     p.restored.out[5].json.plan && p.restored.out[5].json.plan.expected_amount_known === true,
     'the restored items are Project Plan\'s items, in order, with the plan delta intact');
  ok(p.restored.log.probe_verdict === 'granted' &&
     p.restored.log.replacement_calls_this_chunk_will_make === 12,
     'the log states the verdict and what the chunk is about to spend');
}

// ---- 2. the probe is REFUSED: the phase is skipped and the gap is declared ---------------
{
  const N = 40;
  const p = probeRun(DENIED_PROBE, N);
  ok(p.restored.out.every(function (i) { return i.json._replacements_granted === false; }),
     'a refused probe routes the whole chunk down the skip path');
  ok(p.restored.log.probe_verdict === 'denied' && p.restored.log.replacement_calls_avoided === N,
     'the log names the refusal and the calls it just avoided', JSON.stringify(p.restored.log));

  const sk = run(SKIP, p.restored.out, p.nodes);
  const out = sk.out[0].json;

  // ------------------------------------------------------------------ THE PIN THAT MATTERS
  ok(out._replacement_permission_denied === N,
     'THE DECLARED GAP: the skipped chunk reports ' + N + ' permission-denied contracts - the ' +
     'number NOT ATTEMPTED - not 0, which would read downstream as a complete run',
     'got ' + out._replacement_permission_denied);
  ok(out._replacement_fetch_failures === N && out._candidates === N && out.enriched.length === N,
     'every candidate comes back, and every one of them is declared unread');
  ok(out.enriched.every(function (e) {
       return e.replacements_meta.fetch_failed === true &&
              e.replacements_meta.permission_denied === true &&
              e.replacements_meta.token_dead === false &&
              Array.isArray(e.replacements) && e.replacements.length === 0; }),
     'each case carries fetch_failed AND permission_denied, so coveredDays() reports coverage ' +
     'UNKNOWN rather than walking an empty history as "no maid change"');
  ok(out.enriched.every(function (e) { return e.replacements_meta.not_attempted === true; }),
     'the skip is legible: not_attempted separates "we did not ask" from "we were refused"');
  ok(out._replacement_phase_skipped === true && out._replacement_skip.calls_avoided === N,
     'the run log can say how many ERP calls this chunk did not make');
  ok(out._chunk_index === 3,
     'the chunk index is carried, so a skipped chunk is still identifiable in the run log');
  ok(sk.log.permission_denied === N && sk.log.replacement_calls_made === 0,
     'the stage log declares the same gap and states that zero calls were made');
}

// ---- 3. the skip output is INDISTINGUISHABLE from a fully refused chunk ------------------
// This is the same claim as above, made the only way that really settles it: run both paths
// over the same chunk and compare what WF-A receives, field by field. If these two ever diverge,
// a denied account starts scoring differently depending on whether the calls were made - which
// is precisely what must not happen.
{
  const N = 25;
  const denials = [];
  for (let i = 0; i < N; i++) denials.push(n8nError(401, 'INSUFFICIENT_PERMISSIONS'));
  const refused = replRun(denials, N).out[0].json;

  // Same chunk index as replRun uses, because _chunk_index is one of the compared fields and a
  // difference there would be an artefact of the fixture rather than of the two paths.
  const p = probeRun(n8nError(401, 'INSUFFICIENT_PERMISSIONS'), N, 0);
  const skipped = run(SKIP, p.restored.out, p.nodes).out[0].json;

  const counters = ['_candidates', '_plan_fetch_failures', '_replacement_fetch_failures',
                    '_replacement_permission_denied', '_replacement_permission_denied_unmarked',
                    '_replacement_other_failures', '_projected_by', '_chunk_index'];
  const differing = counters.filter(function (k) {
    return JSON.stringify(refused[k]) !== JSON.stringify(skipped[k]); });
  ok(differing.length === 0,
     'skipping reports the SAME counters WF-A reads as making all ' + N + ' calls and being ' +
     'refused - the load changed, what the audit knows did not',
     'differ: ' + differing.join(', '));

  const metaKeys = ['fetch_failed', 'permission_denied', 'token_dead', 'rows', 'declared_total',
                    'truncated'];
  const metaDiff = metaKeys.filter(function (k) {
    return JSON.stringify(refused.enriched[0].replacements_meta[k]) !==
           JSON.stringify(skipped.enriched[0].replacements_meta[k]); });
  ok(metaDiff.length === 0,
     'and the per-case replacements_meta gate 7 reads is identical on both paths',
     'differ: ' + metaDiff.join(', '));

  const missing = Object.keys(refused).filter(function (k) {
    return !Object.prototype.hasOwnProperty.call(skipped, k); });
  ok(missing.length === 0,
     'the skip emits every top-level key Project Replacements emits - WF-A cannot tell which ' +
     'node produced this item', 'missing: ' + missing.join(', '));

  // And WF-A actually accepts it, rather than the shape merely looking right here.
  const scalars = [];
  for (let i = 0; i < N; i++) scalars.push({ json: { case_key: 'c' + i + ':2026-07',
    contract_id: '90000' + i, client_id: '5' + i, needs_enrichment: true } });
  const j = run(JOIN, [{ json: skipped }], { 'Needs enrichment?': scalars });
  ok(j.out.length === N && j.logOf('join_enrichment').replacement_permission_denied === N,
     'Join Enrichment joins a skipped chunk and rolls the SAME denial count into the run log');
}

// ---- 4. an unmarked refusal is charged to the whole chunk --------------------------------
{
  const N = 6;
  const p = probeRun(n8nError(403, 'Forbidden'), N);
  const out = run(SKIP, p.restored.out, p.nodes).out[0].json;
  ok(out._replacement_permission_denied === N && out._replacement_permission_denied_unmarked === N,
     'a bare 403 probe still declares the gap, and marks all ' + N + ' as UNMARKED so a change ' +
     'in ERP\'s error vocabulary shows up as a number rather than as silence');
}

// ---- 5. an INCONCLUSIVE probe runs the phase anyway ---------------------------------------
// The safe direction, and the one that is easy to get wrong: a 503 on the one probe call must
// not be allowed to mean "no grant", or a single bad second converts a whole chunk into declared
// non-coverage. It costs calls and loses nothing.
{
  const p = probeRun(n8nError(503, 'Service Unavailable'), 8);
  ok(p.restored.out.every(function (i) { return i.json._replacements_granted === true; }),
     'a 503 on the probe is INCONCLUSIVE and the phase runs - a transient is never a missing grant');
  ok(p.restored.log.probe_verdict === 'inconclusive',
     '...and it is logged as inconclusive rather than quietly as granted');
  const p404 = probeRun(n8nError(404, 'Not Found'), 8);
  ok(p404.restored.log.probe_verdict === 'inconclusive' &&
     p404.restored.out[0].json._replacements_granted === true,
     'so is a 404 - only 401/403 without a dead-token marker is read as a refusal');
}

// ---- 6. a dead token throws, and is never reported as a permission gap --------------------
throws(function () { probeRun(n8nError(401, 'UNAUTHORIZED <LOGOUT>'), 5); },
  'a logged-out probe throws instead of skipping the phase and blaming a missing grant',
  'DEAD TOKEN');
throws(function () { probeRun({ error: { message: '500 - {"status":498,"error":"token has expired"}' } }, 5); },
  'the 498-inside-500 shape is a dead token on the probe too, not a refusal');

// ---- 7. the two structural refusals ------------------------------------------------------
throws(function () { probeRun([GRANTED_PROBE, GRANTED_PROBE], 5); },
  'more than one probe response means executeOnce was lost - refused loudly rather than ' +
  'silently making the whole phase of calls again', 'executeOnce');
{
  const p = probeRun(DENIED_PROBE, 10);
  throws(function () { run(SKIP, p.restored.out.slice(0, 4), p.nodes); },
    'a partial route is refused: an under-declared gap reads downstream as coverage the run ' +
    'never had', 'partial declaration');
}

// ---- 8. the two things about Project Replacements that were NOT changed -------------------
// Source pins rather than behavioural ones, and said so. Both are decisions, not oversights, and
// both are recorded on the node itself (parameters.notes) and in wf-e/README.md.
//
// THE DIVISOR STAYS 2N. A granted chunk now makes 2N+1 ERP calls - N plan reads, ONE grant probe,
// N replacement reads - while `callsMade` still says 2N and `elapsedMs` (stamped in Read Chunk)
// now includes the probe. The bias that introduces is +0.07% on the divisor against a threshold
// of 3x, which moves no verdict. It is left alone because correcting it means re-transmitting
// 35 KB of the node that classifies permission denials, dead tokens and every breaker input by
// hand, and a transcription error there is the one class of mistake this repo cannot detect from
// a stale-export check. Nothing offline can tell 2N from 2N+1 anyway: ms_per_call rounds to 0
// when Read Chunk stamped the clock microseconds earlier, so this is a source pin by necessity.
ok(REPL.indexOf('callsMade: responses.length * 2,') !== -1,
   'Project Replacements still divides the chunk latency by 2N - the probe is a documented ' +
   '0.07% under-count, not an unnoticed one');
// THE AUTH-WALL OPT-OUT STAYS. The probe removed the everyday full-denial batch - on a denied
// account this node is no longer reached at all - but not the case the probe cannot cover: the
// grant answering the probe and then refusing the batch behind it. All three conditions the
// call site declares still hold there, and the probe re-runs per sub-execution, so a mid-run
// revocation is re-detected by the next chunk and every chunk after it skips. Removing the
// opt-out would buy nothing and would let one optional grant kill a run.
ok(REPL.indexOf('config: { authWall: false }') !== -1,
   'the declared auth-wall opt-out is still in place, and deliberately so');


// =========================================================================================
console.log('\n--- WF-A probes once per RUN, and WF-E takes its word for it (or does not) ---');
// The last hop of the same argument. WF-E's own probe is once per CHUNK, because a WF-E
// execution IS a chunk; WF-A runs once per run, so probing there and passing the verdict down
// makes a denied run cost ONE refused call instead of one per chunk. At the deployed chunk size
// of 750 that is 8 calls saved out of ~11,264 - 0.06% - and it is worth having only because it
// is total: after it, the number of calls known to be refused before they were sent is one.
//
// Three properties are pinned below, and the third is the one that keeps WF-E usable at all:
//   1. the three-way verdict survives the hop - inconclusive still RUNS the phase;
//   2. a caller-supplied `denied` declares exactly the same gap as a chunk that made 750 calls
//      and was refused 750 times;
//   3. WITH THE FLAG ABSENT NOTHING CHANGES. WF-E is callable standalone and by older callers,
//      so an unusable verdict falls back to WF-E's own probe rather than being interpreted.

// ---- the deployed IF condition, executed rather than eyeballed ---------------------------
// `Caller Passed a Verdict?` is an IF, and its condition is the only piece of logic in this flow
// the harness cannot reach through a Code body. So the expression is mirrored in
// nodes/caller_verdict_gate.js and run here for real. If the deployed node and that file ever
// diverge, this suite is testing something that is not live - which is why the deploy report
// diffs the two.
const GATE_SRC = fs.readFileSync(path.join(D, 'nodes', 'caller_verdict_gate.js'), 'utf8');
const GATE_EXPR = GATE_SRC.split('\n').filter(function (l) {
  return l.trim() !== '' && l.trim().indexOf('//') !== 0; }).join('\n').trim();
const gate = new Function('$', 'return (' + GATE_EXPR + ');');
function gateWith(payload) {
  return gate(function (n) {
    if (n !== 'When Called') throw new Error('unexpected $(' + n + ') in the gate expression');
    return { first: function () { return { json: payload }; }, all: function () { return [{ json: payload }]; } };
  });
}
{
  ok(gateWith({ replacements_grant: 'granted' }) === true &&
     gateWith({ replacements_grant: 'denied' }) === true &&
     gateWith({ replacements_grant: 'inconclusive' }) === true,
     'the gate recognises all THREE verdicts - not a boolean, and not two of them');
  ok(gateWith({}) === false,
     'FLAG ABSENT: the gate routes to WF-E\'s own probe, so an older caller behaves as it always did');
  ok(gateWith({ replacements_grant: '' }) === false &&
     gateWith({ replacements_grant: null }) === false &&
     gateWith({ replacements_grant: undefined }) === false,
     '...and so do empty, null and undefined - n8n fills a declared-but-unsent string with "", ' +
     'which must read as "nothing was passed" and never as a verdict');
  ok(gateWith({ replacements_grant: 'maybe' }) === false &&
     gateWith({ replacements_grant: 'true' }) === false &&
     gateWith({ replacements_grant: 42 }) === false &&
     gateWith({ replacements_grant: true }) === false &&
     gateWith({ replacements_grant: { verdict: 'denied' } }) === false,
     'an unrecognised value is DISTRUSTED, never interpreted - there is no fourth meaning and no ' +
     'default verdict');
  ok(gateWith({ replacements_grant: '  DENIED  ' }) === true,
     'case and padding are normalised, because the gate and Apply Caller Verdict must agree on ' +
     'exactly which strings are verdicts');
}

// ---- Apply Caller Verdict: the verdict lands, and no probe call is made -------------------
const APPLY = fs.readFileSync(path.join(D, 'nodes', 'apply_caller_verdict.js'), 'utf8');
function callerRun(payloadExtra, n, chunkIndex) {
  const payload = Object.assign({ bearer: BEARER, cases: cand(n),
    chunk_index: chunkIndex === undefined ? 3 : chunkIndex, run_id: 'run-caller' }, payloadExtra);
  const chunkItems = run(READ, [{ json: payload }], {}).out;
  const planItems = run(PLAN, cand(n).map(function () { return { json: planResp(5712) }; }),
    { 'Read Chunk': chunkItems }).out;
  const nodes = { 'Read Chunk': chunkItems, 'Project Plan': planItems,
                  'When Called': [{ json: payload }] };
  return { nodes: nodes, planItems: planItems,
           applied: run(APPLY, planItems, nodes) };
}
{
  const g = callerRun({ replacements_grant: 'granted' }, 12);
  ok(g.applied.out.length === 12 &&
     g.applied.out.every(function (i) { return i.json._replacements_granted === true; }),
     'a caller-supplied GRANTED runs the phase over the whole chunk, with no probe call here');
  ok(g.applied.log.probed_here === false && g.applied.log.probe_calls_avoided === 1 &&
     g.applied.log.probe_source === 'caller',
     'the log states plainly that this chunk did not ask ERP anything and where the answer came from');
  ok(g.applied.out[7].json.contract_id === g.planItems[7].json.contract_id &&
     g.applied.out[7].json.plan && g.applied.out[7].json.plan.expected_amount_known === true,
     'the items handed on are Project Plan\'s items, in order, with the plan delta intact');

  const inc = callerRun({ replacements_grant: 'inconclusive' }, 8);
  ok(inc.applied.out.every(function (i) { return i.json._replacements_granted === true; }) &&
     inc.applied.log.probe_verdict === 'inconclusive',
     'INCONCLUSIVE SURVIVES THE HOP: the phase runs anyway, and it is logged as inconclusive ' +
     'rather than quietly as granted - a transient at WF-A must never become a whole RUN of ' +
     'declared non-coverage');
}

// ---- a caller-supplied DENIED declares exactly the same gap -------------------------------
{
  const N = 40;
  const d = callerRun({ replacements_grant: 'denied',
    replacements_grant_probe: { http_code: 401, marked: true, source: 'wf-a-run-probe' } }, N);
  ok(d.applied.out.every(function (i) { return i.json._replacements_granted === false; }),
     'a caller-supplied DENIED routes the whole chunk down the skip path');
  const out = run(SKIP, d.applied.out, d.nodes).out[0].json;
  ok(out._replacement_permission_denied === N && out._replacement_fetch_failures === N &&
     out._candidates === N && out.enriched.length === N,
     'THE DECLARED GAP IS UNCHANGED BY THE HOP: ' + N + ' contracts declared unread - the number ' +
     'NOT ATTEMPTED - not 0, which would read downstream as a complete run',
     'got ' + out._replacement_permission_denied);
  ok(out.enriched.every(function (e) {
       return e.replacements_meta.fetch_failed === true &&
              e.replacements_meta.permission_denied === true &&
              e.replacements_meta.token_dead === false; }),
     'and every case still carries fetch_failed + permission_denied, so coveredDays() reports ' +
     'coverage UNKNOWN and gate 7 caps it');
}

// ---- THE THREE PATHS ARE INDISTINGUISHABLE, which is the whole safety argument ------------
// Same chunk, same denial, three routes to it: 25 real 401s through Project Replacements; WF-E's
// own probe refused; WF-A's probe refused and the verdict passed down. If any two of these ever
// diverge, a denied account starts scoring differently depending on WHERE the refusal was
// discovered - which is precisely what must not happen.
{
  const N = 25;
  const denials = [];
  for (let i = 0; i < N; i++) denials.push(n8nError(401, 'INSUFFICIENT_PERMISSIONS'));
  const refused = replRun(denials, N).out[0].json;

  const p = probeRun(n8nError(401, 'INSUFFICIENT_PERMISSIONS'), N, 0);
  const skippedByOwnProbe = run(SKIP, p.restored.out, p.nodes).out[0].json;

  const c = callerRun({ replacements_grant: 'denied',
    replacements_grant_probe: { http_code: 401, marked: true, source: 'wf-a-run-probe' } }, N, 0);
  const skippedByCaller = run(SKIP, c.applied.out, c.nodes).out[0].json;

  const counters = ['_candidates', '_plan_fetch_failures', '_replacement_fetch_failures',
                    '_replacement_permission_denied', '_replacement_permission_denied_unmarked',
                    '_replacement_other_failures', '_projected_by', '_chunk_index'];
  const dA = counters.filter(function (k) {
    return JSON.stringify(refused[k]) !== JSON.stringify(skippedByCaller[k]); });
  ok(dA.length === 0,
     'a caller-supplied denial reports the SAME counters WF-A reads as making all ' + N + ' calls ' +
     'and being refused', 'differ: ' + dA.join(', '));
  const dB = counters.filter(function (k) {
    return JSON.stringify(skippedByOwnProbe[k]) !== JSON.stringify(skippedByCaller[k]); });
  ok(dB.length === 0,
     '...and the same counters as WF-E probing for itself - the hop changed the load, not what ' +
     'the audit knows', 'differ: ' + dB.join(', '));

  const metaKeys = ['fetch_failed', 'permission_denied', 'token_dead', 'rows', 'declared_total',
                    'truncated', 'not_attempted'];
  const mD = metaKeys.filter(function (k) {
    return JSON.stringify(skippedByOwnProbe.enriched[0].replacements_meta[k]) !==
           JSON.stringify(skippedByCaller.enriched[0].replacements_meta[k]); });
  ok(mD.length === 0, 'and the per-case replacements_meta gate 7 reads is identical on both skip ' +
     'paths', 'differ: ' + mD.join(', '));

  const missing = Object.keys(refused).filter(function (k) {
    return !Object.prototype.hasOwnProperty.call(skippedByCaller, k); });
  ok(missing.length === 0,
     'the caller-driven skip emits every top-level key Project Replacements emits - WF-A cannot ' +
     'tell which of the three paths produced this item', 'missing: ' + missing.join(', '));

  const scalars = [];
  for (let i = 0; i < N; i++) scalars.push({ json: { case_key: 'c' + i + ':2026-07',
    contract_id: '90000' + i, client_id: '5' + i, needs_enrichment: true } });
  const j = run(JOIN, [{ json: skippedByCaller }], { 'Needs enrichment?': scalars });
  ok(j.out.length === N && j.logOf('join_enrichment').replacement_permission_denied === N,
     'Join Enrichment joins a caller-skipped chunk and rolls the SAME denial count into the run log');
}

// ---- the diagnostic detail is optional, and its absence is visible rather than baked in ----
{
  const N = 6;
  const bare = callerRun({ replacements_grant: 'denied',
    replacements_grant_probe: { http_code: 403, marked: false, source: 'wf-a-run-probe' } }, N);
  const outBare = run(SKIP, bare.applied.out, bare.nodes).out[0].json;
  ok(outBare._replacement_permission_denied === N &&
     outBare._replacement_permission_denied_unmarked === N,
     'an UNMARKED refusal survives the hop too: a bare 403 at WF-A still charges all ' + N + ' as ' +
     'unmarked, so a change in ERP\'s error vocabulary shows up as a number and not as silence');

  const noDetail = callerRun({ replacements_grant: 'denied' }, N);
  ok(noDetail.applied.log.probe_detail_absent === true &&
     noDetail.applied.log.probe_http_code === null,
     'a verdict sent WITHOUT the diagnostic object is accepted, and the log says the detail was ' +
     'absent rather than pretending to a status code it never saw');
  const outNoDetail = run(SKIP, noDetail.applied.out, noDetail.nodes).out[0].json;
  ok(outNoDetail._replacement_permission_denied === N &&
     outNoDetail._replacement_permission_denied_unmarked === 0,
     '...and the gap is still declared in full; only the unmarked count defaults, to the measured ' +
     'shape of this route');
}

// ---- the structural refusals on the new path ----------------------------------------------
throws(function () { callerRun({ replacements_grant: 'probably' }, 5); },
  'Apply Caller Verdict refuses an unusable verdict rather than defaulting - reaching it with ' +
  'one means the IF and this node no longer agree', 'not one of');
{
  const c = callerRun({ replacements_grant: 'denied' }, 10);
  throws(function () { run(APPLY, c.planItems.slice(0, 4), c.nodes); },
    'a partial route is refused here too: the verdict is a property of the RUN, so both paths ' +
    'must carry the entire chunk', 'partial chunk');
}

// ---- FALLBACK PROOF: with the flag absent, WF-E is byte-for-byte the flow it was ----------
// The gate says route to the probe; the probe path then produces exactly what the caller path
// produces. Both halves are asserted, because either one alone would let a regression through:
// a gate that routed correctly into a broken probe path, or a probe path that worked but was
// never reached.
{
  const N = 25;
  ok(gateWith({ bearer: BEARER, cases: cand(N), chunk_index: 0, run_id: 'r' }) === false,
     'FALLBACK: a trigger payload with no replacements_grant at all routes to Probe Replacements ' +
     'Grant, which is WF-E\'s behaviour before WF-A ever learned to probe');
  const p = probeRun(n8nError(401, 'INSUFFICIENT_PERMISSIONS'), N, 0);
  const fallback = run(SKIP, p.restored.out, p.nodes).out[0].json;
  const c = callerRun({ replacements_grant: 'denied',
    replacements_grant_probe: { http_code: 401, marked: true, source: 'wf-a-run-probe' } }, N, 0);
  const viaCaller = run(SKIP, c.applied.out, c.nodes).out[0].json;
  ok(JSON.stringify(fallback) === JSON.stringify(viaCaller),
     '...and what it produces is IDENTICAL, key for key and value for value, to what the caller ' +
     'path produces - so the fallback is not a degraded mode, it is the same answer bought at a ' +
     'higher price');
}

// ---- WF-A's Classify Grant Probe: the node that actually asks, once per run ---------------
// It is a WF-A body, so it is mirrored in wf-e/wfa/ alongside Chunk Candidates and Join
// Enrichment and tested here rather than in a separate file - the thing being tested is the
// boundary, and the boundary has two ends.
const CLASSIFY = fs.readFileSync(path.join(D, 'wfa', 'classify_grant_probe.js'), 'utf8');
// Built in the shape the DEPLOYED Chunk Candidates emits - {bearer, cases, chunk_index, run_id} -
// rather than by running that node, so this section cannot be knocked over by a change to
// chunking.
function chunksOf(sizes) {
  return sizes.map(function (n, i) {
    return { json: { bearer: BEARER, cases: cand(n), chunk_index: i, run_id: 'run-wfa' } }; });
}
function classifyRun(probeResponses, sizes) {
  const chunkItems = chunksOf(sizes);
  const list = Array.isArray(probeResponses) ? probeResponses : [probeResponses];
  return run(CLASSIFY, list.map(function (j) { return { json: j }; }),
             { 'Chunk Candidates': chunkItems });
}
{
  const g = classifyRun(GRANTED_PROBE, [50, 750, 750]);
  ok(g.out.length === 3 &&
     g.out.every(function (i) { return i.json.replacements_grant === 'granted'; }),
     'ONE probe answers for the WHOLE RUN: every chunk carries the verdict, and the chunk\'s own ' +
     'payload is passed through untouched beside it');
  ok(g.out[1].json.cases.length === 750 && g.out[1].json.chunk_index === 1 &&
     g.out[1].json.bearer === BEARER,
     '...untouched meaning exactly that - bearer, cases and chunk_index are the ones WF-E already ' +
     'expects, so the contract only grew');
  ok(g.out[0].json.replacements_grant_probe.marked === true &&
     g.out[0].json.replacements_grant_probe.source === 'wf-a-run-probe',
     'the diagnostic object rides along and names where the verdict came from');

  const d = classifyRun(DENIED_PROBE, [50, 750, 750]);
  ok(d.out.every(function (i) { return i.json.replacements_grant === 'denied'; }) &&
     d.log.replacement_calls_avoided === 1550 && d.log.wfe_probes_avoided === 3,
     'a refused probe denies the whole run in ONE call, and the log states both what it saved ' +
     '(1,550 refused replacement calls) and that it also removed 3 per-chunk probes',
     JSON.stringify(d.log));
  ok(d.out[0].json.replacements_grant_probe.http_code === 401 &&
     d.out[0].json.replacements_grant_probe.marked === true,
     'and it carries the http code and the INSUFFICIENT_PERMISSIONS marker down, so WF-E\'s ' +
     'unmarked counter keeps meaning what it means');

  const bare = classifyRun(n8nError(403, 'Forbidden'), [10]);
  ok(bare.out[0].json.replacements_grant === 'denied' &&
     bare.out[0].json.replacements_grant_probe.marked === false,
     'a bare 403 is still a denial, and is flagged UNMARKED so a change in ERP\'s error ' +
     'vocabulary surfaces as a number');

  const inc = classifyRun(n8nError(503, 'Service Unavailable'), [750, 750]);
  ok(inc.out.every(function (i) { return i.json.replacements_grant === 'inconclusive'; }) &&
     inc.log.replacement_calls_this_run_will_make === 1500,
     'a 503 on the ONE probe is INCONCLUSIVE and the whole run still makes its calls - at this ' +
     'end of the hop a transient would otherwise cost an entire run, not one chunk');
  ok(classifyRun(n8nError(404, 'Not Found'), [10]).out[0].json.replacements_grant === 'inconclusive',
     'so is a 404 - only 401/403 without a dead-token marker is read as a refusal');
}
throws(function () { classifyRun(n8nError(401, 'UNAUTHORIZED <LOGOUT>'), [10]); },
  'a logged-out probe throws in WF-A, before the enrichment phase, instead of blaming a missing ' +
  'grant for a dead session', 'DEAD TOKEN');
throws(function () { classifyRun([GRANTED_PROBE, GRANTED_PROBE], [10, 10]); },
  'more than one probe response means executeOnce was lost on WF-A\'s probe - refused loudly ' +
  'rather than silently making one refused call per chunk again', 'executeOnce');
{
  const none = classifyRun(GRANTED_PROBE, []);
  ok(none.out.length === 0 && none.log.chunks === 0,
     'ZERO CHUNKS IS LEGITIMATE IN WF-A and is the one place the two ends differ: gate 1 can ' +
     'close out the whole cohort, so this returns [] where WF-E\'s Restore Chunk Items throws');
}
// THE TWO ENDS MUST NOT DRIFT APART. Both nodes decide what a refusal is, and if they ever
// disagree the same 401 means "denied" at one end and something else at the other. The four
// classifier functions are therefore lifted verbatim, and that is asserted rather than promised.
{
  const fns = ['function httpCodeOf(o) {', 'function failureText(o) {',
               'function isTokenDead(text) {', 'function isPermissionDenied(code, text) {'];
  const drift = fns.filter(function (sig) {
    const a = RESTORE.indexOf(sig), b = CLASSIFY.indexOf(sig);
    if (a === -1 || b === -1) return true;
    return RESTORE.slice(a, RESTORE.indexOf('\n}', a)) !== CLASSIFY.slice(b, CLASSIFY.indexOf('\n}', b));
  });
  ok(drift.length === 0,
     'WF-A and WF-E classify a refusal with byte-identical code - one 401 cannot mean two things ' +
     'depending on which end of the hop saw it', 'drifted: ' + drift.join(', '));
}

// ---- source pins for the two things deliberately NOT changed ------------------------------
// WF-A's Chunk Candidates still projects cohort_size x 2 for the §3 budget gate. With WF-A
// probing once per run the true cost is 2N+1 on a granted run and N+1 on a denied one, so the
// projection is now ONE call low on a granted run (0.009%) and ~5,631 calls HIGH on a denied one.
// Both errors are in the safe direction for a gate that hard-fails on over-projection. It is left
// alone for the same reason the callsMade divisor was: correcting it means hand-retransmitting
// the 9 KB body of the node that decides whether the run is allowed to start at all, and that is
// a worse risk than a one-call under-projection. Declared, not hidden.
ok(CHUNK.indexOf('const ERP_CALLS_PER_ENTITY = 2;') !== -1,
   'Chunk Candidates still declares 2 calls per entity - the WF-A probe is a documented one-call ' +
   'under-projection, not an unnoticed one');
ok(REPL.indexOf('config: { authWall: false }') !== -1,
   'the auth-wall opt-out is STILL in place - and now it is what lets a mid-run revocation cost ' +
   'the rest of the run in refused calls instead of killing the run; see wf-e/README.md');

console.log('\n' + pass + '/' + (pass + fail) + ' assertions passed');
process.exit(fail ? 1 : 0);
