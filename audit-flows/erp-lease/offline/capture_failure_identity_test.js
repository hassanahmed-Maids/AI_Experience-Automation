/**
 * capture_failure_identity_test.js
 *
 * DOES EVERY CALLER STILL HAND THE LEASE A HOLDER ID WHEN THE RAIL FIRES?
 *
 * WHY THIS FILE EXISTS, AND WHY IT LIVES HERE. Execution 100774 (MV Overstay Fines,
 * 2026-08-24, manual run at 11:04 UTC) went:
 *
 *    2  Validate Inputs        success  -> run_id 'manual-100774-2026-06'
 *    5  Acquire ERP Lease      success  -> granted to that holder
 *   12  ERP Budget Gate        ERROR
 *   13  Capture Failure        success  -> emitted a SYNTHETIC { _failure: {...} } item
 *   14  Release Lease (error)  ERROR    -> "no run_id was passed"
 *
 * Node 5 and node 14 carried the IDENTICAL mapping - a bare cross-node lookup of
 * $('Validate Inputs').first().json.run_id. It resolved at 5 and resolved to nothing at 14, in
 * the same execution, and n8n then DROPPED the field rather than sending null: the lease received
 *   {"mode":"release","check_id":"mv-overstay-fines","ignore_lease":false,"max_wait_ms":null,
 *    "operator":null,"no_wait":null}
 * - run_id ABSENT, while every sibling field that is a LITERAL arrived intact. The node's
 * workflowInputs.schema does declare run_id, so it was not a schema omission.
 *
 * The lease refused, correctly and by design. THAT REFUSAL IS NOT THE BUG AND MUST NOT BE
 * WEAKENED - releasing without a holder id could free another audit's lease. The bug is a caller
 * that cannot say who it is. So the lease's own suite (lease_test.js, next to this file) proves
 * the lease refuses; THIS suite proves the callers no longer make it refuse.
 *
 * It reads the DEPLOYED bodies out of audit-flows/exports/*.json rather than a canonical source
 * file, because the thing that broke was what was deployed. Re-export before trusting a green run
 * (exports/README.md).
 *
 * The internal n8n reason for the failed lookup is NOT modelled and NOT relied on. The test only
 * asserts the property the fix actually needs: the identity is resolved while the lookup still
 * works and stamped onto the item, and nothing on the rail can throw.
 *
 *   node audit-flows/erp-lease/offline/capture_failure_identity_test.js
 */
const fs = require('fs');
const path = require('path');

const EXPORTS = path.join(__dirname, '..', '..', 'exports');

// Every flow with an error-rail release, and the node that heads its rail. Two flows head theirs
// with `Build Error Callback` instead of `Capture Failure`; both already resolved and stamped the
// identity before this change, and both are checked here on the same terms.
const FLOWS = [
  ['ccnonreceived-1-score.json',      'Capture Failure'],
  ['ccnonreceived-2-verify.json',     'Capture Failure'],
  ['ccprice-stage1.json',             'Capture Failure'],
  ['ccprice-stage2.json',             'Capture Failure'],
  ['ccprice-stage3.json',             'Capture Failure'],
  ['dummy-stage1-score.json',         'Capture Failure'],
  ['mv-overstay-fines.json',          'Capture Failure'],
  ['mv-stage1-population.json',       'Capture Failure'],
  ['mv-stage4-verify.json',           'Capture Failure'],
  ['realticket-audit-check.json',     'Capture Failure'],
  ['terminated-hm-stage1-score.json', 'Capture Failure'],
  ['wfb-verify.json',                 'Capture Failure'],
  ['wfc-deliver.json',                'Capture Failure'],
  ['wfa-parent.json',                 'Build Error Callback'],
  ['cc-overstay-fines.json',          'Build Error Callback'],
];

const SENTINEL = 'run-under-test-100774';

// One object carrying the run id at EVERY path this repo spells it, because every flow's validate
// node has a different name and a different shape: run_id, runId, leaseRunId, params.run_id,
// body.runId, _baton.run_id. Supplying all of them lets one fixture serve fifteen flows without
// the test quietly asserting the wrong field for any of them.
function allSources() {
  return {
    run_id: SENTINEL, runId: SENTINEL, leaseRunId: SENTINEL,
    check_id: 'check-under-test', callback_url: 'https://portal.invalid/cb',
    params: { run_id: SENTINEL, runId: SENTINEL, check_id: 'check-under-test' },
    body:   { run_id: SENTINEL, runId: SENTINEL, check_id: 'check-under-test' },
    _baton: { run_id: SENTINEL, check_id: 'check-under-test' },
  };
}

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}

function load(file) {
  const d = JSON.parse(fs.readFileSync(path.join(EXPORTS, file), 'utf8'));
  return d.workflow || d;
}

function nodeBody(w, name) {
  for (const n of w.nodes) if (n.name === name) return (n.parameters || {}).jsCode;
  return null;
}

/**
 * Run a rail-head body the way n8n would.
 *
 * `resolve` decides what a cross-node lookup does. Passing null makes EVERY $('...') throw, which
 * is the state the rail found itself in on 100774 - and the case the node has to survive without
 * throwing, because a throw here strands the lease AND destroys the diagnostic.
 */
function runHead(body, item, resolve) {
  const items = [{ json: item }];
  const $input = { first: () => items[0], all: () => items, last: () => items[0] };
  const $ = (name) => {
    const v = resolve ? resolve(name) : null;
    if (!v) throw new Error('cannot resolve $(\'' + name + '\') from this item');
    return { first: () => ({ json: v }), all: () => [{ json: v }], item: { json: v } };
  };
  const fn = new Function('$input', '$', 'console', '$prevNode', '$runIndex', '$itemIndex',
    '$getWorkflowStaticData', 'return (function(){' + body + '})();');
  const out = fn($input, $, { log: function () {} }, { name: 'Some Failing Node' }, 0, 0,
                 () => ({}));
  return (out && out[0] && out[0].json) || {};
}

// --- 1. THE STAMP ITSELF ----------------------------------------------------------------------
// The property the fix rests on: after the rail head runs, run_id is ON THE ITEM, so the release
// reads $json and never performs the lookup that failed.
console.log('\n--- 1. every rail head stamps run_id and check_id on its own item ---');
for (const [file, head] of FLOWS) {
  const w = load(file);
  const body = nodeBody(w, head);
  if (!body) { ok(false, file + ': has a "' + head + '" node'); continue; }
  const r = runHead(body, { error: { statusCode: 500, error: 'boom' } }, () => allSources());
  ok(typeof r.run_id === 'string' && r.run_id.length > 0,
     file + ' [' + head + '] stamps a non-empty run_id', JSON.stringify(r.run_id));
  ok(typeof r.check_id === 'string' && r.check_id.length > 0,
     file + ' [' + head + '] stamps a non-empty check_id', JSON.stringify(r.check_id));
}

// --- 2. IT RETURNS '' RATHER THAN THROWING WHEN EVERY SOURCE IS GONE ---------------------------
// '' is the honest answer and the lease will refuse it - loudly, naming the real holder. A THROW
// here would be the strictly worse outcome: the release node never runs at all, so the lease is
// stranded exactly as it was on 100774, and Fail Loudly never gets to say why.
console.log('\n--- 2. no source resolves: return \'\', never throw ---');
for (const [file, head] of FLOWS) {
  const w = load(file);
  const body = nodeBody(w, head);
  if (!body) continue;
  let r = null, threw = null;
  try { r = runHead(body, { error: { statusCode: 500, error: 'boom' } }, null); }
  catch (e) { threw = e; }
  ok(!threw, file + ' [' + head + '] does not throw when every lookup fails',
     threw && threw.message);
  if (!threw) {
    ok(r.run_id === '' || r.run_id === 'unknown',
       file + ' [' + head + '] yields an empty/unknown run_id rather than a wrong one',
       JSON.stringify(r.run_id));
  }
}

// --- 3. THE v3 ERROR PARSING SURVIVED THE IDENTITY STAMP --------------------------------------
// The fixture is the real item from execution 99851: no error.message, the text is HTML inside
// error.error, and the status is buried in the Whitelabel page. v1 answered 'unknown error' to it.
console.log('\n--- 3. v3 parsing still reads the 99851 HTTP error item ---');
const REAL_99851 = { lease: 'erp', action: 'acquire', granted: true, holder_run_id: 'e2e-dtm',
  error: { statusCode: 500, isAxiosError: true, response: { status: 500 },
    error: "<html><body><h1>Whitelabel Error Page</h1><p>This application has no explicit mapping "
         + "for /error, so you are seeing this as a fallback.</p><div id='created'>Sun Aug 23 "
         + "23:29:50 GST 2026</div><div>There was an unexpected error (type=Http Status 498, "
         + "status=498).</div><div>Access Token is missing or malformed &lt;LOGOUT&gt;</div>"
         + "</body></html>" } };
for (const [file, head] of FLOWS) {
  if (head !== 'Capture Failure') continue;   // the two bespoke heads classify differently
  const body = nodeBody(load(file), head);
  if (!body) continue;
  const r = runHead(body, REAL_99851, () => allSources());
  const msg = String((r._failure || {}).message || '');
  ok(msg !== 'unknown error' && /498/.test(msg) && /AMBIGUOUS <LOGOUT>/.test(msg),
     file + ' reads the HTML error body, the 498, and names the denial shape', msg.slice(0, 120));
  ok(!/Whitelabel|explicit mapping/.test(msg),
     file + ' strips the boilerplate so the run log stays readable');
  ok(r.run_id === SENTINEL,
     file + ' still stamps run_id on an HTTP failure', JSON.stringify(r.run_id));
}

// --- 4. IT NEVER THROWS, WHATEVER IT IS HANDED ------------------------------------------------
console.log('\n--- 4. fuzz: the rail head is the last node allowed to fail ---');
const WEIRD = [{}, { error: null }, { error: 123 }, { error: { response: null } },
               { error: { error: null, statusCode: 'x' } }, { error: 'plain string' },
               { error: { message: 'thrown', node: { name: 'ERP Budget Gate' } } }];
for (const [file, head] of FLOWS) {
  const body = nodeBody(load(file), head);
  if (!body) continue;
  let threw = null;
  for (const weird of WEIRD) {
    for (const res of [() => allSources(), null]) {
      try { runHead(body, weird, res); }
      catch (e) { threw = threw || (JSON.stringify(weird) + ': ' + e.message); }
    }
  }
  ok(!threw, file + ' [' + head + '] survives every malformed error item', threw);
}

// --- 5. THE RELEASE NODES THEMSELVES ----------------------------------------------------------
// The structural half, and the one a checker should own permanently: no release mapping may be a
// BARE cross-node lookup, and an error-rail release must read the item first.
console.log('\n--- 5. no release mapping is a bare cross-node lookup ---');
const LEASE_WF = '9gVijqvtLVEhQZXz';
for (const [file] of FLOWS) {
  const w = load(file);
  for (const n of w.nodes) {
    const p = n.parameters || {};
    if (!/executeWorkflow$/.test(n.type)) continue;
    if (((p.workflowId || {}).value) !== LEASE_WF) continue;
    const val = ((p.workflowInputs || {}).value) || {};
    if (val.mode !== 'release') continue;
    const expr = String(val.run_id || '');
    const guarded = /try\s*\{/.test(expr) && /catch\s*\(/.test(expr);
    ok(guarded, file + ' :: "' + n.name + '" run_id is guarded, not a bare lookup', expr);
    if (/error/i.test(n.name)) {
      ok(/\$json\.run_id/.test(expr),
         file + ' :: "' + n.name + '" reads the stamped item BEFORE any lookup', expr);
    } else {
      // Deliberate: on a success path the current item is an ordinary pipeline item and its
      // run_id is the AUDIT run id, which is not always the lease holder - mv-stage4 leases
      // under runId + ':verify' while its case rows carry the bare runId. An item-first read
      // there would name a non-holder and turn the release into a silent no-op.
      ok(!/\$json\.run_id/.test(expr),
         file + ' :: "' + n.name + '" (success path) does NOT read $json.run_id', expr);
    }
  }
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' + (pass + fail)
                         : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
