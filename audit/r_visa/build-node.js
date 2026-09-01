// Builds the body of the n8n "Assemble and Score Cases" Code node from the
// tested scorer plus the driver, so the flow and the offline tests cannot drift.
//
//   node audit/r_visa/build-node.js          # writes dist/score-node.js
//   node audit/r_visa/build-node.js --check  # exits 1 if dist is stale
//
// The generated file is committed. `--check` is what catches someone editing
// scorer.js and forgetting to redeploy the node.

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUT = path.join(DIR, 'dist', 'score-node.js');

function build() {
  const scorer = fs.readFileSync(path.join(DIR, 'scorer.js'), 'utf8');
  const driver = fs.readFileSync(path.join(DIR, 'driver.js'), 'utf8');

  // Strip the CommonJS tail: an n8n Code node has no module object, and the
  // functions are already in scope for the driver appended below.
  const cut = scorer.indexOf('module.exports = {');
  if (cut === -1) throw new Error('scorer.js: module.exports block not found — build-node.js needs updating');
  const body = scorer.slice(0, cut).replace(/^'use strict';\n/m, '');

  const header =
    '// GENERATED FILE — do not edit here.\n' +
    '// Built by audit/r_visa/build-node.js from scorer.js + driver.js.\n' +
    '// This is the body of the "Assemble and Score Cases" node in\n' +
    '// n8n workflow 2yJCYs1YUZz7BVDG (R-Visa Audit · 1-Run).\n' +
    '// Edit scorer.js or driver.js and re-run the builder; never patch the node by hand.\n\n';

  return header + body + '\n' + driver;
}

const out = build();

if (process.argv.indexOf('--check') !== -1) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (existing !== out) {
    console.error('STALE: audit/r_visa/dist/score-node.js does not match scorer.js + driver.js.');
    console.error('Run: node audit/r_visa/build-node.js   then redeploy the node.');
    process.exit(1);
  }
  console.log('score-node.js is up to date with scorer.js + driver.js');
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');
console.log('wrote ' + OUT + ' (' + out.length + ' chars)');
