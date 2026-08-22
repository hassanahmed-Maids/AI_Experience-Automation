// Offline suite for the ERP circuit breaker (tools/erp_breaker.js). No n8n, no network.
//
// The fixtures are the response SHAPES this project has actually seen from ERP, not invented
// ones: the Spring error body, the n8n error object that carries no status code anywhere
// predictable, the permanent INSUFFICIENT_PERMISSIONS on every replacement call, and the
// 498-inside-500 that a dead token produces. A breaker tested against tidy {statusCode: 503}
// objects would pass here and classify nothing correctly in production.
const B = require('../erp_breaker.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  <- ' + extra : '')); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
function head(t) { console.log('\n--- ' + t + ' ---'); }

// ---------------------------------------------------------------- fixtures
const OK_PLAN = { paymentPlan: { additionalDiscount: null }, currentPayment: { amountValue: 4715 } };

// What `Fetch Replacements` returns on EVERY call for an account without ClientReplacement.
// PROBE-RESULTS #6/#13. ~5,632 of these in an unbroken run is a NORMAL run, not a sick ERP.
const AUTH_401 = { error: { message: '401 - "{"timestamp":"2026-08-19T10:04:12.001+00:00","status":401,' +
  '"error":"Unauthorized","message":"INSUFFICIENT_PERMISSIONS","path":"/replacement/page/contract/1054346"}"',
  name: 'NodeApiError', httpCode: '401' } };

// A dead token. Generic 401 shape, arrives fast, every time - the opposite of an overloaded
// server, and it has its own detector (isTokenDead) with its own consequence.
const AUTH_LOGOUT = { error: { message: 'UNAUTHORIZED <LOGOUT>', httpCode: '401' } };

// ERP under load. The n8n error object does NOT carry the code in a predictable field, which
// is why the classifier scans text at all.
const ERR_503 = { error: { message: 'The service was temporarily unavailable - 503 Service Unavailable',
  name: 'NodeApiError' } };
const SPRING_500 = { timestamp: '2026-08-19T10:04:12.001+00:00', status: 500,
  error: 'Internal Server Error', message: 'could not extract ResultSet', path: '/get-client-details/1054346' };
const ERR_429 = { error: { message: '429 - Too Many Requests', httpCode: '429' } };
const ERR_TIMEOUT = { error: { message: 'connect ETIMEDOUT 10.0.0.4:443', name: 'NodeApiError' } };

function rep(item, n) { const a = []; for (let i = 0; i < n; i++) a.push(item); return a; }

// ---------------------------------------------------------------- classification
head('classification of the shapes ERP actually returns');
eq('a good body is ok', B.erpBreakerClassify(OK_PLAN), 'ok');
eq('Spring 500 body -> server_error', B.erpBreakerClassify(SPRING_500), 'server_error');
eq('n8n error mentioning 503 -> server_error', B.erpBreakerClassify(ERR_503), 'server_error');
eq('429 -> throttled', B.erpBreakerClassify(ERR_429), 'throttled');
eq('ETIMEDOUT -> timeout', B.erpBreakerClassify(ERR_TIMEOUT), 'timeout');
eq('INSUFFICIENT_PERMISSIONS -> auth, not degradation', B.erpBreakerClassify(AUTH_401), 'auth');
eq('UNAUTHORIZED <LOGOUT> -> auth', B.erpBreakerClassify(AUTH_LOGOUT), 'auth');

// A 401 that arrives wrapped in something mentioning a server error must STILL read as auth.
// Classified the other way round, the permanent replacement 401 trips the breaker on every run.
eq('auth wins over a server-ish wrapper',
  B.erpBreakerClassify({ error: { message: 'Internal Server Error', description: 'SecurityException: UNAUTHORIZED' } }),
  'auth');

head('THE RUN-KILLER: 5,632 consecutive 401s must not trip anything');
const allAuth = B.erpBreakerEvaluate({ phase: 'replacements', responses: rep(AUTH_401, 5632),
  elapsedMs: 5632 * 250, callsMade: 5632 });
ok('no trip on an all-401 replacement phase', allAuth.trip === null,
   'trip=' + JSON.stringify(allAuth.trip));
eq('...and none of them counted as degraded', allAuth.degraded_count, 0);
eq('...they are counted as auth, so the run can still see them', allAuth.counts.auth, 5632);
eq('...consecutive run of degradation is zero', allAuth.consecutive_max, 0);

head('consecutive 5xx/429/timeout');
const four = B.erpBreakerEvaluate({ phase: 'plan',
  responses: rep(OK_PLAN, 10).concat(rep(ERR_503, 4)).concat(rep(OK_PLAN, 10)) });
ok('4 consecutive does not trip', four.trip === null);
eq('...but is measured', four.consecutive_max, 4);

const five = B.erpBreakerEvaluate({ phase: 'plan',
  responses: rep(OK_PLAN, 10).concat(rep(ERR_503, 5)).concat(rep(OK_PLAN, 10)) });
ok('5 consecutive trips', five.trip !== null);
eq('...with the right code', five.trip && five.trip.code, 'consecutive_failures');
eq('...and points at where it started', five.first_degraded_index, 10);

const mixedFive = B.erpBreakerEvaluate({ phase: 'plan',
  responses: rep(OK_PLAN, 5).concat([ERR_503, ERR_429, SPRING_500, ERR_TIMEOUT, ERR_503]).concat(rep(OK_PLAN, 40)) });
ok('the five need not be the same kind of failure', mixedFive.trip !== null);
eq('...still consecutive_failures', mixedFive.trip && mixedFive.trip.code, 'consecutive_failures');

const brokenRun = B.erpBreakerEvaluate({ phase: 'plan',
  responses: rep(ERR_503, 4).concat([OK_PLAN]).concat(rep(ERR_503, 4)) });
ok('one success resets the consecutive count', brokenRun.trip === null || brokenRun.trip.code !== 'consecutive_failures',
   JSON.stringify(brokenRun.trip));

head('degraded rate - scattered failure that never reaches 5 in a row');
const scattered = [];
for (let i = 0; i < 100; i++) scattered.push(i % 3 === 0 ? ERR_503 : OK_PLAN);
const scatteredV = B.erpBreakerEvaluate({ phase: 'plan', responses: scattered });
eq('never 5 consecutive', scatteredV.consecutive_max, 1);
ok('but 34% failing trips on rate', scatteredV.trip !== null);
eq('...with the rate code', scatteredV.trip && scatteredV.trip.code, 'degraded_rate');

const mild = [];
for (let i = 0; i < 100; i++) mild.push(i % 6 === 0 ? ERR_503 : OK_PLAN);
ok('17% does not trip', B.erpBreakerEvaluate({ phase: 'plan', responses: mild }).trip === null);

const tiny = B.erpBreakerEvaluate({ phase: 'plan', responses: [ERR_503, OK_PLAN, ERR_503, OK_PLAN] });
ok('a 50% rate over 4 responses does not trip - too few to judge', tiny.trip === null,
   JSON.stringify(tiny.trip));

head('latency, measured the only way n8n allows: batch wall clock / calls made');
const slow = B.erpBreakerEvaluate({ phase: 'plan', responses: rep(OK_PLAN, 750),
  elapsedMs: 1500 * 800, callsMade: 1500, baselineMsPerCall: 250 });
ok('3.2x the first batch trips', slow.trip !== null && slow.trip.code === 'latency', JSON.stringify(slow.trip));
eq('...and reports the multiple', slow.latency_multiple, 3.2);

const bearable = B.erpBreakerEvaluate({ phase: 'plan', responses: rep(OK_PLAN, 750),
  elapsedMs: 1500 * 700, callsMade: 1500, baselineMsPerCall: 250 });
ok('2.8x does not trip', bearable.trip === null);

const noBase = B.erpBreakerEvaluate({ phase: 'plan', responses: rep(OK_PLAN, 750),
  elapsedMs: 1500 * 5000, callsMade: 1500 });
ok('a batch with no baseline cannot trip on latency', noBase.trip === null);
eq('...and SAYS it had no baseline, so a lost baseline is visible rather than silent',
   noBase.baseline_carried, false);

// ms_per_call must divide by CALLS, not by items. This phase makes 2 calls per case; dividing
// by cases would read every two-call phase as twice as slow as it is and trip at 1.5x.
const twoCalls = B.erpBreakerEvaluate({ phase: 'plan', responses: rep(OK_PLAN, 100),
  elapsedMs: 50000, callsMade: 200, baselineMsPerCall: 250 });
eq('ms/call divides by calls made, not by items', twoCalls.ms_per_call, 250);
ok('...so a healthy two-call phase does not trip', twoCalls.trip === null);

head('failure precedence and the message');
const both = B.erpBreakerEvaluate({ phase: 'plan', responses: rep(ERR_503, 60).concat(rep(OK_PLAN, 40)),
  elapsedMs: 100 * 9000, callsMade: 100, baselineMsPerCall: 250 });
eq('consecutive is reported ahead of rate and latency', both.trip.code, 'consecutive_failures');

const msg = B.erpBreakerMessage(five, 'Project Plan', 'run-123');
ok('the message names the run', msg.indexOf('run-123') !== -1);
ok('the message carries the counts', msg.indexOf(' ok, ') !== -1);
ok('the message says auth is not degradation', msg.toLowerCase().indexOf('auth is not counted') !== -1);
ok('the message forbids re-firing to see if it passes', msg.indexOf('DO NOT re-fire') !== -1);
ok('the message forbids raising the thresholds', msg.indexOf('DO NOT raise the thresholds') !== -1);
ok('the message points at the policy', msg.indexOf('ERP-LOAD-POLICY.md') !== -1);

head('empty and degenerate input');
const empty = B.erpBreakerEvaluate({ phase: 'plan', responses: [] });
ok('an empty batch does not trip', empty.trip === null);
eq('...and reports nothing measured', empty.ms_per_call, null);

console.log('\n--- a healthy body is not a server error just because of its digits ---');
// FOUND 2026-08-22 while embedding the breaker into CC Price Stage 1. The bare code scan ran
// over the WHOLE item, so any successful response whose DATA contained 502/503/504 anywhere was
// classified as a server error. Not hypothetical: 5040 is a real price on the CC price card and
// contains "504", and Stage 2 ships per-contract payloads full of ids and amounts - so five
// ordinary contracts in a row could trip the breaker against a perfectly healthy ERP. The
// reaction to a spurious trip is to raise the thresholds until it stops, at which point the
// breaker detects nothing at all.
eq('a contract id of 503 is data, not a status code',
   B.erpBreakerClassify({ body: [{ contractId: 503 }], statusCode: 200 }), 'ok');
eq('1502 does not match 502 as a substring either',
   B.erpBreakerClassify({ body: [{ contractId: 1502, clientId: 6318 }], statusCode: 200 }), 'ok');
eq('nor does AED 5040 - a real price on the card this check audits',
   B.erpBreakerClassify({ body: { price_inc_vat: 5040 }, statusCode: 200 }), 'ok');

console.log('\n--- ...while every shape a real 5xx arrives in is still caught ---');
eq('the n8n error object, where the code is only in the message text',
   B.erpBreakerClassify({ error: { message: '503 - {"status":503,"error":"Service Unavailable"}' } }), 'server_error');
eq('a bare 502 in the error region',
   B.erpBreakerClassify({ error: { message: '502 Bad Gateway' } }), 'server_error');
eq('an explicit numeric status',
   B.erpBreakerClassify({ statusCode: 500 }), 'server_error');
eq('a Spring error body nested under body, caught by the PHRASE - which is why the phrase scans still run over the whole item',
   B.erpBreakerClassify({ body: { status: 503, error: 'Service Unavailable' }, statusCode: 200 }), 'server_error');
// THESE TWO CARRY NO PHRASE AT ALL, so only the bare-digit scan can classify them. Without
// them the cases above pass on "bad gateway" and "service unavailable" and the digit scan could
// be deleted outright with every test still green - which is what mutation testing reported.
eq('a bare 504 in the error region, with no phrase to fall back on',
   B.erpBreakerClassify({ error: { message: '504 - {}' } }), 'server_error');
eq('and the same in a top-level message, which is why message is part of the error region',
   B.erpBreakerClassify({ message: '503 - upstream closed' }), 'server_error');
eq('a top-level string message is part of the error region',
   B.erpBreakerClassify({ message: 'connect ETIMEDOUT 10.0.0.1:443' }), 'timeout');

console.log('\n' + (fail === 0 ? 'all ' + pass + ' passed' : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
