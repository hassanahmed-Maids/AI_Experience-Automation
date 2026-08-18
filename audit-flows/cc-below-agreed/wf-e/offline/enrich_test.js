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
  return { out: out, log: logs.length ? JSON.parse(logs[logs.length - 1]) : {} };
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
  const validated = { run_id: 'run-1', params: { erp_auth: { bearer: BEARER } } };
  const cases = [];
  for (let i = 0; i < 1600; i++) cases.push({ json: { case_key: 'k' + i, contract_id: 'c' + i,
    client_id: 'cl' + i, months: { '2026-07': { monthly_net: 1 } }, needs_enrichment: true } });
  const r = run(CHUNK, cases, { 'Validate Inputs': [{ json: validated }] });
  ok(r.out.length === 3 && r.out[0].json.cases.length === 750 && r.out[2].json.cases.length === 100,
    '1,600 candidates split into 750 + 750 + 100');
  ok(Object.keys(r.out[0].json.cases[0]).length === 3,
    'only the three ids cross the boundary, not the whole case');
  ok(r.log.calls_this_will_make === 3200,
    'the log states the call count, which is the cost this staging does NOT reduce');

  const capped = run(CHUNK, cases, { 'Validate Inputs': [{ json:
    { run_id: 'r', params: { erp_auth: { bearer: BEARER }, enrich_chunk_size: 5000 } } }] });
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
    'a return with no `enriched` array is refused', 'no `enriched` array');
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

console.log('\n' + pass + '/' + (pass + fail) + ' assertions passed');
process.exit(fail ? 1 : 0);
