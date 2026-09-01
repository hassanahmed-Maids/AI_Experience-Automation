'use strict';
// Runs the REAL Code-node bodies from the deployed workflow, offline, against
// the pinned fixture - the same technique that proved the generated scorer.
//
// WHY THIS AND NOT A PINNED n8n RUN. A pinned run of the happy path needs 260
// population rows to clear the cohort floor, which is ~45 KB of payload that
// has to be inlined into the test call by hand. This executes the very same
// node code with stubbed n8n accessors, costs nothing, and tests the nodes that
// a pinned run would have exercised - Validate Inputs, Verify Population Pull,
// ERP Budget Gate, Verify History Pull, Build Run Row, Build Case Rows and
// Format Run Summary.
//
// WHAT IT DOES NOT COVER, stated plainly: the n8n wiring itself - which node
// feeds which - and the Workbook IF's routing. Those are read from the workflow
// graph below rather than executed.
const fs = require('fs');

const wf = JSON.parse(fs.readFileSync('./_workflow.json', 'utf8')).workflow;
const fx = JSON.parse(fs.readFileSync('./happy.json', 'utf8'));
const pin = fx.pinDataSlimHistory;

const codeOf = name => {
  const n = wf.nodes.find(n => n.name === name);
  if (!n) throw new Error('node not found: ' + name);
  if (!n.parameters || typeof n.parameters.jsCode !== 'string') throw new Error('not a Code node: ' + name);
  return n.parameters.jsCode;
};

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  if (String(actual) === String(expected)) { pass++; console.log('  ok   %s -> %s', label, actual); }
  else { fail++; console.log('  FAIL %s -> got %s, expected %s', label, actual, expected); }
};

// --- a tiny n8n shim -------------------------------------------------------
const outputs = {};
const run = (name, inputItems, jsonCtx) => {
  const $ = ref => {
    if (!(ref in outputs)) throw new Error('no output recorded for node: ' + ref);
    const items = outputs[ref];
    return { first: () => items[0], all: () => items };
  };
  const $input = { first: () => inputItems[0], all: () => inputItems };
  const $json = jsonCtx !== undefined ? jsonCtx : (inputItems[0] && inputItems[0].json);
  const fn = new Function('$', '$input', '$json', codeOf(name));
  const res = fn($, $input, $json);
  outputs[name] = res;
  return res;
};

console.log('\n=== Real node bodies, offline, against the fixture ===');

// Build Manual Run Context -> Validate Inputs
outputs['Manual Trigger'] = pin['Manual Trigger'];
run('Build Manual Run Context', pin['Manual Trigger']);
const vi = run('Validate Inputs', outputs['Build Manual Run Context']);
check('Validate Inputs resolves the default workbook_id',
  (vi[0].json.workbook_id || '').slice(0, 10), '1jBz1WkAtp');
check('Validate Inputs carries the bearer through', vi[0].json.erp_bearer, 'Bearer offline-pinned-fixture');
check('Validate Inputs windows on the month just ended', /^\d{4}-\d{2}-01$/.test(vi[0].json.range_start), 'true');

// Preflight -> ERP Budget Gate
outputs['Preflight Count Population'] = pin['Preflight Count Population'];
outputs['Preflight Count History'] = pin['Preflight Count History'];
const gate = run('ERP Budget Gate', pin['Preflight Count History']);
check('budget gate projects population pages', gate[0].json.population_pages, Math.ceil(260 / 40));
check('budget gate projects history pages', gate[0].json.history_pages, Math.ceil(262 / 40));
check('budget gate default budget', gate[0].json.budget, 600);

// Verify Population Pull
const vpp = run('Verify Population Pull', pin['Get Population']);
check('population reconciles', vpp[0].json.population_complete, true);
check('population row count', vpp[0].json.cohort_count, 260);

// Verify History Pull
outputs['Get Trailing History'] = pin['Get Trailing History'];
const vhp = run('Verify History Pull', pin['Get Trailing History']);
check('history reconciles', vhp[0].json.history_complete, true);

// Score Cases
const sc = run('Score Cases', vhp);
const s = sc[0].json.summary;
check('clean', s.rows_clean, fx.expected.clean);
check('pending', s.rows_pending, fx.expected.pending);
check('finding', s.rows_finding, fx.expected.finding);
check('inconclusive', s.rows_inconclusive, fx.expected.inconclusive);
check('rows needing a verdict word', s.rows_needing_a_verdict_word, fx.expected.needing_a_verdict_word);

// Build Run Row
const brr = run('Build Run Row', sc, sc[0].json);
const r = brr[0].json;
check('run row carries the unnamed-verdict count', r.rows_needing_a_verdict_word, fx.expected.needing_a_verdict_word);
check('run row marks the workbook as on', r.workbook_written, true);
check('run row overall', r.overall, 'findings');
check('run row names the blocked surfaces',
  /INSUFFICIENT_PERMISSIONS/.test(r.blocked_surfaces) ? 'named' : 'missing', 'named');
check('run row declares the unimplemented rules',
  /NOT PASSED/.test(r.rules_not_implemented) ? 'declared' : 'missing', 'declared');

// Build Case Rows
const bcr = run('Build Case Rows', sc);
check('case rows written (out-of-population excluded)', bcr.length, 260);
const words = {};
for (const it of bcr) { const k = it.json.verdict_word || '(none)'; words[k] = (words[k] || 0) + 1; }
check('case rows carry the spec word for clean', words['One application, one price'], 250);
check('case rows carry the spec word for the duplicate', words['Duplicate application'], 1);
check('case rows leave unnamed states blank', words['(none)'], fx.expected.needing_a_verdict_word);
check('needs_verdict_word flagged on exactly those',
  bcr.filter(i => i.json.needs_verdict_word === true).length, fx.expected.needing_a_verdict_word);
check('no maid NAME field is ever written',
  bcr.some(i => Object.keys(i.json).some(k => /name/i.test(k))) ? 'LEAKED' : 'none', 'none');

// Format Run Summary
const frs = run('Format Run Summary', brr);
const body = frs[0].json.body;
check('summary is counts-only: no maid id appears',
  /maid[_ ]?id/i.test(body) || /\b7000\d\d\b/.test(body) ? 'LEAKED' : 'clean', 'clean');
check('summary declares the degraded run', /DEGRADED RUN/.test(body) ? 'declared' : 'missing', 'declared');
check('summary states nothing is a finding until a human reads it',
  /until a human has read/.test(body) ? 'present' : 'missing', 'present');

// --- wiring, read from the graph rather than executed -----------------------
console.log('\n=== Wiring (read from the workflow graph) ===');
const conn = wf.connections;
const goesTo = (from, to) => ((conn[from] || {}).main || []).some(o => (o || []).some(c => c.node === to));
check('Write Cases -> Workbook Declared?', goesTo('Write Cases', 'Workbook Declared?'), true);
check('Workbook Declared? true -> Cases -> Workbook',
  (((conn['Workbook Declared?'] || {}).main || [])[0] || []).some(c => c.node === 'Cases -> Workbook'), true);
check('Workbook Declared? false -> Format Run Summary',
  (((conn['Workbook Declared?'] || {}).main || [])[1] || []).some(c => c.node === 'Format Run Summary'), true);
// The shared ERP lease was removed so the flow is self-contained for the SD
// publish request: NF deploys one workflow, not a workflow plus a dependency in
// someone else's project. Assert no sub-workflow call has crept back in.
check('no shared-lease dependency remains',
  wf.nodes.filter(n => /executeWorkflow/i.test(n.type)).length, 0);
check('nothing still routes to a lease node',
  Object.values(conn).flatMap(s => (s.main || []).flat())
    .filter(c => c && /Lease/i.test(c.node)).length, 0);
check('crash trigger -> failure draft', goesTo('On Workflow Crash', 'Format Failure Email'), true);
check('Format Failure Email -> Draft: audit failed', goesTo('Format Failure Email', 'Draft: audit failed'), true);


// === Which ERP the run talks to ===============================================
// The run bearer is interpolated into the Authorization header of every ERP
// node, so params.erp_env decides who receives the operator's credential. It is
// resolved through a closed allowlist; these assert the allowlist actually
// closes, and that a non-production run cannot quietly pose as a real audit.
console.log('\n=== Environment switch (Validate Inputs) ===');

const PROD_BASE = 'https://erpbackendpro.maids.cc';
const STAGING_BASE = 'https://backstaging.maids.cc:9443';
const viCode = codeOf('Validate Inputs');

// Re-run the validator standalone so the pipeline's own output is not clobbered.
const validateWith = params => {
  const base = outputs['Build Manual Run Context'][0].json;
  const item = { json: JSON.parse(JSON.stringify(base)) };
  item.json.body.params = Object.assign({}, base.body.params, params);
  const $ = ref => ({ first: () => outputs[ref][0], all: () => outputs[ref] });
  const $input = { first: () => item, all: () => [item] };
  return new Function('$', '$input', '$json', viCode)($, $input, item.json)[0].json;
};
const refusalFrom = params => {
  try { validateWith(params); return '(accepted)'; }
  catch (e) { return /erp_env must be one of/.test(e.message) ? 'refused' : 'wrong error: ' + e.message; }
};

const prod = validateWith({});
check('omitted erp_env means production', prod.erp_base, PROD_BASE);
check('production run id is not tagged', /^staging-/.test(prod.run_id), 'false');
check('production keeps the real workbook', (prod.workbook_id || '').slice(0, 10), '1jBz1WkAtp');

const stg = validateWith({ erp_env: 'staging' });
check('erp_env staging resolves the staging base', stg.erp_base, STAGING_BASE);
check('staging run id is tagged', /^staging-/.test(stg.run_id), 'true');
check('staging defaults away from the real workbook', stg.workbook_id, '');
check('staging still carries the bearer', stg.erp_bearer, 'Bearer offline-pinned-fixture');

check('an explicit workbook still wins on staging',
  validateWith({ erp_env: 'staging', workbook_id: 'sheet-for-rehearsals' }).workbook_id, 'sheet-for-rehearsals');

// The allowlist is the point: a hostname must never reach it as data.
check('a raw host is refused', refusalFrom({ erp_env: 'https://attacker.example.com' }), 'refused');
check('an unknown tier is refused', refusalFrom({ erp_env: 'dev' }), 'refused');
check('erp_env staging2 resolves the live STG2 tier',
  validateWith({ erp_env: 'staging2' }).erp_base, 'https://stagingiibackerp.maids.cc');
check('staging2 run id is tagged', /^staging2-/.test(validateWith({ erp_env: 'staging2' }).run_id), 'true');
check('staging2 defaults away from the real workbook',
  validateWith({ erp_env: 'staging2' }).workbook_id, '');
check('an empty erp_env is refused', refusalFrom({ erp_env: '' }), 'refused');

// Every ERP node must read the resolved base - a leftover hard-coded host would
// send a staging run's traffic, and its token, to production.
const erpNodes = ['Get Population', 'Get Trailing History', 'Preflight Count Population', 'Preflight Count History'];
for (const name of erpNodes) {
  const url = wf.nodes.find(n => n.name === name).parameters.url;
  check(name + ' reads erp_base', /erp_base/.test(url) && !/erpbackendpro/.test(url), 'true');
}

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
