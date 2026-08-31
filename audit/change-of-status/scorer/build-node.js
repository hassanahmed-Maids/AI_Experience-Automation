'use strict';
// Generates the "Score Cases" Code-node body FROM score.js, so the n8n copy and
// the tested copy cannot drift. Until now they were maintained by hand and the
// node carried a comment admitting as much ("if this copy and that one ever
// disagree, that one is right") - which is a warning, not a mechanism.
//
//   node build-node.js > score-cases.node.js
//
// Paste the output into the Score Cases node, or feed it to update_workflow.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'score.js'), 'utf8');

// Strip the CommonJS wrapper: the node has no module system.
const core = src
  .replace(/^'use strict';\n/, '')
  .replace(/\nmodule\.exports[\s\S]*$/, '\n');

const glue = `
// ---------------------------------------------------------------------------
// n8n glue. Everything above is generated verbatim from
// audit/change-of-status/scorer/score.js, which carries the offline test suite.
// Do not hand-edit this node: change score.js, run its tests, regenerate.
// ---------------------------------------------------------------------------
const population = ($('Verify Population Pull').first().json.rows || []).map(project);

let historyRows = [];
for (const p of $('Get Trailing History').all()) {
  const b = p.json || {};
  if (Array.isArray(b.content)) for (const r of b.content) historyRows.push(project(r));
}
if (!historyRows.length) {
  throw new Error('Trailing history is empty. Rule 19 compares each charge against the same maid\\'s EARLIER charges, and a month compared only against itself finds 2 of the 10 known pairs. Refusing to score without history.');
}

const result = run(population, historyRows);
const pop = $('Verify Population Pull').first().json;
result.summary.history_rows = historyRows.length;
result.summary.pages_fetched = pop.pages_fetched;
result.summary.total_elements = pop.total_elements;
result.summary.population_complete = pop.population_complete;

return [{ json: { scored: result.scored, cases: result.cases, summary: result.summary } }];
`;

process.stdout.write(core + glue);
