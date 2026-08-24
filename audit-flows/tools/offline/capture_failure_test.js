/**
 * capture_failure_test.js - the canonical Capture Failure node, against real error items.
 *
 * WHY THIS FILE EXISTS. v1 of that node was written from first principles, deployed to twelve
 * flows, and produced 'unknown node: unknown error' the very first time a rail fired for real
 * (execution 99851, 2026-08-23). It read `error.message`, and an n8n HTTP error item does not
 * have one. The fixture below is that exact item, copied verbatim out of the execution - so the
 * case that beat the node is now the case it is tested against.
 *
 * Every fixture here is a shape SEEN IN THIS PROJECT, not one imagined for the test.
 *   node tools/offline/capture_failure_test.js
 */
const fs = require('fs');
const path = require('path');
const BODY = fs.readFileSync(path.join(__dirname, '..', 'erp_capture_failure.js'), 'utf8');

function capture(item) {
  const $input = { first: () => ({ json: item }) };
  const fn = new Function('$input', 'console', 'return (function(){' + BODY + '})();');
  return fn($input, { log: function () {} })[0].json._failure;
}

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (detail ? '\n       -> ' + detail : '')); }
}

// --- 1. THE ITEM THAT BEAT v1 ----------------------------------------------------------------
// Execution 99851, Get Dummy Ticket Transactions, error output. Note there is no error.message,
// the text is HTML in error.error, and the rest of the item is the LEASE's acquire payload -
// which is what flowed into the failing node.
const REAL_99851 = { lease: 'erp', action: 'acquire', granted: true, holder_run_id: 'e2e-dtm',
  error: { statusCode: 500, isAxiosError: true, response: { status: 500 },
    error: "<html><body><h1>Whitelabel Error Page</h1><p>This application has no explicit mapping "
         + "for /error, so you are seeing this as a fallback.</p><div id='created'>Sun Aug 23 "
         + "23:29:50 GST 2026</div><div>There was an unexpected error (type=Http Status 498, "
         + "status=498).</div><div>Access Token is missing or malformed &lt;LOGOUT&gt;</div>"
         + "</body></html>" } };
const r1 = capture(REAL_99851);
ok(r1.message !== 'unknown error', 'the real 99851 item no longer reports "unknown error"', r1.message);
ok(/498/.test(r1.message), 'it surfaces the 498 buried in the Whitelabel HTML', r1.message);
ok(/AMBIGUOUS <LOGOUT>/.test(r1.message),
   'and names the denial SHAPE, because 500-vs-498-vs-401 sends the operator the wrong way',
   r1.message);
// v2 said flatly "the session is dead, re-token". Measured 2026-08-24 that is wrong half the time:
// GET /accounting/transactions/{id} returns 401 <LOGOUT> while the SAME token gets 200 elsewhere in
// the same second, because the API is not registered under the node's pagecode. Re-tokening there
// loops for ever. The node must offer both readings and name the header that settles it.
ok(/API_NOT_FOUND_FOR_PAGE|developerMessage/.test(r1.message),
   'and points at developerMessage, the header that separates a dead session from a wrong request',
   r1.message);
ok(!/^ERP SESSION NOT ACTIVE/.test(r1.message),
   'it does NOT assert the session is dead on the marker alone', r1.message);
ok(!/Whitelabel|explicit mapping/.test(r1.message),
   'the boilerplate around the message is stripped, so the run log stays readable', r1.message);
ok(r1.status === 500, 'the status is carried separately', String(r1.status));

// --- 2. A Code node or sub-workflow throw - the one case that DOES name the node ---------------
const THROWN = { error: { message: 'ERP CALL BUDGET EXCEEDED: 47000 calls against a budget of 2000',
                          node: { name: 'ERP Budget Gate' } } };
const r2 = capture(THROWN);
ok(r2.node === 'ERP Budget Gate', 'a Code-node throw is attributed to the node that threw', r2.node);
ok(/BUDGET EXCEEDED/.test(r2.message), 'and its message is passed through intact', r2.message);

// --- 3. An HTTP failure is NOT attributed to a node it cannot know ----------------------------
ok(/does not name it/.test(r1.node),
   'an HTTP error item says n8n did not name the node, rather than inventing one', r1.node);

// --- 4. Shapes seen in earlier executions -----------------------------------------------------
const r3 = capture({ error: 'connect ETIMEDOUT 10.0.0.1:443' });
ok(/ETIMEDOUT/.test(r3.message), 'a bare string error survives', r3.message);

const r4 = capture({ error: { statusCode: 503, error: 'Service Unavailable' } });
ok(/MODULE UNAVAILABLE/.test(r4.message),
   'a 503 is named as an outage and explicitly NOT as auth - re-tokening it wastes the operator',
   r4.message);

const r5 = capture({ error: { statusCode: 401, error: 'UNAUTHORIZED' } });
ok(/ACCESS DENIED/.test(r5.message) && !/AMBIGUOUS <LOGOUT>/.test(r5.message),
   'a 401 WITHOUT the dropped-session marker is a permission gap, not a dead session', r5.message);

const r6 = capture({ error: { statusCode: 401, error: 'UNAUTHORIZED <LOGOUT>' } });
ok(/AMBIGUOUS <LOGOUT>/.test(r6.message),
   'a 401 WITH the marker is reported as ambiguous, not asserted to be a dead session', r6.message);

const r7 = capture({ error: { statusCode: 400, error: '{"status":400,"message":"searchfilter is malformed"}' } });
ok(/searchfilter is malformed/.test(r7.message), 'a JSON-string error body is unwrapped', r7.message);

// --- 5. It must never throw, whatever it is handed --------------------------------------------
// A throw here would strand the ERP lease, which is the hole the whole rail exists to close.
let threw = false;
for (const weird of [{}, { error: null }, { error: 123 }, { error: { response: null } },
                     { error: { error: null, statusCode: 'x' } }]) {
  try { capture(weird); } catch (e) { threw = true; console.log('       threw on ' + JSON.stringify(weird) + ': ' + e.message); }
}
ok(!threw, 'it never throws - a throw here would strand the lease it is meant to protect');
ok(capture({}).message === 'unknown error',
   'and with nothing to report it still says so honestly');

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' + (pass + fail) : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
