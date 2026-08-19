// Runs the month-scoped assertion suite against the GENERATED n8n Code-node
// body, not just the sources. A node body that has drifted from the scorer the
// harness proves is indistinguishable from a correct one until it reports a
// wrong number about a real client, so the shipped artefact is tested directly.
const { execFileSync } = require('child_process');
const path = require('path');

const targets = ['sources', './n8n/score-batch.gen.js'];
let bad = 0;
for (const t of targets) {
  try {
    const outp = execFileSync(process.execPath, [path.join(__dirname, 'test-month.js')], {
      cwd: __dirname, env: Object.assign({}, process.env, { SCORER: t }), encoding: 'utf8',
    });
    process.stdout.write(outp.trim() + '\n');
  } catch (e) {
    bad++;
    process.stdout.write((e.stdout || '') + (e.stderr || '') + '\n');
  }
}
console.log(bad ? '\nPARITY FAILED - the generated node body does not match the tested sources.'
                : '\nParity holds: the generated n8n node body passes the same suite as the sources.');
process.exit(bad ? 1 : 0);
