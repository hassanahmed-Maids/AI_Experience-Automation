'use strict';
/**
 * Generates the n8n "Score Cases" Code-node body from scorer.js.
 *
 * The golden sibling flow does the same thing with its circuit breaker
 * ("GENERATED - do not edit here. Canonical: audit-flows/tools/erp_breaker.js") and the
 * reason is the same: the offline scorer is the FIXED REFERENCE the flow is checked
 * against. If the two can drift, the reference stops being one — someone edits the node
 * in the n8n UI, the offline tests still pass, and the thing that actually runs is no
 * longer the thing that was tested.
 *
 * Run: node build-node.js   ->  dist/score-node.js
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'scorer.js'), 'utf8');

// Strip the CommonJS tail — n8n's Code sandbox has no module system.
const cut = src.indexOf('module.exports');
if (cut === -1) throw new Error('build-node: module.exports not found in scorer.js — refusing to guess where the code ends.');
const body = src.slice(0, cut).replace(/^'use strict';\n/, '').trimEnd();

const header = `// ===================== ENTRY VISA AUDIT — DETERMINISTIC SCORER =====================
// GENERATED — do not edit here. Canonical source: audit/entry-visa/scorer.js
// Re-generate with: node audit/entry-visa/build-node.js
//
// Edited in the n8n UI, this node silently stops matching the 23 offline tests that are
// the only proof it is correct. Change scorer.js, re-run the tests, re-generate.
//
// Pure: no I/O, no ERP, no clock of its own. The run date arrives on the input so a run
// is reproducible — scoring the same population twice must give the same answer, and a
// gate that read Date.now() directly would quietly stop doing that.
`;

const footer = `

// ------------------------------- n8n call site -------------------------------------
// Input: ONE item carrying { requests: [...], as_of, run_id }.
// Output: ONE item carrying the cases, the declared gaps and the summary.
//
// The cases carry per-entity amounts and identifiers and are destined for the CASE STORE.
// The summary carries counts, flags and totals only. Nothing here prints a name, a contact
// detail or a salary, and the run summary is the only part a human reads in passing.

const input = $input.first().json || {};

if (!input || !Array.isArray(input.requests)) {
  // FAIL CLOSED. An absent population is not an empty one. Returning zero cases here would
  // read as "nothing wrong this month", which is the false clearance this whole check
  // exists to prevent.
  throw new Error('Score Cases: no population supplied (input.requests is not an array). ' +
    'Refusing to score. An absent population must never be scored as a clean run.');
}

const asOf = input.as_of || null;
if (!asOf) {
  throw new Error('Score Cases: as_of is missing. Gates 7 and 8 measure elapsed days from it, ' +
    'so scoring without it would make the run non-reproducible and the elapsed-day guard meaningless.');
}

const result = score({ requests: input.requests }, { asOf: asOf });

return [{ json: {
  run_id: input.run_id || null,
  as_of: asOf,
  scorer_version: 'scorer.js@' + (input.scorer_sha || 'unpinned'),
  charge_cases: result.charge_cases,
  pair_cases: result.pair_cases,
  declared_gaps: result.declared_gaps,
  summary: result.summary
} }];`;

const out = header + '\n' + body + footer + '\n';
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'score-node.js'), out);
console.log('wrote dist/score-node.js  (' + out.length + ' chars, ' + out.split('\n').length + ' lines)');
