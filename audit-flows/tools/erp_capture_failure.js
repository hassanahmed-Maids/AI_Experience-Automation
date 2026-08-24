// Capture Failure - the FIRST node on the error rail, and the reason the rail can still say what
// went wrong. CANONICAL COPY: tools/erp_capture_failure.js. Deployed by
// tools/make_capture_failure_ops.py; do not hand-edit a deployed copy without changing this one.
//
// WHY IT EXISTS. The rail used to run `failing node -> Release Lease (error) -> Fail Loudly`, and
// Release Lease (error) is an Execute Sub-workflow node with waitForSubWorkflow: true. That node
// does not pass its input through - it REPLACES the item with whatever the lease workflow
// returned. So by the time Fail Loudly read $input, the error payload was gone and every message
// it could produce was 'FAILED at "unknown node": unknown error'. Twelve of thirteen flows shipped
// that way (2026-08-23). The error is captured HERE, before the lease call can overwrite it.
//
// IT DOES NOT THROW. The release has to happen first, and a throw here would strand the lease -
// the exact hole the rail exists to close.
//
// ------------------------------------------------------------------------------------------
// v2, 2026-08-23, written after the FIRST time this rail ever fired for real (execution 99851).
// v1 read `error.message` and got 'unknown error' anyway, because AN n8n HTTP ERROR ITEM HAS NO
// error.message. What it has is:
//
//   { error: { statusCode: 500,
//              error: "<html>... type=Http Status 498 ... Access Token is missing or malformed
//                      &lt;LOGOUT&gt; ...</html>",     <- a STRING, sometimes HTML, sometimes JSON
//              isAxiosError: true,
//              response: { status: 500, headers: {...} } } }
//
// and the rest of the item is whatever flowed IN to the failing node - in 99851 that was the
// lease's own acquire payload, which is why `item.message` was undefined too.
//
// This was already written down. MV Overstay Fines' `Build Error Callback` says it almost word for
// word, from execution 76767 back in the same repo. It was not carried into the shared node, so
// every flow got the naive version. The lesson is in ERP-LOAD-POLICY.md.
// ------------------------------------------------------------------------------------------
const item = $input.first().json || {};
const raw = item.error;
const err = (raw && typeof raw === 'object') ? raw : {};

function firstString() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// The status lives in three different places depending on how the node failed.
const status = Number(err.statusCode) || Number(err.response && err.response.status) ||
               Number(item.statusCode) || null;

// The text is a string that may be HTML, may be JSON, may be a plain throw message.
let text = firstString(err.message, typeof raw === 'string' ? raw : '', err.error,
                       item.message, err.description);
if (text && text.charAt(0) === '{') {
  try {
    const p = JSON.parse(text);
    text = firstString(p.message, p.error, p.detail, text);
  } catch (e) { /* not JSON after all - keep the raw string */ }
}
// ERP serves its refusals as a Whitelabel error PAGE. The sentence worth reading is the last
// <div>; everything around it is boilerplate that would bury the message in the run log.
if (/<html/i.test(text)) {
  const divs = text.match(/<div[^>]*>([^<]+)<\/div>/gi) || [];
  const inner = divs.map(function (d) { return d.replace(/<[^>]+>/g, '').trim(); })
                    .filter(function (t) { return t && !/^\w{3} \w{3} +\d/.test(t); });
  const joined = inner.join(' | ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  text = joined || text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

// NAME THE DENIAL SHAPE, because it decides what the operator does next and the status code alone
// sends them the wrong way. A dropped ERP session appears as BOTH 401 and 5xx-498, and reading the
// status class first tells someone to go request a permission they already hold.
//
// <LOGOUT> IS AMBIGUOUS AND v2 GOT THIS WRONG. v2 read the marker and said flatly "the session is
// dead, go get a fresh token". Measured 2026-08-24: GET /accounting/transactions/{id} answers
// 401 "UNAUTHORIZED <LOGOUT>" while the SAME token, in the same second, gets HTTP 200 from
// /clientmgmt/contract/search/page. The session was fine; that API is simply not registered under
// the pagecode the node sends, and ERP dresses a permission refusal in the same marker as a dead
// session. Telling the operator to re-token there sends them round a loop that can never succeed.
//
// The discriminator is the developerMessage RESPONSE HEADER, which n8n does not put on the error
// item - so this node names both readings and says which header settles it, rather than guessing.
let shape = '';
if (/<LOGOUT>|UNAUTHENTICATED|Access Token is missing or malformed/i.test(text)) {
  shape = 'AMBIGUOUS <LOGOUT> - ERP uses this marker for TWO different things and the status code ' +
          'does not separate them. (a) The session really is dead: measured 2026-08-23, a session ' +
          'died 4h03m after its token was issued while the exp claim still had 2.5h to run, so the ' +
          'exp tells you nothing. (b) The API is not registered under the pagecode this node sends: ' +
          'measured 2026-08-24, GET /accounting/transactions/{id} returns this while the same token ' +
          'gets HTTP 200 elsewhere in the same second. SETTLE IT with the developerMessage response ' +
          'header: API_NOT_FOUND_FOR_PAGE or PAGE_CODE_MISSING means the REQUEST is wrong and ' +
          're-tokening will loop for ever; absent means the session or the permission is. Check ' +
          'another endpoint with the same token before you conclude anything.';
} else if (status === 503 || status === 502 || status === 504) {
  shape = 'ERP MODULE UNAVAILABLE - do not retry in a loop and do not re-token; this is not auth.';
} else if (status === 401 || status === 403) {
  shape = 'ACCESS DENIED with no dropped-session marker - read the developermessage header: a ' +
          'real permission gap is a FINDING to report, not something to route around.';
}

// The node name is only ever present when the failure came from a Code node or a sub-workflow
// throw. n8n does NOT put it on an HTTP error item, so this says so rather than inventing one.
const node = String((err.node && err.node.name) || item.node ||
                    (status ? 'an HTTP node (n8n does not name it on an HTTP error item)'
                            : 'unknown node'));

const message = [status ? 'HTTP ' + status : '', text || 'unknown error', shape]
  .filter(function (x) { return x; }).join(' - ');

console.log(JSON.stringify({ stage: 'capture_failure', failed_node: node, status: status,
  error: message,
  note: 'Captured before Release Lease (error), which replaces the item with the lease\'s own ' +
        'output. The rest of the rail reads this node by name.' }));

return [{ json: { _failure: { node: node, message: message, status: status,
                              at: new Date().toISOString() } } }];
