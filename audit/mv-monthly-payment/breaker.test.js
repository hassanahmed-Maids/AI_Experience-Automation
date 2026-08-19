const assert = require('assert');
const { classify, trip, denialAdvice } = require('./breaker.js');

let n = 0;
const ok = (cond, what) => { n++; assert.ok(cond, what); };
const eq = (a, b, what) => { n++; assert.deepStrictEqual(a, b, what); };

const R = (statusCode, body) => ({ json: { statusCode, body } });
const good = (k) => Array.from({ length: k }, () => R(200, { content: [], totalElements: 0 }));
const scored = (k, gate) => Array.from({ length: k }, () => ({ gate: gate || '8', state: 'finding' }));
const clean = (det, led) => trip({ scored: scored(25), persisted: 25, det, led });

// --- classify: the real response shapes, taken from live probes ---------------------------

// The shape probed at 2026-08-19T11:33Z: HTTP 500 carrying a 498 body. The JWT's own exp said
// 22:00Z, so status code alone cannot tell you the token is gone - only the body can.
const DEAD_BODY = {
  timestamp: '2026-08-19 15:33:29', status: 498, error: 'Http Status 498',
  message: 'Access Token is missing or malformed <LOGOUT>', path: '/clientmgmt/contract/search/page',
};
eq(classify([R(500, DEAD_BODY)]).sessionInactive, 1, 'the live 498-inside-500 body is read as a session failure');
eq(classify([R(500, JSON.stringify(DEAD_BODY))]).sessionInactive, 1, 'same body arriving as a string');
eq(classify([R(503, '<html>503 Service Unavailable</html>')]).unavailable, 1, 'nginx 503 is unavailability');
eq(classify([R(502, '')]).unavailable, 1, '502 is unavailability');
eq(classify([R(504, '')]).unavailable, 1, '504 is unavailability');
eq(classify([R(401, { message: 'PAGE_CODE_MISSING' })]).denied, 1, '401 is a denial, never unavailability');
eq(classify([R(403, {})]).denied, 1, '403 is a denial');
eq(classify([R(500, { message: 'SecurityException' })]).other, 1, 'a 500 that is not the token shape is not a token death');
eq(classify([R(200, {})]).ok, 1, '200 is ok');
eq(classify([{ json: { error: 'ECONNRESET' } }]).other, 1, 'a transport failure with no status lands in other');
eq(classify([]).total, 0, 'no items classifies to zeros');
eq(classify(good(3)).total, 3, 'total counts every item');

// A session failure must not be mistaken for a module fault: the operator actions differ (log back
// in / re-token vs wait for the module to recover), and neither wait ends the other's problem.
ok(classify([R(500, DEAD_BODY)]).unavailable === 0, 'a session failure is not counted as unavailability');

// --- trip: one dead read stops the run immediately ----------------------------------------

const NONE = classify([]);
eq(trip({ scored: scored(25), persisted: 25, det: classify([R(500, DEAD_BODY)]), led: NONE }).code,
  'ERP_SESSION_INACTIVE', 'a SINGLE session-inactive read trips the breaker - no threshold');
eq(trip({ scored: scored(1), persisted: 1, det: NONE, led: classify([R(500, DEAD_BODY)]) }).code,
  'ERP_SESSION_INACTIVE', 'the ledger surface trips it too');

// The SECOND session-drop shape, probed live at 2026-08-19T14:42Z after the breaker tripped on it
// mid-run. Status 401, developermessage UNAUTHENTICATED, body "UNAUTHORIZED <LOGOUT>" - identical
// meaning to the 5xx/498 form, completely different status class. Classified as a plain 401 denial it
// tells the operator to go request a permission they already hold.
const LOGOUT_401 = {
  timestamp: '2026-08-19 18:42:17', status: 401, error: 'Unauthorized',
  message: 'UNAUTHORIZED <LOGOUT>', path: '/clientmgmt/contract/search/page',
};
eq(classify([R(401, LOGOUT_401)]).sessionInactive, 1, 'a 401 carrying <LOGOUT> is a dropped session');
eq(classify([R(401, LOGOUT_401)]).denied, 0, 'and is NOT counted as a permission denial');
eq(trip({ scored: scored(25), persisted: 25, det: classify([R(401, LOGOUT_401)]), led: NONE }).code,
  'ERP_SESSION_INACTIVE', 'one such read stops the run, same as the 5xx form');
eq(denialAdvice(401, LOGOUT_401), 'SESSION_INACTIVE',
  'the operator is told to restore the session, not to request access');
// A 401 WITHOUT the marker is still a genuine access problem - the distinction has to survive.
eq(classify([R(401, { message: 'PAGE_CODE_MISSING' })]).denied, 1,
  'a 401 with no LOGOUT marker is still a real denial');
eq(denialAdvice(401, { message: 'Forbidden' }), 'ACCESS_DENIED', 'and still reads as an access problem');

// --- trip: unavailability needs three, so one blip does not kill a 5-hour run ---------------

eq(clean(classify([R(503, '')]), NONE), null, 'one 503 does not trip');
eq(clean(classify([R(503, ''), R(503, '')]), NONE), null, 'two 503s do not trip');
eq(clean(classify([R(503, ''), R(503, ''), R(503, '')]), NONE).code,
  'ERP_MODULE_UNAVAILABLE', 'three 503s in one chunk trip');
eq(clean(classify([R(503, ''), R(503, '')]), classify([R(503, '')])).code,
  'ERP_MODULE_UNAVAILABLE', 'the threshold is across BOTH surfaces, not per surface');

// --- trip: denials ------------------------------------------------------------------------

eq(clean(classify([R(401, {}), R(401, {}), R(401, {})]), NONE).code,
  'ERP_ACCESS_DENIED', 'three refusals trip');
eq(clean(classify([R(401, {}), R(401, {})]), NONE), null, 'two refusals do not');

// --- trip: the surface storm catches shapes the status classes miss -------------------------

// Verdict-level backstop: reads that fail in ways classify() files as "other" still show up as
// gate=surface on the cases, so the storm test catches them.
eq(trip({ scored: scored(25, 'surface'), persisted: 25, det: classify(good(25)), led: classify(good(25)) }).code,
  'ERP_SURFACE_STORM', 'a whole chunk unreadable trips even when every status looked benign');
// The threshold is inclusive: exactly 40% of a chunk unreadable is already a storm.
{
  const at = scored(10, 'surface').concat(scored(15, '8')); // 10/25 = 40.0%
  eq(trip({ scored: at, persisted: 25, det: NONE, led: NONE }).code, 'ERP_SURFACE_STORM',
    'exactly 40% unreadable trips - the threshold is inclusive');
  const below = scored(9, 'surface').concat(scored(16, '8')); // 9/25 = 36.0%
  eq(trip({ scored: below, persisted: 25, det: NONE, led: NONE }), null,
    'just below 40% proceeds - a few unreadable contracts are normal and are filed for a human');
}
eq(trip({ scored: scored(4, 'surface'), persisted: 4, det: NONE, led: NONE }), null,
  'a tiny chunk is exempt - 4 unreadable out of 4 is not a population signal');

// --- trip: lost case rows -----------------------------------------------------------------

eq(trip({ scored: scored(25), persisted: 0, det: classify(good(25)), led: classify(good(25)) }).code,
  'CASE_ROWS_LOST', 'verdicts computed and then lost is a hard stop, not a quiet chunk');
eq(trip({ scored: [], persisted: 0, det: NONE, led: NONE }), null,
  'an empty chunk is not a loss');

// --- the ordinary case ---------------------------------------------------------------------

eq(trip({ scored: scored(25), persisted: 25, det: classify(good(25)), led: classify(good(25)) }), null,
  'a healthy chunk proceeds');

// --- Stage 1's denial advice: the message an operator acts on ------------------------------

// Probed live 2026-08-19T11:33Z. The token's own JWT exp claimed 22:00Z and had 10h left, yet the
// server had already killed the session: <LOGOUT>. Trusting exp over the response body would have
// started a 5-hour run that could never make a single successful read.
eq(denialAdvice(500, DEAD_BODY), 'SESSION_INACTIVE', 'a 498-inside-500 is a session failure, not a server fault');
// The same token that produced DEAD_BODY at 11:33Z returned HTTP 200 / total 22870 at 11:45Z after
// the operator logged back in. So this shape is NOT proof the token must be replaced - the session
// was simply not active. Advising "get a fresh token" as the only remedy sends the operator to the
// wrong place half the time.
ok(denialAdvice(500, DEAD_BODY) !== 'TOKEN_DEAD', 'the shape is never reported as a permanently dead token');
eq(denialAdvice(503, '<html>503</html>'), 'MODULE_UNAVAILABLE', '503 tells the operator to wait, not to re-token');
eq(denialAdvice(401, { message: 'PAGE_CODE_MISSING' }), 'ACCESS_DENIED', '401 is an access problem');
eq(denialAdvice(500, { message: 'SecurityException: not authorised' }), 'EXECUTOR_UNAUTHORISED', 'the executor shape is distinct');
eq(denialAdvice(500, { message: 'NullPointerException' }), 'SERVER_FAULT', 'an ordinary 500 is a server fault');
eq(denialAdvice(418, ''), 'UNEXPECTED', 'anything else is not guessed at');

console.log(n + ' run-control assertions passed');
