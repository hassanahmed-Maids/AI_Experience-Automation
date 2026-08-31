'use strict';
// Proves the GENERATED n8n node body produces the same result as the tested
// library, by running it against real ERP payloads with a stubbed `$`.
// Without this, "generated from score.js" is a claim rather than a check.
const fs = require('fs');
const S = require('./score.js');

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));   // real ERP rows
const body = fs.readFileSync('./score-cases.node.js', 'utf8');

// Stub the two n8n accessors the glue uses.
const $ = name => {
  if (name === 'Verify Population Pull') {
    return { first: () => ({ json: { rows: raw, pages_fetched: 18, total_elements: raw.length, population_complete: true } }) };
  }
  if (name === 'Get Trailing History') {
    return { all: () => [{ json: { content: raw } }] };
  }
  throw new Error('unexpected node ref: ' + name);
};

const out = new Function('$', body)($);
const generated = out[0].json.summary;

// Same inputs through the library directly.
const rows = raw.map(S.project);
const direct = S.run(rows, rows).summary;

const keys = Object.keys(direct).sort();
let diffs = 0;
for (const k of keys) {
  if (JSON.stringify(direct[k]) !== JSON.stringify(generated[k])) {
    console.log('  MISMATCH %s: library=%s generated=%s', k, direct[k], generated[k]);
    diffs++;
  }
}
console.log('generated node body vs tested library: %d field(s) compared, %d mismatch(es)', keys.length, diffs);
console.log('summary from the generated body:', JSON.stringify(generated));
process.exit(diffs ? 1 : 0);
