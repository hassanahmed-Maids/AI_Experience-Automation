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
check('Workbook Declared? false -> Release ERP Lease',
  (((conn['Workbook Declared?'] || {}).main || [])[1] || []).some(c => c.node === 'Release ERP Lease'), true);
check('crash trigger -> failure draft', goesTo('On Workflow Crash', 'Format Failure Email'), true);
check('Format Failure Email -> Draft: audit failed', goesTo('Format Failure Email', 'Draft: audit failed'), true);

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
